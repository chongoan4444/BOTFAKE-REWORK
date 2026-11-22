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
 *
 * [v1.93.18] ĐÃ GỠ ĐƯỜNG PHÁT HÀNH .crx (người dùng chốt: "kệ cái file crx, xoá luôn đi").
 *   Lý do: `update.xml` khai version MỚI nhưng `botfake.crx` bên trong là code 1.91.43 ⇒
 *   máy nào cài qua `update_url` sẽ chạy code cũ mà TƯỞNG là bản mới (bẫy im lặng).
 *   Nay phát hành bằng "Load unpacked" từ release/botfake-ext/ hoặc file .user.js.
 *
 * Cách dùng:
 *   node tools/build.mjs --check   # chỉ kiểm tra, KHÔNG ghi gì (dùng cho CI/pre-commit)
 *   node tools/build.mjs           # đồng bộ version + kiểm tra + đóng gói dist/*.zip
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, cpSync, readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = new Set(process.argv.slice(2));
const CHECK = ARGS.has('--check');

const MANIFEST = 'manifest.json';
const USERSCRIPT = 'scripts/pancake-send-lite.user.js';
const DIST = 'dist';
// Folder TIỆN ÍCH HOÀN CHỈNH, tự chứa — commit lên GitHub để tải/“Load unpacked” một phát.
// (manifest.json ở gốc repo không dùng trực tiếp được vì cạnh nó còn HAR/HTML tham chiếu.)
const RELEASE_DIR = 'release/botfake-ext';
// Tiện ích BẢN ỔN ĐỊNH: folder riêng, manifest riêng, chỉ nạp pancake-send-stable.user.js.
// Chrome coi là tiện ích khác hẳn bản gốc ⇒ cài/gỡ bản này không ảnh hưởng bản kia.
const STABLE_SCRIPT = 'scripts/pancake-send-stable.user.js';
const STABLE_RELEASE_DIR = 'release/botfake-ext-stable';

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
  /* [v1.93.18] ĐÃ BỎ `update_url`: nó trỏ Chrome tới `update.xml` → `botfake.crx`, cả hai
   * nay đã xoá. Giữ lại là để Chrome đi tìm một file không tồn tại và bỏ qua mọi bản mới
   * cài tay. Cài bằng "Load unpacked" từ release/botfake-ext/ thì không cần update_url. */
  if (m.update_url) { delete m.update_url; changed = true; }
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

/* ------------------------------ RELEASE FOLDER ------------------------------ */

/** Các file phải có trong folder phát hành (đường dẫn tương đối từ gốc repo). */
function releaseFileList() {
  const out = [MANIFEST];
  const walk = (dir) => {
    for (const name of readdirSync(abs(dir), { withFileTypes: true })) {
      const rel = `${dir}/${name.name}`;
      if (name.isDirectory()) walk(rel);
      else out.push(rel);
    }
  };
  walk('extension');
  walk('scripts');
  return out.sort();
}

const sha = (p) => createHash('sha256').update(readFileSync(abs(p))).digest('hex');

/** So folder phát hành đã commit với nguồn hiện tại. */
function checkReleaseFolder() {
  const files = releaseFileList();
  if (!existsSync(abs(RELEASE_DIR))) {
    warnings.push(`Chưa có ${RELEASE_DIR}/ — chạy "npm run build" để sinh folder tiện ích hoàn chỉnh.`);
    return;
  }
  let stale = 0;
  for (const f of files) {
    const dest = `${RELEASE_DIR}/${f}`;
    if (!existsSync(abs(dest)) || sha(dest) !== sha(f)) stale++;
  }
  const extra = [];
  const walk = (dir) => {
    for (const e of readdirSync(abs(dir), { withFileTypes: true })) {
      if (e.name === 'README-LOAD-UNPACKED.txt') continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (!files.includes(rel.slice(RELEASE_DIR.length + 1))) extra.push(rel);
    }
  };
  walk(RELEASE_DIR);
  if (stale) warnings.push(`${RELEASE_DIR}/ lệch ${stale} file so với nguồn — chạy "npm run build" để cập nhật (GitHub sẽ phát hành bản cũ).`);
  if (extra.length) warnings.push(`${RELEASE_DIR}/ có ${extra.length} file thừa: ${extra.slice(0, 3).join(', ')}`);
}

function syncReleaseFolder() {
  const files = releaseFileList();
  rmSync(abs(RELEASE_DIR), { recursive: true, force: true });
  for (const f of files) {
    const dest = path.join(RELEASE_DIR, f);
    mkdirSync(path.dirname(abs(dest)), { recursive: true });
    cpSync(abs(f), abs(dest));
  }
  writeFileSync(abs(`${RELEASE_DIR}/README-LOAD-UNPACKED.txt`), [
    'BOTFAKE LITE — folder tiện ích hoàn chỉnh (tự chứa)',
    '',
    'Cài đặt:',
    '  1. Tải cả folder này về máy (giữ nguyên cấu trúc bên trong).',
    '  2. chrome://extensions → bật "Developer mode".',
    '  3. "Load unpacked" → chọn ĐÚNG folder chứa manifest.json này.',
    '',
    'Bên trong:',
    '  manifest.json   khai báo MV3',
    '  extension/      service worker, content script, popup, icon',
    '  scripts/        pancake-send-lite.user.js (toàn bộ logic gửi trong tab Pancake)',
    '',
    'Lưu ý: đây là bản sinh tự động từ mã nguồn ở gốc repo — không sửa trực tiếp',
    'trong folder này. Sửa ở nguồn rồi chạy: npm run build',
    '',
  ].join('\n'));
  return files.length + 1;
}

/* ------------------- BẢN ỔN ĐỊNH: TIỆN ÍCH CHẠY ĐỘC LẬP ------------------- */

/** Manifest của tiện ích ổn định: lấy manifest.json rồi đổi phần nhận diện + script được nạp. */
function stableManifest(ver) {
  /* [v1.93.19] GIỐNG BẢN GỐC TỪNG TRƯỜNG, trừ 3 thứ BẮT BUỘC phải khác để Chrome chấp nhận
   * và để hai folder không giẫm nhau:
   *   ① `js` đường dẫn → trỏ `-stable.user.js` (bắt buộc, nếu không sẽ nạp nhầm bản gốc)
   *   ② `key` — bỏ (bản này không ký .crx; xem §3 docs/CAI-DAT.md)
   *   ③ `update_url` — bản gốc không còn trường này nữa nên cũng không xuất hiện; giữ dòng
   *      xoá để nếu sau này ai thêm lại thì bản ổn định không tự cập nhật nhầm kênh.
   * ĐÃ BỎ: đổi `name`/`description` — người dùng chốt bản ổn định phải GIỐNG bản gốc cả trên
   * giao diện (tên tiện ích hiện trong chrome://extensions). */
  const m = JSON.parse(read(MANIFEST));
  m.version = ver.base;
  delete m.update_url;
  delete m.key;
  for (const cs of m.content_scripts || []) {
    cs.js = cs.js.map((f) => (f === USERSCRIPT ? STABLE_SCRIPT : f));
  }
  return m;
}

/**
 * Toàn bộ nội dung folder phát hành bản ổn định: Map<'đường/dẫn', Buffer>.
 * Chỉ chứa script ổn định — KHÔNG kèm bản gốc, để hai tiện ích không dính nhau.
 */
function stableFolderFiles(ver) {
  const out = new Map();
  out.set('manifest.json', Buffer.from(JSON.stringify(stableManifest(ver), null, 2) + '\n'));
  const walk = (dir) => {
    for (const e of readdirSync(abs(dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else out.set(p, readFileSync(abs(p)));
    }
  };
  walk('extension');
  /* ═══ [v1.93.19] TIỆN ÍCH BẢN ỔN ĐỊNH = TIỆN ÍCH BẢN GỐC, CHỈ ĐỔI SCRIPT ═══
   * Người dùng chốt: "bản stable giống bản gốc về mọi thứ kể cả trên giao diện".
   * Trước đây khối này đổi 3 thứ trong extension:
   *   ✗ kênh `__botfake` → `__botfakeS` (bridge.js)   ⇒ lệch hành vi, giao diện
   *   ✗ id overlay `botfake-ext-overlay` → `…-stable` ⇒ hai thanh tiến độ khác nhau
   *   ✗ `__BOTFAKE_OVERLAY__` → `…_STABLE__`          ⇒ lớp phủ khác nhau
   * Nay BỎ HẾT: chỉ thay đúng đường dẫn script trong popup (bắt buộc — popup phải tiêm
   * đúng file). Cơ chế chống 2 bản cùng gửi KHÔNG nằm ở extension mà ở userscript:
   * `botfakeClaimSlot()` + `data-botfake-active` — bản nào nạp trước chiếm chỗ, bản sau tự
   * tắt. Cơ chế này có sẵn trong bản gốc nên không cần kênh riêng. */
  out.set('extension/popup.js', Buffer.from(
    read('extension/popup.js').split(USERSCRIPT).join(STABLE_SCRIPT),
  ));
  out.set(STABLE_SCRIPT, readFileSync(abs(STABLE_SCRIPT)));
  return out;
}

function syncStableRelease(ver) {
  const want = stableFolderFiles(ver);
  rmSync(abs(STABLE_RELEASE_DIR), { recursive: true, force: true });
  for (const [p, buf] of want) {
    const dest = `${STABLE_RELEASE_DIR}/${p}`;
    mkdirSync(path.dirname(abs(dest)), { recursive: true });
    writeFileSync(abs(dest), buf);
  }
  /* [v1.93.19] README phải nói ĐÚNG sự thật mới: bản ổn định chỉ khác bản gốc ở phần LOG.
   * Bản trước còn ghi "tên riêng BOTFAKE STABLE" và "công tắc TAB mặc định TẮT" — cả hai
   * đã bỏ, để nguyên là tài liệu nói dối người dùng. */
  writeFileSync(abs(`${STABLE_RELEASE_DIR}/README-LOAD-UNPACKED.txt`), [
    'BOTFAKE — bản ổn định (tiện ích hoàn chỉnh)',
    '',
    'Cài đặt:',
    '  1. Tải cả folder này về máy (giữ nguyên cấu trúc bên trong).',
    '  2. chrome://extensions → bật "Developer mode".',
    '  3. "Load unpacked" → chọn ĐÚNG folder chứa manifest.json này.',
    '',
    'Bên trong:',
    '  manifest.json   khai báo MV3 (giống hệt bản gốc, chỉ khác đường dẫn script)',
    '  extension/      service worker, content script, popup, icon',
    `  scripts/        ${STABLE_SCRIPT.split('/').pop()} (toàn bộ logic gửi)`,
    '',
    'KHÁC BẢN GỐC DUY NHẤT Ở PHẦN LOG:',
    '  · cuối lượt chỉ in 1 dòng: ✅ n/tổng (%) · ❌ · ⚠ · ⏱ · tin/giây',
    '  · không in các dòng chẩn đoán dài (WAVE/SOCKET/API/globalId/CHẠY NỀN)',
    '  · không in dòng tiến trình 🟢 giữa lượt (bảng TỔNG HỢP vẫn cập nhật)',
    'Cơ chế gửi, làn, ngưỡng, giao diện panel, công tắc phím TAB: GIỐNG HỆT bản gốc.',
    '',
    'Lưu ý: folder này sinh tự động từ mã nguồn ở gốc repo — không sửa trực tiếp.',
    'Sửa ở nguồn rồi chạy: npm run build',
    '',
  ].join('\n'));
  return want.size + 1;
}

function checkStableRelease(ver) {
  if (!existsSync(abs(STABLE_SCRIPT))) {
    notes.push(`Chưa có ${STABLE_SCRIPT} — bỏ qua tiện ích bản ổn định.`);
    return;
  }
  const want = stableFolderFiles(ver);
  // tự kiểm: manifest chỉ được trỏ tới file có trong folder, và KHÔNG được kèm bản gốc
  const mf = JSON.parse(want.get('manifest.json').toString());
  for (const cs of mf.content_scripts || []) {
    for (const f of cs.js || []) {
      if (!want.has(f)) problems.push(`${STABLE_RELEASE_DIR}: manifest trỏ tới ${f} nhưng folder không có.`);
    }
  }
  if (want.has(USERSCRIPT)) problems.push(`${STABLE_RELEASE_DIR}: không được chứa bản gốc ${USERSCRIPT}.`);
  if (!existsSync(abs(STABLE_RELEASE_DIR))) {
    warnings.push(`Chưa có ${STABLE_RELEASE_DIR}/ — chạy "npm run build" để sinh tiện ích bản ổn định.`);
    return;
  }
  let stale = 0;
  for (const [p, buf] of want) {
    const dest = `${STABLE_RELEASE_DIR}/${p}`;
    if (!existsSync(abs(dest)) || !readFileSync(abs(dest)).equals(buf)) stale++;
  }
  const extra = [];
  const walkD = (dir) => {
    for (const e of readdirSync(abs(dir), { withFileTypes: true })) {
      if (e.name === 'README-LOAD-UNPACKED.txt') continue;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walkD(p);
      else if (!want.has(p.slice(STABLE_RELEASE_DIR.length + 1))) extra.push(p);
    }
  };
  walkD(STABLE_RELEASE_DIR);
  if (stale) warnings.push(`${STABLE_RELEASE_DIR}/ lệch ${stale} file so với nguồn — chạy "npm run build".`);
  if (extra.length) warnings.push(`${STABLE_RELEASE_DIR}/ có ${extra.length} file thừa: ${extra.slice(0, 3).join(', ')}`);
}

function zipStable() {
  mkdirSync(abs(DIST), { recursive: true });
  const zipPath = path.join(DIST, 'botfake-stable.zip');
  rmSync(abs(zipPath), { force: true });
  // zipPath phải là đường dẫn TUYỆT ĐỐI: cwd là folder phát hành, đường dẫn tương đối sẽ trỏ sai chỗ.
  execFileSync('zip', ['-r', '-X', '-q', abs(zipPath), '.', '-x', 'README-LOAD-UNPACKED.txt'], {
    cwd: abs(STABLE_RELEASE_DIR),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return { zipPath, size: statSync(abs(zipPath)).size };
}

/* ------------------------------ MAIN ------------------------------ */

function main() {
  const ver = loadVersion();
  console.log(`BOTFAKE · ${ver.base} (build ${ver.build})`);

  // 1) đồng bộ version
  syncManifest(ver);
  syncUserscript(ver);
  syncPackageJson(ver);

  if (fixes.length) {
    console.log(CHECK
      ? `✗ Lệch version ở: ${[...new Set(fixes)].join(', ')}  → chạy "node tools/build.mjs" để đồng bộ.`
      : `↻ Đã đồng bộ version: ${[...new Set(fixes)].join(', ')}`);
  }

  // 2) kiểm tra
  validateManifest(ver);
  if (CHECK) { checkReleaseFolder(); checkStableRelease(ver); }
  validateUserscript(ver);

  for (const n of notes) console.log(`· ${n}`);
  for (const w of warnings) console.log(`! ${w}`);
  for (const p of problems) console.log(`✗ ${p}`);

  if (problems.length) {
    console.log(`\n✗ ${problems.length} lỗi cấu trúc — dừng.`);
    process.exit(1);
  }

  if (CHECK) {
    if (fixes.length) process.exit(1);
    console.log('✓ --check: manifest, userscript, release/ đồng bộ & hợp lệ.');
    return;
  }

  // 3) đóng gói
  const nRelease = syncReleaseFolder();
  console.log(`✓ ${RELEASE_DIR}/ (${nRelease} file — folder tiện ích hoàn chỉnh để load unpacked)`);

  const { zipPath, size } = zipFiles();
  console.log(`✓ ${rel(zipPath)} (${(size / 1024).toFixed(0)} KB)`);

  if (existsSync(abs(STABLE_SCRIPT))) {
    const nStable = syncStableRelease(ver);
    console.log(`✓ ${STABLE_RELEASE_DIR}/ (${nStable} file — tiện ích bản ổn định, chạy độc lập)`);
    const zs = zipStable();
    console.log(`✓ ${rel(zs.zipPath)} (${(zs.size / 1024).toFixed(0)} KB)`);
  } else {
    notes.push('Không có bản ổn định — bỏ qua tiện ích thứ hai.');
  }

  /* [v1.93.18] KHÔNG còn bước ký .crx — xem ghi chú đầu file. Phát hành bằng:
   *   • Load unpacked từ release/botfake-ext/ (bản gốc) hoặc release/botfake-ext-stable/
   *   • hoặc cài userscript scripts/*.user.js
   * `npm run build:crx` đã bị bỏ khỏi package.json. */

  console.log('\n✓ Build xong.');
}

main();
