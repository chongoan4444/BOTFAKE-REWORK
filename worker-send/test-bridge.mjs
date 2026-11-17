/**
 * TEST CẦU NỐI (bridge.js) — dựng bundle ĐÚNG NHƯ TRÌNH DUYỆT rồi chạy nó.
 *
 * Vì sao cần test riêng: `test-worker.mjs` chạy `worker.js` như module (Node import),
 * còn trên trang Pancake nó KHÔNG phải module — bridge.js ghép engine.mjs + worker.js
 * thành một blob classic. Hai đường này khác nhau, và bản đầu của bridge.js đã SAI
 * đúng ở chỗ đó: quên strip `export` của worker.js + bọc hàm không async ⇒ blob là
 * SyntaxError ⇒ Worker chết ngay, biểu hiện ra ngoài chỉ là "không có log gì".
 *
 * Test này chạy: bridge.js thật → buildBlobUrl() thật → bundle thật → vm (giả lập
 * trình duyệt, có `self`) → HTTP server thật (giả lập Pancake).
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_SRC = readFileSync(path.join(HERE, 'engine.mjs'), 'utf8');
const WORKER_SRC = readFileSync(path.join(HERE, 'worker.js'), 'utf8');
const BRIDGE_SRC = readFileSync(path.join(HERE, 'bridge.js'), 'utf8');

let pass = 0; let fail = 0;
function check(name, got, want) {
  const a = JSON.stringify(got); const b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + '\n      nhận: ' + a + '\n      mong: ' + b); }
}

/* ---------------------------------------------------------------- Pancake giả */
function startFakeServer(handler) {
  return new Promise((resolve) => {
    const hits = [];
    const srv = http.createServer((req, res) => {
      let buf = '';
      req.on('data', (c) => { buf += c; });
      req.on('end', () => {
        /* Pancake thật: multipart cho chữ/1 ảnh, JSON cho ≥2 ảnh. Đọc được cả hai. */
        const ctype = String(req.headers['content-type'] || '');
        let body = null;
        if (ctype.indexOf('application/json') > -1) {
          try { body = JSON.parse(buf || '{}'); } catch (e) { body = null; }
        } else {
          body = {};
          const re = /name="([^"]+)"(?:\r\n\r\n)([\s\S]*?)\r\n--/g;
          let m;
          while ((m = re.exec(buf)) !== null) body[m[1]] = m[2];
        }
        const rec = { url: req.url, method: req.method, body, ctype };
        hits.push(rec);
        const r = handler(rec, hits.length);
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.json));
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, hits, port: srv.address().port }));
  });
}

/* ------------------------------------------------- lấy bundle từ bridge.js thật */
function buildBundleViaBridge() {
  let captured = null;
  const fakeWindow = {};
  const sandbox = {
    window: fakeWindow,
    Blob: class { constructor(parts) { this._parts = parts; } },
    URL: { createObjectURL(b) { captured = b._parts.join(''); return 'blob:fake'; }, revokeObjectURL() {} },
    console,
    Promise, JSON, Object, String, Array, Error, RegExp, Date, setTimeout, clearTimeout,
    Worker: class { constructor() {} postMessage() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE_SRC, sandbox, { filename: 'bridge.js' });
  const API = fakeWindow.__BOTFAKE_WORKER_SEND__;
  if (!API) throw new Error('bridge.js không gắn được API vào window');
  API.setSources(ENGINE_SRC, WORKER_SRC);
  API.setConfig({ mainCap: 96, apiBase: 'http://127.0.0.1:PORT', accessToken: 'TOK' });
  API.start(); // tạo blob (không có Worker thật ⇒ terminate ngay bên dưới)
  API.terminate();
  if (!captured) throw new Error('bridge.js không tạo được blob');
  return captured;
}

/* --------------------------------- chạy bundle trong giả lập trình duyệt (self) */
function runInFakeBrowser(code, apiBase, onMessage) {
  const listeners = [];
  const ctx = {
    self: {
      postMessage(m) { onMessage(m); },
      addEventListener(ev, fn) { if (ev === 'message') listeners.push(fn); },
    },
    fetch, AbortController, setTimeout, clearTimeout, console,
    /* TRÌNH DUYỆT có sẵn FormData/Blob/URLSearchParams trong Worker — sandbox vm thì KHÔNG.
     * Thiếu FormData ⇒ publishViaApi ném ngay ở `new FormData()` và test đỏ hàng loạt.
     * Đây là khác biệt MÔI TRƯỜNG, không phải lỗi code — nhưng nếu không bổ sung thì
     * test sẽ đo một thứ khác với trình duyệt thật. */
    FormData, Blob, URLSearchParams,
    Promise, JSON, Object, String, Array, Error, RegExp, Date, Math, Number, Map, Set,
    encodeURIComponent, parseInt, isNaN,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'bundle.js' });
  return {
    post(m) { for (const fn of listeners) fn({ data: m }); },
    listenerCount: () => listeners.length,
  };
}

/* ============================================================== CÁC CA ======= */
console.log('\n[1] bridge.js dựng bundle');

let bundle = null;
let buildErr = null;
try { bundle = buildBundleViaBridge(); } catch (e) { buildErr = String(e.message || e); }

check('[B1] bridge.js tạo được bundle (không ném)', buildErr, null);
check('[B2] bundle không còn export/import', /^\s*(export|import)\s/m.test(bundle || ''), false);
check('[B3] bundle bọc trong hàm async', /^\(async function \(\)\s*\{/.test(bundle || ''), true);

let scriptOk = true;
try { new vm.Script(bundle, { filename: 'bundle.js' }); } catch (e) { scriptOk = false; buildErr = String(e.message || e); }
check('[B4] bundle PARSE ĐƯỢC (đây là ca bản đầu của tôi FAIL)', scriptOk, true);
if (!scriptOk) console.log('      lỗi parse: ' + buildErr);

/* Bundle phải giữ đủ 3 hàm cốt lõi của worker — ghép thiếu là chết câm. */
check('[B5] bundle có publishViaApi', bundle.includes('function publishViaApi'), true);
check('[B6] bundle có isRejectedError', bundle.includes('function isRejectedError'), true);
check('[B7] bundle có createWorkerSend', bundle.includes('function createWorkerSend'), true);
check('[B8] bundle có boot()', /function boot\(\)/.test(bundle), true);

console.log('\n[2] bundle CHẠY THẬT trong giả lập trình duyệt + server thật');

const { srv, hits, port } = await startFakeServer((rec, n) => {
  if (n === 2) return { status: 200, json: { success: false, message: 'Tin nhắn nằm ngoài khoảng thời gian cho phép (#10)' } };
  if (n === 3) return { status: 503, json: { error: 'unavailable' } };
  return { status: 200, json: { success: true, id: 'm' + n } };
});

const msgs = [];
let ctl = null;
try {
  ctl = runInFakeBrowser(
    bundle.replace(/__PORT__/g, String(port)),
    'http://127.0.0.1:' + port,
    (m) => msgs.push(m),
  );
} catch (e) {
  check('[B9] bundle chạy được trong trình duyệt giả lập', String(e.message || e), null);
}

if (ctl) {
  check('[B9] bundle chạy được trong trình duyệt giả lập', true, true);
  check('[B10] đăng ký đúng 1 listener message', ctl.listenerCount(), 1);
  check('[B11] gửi hello khi khởi động', msgs.filter((m) => m.t === 'hello').length, 1);

  ctl.post({ t: 'init', cfg: { mainCap: 96, apiBase: 'http://127.0.0.1:' + port, accessToken: 'TOK' } });
  await new Promise((r) => setTimeout(r, 50));
  check('[B12] init ⇒ ready', msgs.filter((m) => m.t === 'ready').length, 1);

  ctl.post({
    t: 'send',
    limit: 96,
    list: [
      { id: '111_1', pageId: '111', text: 'a' },
      { id: '111_2', pageId: '111', text: 'b' },
      { id: '111_3', pageId: '111', text: 'c' },
      { id: '111_1', pageId: '111', text: 'a' }, // TRÙNG
    ],
  });

  const done = await new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const d = msgs.find((m) => m.t === 'done');
      if (d) { clearInterval(iv); resolve(d); }
      else if (Date.now() - t0 > 15000) { clearInterval(iv); resolve(null); }
    }, 25);
  });

  check('[B13] nhận được done (bundle sống tới cuối)', !!done, true);
  if (done) {
    check('[B14] 4 dòng, 1 trùng ⇒ 3 request thật', hits.length, 3);
    check('[B15] URL đúng dạng THẬT của Pancake',
      hits[0] && hits[0].url, '/v1/pages/111/conversations/111_1/messages?access_token=TOK');
    check('[B16] body có action=reply_inbox (bản đầu tôi thiếu ⇒ request vô hiệu)',
      hits[0] && hits[0].body.action, 'reply_inbox');
    check('[B16b] body có send_by_platform=web', hits[0] && hits[0].body.send_by_platform, 'web');
    check('[B16c] dùng multipart/form-data cho tin chữ',
      hits[0] && /multipart\/form-data/.test(hits[0].ctype), true);
    check('[B17] ok=1', done.stats.ok, 1);
    check('[B18] rejected (#10) ⇒ fail=1', done.stats.fail, 1);
    check('[B19] 503 ⇒ uncertain=1, KHÔNG bắn lại', done.stats.uncertain, 1);
    check('[B20] dupBlocked=1 (dòng trùng bị chặn)', done.stats.dupBlocked, 1);
    check('[B21] gửi log về trang', msgs.filter((m) => m.t === 'log').length > 0, true);
  }
}
srv.close();

/* [3] thiếu token ⇒ KHÔNG bắn, phải trả 'dead' chứ không im lặng */
console.log('\n[3] thiếu cấu hình');
const hits2 = [];
const srv2 = await startFakeServer((rec, n) => { hits2.push(rec); return { status: 200, json: { success: true, id: 'x' } }; });
const msgs2 = [];
const ctl2 = runInFakeBrowser(bundle, '', (m) => msgs2.push(m));
ctl2.post({ t: 'init', cfg: { mainCap: 96, apiBase: 'http://127.0.0.1:' + srv2.port, accessToken: '' } });
await new Promise((r) => setTimeout(r, 30));
ctl2.post({ t: 'send', limit: 96, list: [{ id: '111_9', pageId: '111', text: 'a' }] });
const done2 = await new Promise((resolve) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const d = msgs2.find((m) => m.t === 'done');
    if (d) { clearInterval(iv); resolve(d); }
    else if (Date.now() - t0 > 8000) { clearInterval(iv); resolve(null); }
  }, 25);
});
check('[B22] thiếu token ⇒ 0 request', srv2.hits.length, 0);
check('[B23] thiếu token ⇒ done.fail=1 (chốt là chưa bắn)', done2 && done2.stats.fail, 1);
check('[B24] thiếu token ⇒ KHÔNG uncertain (biết chắc chưa gửi)', done2 && done2.stats.uncertain, 0);
srv2.srv.close();

console.log('\n' + (fail === 0 ? '✓ ' + pass + ' test đều đúng — bundle của bridge.js CHẠY THẬT.' : '✗ ' + fail + '/' + (pass + fail) + ' test ĐỎ'));
process.exit(fail === 0 ? 0 : 1);
