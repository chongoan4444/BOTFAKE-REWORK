#!/usr/bin/env node
/**
 * BOTFAKE WORKER-SEND — chạy THẬT file worker trong Node Worker
 * ============================================================================
 * Chạy: node worker-send/test-worker.mjs
 *
 * Đây không phải test "đọc chuỗi trong source" (như tools/test-verify.mjs): nó NẠP
 * worker-send/worker.js vào một Worker thật, đưa danh sách chat qua postMessage, và
 * chặn `fetch` để giả lập server Pancake. Nhờ vậy nó chứng minh được:
 *   • giao thức postMessage hai chiều chạy đúng
 *   • worker tự gọi fetch được (không cần DOM)
 *   • phân loại ok / rejected / noack đúng như engine
 *   • KHÔNG bắn trùng khi danh sách có ID trùng
 */

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_FILE = path.join(HERE, 'worker.js');

let pass = 0;
const fails = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fails.push(`${name}\n     nhận: ${JSON.stringify(got)} | mong đợi: ${JSON.stringify(want)}`);
}

/**
 * SERVER PANCAKE GIẢ — HTTP THẬT, không stub `fetch`.
 * Lý do: `fetch` của worker là biến toàn cục RIÊNG của worker, không thể tiêm từ ngoài.
 * Dùng server HTTP thật thì worker chạy đúng code production (gọi `fetch` tới `apiBase`),
 * và ta kiểm được cả việc nó thực sự gửi request + đọc JSON + phân loại lỗi.
 */
function startFakeServer() {
  const st = { calls: 0, urls: [], bodies: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      st.calls++;
      st.urls.push(req.url || '');
      st.ctypes = st.ctypes || [];
      st.ctypes.push(String(req.headers['content-type'] || ''));
      /* Thân request PANCAKE THẬT có 2 dạng:
       *   • chữ / 1 ảnh  → multipart/form-data   (KHÔNG parse JSON được)
       *   • ≥ 2 ảnh      → application/json
       * Server giả phải đọc được CẢ HAI, nếu không thì ca "gửi chữ" sẽ luôn rơi vào nhánh
       * mặc định và test xanh một cách vô nghĩa. */
      let body = {};
      const ctype = String(req.headers['content-type'] || '');
      if (ctype.indexOf('application/json') > -1) {
        try { body = JSON.parse(raw || '{}'); } catch (e) { body = {}; }
      } else {
        /* multipart: bóc từng part, đủ cho các field dạng text của request này */
        const re = /name="([^"]+)"(?:\r\n\r\n|\r\n\r\n)([\s\S]*?)\r\n--/g;
        let m;
        while ((m = re.exec(raw)) !== null) body[m[1]] = m[2];
        if (!Object.keys(body).length) body = { __raw: raw.slice(0, 200) };
      }
      st.bodies.push(body);
      const text = String(body.message || '');
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (text.indexOf('REJECT') > -1) {
        return send(200, { success: false, message: '(#10) Tin nhắn này được gửi ngoài khoảng thời gian cho phép' });
      }
      if (text.indexOf('NOACK') > -1) {
        return send(503, { success: false, message: 'Service Unavailable' });
      }
      return send(200, { success: true, id: 'msg_' + st.calls });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ st, server, base: 'http://127.0.0.1:' + port });
    });
  });
}

function runWorker(list, cfgExtra) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_FILE, {
      workerData: null,
      execArgv: [],
      // Tiêm `fetch` giả + `self` cho môi trường Node (Web Worker API).
      resourceLimits: {},
    });
    const logs = [];
    let settled = false;
    const fin = (fn, v) => { if (settled) return; settled = true; clearTimeout(t); try { w.terminate(); } catch (e) { /* ignore */ } fn(v); };
    const t = setTimeout(() => fin(reject, new Error('worker timeout')), 15000);

    /* CHỜ `done` TỪ WORKER, KHÔNG chờ sự kiện 'exit': worker vẫn sống sau khi gửi done
     * (nó còn nhận lệnh Dừng) ⇒ chờ exit là treo tới hết giờ. Đây là lỗi của harness,
     * không phải của worker. */
    w.on('message', (m) => {
      if (!m || !m.t) return;
      if (m.t === 'log') logs.push(m.rec);
      if (m.t === 'done') fin(resolve, { done: m, logs });
      if (m.t === 'error') fin(reject, new Error('worker error: ' + m.message));
    });
    w.on('error', (e) => fin(reject, e));

    w.postMessage({ t: 'init', cfg: Object.assign({ accessToken: 'TOK' }, cfgExtra) });
    w.postMessage({ t: 'send', list });
  });
}

/* ------------------------------------------------------------------ chạy thật */
const { st, server, base } = await startFakeServer();

const list = [
  { id: '111_1', pageId: '111', text: 'xin chào' },
  { id: '111_2', pageId: '111', text: 'REJECT ca này' },   // ⇒ rejected
  { id: '111_3', pageId: '111', text: 'NOACK ca này' },    // ⇒ noack
  { id: '111_1', pageId: '111', text: 'xin chào' },        // TRÙNG ID ⇒ phải bị chặn
  { id: '222_1', pageId: '222', text: 'tin khác page' },
];

const { done, logs } = await runWorker(list, { mainCap: 3, apiBase: base, accessToken: 'TOK' });

check('[W1] worker chạy xong và trả done', !!done, true);
/* `n` = số lần BẮN THẬT (giữ đúng nghĩa bản cũ), không phải số dòng danh sách.
 * 5 dòng, 1 dòng trùng ⇒ 4 lần bắn + 1 lần chặn. */
check('[W2] 5 dòng danh sách ⇒ 4 lần bắn + 1 lần bị chặn (dupBlocked)', [done.stats.n, done.stats.dupBlocked], [4, 1]);
check('[W3] KHÔNG bắn trùng ⇒ server chỉ nhận 4 request', st.calls, 4);
check('[W4] đếm ok = 2 (111_1 + 222_1)', done.stats.ok, 2);
check('[W5] đếm fail = 1 (ca REJECT)', done.stats.fail, 1);
check('[W6] đếm uncertain = 1 (ca NOACK ⇒ chưa rõ, KHÔNG bắn lại)', done.stats.uncertain, 1);
check('[W7] có log đẩy về main thread', logs.length > 0, true);
check('[W8] log có đủ 3 loại kind', Array.from(new Set(logs.map((l) => l.kind))).sort(), ['noack', 'ok', 'rejected']);
check('[W9] URL đúng dạng THẬT /v1/pages/{page}/conversations/{id}/messages?access_token=…',
  /^\/v1\/pages\/111\/conversations\/111_1\/messages\?access_token=TOK$/.test(st.urls[0]), true);
check('[W10] thân request có action=reply_inbox (BẮT BUỘC, bản đầu tôi thiếu)', st.bodies[0].action, 'reply_inbox');
check('[W10b] thân request có send_by_platform=web', st.bodies[0].send_by_platform, 'web');
check('[W10c] thân request có message đúng', String(st.bodies[0].message || ''), 'xin chào');
check('[W11] peakInFlight không vượt mainCap 3', done.stats.peakInFlight <= 3, true);

/* ------------------------------------------- ca KHÔNG có token ⇒ 'dead', không bắn */
{
  const before = st.calls;
  const got = await runWorker([{ id: 'p_1', pageId: 'p', text: 'x' }], { mainCap: 2, apiBase: base, accessToken: '' });
  check('[W12] thiếu token ⇒ KHÔNG gọi server lần nào', st.calls - before, 0);
  check('[W13] thiếu token ⇒ chốt failed (biết chắc chưa bắn)', got.done.stats.fail, 1);
}

/* ---------------------------------- ca NHIỀU PAGE: nhịp phát độc lập, không chờ nhau */
{
  const before = st.calls;
  const many = [];
  for (let i = 0; i < 6; i++) many.push({ id: 'A_' + i, pageId: 'A', text: 'a' + i });
  for (let i = 0; i < 6; i++) many.push({ id: 'B_' + i, pageId: 'B', text: 'b' + i });
  const r = await runWorker(many, { mainCap: 12, apiBase: base, accessToken: 'TOK' });
  check('[W14] 12 chat / 2 page ⇒ 12 request, 0 trùng', [st.calls - before, r.done.stats.dupBlocked], [12, 0]);
  check('[W15] tất cả thành công', r.done.stats.ok, 12);
}

server.close();

/* ------------------------------------------------------------------ kết quả */
if (fails.length) {
  console.log(`✗ ${fails.length}/${pass + fails.length} test WORKER THẬT THẤT BẠI:\n`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`✓ ${pass} test đều đúng — worker.js CHẠY THẬT trong Node Worker + HTTP server thật.`);
console.log('  Chứng minh: postMessage 2 chiều · tự gọi fetch · phân loại ok/rejected/noack · KHÔNG gửi trùng.');
