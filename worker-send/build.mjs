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
const OUT_DIR = HERE;              // đặt NGAY CẠNH build.mjs — không đụng dist/ (bị gitignore)
const OUT = path.join(OUT_DIR, 'cai-dat.js');

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

const out = `// ==UserScript==
// @name         BOTFAKE — Gửi bằng Worker
// @namespace    botfake-worker-send
// @version      ${VERSION.base}-${VERSION.build}
// @description  Gửi hàng loạt Pancake, phần điều phối chạy trong Web Worker
// @match        https://pancake.vn/*
// @match        https://*.pancake.vn/*
// @match        https://pages.fm/*
// @match        https://*.pages.fm/*
// @match        https://pancake.ph/*
// @match        https://pancake.id/*
// @match        https://pancake.in/*
// @match        https://pancake.biz/*
// @match        https://socialos.vip/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

/* ============================================================================
 * BOTFAKE · GỬI BẰNG WORKER — bản cài 1 file
 * Sinh tự động bởi worker-send/build.mjs — ĐỪNG SỬA TAY.
 * Gốc: ${VERSION.base}-${VERSION.build}
 * ============================================================================
 *
 * DÙNG:
 *   1. Mở trang Pancake (pages.fm hoặc pancake.vn), đợi danh sách chat hiện ra.
 *   2. F12 → Console → dán toàn bộ file này → Enter.
 *   3. Nút "⚡ GỬI BẰNG WORKER" hiện ở góc dưới phải. Bấm vào.
 * ============================================================================ */
(function botfakeWorkerSendInstall() {
  'use strict';
  if (window.__BOTFAKE_WS_INSTALLED__) {
    var old = document.getElementById('bws-root');
    if (old) { old.style.display = 'block'; }
    console.warn('[BOTFAKE-WS] đã nạp rồi — nút đang ở góc dưới phải');
    return;
  }
  window.__BOTFAKE_WS_INSTALLED__ = true;

  var ENGINE_SRC = ${asStringLiteral(engine)};
  var WORKER_SRC = ${asStringLiteral(worker)};

  ${bridge}

  ${loadlist}

  var B = window.__BOTFAKE_WORKER_SEND__;
  if (!B) { console.error('[BOTFAKE-WS] nạp bridge.js thất bại'); return; }
  B.setSources(ENGINE_SRC, WORKER_SRC);
  B.setConfig({ mainCap: 96 });

  /* ============================ GIAO DIỆN ============================
   * Chỉ 1 khung nhỏ, 3 dòng, 2 nút. Không có bảng chọn chat, không tag, không
   * lịch gửi — bản này chỉ để ĐO đường gửi mới, không phải bản thay thế. */
  var CSS = [
    '#bws-root{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:320px;',
    'font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;',
    'background:#fff;border:1px solid #d5d9e0;border-radius:10px;',
    'box-shadow:0 8px 28px rgba(0,0,0,.18);overflow:hidden}',
    '#bws-root *{box-sizing:border-box}',
    '#bws-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#0b63d6;color:#fff}',
    '#bws-head b{font-size:13px;flex:1}',
    '#bws-head button{background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:6px;',
    'padding:2px 8px;cursor:pointer;font-size:12px}',
    '#bws-body{padding:10px;display:flex;flex-direction:column;gap:8px}',
    '#bws-text{width:100%;min-height:64px;resize:vertical;padding:7px 8px;border:1px solid #cfd6e0;',
    'border-radius:7px;font:13px/1.4 inherit}',
    '#bws-info{font-size:12px;color:#556;min-height:16px}',
    '#bws-row{display:flex;gap:8px}',
    '#bws-row button{flex:1;padding:8px 10px;border:0;border-radius:7px;cursor:pointer;',
    'font-weight:600;font-size:13px}',
    '#bws-load{background:#e8eef8;color:#0b4ea2}',
    '#bws-send{background:#0b63d6;color:#fff}',
    '#bws-send:disabled,#bws-load:disabled{opacity:.45;cursor:default}',
    '#bws-stop{background:#f3e8e8;color:#a11}',
    '#bws-log{max-height:120px;overflow:auto;font:12px/1.4 ui-monospace,Menlo,monospace;',
    'background:#f6f8fb;border-radius:6px;padding:6px;color:#334}',
    '#bws-log div{padding:1px 0;word-break:break-word}',
    '#bws-log .ok{color:#137a2f}#bws-log .bad{color:#a11}#bws-log .warn{color:#9a6700}',
  ].join('');

  function el(tag, id, txt) {
    var e = document.createElement(tag);
    if (id) e.id = id;
    if (txt != null) e.textContent = txt;
    return e;
  }

  var root, taText, inf, logBox, btnLoad, btnSend, btnStop;

  function logLine(kind, txt) {
    if (!logBox) return;
    var d = el('div', null, txt);
    if (kind === 'ok') d.className = 'ok';
    else if (kind === 'rejected') d.className = 'bad';
    else if (kind === 'noack') d.className = 'warn';
    logBox.appendChild(d);
    while (logBox.childNodes.length > 200) logBox.removeChild(logBox.firstChild);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function setInfo(t) { if (inf) inf.textContent = t; }

  function buildUI() {
    var st = el('style'); st.textContent = CSS; document.head.appendChild(st);

    root = el('div', 'bws-root');
    var head = el('div', 'bws-head');
    head.appendChild(el('b', null, 'Gửi bằng Worker'));
    var min = el('button', null, '—');
    min.title = 'Thu nhỏ';
    var close = el('button', null, '✕');
    close.title = 'Ẩn (dán lại file để hiện)';
    head.appendChild(min); head.appendChild(close);
    root.appendChild(head);

    var body = el('div', 'bws-body');

    taText = el('textarea', 'bws-text');
    taText.placeholder = 'Nội dung sẽ gửi cho TẤT CẢ chat đã tải…';
    body.appendChild(taText);

    inf = el('div', 'bws-info', 'Bấm "Tải danh sách" để bắt đầu.');
    body.appendChild(inf);

    var row = el('div', 'bws-row');
    btnLoad = el('button', 'bws-load', '⟳ Tải danh sách');
    btnSend = el('button', 'bws-send', '⚡ Gửi');
    btnSend.disabled = true;
    row.appendChild(btnLoad); row.appendChild(btnSend);
    body.appendChild(row);

    var row2 = el('div', 'bws-row');
    btnStop = el('button', 'bws-stop', '⏹ Dừng');
    btnStop.disabled = true;
    row2.appendChild(btnStop);
    body.appendChild(row2);

    logBox = el('div', 'bws-log');
    body.appendChild(logBox);

    root.appendChild(body);
    document.body.appendChild(root);

    min.onclick = function () {
      body.style.display = body.style.display === 'none' ? 'flex' : 'none';
    };
    close.onclick = function () { root.style.display = 'none'; };
  }

  /* ------------------------------- HÀNH ĐỘNG ------------------------------- */

  var loaded = null;   // danh sách đã tải (có cờ ctx7)
  var busy = false;

  function setBusy(b) {
    busy = b;
    btnLoad.disabled = b;
    btnStop.disabled = !b;
    btnSend.disabled = b || !loaded || !loaded.length;
  }

  async function doLoad() {
    if (busy) return;
    setBusy(true);
    setInfo('Đang tải danh sách chat…');
    logBox.innerHTML = '';
    try {
      var LL = window.__BOTFAKE_WS_LOADLIST__;
      var token = LL.getToken();
      if (!token) throw new Error('Không tìm thấy access_token — tải lại trang Pancake rồi thử lại');
      B.setConfig({ apiBase: LL.apiBase(), accessToken: token });
      var got = await LL.load({
        maxPages: 200,
        onProgress: function (n) { setInfo('Đã tải ' + n + ' chat…'); },
      });
      if (!got.ok) throw new Error(got.error || 'tải thất bại');
      loaded = LL.decorate(got.items);
      var withCtx = loaded.filter(function (x) { return x.isRecordCtx7Days; }).length;
      setInfo(loaded.length + ' chat' + (got.incomplete ? ' (CHƯA HẾT — còn dữ liệu)' : '')
        + ' · bật cờ 7 ngày: ' + withCtx);
      btnSend.disabled = !loaded.length;
    } catch (e) {
      setInfo('LỖI: ' + (e && e.message || e));
      logLine('bad', String(e && e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function doSend() {
    if (busy || !loaded) return;
    var text = String(taText.value || '');
    if (!text.trim()) { setInfo('Chưa nhập nội dung'); taText.focus(); return; }
    var n = loaded.length;
    if (!window.confirm('Gửi tin này cho ' + n + ' chat?\\n\\n' + text.slice(0, 120))) return;

    setBusy(true);
    logBox.innerHTML = '';
    setInfo('Đang gửi ' + n + ' chat…');
    B.start();
    B.send(loaded.map(function (c) {
      return { id: c.id, pageId: c.pageId, name: c.name, text: text, isRecordCtx7Days: c.isRecordCtx7Days };
    }), 96);
  }

  B.on('done', function (m) {
    var s = (m && m.stats) || {};
    setInfo('XONG — bắn ' + (s.n || 0) + ' · ok ' + (s.ok || 0) + ' · từ chối ' + (s.fail || 0)
      + ' · CHƯA RÕ ' + (s.uncertain || 0));
    logLine('ok', 'XONG: ok ' + (s.ok || 0) + '/' + (s.n || 0)
      + (s.uncertain ? ' · ' + s.uncertain + ' CHƯA RÕ (đừng chạy lại toàn bộ!)' : ''));
    if (s.uncertain) logLine('noack', 'CẢNH BÁO: ' + s.uncertain + ' chat chưa rõ đã gửi hay chưa. Kiểm tay.');
    setBusy(false);
    B.terminate();
  });
  B.on('error', function (e) { logLine('bad', 'lỗi: ' + (e && e.message || e)); setBusy(false); });

  /* THỨ TỰ QUAN TRỌNG: phải VẼ GIAO DIỆN trước, rồi mới gán sự kiện — vì nút chỉ
   * tồn tại sau buildUI(). Bản trước gán trước khi vẽ ⇒ btnLoad là undefined ⇒
   * TypeError ngay khi dán file, và biểu hiện ra ngoài chỉ là "không thấy nút nào".
   * Test [I5]–[I9] bắt đúng lỗi này. */
  function wire() {
    buildUI();
    btnLoad.onclick = doLoad;
    btnSend.onclick = doSend;
    btnStop.onclick = function () { B.stop(); logLine('warn', 'đã bấm dừng'); setBusy(false); };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  window.BOTFAKE_WS = { bridge: B, load: function () { return doLoad(); } };
  console.log('%c[BOTFAKE-WS] đã nạp ✓', 'color:#0b63d6;font-weight:bold',
    '— nút "Gửi bằng Worker" ở góc dưới phải màn hình');
})();
`;

writeFileSync(OUT, out, 'utf8');

/* Kiểm lần cuối: file sinh ra phải parse được ở cấp cao nhất. */
try { new vm.Script(out, { filename: 'install.js' }); }
catch (e) {
  console.error('✗ file cài KHÔNG parse được: ' + e.message);
  process.exit(1);
}

const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
console.log('✓ worker-send/build → worker-send/cai-dat.js (' + kb + ' KB)');
console.log('  · bundle worker đã kiểm parse');
console.log('  · file cài đã kiểm parse');
