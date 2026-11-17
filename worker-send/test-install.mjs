/**
 * TEST BẢN CÀI (dist/worker-send.install.js) — chạy END-TO-END.
 *
 * `build.mjs` chỉ chứng minh file PARSE ĐƯỢC. Test này chứng minh nó CHẠY ĐƯỢC:
 * nạp file cài vào một trang giả lập (có window/Redux/Worker/Blob), rồi gọi đúng
 * `BOTFAKE_WS.run({text})` như người dùng sẽ gõ, và kiểm HTTP server THẬT nhận gì.
 *
 * Đây là mức gần nhất với "người dùng dán vào console" mà không cần trình duyệt thật.
 */
import http from 'node:http';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const INSTALL = path.join(ROOT, 'dist', 'worker-send.install.js');

let pass = 0; let fail = 0;
function check(name, got, want) {
  const a = JSON.stringify(got); const b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      nhận: ' + a + '\n      mong: ' + b); }
}

if (!existsSync(INSTALL)) {
  console.error('✗ chưa có dist/worker-send.install.js — chạy: node worker-send/build.mjs');
  process.exit(1);
}
const INSTALL_SRC = readFileSync(INSTALL, 'utf8');

/* ---------------------------------------------------------- Pancake giả */
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
      st.sends.push({ url: req.url, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, id: 'msg_' + st.sendCalls }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, st, port: srv.address().port })));
}

/* ------------------------------------------------- trang giả lập + Worker thật */
/**
 * Dựng ngữ cảnh giống trình duyệt: `window` là global, có Redux, có Blob/URL
 * và **Worker thật** — Worker được chạy bằng cách eval bundle trong một vm riêng,
 * postMessage nối 2 chiều bằng hàng đợi async (giống thread riêng).
 */
function makeBrowser(port, hostname) {
  const logs = [];
  const ctx = {
    console: {
      log: (...a) => logs.push(['log', a]), warn: (...a) => logs.push(['warn', a]),
      error: (...a) => logs.push(['error', a]),
    },
    location: { hostname: hostname || 'pancake.vn', origin: 'http://127.0.0.1:' + port, pathname: '/pages/689375157595846/inbox', search: '' },
    localStorage: { length: 0, key() { return null; }, getItem() { return null; }, setItem() {} },
    performance: { getEntriesByType() { return []; } },
    document: { getElementById() { return null; }, querySelector() { return null; } },
    fetch, FormData, Blob, URLSearchParams, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Object, String, Array, Error, RegExp, Date, Math, Number, Map, Set,
    encodeURIComponent, decodeURIComponent, parseInt, isNaN,
  };
  ctx.window = ctx; // window === global, như trình duyệt
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

  /* Blob/URL.createObjectURL: thu mã nguồn lại để "Worker" đọc được. */
  let blobCode = null;
  ctx.Blob = class { constructor(parts) { this.code = parts.join(''); } };
  ctx.URL = { createObjectURL(b) { blobCode = b.code; return 'blob:ws'; }, revokeObjectURL() {} };

  /* WORKER "THẬT": mỗi Worker có global RIÊNG (self), chạy trong vm riêng, và
   * postMessage đi qua hàng đợi setTimeout ⇒ main và worker KHÔNG dùng chung closure.
   * Đủ để bắt lỗi kiểu "worker đọc biến của main". */
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
      this._selfCtx = selfCtx;
      this.onmessage = null;
      this.onerror = null;
    }
    postMessage(m) {
      setTimeout(() => { if (this._fn) this._fn({ data: m }); }, 0);
    }
    terminate() { this._fn = null; this.onmessage = null; }
  };

  vm.createContext(ctx);
  vm.runInContext(INSTALL_SRC, ctx, { filename: 'install.js' });
  return { ctx, logs };
}

/* ============================================================== */
console.log('\n[1] nạp bản cài');

const { srv, st, port } = await startPancake();
const { ctx, logs } = makeBrowser(port);

check('[I1] nạp xong có window.BOTFAKE_WS', typeof ctx.window.BOTFAKE_WS, 'object');
check('[I2] gắn cờ chống nạp 2 lần', ctx.window.__BOTFAKE_WS_INSTALLED__, true);
check('[I3] có loadlist.js', typeof ctx.window.__BOTFAKE_WS_LOADLIST__, 'object');
check('[I4] có bridge.js', typeof ctx.window.__BOTFAKE_WORKER_SEND__, 'object');
check('[I5] in hướng dẫn khi nạp',
  logs.some(([k, a]) => k === 'log' && String(a[0]).indexOf('đã nạp') > -1), true);

{
  let threw = false;
  try { vm.runInContext(INSTALL_SRC, ctx, { filename: 'install-2.js' }); } catch (e) { threw = true; }
  check('[I6] dán 2 lần không ném lỗi', threw, false);
  check('[I7] dán 2 lần không nạp đè', ctx.window.BOTFAKE_WS && typeof ctx.window.BOTFAKE_WS.run, 'function');
}

/* [1b] HOOK MẠNG — pages.fm không có JWT sẵn, PHẢI bắt từ request của trang.
 * Đây là lỗi thật từng mắc: loadlist.js bản đầu không hook ⇒ token rỗng ⇒ run() báo
 * "Không có access_token" dù trang đang chạy bình thường. */
console.log('\n[1b] hook mạng bắt token trên pages.fm');
{
  const { srv: s2, port: p2 } = await startPancake();
  const b = makeBrowser(p2, 'pages.fm');
  const L = b.ctx.window.__BOTFAKE_WS_LOADLIST__;
  check('[H1] pages.fm, chưa có request ⇒ token rỗng', L.getToken(), '');
  /* Giả lập CHÍNH TRANG gửi 1 request có access_token (như app vẫn làm). */
  await b.ctx.fetch('http://127.0.0.1:' + p2 + '/api/v1/users/get_auth/?access_token=eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl');
  check('[H2] sau khi trang gửi request ⇒ bắt được JWT', L.getToken(), 'eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl');
  check('[H3] token JWT dùng được cho danh sách', /access_token=eyJ/.test(L.buildListUrl({}).url), true);
  s2.close();
}

console.log('\n[2] BOTFAKE_WS.help()');

{
  const before = logs.length;
  ctx.window.BOTFAKE_WS.help();
  check('[I8] help() in ra hướng dẫn', logs.length > before, true);
  const txt = logs.slice(before).map(([, a]) => a.join(' ')).join('\n');
  check('[I9] help() có nhắc dryRun (chạy thử trước)', /dryRun/.test(txt), true);
  check('[I10] help() nói rõ dùng API, chậm hơn Socket', /API/.test(txt) && /chậm hơn/.test(txt), true);
}

console.log('\n[3] run() — CHẠY THỬ (dryRun) không được bắn');

{
  const before = st.sendCalls;
  const r = await ctx.window.BOTFAKE_WS.run({ text: 'Xin chào', dryRun: true });
  check('[I11] dryRun ⇒ ok', r.ok, true);
  check('[I12] dryRun ⇒ đọc được danh sách 2 chat', r.items, 2);
  check('[I13] dryRun ⇒ KHÔNG bắn request nào', st.sendCalls - before, 0);
  check('[I14] dryRun ⇒ sent=0', r.sent, 0);
}

console.log('\n[4] run() — GỬI THẬT');

{
  const before = st.sendCalls;
  const r = await ctx.window.BOTFAKE_WS.run({ text: 'Xin chào' });
  check('[I15] gửi thật ⇒ ok', r.ok, true);
  check('[I16] gửi thật ⇒ đọc 2 chat', r.items, 2);

  /* chờ worker xong */
  const done = await new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (st.sendCalls - before >= 2) { clearInterval(iv); resolve(true); }
      else if (Date.now() - t0 > 10000) { clearInterval(iv); resolve(false); }
    }, 25);
  });
  check('[I17] server nhận 2 request gửi', done, true);

  const s0 = st.sends[0] || {};
  check('[I18] URL đúng dạng THẬT',
    s0.url, '/api/v1/pages/689375157595846/conversations/689375157595846_29617688761165549/messages?access_token=cookie_session');
  check('[I19] có action=reply_inbox', s0.body.action, 'reply_inbox');
  check('[I20] có send_by_platform=web', s0.body.send_by_platform, 'web');
  check('[I21] có message đúng', String(s0.body.message || ''), 'Xin chào');
  check('[I22] có is_record_ctx_7_days=true (khách im từ 2026-09 + page bật ctx7)',
    s0.body.is_record_ctx_7_days, 'true');
}

console.log('\n[5] stats & results');

{
  const s = ctx.window.BOTFAKE_WS.stats();
  check('[I23] stats() có ok', typeof s.ok, 'number');
  check('[I24] results() là mảng', Array.isArray(ctx.window.BOTFAKE_WS.results()), true);
}

srv.close();

console.log('\n' + (fail === 0 ? '✓ ' + pass + ' test đều đúng — BẢN CÀI chạy end-to-end.' : '✗ ' + fail + '/' + (pass + fail) + ' test ĐỎ'));
process.exit(fail === 0 ? 0 : 1);
