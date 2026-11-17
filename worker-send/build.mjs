/**
 * BUILD worker-send → MỘT file dán được (`dist/worker-send.install.js`).
 *
 * Mục đích: người dùng không phải mở 3 file, không phải copy từng đoạn.
 * Dán 1 lần vào console (hoặc tạo Userscript) là chạy.
 *
 * KHÔNG đụng `tools/build.mjs`, KHÔNG đụng `release/`. Thư mục này tự chứa.
 *
 *   node worker-send/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT = path.join(OUT_DIR, 'worker-send.install.js');

const rd = (f) => readFileSync(path.join(HERE, f), 'utf8');

/** Bọc 1 file thành chuỗi JS an toàn: dùng template literal nhưng escape `${` và `\`. */
function asStringLiteral(src) {
  return '`' + src.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
}

const engine = rd('engine.mjs');
const worker = rd('worker.js');
const bridge = rd('bridge.js');
const loadlist = rd('loadlist.js');

/* Kiểm NGAY trong build: bundle worker phải parse được, nếu không thì bản cài là
 * một file chết câm. Đây đúng lỗi tôi từng mắc (xem §91.8). */
const workerBody = worker.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/engine\.mjs['"]\s*;?/m, '');
const joined = (engine + '\n' + workerBody)
  .replace(/^export\s+default\s+/gm, 'var __default__ = ')
  .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/^export\s+/gm, '');
const bundle = '(async function () {\n"use strict";\n' + joined + '\n})();';
if (/^\s*(export|import)\s/m.test(bundle)) {
  console.error('✗ bundle còn export/import — DỪNG BUILD');
  process.exit(1);
}
try { new vm.Script(bundle, { filename: 'bundle.js' }); }
catch (e) {
  console.error('✗ bundle KHÔNG parse được: ' + e.message + ' — DỪNG BUILD');
  process.exit(1);
}

const VERSION = (() => {
  try { return JSON.parse(readFileSync(path.join(ROOT, 'version.json'), 'utf8')); }
  catch (e) { return { base: '?', build: '?' }; }
})();

const out = `/* ============================================================================
 * BOTFAKE · WORKER-SEND — BẢN CÀI MỘT FILE
 * Sinh tự động bởi worker-send/build.mjs — ĐỪNG SỬA TAY.
 * Nguồn: worker-send/{engine.mjs,worker.js,bridge.js,loadlist.js}
 * Gốc: ${VERSION.base}-${VERSION.build}
 * ============================================================================
 *
 * CÁCH DÙNG (2 bước):
 *   1. Mở trang Pancake (pages.fm hoặc pancake.vn), để trang tải xong danh sách chat.
 *   2. F12 → Console → dán TOÀN BỘ file này → Enter.
 *
 *   Sau khi dán, dùng:
 *     BOTFAKE_WS.help()                                  // xem hướng dẫn
 *     BOTFAKE_WS.run({ text: 'Xin chào', dryRun: true }) // CHẠY THỬ, không gửi
 *     BOTFAKE_WS.run({ text: 'Xin chào' })               // GỬI THẬT
 * ============================================================================ */
(function botfakeWorkerSendInstall() {
  'use strict';
  if (window.__BOTFAKE_WS_INSTALLED__) {
    console.warn('[BOTFAKE-WS] đã nạp rồi — dùng BOTFAKE_WS.help()');
    return;
  }
  window.__BOTFAKE_WS_INSTALLED__ = true;

  var ENGINE_SRC = ${asStringLiteral(engine)};
  var WORKER_SRC = ${asStringLiteral(worker)};

  /* Nạp cầu nối + bộ tải danh sách (2 IIFE, gắn vào window). */
  ${bridge}

  ${loadlist}

  var B = window.__BOTFAKE_WORKER_SEND__;
  if (!B) { console.error('[BOTFAKE-WS] nạp bridge.js thất bại'); return; }
  B.setSources(ENGINE_SRC, WORKER_SRC);
  B.setConfig({ mainCap: 96 });

  B.on('log', function (r) {
    if (!r) return;
    if (r.kind === 'ok' || r.kind === 'info') console.log('%c[WS]', 'color:#3a3', r.msg || r);
    else if (r.kind === 'rejected') console.warn('%c[WS từ chối]', 'color:#e80', r.msg || r);
    else console.warn('%c[WS CHƯA RÕ]', 'color:#c00', r.msg || r);
  });
  B.on('done', function (m) {
    B.terminate();
    var s = (m && m.stats) || {};
    console.log('%c[BOTFAKE-WS] XONG', 'font-weight:bold;color:#06c',
      '\\n  bắn: ' + (s.n || 0) + ' · ok: ' + (s.ok || 0) + ' · từ chối: ' + (s.fail || 0)
      + ' · CHƯA RÕ: ' + (s.uncertain || 0) + ' · chặn trùng: ' + (s.dupBlocked || 0));
    if (s.uncertain) {
      console.warn('[BOTFAKE-WS] ' + s.uncertain + ' chat CHƯA RÕ (server không trả lời).'
        + ' TUYỆT ĐỐI không bấm chạy lại toàn bộ — sẽ gửi trùng. Kiểm tay các chat đó.');
    }
  });
  B.on('error', function (e) { console.error('[BOTFAKE-WS] lỗi', e); });

  window.BOTFAKE_WS = {
    help: function () {
      console.log([
        'BOTFAKE WORKER-SEND — đường gửi chạy trong Web Worker (CPU tab ~0)',
        '',
        '  BOTFAKE_WS.run({ text: "…", dryRun: true })   xem danh sách, KHÔNG gửi',
        '  BOTFAKE_WS.run({ text: "…" })                 gửi thật',
        '  BOTFAKE_WS.run({ text: "…", limit: 8 })       giới hạn 8 luồng song song',
        '  BOTFAKE_WS.run({ text: "…", maxPages: 5 })    chỉ tải 5 trang danh sách',
        '  BOTFAKE_WS.stats()                            số đo hiện tại',
        '  BOTFAKE_WS.results()                          chat nào OK / chat nào CHƯA RÕ',
        '  BOTFAKE_WS.stop()                             dừng',
        '',
        'LƯU Ý: đường này dùng API (không phải Socket) — chậm hơn bản cũ.',
        '      Nó KHÔNG thay thế bản 1.92.55; dùng để đo CPU/ACK trong lúc bản cũ chạy.',
      ].join('\\n'));
    },
    run: function (opts) { return B.run(opts); },
    stats: function () { return B.stats(); },
    results: function () { return B.results(); },
    stop: function () { return B.stop(); },
    bridge: B,
  };

  console.log('%c[BOTFAKE-WS] đã nạp ✓', 'color:#06c;font-weight:bold',
    '— gõ BOTFAKE_WS.help() để xem cách dùng. Chạy thử trước: ...run({text:"…", dryRun:true})');
})();
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, out, 'utf8');

/* Kiểm lần cuối: file sinh ra phải parse được ở cấp cao nhất. */
try { new vm.Script(out, { filename: 'install.js' }); }
catch (e) {
  console.error('✗ file cài KHÔNG parse được: ' + e.message);
  process.exit(1);
}

const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
console.log('✓ worker-send/build → dist/worker-send.install.js (' + kb + ' KB)');
console.log('  · bundle worker đã kiểm parse');
console.log('  · file cài đã kiểm parse');
