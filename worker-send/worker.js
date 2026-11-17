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

import {
  createWorkerSend, makeRealClock, DEFAULT_MAIN_CAP,
} from './engine.mjs';

/* ---------------------------------------------------------------------------
 * TƯƠNG THÍCH MÔI TRƯỜNG (Web Worker ⇄ Node Worker)
 * Worker trên trang Pancake dùng `self.postMessage` + `self.onmessage`.
 * Node dùng `parentPort` + `workerData`/`postMessage`. Giữ MỘT bản code cho cả hai
 * để test bằng Node chính là code chạy thật trên trình duyệt — không test bản sao.
 * ------------------------------------------------------------------------- */
const IS_NODE = (typeof self === 'undefined' || typeof self.postMessage !== 'function');

let nodePort = null;
if (IS_NODE) {
  const { parentPort } = await import('node:worker_threads');
  nodePort = parentPort;
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
 * Bắn MỘT tin qua API Pancake (đường HTTP).
 *
 * ĐÂY LÀ ĐƯỜNG AN TOÀN NHẤT ĐỂ CHẠY TRONG WORKER vì:
 *   • `fetch` có sẵn trong Worker, không cần DOM.
 *   • API chỉ cần conversation_id + access_token (HAR: 58/58 lệnh gửi API KHÔNG có global_id)
 *     ⇒ không phải chờ main thread dò gid ⇒ bỏ hẳn khâu 13 475 ms từng thấy ở lô 13:31.
 *   • Token do main thread đưa sang (cookie phiên nằm ở trang), worker chỉ dùng.
 *
 * TRẢ VỀ ĐÚNG `kind` MÀ ENGINE CẦN:
 *   'ok'       — server nhận (2xx + success)
 *   'rejected' — FB từ chối dứt khoát (#10 ngoài 24h / #551 không có mặt / 1545041)
 *                ⇒ CHẮC CHẮN chưa gửi ⇒ an toàn để tầng trên bù kênh khác
 *   'noack'    — timeout / 5xx / mạng đứt ⇒ CHƯA RÕ ⇒ tuyệt đối không bắn lại mù
 *   'dead'     — không có token / không cấu hình ⇒ chưa bắn
 */
async function publishViaApi(conv, opts) {
  const token = cfg.accessToken;
  if (!token) return { ok: false, kind: 'dead', error: 'Worker chưa có access_token' };
  if (!cfg.apiBase) return { ok: false, kind: 'dead', error: 'Worker chưa có apiBase' };

  const pageId = opts.pageId;
  const url = cfg.apiBase + '/v1/pages/' + encodeURIComponent(pageId) + '/messages'
    + '?access_token=' + encodeURIComponent(token);

  const body = {
    conversation_id: String(conv.id),
    message: conv.text || '',
  };
  if (conv.contentIds && conv.contentIds.length) body.content_ids = conv.contentIds;
  if (conv.isRecordCtx7Days) body.is_record_ctx_7_days = true;

  const t0 = clock.now();
  let res;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => { try { ctl.abort(); } catch (e) { /* ignore */ } }, opts.holdMs + 4000);
    res = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit', // cookie phiên nằm ở trang; worker dùng access_token
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
