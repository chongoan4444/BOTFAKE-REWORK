/**
 * TEST BẢN CÀI (worker-send/cai-dat.js) — chạy END-TO-END, BẤM NÚT THẬT.
 *
 * Người dùng làm đúng 2 việc: dán file, rồi BẤM NÚT. Test này làm y hệt:
 *   nạp file cài vào một trang giả lập (DOM giả + Redux + Worker thật)
 *   → bấm "⟳ Tải danh sách"
 *   → nhập nội dung, bấm "⚡ Gửi"
 *   → kiểm HTTP server THẬT nhận đúng request.
 *
 * DOM giả ở đây không phải đồ chơi: nó có createElement/appendChild/textContent/
 * className/onclick và tự gọi onclick khi .click() — đủ để phát hiện lỗi kiểu
 * "nút không nối sự kiện", "không tìm thấy #id", "gán nhầm element".
 */
import http from 'node:http';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL = path.join(HERE, 'cai-dat.js');

let pass = 0; let fail = 0;
function check(name, got, want) {
  const a = JSON.stringify(got); const b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      nhận: ' + a + '\n      mong: ' + b); }
}

if (!existsSync(INSTALL)) {
  console.error('✗ chưa có worker-send/cai-dat.js — chạy: node worker-send/build.mjs');
  process.exit(1);
}
const INSTALL_SRC = readFileSync(INSTALL, 'utf8');

/* ------------------------------------------------------ DOM giả (tối thiểu) */
function makeDom() {
  let idSeq = 0;
  function mkNode(tag) {
    const n = {
      tagName: String(tag).toUpperCase(),
      _id: '',
      className: '',
      textContent: '',
      value: '',
      placeholder: '',
      title: '',
      disabled: false,
      style: {},
      onclick: null,
      children: [],
      parent: null,
      _attrs: {},
      get id() { return this._id; },
      set id(v) { this._id = String(v); if (v) DOC.byId[this._id] = this; },
      get childNodes() { return this.children; },
      get firstChild() { return this.children[0]; },
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); return c; },
      setAttribute(k, v) { this._attrs[k] = String(v); },
      getAttribute(k) { return this._attrs[k] == null ? null : this._attrs[k]; },
      addEventListener() {},
      focus() {},
      click() { if (typeof this.onclick === 'function') return this.onclick(); return undefined; },
      get scrollHeight() { return 0; },
      set scrollTop(v) { this._st = v; },
      get scrollTop() { return this._st || 0; },
      _uid: ++idSeq,
    };
    return n;
  }
  const DOC = {
    byId: Object.create(null),
    readyState: 'complete',
    head: mkNode('head'),
    body: mkNode('body'),
    createElement: (t) => mkNode(t),
    getElementById(id) { return this.byId[id] || null; },
    querySelector() { return null; },
    addEventListener() {},
  };
  return { DOC, mkNode };
}

/* ------------------------------------------------------ Pancake giả */
function startPancake() {
  const st = { listCalls: 0, urls: [], sendCalls: 0, sends: [] };
  const conv = {
    id: '689375157595846_29617688761165549',
    type: 'INBOX', tags: [], seen: true,
    from: { id: '29617688761165549', name: 'Thao Quyên' },
    snippet: 'Em chào chị ạ !!!',
    updated_at: '2026-10-19T10:11:08.000000',
    page_id: '689375157595846',
    customers: [{ id: '6023b3fa', fb_id: '29617688761165549', name: 'Thao Quyên' }],
    last_customer_interactive_at: '2026-09-01T00:00:00.000000',
  };
  const srv = http.createServer((req, res) => {
    st.urls.push(req.url || '');
    if (req.method === 'GET') {
      st.listCalls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        conversations: [conv, Object.assign({}, conv, { id: '689375157595846_999', from: { name: 'Khách Hai' } })],
        next_cursor: null,
      }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      st.sendCalls++;
      const ctype = String(req.headers['content-type'] || '');
      let body = {};
      if (ctype.indexOf('application/json') > -1) { try { body = JSON.parse(raw); } catch (e) {} }
      else { const re = /name="([^"]+)"(?:\r\n\r\n)([\s\S]*?)\r\n--/g; let m; while ((m = re.exec(raw)) !== null) body[m[1]] = m[2]; }
      st.sends.push({ url: req.url, body, ctype });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, id: 'msg_' + st.sendCalls }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, st, port: srv.address().port })));
}

/* ------------------------------------ trang giả lập: DOM giả + Worker thật */
function makeBrowser(port, hostname) {
  const logs = [];
  const { DOC } = makeDom();
  const confirms = [];

  const ctx = {
    console: {
      log: (...a) => logs.push(['log', a]), warn: (...a) => logs.push(['warn', a]),
      error: (...a) => logs.push(['error', a]),
    },
    document: DOC,
    location: { hostname: hostname || 'pancake.vn', origin: 'http://127.0.0.1:' + port, pathname: '/pages/689375157595846/inbox', search: '' },
    localStorage: { length: 0, key() { return null; }, getItem() { return null; }, setItem() {} },
    performance: { getEntriesByType() { return []; } },
    confirm: (m) => { confirms.push(m); return true; },   // người dùng bấm OK
    alert() {},
    fetch, FormData, Blob, URLSearchParams, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Object, String, Array, Error, RegExp, Date, Math, Number, Map, Set,
    encodeURIComponent, decodeURIComponent, parseInt, isNaN,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.window.__pancakeReduxStore__ = {
    getState: () => ({
      pages: {
        multiplePageMode: false,
        currentPageId: '689375157595846',
        activatedMap: { 689375157595846: { id: '689375157595846', platform: 'facebook', platform_extra_info: { ctx_7_days_enabled: true } } },
        activated: [],
      },
      auth: {}, conversations: {},
    }),
  };

  let blobCode = null;
  ctx.Blob = class { constructor(parts) { this.code = parts.join(''); } };
  ctx.URL = { createObjectURL(b) { blobCode = b.code; return 'blob:ws'; }, revokeObjectURL() {} };

  ctx.Worker = class {
    constructor() {
      const selfCtx = {
        self: null, fetch, FormData, Blob, AbortController,
        setTimeout, clearTimeout, console: ctx.console,
        Promise, JSON, Object, String, Array, Error, RegExp, Date, Math, Number, Map, Set,
        encodeURIComponent, decodeURIComponent, parseInt, isNaN,
      };
      selfCtx.globalThis = selfCtx;
      selfCtx.self = {
        postMessage: (m) => setTimeout(() => { if (this.onmessage) this.onmessage({ data: m }); }, 0),
        addEventListener: (ev, fn) => { if (ev === 'message') this._fn = fn; },
      };
      vm.createContext(selfCtx);
      vm.runInContext(blobCode, selfCtx, { filename: 'worker-bundle.js' });
      this.onmessage = null;
      this.onerror = null;
    }
    postMessage(m) { setTimeout(() => { if (this._fn) this._fn({ data: m }); }, 0); }
    terminate() { this._fn = null; this.onmessage = null; }
  };

  vm.createContext(ctx);
  vm.runInContext(INSTALL_SRC, ctx, { filename: 'cai-dat.js' });
  return { ctx, logs, DOC, confirms };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) { if (fn()) return true; await wait(20); }
  return false;
}

/* ============================================================== */
console.log('\n[1] dán file → nút hiện ra');

const { srv, st, port } = await startPancake();
const { ctx, logs, DOC, confirms } = makeBrowser(port);

check('[I1] có window.BOTFAKE_WS', typeof ctx.window.BOTFAKE_WS, 'object');
check('[I2] cờ chống nạp 2 lần', ctx.window.__BOTFAKE_WS_INSTALLED__, true);

const root = DOC.getElementById('bws-root');
check('[I3] tự vẽ khung #bws-root vào trang', !!root, true);
check('[I4] khung nằm trong document.body', root && root.parent && root.parent.tagName, 'BODY');

const btnLoad = DOC.getElementById('bws-load');
const btnSend = DOC.getElementById('bws-send');
const btnStop = DOC.getElementById('bws-stop');
const taText = DOC.getElementById('bws-text');

check('[I5] có nút "Tải danh sách"', !!(btnLoad && /Tải danh sách/.test(btnLoad.textContent)), true);
check('[I6] có nút "Gửi"', !!(btnSend && /Gửi/.test(btnSend.textContent)), true);
check('[I7] nút Gửi BỊ KHOÁ khi chưa tải danh sách', btnSend && btnSend.disabled, true);
check('[I8] nút Dừng bị khoá khi chưa chạy', btnStop && btnStop.disabled, true);
check('[I9] có ô nhập nội dung', !!taText, true);
check('[I10] in hướng dẫn ra console',
  logs.some(([k, a]) => k === 'log' && /đã nạp/.test(String(a[0]))), true);

console.log('\n[2] bấm "⟳ Tải danh sách"');

btnLoad.click();
const loaded = await until(() => btnSend.disabled === false, 8000);
check('[I11] bấm tải ⇒ xong', loaded, true);
check('[I12] server nhận request danh sách', st.listCalls >= 1, true);
check('[I13] dùng endpoint THẬT /api/v1/pages/{id}/conversations',
  /\/api\/v1\/pages\/689375157595846\/conversations\?/.test(st.urls[0] || ''), true);
check('[I14] tải xong ⇒ nút Gửi MỞ', btnSend.disabled, false);
check('[I15] hiện số chat đã tải', /2 chat/.test(DOC.getElementById('bws-info').textContent), true);
check('[I16] hiện số chat bật cờ 7 ngày', /bật cờ 7 ngày: 2/.test(DOC.getElementById('bws-info').textContent), true);

console.log('\n[3] bấm "⚡ Gửi" khi CHƯA nhập nội dung');

{
  const before = st.sendCalls;
  taText.value = '   ';
  btnSend.click();
  await wait(100);
  check('[I17] chưa nhập nội dung ⇒ KHÔNG gửi', st.sendCalls - before, 0);
  check('[I18] báo rõ "Chưa nhập nội dung"',
    /Chưa nhập/.test(DOC.getElementById('bws-info').textContent), true);
}

console.log('\n[4] bấm "⚡ Gửi" với nội dung thật');

{
  const before = st.sendCalls;
  taText.value = 'Xin chào';
  btnSend.click();

  check('[I19] hỏi xác nhận trước khi gửi', confirms.length >= 1, true);
  check('[I20] câu xác nhận nêu đúng số chat', /cho 2 chat/.test(confirms[0] || ''), true);

  const sent = await until(() => st.sendCalls - before >= 2, 10000);
  check('[I21] server nhận 2 request gửi', sent, true);

  const s0 = st.sends[0] || {};
  check('[I22] URL đúng dạng THẬT',
    s0.url, '/api/v1/pages/689375157595846/conversations/689375157595846_29617688761165549/messages?access_token=cookie_session');
  check('[I23] có action=reply_inbox', s0.body.action, 'reply_inbox');
  check('[I24] có send_by_platform=web', s0.body.send_by_platform, 'web');
  check('[I25] có message đúng', String(s0.body.message || ''), 'Xin chào');
  check('[I26] có is_record_ctx_7_days=true', s0.body.is_record_ctx_7_days, 'true');
  check('[I27] dùng multipart cho tin chữ', /multipart\/form-data/.test(s0.ctype || ''), true);

  /* Chờ worker báo done ⇒ panel phải hiện XONG và mở lại nút */
  const done = await until(
    () => /XONG/.test(DOC.getElementById('bws-info').textContent), 10000);
  check('[I28] panel hiện XONG', done, true);
  check('[I29] XONG hiện số ok', /ok 2/.test(DOC.getElementById('bws-info').textContent), true);
  check('[I30] xong ⇒ nút Tải mở lại', btnLoad.disabled, false);
}

console.log('\n[5] nạp 2 lần không hỏng');

{
  const nRoot = DOC.body.children.filter((c) => c.id === 'bws-root').length;
  check('[I31] chỉ có 1 khung (không vẽ chồng)', nRoot, 1);
  let threw = false;
  try { vm.runInContext(INSTALL_SRC, ctx, { filename: 'cai-dat-2.js' }); } catch (e) { threw = true; }
  check('[I32] dán lần 2 không ném lỗi', threw, false);
  check('[I33] dán lần 2 vẫn chỉ 1 khung',
    DOC.body.children.filter((c) => c.id === 'bws-root').length, 1);
}

srv.close();

console.log('\n' + (fail === 0
  ? '✓ ' + pass + ' test đều đúng — BẢN CÀI chạy end-to-end (bấm nút thật).'
  : '✗ ' + fail + '/' + (pass + fail) + ' test ĐỎ'));
process.exit(fail === 0 ? 0 : 1);
