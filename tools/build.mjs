#!/usr/bin/env node
/**
 * BOTFAKE — build & verify
 * ---------------------------------------------------------------------------
 * Một nguồn version duy nhất: `version.json`  { base, build }
 *
 *   base  → version của tiện ích Chrome  (vd "1.91.72" — CHỈ số, tối đa 4 phần)
 *   build → hậu tố bản dựng của userscript (vd "W200.14")
 *
 * Build tự động ghi lại version vào 3 nơi đang được dùng:
 *   - manifest.json                      "version": base
 *   - scripts/pancake-send-lite.user.js   // @version base-build   (chữ thường)
 *                                        const APP_VERSION = 'base-build'
 *   - update.xml                         <updatecheck version='base'>
 *
 * Cách dùng:
 *   node tools/build.mjs --check   # chỉ kiểm tra, KHÔNG ghi gì (dùng cho CI/pre-commit)
 *   node tools/build.mjs           # đồng bộ version + kiểm tra + đóng gói dist/*.zip
 *   node tools/build.mjs --crx     # thêm: ký & ghi botfake.crx (cần khoá ký)
 *
 * Khoá ký (KHÔNG BAO GIỜ commit — repo công khai):
 *   installer/extension-signing-key.pem   (mặc định)  hoặc  env CRX_SIGNING_KEY=/path/to/key.pem
 *   Không có khoá → bỏ qua bước crx, chỉ xuất zip + cảnh báo crx cũ.
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync,
} from 'node:fs';
import {
  createHash, createPrivateKey, createPublicKey, sign as cryptoSign,
} from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = new Set(process.argv.slice(2));
const CHECK = ARGS.has('--check');
const WANT_CRX = ARGS.has('--crx');

const MANIFEST = 'manifest.json';
const USERSCRIPT = 'scripts/pancake-send-lite.user.js';
const UPDATE_XML = 'update.xml';
const CRX_OUT = 'botfake.crx';
const DIST = 'dist';
const KEY_CANDIDATES = [
  process.env.CRX_SIGNING_KEY,
  'installer/extension-signing-key.pem',
].filter(Boolean);

const abs = (p) => path.join(ROOT, p);
const rel = (p) => path.relative(ROOT, p);
const read = (p) => readFileSync(abs(p), 'utf8');

const problems = [];
const fixes = [];
const warnings = [];
const notes = [];

/* ------------------------------ VERSION ------------------------------ */

function loadVersion() {
  const v = JSON.parse(read('version.json'));
  const base = String(v.base || '').trim();
  const build = String(v.build || '').trim();

  if (!/^(\d{1,5})(\.\d{1,5}){0,3}$/.test(base)) {
    throw new Error(
      `version.json: "base" = "${base}" không hợp lệ. Chrome chỉ nhận 1–4 phần số ` +
      `(0–65535), vd "1.91.72". Hậu tố chữ như "-w200.14" phải nằm ở "build".`,
    );
  }
  for (const part of base.split('.')) {
    if (String(Number(part)) !== part) {
      throw new Error(`version.json: phần "${part}" trong "base" có số 0 vô nghĩa ở đầu.`);
    }
    if (Number(part) > 65535) throw new Error(`version.json: phần "${part}" vượt 65535.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(build)) {
    throw new Error(`version.json: "build" = "${build}" không hợp lệ (chỉ chữ/số . _ -).`);
  }
  return {
    base,
    build,
    userVersion: `${base}-${build.toLowerCase()}`,
    appVersion: `${base}-${build}`,
  };
}

/* ------------------------------ SYNC ------------------------------ */

/** Áp transform; ghi file khi khác (trừ --check). Trả về true nếu lệch. */
function syncFile(file, transform) {
  const before = read(file);
  const after = transform(before);
  if (after === before) return false;
  if (!CHECK) writeFileSync(abs(file), after);
  fixes.push(file);
  return true;
}

function syncManifest(ver) {
  const m = JSON.parse(read(MANIFEST));
  let changed = false;
  if (m.version !== ver.base) { m.version = ver.base; changed = true; }
  if (!m.update_url) {
    // Chrome dùng update_url để tự cập nhật từ file .crx ngoài Web Store.
    m.update_url = 'https://chongoan4444.github.io/SALESCRIPT/update.xml';
    changed = true;
  }
  if (!changed) return false;
  if (!CHECK) writeFileSync(abs(MANIFEST), JSON.stringify(m, null, 2) + '\n');
  fixes.push(MANIFEST);
  return true;
}

function syncUserscript(ver) {
  return syncFile(USERSCRIPT, (src) => {
    let out = src;
    // header Tampermonkey
    out = out.replace(
      /^(\/\/\s*@version\s+)(\S+)\s*$/m,
      (_m, lead) => `${lead}${ver.userVersion}`,
    );
    // hằng số hiển thị trên tiêu đề panel
    out = out.replace(
      /(const APP_VERSION = ')([^']*)(')/,
      (_m, a, _old, c) => `${a}${ver.appVersion}${c}`,
    );
    return out;
  });
}

function syncUpdateXml(ver) {
  return syncFile(UPDATE_XML, (src) => src.replace(
    /(<updatecheck\b[^>]*\bversion=')[^']*(')/,
    (_m, a, b) => `${a}${ver.base}${b}`,
  ));
}

function syncPackageJson(ver) {
  if (!existsSync(abs('package.json'))) return false;
  return syncFile('package.json', (src) => {
    const pkg = JSON.parse(src);
    if (pkg.version === ver.base) return src;
    pkg.version = ver.base;
    return JSON.stringify(pkg, null, 2) + '\n';
  });
}

/* ------------------------------ VALIDATE ------------------------------ */

function validateManifest(ver) {
  let m;
  try {
    m = JSON.parse(read(MANIFEST));
  } catch (e) {
    problems.push(`${MANIFEST}: JSON không hợp lệ — ${e.message}`);
    return;
  }

  if (m.manifest_version !== 3) problems.push(`${MANIFEST}: manifest_version phải là 3.`);
  if (m.version !== ver.base) {
    problems.push(`${MANIFEST}: version "${m.version}" ≠ version.json base "${ver.base}".`);
  }

  // Gom mọi tài nguyên manifest trỏ tới và kiểm tra tồn tại thật.
  const refs = new Set();
  const addref = (p) => { if (typeof p === 'string' && p) refs.add(p); };
  Object.values(m.icons || {}).forEach(addref);
  Object.values((m.action && m.action.default_icon) || {}).forEach(addref);
  addref(m.action && m.action.default_popup);
  addref(m.background && m.background.service_worker);
  addref(m.options_page);
  addref(m.options_ui && m.options_ui.page);
  (m.content_scripts || []).forEach((cs) => {
    (cs.js || []).forEach(addref);
    (cs.css || []).forEach(addref);
  });
  (m.web_accessible_resources || []).forEach((w) => (w.resources || []).forEach(addref));

  for (const r of [...refs].sort()) {
    if (/[*]/.test(r)) continue; // wildcard: không kiểm tra
    if (!existsSync(abs(r))) {
      problems.push(`${MANIFEST}: trỏ tới file KHÔNG tồn tại → "${r}"`);
    }
  }

  // Bố cục thư mục: code tiện ích phải nằm trong extension/, userscript trong scripts/.
  for (const r of [...refs].sort()) {
    if (/[*]/.test(r) || !existsSync(abs(r))) continue;
    if (r === USERSCRIPT) continue;
    if (!r.startsWith('extension/')) {
      problems.push(`${MANIFEST}: "${r}" phải nằm dưới extension/ (sai bố cục).`);
    }
  }

  const csJs = (m.content_scripts || []).flatMap((c) => c.js || []);
  if (!csJs.includes(USERSCRIPT)) {
    problems.push(`${MANIFEST}: content_scripts thiếu "${USERSCRIPT}".`);
  }
  if (!csJs.includes('extension/bridge.js')) {
    problems.push(`${MANIFEST}: content_scripts thiếu "extension/bridge.js" (cầu MAIN ↔ SW).`);
  }

  // overlay.js chạy trên MỌI tab → path trong code cũng phải khớp bố cục mới.
  const bg = read('extension/background.js');
  for (const [file, injected] of [
    ['extension/overlay.js', 'extension/overlay.js'],
    ['extension/bridge.js', 'extension/bridge.js'],
  ]) {
    if (!bg.includes(`files: ['${injected}']`)) {
      problems.push(`extension/background.js: executeScript không trỏ tới "${injected}" (tab đang mở sẽ mất ${file}).`);
    }
  }
  const popup = read('extension/popup.js');
  if (!popup.includes(`files: ['${USERSCRIPT}']`)) {
    problems.push(`extension/popup.js: nút "Hiện panel" không trỏ tới "${USERSCRIPT}".`);
  }
  if (!popup.includes('extension/popup.js')) notes.push('popup: dùng đường dẫn mới OK');

  // popup.html nằm trong extension/ → script src phải là đường dẫn tương đối cùng thư mục.
  const popupHtml = read('extension/popup.html');
  if (/<script[^>]+src="(?:\.\/)?popup\.js"/.test(popupHtml) === false) {
    problems.push('extension/popup.html: không thấy <script src="popup.js">.');
  }
}

function validateUserscript(ver) {
  const src = read(USERSCRIPT);
  const header = src.slice(0, 4000);
  const m = /^\/\/\s*@version\s+(\S+)\s*$/m.exec(header);
  if (!m) {
    problems.push(`${USERSCRIPT}: thiếu dòng "// @version" trong header.`);
  } else if (m[1] !== ver.userVersion) {
    problems.push(`${USERSCRIPT}: @version "${m[1]}" ≠ "${ver.userVersion}".`);
  }
  const app = /const APP_VERSION = '([^']*)'/.exec(src);
  if (!app) {
    problems.push(`${USERSCRIPT}: không tìm thấy "const APP_VERSION".`);
  } else if (app[1] !== ver.appVersion) {
    problems.push(`${USERSCRIPT}: APP_VERSION "${app[1]}" ≠ "${ver.appVersion}".`);
  }
  if (!/@match\s+https:\/\/pancake\.vn/.test(header)) {
    problems.push(`${USERSCRIPT}: header thiếu @match pancake.vn.`);
  }
}

function validateUpdateXml(ver) {
  const xml = read(UPDATE_XML);
  const v = /<updatecheck\b[^>]*\bversion='([^']*)'/.exec(xml);
  if (!v) problems.push(`${UPDATE_XML}: không tìm thấy <updatecheck version='…'>.`);
  else if (v[1] !== ver.base) {
    problems.push(`${UPDATE_XML}: version "${v[1]}" ≠ "${ver.base}" (Chrome sẽ không thấy bản mới).`);
  }
  const cb = /<updatecheck\b[^>]*\bcodebase='([^']*)'/.exec(xml);
  if (!cb) problems.push(`${UPDATE_XML}: thiếu codebase.`);
  else {
    const name = cb[1].split('/').pop();
    if (name !== CRX_OUT) {
      warnings.push(`${UPDATE_XML}: codebase trỏ tới "${name}" nhưng build xuất "${CRX_OUT}".`);
    }
  }
  const appid = /<app\b[^>]*\bappid='([^']*)'/.exec(xml);
  if (!appid) problems.push(`${UPDATE_XML}: thiếu appid.`);
}

/* ------------------------------ PACKAGE ------------------------------ */

function zipFiles() {
  mkdirSync(abs(DIST), { recursive: true });
  const zipPath = path.join(DIST, 'botfake.zip');
  rmSync(abs(zipPath), { force: true });
  // -X: bỏ extra attributes (zip tất định hơn)  -q: im lặng
  execFileSync('zip', ['-r', '-X', '-q', zipPath, MANIFEST, 'extension', 'scripts'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const size = statSync(abs(zipPath)).size;
  return { zipPath, size };
}

/* ------------------------------ CRX3 ------------------------------ */

const varint = (n) => {
  const out = [];
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return Buffer.from(out);
};
const pbBytes = (field, buf) => Buffer.concat([varint((field << 3) | 2), varint(buf.length), buf]);

/**
 * CRX3 = "Cr24" | u32 3 | u32 header_len | header | zip
 * header  = CrxFileHeader { sha256_with_rsa: AsymmetricKeyProof{public_key, signature},
 *                           signed_header_data: SignedData{crx_id} }
 * Chữ ký = RSA-SHA256( "CRX3 SignedData\0" | u32 len(SignedData) | SignedData | zip )
 */
function buildCrx(zipPath, keyPem) {
  const zipBuf = readFileSync(zipPath);
  const key = createPrivateKey(keyPem);
  const pubDer = createPublicKey(key).export({ type: 'spki', format: 'der' });
  const crxId = createHash('sha256').update(pubDer).digest().subarray(0, 16);

  const signedData = pbBytes(1, crxId);
  const ctx = Buffer.from('CRX3 SignedData\u0000', 'binary');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(signedData.length, 0);
  const signature = cryptoSign('sha256', Buffer.concat([ctx, lenBuf, signedData, zipBuf]), key);

  const proof = Buffer.concat([pbBytes(1, pubDer), pbBytes(2, signature)]);
  const header = Buffer.concat([pbBytes(10000, signedData), pbBytes(2, proof)]);

  const head = Buffer.alloc(12);
  head.write('Cr24', 0, 'binary');
  head.writeUInt32LE(3, 4);
  head.writeUInt32LE(header.length, 8);

  return { crx: Buffer.concat([head, header, zipBuf]), crxId: crxId.toString('hex') };
}

function findKey() {
  for (const c of KEY_CANDIDATES) {
    const p = path.isAbsolute(c) ? c : abs(c);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Cảnh báo khi .crx đang phát hành chứa userscript khác bản hiện tại. */
function checkCrxFreshness() {
  if (!existsSync(abs(CRX_OUT))) return;
  const current = createHash('sha256').update(readFileSync(abs(USERSCRIPT))).digest('hex');
  for (const entry of [USERSCRIPT, 'pancake-send-lite.user.js']) {
    // unzip trả exit code 1 khi chỉ có CẢNH BÁO (crx có vài trăm byte header thừa),
    // nên đọc stdout thay vì tin vào exit code.
    const r = spawnSync('unzip', ['-p', CRX_OUT, entry], { cwd: ROOT, encoding: 'buffer' });
    const buf = r.stdout || Buffer.alloc(0);
    if (!buf.length) continue; // entry không có → thử tên khác
    const inside = createHash('sha256').update(buf).digest('hex');
    if (inside !== current) {
      warnings.push(
        `${CRX_OUT} chứa bản userscript CŨ (khác ${USERSCRIPT}). ` +
        'Chrome đang cài từ .crx sẽ vẫn chạy code cũ → chạy "node tools/build.mjs --crx" với khoá ký.',
      );
    }
    return;
  }
  warnings.push(`${CRX_OUT}: không đọc được userscript bên trong để so sánh.`);
}

/* ------------------------------ MAIN ------------------------------ */

function main() {
  const ver = loadVersion();
  console.log(`BOTFAKE · ${ver.base} (build ${ver.build})`);

  // 1) đồng bộ version
  syncManifest(ver);
  syncUserscript(ver);
  syncUpdateXml(ver);
  syncPackageJson(ver);

  if (fixes.length) {
    console.log(CHECK
      ? `✗ Lệch version ở: ${[...new Set(fixes)].join(', ')}  → chạy "node tools/build.mjs" để đồng bộ.`
      : `↻ Đã đồng bộ version: ${[...new Set(fixes)].join(', ')}`);
  }

  // 2) kiểm tra
  validateManifest(ver);
  validateUserscript(ver);
  validateUpdateXml(ver);
  checkCrxFreshness();

  for (const n of notes) console.log(`· ${n}`);
  for (const w of warnings) console.log(`! ${w}`);
  for (const p of problems) console.log(`✗ ${p}`);

  if (problems.length) {
    console.log(`\n✗ ${problems.length} lỗi cấu trúc — dừng.`);
    process.exit(1);
  }

  if (CHECK) {
    if (fixes.length) process.exit(1);
    console.log('✓ --check: manifest, userscript, update.xml đồng bộ & hợp lệ.');
    return;
  }

  // 3) đóng gói
  const { zipPath, size } = zipFiles();
  console.log(`✓ ${rel(zipPath)} (${(size / 1024).toFixed(0)} KB)`);

  const keyPath = findKey();
  if (WANT_CRX || keyPath) {
    if (!keyPath) {
      console.log('! Không thấy khoá ký (installer/extension-signing-key.pem hoặc env CRX_SIGNING_KEY).');
      console.log('  Bỏ qua .crx — chỉ có zip. Bản .crx cũ vẫn đang được phát hành.');
    } else {
      const { crx, crxId } = buildCrx(zipPath, readFileSync(keyPath, 'utf8'));
      writeFileSync(abs(CRX_OUT), crx);
      console.log(`✓ ${CRX_OUT} (${(crx.length / 1024).toFixed(0)} KB · crx_id ${crxId})`);
      console.log('  → commit botfake.crx + update.xml rồi push để GitHub Pages phát hành bản mới.');
    }
  } else {
    console.log('· Không có khoá ký → chỉ đóng gói zip (thêm --crx sau khi đặt khoá để xuất .crx).');
  }

  console.log('\n✓ Build xong.');
}

main();
