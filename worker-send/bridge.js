/**
 * BOTFAKE WORKER-SEND — CẦU NỐI PHÍA TRANG (main thread)
 * ============================================================================
 * Nạp file này ở cuối userscript (hoặc content script). Nó:
 *   1. tạo Web Worker từ `worker.js` + `engine.mjs` (bundle thành Blob),
 *   2. đưa cấu hình (token, apiBase, mainCap) sang,
 *   3. nhận log/tick/done và đẩy vào `logLine()` / TỔNG HỢP của panel hiện có,
 *   4. trả lời RPC khi worker cần thứ chỉ main thread có (dò global_id…).
 *
 * ĐIỂM CỐT LÕI: sau khi bật cái này, đường gửi KHÔNG còn chạy trên main thread.
 * React/MQTT của trang Pancake không còn tranh CPU với vòng lặp gửi ⇒ đồng hồ
 * không trễ ⇒ ACK không bị cắt oan (§91).
 *
 * KHÔNG đụng: script cũ, các lane cũ, extension release/. Đây là đường SONG SONG để
 * bật/tắt bằng `BOTFAKE_USE_WORKER_SEND`.
 */

/* eslint-disable no-var */
(function botfakeWorkerSendBridge() {
  'use strict';

  var NS = '__BOTFAKE_WORKER_SEND__';
  if (window[NS]) return;

  var CFG = {
    enabled: false,      // bật bằng tay hoặc bằng localStorage
    mainCap: 96,
    apiBase: '',
    accessToken: '',
    version: 'worker-send-1',
  };

  var worker = null;
  var objUrl = null;
  var rpcHandlers = {};
  var stats = { n: 0, ok: 0, fail: 0, uncertain: 0, dupBlocked: 0, holdAvg: 0, rate: 0, peaks: {} };
  var listeners = { log: [], tick: [], done: [], error: [] };
  var seq = 0;
  var lastDone = null;

  function emit(ev, payload) {
    var arr = listeners[ev] || [];
    for (var i = 0; i < arr.length; i++) {
      try { arr[i](payload); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Lấy mã nguồn 2 file (engine + worker) để dựng Blob.
   * Trong userscript, `__BOTFAKE_WS_SRC__` được build nạp sẵn; nếu không có thì
   * người dùng phải gọi `setSources()` trước (xem README).
   */
  var SRC = { engine: '', worker: '' };

  function setSources(engineSrc, workerSrc) {
    SRC.engine = String(engineSrc || '');
    SRC.worker = String(workerSrc || '');
  }

  /**
   * Ghép engine.mjs + worker.js thành MỘT đoạn script classic để chạy trong Worker.
   *
   * Vì sao không dùng `new Worker(url, {type:'module'})` trực tiếp trên file .mjs:
   * trang Pancake chạy code này từ content script `world: MAIN`, mà content script
   * chỉ có URL của chính nó — không có đường dẫn tới engine.mjs. Blob là cách duy nhất
   * không phải sửa manifest. Đổi lại phải tự làm 3 việc, và cả 3 đều dễ sai câm:
   *   1. bỏ `import ... from './engine.mjs'`          → engine nằm ngay trong blob
   *   2. bỏ `export ...` ở CẢ HAI file                → script classic không có export
   *   3. bọc trong hàm **async**                       → worker.js có `await` bên trong
   *      (không phải top-level await nữa, nhưng vẫn cần async để await hoạt động)
   *
   * Đã kiểm bằng `node --check`: bản trước thiếu (2) và (3) ⇒ blob là SyntaxError,
   * Worker chết ngay khi tạo và biểu hiện ra ngoài chỉ là "không có log gì".
   */
  function buildWorkerCode(engineSrc, workerSrc) {
    var workerBody = String(workerSrc)
      .replace(/import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/engine\.mjs['"]\s*;?/m, '');
    var joined = String(engineSrc) + '\n' + workerBody;
    /* Strip export ở CẢ HAI (engine + worker), sau khi đã ghép. */
    joined = joined
      .replace(/^export\s+default\s+/gm, 'var __default__ = ')
      .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
      .replace(/^export\s+/gm, '');
    return '(async function () {\n"use strict";\n' + joined + '\n})();';
  }

  function buildBlobUrl() {
    if (!SRC.engine || !SRC.worker) throw new Error('worker-send: chưa có mã nguồn (gọi setSources)');
    var code = buildWorkerCode(SRC.engine, SRC.worker);
    /* Lưới an toàn: nếu còn sót export/import thì báo NGAY, thay vì để Worker chết câm. */
    if (/^\s*(export|import)\s/m.test(code)) {
      throw new Error('worker-send: bundle còn export/import — worker sẽ không chạy');
    }
    var blob = new Blob([code], { type: 'text/javascript' });
    return URL.createObjectURL(blob);
  }

  function spawn() {
    if (worker) return worker;
    objUrl = buildBlobUrl();
    worker = new Worker(objUrl, { type: 'classic', name: 'botfake-worker-send' });
    worker.onmessage = onMessage;
    worker.onerror = function (e) {
      emit('error', { message: (e && e.message) || 'worker error' });
    };
    return worker;
  }

  function onMessage(ev) {
    var m = ev && ev.data;
    if (!m || !m.t) return;
    if (m.t === 'log') { emit('log', m.rec); return; }
    if (m.t === 'tick') { if (m.stats) stats = Object.assign(stats, m.stats); emit('tick', m); return; }
    if (m.t === 'done') { if (m.stats) stats = Object.assign(stats, m.stats); lastDone = m; emit('done', m); return; }
    if (m.t === 'error') { emit('error', m); return; }
    if (m.t === 'ready') { emit('tick', { t: 'ready', mainCap: m.mainCap }); return; }
    if (m.t === 'rpc') { handleRpc(m); return; }
  }

  /**
   * RPC: worker cần main thread làm hộ.
   * Hiện hỗ trợ:
   *   'gid'   → dò global_id cho 1 chat (gọi hàm sẵn có của script cũ nếu có)
   *   'token' → trả access_token hiện tại
   */
  function handleRpc(m) {
    var id = m.id;
    var reply = function (ok, data, error) {
      try { worker.postMessage({ t: 'rpc-result', id: id, ok: !!ok, data: data, error: error }); } catch (e) { /* ignore */ }
    };
    var fn = rpcHandlers[m.what];
    if (!fn) { reply(false, null, 'không có handler: ' + m.what); return; }
    Promise.resolve()
      .then(function () { return fn(m.args || {}); })
      .then(function (r) { reply(true, r); })
      .catch(function (e) { reply(false, null, String(e && e.message || e)); });
  }

  var API = {
    setConfig: function (patch) { Object.assign(CFG, patch || {}); return CFG; },
    getConfig: function () { return Object.assign({}, CFG); },
    setSources: setSources,
    onRpc: function (what, fn) { rpcHandlers[what] = fn; },
    on: function (ev, fn) { if (listeners[ev]) listeners[ev].push(fn); },
    stats: function () { return Object.assign({}, stats); },
    isRunning: function () { return !!CFG.running; },
    start: function () {
      spawn();
      CFG.running = true;
      worker.postMessage({ t: 'init', cfg: { mainCap: CFG.mainCap, apiBase: CFG.apiBase, accessToken: CFG.accessToken } });
      return true;
    },
    stop: function () {
      CFG.running = false;
      if (worker) { try { worker.postMessage({ t: 'stop' }); } catch (e) { /* ignore */ } }
      return true;
    },
    send: function (list, limit) {
      if (!worker) API.start();
      var payload = (list || []).map(function (c) {
        return {
          id: String(c.id || ''),
          pageId: c.pageId || String(c.id || '').split('_')[0],
          name: c.name || '',
          text: c.text || CFG.text || '',
          photos: c.photos || c.photo || null,
          isRecordCtx7Days: !!c.isRecordCtx7Days,
        };
      });
      worker.postMessage({ t: 'send', list: payload, limit: limit || CFG.mainCap });
      seq++;
      return seq;
    },

    /**
     * TẢI DANH SÁCH rồi GỬI — một lệnh, dùng được ngay.
     * Cần `loadlist.js` đã nạp (nó đọc Redux/token của trang, thứ worker không có).
     *   opts = { text, maxPages, count, pageIds, singlePageId, dryRun, limit }
     * Trả { ok, sent, items, error }
     */
    run: async function (opts) {
      opts = opts || {};
      var LL = window.__BOTFAKE_WS_LOADLIST__;
      if (!LL) return { ok: false, error: 'Chưa nạp loadlist.js' };
      if (opts.text) CFG.text = opts.text;

      var token = LL.getToken(opts.accessToken);
      if (!token) return { ok: false, error: 'Không có access_token — tải lại trang Pancake' };
      CFG.accessToken = token;
      if (!CFG.apiBase) CFG.apiBase = LL.apiBase();

      emit('log', { kind: 'info', msg: 'Đang tải danh sách chat…' });
      var got = await LL.load({
        maxPages: opts.maxPages || 200,
        count: opts.count,
        pageIds: opts.pageIds,
        singlePageId: opts.singlePageId,
        accessToken: token,
        onProgress: function (n) { emit('tick', { t: 'loading', items: n }); },
      });
      /* `ok:false` khi có page lỗi. Nếu ĐÃ tải được phần nào thì vẫn đi tiếp nhưng
       * BÁO RÕ — không im lặng gửi thiếu, cũng không vứt công đã tải. */
      if (!got.ok && !(got.items && got.items.length)) {
        return { ok: false, items: 0, sent: 0, error: (got.errors && got.errors[0]) || got.error || 'tải danh sách thất bại' };
      }
      if (!got.ok) {
        emit('log', { kind: 'noack', msg: 'Tải THIẾU: ' + (got.errors || []).join(' · ') + ' — vẫn đi tiếp với ' + got.items.length + ' chat' });
      }

      /* Gắn is_record_ctx_7_days Ở MAIN THREAD (cần Redux) — worker không tự tính được. */
      var list = LL.decorate(got.items);
      var withCtx = list.filter(function (x) { return x.isRecordCtx7Days; }).length;
      emit('log', {
        kind: 'info',
        msg: 'Danh sách ' + list.length + ' chat'
          + (got.incomplete ? ' (CHƯA HẾT — còn next_cursor)' : ' (đã hết)')
          + ' · ctx7 bật ' + withCtx,
      });
      if (opts.dryRun) return { ok: true, sent: 0, items: list.length, withCtx: withCtx, incomplete: !!got.incomplete };

      API.start();
      API.send(list, opts.limit);
      return {
        ok: true,
        sent: list.length,
        items: list.length,
        withCtx: withCtx,
        incomplete: !!got.incomplete,
      };
    },

    /** Kết quả chi tiết: chat nào OK, chat nào chưa rõ. Luôn là MẢNG. */
    results: function () {
      return (lastDone && Array.isArray(lastDone.results)) ? lastDone.results : [];
    },
    terminate: function () {
      if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
      if (objUrl) { try { URL.revokeObjectURL(objUrl); } catch (e) { /* ignore */ } objUrl = null; }
    },
  };

  try { window[NS] = API; } catch (e) { /* ignore */ }
})();
