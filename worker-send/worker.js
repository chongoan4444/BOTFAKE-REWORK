/**
 * BOTFAKE WORKER-SEND — LỚP VỎ CHẠY TRONG WEB WORKER
 * ============================================================================
 * File này được nạp bằng `new Worker(blobURL, { type: 'module' })` (hoặc file trực tiếp
 * trong tiện ích). Nó KHÔNG có DOM, KHÔNG có localStorage — đó chính là mục đích:
 * mọi thứ nặng (điều phối, đồng hồ, phân loại ACK) chạy ở thread riêng, không tranh
 * CPU với React/MQTT của trang Pancake ⇒ đồng hồ không trễ ⇒ ACK không bị cắt oan.
 *
 * GIAO THỨC (postMessage hai chiều)
 *   main → worker
 *     { t: 'init',        cfg }            cấu hình: mainCap, accessToken, apiBase, pageIds
 *     { t: 'send',        list }           danh sách chat cần gửi
 *     { t: 'stop' }                        dừng ngay
 *     { t: 'rpc-result',  id, ok, data }   trả lời cho yêu cầu worker→main (xem dưới)
 *   worker → main
 *     { t: 'ready' }
 *     { t: 'log',   rec }                  một dòng log (main tự vẽ, đã hạ nhịp)
 *     { t: 'tick',  stats }                số đo định kỳ
 *     { t: 'rpc',   id, what, args }       worker CẦN main làm hộ (Redux/IndexedDB/token)
 *     { t: 'done',  stats }
 *     { t: 'error', message }
 *
 * VÌ SAO CẦN RPC: dò global_id phải đọc Redux/IndexedDB/mapping MQTT của chính trang —
 * những thứ đó chỉ tồn tại ở main thread. Worker hỏi, main trả lời, worker quyết định.
 */

import { createWorkerSend, makeRealClock, DEFAULT_MAIN_CAP } from './engine.mjs';

/* ---------------------------------------------------------------------------
 * TƯƠNG THÍCH MÔI TRƯỜNG (Web Worker ⇄ Node Worker)
 * Worker trên trang Pancake dùng `self.postMessage` + `self.onmessage`.
 * Node dùng `parentPort` + `workerData`/`postMessage`. Giữ MỘT bản code cho cả hai
 * để test bằng Node chính là code chạy thật trên trình duyệt — không test bản sao.
 * ------------------------------------------------------------------------- */
const IS_NODE = (typeof self === 'undefined' || typeof self.postMessage !== 'function');

let nodePort = null;
if (IS_NODE) {
  /* KHÔNG dùng `await import(...)` ở đây: nó là top-level await ⇒ khi bridge.js
   * nhúng file này vào một Blob/IIFE (không phải module) sẽ là SyntaxError.
   * `process.getBuiltinModule` lấy được module đồng bộ (Node >= 20.16 / 22). */
  try {
    const wt = (typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function')
      ? process.getBuiltinModule('node:worker_threads')
      : null;
    nodePort = wt ? wt.parentPort : null;
  } catch (e) { nodePort = null; }
}

let stopResolve = null;
const stopPromise = new Promise((r) => { stopResolve = r; });
const clock = makeRealClock(stopPromise);

let engine = null;
let cfg = { mainCap: DEFAULT_MAIN_CAP, apiBase: '', accessToken: '', dryRun: false };
const rpcWaiters = new Map();
let rpcSeq = 0;

const post = (msg) => {
  try {
    if (nodePort) nodePort.postMessage(msg); else self.postMessage(msg);
  } catch (e) { /* ignore */ }
};

/** Gọi main thread làm hộ một việc (dò gid, lấy token, đọc Redux…). Có hạn chờ. */
function rpc(what, args, timeoutMs) {
  const id = ++rpcSeq;
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (done) return; done = true; rpcWaiters.delete(id); resolve(v); };
    rpcWaiters.set(id, fin);
    post({ t: 'rpc', id, what, args });
    clock.wait(timeoutMs || 8000).then(() => fin({ ok: false, error: 'rpc timeout: ' + what }));
  });
}

/**
 * Bắn MỘT tin qua API Pancake — DÙNG ĐÚNG REQUEST THẬT CỦA APP.
 *
 * BẢN ĐẦU CỦA TÔI SAI (đáng ghi lại, vì nó "chạy được" nên rất dễ tin nhầm):
 *   tôi viết  POST {apiBase}/v1/pages/{pageId}/messages
 *              body JSON { conversation_id, message }
 *   Request đó KHÔNG BAO GIỜ được Pancake xử lý: thiếu đoạn
 *   `/conversations/{convId}`, thiếu `action=reply_inbox`, thiếu `send_by_platform=web`.
 *   Test cũ vẫn xanh vì server giả của tôi nhận gì cũng trả `success` — test đúng mà
 *   giả thuyết sai. Nay đối chiếu với `buildInboxSend` của bản 1.92.55 (dòng 3130).
 *
 * REQUEST THẬT (đã khớp 13 request của app trong tinnhan.har, ghi ở dòng 3123):
 *   POST {apiBase}/v1/pages/{page_id}/conversations/{encodeURIComponent(conv.id)}/messages
 *        ?access_token=...
 *   • chữ hoặc 1 ảnh  → multipart/form-data:
 *       action=reply_inbox · [is_record_ctx_7_days=true] · message · [content_id ·
 *       attachment_id · content_url · width · height] · send_by_platform=web
 *   • ≥ 2 ảnh         → application/json:
 *       { action, [is_record_ctx_7_days], message, content_ids, attachment_ids,
 *         content_urls, dimensions, send_by_platform: 'web' }
 *
 * `is_record_ctx_7_days` KHÔNG phải tuỳ chọn cho vui — HAR: 19/19 request CÓ cờ ⇒
 * success:true; 24/24 request THIẾU cờ ⇒ (#10). Thiếu cờ là nguyên nhân phổ biến nhất
 * của (#10), KHÔNG phải "app khác giữ thread". Cờ do main thread tính (cần Redux của
 * trang) rồi truyền vào `conv.isRecordCtx7Days`.
 */
async function publishViaApi(conv, opts) {
  const token = cfg.accessToken;
  if (!token) return { ok: false, kind: 'dead', error: 'Worker chưa có access_token' };
  if (!cfg.apiBase) return { ok: false, kind: 'dead', error: 'Worker chưa có apiBase' };

  const pageId = opts.pageId;
  const convId = String(conv.id);
  const url = cfg.apiBase + '/v1/pages/' + encodeURIComponent(pageId)
    + '/conversations/' + encodeURIComponent(convId) + '/messages'
    + '?access_token=' + encodeURIComponent(token);

  const text = conv.text == null ? '' : String(conv.text);
  const ctx7 = !!conv.isRecordCtx7Days;
  const items = (Array.isArray(conv.photos) && conv.photos.length)
    ? conv.photos
    : (conv.photo ? [conv.photo] : []);

  let body; let headers;
  if (items.length > 1) {
    /* Đa ảnh ⇒ JSON. Đúng thứ tự field như buildInboxSend của bản cũ. */
    const jb = {
      action: 'reply_inbox',
      message: text,
      content_ids: items.map((x) => (x && x.id) || ''),
      attachment_ids: items.map((x) => (x && x.fbId) || ''),
      content_urls: items.map((x) => (x && x.url) || ''),
      dimensions: items.map((x) => ({ width: Number(x && x.w) || 0, height: Number(x && x.h) || 0 })),
      send_by_platform: 'web',
    };
    if (ctx7) jb.is_record_ctx_7_days = true;
    body = JSON.stringify(jb);
    headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  } else {
    /* Chữ hoặc 1 ảnh ⇒ multipart/form-data. Worker có FormData sẵn. */
    const fd = new FormData();
    fd.append('action', 'reply_inbox');
    if (ctx7) fd.append('is_record_ctx_7_days', 'true');
    fd.append('message', text);
    const p0 = items[0] || null;
    if (p0) {
      /* ĐÚNG THỨ TỰ request thật của app khi gửi 1 ảnh:
       * content_id → attachment_id → content_url → width → height */
      if (p0.id) fd.append('content_id', p0.id);
      if (p0.fbId) fd.append('attachment_id', p0.fbId);
      fd.append('content_url', p0.url || '');
      if (p0.w) fd.append('width', String(p0.w));
      if (p0.h) fd.append('height', String(p0.h));
    }
    fd.append('send_by_platform', 'web');
    body = fd;
    headers = { Accept: 'application/json' }; // KHÔNG đặt Content-Type: boundary do FormData sinh
  }

  const t0 = clock.now();
  let res;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => { try { ctl.abort(); } catch (e) { /* ignore */ } }, opts.holdMs + 4000);
    /* `credentials: 'omit'` — CỐ Ý. Worker gửi kèm access_token, không dựa cookie phiên
     * (bản cũ dùng 'include' vì chạy trên trang). Nếu sau này thấy 401 hàng loạt thì
     * đổi thành 'include' SAU KHI đo, không đổi mù. */
    res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      credentials: 'omit',
      signal: ctl.signal,
    }).finally(() => { try { clearTimeout(timer); } catch (e) { /* ignore */ } });
  } catch (e) {
    // Mạng đứt / bị huỷ: CHƯA RÕ. Không bao giờ trả 'error' ở đây vì tầng trên có thể bắn lại.
    return { ok: false, kind: 'noack', error: 'fetch lỗi: ' + String(e && e.message || e), ackMs: clock.now() - t0 };
  }

  const ackMs = clock.now() - t0;
  if (res.status === 429 || res.status >= 500) {
    return { ok: false, kind: 'noack', error: 'HTTP ' + res.status, ackMs };
  }
  let j = null;
  try { j = await res.json(); } catch (e) { j = null; }

  if (res.ok && j && (j.success === true || j.id)) {
    return { ok: true, kind: 'ok', ackMs, id: j.id };
  }
  const msg = String((j && (j.message || j.error || (j.data && j.data.message))) || ('HTTP ' + res.status));
  if (isRejectedError(msg)) return { ok: false, kind: 'rejected', error: msg, ackMs };
  return { ok: false, kind: 'noack', error: msg, ackMs };
}

/** Nhận diện lỗi FB TỪ CHỐI DỨT KHOÁT — bản cũ: `isWindowClosedError` + 1545041. */
export function isRejectedError(msg) {
  const m = String(msg || '');
  return m.indexOf('(#551)') > -1
    || m.indexOf('(#10)') > -1
    || m.indexOf('ngoài khoảng thời gian cho phép') > -1
    || m.indexOf('Người này hiện không có mặt') > -1
    || m.indexOf('1545041') > -1;
}

function buildEngine() {
  return createWorkerSend({
    clock,
    mainCap: cfg.mainCap,
    publish: publishViaApi,
    onLog(rec) { post({ t: 'log', rec }); },
  });
}

let tickTimer = null;
function startTick() {
  if (tickTimer) return;
  const loop = () => {
    post({ t: 'tick', stats: engine ? engine.stats() : null, diag: engine ? engine.diag : null });
    tickTimer = setTimeout(loop, 1000);
  };
  tickTimer = setTimeout(loop, 1000);
}

async function onMessage(m) {
  if (!m || !m.t) return;

  if (m.t === 'init') {
    cfg = Object.assign({}, cfg, m.cfg || {});
    engine = buildEngine();
    post({ t: 'ready', mainCap: cfg.mainCap });
    return;
  }

  if (m.t === 'rpc-result') {
    const w = rpcWaiters.get(m.id);
    if (w) w({ ok: !!m.ok, data: m.data, error: m.error });
    return;
  }

  if (m.t === 'stop') {
    stopResolve();
    post({ t: 'done', stats: engine ? engine.stats() : null, stopped: true });
    return;
  }

  if (m.t === 'send') {
    if (!engine) { post({ t: 'error', message: 'Chưa init' }); return; }
    startTick();
    try {
      const results = await engine.sendAll(m.list || [], { limit: m.limit || cfg.mainCap });
      if (tickTimer) { try { clearTimeout(tickTimer); } catch (e) { /* ignore */ } tickTimer = null; }
      post({ t: 'done', stats: engine.stats(), diag: engine.diag, results: results.length });
    } catch (e) {
      post({ t: 'error', message: String(e && e.message || e) });
    }
  }
}

/* Khởi động. Tách thành hàm để `bridge.js` gọi được sau khi nhúng file này vào Blob
 * (bundle không phải module nên không tự chạy ở cấp cao nhất được). */
function boot() {
  if (nodePort) {
    nodePort.on('message', (m) => { void onMessage(m); });
  } else if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
    self.addEventListener('message', (ev) => { void onMessage(ev && ev.data); });
  } else if (typeof self !== 'undefined') {
    self.onmessage = (ev) => { void onMessage(ev && ev.data); };
  }
  /* Node MAIN thread (không phải worker): không đăng ký listener — file vẫn import được
   * để kiểm cú pháp, nhưng không có nơi nào gửi message tới. */
  post({ t: 'hello', version: 'worker-send-1' });
}

export { boot };
boot();
