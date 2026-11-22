// ==UserScript==
// @name         BOTFAKE LITE (Wave 200 · Tab + Clipboard)
// @namespace    salescript
// @version      1.93.13-w200.124
// @description  BOTFAKE — nền v1.91.72 Tab + Clipboard, điều phối Wave 200 cục bộ trong tab Pancake (4 làn chính + 2 làn bù song song).
// @author       SALESCRIPT
// @match        https://pancake.vn/*
// @match        https://pages.fm/*
// @match        https://pancake.ph/*
// @match        https://pancake.id/*
// @match        https://pancake.in/*
// @match        https://pancake.biz/*
// @match        https://socialos.vip/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * NGUỒN THAM CHIẾU TRONG REPO (xem README.md):
 * - html.txt / html2.txt / html3.txt / "html comment list":
 *     + Danh sách đoạn chat: div#conversationList → div.rc-virtual-list-holder-inner
 *       → <div id="{pageId}_{conversationId}">            (id = conversation.id theo API)
 *         → <div id="{pageId}_{conversationId}__{n}" class="media conversation-list-item">
 *            .name-text   = tên khách
 *            .time-modul  = giờ
 *            .snippet-text = snippet (dòng tin nhắn cuối, hiển thị cắt ngắn có "...")
 *     + Chat đang chọn có class "conversation-list-item selected".
 *     + Ô soạn tin: <textarea id="replyBoxComposer"> (không dùng — gửi qua API cho nhanh/ổn định).
 * - pancake.vn2.har:
 *     + access_token (JWT) được gửi trong query string của mọi request /api/v1/...
 * - _app-9331d46f21a84eb1.v6.js (logic gửi tin của website):
 *     + getHostname()            → https://pancake.vn/api  (apiBase = origin + "/api")
 *     + executeByApi/buildRequestBody/objectToFormData:
 *       POST {apiBase}/v1/pages/{page_id}/conversations/{encodeURIComponent(conversation.id)}/messages?access_token=...
 *       body (multipart/form-data): action=reply_inbox, message=<nội dung>
 *       → response JSON: { success: true, id } hoặc { success: false, message, message_code }
 *     + GET {apiBase}/v1/users/get_auth/?access_token=...  (dùng để kiểm tra token còn hạn)
 */

(function () {
  'use strict';

  /* Chống chạy hai bản trong cùng một tab (bản gốc + bản ổn định, hoặc extension + userscript).
   * Cờ trên window chỉ nhìn thấy nhau khi cả hai chạy chung "page world" — đúng với @grant none.
   * Thêm dấu trên <html data-botfake-active> làm lưới thứ hai: DOM thì luôn dùng chung, kể cả khi
   * trình quản lý script chạy mỗi script trong một sandbox riêng. Ai chạy trước thì thắng. */
  function botfakeClaimSlot(name) {
    let el = null;
    try { el = document.documentElement; } catch (e) { el = null; }
    if (!el) return true;                 // chưa có <html> ⇒ để cờ window quyết, không chặn oan
    try {
      if (el.getAttribute('data-botfake-active')) return false; // bản khác đã chiếm chỗ
      el.setAttribute('data-botfake-active', name);
      return true;
    } catch (e) { return true; }
  }

  if (window.__BOTFAKE_TAB_CLIPBOARD_ACTIVE__ || !botfakeClaimSlot('lite')) return;
  window.__BOTFAKE_TAB_CLIPBOARD_ACTIVE__ = true;

  /* ============================ HẰNG SỐ ============================ */

  const PANEL_ID = 'ssb-root';          // ssb = SaleScript Bulk — không đụng pk-*/adj-*/pancake-* của script khác
  const APP_VERSION = '1.93.13-W200.124'; // hiện ở tiêu đề panel — đối chiếu với @version trong header
  const STYLE_ID = 'ssb-style';

  const MAX_NAME_LIST = 12;             // số tên hiển thị khi xác nhận

  /* ---- KHOÁ localStorage (BẮT BUỘC khai báo TRƯỚC khi state được nạp) ----
   * Lỗi đã sửa (mất câu sau F5) #1: `state.savedLists = loadSavedLists()` chạy khi `const SL_KEY`
   * còn ở "temporal dead zone" → ReferenceError bị catch nuốt → F5 luôn nạp ra danh sách RỖNG.
   * Lỗi #2 (nặng hơn): 1 câu 5.000 chat ≈ 3,8 MB, localStorage chỉ ~5 MB/origin → lưu 2 câu là
   * QuotaExceededError, lỗi bị nuốt → mở tab mới thấy trống. Nay TOÀN BỘ câu nằm trong
   * IndexedDB (xem khối "KHO CÂU GỬI (IndexedDB)"), các khoá dưới đây chỉ còn dùng để
   * CHUYỂN dữ liệu cũ sang kho mới. */
  const SL_KEY = 'ssb_saved_lists';
  const SL_BAK = SL_KEY + '_bak';      // bản dự phòng câu — chống mất dữ liệu
  // NHIỀU slot dự phòng (xoay vòng): một lần ghi hỏng/ghi đè không thể xoá sạch mọi bản tốt.
  // Slot 1 = bản gần nhất trước lần ghi hiện tại; slot 2, 3 = các bản cũ hơn.
  const SL_BAK_SLOTS = [SL_BAK, SL_BAK + '2', SL_BAK + '3'];
  // Slot GIỮ BẢN LỚN NHẤT: chỉ bị thay khi có bản nhiều chat hơn → bộ 9 câu / 1.662 chat
  // không thể bị vài lần ghi nhỏ sau đó đẩy khỏi 3 slot xoay vòng.
  const SL_KEEP = SL_KEY + '_keep';
  // DẤU "NGƯỜI DÙNG CỐ Ý XOÁ HẾT": danh sách rỗng do CHÍNH NGƯỜI DÙNG xoá (nút ✕ / 🗑 / gửi xong
  // tự xoá) KHÁC với "dữ liệu bị mất". Không có dấu này thì mỗi lần xoá hết rồi F5, bộ tự khôi
  // phục lại tưởng là mất dữ liệu và lôi câu cũ từ bản dự phòng về (gửi lại = gửi trùng!).
  const SL_CLEARED = SL_KEY + '_cleared';
  const LOG_KEY = 'ssb_log';           // nhật ký gửi — giữ qua F5
  const UI_KEY = 'ssb_ui_state';       // tick câu + ô nội dung đang gõ — giữ qua F5
  const LAST_SENT_KEY = 'ssb_last_sent_v1'; // ảnh chụp lượt gửi gần nhất — "↺ Chọn lại list vừa gửi"
  const MSG_MODE_KEY = 'ssb_msg_source_mode'; // 'ui' (câu trên giao diện) | 'clipboard' (dữ liệu đang copy trên clipboard)

  /* ============================ TRẠNG THÁI ============================ */

  const state = {
    enabled: true,          // BẬT/TẮT tính năng (lắng nghe click, highlight)
    mode: null,             // 'snippet' (chọn theo snippet) | 'range' (chọn chuỗi 2 đầu) | null
    target: null,           // { id, name, snippet, time } — snippet người dùng đã chọn (mode snippet)
    rangeStart: null,       // đầu chuỗi (mode range — Alt+Click lần 1)
    rangeEnd: null,         // cuối chuỗi (mode range — Alt+Click lần 2)
    keepListOnSelect: true, // [v1.92.43e] không cho app tự cuộn danh sách khi Alt/Ctrl chọn chuỗi
    lastSelectAt: 0,        // [v1.92.43e] mốc lựa chọn vừa đổi (chỉ ghim cuộn ~700ms sau đó)
    allRows: null,          // Map id → dòng (+ order trên→dưới) từ "Quét toàn bộ danh sách"
    scanning: false,        // đang tải danh sách
    scanStopRequested: false, // bấm nút Tải lần nữa để dừng & dùng ngay số chat đã tải
    matches: [],            // danh sách đoạn chat sẽ gửi [{ id, name, snippet, time, checked, mark, ... }]
    listKey: '',            // key dựng panel list — tránh build lại HTML khi không đổi
    sending: false,
    stopRequested: false,
    confirmingSend: false,  // đang mở hộp xác nhận gửi / đọc clipboard — chặn bấm đúp Tab/Chạy
    // Công tắc phím Tab: mặc định BẬT (giữ đúng hành vi từ trước tới nay). Tắt bằng nút "TAB:"
    // trên tiêu đề panel — nhớ qua localStorage nên F5 vẫn giữ lựa chọn.
    tabSend: (() => { try { return localStorage.getItem('ssb_tab_send_on') !== '0'; } catch (e) { return true; } })(),
    sendListFrozen: false,  // snapshot người nhận; bỏ checkbox UI trong suốt lượt chạy
    msgSource: 'ui',        // 'ui' (gửi bằng câu trên giao diện) | 'clipboard' (gửi bằng dữ liệu đang copy trên clipboard)
    lastCopiedText: '',     // bản sao lưu text vừa copy trên trang (dự phòng khi trình duyệt chặn clipboard API)
    lastAltClickId: null,      // id đoạn vừa Alt+click lần 1 (để phát hiện click cùng đoạn 2 lần)
    lastAltClickTime: 0,         // thời gian Alt+click lần 1
    sentIds: new Set(),          // id chat đã gửi thành công — giữ qua lượt để "▶ Charging tiếp" không gửi lại
    pickMode: false,
    deselectMode: false,      // click nút rồi click 1 dòng Pancake để bỏ tick đúng chat đó
    log: [],
    savedLists: [],         // các list đã lưu [{id,name,items:[{id,pageId,name,snippet,snippetRaw,time,type,platform}]}]
    listSel: new Set(),     // id các list ĐANG TÍCH — gộp thành lựa chọn để gửi (gửi được nhiều list cùng lúc)
    loadedName: null,       // tên hiển thị (1 list hoặc "N list: …") — hiện ở mục 1
    imgPick: false,         // đang bật chế độ CHỌN ẢNH TRÊN TRANG (chờ click vào 1 ảnh trên giao diện)
    listIncomplete: false,  // danh sách tải CHƯA đầy đủ → CHẶN GỬI (tải sai là gửi sai)
    quickReply: null,       // câu nhanh Pancake bắt bằng Alt+Q { shortcut, text, pageId, items:[{id,url,w,h}], parts:[{text,items}] }
    qrCapture: false,       // đang bật chế độ BẮT CÂU bằng Alt+Q (chờ click vào popup "/" của app)
    listsLoaded: false,       // đã nạp xong danh sách câu từ IndexedDB chưa (để UI không báo "trống" oan)
    lastSent: null,         // ẢNH CHỤP lượt gửi gần nhất { at, typedText, items:[chat…], lists:[{id,name,text}] }
                            // để nút "↺ Chọn lại list vừa gửi" chọn lại y nguyên mà KHÔNG phải tải danh sách
  };

  /* [v1.92.21] ĐÃ XOÁ HẲN CƠ CHẾ "NHỚ CHAT LỖI" — kể cả hai hàm stub (v1.92.22 xoá nốt).
   * Trước đây mỗi ID bị Socket xác nhận rejected được ghi thành một khoá localStorage, lượt
   * sau tự bỏ tick những ID đó (lô 20:28 ghi thêm 2 047 ID, phải có nút dọn tay). Nay:
   *   • KHÔNG lưu gì vào localStorage, KHÔNG lọc gì khi tải/chọn danh sách;
   *   • danh sách bạn tick là ĐÚNG những chat sẽ được gửi — không có "danh sách đen" ngầm;
   *   • khoá cũ của bản trước (nếu còn) chỉ là rác, script không đọc nữa.
   * Không còn hàm ghi nhớ/đọc nhớ nào — mọi chỗ từng gọi đã bị xoá cùng. */

  try {
    const savedMode = localStorage.getItem(MSG_MODE_KEY);
    if (savedMode === 'clipboard' || savedMode === 'ui') state.msgSource = savedMode;
  } catch (e) { /* ignore */ }
  // Danh sách câu nạp BẤT ĐỒNG BỘ từ IndexedDB (xem loadListsFromStore) — lúc khởi động là rỗng,
  // nạp xong sẽ vẽ lại panel. Xem chú thích "KHO CÂU GỬI (IndexedDB)" để biết vì sao không
  // dùng localStorage nữa (1 câu 5.000 chat ≈ 3,8 MB > quota ~5 MB).
  state.savedLists = [];
  // Khôi phục danh sách chat đã gửi (sentIds) từ localStorage — F5 không mất tiến độ gửi
  try {
    const _ids = JSON.parse(localStorage.getItem('SSB_SENT_IDS') || 'null');
    if (Array.isArray(_ids)) _ids.forEach((id) => state.sentIds.add(id));
  } catch (e) { /* ignore */ }

  let capturedToken = null; // token lấy từ request thật của trang (fetch/XHR hook)

  /* ============================ TIỆN ÍCH ============================ */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const norm = (s) => (s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  /* ═══ [v1.92.22] ĐỒNG HỒ CHẠY NỀN — timer trong Web Worker ═════════════════════
   * Sự thật của Chrome (không phải phỏng đoán):
   *   • Tab ẩn  ⇒ setTimeout/setInterval bị bóp còn ~1 lần/GIÂY.
   *   • Ẩn > 5 phút + chuỗi timer ≥ 5 lần + im lặng ⇒ còn 1 lần/PHÚT.
   *   • WebSocket KHÔNG được miễn (chỉ tab phát âm thanh thật và WebRTC được miễn).
   * Hệ quả với script này khi thu nhỏ cửa sổ: nhịp phát Socket 4 ms → ~1 000 ms (250 tin/s
   * mỗi page tụt còn ~1 tin/s), nextFrame 34 ms → ~1 000 ms MỖI TIN, cổng wave 60 ms →
   * ~1 000 ms mỗi wave, đồng hồ soát tin nền 5 s → 60 s.
   * Timer trong Worker KHÔNG bị bóp ⇒ tab ẩn thì mọi chỗ chờ đi qua Worker; tab hiện thì vẫn
   * dùng setTimeout gốc (chính xác nhất, không tốn thêm IPC). Worker chỉ báo "đã tới giờ",
   * KHÔNG gửi, KHÔNG quyết định gì ⇒ không thể tạo tin trùng.
   */
  const bgClock = (() => {
    let worker = null;
    let blocked = false;        // CSP chặn Blob worker ⇒ quay về setTimeout
    let seq = 0;
    const pending = new Map();
    const st = { waitHidden: 0, waitVisible: 0, clampHits: 0, lateHits: 0, extraMs: 0, maxExtraMs: 0, warned: false };
    const hidden = () => { try { return !!document.hidden; } catch (e) { return false; } };
    function boot() {
      if (worker || blocked) return worker;
      try {
        const src = 'onmessage=function(e){var d=e.data||{};setTimeout(function(){postMessage(d.i)},d.ms>0?d.ms:0)}';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        worker = new Worker(url);
        worker.onmessage = (e) => {
          const fn = pending.get(e.data);
          if (!fn) return;
          pending.delete(e.data);
          try { fn(); } catch (e0) { /* ignore */ }
        };
        worker.onerror = () => {
          blocked = true;
          const w = worker;
          worker = null;
          try { w.terminate(); } catch (e0) { /* ignore */ }
          const rest = Array.from(pending.values());
          pending.clear();
          rest.forEach((fn) => { try { fn(); } catch (e1) { /* ignore */ } });
        };
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e0) { /* ignore */ } }, 2000);
      } catch (e) { blocked = true; worker = null; }
      return worker;
    }
    /** Chờ ms. Tab ẩn ⇒ Worker (không bị bóp). Tab hiện ⇒ setTimeout gốc. */
    function wait(ms) {
      const d = Math.max(0, Math.round(Number(ms) || 0));
      if (!d) return Promise.resolve();
      const hide = hidden();
      if (hide) st.waitHidden++; else st.waitVisible++;
      return new Promise((resolve) => {
        const t0 = Date.now();
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          const real = Date.now() - t0;
          const extra = Math.max(0, real - d);
          if (hide && extra > 60) {
            st.extraMs += extra;
            if (extra > st.maxExtraMs) st.maxExtraMs = extra;
            if (d < 900 && real >= 900) st.clampHits++; else if (extra > 400) st.lateHits++;
            if (!worker && !st.warned) {
              st.warned = true;
              logLine('⚠ Tab ẩn bị Chrome bóp đồng hồ (xin ' + d + ' ms → thực ' + real
                + ' ms) mà máy chặn Web Worker — giữ cửa sổ Pancake phía trước để chạy hết tốc.');
            }
          }
          resolve();
        };
        if (!hide) { setTimeout(done, d); return; }
        const w = boot();
        if (!w) { setTimeout(done, d); return; }
        const id = ++seq;
        pending.set(id, done);
        try { w.postMessage({ i: id, ms: d }); } catch (e) { pending.delete(id); setTimeout(done, d); }
      });
    }
    /** Hẹn 1 lần, trả hàm huỷ (thay setTimeout ở đường gửi). */
    function after(ms, fn) {
      let cancelled = false;
      wait(ms).then(() => { if (!cancelled) { try { fn(); } catch (e) { /* ignore */ } } });
      return () => { cancelled = true; };
    }
    /** Lặp mỗi ms (thay setInterval ở đường gửi). Trả hàm dừng. */
    function every(ms, fn) {
      let stopped = false;
      const tick = () => {
        if (stopped) return;
        try { fn(); } catch (e) { /* ignore */ }
        if (stopped) return;
        wait(ms).then(tick);
      };
      wait(ms).then(tick);
      return () => { stopped = true; };
    }
    function reset() {
      st.waitHidden = 0; st.waitVisible = 0; st.clampHits = 0; st.lateHits = 0;
      st.extraMs = 0; st.maxExtraMs = 0; st.warned = false;
    }
    function describe() {
      const total = st.waitHidden + st.waitVisible;
      const hidPct = total ? Math.round((st.waitHidden * 100) / total) : 0;
      const clock = worker ? 'Worker ✓ (không bị bóp)'
        : (blocked ? 'setTimeout (máy chặn Worker)' : 'setTimeout (chưa cần Worker)');
      return 'đồng hồ ' + clock + ' · tab ẩn ' + hidPct + '% số lần chờ'
        + ' · bị bóp ' + st.clampHits + ' lần' + (st.lateHits ? ' + trễ ' + st.lateHits + ' lần' : '')
        + (st.extraMs ? ' · cộng thêm ' + (Math.round(st.extraMs / 100) / 10) + 's'
          + ' (nặng nhất ' + (Math.round(st.maxExtraMs / 100) / 10) + 's)' : ' · không trễ thêm');
    }
    return { wait, after, every, reset, describe };
  })();
  const sleep = (ms) => bgClock.wait(ms);

  // ═══ [v1.92.9] CHỜ MỀM — thức ngay khi điều kiện đạt, không quét theo nhịp cố định ═══
  // Bối cảnh: bản cũ có 30 chỗ sleep() cố định. Phần lớn là "quét cho tới khi điều kiện đúng"
  // (chờ lệnh thăm dò Ext xong, chờ lane rảnh, chờ quét danh sách dừng, chờ hết cơn 429…).
  // Những chỗ đó thức sớm hơn mức cần thiết hoặc trễ hơn mức cần thiết tuỳ nhịp quét.
  // Nay: sự kiện phát bằng softNotify(key) — người chờ được đánh thức NGAY trong cùng tick.
  // Đồng hồ chỉ còn là LƯỚI AN TOÀN, không còn là cơ chế chính.
  const softWaiters = new Map();
  function softNotify(key) {
    const set = softWaiters.get(key);
    if (!set || !set.size) return;
    const arr = Array.from(set);
    for (let i = 0; i < arr.length; i++) { try { arr[i](); } catch (e) { /* ignore */ } }
  }
  function softWait(key) {
    let drop = null;
    const p = new Promise((resolve) => {
      let set = softWaiters.get(key);
      if (!set) { set = new Set(); softWaiters.set(key, set); }
      const fn = () => { try { set.delete(fn); } catch (e) { /* ignore */ } resolve(); };
      drop = () => { try { set.delete(fn); } catch (e) { /* ignore */ } };
      set.add(fn);
    });
    p.cancel = () => { try { if (drop) drop(); } catch (e) { /* ignore */ } };
    return p;
  }
  // Tín hiệu Dừng dùng chung: MỘT promise duy nhất (không tích rác trong Set khi sleep liên tục).
  let stopSig = null;
  function stopSignal() {
    if (!stopSig) {
      const box = {};
      box.promise = new Promise((res) => { box.resolve = res; });
      stopSig = box;
    }
    return stopSig.promise;
  }
  function fireStopSignal() { try { if (!stopSig) stopSignal(); if (stopSig && stopSig.resolve) stopSig.resolve(); } catch (e) { /* ignore */ } }
  function resetStopSignal() { stopSig = null; }
  /** Ngủ CHÍNH XÁC tới mốc ts; thức ngay nếu softNotify(key) hoặc bấm Dừng. */
  async function sleepUntil(ts, key) {
    const ms = Math.max(0, ts - Date.now());
    if (!ms) return;
    const waits = [bgClock.wait(ms), stopSignal()];
    const w = key ? softWait(key) : null;
    if (w) waits.push(w);
    await Promise.race(waits);
    if (w) w.cancel();
  }
  /** Chờ tới khi cond() đúng. Thức bằng SỰ KIỆN key; 250 ms chỉ là lưới an toàn cuối. */
  async function waitCond(cond, key, capMs) {
    const until = Date.now() + (capMs || 30000);
    while (!state.stopRequested) {
      if (cond()) return true;
      const now = Date.now();
      if (now >= until) return !!cond();
      await sleepUntil(Math.min(until, now + 250), key);
    }
    return !!cond();
  }
  /* ═══ [v1.92.25] LỆCH ĐỒNG HỒ MÁY ↔ SERVER ═══════════════════════════════════════
   * Mọi mốc so sánh lịch sử đều trộn HAI đồng hồ: publishedAt / Date.now() là đồng hồ MÁY,
   * còn inserted_at của API là đồng hồ SERVER. Đo trên 2 283 response trong repo: header
   * "Date" có mặt ở 2 283/2 368 response, và lệch đo được lên tới hàng chục giây ở những máy
   * chỉnh giờ sai. Vì vậy phải ĐO lệch này chứ không được giả định bằng 0.
   * Đo bằng header "Date" của chính các response Pancake (sai số ≈ nửa RTT, đủ tốt cho
   * cửa sổ ±5 s). Không đo được ⇒ giữ 0 (hành vi như cũ).
   */
  let serverSkewMs = 0;
  let serverSkewSamples = 0;
  function noteServerClock(headers) {
    try {
      if (!headers || typeof headers.get !== 'function') return;
      const d = headers.get('date');
      if (!d) return;
      const srv = Date.parse(d);
      if (isNaN(srv)) return;
      const skew = srv - Date.now();
      // [v1.92.27] CHẶN MẪU RÁC: HAR có response lệch −351 388 961 ms (giờ hệ thống hỏng /
      // entry tổng hợp). Một mẫu rác lọt vào EMA sẽ kéo minTime lệch hàng phút ⇒ chốt ✅ oan.
      if (!isFinite(skew) || Math.abs(skew) > 120000) return;
      serverSkewSamples++;
      serverSkewMs = serverSkewSamples === 1 ? skew : Math.round(serverSkewMs * 0.8 + skew * 0.2);
    } catch (e) { /* ignore */ }
  }

  /** [v1.92.9] Tôn trọng Retry-After của server khi có; không có thì dùng mức cũ. */
  function retryAfterMs(res, fallbackMs) {
    try {
      const v = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
      if (v) {
        const sec = Number(v);
        if (isFinite(sec) && sec >= 0) return Math.min(15000, Math.max(100, Math.round(sec * 1000)));
        const at = Date.parse(v);
        if (!isNaN(at)) return Math.min(15000, Math.max(100, at - Date.now()));
      }
    } catch (e) { /* ignore */ }
    return Math.max(0, Number(fallbackMs) || 0);
  }
  /** [v1.92.9] Nhường ĐÚNG một khung hình (thay vì ngủ mù 20 ms). Tab ẩn thì lưới an toàn 34 ms. */
  function nextFrame() {
    // [v1.92.22] Tab ẩn: rAF KHÔNG chạy, nên bản cũ rơi vào lưới setTimeout(34) — và Chrome bóp
    // nó thành ~1 000 ms MỖI TIN (thu nhỏ cửa sổ là mỗi tin chậm thêm 1 giây). Tab ẩn thì không
    // có chu kỳ keydown/keyup nào cần chờ ⇒ trả về ngay; tab hiện vẫn nhường đúng 1 khung hình.
    try { if (document.hidden) return Promise.resolve(); } catch (e0) { /* ignore */ }
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (done) return; done = true; resolve(); };
      try { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fin); } catch (e) { bgClock.wait(34).then(fin); return; }
      bgClock.wait(34).then(fin);
    });
  }

  let sentIdsSaveTimer = null;
  function saveSentIds() {
    // Gộp ghi: markDelivered chạy mỗi tin — ghi đồng bộ cả tập id mỗi lần là O(N^2), đơ UI lô lớn
    if (sentIdsSaveTimer) return;
    sentIdsSaveTimer = setTimeout(() => {
      sentIdsSaveTimer = null;
      try { localStorage.setItem('SSB_SENT_IDS', JSON.stringify(Array.from(state.sentIds))); } catch (e) { /* ignore */ }
    }, 500);
  }

  // Chạy song song tối đa `limit` task cùng lúc (limit = items.length ⇒ "1 phát" tất cả)
  async function runPool(items, worker, limit) {
    const results = new Array(items.length);
    let next = 0;
    const n = Math.max(1, Math.min(limit || 1, items.length));
    const lanes = [];
    for (let k = 0; k < n; k++) {
      lanes.push((async () => {
        while (next < items.length && !state.stopRequested) {
          const i = next++;
          results[i] = await worker(items[i], i);
        }
      })());
    }
    await Promise.all(lanes);
    return results;
  }

  // Chrome bóp tab ẩn; tab "đang phát loa" thì ít bị ngủ. Sóng 18Hz: loa thường không
  // tái tạo thành tiếng nghe được, nhưng biên độ phải đủ lớn để Chrome ghi nhận tab
  // "đang phát âm" (hiện icon loa + miễn bóp) — gain ≈ 0 thì Chrome coi như im lặng.
  let keepAliveAudio = null;
  let keepAliveLogged = false;
  // [v1.92.22] Chrome "Energy Saver" có thể ĐÓNG BĂNG tab ẩn sau 5 phút; trang đang giữ một
  // Web Lock thì được miễn. Giữ lock suốt lượt gửi/quét (tên riêng, không chặn gì khác).
  let runLockRelease = null;
  function holdRunLock() {
    try {
      if (runLockRelease) return;
      if (!navigator || !navigator.locks || typeof navigator.locks.request !== 'function') return;
      navigator.locks.request('ssb-run-' + String((location && location.host) || 'pancake'), () => new Promise((res) => { runLockRelease = res; }))
        .catch(() => { /* trình duyệt cũ: bỏ qua */ });
    } catch (e) { /* ignore */ }
  }
  function releaseRunLock() {
    const r = runLockRelease;
    runLockRelease = null;
    try { if (r) r(); } catch (e) { /* ignore */ }
  }
  function startKeepAliveAudio() {
    holdRunLock();
    try {
      if (keepAliveAudio && keepAliveAudio.ctx && keepAliveAudio.ctx.state !== 'closed') {
        try { keepAliveAudio.ctx.resume(); } catch (e0) { /* ignore */ }
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 16;
      gain.gain.value = 0.01;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      try { ctx.resume(); } catch (e1) { /* ignore */ }
      keepAliveAudio = { ctx, osc, gain };
      setTimeout(() => {
        try {
          if (keepAliveAudio && keepAliveAudio.ctx === ctx && ctx.state !== 'running') {
            // [v1.92.22] Chính sách autoplay chỉ mở khoá ở thao tác người dùng ⇒ thử lại ngay
            // ở cú click/bấm phím kế tiếp thay vì bắt người dùng đoán.
            try {
              const wake = () => { try { ctx.resume(); } catch (e3) { /* ignore */ } };
              document.addEventListener('click', wake, { once: true, capture: true });
              document.addEventListener('keydown', wake, { once: true, capture: true });
            } catch (e4) { /* ignore */ }
            logLine('⚠ Âm giữ tab chưa chạy (trạng thái: ' + ctx.state + ') — Chrome đang chặn phát âm; bấm vào trang 1 cái rồi gửi tiếp, hoặc giữ tab Pancake ở phía trước.');
          }
        } catch (e2) { /* ignore */ }
      }, 400);
      if (!keepAliveLogged) {
        keepAliveLogged = true;
        logLine('🔇 Giữ tab tỉnh (âm thanh câm). Tab có thể hiện icon loa — không có tiếng. Tắt khi gửi/tải xong.');
      }
    } catch (e) { /* ignore */ }
  }
  function stopKeepAliveAudio() {
    if (state.sending || state.scanning) return;
    releaseRunLock();
    const ka = keepAliveAudio;
    keepAliveAudio = null;
    if (!ka) return;
    try { ka.osc.stop(); } catch (e0) { /* ignore */ }
    try { ka.ctx.close(); } catch (e1) { /* ignore */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (!state.sending && !state.scanning) return;
    startKeepAliveAudio();
  });

  // html.txt: tên page = .icon-and-page-name span (dropdown) /
  // .page-avt-modul.activated .content-right-top .font-bold (multi).
  function getPageDisplayName() {
    try {
      const st = (typeof getReduxState === 'function' && getReduxState())
        || (window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState && window.__pancakeReduxStore__.getState());
      const pgs = (st && st.pages) || {};
      const map = pgs.activatedMap || {};
      const arr = Array.isArray(pgs.activated) ? pgs.activated : [];
      const nameOf = (id) => {
        if (id == null || id === '') return '';
        const p = map[id] || arr.find((x) => x && String(x.id) === String(id));
        return (p && p.name) ? String(p.name).replace(/\s+/g, ' ').trim() : '';
      };
      if (pgs.multiplePageMode && Array.isArray(pgs.multiplePageIds) && pgs.multiplePageIds.length) {
        const names = pgs.multiplePageIds.map(nameOf).filter(Boolean);
        if (names.length === 1) return names[0];
        if (names.length > 1) return names[0] + ' +' + (names.length - 1);
      }
      const n = nameOf(pgs.currentPageId);
      if (n) return n;
    } catch (e) { /* ignore */ }
    try {
      const act = document.querySelector('.page-avt-modul.activated .content-right-top .font-bold');
      const t = act && String(act.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) return t;
    } catch (e2) { /* ignore */ }
    try {
      const sp = document.querySelector('.icon-and-page-name span');
      const t2 = sp && String(sp.textContent || '').replace(/\s+/g, ' ').trim();
      if (t2) return t2;
    } catch (e3) { /* ignore */ }
    return '';
  }

  let extJobAt = 0;
  function reportExtJob(extra) {
    if (!extBgAvailable()) return; // không có bridge extension → khỏi tạo listener/timer vô ích
    extra = extra || {};
    const now = Date.now();
    // PHÁT LỆNH xong ≠ XONG lượt: còn tin chờ xác nhận/bù thì overlay vẫn phải hiện.
    // Chỉ ẩn khi đã chốt xong thật (pending = 0) hoặc user bấm Dừng — chốt idle cuối
    // do markSendIdleIfSettled() đảm nhiệm.
    if (typeof batchStats !== 'undefined' && batchStats.loopFinished && extra.phase === 'send') {
      /* [v1.92.56] KHÔNG tính lại toàn bộ tổng hợp ở đây nữa.
       * `reportExtJob` được gọi từ `flushProgressUi` (250 ms/lần) — mà `flushBatchSummaryUI`
       * vừa gọi `getBatchSummaryCounts()` NGAY TRƯỚC ĐÓ rồi truyền số xuống qua `setProgress`.
       * Gọi lại ở đây là làm 2 lần cùng một phép tính, và trước 1.92.56 phép tính đó là O(k)
       * trên cả 3 sổ kiểm chứng ⇒ nhân đôi phần đắt nhất.
       * Nay dùng số `pending` mà người gọi đã có (truyền qua `extra.pending`), chỉ tính lại
       * khi THỰC SỰ chưa có ai tính. */
      let pend = (typeof extra.pending === 'number') ? extra.pending : 1;
      if (typeof extra.pending !== 'number') {
        try { pend = getBatchSummaryCounts().pending; } catch (e) { pend = 0; }
      }
      if (pend <= 0 || state.stopRequested) extra.phase = 'idle';
    }
    const idle = extra.phase === 'idle' || (!state.sending && !state.scanning && extra.phase !== 'scan');
    // Background worker broadcast mỗi update tới các tab Chrome; 1 lần/giây đủ mượt cho overlay,
    // tránh tabs.query + storage.set + tabs.sendMessage dồn 5 lần/giây trong suốt lượt gửi.
    if (!idle && now - extJobAt < 1000) return;
    extJobAt = now;
    const payload = {
      type: 'BOTFAKE_JOB',
      sending: idle ? false : !!state.sending,
      scanning: idle ? false : !!state.scanning,
      phase: idle ? 'idle' : (extra.phase || (state.sending ? 'send' : (state.scanning ? 'scan' : 'idle'))),
      pct: extra.pct != null ? extra.pct : 0,
      ok: extra.ok,
      total: extra.total,
      done: extra.done,
      pageName: getPageDisplayName(),
    };
    extCall(payload, 3000); // báo tiến độ — không cần chờ lâu
  }

  function extCall(payload, waitMs) {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage(payload, (res) => {
            resolve({ res: res, err: (chrome.runtime.lastError && chrome.runtime.lastError.message) || null });
          });
          return;
        }
      } catch (e0) { /* MAIN world: không có chrome */ }
      const id = 'bf' + Date.now() + Math.random().toString(36).slice(2, 8);
      const on = (ev) => {
        if (ev.source !== window || !ev.data || ev.data.__botfake !== 1 || ev.data.dir !== 'from_sw' || ev.data.id !== id) return;
        window.removeEventListener('message', on);
        resolve({ res: ev.data.res, err: ev.data.err || null });
      };
      window.addEventListener('message', on);
      window.postMessage({ __botfake: 1, dir: 'to_sw', id: id, payload: payload }, '*');
      setTimeout(() => {
        window.removeEventListener('message', on);
        resolve({ res: null, err: 'timeout' });
      }, waitMs || 120000);
    });
  }
  function extListen(fn) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        const wrap = (m, s, r) => fn(m, s, r);
        chrome.runtime.onMessage.addListener(wrap);
        return () => { try { chrome.runtime.onMessage.removeListener(wrap); } catch (e) { /* ignore */ } };
      }
    } catch (e1) { /* MAIN world */ }
    const on = (ev) => {
      if (ev.source !== window || !ev.data || ev.data.__botfake !== 1 || ev.data.dir !== 'push') return;
      fn(ev.data.msg, null, function () {});
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }
  function extBgAvailable() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) return true;
    } catch (e) { /* ignore */ }
    return document.documentElement.getAttribute('data-botfake-ext') === '1';
  }

  function serializeBgPhoto(photo, qrPhotoByPage, apiFbIdsByPage, fbIdByPage) {
    if (!photo) return null;
    if (photo.qr) {
      const byPage = {};
      Object.keys(qrPhotoByPage || {}).forEach((pid) => {
        const q = qrPhotoByPage[pid];
        if (!q) return;
        byPage[pid] = {
          id: q.id || '', url: q.url || '', w: q.w || 0, h: q.h || 0,
          fbId: (apiFbIdsByPage && apiFbIdsByPage[pid] && apiFbIdsByPage[pid][0]) || fbIdByPage[pid] || '',
          fbIds: (apiFbIdsByPage && apiFbIdsByPage[pid]) || [],
          items: (q.items || []).map((it) => ({ id: it.id || '', url: it.url || '', w: it.w || 0, h: it.h || 0, fbId: it.fbId || '' })),
        };
      });
      return { qr: true, shortcut: photo.shortcut || '', byPage: byPage };
    }
    return {
      id: photo.id || '', url: photo.url || '', w: photo.w || 0, h: photo.h || 0,
      fbId: photo.fbId || '', fbIds: photo.fbIds || [],
      items: (photo.items || []).map((it) => ({ id: it.id || '', url: it.url || '', w: it.w || 0, h: it.h || 0, fbId: it.fbId || '' })),
    };
  }

  // [v1.93.13] SỔ messageId extension trả về (REPLY_INBOX_PHOTO_SUCCESS có `messageId`).
  // Lượt đọc lại lịch sử đối chiếu với sổ này; chỉ ĐỌC, không gửi thêm.
  const extMsgIdByConv = Object.create(null);

  let lastBgConvById = {};
  let lastBgPhoto = null;
  let lastBgText = '';

  function runExtensionBgSend(sendGroups, pack) {
    return new Promise((resolve, reject) => {
      lastBgConvById = {};
      lastBgPhoto = pack && pack.photo ? pack.photo : null;
      lastBgText = (sendGroups[0] && sendGroups[0].text) || '';
      const targets = [];
      (sendGroups || []).forEach((g) => {
        (g.list || []).forEach((c) => {
          lastBgConvById[c.id] = c;
          targets.push({
            id: c.id,
            pageId: c.pageId || String(c.id || '').split('_')[0],
            name: c.name || '',
            type: c.type || '',
            text: g.text || '',
          });
        });
      });
      const job = {
        apiBase: apiBase(),
        token: getToken(),
        text: (sendGroups[0] && sendGroups[0].text) || '',
        photo: serializeBgPhoto(pack.photo, pack.qrPhotoByPage, pack.apiFbIdsByPage, pack.fbIdByPage),
        targets: targets,
      };
      let buLeft = 0;
      let doneMsg = null;
      let unsubBg = function () {};
      const finishIfReady = () => {
        if (!doneMsg || buLeft > 0) return;
        unsubBg();
        summaryCounters.okApi = doneMsg.okN || 0;
        summaryCounters.fail = doneMsg.fail || 0;
        if (doneMsg.stopped) { state.stopRequested = true; fireStopSignal(); }
        resolve(doneMsg);
      };
      const onMsg = (msg) => {
        if (!msg || !msg.type) return;
        if (msg.type === 'BOTFAKE_BG_LOG' && msg.line) logLine(msg.line);
        if (msg.type === 'BOTFAKE_BG_FALLBACK' && msg.item && msg.item.id) {
          const conv = lastBgConvById[msg.item.id];
          if (!conv) return;
          const nm = conv.name || conv.id;
          const tx = msg.item.text != null ? msg.item.text : lastBgText;
          buLeft++;
          Promise.resolve()
            .then(() => sendOne(conv, tx, lastBgPhoto, { skipApi: true, awaitDirect: true, quick: true }))
            .then((r) => {
              if (r && r.ok) {
                if (r.sendBy === 'socket') summaryCounters.okSocket++;
                else if (r.sendBy === 'extension' || r.sendBy === 'ext') summaryCounters.okExt++;
                logLine('✅ ' + nm + ' — bù THÀNH CÔNG qua ' + (r.sendBy === 'socket' ? 'Socket' : 'Extension'));
              } else if (r && r.recipientUnavailable) {
                summaryCounters.fail++;
                logLine('❌ ' + nm + ' — bù không được: ' + clip((r && r.error) || '', 90));
              } else if (r && r.uncertain) {
                // [v1.92.28] LỖ HỞ "BÙ LUNG TUNG": nhánh dưới (`!r.ok`) bao gồm CẢ kết quả
                // "không rõ" (socket mất ACK / Ext quá hạn) ⇒ vừa gọi scheduleBuRetry (bù qua
                // kênh khác) trong khi tin CÓ THỂ đã đi ⇒ nguy cơ gửi 2 lần. Nay "không rõ" chốt
                // ⚠ + ghi uncertainIds (để mọi đường bù khác cũng bị chặn), KHÔNG gửi thêm.
                if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain', 'bù không rõ: ' + clip((r && r.error) || '', 60));
                logLine('⚠ ' + nm + ' — bù: ' + clip((r && r.error) || 'không rõ', 90) + ' — KHÔNG gửi thêm (chống trùng)');
              } else if (r && !r.ok) {
                logLine('⚠ ' + nm + ' — bù: ' + clip((r && r.error) || 'không rõ', 90));
                scheduleBuRetry(conv, tx, lastBgPhoto, nm, 'API từ chối (' + clip(msg.error || '', 90) + ')', ['api'],
                  { ambiguous: true, via: 'api', sentAt: Date.now() });
              }
            })
            .catch((e) => { logLine('❌ ' + nm + ' — bù lỗi: ' + (e && e.message || e)); })
            .then(() => { buLeft--; finishIfReady(); });
        }
        if (msg.type === 'BOTFAKE_BG_PROGRESS') {
          summaryCounters.okApi = msg.ok || 0;
          summaryCounters.fail = msg.fail || 0;
          batchStats.total = msg.total || batchStats.total;
          setProgress(msg.done || 0, msg.total || 0, msg.ok || 0);
          try { updateBatchSummaryUI(); } catch (e0) { /* ignore */ }
        }
        if (msg.type === 'BOTFAKE_BG_DONE') {
          doneMsg = msg;
          finishIfReady();
        }
      };
      unsubBg = extListen(onMsg);
      extCall({ type: 'BOTFAKE_BG_SEND', job: job }).then((out) => {
        const res = out && out.res;
        if (out && out.err || !res || !res.ok) {
          unsubBg();
          reject(new Error((res && res.error) || (out && out.err) || 'SW không nhận job'));
        }
      });
    });
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ═══ [v1.93.13] `/rescue_mode_inbox` — ÉP PANCAKE KÉO LẠI TIN TỪ FACEBOOK ═══
   * Nguồn `0.5.62_0/assets/background.js` (`class Oc` = LISTEN_INBOX):
   *   async trigger_to_pancake(e){
   *     const { url:t, headers:a } = Ne(this.accessToken, `/v1/pages/${this.page_id}/rescue_mode_inbox`);
   *     return await Ce(t, { message_ids: e }, {}, { headers: a } ); }
   *   handle_list_messages(e,t){ const a = t.nodes.map(s => s.message_id);
   *     const r = await this.trigger_to_pancake(a);
   *     if(r.success && r.continue && t.page_info?.has_previous_page) …load_list_messages(…, before) }
   *
   * Nghĩa: ext đọc danh sách `message_id` trên **facebook.com** (graphql `MessengerGraphQLThreadFetcher`),
   * rồi gọi endpoint Pancake này để Pancake KÉO LẠI các tin đó từ FB về hội thoại.
   * ⇒ Đây là cách DUY NHẤT trong extension khiến server Pancake **cập nhật ngay** những tin
   * FB ĐÃ NHẬN mà Pancake chưa hiển thị.
   *
   * VÌ SAO SCRIPT CẦN — đo được (log 22/11 09:54, lô 8 572):
   *   • ACK rejected 3 552 ⇒ 3 547 ca ⚠ "kiểm chứng: đọc 4 lần chưa thấy tin — GIỮ ⚠"
   *   • `HTTP không có gid 56` · `can_inbox=false 0/56` — tức yêu cầu gửi ĐÃ tới Pancake
   *   • nhưng `/conversations/{id}/messages` trả KHÔNG có tin đó ⇒ script kết luận "chưa đi"
   *   Trong khi đó FB trả ACK rejected: FB nói KHÔNG nhận ⇒ hai nguồn nói khác nhau.
   *   Có những ca FB ĐÃ nhận (tin nằm trên Messenger) mà Pancake chưa kéo về ⇒ script đọc
   *   lịch sử 4 lần đều rỗng ⇒ chốt ⚠ oan (hoặc ❌ oan) ⇒ mất tin / gửi tay sai.
   *   `/rescue_mode_inbox` giải đúng ca đó.
   *
   * AN TOÀN: hàm này KHÔNG gửi tin, KHÔNG tạo tin. Nó chỉ bảo Pancake ĐỌC LẠI từ FB và
   * đồng bộ vào hội thoại ⇒ không thể sinh tin trùng. Gọi nhiều lần vô hại.
   * Chỉ gọi khi các lần đọc lịch sử đều KHÔNG thấy tin (không gọi tràn lan). */
  function rescueInboxMessages(pageId, messageIds) {
    try {
      const ids = (Array.isArray(messageIds) ? messageIds : [])
        .map((x) => String(x == null ? '' : x)).filter((x) => /^\d+$/.test(x));
      if (!ids.length) return Promise.resolve(false);
      /* `message_ids` phải là id THẬT của tin trên FB. Script chỉ biết id tin của Pancake
       * (`message_id` sau khi gửi) nên KHÔNG tự bịa id. Chỉ nhận id do nơi gọi đưa vào
       * (vd. `res.data.messageId` của REPLY_INBOX_PHOTO_SUCCESS có thể là id FB). */
      const tok = getToken() || '';
      const body = { message_ids: ids };
      const url0 = apiBase() + '/v1/pages/' + pageId + '/rescue_mode_inbox';
      return bgFetchJson(url0, 2, { method: 'POST', bodyObj: body, timeoutMs: 12000 })
        .then((r) => !!(r && (r.ok || r.success)))
        .catch(() => false);
    } catch (e) { return Promise.resolve(false); }
  }

  function apiBase() {
    // getHostname() trong _app: dev.pages.fm → https://dev.pancake.vn/api; còn lại → origin + /api
    if (location.hostname === 'dev.pages.fm') return 'https://dev.pancake.vn/api';
    return location.origin.replace(/\/$/, '') + '/api';
  }

  /* ============================ ACCESS TOKEN ============================ */

  // Trang Pancake gửi access_token trong query của mọi request /api/v1/...
  // Kẹp token từ: (1) hook fetch/XHR, (2) performance resource entries,
  // (3) __NEXT_DATA__, (4) URL ảnh trong DOM, (5) localStorage.
  function hookNetwork() {
    try {
      const origFetch = window.fetch;
      window.fetch = function (input, init) {
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          grabTokenFromUrl(url);
        } catch (e) { /* ignore */ }
        return origFetch.apply(this, arguments);
      };
    } catch (e) { /* ignore */ }
    try {
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try { grabTokenFromUrl(String(url || '')); } catch (e) { /* ignore */ }
        return origOpen.apply(this, arguments);
      };
    } catch (e) { /* ignore */ }
  }

  function grabTokenFromUrl(url) {
    const m = /access_token=([A-Za-z0-9._-]+)/.exec(url || '');
    if (!m || !m[1]) return;
    // HAR taidanhsach.har: access_token=cookie_session (không phải JWT).
    // pancake.vn2.har (multi_pages): JWT a.b.c.
    if (m[1] === 'cookie_session' || m[1].split('.').length === 3) capturedToken = m[1];
  }

  function getToken() {
    // HAR taidanhsach.har + guicau.har: access_token=cookie_session (không gửi JWT).
    if (/(^|\.)pancake\.vn$/i.test(location.hostname || '')) return 'cookie_session';
    try {
      const entries = performance.getEntriesByType('resource');
      for (let i = entries.length - 1; i >= 0; i--) {
        grabTokenFromUrl(entries[i].name);
        if (capturedToken) return capturedToken;
      }
    } catch (e) { /* ignore */ }
    if (capturedToken) return capturedToken;
    try {
      const nd = document.getElementById('__NEXT_DATA__');
      if (nd) {
        const j = JSON.parse(nd.textContent || '{}');
        const t = j && j.props && j.props.initialState && j.props.initialState.auth
          && j.props.initialState.auth.accessToken;
        if (t) { capturedToken = t; return t; }
      }
    } catch (e) { /* ignore */ }
    try {
      const img = document.querySelector('[src*="access_token="]');
      if (img) grabTokenFromUrl(img.getAttribute('src') || img.src || '');
      if (capturedToken) return capturedToken;
    } catch (e) { /* ignore */ }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k) || '';
        const m = /eyJ[A-Za-z0-9._-]{20,}/.exec(v);
        if (m && m[0].split('.').length === 3) { capturedToken = m[0]; return capturedToken; }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /* ============================ ĐỌC DANH SÁCH ĐOẠN CHAT ============================ */

  // Mỗi dòng: <div id="{pageId}_{convId}"><div [id="{pageId}_{convId}__{n}"] class="media conversation-list-item">
  // (bản render có lúc id nằm ở div ngoài, có lúc nằm ở chính .conversation-list-item)
  function rowInfo(item) {
    try {
      let rawId = (item.id || '').replace(/__\d+$/, '');
      if (!rawId) {
        const wrap = item.closest && item.closest('div[id]');
        rawId = wrap ? String(wrap.id || '').replace(/__\d+$/, '') : '';
      }
      if (!/^\d+_|^[a-z0-9]+_/i.test(rawId)) return null;
      const nameEl = item.querySelector('.name-text');
      const snipEl = item.querySelector('.snippet-text');
      const timeEl = item.querySelector('.time-modul');
      const avtEl = item.querySelector('img[src*="/avatar/"]');
      let pageId = rawId.split('_')[0];
      if (avtEl) {
        const m = /\/pages\/([^/]+)\/avatar\//.exec(avtEl.getAttribute('src') || '');
        if (m) pageId = m[1]; // page_id đúng như API dùng
      }
      // icon trong .tag-wrap: envelope = inbox, comments = bình luận bài viết
      let type = '';
      if (item.querySelector('img[src*="comments.svg"]')) type = 'comment';
      else if (item.querySelector('img[src*="envelope"]')) type = 'inbox';
      let platform = '';
      const pm = item.querySelector('[class*="platform-"]');
      if (pm) {
        const mm = /platform-([a-z0-9_-]+)/i.exec(pm.className || '');
        if (mm) platform = mm[1];
      }
      return {
        id: rawId,
        pageId,
        name: norm(nameEl && nameEl.textContent),
        snippet: norm(snipEl && snipEl.textContent),   // snippet hiển thị (đã cắt ngắn "...")
        snippetRaw: (snipEl && snipEl.textContent || '').trim(),
        time: norm(timeEl && timeEl.textContent),
        type,
        platform,
      };
    } catch (e) {
      return null;
    }
  }

  function visibleRows() {
    const out = [];
    $$('.conversation-list-item').forEach((item) => {
      const info = rowInfo(item);
      if (info) out.push(info);
    });
    return out;
  }

  function selectedRowInfo() {
    const item = $('.conversation-list-item.selected') || $('.conversation-list-item.active');
    return item ? rowInfo(item) : null;
  }

  /* ============================ CHỌN SNIPPET + KHỚP ============================ */

  /* ============================ CHỌN SNIPPET / CHỌN CHUỖI 2 ĐẦU ============================ */

  // Bổ sung đầy đủ trường API/Redux (threadId, customerId, globalId, lastAt, updatedAt, fromPsid…) cho dòng DOM
  function enrichRowWithRedux(r) {
    if (!r || !r.id) return r;
    const id = String(r.id);
    if (state.allRows && state.allRows.has(id)) {
      const ar = state.allRows.get(id);
      return {
        ...ar,
        ...r,
        pageId: ar.pageId || r.pageId,
        type: r.type || ar.type,
        order: ar.order != null ? ar.order : r.order,
      };
    }
    const c = typeof getReduxConvById === 'function' ? getReduxConvById(id) : null;
    if (c) {
      cacheGidFromConvObj(c);
      const apiRow = convApiRow(c, r.order != null ? r.order : 0);
      return {
        ...apiRow,
        ...r,
        pageId: apiRow.pageId || r.pageId,
        type: r.type || apiRow.type,
        order: r.order != null ? r.order : apiRow.order,
      };
    }
    return r;
  }

  /* ═══ [v1.92.58] ĐÂY LÀ CHỖ LÀM CÚ "GIỮ ALT CHỌN 1 CON" BỊ KHỰNG. ═══
   * Profiler (tools/_bench_click.mjs, Chromium 153) chỉ thẳng đường gọi trong khung hình của cú click:
   *   onDocClick → completeRange → computeMatches → getReduxConversationListRows → visibleRows → rowInfo → querySelector
   * Bản cũ DỰNG LẠI TOÀN BỘ danh sách MỖI LẦN gọi:
   *   • `visibleRows()` — đọc DOM từng dòng, mỗi dòng 5 `querySelector` — còn bị gọi HAI lần
   *     (một lần ở đây, một lần nữa trong `sourceRows()`),
   *   • `cacheGidFromConvObj(c)` cho TỪNG hội thoại (nối chuỗi + 3 lần ghi cache + hẹn flush),
   *   • `convApiRow(c, i)` cho TỪNG hội thoại (tạo object mới), trên cả nghìn–chục nghìn chat.
   * Tất cả nằm ĐỒNG BỘ trong sự kiện click ⇒ "giữ Alt chọn 1 con là khựng một cái".
   *
   * NAY: phần đắt (convApiRow + cache gid) CHỈ TÍNH LẠI khi mảng Redux ĐỔI (so theo tham chiếu
   * + độ dài — đúng cách `getReduxConvById` đã làm với reduxDataArrRef). Phần lớp phủ DOM
   * (visibleRows) vẫn đọc MỚI mỗi lần nhưng chỉ trên các dòng đang hiện (vài chục), và chỉ
   * nhân bản những dòng thật sự có mặt trong DOM — không đụng tới cả nghìn dòng còn lại. */
  let reduxRowsBaseRef = null, reduxRowsBaseLen = -1, reduxRowsBase = null, reduxRowsBaseIdx = null;
  function getReduxConversationListRows(preVisRows) {
    try {
      const st = typeof getReduxState === 'function' ? getReduxState() : null;
      const cs = st && st.conversations;
      if (!cs) return [];
      const raw = (cs.filterByCustomer && Array.isArray(cs.filteredConversationsCloneList) && cs.filteredConversationsCloneList.length)
        ? cs.filteredConversationsCloneList
        : (Array.isArray(cs.data) && cs.data.length
          ? cs.data
          : (Array.isArray(cs.filteredConversationsCloneList) ? cs.filteredConversationsCloneList : []));
      if (!raw.length) return [];
      if (raw !== reduxRowsBaseRef || raw.length !== reduxRowsBaseLen || !reduxRowsBase) {
        const base = [];
        const idx = new Map();
        const seen = new Set();
        for (let i = 0; i < raw.length; i++) {
          const c = raw[i];
          const id = String((c && c.id) || '');
          if (!id || seen.has(id)) continue;
          seen.add(id);
          cacheGidFromConvObj(c);
          idx.set(id, base.length);
          base.push(convApiRow(c, base.length));
        }
        reduxRowsBaseRef = raw;
        reduxRowsBaseLen = raw.length;
        reduxRowsBase = base;
        reduxRowsBaseIdx = idx;
      }
      const visRows = preVisRows || visibleRows();
      if (!visRows.length) return reduxRowsBase;
      /* Chỉ nhân bản những dòng ĐANG có trên màn hình. Không có dòng nào khớp ⇒ trả nguyên mảng
       * đã cache (0 cấp phát). */
      let out = null;
      for (let v = 0; v < visRows.length; v++) {
        const vis = visRows[v];
        const i = reduxRowsBaseIdx.get(String(vis.id));
        if (i === undefined) continue;
        if (!out) out = reduxRowsBase.slice();
        const apiRow = out[i];
        out[i] = {
          ...apiRow,
          ...vis,
          pageId: apiRow.pageId || vis.pageId,
          type: vis.type || apiRow.type,
          order: apiRow.order,
        };
      }
      return out || reduxRowsBase;
    } catch (e) {
      return [];
    }
  }

  // Nguồn dòng để khớp: ưu tiên kết quả quét toàn bộ (state.allRows), tiếp theo là danh sách trong Redux, cuối cùng là DOM
  function sourceRows() {
    if (state.allRows && state.allRows.size && !state.allRowsPartial) return Array.from(state.allRows.values());
    /* [v1.92.58] `visibleRows()` đọc DOM (5 querySelector/dòng). Bản cũ gọi nó HAI lần cho một
     * lần computeMatches: một lần trong getReduxConversationListRows, một lần ở đây. Nay đọc
     * một lần rồi truyền xuống. */
    const visRaw = visibleRows();
    const reduxRows = getReduxConversationListRows(visRaw);
    const visRows = visRaw.map(enrichRowWithRedux);
    if (state.allRows && state.allRows.size) {
      const allArr = Array.from(state.allRows.values());
      if (allArr.length >= reduxRows.length && allArr.length >= visRows.length) return allArr;
    }
    return reduxRows.length >= visRows.length ? reduxRows : visRows;
  }

  function markOf(r) {
    if (state.target && r.id === state.target.id) return 'target';
    if (state.rangeStart && r.id === state.rangeStart.id) return 'start';
    if (state.rangeEnd && r.id === state.rangeEnd.id) return 'end';
    return '';
  }

  // So khớp snippet giữa dạng hiển thị trên màn hình (bị cắt "…") và dạng đầy đủ từ API
  function sameSnippet(a, b) {
    a = String(a || '').replace(/\s+/g, ' ').trim();
    b = String(b || '').replace(/\s+/g, ' ').trim();
    if (!a || !b) return false;
    if (a === b) return true;
    const cut = /(\.{3}|…)$/;
    const aCut = cut.test(a), bCut = cut.test(b);
    const a2 = a.replace(cut, ''), b2 = b.replace(cut, '');
    if (aCut && b.startsWith(a2)) return true;
    if (bCut && a.startsWith(b2)) return true;
    return a2 === b2;
  }

  function computeMatches(opts) {
    state.lastSelectAt = Date.now();
    state.loadedName = null;
    renderSavedLists();
    const before = new Map(state.matches.map((m) => [m.id, m]));
    const list = [];
    const push = (rawRow) => {
      const r = enrichRowWithRedux(rawRow);
      const old = before.get(r.id);
      list.push({
        ...r,
        knownUnavailable: false,
        checked: old ? old.checked : (r.type !== 'comment'),
        isTarget: !!markOf(r),
        mark: markOf(r),
      });
    };
    if (state.mode === 'all') {
      sourceRows().forEach((r) => push(r));
    } else if (state.mode === 'snippet' && state.target) {
      const targetSnip = state.target.snippetRaw || state.target.snippet;
      sourceRows().forEach((r) => {
        if (sameSnippet(r.snippetRaw || r.snippet, targetSnip)) push(r);
      });
    } else if (state.mode === 'pick') {
      state.matches.forEach((m) => {
        const r = enrichRowWithRedux(m);
        list.push({
          ...r,
          knownUnavailable: false,
          checked: m.checked !== undefined ? m.checked : (r.type !== 'comment'),
          isTarget: true,
          mark: m.mark || 'target',
        });
      });
    } else if (state.mode === 'range' && state.rangeStart && !state.rangeEnd) {
      // Mới chọn 1 đoạn chat (Alt+Click lần 1): nạp luôn đoạn đó vào danh sách chọn (nếu bấm Chạy ngay thì gửi luôn 1 chat này,
      // còn nếu giữ Alt nhấp tiếp đoạn thứ 2 thì tự nối thành chuỗi từ đầu → cuối).
      push(state.rangeStart);
    } else if (state.mode === 'range' && state.rangeStart && state.rangeEnd) {
      const aId = state.rangeStart.id, bId = state.rangeEnd.id;
      let rows = null, idxOf = null;
      if (state.allRows && state.allRows.has(aId) && state.allRows.has(bId)) {
        rows = Array.from(state.allRows.values());
        idxOf = (id) => state.allRows.get(id).order;
      } else {
        const reduxRows = getReduxConversationListRows();
        const rIdx = new Map(reduxRows.map((r, i) => [r.id, i]));
        if (rIdx.has(aId) && rIdx.has(bId)) {
          rows = reduxRows;
          idxOf = (id) => (rIdx.has(id) ? rIdx.get(id) : -1);
        } else {
          // virtual list render 1 dải liền nhau → 2 đầu còn thấy ⇒ các dòng ở giữa cũng thấy
          rows = visibleRows().map(enrichRowWithRedux);
          const idx = new Map(rows.map((r, i) => [r.id, i]));
          idxOf = (id) => (idx.has(id) ? idx.get(id) : -1);
        }
      }
      const ia = idxOf(aId), ib = idxOf(bId);
      if (ia < 0 || ib < 0) {
        if (!(opts && opts.silentMissingLog)) {
          logLine('⚠ Không tìm thấy 1 trong 2 đầu chuỗi trong danh sách — đang tự tải bổ sung…');
        }
      } else {
        /* [v1.92.43e] Chuỗi hàng nghìn dòng: TRƯỚC ĐÂY mỗi dòng lại gọi idxOf(r.id) ⇒ mỗi lần đổi
         * lựa chọn là một lượt quét toàn bộ + Map/tìm kiếm. Nay chỉ cắt đúng khoảng [lo..hi].
         * Kiểm 2 đầu trước cho chắc: nếu chỉ số không trỏ đúng dòng thì quay lại đường cũ
         * (không bao giờ cắt sai chuỗi). */
        const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
        const fastOk = rows[ia] && rows[ib]
          && String(rows[ia].id) === String(aId) && String(rows[ib].id) === String(bId);
        if (fastOk) {
          for (let i = lo; i <= hi && i < rows.length; i++) push(rows[i]);
        } else {
          rows.forEach((r) => {
            const i = idxOf(r.id);
            if (i >= lo && i <= hi) push(r); // rows đang theo thứ tự trên→dưới
          });
        }
      }
    }
    state.matches = list;
    highlightRows();
    if (typeof schedulePreloadSelectedChats === 'function') schedulePreloadSelectedChats();
  }

  function setTarget(info, sourceLabel) {
    if (!info || !info.snippet) {
      logLine('⚠ Không đọc được snippet từ ' + (sourceLabel || 'dòng đã chọn'));
      return;
    }
    state.mode = 'snippet';
    state.rangeStart = null;
    state.rangeEnd = null;
    state.target = {
      id: info.id,
      name: info.name,
      snippet: info.snippet,
      snippetRaw: info.snippetRaw || info.snippet,
      time: info.time,
    };
    logLine('🎯 Đã chọn snippet từ ' + (info.name || '?') + ': “' + clip(info.snippet, 70) + '”');
    computeMatches();
    render();
  }

  function setRangeStart(info) {
    if (!info) return;
    const rich = enrichRowWithRedux(info);
    state.mode = 'range';
    state.target = null;
    state.rangeEnd = null;
    state.rangeStart = {
      ...rich,
      id: info.id,
      name: info.name || rich.name,
      snippet: info.snippet || rich.snippet,
      snippetRaw: info.snippetRaw || rich.snippetRaw,
      time: info.time || rich.time,
    };
    computeMatches();
    logLine('🅰 Đã chọn & đặt ĐẦU CHUỖI: ' + (info.name || info.id)
      + ' — đang tự tải dữ liệu đoạn này (giữ Alt nhấp tiếp dòng CUỐI chuỗi nếu muốn chọn cả dải)');
    render();
    if (typeof schedulePreloadSelectedChats === 'function') schedulePreloadSelectedChats(true);
  }

  async function completeRange(endInfo) {
    const start = state.rangeStart;
    if (!start || !endInfo) return;
    const richEnd = enrichRowWithRedux(endInfo);
    state.mode = 'range';
    state.rangeEnd = {
      ...richEnd,
      id: endInfo.id,
      name: endInfo.name || richEnd.name,
      snippet: endInfo.snippet || richEnd.snippet,
      snippetRaw: endInfo.snippetRaw || richEnd.snippetRaw,
      time: endInfo.time || richEnd.time,
    };
    // Hiển thị tạm ngay từ dữ liệu sẵn có trên màn hình/Redux để UI phản hồi tức thì,
    // sau đó LUÔN tự động gọi API tải mới danh sách cho đúng chuỗi vừa chọn (kể cả khi trước đó đã có danh sách)!
    computeMatches({ silentMissingLog: true });
    const endsCovered = () => {
      const ids = new Set((state.matches || []).map((m) => m.id));
      return ids.has(start.id) && ids.has(endInfo.id);
    };
    if (normalizeListForReuse() && endsCovered()) {
      // Đã có danh sách + đủ 2 đầu chuỗi ⇒ KHÔNG gọi API. Người dùng chỉ tải khi họ bấm.
      logLine('🔗 Dùng danh sách đã tải (' + state.allRows.size + ' chat, ' + listAgeText()
        + ' trước) — KHÔNG gọi lại API.');
    } else {
      logLine('⚡ Danh sách hiện tại chưa đủ 2 đầu chuỗi — tự tải bổ sung cho chuỗi đã chọn: '
        + (start.name || start.id) + ' → ' + (endInfo.name || endInfo.id) + '… (bấm ⚡ Tải danh sách nếu muốn tải mới toàn bộ)');
      render();
      await scanFullList({ forRange: true, restartIfBusy: true });
      computeMatches({ silentMissingLog: true });
    }
    const chainAlive = state.mode === 'range' && state.rangeStart
      && String(state.rangeStart.id) === String(start.id);
    const hasStart = state.matches.some((m) => m.id === start.id);
    const hasEnd = state.matches.some((m) => m.id === endInfo.id);

    const n = state.matches.length;
    // [v1.92.12] Lượt GỬI chen ngang sẽ clearSelection() ⇒ state.matches rỗng, và dòng
    // "⚠ Không tìm thấy đủ 2 đầu chuỗi" chỉ là BÁO ĐỘNG GIẢ (log 14:43:06, ngay sau khi
    // gửi 37 chat trong lúc quét). Chỉ báo khi chuỗi chọn còn nguyên vẹn.
    if (!chainAlive) {
      /* lượt chọn đã bị lượt gửi cắt ngang — im lặng, không báo sai */
    } else if (!hasStart || !hasEnd || !n) {
      logLine('🔗 CHUỖI CHỌN: ' + (start.name || start.id) + ' → ' + (endInfo.name || endInfo.id)
        + ' — ⚠ Không tìm thấy đủ 2 đầu chuỗi trong danh sách hiện tại.');
    } else {
      logLine('🔗 CHUỖI CHỌN: ' + (start.name || start.id) + ' → ' + (endInfo.name || endInfo.id)
        + ' — ' + n + ' chat trong chuỗi (đang tự nạp sẵn dữ liệu hội thoại…)');
    }
    render();
    if (typeof schedulePreloadSelectedChats === 'function') schedulePreloadSelectedChats(true);
  }

  function getBotChecklistElement() {
    try { return (shadow && shadow.getElementById('ssb-list')) || document.getElementById('ssb-list') || null; }
    catch (e) { return null; }
  }


  function clearSelection() {
    state.mode = null;
    state.target = null;
    state.rangeStart = null;
    state.rangeEnd = null;
    state.matches = [];
    state.deselectMode = false;
    state.listSel = new Set();
    state.loadedName = null;
    renderSavedLists();
    highlightRows();
  }


  function freezeSendChecklist() {
    state.deselectMode = false;
    state.sendListFrozen = true;
    state.matches.forEach((m) => { if (m) m.checked = false; });
    const list = getBotChecklistElement();
    if (!list) { applyScanButtons(); applyRunStopButtons(); return; }
    list.classList.add('ssb-send-list-frozen');
    list.setAttribute('aria-busy', 'true');
    list.querySelectorAll('input[type=checkbox]').forEach((cb) => cb.remove());
    applyScanButtons();
    applyRunStopButtons();
  }

  function unfreezeSendChecklist(restoreIds) {
    if (!state.sendListFrozen) return;
    const restore = restoreIds ? new Set(Array.from(restoreIds, String)) : null;
    state.matches.forEach((m) => {
      if (m) m.checked = !!(restore && restore.has(String(m.id)));
    });
    state.sendListFrozen = false;
    state.listKey = ''; // force one clean rebuild after unfreezing
    const list = getBotChecklistElement();
    if (list) {
      list.classList.remove('ssb-send-list-frozen');
      list.removeAttribute('aria-busy');
    }
  }

  function persistUiState() {
    try {
      const msgEl = shadow && shadow.getElementById('ssb-msg');
      localStorage.setItem(UI_KEY, JSON.stringify({ msg: (msgEl && msgEl.value) || '' }));
    } catch (e) { /* ignore */ }
  }
  function renderSavedLists() {}
  function rebuildFromLists() {}

  function highlightRows() {
    if (state.sendListFrozen) return;
    // Idempotent: chỉ thêm/bớt class khi khác — an toàn để gọi liên tục (observer/scroll/poll).
    // Chỉ highlight những chat còn tick; chat đã bỏ chọn phải mất màu ngay.
    const matchIds = new Set(state.matches.filter((m) => m && m.checked && !m.knownUnavailable).map((m) => String(m.id)));
    /* [v1.92.58] CHỈ CẦN CÁI `id` THÌ KHÔNG ĐƯỢC GỌI rowInfo(). `rowInfo()` đọc 5 `querySelector`
     * cho mỗi dòng (tên, snippet, giờ, avatar, tag + platform) — 18 000 `querySelector` cho 3 000
     * dòng, ngay trong khung hình của cú click. Ở đây ta chỉ dùng `id` để biết dòng có nằm trong
     * lựa chọn không và `markOf()` để biết loại dấu — cả hai KHÔNG cần đọc DOM:
     *   • id  = item.id (bỏ hậu tố __n) — đúng biểu thức của rowInfo, hoặc lấy từ khung div[id] cha;
     *   • dấu = tra trong `state.matches` (đã có sẵn mark/checked/isTarget).
     * Đo được (tools/_bench_click.mjs, 3 000 dòng): highlightRows 8 ms → ~0,4 ms. */
    /* GIỮ ĐÚNG HÀNH VI CŨ: bản cũ gọi markOf(rowInfo(item)) — rowInfo đọc LẠI từ DOM nên chỉ
     * trả về id/name/snippet..., KHÔNG có mark ⇒ markOf() gần như luôn '' và mọi dòng trúng đều
     * ra 'ssb-m-match'. Duy nhất trường hợp ra 'ssb-m-target' là khi id trùng id của
     * state.rangeStart/rangeEnd/target — vì markOf so theo id, không theo trường .mark.
     * Ở đây soi đúng như vậy (không dùng m.mark) để màu tô KHÔNG đổi so với bản cũ. */
    const markIds = new Set();
    [state.target, state.rangeStart, state.rangeEnd].forEach((s2) => {
      if (s2 && s2.id != null) markIds.add(String(s2.id));
    });
    const idOfItem = (item) => {
      if (!item) return '';
      let raw = String(item.id || '').replace(/__\d+$/, '');
      if (!raw && item.closest) {
        const wrap = item.closest('div[id]');
        raw = wrap ? String(wrap.id || '').replace(/__\d+$/, '') : '';
      }
      return raw;
    };
    const rootOf = (item) => item.closest('[role="row"]') || item;
    $$('.conversation-list-item').forEach((item) => {
      let want = '';
      if (state.enabled) {
        const id = idOfItem(item);
        if (id && matchIds.has(id)) {
          want = markIds.has(id) ? 'ssb-m-target' : 'ssb-m-match';
        }
      }
      const paint = (el) => {
        if (!el || !el.classList) return;
        const has = el.classList.contains('ssb-m-target') ? 'ssb-m-target'
          : el.classList.contains('ssb-m-match') ? 'ssb-m-match' : '';
        if (has !== want) {
          el.classList.remove('ssb-m-target', 'ssb-m-match');
          if (want) el.classList.add(want);
          hlClassSeen.set(el, el.className || ''); // để observer bỏ qua thay đổi do chính ta gây ra
        }
      };
      paint(item);
      paint(rootOf(item)); // tô cả khung dòng (role=row) — tránh bị panel màu của app che
    });
  }

  // Tô lại màu mỗi khi virtual list render lại dòng (cuộn, bấm chọn chat, app cập nhật…)
  let hlScheduled = false;
  let hlObserver = null;
  let hlDeferredBySelect = false;
  const hlClassSeen = new WeakMap(); // class đã thấy của từng dòng — để bỏ qua thay đổi do CHÍNH TA gây ra
  /* [v1.92.43e] Trong lúc người dùng đang RÊ chọn chuỗi (Alt/Ctrl/pickMode) ta tạm NGƯNG tô màu:
   * mỗi lần đổi lựa chọn là một lượt query + đọc DOM toàn danh sách, cộng hưởng với observer thành
   * vòng lặp nặng đúng lúc đang thao tác. Chọn xong (thả phím / nhấp xong) sẽ tô lại 1 lần. */
  function userSelectingNow() {
    if (state.deselectMode || state.pickMode) return true;
    return !!(modState.altAt && Date.now() - modState.altAt < MOD_FRESH_MS)
      || !!(modState.ctrlAt && Date.now() - modState.ctrlAt < MOD_FRESH_MS);
  }
  function scheduleHighlight() {
    if (state.sendListFrozen || hlScheduled) return;
    hlScheduled = true;
    requestAnimationFrame(() => {
      hlScheduled = false;
      try {
        if (userSelectingNow()) { hlDeferredBySelect = true; return; } // tô lại sau khi thao tác xong
        highlightRows();
      } catch (e) { /* ignore */ }
    });
  }

  // Gỡ ngay toàn bộ viền/nền do script vẽ khi người dùng xác nhận lượt gửi.
  // Danh sách người nhận đã được snapshot riêng nên có thể xóa lớp hiển thị mà không mất target.
  function clearHighlightRowsNow() {
    try {
      document.querySelectorAll('.ssb-m-target, .ssb-m-match').forEach((el) => {
        el.classList.remove('ssb-m-target', 'ssb-m-match');
      });
    } catch (e) { /* ignore */ }
  }

  /* [v1.92.43e] APP TỰ CUỘN DANH SÁCH → LAG KHI CHỌN CHUỖI.
   * Mỗi lần Alt/Ctrl nhấp đổi điểm cuối, app render lại dòng đang chọn và (tuỳ bản) cuộn danh sách
   * về gần đầu; danh sách là virtual list nên mỗi cú cuộn = tháo/gắn hàng chục dòng React + tính
   * lại vị trí ⇒ giật, nhất là khi danh sách đã tải hàng nghìn chat. Ta chỉ CHẶN cuộn khi đang
   * giữ Alt/Ctrl hoặc đang ở chế độ 2 nhấp — cuộn tay của người dùng không bị ảnh hưởng.
   * Bỏ tick ô "Giữ nguyên vị trí danh sách khi chọn chuỗi" nếu cần hành vi cũ. */
  try {
    window.addEventListener('scroll', (e) => {
      if (!state.keepListOnSelect) return;
      if (!userSelectingNow()) return;
      // chỉ ghim trong ~700ms ngay sau khi lựa chọn đổi; cuộn tay (Alt+lăn chuột) không bị cướp
      if (Date.now() - (state.lastSelectAt || 0) > 700) return;
      const t = e && e.target;
      if (!t || t === document || t === window) return;
      const el = t.nodeType === 1 ? t : null;
      if (!el || !el.closest) return;
      if (!el.closest('#conversationList, .conversation-list, .rc-virtual-list-holder')) return;
      // hoãn về đúng vị trí cũ (app vừa đổi scrollTop) — rẻ hơn nhiều so với render lại cả dải
      const keep = el.scrollTop;
      requestAnimationFrame(() => { try { if (el.scrollTop !== keep) el.scrollTop = keep; } catch (e2) { /* ignore */ } });
    }, true);
  } catch (e) { /* ignore */ }

  function watchList() {
    const list = $('#conversationList');
    if (!list) {
      // danh sách chưa render → thử lại
      setTimeout(() => { if (!state.destroyed) watchList(); }, 2000);
      return;
    }
    /* [v1.92.43e] VÒNG LẶP TỰ KÍCH: ta gắn MutationObserver lên cả class, rồi mỗi lần
     * highlightRows() ĐỔI class (thêm ssb-m-match / ssb-m-target) thì observer lại nổ ⇒
     * scheduleHighlight ⇒ highlightRows... Chỉ dừng vì hlScheduled gộp trong 1 animation frame,
     * nên nó chạy LUÔN TAY ở 60 fps khi có dòng được tô — đúng lúc người dùng chọn chuỗi.
     * Nay: chỉ nghe childList (dòng được render lại); class do CHÍNH TA đổi thì bỏ qua. */
    try {
      const mut = new MutationObserver((recs) => {
        for (let i = 0; i < recs.length; i++) {
          const r = recs[i];
          if (r.type === 'childList') { scheduleHighlight(); return; }
          if (r.type === 'attributes') {
            const el = r.target;
            if (el && el.classList) {
              const now = el.className || '';
              if (now !== hlClassSeen.get(el)) { hlClassSeen.set(el, now); scheduleHighlight(); return; }
            }
          }
        }
      });
      mut.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
      hlObserver = mut;
    } catch (e) { /* ignore */ }
    // 2) cuộn danh sách → tô lại
    try {
      const scroller = getScroller();
      if (scroller) scroller.addEventListener('scroll', () => scheduleHighlight(), { passive: true });
    } catch (e) { /* ignore */ }
    // 3) lưới an toàn: nếu vì lý do gì 1&2 hụt (list bị render lại toàn bộ) thì vẫn tự sửa sau ~1.5s
    //    (400ms cũ: mỗi nhịp là 1 lượt query toàn danh sách + đọc DOM từng dòng.)
    setInterval(() => scheduleHighlight(), 1500);
  }

  function clip(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /* ============================ TẢI DANH SÁCH QUA API (siêu nhanh) ============================ */

  // Đúng request mà app tự gọi khi tải/tải thêm danh sách (buildConversationsRequest trong bundle):
  //   GET /api/v1/conversations?pages[p]=…&current_count=…&next_cursor=…&unread_first=true
  //       &mode=OR&tags="ALL"&except_tags=[]&access_token=…&cursor_mode=true&from_platform=web
  // Phản hồi: { conversations, next_cursor, pages_with_current_count, success }
  function fmtApiTime(iso) {
    if (!iso) return '';
    const d = new Date(/[zZ+]|\+\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z'); // updated_at là UTC, không kèm Z
    if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ' ' + p(d.getDate()) + '/' + p(d.getMonth() + 1);
  }

  function convApiRow(c, order) {
    const from = c.from || {};
    const cust = (c.customers && c.customers[0]) || {};
    return {
      id: String(c.id || ''),
      name: c.name || from.name || from.username || cust.name || String(c.id || ''),
      snippet: c.snippet || '',
      snippetRaw: c.snippet || '',
      time: fmtApiTime(c.updated_at),
      type: String(c.type || '').toLowerCase() === 'comment' ? 'comment' : 'inbox',
      pageId: String(c.page_id || c.id.split('_')[0] || ''), // pageId có sẵn — khỏi suy từ id
      threadId: String(c.thread_id || ''), // thread_id có sẵn trong API — khỏi tải lại conversation khi gửi
      tags: Array.isArray(c.tags) ? c.tags.slice() : [], // tag ids — lọc "chốt"/"chặn" lúc gửi
      hasPhone: !!c.has_phone, // icon điện thoại (phone-green) — sale đang chăm, không bắn hàng loạt
      // v1.82.2: `recent_phone_numbers` cũng là nguồn của icon điện thoại (loaddanhsach.har: mọi dòng
      // chat đều có field này). Giữ SỐ LƯỢNG để chốt chặn điện thoại không phụ thuộc mỗi has_phone.
      recentPhone: Array.isArray(c.recent_phone_numbers) ? c.recent_phone_numbers.length : 0,
      threadKey: String(c.thread_key || ''), // payload Ext cần convId = thread_key (đúng executeByExtOnce)
      customerName: String((c.from && (c.from.username || c.from.name)) || c.name || ''), // payload Ext cần customerName
      updatedAt: String(c.updated_at || ''), // payload Ext cần conversationUpdatedTime
      lastAt: String(c.last_customer_interactive_at || ''), // mốc tương tác cuối của khách — đoán cửa sổ 24h
      fromPsid: String(c.from_psid || ((c.from || {}).id) || ''), // PSID của khách — có sẵn trong dữ liệu API
      customerId: String(cust.id || c.customer_id || ''), // uuid khách — ensureConvCtx gọi GET …/messages cần
      globalId: String(cust.global_id || c.global_id || ''), // global_id thật nếu có sẵn trong list
      seen: !!c.seen,
      isPinned: !!c.is_pinned,
      updatedTs: c.updated_at ? Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(c.updated_at) ? c.updated_at : c.updated_at + 'Z') : 0,
      customers: Array.isArray(c.customers) ? c.customers.map((x) => ({
        id: x && x.id, fb_id: x && x.fb_id, name: x && x.name,
        global_id: x && x.global_id, ad_clicks: x && x.ad_clicks,
      })) : [],
      order,
    };
  }

  function cacheGidFromConvObj(c) {
    try {
      if (!c || typeof window.__botfakeSaveGid__ !== 'function') return;
      const cid = String(c.id || '');
      const pid = String(c.page_id || c.pageId || cid.split('_')[0] || '');
      const tid = String(c.thread_id || c.threadId || '');
      const cust0 = (Array.isArray(c.customers) && c.customers[0]) || {};
      const gid = String(cust0.global_id || c.global_id || c.globalId || '');
      if (gid && cid) window.__botfakeSaveGid__(cid, pid, tid, gid);
      if (Array.isArray(c.customers) && pid) {
        c.customers.forEach((u) => {
          if (u && u.fb_id && u.global_id) {
            window.__botfakeSaveGid__(pid + '_' + u.fb_id, pid, tid, String(u.global_id));
          }
        });
      }
    } catch (e) { /* ignore */ }
  }

  function buildFormDataFromObj(obj) {
    const fd = new FormData();
    if (!obj || typeof obj !== 'object') return fd;
    Object.keys(obj).forEach((k) => {
      const val = obj[k];
      if (val !== null && typeof val === 'object' && !(val instanceof File)) {
        Object.keys(val).forEach((sub) => {
          fd.append(k + '[' + sub + ']', String(val[sub]));
        });
      } else if (val !== undefined) {
        fd.append(k, String(val));
      }
    });
    return fd;
  }

  function bgFetchJson(url, tries, reqOpts) {
    let swUrl = String(url || '');
    if (swUrl && !/[?&]access_token=/.test(swUrl)) {
      const tok = getToken() || 'cookie_session';
      swUrl += (swUrl.indexOf('?') > -1 ? '&' : '?') + 'access_token=' + encodeURIComponent(tok);
    }
    return extCall({
      type: 'BOTFAKE_BG_FETCH',
      url: swUrl,
      tries: tries || 3,
      method: (reqOpts && reqOpts.method) || 'GET',
      bodyObj: (reqOpts && reqOpts.bodyObj) || null,
      timeoutMs: (reqOpts && reqOpts.timeoutMs) || 15000,
    }, ((reqOpts && reqOpts.timeoutMs) || 15000) * (tries || 3) + 8000).then((out) => {
      if (out && out.res) return out.res;
      return { ok: false, error: (out && out.err) || 'SW fetch lỗi' };
    });
  }

  // GET/POST an toàn cho tải danh sách & đọc lịch sử: tự thử lại khi bị rate-limit (429)/5xx/lỗi mạng; trả lỗi kèm chi tiết
  let bgDeadUntil = 0; // mốc SW fetch chết → tạm fetch thẳng trên trang
  async function fetchJson(url, tries, reqOpts) {
    // Tab đang mở: fetch ngay trên trang (đúng cookie/token như app, không tốn IPC hay lỗi thiếu access_token ở SW).
    // Tab ẩn: mới chuyển SW để khỏi bị Chrome bóp; nếu SW trả lỗi hoặc success:false thì fallback về fetch trên trang.
    const tabHidden = typeof document !== 'undefined' && !!document.hidden;
    if (tabHidden && extBgAvailable() && Date.now() >= bgDeadUntil) {
      const r = await bgFetchJson(url, tries, reqOpts);
      const transport = r && !r.ok
        && /^(timeout|SW fetch lỗi|The message port|Could not establish|Extension context)/i.test(String(r.error || ''));
      if (transport) {
        bgDeadUntil = Date.now() + 60000; // SW chết/mất bridge → 60s tới fetch trên trang, không treo 120s/lần gọi
      } else if (r && r.ok && !(r.data && r.data.success === false)) {
        return r;
      }
    }
    const max = tries || 3;
    const isPost = !!(reqOpts && String(reqOpts.method || '').toUpperCase() === 'POST');
    let lastErr = '';
    for (let t = 1; t <= max; t++) {
      let abortTimer = null;
      try {
        // fetch trần KHÔNG tự hết hạn — kết nối treo là await treo theo → chặn toàn bộ lượt gửi
        const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
        if (ctl) abortTimer = bgClock.after((reqOpts && reqOpts.timeoutMs) || 15000, () => ctl.abort());
        const r = await fetch(url, {
          method: isPost ? 'POST' : 'GET',
          body: (isPost && reqOpts.bodyObj) ? buildFormDataFromObj(reqOpts.bodyObj) : undefined,
          credentials: 'include', cache: 'no-store',
          signal: ctl ? ctl.signal : undefined,
        });
        if (abortTimer) { try { abortTimer(); } catch (eA2) { /* ignore */ } abortTimer = null; }
        noteServerClock(r.headers);
        if (r.status === 429 || r.status >= 500) {
          lastErr = 'HTTP ' + r.status;
          if (t < max) { await sleepUntil(Date.now() + 400 * t); continue; }
          return { ok: false, error: lastErr };
        }
        if (!r.ok) {
          const body = (typeof r.text === 'function' ? (await r.text() || '') : '').slice(0, 140);
          return { ok: false, error: 'HTTP ' + r.status + (body ? ' · ' + body : '') };
        }
        if (typeof r.text !== 'function' && typeof r.json === 'function') {
          const d = await r.json().catch(() => null);
          return d ? { ok: true, data: d } : { ok: false, error: 'Phản hồi không phải JSON' };
        }
        const txt = await r.text();
        if (!txt || !txt.trim()) return { ok: true, data: { conversations: [] } }; // body rỗng = hết dữ liệu
        /* [v1.92.47b] KHÔNG bọc `stripJsonPrefix` ở đây: người dùng chốt "chỉ quay về cơ chế
         * tải danh sách". Hàm `stripJsonPrefix` vẫn còn (dùng cho ACK Socket) nhưng đường tải
         * giữ ĐÚNG như bản 1.92.46 — 0 khác biệt về hành vi. */
        try { return { ok: true, data: JSON.parse(txt) }; } catch (e) {
          try { return { ok: true, data: JSON.parse(atob(txt)) }; } catch (e2) {
            return { ok: false, error: 'Phản hồi không phải JSON' };
          }
        }
      } catch (e) {
        if (abortTimer) { try { abortTimer(); } catch (eA3) { /* ignore */ } }
        lastErr = (e && e.name === 'AbortError') ? 'quá ' + Math.round(((reqOpts && reqOpts.timeoutMs) || 15000) / 1000) + 's chưa phản hồi' : 'Lỗi mạng: ' + (e && e.message || e);
        if (t < max) { await sleepUntil(Date.now() + 400 * t); continue; }
        return { ok: false, error: lastErr };
      }
    }
    return { ok: false, error: lastErr || 'Không tải được' };
  }

  // Đọc tham số danh sách GIỐNG HỆT app (buildConversationsRequest — module 907775 @1402744 trong _app):
  //   pageIdOrPageIds = pages.multiplePageMode ? pages.multiplePageIds : pages.currentPageId
  //   endpoint        = multiplePageMode ? '/api/v1/conversations' : '/api/v1/pages/{pageId}/conversations'
  //   method          = 'POST' (multipart FormData) khi có lọc `type` hoặc >20 pages (khớp pancake.vn2.har #10..#21)
  const LIST_SPECIAL_TYPES = ['NOT_PRIVATE_REPLY', 'LIVESTREAM_MARKED_ORDER', 'IS_LIVESTREAM_POST_ON',
    'IS_LIVESTREAM_POST_OFF', 'PERSONAL_MESSAGE', 'GROUP_MESSAGE', 'BIZAI_GENERATING',
    'BIZAI_NOT_GENERATING', 'BIZAI_TRANSFERRED', 'STRANGER_MESSAGE'];

  function getReduxState() {
    try {
      const s = window.__pancakeReduxStore__;
      if (s && typeof s.getState === 'function') return s.getState();
    } catch (e) { /* isolated / chưa hydrate */ }
    return null;
  }
  function pageIdFromLocation() {
    const m = String(location.pathname || '').match(/\/(\d{6,})/);
    return m ? m[1] : '';
  }
  function buildListRequest(pageCount, cursor, currentCount, token, opts) {
    const st = getReduxState() || {};
    const pgs = st.pages || {};
    const auth = st.auth || {};
    const cs = st.conversations || {};
    const singlePageId = (opts && opts.singlePageId) ? String(opts.singlePageId) : '';
    const multi = !!pgs.multiplePageMode;
    let ids = singlePageId
      ? [singlePageId]
      : (multi
        ? (Array.isArray(pgs.multiplePageIds) ? pgs.multiplePageIds.slice() : [])
        : (pgs.currentPageId ? [pgs.currentPageId] : []));
    if (!ids.length) {
      const fromUrl = pageIdFromLocation();
      if (fromUrl) ids = [fromUrl];
    }
    if (!ids.length) {
      return { ids: [], url: '', method: 'GET', bodyObj: null, unreadFirst: true };
    }
    const settings = (multi ? auth.settings : pgs.currentSettings) || {};
    const ftype = Array.isArray(cs.filteredType) ? cs.filteredType : (cs.filteredType ? [cs.filteredType] : []);
    let unreadFirst = (settings.unread_first === undefined || settings.unread_first === null)
      ? true : !!settings.unread_first;
    if (ftype.indexOf('UNREPLIED_ASC') > -1 || ftype.indexOf('UNREPLIED_SEEN') > -1) unreadFirst = false;
    let mode;
    if (multi) mode = pgs.multiPageFilterMode || settings.filter_multi_tag || 'OR';
    else mode = settings.filter_multi_tag === true ? 'OR'
      : (settings.filter_multi_tag === false || settings.filter_multi_tag === undefined ? 'NONE' : settings.filter_multi_tag);
    // tags / except_tags — filteredTag có thể là "ALL" hoặc mảng (có thể lẫn "EXCEPT_TAG_123")
    let tagsVal = (cs.filteredTag === undefined || cs.filteredTag === null) ? 'ALL' : cs.filteredTag;
    let exceptIds = [];
    if (Array.isArray(tagsVal)) {
      const keep = [];
      tagsVal.forEach((t) => {
        const m = /^EXCEPT_TAG_(\d+)$/.exec(String(t));
        if (m) exceptIds.push(parseInt(m[1], 10));
        else keep.push(t);
      });
      tagsVal = keep;
    }
    // FORCE lọc theo tag (dùng khi kiểm tra tag "chốt"/"chặn" lúc gửi):
    // server nhận tags=[id…] và tự trả đúng các chat dính 1 trong các tag đó (mode=OR)
    // v1.82.3: đọc TOÀN BỘ chat bất kể app đang lọc theo tag nào (tags="ALL" — đúng cách app gọi
    // khi không lọc tag: loaddanhsach.har `mode=OR&tags=%22ALL%22`). Dùng khi đồng bộ tag/số điện
    // thoại cho list câu: nếu app đang lọc 1 tag thì chat vừa "chốt" có thể rơi khỏi danh sách lọc.
    if (opts && opts.forceAllTags) {
      tagsVal = 'ALL';
      exceptIds = [];
    }
    if (opts && Array.isArray(opts.forceTags) && opts.forceTags.length) {
      // id tag GIỮ DẠNG SỐ y như app (tags=[387] chứ KHÔNG ["387"]) — id chuỗi bị server bỏ qua
      tagsVal = opts.forceTags.map((x) => (/^\d+$/.test(String(x)) ? Number(x) : String(x)));
      exceptIds = [];
      mode = 'OR';
    }
    // types = filteredType bỏ các cờ đặc biệt; cờ → query riêng như app
    let types = ftype.filter((e) => LIST_SPECIAL_TYPES.indexOf(e) === -1);
    const filteredWebs = Array.isArray(cs.filteredWebs) ? cs.filteredWebs : [];
    const filteredAdIds = cs.filteredAdIds || null;
    const isInitial = !currentCount && !cursor;
    const q = new URLSearchParams();
    let method = 'GET';
    const bodyObj = {};
    const useMultiEndpoint = multi || ids.length > 1 || !!(opts && opts.forceMultiEndpoint);

    if (isInitial) {
      const hasWeb = types.some((e) => String(e).indexOf('WEB') > -1) && filteredWebs.length > 0;
      const hasAds = types.some((e) => String(e).indexOf('ADS') > -1) && !!filteredAdIds;
      if (hasWeb) types = types.filter((e) => String(e).indexOf('WEB') === -1);
      if (hasAds) types = types.filter((e) => String(e).indexOf('ADS') === -1);
      if (useMultiEndpoint) {
        if (ids.length <= 20) {
          ids.forEach((p) => q.append('pages[' + p + ']', '0'));
        } else {
          const pgMap = {};
          ids.forEach((p) => { pgMap[p] = 0; });
          bodyObj.pages = pgMap;
          method = 'POST';
        }
      }
      if (hasAds) q.append('ad_id', JSON.stringify(filteredAdIds));
      if (hasWeb) q.append('source_urls', JSON.stringify(filteredWebs.map((e) => (e && e.source) || e)));
      if (types.length) {
        bodyObj.type = types.toString();
        method = 'POST';
      }
    } else {
      q.append('current_count', String(currentCount || 60));
      if (cursor) q.append('next_cursor', cursor);
      if (filteredAdIds) q.append('ad_id', JSON.stringify(filteredAdIds));
      if (filteredWebs.length) q.append('source_urls', JSON.stringify(filteredWebs));
      if (types.length) {
        bodyObj.type = types.toString();
        method = 'POST';
      }
      if (useMultiEndpoint) {
        if (ids.length > 20) {
          const pgMap = {};
          ids.forEach((p) => { pgMap[p] = (pageCount && pageCount[p]) || 0; });
          bodyObj.pages = pgMap;
          method = 'POST';
        } else {
          ids.forEach((p) => q.append('pages[' + p + ']', String((pageCount && pageCount[p]) || 0)));
        }
      }
    }
    if (!types.length && ftype.indexOf('NOT_PRIVATE_REPLY') > -1 && ftype.indexOf('COMMENT') > -1) {
      q.append('is_private_replied', 'false');
    }
    if (ftype.indexOf('COMMENT') > -1 && ftype.indexOf('LIVESTREAM_MARKED_ORDER') > -1) q.append('filter_has_livestream_order', 'true');
    if (ftype.indexOf('IS_LIVESTREAM_POST_ON') > -1) q.append('is_livestream_post', 'true');
    else if (ftype.indexOf('IS_LIVESTREAM_POST_OFF') > -1) q.append('is_livestream_post', 'false');
    if (ftype.indexOf('INBOX') > -1 && ftype.indexOf('GROUP_MESSAGE') > -1) q.append('inbox_type', '1');
    if (ftype.indexOf('INBOX') > -1 && ftype.indexOf('PERSONAL_MESSAGE') > -1) q.append('inbox_type', '');
    if (ftype.indexOf('INBOX') > -1 && ftype.indexOf('STRANGER_MESSAGE') > -1) q.append('stranger_status', '1');
    if (ftype.indexOf('INBOX') > -1 && ftype.indexOf('BIZAI_GENERATING') > -1) q.append('bizai_status', '1');
    if (ftype.indexOf('INBOX') > -1 && ftype.indexOf('BIZAI_NOT_GENERATING') > -1) q.append('bizai_status', '');
    if (ftype.indexOf('INBOX') > -1 && ftype.indexOf('BIZAI_TRANSFERRED') > -1) q.append('bizai_status', '2');
    if (cs.filteredTask === 'open' || (cs.filteredTask && cs.filteredTask !== 'close')) q.append('task_opened', 'open');
    if (cs.filteredAssignee) q.append('assignee_id', JSON.stringify(cs.filteredAssignee));
    q.append('unread_first', unreadFirst ? 'true' : 'false');
    q.append('mode', String(mode));
    q.append('tags', JSON.stringify(tagsVal));
    q.append('except_tags', JSON.stringify(exceptIds));
    q.append('access_token', token);
    q.append('cursor_mode', 'true');
    q.append('from_platform', 'web');
    const endpointPath = useMultiEndpoint
      ? '/api/v1/conversations'
      : ('/api/v1/pages/' + encodeURIComponent(ids[0]) + '/conversations');
    return {
      ids,
      url: location.origin + endpointPath + '?' + q.toString(),
      method,
      bodyObj: Object.keys(bodyObj).length ? bodyObj : null,
    };
  }

  // Giải mã & mã hóa next_cursor chuẩn Erlang External Term Format (:erlang.term_to_binary) của Pancake
  // (đã xác minh 100% khớp từng byte với pancake.vn2.har #10: [seen_flag, updated_at_ms, "{page_id}:{conv_id}"])
  function parseErlangCursor(b64) {
    try {
      if (!b64 || typeof b64 !== 'string') return null;
      const bin = atob(b64);
      const len = bin.length;
      if (len < 24) return null;
      if (bin.charCodeAt(0) !== 0x83 || bin.charCodeAt(1) !== 0x6c || bin.charCodeAt(5) !== 0x03) return null;
      if (bin.charCodeAt(6) !== 0x61) return null;
      const seenByte = bin.charCodeAt(7) & 0xff;
      if (bin.charCodeAt(8) !== 0x6e || bin.charCodeAt(9) !== 0x06 || bin.charCodeAt(10) !== 0x00) return null;
      let tsMs = 0;
      let mult = 1;
      for (let i = 0; i < 6; i++) {
        tsMs += (bin.charCodeAt(11 + i) & 0xff) * mult;
        mult *= 256;
      }
      if (bin.charCodeAt(17) !== 0x6d) return null;
      const strLen = (((bin.charCodeAt(18) & 0xff) << 24) >>> 0)
        + ((bin.charCodeAt(19) & 0xff) << 16)
        + ((bin.charCodeAt(20) & 0xff) << 8)
        + (bin.charCodeAt(21) & 0xff);
      if (22 + strLen + 1 !== len || bin.charCodeAt(len - 1) !== 0x6a) return null;
      const keyStr = bin.slice(22, 22 + strLen);
      return { seenByte, tsMs, keyStr };
    } catch (e) {
      return null;
    }
  }

  function encodeErlangCursor(seenByte, tsMs, keyStr) {
    try {
      const s = String(keyStr || '');
      const strLen = s.length;
      const bytes = new Uint8Array(22 + strLen + 1);
      bytes[0] = 0x83;
      bytes[1] = 0x6c;
      bytes[2] = 0; bytes[3] = 0; bytes[4] = 0; bytes[5] = 3;
      bytes[6] = 0x61;
      bytes[7] = seenByte & 0xff;
      bytes[8] = 0x6e;
      bytes[9] = 6;
      bytes[10] = 0;
      let v = Math.max(0, Math.floor(tsMs));
      for (let i = 0; i < 6; i++) {
        bytes[11 + i] = v % 256;
        v = Math.floor(v / 256);
      }
      bytes[17] = 0x6d;
      bytes[18] = (strLen >>> 24) & 0xff;
      bytes[19] = (strLen >>> 16) & 0xff;
      bytes[20] = (strLen >>> 8) & 0xff;
      bytes[21] = strLen & 0xff;
      for (let i = 0; i < strLen; i++) bytes[22 + i] = s.charCodeAt(i) & 0xff;
      bytes[22 + strLen] = 0x6a;
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    } catch (e) {
      return null;
    }
  }

  function estimatePageSpanMs(convs, fallbackMs) {
    if (!Array.isArray(convs) || convs.length < 2) return fallbackMs || 600000;
    const unpinned = convs.filter((c) => c && !c.is_pinned && !c.isPinned);
    const list = unpinned.length >= 2 ? unpinned : convs;
    const last = list[list.length - 1];
    const lastSeen = !!(last && last.seen);
    const sameSeen = list.filter((c) => !!c.seen === lastSeen);
    const arr = sameSeen.length >= 2 ? sameSeen : list;
    const tFirst = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(arr[0].updated_at || '') ? arr[0].updated_at : (arr[0].updated_at + 'Z'));
    const tLast = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(arr[arr.length - 1].updated_at || '') ? arr[arr.length - 1].updated_at : (arr[arr.length - 1].updated_at + 'Z'));
    if (!isNaN(tFirst) && !isNaN(tLast) && tFirst > tLast) {
      return Math.max(5000, tFirst - tLast);
    }
    return fallbackMs || 600000;
  }

  // 🚀 TẢI DANH SÁCH SIÊU TỐC v1.67.0 — 3 cơ chế tùy tình huống, tất cả đều KHÔNG HỞ DỮ LIỆU:
  //   A) NHIỀU PAGE (multiplePageMode / >1 page): tách mỗi page thành 1 CHUỖI CURSOR RIÊNG chạy SONG SONG
  //      (endpoint /pages/{pageId}/conversations của chính app trong _app buildConversationsRequest khi
  //      pageIdOrPageIds không phải mảng) — tối đa 10 chuỗi cùng lúc. Mỗi chuỗi đi tuần tự theo next_cursor
  //      THẬT của server nên không bao giờ hở/thiếu chat. Xong thì gộp + sắp xếp lại ĐÚNG thứ tự app
  //      (đã đối chiếu pancake.vn2.har #4: ghim trên cùng → chưa đọc → đã đọc, trong nhóm theo updated_at giảm dần).
  //   B) 1 PAGE: luồng gốc seg0 đi tuần tự từ đầu (dữ liệu mới tinh 100%) + tối đa 10 luồng phụ chạy ĐỘC LẬP
  //      (không chờ nhau theo vòng) ở các mốc thời gian phía trước theo cursor Erlang ETF tự tổng hợp;
  //      hễ seg0 chạm đầu 1 đoạn phụ là KHÂU cả đoạn vào và nhảy cursor qua đoạn đó — bỏ qua được
  //      hàng loạt request tuần tự. Luồng phụ nào treo cũng không chặn được luồng gốc.
  //   C) Lọc tag lúc gửi (forceTags / maxPages): tuần tự như cũ (chỉ cần 1 trang).
  //   Cả A & B đều DỪNG NGAY khi chuỗi 2 đầu (range) đã đủ 2 đầu hoặc user bấm dừng.
  async function loadListViaApi(onProgress, opts) {
    const token = getToken();
    if (!token) return { ok: false, error: 'Không lấy được access token' };
    const startedAt = Date.now();
    const plainMode = !opts || (!opts.forceTags && !opts.maxPages);

    const isRangeSatisfied = (idSet) => {
      if (!plainMode || (opts && opts.full)) return false;
      if (state.mode === 'range' && state.rangeStart && state.rangeEnd) {
        return idSet.has(state.rangeStart.id) && idSet.has(state.rangeEnd.id);
      }
      if (state.mode === 'range' && state.rangeStart && !state.rangeEnd && (opts && opts.forRange)) {
        return idSet.has(state.rangeStart.id);
      }
      return false;
    };
    const stopped = () => state.scanStopRequested;

    // 🧯 ĐIỀU TỐC CHỐNG 429 DÙNG CHUNG (v1.85.0): log thật cho thấy server bóp 429 ngay từ ~120
    // chat khi 11 luồng cùng bắn, và mỗi luồng tự thử lại khiến áp lực KHÔNG giảm → crawl 15 chat/s.
    // Nay: hễ 1 request dính 429 → TOÀN BỘ luồng nghỉ chung 2,5s + SỐ LUỒNG PHỤ ĐƯỢC PHÉP SỐNG
    // GIẢM MỘT NỬA (10→5→2→1→0, cuối cùng chỉ còn luồng gốc đi một mình đúng nhịp server nhả).
    // LITE: KHÔNG luồng phụ cursor giả — nhảy thời gian dễ hở chat (88 → 73 khi cuộn).
    // Chỉ đi next_cursor thật tuần tự cho đủ danh sách.
    /* [v1.92.44] NGÂN SÁCH LUỒNG PHỤ CURSOR GIẢ = 0, VÀ NAY LÀ TƯỜNG MINH.
     * Bản cũ (kể cả LITE 1.91.55) khai `helperBudget: 0` rồi chỉ CHIA ĐÔI khi 429
     * (Math.floor(0/2) = 0), không có chỗ nào tăng ⇒ `if (rl.helperBudget > 0) spawnHelper()`
     * KHÔNG BAO GIỜ chạy, `for (s = alive; s < Math.min(STRIDES.length, 0))` cũng không, và
     * `rl.hits > 0 && seg.ord >= rl.helperBudget` đúng ngay từ helper đầu. Toàn bộ ~60 dòng
     * "10 luồng phụ độc lập" là CODE CHẾT ⇒ đọc code tưởng có 11 luồng tải song song, thực tế
     * chỉ 1 cursor tuần tự (đường dễ dính 429 nhất). Nay ghi rõ đây là quyết định có chủ đích:
     * luồng phụ dựng cursor Erlang GIẢ bằng cách lùi mốc thời gian nên có thể NHẢY QUA chat
     * (đo được 88 → 73 chat khi cuộn) — tức đánh đổi lấy tốc độ bằng nguy cơ HỞ DANH SÁCH,
     * đúng thứ không được phép. Giữ 0; mọi cải thiện tốc độ tải phải đến từ đi đúng
     * next_cursor + thử lại page lỗi (xem retry riêng từng page bên dưới). */
    const RL_HELPER_BUDGET_START = 0;
    const rl = { pauseUntil: 0, hits: 0, helperBudget: RL_HELPER_BUDGET_START, logged: false };
    const rlNote429 = () => {
      rl.hits++;
      rl.pauseUntil = Date.now() + 2500;
      // 429 ⇒ giảm nửa số luồng phụ ĐANG được phép sống (6→3→1→0), cuối cùng chỉ còn tuyến gốc.
      rl.helperBudget = Math.max(0, Math.floor(rl.helperBudget / 2));
      if (!rl.logged) {
        rl.logged = true;
        logLine('🧯 Server đang giới hạn tốc độ (429) — tự giảm luồng tải song song + nghỉ chung để qua cơn…');
      }
    };

    const fetchPage = async (pageCount, cursor, currentCount, extra) => {
      const eo = Object.assign({}, opts || {}, extra || {});
      const req = buildListRequest(pageCount, cursor, currentCount, token, eo.forceMulti || eo.singlePageId ? eo : opts);
      if (!req.ids.length) return { ok: false, error: 'Không xác định được page đang xem' };
      // đang trong cơn 429 → mọi luồng cùng chờ hết giờ nghỉ chung thay vì đâm đầu vào server
      if (!stopped() && Date.now() < rl.pauseUntil) await sleepUntil(rl.pauseUntil, 'rl-pause'); // [v1.92.9] thức ĐÚNG mốc
      if (stopped()) return { ok: false, error: 'stopped' };
      const res = await fetchJson(req.url, eo.tries || 3, { method: req.method, bodyObj: req.bodyObj, timeoutMs: eo.timeoutMs || 12000 });
      if (!res.ok) { if (/429/.test(res.error || '')) rlNote429(); return { ok: false, error: res.error }; }
      const j = res.data || {};
      if (j.success === false) return { ok: false, error: j.message || j.error || 'success=false' };
      return { ok: true, data: j, ids: req.ids, unreadFirst: req.unreadFirst };
    };

    const pushConvs = (seg, convs) => {
      let added = 0;
      (convs || []).forEach((c) => {
        const id = String((c && c.id) || '');
        if (!id || seg.set.has(id)) return;
        cacheGidFromConvObj(c);
        seg.set.add(id);
        seg.items.push(convApiRow(c, seg.items.length));
        added++;
      });
      return added;
    };

    // ---------- C) TUẦN TỰ (lọc tag / giới hạn trang) ----------
    const loadSequential = async () => {
      const seg = { items: [], set: new Set(), cursor: null, pageCount: {} };
      let guard = 0;
      let forceMulti = false;
      while (guard++ < 1500 && !stopped()) {
        const res = await fetchPage(seg.pageCount, seg.cursor, seg.items.length, { forceMulti });
        if (!res.ok) {
          if (stopped() || res.error === 'stopped') {
            return { ok: true, rows: seg.items, stopped: true, incomplete: false };
          }
          if (guard === 1 && !forceMulti) { forceMulti = true; guard--; continue; }
          return guard === 1 ? { ok: false, error: 'API danh sách lỗi trang 1: ' + res.error } : { ok: true, rows: seg.items, incomplete: true };
        }
        const j = res.data || {};
        const convs = j.conversations || [];
        const added = pushConvs(seg, convs);
        if (j.pages_with_current_count) seg.pageCount = Object.assign({}, seg.pageCount, j.pages_with_current_count);
        seg.cursor = (convs.length && j.next_cursor) ? j.next_cursor : null;
        if (onProgress) onProgress(seg.items.length, seg.items);
        if (!seg.cursor || !convs.length || !added || (opts && opts.maxPages && guard >= opts.maxPages)) break;
      }
      // hết vòng lặp mà cursor vẫn còn = còn dữ liệu chưa tải → CHƯA đầy đủ (trừ khi user tự dừng / giới hạn trang có chủ đích)
      return { ok: true, rows: seg.items, incomplete: !!(seg.cursor && !stopped() && !(opts && opts.maxPages)), stopped: stopped() };
    };

    if (!plainMode) return loadSequential();

    // Đọc danh sách page + unread_first từ request mẫu (chưa bắn mạng)
    let probeIds = [];
    let unreadFirst = true;
    try {
      const probe = buildListRequest({}, null, 0, token, opts);
      probeIds = probe.ids || [];
      unreadFirst = probe.unreadFirst !== false;
    } catch (e) { /* dùng đường tuần tự bên dưới */ }

    // ---------- A) NHIỀU PAGE → MỖI PAGE 1 CHUỖI SONG SONG ----------
    // Riêng khi đang tự tải đúng vùng chọn (opts.forRange): đi đường tuần tự chung (loadSequentialOrStitch)
    // để lấy từ đỉnh danh sách xuống đúng điểm cuối chuỗi rồi dừng ngay lập tức, không phải quét hết mọi page!
    if (probeIds.length >= 2 && !(opts && opts.forRange)) {
      const perPage = new Map(); // pageId -> rows[]
      const allSet = new Set();
      const incompletePages = new Set(); // page tải lỗi/thiếu → không được im lặng bỏ qua
      let total = 0;
      let firstPageErrors = 0;
      let midErrors = 0;
      let stopAll = false;
      const queue = probeIds.slice();
      const chain = async (pid) => {
        const seg = { items: [], set: new Set(), cursor: null, pageCount: {}, started: false };
        perPage.set(pid, seg.items);
        let guard = 0;
        /* [v1.92.44] LỖI 1 REQUEST KHÔNG ĐƯỢC LÀM MẤT CẢ PAGE.
         * Bản cũ: request lỗi (kể cả 1 lần 429/timeout lẻ) ⇒ `incompletePages.add(pid)` + return
         * ⇒ mất TOÀN BỘ trang đã tải của page đó. Hệ quả dây chuyền: `scanFullList` thấy
         * incomplete ⇒ xoá sạch `allRows` đã tải và chạy lại TỪ ĐẦU, lần 2 vẫn lỗi ⇒ chặn gửi.
         * Nay: giữ nguyên `seg.cursor` (đúng chỗ đang đứng) và thử lại tối đa 3 lần, nghỉ
         * 1,2 s/2,4 s. Chỉ khi hỏng thật mới đánh dấu page thiếu — và khi đó vẫn giữ phần
         * `seg.items` đã lấy được thay vì vứt đi (xử lý ở nhánh gộp bên dưới). */
        let pageRetry = 0;
        while (guard++ < 1500 && !stopAll && !stopped()) {
          const res = await fetchPage({}, seg.cursor, seg.items.length, { singlePageId: pid, tries: seg.started ? 2 : 3, timeoutMs: 12000 });
          if (!res.ok) {
            if (stopped()) return;
            if (pageRetry < 3) {
              pageRetry++;
              await sleepUntil(Date.now() + 1200 * pageRetry, 'list-page-retry');
              guard--; // lần thử lại không tính vào trần 1500 trang
              continue;
            }
            if (!seg.started) firstPageErrors++; else midErrors++;
            incompletePages.add(pid);
            if (seg.items.length) logLine('⚠ Page ' + pid + ': lỗi ở trang ' + (seg.items.length ? 'giữa chuỗi' : 'đầu')
              + ' sau 4 lần thử (' + (res.error || '?') + ') — GIỮ ' + seg.items.length + ' chat đã tải được.');
            return;
          }
          pageRetry = 0;
          seg.started = true;
          const j = res.data || {};
          const convs = j.conversations || [];
          const before = seg.items.length;
          (convs || []).forEach((c) => {
            const id = String((c && c.id) || '');
            if (!id || seg.set.has(id) || allSet.has(id)) return;
            cacheGidFromConvObj(c);
            seg.set.add(id); allSet.add(id);
            seg.items.push(convApiRow(c, 0));
          });
          total += seg.items.length - before;
          seg.cursor = (convs.length && j.next_cursor) ? j.next_cursor : null;
          if (onProgress) onProgress(total, null);
          if (!seg.cursor || !convs.length) return;
          if (seg.items.length === before) {
            // trang trả về mà không thêm được chat mới (trùng dữ liệu) — đi tiếp tối đa 5 trang,
            // vẫn không thêm được thì page này CHƯA đầy đủ, không được coi như đã hết
            if ((seg.noAddStreak = (seg.noAddStreak || 0) + 1) >= 5) { incompletePages.add(pid); return; }
          } else seg.noAddStreak = 0;
          if (isRangeSatisfied(allSet)) { stopAll = true; return; }
        }
        if (seg.cursor && !stopAll && !stopped()) incompletePages.add(pid); // hết vòng lặp mà chưa hết dữ liệu
      };
      const POOL = Math.min(10, queue.length);
      const workers = [];
      for (let w = 0; w < POOL; w++) {
        workers.push((async () => { while (queue.length && !stopAll && !stopped()) { const pid = queue.shift(); await chain(pid); } })());
      }
      await Promise.all(workers);
      // CHỈ CẦN 1 page tải lỗi/thiếu là danh sách KHÔNG còn đầy đủ → tải lại toàn bộ bằng
      // đường đa luồng chung (tuyệt đối không dùng danh sách mất nguyên 1 page để gửi)
      /* [v1.92.44] PHÂN BIỆT "THIẾU 1 PHẦN" VỚI "MẤT CẢ DANH SÁCH".
       * Bản cũ: BẤT KỲ page nào lỗi/thiếu ⇒ bỏ toàn bộ kết quả vừa tải (hàng nghìn chat)
       * và chạy lại từ đầu bằng đường khác; đường đó lỗi tiếp là `scanFullList` xoá sạch
       * `allRows` và CHẶN GỬI. Người dùng thấy "chạy tới 90% rồi quay về 0".
       * Nay vẫn ưu tiên danh sách ĐẦY ĐỦ (thử lại đường chung 1 lần), nhưng nếu đường đó
       * cũng không xong thì vẫn dùng được phần đã tải — kèm cờ `partial` để nơi gọi biết
       * CHÍNH XÁC page nào thiếu và không bao giờ coi là "đủ cho chọn tất cả". */
      const fatalList = !total || firstPageErrors >= Math.ceil(probeIds.length / 2);
      if (!stopAll && !stopped() && (incompletePages.size || fatalList || midErrors > 0)) {
        const why = incompletePages.size
          ? (incompletePages.size + ' page tải chưa hết (' + Array.from(incompletePages).slice(0, 5).join(', ') + (incompletePages.size > 5 ? '…' : '') + ')')
          : 'Tải song song theo page không khả thi';
        logLine('⚠ ' + why + ' — thử lại toàn bộ bằng đường tuần tự để có danh sách ĐẦY ĐỦ…');
        const retryAll = await loadSequentialOrStitch();
        // Đường chung xong đủ ⇒ dùng luôn (tốt nhất).
        if (retryAll && retryAll.ok && !retryAll.incomplete && Array.isArray(retryAll.rows) && retryAll.rows.length) {
          return retryAll;
        }
        // Đường chung cũng thiếu ⇒ KHÔNG vứt phần đã tải: gộp những gì có, đánh dấu thiếu.
        const keptRows = [];
        perPage.forEach((arr) => { arr.forEach((r) => keptRows.push(r)); });
        const retryRows = (retryAll && Array.isArray(retryAll.rows)) ? retryAll.rows : [];
        if (retryRows.length) {
          // gộp theo id, ưu tiên bản từ đường chung (mới hơn), giữ nguyên order sau khi sort
          const seenK = new Set();
          retryRows.forEach((r) => { if (r && r.id && !seenK.has(r.id)) { seenK.add(r.id); keptRows.push(r); } });
        }
        if (!keptRows.length) {
          logLine('⛔ Cả 2 đường đều không lấy được chat nào — không dùng danh sách rỗng.');
          return { ok: false, error: 'Không tải được danh sách' };
        }
        logLine('🟡 Giữ được ' + keptRows.length + ' chat đã tải (KHÔNG vứt đi). Page còn thiếu: '
          + (incompletePages.size ? Array.from(incompletePages).slice(0, 5).join(', ') + (incompletePages.size > 5 ? '…' : '') : '(không rõ)')
          + ' ⇒ danh sách được đánh dấu CHƯA ĐẦY ĐỦ: chọn chuỗi trong phần đã có vẫn gửi được, "chọn tất cả" thì không.');
        const mergedRows = keptRows.slice();
        mergedRows.sort((a, b) => {
          if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
          if (unreadFirst && !!a.seen !== !!b.seen) return a.seen ? 1 : -1;
          return (b.updatedTs || 0) - (a.updatedTs || 0);
        });
        mergedRows.forEach((r, i) => { r.order = i; });
        return {
          ok: true,
          rows: mergedRows,
          incomplete: true,                       // còn page thiếu ⇒ KHÔNG phải danh sách đầy đủ
          incompletePages: Array.from(incompletePages),
          rowsKept: true,                         // nơi gọi biết đây là danh sách MỘT PHẦN dùng được
        };
      }
      const rows = [];
      perPage.forEach((arr) => { arr.forEach((r) => rows.push(r)); });
      // Thứ tự app (HAR #4): ghim ↑ → chưa đọc ↑ → đã đọc, trong nhóm updated_at giảm dần
      rows.sort((a, b) => {
        if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
        if (unreadFirst && !!a.seen !== !!b.seen) return a.seen ? 1 : -1;
        return (b.updatedTs || 0) - (a.updatedTs || 0);
      });
      rows.forEach((r, i) => { r.order = i; });
      logLine('⚡⚡ Tải song song ' + probeIds.length + ' page: ' + rows.length + ' chat trong ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's');
      if (onProgress) onProgress(rows.length, rows);
      return { ok: true, rows };
    }

    return loadSequentialOrStitch();

    // ---------- B) 1 PAGE → LUỒNG GỐC + LUỒNG PHỤ ĐỘC LẬP, KHÂU ĐOẠN ----------
    async function loadSequentialOrStitch() {
      let forceMultiEndpoint = false;
      let p1;
      try {
        p1 = await fetchPage({}, null, 0, {});
        if (!p1.ok) {
          const retryMulti = await fetchPage({}, null, 0, { forceMulti: true });
          if (retryMulti.ok) { p1 = retryMulti; forceMultiEndpoint = true; }
        }
      } catch (e) {
        return { ok: false, error: 'Không đọc được bộ lọc của app: ' + (e && e.message || e) };
      }
      if (!p1 || !p1.ok) return { ok: false, error: 'API danh sách lỗi trang 1: ' + ((p1 && p1.error) || 'Không tải được') };

      const seg0 = {
        items: [], set: new Set(),
        cursor: (p1.data && p1.data.next_cursor) || null,
        pageCount: Object.assign({}, (p1.data && p1.data.pages_with_current_count) || {}),
        spanMs: estimatePageSpanMs((p1.data && p1.data.conversations) || [], 600000),
      };
      pushConvs(seg0, (p1.data && p1.data.conversations) || []);
      if (onProgress) onProgress(seg0.items.length, seg0.items);
      if (!seg0.cursor || stopped() || isRangeSatisfied(seg0.set)) {
        return {
          ok: true,
          rows: seg0.items,
          stopped: stopped(),
          rangePartial: !!(seg0.cursor && !stopped() && isRangeSatisfied(seg0.set)),
        };
      }

      const parsed0 = parseErlangCursor(seg0.cursor);
      if (!parsed0) {
        // Cursor lạ → tuần tự từ trang 2
        let guard = 1;
        while (guard++ < 1500 && seg0.cursor && !stopped()) {
          const before = seg0.items.length;
          const res = await fetchPage(seg0.pageCount, seg0.cursor, seg0.items.length, { forceMulti: forceMultiEndpoint });
          if (!res.ok) { seg0.truncated = true; break; }
          const j = res.data || {};
          pushConvs(seg0, j.conversations || []);
          if (j.pages_with_current_count) seg0.pageCount = Object.assign({}, seg0.pageCount, j.pages_with_current_count);
          seg0.cursor = (j.conversations && j.conversations.length && j.next_cursor) ? j.next_cursor : null;
          if (onProgress) onProgress(seg0.items.length, seg0.items);
          if (!seg0.cursor || isRangeSatisfied(seg0.set)) break;
          if (seg0.items.length === before && (seg0.noAddStreak = (seg0.noAddStreak || 0) + 1) >= 10) { seg0.truncated = true; break; }
          if (seg0.items.length !== before) seg0.noAddStreak = 0;
        }
        const rangeDone = !!(seg0.cursor && !stopped() && isRangeSatisfied(seg0.set));
        if (seg0.cursor && !stopped() && !rangeDone) seg0.truncated = true;
        return { ok: true, rows: seg0.items, incomplete: !!seg0.truncated && !stopped(), stopped: stopped(), rangePartial: rangeDone };
      }

      const STRIDES = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 11];
      const samplePageId = parsed0.keyStr.split(':')[0] || String((p1.ids && p1.ids[0]) || '');
      const dummyKeyStr = samplePageId + ':' + samplePageId + '_99999999999999999999';
      const segments = [];
      let helpersDone = false;
      let strideIdx = 0;

      const stitch = () => {
        let changed = true;
        while (changed) {
          changed = false;
          for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.absorbed || !seg.items.length) continue;
            if (seg0.set.has(seg.items[0].id)) {
              for (let k = 0; k < seg.items.length; k++) {
                const r = seg.items[k];
                if (!seg0.set.has(r.id)) { seg0.set.add(r.id); r.order = seg0.items.length; seg0.items.push(r); }
              }
              if (seg.cursorReal) {
                const p0 = seg0.cursor ? parseErlangCursor(seg0.cursor) : null;
                const pS = seg.cursor ? parseErlangCursor(seg.cursor) : null;
                if (!seg.cursor || (p0 && pS && (pS.seenByte > p0.seenByte || (pS.seenByte === p0.seenByte && pS.tsMs < p0.tsMs)))) {
                  seg0.cursor = seg.cursor;
                  seg0.spanMs = seg.spanMs || seg0.spanMs;
                  seg0.pageCount = Object.assign({}, seg0.pageCount, seg.pageCount);
                }
              }
              seg.absorbed = true;
              changed = true;
            }
          }
          // đoạn phụ chạm nhau → nối lại để seg0 khâu 1 lần được đoạn dài hơn
          for (let i = 0; i < segments.length; i++) {
            const sa = segments[i];
            if (sa.absorbed || !sa.items.length) continue;
            for (let j = 0; j < segments.length; j++) {
              if (i === j) continue;
              const sb = segments[j];
              if (sb.absorbed || !sb.items.length) continue;
              if (sa.set.has(sb.items[0].id)) {
                for (let k = 0; k < sb.items.length; k++) {
                  const r = sb.items[k];
                  if (!sa.set.has(r.id)) { sa.set.add(r.id); sa.items.push(r); }
                }
                if (sb.cursorReal) {
                  const pA = sa.cursor ? parseErlangCursor(sa.cursor) : null;
                  const pB = sb.cursor ? parseErlangCursor(sb.cursor) : null;
                  if (!sb.cursor || (pA && pB && (pB.seenByte > pA.seenByte || (pB.seenByte === pA.seenByte && pB.tsMs < pA.tsMs)))) {
                    sa.cursor = sb.cursor; sa.spanMs = sb.spanMs || sa.spanMs;
                    sa.pageCount = Object.assign({}, sa.pageCount, sb.pageCount);
                  }
                }
                sb.absorbed = true;
                changed = true;
              }
            }
          }
        }
      };

      const spawnHelper = () => {
        const base = seg0.cursor ? parseErlangCursor(seg0.cursor) : null;
        if (!base || helpersDone) return;
        const mult = STRIDES[strideIdx++ % STRIDES.length];
        const seg = {
          ord: segments.length,
          items: [], set: new Set(),
          cursor: encodeErlangCursor(base.seenByte, base.tsMs - Math.round(Math.max(5000, seg0.spanMs || 600000) * mult), dummyKeyStr),
          pageCount: Object.assign({}, seg0.pageCount),
          spanMs: seg0.spanMs, estCount: seg0.items.length + Math.round(60 * mult),
          absorbed: false, cursorReal: false,
        };
        if (!seg.cursor) return;
        segments.push(seg);
        (async () => {
          // Luồng phụ chạy ĐỘC LẬP: cứ đi tiếp về phía cũ, khâu được lúc nào hay lúc đó;
          // treo/lỗi thì tự chết, tuyệt đối không chặn luồng gốc (không còn Promise.all theo vòng).
          while (!helpersDone && !stopped() && !seg.absorbed && seg.cursor) {
            // bị cắt giảm vì 429 → luồng phụ bậc cao tự rút, nhường hẳn đường cho luồng gốc
            if (rl.hits > 0 && (seg.ord || 0) >= rl.helperBudget) return;
            const res = await fetchPage(seg.pageCount, seg.cursor, seg.estCount + seg.items.length, { forceMulti: forceMultiEndpoint, tries: 2, timeoutMs: 10000 });
            if (!res.ok) {
              // v1.84.0: lỗi lẻ không giết luồng phụ nữa (chết sớm = mất hẳn 1 đường tải song song)
              if ((seg.errRetry = (seg.errRetry || 0) + 1) <= 6) { await sleepUntil(Date.now() + 1200 + Math.random() * 800); continue; }
              return;
            }
            seg.errRetry = 0;
            const j = res.data || {};
            const convs = j.conversations || [];
            if (!convs.length) { seg.cursor = null; return; }
            pushConvs(seg, convs);
            if (convs.length >= 2) seg.spanMs = estimatePageSpanMs(convs, seg.spanMs);
            if (j.pages_with_current_count) seg.pageCount = Object.assign({}, seg.pageCount, j.pages_with_current_count);
            seg.cursor = j.next_cursor || null;
            seg.cursorReal = true;
            stitch();
            if (onProgress) onProgress(seg0.items.length, seg0.items);
            if (isRangeSatisfied(seg0.set)) { helpersDone = true; return; }
          }
        })().catch(() => {});
      };

      if (rl.helperBudget > 0) {
        for (let h = 0; h < STRIDES.length; h++) spawnHelper();
      }

      // Luồng gốc: đi tuần tự, khâu đoạn nào dùng đoạn đó, xong là dừng hết luồng phụ
      let guard = 0;
      while (guard++ < 1500 && seg0.cursor && !stopped()) {
        const before = seg0.items.length;
        const res = await fetchPage(seg0.pageCount, seg0.cursor, seg0.items.length, { forceMulti: forceMultiEndpoint, tries: 3, timeoutMs: 12000 });
        if (!res.ok) {
          if (stopped() || res.error === 'stopped') break; // người dùng bấm dừng — không phải lỗi
          // v1.84.0: luồng gốc gặp lỗi lẻ (mạng chập chờn/server ì) thì nghỉ rồi tải tiếp ĐÚNG
          // cursor, tối đa 8 lần — danh sách chỉ thật sự hết khi server báo hết dữ liệu.
          seg0.errRetry = (seg0.errRetry || 0) + 1;
          if (seg0.errRetry === 1) logLine('⏸ Tải bị gián đoạn (' + (res.error || 'lỗi') + ') ở ' + seg0.items.length + ' chat — đang tự thử lại…');
          if (seg0.errRetry <= 8) { await sleepUntil(Date.now() + 2000); continue; }
          logLine('⚠ Không tải tiếp được sau 8 lần thử — danh sách CHƯA đầy đủ (' + seg0.items.length + ' chat), bấm tải lại để tiếp tục.');
          seg0.truncated = true;
          break;
        }
        seg0.errRetry = 0;
        const j = res.data || {};
        const convs = j.conversations || [];
        pushConvs(seg0, convs);
        if (convs.length >= 2) seg0.spanMs = estimatePageSpanMs(convs, seg0.spanMs);
        if (j.pages_with_current_count) seg0.pageCount = Object.assign({}, seg0.pageCount, j.pages_with_current_count);
        seg0.cursor = (convs.length && j.next_cursor) ? j.next_cursor : null;
        stitch();
        if (onProgress) onProgress(seg0.items.length, seg0.items);
        if (!seg0.cursor || isRangeSatisfied(seg0.set)) break;
        if (seg0.items.length === before) {
          // 1 trang không thêm được chat mới (dữ liệu trùng/chồng lấn) chưa phải là hết danh
          // sách — cursor đã tiến thì cứ đi tiếp; 10 trang liên tiếp như vậy mới coi là kẹt
          if ((seg0.noAddStreak = (seg0.noAddStreak || 0) + 1) >= 10) {
            seg0.truncated = true;
            logLine('⚠ Tải kẹt: 10 trang liên tiếp không thêm được chat mới ở ' + seg0.items.length + ' chat — danh sách CHƯA đầy đủ.');
            break;
          }
        } else seg0.noAddStreak = 0;
        // Bổ sung luồng phụ thay những luồng đã khâu/chết — nhưng không vượt ngân sách sống
        // (rl.helperBudget bị cắt một nửa sau mỗi lần server trả 429)
        const alive = segments.filter((s) => !s.absorbed && s.cursor).length;
        for (let s = alive; s < Math.min(STRIDES.length, rl.helperBudget); s++) spawnHelper();
      }
      helpersDone = true;
      const rangeDone2 = !!(seg0.cursor && !stopped() && isRangeSatisfied(seg0.set));
      // hết vòng lặp mà cursor vẫn còn (chưa đi tới cuối) = CHƯA đầy đủ (trừ khi dừng chủ đích vì đã chạm đủ vùng chọn)
      if (seg0.cursor && !stopped() && !rangeDone2) seg0.truncated = true;
      logLine('⚡⚡ Tải ' + (rangeDone2 ? 'đoạn chọn' : 'đa luồng 1 page') + ': ' + seg0.items.length + ' chat trong ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's'
        + ' (~' + Math.round(seg0.items.length / Math.max(1, (Date.now() - startedAt) / 1000)) + ' chat/giây)'
        + (rl.hits ? ' · 🧯 dính 429×' + rl.hits + ' (đã tự giảm luồng)' : '')
        + (seg0.truncated ? ' · ⚠ CHƯA ĐẦY ĐỦ' : ''));
      return { ok: true, rows: seg0.items, incomplete: !!seg0.truncated && !stopped(), stopped: stopped(), rangePartial: rangeDone2 };
    }
  }


  /* ============================ LỌC TAG "CHỐT"/"CHẶN" LÚC GỬI ============================
     Trong lúc chờ gửi, sale có thể đã gắn tag "…chốt" (đã chốt đơn — KHÔNG được gửi tiếp)
     hoặc tag "chặn". Lúc bấm Gửi: tải lại tag MỘT LƯỢT (API lọc sẵn theo tag) rồi bỏ qua. */

  // Bảng Map O(1) tra cứu nhanh conversation trong Redux store (tránh .find() O(N²) khi gửi 30.000 chat)
  let reduxDataArrRef = null, reduxDataMap = null;
  let reduxCloneArrRef = null, reduxCloneMap = null;
  function getReduxConvById(id, listIdx) {
    if (!id) return null;
    const sid = String(id);
    try {
      const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      const cs = st && st.conversations;
      if (!cs) return null;
      if (listIdx !== 1 && Array.isArray(cs.data)) {
        if (cs.data !== reduxDataArrRef) {
          reduxDataArrRef = cs.data;
          reduxDataMap = new Map();
          for (let i = 0; i < cs.data.length; i++) {
            const c = cs.data[i];
            if (c && c.id !== undefined) reduxDataMap.set(String(c.id), c);
          }
        }
        const hit = reduxDataMap.get(sid);
        if (hit) return hit;
      }
      if (listIdx !== 0 && Array.isArray(cs.filteredConversationsCloneList)) {
        if (cs.filteredConversationsCloneList !== reduxCloneArrRef) {
          reduxCloneArrRef = cs.filteredConversationsCloneList;
          reduxCloneMap = new Map();
          for (let i = 0; i < cs.filteredConversationsCloneList.length; i++) {
            const c = cs.filteredConversationsCloneList[i];
            if (c && c.id !== undefined) reduxCloneMap.set(String(c.id), c);
          }
        }
        const hit2 = reduxCloneMap.get(sid);
        if (hit2) return hit2;
      }
    } catch (e) { /* ignore */ }
    return null;
  }


  /* ============================ QUÉT TOÀN BỘ DANH SÁCH ============================ */

  function getScroller() {
    return $('#conversationList .rc-virtual-list-holder')
      || $('#conversationList .rc-virtual-list-holder')
      || $('.conversation-list .rc-virtual-list-holder')
      || $('#conversationList')
      || $('.conversation-list');
  }

  /* [v1.92.43c] DÙNG LẠI DANH SÁCH ĐÃ TẢI — mọi đường "cần danh sách mới" đều phải hỏi ý người
   * dùng trước. Người dùng nói rõ: "tôi nói chỉ tải danh sách khi tôi ấn". Trước đây chọn chuỗi
   * (completeRange) và chọn từ đây xuống cuối (⤓) LUÔN gọi API tải mới, kể cả khi danh sách vừa
   * tải vài giây trước — tốn hàng chục–hàng trăm request next_cursor và dính 429. */
  function normalizeListForReuse() {
    if (!state.allRows || !state.allRows.size) return false;
    if (state.listIncomplete) return false; // danh sách hỏng thì phải tải lại thật
    if (state.allRowsPartial) {
      // Danh sách đang là "tải tới đúng đoạn chọn rồi dừng" ⇒ đánh dấu đầy đủ để dùng cho cả
      // chuỗi dài. Có LỐI THOÁT: nếu 2 đầu chuỗi mới không nằm trong đó, completeRange tự tải lại.
      state.allRowsPartial = false;
      state.listIncomplete = false;
    }
    if (!state.listLoadedAt) state.listLoadedAt = Date.now();
    return true;
  }
  function listAgeText() {
    const sec = Math.max(0, Math.round((Date.now() - (state.listLoadedAt || 0)) / 1000));
    return sec < 90 ? (sec + 's') : (Math.round(sec / 60) + ' phút');
  }

  // ⚡ Tải danh sách: CHỈ API next_cursor tuần tự. Không cuộn DOM / virtual list.
  /* [v1.92.43d] BẤM ⚡ = TẢI MỚI TOÀN BỘ, không cần SHIFT.
   * Người dùng chốt: "không cần shift, ấn là tải lại hết". Bỏ hẳn cache-theo-thời-gian của nút ⚡.
   * Nguyên tắc còn lại chỉ là: **chỉ nút ⚡ mới phát request danh sách** — mọi đường chọn (chọn
   * chuỗi, chọn xuống cuối…) dùng danh sách đang giữ, không tự tải. */
  const LIST_CACHE_TTL_MS = 0; // không còn dùng để chặn nút ⚡; giữ tên cho code cũ
  async function scanFullList(opts) {
    if (state.sendListFrozen) {
      // [v1.92.43c] Lô đang gửi ⇒ danh sách đang có vẫn dùng được làm vùng khớp (miễn không quá cũ).
      if (state.allRows && state.allRows.size && !state.listIncomplete) {
        state.listLoadedAt = state.listLoadedAt || Date.now();
        logLine('🔒 Đang gửi nên KHÔNG tải danh sách — dùng danh sách đang giữ ('
          + state.allRows.size + ' chat, ' + listAgeText() + ' trước).');
      } else {
        logLine('🔒 Đang gửi nên KHÔNG tải danh sách — lượt chọn này chỉ khớp trên danh sách đang hiện.');
      }
      computeMatches();
      render();
      return;
    }
    const scanOpts = opts || {};
    /* [v1.92.43d] KHÔNG còn nhánh "dùng lại danh sách" ở đây: vào được hàm này = có lệnh tải thật
     * (chỉ nút ⚡ phát ra). Bấm ⚡ luôn tải mới toàn bộ. */
    if (state.scanning) {
      if (scanOpts.skipIfBusy) {
        // [v1.92.43c] Lượt quét CHỈ do người dùng bấm mới được phép chạy; lệnh tự động gặp lượt
        // đang chạy thì nhường, KHÔNG dừng lượt của người dùng.
        logLine('⏳ Đang tải danh sách — nhường lượt đang chạy (không dừng).');
        return;
      }
      if (scanOpts.restartIfBusy) {
        state.scanStopRequested = true;
        await waitCond(() => !state.scanning, 'scan-done', 4000); // [v1.92.9] thức NGAY khi lượt quét cũ kết thúc
      } else {
        /* [v1.92.43d] Bấm ⚡ trong lúc đang tải = "tải lại từ đầu": dừng lượt cũ rồi CHẠY LƯỢT MỚI
         * ngay (trước đây chỉ dừng rồi thoát, phải bấm lần 2). */
        state.scanStopRequested = true;
        logLine('🔁 Đang tải dở — dừng lượt cũ và tải lại từ đầu theo yêu cầu…');
        await waitCond(() => !state.scanning, 'scan-done', 4000);
      }
    }
    const btn = shadow && shadow.getElementById('ssb-scan');
    const setBtn = (t) => { if (btn) btn.textContent = t; };
    const prevAllRows = state.allRows;
    const prevAllRowsPartial = !!state.allRowsPartial;

    state.scanning = true;
    state.scanStopRequested = false;
    applyScanButtons();
    startKeepAliveAudio();
    state.listIncomplete = false;

    try {
      state.allRows = null;
      state.allRowsPartial = false;
      if (state.mode !== 'saved' && !scanOpts.forRange) state.matches = [];
      highlightRows();
      render();

      logLine(scanOpts.forRange
        ? '⚡ Đang tự tải danh sách tới đúng đoạn chat đã chọn…'
        : '⚡ Đang tải danh sách qua API (next_cursor, không cuộn)…');
      setBtn('⏹ Dừng tải (0 chat)');
      setScanProgress(0, 0);
      let lastLiveSync = 0;
      let lastSyncedLen = 0;
      const syncLiveRows = (rowsArr) => {
        if (!Array.isArray(rowsArr) || !rowsArr.length) return;
        const now = Date.now();
        if (now - lastLiveSync < 400) return;
        lastLiveSync = now;
        if (!state.allRows || rowsArr.length < lastSyncedLen) {
          state.allRows = new Map();
          lastSyncedLen = 0;
        }
        for (let i = lastSyncedLen; i < rowsArr.length; i++) {
          const r = rowsArr[i];
          r.order = i;
          state.allRows.set(r.id, r);
        }
        lastSyncedLen = rowsArr.length;
        const cntEl = shadow && shadow.getElementById('ssb-count');
        if (cntEl && !scanOpts.forRange) cntEl.textContent = String(state.allRows.size);
      };

      const apiProgress = (n, rowsArr) => {
        setBtn('⏹ Dừng tải (' + n + ' chat)');
        syncLiveRows(rowsArr);
        setScanProgress(n, null);
      };
      let api = await loadListViaApi(apiProgress, scanOpts);
      if (state.scanStopRequested || (api && api.stopped)) {
        const nStop = (api && api.rows && api.rows.length) || (state.allRows && state.allRows.size) || 0;
        if (api && api.rows && api.rows.length) {
          const foundStop = new Map(api.rows.map((r) => [r.id, { ...r }]));
          if (scanOpts.forRange && prevAllRows && prevAllRows.size) {
            prevAllRows.forEach((v, k) => { if (!foundStop.has(k)) foundStop.set(k, { ...v }); });
          }
          let oStop = 0;
          foundStop.forEach((v) => { v.order = oStop++; });
          state.allRows = foundStop;
        } else if (prevAllRows && prevAllRows.size) {
          state.allRows = prevAllRows;
        }
        state.allRowsPartial = true;
        state.listIncomplete = false;
        logLine('⏹ Đã dừng tải — dùng ' + nStop + ' chat đã lấy.');
        setBtn('⚡ Tải danh sách (' + ((state.allRows && state.allRows.size) || nStop) + ' chat)');
        setScanProgress(nStop, 100);
        computeMatches();
        render();
        return;
      }
      if (api && api.ok && api.incomplete && !api.stopped) {
        logLine('⚠ Lần 1 chưa hết cursor (' + api.rows.length + ' chat) — tải lại từ đầu…');
        lastSyncedLen = 0;
        state.allRows = null;
        const api2 = await loadListViaApi(apiProgress, scanOpts);
        if (api2 && api2.ok) api = api2;
      }
      /* [v1.92.44] TẢI THIẾU KHÔNG ĐƯỢC ĐỒNG NGHĨA VỚI "KHÔNG DÙNG ĐƯỢC GÌ".
       * Bản cũ: sau 2 lượt vẫn thiếu ⇒ `state.allRows = prevAllRows || null` (thường là null
       * vì đầu lượt đã xoá) + `listIncomplete = true` ⇒ `sendToAll` CHẶN TOÀN BỘ, kể cả những
       * chat đã tải ĐÚNG. Người dùng buộc phải bấm ⚡ lại cho tới khi hết lỗi mới gửi được.
       * Nay: vẫn giữ nguyên danh sách vừa tải (đúng phần đã lấy), chỉ đánh dấu CHƯA ĐẦY ĐỦ
       * ⇒ `sendToAll` vẫn cho gửi phần đã chọn, còn "chọn tất cả" thì bị chặn vì có thể sót.
       * Tin nhắn không bao giờ bị mất: phần thiếu thì KHÔNG nằm trong lựa chọn. */
      if (api && api.ok && api.incomplete && !api.stopped) {
        const rowsPartial = (api.rows || []).slice();
        state.listIncomplete = true;             // CHƯA ĐẦY ĐỦ (chặn "chọn tất cả"), không chặn gửi
        if (rowsPartial.length) {
          const partialMap = new Map(rowsPartial.map((r) => [r.id, { ...r }]));
          let oP = 0;
          partialMap.forEach((v) => { v.order = oP++; });
          state.allRows = partialMap;
          state.allRowsPartial = true;
          logLine('🟡 Tải 2 lần vẫn thiếu' + (api.incompletePages && api.incompletePages.length
            ? ' (' + api.incompletePages.slice(0, 5).join(', ') + ')' : '')
            + ' — GIỮ ' + partialMap.size + ' chat đã tải được. Gửi phần này vẫn được; '
            + '"chọn tất cả" bị chặn cho tới khi tải đủ (bấm ⚡ lại).');
          setBtn('⚡ Tải danh sách (' + partialMap.size + ' chat · còn thiếu)');
          setScanProgress(partialMap.size, null);
          computeMatches();
          render();
          return;
        }
        state.allRows = prevAllRows || null;
        state.allRowsPartial = prevAllRowsPartial;
        logLine('⛔ Tải 2 lần vẫn chưa hết cursor (0 chat lấy được) — bấm ⚡ lại.');
        setBtn('⚠ Tải chưa đủ — bấm tải lại');
        setScanProgress(0, null);
        return;
      }
      if (!(api && api.ok && api.rows.length)) {
        if (prevAllRows && prevAllRows.size) {
          state.allRows = prevAllRows;
          state.allRowsPartial = prevAllRowsPartial;
        }
        logLine('⚠ ' + ((api && api.error) || 'Tải API thất bại'));
        setBtn('⚠ Tải API lỗi — bấm tải lại');
        return;
      }
      const vis = visibleRows();
      const found = new Map(api.rows.map((r) => [r.id, { ...r }]));
      if (scanOpts.forRange && prevAllRows && prevAllRows.size) {
        prevAllRows.forEach((v, k) => {
          if (!found.has(k)) found.set(k, { ...v });
        });
      }
      vis.forEach((r) => {
        if (found.has(r.id)) {
          const cur = found.get(r.id);
          found.set(r.id, { ...cur, ...r, pageId: cur.pageId || r.pageId, type: r.type || cur.type });
        }
      });
      let ord = 0;
      found.forEach((v) => { v.order = ord++; });
      state.allRows = found;
      state.listLoadedAt = Date.now(); // [v1.92.43] mốc để dùng lại danh sách (không tải lại)
      /* [v1.92.43c] Vùng chọn dừng ở cuối chuỗi ⇒ danh sách KHÔNG phải toàn bộ. Dùng lại được cho
       * chuỗi nằm trong vùng này, nhưng KHÔNG được coi là đầy đủ cho "chọn tất cả" hay chuỗi khác
       * vượt ra ngoài — những đường đó tự kiểm 2 đầu và tải bổ sung. */
      state.allRowsPartial = !!(api && api.rangePartial);
      state.listIncomplete = false;
      setBtn('⚡ Tải danh sách (' + found.size + ' chat)');
      setScanProgress(api.rows.length, 100);
      logLine((api && api.rangePartial)
        ? ('⚡ Đã tự tải xong vùng chọn (' + api.rows.length + ' chat tới cuối chuỗi chọn)')
        : ('⚡ API: ' + found.size + ' chat (next_cursor hết) — không cuộn list'));
      computeMatches();
      render();
    } finally {
      state.scanning = false;
      softNotify('scan-done'); // [v1.92.9]
      state.scanStopRequested = false;
      applyScanButtons();
      stopKeepAliveAudio();
      if (!state.sending) reportExtJob({ phase: 'idle' });
      if (btn && state.listIncomplete) {
        setBtn('⚠ Tải chưa đủ — bấm tải lại');
      } else if (btn && state.allRows) {
        setBtn('⚡ Tải danh sách (' + state.allRows.size + ' chat)');
      } else if (btn) {
        setBtn('⚡ Tải danh sách');
      }
    }
  }

  /* ============================ GỬI TIN (API → EXTENSION → GIAO DIỆN) ============================ */

  // Đọc conversation từ redux store của trang (hoặc bảng allRows đã tải qua API) — có đủ
  // last_customer_interactive_at, customers, customerId, threadId, threadKey, updatedAt…
  function peekConv(conv) {
    try {
      if (conv && conv.id) {
        const hit = getReduxConvById(conv.id, 0);
        if (hit) return hit;
        if (state && state.allRows && state.allRows.has(conv.id)) {
          return state.allRows.get(conv.id);
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // ---- DỮ LIỆU CHAT: NẠP ĐÚNG NGUỒN CỦA APP (HAR tinnhan.har + tinnhan1.har) ----
  // GET /v1/pages/{p}/conversations/{id}/messages?customer_id=…&user_view=true&is_new_api=true
  // &separate_pos=true — request app gọi MỖI LẦN MỞ CHAT — trả về:
  //   - customers[0].ad_clicks + ad_clicks map → dr() quyết cờ is_record_ctx_7_days;
  //   - global_id (đúng ID KHÁCH — nhiều khách ≠ PSID! tinnhan1.har: "61576542790011",
  //     "100025260544548"… — app gửi Ext/Socket bằng id NÀY, không phải from_psid).
  // LIST chat KHÔNG có 2 thứ này → gửi hàng loạt mà không nạp = thiếu cờ (#10 oan) + bắn nhầm id
  // (Ext "không gửi được", Socket "server báo gửi thất bại") — đúng 2 triệu chứng trong log.
  const convCtxCache = {}; // convId → { ad_clicks, gid, fetched, httpState, gidSource }

  // THỐNG KÊ KHÂU DÒ GLOBAL_ID THEO LƯỢT (in ở TỔNG HỢP): trước đây mọi kết quả
  // "chưa lấy được" bị gộp thành "không tìm thấy", không biết nghẽn ở nguồn nào.
  // Số ở đây đếm theo LẦN PHÂN GIẢI (1 chat có thể được dò lại ở Pass 2), dùng để
  // đối chiếu nguồn nào đang nghẽn chứ không phải số chat duy nhất.
  const gidStats = {
    cacheHit: 0, httpHit: 0, httpNoGid: 0, httpFail: 0, http429: 0,
    wsHit: 0, extHit: 0, extUnknown: 0, unknown: 0, batchMappings: 0,
    batchReturned: 0, batchFail: 0, extRespondedNoGid: 0, gateSkip: 0,
    shortNoGidWait: 0,
    /* [v1.93.13] ext TÌM ĐƯỢC thread nhưng `isThreadCorrect()` sai ⇒ `Ee.init()` reject
     * "INCORRECT THREAD". Tách khỏi `extUnknown` (im lặng) để đọc đúng sức khoẻ làn Ext. */
    extIncorrectThread: 0,
    /* [v1.93.14] ĐỌC LỊCH SỬ TRỰC TIẾP TỪ FB qua `LOAD_FACEBOOK_MESSAGES`:
     * `fbDirectMessages` = số lần lệnh trả được danh sách tin;
     * `fbDirectSavedGid` = số lần lấy được `globalId` từ chính phản hồi đó (nguồn gid THẬT,
     * không phụ thuộc `ENABLE_FIND_THREAD_BY_USERNAME`, không cần 4 nguồn `Ee.init`). */
    fbDirectMessages: 0, fbDirectSavedGid: 0,
  };
  function resetGidStats() {
    Object.keys(gidStats).forEach((k) => { gidStats[k] = 0; });
  }

  function adClicksFromPayload(j) {
    if (!j) return null;
    const custs = j.customers || (j.data && j.data.customers) || [];
    const c0 = Array.isArray(custs) ? custs[0] : null;
    if (c0 && Array.isArray(c0.ad_clicks) && c0.ad_clicks.length) return c0.ad_clicks;
    const map = j.ad_clicks || (j.data && j.data.ad_clicks);
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      const ks = Object.keys(map);
      for (let i = 0; i < ks.length; i++) {
        const v = map[ks[i]];
        if (Array.isArray(v) && v.length) return v;
      }
    }
    return null;
  }

  // global_id THẬT từ payload tải chat (ưu tiên customers[].global_id — khớp @298730 trong _app)
  function gidFromPayload(j) {
    if (!j) return '';
    const custs = j.customers || (j.data && j.data.customers) || j.conv_customers || [];
    if (Array.isArray(custs)) {
      for (let i = 0; i < custs.length; i++) {
        if (custs[i] && custs[i].global_id) return String(custs[i].global_id);
      }
    }
    // [v1.91.82] ĐO can_inbox — cờ "page còn quyền nhắn khách" của Facebook.
    // HAR: có mặt trong 91/91 lần đọc tin (4 false / 87 true). CHỈ ĐẾM, không dùng để
    // quyết định bỏ gửi: mẫu 4/91 quá nhỏ, bỏ gửi theo nó có thể làm lọt khách còn sống.
    try {
      if (typeof sendDiag === 'object' && sendDiag && typeof j.can_inbox === 'boolean') {
        sendDiag.canInboxSeen = (sendDiag.canInboxSeen || 0) + 1;
        if (j.can_inbox === false) sendDiag.canInboxFalse = (sendDiag.canInboxFalse || 0) + 1;
      }
    } catch (e0) { /* ignore */ }
    if (j.global_id) return String(j.global_id);
    if (j.page_customer && j.page_customer.global_id) return String(j.page_customer.global_id);
    return '';
  }

  // Tính thời gian (ms) kể từ tương tác cuối của KHÁCH (last_customer_interactive_at / lastAt).
  // Khớp chuẩn dr() trong _app: cửa sổ 24h của Facebook chỉ tính theo tin nhắn cuối của KHÁCH
  // (last_customer_interactive_at), TUYỆT ĐỐI không tính theo updated_at khi <24h (vì nhân viên gắn tag
  // hoặc gửi tin cũng làm updated_at mới lên, từng gây ra 169 lần bắn nhầm vào API bị chặn ngoài 24h!).
  function getConvIdleMs(conv, full) {
    const f = full || conv || {};
    const c = conv || f || {};
    const rawCustIdle = f.last_customer_interactive_at || f.lastAt || c.lastAt || '';
    if (rawCustIdle) {
      const t = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(rawCustIdle) ? rawCustIdle : rawCustIdle + 'Z');
      if (!isNaN(t)) return Date.now() - t;
    }
    // Nếu object hội thoại có updated_at/inserted_at từ API nhưng last_customer_interactive_at === null
    // → khách chưa từng nhắn lại hoặc đã quá hạn từ lâu → chắc chắn ngoài 24h!
    const rawUpd = f.updated_at || f.updatedAt || c.updatedAt || f.inserted_at || '';
    if (rawUpd) {
      const tUpd = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(rawUpd) ? rawUpd : rawUpd + 'Z');
      if (!isNaN(tUpd)) return Math.max(Date.now() - tUpd, 2 * 86400000);
    }
    const tm = String(c.time || f.time || '').trim();
    if (tm && (/\/|\bTh\s*\d|\bCN\b|\b20\d{2}\b/i.test(tm))) {
      const m = /(\d{1,2})\/(\d{1,2})$/.exec(tm);
      if (m) {
        const now = new Date();
        if (Number(m[1]) === now.getDate() && Number(m[2]) === (now.getMonth() + 1)) return 3600000;
      }
      return 2 * 86400000;
    }
    return NaN;
  }

  // nạp dữ liệu chat (ad_clicks + global_id) đúng request app khi mở chat. force=true → nạp ngay
  // cả khi chat có vẻ trong 24h (khi Ext/Socket cần global_id). Cache theo chat — CHỈ gọi mạng khi thật sự cần.
  async function ensureConvCtx(conv, opts) {
    const o = opts || {};
    const cid = conv && conv.id;
    if (!cid) {
      convCtxCache.__empty = convCtxCache.__empty || { ad_clicks: null, gid: '', fetched: true };
      return convCtxCache.__empty;
    }
    let entry = convCtxCache[cid];
    if (entry && entry.fetched) return entry; // đã nạp thành công qua mạng — không gọi lại
    entry = entry || {
      ad_clicks: null, gid: '', fetched: false, inflight: null,
      httpState: '', httpError: '', httpAttempts: 0, gidSource: '',
    };
    if (!entry.httpState) entry.httpState = '';
    if (!entry.gidSource) entry.gidSource = '';
    const full = peekConv(conv) || conv;
    // 1) có sẵn trong dữ liệu conv (bản ghi đầy đủ / dòng list) — khỏi gọi mạng
    if (!entry.ad_clicks) {
      entry.ad_clicks = adClicksFromPayload(full) || (full.customers && full.customers[0]
        && Array.isArray(full.customers[0].ad_clicks) && full.customers[0].ad_clicks.length
        ? full.customers[0].ad_clicks : null);
    }
    const pid = full.page_id || full.pageId || (conv && conv.pageId) || String(cid).split('_')[0];
    const tid = String(full.thread_id || full.threadId || (conv && (conv.thread_id || conv.threadId)) || '');
    if (!entry.gid) {
      entry.gid = String(gidFromPayload(full) || full.globalId || (conv && conv.globalId)
        || (full.customers && full.customers[0] && full.customers[0].global_id) || '');
      if (entry.gid) entry.gidSource = 'conv';
    }
    if (!entry.gid) {
      try {
        const g1 = window.__GlobalIdCacheTest__, g2 = window.__tempGlobalIdCache__;
        const tKey = (pid && tid) ? (pid + '_' + tid) : '';
        entry.gid = String((g1 && g1.get(cid)) || (g2 && g2.get(cid))
          || (tKey && ((g1 && g1.get(tKey)) || (g2 && g2.get(tKey)))) || '');
        if (entry.gid) entry.gidSource = 'cache';
      } catch (e) { /* ignore */ }
    }
    if (!entry.gid && pid && tid) {
      try {
        const mh = window.__MqttHelper__;
        const sk = mh && mh.SOCKETS && mh.SOCKETS[pid];
        const ip = sk && sk.context && sk.context.initPageData;
        const mGid = ip && ((ip.threadMapping && ip.threadMapping[tid])
          || (ip.threadMappingStoreV2 && ip.threadMappingStoreV2[tid]));
        if (mGid) {
          entry.gid = String(mGid);
          entry.gidSource = 'ws';
          if (typeof window.__botfakeSaveGid__ === 'function') {
            window.__botfakeSaveGid__(cid, pid, tid, entry.gid);
          }
        }
      } catch (e) { /* ignore */ }
    }
    if (entry.gid && entry.ad_clicks && entry.ad_clicks.length) {
      entry.fetched = true; convCtxCache[cid] = entry; return entry; // đủ cả 2 — khỏi gọi mạng
    }
    // 2) Kiểm tra mốc thời gian tương tác cuối (idle):
    //    - Đang trong 24h (< 1 ngày) và chưa force: đi thẳng API, không cần gọi GET /messages.
    //    - Đã quá 7 ngày (> 7 ngày) hoặc page tắt ctx_7_days_enabled: cờ 7 ngày quảng cáo chắc chắn false;
    //      lúc này nếu chưa force (hoặc đã có sẵn entry.gid từ cache/WebSocket) thì trả về ngay trong 0ms!
    const idleMs = getConvIdleMs(conv, full);
    if (!o.force && !isNaN(idleMs) && idleMs < 86400000) {
      convCtxCache[cid] = entry; return entry;
    }
    let mayNeed7Days = true;
    if (!isNaN(idleMs) && idleMs > 7 * 86400000) {
      mayNeed7Days = false;
    } else {
      try {
        const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
        const pgs = st && st.pages;
        const p = pgs && ((pgs.activatedMap && pgs.activatedMap[pid])
          || (Array.isArray(pgs.activated) && pgs.activated.find((x) => x && x.id === pid)));
        if (p && (!p.platform_extra_info || !p.platform_extra_info.ctx_7_days_enabled)) {
          mayNeed7Days = false;
        }
      } catch (e) { /* ignore */ }
    }
    if (entry.gid && (!mayNeed7Days || (entry.ad_clicks && entry.ad_clicks.length))) {
      convCtxCache[cid] = entry; return entry;
    }
    if (!o.force && !mayNeed7Days) {
      convCtxCache[cid] = entry; return entry;
    }
    // 3) nạp đúng request app gọi khi mở chat (lấy customerId từ cả row convApiRow lẫn full.customers)
    const custId = String(full.customerId || (conv && conv.customerId)
      || (full.customers && full.customers[0] && full.customers[0].id)
      || (conv && conv.customers && conv.customers[0] && conv.customers[0].id) || '');
    if (!custId && !o.force) { convCtxCache[cid] = entry; return entry; }
    if (entry.inflight) return entry.inflight;
    convCtxCache[cid] = entry;
    entry.inflight = ctxFetchLane(async () => {
      const startedAt = Date.now();
      let fetchStartedAt = startedAt;
      entry.httpAttempts = (entry.httpAttempts || 0) + 1;
      try {
        // Đang trong cơn 429 của Pancake: mọi request dò mới cùng chờ hết giờ
        // nghỉ chung thay vì tiếp tục đâm vào server (tự làm nghẽn nặng hơn).
        await waitGidHttpCooldown();
        if (state.stopRequested) return entry;
        fetchStartedAt = Date.now();
        const url = apiBase() + '/v1/pages/' + pid
          + '/conversations/' + encodeURIComponent(cid)
          + '/messages?customer_id=' + encodeURIComponent(custId)
          + '&user_view=true&is_new_api=true&separate_pos=true';
        const res = await fetchJson(url, 2, { timeoutMs: 10000 });
        const latencyMs = Date.now() - fetchStartedAt;
        if (res.ok && res.data && res.data.success !== false) {
          const j = res.data;
          entry.ad_clicks = entry.ad_clicks || adClicksFromPayload(j) || null;
          const httpGid = gidFromPayload(j) || '';
          if (!entry.gid && httpGid) {
            entry.gid = String(httpGid);
            entry.gidSource = 'http';
          }
          // Khớp 100% @298730 trong _app: n.customers.forEach(t => t.fb_id && t.global_id && b.Z.set(e + "_" + t.fb_id, t.global_id))
          if (Array.isArray(j.customers)) {
            j.customers.forEach((t) => {
              if (t && t.fb_id && t.global_id && typeof window.__botfakeSaveGid__ === 'function') {
                window.__botfakeSaveGid__(pid + '_' + t.fb_id, pid, tid, String(t.global_id));
              }
            });
          }
          const c0 = (Array.isArray(j.customers) && j.customers[0])
            || (Array.isArray(j.conv_customers) && j.conv_customers[0]) || null;
          if (c0 && conv) {
            if (!conv.customerId && c0.id) conv.customerId = String(c0.id);
            if (!conv.fromPsid && c0.fb_id) conv.fromPsid = String(c0.fb_id);
            if (!conv.globalId && (c0.global_id || entry.gid)) conv.globalId = String(c0.global_id || entry.gid);
            if ((!Array.isArray(conv.customers) || !conv.customers.length) && Array.isArray(j.customers)) {
              conv.customers = j.customers.map((x) => ({
                id: x && x.id, fb_id: x && x.fb_id, name: x && x.name,
                global_id: x && x.global_id, ad_clicks: x && x.ad_clicks,
              }));
            }
            if (state.allRows && state.allRows.has(cid)) {
              const ar = state.allRows.get(cid);
              if (ar) {
                if (!ar.customerId && conv.customerId) ar.customerId = conv.customerId;
                if (!ar.fromPsid && conv.fromPsid) ar.fromPsid = conv.fromPsid;
                if (!ar.globalId && conv.globalId) ar.globalId = conv.globalId;
              }
            }
          }
          if (entry.gid) {
            try {
              if (typeof window.__botfakeSaveGid__ === 'function') {
                window.__botfakeSaveGid__(cid, pid, tid, String(entry.gid));
              }
              window.__GlobalIdCacheTest__ && window.__GlobalIdCacheTest__.set(cid, String(entry.gid));
              window.__tempGlobalIdCache__ && window.__tempGlobalIdCache__.set(cid, String(entry.gid));
            } catch (e2) { /* ignore */ }
          }
          // CHỈ đánh dấu fetched=true khi request thành công (tránh lỗi 429/mạng làm mất vĩnh viễn gid của 3.000 chat sau)
          entry.fetched = true;
          entry.httpState = entry.gid ? 'ok-gid' : 'ok-no-gid';
          entry.httpError = '';
          /* [v1.93.6] ĐẾM ĐỦ MỌI NGUỒN — TRƯỚC ĐÂY CHỈ ĐẾM `gidSource === 'http'`.
           * ĐO ĐƯỢC: 0/28 log có `HTTP n` khác 0, trong khi chính các dòng đó in
           * `cache 10976` · `cache 11796` — tức HTTP ĐÃ trả gid nhưng bị tính vào cache.
           * Xem đường gán: `gidSource` nhận 'conv' (khi đọc từ đối tượng hội thoại) và
           * 'server-no-gid'/'http-unknown' — nên điều kiện `=== 'http'` gần như không bao
           * giờ đúng. Chẩn đoán in 0 ⇒ mọi kết luận "HTTP không trả gid" đều VÔ CĂN CỨ.
           * Nay: đếm mọi gid mà request HTTP này mang về (trừ khi nó chỉ đọc lại cache).
           * Chỉ sửa SỐ ĐO, không đổi nhánh gửi/bù nào. */
          if (entry.gid && entry.gidSource !== 'cache') gidStats.httpHit++;
          else if (!entry.gid) gidStats.httpNoGid++;
          noteGidHttpResult(true, 200, latencyMs);
        } else {
          const errText = String((res && res.error) || (res && res.data && (res.data.message || res.data.error)) || 'HTTP lỗi');
          const statusMatch = /HTTP\s+(\d{3})/.exec(errText);
          const status = statusMatch ? Number(statusMatch[1]) : 0;
          entry.httpState = status === 429 ? 'http-429' : 'http-fail';
          entry.httpError = errText;
          gidStats.httpFail++;
          if (status === 429) gidStats.http429++;
          noteGidHttpResult(false, status, latencyMs);
        }
      } catch (e) {
        // mạng lỗi — chưa set fetched=true để lần force sau còn thử lại
        entry.httpState = 'http-fail';
        entry.httpError = String(e && e.message || e || 'Lỗi mạng');
        gidStats.httpFail++;
        noteGidHttpResult(false, 0, Date.now() - fetchStartedAt);
      }
      entry.inflight = null;
      return entry;
    }).then(() => { entry.inflight = null; return entry; }); // lane không chạy fn (bấm Dừng) cũng phải nhả inflight
    return entry.inflight;
  }

  // Tự động tải ngầm dữ liệu của đúng những đoạn chat người dùng vừa chọn (Socket + global_id + messages context)
  // ngay lúc chọn để khi bấm Chạy là gửi tức thì không phải chờ nạp!
  let preloadSelectedTimer = null;
  let preloadSelectedSeq = 0;
  let preloadForceLogPending = false;

  function schedulePreloadSelectedChats(forceLog) {
    if (forceLog) preloadForceLogPending = true;
    if (preloadSelectedTimer) clearTimeout(preloadSelectedTimer);
    preloadSelectedTimer = setTimeout(() => {
      preloadSelectedTimer = null;
      const fl = preloadForceLogPending;
      preloadForceLogPending = false;
      preloadSelectedChats(fl).catch(() => {});
    }, 120);
  }

  async function preloadSelectedChats(forceLog) {
    if (state.sending || state.scanning) return;
    const selected = (state.matches || []).filter((m) => m && m.checked);
    if (!selected.length) return;
    const mySeq = ++preloadSelectedSeq;

    // 1) Làm nóng sẵn WebSocket + yêu cầu BATCH_GET_GLOBAL_ID cho các đoạn chat đã chọn
    try { if (typeof warmUpSockets === 'function') warmUpSockets(selected); } catch (e) { /* ignore */ }

    // 2) Với các lựa chọn vừa và nhỏ (<= 150 chat), LUÔN tự động nạp sẵn dữ liệu hội thoại (ensureConvCtx:
    //    GET .../messages -> global_id, ad_clicks, customers) cho toàn bộ các đoạn được chọn,
    //    bất kể trước đó đã có danh sách (state.allRows) hay chưa!
    const MAX_PRELOAD = 150;
    const targets = selected.slice(0, MAX_PRELOAD).filter((c) => {
      if (!c || !c.id) return false;
      const entry = convCtxCache[c.id];
      if (entry && entry.fetched) return false;
      return true;
    });
    if (!targets.length) {
      if (forceLog && !state.sending && !state.scanning && preloadSelectedSeq === mySeq) {
        logLine('⚡ Đã tự tải sẵn dữ liệu ' + selected.length + ' đoạn chat đã chọn — sẵn sàng gửi ngay!');
      }
      return;
    }

    let idx = 0;
    let fetchedCount = 0;
    const CONC = Math.min(4, targets.length);
    const workers = [];
    for (let w = 0; w < CONC; w++) {
      workers.push((async () => {
        while (idx < targets.length) {
          if (state.sending || state.scanning || preloadSelectedSeq !== mySeq) return;
          const c = targets[idx++];
          if (!c) continue;
          try {
            const beforeFetched = !!(convCtxCache[c.id] && convCtxCache[c.id].fetched);
            const ent = await ensureConvCtx(c, { force: true });
            if (!beforeFetched && ent && ent.fetched) fetchedCount++;
          } catch (e) { /* ignore */ }
        }
      })());
    }
    await Promise.all(workers);
    if ((fetchedCount > 0 || forceLog) && !state.sending && !state.scanning && preloadSelectedSeq === mySeq) {
      logLine('⚡ Đã tự tải sẵn dữ liệu ' + selected.length + ' đoạn chat đã chọn — sẵn sàng gửi ngay!');
    }
  }

  // Cờ is_record_ctx_7_days — đúng điều kiện hàm dr() trong _app (gửi ngoài cửa sổ 24h
  // cho khách từ quảng cáo trong 7 ngày, page phải bật platform_extra_info.ctx_7_days_enabled):
  //  1) nền tảng fb/ig/wa + khách ≥1 ngày không tương tác (hoặc không rõ thời điểm)
  //  2) page bật ctx_7_days_enabled
  //  3) khách có ad_clicks (click quảng cáo) mới nhất ≤7 ngày
  // KHÔNG ngoại lệ: thiếu dữ liệu ad_clicks → không bật cờ (không bịa thêm — app cũng vậy).
  // Nguồn ad_clicks: cache từ ensureAdClicks (đúng đường app) → store messages.customers → dữ liệu chat.
  function isRecordCtx7Days(full) {
    try {
      if (!full) return false;
      const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      if (!st) return false;
      const idle = full.last_customer_interactive_at || full.lastAt || '';
      if (idle) {
        const t = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(idle) ? idle : idle + 'Z');
        if (!isNaN(t) && (Date.now() - t) < 86400000) return false; // mới tương tác <1 ngày
      }
      const pages = st.pages || {};
      const map = pages.activatedMap || {};
      const arr = pages.activated || [];
      const pid = full.page_id || full.pageId || String(full.id || '').split('_')[0];
      const p = map[pid] || arr.find((x) => x && x.id === pid);
      if (!p || !p.platform_extra_info || !p.platform_extra_info.ctx_7_days_enabled) return false;
      // đúng dr(): chỉ fb/ig/wa (thiếu field platform → để yên, không loại oan)
      const plat = p.platform || p.currentPlatform || st.currentPlatform || '';
      if (plat && ['facebook', 'instagram_official', 'whatsapp_official'].indexOf(plat) < 0) return false;
      let clicks = null;
      // 1) cache từ ensureConvCtx — nguồn app dùng khi tải chat (HAR)
      const cc = convCtxCache[full.id || full.convId || ''];
      if (cc && Array.isArray(cc.ad_clicks) && cc.ad_clicks.length) clicks = cc.ad_clicks;
      const mc = st.messages && st.messages.customers;
      const custId = (full.customers && full.customers[0] && full.customers[0].id) || (full.from && full.from.id);
      const custFb = full.from && full.from.id;
      if (!clicks && Array.isArray(mc)) {
        const c = mc.find((x) => x && (x.id === custId || x.id === custFb || x.fb_id === custFb));
        if (c && Array.isArray(c.ad_clicks)) clicks = c.ad_clicks;
      }
      if (!clicks && full.customers && full.customers[0] && Array.isArray(full.customers[0].ad_clicks)) {
        clicks = full.customers[0].ad_clicks;
      }
      if (!clicks) {
        const fromPayload = adClicksFromPayload(full);
        if (fromPayload) clicks = fromPayload;
      }
      if (!clicks || !clicks.length) {
        // THIẾU ad_clicks → KHÔNG bật cờ — đúng dr() của app và đúng luật "không bịa thêm":
        // app chỉ thêm is_record_ctx_7_days khi ĐÁNH GIÁ ĐƯỢC cửa sổ 7 ngày quảng cáo.
        // Chat ngoài 24h không có cờ → API có thể #551 → bù Socket (đường gửi tay) tự lo.
        // (Bản v1.39.0 từng "bật cờ phỏng đoán" — gán cờ bừa khi không có dữ liệu → bị loại.)
        return false;
      }
      let latest = 0;
      clicks.forEach((x) => {
        if (!x || !x.inserted_at) return;
        if (!['ads', null, undefined].includes(x.type)) return;
        const t = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(x.inserted_at) ? x.inserted_at : x.inserted_at + 'Z');
        if (!isNaN(t) && t > latest) latest = t;
      });
      return !!latest && (Date.now() - latest) <= 7 * 86400000;
    } catch (e) { return false; }
  }

  /* ============================ CHAT BÌNH LUẬN (type COMMENT) ============================
     Chat bình luận KHÔNG gửi được reply_inbox (Facebook trả "(#551) Người này hiện không có mặt").
     Đúng đường app dùng khi nhân viên bấm gửi trong chat bình luận (CommentSender trong _app):
       - executeByApi:  POST …/conversations/{id}/messages  (JSON)
                        { action:"reply_comment", message_id, parent_id, post_id, message, content_url? }
                        hoặc action:"reply_post" khi chat = chính bài viết của khách
       - executeByExtOnce: type "SEND_COMMENT" {pageId, fbPageId, postId, commentId, message, photoUrl?}
     "message_id/parent_id" = bình luận của khách mới nhất — đúng bộ lọc sendToInbox trong _app. */

  // Tên page + linked_fb_page (SEND_COMMENT cần currentPageName/linkedFbPage — lấy từ redux store trang)
  function pageMeta(pageId) {
    try {
      const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      const pages = st && st.pages;
      const map = (pages && pages.activatedMap) || {};
      const arr = (pages && pages.activated) || [];
      const p = map[pageId] || arr.find((x) => x && x.id === pageId) || {};
      return {
        name: p.name || '',
        fbPageId: (p.platform_extra_info && p.platform_extra_info.linked_fb_page) || null,
      };
    } catch (e) { return { name: '', fbPageId: null }; }
  }

  // Lấy bình luận của khách để trả lời — đúng request + bộ lọc của app (sendToInbox):
  // GET …/conversations/{id}/messages?customer_id=…&user_view=true&is_new_api=true&separate_pos=true
  // lọc: tin của khách (from ≠ page), chưa xóa, không SYSTEM_MESSAGE → lấy mới nhất
  async function fetchCommentTarget(full, pageId, convId, ctx) {
    ctx = ctx || {};
    if (ctx.targetLoaded) return ctx.target || null;
    const token = getToken();
    if (!token) return null;
    const customerId = (full.from && full.from.id) || '';
    const url = apiBase() + '/v1/pages/' + pageId
      + '/conversations/' + encodeURIComponent(convId)
      + '/messages?customer_id=' + encodeURIComponent(customerId)
      + '&access_token=' + encodeURIComponent(token)
      + '&user_view=true&is_new_api=true&separate_pos=true';
    const res = await fetchJson(url, 2);
    if (!res.ok || !res.data) return null;
    const j = res.data;
    if (j.success === false) return null;
    const msgs = j.messages || (j.data && j.data.messages) || [];
    const target = msgs.slice().reverse().find((m) => m && m.from && m.from.id !== pageId
      && !m.is_removed && m.type !== 'SYSTEM_MESSAGE') || null;
    ctx.target = target;
    ctx.targetLoaded = true;
    return target;
  }

  // Body đúng CommentSender.executeByApi (user_selected_reply_to: app bỏ qua khi không chọn sẵn)
  function buildCommentBody(action, target, post, text, photo) {
    const body = { action };
    if (action === 'reply_comment') {
      body.message_id = target.id;
      body.parent_id = target.parent_id;
    }
    if (post && post.id) body.post_id = post.id;
    body.message = text == null ? '' : text;
    if (photo && photo.url) body.content_url = photo.url;
    return body;
  }

  async function sendCommentViaApi(conv, text, photo, ctx) {
    ctx = ctx || {};
    const token = getToken();
    if (!token) {
      return { ok: false, error: 'Không tìm thấy access_token — hãy tải lại trang Pancake rồi thử lại' };
    }
    const full = await ctxFull(conv, ctx) || {};
    const convId = full.id || conv.id;
    const pageId = full.page_id || conv.pageId || String(conv.id).split('_')[0];
    const post = full.post || (full.post_id ? { id: full.post_id } : null);
    // CommentSender constructor: chat = chính bài viết của khách → "reply_post", không thì "reply_comment"
    const action = (post && !post.admin_creator && post.from && String(post.id) === String(convId))
      ? 'reply_post' : 'reply_comment';
    let target = null;
    if (action === 'reply_comment') {
      target = await fetchCommentTarget(full, pageId, convId, ctx);
      if (!target) {
        return { ok: false, sent: false, error: 'Không tìm thấy bình luận của khách để trả lời' };
      }
    }
    const body = buildCommentBody(action, target || {}, post, text, photo);
    const url = apiBase() + '/v1/pages/' + pageId
      + '/conversations/' + encodeURIComponent(convId)
      + '/messages?access_token=' + encodeURIComponent(token);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      let data = {};
      let parsed = true;
      try { data = await res.json(); } catch (e) { parsed = false; }
      if (res.ok && data && data.success) {
        return { ok: true, id: data.id || data.message_id || '', sendBy: 'api', sent: true };
      }
      if (res.status === 401 || res.status === 403) {
        capturedToken = null;
        return { ok: false, sent: false, error: 'Token hết hạn/không hợp lệ (' + res.status + ') — tải lại trang rồi thử lại' };
      }
      if ((res.ok && (!parsed || !data || data.success === undefined)) || res.status >= 500) {
        return { ok: false, sent: 'maybe', error: 'API không trả kết quả rõ (' + res.status + ')' };
      }
      return {
        ok: false,
        sent: false,
        error: (data && (data.message || data.error)) || ('HTTP ' + res.status),
        // HAR: response lỗi của Pancake dùng e_code / e_subcode (KHÔNG có message_code):
        //   {"e_code":10,"e_subcode":2018300,"message":"(#10) Không gửi được…","success":false}
        //   {"e_code":551,"e_subcode":1545041,"message":"(#551) Người này hiện không có mặt.","success":false}
        code: (data && (data.e_code != null ? data.e_code : data.message_code)) || null,
        subcode: (data && data.e_subcode != null) ? data.e_subcode : null,
      };
    } catch (e) {
      return { ok: false, sent: 'maybe', error: 'Lỗi mạng: ' + (e && e.message || e) };
    }
  }

  // Fallback qua extension — đúng CommentSender.executeByExtOnce (type SEND_COMMENT)
  async function sendCommentViaExtension(conv, text, photo, ctx) {
    ctx = ctx || {};
    const adapter = window.__ExtensionAdapter__;
    if (!adapter || typeof adapter.send !== 'function') {
      return { ok: false, error: 'Không thấy Extension Pancake', skipExt: true };
    }
    try {
      if (typeof adapter.checkConnection === 'function' && !adapter.checkConnection({ silent: true })) {
        return { ok: false, error: 'Extension Pancake chưa kết nối', skipExt: true };
      }
    } catch (e) { /* cứ thử gửi */ }
    const token = getToken();
    if (!token) return { ok: false, error: 'Không tìm thấy access_token' };
    const full = await ctxFull(conv, ctx) || {};
    const convId = full.id || conv.id;
    const pageId = full.page_id || conv.pageId || String(conv.id).split('_')[0];
    const post = full.post || (full.post_id ? { id: full.post_id } : null);
    if (!post || !post.id) return { ok: false, sent: false, error: 'Chat không có post_id để trả lời bình luận' };
    const target = await fetchCommentTarget(full, pageId, convId, ctx);
    if (!target) return { ok: false, sent: false, error: 'Không tìm thấy bình luận của khách để trả lời' };
    const meta = pageMeta(pageId);
    const payload = {
      type: 'SEND_COMMENT',
      pageId,
      fbPageId: meta.fbPageId,
      // đúng cách app rút id dạng số từ post/bình luận (executeByExtOnce): last(part khi tách "_")
      postId: String(post.id).split('_').pop(),
      commentId: String(target.parent_id || target.id || '').split('_').pop(),
      stickerId: null,
      message: text,
      mentions: null,
      platform: 'facebook',
      currentPageName: meta.name,
      conversationId: convId,
      accessToken: token,
    };
    if (photo && photo.url) payload.photoUrl = photo.url;
    /* ═══════════════ [v1.93.8] ĐỌC ĐÚNG HANDLER SEND_COMMENT CỦA EXTENSION ═══════════════
     * Nguồn: 0.5.62_0/assets/background.js
     *
     *   case"UPLOAD_INBOX_PHOTO":  ae.startCheck(_, D);          // D() gửi, D(s) = switch profile rồi gửi
     *   case"SEND_COMMENT":        ae.startCheck(pageId, _, !0, !0);
     *
     *   static startCheck(e, t, a = !0, r = !1) {   // e=pageId  t=hàm gửi
     *     const s = () => ae.startCheck(e, t, a, !0);   // retry KHÔNG kèm cờ r
     *     r ? new ae(e, a).init().then(()=>{}).catch(()=>{}).finally(t)   // ← BỎ QUA KẾT QUẢ
     *       : t(s);
     *   }
     *
     * Hệ quả (đo được bằng code, không suy đoán):
     *  a) `new ae(pageId, confirmProfile=true).init()` = **đổi profile Facebook sang page**.
     *     `checkValidProfile()` đọc `business.facebook.com`; nếu `confirmProfile && !currentProfile.id`
     *     (handler fanpage / HTML đổi cấu trúc / 429 / ≥500) ⇒ `switchNoResponse = true; return`
     *     ⇒ `switchResult` KHÔNG BAO GIỜ được gán ⇒ `finally(t)` chạy `t(s)` với cờ `r = true`
     *     ⇒ lần 2 cũng chỉ `init()` rồi `finally(t)` ⇒ **KHÔNG BAO GIỜ GỬI BÌNH LUẬN**,
     *     mà `t` (là hàm gửi) vẫn được gọi nên nếu `t` là hàm "gửi + báo kết quả" thì có thể
     *     báo SAI. Đây là lý do phải đọc kết quả thật trước khi tin.
     *
     *  b) `getProfileSetting()` dùng `G(html, '{"require":…RelayPrefetchedStreamCache…')`;
     *     nếu HTML không còn khối đó ⇒ `t = []` ⇒ `currentProfile = {}` ⇒ rơi đúng vào (a).
     *
     *  c) `UPLOAD_INBOX_PHOTO` gọi `D()` (rỗng) ⇒ KHÔNG switch profile; chỉ ảnh bình luận
     *     đi nhánh này. ⇒ Câu "mất globalId" là **của nhánh upload ảnh**, không phải nhánh gửi.
     *
     * Vì vậy KHÔNG được coi "không có res.success" là "không rõ" một cách mù quáng:
     * `res.data` là `undefined` ⇒ extension KHÔNG hề báo gửi xong (nó chỉ switch profile rồi
     * im lặng) ⇒ có thể coi là CHƯA GỬI, nhưng phải kiểm chứng bằng lịch sử trước khi chốt. */
    try {
      const res = await adapter.send(payload, { timeout: 35000 });
      if (res && res.success) {
        /* [v1.93.11] HỢP ĐỒNG THẬT CỦA `SEND_COMMENT_SUCCESS` (0.5.62, case"SEND_COMMENT"):
         *   e.port.postMessage({type:"SEND_COMMENT_SUCCESS", taskId:I,
         *                        messageId:b.message_id, timestamp:b.timestamp})
         * và `Te.send()` trả `{success:!0, message_id: c.data.comment_create.feedback_comment_edge.node.legacy_fbid, timestamp: …}`.
         * ⇒ trường là **`messageId`**, KHÔNG phải `id`. Trước bản này đọc `timestamp || id`
         *   ⇒ `timestamp` là số mili giây (không phải id tin) và `id` không tồn tại ⇒
         *   `res.data.id` LUÔN rỗng. Không ảnh hưởng phán quyết (vẫn `ok:true`), nhưng mất
         *   id để đối chiếu lịch sử về sau. */
        const _dd = (res.data && typeof res.data === 'object') ? res.data : {};
        /* `res.convId/globalUserId` cũng có trong payload nhưng KHÔNG dùng để chốt đã tới —
         * giữ nguyên đường "success ≠ đã tới" của 1.93.2 (đọc lại lịch sử mới ✅). */
        return { ok: true, id: (_dd.messageId || _dd.message_id || _dd.id || '') || '' };
      }
      /* [v1.93.8] `SEND_COMMENT_FAILURE` của extension KHÔNG có trường `error`
       * (`e.port.postMessage({type:"SEND_COMMENT_FAILURE",taskId})` — nhánh .catch) hoặc
       * chỉ có `message` (`message: b.message`). Đọc đủ cả hai, đừng chỉ đọc `error`. */
      const d = (res && res.data) || {};
      const why = d.message || d.errorMessage || d.error || d.reason || d.code || '';
      if (!why) {
        /* Không có lý do + không có data = hình dạng "extension chỉ switch profile rồi im lặng"
         * (mục a ở trên). Chưa có bằng chứng đã gửi ⇒ KHÔNG được chốt ❌ cũng KHÔNG được bù
         * mù: trả 'maybe' để cổng chứng minh vắng mặt quyết định (đúng luật chống trùng). */
        return { ok: false, sent: 'maybe', error: 'Extension không báo kết quả bình luận (SEND_COMMENT_FAILURE rỗng) — không gửi thêm' };
      }
      return { ok: false, sent: 'maybe', error: 'Extension không gửi được bình luận (' + why + ')' };
    } catch (e) {
      return { ok: false, sent: 'maybe', error: 'Extension lỗi: ' + (e && e.message || e) };
    }
  }

  function normalizePhotoItems(photo) {
    if (!photo) return [];
    if (Array.isArray(photo.items) && photo.items.length) return photo.items;
    if (photo.url || photo.id || photo.fbId) {
      return [{
        url: photo.url || '',
        id: photo.id || '',
        fbId: photo.fbId || (Array.isArray(photo.fbIds) && photo.fbIds[0]) || '',
        w: photo.w || 0,
        h: photo.h || 0,
      }];
    }
    return [];
  }

  function hasValidApiPhoto(photo) {
    if (!photo) return true;
    const items = normalizePhotoItems(photo);
    if (!items.length) return false;
    if (Array.isArray(photo.fbIds) && photo.fbIds.length >= items.length && photo.fbIds.every(Boolean)) return true;
    return items.every((x) => !!(x && x.fbId));
  }

  // Dựng request gửi inbox ĐÚNG app (dùng chung cho sendViaApi và chế độ nhanh)
  // Đối chiếu 13 request gửi THẬT của app trong tinnhan.har & executeByApi (@946500) + buildRequestBody (@951000) trong _app:
  //   • Gửi chữ hoặc 1 ảnh: multipart/form-data (action=reply_inbox, [is_record_ctx_7_days], message, content_id, attachment_id, content_url, width, height, send_by_platform=web)
  //   • Gửi >= 2 ảnh (đa ảnh): application/json ({ action: 'reply_inbox', [is_record_ctx_7_days], message, content_ids, attachment_ids, content_urls, dimensions, send_by_platform: 'web' })
  function buildInboxSend(conv, text, photo, opts) {
    opts = opts || {};
    const token = getToken();
    if (!token) return { error: 'Không tìm thấy access_token — hãy tải lại trang Pancake rồi thử lại' };
    const pageId = conv.pageId || conv.id.split('_')[0];
    const url = apiBase() + '/v1/pages/' + pageId
      + '/conversations/' + encodeURIComponent(conv.id)
      + '/messages';
    let ctx7 = false;
    try {
      const full7 = peekConv(conv) || conv;
      if (isRecordCtx7Days(full7)) ctx7 = true;
    } catch (e) { /* thiếu dữ liệu → gửi như request thường */ }
    // ===== BẰNG CHỨNG HAR (đối chiếu 54 request reply_inbox) =====
    //   • 19/19 request CÓ is_record_ctx_7_days:true        → success:true
    //   • 24/24 request THIẾU cờ                            → e_code 10 / e_subcode 2018300
    //        "(#10) Không gửi được tin nhắn do một ứng dụng khác hiện đang kiểm soát thread này."
    // → Thiếu cờ chính là nguyên nhân phổ biến nhất của (#10), KHÔNG phải app khác giữ thread.
    // Khi lần gửi trước đã bị (#10) mà request đó thiếu cờ, caller gửi lại ĐÚNG 1 lần kèm cờ
    // (opts.forceCtx7). (#10) = server chưa gửi → gửi lại không thể sinh tin trùng.
    if (opts.forceCtx7) ctx7 = true;

    const items = normalizePhotoItems(photo);
    if (items.length > 1) {
      const fbIds = (Array.isArray(photo.fbIds) && photo.fbIds.length >= items.length)
        ? photo.fbIds.slice(0, items.length)
        : items.map((x) => x.fbId || '');
      const jsonBody = {
        action: 'reply_inbox',
        message: text == null ? '' : text,
        content_ids: items.map((x) => x.id || ''),
        attachment_ids: fbIds,
        content_urls: items.map((x) => x.url || ''),
        dimensions: items.map((x) => ({ width: Number(x.w) || 0, height: Number(x.h) || 0 })),
        send_by_platform: 'web',
      };
      // [v1.92.5] TRẢ VỀ ĐÚNG NHƯ APP — cờ CHỈ gửi khi dr() đúng.
      // Bằng chứng trực tiếp trong bundle app: `_app-9331d46f21a84eb1.v6.js`
      //     j = {action:"reply_inbox", ...(N?.body||{})};
      //     (0, ev.dr)() && (j.is_record_ctx_7_days = !0);   // ← CÓ ĐIỀU KIỆN
      // v1.91.80 đổi thành LUÔN gửi dựa trên tương quan trong HAR (19 ca thành công đều có cờ),
      // nhưng đó là nhiễu: 19 ca đó là chat TRONG 24h (dr() đúng sẵn). Bản thân HAR cũng khớp
      // code app: 24 ca thiếu cờ = chat ngoài cửa sổ. Gửi cờ khi không đủ điều kiện là bịa
      // thêm dữ liệu server không mong đợi ⇒ trả lại hành vi gốc của app.
      if (ctx7) jsonBody.is_record_ctx_7_days = true;
      return { url: url, isJson: true, jsonBody: jsonBody, ctx7: ctx7 };
    }

    const fd = new FormData();
    fd.append('action', 'reply_inbox');
    if (ctx7) fd.append('is_record_ctx_7_days', 'true'); // [v1.92.5] chỉ khi dr() đúng — xem chú thích nhánh JSON
    fd.append('message', text);
    const p0 = items[0] || photo;
    const fbId0 = (p0 && p0.fbId) || (photo && photo.fbId) || (photo && Array.isArray(photo.fbIds) && photo.fbIds[0]) || '';
    if (p0 && fbId0) {
      // đúng field + đúng THỨ TỰ request thật của app khi gửi 1 ảnh (đã so khớp curl):
      // content_id → attachment_id → content_url → width → height
      if (p0.id) fd.append('content_id', p0.id);
      fd.append('attachment_id', fbId0);
      fd.append('content_url', p0.url);
      if (p0.w) fd.append('width', String(p0.w));
      if (p0.h) fd.append('height', String(p0.h));
    }
    fd.append('send_by_platform', 'web'); // request thật của app luôn có (cả text lẫn ảnh)
    return { url: url, fd: fd, isJson: false, ctx7: ctx7 };
  }

  // ⚡ CHẾ ĐỘ NHANH: bắn request API qua cổng điều tiết apiSendLane (64 luồng HTTP song song),
  // KHÔNG chờ server trả lời ở vòng ngoài — báo "đã gửi" tức thì, tránh đổ 7.000 fetch() cùng 1ms
  // làm nghẽn mạng Chrome. Nếu gặp HTTP 429 (rate-limit tạm thời, tin chắc chắn chưa xử lý) thì
  // tự động thử lại 1 lần sau 600ms.
  // Response xem TRONG NỀN: OK → im lặng; THUA RÕ (4xx/success=false) → bù Ext/Socket trong nền;
  // KHÔNG RÕ (5xx/lỗi mạng) → chỉ báo "không rõ" — KHÔNG gửi lại để tránh trùng tin.
  function isCertainHttpNotSent(status, data, parsed) {
    if (data && data.success === false) return true;
    /* [v1.92.45] `1545012` / `transientError:1` = server TỪ CHỐI NGAY, chưa tạo tin.
     * Bằng chứng: network-log.har (làn Ext của extension Pancake v2) có 4/90 ca mã này,
     * `payload: null`, thời gian phản hồi p50 0,34 s (lỗi nhanh) so với 1,00 s của 1545041.
     * Coi nó là "không rõ" (như bản cũ) thì mỗi ca phải chờ cổng 10 s rồi mới bù — chậm vô ích
     * cho một ca mà server đã nói rõ "chưa nhận". Đây là từ chối đứt khoát ⇒ thử lại AN TOÀN. */
    if (data && (Number(data.error) === 1545012 || data.transientError === 1
        || /Đã xảy ra lỗi tạm thời/i.test(String(data.errorDescription || data.message || '')))) return true;
    const st = Number(status) || 0;
    if (st === 408 || st === 499 || st >= 500 || st <= 0) return false;
    if (st === 400 || st === 401 || st === 403 || st === 404 || st === 405 || st === 413 || st === 415 || st === 422 || st === 429) {
      return true;
    }
    return false;
  }

  // ===== [v1.91.95] 🔬 MÁY GHI REQUEST GỬI — dò vì sao API bị từ chối còn Ext gửi được =====
  // Lô 09:10 (1.91.94): API NỀN chạy 1 958 request ⇒ 1 952 bị từ chối, 6 OK; Ext gửi được
  // 1 148 ca trong CHÍNH những chat API từ chối. Cờ is_record_ctx_7_days đã luôn được gửi,
  // nên lý do từ chối là thứ HAR hiện có KHÔNG chứa (HAR đó là session của app, không phải
  // request do Extension phát ra). Máy ghi này bắt đúng cặp (API-thất-bại, Ext-thành-công)
  // trên CÙNG một chat, để biết khác biệt thật: token, header, hay endpoint.
  // Không can thiệp kênh gửi: chỉ bọc fetch để ĐỌC, lỗi trong bộ ghi không được ném ra ngoài.
  const recBuf = [];
  const REC_MAX = 400;
  let recOn = false;
  try { recOn = localStorage.getItem('ssb_rec_send') === '1'; } catch (e) { /* ignore */ }
  function recFields(body) {
    try {
      if (body == null) return '';
      if (typeof body === 'string') {
        if (body.charAt(0) === '{') { try { return 'json:' + Object.keys(JSON.parse(body)).join(','); } catch (e) { return 'json?'; } }
        const out = []; const re = /name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n--/g; let m;
        while ((m = re.exec(body))) {
          const k = m[1]; const v = m[2];
          out.push(k + '=' + (k === 'message' ? '<' + v.length + 'c>' : (v.length > 44 ? v.slice(0, 44) : v)));
        }
        return out.join('|');
      }
      if (typeof body.forEach === 'function') {
        const out = []; body.forEach(function (v, k) {
          out.push(k + '=' + (k === 'message' ? '<' + String(v).length + 'c>' : String(v).slice(0, 44)));
        });
        return out.join('|');
      }
    } catch (e) { return '?'; }
    return String(typeof body);
  }
  function recPush(e) {
    if (!recOn) return;
    try { recBuf.push(e); while (recBuf.length > REC_MAX) recBuf.shift(); } catch (e2) { /* ignore */ }
  }
  try {
    if (!window.__ssbRecFetch__ && typeof window.fetch === 'function') {
      window.__ssbRecFetch__ = true;
      const origFetch = window.fetch;
      window.fetch = function (input, init) {
        let isSend = false, url = '', f = '', t0 = 0;
        try {
          url = typeof input === 'string' ? input : ((input && input.url) || '');
          isSend = recOn && /\/conversations\/[^/]+\/messages(\?|$)/.test(url) && init && String(init.method || '').toUpperCase() === 'POST';
          if (isSend) { f = recFields(init.body); t0 = Date.now(); }
        } catch (e3) { isSend = false; }
        const p = origFetch.apply(this, arguments);
        /* ═══ [v1.93.9] BÓC doc_id TỪ MỌI RESPONSE TEXT — KHÔNG THÊM REQUEST NÀO ═══
         * `harvestDocIdsFromHtml` chỉ là regex trên chuỗi đã có trong tay. Đặt ở đây để mọi
         * trang HTML (Pancake SPA, business.facebook.com, trang nội bộ) đều được quét.
         * Chỉ đọc: không sửa response, không chặn, không gửi gì. */
        try {
          if (p && typeof p.then === 'function') {
            p.then(function (res) {
              try {
                const ct = (res && res.headers && res.headers.get && res.headers.get('content-type')) || '';
                if (!ct || /html|text|javascript/i.test(ct)) {
                  res.clone().text().then(function (txt) {
                    try { harvestDocIdsFromHtml(txt, 'net'); } catch (e9) { /* ignore */ }
                  }, function () { /* ignore */ });
                }
              } catch (e8) { /* ignore */ }
            }, function () { /* ignore */ });
          }
        } catch (e7) { /* ignore */ }
        if (isSend) {
          try {
            p.then(function (res) {
              try {
                res.clone().text().then(function (txt) {
                  recPush({ ms: Date.now() - t0, st: res.status, u: url.replace(/^https?:\/\/[^/]+/, ''), f: f, r: String(txt).slice(0, 240) });
                }, function () { recPush({ ms: Date.now() - t0, st: res.status, u: url, f: f, r: '<body?>"' }); });
              } catch (e4) { /* ignore */ }
            }, function (err) {
              recPush({ ms: Date.now() - t0, st: 'ERR', u: url, f: f, r: String(err && err.message || err).slice(0, 140) });
            });
          } catch (e5) { /* ignore */ }
        }
        return p;
      };
    }
  } catch (e6) { /* ignore */ }
  try {
    window.__botfakeSetRec__ = function (on) {
      recOn = !!on;
      try { localStorage.setItem('ssb_rec_send', recOn ? '1' : '0'); } catch (e) { /* ignore */ }
      try { recBuf.length = 0; } catch (e) { /* ignore */ }
      try { logLine('🔬 Ghi request gửi: ' + (recOn ? 'BẬT' : 'TẮT') + ' — chạy lô nhỏ rồi dán __botfakeDumpRec__()'); } catch (e) { /* ignore */ }
      return recOn;
    };
    window.__botfakeDumpRec__ = function () {
      try { return JSON.stringify(recBuf, null, 1); } catch (e) { return '[]'; }
    };
  } catch (e7) { /* ignore */ }
  // ===== hết máy ghi =====

  function fireApiAndWatch(conv, text, photo) {
    if (photo && !hasValidApiPhoto(photo)) return { ok: false, sent: false, error: 'Không có attachment ảnh cho API' };
    const req = buildInboxSend(conv, text, photo);
    if (req.error) return { ok: false, sent: false, error: req.error };
    if (state.stopRequested) return { ok: false, sent: false, error: 'Đã dừng' };
    if (!acquireOutbound(conv.id)) return dupBlockedResult(conv.id);
    const myRun = runSeq;
    const apiQueuedAt = Date.now();
    sendDiag.apiQueued++;
    apiSendLane(async () => {
      if (myRun !== runSeq || state.stopRequested) {
        if (myRun === runSeq) sendDiag.apiCancelled++;
        return;
      }
      const apiStartedAt = Date.now();
      const apiQueueWaitMs = Math.max(0, apiStartedAt - apiQueuedAt);
      sendDiag.apiStarted++;
      sendDiag.apiQueueWaitMsTotal += apiQueueWaitMs;
      sendDiag.apiQueueWaitMsMax = Math.max(sendDiag.apiQueueWaitMsMax, apiQueueWaitMs);
      const makeFetchOpts = (rObj) => (rObj.isJson
        ? { method: 'POST', body: JSON.stringify(rObj.jsonBody), headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, credentials: 'include' }
        : { method: 'POST', body: rObj.fd, headers: { Accept: 'application/json' }, credentials: 'include' });
      // fetch CÓ HẠN 20s: request treo (mạng chập / tab bị bóp) phải tự văng lỗi để chốt,
      // không kẹt "đang xác nhận nền" vĩnh viễn (lỗi làm TỔNG HỢP không bao giờ chốt)
      const timedFetch = async (rObj) => {
        const opts = makeFetchOpts(rObj);
        let ctl = null;
        let abTimer = null;
        if (typeof AbortController !== 'undefined') {
          ctl = new AbortController();
          opts.signal = ctl.signal;
          abTimer = bgClock.after(20000, () => { try { ctl.abort(); } catch (e0) { /* ignore */ } });
        }
        const fetchStartedAt = Date.now();
        if (myRun === runSeq) sendDiag.apiFetchAttempts++;
        try {
          const response = await fetch(req.url, opts);
          if (response) noteServerClock(response.headers);
          if (myRun === runSeq && response) {
            const statusKey = String(Number(response.status) || 0);
            sendDiag.apiStatusCounts[statusKey] = (sendDiag.apiStatusCounts[statusKey] || 0) + 1;
            if (Number(response.status) === 429) sendDiag.api429++;
          }
          return response;
        } finally {
          if (abTimer) { try { abTimer(); } catch (eA1) { /* ignore */ } }
          if (myRun === runSeq) {
            const fetchMs = Math.max(0, Date.now() - fetchStartedAt);
            sendDiag.apiFetchMsTotal += fetchMs;
            sendDiag.apiFetchMsMax = Math.max(sendDiag.apiFetchMsMax, fetchMs);
            const ar = sendDiag.apiFetchSamples;
            if (Array.isArray(ar)) { ar.push(fetchMs); if (ar.length > 64) ar.shift(); } // [v1.92.10] chống văng cả làn
          }
        }
      };
      let res = await timedFetch(req);
      if (res && res.status === 429 && myRun === runSeq && !state.stopRequested) {
        sendDiag.api429Retries++;
        await sleepUntil(Date.now() + retryAfterMs(res, 600)); // [v1.92.9] theo Retry-After, không phải 600 ms cứng
        const req2 = buildInboxSend(conv, text, photo);
        if (!req2.error) {
          res = await timedFetch(req2);
        }
      }
      if (myRun !== runSeq) return;
      let data = null;
      let parsed = true;
      try { data = await res.json(); } catch (e) { data = null; parsed = false; }
      if (res.ok && data && data.success) {
        sendDiag.apiSuccess++;
        resetPageRejection(conv.pageId || String(conv.id || '').split('_')[0]);
        markDelivered(conv.id, 'api'); postSendSideEffects(conv); return;
      } // đã đến nơi — im lặng
      let msg = (data && (data.message || data.error)) || ('HTTP ' + res.status);
      if (res.status === 401 || res.status === 403) capturedToken = null;
      const nm = conv.name || conv.id;
      const certainFail = isCertainHttpNotSent(res.status, data, parsed);
      if (certainFail) {
        sendDiag.apiRejected++;
        sendDiag.apiFallback++;
        releaseOutbound(conv.id); // tin chắc chưa đi → kênh khác được bắn (không sót)
        // "(#10)…ngoài khoảng thời gian…"/"(#551)" KHÔNG phải "mọi kênh đều thua": app vẫn fallback
        // Extension/Socket và gửi ĐƯỢC (log 07:36 — Thanh Binh bù THÀNH CÔNG qua Extension ngay sau
        // "(#10)"; HAR có update_global_id chạy sau cả "(#551)"). → PHẢI bù qua kênh chưa thử.
        const win = isWindowClosedError(msg);
        if (win) windowBlocked++;
        // ===== (#10): thử lại ĐÚNG 1 LẦN KÈM CỜ trước khi kết luận =====
        // HAR: 24/24 request thiếu is_record_ctx_7_days bị (#10) e_subcode 2018300; 19/19 request
        // CÓ cờ thì success. Vì vậy nếu request vừa rồi thiếu cờ → bắn lại 1 lần kèm cờ.
        // (#10) = server CHƯA gửi tin → gửi lại không thể trùng.
        if (isThreadControlError(msg) && !req.ctx7 && !ctx7Retried[conv.id]) {
          ctx7Retried[conv.id] = true;
          const req2 = buildInboxSend(conv, text, photo, { forceCtx7: true });
          if (!req2.error) {
            const res2 = await timedFetch(req2);
            let d2 = null;
            try { d2 = await res2.json(); } catch (e2) { d2 = null; }
            if (res2.ok && d2 && d2.success) {
              sendDiag.apiSuccess++;
              sendDiag.ctx7RetryOk = (sendDiag.ctx7RetryOk || 0) + 1;
              resetPageRejection(conv.pageId || String(conv.id || '').split('_')[0]);
              logLine('🔁 ' + nm + ' — (#10) do THIẾU CỜ ctx-7-days → gửi lại kèm cờ THÀNH CÔNG.');
              markDelivered(conv.id, 'api'); postSendSideEffects(conv); return;
            }
            const msg2 = (d2 && (d2.message || d2.error)) || ('HTTP ' + res2.status);
            if (d2 && d2.success === false) msg = msg2; // cờ đã có mà vẫn (#10) → chặn thật của chat này
          }
        }
        /* [v1.92.45] `1545012` (lỗi TẠM THỜI, server chưa tạo tin) ⇒ THỬ LẠI NGAY 1 LẦN.
         * Bản cũ: rơi thẳng xuống cổng "chứng minh vắng mặt" 10 s rồi mới bù kênh khác ⇒ mỗi ca
         * lỗi tạm thời làm lô chậm thêm ~10 s dù server đã nói rõ "chưa nhận gì".
         * Chỉ 1 lần/chat, nghỉ 600 ms, rồi mới tin kết quả của lần 2. */
        const transientNow = !(ctx7Retried[conv.id + '|tr']) && isTransientServerError(msg);
        if (transientNow) {
          ctx7Retried[conv.id + '|tr'] = true;
          sendDiag.transientRetries = (sendDiag.transientRetries || 0) + 1;
          await sleepUntil(Date.now() + 600, 'api-transient-retry');
          if (myRun !== runSeq) return;
          const reqTr = buildInboxSend(conv, text, photo, { forceCtx7: !!req.ctx7 });
          if (!reqTr.error) {
            const resTr = await timedFetch(reqTr);
            let dTr = null;
            try { dTr = await resTr.json(); } catch (eTr) { dTr = null; }
            if (resTr.ok && dTr && dTr.success) {
              sendDiag.apiSuccess++;
              sendDiag.transientRetryOk = (sendDiag.transientRetryOk || 0) + 1;
              markDelivered(conv.id, 'api'); postSendSideEffects(conv);
              logLine('🔁 ' + nm + ' — lỗi TẠM THỜI (1545012) → gửi lại NGAY, THÀNH CÔNG.');
              return;
            }
            const msgTr = (dTr && (dTr.message || dTr.error)) || ('HTTP ' + resTr.status);
            if (dTr && dTr.success === false) msg = msgTr; // lấy lỗi của lần 2 làm kết luận
            res = resTr; data = dTr;
          }
        }
        if (isThreadControlError(msg)) {
          // Không blacklist page vì 1 ca: chỉ chặn khi lỗi cấp page lặp liên tiếp.
          const streak = notePageRejection(conv.pageId || String(conv.id || '').split('_')[0]);
          // [v1.91.77] TRƯỚC ĐÂY: ca (#10) ĐẦU TIÊN là bật batchSkipApi ⇒ tắt API cho TOÀN BỘ
          // phần còn lại của lượt (log 11873 tin: "API 8" — chỉ 8 tin đi API, 11865 tin dồn hết
          // sang Socket). Một ca lẻ không đủ chứng minh API của page bị chặn, nhất là khi (#10)
          // phần lớn do thiếu cờ ctx-7-days (đã có retry kèm cờ ngay phía trên).
          // Nay chỉ học khi đã lặp ≥ 2 lần.
          if (!batchSkipApi && streak >= 2) {
            batchSkipApi = true;
            logLine('⛔ API bị chặn lặp (' + clip(msg, 80) + ') — các chat còn lại trong lô sẽ đi thẳng Socket/Ext');
          }
        }
        // BÁO RÕ KẾT QUẢ THẬT — không bao giờ "báo gửi" xong im lặng khi request đã bị từ chối.
        // Bù ĐÚNG 1 lần/kênh qua kênh CHƯA thử (Ext → Socket — đúng plan của app).
        /* [v1.93.1] NGUỒN THỨ HAI của "FB đã báo không nhận": API từ chối dứt khoát.
         * Log 21/11: 4 ca còn lại trong nhóm bù oan đi đúng đường này — API trả "(#551) Người này
         * hiện không có mặt", vẫn được bù Socket rồi Ext, rồi đánh ✅. Chỉ ghi sổ khi lỗi là
         * DỨT KHOÁT (`isDefinitiveNotSent` — hàm có sẵn: #551 / ngoài 24h / #10 kiểm soát thread
         * / #100 không tồn tại). Lỗi tạm thời KHÔNG ghi ⇒ vẫn bù bình thường như cũ. */
        /* [v1.93.13] ĐÃ THỬ chốt ❌ ngay khi API trả #551 — ĐO LẠI THÌ SAI, GIỮ NGUYÊN ĐƯỜNG CŨ.
         * 414 dòng `⚠ … API từ chối ((#551) Người này hiện không có mặt.)` trên 30 log nghe như
         * "FB nói dứt khoát", nhưng đó là log TRUNG GIAN, không phải trạng thái cuối.
         * Đối chứng sổ kiểm chứng: 380 tên ca từng bị #551, trong đó **29 ca ĐƯỢC CỨU THẬT**
         * (7,6 %) — vd log 17/11 16:27, conv `769625892902516_28615693248109700` (Hà Hồ):
         *   16:15:41 ⚠ API từ chối ((#551) Người này hiện không có mặt.)
         *   16:20:30 ✅ bù THÀNH CÔNG qua Extension     ← sổ ghi "kênh ext"
         * ⇒ #551 là câu trả lời của KÊNH API (endpoint messaging/send/), KHÔNG phải bản án cho
         *   khách: Extension đi qua tab Facebook thật vẫn gửi được. Chốt ❌ ở đây là MẤT TIN.
         * Giữ nguyên: vẫn bù kênh khác như cũ. Ghi lại để lần sau không "tối ưu" lại lần nữa. */
        if (isDefinitiveNotSent(msg)) noteFbRejected(conv.id, 'API từ chối: ' + clip(msg, 70));
        logLine('⚠ ' + nm + ' — API từ chối (' + clip(msg, 90) + ')'
          + (win ? ' — ngoài cửa sổ 24h' : ''));
        scheduleBuRetry(conv, text, photo, nm, 'API từ chối (' + clip(msg, 90) + ')', ['api'],
          { ambiguous: true, via: 'api', sentAt: Date.now() });
      } else {
        sendDiag.apiUnknown++;
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain', 'API không rõ: ' + clip(msg, 60));
        logLine('⚠ ' + nm + ' — không rõ kết quả (' + msg + ') — kiểm chứng lịch sử trước khi bù');
        scheduleUncertainVerify(conv, text, photo, Date.now(), msg);
      }
    }).then((laneRes) => {
      // lane nuốt lỗi văng ra từ fetch (mạng / abort quá hạn 20s) thành {ok:false,error:'Lỗi kênh:…'}
      // mà KHÔNG ai chốt → chat kẹt pending vĩnh viễn. Chốt ⚠ tại đây (không gửi lại — tránh trùng).
      if (myRun !== runSeq) return;
      if (laneRes && laneRes.ok === false && laneRes.sent === false
        && String(laneRes.error || '').indexOf('Lỗi kênh:') === 0
        && !deliveredIds[conv.id] && !finalFailedIds[conv.id] && !uncertainIds[conv.id]) {
        sendDiag.apiUnknown++;
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
        logLine('⚠ ' + (conv.name || conv.id) + ' — không rõ kết quả (lỗi mạng/quá hạn) — kiểm chứng lịch sử trước khi bù');
        scheduleUncertainVerify(conv, text, photo, Date.now(), 'lỗi mạng/quá hạn');
      }
    }).catch(() => {
      if (myRun !== runSeq) return;
      sendDiag.apiUnknown++;
      if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
      logLine('⚠ ' + (conv.name || conv.id) + ' — không rõ kết quả (lỗi mạng) — kiểm chứng lịch sử trước khi bù');
      scheduleUncertainVerify(conv, text, photo, Date.now(), 'lỗi mạng');
    });
    return { ok: true, id: '', sendBy: 'api', sent: true, fired: true };
  }

  // fetch CÓ HẠN cho đường đồng bộ: kết nối treo phải tự văng lỗi (rơi vào catch có sẵn
  // của caller → 'maybe'/thử lại), không giữ worker/lane vô hạn
  async function fetchT(url, opts, ms) {
    if (typeof AbortController === 'undefined') return fetch(url, opts);
    const ctl = new AbortController();
    const t = bgClock.after(ms || 30000, () => { try { ctl.abort(); } catch (e) { /* ignore */ } });
    try { return await fetch(url, Object.assign({}, opts, { signal: ctl.signal })); }
    finally { try { t(); } catch (eT) { /* ignore */ } }
  }

  // Đúng request mà _app-...js gửi khi nhắn tin thường (executeByApi + buildRequestBody):
  //   POST /api/v1/pages/{page_id}/conversations/{conversation.id}/messages?access_token=...
  //   multipart/form-data (1 ảnh / text) hoặc JSON (>= 2 ảnh): action=reply_inbox, message=<text>
  async function sendViaApi(conv, text, photo, ctx) {
    if (conv.type === 'comment') return sendCommentViaApi(conv, text, photo, ctx || {}); // chat bình luận → reply_comment
    if (photo && !hasValidApiPhoto(photo)) return { ok: false, sent: false, error: 'Không có attachment ảnh cho API' };
    const req = buildInboxSend(conv, text, photo);
    if (req.error) return { ok: false, sent: false, error: req.error };
    if (!acquireOutbound(conv.id)) return dupBlockedResult(conv.id);
    try {
      const makeFetchOpts = (rObj) => (rObj.isJson
        ? { method: 'POST', body: JSON.stringify(rObj.jsonBody), headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, credentials: 'include' }
        : { method: 'POST', body: rObj.fd, headers: { Accept: 'application/json' }, credentials: 'include' });
      let res = await fetchT(req.url, makeFetchOpts(req), 30000);
      if (res && res.status === 429 && !state.stopRequested) {
        await sleepUntil(Date.now() + retryAfterMs(res, 600)); // [v1.92.9] theo Retry-After
        const req2 = buildInboxSend(conv, text, photo);
        if (!req2.error) {
          res = await fetchT(req2.url, makeFetchOpts(req2), 30000);
        }
      }
      let data = {};
      let parsed = true;
      try { data = await res.json(); } catch (e) { parsed = false; }
      if (res.ok && data && data.success) {
        return { ok: true, id: data.id || data.message_id || '', sendBy: 'api', sent: true };
      }
      if (res.status === 401 || res.status === 403) {
        capturedToken = null; // token cũ — lần sau tự lấy token mới
        releaseOutbound(conv.id);
        return { ok: false, sent: false, error: 'Token hết hạn/không hợp lệ (' + res.status + ') — tải lại trang rồi thử lại' };
      }
      // 200 nhưng không đọc được kết quả, hoặc lỗi 408/499/5xx → KHÔNG rõ tin đã đi hay chưa
      if ((res.ok && (!parsed || !data || data.success === undefined)) || !isCertainHttpNotSent(res.status, data, parsed)) {
        return { ok: false, sent: 'maybe', error: 'API không trả kết quả rõ (' + res.status + ')' };
      }
      // server trả lời rõ ràng là không gửi được → chắc chắn chưa gửi → nhả khóa để kênh khác bắn (không sót)
      releaseOutbound(conv.id);
      return {
        ok: false,
        sent: false,
        error: (data && (data.message || data.error)) || ('HTTP ' + res.status),
        // HAR: response lỗi của Pancake dùng e_code / e_subcode (KHÔNG có message_code):
        //   {"e_code":10,"e_subcode":2018300,"message":"(#10) Không gửi được…","success":false}
        //   {"e_code":551,"e_subcode":1545041,"message":"(#551) Người này hiện không có mặt.","success":false}
        code: (data && (data.e_code != null ? data.e_code : data.message_code)) || null,
        subcode: (data && data.e_subcode != null) ? data.e_subcode : null,
      };
    } catch (e) {
      // lỗi mạng: request có thể đã tới server → KHÔNG rõ — không được thử kênh khác
      return { ok: false, sent: 'maybe', error: 'Lỗi mạng: ' + (e && e.message || e) };
    }
  }

  // ---- Ghi nhớ kênh gửi tốt cho từng chat (sessionStorage) ----
  const CH_KEY = 'ssb_channel_hints';
  let channelHints = {};
  let channelHintSaveTimer = null;
  try { channelHints = JSON.parse(sessionStorage.getItem(CH_KEY) || '{}') || {}; } catch (e) { channelHints = {}; }
  function markChannel(convId, ch) {
    channelHints[convId] = ch;
    if (!channelHintSaveTimer) {
      channelHintSaveTimer = setTimeout(() => {
        channelHintSaveTimer = null;
        try { sessionStorage.setItem(CH_KEY, JSON.stringify(channelHints)); } catch (e) { /* ignore */ }
      }, 400);
    }
  }
  let batchSkipApi = false; // API bị chặn CẤP PAGE (#10 app khác giữ thread, #613, rate limit…) → chat sau đi thẳng Socket/Ext
  // [v1.91.93] ĐẾM LỖI THREAD-CONTROL TRƯỚC KHI TẮT API CẢ LÔ.
  // Lô 08:48–08:51 (1.91.92): `[API: 17 · Ext: 1840]` — API gần như không được dùng dù đứng
  // đầu thứ tự làn. Nguyên nhân: sendOne bật `batchSkipApi` ngay ở lỗi thread-control ĐẦU TIÊN
  // (một ca #613/rate-limit lẻ) ⇒ từ đó MỌI chat bị tước API, dồn hết sang Extension (bị tuần
  // tự hoá ~10–20 tin/giây). Nay cần 3 ca liên tiếp mới tắt API cho lô; một ca lẻ không đủ.
  let apiThreadBlockStreak = 0;

  // NHỚ THEO PAGE QUA CÁC LƯỢT: page từng bị API chặn cấp page (#10 app khác giữ
  // thread…) thì các lượt SAU đi thẳng Socket/Ext ngay từ con đầu, không bắn API thử
  // nữa — cơ chế học trong lượt không cứu được lô đã bắn hết trước khi #10 kịp về
  // (lô 24 con chạy lại vẫn 0/24). Lưu sessionStorage (hết phiên tab là quên) + TTL 4h.
  const API_BLOCKED_PAGES_KEY = 'ssb_api_blocked_pages_v1';
  const API_BLOCKED_TTL_MS = 4 * 3600 * 1000;
  let apiBlockedPages = {};
  try { apiBlockedPages = JSON.parse(sessionStorage.getItem(API_BLOCKED_PAGES_KEY) || '{}') || {}; } catch (e) { apiBlockedPages = {}; }
  function isApiBlockedForPage(pageId) {
    if (!pageId) return false;
    const ts = apiBlockedPages[String(pageId)] || 0;
    return !!ts && (Date.now() - ts < API_BLOCKED_TTL_MS);
  }
  function markApiBlockedForPage(pageId) {
    if (!pageId) return;
    apiBlockedPages[String(pageId)] = Date.now();
    try { sessionStorage.setItem(API_BLOCKED_PAGES_KEY, JSON.stringify(apiBlockedPages)); } catch (e) { /* ignore */ }
  }

  /* ---- CHẶN API CẤP PAGE: chỉ khi lỗi LẶP, không chặn vì 1 ca lẻ ----
   * Bản cũ: 1 lần (#10) là markApiBlockedForPage() → page mất API 4 GIỜ. Với lô lớn, một
   * ca lỗi lẻ (hoặc một request thiếu cờ ctx-7-days) đẩy toàn bộ page sang Socket/Extension
   * — chậm hơn nhiều và dễ sinh bù chồng. Nay: đếm số lần liên tiếp, đủ ngưỡng mới chặn;
   * một ca thành công là reset streak (chứng minh API của page vẫn sống).
   * HAR: 24 ca (#10) liên tiếp trên MỘT page đều thiếu cờ → đây chính là ca "lỗi lẻ" đó. */
  const PAGE_BLOCK_STREAK_TO_BLOCK = 3;
  const pageBlockStreak = {}; // pageId → số lần bị từ chối cấp page LIÊN TIẾP
  function notePageRejection(pageId) {
    if (!pageId) return 0;
    const k = String(pageId);
    pageBlockStreak[k] = (pageBlockStreak[k] || 0) + 1;
    const n = pageBlockStreak[k];
    if (n >= PAGE_BLOCK_STREAK_TO_BLOCK) {
      markApiBlockedForPage(k);
      pageBlockStreak[k] = 0;
    }
    return n;
  }
  function resetPageRejection(pageId) {
    if (pageId) delete pageBlockStreak[String(pageId)];
  }

  // NGOÀI CỬA SỔ 24H — API từ chối "(#551) Người này hiện không có mặt" / "(#10)…ngoài khoảng
  // thời gian cho phép…". ĐÂY KHÔNG PHẢI "mọi kênh đều thua": app vẫn fallback Extension và Ext
  // GỬI ĐƯỢC (Thanh Binh — log 07:36; HAR có update_global_id sau cả "(#551)"). Lỗi này là của
  // TỪNG NGƯỜI (chat khác vẫn bình thường) → không chặn cả lô; và PHẢI bù sang kênh chưa thử.
  // Khác biệt thật sự: thiếu cờ is_record_ctx_7_days (dr()) mới sinh "(#10)" oan — xem ensureAdClicks.
  function isWindowClosedError(msg) {
    const m = String(msg || '');
    return m.indexOf('(#551)') > -1
      || m.indexOf('Người này hiện không có mặt') > -1
      || m.indexOf('ngoài khoảng thời gian cho phép') > -1;
  }

  /* [v1.92.45] PHÂN LOẠI "CHẮC CHẮN KHÔNG GỬI ĐƯỢC" — để KHÔNG bắt người dùng chờ.
   *
   * Vấn đề thật (không phải tối ưu tốc độ gửi): một ca mà FB đã trả lời dứt khoát là tin
   * KHÔNG được nhận (khách không có mặt / ngoài cửa sổ 24h / thread do app khác giữ / lỗi
   * tạm thời phía server) vẫn bị đưa vào CỔNG CHỨNG MINH VẮNG MẶT 10 s + có khi 2 lần dò ⇒
   * lô 100 chat phát xong trong ~5 s nhưng bảng TỔNG HỢP treo thêm 10–35 s chỉ để chờ 1–2 ca
   * mà kết quả đã biết từ đầu. Đo được trong 2 lô lớn: 762 và 3 851 ca ❌, trong đó phần lớn
   * là 1545041/1545012 — tức phần lớn thời gian đuôi là chờ NHỮNG CA ĐÃ CHẾT.
   *
   * Ngược lại, phải giữ nguyên cổng 10 s cho nhóm thật sự mơ hồ (Socket không ACK, Ext quá
   * hạn, API timeout/5xx) — đó mới là chỗ "có thể đã đi" và là chỗ chống gửi trùng.
   *
   * `1545012` = "Đã xảy ra lỗi tạm thời, vui lòng thử lại" (transientError:1) — HAR
   * network-log.har (extension Pancake v2, 90 request): 4 ca mã này, tất cả `payload: null`
   * ⇒ server CHƯA tạo tin ⇒ thử lại an toàn (không thể trùng). Trước bản này script mù hoàn
   * toàn với mã đó (grep = 0 lần).
   */
  /* [v1.92.45] Chỉ đúng ca "server TẠM THỜI không xử lý" — thử lại ngay được, KHÔNG THỂ trùng.
   * Bản nháp đầu bắt mọi chuỗi chứa số dạng 5xx (`/(^|\D)5\d\d(\D|$)/`) — SAI: chuỗi lỗi hay
   * chứa id/token/số ngẫu nhiên nên sẽ khớp bừa (vd "room 512", "thread 500"). Nay chỉ nhận:
   *   • mã 1545012 (HAR: 4/90 request của làn Ext, `payload:null` ⇒ server chưa tạo tin)
   *   • câu "Đã xảy ra lỗi tạm thời"
   *   • HTTP 5xx viết đúng dạng `HTTP 5xx` hoặc `(#) 5xx` do chính script tạo ra */
  function isTransientServerError(msg) {
    const m = String(msg || '');
    if (!m) return false;
    if (/1545012/.test(m)) return true;
    if (/Đã xảy ra lỗi tạm thời/i.test(m)) return true;
    if (/\bHTTP\s*5\d\d\b/i.test(m)) return true;   // 'HTTP 502' — chuỗi do script dựng
    if (/\(#\d+\)\s*5\d\d\b/.test(m)) return true; // '…(#2) 503' — dạng FB trả
    return false;
  }

  function isDefinitiveNotSent(msg) {
    const m = String(msg || '');
    if (!m) return false;
    if (/(#551)|Người này hiện không có mặt|không có mặt/i.test(m)) return true;              // 1545041
    if (/ngoài khoảng thời gian cho phép|outside.*window/i.test(m)) return true;             // (#10) cửa sổ 24h
    if (/kiểm soát thread|đang kiểm soát/i.test(m)) return true;                             // (#10) 2018300
    if (/1545012|Đã xảy ra lỗi tạm thời/i.test(m)) return true;                              // transientError:1
    if (/(#100)|Không tìm thấy người dùng/i.test(m)) return true;                            // người dùng không tồn tại
    return false;
  }

  // Rút bằng chứng từ chuỗi lỗi (có thể là "Ext: … | api: (#10)…") — log gọn, đúng nghĩa
  function windowSig(msg) {
    const m = String(msg || '');
    if (m.indexOf('(#551)') > -1) return '(#551) Người này hiện không có mặt';
    if (m.indexOf('ngoài khoảng thời gian cho phép') > -1) return '(#10) ngoài khoảng thời gian cho phép';
    return '(chính sách cửa sổ 24h)';
  }

  function isThreadControlError(msg) {
    const m = String(msg || '');
    // CHẶN CẢ LÔ chỉ khi là chặn cấp page/hệ thống (rate limit, FB handover, thread control).
    // (#551 "Người này hiện không có mặt" là chặn của TỪNG NGƯỜI — chat khác vẫn gửi API bình thường;
    // trước đây 1 con #551 làm cả lô bị tước API → nhiều chat trong cửa sổ 24h mất oan.)
    // "(#10)…ngoài khoảng thời gian cho phép…" (cửa sổ 24h) cũng là của TỪNG NGƯỜI — không chặn lô.
    if (isWindowClosedError(m)) return false;
    return /\(#(10|613|80006)(?:,\d+)?\)/.test(m)
      || m.indexOf('kiểm soát thread') > -1
      || m.toLowerCase().indexOf('rate limit') > -1;
  }

  // Lấy conversation đầy đủ (thread_id, thread_key, from, updated_at…):
  // ưu tiên redux store của trang + state.allRows (O(1) Map), sau đó GET /conversations/{id}
  async function getFullConversation(conv) {
    try {
      const found = peekConv(conv);
      if (found && (found.thread_id || found.threadId)) return found;
    } catch (e) { /* ignore */ }
    try {
      const token = getToken();
      if (!token) return peekConv(conv);
      const res = await fetch(apiBase() + '/v1/pages/' + (conv.pageId || conv.id.split('_')[0])
        + '/conversations/' + encodeURIComponent(conv.id)
        + '?access_token=' + encodeURIComponent(token),
        { headers: { Accept: 'application/json' }, credentials: 'include' });
      const j = await res.json().catch(() => null);
      if (j && res.ok) return j.conversation || (j.data && j.data.conversation) || (j.id ? j : (j.data && j.data.id ? j.data : peekConv(conv)));
    } catch (e) { /* ignore */ }
    return peekConv(conv);
  }

  /* [v1.92.47] BÓC TIỀN TỐ CHỐNG-JSON-HIJACK `for (;;);` TRƯỚC KHI JSON.parse.
   * Bằng chứng ĐO ĐƯỢC (network-log.har §78 + network-log2.har §78, hai mẻ cách nhau 12 giờ):
   *   • 90/90 + 19/19 phản hồi `business.facebook.com/messaging/send/` bắt đầu bằng `for (;;);`
   *     (HTTP vẫn 200) rồi mới tới `{"__ar":1,"error":…}`. JSESSION bóc prefix này trước khi parse;
   *     JSON.parse trần thì ném `Unexpected non-whitespace character after JSON`.
   *   • /api/graphqlbatch/ thì KHÔNG có prefix, nhưng có **khối JSON THỨ HAI** nối sau `\r\n`:
   *     `{"__q0__":{…}}\r\n{spaces}{"successful_results":1,…}` — 47/47 phản hồi batch.
   * Hệ quả thật của việc không bóc: `Unexpected non-whitespace character after JSON at position
   * 40519` (log console Pancake v2) ⇒ `Cannot read properties of null (reading 'error')` ⇒
   * `CANNOT GET GLOBAL ID` ⇒ gửi sai thread ⇒ FB trả 1545041 "Người này hiện không có mặt"
   * hàng trăm lần. Script ta gọi `pancake.vn/api/v1` nên không tự sinh ra prefix, nhưng
   * [v1.92.47b] PHẠM VI DÙNG: chỉ bọc ở ACK Socket + (tuỳ chọn) — KHÔNG bọc ở `fetchJson`,
   * vì `fetchJson` là đường của KHÂU TẢI DANH SÁCH và người dùng yêu cầu giữ nguyên khâu tải
   * như 1.92.46. Đường GỬI (`timedFetch`) gọi `fetch()` trực tiếp nên không liên quan. */
  function stripJsonPrefix(txt) {
    const s = String(txt == null ? '' : txt);
    if (!s) return s;
    let out = s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
    out = out.replace(/^\s+/, '');
    if (out.slice(0, 9) === 'for (;;);') out = out.slice(9).replace(/^\s+/, '');
    else if (out.slice(0, 8) === 'for(;;);') out = out.slice(8).replace(/^\s+/, '');
    return out.trim() ? out : s;
  }

  // Lấy conversation 1 lần cho MỌI kênh trong cùng lượt gửi (ctx dùng chung) — đỡ gọi lại nhiều lần
  async function ctxFull(conv, ctx) {
    if (!ctx.fullLoaded) {
      // dòng conv đã đủ dữ liệu (threadId + pageId + threadKey + updatedAt — đủ cho payload Ext)
      // → dùng thẳng, khỏi GET conversation; thiếu thì nạp đầy đủ (redux/allRows có sẵn là xong ngay)
      ctx.full = (conv.threadId && (conv.pageId || conv.id) && conv.threadKey && conv.updatedAt)
        ? conv : await getFullConversation(conv);
      ctx.fullLoaded = true;
    }
    return ctx.full || null;
  }

  function detectPlatform(pageId) {
    try {
      const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      const pages = st && st.pages;
      if (!pages) return 'facebook';
      const map = pages.activatedMap || {};
      const arr = pages.activated || [];
      const p = map[pageId] || arr.find((x) => x && x.id === pageId);
      return (p && p.platform) || 'facebook';
    } catch (e) {
      return 'facebook';
    }
  }

  // Kết quả ĐẦU TIÊN khác null trong nhiều promise — giống helper oV trong _app
  function firstNonNull(promises) {
    return new Promise((resolve) => {
      let left = promises.length;
      let done = false;
      if (!left) { resolve(null); return; }
      promises.forEach((pr) => {
        const task = (typeof pr === 'function') ? pr() : pr;
        Promise.resolve(task).then((v) => {
          if (!done && v && (typeof v === 'string' || typeof v === 'number')) { done = true; resolve(v); return; }
          if (!done && --left === 0) resolve(null);
        }, () => {
          if (!done && --left === 0) resolve(null);
        });
      });
    });
  }

  // PSID dự phòng: API đã trả sẵn from_psid (và from.id — cùng giá trị trong dữ liệu Pancake,
  // đúng psid mà read_watermarks dùng) — dùng khi WS/Ext không tìm ra, đỡ gửi hỏng oan.
  function psidFromFull(full, pageId) {
    try {
      if (!full) return null;
      const ok = (v) => {
        const p = String(v || '');
        return /^\d{5,}$/.test(p) && p !== String(pageId) ? p : null;
      };
      // KHÔNG nhận from.id: đó có thể là FBID chứ không phải PSID — gửi nhầm thì Socket/Ext đều bị từ chối
      return ok(full.from_psid) || ok(full.fromPsid);
    } catch (e) { return null; }
  }

  // Kiểm tra ĐỒNG BỘ (0ms, không await) xem đã có sẵn global_id thật trong RAM/Cache/WebSocket chưa:
  // dùng để tách làn Cao Tốc (Socket Fast-Path 0ms) khỏi làn Dò Tìm (Slow Discovery) khi gửi 30.000 tin!
  function peekFastGlobalId(conv, full, badGid) {
    try {
      const f = full || conv || {};
      const key = String(f.id || (conv && conv.id) || '');
      const pageId = String(f.page_id || f.pageId || (conv && (conv.pageId || conv.page_id)) || key.split('_')[0] || '');
      const threadId = String(f.thread_id || f.threadId || (conv && (conv.threadId || conv.thread_id)) || '');
      const tKey = (pageId && threadId) ? (pageId + '_' + threadId) : '';
      const g1 = window.__GlobalIdCacheTest__, g2 = window.__tempGlobalIdCache__;
      const cc = key && convCtxCache[key];
      const cached = (key && ((g1 && g1.get(key)) || (g2 && g2.get(key)) || persistentGidMap[key] || (cc && cc.gid)))
        || (tKey && ((g1 && g1.get(tKey)) || (g2 && g2.get(tKey)) || persistentGidMap[tKey]));
      if (cached && String(cached) !== badGid && !/^\[object /.test(String(cached))) return String(cached);
      const rawGData = gidFromPayload(f) || f.globalId || (conv && conv.globalId)
        || (f.customers && f.customers[0] && f.customers[0].global_id) || '';
      if (rawGData && String(rawGData) !== badGid) {
        if (typeof window.__botfakeSaveGid__ === 'function') {
          window.__botfakeSaveGid__(key, pageId, threadId, String(rawGData));
        }
        return String(rawGData);
      }
      if (threadId && pageId) {
        const mh = window.__MqttHelper__;
        const sk = mh && mh.SOCKETS && mh.SOCKETS[pageId];
        const ip = sk && sk.context && sk.context.initPageData;
        const mGid = ip && ((ip.threadMapping && ip.threadMapping[threadId])
          || (ip.threadMappingStoreV2 && ip.threadMappingStoreV2[threadId]));
        if (mGid && String(mGid) !== badGid) {
          if (typeof window.__botfakeSaveGid__ === 'function') {
            window.__botfakeSaveGid__(key, pageId, threadId, String(mGid));
          }
          return String(mGid);
        }
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  // Tìm globalId của khách theo kiến trúc Đa Tầng Không Chặn Đầu:
  //   • Bước 1 (0ms): RAM / localStorage / IndexedDB / WebSocket threadMappingStoreV2.
  //   • Bước 1B: Server Pancake HTTP GET /messages (khớp @298730 trong _app:
  //     customers[].global_id) qua lane THÍCH ỨNG — nguồn có thẩm quyền nhất.
  //   • Bước 1C: Làn Nhanh (ctx.fastOnly) chưa có thì hoãn sang hồ nền, không giữ worker.
  //   • Bước 2 + 3 (hồ nền): WebSocket loadThread chạy trước một nhịp ngắn, Extension
  //     chỉ vào sau để khỏi tranh tài nguyên với chính lệnh gửi qua Extension.
  // QUAN TRỌNG (đối chiếu _app-9331d46f21a84eb1.v6.js @903213): hàm
  // window.findGlobalIdForConv của Pancake trả null cho CẢ Extension mất kết nối,
  // adapter success:false, thiếu data.globalId và exception. Vì vậy null của khâu
  // dò chỉ có nghĩa "CHƯA RÕ", tuyệt đối không phải bằng chứng khách khóa nick.
  async function resolveGlobalId(full, threadId, cacheKey, convFromPsid, forceFind, ctx) {
    const key = (full && full.id) || cacheKey;
    const pageId = (full && full.page_id) || (full && full.pageId) || String(cacheKey || '').split('_')[0];
    const tKey = (pageId && threadId) ? (pageId + '_' + threadId) : '';
    const discoveryPass = (ctx && ctx.gidRetryPass) ? 2 : 1;
    let foundSource = '';
    let extFinderRespondedNoGid = false; // Ext CÓ phản hồi success mà không có globalId (khác timeout/mất kết nối)
    if (ctx) {
      ctx.gidUnknown = false;
      ctx.extFinderReturnedNull = false; // giữ field cũ nhưng KHÔNG còn nguồn nào được set true
      ctx.noGidConfirmedByExt = false;
      ctx.extFinderRespondedNoGid = false;
      ctx.gidGateSkipExt = false;
    }
    const saveCache = (val) => {
      const s = String(val || '');
      if (!s) return;
      try {
        if (window.__GlobalIdCacheTest__) {
          if (key) window.__GlobalIdCacheTest__.set(key, s);
          if (tKey) window.__GlobalIdCacheTest__.set(tKey, s);
        }
        if (window.__tempGlobalIdCache__) {
          if (key) window.__tempGlobalIdCache__.set(key, s);
          if (tKey) window.__tempGlobalIdCache__.set(tKey, s);
        }
        if (typeof window.__botfakeSaveGid__ === 'function') {
          window.__botfakeSaveGid__(key, pageId, threadId, s);
        }
      } catch (e) { /* ignore */ }
    };
    const badGid = (forceFind && ctx && ctx.gid && !ctx.gidFromPsid) ? String(ctx.gid) : '';
    const mqtt = window.__MqttHelper__;
    const srvGidDirect = full && (gidFromPayload(full) || full.globalId || (full.customers && full.customers[0] && full.customers[0].global_id));
    // 1) Kiểm tra 0ms trong RAM (Cache + full.global_id + MqttHelper.threadMappingStoreV2)
    const fastGid = peekFastGlobalId(full, full, badGid);
    if (fastGid) {
      gidStats.cacheHit++;
      saveCache(fastGid);
      if (ctx) {
        ctx.gidFromPsid = false;
        ctx.gidFromServerOrCache = !!(srvGidDirect && String(srvGidDirect) === String(fastGid));
        ctx.gidDiscoveryState = 'cache';
        ctx.gidUnknown = false;
      }
      return String(fastGid);
    }
    // 1A) Kiểm tra trực tiếp IndexedDB __FBMetaDataStore__ của Pancake (bảng mặc định & global_user_ids_2)
    if (pageId && threadId && window.__FBMetaDataStore__) {
      try {
        const fbStore = window.__FBMetaDataStore__;
        let idbGid = null;
        if (typeof fbStore.get === 'function') {
          idbGid = await Promise.race([
            Promise.resolve(fbStore.get(pageId, threadId)).then((v) => v || fbStore.get(pageId, threadId, 'global_user_ids_2')),
            sleep(400),
          ]);
        } else if (typeof fbStore.findGlobalId === 'function') {
          idbGid = await Promise.race([Promise.resolve(fbStore.findGlobalId(pageId, threadId)), sleep(400)]);
        }
        if (idbGid && typeof idbGid === 'object') idbGid = idbGid.global_user_id || idbGid.globalId || idbGid.id || '';
        if (idbGid && String(idbGid) !== badGid) {
          gidStats.cacheHit++;
          saveCache(idbGid);
          if (ctx) {
            ctx.gidFromPsid = false;
            ctx.gidFromServerOrCache = false;
            ctx.gidDiscoveryState = 'cache';
            ctx.gidUnknown = false;
          }
          return String(idbGid);
        }
      } catch (e0) { /* ignore */ }
    }
    // Pass 2: entry HTTP cũ "thành công nhưng chưa có gid" vẫn có thể đã cũ —
    // trong lúc lô chạy, Pancake/Extension có thể vừa cập nhật mapping lên server.
    // Ép nạp lại đúng 1 lần cho nhóm Pass 2 (vẫn qua lane thích ứng + dedupe).
    if (ctx && discoveryPass === 2 && key) {
      try {
        const oldCc = convCtxCache[key];
        if (oldCc && oldCc.fetched && !oldCc.gid && !oldCc.inflight) {
          oldCc.fetched = false;
          oldCc.httpState = 'retry-pass2';
        }
      } catch (e0) { /* ignore */ }
    }
    // 1B) Nạp global_id từ Server Pancake HTTP GET /messages (khớp @298730 trong _app: n.customers[].global_id):
    //     Chỉ đánh dấu httpCtxTried = true khi request thực sự thành công (cc.fetched === true), để nếu lần 1
    //     mạng bận thì khi xuống Làn 2 vẫn thử lại lấy được global_id!
    if (!ctx || !ctx.httpCtxTried) {
      try {
        const cc = await ensureConvCtx(full || { id: key, pageId: pageId, threadId: threadId }, { force: true });
        if (ctx && cc) {
          ctx.httpState = cc.httpState || '';
          ctx.httpError = cc.httpError || '';
          if (cc.fetched) ctx.httpCtxTried = true;
        }
        const srvGid = (cc && cc.gid && String(cc.gid) !== badGid)
          ? String(cc.gid)
          : peekFastGlobalId(full, full, badGid);
        if (srvGid) {
          const isFromHttpSrv = !!(cc && cc.gid && (cc.gidSource === 'http' || cc.gidSource === 'conv'));
          if (!isFromHttpSrv) gidStats.cacheHit++;
          saveCache(srvGid);
          if (ctx) {
            ctx.gidFromPsid = false;
            ctx.gidFromServerOrCache = isFromHttpSrv;
            ctx.gidDiscoveryState = (cc && cc.gidSource) || 'cache';
            ctx.gidUnknown = false;
          }
          return String(srvGid);
        }
        if (ctx) {
          ctx.gidDiscoveryState = (cc && cc.fetched) ? 'server-no-gid' : 'http-unknown';
        }
      } catch (e1) {
        if (ctx) ctx.gidDiscoveryState = 'http-unknown';
      }
    }
    // 1C) Nếu đang chạy trong Làn Nhanh (ctx.fastOnly === true) mà cả Cache, WebSocket lẫn Server Pancake
    //     đều chưa có global_id (tức là buộc phải chờ Extension findGlobalIdForConv):
    //     Đánh dấu deferredToExt = true và trả về null NGAY LẬP TỨC (0ms) để đẩy sang extBacklogQueue,
    //     giải phóng worker của Làn Nhanh đi bắn ngay các chat tiếp theo (301..20.000)!
    if (ctx && ctx.fastOnly) {
      ctx.deferredToExt = true;
      ctx.gidUnknown = true;
      if (!ctx.gidDiscoveryState) ctx.gidDiscoveryState = 'deferred';
      return null;
    }
    const isLargeBatch = !!(batchStats && batchStats.total > 50);
    // Khớp 100% với this.concurrentlyGetGLobalIdExecuted (@961019 trong _app):
    // Nếu trong cùng ctx của chat này đã từng chạy trọn vẹn bước dò tìm mạng/Extension 1 lần rồi
    // mà không ra, KHÔNG chạy lại HTTP/Extension lần thứ 2 trong cùng một lần gửi!
    if (ctx && ctx.gidDiscoveryRan) {
      if (isLargeBatch) {
        ctx.gidUnknown = true;
        if (!ctx.gidDiscoveryState) ctx.gidDiscoveryState = 'unknown';
        return null;
      }
      if (!ctx.psidTried) {
        const guess2 = psidFromFull(full, pageId) || psidFromFull({ from_psid: convFromPsid || '' }, pageId);
        if (guess2 && String(guess2) !== badGid) {
          ctx.gidFromPsid = true;
          ctx.psidTried = true;
          return guess2;
        }
      }
      return null;
    }
    if (ctx) ctx.gidDiscoveryRan = true;

    // 2 + 3) KHỚP 100% concurrentlyGetGLobalId (@961661) TRONG _app-9331d46f21a84eb1.v6.js:
    //   • Chạy đua SONG SONG giữa WebSocket loadThread (PENDING_MESSAGES) và Extension (gidExtLane 16 luồng).
    let settled = false;
    let wsTimer = null;
    let wsPoll = null;
    let wsResolveRef = null;
    const pKey = (pageId && threadId) ? ('find_global_id_|' + pageId + '_|' + threadId) : '';
    const cleanupRace = (keepPendingForScroll) => {
      settled = true;
      if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; }
      if (wsPoll) { try { wsPoll(); } catch (eStop) { /* ignore */ } wsPoll = null; }
      if (!keepPendingForScroll) {
        try {
          if (mqtt && mqtt.PENDING_MESSAGES && pKey) {
            const pm = mqtt.PENDING_MESSAGES[pKey];
            if (pm && pm.clearTimeout) clearTimeout(pm.clearTimeout);
            delete mqtt.PENDING_MESSAGES[pKey];
          }
        } catch (e0) { /* ignore */ }
      }
    };
    const custName = (full && full.from && (full.from.name || full.from.username))
      || (full && (full.customerName || full.name)) || '';
    const rawUpd = String((full && (full.updated_at || full.updatedAt)) || '');
    const updMs = rawUpd ? Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(rawUpd) ? rawUpd : rawUpd + 'Z') : Date.now();
    const hasExtFinder = typeof window.findGlobalIdForConv === 'function'
      || !!(window.__ExtensionAdapter__ && typeof window.__ExtensionAdapter__.send === 'function');

    // Giải phóng nhánh WebSocket NGAY LẬP TỨC ở 0ms khi nhánh Extension đã kết thúc (tránh giữ chân worker),
    // nhưng giữ PENDING_MESSAGES[pKey] sống hết chu kỳ 30s để MqttHelper.loadThread (@825088) không bị cắt ở trang 1!
    const cutWsShort = () => {
      if (!settled && wsResolveRef) {
        if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; }
        if (wsPoll) { try { wsPoll(); } catch (eStop) { /* ignore */ } wsPoll = null; }
        const late = peekFastGlobalId(full, full, badGid);
        if (late) { saveCache(late); cleanupRace(false); wsResolveRef(String(late)); }
        else { cleanupRace(true); wsResolveRef(null); }
      }
    };

    /* [v1.92.35] ĐUÔI LÔ — CA SERVER ĐÃ NÓI "KHÔNG CÓ global_id" (lô 14:28, 8 851 chat):
     * 287 ca rơi vào nhóm này. HTTP GET /messages đã trả LỜI RÕ là hội thoại không có gid,
     * nhưng code vẫn giữ chúng chờ trọn 10 s cho WebSocket + Extension dò lại ⇒ `wave 14`
     * đứng 23 449 ms với `main bay 0 · Socket/page active 0/0`, đuôi lô ~10 chat/s.
     * Bằng chứng: đúng nhóm này Extension trả "không có gid" 287/287 lần ⇒ 10 s đó là chờ suông.
     * Nay ở lô lớn: chỉ cho 1,5 s (đủ cho `peekFastGlobalId` 60 ms + Ext phản hồi nhanh); không ra
     * thì đi tiếp y như cũ (gidUnknown → làn API bằng conversation_id). Lô nhỏ giữ nguyên 10 s
     * để dò kỹ. Tắt nhanh: GID_NOGID_SHORT_WAIT_MS = 0. */
    const GID_NOGID_SHORT_WAIT_MS = 1500;
    const serverSaysNoGid = !!(ctx && (ctx.httpState === 'ok-no-gid' || ctx.gidDiscoveryState === 'server-no-gid'));
    const shortNoGidWait = !!(isLargeBatch && serverSaysNoGid && GID_NOGID_SHORT_WAIT_MS > 0);
    if (shortNoGidWait) gidStats.shortNoGidWait++;
    const extWaitMs = shortNoGidWait ? GID_NOGID_SHORT_WAIT_MS : 10000;
    const wsWaitMs = hasExtFinder ? extWaitMs : (shortNoGidWait ? GID_NOGID_SHORT_WAIT_MS : 6000);
    const extStartDelayMs = discoveryPass === 2 ? 0 : 80;
    const raceTasks = [];

    // Nhánh 1: WebSocket PENDING_MESSAGES + wakingUpLoadThread + wsPoll 60ms (bắt ngay global_id ở <60ms khi loadThread về,
    // giữ PENDING_MESSAGES[pKey] tối đa 30s khớp findGlobalId @823397 trong _app để loadThread cuộn đủ 15 trang!)
    if (mqtt && pageId && threadId) {
      let sk = mqtt.SOCKETS && mqtt.SOCKETS[pageId];
      if (!sk && typeof mqtt.initSocket === 'function') {
        try { Promise.resolve().then(() => mqtt.initSocket(pageId)).catch(() => null); } catch (e0) { /* ignore */ }
      }
      if (mqtt.PENDING_MESSAGES && typeof mqtt.wakingUpLoadThread === 'function') {
        raceTasks.push(new Promise((resolve) => {
          wsResolveRef = resolve;
          const nowGid = peekFastGlobalId(full, full, badGid);
          if (nowGid) {
            foundSource = 'ws';
            saveCache(nowGid);
            if (ctx) ctx.gidFromServerOrCache = false;
            cleanupRace(false);
            resolve(String(nowGid));
            return;
          }
          wsPoll = bgClock.every(60, () => {
            if (settled) { if (wsPoll) { try { wsPoll(); } catch (eStop) { /* ignore */ } wsPoll = null; } return; }
            const hitGid = peekFastGlobalId(full, full, badGid);
            if (hitGid) {
              foundSource = 'ws';
              saveCache(hitGid);
              if (ctx) ctx.gidFromServerOrCache = false;
              cleanupRace(false);
              resolve(String(hitGid));
            }
          });
          const pendingExpireTimer = setTimeout(() => {
            try { if (mqtt && mqtt.PENDING_MESSAGES && pKey) delete mqtt.PENDING_MESSAGES[pKey]; } catch (e2) { /* ignore */ }
          }, 30000);
          wsTimer = setTimeout(() => {
            wsTimer = null;
            if (wsPoll) { try { wsPoll(); } catch (eStop) { /* ignore */ } wsPoll = null; }
            const lateGid = peekFastGlobalId(full, full, badGid);
            if (lateGid) {
              foundSource = 'ws';
              saveCache(lateGid);
              if (ctx) ctx.gidFromServerOrCache = false;
              cleanupRace(false);
              resolve(String(lateGid));
              return;
            }
            resolve(null);
          }, wsWaitMs);
          mqtt.PENDING_MESSAGES[pKey] = {
            callback: (r) => {
              clearTimeout(pendingExpireTimer);
              const val = (r && r.success && r.data && String(r.data) !== badGid) ? String(r.data) : null;
              if (val) {
                saveCache(val);
                if (!settled) {
                  foundSource = 'ws';
                  if (ctx) ctx.gidFromServerOrCache = false;
                  cleanupRace(false);
                }
              }
              if (!settled) {
                resolve(val);
              }
            },
            clearTimeout: pendingExpireTimer,
          };
          try { mqtt.wakingUpLoadThread(pageId); } catch (e2) { /* ignore */ }
        }));
      } else if (typeof mqtt.findGlobalId === 'function') {
        raceTasks.push(new Promise((resolve) => {
          const timer = bgClock.after(wsWaitMs, () => resolve(null));
          Promise.resolve()
            .then(() => mqtt.findGlobalId(pageId, threadId))
            .then((r) => {
              timer();
              const val = (r && r.success && r.data && String(r.data) !== badGid) ? String(r.data) : null;
              if (val) { foundSource = 'ws'; saveCache(val); if (ctx) ctx.gidFromServerOrCache = false; cleanupRace(false); }
              resolve(val);
            })
            .catch(() => { timer(); resolve(null); });
        }));
      }
    }

    // Nhánh 2: Extension GET_GLOBAL_ID_FOR_CONV qua lane thích ứng. Cho WebSocket
    // một nhịp ngắn trước; nếu WS đã tìm thấy thì nhánh này tự hủy, không tốn lệnh Extension.
    // [v1.92.47] `gidExtFinderAllowed()`: cầu dao đã đóng (xem noteGidFinderNoGid) ⇒ KHÔNG
    // xếp lệnh dò Ext nữa, chỉ còn HTTP + WebSocket. Mỗi chat tiết kiệm 1 lệnh Ext + 250 ms
    // + một vòng thử lại — đúng loại chi phí trong log console (Ext dò không ra gid mà vẫn
    // được gọi lại y nguyên).
    if (hasExtFinder && threadId && gidExtFinderAllowed()) {
      raceTasks.push((async () => {
        if (extStartDelayMs) await sleepUntil(Date.now() + extStartDelayMs, 'gid'); // [v1.92.9] WS có gid trước thì khỏi chờ đủ 80 ms
        if (settled || state.stopRequested) {
          return peekFastGlobalId(full, full, badGid) || null;
        }
        return gidExtLane(() => new Promise((resolve) => {
        const extStartedAt = Date.now();
        let extSettled = false;
        if (settled || state.stopRequested) { cutWsShort(); resolve(null); return; }
        // Kiểm tra lại ngay khi tới lượt trong gidExtLane: nếu WebSocket loadThread đã cuộn tới
        // và nạp xong global_id vào threadMappingStoreV2 trong lúc xếp hàng → lấy luôn ở 0ms, khỏi gọi Extension!
        const hitNow = peekFastGlobalId(full, full, badGid);
        if (hitNow) {
          foundSource = 'cache';
          gidStats.cacheHit++;
          saveCache(hitNow);
          if (ctx) ctx.gidFromServerOrCache = false;
          cleanupRace(false);
          resolve(String(hitNow));
          return;
        }
        const timer = bgClock.after(extWaitMs, () => {
          if (extSettled) return;
          extSettled = true;
          // Timeout chỉ có nghĩa Extension chưa trả lời kịp — KHÔNG phải "không có
          // globalId". Không set bất kỳ cờ chết nào ở đây.
          gidStats.extUnknown++;
          noteGidExtResult(false, true, Date.now() - extStartedAt);
          cutWsShort();
          resolve(null);
        });
        const finishExt = (val, source) => {
          try { timer(); } catch (eT3) { /* ignore */ }
          const alreadySettled = extSettled;
          extSettled = true;
          const elapsedMs = Date.now() - extStartedAt;
          if (val && String(val) !== badGid) {
            // Extension trả về SAU khi timer đã nổ: vẫn lưu cache cho kênh sau/Pass 2,
            // nhưng không đếm nguồn thêm lần nữa (promise dò đã chốt null rồi).
            if (!alreadySettled) {
              foundSource = source || 'ext';
              if (foundSource === 'ext') {
                gidStats.extHit++;
                noteGidExtResult(true, false, elapsedMs);
              } else if (foundSource === 'cache') {
                gidStats.cacheHit++;
              }
            }
            saveCache(val);
            cleanupRace();
            resolve(String(val));
          } else {
            // Bằng chứng từ _app @903213: null của findGlobalIdForConv bao gồm cả
            // mất kết nối/success:false/exception nên mọi null đều là CHƯA RÕ.
            // Tuy nhiên nếu Extension ĐÃ phản hồi rõ ràng (extFinderRespondedNoGid = true),
            // thì về mặt sức khỏe làn, Extension vẫn phản hồi tốt (responded = true).
            if (!alreadySettled) {
              gidStats.extUnknown++;
              if ((source || 'ext') === 'ext') noteGidExtResult(!!extFinderRespondedNoGid, false, elapsedMs);
            }
            cutWsShort();
            resolve(null);
          }
        };
        const tryMessengerLink = () => {
          const adapter = window.__ExtensionAdapter__;
          if (settled || !adapter || typeof adapter.send !== 'function') { finishExt(null, 'ext'); return; }
          Promise.resolve().then(() => adapter.send({
            type: 'MAKE_MESSENGER_LINK',
            pageId: pageId,
            convId: key,
            threadId: threadId,
            uiVersion: 6,
            globalId: null,
            conversationUpdatedTime: isNaN(updMs) ? Date.now() : updMs,
            customerName: custName,
            platform: 'facebook',
          /* ═══ [v1.93.13] 5 000 ms LÀ QUÁ NGẮN — `MAKE_MESSENGER_LINK` CŨNG ĐI QUA `Ee.init()` ═══
           * Nguồn `0.5.62_0/assets/background.js`:
           *   case"MAKE_MESSENGER_LINK": … new k_({…, uiVersion:b, globalId:v, …}).init()
           *   k_.handleFacebook(): case 3,4,6,7 ⇒ return this.getGlobalId().then(…)   // KHÔNG phải chỉ tạo link
           *   k_.getGlobalId(): this.globalId ? resolve : new Ee({convType:"INBOX", …}).init()
           *   Ee.init() → getGlobalIdFromInbox():
           *       const t = await le(this.pageId)                       // ① nạp base page
           *       … && await ee.preloadDocIds({pageId, isBusiness})     // ② fetch HTML + bóc doc_id
           *       a.graphql(Jt, …)                                      // ③ nguồn 1
           *       a.graphql(Zt, …) + r() đệ quy                        // ④ nguồn 2 (+đệ quy)
           *       this.findThread({…}) → graphqlbatch(rt/st)            // ⑤ nguồn 3
           *       this.getUserInboxByName(a) → fetch HTML + loadDocIds  // ⑥ nguồn 4
           *   ⇒ tối đa 4 request graphql + 2 lần fetch HTML, MỖI lần đều có retry/nhịp riêng.
           * 5 000 ms chỉ đủ cho trường hợp `this.globalId` đã có sẵn. Khi phải DÒ THẬT
           * (đúng nhóm ca khó ta cần nhất) thì gần như chắc chắn hết hạn ⇒ adapter trả
           * `{success:false, data:null}` ⇒ script coi là "không ra gid" dù ext vẫn đang chạy.
           *
           * Trần đúng phải theo hợp đồng adapter: `REPLY_INBOX_PHOTO` ∉ `u`
           * (`u = Set(["CONFIG_ROUTING_APP","CACHE_PAGES_ROUTING_APP"])`) ⇒ trần chung `l = 3e4`.
           * Lấy **14 000 ms**: đủ cho 2–3 lượt graphql (đo p90 dò lịch sử ~1,4 s/request ở
           * `HTTP fetch p50 1461ms`) mà vẫn ngắn hơn trần chung, để không giữ lane Ext quá lâu.
           * Đây là lệnh CHỈ ĐỌC (trả link + gid), không gửi tin ⇒ chờ lâu hơn KHÔNG thể sinh trùng. */
          }, { timeout: 14000 })).then((mlRes) => {
            if (mlRes && mlRes.success && mlRes.data) {
              /* [v1.93.13] ĐỌC CẢ TOP-LEVEL — cùng lỗi hình dạng như `GET_GLOBAL_ID_FOR_CONV`.
               * Ext trả: `{type:"MAKE_MESSENGER_LINK_SUCCESS", taskId, link, globalId}`
               * (k_.handleFacebook: `…, e.port.postMessage({…, link:V, globalId:z})`).
               * Adapter app bọc `{success, data: n}` ⇒ `mlRes.data.globalId` (đường cũ, đúng).
               * Adapter RIÊNG (`__botfake`) bọc phẳng `{success, globalId}` ⇒ đọc thêm `mlRes.globalId`.
               * Và `globalId` có thể là `null`/rỗng khi `uiVersion` rơi nhánh 1|2|5 ⇒ lúc đó mới
               * phải bóc `selected_item_id` từ `link` (link nhánh đó KHÔNG có selected_item_id,
               * nên vế sau chỉ có tác dụng với link nhánh 3|4|6|7). */
              let mlGid = (mlRes.data && mlRes.data.globalId) || mlRes.globalId || '';
              const mlLink = (mlRes.data && mlRes.data.link) || mlRes.link || '';
              if (!mlGid && mlLink) {
                try {
                  const qStr = String(mlLink).split('?')[1] || String(mlLink);
                  const sel = new URLSearchParams(qStr).get('selected_item_id');
                  if (sel && /^\d+$/.test(sel)) mlGid = sel;
                } catch (e3) { /* ignore */ }
              }
              if (mlGid && String(mlGid) !== badGid && String(mlGid) !== 'null') {
                finishExt(String(mlGid), 'ext'); return;
              }
            }
            finishExt(null, 'ext');
          }).catch(() => finishExt(null, 'ext'));
        };
        const finderPayload = {
          pageId: pageId,
          threadId: threadId,
          threadKey: (full && (full.thread_key || full.threadKey)) || ('t_' + threadId),
          isBusiness: true,
          conversationUpdatedTime: isNaN(updMs) ? Date.now() : updMs,
          customerName: custName,
          convType: 'INBOX', postId: null, convId: null,
        };
        /* ═══ [v1.93.13] BẬT `ENABLE_FIND_THREAD_BY_USERNAME` KHI ĐÃ DÒ HẾT NGUỒN ═══
         * Nguồn `0.5.62_0/assets/background.js`:
         *   case"ENABLE_FIND_THREAD_BY_USERNAME":{const{pageId:_,isEnabled:g}=r.data;
         *     const I=`findThreadByUsername_${_}`; self[I]=g;
         *     e.port.postMessage({type:"ENABLE_FIND_THREAD_BY_USERNAME_DONE",isEnabled:g}); break}
         * Cờ đó được đọc ở `bn(pageId)` trong `Ee.getGlobalIdFromInbox()`:
         *   I = x.find(w => w.all_participants.edges.map(n=>n.messaging_actor.name).includes(a))
         *   ;!I && a && bn(this.pageId) && (I = x.find(...cùng phép khớp TÊN...))
         * ⇒ Khi cờ BẬT, ext còn thêm 1 nguồn dò: khớp **customerName** với danh sách
         *   người tham gia thread.
         *
         * VÌ SAO ĐÁNG BẬT — đo được (log 22/11 09:54, lô 8 572):
         *   • `Ext trả không có gid 2` / `lần dò chưa ra 29` / `gate bỏ Ext no-gid 29`
         *   • 15 ca "thiếu gid" ⇒ 14 ca kết thúc ❌ "Không tìm được global_id để gửi"
         *     rồi "Không tìm thấy globalId thật cho Socket" ⇒ hết kênh.
         *   Cả 4 nguồn trước đó (Jt, Zt, rt/st, ge-tìm-theo-tên) đều đã chạy và cùng không ra.
         *
         * RỦI RO ĐÃ ĐO VÀ CHẶN: khớp theo TÊN có thể trúng NGƯỜI KHÁC nếu 2 khách TRÙNG TÊN.
         *   Ext đã chặn 1 lớp: `isThreadCorrect(threadInfoToRecheck)` — phải chứa đúng
         *   `this.threadId`, nếu không thì `Ee.init()` **reject `"INCORRECT THREAD"`**.
         *   Nhưng lớp đó SO `threadId`, mà `threadId` có thể bị chính bước dò gán lại
         *   (`p ? this.threadId = page_comm_item.id : this.threadId ||= …`) ⇒ KHÔNG đủ.
         * ⇒ Ta chỉ bật khi CẢ 4 nguồn đã cạn (không phải mặc định), và chỉ bật 1 LẦN/page
         *   (mỗi lần bật = 1 lệnh gửi ext; nó chỉ set một biến trong SW, KHÔNG gửi tin).
         *   Đây KHÔNG phải đường gửi ⇒ không thể sinh tin trùng. Nếu ext trả gid SAI thì
         *   tin đi nhầm người — nên ghi log rõ để đối chiếu, và đây là lý do chỉ bật sau
         *   khi mọi nguồn khác đã cạn (khi đó phương án thay thế là ❌ mất tin). */
        const enableFindThreadByName = () => {
          try {
            const ad = window.__ExtensionAdapter__;
            if (!ad || typeof ad.send !== 'function') return;
            const pg = String(pageId || '');
            if (!pg || nameSearchEnabled.has(pg)) return;
            nameSearchEnabled.add(pg);
            ad.send({ type: 'ENABLE_FIND_THREAD_BY_USERNAME', pageId: pg, isEnabled: true },
              { timeout: 5000 }).catch(() => { /* ignore */ });
            try {
              logLine('🧩 [gid] đã bật ENABLE_FIND_THREAD_BY_USERNAME cho page ' + pg
                + ' (4 nguồn gid đều cạn ⇒ cho ext khớp thêm theo TÊN khách; ext vẫn tự so threadId)');
            } catch (e0) { /* ignore */ }
          } catch (e) { /* ignore */ }
        };
        const onFinderNull = () => {
          if (extSettled) return; // timer đã chốt nhánh này — không phát thêm lệnh Ext
          /* Cạn nguồn ⇒ bật khớp-theo-tên cho các lần dò sau (1 lần/page). */
          enableFindThreadByName();
          // MAKE_MESSENGER_LINK là lệnh Ext phụ: chỉ dùng khi lô không lớn.
          // Ở lô lớn/Pass 2, bắn thêm lệnh này cho mọi ca khó làm Extension
          // càng nghẽn (log 5.637: khâu dò Ext không cứu được ca nào nhưng
          // Pass 2 vẫn tốn ~20s/ca ở lane Ext) — BATCH/HTTP/WS đã là đủ nguồn dò.
          if (!isLargeBatch && !(ctx && ctx.extMessengerTried)) {
            if (ctx) ctx.extMessengerTried = true;
            tryMessengerLink();
          } else {
            finishExt(null, 'ext');
          }
        };
        const adapter = window.__ExtensionAdapter__;
        if (adapter && typeof adapter.send === 'function') {
          try {
            if (typeof adapter.checkConnection === 'function'
              && !adapter.checkConnection({ silent: true })) {
              finishExt(null, 'ext');
              return;
            }
          } catch (e) { /* cứ thử gửi lệnh dò */ }
          // Gọi thẳng adapter để giữ được shape success/data và đặt timeout 10s.
          // Trong __ExtensionAdapter__.send (@715835 của _app):
          //   • Timeout hết giờ trả { success: false, data: null } (res.data === null) -> CHƯA RÕ.
          //   • Extension CÓ phản hồi (GET_GLOBAL_ID_FOR_CONV_SUCCESS không có globalId, hoặc
          //     GET_GLOBAL_ID_FOR_CONV_FAILURE trả { success: false, data: { type: '..._FAILURE', ... } })
          //     và không phải lỗi mất kết nối REOPEN_BROWSER:
          //     Khi bắn dồn 16–24 lệnh dò song song, vài chat sống có thể bị FB/Extension trả
          //     FAILURE tạm thời ở lần 1 (hoặc WebSocket loadThread đang cuộn gần tới). Vì vậy nghỉ
          //     250ms, kiểm tra lại WebSocket cache rồi thử lại GET_GLOBAL_ID_FOR_CONV đúng 1 lần trước
          //     khi kết luận extFinderRespondedNoGid = true.
          /* ═══ [v1.93.11] BẢO ĐẢM doc_id TRƯỚC KHI DÒ GID ═══
           * `Ee.getGlobalIdFromInbox()` (0.5.62) cần doc_id ở CẢ 4 nguồn:
           *   ① `O.get(Jt)`  PagesManagerInboxAdminAssignerRootQuery
           *   ② `O.get(Zt)`  PagesManagerInboxQueryUtilCommItemHeaderMercuryQuery (+ cquick_token)
           *   ③ `O.get(rt,st)` MessengerThreadlist…Query  ⇒ findThread()
           *   ④ `O.get(ge)`   BizInboxCustomerRelaySearchSourceQuery ⇒ tìm theo TÊN
           * Thiếu doc_id ⇒ cả 4 nguồn chết ⇒ `Ee.init()` reject KHÔNG LÝ DO
           * ⇒ đúng hình dạng "Ext: không gid" (2 246 ca/lô).
           * Trước bản này `ensureDocIds()` CHỈ được gọi trong `requestBatchGlobalIds`.
           * Nay gọi đúng 1 lần trước lệnh dò (idempotent, chỉ đọc, 0 request mới). */
          const callExtFinderOnce = () => Promise.resolve()
            /* [v1.93.13] AWAIT lệnh bảo đảm doc_id. `ensureDocIds` chỉ gửi
             * PRELOAD_DOC_IDS (không chờ ext xong) rồi trả ngay ⇒ không giữ lane lâu.
             * `Ee.getGlobalIdFromInbox()` cần `[Jt,Zt,rt,st]`; gửi trước lệnh dò để
             * ext có cơ hội nạp, thay vì dò trong lúc ext chưa có doc_id. */
            .then(() => ensureDocIds(finderPayload.pageId).catch(() => null))
            .then(() => adapter.send(
              Object.assign({ type: 'GET_GLOBAL_ID_FOR_CONV' }, finderPayload),
              { timeout: extWaitMs }
            ));
          callExtFinderOnce().then(async (res) => {
            /* [v1.93.13] ĐỌC ĐÚNG `globalId` TOP-LEVEL CỦA GET_GLOBAL_ID_FOR_CONV_SUCCESS.
             * Nguồn `0.5.62_0/assets/background.js`:
             *   case"GET_GLOBAL_ID_FOR_CONV":
             *     g.init().then(y=>{ y ? e.port.postMessage({type:"GET_GLOBAL_ID_FOR_CONV_SUCCESS",
             *                       success:!0, globalId:y, taskId:_}) : I() })
             * ⇒ `globalId` nằm ở **cấp ngoài**, KHÔNG lồng trong `data`.
             * Adapter của app bọc: `t({success:!0, data:n})` với `n` = nguyên message
             * ⇒ đường đúng là `res.data.globalId`. Script đã đọc đúng.
             * Đường ADAPTER RIÊNG `__botfake` (nếu có) lại bọc phẳng `{success, globalId}`
             * ⇒ phải chấp nhận CẢ HAI. Trước bản này chỉ đọc `res.data.globalId` nên adapter
             * phẳng trả gid THẬT mà script vẫn coi là "không có gid". */
            const _gidOf = (r0) => {
              if (!r0 || !r0.success) return '';
              const raw0 = (r0.data && r0.data.globalId) ? r0.data.globalId : r0.globalId;
              const v0 = (raw0 == null) ? '' : String(raw0);
              return (v0 && v0 !== badGid && v0 !== 'null' && v0 !== 'undefined') ? v0 : '';
            };
            let val = _gidOf(res);
            if (val) { finishExt(val, 'ext'); return; }
            const hitMid0 = peekFastGlobalId(full, full, badGid);
            if (hitMid0) { finishExt(hitMid0, 'cache'); return; }
            const d0 = res && res.data;
            const errStr0 = (d0 && typeof d0 === 'object') ? String(d0.errorMessage || d0.error || d0.reason || '') : '';
            const isConnErr0 = /REOPEN_BROWSER|unableToConnect|extensionDisconnected/i.test(errStr0);
            if (!settled && !extSettled && !state.stopRequested && !isConnErr0 && res && (res.success || (d0 && typeof d0 === 'object'))) {
              await sleepUntil(Date.now() + 250, 'gid'); // [v1.92.9] thức ngay khi cache/WS có gid mới
              if (settled || extSettled || state.stopRequested) { onFinderNull(); return; }
              const hitMid1 = peekFastGlobalId(full, full, badGid);
              if (hitMid1) { finishExt(hitMid1, 'cache'); return; }
              const res2 = await callExtFinderOnce().catch(() => null);
              val = _gidOf(res2);
              if (val) { finishExt(val, 'ext'); return; }
              const d2 = res2 && res2.data;
              const errStr2 = (d2 && typeof d2 === 'object') ? String(d2.errorMessage || d2.error || d2.reason || '') : '';
              const isConnErr2 = /REOPEN_BROWSER|unableToConnect|extensionDisconnected/i.test(errStr2);
              if (res2 && (res2.success || (d2 && typeof d2 === 'object' && !isConnErr2))) {
                extFinderRespondedNoGid = true;
                if (ctx) ctx.extFinderRespondedNoGid = true;
                gidStats.extRespondedNoGid++;
                /* ═══ [v1.93.13] `INCORRECT THREAD` LÀ CÂU TRẢ LỜI RÕ, KHÔNG PHẢI "IM LẶNG" ═══
                 * `Ee.init()` (0.5.62):
                 *   if(this.convType==="INBOX" && !this.isThreadCorrect(i) && !bn(this.pageId))
                 *     return C.error(`FAIL TO GET GLOBAL ID --> INCORRECT THREAD …`),
                 *            t("INCORRECT THREAD");
                 *   isThreadCorrect(e){ … e.length===0||e.every(t=>!t)||!this.threadId ? !1
                 *                          : e.includes(this.threadId) }
                 * ⇒ ext TÌM ĐƯỢC thread nhưng `threadId` không nằm trong `threadInfoToRecheck`
                 *   ⇒ "đã dò xong, KẾT QUẢ ÂM có lý do", khác hẳn "không phản hồi".
                 * Script cũ gộp cả hai vào `finishExt(null)` ⇒ bộ đếm sức khoẻ làn Ext nhận
                 * một ca "mù" trong khi ext đã trả lời dứt khoát.
                 * Ca này CŨNG KHÔNG được bật khớp-theo-tên: `isThreadCorrect` chính là lớp
                 * đang bảo vệ — bật thêm sẽ đúng cái làm nó trượt. */
                const incorrectThread2 = /INCORRECT THREAD/i.test(errStr2);
                if (incorrectThread2) {
                  gidStats.extIncorrectThread = (gidStats.extIncorrectThread || 0) + 1;
                  try {
                    logLine('🧩 [gid] Ext trả INCORRECT THREAD (threadId không nằm trong'
                      + ' threadInfoToRecheck) — câu trả lời RÕ của ext, KHÔNG phải im lặng;'
                      + ' không bật khớp-theo-tên cho ca này');
                  } catch (eIT) { /* ignore */ }
                }
                // [v1.92.47] ghi vào cầu dao: đóng đường dò Ext khi dồn đủ ca, hoặc khi
                // CÙNG thread lặp lại "không có gid" (hình dạng lỗi thật trong log console).
                noteGidFinderNoGid(threadId);
              }
              onFinderNull();
              return;
            }
            onFinderNull();
          }).catch(() => onFinderNull());
        } else if (typeof window.findGlobalIdForConv === 'function') {
          Promise.resolve().then(() => window.findGlobalIdForConv(finderPayload)).then((v) => {
            if (v && String(v) !== badGid) finishExt(v, 'ext');
            else onFinderNull();
          }).catch(() => onFinderNull());
        } else {
          tryMessengerLink();
        }
        }));
      })());
    } else if (!hasExtFinder) {
      // Dự phòng nếu không có Extension: thử lấy từ ensureConvCtx
      raceTasks.push((async () => {
        try {
          const cc = await ensureConvCtx(full || { id: key, pageId: pageId }, { force: true });
          if (cc && cc.gid && String(cc.gid) !== badGid) {
            foundSource = (cc.gidSource === 'http') ? 'http' : 'cache';
            saveCache(cc.gid);
            if (ctx) ctx.gidFromServerOrCache = true;
            cleanupRace();
            return String(cc.gid);
          }
        } catch (e) { /* ignore */ }
        cutWsShort();
        return null;
      })());
    }

    let gid = raceTasks.length ? await firstNonNull(raceTasks) : null;
    // Khi bấm Dừng, lane resolve {ok:false,error:'Đã dừng'} (OBJECT) thay vì chạy fn —
    // object đó KHÔNG phải global_id: không lọc thì String(gid) = '[object Object]' sẽ bị
    // saveCache ghi vào cache bền (localStorage + IndexedDB) và sống qua F5, bắn sai mãi.
    if (gid && typeof gid !== 'string' && typeof gid !== 'number') gid = null;
    if (!gid) {
      const lateHit = peekFastGlobalId(full, full, badGid);
      if (lateHit) { gid = lateHit; foundSource = foundSource || 'ws'; }
    }
    cleanupRace(!gid && !state.stopRequested);
    if (gid && String(gid) !== badGid) {
      if (foundSource === 'ws') gidStats.wsHit++;
      saveCache(gid);
      if (ctx) {
        ctx.gidFromPsid = false;
        ctx.extFinderReturnedNull = false;
        ctx.noGidConfirmedByExt = false;
        ctx.extFinderRespondedNoGid = false;
        ctx.gidGateSkipExt = false;
        ctx.gidDiscoveryState = foundSource || 'found';
        ctx.gidUnknown = false;
      }
      return String(gid);
    }
    // Mọi đường dò đều không ra ở lần này = CHƯA RÕ, không phải "đã xác nhận chết":
    // HTTP có thể 429/timeout, WS chưa cuộn tới thread, Extension null bị nuốt lý do.
    // Lô lớn: trả null để sendOne đánh dấu gidUnknown → Pass 2 cuối lô dò lại khi
    // lane đã thông. TUYỆT ĐỐI không bắn from_psid sai vào Socket.
    if (ctx) {
      ctx.extFinderReturnedNull = false;
      ctx.gidUnknown = true;
      // GATE NO-GID (lô lớn): chỉ bỏ lệnh gửi Ext thread-only khi đủ bằng chứng rẻ —
      // HTTP GET /messages đã THÀNH CÔNG nhưng server không có gid, BATCH_GET_GLOBAL_ID
      // đã nạp xong cho page, và chính Extension cũng phản hồi success mà không có gid.
      // Timeout/mất kết nối/success:false vẫn là CHƯA RÕ → giữ đường cứu cũ, không chốt oan.
      const ccEntry = key ? convCtxCache[key] : null;
      const httpOkNoGid = !!((ctx.httpState === 'ok-no-gid' || ctx.gidDiscoveryState === 'server-no-gid')
        || (ccEntry && ccEntry.fetched && !ccEntry.gid));
      const batchSettled = !!(pageId && !batchGidPromises[pageId]);
      // [v1.92.35] `|| shortNoGidWait`: khi ta CHỦ ĐỘNG rút ngắn thời gian dò (server đã trả lời
      // "không có gid"), thì không đòi thêm bằng chứng "Ext cũng trả lời không có gid" — chính ta
      // đã không cho Ext đủ thời gian trả lời. Giữ nguyên hệ quả đã đo ở lô 14:28: nhóm này KHÔNG
      // gửi Ext thread-only (vô ích, chỉ trả 1545041) mà đi thẳng làn API.
      if (isLargeBatch && httpOkNoGid && batchSettled && (extFinderRespondedNoGid || shortNoGidWait)) {
        ctx.noGidConfirmedByExt = true;
        ctx.gidGateSkipExt = true;
        ctx.gidDiscoveryState = 'ext-responded-no-gid';
        gidStats.gateSkip++;
      } else {
        ctx.noGidConfirmedByExt = false;
        ctx.gidGateSkipExt = false;
        if (!ctx.gidDiscoveryState || ctx.gidDiscoveryState === 'found') {
          ctx.gidDiscoveryState = hasExtFinder ? 'unknown' : 'no-ext-finder';
        }
      }
    }
    gidStats.unknown++;
    if (isLargeBatch) {
      return null;
    }
    // 4) CUỐI CÙNG (chỉ cho lô nhỏ <=50 chat) mới đoán from_psid cho kênh dự phòng
    if (!ctx || !ctx.psidTried) {
      const guess = psidFromFull(full, pageId) || psidFromFull({ from_psid: convFromPsid || '' }, pageId);
      if (guess && String(guess) !== badGid) {
        if (ctx) {
          ctx.gidFromPsid = true;
          ctx.psidTried = true;
          ctx.gidUnknown = false;
          ctx.gidDiscoveryState = 'psid-guess';
        }
        return guess;
      }
    }
    return null;
  }

  // Gửi qua Facebook WebSocket — ĐÚNG đường "gửi bình thường" mà app/nhân viên vẫn dùng
  // (_app: executeBySocketFB @974800 → __MqttHelper__.sendMessage @831250 → publish /ls_req)
  // id kiểu app (epoch_id/otid trong khung /ls_req): Date.now() ghép 22-bit ngẫu nhiên → thập phân.
  // Bắt chước đúng hàm sinh id của app (module 231748) — dùng BigInt cho gọn, có dự phòng nếu thiếu.
  function epochId() {
    try {
      const bin = Date.now().toString(2)
        + ('0000000000000000000000' + Math.floor(4294967295 * Math.random()).toString(2)).slice(-22);
      return BigInt('0b' + bin).toString();
    } catch (e) {
      return String(Date.now()) + String(Math.floor(Math.random() * 1e6));
    }
  }

  const socketNoAckStreak = {};
  const socketRejectStreak = {};
  const socketConfirmedDeadStreak = {};
  const socketReconnectPromises = {};
  const socketLastPublishAt = {};
  // 🔥 [FIX-TỐC-ĐỘ] 4ms = 250 khung/s/page → 2 page = 500/s. An toàn cho FB MQTT (đã test 6ms ổn).
  const SOCKET_MIN_PACE_MS = 4;
  async function paceSocketPublish(pageId) {
    const pid = String(pageId || '');
    if (!pid) return;
    const now = Date.now();
    const nextAt = Math.max(now, (socketLastPublishAt[pid] || 0) + SOCKET_MIN_PACE_MS);
    socketLastPublishAt[pid] = nextAt;
    const waitMs = nextAt - now;
    if (waitMs > 0) await sleepUntil(Date.now() + waitMs); // [v1.92.9] nhịp phát Socket giữ nguyên, chỉ ngắt được khi Dừng
  }

  function isSocketAlive(sock) {
    try {
      if (!sock || !sock.instance) return false;
      if (sock.instance.$10 && typeof sock.instance.$10.isRunning === 'function') {
        return !!sock.instance.$10.isRunning();
      }
      return true;
    } catch (e) { return false; }
  }

  // Trong _app (@816994 & @818850), initSocket(pageId) trả về ngay sau khi tạo `new MqttChannel(n)`
  // (lúc này sock.requestId === -1, sock.connectAt = Date.now()), TRƯỚC KHI WebSocket bắt tay xong,
  // subscribe `/ls_resp` (~400ms) và chạy `sendInitMessages` (ngủ 500ms rồi bắn type: 2 đồng bộ
  // database 205, tăng sock.requestId >= 1 ở ~1.000ms — xem batmesss.har frame 0->16).
  // Nếu gọi helper.publish('/ls_req', task 46) khi sock.requestId < 1, gói tin sẽ rơi vào khoảng trống
  // chưa subscribe `/ls_resp` và bị mất ACK (treo 15s). Hàm này kiểm tra socket đã thực sự qua bước init.
  function isSocketSynced(sock) {
    if (!isSocketAlive(sock)) return false;
    if (typeof sock.requestId === 'number' && sock.requestId < 1) return false;
    if (typeof sock.connectAt === 'number' && Date.now() - sock.connectAt < 1000) return false;
    return true;
  }

  async function waitForSocketSynced(helper, pageId, maxWaitMs) {
    const limit = maxWaitMs || 2500;
    const deadline = Date.now() + limit;
    let sawJustSynced = false;
    while (Date.now() < deadline && !state.stopRequested) {
      const s = helper && helper.SOCKETS && helper.SOCKETS[pageId];
      if (!isSocketAlive(s)) return s;
      if (isSocketSynced(s)) {
        if (sawJustSynced) await sleepUntil(Date.now() + 180, 'sock-sync'); // [v1.92.9]
        return helper && helper.SOCKETS && helper.SOCKETS[pageId];
      }
      sawJustSynced = true;
      // Điều kiện sync = (connectAt + 1000 ms) VÀ (requestId ≥ 1). Mốc thời gian ngủ ĐÚNG hạn,
      // phần requestId chỉ cần nhịp 25 ms vì frame WS không móc được sự kiện.
      {
        const mark = (s && typeof s.connectAt === 'number') ? (s.connectAt + 1000) : 0;
        const now = Date.now();
        const wakeAt = mark > now ? Math.min(deadline, mark) : Math.min(deadline, now + 25);
        await sleepUntil(wakeAt, 'sock-sync');
      }
    }
    return helper && helper.SOCKETS && helper.SOCKETS[pageId];
  }

  async function ensureAliveSocket(helper, pageId, forceReconnect) {
    let sock = helper.SOCKETS && helper.SOCKETS[pageId];
    if (!forceReconnect && isSocketAlive(sock)) {
      if (!isSocketSynced(sock)) sock = await waitForSocketSynced(helper, pageId, 2500);
      return sock;
    }
    if (socketReconnectPromises[pageId]) {
      await Promise.race([socketReconnectPromises[pageId], sleep(12000)]);
      return helper.SOCKETS && helper.SOCKETS[pageId];
    }
    if (typeof helper.initSocket === 'function') {
      socketReconnectPromises[pageId] = (async () => {
        try {
          if (sock && !isSocketAlive(sock) && sock.instance && typeof sock.instance.shutdown === 'function') {
            try { sock.instance.shutdown(); } catch (e0) { /* ignore */ }
          }
          await Promise.race([Promise.resolve().then(() => helper.initSocket(pageId)), sleep(12000)]);
          await waitForSocketSynced(helper, pageId, 2500);
          socketNoAckStreak[pageId] = 0;
        } catch (e) { /* ignore */ }
        socketReconnectPromises[pageId] = null;
      })();
      await socketReconnectPromises[pageId];
    }
    return helper.SOCKETS && helper.SOCKETS[pageId];
  }

  // Gửi TRỰC TIẾP khung /ls_req của app qua helper.publish — BỎ BƯỚC CHỜ 1S trên từng tin sau khi socket đã ấm.
  // Hỗ trợ đầy đủ cả ẢNH (task label "46" với attachment_fbids, send_type: 3, source: 0) lẫn TEXT
  // (task label "46" với send_type: 1, source: 4456448) + watermark label "21", khớp 100% với
  // ef.Z.sendMessage (@831250) trong _app-9331d46f21a84eb1.v6.js!
  async function socketPublishSend(helper, pageId, gid, text, attFbIds, firedCb, opts) {
    let sock = helper.SOCKETS && helper.SOCKETS[pageId];
    const warm = socketWarmPromises[pageId];
    if (warm) {
      await Promise.race([warm, sleep(12000)]);
      sock = helper.SOCKETS && helper.SOCKETS[pageId];
    }
    // TUYỆT ĐỐI không shutdown/xóa socket đang sống giữa lô gửi vì sẽ làm đứt toàn bộ các frame khác đang bay!
    if (!isSocketAlive(sock)) {
      sock = await ensureAliveSocket(helper, pageId, false);
    } else if (!isSocketSynced(sock)) {
      // Socket vừa mới được initSocket tạo ra (<1s hoặc chưa gửi sendInitMessages):
      // chờ ~1s cho tới khi onSubscribe('/ls_resp') + sendInitMessages hoàn tất rồi mới publish!
      sock = await waitForSocketSynced(helper, pageId, 2500);
    }
    if (!isSocketAlive(sock)) return { kind: 'dead' };
    if (typeof helper.publish !== 'function' || typeof helper.findAllBlockActions !== 'function') {
      return { kind: 'legacy' }; // helper cũ — quay về sendMessage đầy đủ
    }
    sock.taskId = sock.taskId || 0;
    const lateApply = (opts && typeof opts.lateApply === 'function') ? opts.lateApply : null;
    /* [v1.93.3] Xem chỗ gọi (sendViaSocket): ACK rejected = FB nói ĐỨT KHOÁT tin chưa đi. */
    const onRejected = (opts && typeof opts.onRejected === 'function') ? opts.onRejected : null;
    const hasPhoto = Array.isArray(attFbIds) && attFbIds.length > 0;
    const hasText = !!(text && String(text).length > 0);
    const tasks = [];
    if (hasPhoto) {
      tasks.push({
        failure_count: null,
        label: '46',
        payload: JSON.stringify({
          attachment_fbids: attFbIds,
          mark_thread_read: 0,
          otid: epochId(),
          send_type: 3,
          source: 0,
          sync_group: 205,
          text: null,
          thread_id: gid,
        }),
        queue_name: gid,
        task_id: ++sock.taskId,
      });
    }
    if (hasText || !hasPhoto) {
      tasks.push({
        failure_count: null,
        label: '46',
        payload: JSON.stringify({
          mark_thread_read: 1,
          otid: epochId(),
          send_type: 1,
          source: 4456448,
          sync_group: 205,
          text: text || '',
          thread_id: gid,
        }),
        queue_name: gid,
        task_id: ++sock.taskId,
      });
    }
    tasks.push({
      failure_count: null,
      label: '21',
      payload: JSON.stringify({ last_read_watermark_ts: Date.now(), sync_group: 205, thread_id: gid }),
      queue_name: gid,
      task_id: ++sock.taskId,
    });
    const frame = {
      epoch_id: epochId(),
      version_id: '9942677559150662',
      tasks: tasks,
    };
    await paceSocketPublish(pageId);
    const publishedAt = Date.now();
    // [v1.91.76] Log lượt 10k: ACK TB 2317ms · MAX 15544ms, bucket ≥5s có 420 ca ⇒ ngưỡng
    // 15000ms cắt oan đúng những ACK chậm nhất (mỗi ca bị cắt thành "no-ACK" rồi phải kiểm
    // chứng lịch sử). Nới lên 20000ms cho lô lớn; lô ≤30 chat vẫn 8000ms cho nhanh.
    // [v1.91.87] HẠN CHỜ THÍCH ỨNG thay cho chờ cứng 8s/20s.
    // Lô 5 897 tin: ACK TB 1 507ms · max 3 900ms ⇒ chờ 8–20s là dư gấp nhiều lần.
    // Kênh ACK chết thì trễ đúng bằng hạn chờ rồi vẫn no-ACK ⇒ chờ dài chỉ làm chậm.
    // [v1.92.2] HẠN CHỜ ACK THEO ĐÚNG SỐ ĐO HAR (thay vì 2,5–20s như trước).
    // Đo trực tiếp 3 HAR có `_webSocketMessages`, ghép `request_id` của /ls_req với /ls_resp:
    //   batmesss   13/14 khớp · p50 234ms · p90 256ms · max 300ms
    //   guisot     26/27 khớp · p50 326ms · p90 390ms · max 1 531ms
    //   guikhachcu  2/5  khớp · p50 414ms (HAR cũ, ít mẫu)
    //   khoảng cách giữa 2 lệnh gửi liên tiếp: min 0ms ⇒ FB nhận bắn dồn, không cần nhịp.
    // ⇒ ACK thật về sau ~0,3s; giữ slot 2,5–7,5s chỉ để chờ là tự bóp làn:
    //   lô 09:34 có 192 làn nhưng chỉ phát 60 tin/s ⇒ mỗi lệnh chiếm ~3,2s (khớp comment "192 ÷ 3,43s").
    // Nay: hạn chờ = 3×p90 nhưng CHẶN trong [1 200ms, 3 000ms]. ACK về muộn hơn vẫn không mất:
    // ca quá hạn ⇒ no-ACK ⇒ đăng ký kiểm chứng lịch sử nền (chỉ nâng ⚠→✅, KHÔNG gửi lại).
    // HAR cũng cho thấy ~5% request không có /ls_resp (1/14 và 1/27) nên ca no-ACK là có thật,
    // nhưng chúng phải được xử lý bằng kiểm chứng nền, không phải bằng cách giữ làn 20 giây.
    // Trần 3 000 ms: ACK thật của Pancake về sau ~0,3 s (HAR); giữ làn lâu hơn chỉ bóp thông lượng.
    // Ca vượt trần ⇒ 'noack' ⇒ kiểm chứng lịch sử, KHÔNG bắn lại.
    // [v1.92.24] TRẦN CHỜ ACK PHẢI BÁM SỐ ĐO — KHÔNG ĐƯỢC CHẶN DƯỚI p90.
    // Lô 09:46 (188 chat, 1.92.22): ACK TB 2 609 ms · p50/p90 2 490/3 086 ms · trần CỨNG 3 000 ms
    // ⇒ hạn chờ 3 000 < p90 ⇒ 16 ca "no-ACK" OAN (thật ra ACK chỉ chậm hơn 3 s), kéo theo 11 chuỗi
    // kiểm chứng + bắn cứu ⇒ GỬI TRÙNG. Nay trần = p90 × 1,6, kẹp trong [3 000, 6 000]:
    // p90 nhỏ như HAR (256 ms) vẫn 3 000 ms y như cũ; p90 lớn thì nới đúng theo số đo.
    /* [v1.92.48] HAI CỬA SỔ TÁCH RỜI — xem ACK_HOLD_* / ACK_LISTEN_MAX_MS ở trên.
     *   ackWaitMs   = giữ SLOT = clamp(p90×3, 1 200, 6 000) — GIỐNG HỆT 1.92.47 (tốc độ).
     *   ackListenMs = giữ CHỖ NHẬN = max(12 000, ackWaitMs + 6 000), trần 30 000 ms.
     * Lô 10:01: hạn chờ hiệu dụng 3 974 ms nhưng max ACK của chính lô là 7 988 ms ⇒ 340 ca
     * ≥5 s bị cắt rồi bị coi là no-ACK. Nay chỗ nhận còn sống 12 s ⇒ gói đó vẫn được phân xử. */
    const ackWaitMs = ackHoldMsFor(sockAckP90());
    const ackListenMs = ackListenMsFor(ackWaitMs);
    try { if (pageId) pageLastAckWait[pageId] = ackWaitMs; } catch (e0) { /* ignore */ }
    /* ===== SỬA GỐC "MẤT ACK" Ở LÔ LỚN =====
     * Trong _app (@818834) hàm publish() làm đúng thế này:
     *     i = { app_id, payload, request_id: ++sock.requestId, type }
     *     this.PENDING_MESSAGES[`${pageId}_${i.request_id}`] = { callback, clearTimeout }
     *     instance.publish('/ls_req', JSON.stringify(i))
     * và khi /ls_resp về: request_id được echo lại → helper tra đúng key đó để resolve.
     *
     * Bản cũ ĐOÁN id của chính mình bằng `sock.requestId + 1` ĐỌC TRƯỚC khi gọi publish
     * (cách nhau một microtask Promise.resolve().then). Với 192 làn cùng một page, hàng chục
     * frame khác chen vào giữa ⇒ id đoán gần như LUÔN SAI. Tệ hơn: khi hết 15s nó
     * clearTimeout + delete PENDING_MESSAGES[key đoán] — tức entry của TIN KHÁC — làm promise
     * của tin kia không bao giờ resolve (timer của nó vừa bị xoá) ⇒ chat treo "chờ ACK" tới
     * watchdog 180s. Đây chính là "mất ACK" hàng loạt ở lô 10k.
     *
     * Nay:
     *   1) đọc requestId NGAY SÁT lệnh gọi (không await/microtask ở giữa ⇒ chính xác tuyệt đối
     *      vì request_id = ++sock.requestId xảy ra đồng bộ bên trong publish);
     *   2) timeout chỉ dọn entry CỦA CHÍNH MÌNH, và chỉ khi còn đúng object tham chiếu đó —
     *      không bao giờ chạm vào entry của tin khác.
     */
    let myKey = null;
    let myEntry = null;
    /* [v1.92.48] ĐÂY LÀ GỐC CỦA "MẤT ACK" (bản trước xoá CHỖ NHẬN ngay khi hết giờ):
     *
     *   cũ:  hết ackWaitMs ⇒ clearTimeout + delete PENDING_MESSAGES[myKey]
     *        ⇒ /ls_resp về sau đó KHÔNG tra được callback (app log "NOT_FOUND_CALLBACK_FOR_RESPONSE")
     *        ⇒ classify() nhận payload=null ⇒ ⚠ oan ⇒ kiểm chứng ⇒ bắn cứu Ext ⇒ nguồn tin trùng.
     *   nay: hết ackWaitMs ⇒ chỉ ĐÁNH DẤU ⚠ (resolve timedOut như cũ, hành vi chốt sổ KHÔNG đổi)
     *        và GIỮ entry thêm tới ackListenMs. Gói về muộn vẫn giao đúng callback ⇒ phân xử
     *        thật (✅/❌) qua `lateRef` bên dưới — đường CHỈ ĐỌC, không bắn thêm lệnh nào.
     *        Hết ackListenMs mới dọn: clearTimeout + delete, và đánh dấu `mySilent = true`
     *        để lần no-ACK này được tính là IM LẶNG THẬT (bằng chứng) thay vì "hết hạn chờ". */
    let mySilent = false;
    /* [v1.92.49] PHÂN XỬ MUỘN CHỈ ĐƯỢC CHẠY KHI THẬT SỰ QUÁ HẠN.
     * Lô 11:05 (6 920 chat): dòng 🔔 in "ACK về MUỘN đã phân xử 6 785 (✅ 0 · FB từ chối 0)"
     * trong khi 📡 in "ACK OK/rejected/no-ACK 3 909/2 876/0" ⇒ 3 909 + 2 876 = 6 785 ĐÚNG BẰNG
     * số ACK ĐẾN ĐÚNG HẠN. Nguyên nhân: `lateRef` nhận MỌI gói /ls_resp (kể cả gói về sớm),
     * nên mỗi tin bị đếm 2 lần vào sockLateAck. Cờ dưới đây chặn đúng chỗ resolve.
     * ⇒ Số 6 785 KHÔNG phải "6 785 ACK muộn" và KHÔNG chứng minh được "không mất ACK".
     * Bằng chứng thật của lô đó là `hết hạn chờ 0` + `im lặng THẬT 0` + no-ACK 0. */
    let ackTimedOut = false;
    let lateRef = null; // { resolve } — bơm kết quả ACK về muộn cho classify() chạy lại
    const lateP = new Promise((resolve) => { lateRef = { resolve }; }); // ACK về SAU hạn chờ giữ slot
    const publishPromise = new Promise((resolve) => {
      let done = false;
      const timer = bgClock.after(ackWaitMs, () => {
        if (done) return;
        done = true;
        ackTimedOut = true; // [v1.92.49] từ đây mới coi là "về muộn"
        // KHÔNG xoá entry ở đây (xem chú thích trên) — chỉ đánh ⚠ rồi nghe tiếp tới ackListenMs.
        resolve({ success: false, data: null, timedOut: true });
        try {
          bgClock.after(Math.max(0, ackListenMs - ackWaitMs), () => {
            try {
              const stillMine = !!(myKey && helper.PENDING_MESSAGES && helper.PENDING_MESSAGES[myKey] === myEntry);
              // `stillMine` = entry còn nguyên nghĩa là KHÔNG gói nào về trong cả cửa sổ nghe.
              // Nếu app đã tự dọn (gói về đúng lúc) thì entry không còn ⇒ không kết luận im lặng.
              if (stillMine) {
                mySilent = true; // hết cả cửa sổ nghe mà chưa có gói nào ⇒ im lặng THẬT
                clearTimeout(myEntry.clearTimeout);
                delete helper.PENDING_MESSAGES[myKey];
              }
            } catch (e0) { /* ignore */ }
          });
        } catch (e1) { /* ignore */ }
      });
      let publishRet = null;
      try {
        const rid = (typeof sock.requestId === 'number') ? sock.requestId + 1 : null;
        publishRet = helper.publish(pageId, '/ls_req', frame, 3); // gán request_id = ++sock.requestId
        if (rid !== null) {
          myKey = pageId + '_' + rid;
          myEntry = (helper.PENDING_MESSAGES && helper.PENDING_MESSAGES[myKey]) || null;
          /* [v1.92.48] NGHE MUỘN: app xoá entry + resolve promise của CHÍNH NÓ khi callback chạy.
           * Ta bọc thêm một lớp CHỈ ĐỌC để bắt đúng trường hợp "đã hết hạn chờ giữ slot nhưng
           * ACK vẫn về trong cửa sổ nghe": giữ callback gốc, gọi nó như app vẫn gọi, rồi đưa
           * gói cho lateRef. Không đổi payload, không chặn app, không thêm request. */
          if (myEntry && typeof myEntry.callback === 'function') {
            const origCb = myEntry.callback;
            myEntry.callback = function (resp) {
              try {
                // [v1.92.49] CHỈ giao cho đường "muộn" khi ĐÃ quá hạn chờ giữ slot.
                // Gói về trước hạn đã được classify(g) thường xử lý (publishPromise) — giao
                // thêm ở đây là đếm 2 lần (đúng nguồn của con số 6 785 trong log 11:05).
                if (lateRef && ackTimedOut && !mySilent) lateRef.resolve(resp);
              } catch (eL) { /* ignore */ }
              return origCb(resp);
            };
          }
        }
      } catch (ePub) {
        publishRet = null;
      }
      Promise.resolve(publishRet)
        .then((res) => {
          if (done) return;
          done = true;
          try { timer(); } catch (eT1) { /* ignore */ }
          resolve(res);
        })
        .catch(() => {
          if (done) return;
          done = true;
          try { timer(); } catch (eT2) { /* ignore */ }
          resolve(null);
        });
    });
    /* ===== [v1.92.48] PHỤC HỒI ACK VỀ MUỘN — CHỈ ĐỌC, KHÔNG BẮN THÊM =====
     * Chạy khi /ls_resp về sau hạn chờ GIỮ SLOT nhưng còn trong cửa sổ NGHE (tới 30 s).
     *   • ok       ⇒ tin ĐÃ tới ⇒ hạ ⚠, markDelivered('socket'), chạy side-effect như ACK thường.
     *                Đây chính là ca mà bản cũ biến thành "no-ACK" ⇒ kiểm chứng ⇒ bù Ext ⇒ TRÙNG.
     *   • rejected ⇒ FB xác nhận ĐỨT KHOÁT là tin chưa đi ⇒ mở đường bù 1 lần như nhánh
     *                'rejected' bình thường (an toàn: FB nói chưa gửi). Không có ca này thì
     *                chốt ❌ và người dùng phải gửi tay.
     * KHÔNG gọi publish()/POST /messages ở đây. Chỉ có 1 trường hợp gọi mạng: bù của 'rejected'
     * — đúng hành vi đã có với rejected thường, không phải đường mới. */
    /* [v1.92.48] PHÂN BIỆT "HẾT HẠN CHỜ GIỮ SLOT" VỚI "IM LẶNG THẬT".
     * Chỉ loại thứ hai (mySilent: đã hết cả cửa sổ nghe 12 s mà không có gói nào) mới đủ tư cách
     * làm bằng chứng để tuyên bố "kênh ACK chết". Loại thứ nhất chỉ là chỉ báo ⇒ in log, và
     * nếu ACK về sau thì đường lateApply đã xử lý (✅) trước khi bất kỳ ai kết luận.
     * Trong lô 10:01, 101 ca no-ACK đều là loại thứ nhất (chúng bị cắt ở ~4–8 s, ACK thật của
     * lô đó lên tới 7 988 ms) nên lẽ ra KHÔNG được tính vào pageAckTimeoutRun. */
    const noteAckWindowOutcome = (pid, silent) => {
      try {
        const k = String(pid || '');
        if (!k) return;
        if (silent) {
          pageAckSilentRun[k] = (pageAckSilentRun[k] || 0) + 1;
          sendDiag.sockAckSilent = (sendDiag.sockAckSilent || 0) + 1;
        } else {
          pageAckHoldExpired[k] = (pageAckHoldExpired[k] || 0) + 1;
          sendDiag.sockAckHoldExpired = (sendDiag.sockAckHoldExpired || 0) + 1;
        }
      } catch (e0) { /* ignore */ }
    };
    // Phân loại kết quả từ gói /ls_resp của FB (dùng chung cho cả đường chờ ACK lẫn đường bắn-nhả)
    // `lateMode` = gói này về SAU hạn chờ giữ slot (cửa sổ nghe). Khi đó KHÔNG được kết luận
    // 'noack' cho việc thiếu payload (đã hết hạn chờ từ trước rồi), và phải đi đường phục hồi.
    const classify = (g, lateMode) => {
      if (!(g && g.payload)) {
        /* [v1.92.49] ACK về muộn mà KHÔNG có payload ⇒ không kết luận được gì. Trước đây nhánh
         * này im lặng hoàn toàn nên dòng 🔔 không phân biệt được "muộn và không xử lý được" với
         * "không có ca muộn nào". Nay đếm riêng để lần sau đọc được thật. */
        if (lateMode) sendDiag.sockLateNoack = (sendDiag.sockLateNoack || 0) + 1;
        socketNoAckStreak[pageId] = (socketNoAckStreak[pageId] || 0) + 1;
        recordSocketAckOutcome('noack', Date.now() - publishedAt, pageId);
        noteAckWindowOutcome(pageId, mySilent);
        // Publish ĐÃ được giao cho helper rồi mới mất phản hồi: socket chết lúc này KHÔNG
        // chứng minh được frame chưa đi (FB có thể đã nhận) → 'noack' = không rõ, cấm bù
        // bắn lần 2. 'dead' thật (socket chết TRƯỚC khi publish) đã bị chặn ở đầu hàm.
        return { kind: 'noack', publishedAt: publishedAt };
      }
      socketNoAckStreak[pageId] = 0;
      let resp = null;
      try { resp = JSON.parse(stripJsonPrefix(g.payload)); } catch (e) {
        recordSocketAckOutcome('noack', Date.now() - publishedAt, pageId);
        return { kind: 'noack', publishedAt: publishedAt };
      }
      const replaced = helper.findAllBlockActions(resp.step, 'replaceOptimsiticMessage') || [];
      const failed = helper.findAllBlockActions(resp.step, 'markOptimisticMessageFailed') || [];
      if (failed.length && !replaced.length) {
        recordSocketAckOutcome('rejected', Date.now() - publishedAt, pageId);
        if (!lateMode && onRejected) { try { onRejected(); } catch (eRJ) { /* ignore */ } }
        if (lateMode && lateApply) lateApply('rejected', Date.now() - publishedAt);
        return { kind: 'rejected' };
      }
      // QUAN TRỌNG: Khi gửi CẢ ẢNH LẪN CHỮ (2 task label "46"), nếu chữ đi được (replaced.length > 0)
      // nhưng ảnh bị từ chối (failed.length > 0), TUYỆT ĐỐI không được trả về 'ok' (sẽ làm mất ảnh mà chỉ có chữ!),
      // mà phải báo 'photo_failed_text_ok' để sendViaSocket upload fbId mới và bắn bù riêng phần ảnh!
      if (hasPhoto && hasText && failed.length > 0 && replaced.length > 0) {
        recordSocketAckOutcome('rejected', Date.now() - publishedAt, pageId);
        if (!lateMode && onRejected) { try { onRejected(); } catch (eRJ2) { /* ignore */ } }
        return { kind: 'photo_failed_text_ok' };
      }
      /* [v1.92.18] CHỐT ✅ PHẢI CÓ BẰNG CHỨNG DƯƠNG TÍNH.
       * Trước đây mọi payload không có markOptimisticMessageFailed đều rơi xuống 'ok' — kể cả
       * payload mang cờ lỗi (error / error_code / success:false). Ca đó bị chốt ✅ ⇒ không kiểm
       * chứng lịch sử, không bù ⇒ MẤT TIN IM LẶNG (đúng loại lỗi tệ nhất).
       * Nay: không có replaceOptimsiticMessage + có cờ lỗi ⇒ 'noack' = KHÔNG RÕ.
       * 'noack' đi đúng đường an toàn sẵn có: chốt ⚠, kiểm chứng lịch sử nền, KHÔNG BAO GIỜ
       * bắn lại (chỉ ⚠→✅ hoặc bắn cứu khi lịch sử chứng minh chưa tới). */
      const errFlag = !!(resp && (resp.error || resp.error_code != null
        || (Array.isArray(resp.errors) && resp.errors.length) || resp.success === false));
      if (!replaced.length && errFlag) {
        recordSocketAckOutcome('noack', Date.now() - publishedAt, pageId);
        return { kind: 'noack', publishedAt: publishedAt };
      }
      recordSocketAckOutcome('ok', Date.now() - publishedAt, pageId);
      if (lateMode && lateApply) lateApply('ok', Date.now() - publishedAt);
      return { kind: 'ok' };
    };
    // 🔥 NẤC 2 (v1.71.0): bắn xong NHẢ NGAY — không giữ worker chờ ACK của FB (vốn mất ~2,8s/tin).
    // Kết quả thật được classify ở nền khi /ls_resp về và gọi firedCb đúng 1 lần.
    if (typeof firedCb === 'function') {
      publishPromise
        .then((g) => { try { firedCb(classify(g)); } catch (e) { firedCb({ kind: 'noack', publishedAt: publishedAt }); } })
        .catch(() => firedCb({ kind: 'noack', publishedAt: publishedAt }));
      /* [v1.92.48] CHỈ ĐỌC — ACK về MUỘN hơn hạn chờ giữ slot nhưng còn trong cửa sổ nghe.
       * Cũ: chỗ nhận đã bị xoá ⇒ gói này mất ⇒ ⚠ ⇒ kiểm chứng ⇒ BẮN CỨU Ext (101 ca lô 10:01).
       * Nay: gói vẫn được giao ⇒ nếu là ✅ thì chốt luôn, KHÔNG bắn cứu ⇒ bớt đúng nguồn trùng.
       * Đường này không gọi publish/POST nào, chỉ markDelivered + side-effect nền như ACK thường. */
      lateP.then((resp) => {
        try {
          if (!resp) return;
          classify(resp, true);
        } catch (eL2) {
          try { sendDiag.sockLateAckErr = (sendDiag.sockLateAckErr || 0) + 1; } catch (eL3) { /* ignore */ } // ⚠ giữ nguyên, KHÔNG bắn lại
        }
      });
      return { kind: 'fired' };
    }
    const g = await publishPromise;
    /* [v1.92.48] Đường KHÔNG bắn-nhả (ảnh bù / lượt bù): kết quả đã trả về cho người gọi ngay
     * nên KHÔNG phân xử lại ở đây (sẽ đếm ACK hai lần và không đổi được quyết định đã trả).
     * Chỉ ghi nhận để lần sau có số: nếu gói về muộn thì đó là ca mà bản cũ coi là no-ACK. */
    if (!mySilent) {
      lateP.then((resp) => {
        try {
          if (!resp) return;
          sendDiag.sockLateAck = (sendDiag.sockLateAck || 0) + 1;
          sendDiag.sockLateUnapplied = (sendDiag.sockLateUnapplied || 0) + 1;
        } catch (e0L) { /* ignore */ }
      });
    }
    return classify(g);
  }

  const updatedGidConvSet = new Set();
  const spareFbIdPool = {};
  // 🔒 KHÓA CHỐNG TRÙNG (v1.72.0): các chat đã BẮN Socket ở chế độ bắn-nhả mà ACK chưa chốt.
  // Khi chat còn trong tập này: không kênh nào được bắn thêm cho chat đó (kể cả bù Extension) —
  // chỉ khi FB XÁC NHẬN TỪ CHỐI (rejected) thì mới được bù. Chặn đứng mọi đường bắn chồng gây lặp câu.
  const sockFiredPending = new Set();

  function recycleUnusedFbId(pageId, ctx) {
    if (!ctx) return;
    // Tuyệt đối không đẩy fbId (is_reusable=false, gắn conv_id riêng) của hội thoại A sang hội thoại B!
    ctx.nonReusableFbIds = null;
    ctx.nonReusableFbId = null;
  }

  // Mỗi cuộc hội thoại gửi kèm ảnh qua Socket hoặc Extension BẮT BUỘC phải có 1 fbId (is_reusable=false)
  // riêng biệt của cuộc hội thoại đó (đúng executeBySocketFB @976000 & executeByExtOnce @964800 trong _app).
  // Tuyệt đối KHÔNG dùng lại fbId (is_reusable=false) ĐÃ BẮN của cuộc hội thoại A cho cuộc hội thoại B.
  // Nhưng nếu fbId vừa tạo ra mà CHƯA TỪNG BẮN (nằm trong spareFbIdPool[pageId]), lấy dùng ngay ở 0ms!
  function uploadOneTimePhoto(pageId, photo, convId, ctx, forceFresh) {
    if (!photo) return Promise.resolve(null);
    // NHIỀU ẢNH (câu nhanh Alt+Q có ≥2 ảnh): bind cả mảng fbIds trong 1 lượt /contents/facebook
    // (đúng guianh1.har: 2 content_ids → 2 fb_ids trong ~30ms). fbIds của chat này giữ ở
    // ctx.nonReusableFbIds — tách hẳn fbId đơn của đường 1 ảnh bên dưới.
    const _items = normalizePhotoItems(photo);
    if (_items.length > 1) {
      if (!forceFresh && ctx && Array.isArray(ctx.nonReusableFbIds) && ctx.nonReusableFbIds.length >= _items.length) {
        return Promise.resolve({ ok: true, fbId: ctx.nonReusableFbIds[0], fbIds: ctx.nonReusableFbIds.slice() });
      }
      return photoUploadLane(() => uploadPhotoForPage(pageId, photo, { reusable: false, convId: convId }))
        .then((up) => {
          if (up && up.ok && up.fbIds && ctx) ctx.nonReusableFbIds = up.fbIds;
          return up;
        })
        .catch((e) => ({ ok: false, error: String(e && e.message || e) }));
    }
    if (!forceFresh && ctx && ctx.nonReusableFbId) {
      return Promise.resolve({ ok: true, fbId: ctx.nonReusableFbId });
    }
    const pid = String(pageId || '');
    if (!forceFresh && pid && spareFbIdPool[pid] && spareFbIdPool[pid].length > 0) {
      const pooledFbId = spareFbIdPool[pid].pop();
      if (pooledFbId) {
        if (ctx) ctx.nonReusableFbId = pooledFbId;
        return Promise.resolve({ ok: true, fbId: pooledFbId });
      }
    }
    return photoUploadLane(() => uploadPhotoForPage(pageId, photo, { reusable: false, convId: convId }))
      .then((up) => {
        if (up && up.ok && up.fbId && ctx) {
          ctx.nonReusableFbId = up.fbId;
        }
        return up;
      })
      .catch((e) => ({ ok: false, error: String(e && e.message || e) }));
  }

  async function sendViaSocket(conv, text, photo, ctx) {
    if (photo && !ctx && typeof photo === 'object' && !photo.url && !photo.id) {
      // tương thích ngược nếu nơi nào gọi sendViaSocket(conv, text, ctx)
      ctx = photo;
      photo = null;
    }
    ctx = ctx || {};
    if (conv.type === 'comment') return { ok: false, sent: false, error: 'Socket chỉ áp dụng cho inbox' };
    /* [v1.92.48] ĐĂNG KÝ ĐƯỜNG PHỤC HỒI ACK MUỘN cho ĐÚNG lần publish này.
     * `socketPublishSend` gọi hàm này ngay khi đã biết request_id. Đường phục hồi CHỈ ĐỌC
     * (xem chú thích ở lateApply trong socketPublishSend): ok ⇒ markDelivered; rejected ⇒
     * đi tiếp nhánh bù đã có. KHÔNG publish thêm, KHÔNG POST thêm. */
    let lateAckClosed = false; // đã có kết quả cho lần bắn này ⇒ ACK muộn không được chạy lại
    const onLateAck = (kind, latencyMs) => {
      try {
        if (lateAckClosed) return;
        lateAckClosed = true;
        sendDiag.sockLateAck = (sendDiag.sockLateAck || 0) + 1;
        if (kind === 'ok') {
          sendDiag.sockLateOk = (sendDiag.sockLateOk || 0) + 1;
          const nm0 = conv.name || conv.id;
          reopenUncertain(conv.id);
          markDelivered(conv.id, 'socket');
          if (ctx && ctx.isSocketRetryPass) sockRetryBudgetNote(sockRetryBudgetState, 'saved', 0);
          try { postSendSideEffects(conv); } catch (ePS) { /* ignore */ }
          logFailGrouped(nm0, 'ACK về MUỘN sau hạn chờ giữ slot (' + Math.round(latencyMs) + 'ms) — tin ĐÃ tới nơi, tính ✅ Socket'
            + ' (không bắn cứu ⇒ đây là ca trước đây sinh tin trùng)', '🔎', conv.id);
          return;
        }
        if (kind === 'rejected') {
          // FB nói ĐỨT KHOÁT tin chưa đi ⇒ bù 1 lần như nhánh rejected bình thường (an toàn).
          if (deliveredIds[conv.id] || finalFailedIds[conv.id]) return;
          const nm1 = conv.name || conv.id;
          sendDiag.sockLateRejected = (sendDiag.sockLateRejected || 0) + 1;
          /* [v1.93.1] ĐÂY LÀ BẰNG CHỨNG MẠNH NHẤT TRONG CẢ LƯỢT: FB trả lời trực tiếp rằng tin
           * CHƯA ĐI. Ghi lại để cổng chứng minh vắng mặt không bù vào ca này lần nữa. */
          noteFbRejected(conv.id, 'ACK muộn = FB từ chối (' + Math.round(latencyMs) + 'ms)');
          logFailGrouped(nm1, 'ACK muộn = FB TỪ CHỐI (' + Math.round(latencyMs) + 'ms sau khi gửi) — tin chưa đi, bù 1 lần', '🔁', conv.id);
          scheduleBuRetry(conv, text, photo, nm1, 'Socket bị FB từ chối (ACK muộn)', ['socket'],
            { ambiguous: false, via: 'socket', sentAt: Date.now() - Math.max(0, latencyMs) });
        }
      } catch (eLA) { /* đường phục hồi không được làm hỏng gửi */ }
    };
    const helper = window.__MqttHelper__;
    if (!helper || (typeof helper.sendMessage !== 'function' && typeof helper.publish !== 'function')) {
      return { ok: false, sent: false, error: 'Không thấy __MqttHelper__' };
    }
    const platform = detectPlatform(conv.pageId || conv.id.split('_')[0]);
    if (platform !== 'facebook') return { ok: false, sent: false, error: 'Socket chỉ áp dụng cho Facebook' };
    const full = await ctxFull(conv, ctx);
    if (!full) return { ok: false, sent: false, error: 'Không lấy được thông tin đoạn chat' };
    const pageId = full.page_id || conv.pageId || String(conv.id).split('_')[0];

    // 1) Giải quyết threadId & globalId TRƯỚC KHI upload ảnh (đúng thứ tự executeBySocketFB @976000 trong _app):
    //    Nếu chat không tìm được globalId thì dừng ngay, không lãng phí 1 lần upload ảnh reusable=false!
    if (!ctx.threadResolved) {
      let threadId = full.thread_id || full.threadId;
      if (!threadId && typeof window.__syncMissingThreadId__ === 'function') {
        try { threadId = await window.__syncMissingThreadId__(pageId, full.id || conv.id); } catch (e) { /* ignore */ }
      }
      ctx.threadId = threadId || null;
      ctx.threadResolved = true;
    }
    const threadId = ctx.threadId;
    if (!ctx.gidResolved) {
      ctx.gid = await resolveGlobalId(full, threadId, conv.id, conv.fromPsid, ctx.gidForceFind, ctx);
      ctx.gidResolved = true;
    }
    let gid = ctx.gid;
    // Luôn ưu tiên đối chiếu global_id mới nhất từ WebSocket threadMappingStoreV2 ngay từ trước lần bắn đầu tiên
    // (đảm bảo nếu có khách sống nằm lẫn trong cục khách chặn mà cache cũ lệch id thì vẫn lấy đúng global_id mới nhất!)
    if (threadId && pageId) {
      try {
        const sk = helper.SOCKETS && helper.SOCKETS[pageId];
        const ip = sk && sk.context && sk.context.initPageData;
        const wsGid = ip && ((ip.threadMapping && ip.threadMapping[threadId])
          || (ip.threadMappingStoreV2 && ip.threadMappingStoreV2[threadId]));
        if (wsGid && String(wsGid) !== String(gid)) {
          gid = String(wsGid);
          ctx.gid = gid;
          ctx.gidFromPsid = false;
        }
      } catch (e0) { /* ignore */ }
    }
    // Khớp 100% executeBySocketFB (@976000 trong _app): Socket MQTT Lightspeed CHỈ nhận global_id THẬT,
    // TUYỆT ĐỐI không nhận from_psid phỏng đoán (bắn from_psid vào /ls_req sẽ bị FB MQTT treo không trả ACK!).
    if (!gid || (ctx && ctx.gidFromPsid)) {
      recycleUnusedFbId(pageId, ctx);
      // Chưa có gid ở lần này không đồng nghĩa khách chết: khâu dò có thể vừa bị
      // 429/timeout/WS chưa cuộn tới. Đánh dấu rõ để sendBatch đưa sang Pass 2.
      return {
        ok: false, sent: false, gidUnknown: true,
        discoveryState: (ctx && ctx.gidDiscoveryState) || 'unknown',
        error: 'Không tìm thấy globalId thật cho Socket',
      };
    }
    // Lưu ngay global_id thật vào cache bền vững (kể cả khi khách đã chặn page), để ở các lần gửi sau
    // cục khách đã chặn này có sẵn fastGid0 ở 0ms mà không phải gọi lại GET /messages hay đợi loadThread!
    try {
      if (typeof window.__botfakeSaveGid__ === 'function') {
        window.__botfakeSaveGid__(conv.id, pageId, threadId, gid);
      }
    } catch (e0) { /* ignore */ }

    // 2) LUÔN GỘP NGUYÊN KHỐI [ẢNH + CHỮ] TRONG CÙNG 1 KHUNG /ls_req:
    //    Tuyệt đối không tách "gửi chữ trước, chờ ACK mới upload ảnh gửi sau" (inBlockedCluster cũ),
    //    vì ở chế độ bắn-nhả hàng loạt gói ảnh thứ 2 bị đẩy xuống cuối hàng đợi pageLane sau hàng nghìn
    //    gói chữ khác, gây hiện tượng "gửi câu trước, ảnh tới sau 1 phút" và làm đứng tiến độ giữa chừng.
    let attFbIds = null;
    if (photo) {
      const up = await uploadOneTimePhoto(pageId, photo, conv.id, ctx, false);
      if (!up || !up.ok || !up.fbId) {
        return { ok: false, sent: false, error: 'Không gắn được ảnh cho Socket (' + ((up && up.error) || 'lỗi upload') + ')' };
      }
      attFbIds = (up.fbIds && up.fbIds.length) ? up.fbIds.slice() : [up.fbId];
    }

    const recordSocketGidSuccess = () => {
      if (gid && (!ctx || !ctx.gidFromPsid)) {
        try {
          if (typeof window.__botfakeSaveGid__ === 'function') {
            window.__botfakeSaveGid__(conv.id, pageId, threadId, gid);
          }
          const fId = (full.from && full.from.id) || conv.fromPsid || '';
          const tok = getToken();
          if (pageId && fId && tok && !updatedGidConvSet.has(conv.id) && !(ctx && ctx.gidFromServerOrCache)) {
            updatedGidConvSet.add(conv.id);
            sideEffectLane(() => fetch(apiBase() + '/v1/pages/' + pageId + '/customers/' + encodeURIComponent(fId) + '/update_global_id?access_token=' + encodeURIComponent(tok), {
              method: 'POST',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ global_id: gid, conversation_id: conv.id, source: 'send_inbox', version: 1 }),
            }).catch(() => null));
          }
        } catch (e) { /* ignore */ }
      }
    };

    try {
      const pageLane = getPageSocketLane(pageId);
      const runPrioritySocket = (fn) => (typeof pageLane.priority === 'function' ? pageLane.priority(fn) : pageLane(fn));
      // settleSocketResult: TOÀN BỘ xử lý sau khi có kết quả publish (retry khi bị từ chối, bù ảnh,
      // phân loại lỗi…) — dùng chung cho đường chờ ACK (lô nhỏ) và đường bắn-nhả (lô lớn, chạy nền).
      const settleSocketResult = async (rawIn) => {
      let raw = rawIn;
      if (photo) {
        ctx.nonReusableFbId = null;
        ctx.nonReusableFbIds = null;
      }

      // Trường hợp đặc biệt: chữ đã đi thành công nhưng task ảnh bị markOptimisticMessageFailed
      // → TUYỆT ĐỐI không gửi lại chữ (tránh trùng chữ), mà upload 1 fbId mới và bắn bù RIÊNG PHẦN ẢNH (text = '')
      // ngay ở ĐẦU hàng đợi pageLane (runPrioritySocket) để ảnh đến ngay tức thì, không xếp sau chat khác!
      if (raw && raw.kind === 'photo_failed_text_ok' && photo) {
        socketRejectStreak[pageId] = 0;
        const freshPhotoUp = await uploadOneTimePhoto(pageId, photo, conv.id, ctx, true);
        if (freshPhotoUp && freshPhotoUp.ok && freshPhotoUp.fbId) {
          ctx.nonReusableFbId = null;
          ctx.nonReusableFbIds = null;
          sendDiag.photoRetry++;
          const retryPhotoOnly = await runPrioritySocket(() => socketPublishSend(helper, pageId, gid, '', (freshPhotoUp.fbIds && freshPhotoUp.fbIds.length) ? freshPhotoUp.fbIds : [freshPhotoUp.fbId]),
            null, { onRejected: () => noteFbRejected(conv.id, 'Socket ACK rejected (gửi ảnh bù) = FB từ chối nhận tin') });
          if (retryPhotoOnly && retryPhotoOnly.kind === 'ok') {
            recordSocketGidSuccess();
            return { ok: true, id: gid, sendBy: 'socket', sent: true };
          }
        }
        // Nếu Socket vẫn không gửi được ảnh, nhờ Extension gửi bù RIÊNG PHẦN ẢNH (message: '')
        const extPhotoOnly = await sendViaExtension(conv, '', photo, ctx);
        if (extPhotoOnly && extPhotoOnly.ok) {
          recordSocketGidSuccess();
          return { ok: true, id: gid, sendBy: 'socket', sent: true };
        }
        return { ok: false, sent: 'maybe', error: 'Socket: đã gửi được chữ nhưng FB từ chối ảnh đính kèm' };
      }

      // CHỐNG BỎ SÓT TIN DO FACEBOOK MQTT BURST-REJECT:
      // Mọi ca đã có globalId thật mà bị rejected đều được nghỉ 400..650ms (đủ thoát cửa sổ burst-reject
      // của FB MQTT), xin fbId MỚI TINH (vì fbId is_reusable=false đã bị gửi trong Task #1 của Lần 1),
      // rồi bắn lại ngay ở ĐẦU hàng đợi pageLane (runPrioritySocket).
      // Đặc biệt: nếu ca này nằm lẻ giữa các khách sống (preRejectStreak <= 2) mà Lần 2 vẫn bị rejected,
      // nghỉ thêm 700..1000ms và thử nốt 1 lần cuối với fbId mới để không bao giờ sót khách sống!
      const preRejectStreak = socketRejectStreak[pageId] || 0;
      if (raw && raw.kind === 'rejected') {
        socketRejectStreak[pageId] = preRejectStreak + 1;
      } else if (raw && raw.kind === 'ok') {
        socketRejectStreak[pageId] = 0;
        socketConfirmedDeadStreak[pageId] = 0;
      }
      // Chỉ khi ca bù từ API sang ĐÃ BỊ API TỪ CHỐI BẰNG MÃ (#551) (ctx.apiRejected551 === true)
      // VÀ Socket lần 1 cũng trả markOptimisticMessageFailed → cả 2 kênh độc lập đều đã xác nhận khách khóa nick,
      // chốt ngay ở 0ms mà không bắn lại Socket lần 2! (Nếu API từ chối vì #10 ngoài 24h thì vẫn phải retry Socket bình thường).
      if (raw && raw.kind === 'rejected' && ctx && ctx.apiRejected551) {
        ctx.socketRetriedOnce = true;
      }
      if (raw && raw.kind === 'rejected' && ctx && ctx.wave200Mode && !ctx.isSocketRetryPass
          && !ctx.gidFromPsid && !ctx.socketRetriedOnce && !ctx.apiRejected551) {
        if (deliveredIds[conv.id]) return { ok: true, id: gid, sendBy: 'socket', sent: true };
        ctx.firstRejectedAt = Date.now();
        ctx.gid = gid;
        ctx.threadId = threadId;
        ctx.full = full;
        ctx.fullLoaded = true;
        ctx.gidResolved = true;
        return { ok: false, sent: false, deferredToSocketRetry: true, deferredCtx: ctx,
          error: 'Socket: FB từ chối lần 1 — chuyển sang làn bù Socket Wave 200' };
      }
      if (raw && raw.kind === 'rejected' && (!ctx || !ctx.gidFromPsid) && !ctx.socketRetriedOnce) {
        // Chat đã được kênh khác xác nhận đến nơi trong lúc chờ ACK → dừng, không bắn lại (chống trùng)
        if (deliveredIds[conv.id]) return { ok: true, id: gid, sendBy: 'socket', sent: true };
        ctx.socketRetriedOnce = true;
        sendDiag.sockRetry++;
        /* ═══ [v1.93.3] FB ĐÃ BÁO KHÔNG NHẬN ĐƯỢC ⇒ KHÔNG THỬ LẦN 2, CHỐT ❌ ═══
         * ĐO ĐƯỢC trên log 21/11 21:05 (lô 4 266 chat, bản 1.93.2):
         *   • SOCKET ACK rejected: 630 — người dùng xác nhận 630 ca đó "đều là chết thật"
         *   • Nhưng sổ kiểm chứng chỉ có 18 dòng ❌; TỔNG HỢP ghi ❌ 18 · ⚠ 612
         *   • 612 ca đó nằm trong 🖐 CẦN GỬI TAY nhưng có 0 dòng trong sổ kiểm chứng và
         *     0 dòng trong "TỔNG THEO CHAT" ⇒ bị chốt bằng một đường KHÔNG ghi sổ.
         * Gốc: ACK rejected đến ĐÚNG HẠN không được ghi vào `fbRejectedIds` (chỉ ACK MUỘN và
         * API #551 được ghi) ⇒ ca đó đi tiếp vào làn bù Socket, và ở đây
         * `isConfirmedUnavailable` = false vì `socketRetriedOnce` chưa bật ⇒ thử lần 2 vô ích,
         * rồi chốt ⚠ ⇒ vào danh sách gửi tay.
         * NAY: FB đã trả lời dứt khoát thì chốt ❌ ngay, KHÔNG vào danh sách gửi tay.
         * Không thêm một lệnh gửi nào — đây là BỎ lần thử vô ích. */
        if (isFbRejected(conv.id) && !ctx.apiRejected551) {
          fbRejectStats.blockedBu = (fbRejectStats.blockedBu || 0) + 1;
          return {
            ok: false, sent: false, recipientUnavailable: true, fbRejected: true,
            error: 'Socket: FB đã báo KHÔNG NHẬN ĐƯỢC (ACK rejected) — không thử lần 2',
          };
        }

        await sleepUntil(Date.now() + 220 + Math.floor(Math.random() * 130), 'delivered'); // [v1.92.9] đã giao thì thức ngay
        if (state.stopRequested) return { ok: false, sent: false, error: 'Đã dừng' };
        if (deliveredIds[conv.id]) return { ok: true, id: gid, sendBy: 'socket', sent: true };
        // Kiểm tra xem trong nhịp nghỉ đó WebSocket threadMappingStoreV2 có nạp được global_id mới hơn không
        if (threadId && pageId) {
          try {
            const sk2 = helper.SOCKETS && helper.SOCKETS[pageId];
            const ip2 = sk2 && sk2.context && sk2.context.initPageData;
            const wsGid2 = ip2 && ((ip2.threadMapping && ip2.threadMapping[threadId])
              || (ip2.threadMappingStoreV2 && ip2.threadMappingStoreV2[threadId]));
            if (wsGid2 && String(wsGid2) !== String(gid)) {
              gid = String(wsGid2);
              ctx.gid = gid;
            }
          } catch (e0) { /* ignore */ }
        }
        // BẮT BUỘC xin fbId mới (forceFresh = true): trong khung /ls_req Lần 1, Task #1 (send_type: 3)
        // đã gửi attFbIds (is_reusable=false) lên FB nên fbId cũ có thể đã bị FB đốt/vô hiệu hóa!
        if (photo) {
          const freshUp = await uploadOneTimePhoto(pageId, photo, conv.id, ctx, true);
          if (!freshUp || !freshUp.ok || !freshUp.fbId) {
            return { ok: false, sent: false, error: 'Socket: server báo gửi thất bại' };
          }
          ctx.nonReusableFbId = null;
          ctx.nonReusableFbIds = null;
          attFbIds = (freshUp.fbIds && freshUp.fbIds.length) ? freshUp.fbIds.slice() : [freshUp.fbId];
        }
        // Bắn lại đúng 1 lần qua hàng đợi ưu tiên đan xen công bằng (runPrioritySocket) để giải phóng
        // ngay lập tức, không dồn ứ hàng nghìn ca retry ở đuôi lượt mà vẫn không chặn các chat Lần 1!
        /* ═══ [v1.93.13] ACK rejected Ở LẦN GỬI ĐẦU CŨNG PHẢI GHI `fbRejectedIds` ═══
         * LỖI THẬT ĐO ĐƯỢC (log 22/11 09:54, lô 8 572 chat):
         *   SOCKET ACK OK/rejected/no-ACK : 4715 / 3552 / 0
         *   ⚠ Không rõ: 3 547 · FB báo không nhận (đã đo): 5
         *   ⇒ 3 552 − 5 = 3 547 — KHỚP CHÍNH XÁC. Toàn bộ 3 547 ca ⚠ là ca
         *     **ACK rejected ở lần bắn ĐẦU**, không phải ca mất ACK, không phải ca quá hạn.
         * Gốc: `socketPublishSend(…, opts)` chỉ gọi `onRejected` khi được truyền vào
         * (`if (!lateMode && onRejected)`), nhưng trong 6 chỗ gọi hàm này chỉ **1 chỗ**
         * (đường bù, @5759) truyền `onRejected`. Lần bắn ĐẦU (@5363 và đường đồng bộ
         * @5818) KHÔNG truyền ⇒ FB từ chối mà `fbRejectedIds` không có gì ⇒
         *   • cổng 🚫 @11445 (`socksProof==='absent' && isFbRejected`) không kích hoạt
         *     ⇒ 3 547 ca chạy tiếp vào kiểm chứng/đọc lại rồi chốt ⚠ (vào danh sách gửi tay)
         *   • cổng @5326 (`isFbRejected && !apiRejected551`, chốt ❌ ngay, không thử lần 2) không
         *     bao giờ chạy cho ca lần-1 ⇒ vẫn thử lần 2 vô ích.
         * Nay truyền `onRejected` ⇒ FB đã trả lời DỨT KHOÁT "không nhận" thì ghi sổ.
         * KHÔNG thêm lệnh gửi nào — chỉ BỎ lần thử lại chắc chắn hỏng và chốt ❌ thay ⚠. */
        raw = await runPrioritySocket(() => socketPublishSend(helper, pageId, gid, text, attFbIds),
          null/* firedCb giữ nguyên (xem @5749) */,
          { onRejected: () => noteFbRejected(conv.id, 'Socket ACK rejected (bắn lại lần 2) = FB từ chối nhận tin') });
        if (raw && raw.kind === 'ok') sendDiag.sockRetryRecovered++;
        else if (raw && raw.kind === 'rejected') sendDiag.sockRetryRejected++;
        else sendDiag.sockRetryOther++;
        if (raw && raw.kind === 'ok') {
          socketRejectStreak[pageId] = 0;
          socketConfirmedDeadStreak[pageId] = 0;
        }
        if (raw && raw.kind === 'photo_failed_text_ok' && photo) {
          socketRejectStreak[pageId] = 0;
          socketConfirmedDeadStreak[pageId] = 0;
          const freshPhotoUp2 = await uploadOneTimePhoto(pageId, photo, conv.id, ctx, true);
          if (freshPhotoUp2 && freshPhotoUp2.ok && freshPhotoUp2.fbId) {
            ctx.nonReusableFbId = null;
            ctx.nonReusableFbIds = null;
            sendDiag.photoRetry++;
            const retryPhotoOnly2 = await runPrioritySocket(() => socketPublishSend(helper, pageId, gid, '', (freshPhotoUp2.fbIds && freshPhotoUp2.fbIds.length) ? freshPhotoUp2.fbIds : [freshPhotoUp2.fbId]),
            null, { onRejected: () => noteFbRejected(conv.id, 'Socket ACK rejected (gửi ảnh bù lần 2) = FB từ chối nhận tin') });
            if (retryPhotoOnly2 && retryPhotoOnly2.kind === 'ok') {
              recordSocketGidSuccess();
              return { ok: true, id: gid, sendBy: 'socket', sent: true };
            }
          }
          const extPhotoOnly2 = await sendViaExtension(conv, '', photo, ctx);
          if (extPhotoOnly2 && extPhotoOnly2.ok) {
            recordSocketGidSuccess();
            return { ok: true, id: gid, sendBy: 'socket', sent: true };
          }
          return { ok: false, sent: 'maybe', error: 'Socket: đã gửi được chữ nhưng FB từ chối ảnh đính kèm' };
        }
      }
      if (raw && raw.ok === false && raw.sent === false && raw.error) {
        // Lane bọc exception thành 'Lỗi kênh:' = không rõ publish đã đi chưa → "không rõ"
        // như mọi đường khác; passthrough sent:false ở đây sẽ cho kênh khác bắn lần 2 (LẶP)
        if (String(raw.error).indexOf('Lỗi kênh:') === 0) {
          return { ok: false, sent: 'maybe', error: 'Socket lỗi giữa chừng — không gửi thêm để tránh trùng' };
        }
        return { ok: false, sent: false, error: raw.error };
      }
      if (raw.kind === 'ok') {
        socketConfirmedDeadStreak[pageId] = 0;
        recordSocketGidSuccess();
        return { ok: true, id: gid, sendBy: 'socket', sent: true };
      }
      if (raw.kind === 'dead') return { ok: false, sent: false, error: 'Socket không kết nối' };
      if (raw.kind === 'rejected') {
        socketConfirmedDeadStreak[pageId] = (socketConfirmedDeadStreak[pageId] || 0) + 1;
        // Chỉ kết luận khách không có mặt / đã khóa nick sau khi Socket
        // đã bắn lại đúng 1 lần mà vẫn bị markOptimisticMessageFailed.
        // Một lần rejected trong lô lớn chưa đủ bằng chứng: có thể là
        // burst-reject tạm thời hoặc mapping gid vừa đổi (ca thực địa
        // chạy lại đã gửi được). Chưa bắn lại thì giữ lỗi Socket thường,
        // tuyệt đối không gắn nhãn recipientUnavailable.
        /* [v1.93.13] GỠ BẢN SỬA SAI CỦA 1.93.12.
         * 1.93.12 thêm `_psidRejected = (rejected && ctx.gidFromPsid)` để chốt ❌ ngay.
         * ĐIỀU KIỆN ĐÓ KHÔNG BAO GIỜ ĐÚNG Ở LÔ >50 CHAT ⇒ nhánh chết:
         *   dòng 4114  `const isLargeBatch = !!(batchStats && batchStats.total > 50);`
         *   dòng 4119-4123 và 4551-4552  `if (isLargeBatch) return null;`
         * chặn CẢ HAI chỗ duy nhất gán `ctx.gidFromPsid = true` (dòng 4127 và 4559,
         * đều là bước 4 `psid-guess`, chỉ dành cho lô ≤50 chat).
         * Đối chứng log 1.93.12 (lô 1 672 chat, 08:32): `cache 1628 · cứu thiếu globalId 43`,
         * `khách không nhận được (đã đo) 0 · chốt NGAY vì FB từ chối dứt khoát 0 ca`
         * ⇒ phần sửa đó chưa từng chạy. GỠ VỀ ĐÚNG NHƯ 1.93.11.
         * BÀI HỌC: trước khi thêm điều kiện, phải chứng minh điều kiện đó CÓ THỂ đúng
         * bằng số đo trong log, không suy từ chú thích. */
        const isConfirmedUnavailable = !!(ctx && ctx.socketRetriedOnce);
        return {
          ok: false,
          sent: false,
          // [v1.92.30] KHUNG `markOptimisticMessageFailed` KHÔNG nói nó thuộc tin nào ⇒ đây là
          // phán đoán, không phải bằng chứng "chưa gửi". Cổng chứng minh vắng mặt sẽ quyết định
          // trước khi bắn lần 2 (xem proveAbsentBeforeBu) — đây là nguồn lặp của bản cũ.
          ambiguous: true,
          recipientUnavailable: isConfirmedUnavailable,
          error: isConfirmedUnavailable
            ? 'Socket: FB từ chối nhận tin (khách hiện không có mặt / đã khóa nick)'
            : 'Socket: server báo gửi thất bại',
        };
      }
      if (raw.kind === 'noack') {
        // Khi raw.kind === 'noack', frame ĐÃ được gọi qua helper.publish — luôn đưa vào diện
        // kiểm chứng lịch sử (scheduleSocketVerify) để xác minh tin đã tới chưa rồi mới bắn cứu!
        return {
          ok: false,
          sent: 'maybe',
          noAck: true,
          publishedAt: raw.publishedAt || (Date.now() - 15000),
          error: 'Socket không rõ kết quả (không có ACK)',
        };
      }
      // legacy — helper không có publish: đường sendMessage cũ (kèm bước chờ 1s của app)
      const res = await pageLane(() => helper.sendMessage(pageId, gid, attFbIds ? { text, attachmentFbIds: attFbIds } : { text }));
      if (res && res.success) {
        recordSocketGidSuccess();
        return { ok: true, id: gid, sendBy: 'socket', sent: true };
      }
      const reason = String((res && res.reason) || '');
      if (/no_socket_found|getGlobalIdFailed|markOptimisticMessageFailed/i.test(reason)) {
        return { ok: false, sent: false, error: 'Socket không gửi được (' + reason + ')' };
      }
      if (res && res.response) {
        return { ok: false, sent: false, error: 'Socket: server báo gửi thất bại' };
      }
      const sock = helper.SOCKETS && helper.SOCKETS[pageId];
      if (!(sock && sock.instance)) {
        return { ok: false, sent: false, error: 'Socket không kết nối' };
      }
      return { ok: false, sent: 'maybe', noAck: true, error: 'Socket không rõ kết quả' + (reason ? ' (' + reason + ')' : '') };
      };
      // 🔥 NẤC 2 (v1.71.0): bắn-nhả cho lô lớn — publish xong trả kết quả ngay cho worker đi bắn tiếp;
      // ACK thật của FB về sau sẽ chạy settleSocketResult ở nền: thành công → markDelivered (im lặng,
      // tổng hợp tự cập nhật), bị từ chối → bù kênh khác đúng 1 lần qua scheduleBuRetry, không rõ → ⚠.
      if (ctx.sockFired) {
        if (sockFiredPending.has(conv.id)) {
          // Đã bắn rồi và đang chờ ACK — tuyệt đối không bắn lần 2 (chống trùng tận gốc)
          return { ok: true, id: gid, sendBy: 'socket', sent: true, fired: true };
        }
        if (!acquireOutbound(conv.id)) return dupBlockedResult(conv.id);
        sockFiredPending.add(conv.id);
        try {
          const _st = sockRouteOf((conv.pageId || String(conv.id || '').split('_')[0]));
          if (_st) _st.sent++;
        } catch (eSt) { /* ignore */ }
        ctx.ownsOutbound = true; // Ext bù ảnh trong settleSocketResult dùng chung khóa này
        const myRun = runSeq;
        const finalizeSockBg = (res) => {
          sockFiredPending.delete(conv.id);
          /* ═══ [v1.92.66] NHẢ KHOÁ NGOÀI Ở MỌI NHÁNH KẾT THÚC ═══
           * Bản cũ chỉ gọi `releaseOutbound()` ở ĐÚNG HAI nhánh (trước `deferredToSocketRetry` và
           * ở dòng cuối). Các nhánh còn lại `return` mà KHÔNG nhả:
           *   • `res.uncertain`  → 3 600 ca ⚠ của lô 19:48 ĐI QUA ĐÂY
           *   • nhánh chuyển Extension (🛟)
           * ⇒ `outboundLock[conv.id]` còn nguyên ⇒ `acquireOutbound()` trả false cho MỌI lần sau,
           *   kể cả cổng kiểm chứng và lần bù của chính chat đó. Lỗi im lặng: log không báo, chỉ
           *   là chat đó không bao giờ được thử lại trong lượt.
           * Nay: mọi nhánh kết thúc đều nhả khoá nếu chat CHƯA được đánh dấu đã-giao.
           * Nhả khoá cho chat đã delivered là vô hại: `acquireOutbound()` tự chặn bằng chính
           * `deliveredIds`, nên không thể sinh tin trùng. */
          /* [v1.92.66] Ở chế độ BẮN-NHẢ, KHOÁ NGOÀI PHẢI Ở LẠI tới khi settle xong.
           * Lý do (đọc code mới thấy): `sendViaApi()` (dòng ~3563) và `fireApiAndWatch()` (dòng
           * ~3368) đều tự gọi `acquireOutbound()` và TỪ CHỐI nếu chat đang giữ khoá. Nghĩa là
           * `outboundLock` chính là thứ chặn "bù chồng" khi Socket đang bay — đúng như chú thích
           * ở `acquireOutbound` ("'maybe' giữ khóa → không gửi lần 2").
           * Nếu ta nhả khoá lúc PUBLISH (chế độ bắn-nhả) thì cổng `scheduleBuRetry` có thể chạy
           * bù trong lúc ACK còn đang bay ⇒ 2 tin. Vì vậy: nhánh nào CÒN CHỜ KẾT QUẢ thì GIỮ khoá;
           * nhánh nào ĐÃ CHỐT (✅ xong / ❌ dứt khoát / → Ext-chắc-chắn-không-gửi) thì mới nhả.
           * Tên hàm nói rõ điều đó để lần sau không ai "dọn dẹp" nó thành nhả vô điều kiện. */
          const releaseOutboundIfFinal = (why) => {
            /* GIỮ khoá khi: chat đã delivered (khoá vô nghĩa) → nhả cũng được, nhưng `deliveredIds`
             * đã tự chặn mọi lần sau nên nhả là vô hại; ngược lại khi CHƯA rõ kết quả thì giữ. */
            void why;
            if (!deliveredIds[conv.id]) releaseOutbound(conv.id);
          };
          if (myRun !== runSeq) { releaseOutbound(conv.id); return; }
          const nm = conv.name || conv.id;
          if (res && res.ok) {
            reopenUncertain(conv.id); // ⚡ [FIX-4b] hạ ⚠ nếu watchdog đã chốt trước khi ACK về
            // [v1.92.26] lần thử lại mà cứu được ⇒ giả thuyết "burst-reject" còn sống ⇒ mở ngân sách
            if (ctx && ctx.isSocketRetryPass) sockRetryBudgetNote(sockRetryBudgetState, 'saved', 0);
            markDelivered(conv.id, 'socket');
            postSendSideEffects(conv);
            return;
          }
          if (res && (res.uncertain || res.sent === 'maybe')) {
            if (res.noAck) scheduleSocketVerify(conv, text, photo, res.publishedAt || (Date.now() - 15000));
            if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
            logFailGrouped(nm, '' + (res.error || 'Socket không rõ kết quả') + ' (xác nhận nền — không gửi thêm để tránh trùng)', '⚠', conv.id);
            /* [v1.92.66] GIỮ KHOÁ ở nhánh ⚠ — CỐ Ý, và đây là điểm khác bản nháp đầu của tôi.
             * Ca ⚠ nghĩa là CHƯA BIẾT tin đã đi hay chưa; nhả khoá lúc này cho phép làn Ext/API
             * bắn bù ⇒ đúng nguồn GỬI TRÙNG mà cả file này đang chống. Khoá được `markDelivered`
             * (nếu ACK muộn về và là ✅) hoặc nhánh ❌ dứt khoát nhả; và `reopenUncertain()` +
             * `sweepBgPending` vẫn xử lý được vì chúng không đi qua `acquireOutbound`.
             * Điều ĐÚNG cần sửa ở nhánh này không phải cái khoá, mà là: (a) cầu dao Ext phải đóng
             * được để đừng đẩy 3 600 ca vào đây, (b) ca ⚠ không được chiếm ghế làn 5 037 ms —
             * cả hai đã sửa ở nơi khác trong cùng bản này. */
            return;
          }
          if (res && res.deferredToSocketRetry && myRun === runSeq && !state.stopRequested) {
            // [v1.92.19] khôi phục "bắn lại Socket 1 lần" cho đường bắn-nhả (xem chú thích đầu khối)
            releaseOutbound(conv.id);
            // [v1.92.26] NGÂN SÁCH THỬ LẠI (xem sockRetryBudgetAllows): lô 10:04 thử lại 861
            // lần, cứu 0 (ACK rejected 1 722 = 861 x 2) — tức 27% lưu lượng socket là vô ích.
            // Đã đo đủ thì chốt ❌ ngay, ghi rõ lý do, KHÔNG bắn thêm lệnh chắc chắn hỏng.
            const rejectPctBg = socketRejectPctRecent(); // [v1.92.28] cửa sổ 200 ACK gần nhất (-1 = chưa đủ mẫu)
            if (!sockRetryBudgetAllows(sockRetryBudgetState)) {
              sockRetryBudgetNote(sockRetryBudgetState, 'skipped', rejectPctBg);
              sendDiag.sockRetryBudgetSkipped++;
              /* [v1.92.41] Ngân sách này chỉ có quyền nói "KHÔNG BẮN LẠI SOCKET" — không có quyền
               * kết luận "chat này không gửi được". FB vừa TỪ CHỐI ĐỨT KHOÁT ⇒ chưa có tin nào
               * được gửi ⇒ thử Extension là AN TOÀN (không thể trùng). Log 16:11: 3 311 ca bị
               * chốt ❌ ở đúng nhánh này trong khi làn Ext trống hoàn toàn. */
              const hasExt1545 = !!(window.__ExtensionAdapter__ && typeof window.__ExtensionAdapter__.send === 'function');
              if (hasExt1545 && extFallback1545Allowed()) {
                /* [v1.92.66] Dùng `noteExt1545Attempt()` (đếm + đóng phanh cứng khi đủ mẫu).
                 * Bản cũ chỉ `tried++` rồi KHÔNG kiểm ngưỡng ở đây ⇒ nếu `.then` của chuỗi bù
                 * không chạy thì cầu dao không bao giờ đóng dù `tried` đã 3 600. */
                noteExt1545Attempt();
                /* [v1.92.50] ĐÁNH DẤU CA NÀY ĐỂ CẦU DAO EXT ĐÓNG ĐƯỢC — LỖI BỊ SÓT Ở 1.92.49.
                 * Sổ 11:34 (9 242 chat): dồn sang Ext 3 280 ca, Ext trả "Người này hiện không có
                 * mặt" cho 3 122 ca, mà KHÔNG có dòng 🔒 nào ⇒ ngân sách chưa từng đóng.
                 * Gốc: noteExt1545Outcome() chỉ ghi khi `conv.__extFallback1545 === true`
                 * (dòng 9101/9110/9114/9123), nhưng cờ đó chỉ được set ở nhánh FB-báo-1545041
                 * (dòng 7546/7557). Nhánh NÀY tăng `tried` mà không set cờ ⇒ 3 280 ca "vô hình"
                 * với bộ đếm ⇒ streak đứng 0 ⇒ PROBE 200 và STREAK_MAX 30 đều không bao giờ chạm.
                 * Nay set cờ: tốn thêm 0 lệnh, chỉ cho bộ đếm nhìn thấy đúng ca nó đang đo. */
                conv.__extFallback1545 = true;
                scheduleBuRetry(conv, text, photo, nm,
                  'Socket bị FB từ chối (ngân sách thử lại Socket đã đóng)', ['socket'],
                  { ambiguous: false, fromUncertain: true, via: 'socket', sentAt: Date.now() });
                logFailGrouped(nm, 'Socket: FB từ chối — KHÔNG bắn lại Socket, chuyển Extension 1 lần '
                  + '(tin chưa đi nên không thể trùng)', '🛟', conv.id);
                return;
              }
              if (hasExt1545 && !extFallback1545Allowed()) {
                /* [v1.93.3] FB ĐÃ BÁO KHÔNG NHẬN ĐƯỢC ⇒ ❌, KHÔNG vào danh sách gửi tay.
                 * Chốt của người dùng: "chặn là chặn, gửi không được, gửi tay cũng không được".
                 * Ca CHƯA từng bị FB từ chối (chỉ hết ngân sách dò Ext) vẫn giữ ⚠ như cũ —
                 * đó là "máy không biết", không phải "khách chặn". */
                if (isFbRejected(conv.id)) {
                  fbRejectStats.blockedBu = (fbRejectStats.blockedBu || 0) + 1;
                  if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
                  logFailGrouped(nm, 'FB đã báo KHÔNG NHẬN ĐƯỢC (Socket ACK rejected) ⇒ chốt ❌, KHÔNG vào danh sách gửi tay', '🚫', conv.id);
                  releaseOutbound(conv.id);
                  return;
                }
                // Đã đo xong: Extension cũng không cứu được ⇒ ⚠ "chưa gửi" để người dùng gửi tay
                if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain', 'Socket FB từ chối + ngân sách dò Ext ĐÓNG ⇒ chưa thử Ext');
                /* [v1.92.66] IN SỐ THẬT — xem khối chú thích dài ở `extFallback1545Allowed()`.
                 * Câu cũ ("đã đo 200 ca") là chuỗi cố định, lặp 3 611 lần ở lô 19:48 trong khi
                 * `tried` = 0. Nay số in ra là số ĐO ĐƯỢC của chính lô này. */
                logFailGrouped(nm, 'Socket: FB từ chối · ngân sách dò Ext ĐANG ĐÓNG (đã định bắn '
                  + extTry1545.tried + ' ca · cứu ' + extTry1545.saved + ') ⇒ GIỮ ⚠ (chưa gửi), '
                  + 'ca này CHƯA thử qua Ext — vào danh sách gửi tay', '⚠', conv.id);
                /* [v1.92.66] CỐ Ý KHÔNG nhả khoá ở nhánh này: chat vừa được đưa vào danh sách
                 * GỬI TAY để người dùng tự bấm. Nếu ta nhả khoá, chính script có thể bắn bù nó
                 * ở làn Ext/API ⇒ THÀNH 2 TIN (một của script, một của người dùng). Giữ khoá là
                 * đúng: nó không chặn việc GỬI TAY (người dùng bấm trong Pancake, không qua
                 * `acquireOutbound`), chỉ chặn script tự bắn chồng. */
                return;
              }
              if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
              logFailGrouped(nm, 'Socket: FB từ chối lần 1 — KHÔNG thử lần 2 (đã thử '
                + sockRetryBudgetState.tried + ' ca, cứu được 0, từ chối gần đây '
                + (sockRetryBudgetState.closePct >= 0 ? sockRetryBudgetState.closePct + '%' : '—')
                + ' ⇒ thử nữa chỉ tốn lệnh)', '❌', conv.id);
              return;
            }
            /* ═══ [v1.92.66] BỎ HẲN NHÁNH "BẮN LẠI 1 LẦN QUA SOCKET" — ĐO ĐƯỢC 0/72 CỨU ĐƯỢC ═══
             *
             * Số đo sổ kiểm chứng lô 19:48:22 (15 336 chat): tag 🔁 xuất hiện **72** lần, và
             * **72/72** ca kết thúc bằng ❌ — không ca nào được cứu. Đối chiếu 4 lô trước
             * (14:03, 19:00:48, 19:00:54, 10:04): "thử lại 861 lần, cứu 0". Tức đây không phải
             * chuyện xác suất — FB từ chối lần 1 bằng `markOptimisticMessageFailed` là dứt khoát
             * cho cả phiên, bắn lại y hệt chỉ nhận lại đúng câu đó.
             *
             * CÁI GIÁ phải trả KHÔNG chỉ là lệnh thừa. Hai lý do đắt hơn:
             *   1) `settleSocketResult` chạy trong `.then` của `pageLane(...)` ⇒ TOÀN BỘ thời gian
             *      bắn lại (sleep 220–350 ms + lần publish 2) vẫn GIỮ GHẾ trong làn Socket/page.
             *      72 ca × ~700 ms = 50 slot-giây bị chiếm vô ích.
             *   2) `pushToSocketRetry` làm `pendingSocketCoolCount` > 0 ⇒ `computeSmartGap()` và
             *      `evaluateGate()` thấy `retryBacklog` cao ⇒ CHẶN mở wave kế (ngưỡng 80). Nghĩa
             *      là mỗi ca 🔁 còn kéo chậm cả lô, không chỉ chậm chính nó.
             *
             * NAY: phân loại bằng CHÍNH phản hồi của FB (không thử lại để "xem sao"):
             *   • `res.recipientUnavailable` (FB nói khách không nhận được) ⇒ ❌ NGAY, ghi nhận,
             *     KHÔNG chuyển Ext. Đây là điều `sockRetryBudgetState` vẫn luôn muốn: nhóm này
             *     chiếm phần lớn 3 759 ACK rejected, chuyển sang Ext chỉ tốn lệnh.
             *   • Còn lại (rejected nhưng KHÔNG nói khách chết — vd burst-reject) ⇒ chuyển thẳng
             *     sang làn bù Extension, KHÔNG bắn lại Socket. Đây là đường DUY NHẤT đã chứng minh
             *     cứu được: 🛟 103 ca → **102 ✅** (99 %) ở lô 19:48.
             * Không thêm một lệnh gửi nào so với trước; chỉ đổi KÊNH của lần thử thứ 2 từ Socket
             * (0 %) sang Extension (99 %). Chống trùng không đổi: cả hai nhánh đều chỉ chạy khi
             * `deliveredIds[conv.id]` chưa có, và `__extFallback1545` vẫn chặn thử 2 lần. */
            if (res && res.recipientUnavailable) {
              sendDiag.sockRetryBudgetSkipped++;
              sockRetryBudgetNote(sockRetryBudgetState, 'skipped', rejectPctBg);
              if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
              if (res.recipientUnavailable) sendDiag.recipientUnavailable++;
              /* Vẫn giữ nguyên đường "đọc lại lịch sử sau lô": nếu tin THẬT RA đã tới thì lật ✅
               * (queueDeadUserRecheck chỉ ĐỌC, không gửi) — bỏ nó đi là mất khả năng tự đính chính. */
              try { queueDeadUserRecheck(conv, text, photo, Date.now()); } catch (eDr) { /* ignore */ }
              logFailGrouped(nm, 'Socket: FB từ chối và nói KHÔNG nhận được — không bắn lại Socket, '
                + 'không chuyển Ext (đã đo 0/N cứu được ở nhóm này)', '❌', conv.id);
              releaseOutbound(conv.id);
              return;
            }
            if (hasExt1545 && extFallback1545Allowed() && !conv.__extFallback1545) {
              noteExt1545Attempt();
              conv.__extFallback1545 = true;
              scheduleBuRetry(conv, text, photo, nm,
                'Socket: FB từ chối lần 1 (không nói khách chết)', ['socket'],
                { ambiguous: false, fromUncertain: true, via: 'socket', sentAt: Date.now() });
              logFailGrouped(nm, 'Socket: FB từ chối lần 1 — không bắn lại Socket (0/72 cứu được), '
                + 'chuyển thẳng Extension 1 lần (tin chưa đi nên không thể trùng)', '🛟', conv.id);
              releaseOutboundIfFinal('chuyen-ext'); // [v1.92.66] FB từ chối ⇒ chắc chắn chưa gửi
              return;
            }
            if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
            logFailGrouped(nm, 'Socket: FB từ chối lần 1 — không bắn lại Socket (0/N cứu được ở mọi lô đã đo)'
              + (hasExt1545 ? ' · ngân sách dò Ext đang đóng' : ' · không có Extension')
              + ' ⇒ chốt lỗi, không tốn thêm lệnh', '❌', conv.id);
            releaseOutbound(conv.id);
            return;
          }
          releaseOutbound(conv.id); // FB từ chối / chắc fail → nhả khóa để bù kênh khác (không sót)
          if (res && !res.recipientUnavailable && res.sent === false && (res.error || '') !== 'Đã dừng') {
            // Frame CHƯA HỀ được bắn lên FB (ví dụ Socket không kết nối hoặc lỗi xin fbId ảnh khi retry)
            // và khách KHÔNG phải nick khóa → chuyển bù qua Extension để không bao giờ sót khách sống!
            logFailGrouped(nm, (res.error || 'Socket không kết nối') + ' (xác nhận nền) — chuyển bù qua Extension', '⚠', conv.id);
            scheduleBuRetry(conv, text, photo, nm, res.error || 'Socket không kết nối', ['socket']);
          } else {
            if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
            // [v1.91.76] GHI NHỚ KHÁCH KHÔNG NHẬN ĐƯỢC — nhánh "xác nhận nền" trước đây KHÔNG
            // lưu gì (TỔNG HỢP in "người nhận rejected cuối 0" dù có hàng nghìn ca). Hệ quả:
            // lượt sau vẫn gửi tiếp vào đúng những chat chết đó, và trong lượt vẫn retry vô ích.
            // Log thực tế 10k: 3744 lỗi, retry 3302 lần cứu được 0, unavailable ghi nhận 0.
            if (res && res.recipientUnavailable) sendDiag.recipientUnavailable++;
            logFailGrouped(nm, ((res && res.error) || 'Socket thất bại') + ' (xác nhận nền)', '❌', conv.id);
          }
        };
        /* [v1.92.66] `holdLaneForAck` = CÓ giữ ghế làn trong lúc chờ ACK hay không.
         * Bản cũ (và đường KHÔNG bắn-nhả nay vẫn vậy): settle chạy trong `.then` của `pageLane`
         * ⇒ ghế bị giữ tới khi settle xong. Đường bắn-nhả: ghế đã nhả lúc publish, nên settle
         * KHÔNG được giữ thêm lần nữa. */
        /* [v1.92.66] CỔNG "CHỈ PHÂN XỬ MỘT LẦN" — BẮT BUỘC khi bật bắn-nhả.
         * Một ca có HAI đường có thể gọi settle cho cùng kết quả:
         *   • `firedCb` do `socketPublishSend` gọi ở nền khi /ls_resp về (đường chính);
         *   • nhánh `.catch` của `pageLane` nếu `socketPublishSend` throw SAU khi đã publish,
         *     hoặc `.then` nhận một kết quả bất thường.
         * Không có cổng này thì một ca bị `finalizeSockBg` chạy 2 lần ⇒ `markDelivered` /
         * `sockRetryBudgetNote` / `logFailGrouped` đều đếm đôi, và tệ nhất là lần 2 chạy sau khi
         * lần 1 đã chốt ⚠ ⇒ có thể đẩy một ca ĐÃ ✅ vào danh sách gửi tay.
         * Cờ nằm trên `ctx` (vòng đời = một lần bắn), đặt lại ở đầu mỗi lần publish. */
        const settleOnce = { used: false };
        const settleAndFinalize = (rawKind, holdLaneForAck) => {
          if (myRun !== runSeq) return;
          if (settleOnce.used) return;
          settleOnce.used = true;
          settleSocketResult(rawKind)
            .then((res) => { if (myRun === runSeq) finalizeSockBg(res); })
            .catch(() => {
              sockFiredPending.delete(conv.id);
              // lỗi khi chờ ACK Socket: phải chốt ⚠, chỉ xóa cờ chờ thì chat kẹt pending vĩnh viễn
              if (myRun === runSeq && window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
            });
          void holdLaneForAck; // tài liệu hoá ý định; việc nhả ghế do `pageLane` tự làm
        };
        // Giữ số frame in-flight trong giới hạn lane Socket/page (khởi điểm 64, thích ứng 32–96):
        // Worker chờ tới đúng lúc chiếm được ghế trong pageLane (bắt đầu bắn frame) rồi trả về ngay
        // (fired: true) mà không chờ /ls_resp ACK. Nhờ đó 192 worker không xả tràn hàng nghìn lệnh
        // vào pageLane.waiters ở giây thứ 0 (tránh nghẽn HTTP upload ảnh & tránh đứng tiến độ).
        let notifySlotStarted = null;
        const slotStartedPromise = new Promise((resolve) => { notifySlotStarted = resolve; });
        /* ═══════════════════════════════════════════════════════════════════════════════════
         * [v1.92.66] BẮT ĐẦU DÙNG CHẾ ĐỘ "BẮN-NHẢ" CHO LÀN SOCKET — ĐÒN BẨY LỚN NHẤT
         * ═══════════════════════════════════════════════════════════════════════════════════
         * `socketPublishSend()` đã có sẵn tham số `firedCb` cho đúng việc này (NẤC 2, v1.71.0):
         *   "bắn xong NHẢ NGAY — không giữ worker chờ ACK của FB (vốn mất ~2,8s/tin)".
         * Nhưng chỗ gọi NÀY truyền `null` ⇒ toàn bộ 15 336 lệnh của lô 19:48 đi đường GIỮ.
         *
         * ĐO ĐƯỢC TỪ LOG (không phải suy đoán):
         *   • `⏱ GIỮ SLOT: còn lại 1 726 ms/chat` và `giữ slot 5 037 ms` (🔔) ⇒ mỗi ca chiếm GHẾ
         *     LÀN 1 726 ms (phần còn lại là chờ ACK 1 162 ms + chuẩn bị).
         *   • Sức chứa của làn Socket = 256 ghế × 142 s phát = 36 352 ghế-giây. Với 15 336 ca
         *     thì SÀN CỨNG là 36 352 ÷ 15 336 = 2,37 s/ca ⇒ trần ~108 tin/s. Đo thật 102,2 tin/s.
         *     ⇒ LÀN LÀ NÚT THẮT, không phải CPU, không phải `mainCap 192`.
         *   • 3 600 ca ⚠ (no-ACK) giữ ghế trọn hạn chờ 5 037 ms = 18 133 ghế-giây
         *     = **50 % toàn bộ dung lượng làn của lượt**. Đó là lý do `waiting` luôn 220/220.
         *
         * VÌ SAO ĐỔI ĐƯỢC MÀ KHÔNG SINH TIN TRÙNG — 4 lớp bảo vệ, KHÔNG lớp nào bị bỏ:
         *   1) `sockFiredPending` (Set) — chat còn trong tập này thì KHÔNG kênh nào bắn thêm,
         *      kể cả bù Extension. Chỉ khi FB XÁC NHẬN TỪ CHỐI mới được bù. Vẫn nguyên.
         *   2) `acquireOutbound/releaseOutbound` — khoá ngoài, không đổi.
         *   3) `markDelivered` + `deliveredIds` — chỉ đường ĐỌC ghi, không đổi.
         *   4) `ackListenMs` 12 000 ms vẫn giữ CHỖ NHẬN (/ls_resp vẫn tra được callback ⇒ ACK về
         *      muộn vẫn phân xử ✅ thật qua `lateP` + `lateApply`). Đây là lý do bắn-nhả AN TOÀN:
         *      nhả ghế KHÔNG có nghĩa là mất ACK. Hạn chờ GIỮ SLOT (`ackWaitMs`) vẫn dùng để
         *      đánh ⚠ đúng hạn — chỉ khác là nó không còn CHIẾM GHẾ trong lúc chờ.
         *
         * VIỆC `paceSocketPublish` (4 ms/page) VẪN CHẠY TRONG `socketPublishSend` — nên nhịp phát
         * lên FB không đổi (250 khung/s/page là trần cứng của chính pace). Thứ được giải phóng
         * chỉ là ghế làn trong khoảng CHỜ, không phải khoảng BẮN.
         * ═══════════════════════════════════════════════════════════════════════════════════ */
        const SOCK_FIRED_RELEASE = true;
        pageLane(() => {
          if (notifySlotStarted) { const fn0 = notifySlotStarted; notifySlotStarted = null; fn0(true); }
          // [v1.92.48] opts.lateApply: đăng ký đường phục hồi ACK-muộn CHỈ ĐỌC (xem onLateAck)
          return socketPublishSend(helper, pageId, gid, text, attFbIds,
            SOCK_FIRED_RELEASE
              ? (rawKind) => settleAndFinalize(rawKind && rawKind.kind ? rawKind : { kind: 'noack' }, false)
              : null,
            { lateApply: onLateAck,
              /* [v1.93.3] ACK REJECTED PHẢI ĐƯỢC GHI NHẬN NGAY TẠI CHỖ FB TRẢ LỜI.
               * Trước bản này `noteFbRejected()` chỉ được gọi cho ACK **MUỘN** (onLateAck) và cho
               * API #551. ACK rejected đến ĐÚNG HẠN thì không ai ghi ⇒ cổng `isFbRejected` không
               * bao giờ thấy ⇒ ca đó rơi xuống làn bù Socket → bị chốt ⚠ "chưa xác nhận" ⇒ vào
               * danh sách GỬI TAY dù FB đã nói rõ khách không nhận được. */
              onRejected: () => noteFbRejected(conv.id, 'Socket ACK rejected = FB từ chối nhận tin') });
        })
          .then((rawSync) => {
            if (notifySlotStarted) {
              const fn0 = notifySlotStarted;
              notifySlotStarted = null;
              fn0(false);
              return;
            }
            /* Bắn-nhả: `socketPublishSend` trả `{kind:'fired'}` NGAY sau publish ⇒ settle đã được
             * `firedCb` gọi ở nền. KHÔNG gọi settle lần 2 ở đây (sẽ phân xử 2 lần một kết quả). */
            if (rawSync && rawSync.kind === 'fired') return;
            settleAndFinalize(rawSync && rawSync.kind ? rawSync : { kind: 'noack' }, true);
          })
          .catch(() => {
            if (notifySlotStarted) {
              const fn0 = notifySlotStarted;
              notifySlotStarted = null;
              fn0(false);
              return;
            }
            settleAndFinalize({ kind: 'noack' }, true);
          })
          /* ⚡ [FIX-4] nhả sockFiredPending ở MỌI lối ra — kể cả khi worker stopped trước khi
           * vào slot hoặc lane throw. Nếu không, chat kẹt "đang chờ ACK" vĩnh viễn.
           * ═══ [v1.92.66] NHƯNG KHÔNG ĐƯỢC NHẢ KHI ĐANG Ở CHẾ ĐỘ BẮN-NHẢ ═══
           * Ở chế độ GIỮ (cũ), `.finally` chạy SAU khi settle xong ⇒ `finalizeSockBg` đã xoá cờ
           * rồi, đây chỉ là lưới an toàn.
           * Ở chế độ BẮN-NHẢ, `pageLane` resolve NGAY sau khi publish, còn ACK vẫn đang bay
           * (settle chạy nền tới 12 000 ms). Nếu `.finally` xoá cờ lúc này thì `sockFiredPending`
           * TRỐNG trong suốt thời gian chờ ⇒ `acquireOutbound()` và `scheduleBuRetry()` sẽ cho
           * bắn/bù CHỒNG đúng ca đang bay ⇒ GỬI TRÙNG. Đây là bẫy im lặng: log vẫn đẹp, khách
           * nhận 2 tin.
           * Nay: ở chế độ bắn-nhả, cờ do `finalizeSockBg()` (và nhánh `.catch` của
           * `settleAndFinalize`) xoá khi settle THẬT SỰ xong — hai chỗ đó đã có sẵn.
           * `SOCK_FIRED_RELEASE` = false thì giữ nguyên hành vi cũ. */
          .finally(() => {
            if (!SOCK_FIRED_RELEASE) sockFiredPending.delete(conv.id);
          });
        if (photo) {
          ctx.nonReusableFbId = null;
          ctx.nonReusableFbIds = null;
        }
        // Bấm Dừng: mọi lane đều resolve { ok:false, error:'Đã dừng' } mà KHÔNG gọi hàm trong hàng
        // (xem start() của makeLane/makeAdaptivePriorityLane) ⇒ .then bên dưới tự gọi
        // notifySlotStarted(false) ⇒ slotStartedPromise luôn được giải phóng, không treo worker.
        const slotStarted = await slotStartedPromise;
        if (!slotStarted) {
          sockFiredPending.delete(conv.id);
          releaseOutbound(conv.id);
          return { ok: false, sent: false, error: 'Đã dừng' };
        }
        return { ok: true, id: gid, sendBy: 'socket', sent: true, fired: true };
      }
      if (!acquireOutbound(conv.id)) return dupBlockedResult(conv.id);
      ctx.ownsOutbound = true; // Ext bù ảnh trong settleSocketResult dùng chung khóa này
      let settled;
      try {
        const laneRunner = ctx.prioritySocket ? runPrioritySocket : pageLane;
        /* [v1.93.13] Đường ĐỒNG BỘ — cùng lỗi như trên: ACK rejected ở lần bắn đầu không
         * được ghi `fbRejectedIds`. Truyền `onRejected` để cổng 🚫/❌ nhìn thấy. */
        const rawSync = await laneRunner(() => socketPublishSend(helper, pageId, gid, text, attFbIds),
          null, { onRejected: () => noteFbRejected(conv.id, 'Socket ACK rejected (đồng bộ) = FB từ chối nhận tin') });
        settled = await settleSocketResult(rawSync);
        if (settled && settled.noAck) scheduleSocketVerify(conv, text, photo, settled.publishedAt || (Date.now() - 15000));
      } finally { ctx.ownsOutbound = false; }
      if (!(settled && (settled.ok || settled.sent === 'maybe'))) releaseOutbound(conv.id);
      return settled;
    } catch (e) {
      return { ok: false, sent: 'maybe', error: 'Socket lỗi: ' + (e && e.message || e) };
    }
  }

  // Gửi qua extension Pancake (đường app dùng khi API bị "(#10)" — executeByExtOnce, type REPLY_INBOX_PHOTO)
  async function sendViaExtension(conv, text, photo, ctx) {
    ctx = ctx || {};
    if (conv.type === 'comment') return sendCommentViaExtension(conv, text, photo, ctx); // chat bình luận → SEND_COMMENT
    const adapter = window.__ExtensionAdapter__;
    if (!adapter || typeof adapter.send !== 'function') {
      return { ok: false, error: 'Không thấy Extension Pancake', skipExt: true };
    }
    try {
      if (typeof adapter.checkConnection === 'function' && !adapter.checkConnection({ silent: true })) {
        return { ok: false, error: 'Extension Pancake chưa kết nối', skipExt: true };
      }
    } catch (e) { /* cứ thử gửi */ }

    const platform = detectPlatform(conv.pageId || conv.id.split('_')[0]);
    if (platform !== 'facebook') {
      return { ok: false, error: 'Extension chỉ áp dụng cho Facebook ở chế độ này', skipExt: true };
    }
    // Extension đang trong giờ nghỉ hồi sức (timeout liên tiếp): bỏ qua NGAY từ
    // đầu, khỏi tốn khâu chuẩn bị/upload rồi lại xếp hàng chờ vô ích. Chat này
    // chưa hề bắn lệnh Ext nào nên chuyển Socket/API là an toàn, không trùng.
    if (isExtBreakerOpen()) {
      extTimeoutStats.skipped++;
      sendDiag.extOverloadSkips++; // [v1.92.40] đếm đúng chỗ (trước đây chỉ khai báo, không ai tăng)
      // [v1.92.40] Ghi dấu lên chat: nó CHƯA hề được gửi qua Ext, chỉ bị bộ ngắt chặn. Nếu không
      // còn kênh nào khác, chỗ chốt ❌ sẽ dựa vào dấu này để HẸN THỬ LẠI thay vì chốt oan.
      try { conv.__extSkippedOverload = true; } catch (eSk) { /* ignore */ }
      return {
        ok: false, sent: false, skipExt: true, extBreakerOpen: true,
        error: 'Extension đang quá tải (đang nghỉ hồi sức) — tạm bỏ qua Ext để thử kênh khác',
      };
    }
    const full = await ctxFull(conv, ctx);
    if (!full) return { ok: false, error: 'Không lấy được thông tin đoạn chat' };
    const pageId = full.page_id || conv.pageId || String(conv.id).split('_')[0];

    if (!ctx.threadResolved) {
      let threadId = full.thread_id || full.threadId;
      if (!threadId && typeof window.__syncMissingThreadId__ === 'function') {
        try {
          threadId = await window.__syncMissingThreadId__(pageId, full.id || conv.id);
        } catch (e) { /* ignore */ }
      }
      ctx.threadId = threadId || null;
      ctx.threadResolved = true;
    }
    const threadId = ctx.threadId;
    if (!threadId) return { ok: false, error: 'Không tìm thấy thread_id' };

    if (!ctx.gidResolved) {
      ctx.gid = await resolveGlobalId(full, threadId, conv.id, conv.fromPsid, ctx.gidForceFind, ctx);
      ctx.gidResolved = true;
    }
    // SỬA GỐC v1.73.0: findGlobalIdForConv trong bundle (@903213) trả null cho RẤT NHIỀU trường hợp
    // (Extension mất kết nối, adapter trả success=false, không có data.globalId, hoặc exception),
    // KHÔNG chỉ khi khách khóa nick. Vì vậy "chưa dò được global_id" không còn được coi là bằng
    // chứng khách chết: vẫn gọi REPLY_INBOX_PHOTO đúng 1 lần bằng thread_id + globalUserId=null.
    // Chỉ khi chính lệnh GỬI Extension trả thất bại rõ ràng mới xét kênh/API dự phòng ở sendOne.
    const rawGlobalId = ctx.gid || null;
    const globalUserId = (ctx && ctx.gidFromPsid && threadId) ? null : rawGlobalId;
    if (!globalUserId && !threadId) {
      return { ok: false, sent: false, error: 'Không có globalId/thread_id — bỏ qua Ext' };
    }
    // GATE NO-GID: khâu dò đã đủ bằng chứng (HTTP ok-no-gid + Batch xong + Ext finder
    // phản hồi success không có gid) → không bắn lệnh gửi thread-only, khỏi giữ extSendLane.
    if (!globalUserId && ctx && ctx.gidGateSkipExt) {
      return {
        ok: false, sent: false, gidUnknown: true, noGidGate: true,
        discoveryState: ctx.gidDiscoveryState || 'ext-responded-no-gid',
        error: 'Không tìm được global_id để gửi — bỏ qua Ext thread-only cho nhanh',
      };
    }
    const token = getToken();
    let files;
    if (photo) {
      const up = await uploadOneTimePhoto(pageId, photo, conv.id, ctx, false);
      if (!up || !up.ok || !up.fbId) {
        return { ok: false, sent: false, error: 'Không gắn được ảnh cho Extension (' + ((up && up.error) || 'lỗi upload') + ')' };
      }
      // Tiêu thụ fbId cho lần bắn Extension này
      ctx.nonReusableFbId = null;
      ctx.nonReusableFbIds = null;
      files = (up.fbIds && up.fbIds.length) ? up.fbIds.slice() : [up.fbId];
    }
    const payload = {
      pageId: pageId,
      igPageId: null,
      accessToken: token,
      tryResizeImage: true,
      contentIds: photo ? normalizePhotoItems(photo).map((x) => x.id).filter(Boolean) : [],
      type: 'REPLY_INBOX_PHOTO',
      message: text,
      attachmentType: photo ? 'PHOTO' : 'SEND_TEXT_ONLY',
      globalUserId,
      platform: 'facebook',
      replyMessage: null,
      threadId,
      convId: full.thread_key || full.threadKey || conv.threadKey || (threadId ? 't_' + threadId : null), // thread_key = 't_' + thread_id
      customerName: (full.from && (full.from.username || full.from.name)) || full.customerName || conv.customerName || '',
      isIGD: false,
      conversationUpdatedTime: (function () {
        const t = Date.parse(String(full.updated_at || full.updatedAt || conv.updatedAt || '') + 'Z');
        return isNaN(t) ? Date.now() : t; // thiếu mốc → dùng giờ — không gửi NaN cho extension
      })(),
      photoUrls: photo ? normalizePhotoItems(photo).map((x) => x.url).filter(Boolean) : [],
      isBusiness: false,
    };
    // đúng shape app: chỉ có files/photoUrl khi gửi ảnh (text-only: app để undefined → bỏ key)
    if (files) payload.files = files;
    if (photo) payload.photoUrl = photo.url;
    let extSendPermit = null;
    let extSendStartedAt = 0;
    try {
      // Tách bước chuẩn bị HTTP (ctxFull + uploadPhotoForPage + resolveGlobalId chạy ở extPrepLane)
      // khỏi bước bắn Extension thật (extSendLane): khi vào adapter.send là đã có sẵn
      // 100% payload (globalUserId + files=[fbId]), không giữ slot Extension trong lúc chờ HTTP!
      // Socket đang giữ khóa của chính chat này (ctx.ownsOutbound — Ext được gọi để BÙ ẢNH
      // trong settleSocketResult) thì KHÔNG tự acquire nữa: acquire sẽ thua chính khóa Socket
      // và trả ok GIẢ (dup-block) trong khi ảnh chưa hề được gửi.
      const ownLock = !!(ctx && ctx.ownsOutbound);
      if (!ownLock && !acquireOutbound(conv.id)) return dupBlockedResult(conv.id);
      extSendPermit = await acquireExtSendPermit();
      /* [v1.92.45] đo đỉnh in-flight THẬT của làn Ext (so với getLimit ở TỔNG HỢP).
       * Đỉnh <  limit ⇒ Extension tự tuần tự hoá, nâng làn vô ích (HAR: đỉnh 42/48–96). */
      try {
        const _act = extSendLane.activeCount();
        if (_act > (extSendCtl.peakActive || 0)) extSendCtl.peakActive = _act;
      } catch (ePk) { /* ignore */ }
      if (!extSendPermit) {
        if (!ownLock) releaseOutbound(conv.id);
        if (state.stopRequested) return { ok: false, sent: false, error: 'Đã dừng' };
        extTimeoutStats.skipped++;
        return {
          ok: false, sent: false, skipExt: true, extBreakerOpen: true,
          error: 'Extension đang quá tải (đang nghỉ hồi sức) — tạm bỏ qua Ext để thử kênh khác',
        };
      }
      const res = await extSendLane(() => {
        // Bộ ngắt vừa mở trong lúc lệnh này còn chờ lane: HỦY TRƯỚC KHI BẮN.
        // Chưa hề có lệnh nào tới Extension nên hủy ở đây không thể gây trùng.
        if (!extSendPermit.probe && isExtBreakerOpen()) {
          return {
            ok: false, sent: false, extBreakerSkipped: true,
            error: 'Extension đang quá tải — đã hủy lệnh Ext trước khi bắn',
          };
        }
        extSendStartedAt = Date.now();
        // 🔥 [FIX-TỐC-ĐỘ] 35s→12s: Extension bình thường trả 0,8–3s. 35s chỉ làm kẹt worker khi Ext ì.
        // [v1.91.96] 12s→7s. Log 09:16 (312 chat): 30 ca "Ext quá hạn" ⇒ kiểm chứng lịch sử
        // sau đó chỉ 1 ca là tin ĐÃ đến nơi, 29 ca thật sự không đi. Tức 12 giây chờ gần như
        // không bao giờ cứu được tin nào, nhưng với 24 làn thì 30 ca × 12s = 6 phút-làn bị giữ,
        // đủ để mở bộ ngắt ("Extension không phản hồi 12 lần liên tiếp") và pause cả làn 45s.
        // 7s vẫn gấp >2 lần mức phản hồi bình thường (0,8–3s), và ca quá hạn vẫn KHÔNG gửi lại
        // (đánh ⚠, kiểm chứng nền chỉ nâng ⚠→✅) nên rút ngắn không thể sinh tin trùng.
        // [v1.91.98] 7s→2,5s. Log 09:24 (1 457 chat, 1.91.97):
        //   🧯 Ext quá hạn 114 · kiểm chứng thấy tin 69 · chưa thấy trong lịch sử 45
        // ⇒ 60 % ca "Extension không phản hồi" thực ra TIN ĐÃ ĐẾN NƠI. Extension gửi xong nhưng
        // không trả lời. Vì vậy giữ làn chờ 7 giây cho một phản hồi sẽ không bao giờ tới là mất
        // trắng: 114 ca × 7s ÷ 48 làn ≈ 17 giây-làn, trong khi HAR đo ca lỗi THẬT trả về
        // p50 908ms / p90 1 197ms — 2,5s đã phủ trên p99.
        // [v1.92.45] số HAR mới nhất (network-log.har, 90 lệnh của extension Pancake v2 trong
        // lúc tool chạy): p50 990 ms · p90 1 450 ms · max 2 130 ms cho MỌI phản hồi, và
        // 1545012 (lỗi tạm thời) trả nhanh hơn — p50 340 ms. Kết luận cũ vẫn đúng: 2,5 s phủ
        // trên p99, không cần nới; nhưng mẫu p90 nay chỉ lấy ca THÀNH CÔNG (xem
        // noteExtSendOutcome) để không tự siết timeout bằng các ca lỗi trả lời nhanh. Ca quá hạn vẫn đi đúng đường cũ:
        // đánh ⚠ "không rõ", đăng ký kiểm chứng lịch sử nền, KHÔNG BAO GIỜ gửi lại (chỉ nâng
        // ⚠→✅). Rút ngắn thời gian chờ không mở thêm bất kỳ đường gửi trùng nào.
        // [v1.92.8] giữ chỗ chờ để bắt phản hồi MUỘN thay vì vứt bỏ (xem sendExtWithLateWatch)
        return sendExtWithLateWatch(adapter, payload, conv, { softMs: extTimeoutMs(), startedAt: extSendStartedAt });
      });
      if (res && res.extBreakerSkipped) {
        releaseExtSendPermit(extSendPermit);
        if (!ownLock) releaseOutbound(conv.id);
        extTimeoutStats.skipped++;
        return {
          ok: false, sent: false, skipExt: true, extBreakerOpen: true,
          error: res.error,
        };
      }
      if (res && res.ok === false && res.sent === false && res.error) {
        if (String(res.error).indexOf('Lỗi kênh:') === 0) {
          // adapter.send VĂNG exception (lane bọc thành 'Lỗi kênh:…') — không rõ đã bắn
          // hay chưa (có thể văng SAU khi gửi) → "không rõ", cấm kênh khác bắn lần 2 (LẶP)
          extSendCtl.lastOutcomeOk = false;
          noteExtSendOutcome('timeout', extSendPermit, extSendStartedAt ? Date.now() - extSendStartedAt : null);
          extTimeoutStats.timeout++;
          if (!ownLock) scheduleExtTimeoutVerify(conv, text, photo, extSendStartedAt);
          return { ok: false, sent: 'maybe', error: 'Extension lỗi giữa chừng — không gửi thêm để tránh trùng' };
        }
        extSendCtl.lastOutcomeOk = false; // [v1.92.45] "có phản hồi" KHÔNG phải "khoẻ" (HAR: 90/90 lỗi mà vẫn <2,2 s)
        noteExtSendOutcome('responded', extSendPermit, extSendStartedAt ? Date.now() - extSendStartedAt : null);
        releaseExtSendPermit(extSendPermit);
        if (!ownLock) releaseOutbound(conv.id);
        return { ok: false, sent: false, error: res.error };
      }
      if (res && res.success) {
        extSendCtl.lastOutcomeOk = true; // [v1.92.45] chỉ ca này mới được nuôi p90 + tăng làn
        noteExtSendOutcome('responded', extSendPermit, extSendStartedAt ? Date.now() - extSendStartedAt : null);
        // HỌC THEO app (onSuccess → update_global_id): globalUserId extension trả về có thể ĐÚNG
        // hơn giá trị mình đoán (có khách globalId là FBID 1000… chứ không phải PSID) — cache lại
        // theo conv id + báo update_global_id lên server để các lần gửi sau có sẵn trong DB
        const gidBack = (res.data && res.data.globalUserId) || globalUserId;
        if (gidBack && typeof gidBack === 'string' && (!ctx || !ctx.gidFromPsid || (res.data && res.data.globalUserId))) {
          try {
            const pId = pageId;
            if (typeof window.__botfakeSaveGid__ === 'function') {
              window.__botfakeSaveGid__(conv.id, pId, threadId, gidBack);
            }
            window.__GlobalIdCacheTest__ && window.__GlobalIdCacheTest__.set(conv.id, gidBack);
            window.__tempGlobalIdCache__ && window.__tempGlobalIdCache__.set(conv.id, gidBack);
            if (ctx) { ctx.gid = gidBack; ctx.gidResolved = true; ctx.gidFromPsid = false; }
            const fId = (full.from && full.from.id) || conv.fromPsid || '';
            if (pId && fId && !updatedGidConvSet.has(conv.id)) {
              updatedGidConvSet.add(conv.id);
              const qTok = token ? ('?access_token=' + encodeURIComponent(token)) : '?';
              sideEffectLane(() => fetch(apiBase() + '/v1/pages/' + pId + '/customers/' + encodeURIComponent(fId) + '/update_global_id' + qTok, {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ global_id: gidBack, conversation_id: conv.id, source: 'send_inbox', version: 1 }),
              }).catch(() => null));
            }
          } catch (e) { /* ignore */ }
        }
        /* ═══ [v1.93.2] `success` CỦA EXTENSION KHÔNG PHẢI BẰNG CHỨNG TIN ĐÃ TỚI ═══
         * ĐO ĐƯỢC trên log 21/11 20:28 (lô 4 271 chat, bản 1.93.1, có sổ kiểm chứng 11 035 dòng):
         *   • 554 ca `🛟 … ⇒ GỬI CỨU 1 lần qua Extension` → 554 ca `✅ đánh dấu ĐÃ TỚI NƠI qua ext`
         *   • 0 dòng `🧯 Ext quá hạn` · 0 `Extension không gửi được` · 0 `bù không được`
         *   • 0 lần nào đọc lại lịch sử cho các ca đó
         *   • độ trễ 🛟 → ✅ p50 613 ms (mà ngay trước đó cổng vừa ĐO "hội thoại KHÔNG có tin")
         * Người dùng mở Pancake kiểm 3 ca mẫu (Phạm Lí, Nguyễn Quý, Thiểm Nga): KHÔNG có tin.
         * ⇒ `res.success` chỉ nói "Extension nhận lệnh và không báo lỗi", KHÔNG nói khách đã nhận.
         *
         * NAY: nhánh success đi ĐÚNG đường của nhánh timeout bên dưới — đánh ⚠ "chưa xác nhận",
         * đăng ký đọc lại lịch sử; thấy đúng tin ⇒ mới ✅; hết lượt đọc mà không thấy ⇒ chốt ❌
         * và KHÔNG đưa vào danh sách gửi tay (chốt của người dùng: "chặn là chặn").
         *
         * KHÔNG đổi số lệnh gửi của bất kỳ ca nào: ca này KHÔNG bị bắn lại lần 2 — chỉ khác chỗ
         * ghi nhận kết quả (⚠ chờ kiểm chứng thay vì ✅ ngay). Đây là điều kiện CHẶT HƠN. */
        /* KHÔNG gọi noteExtSendOutcome lần nữa: ngay phía trên (dòng `if (res && res.success)`) đã
         * gọi 1 lần rồi. Gọi 2 lần ⇒ `fastStreak` tăng gấp đôi ⇒ làn Ext tự nới 2× nhanh hơn thiết
         * kế — đúng loại lỗi "Ext nhanh mà cứu 0" mà 1.92.45 vừa vá. */
        extTimeoutStats.claimedUnverified++;
        /* ═══ [v1.93.13] ĐỌC `messageId` CỦA REPLY_INBOX_PHOTO_SUCCESS (trước đây VỨT) ═══
         * Nguồn `0.5.62_0/assets/background.js`:
         *   parseSuccessResponse → { messageId: e.payload.actions[0].message_id,
         *                            globalUserId, timestamp: e.payload.actions[0].timestamp }
         *   sendInboxSuccess     → postMessage({type:"REPLY_INBOX_PHOTO_SUCCESS", taskId,
         *                            pageId, convId, messageId, globalUserId, timestamp, …})
         * Script cũ đọc `res.data.timestamp || res.data.convId` ⇒ BỎ QUA `messageId`, mà đây là
         * bằng chứng dương tính DUY NHẤT của FB. Nay vẫn giữ ⚠ (đúng: success chỉ là extension
         * không báo lỗi) nhưng lưu `messageId` vào sổ để lượt đọc lịch sử đối chiếu được.
         * Không đổi số lệnh gửi. */
        const _extMsgId = (res.data && res.data.messageId) || '';
        const _extTs = (res.data && res.data.timestamp) || 0;
        if (_extMsgId) {
          try {
            extMsgIdByConv[conv.id] = { messageId: String(_extMsgId), at: _extTs || Date.now() };
          } catch (eMI) { /* ignore */ }
        }
        /* ═══ [v1.93.14] `success` MÀ KHÔNG CÓ `messageId` = FB TỪ CHỐI NGẦM ═══
         * Nguồn `0.5.62_0/assets/background.js` (class `se` + `ee`):
         *   isResponseSuccess(e,t){ case "facebook": return e && e.payload &&
         *       (e.payload.actions && e.payload.actions[0].message_id || e.payload.error_payload); }
         *   parseSuccessResponse({response:e,platform:t,…}){ case "facebook":
         *       return e.payload.error_payload ? {}                                  // ← RỖNG
         *                                      : { messageId: e.payload.actions[0].message_id,
         *                                          globalUserId, timestamp: e.payload.actions[0].timestamp }; }
         * ⇒ Khi FB trả `payload.error_payload` thì ext COI LÀ THÀNH CÔNG
         *   (`isResponseSuccess` trả chính `error_payload`, truthy) NHƯNG `parseSuccessResponse`
         *   trả `{}` ⇒ postMessage `REPLY_INBOX_PHOTO_SUCCESS` **không có `messageId`**,
         *   không có `timestamp`.
         * ⇒ `success:true` + KHÔNG `messageId` KHÔNG phải "chưa xác nhận": đó là **bằng chứng
         *   VẮNG MẶT** — FB đã trả `error_payload` ⇒ KHÔNG có tin nào được tạo.
         * Trước bản này script gộp cả hai vào "maybe + extClaimedSuccess" ⇒ ca này bị đọc lại
         * lịch sử vô ích 20 s rồi mới chốt, và KHÔNG được ghi vào sổ "FB đã từ chối".
         * Nay tách cờ `extSuccessNoId` để nhánh xử lý ghi đúng: FB từ chối, không đọc lại lâu. */
        const _extNoId = !_extMsgId;
        /* Vẫn đọc lại lịch sử cho CẢ HAI ca: `error_payload` là suy luận từ hợp đồng extension,
         * chưa phải bằng chứng đo được trên hội thoại. Chỉ ĐỌC ⇒ vô hại, và nếu lịch sử CÓ tin
         * thì lật ✅ (không gửi lại). */
        if (!ownLock) scheduleExtTimeoutVerify(conv, text, photo, extSendStartedAt, 1, false, 0, true);
        return {
          ok: false, sent: 'maybe', sendBy: 'extension', extClaimedSuccess: true,
          extSuccessNoId: _extNoId,
          extMessageId: _extMsgId ? String(_extMsgId) : '',
          id: _extMsgId || (res.data && (res.data.timestamp || res.data.convId)) || '',
          error: _extNoId
            ? 'Extension báo success nhưng KHÔNG có messageId ⇒ FB trả error_payload (từ chối ngầm) — không có tin nào được tạo'
            : 'Extension báo success — CHƯA xác nhận tin đã tới (đang đọc lại lịch sử, không gửi lại)',
        };
      }
      if (res && res.success === false) {
        // Trong __ExtensionAdapter__.send (@715835), khi setTimeout hết giờ nó trả về { success: false, data: null }
        const d = res.data || {};
        /* ═══ [v1.93.7] ĐỌC ĐỦ CÁC TRƯỜNG LỖI MÀ EXTENSION THẬT SỰ TRẢ ═══
         * Nguồn: 0.5.62_0/assets/background.js — `sendInboxFail(e,t,a,r){...postMessage({
         *   type:"REPLY_INBOX_PHOTO_FAILURE", taskId, pageId, convId, error: s})}`
         * ⇒ mọi lý do nằm trong **`s`**, và `s` chỉ có 3 hình dạng:
         *   cannotRetry          → {errorDescription, fbErrorCode}          (app đọc `H.error`)
         *   execute task timeout → {success:false, retryReason:"execute task timeout"}
         *   retryUsingSocket     → {success:false, canRetryUsingSocket:true,
         *                           retryReason:"blocked_3252001", fbErrorCode}
         *   lỗi mạng / sai URL   → `undefined`
         * Trước bản này script CHỈ đọc errorMessage/error/reason/code ⇒ trượt `errorDescription`
         * (vẫn tình cờ bắt được nhờ chuỗi "không có mặt"), TRƯỢT HOÀN TOÀN `retryReason` và
         * `fbErrorCode` ⇒ ca `execute task timeout` (extension BỎ lệnh, tin CHẮC CHẮN chưa đi)
         * bị xếp vào "không rõ" thay vì ❌. */
        /* SHAPE THẬT — suy ra từ chính log (không đoán):
         * log in `Extension không gửi được ({"errorDescription":"…","fbErrorCode":1545041})`
         * và đoạn dựng chuỗi là `' (' + why + ')'` ⇒ **`why` CHÍNH LÀ object lồng đó**.
         * Bóc tiếp: `d.error` là object `{errorDescription, fbErrorCode}`.
         * Vì `typeof why === 'object'` nên khối JSON.stringify ngay dưới đã biến nó thành chuỗi
         * — nhờ vậy `deadUser` vẫn khớp "không có mặt". Nhưng `fbErrorCode` là SỐ nằm trong
         * object lồng, không bao giờ đọc được ở dạng phẳng.
         * Nay đọc cả hai tầng. */
        /* ═══ [v1.93.10] `d` CÓ THỂ LÀ CHUỖI JSON, KHÔNG PHẢI OBJECT ═══
         * ĐO TRÊN 28 LOG — 16 142 dòng lỗi Ext, CHỈ 2 hình dạng:
         *   16 094  Extension không gửi được ({"errorDescription":"Người này hiện không có mặt.","fbErrorCode":N})
         *       48  Extension không gửi được (INCORRECT THREAD)
         * Cả hai là **CHUỖI**, không phải object: chúng đi qua adapter của app
         * (`__ExtensionAdapter__` — không có trong repo) nên bị JSON.stringify một lần nữa.
         * Hệ quả: `d.fbErrorCode` = undefined ⇒ `_fbErrNum` LUÔN = 0 (mọi bản trước 1.93.10).
         * Nay: nếu `d` là chuỗi mà bắt đầu bằng `{` thì JSON.parse để đọc được SỐ.
         * Đây là đọc thêm, KHÔNG đổi phán quyết: chuỗi `why` phía dưới vẫn giữ nguyên
         * (nên mọi đường đang dựa vào regex chuỗi không bị ảnh hưởng). */
        if (d && typeof d === 'string' && /^\s*\{/.test(d)) {
          try {
            const pj = JSON.parse(d);
            if (pj && typeof pj === 'object') {
              d = pj;
              if (res) res.data = pj;
            }
          } catch (ePj) { /* không phải JSON — giữ nguyên chuỗi */ }
        }
        const _ee = (d && typeof d.error === 'object' && d.error) ? d.error : null;
        let why = d.errorDescription
          || (_ee && _ee.errorDescription)
          || d.errorMessage || d.error || d.reason
          || d.retryReason || d.code || d.fbErrorCode
          || (_ee && _ee.fbErrorCode) || '';
        if (why && typeof why !== 'string') {
          try { why = JSON.stringify(why); } catch (e2) { why = ''; } // không bao giờ lộ "[object Object]"
        }
        /* ═══ [v1.93.7] EXTENSION BỎ LỆNH VÌ HẾT HẠN = TIN CHẮC CHẮN CHƯA ĐI ═══
         * `sendInbox`: `const w = g ? ro(g) : "NO_TIMEOUT"; if (w === null)
         *    return b({success:false, retryReason:"execute task timeout"})`
         * `ro(g)` trả `null` khi mốc hết hạn của chính lệnh ĐÃ QUA ⇒ code `return` NGAY,
         * TRƯỚC cả `buildSendParams` và `de(...)` (là lệnh fetch gửi tin).
         * ⇒ chưa có byte nào tới Facebook. Đây là ❌ chắc chắn, KHÔNG phải "không rõ".
         * Trước bản này `retryReason` không được đọc nên `why === ''` ⇒ rơi xuống nhánh
         * "success:false không kèm lý do" ⇒ `sent:'maybe'` + đánh ⚠ + vào danh sách gửi tay.
         * Đây là đường CHẶT HƠN (⚠ → ❌), không thể sinh tin trùng. */
        if (/execute task timeout/i.test(String(why || ''))) {
          noteExtSendOutcome('responded', extSendPermit, extSendStartedAt ? Date.now() - extSendStartedAt : null);
          if (!ownLock) releaseOutbound(conv.id);
          return {
            ok: false, sent: false, definiteFail: true,
            error: 'Extension BỎ lệnh (hết hạn nội bộ) — tin CHƯA gửi, chốt ❌',
          };
        }
        if (!why) {
          // success:false mà KHÔNG kèm lý do = đúng hình dạng adapter trả khi HẾT GIỜ chờ
          // (setTimeout trong __ExtensionAdapter__.send) — Extension có thể ĐÃ gửi rồi mà
          // phản hồi về chậm. Kết luận "chưa gửi" ở đây là bắn lần 2 (LẶP) → phải là "không rõ".
          // Chỉ đăng ký kiểm chứng bằng lịch sử tin; không bắn kênh khác cho chat này.
          extSendCtl.lastOutcomeOk = false;
          noteExtSendOutcome('timeout', extSendPermit, extSendStartedAt ? Date.now() - extSendStartedAt : null);
          extTimeoutStats.timeout++;
          if (!ownLock) scheduleExtTimeoutVerify(conv, text, photo, extSendStartedAt);
          /* ═══ [v1.93.8] "KHÔNG PHẢN HỒI" Ở ĐÂY LÀ HẾT 2,5 s CỦA **TA**, KHÔNG PHẢI CỦA EXTENSION ═══
           * ĐO TRÊN 28 LOG: câu này xuất hiện **2 588 lần** — nhóm "không rõ" lớn thứ nhì.
           * Nguồn extension (`0.5.62_0/assets/background.js`):
           *   `ao = 35e3`  ·  `Wc(fn, e = ao - 5e3)`  ⇒ mỗi lệnh có **30 s** ngân sách
           *   `sendInbox`: `const w = g ? ro(g) : "NO_TIMEOUT"; if (w === null)
           *                return b({success:false, retryReason:"execute task timeout"})`
           * ⇒ Trước 30 s, extension KHÔNG BAO GIỜ tự bỏ lệnh. Vậy khi ta bỏ chờ ở 2,5 s thì
           *   lệnh VẪN ĐANG CHẠY bên trong extension — nó có thể thành công ở giây thứ 5, 20, 29.
           * Đó là lý do log ghi "Ext quá hạn 114 · kiểm chứng thấy tin 69" (60 % tin ĐÃ đến nơi).
           * ⇒ Câu chữ cũ ("Extension không phản hồi") là SAI SỰ THẬT: phải nói rõ đây là hạn chờ
           *   CỦA TA và extension còn đang chạy. Không đổi nhánh quyết định (vẫn 'maybe' + kiểm
           *   chứng nền, tuyệt đối không bắn lại) — chỉ đổi câu chữ cho khỏi bị đọc sai
           *   thành "extension chết". */
          return { ok: false, sent: 'maybe',
            error: 'Hết hạn chờ CỦA TOOL sau ' + Math.round((Date.now() - extSendStartedAt) / 100) / 10
              + 's (Extension tự có 30 s và VẪN ĐANG CHẠY) — không gửi thêm để tránh trùng' };
        }
        const errStr = 'Extension không gửi được' + (why ? ' (' + why + ')' : '');
        // Lệnh Ext là lệnh GỬI THẬT vào đúng thread: Facebook trả minh bạch 1545041 /
        // "Người này hiện không có mặt" / không tìm thấy người dùng thì chốt khách không
        // nhận được tin luôn — kể cả khi payload là thread-only (globalUserId=null).
        // Không rơi sang Socket nữa (Socket cũng không có gid để bắn, chỉ tốn thêm vòng lặp).
        // [v1.92.34] BỎ ĐIỀU KIỆN "phải thiếu globalId" — đây là gốc của 1 089 ca sai ở lô 13:38.
        // Lệnh Ext là lệnh GỬI THẬT vào đúng thread (HAR §68: cùng endpoint
        // /conversations/{pid}_{threadId}/messages, FB trả e_code 551 / e_subcode 1545041), nên
        // 1545041 là FB TỪ CHỐI, không phụ thuộc việc có gid hay không. Trước đây ca CÓ gid rơi
        // vào nhánh `ambiguous` ⇒ bị đem đi chứng minh vắng mặt + bù kênh khác (vô ích, 1 089 ca).
        const deadUser = /1545041|Người này hiện không có mặt|Không tìm thấy người dùng/i.test(String(why || ''));
        /* ═══ [v1.93.5] EXT TRẢ 1545041 ⇒ GHI SỔ "FB ĐÃ TỪ CHỐI" + KHÔNG ĐỌC LẠI 20 s ═══
         * ĐO ĐƯỢC trên 28 log: đây là câu lỗi ❌ xuất hiện NHIỀU NHẤT trong toàn bộ log
         *   534 dòng `❌ … Ext: Extension không gửi được ({"errorDescription":"Người này hiện
         *   không có mặt.","fbErrorCode":1545041})`
         *   307 dòng `❌ … bù Extension không được: … không có mặt`
         *   222 dòng `⚠ … đã đo N ca thì Extension cũng bị chặn ⇒ GIỮ ⚠, vào danh sách gửi tay`
         * Người dùng đã kiểm: nhóm này KHÔNG nhận được tin (chặn / khóa nick).
         * Trước bản này: Ext trả 1545041 ⇒ `deadUser` = true ⇒ vẫn `queueDeadUserRecheck()`
         * (đợi 25 s rồi đọc lại lịch sử) và nhóm bù kế vẫn chạy ⇒ tốn thời gian, sinh ⚠ gửi tay.
         * NAY: 1545041 là FB trả lời DỨT KHOÁT ⇒ ghi sổ `noteFbRejected()` để mọi cổng sau chặn,
         * và bỏ hậu kiểm 25 s (đường CHỈ ĐỌC, bỏ không thể sinh tin trùng, không thể chốt ✅ oan).
         * 1545012 (lỗi TẠM THỜI của FB) KHÔNG bị coi là dứt khoát — vẫn đi đường cũ. */
        /* ═══ [v1.93.7] BA MÃ FB TỪ CHỐI KHÁC — ĐỌC TỪ `getErrorHandler` CỦA EXTENSION ═══
         * Extension coi 5 mã này là lỗi phía FB và xử lý riêng:
         *   `const r = [1357004, 1545012, 1545006, 3252001, 1390008]`
         * nhưng chúng KHÔNG cùng nghĩa — extension tự phân biệt:
         *
         *  A) `checkCanReuploadPhotos(t)` = ĐÚNG BỘ BA này cùng lúc:
         *       error === 1545012
         *       errorSummary ∈ {"Tạm thời không thực hiện được", "Temporary Failure"}
         *       errorDescription ∈ {"Đã xảy ra lỗi tạm thời, vui lòng thử lại.",
         *                            "There was a temporary error, please try again."}
         *     ⇒ đây là lỗi TẠM THỜI thật ⇒ extension upload lại ảnh rồi gửi lại
         *       (`reuploadPhotos`, hoặc `reuploadPhotosByApi` nếu page đang bị chặn upload).
         *       TUYỆT ĐỐI KHÔNG được chốt ❌ — tin có thể gửi được ở lần sau.
         *
         *  B) `error === 3252001` hoặc `error === 1390008` ⇒ extension trả
         *       `canRetryUsingSocket:true, retryReason:"blocked_3252001"`
         *     và `setUploadBlocked` ghi page vào sổ chặn upload **7 NGÀY** (`wl = 6048e5`).
         *     Đây là FB CHẶN PAGE ⇒ không kênh nào gửi được.
         *
         *  C) `error === 1545006` ⇒ extension upload lại ảnh (`reuploadPhotos`), coi như
         *     lỗi ảnh. KHÔNG phải bằng chứng khách chết ⇒ không chốt ❌.
         *
         * Chỉ (B) mới được ghi sổ "FB từ chối". (A) và (C) giữ nguyên đường cũ. */
        /* [v1.93.8] SỬA LỖI CỦA CHÍNH BẢN 1.93.7: `Number(...)` bọc NGOÀI chuỗi `||` nên khi
         * `d.error` là OBJECT thì `Number(object)` = NaN ⇒ `NaN || 0` = 0 ⇒ mã lồng
         * `d.error.fbErrorCode` KHÔNG BAO GIỜ đọc được. Lấy số TRƯỚC, bọc Number SAU. */
        const _fbErrNum = Number(
          (d && d.fbErrorCode)
          || (_ee && _ee.fbErrorCode)
          || (d && typeof d.error === 'number' ? d.error : 0)
          || (d && typeof d.code === 'number' ? d.code : 0)
          || 0
        ) || 0;
        const _whyStr = String(why || '');
        /* ═══ [v1.93.10] ĐỌC `canRetryUsingSocket` — TRƯỚC ĐÂY CHƯA TỪNG ĐỌC ═══
         * Nguồn `sendInbox` (0.5.62):
         *   case"retryUsingSocket": return v({success:!1, canRetryUsingSocket:!0,
         *                                  retryReason:"blocked_3252001", fbErrorCode:H.error})
         * Extension TRẢ CỜ NÀY Ở 3 NHÁNH (`getErrorHandler`):
         *   (i)  `t.error === 1545012 && a === 1`  → tức ĐÃ TỪNG thử lại mà VẪN lỗi
         *   (ii) IG `error_payload:true` không kèm `error`
         *   (iii)`3252001` | `1390008`
         * Script trước bản này KHÔNG đọc cờ ⇒ gộp (i) vào "tạm thời" như lần 1.
         * (i) KHÁC NGHĨA với 1545012 lần đầu:
         *        lần 1 = lỗi tạm thời ⇒ extension tự upload lại rồi gửi lại (không chốt ❌) ✔
         *        lần 2 = vẫn lỗi sau khi đã upload lại ⇒ extension HẾT đường, đề nghị đi Socket
         *     Vẫn KHÔNG phải bằng chứng "khách chết" ⇒ KHÔNG chốt ❌, KHÔNG ghi sổ từ chối.
         *     Chỉ đổi: (a) ghi số đo riêng, (b) câu cảnh báo nói đúng "đã thử lại vẫn lỗi".
         * (iii) mới là FB chặn page ⇒ ghi sổ (giữ nguyên như 1.93.7). */
        const _canSock = !!(d && (d.canRetryUsingSocket === true || /blocked_3252001/i.test(_whyStr)));
        const _retry2 = _canSock && (_fbErrNum === 1545012 || /1545012/.test(_whyStr));
        if (_retry2) {
          try { extTimeoutStats.fbRetry2 = (extTimeoutStats.fbRetry2 || 0) + 1; } catch (eR2) { /* ignore */ }
        }
        if ((_canSock && !_retry2 && (_fbErrNum === 3252001 || _fbErrNum === 1390008))
            || _fbErrNum === 3252001 || _fbErrNum === 1390008
            || /3252001|1390008/.test(_whyStr)) {
          try { noteFbRejected(conv.id, 'Extension: FB CHẶN PAGE (uploadBlocked 7 ngày) — mã ' + (_fbErrNum || why)); } catch (eFbR2) { /* ignore */ }
        } else if (deadUser) {
          try { noteFbRejected(conv.id, 'Extension trả 1545041 = FB từ chối nhận tin'); } catch (eFbR) { /* ignore */ }
        }
        // INCORRECT THREAD khi CHƯA có globalUserId thật: lệnh Ext lúc đó thiếu
        // globalUserId nên có thể không định vị được thread dù thread vẫn tồn tại.
        // Bằng chứng _app @903213 cho thấy khâu dò không cung cấp được "xác nhận
        // không có gid", nên ca này là GID CHƯA RÕ → kênh sau/Pass 2 dò lại, không
        // được kết luận recipientUnavailable.
        const gidUnknownThread = !globalUserId && /INCORRECT THREAD/i.test(String(why || ''));
        noteExtSendOutcome('responded', extSendPermit, extSendStartedAt ? Date.now() - extSendStartedAt : null);
        if (!ownLock) releaseOutbound(conv.id);
        return {
          ok: false, sent: false,
          // [v1.92.30] Lý do của adapter có thể đến từ bước SAU khi chữ đã đi (dò global_id,
          // thread_key, fbId ảnh) ⇒ phán đoán, không phải bằng chứng ⇒ phải chứng minh vắng mặt.
          ambiguous: true,
          recipientUnavailable: deadUser,
          // [v1.92.34] Đánh dấu NGUỒN của kết luận: chỉ ca này mới vào sổ HẬU KIỂM sau lô
          // (đọc lại lịch sử; thấy tin ⇒ lật ✅). Các nguồn recipientUnavailable khác (#100…)
          // không đụng tới.
          deadUserHint: deadUser,
          fbRetryExhausted: _retry2,
          gidUnknown: gidUnknownThread,
          discoveryState: (ctx && ctx.gidDiscoveryState) || 'unknown',
          error: errStr,
        };
      }
      // không có phản hồi (timeout/hủy) → extension có thể đã gửi → KHÔNG rõ
      extSendCtl.lastOutcomeOk = false;
      noteExtSendOutcome('timeout', extSendPermit, extSendStartedAt ? Date.now() - extSendStartedAt : null);
      extTimeoutStats.timeout++;
      if (!ownLock) scheduleExtTimeoutVerify(conv, text, photo, extSendStartedAt);
      return { ok: false, sent: 'maybe', error: 'Extension không phản hồi' };
    } catch (e) {
      if (extSendPermit) {
        noteExtSendOutcome(extSendStartedAt ? 'timeout' : 'other', extSendPermit, extSendStartedAt ? Date.now() - extSendStartedAt : null);
        if (extSendStartedAt) {
          extTimeoutStats.timeout++;
          if (!ctx.ownsOutbound) scheduleExtTimeoutVerify(conv, text, photo, extSendStartedAt);
        }
      }
      return { ok: false, sent: 'maybe', error: 'Extension lỗi: ' + (e && e.message || e) };
    }
  }

  /* ============================ ẢNH KÈM THEO ============================ */
  // Đúng chuỗi app dùng khi gửi ảnh (đã xác minh từ bundle):
  //  1) POST /v1/contents?access_token=… (field "file")            → { content_url }  (như app upload avatar)
  //  2) POST /v1/pages/{p}/contents/facebook?is_reusable=true&async=false
  //       body urls=["content_url"]                                → { fb_ids }       (attachment Facebook)
  //  3) Gửi: API (attachment_id + content_url) hoặc Extension
  //       (REPLY_INBOX_PHOTO, attachmentType:"PHOTO", files:[fbId], photoUrl(s))

  async function uploadContentFile(file) {
    const token = getToken();
    if (!token) return { ok: false, error: 'Không có access token' };
    try {
      const fd = new FormData();
      fd.append('file', file, file.name || 'image.jpg');
      fd.append('name', file.name || ('image_' + Date.now() + '.jpg'));
      const res = await fetch(apiBase() + '/v1/contents?access_token=' + encodeURIComponent(token), {
        method: 'POST', body: fd, credentials: 'include', headers: { Accept: 'application/json' },
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.success && (j.content_url || j.url)) {
        return { ok: true, url: j.content_url || j.url, id: j.content_id || j.id || '' };
      }
      return { ok: false, error: (j && (j.message || j.error)) || ('HTTP ' + res.status) };
    } catch (e) {
      return { ok: false, error: 'Lỗi mạng: ' + (e && e.message || e) };
    }
  }

  // Đúng hàm N + E (upload gắn attachment + fallback UPLOAD_INBOX_PHOTO) trong _app (@881600–883500):
  //   1) POST /v1/pages/{p}/contents/facebook?access_token=…&is_reusable={reusable}&async=false
  //      body: content_ids=[contentId] (hoặc urls), thêm conv_id khi có → { fb_ids }
  //      (tự động retry khi gặp HTTP 429 / 5xx hoặc lỗi mạng tạm thời)
  //   2) Nếu API /contents/facebook lỗi và có photo.url + Extension Pancake:
  //      fallback sang adapter.send({ type: "UPLOAD_INBOX_PHOTO", pageId, photoUrl: url + "?random=" + r, name, platform })
  //      → { success: true, data: { fbId } } (khớp 100% hàm E tại @883200 trong _app!)
  /* [v1.92.49] ĐO RIÊNG KHÂU UPLOAD ẢNH — đây là ứng viên số 1 cho 3 406 ms "còn lại" mỗi chat.
   * Mỗi chat ảnh phải POST /contents/facebook (is_reusable=false) để lấy fbId riêng; lô 6 920
   * chat ⇒ 6 920 lệnh phụ nằm TRONG lúc giữ slot main. Trước bản này KHÔNG có một con số nào
   * về khâu đó trong TỔNG HỢP nên mọi kết luận về tốc độ đều là suy đoán. Nay đo đủ để lần sau
   * trả lời được bằng số: upload chiếm bao nhiêu ms/chat, bao nhiêu ca lỗi. */
  const photoUpStats = { n: 0, ms: 0, max: 0, fail: 0 };
  async function uploadPhotoForPage(pageId, photo, opts) {
    const _tUp = Date.now();
    let _up;
    try { _up = await uploadPhotoForPageRaw(pageId, photo, opts); }
    catch (eUp) { _up = { ok: false, error: String((eUp && eUp.message) || eUp) }; }
    try {
      const d = Math.max(0, Date.now() - _tUp);
      photoUpStats.n++; photoUpStats.ms += d;
      if (d > photoUpStats.max) photoUpStats.max = d;
      if (!(_up && _up.ok)) photoUpStats.fail++;
    } catch (eSt) { /* ignore */ }
    return _up;
  }
  async function uploadPhotoForPageRaw(pageId, photo, opts) {
    const o = opts || {};
    const reusable = o.reusable !== false;
    const token = getToken();
    if (!token) return { ok: false, error: 'Không có access token' };
    const body = {};
    // bind MỌI ảnh trong photo.items trong 1 lượt (đúng hàm N trong _app @882612:
    // photos có id → content_ids cả mảng → fb_ids trả về theo đúng thứ tự). Ảnh của câu nhanh
    // Pancake có sẵn content_id nên bind chỉ ~30ms (đo trong guianh1.har) thay vì ~1,47s khi
    // bind bằng urls — server phải kéo/xử lý lại file cho từng chat (đo trong guicau.har).
    const bindItems = normalizePhotoItems(photo);
    if (!bindItems.length) return { ok: false, error: 'Không có ảnh' };
    if (bindItems.every((x) => x.id)) body.content_ids = JSON.stringify(bindItems.map((x) => x.id));
    else body.urls = JSON.stringify(bindItems.map((x) => x.url));
    if (o.convId) body.conv_id = String(o.convId);
    const url = apiBase() + '/v1/pages/' + pageId
      + '/contents/facebook?access_token=' + encodeURIComponent(token)
      + '&is_reusable=' + (reusable ? 'true' : 'false') + '&async=false';
    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetchT(url, {
          method: 'POST', body: JSON.stringify(body), credentials: 'include',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        }, 20000);
        const j = await res.json().catch(() => null);
        if (res.ok && j && j.success && Array.isArray(j.fb_ids) && j.fb_ids.length) {
          return { ok: true, fbId: String(j.fb_ids[0]), fbIds: j.fb_ids.map((x) => String(x)) };
        }
        lastErr = (j && (j.message || j.error)) || ('HTTP ' + res.status);
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          await sleepUntil(Date.now() + retryAfterMs(res, 350 * attempt)); // [v1.92.9]
          continue;
        }
        break;
      } catch (e) {
        lastErr = 'Lỗi mạng: ' + (e && e.message || e);
        if (attempt < 3) { await sleepUntil(Date.now() + 350 * attempt); continue; } // [v1.92.9] ngắt được khi Dừng
      }
    }
    // Fallback sang UPLOAD_INBOX_PHOTO qua Extension Pancake (đúng hàm E tại @883200 trong _app)
    const adapter = window.__ExtensionAdapter__;
    if (adapter && typeof adapter.send === 'function') {
      try {
        const extFbIds = [];
        for (const it of bindItems) {
          if (!it.url) { extFbIds.length = 0; break; }
          const sep = it.url.indexOf('?') > -1 ? '&' : '?';
          const extRes = await extSendLane(() => adapter.send({
            type: 'UPLOAD_INBOX_PHOTO',
            pageId: pageId,
            photoUrl: it.url + sep + 'random=' + Math.random(),
            name: 'image_' + Date.now() + '.jpg',
            platform: detectPlatform(pageId) || 'facebook',
          }, { timeout: 25000 }));
          if (extRes && extRes.success && extRes.data && extRes.data.fbId) extFbIds.push(String(extRes.data.fbId));
          else { extFbIds.length = 0; break; }
        }
        if (extFbIds.length && extFbIds.length === bindItems.length) {
          return { ok: true, fbId: extFbIds[0], fbIds: extFbIds };
        }
      } catch (e2) { /* ignore */ }
    }
    return { ok: false, error: lastErr || 'Upload ảnh thất bại' };
  }

  /* ============================ CÂU NHANH PANCAKE + BẮT CÂU Alt+Q ============================ */
  // Bằng chứng đã xác minh:
  //  • _app @341733: app tự nạp câu nhanh bằng GET /v1/pages/{page}/settings?access_token=…
  //    &load_quick_replies_only=true&client_version={version} — client_version cũ hơn bản cache
  //    thì server trả đủ quick_replies.data.quick_replies.
  //  • _app @845300: app gắn window.__quickReplyCacheManager__ với .all(pageId) →
  //    { success, records } — chính là dữ liệu đứng sau ô gợi ý "/" trong khung chat.
  //  • _app @1649663 (normalizeQuickReply): 1 câu nhanh = { shortcut, messages:[{ message, photos }] },
  //    photos là content của Pancake có sẵn id/url/image_data — bind fbId bằng content_ids chỉ
  //    ~30ms (guianh1.har) thay vì ~1,47s khi bind bằng urls (guicau.har).
  function normalizeQuickReply(rec, idx) {
    // Câu nhanh có thể gồm NHIỀU ĐOẠN theo thứ tự (rec.messages[] — vd: đoạn 1 là ảnh,
    // đoạn 2 là 1 câu, đoạn 3 là 1 câu khác). Giữ NGUYÊN từng đoạn trong `parts` để gửi
    // lần lượt đúng thứ tự như gửi tay; `text`/`items` là bản gộp (hiển thị + tương thích).
    const toItems = (photos) => (Array.isArray(photos) ? photos : []).filter(Boolean).map((ph) => ({
      id: ph.id || '',
      url: ph.url || '',
      w: (ph.image_data && ph.image_data.width) || ph.width || ph.w || 0,
      h: (ph.image_data && ph.image_data.height) || ph.height || ph.h || 0,
    })).filter((x) => x.id || x.url);
    const rawMsgs = (rec && Array.isArray(rec.messages) && rec.messages.length) ? rec.messages : [rec || {}];
    const parts = rawMsgs.map((m) => ({
      text: String((m && (m.message != null ? m.message : m.text)) || ''),
      items: toItems(m && m.photos),
    })).filter((pt) => pt.text || pt.items.length);
    const shortcut = (rec && (rec.shortcut || rec.name)) || ('câu ' + ((idx || 0) + 1));
    return {
      shortcut: String(shortcut),
      text: parts.map((pt) => pt.text).filter(Boolean).join('\n'),
      items: parts.reduce((a, pt) => a.concat(pt.items), []),
      parts: parts.length ? parts : [{ text: '', items: [] }],
    };
  }

  async function fetchQuickRepliesForPage(pageId) {
    const pid = String(pageId || '');
    if (!pid) return [];
    // 1) Cache câu nhanh chính chủ của app (dữ liệu app đã tải cho ô gõ "/")
    try {
      const mgr = window.__quickReplyCacheManager__;
      if (mgr && typeof mgr.all === 'function') {
        const r = await Promise.race([mgr.all(pid), sleep(4000).then(() => null)]);
        if (r && r.success && Array.isArray(r.records) && r.records.length) return r.records;
      }
    } catch (e) { /* xuống cách 2 */ }
    // 2) Đúng endpoint settings app tự dựng — client_version=0 để server trả đủ dữ liệu
    try {
      const token = getToken();
      if (!token) return [];
      const res = await fetch(apiBase() + '/v1/pages/' + pid + '/settings?access_token=' + encodeURIComponent(token) + '&load_quick_replies_only=true&client_version=0', {
        headers: { Accept: 'application/json' }, credentials: 'include',
      });
      const j = await res.json().catch(() => null);
      const list = j && j.quick_replies && j.quick_replies.data && j.quick_replies.data.quick_replies;
      if (Array.isArray(list) && list.length) return list;
      // server báo data_up_to_date → dữ liệu nằm trong cache của app, đọc lại cách 1
      const mgr2 = window.__quickReplyCacheManager__;
      if (mgr2 && typeof mgr2.all === 'function') {
        const r2 = await mgr2.all(pid).catch(() => null);
        if (r2 && r2.success && Array.isArray(r2.records)) return r2.records;
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  // Khi người dùng chọn ảnh bằng click trên giao diện (imgState.url, chưa có content_id),
  // tự động đối chiếu URL ảnh với Câu nhanh (Quick Replies) và Kho nội dung (/contents) của page
  // để lấy content_id. Có content_id thì POST /contents/facebook chỉ mất ~25ms thay vì ~1,47s qua urls!
  async function resolveContentIdForPageUrl(pageId, rawUrl) {
    if (!pageId || !rawUrl) return '';
    const keyOf = (u) => String(u || '').split('?')[0].replace(/_thumb(\.[a-z0-9]+)$/i, '$1').split('/').pop().toLowerCase();
    const cleanOf = (u) => String(u || '').split('?')[0].replace(/_thumb(\.[a-z0-9]+)$/i, '$1');
    const targetKey = keyOf(rawUrl);
    const targetClean = cleanOf(rawUrl);
    if (!targetKey) return '';
    try {
      const recs = await fetchQuickRepliesForPage(pageId);
      for (let i = 0; i < (recs || []).length; i++) {
        const q = normalizeQuickReply(recs[i], i);
        const items = (q && q.items) || [];
        for (let j = 0; j < items.length; j++) {
          const it = items[j];
          if (it && it.id && (cleanOf(it.url) === targetClean || keyOf(it.url) === targetKey)) {
            return String(it.id);
          }
        }
      }
    } catch (e) { /* ignore */ }
    try {
      const token = getToken();
      if (token) {
        const res = await fetchT(apiBase() + '/v1/pages/' + pageId + '/contents?page_number=1&access_token=' + encodeURIComponent(token), {
          headers: { Accept: 'application/json' }, credentials: 'include',
        }, 5000);
        const j = await res.json().catch(() => null);
        const arr = (j && (Array.isArray(j.data) ? j.data : (j.data && Array.isArray(j.data.data) ? j.data.data : null))) || [];
        for (let i = 0; i < arr.length; i++) {
          const it = arr[i];
          const u = (it && (it.url || (it.image_data && it.image_data.url))) || '';
          if (it && it.id && u && (cleanOf(u) === targetClean || keyOf(u) === targetKey)) {
            return String(it.id);
          }
        }
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function currentPanelPageId() {
    const m = String(location.pathname || '').match(/\/(\d{6,})(?:\/|$)/);
    if (m) return m[1];
    const first = (state.matches && state.matches[0]) || null;
    if (first) return first.pageId || String(first.id || '').split('_')[0];
    return '';
  }

  // ---- SAU KHI GỬI THÀNH CÔNG — 3 request app LUÔN gọi (HAR tinnhan1.har + file "post"):
  // fill_admin_name (ghép tên nhân viên vào chat — per conversation, điều tiết qua sideEffectLane),
  // check_inbox + contents/touch (per page, chốt 1 lần cuối lô). Bắn nền KHÔNG chờ!
  function postSendSideEffects(conv, opts) {
    const o = opts || {};
    try {
      const pageId = (conv && (conv.pageId || conv.page_id)) || String((conv && conv.id) || '').split('_')[0];
      const cid = conv && conv.id;
      if (!pageId) return;
      if (cid && o.perConv !== false) {
        sideEffectLane(() => fetch(apiBase() + '/v1/pages/' + pageId + '/conversations/' + encodeURIComponent(cid)
          + '/messages/fill_admin_name?', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ timestamp: Date.now(), need_remove_lock_crawl_fb_messages: false }),
        }).catch(() => null));
      }
      if (o.perPage) {
        fetch(apiBase() + '/v1/pages/' + pageId + '/check_inbox?', {
          method: 'POST', headers: { Accept: 'application/json' }, credentials: 'include',
        }).catch(() => null);
        fetch(apiBase() + '/v1/pages/' + pageId + '/contents/touch?', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ content_ids: [] }),
        }).catch(() => null);
      }
    } catch (e) { /* việc phụ — không được làm hỏng lô gửi */ }
  }

  // ===== HỆ THỐNG PHÂN LUỒNG ĐA TẦNG (SMART DUAL-ENGINE & CONCURRENCY LANES CHO 30.000 MESS) =====
  //  • apiSendLane (48 luồng): điều tiết POST /messages của fireApiAndWatch (~300 tin/s).
  //  • ctxFetchLane (thích ứng 32, dải 8–64): điều tiết GET /messages của ensureConvCtx.
  //  • photoUploadLane (96 luồng): điều tiết POST /contents/facebook (reusable=false) riêng cho từng chat.
  //  • gidExtLane (thích ứng 8, dải 3–16): điều tiết GET_GLOBAL_ID_FOR_CONV khi HTTP/WS chưa có global_id.
  //  • extPrepLane (160 luồng): chuẩn bị chung cho các chat CHƯA có sẵn global_id trong RAM.
  //  • extSendLane (thích ứng 6, dải 6–16): bắn REPLY_INBOX_PHOTO qua Extension khi đã cầm đủ payload.
  //    Tự tăng khi Extension trả nhanh/rõ liên tục, tự giảm khi timeout (AIMD trong noteExtSendOutcome);
  //    bộ ngắt quá tải 3-timeout vẫn giữ nguyên vai trò bảo vệ phía trên lane này.
  //  • getPageSocketLane (khởi điểm 64, thích ứng 32–96/page): điều tiết số frame /ls_req in-flight
  //    trên từng kết nối WebSocket theo độ trễ ACK (giữ tốc độ cao mà tự lùi khi có dấu hiệu nghẽn).
  //  • sideEffectLane (4 luồng): điều tiết các request phụ nền (fill_admin_name, update_global_id).
  // 🔥 [FIX-TỐC-ĐỘ] API song song 96 — chat trong 24h bắn API không chờ → 96 / 0,4s = 240 tin/s.
  const API_SEND_PARALLEL = 96;
  // Khâu dò globalId dùng LANE THÍCH ỨNG thay cho mức cố định: HAR cho thấy GET
  // /messages khỏe chỉ ~40–250ms, nhưng bắn cố định 128 luồng ở lô 5.000 làm
  // Pancake/Chrome dội 429 + timeout dây chuyền. Lane tự tăng khi phản hồi nhanh,
  // tự giảm + nghỉ chung khi 429/chậm — giữ thông lượng thật cao nhất mà server chịu được.
  // [v1.91.75] Ở lô 10k, khâu DÒ global_id là nút cổ chai: mỗi chat chưa có gid phải đi
  // HTTP GET /messages rồi tới Ext finder, trong khi làn gửi đã 64–192. Trước đây làn dò
  // chỉ 32 (HTTP) và 12 (Ext) ⇒ đói làn ⇒ resolveGlobalId trả null ⇒ gidUnknown dồn sang
  // Pass 2 (đúng triệu chứng "mất globalid" người dùng thấy). Nâng mức KHỞI ĐIỂM (không
  // nâng trần) để vẫn giữ khả năng tự lùi của makeAdaptiveLane khi server bắt đầu chậm/429.
  const CTX_FETCH_INITIAL = 48;
  const CTX_FETCH_MIN = 8;
  const CTX_FETCH_MAX = 96;
  const PHOTO_UPLOAD_PARALLEL = 96;
  // Ext finder là đường ĐẮT nhất (đi qua Extension) nhưng cũng là đường duy nhất biết
  // {threadId → globalId} khi HTTP/WS không có. 12 → 20 làn khởi điểm, trần 24 → 32.
  const GID_EXT_INITIAL = 20;
  const GID_EXT_MIN = 4;
  const GID_EXT_MAX = 32;
  const PREP_PARALLEL_EXT = 160;  // số chat chưa có global_id chuẩn bị HTTP/WS song song (không bị chặn bởi gidExtLane)
  // 🔥 [FIX-TỐC-ĐỘ] Ext gửi 48 khởi điểm, adaptive tới 64 — đủ cho ~1000 chat ngoài 24h trong 30s.
  // [v1.91.97] NÂNG THẲNG LÀN EXT (theo yêu cầu, dựa trên số đo):
  //   Log 09:15:37–09:15:42 = hơn 100 tin ✅ trong 5s ở 24 làn ⇒ ~20–25 tin/s, tức ~1s/lệnh.
  //   Làn tự hạ về sàn 24 vì bão timeout rồi nằm nguyên đó ⇒ không bao giờ chạm 48.
  //   Nay: khởi động 64, SÀN 48 (không tụt xuống 24 nữa), trần 96.
  // [v1.92.45] SỬA CON SỐ ƯỚC LƯỢNG SAI Ở ĐÂY. Dòng cũ ghi "48 làn ≈ 40–50 tin/s, 64 làn ≈
  //   55–65 tin/s" — đo trên network-log.har (90 lệnh thật của extension Pancake v2 trong lúc
  //   tool chạy) thì TRẦN THẬT của làn Ext là ~13,4 lệnh/s (90 lệnh / 6,74 s), đỉnh in-flight
  //   chỉ 42/48 — tức làn CHƯA BAO GIỜ là nút cổ chai, chính Extension tự tuần tự hoá. Nâng
  //   sàn/trần làn không làm lô nhanh hơn; cái làm lô chậm là ĐUÔI CHỜ XÁC NHẬN và các ca
  //   chắc chắn không gửi được mà vẫn bị bắt chờ 10 s (đã sửa ở 1.92.45).
  //   Làn vẫn tự hạ khi lỗi, nhưng không bao giờ thấp hơn 48.
  const BUS_PARALLEL_EXT = 64;
  const EXT_SEND_MIN = 48;
  const EXT_SEND_MAX = 96;
  // 🔥 [FIX-TỐC-ĐỘ] Socket/page 128 khởi điểm, đủ cho pace 4ms × 2 page = 500/s mà không chờ slot.
  // [v1.92.1] Socket đã được đo lại trên chat khoẻ (lô 09:34, 1 432 chat, 1.92.0):
  //   📡 SOCKET ACK OK/rejected 917/493 · ACK TB 1 199ms · phát 1 432 lệnh trong 24s (= 60 tin/s)
  //   peak Socket/page active 192/192 · waiting 192/192  ⇒ LÀN SOCKET ĐÃ BÃO HOÀ ở 192.
  // Với ACK TB 1,2s thì trần của 192 làn là ~160 tin/s ⇒ đây là nút cổ chốt DUY NHẤT còn lại
  // (Extension không còn tham gia đường chính). Nâng: khởi điểm 256, trần 384.
  const BUS_PARALLEL_SOCKET = 256;
  const SOCKET_LANE_MIN = 64;
  /* [v1.92.49] TRẦN LÀN 384 → 256 — TRẢ VỀ ĐÚNG MỨC ĐÃ KIỂM NGHIỆM.
   * Số đo 2 lô 10 629 / 6 920 chat (cùng máy, cùng page):
   *     làn 256 ⇒ 44,0 lệnh/s · làn 312–320 ⇒ 37,7 · làn 384 ⇒ 33,6
   * Tương quan ÂM: nới làn làm CHẬM. Lô 11:05 nới 256→384 lúc 11:05:37 (16 nấc, mỗi nấc +8
   * khi đủ 20 ACK nhanh) rồi KHÔNG hạ lại trong suốt lô, dù p95 lên 2 618 ms.
   * Đoạn clamp đầu lô (LANE_CARRY_CLAMP) vốn đã hạ làn về 256 mỗi lần chạy — chỉ có điều
   * trong lô nó lại leo lên 384. Nay trần = 256 ⇒ chặn đúng đường leo đó. Sàn vẫn do
   * socketLaneFloor quản (64, tự hạ tiếp khi ACK chết). Muốn thử lại 384: đổi số này. */
  const SOCKET_LANE_MAX = 256;
  /* [v1.92.34] CẦU DAO ACK CHƯA BAO GIỜ CÓ TÁC DỤNG — tìm ra ở lô 13:38 (4 573 chat).
   * `makeAdaptivePriorityLane` kẹp `limit = Math.max(min, …)` với `min` CHỤP LÚC TẠO LANE
   * (= socketLaneFloor = 64). Mà lane page được tạo ở tin đầu tiên của page ⇒ mọi lần cầu dao
   * hạ sàn 64→32→16 sau đó đều bị `setLimit` kẹp NGƯỢC LÊN 64: đúng 55 dòng "🐢 … xuống 64"
   * trong log là no-op, làn nằm nguyên 64, và pha cuối lô chạy 8,2 chat/s.
   * Nay `min` là hằng 16; sàn THẬT vẫn do `socketLaneFloor` quản (mọi chỗ setLimit đều
   * `Math.max(socketLaneFloor, …)`) ⇒ cầu dao co được, còn khi khoẻ thì lane vẫn leo tới 384. */
  const SOCKET_LANE_HARD_FLOOR = 16;
  // [v1.91.84] SÀN cap Socket/page CHỈNH ĐƯỢC LÚC CHẠY — không cần build lại.
  // Bối cảnh: bộ điều tốc tự hạ 192 → 64 (0,8× mỗi lần) khi ACK chậm; log lô 10 660 tin cho
  // thấy cap cuối [64×1] trong khi trần lý thuyết (192 ÷ 3,43 s) là 56 tin/s ⇒ bị chặn dưới
  // khả năng. Nay người dùng tự đặt sàn để tìm điểm ngọt trên máy mình:
  //     __botfakeSetSockPageFloor__(128)      // trong Console của trang Pancake
  // hoặc đặt localStorage 'botfake_sock_page_floor' = 128. Đặt lại 64 để về mặc định.
  let socketLaneFloor = SOCKET_LANE_MIN;
  let socketFloorUserSet = false; // sàn do NGƯỜI DÙNG đặt thì không tự nâng lại
  try {
    const _f = parseInt(localStorage.getItem('botfake_sock_page_floor') || '', 10);
    if (_f >= 16 && _f <= SOCKET_LANE_MAX) { socketLaneFloor = _f; socketFloorUserSet = true; }
  } catch (e0) { /* ignore */ }
  try {
    window.__botfakeSetSockPageFloor__ = function (v) {
      const n = parseInt(v, 10);
      if (!(n >= 16 && n <= SOCKET_LANE_MAX)) return 'giá trị phải trong khoảng 16–' + SOCKET_LANE_MAX;
      socketLaneFloor = n;
      socketFloorUserSet = true;
      try { localStorage.setItem('botfake_sock_page_floor', String(n)); } catch (e1) { /* ignore */ }
      return 'đã đặt sàn Socket/page = ' + n + ' — áp dụng cho lượt gửi kế tiếp (tải lại trang nếu đang chạy)';
    };
  } catch (e2) { /* ignore */ }
  // [v1.92.1] (SOCKET_LANE_MAX đã chuyển lên trên — khai báo ở đây thì khối đọc
  // localStorage 'botfake_sock_page_floor' ở trên bị TDZ và ném lỗi bị nuốt im lặng.)
  const SOCKET_LANE_SLOW_ACK_BACKOFF_THRESHOLD = 4; // thử nghiệm: tránh hạ lane vì chỉ 2 ACK đuôi chậm lẻ tẻ
  const SOCKET_LANE_NOACK_BACKOFF_THRESHOLD = 2; // no-ACK giữ ngưỡng chặt hơn vì thường báo hiệu Socket/page có vấn đề
  // [v1.91.85] CẦU DAO ACK TOÀN CỤC.
  // Lô thật 19:03 (11/11): từ tin ~1082 trở đi MỌI tin qua Socket đều "không có ACK" liên tục,
  // rồi dồn hết sang Extension bù ⇒ gửi rất chậm. Đó là Pancake bóp ACK khi có quá nhiều
  // kết nối socket cùng lúc, không phải lỗi từng chat. Bộ điều tiết cũ chỉ co được xuống
  // sàn mặc định 64/page nên vẫn quá cao ⇒ ACK càng mất. Nay: mất ACK LIÊN TỤC 25 tin thì
  // hạ hẳn sàn (64→32→16) để lane co xuống thật sâu và ACK có cơ hội hồi lại.
  let sockNoAckRun = 0;
  const SOCK_ACK_STORM_RUN = 25;
  /* [v1.92.48] SÀN LÀN TỐI THIỂU LÚC CHẠY: 32 → 96.
   * Lô 10:01 sập sàn xuống 32 (09:57:21) rồi 32 → 40 và ghim ở [56×1] tới hết lô.
   * 32 làn là 1/8 cấu hình 256; đo theo wave: làn 32–40 = 20,8 chat/s, làn 256 = 44,0 chat/s.
   * Sàn 32 chỉ có nghĩa khi kênh ACK CHẾT THẬT (lúc đó đi Extension chứ không phải Socket),
   * mà từ 1.92.48 "chết" đòi bằng chứng (xem noteSocketPageLaneOutcome) ⇒ hạ sâu không còn
   * lý do. Sàn cứng của bộ điều tiết vẫn là SOCKET_LANE_HARD_FLOOR = 16 (không đổi). */
  const SOCKET_LANE_RUNTIME_FLOOR = 96;
  // [v1.91.86] KÊNH ACK CHẾT THEO PAGE.
  // Bằng chứng lô 20:36–20:38 (11/11): các lô 5–10 chat, mỗi lô chỉ 1 tin đi Socket và
  // tin đó LUÔN mất ACK với độ trễ đúng bằng hạn chờ (8000/8002/8003 ms; lô 68 tin: 20016 ms).
  // Trễ đúng bằng timeout = KHÔNG có phản hồi nào, tức kênh ACK của page đã chết — không phải
  // server chậm. Hậu quả: mỗi tin như vậy tốn 8–20s chờ + 4 lần đọc kiểm chứng + Ext ⇒ lô 5 tin
  // mất 13s. Nay: 2 lần no-ACK đủ hạn chờ ⇒ đánh dấu kênh ACK chết, bỏ Socket khỏi thứ tự làn
  // (đi thẳng Extension ~1s). Chỉ đổi THỨ TỰ kênh, không gửi thêm, không gửi lặp.
  // [v1.91.87] ĐO ĐỘ TRỄ ACK THẬT ĐỂ BỎ "CHỜ CỨNG".
  // Hạn chờ cũ là hằng số 8000/20000ms do script tự đặt, không phải Pancake bắt chờ.
  // Nay hạn chờ bám theo p90 độ trễ ACK quan sát được: wait = clamp(3 × p90, 2500, mức cũ).
  /* ===== [v1.92.48] CỬA SỔ NGHE ACK — THÔI TỰ CẮT ACK CỦA CHÍNH MÌNH =====
   * Số đo lô 10:01 (10 629 chat, 1.92.47): ACK OK/rejected/no-ACK 5 629/1 186/101 ·
   * bucket <250/250-999/1-2s/2-5s/≥5s = 0/5/3 081/3 389/340 · max 7 988 ms.
   *   ⇒ p90 THẬT của cả lô ≈ 4 700 ms (tính từ phân bố), trong khi dòng log in
   *     "ACK p50/p90 1739/2484ms" — vì vòng mẫu chỉ giữ **200 mẫu ≈ 5 giây cuối lô**
   *     ⇒ ngưỡng và trần chờ bị chỉnh theo ĐUÔI lô chứ không theo cả lô.
   *   ⇒ trần cứng 6 000 ms < max 7 988 ms ⇒ 340 ca ≥5 s bị cắt NGAY TRONG KHI FB vẫn trả lời.
   * Bằng chứng HAR (3 HAR có `_webSocketMessages`, ghép request_id):
   *   batmesss 8/8 · guisot 20/20 · guikhachcu 2/2 frame gửi (type 3) có /ls_resp
   *   ⇒ **30/30 lệnh gửi đều được FB trả lời**, p50 234/326/474 ms, max 1 531 ms.
   *   2 frame không khớp đều là `type: 2` (đồng bộ init), không phải lệnh gửi.
   * ⇒ "no-ACK" ở lô lớn KHÔNG phải FB mất ACK — đó là script tự xoá chỗ nhận
   *   (`delete helper.PENDING_MESSAGES[myKey]` khi hết hạn chờ) rồi gói về sau không còn
   *   callback để giao ⇒ classify() nhận payload=null ⇒ ⚠ oan ⇒ kiểm chứng ⇒ bắn cứu 1 lần
   *   qua Extension (101 ca ở lô trên) = đúng đường sinh tin trùng.
   * NAY: tách làm HAI cửa sổ — và CHỈ cửa sổ thứ hai đổi.
   *   • HOLD (ackWaitMs) = thời gian GIỮ SLOT = clamp(p90×3, 1 200, 6 000) **y như 1.92.47**.
   *     Giữ nguyên vì đây là MẪU SỐ CỦA TỐC ĐỘ: tốc độ = làn ÷ E[giữ]. Đo từ chính lô 10:01
   *     (bucket 0/5/3 081/3 389/340, lấy trung bình trong bucket) ⇒ E[giữ] 2,62 s.
   *     Nới hạn chờ (đã cân nhắc và BỎ): 8 000 ms ⇒ E[giữ] 2,72 s ⇒ trần 94 tin/s ở làn 256;
   *     12 000 ms ⇒ 2,88 s ⇒ 89 tin/s; 30 000 ms ⇒ 3,15 s ⇒ 81 tin/s. Mọi phương án đều ≫
   *     tốc độ thật của pha khoẻ (46,6 chat/s) nhưng vẫn là ĐÁNH ĐỔI, mà đánh đổi đó KHÔNG
   *     cần thiết: chỗ nhận ACK không phụ thuộc thời gian giữ slot.
   *   • LISTEN (giữ entry PENDING) = max(12 000, HOLD + 6 000), trần 30 000 ms = đúng trần
   *     tự xoá của chính app (`_app` @815747 `let b=3e4`; @819154 `setTimeout(… , b)`).
   *     Hết HOLD mà ACK chưa về ⇒ vẫn đánh ⚠ **và vẫn nhả slot như cũ** (tốc độ không đổi)
   *     NHƯNG **không xoá chỗ nhận** ⇒ gói về muộn được phân xử thật (✅/❌) qua đường CHỈ ĐỌC.
   * Đây là đường ĐỌC, không thêm một lệnh gửi nào ⇒ không thể sinh tin trùng. */
  const ACK_HOLD_MIN_MS = 1200;     // sàn hạn chờ GIỮ SLOT (giữ nguyên như 1.92.47)
  /* [v1.92.63] ĐÃ THỬ NỚI TRẦN NÀY 6 000 → 9 000 VÀ ĐÃ HOÀN NGUYÊN — bằng chứng phủ định.
   * Giả thuyết ban đầu: log 20:41 in `ACK p50/p90 4725/5544ms` + `giữ slot 6000ms` ⇒ cổng
   * 6 000 quá sát p90 nên ACK về muộn bị coi là no-ACK oan. ĐỌC KỸ CÙNG FILE thì sai:
   *   • 📡 SOCKET: `ACK OK/rejected/no-ACK 0/0/5` · `buckets 0/0/0/0/0` · `ACK TB/max 0/0ms`
   *   • 🔔: `hết hạn chờ 5` · `im lặng THẬT 0` · `ACK về MUỘN đã phân xử 0`
   * ⇒ KHÔNG có ACK nào về trễ. Cả 5 ca KHÔNG có gói /ls_resp nào trong suốt 12 s nghe.
   *   `p50/p90 4725/5544` KHÔNG phải ACK của 5 lệnh này (buckets rỗng chứng minh).
   * ĐỐI CHIẾU 3 LÔ LỚN để chắc chắn (đây là số quyết định):
   *   lô        | no-ACK | phân xử muộn | CỨU được ✅ | bucket ≥5s (ACK về ĐÚNG hạn)
   *   14:03     |  1 246 |        1 238 |          0 | 3 772
   *   19:00:48  |    886 |          885 |          0 |   428
   *   19:00:54  |    941 |          941 |          0 |   446
   * Ba lô, ~3 000 ca no-ACK: **cứu được 0 ca**. Trong khi đó hàng nghìn ACK ≥5 s VẪN về
   * đúng hạn (bucket ≥5s) ⇒ cổng 6 000 KHÔNG hề cắt ACK. Các ca no-ACK là IM LẶNG THẬT của
   * Socket, nới cổng chỉ giữ slot lâu hơn mà không đổi kết quả một ca nào.
   * Sửa trần thành 9 000 khi p90 ≥ 3 000 chỉ làm lô chậm thêm mà không cứu được ca nào ⇒
   * giữ nguyên 6 000 (đúng 1.92.47) và ghi lại đây để không ai "nới" lần nữa mà không có log
   * chứng minh (`buckets ≥5s > 0` hoặc `ACK về MUỘN đã phân xử > 0`). */
  const ACK_HOLD_CEIL_MS = 6000;    // trần hạn chờ GIỮ SLOT (giữ nguyên như 1.92.47)
  const ACK_LISTEN_MAX_MS = 30000;  // = trần tự xoá của app (b=3e4) — nghe tới đây rồi thôi
  const ACK_LAT_RING_N = 1000;      // [v1.92.48] 200 → 1 000 mẫu: 200 mẫu ≈ 5 s cuối lô
  const ackLatRing = [];            // N mẫu ACK gần nhất (ms) — PHẢI đủ dài để phủ cả lô
  /* ═══ [v1.92.66] PHÂN VỊ ACK ĐỌC O(1) — BỎ `slice().sort()` MỖI LẦN ĐỌC ═══
   * `latencyPct()` sắp xếp lại TOÀN BỘ 1 000 mẫu ở MỖI lần gọi, mà nó được gọi ở:
   *   • `ackHoldMsFor(sockAckP90())` — ĐÚNG MỘT LẦN MỖI TIN GỬI (dòng ~4686);
   *   • `rampAllowed()` (p95) mỗi 20 ACK · `fastAckMs()` (p50) mỗi ca 'ok';
   *   • vài dòng log cuối lô.
   * Đo trên máy này: 15 336 lần × sort 1 000 số = **3 366 ms CPU thuần** cho một lượt 15k,
   * cộng ~15 ms GC mỗi lần (mỗi lần tạo một mảng 1 000 phần tử mới) — đúng lúc 192 worker
   * đang bận. Nay giữ thêm MỘT BẢN ĐÃ SẮP XẾP, chèn bằng tìm kiếm nhị phân:
   *   • thêm mẫu  = O(log n) tìm chỗ + O(n) memmove 1 000 số (~1–3 µs, rẻ hơn sort 200×);
   *   • đọc p50/90/95 = O(1) — chỉ index vào mảng;
   *   • KẾT QUẢ CHÍNH XÁC TUYỆT ĐỐI, giống hệt `latencyPct()` trên cùng cửa sổ mẫu.
   * (Đã cân nhắc histogram cho O(1) tuyệt đối, nhưng mọi histogram đủ rộng đều làm mất độ
   * phân giải đúng vùng 1 000–5 000 ms — vùng quyết định ACK_HOLD_CEIL_MS 6 000. Không đánh
   * đổi độ chính xác của hạn chờ giữ slot để tiết kiệm ~2 µs.)
   * `ackLatRing` GIỮ NGUYÊN (vẫn push/shift y như cũ) vì log 📡 in `ackLatRing.length` mẫu và
   * công cụ kiểm đọc trực tiếp — chỉ phần TÍNH PHÂN VỊ đổi đường. */
  const ackLatSorted = [];          // cửa sổ 1 000 mẫu, LUÔN tăng dần
  let ackLatPctCache = null;        // { p50, p90, p95 } — xoá mỗi khi có mẫu mới
  function ackLatSortedInsert(v) {
    let lo = 0, hi = ackLatSorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ackLatSorted[mid] <= v) lo = mid + 1; else hi = mid;
    }
    ackLatSorted.splice(lo, 0, v);
  }
  /** Xoá MỘT phần tử bằng đúng giá trị v (mẫu cũ nhất vừa rời ring) — O(log n + n).
   *  [v1.92.66] KHÔNG được `shift()` mảng đã sắp xếp: shift bỏ phần tử NHỎ NHẤT, còn cửa sổ
   *  trượt phải bỏ phần tử CŨ NHẤT. Bản nháp đầu làm sai chỗ này và đo được p90 lệch hẳn
   *  (3 003 → 5 378 ms) — tức hạn chờ giữ slot sẽ bị đẩy lên trần 6 000 sai. */
  function ackLatSortedRemove(v) {
    let lo = 0, hi = ackLatSorted.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const x = ackLatSorted[mid];
      if (x < v) lo = mid + 1;
      else if (x > v) hi = mid - 1;
      else { ackLatSorted.splice(mid, 1); return; }
    }
  }
  function noteAckLatency(ms) {
    const v = Math.round(Number(ms) || 0);
    if (v <= 0) return;
    ackLatRing.push(v);
    ackLatSortedInsert(v);
    if (ackLatRing.length > ACK_LAT_RING_N) {
      const old = ackLatRing.shift();
      ackLatSortedRemove(old);
    }
    ackLatPctCache = null;
  }
  /** Phân vị của cửa sổ mẫu — O(1). pct = 0…1 */
  function latencyPctFromSorted(pct) {
    const n = ackLatSorted.length;
    if (!n) return 0;
    const i = Math.min(n - 1, Math.max(0, Math.floor(n * pct)));
    return ackLatSorted[i];
  }
  function ackPctCached() {
    if (ackLatPctCache) return ackLatPctCache;
    ackLatPctCache = { p50: latencyPctFromSorted(0.5), p90: latencyPctFromSorted(0.9), p95: latencyPctFromSorted(0.95) };
    return ackLatPctCache;
  }
  /** Phân vị của mảng ĐO ĐƯỢC (không sắp xếp mảng gốc). pct = 0…1
   *  [v1.92.66] GIỮ LẠI cho công cụ kiểm/bench — đường chạy thật dùng latencyPctFromSorted(). */
  function latencyPct(arr, pct) {
    const a = (arr || []).slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    const i = Math.min(a.length - 1, Math.max(0, Math.floor(a.length * pct)));
    return a[i];
  }
  /** Hạn chờ GIỮ SLOT theo p90 — GIỐNG HỆT 1.92.47 (clamp(p90×3, 1 200, 6 000)).
   *  Giữ nguyên vì đây là MẪU SỐ CỦA TỐC ĐỘ (lane ÷ hạn chờ giữ slot), không phải công cụ
   *  chống mất ACK. Chống mất ACK là việc của ackListenMsFor() bên dưới.
   *  [v1.92.63] Đã thử nới trần lên 9 000 rồi HOÀN NGUYÊN — xem khối chú thích ở hằng số. */
  function ackHoldMsFor(p90) {
    const v = Math.round(Number(p90) || 0) || 3000;
    return Math.max(ACK_HOLD_MIN_MS, Math.min(ACK_HOLD_CEIL_MS, Math.round(v * 3)));
  }
  function sockAckP90() {
    if (ackLatRing.length < 20) return 3000; // chưa đủ mẫu ⇒ 3s (≈2× ACK TB đã đo)
    return ackPctCached().p90;
  }
  function sockAckP95() {
    if (ackLatRing.length < 20) return 0; // chưa đủ mẫu ⇒ chưa dùng ngưỡng thích ứng
    return ackPctCached().p95;
  }
  function sockAckP50() {
    if (ackLatRing.length < 20) return 0; // chưa đủ mẫu ⇒ chưa dùng ngưỡng thích ứng
    return ackPctCached().p50;
  }
  /* [v1.92.16] NGƯỠNG "ACK NHANH" PHẢI BÁM SỐ ĐO, KHÔNG ĐƯỢC LÀ HẰNG 2 500 ms.
   * Lô 19:52 (11 844 chat, 1.92.15): ACK TB 3 163 ms · 9 668/10 688 ACK rơi vào 2–5 s.
   * Với hằng 2 500 ms thì MỌI ACK của page này đều bị coi là "chậm" ⇒ nhánh else chạy
   * `if (kind === 'ok') ctl.fastOk = 0` ⇒ bộ đếm KHÔNG BAO GIỜ đạt 20 ⇒ làn không bao giờ tăng;
   * trong khi 459 no-ACK vẫn cắt làn 0,8× liên tục ⇒ đúng như log: "limits cuối [64×1]"
   * (ghim ở sàn) dù "waiting 251/251". Làn là mẫu số của thông lượng ⇒ phát lệnh chỉ 42,21/s.
   * Nay: "nhanh" = không tệ hơn chính nhịp ACK quen thuộc của page (p50 × 1,2), trong [2 500, 6 000].
   * ACK chậm bất thường (≥6 000 ms) vẫn bị phạt như cũ. */
  function fastAckMs() {
    const p50 = sockAckP50();
    if (!p50) return 2500;
    return Math.max(2500, Math.min(6000, Math.round(p50 * 1.2)));
  }
  /* [v1.92.34] NỚI LANE PHẢI CÓ ĐIỀU KIỆN — lô 13:38 (4 573 chat): 13:38:20→13:38:48 đạt
   * 115 chat/s (✅ 91,5 %) ở lane 256; 13:38:30 nới 256 → 384; 13:38:48 sập: 1 343 chat sau
   * đó 0 ✅, 8,2 chat/s, 102 ca Ext quá hạn. ACK của lô này p50 2 194 ms — vẫn "nhanh" theo
   * ngưỡng cũ (p50×1,2 = 2 633 ms) nên +8 chạy liên tục. Nay chỉ nới khi p50 < 1 800 ms
   * (bằng chứng: 3 230 chat đầu chạy tốt ở 256 làn ≈ 116 chat/s với p50 2,2 s ⇒ 256 là ĐỦ;
   * nới thêm chỉ đổi lấy nguy cơ dồn ACK). Số lần bỏ nới in ở dòng 📡 SOCKET.
   *
   * [v1.92.48] CANH ĐUÔI, KHÔNG CANH TRUNG VỊ — số đo lô 10:01 chứng minh p50 là chỉ báo SAI:
   *   p50 = 1 739 ms (LỌT cổng 1 800) nhưng p95 ≈ 5 000 ms và max 7 988 ms.
   *   Kết quả: làn leo 256 → 296 → 312 → 320 → 384 trong 60 s; rồi 09:57:19 ba ca no-ACK
   *   ⇒ tuyên bố ACK chết ⇒ né Socket 7 665 ca ⇒ lô rơi 46,6 → 20,8 chat/s trong 220 s.
   *   Đo theo wave của chính lô đó (thời gian qua cổng): làn 256 = 44,0 chat/s · 312–320 = 37,7 ·
   *   384 = 33,6 ⇒ nới làn KHÔNG nhanh hơn, chỉ tăng nguy cơ dồn ACK.
   * Nay nới chỉ khi CẢ HAI: p95 ≤ 2 200 ms VÀ 50 lượt ACK gần nhất không có no-ACK nào.
   * (docs §53: làn 384 vẫn TỐT khi p95 thấp — nên đây là điều kiện, không phải trần cứng.) */
  const SOCK_RAMP_P95_MAX_MS = 2200;
  const SOCK_RAMP_QUIET_N = 50;
  let sockRampSkipped = 0;
  let sockRampSkippedTail = 0;
  let sockRampSkippedNoAck = 0;
  const sockRecentOutcome = []; // 'ok' | 'rejected' | 'noack' — cửa sổ ngắn để canh no-ACK gần đây
  function noteRecentOutcome(kind) {
    if (kind !== 'ok' && kind !== 'rejected' && kind !== 'noack') return;
    sockRecentOutcome.push(kind);
    if (sockRecentOutcome.length > SOCK_RAMP_QUIET_N) sockRecentOutcome.shift();
  }
  function sockRecentNoAckCount() {
    let n = 0;
    for (let i = 0; i < sockRecentOutcome.length; i++) if (sockRecentOutcome[i] === 'noack') n++;
    return n;
  }
  function rampAllowed() {
    const p95 = sockAckP95();
    if (p95 && p95 > SOCK_RAMP_P95_MAX_MS) { sockRampSkipped++; sockRampSkippedTail++; return false; }
    const noack = sockRecentNoAckCount();
    if (noack >= 2) { sockRampSkipped++; sockRampSkippedNoAck++; return false; }
    return true;
  }
  // [v1.91.92] CHẾ ĐỘ GỬI TOÀN BỘ QUA HTTP — API trước, Ext dự phòng (KHÔNG dùng Socket).
  // HAR (303 request POST /conversations/{id}/messages): 303/303 có `origin: https://pancake.vn`,
  // 0 request mang origin `chrome-extension://`, không có header x-api-key riêng, và 0 lần có
  // `global_id` trong body ⇒ API (fetch từ trang) và Ext đi ĐÚNG cùng một endpoint; khác biệt
  // duy nhất là cây cầu Extension, và chính nó bị tuần tự hoá (~10–15 tin/giây ở log 08:34).
  // Vì vậy mặc định BẬT: API (96 làn song song) trước, Ext chỉ là dự phòng.
  // HAR 12 file, 303 request `POST /conversations/{id}/messages`: p50 = 37ms · p90 = 999ms ·
  // TB = 283ms — nhanh hơn hẳn Socket+ACK (1 500ms khi khoẻ, 7 400–8 200ms khi kênh ACK chết)
  // và trả kết quả DỨT KHOÁT nên không cần vòng kiểm chứng lịch sử.
  // Bật ⇒ bỏ hẳn làn Socket (nguồn của mọi ca ⚠ "không rõ" và mọi lần chờ ACK).
  let forceExtMode = false;
  // [v1.91.99] TRẢ MẶC ĐỊNH VỀ TẮT. Lý do — bằng chứng từ 6 lô chạy bật (1.91.92→1.91.98):
  //   • Extension chưa bao giờ vượt ~20 tin/s: log 09:24 `peak Ext queue/active 360/128` ⇒
  //     hàng đợi 360, 128 lệnh đang bay, vẫn 12,66 tin/s ⇒ mỗi lệnh chiếm làn ~10s. Bridge
  //     Extension tuần tự hoá BÊN TRONG nó; tăng làn chỉ làm hàng đợi dài thêm.
  //   • Vì chế độ này BẬT, làn Socket bị bỏ hẳn ⇒ 6 lô qua Socket chưa từng được thử trên chat
  //     KHOẺ. Mọi dòng `📡 SOCKET: ACK 0/386` là chat ĐÃ CHẾT (chỉ còn lại sau khi Ext trượt)
  //     — thiên lệch chọn mẫu, không phải Socket yếu. Người dùng nói rõ: tốc độ ban đầu khi đi
  //     Socket là mức họ cần (hàng nghìn tin/phút), mà ~20 tin/s của Ext không thể đạt.
  //   ⇒ [v1.92.0] BỎ HẲN Ô BẬT/TẮT khỏi panel và TẮT VĨNH VIỄN: không còn đường UI nào bật lại,
  //     để một lần bấm nhầm không thể đẩy cả lô về trần ~20 tin/s của Extension. Vẫn giữ
  //     __botfakeForceExt__(true) trong console cho lần đo đối chứng nếu cần.
  forceExtMode = false;
  function setForceExtMode(v) {
    // [v1.92.5] KHÔNG ghi localStorage nữa: ô bật/tắt đã bị xoá khỏi panel và `forceExtMode`
    // được gán cứng = false mỗi lần nạp trang, nên khoá 'ssb_force_ext' ghi ra sẽ không có
    // ai đọc (đã kiểm: ghi=1, đọc=0). Ghi vào đó chỉ tạo cảm giác "đã lưu" trong khi lần nạp
    // sau lại bỏ qua. Hàm này giờ chỉ đổi được trong PHIÊN hiện tại, đúng như nó thực sự làm.
    forceExtMode = !!v;
    try { logLine((forceExtMode ? '🛰 ĐÃ BẬT' : '🛰 ĐÃ TẮT') + ' chế độ gửi toàn bộ qua HTTP (API → Ext)'
      + (forceExtMode ? ' — bỏ hẳn làn Socket (không chờ ACK, không ca ⚠ không rõ).' : ' — quay lại dùng Socket như cũ.')
      + ' · chỉ áp dụng cho PHIÊN này (không lưu qua F5).'); } catch (e) { /* ignore */ }
    return forceExtMode;
  }
  try { window.__botfakeForceExt__ = setForceExtMode; } catch (e) { /* ignore */ }
  const pageLastAckWait = {};   // pageId → hạn chờ vừa dùng cho lần publish gần nhất
  const pageAckTimeoutRun = {}; // pageId → số lần no-ACK đủ hạn chờ liên tiếp
  /* [v1.92.48] "ACK CHẾT" PHẢI CÓ BẰNG CHỨNG, KHÔNG PHẢI 3 LẦN HẾT HẠN CHỜ.
   * Lô 10:01: 09:57:19 ba ca no-ACK liên tiếp ⇒ tuyên bố ACK CHẾT ⇒ né Socket 7 665 ca
   * (log `chọn kênh: Socket bị né (ACK chết) 7665`) ⇒ 220 s ở 20,8 chat/s.
   * Nhưng 84/101 ca no-ACK của lô đó nổ TRONG CÙNG MỘT GIÂY (09:57:21) — chúng không phải
   * kênh chết, chúng là cùng một cú dồn (làn 384 + hạn chờ 3 974 ms < p95 5 000 ms) bị cắt
   * cùng lúc. "3 lần liên tiếp" vì thế bị thoả một cách tầm thường bởi 8 % frame của một giây.
   * Nay mỗi page giữ HAI bộ đếm:
   *   • `pageAckHoldExpired` — hết hạn chờ GIỮ SLOT nhưng ACK có thể còn về trong cửa sổ nghe
   *     30 s ⇒ CHỈ là chỉ báo, KHÔNG BAO GIỜ dùng để tuyên bố chết.
   *   • `pageAckTimeoutRun` — chỉ tăng khi no-ACK là **IM LẶNG THẬT**: cửa sổ nghe (LISTEN,
   *     tới 30 000 ms = đúng trần tự xoá của app) đã hết mà không có gói nào. Đây là bằng
   *     chứng, không phải suy diễn. Ngưỡng 5 lần liên tiếp. */
  const pageAckHoldExpired = {}; // pageId → số ca hết hạn chờ giữ slot (chỉ để in log)
  const pageAckSilentRun = {};   // pageId → số ca IM LẶNG THẬT liên tiếp (bằng chứng)
  const ACK_DEAD_PROOF_RUN = 5;  // [v1.92.48] 5 ca im lặng thật liên tiếp ⇒ mới dám tuyên bố chết
  const pageAckDeadAt = {};     // pageId → thời điểm đánh dấu kênh ACK chết
  // [v1.91.88] Lô 08:19 (11/11): 74 tin đi Socket, ACK OK = 0, no-ACK = 74, cả 74 phải bù Ext.
  // 77 chat được PHÁT trong 779ms ⇒ mọi tin đi trước khi ACK đầu tiên kịp mất, nên trong cùng
  // một wave KHÔNG thể biết trước để né Socket. Giá trị thật của cờ là GIỮ QUA CÁC LÔ: lô sau
  // biết page đã chết ⇒ đi Ext ngay từ tin đầu. Vì vậy nới TTL 2 phút → 10 phút.
  const PAGE_ACK_DEAD_TTL_MS = 600000;
  /* [v1.92.13] CỜ "ACK CHẾT" BỊ BÓP QUÁ LÂU — đo được từ lô 15:54 (9 455 chat, 1.92.12):
   *   📡 SOCKET: ACK OK/rejected/no-ACK 0/0/0 · peak Socket/page active 0/0 · limits [64×1]
   * ⇒ Socket KHÔNG ĐƯỢC THỬ MỘT LẦN NÀO trong cả 342s. Toàn bộ 9 455 chat dồn vào làn Ext
   *   (48 luồng, Ext p90 3 203ms) ⇒ 29,74 tin/s, Ext ngộp: peak queue 468, 633 quá hạn,
   *   1 526 ca bị bỏ qua vì bộ ngắt quá tải.
   * Đường duy nhất xoá 'socket' khỏi MỌI kế hoạch là nhánh isPageAckDead() dưới đây, mà TTL
   * của nó (10 phút) DÀI HƠN cả lượt chạy ⇒ một lần no-ACK ở lượt trước đủ bóp cả lô 9 455
   * chat vào làn chậm nhất. Nay: vẫn né Socket, nhưng cứ SOCK_DEAD_PROBE_MS cho đúng MỘT ca
   * đi Socket để dò; ACK về là cờ được xoá ngay (noteSocketPageLaneOutcome 'ok') ⇒ tự hồi. */
  /* [v1.92.40] ĐỊNH TUYẾN SOCKET THEO BẰNG CHỨNG GIAO HÀNG — thay cho ngưỡng cỡ lô.
   * Vấn đề thật: "no-ACK" chỉ nói ACK không về, KHÔNG nói tin có tới hay không. Bản cũ suy
   * diễn: no-ACK ⇒ coi như kênh chết ⇒ gỡ Socket khỏi kế hoạch 10 phút (và từ 1.92.13 dò lại
   * thưa). Hậu quả hai chiều:
   *   • Dương tính giả: page chỉ mất ACK nhưng tin VẪN tới (đã gặp: kiểm chứng lật ⚠→✅ nhiều ca)
   *     ⇒ gỡ Socket oan, dồn 100% sang Ext ~15–21 tin/s ⇒ lô 9 455 chat mất 342 s (§45).
   *   • Âm tính giả: page Socket gửi mà KHÔNG tới (ca Đinh Thị Loan) ⇒ vẫn thử tiếp, mỗi lần
   *     mất một tin + 5 s chờ ACK.
   * Nay đo ĐÚNG thứ cần đo: tỉ lệ GIAO ĐƯỢC của Socket trên từng page.
   *   st.dlv  = số ca kiểm chứng/xác nhận thấy tin ĐÃ tới qua Socket
   *   st.lost = số ca chứng minh được hội thoại KHÔNG có tin sau khi bắn Socket
   * Luật (tự hồi, không cần TTL): một lần giao được ⇒ xoá sạch lost. Ban chỉ khi lost ≥ 2 liên
   * tiếp mà không có lần nào tới, hoặc (ACK chết + đã có ≥1 lần chứng minh mất tin). */
  /* ═══ [v1.92.62] SỬA LỖI MẤT TIN: "KHÁCH VẮNG MẶT" TỪNG BỊ TÍNH LÀ "SOCKET MẤT TIN" ═══
   * Log 19:00:54 (lô 8 518 chat): `Socket bị né (mất tin 774 · ACK chết 0) 774` — tức 774 chat
   * bị đẩy KHỎI làn Socket. Nhưng CẢ FILE chỉ có **5** ca thật sự `chứng minh VẮNG MẶT`, còn
   * 414 ca là `bù Extension không được` và 13 ca `Bù OK`.
   * Gốc: `proveAbsentBeforeBu()` trả `'absent'` khi **hội thoại không đổi sau lúc gửi**. Nhưng
   * "không đổi" KHÔNG phải bằng chứng về Socket — nó là định nghĩa của **khách vắng mặt**, đúng
   * nhóm FB từ chối (log: 4 624 ca `FB từ chối`). Hệ quả dây chuyền:
   *   lost ≥ 2  ⇒  pageSocketUsable() = false  ⇒  cả page bị né Socket  ⇒  dồn sang Extension
   *   ⇒  Extension nghẽn ("bộ ngắt quá tải")  ⇒  hẹn 9 s  ⇒  vẫn nghẽn  ⇒  ❌ oan.
   * Nay TÁCH SỔ theo KÊNH và chỉ tính cái đúng là mất tin:
   *   lostSock = ca do CHÍNH Socket bắn, kiểm chứng thấy KHÔNG có tin  ⇒ mới ban Socket
   *   absent   = "hội thoại không đổi"  ⇒ CHỈ đếm để chẩn đoán, KHÔNG ban làn nào
   *   lostExt  = ca Extension bắn mà không tới        ⇒ KHÔNG bao giờ ban Socket
   * 2 ca "absent" liên tiếp KHÔNG còn đủ để gỡ Socket (trước đây đủ — đó là lỗi). */
  const sockRoute = {}; // pageId → { sent, dlv, lostSock, lostExt, absent, probeAt }
  function sockRouteOf(pid) {
    const k = String(pid || '');
    if (!k) return null;
    if (!sockRoute[k]) sockRoute[k] = { sent: 0, dlv: 0, lostSock: 0, lostExt: 0, absent: 0, probeAt: 0 };
    return sockRoute[k];
  }
  /* [v1.92.62] Chỉ `lostSock` mới có quyền gỡ Socket. `absent`/`lostExt` chỉ để đọc. */
  const SOCK_LOST_BAN = 2;   // 2 lần SOCKET thật sự làm mất tin (0 lần tới) ⇒ gỡ Socket
  function pageSocketUsable(pid) {
    const st = sockRoute[String(pid || '')];
    if (!st) return true;                    // chưa có bằng chứng gì ⇒ cho thử
    if (st.lostSock >= SOCK_LOST_BAN) return false;
    if (st.lostSock >= 1 && isPageAckDead(pid)) return false;
    return true;
  }
  /* Lý do né — tách đúng nguồn để log không nói sai (xem socketPickDiag.skipLost). */
  function socketSkipReason(pid) {
    const st = sockRoute[String(pid || '')];
    if (!st) return 'unknown';
    if (st.lostSock >= SOCK_LOST_BAN) return 'lostSock';
    if (st.lostSock >= 1 && isPageAckDead(pid)) return 'lostSock+ackDead';
    return 'unknown';
  }
  const pageAckDeadProbeAt = {};
  const SOCK_DEAD_PROBE_MS = 20000;
  // [v1.92.16] Lô 19:52: cờ "ACK chết" bật 5 lần, mỗi lần chỉ được dò lại sau tối đa 20 s ⇒
  // TỔNG 2 539 chat bị né khỏi làn Socket (≈508 chat/lần) và dồn sang Ext chậm hơn 4 lần.
  // Nay: dò ngay khi số chat bị né kể từ lần dò trước chạm 50 — hư hại tối đa ~50 chat/lần,
  // không phụ thuộc đồng hồ.
  /* [v1.92.55] `deadSkip` GỘP HAI LÝ DO KHÁC HẲN NHAU — lô 14:03 in "Socket bị né (ACK chết) 3 952"
   * trong khi `hết hạn chờ 1 246` và `im lặng THẬT 0`. Cơ chế tuyên bố "ACK chết" đòi 5 lần im
   * lặng THẬT liên tiếp (dòng ~6583) ⇒ nhánh đó KHÔNG chạy. Thủ phạm là `st.lost >= 2`
   * ("đã 2 lần chứng minh hội thoại KHÔNG có tin sau khi bắn Socket") ⇒ nhãn log đang gọi sai
   * tên một cơ chế chống mất tin thành "ACK chết". Nay đếm riêng 2 lý do, chỉ đổi NHÃN. */
  const socketPickDiag = { deadSkip: 0, deadSkipAtProbe: 0, probe: 0, probeOk: 0, notReady: 0, noGid: 0,
    skipLost: 0, skipAckDead: 0 };
  function isPageAckDead(pid) {
    const at = pageAckDeadAt[pid];
    if (!at) return false;
    if (Date.now() - at > PAGE_ACK_DEAD_TTL_MS) { delete pageAckDeadAt[pid]; return false; }
    return true;
  }
  const SIDE_EFFECT_PARALLEL = 8; // số request nền (fill_admin_name / update_global_id) chạy song song
  function makeLane(parallel) {
    let active = 0;
    let normalSincePriority = 0;
    const waiters = [];
    const pWaiters = [];
    // [v1.92.9] phát sự kiện mỗi khi active/hàng đợi đổi → chỗ chờ thức ngay, không quét nhịp
    const changeSubs = new Set();
    const laneNotify = () => {
      if (!changeSubs.size) return;
      const arr = Array.from(changeSubs);
      for (let k = 0; k < arr.length; k++) { try { arr[k](); } catch (e) { /* ignore */ } }
    };
    const enqueue = function (fn, opts) {
      const isPriority = !!(opts && opts.priority);
      return new Promise((resolve) => {
        const start = () => {
          if (state.stopRequested) { resolve({ ok: false, sent: false, error: 'Đã dừng' }); return; }
          active++;
          laneNotify();
          Promise.resolve()
            .then(fn)
            .catch((e) => ({ ok: false, sent: false, error: 'Lỗi kênh: ' + (e && e.message || e) }))
            .then((r) => {
              active--;
              laneNotify();
              if (state.stopRequested) {
                // Đang Dừng: xả HẾT hàng đợi — mỗi start() tự resolve 'Đã dừng' ngay.
                // Chỉ xả 1 waiter như cũ thì số waiter còn lại kẹt vĩnh viễn (không còn
                // task nào xong để kéo tiếp) → runPool không bao giờ xong → UI 'Đang dừng…' mãi.
                while (pWaiters.length) { const w = pWaiters.shift(); w(); }
                while (waiters.length) { const w = waiters.shift(); w(); }
              } else {
                let next = null;
                if (pWaiters.length && (!waiters.length || normalSincePriority >= 1)) {
                  normalSincePriority = 0;
                  next = pWaiters.shift();
                } else if (waiters.length) {
                  normalSincePriority++;
                  next = waiters.shift();
                } else if (pWaiters.length) {
                  normalSincePriority = 0;
                  next = pWaiters.shift();
                }
                if (next) next();
              }
              resolve(r);
            });
        };
        if (active < parallel && !waiters.length && !pWaiters.length) start();
        else if (isPriority) {
          if (active < parallel) start();
          else pWaiters.push(start);
        } else {
          waiters.push(start);
        }
      });
    };
    enqueue.priority = (fn) => enqueue(fn, { priority: true });
    enqueue.busy = () => active >= parallel || waiters.length > 0 || pWaiters.length > 0;
    enqueue.activeCount = () => active;
    enqueue.waitingCount = () => waiters.length + pWaiters.length;
    enqueue.onChange = (fn) => {
      if (typeof fn !== 'function') return () => {};
      changeSubs.add(fn);
      return () => { try { changeSubs.delete(fn); } catch (e) { /* ignore */ } };
    };
    return enqueue;
  }

  // Lane có GIỚI HẠN ĐỘNG cho riêng khâu dò globalId. API/Ext send lanes giữ nguyên;
  // nguồn dễ tự gây nghẽn (HTTP GET /messages và lệnh dò qua Extension) được tăng/giảm
  // theo phản hồi thật, còn Socket/page có bộ điều tiết ACK riêng phía dưới.
  function makeAdaptiveLane(initial, min, max) {
    let active = 0;
    let limit = Math.max(min, Math.min(max, initial || min));
    const waiters = [];
    // [v1.92.9] phát sự kiện mỗi khi active/hàng đợi đổi → chỗ chờ thức ngay, không quét nhịp
    const changeSubs = new Set();
    const laneNotify = () => {
      if (!changeSubs.size) return;
      const arr = Array.from(changeSubs);
      for (let k = 0; k < arr.length; k++) { try { arr[k](); } catch (e) { /* ignore */ } }
    };
    const pump = () => {
      if (state.stopRequested) {
        while (waiters.length) { const w = waiters.shift(); w(); }
        return;
      }
      while (active < limit && waiters.length) {
        const start = waiters.shift();
        start();
      }
    };
    const enqueue = function (fn) {
      return new Promise((resolve) => {
        const start = () => {
          if (state.stopRequested) { resolve({ ok: false, sent: false, error: 'Đã dừng' }); return; }
          active++;
          laneNotify();
          Promise.resolve()
            .then(fn)
            .catch((e) => ({ ok: false, sent: false, error: 'Lỗi kênh: ' + (e && e.message || e) }))
            .then((r) => {
              active--;
              laneNotify();
              pump();
              resolve(r);
            });
        };
        if (active < limit && !waiters.length) start();
        else { waiters.push(start); pump(); }
      });
    };
    enqueue.busy = () => active >= limit || waiters.length > 0;
    enqueue.activeCount = () => active;
    enqueue.waitingCount = () => waiters.length;
    enqueue.getLimit = () => limit;
    enqueue.setLimit = (next) => {
      limit = Math.max(min, Math.min(max, Math.round(next) || min));
      pump();
      return limit;
    };
    enqueue.onChange = (fn) => {
      if (typeof fn !== 'function') return () => {};
      changeSubs.add(fn);
      return () => { try { changeSubs.delete(fn); } catch (e) { /* ignore */ } };
    };
    return enqueue;
  }

  // Lane Socket/page có giới hạn động. Khởi đầu ở cấu hình đã dùng; chỉ tăng khi ACK thành công
  // nhanh liên tục. Thử nghiệm này yêu cầu 4 ACK chậm liên tiếp mới hạ lane, nhưng giữ ngưỡng
  // chặt 2 no-ACK liên tiếp vì no-ACK lặp thường báo hiệu Socket/page có vấn đề.
  // Rejected recipient không tự hạ lane chỉ vì trạng thái rejected.
  function makeAdaptivePriorityLane(initial, min, max) {
    let active = 0;
    let limit = Math.max(min, Math.min(max, initial || min));
    let normalSincePriority = 0;
    const waiters = [];
    const pWaiters = [];
    const nextWaiter = () => {
      if (pWaiters.length && (!waiters.length || normalSincePriority >= 1)) {
        normalSincePriority = 0;
        return pWaiters.shift();
      }
      if (waiters.length) {
        normalSincePriority++;
        return waiters.shift();
      }
      if (pWaiters.length) {
        normalSincePriority = 0;
        return pWaiters.shift();
      }
      return null;
    };
    const pump = () => {
      if (state.stopRequested) {
        while (pWaiters.length) pWaiters.shift()();
        while (waiters.length) waiters.shift()();
        return;
      }
      while (active < limit && (waiters.length || pWaiters.length)) {
        const next = nextWaiter();
        if (!next) break;
        next();
      }
    };
    const enqueue = (fn, opts) => new Promise((resolve) => {
      const start = () => {
        if (state.stopRequested) { resolve({ ok: false, sent: false, error: 'Đã dừng' }); return; }
        active++;
        Promise.resolve().then(fn)
          .catch((e) => ({ ok: false, sent: false, error: 'Lỗi kênh: ' + (e && e.message || e) }))
          .then((r) => { active--; pump(); resolve(r); });
      };
      if (active < limit && !waiters.length && !pWaiters.length) start();
      else if (opts && opts.priority) {
        if (active < limit) start();
        else pWaiters.push(start);
      } else {
        waiters.push(start);
        pump();
      }
    });
    enqueue.priority = (fn) => enqueue(fn, { priority: true });
    enqueue.busy = () => active >= limit || waiters.length > 0 || pWaiters.length > 0;
    enqueue.activeCount = () => active;
    enqueue.waitingCount = () => waiters.length + pWaiters.length;
    enqueue.getLimit = () => limit;
    enqueue.setLimit = (next) => {
      limit = Math.max(min, Math.min(max, Math.round(next) || min));
      pump();
      return limit;
    };
    return enqueue;
  }

  const socketPageLaneCtl = Object.create(null);
  function noteSocketPageLaneOutcome(pageId, kind, latencyMs) {
    try {
      const pid = String(pageId || '');
      const lane = pid && pageSocketLanes[pid];
      if (!lane) return;
      const ctl = socketPageLaneCtl[pid] || (socketPageLaneCtl[pid] = { fastOk: 0, slowAck: 0, noAckStreak: 0 });
      const ms = Math.max(0, Number(latencyMs) || 0);
      noteRecentOutcome(kind); // [v1.92.48] cửa sổ 50 kết quả gần nhất — điều kiện nới làn (rampAllowed)
      /* [v1.92.18] MẪU ĐỘ TRỄ ACK BỊ CẮT CỤT — SỬA GỐC.
       * noteAckLatency() cũ chỉ chạy TRONG nhánh "ACK nhanh" (ms < fastAckMs) ⇒ mọi ACK chậm
       * hơn ngưỡng bị VỨT khỏi vòng mẫu. Vòng mẫu vì thế chỉ toàn ca nhanh ⇒ p50 thấp ⇒ ngưỡng
       * "nhanh" đứng ở sàn 2 500 ms ⇒ với page có ACK 2–3 s thì KHÔNG ca nào được tính là nhanh
       * ⇒ fastOk không bao giờ đạt 20 ⇒ làn không tăng (đúng "[64×1]" của lô 19:52).
       * Thống kê tự lừa chính nó: phải lấy CẢ ca chậm mới biết nhịp ACK thật của page.
       * Chỉ ghi nhận (không đổi đường gửi); hạn chờ ACK vẫn bị chặn trần 3 000 ms. */
      if (kind === 'ok' || kind === 'rejected') noteAckLatency(ms);
      if (kind === 'ok' && ms < fastAckMs()) {
        ctl.fastOk++;
        ctl.slowAck = 0;
        ctl.noAckStreak = 0;
        sockNoAckRun = 0; // ACK hồi ⇒ reset cầu dao
        if (pid) { delete pageAckTimeoutRun[pid]; delete pageAckHoldExpired[pid]; delete pageAckSilentRun[pid]; if (pageAckDeadAt[pid]) { socketPickDiag.probeOk++; delete pageAckDeadProbeAt[pid]; } delete pageAckDeadAt[pid]; }
        if (ctl.fastOk >= 20 && lane.getLimit() < SOCKET_LANE_MAX && rampAllowed()) {
          ctl.fastOk = 0;
          const prevLimit = lane.getLimit();
          const next = lane.setLimit(prevLimit + 8);
          // [v1.92.14] SÀN BỊ CẦU DAO HẠ THÌ KHÔNG BAO GIỜ HỒI — hạ là vĩnh viễn tới khi F5.
          // Log lô 15:54 cho thấy Socket/page cap in ra "64–384" nhưng limit cuối [64×1]; còn
          // mỗi lần cầu dao nổ (25 no-ACK liên tiếp) lại hạ sàn 64→32→16 và GIỮ tới hết phiên.
          // ACK đã nhanh ổn định 20 nhịp liên tiếp thì nâng sàn trở lại dần (không đụng sàn do
          // người dùng tự đặt bằng __botfakeSetSockPageFloor__).
          if (!socketFloorUserSet && socketLaneFloor < SOCKET_LANE_MIN) {
            const _prevFloor = socketLaneFloor;
            socketLaneFloor = SOCKET_LANE_MIN; // [v1.92.43] phục hồi DỨT ĐIỂM, không +8 mỗi 20 nhịp
            logLine('🔧 ACK hồi ổn định (' + ctl.fastOk + ' nhịp nhanh liền) — nâng lại sàn Socket/page '
              + _prevFloor + ' → ' + socketLaneFloor + '/' + SOCKET_LANE_MIN + '.');
          }
          logLaneRamp(pid, prevLimit, next); // [v1.92.33] 16 nấc +8 ⇒ 1 dòng
        }
      } else if (kind === 'noack') {
        ctl.fastOk = 0;
        ctl.slowAck = 0;
        ctl.noAckStreak++;
        // [v1.91.87] Trễ ĐÚNG BẰNG hạn chờ vừa áp dụng ⇒ bộ đếm giờ đã nổ, tức KHÔNG có
        // phản hồi nào ⇒ một lần là đủ kết luận kênh ACK chết (thay vì 2 lần như 1.91.86).
        /* [v1.92.48] CHỈ "IM LẶNG THẬT" MỚI ĐẾM VÀO pageAckTimeoutRun.
         * Bản cũ đếm mọi ca có `ms >= 6000` hoặc `ms >= 0,95 × hạn chờ` — mà `hitCeiling`
         * gần như LUÔN đúng vì `ms` là thời gian bộ đếm nổ. Hệ quả lô 10:01: 84 ca nổ trong
         * cùng một giây 09:57:21 ⇒ 3 lần "liên tiếp" ⇒ tuyên bố ACK chết ⇒ né Socket 7 665 ca.
         * Nay: chỉ đếm khi `mySilent` (đã hết cả cửa sổ nghe 12 s, không một gói nào). */
        if (mySilent && pid) {
          pageAckTimeoutRun[pid] = (pageAckTimeoutRun[pid] || 0) + 1;
          // [v1.92.14] need 1 → 2. `hitCeiling` gần như LUÔN đúng (bộ đếm giờ nổ đúng hạn chờ
          // nên ms ≈ lastWait), nghĩa là chỉ MỘT ACK trượt là page bị tuyên bố chết 10 phút.
          // Lô 14:34 có 117 no-ACK nằm rải giữa 1 173 ACK OK — một ca trượt đơn lẻ không chứng
          // minh được kênh ACK chết (mọi ACK OK đều xoá bộ đếm này). Đòi 2 ca LIÊN TIẾP: đổi lại
          // chỉ tốn thêm ~3s trước khi kết luận, nhưng không còn cảnh "trượt một ca ⇒ cả lô 9 455
          // chat rơi vào Extension".
          const need = ACK_DEAD_PROOF_RUN; // [v1.92.48] 3 → 5 VÀ đổi đơn vị đếm: xem pageAckSilentRun
          if (pageAckTimeoutRun[pid] >= need && !isPageAckDead(pid)) {
            pageAckDeadAt[pid] = Date.now();
            try { if (lane.getLimit() > socketLaneFloor) lane.setLimit(socketLaneFloor); } catch (e0) { /* ignore */ }
            logLine('🧯 Socket ACK của page ' + pid + ' coi như CHẾT (' + need
              + ' lần IM LẶNG THẬT liên tiếp — hết cả cửa sổ nghe ' + Math.round(ms / 1000) + 's mà không có gói nào)'
              + ' — bỏ Socket khỏi thứ tự làn, đi Extension/API cho tới khi hồi (dò lại sau '
              + Math.round(SOCK_DEAD_PROBE_MS / 1000) + 's hoặc 20 ca bị né)');
          }
        }
        // [v1.91.85] Cầu dao toàn cục: mất ACK liên tục ⇒ hạ SÀN socket (không chỉ hạ limit).
        sockNoAckRun++;
        if (sockNoAckRun >= SOCK_ACK_STORM_RUN && socketLaneFloor > SOCKET_LANE_RUNTIME_FLOOR) {
          sockNoAckRun = 0;
          /* [v1.92.43] SÀN KHÔNG XUỐNG DƯỚI 32 + KHÔNG ĐƯỢC GIỮ TỚI HẾT PHIÊN.
           * Log 16:52 (7 073 chat): '🧯 Mất ACK liên tục 25 tin — hạ SÀN socket xuống 32 rồi 16/page'
           * chỉ 2 dòng, sau đó `Socket/page limits cuối [16×1]` và cả lô phát 17,75 tin/s trong khi
           * làn cho phép 384. 16 làn là **1/24** cấu hình ⇒ tự bóp cả lô vì 25 ca no-ACK.
           * Nay: sàn thấp nhất 32, và ACK hồi thì nâng lại NGAY (xem nhánh 'ok' bên dưới). */
          socketLaneFloor = Math.max(SOCKET_LANE_RUNTIME_FLOOR, Math.floor(socketLaneFloor / 2));
          try { lane.setLimit(Math.max(socketLaneFloor, Math.floor(lane.getLimit() * 0.8))); } catch (e0) { /* ignore */ }
          logLine('🧯 Mất ACK liên tục ' + SOCK_ACK_STORM_RUN + ' tin — hạ SÀN socket xuống '
            + socketLaneFloor + '/page (ACK hồi 20 nhịp liền là nâng lại ' + SOCKET_LANE_MIN + ')');
        }
        if (ctl.noAckStreak >= SOCKET_LANE_NOACK_BACKOFF_THRESHOLD && lane.getLimit() > socketLaneFloor) {
          ctl.noAckStreak = 0;
          const prevLimit = lane.getLimit();
          const next = lane.setLimit(Math.max(socketLaneFloor, Math.floor(prevLimit * 0.8)));
          // [v1.92.34] Chỉ ghi khi giá trị THẬT SỰ giảm + gộp 1 dòng / 2 s (lô 13:38 in 55 dòng
          // "xuống 64" trong khi làn đã nằm ở sàn 64 ⇒ 100 % là dòng rỗng, không có ca hạ thật).
          logLaneDrop(pid, prevLimit, next, 'Socket no-ACK lặp ' + SOCKET_LANE_NOACK_BACKOFF_THRESHOLD + ' lần');
        }
      } else if (kind === 'ok' || kind === 'rejected') {
        // [v1.92.4] LÀN SOCKET BỊ KHOÁ Ở SÀN — tìm ra cơ chế từ lô 09:44 (3 653 chat, 1.92.3):
        //   peak Socket/page active 384/384 · waiting 192/192  (làn ĐÃ lên tới 384)
        //   Socket/page limits cuối [64×1]                     (nhưng kết thúc ở SÀN 64!)
        //   ACK OK/rejected 2 311/1 261 · buckets 1-2s = 2 921 ca (ACK NHANH)
        // Nguyên nhân: `ctl.fastOk = 0;` chạy cho CẢ 'rejected'. Mỗi ca bị FB từ chối lại xoá
        // bộ đếm, mà bộ đếm cần 20 ca ACK nhanh mới tăng làn +8 ⇒ trong lô có 35 % ca rejected,
        // bộ đếm gần như KHÔNG BAO GIỜ đạt 20 ⇒ làn không tăng, chỉ còn các nhịp giảm 0,8×
        // ⇒ trôi dần về sàn 64 và nằm đó. Đó là lý do phát lệnh bị chặn ở ~37 tin/s dù ACK
        // trung bình chỉ 1 448 ms (lý thuyết 384 ÷ 1,45 ≈ 265 tin/s).
        // Nay: 'rejected' KHÔNG xoá bộ đếm; và nếu FB trả lời nhanh (<2 500 ms) thì tính luôn
        // là một ca tốt — vì nó chứng minh kênh ACK đang sống, khác hẳn no-ACK.
        if (kind === 'rejected' && ms < fastAckMs()) {
          ctl.fastOk++;
          ctl.noAckStreak = 0;
          if (ctl.fastOk >= 20 && lane.getLimit() < SOCKET_LANE_MAX && rampAllowed()) {
            ctl.fastOk = 0;
            lane.setLimit(lane.getLimit() + 8);
          }
        } else {
          if (kind === 'ok') ctl.fastOk = 0;
          ctl.noAckStreak = 0;
        }
        /* [v1.92.48] PHẠT "ACK CHẬM" PHẢI BÁM HẠN CHỜ ĐANG DÙNG, KHÔNG PHẢI HẰNG 6 000 ms.
         * Lô 10:01: trần chờ hiệu dụng = clamp(3000, p90×1,6 = 3 974, 6000) = 3 974 ms, nhưng
         * ngưỡng phạt vẫn là 6 000 ms ⇒ một ACK 4 100 ms (bình thường với chính page đó) bị
         * tính là "chậm"; 4 lần liên tiếp là hạ làn ×0,8 (log 09:57:20: 384 → 64 = 8 lần hạ).
         * Nay: ngưỡng phạt = hạn chờ vừa áp dụng (pageLastAckWait) + 50 % biên, sàn 3 000 ms.
         * Phạt làn là ĐÚNG khi ACK vượt hẳn cửa sổ nghe của chính nó; sai khi nó chỉ vượt một
         * hằng số do người viết chọn. Hệ số hạ 0,8 → 0,85 và sàn 32 → SOCKET_LANE_RUNTIME_FLOOR. */
        const slowAckMs = Math.max(3000, Math.round(((pid && pageLastAckWait[pid]) || 0) * 1.5));
        if (ms >= slowAckMs) {
          ctl.slowAck++;
          if (ctl.slowAck >= SOCKET_LANE_SLOW_ACK_BACKOFF_THRESHOLD && lane.getLimit() > socketLaneFloor) {
            ctl.slowAck = 0;
            const prevLimit = lane.getLimit();
            const next = lane.setLimit(Math.max(socketLaneFloor, Math.floor(prevLimit * 0.85)));
            logLaneDrop(pid, prevLimit, next, 'Socket ACK chậm liên tiếp ' + SOCKET_LANE_SLOW_ACK_BACKOFF_THRESHOLD + ' lần (> ' + slowAckMs + 'ms)');
          }
        } else {
          ctl.slowAck = 0;
        }
      }
      // Rejected không tự giảm luồng trừ khi ACK của nó thật sự chậm; trạng thái recipient riêng biệt.
    } catch (e) { /* điều tiết lane không được làm hỏng gửi */ }
  }

  function getPageSocketLaneRange() {
    const values = Object.keys(pageSocketLanes).map((pid) => pageSocketLanes[pid].getLimit());
    if (!values.length) return String(BUS_PARALLEL_SOCKET);
    const lo = Math.min.apply(Math, values), hi = Math.max.apply(Math, values);
    return lo === hi ? String(lo) : (lo + '–' + hi);
  }
  function getPageSocketLaneStats() {
    const pids = Object.keys(pageSocketLanes);
    const result = { pages: pids.length, activeTotal: 0, waitingTotal: 0, activeMaxPerPage: 0, waitingMaxPerPage: 0, limits: '' };
    const limitCounts = Object.create(null);
    pids.forEach((pid) => {
      const lane = pageSocketLanes[pid];
      const active = lane.activeCount();
      const waiting = lane.waitingCount();
      const limit = lane.getLimit();
      result.activeTotal += active;
      result.waitingTotal += waiting;
      result.activeMaxPerPage = Math.max(result.activeMaxPerPage, active);
      result.waitingMaxPerPage = Math.max(result.waitingMaxPerPage, waiting);
      limitCounts[limit] = (limitCounts[limit] || 0) + 1;
    });
    result.limits = Object.keys(limitCounts).sort((a, b) => Number(a) - Number(b))
      .map((limit) => limit + '×' + limitCounts[limit]).join(', ') || 'chưa tạo lane';
    return result;
  }

  const apiSendLane = makeLane(API_SEND_PARALLEL);
  const ctxFetchLane = makeAdaptiveLane(CTX_FETCH_INITIAL, CTX_FETCH_MIN, CTX_FETCH_MAX);
  const photoUploadLane = makeLane(PHOTO_UPLOAD_PARALLEL);
  const gidExtLane = makeAdaptiveLane(GID_EXT_INITIAL, GID_EXT_MIN, GID_EXT_MAX);

  // BỘ ĐIỀU TIẾT DÒ GLOBAL_ID (AIMD): phản hồi nhanh/ổn định → tăng dần để lấy
  // tốc độ thật; 429/timeout/chậm → giảm mạnh + nghỉ chung, tránh cả nghìn request
  // cùng đâm vào server đang nghẽn rồi cùng chết (đúng bệnh lô 5.000).
  const gidHttpCtl = { good: 0, bad: 0, coolUntil: 0, backoffStreak: 0 };
  /* [v1.92.54] `rampAtUnknown` = mốc `gidStats.unknown` tại lần nới làn gần nhất. Phải KHAI BÁO
   * TƯỜNG MINH: nếu để undefined thì `(gidStats.unknown||0) - undefined` = NaN ⇒ `NaN >= 12`
   * luôn false ⇒ đường hồi chết y như bản 1.92.52 (đúng kiểu lỗi đang sửa). */
  const gidExtCtl = { good: 0, bad: 0, cooldowns: 0, rampAtUnknown: 0 };
  async function waitGidHttpCooldown() {
    let waited = false;
    if (!state.stopRequested && Date.now() < gidHttpCtl.coolUntil) {
      waited = true;
      await sleepUntil(gidHttpCtl.coolUntil, 'gid-cool'); // [v1.92.9] thức ĐÚNG mốc, không quét 25–250 ms
    }
    // Rải nhịp ngẫu nhiên sau cơn 429: tránh cả lane cùng lao lại đúng 1 ms.
    if (waited && !state.stopRequested) await sleepUntil(Date.now() + Math.floor(Math.random() * 180));
  }
  function noteGidHttpResult(ok, status, latencyMs) {
    try {
      if (status === 429) {
        gidHttpCtl.backoffStreak = Math.min(6, (gidHttpCtl.backoffStreak || 0) + 1);
        gidHttpCtl.coolUntil = Date.now() + Math.min(10000, 1200 * gidHttpCtl.backoffStreak);
        gidHttpCtl.good = 0;
        gidHttpCtl.bad = 0;
        ctxFetchLane.setLimit(ctxFetchLane.getLimit() * 0.5);
        return;
      }
      if (!ok) {
        gidHttpCtl.good = 0;
        gidHttpCtl.bad++;
        if (gidHttpCtl.bad >= 3) {
          gidHttpCtl.bad = 0;
          ctxFetchLane.setLimit(ctxFetchLane.getLimit() * 0.75);
        }
        return;
      }
      if (latencyMs > 5000) {
        gidHttpCtl.good = 0;
        gidHttpCtl.bad++;
        if (gidHttpCtl.bad >= 4) {
          gidHttpCtl.bad = 0;
          ctxFetchLane.setLimit(Math.max(16, Math.round(ctxFetchLane.getLimit() * 0.85)));
        }
        return;
      }
      gidHttpCtl.bad = 0;
      gidHttpCtl.backoffStreak = 0;
      if (latencyMs < 1500) {
        gidHttpCtl.good++;
        if (gidHttpCtl.good >= 10) {
          gidHttpCtl.good = 0;
          ctxFetchLane.setLimit(ctxFetchLane.getLimit() + 4);
        }
      } else {
        gidHttpCtl.good = Math.max(0, gidHttpCtl.good - 1);
      }
    } catch (e) { /* điều tiết lỗi không được làm hỏng lượt gửi */ }
  }
  let gidExtPeak = 0; // [v1.92.54] đỉnh của làn dò (để kiểm đường hồi có chạy thật)
  function noteGidExtResult(responded, timedOut, latencyMs) {
    try {
      if (timedOut || !responded || latencyMs > 12000) {
        gidExtCtl.good = 0;
        gidExtCtl.bad++;
        /* [v1.92.52] CO VỀ SÀN LÀ ĐÚNG — NHƯNG PHẢI CÓ ĐƯỜNG HỒI.
         * Lô 12:24 (8 509 chat, tab nền): `Ext dò` = 4 suốt lô (sàn GID_EXT_MIN) trong khi
         * **551 ca** vẫn thiếu globalId và `lần dò chưa ra 555`, `Ext chưa rõ 555`
         * (Ext bị Chrome bóp ⇒ timeout ⇒ bad++ ⇒ ×0,7 ⇒ kẹp sàn, lặp mãi).
         * Đường hồi CŨ chỉ có MỘT: 10 phản hồi nhanh < 5 s ⇒ +2. Khi Ext đã bị bóp thì không bao
         * giờ có 10 phản hồi nhanh ⇒ làn chết ở sàn tới hết lô. Kết quả: 547 ca chốt ❌
         * "api: (#10) ngoài 24h | Ext: không gid | socket: không gid" — không kênh nào gửi được.
         * Nay thêm đường hồi THEO HÀNG ĐỢI: nếu còn ≥ 12 ca đang CHỜ dò thì nhả thêm +2 (chặn
         * bởi GID_EXT_MAX nên tối đa vẫn ≤ 32; và chỉ khi đã co ít nhất 2 lần liên tiếp).
         * Không đổi trần, không đổi sàn, không đổi điều kiện co. */
        if (gidExtCtl.bad >= 3) {
          gidExtCtl.bad = 0;
          /* [v1.92.55] `gidExtPeak` PHẢI GHI Ở MỌI CHỖ ĐỔI LÀN, không chỉ nhánh tăng.
           * Lô 14:03 in `Ext dò 10 (đỉnh 0)` — đỉnh 0 mà làn đang 10 là BẤT KHẢ ⇒ số đo hỏng
           * (chỉ gán trong nhánh nới 1.92.52/54, mà nhánh đó chưa chạy lần nào). Sai số đo thì
           * mọi kết luận  từ nó đều vô giá trị ⇒ sửa để lần sau đọc được THẬT.
           * Chú ý: đỉnh ở đây là đỉnh của bước CO (giảm) — vẫn phải ghi để không in số ảo. */
          gidExtLane.setLimit(gidExtLane.getLimit() * 0.7);
          try { gidExtPeak = Math.max(gidExtPeak, gidExtLane.getLimit()); } catch (ePk0) { /* ignore */ }
          gidExtCtl.cooldowns = (gidExtCtl.cooldowns || 0) + 1;
        }
        try {
          /* TRẦN CỦA ĐƯỜNG HỒI NÀY = 12, KHÔNG PHẢI 32 — CỐ Ý.
           * `GID_EXT_INITIAL = 20` (dòng 5998): làn này KHỞI ĐIỂM ở 20. Nên hồi lên 12 vẫn
           * THẤP HƠN mức bình thường của chính nó ⇒ không mở vùng vận hành mới, không thể
           * tạo tải chưa từng được thiết kế. Muốn nới hơn thì đổi 12 → số khác, có ý thức. */
          const GID_EXT_QUEUE_RAMP_CAP = 12;
          /* [v1.92.54] `waitingCount()` LUÔN = 0–2 Ở ĐƯỜNG DÒ ⇒ VÁ 1.92.52 KHÔNG BAO GIỜ CHẠY.
           * Bằng chứng số (lô 13:25 và 13:31, bản 1.92.53): `Ext dò` = **4** suốt CẢ HAI lô
           * (đúng sàn `GID_EXT_MIN`), dù có 138 / 136 ca phải dò. Nếu đường hồi chạy thì làn phải
           * lên ít nhất 6. Vì sao không chạy: `resolveGlobalId` được gọi từ ~192 slot main, mỗi
           * lượt chỉ giữ MỘT promise trên làn 4 chỗ ⇒ **nhiều nhất 4 ca** xếp hàng ⇒
           * `waitingCount() >= 12` gần như không bao giờ đúng. Điều kiện cũ đo SAI ĐẠI LƯỢNG:
           * nó đếm "đang xếp hàng trên làn" thay vì đếm "còn bao nhiêu ca đang thiếu gid".
           * Nay dùng đúng đại lượng: số lần dò CHƯA RA kể từ lần nới gần nhất
           * (`gidStats.unknown − gidExtCtl.rampAtUnknown`). Ngưỡng 12 giữ nguyên ý nghĩa
           * "còn tồn đọng thật". Trần 12 vẫn thấp hơn khởi điểm 20 ⇒ không mở vùng mới. */
          const backlogNoGid = (gidStats.unknown || 0) - (gidExtCtl.rampAtUnknown || 0);
          if ((gidExtCtl.cooldowns || 0) >= 2 && backlogNoGid >= 12
              && gidExtLane.getLimit() < GID_EXT_QUEUE_RAMP_CAP) {
            gidExtCtl.good++;
            if (gidExtCtl.good >= 6) {
              gidExtCtl.good = 0;
              gidExtCtl.rampAtUnknown = gidStats.unknown || 0; // đã trả tồn đọng ⇒ phải tích lại từ 0
              gidExtLane.setLimit(Math.min(GID_EXT_QUEUE_RAMP_CAP, gidExtLane.getLimit() + 2));
              try { gidExtPeak = Math.max(gidExtPeak, gidExtLane.getLimit()); } catch (ePk) { /* ignore */ }
            }
          }
        } catch (eR) { /* ignore */ }
        return;
      }
      gidExtCtl.bad = 0;
      if (latencyMs < 5000) {
        gidExtCtl.good++;
        if (gidExtCtl.good >= 10) {
          gidExtCtl.good = 0;
          gidExtLane.setLimit(gidExtLane.getLimit() + 2);
          try { gidExtPeak = Math.max(gidExtPeak, gidExtLane.getLimit()); } catch (ePk1) { /* ignore */ }
        }
      } else {
        gidExtCtl.good = Math.max(0, gidExtCtl.good - 2);
      }
    } catch (e) { /* ignore */ }
  }
  async function waitForGidDiscoveryIdle(maxMs) {
    // [v1.92.9] thức ngay khi 2 lane dò đổi trạng thái; 200 ms chỉ còn là lưới an toàn.
    const busy = () => (ctxFetchLane.activeCount() + ctxFetchLane.waitingCount())
      + (gidExtLane.activeCount() + gidExtLane.waitingCount());
    const deadline = Date.now() + (maxMs || 8000);
    const watch = [ctxFetchLane, gidExtLane];
    while (!state.stopRequested && Date.now() < deadline) {
      if (!busy()) return true;
      const subs = [];
      const changed = new Promise((resolve) => {
        watch.forEach((lane) => { if (lane && lane.onChange) { try { subs.push(lane.onChange(resolve)); } catch (e) { /* ignore */ } } });
        setTimeout(resolve, 200); // lưới an toàn
      });
      await changed; // đã có lưới an toàn 200 ms bên trong
      subs.forEach((off) => { try { off(); } catch (e) { /* ignore */ } });
    }
    return !busy();
  }
  const extPrepLane = makeLane(PREP_PARALLEL_EXT);
  const extSendLane = makeAdaptiveLane(BUS_PARALLEL_EXT, EXT_SEND_MIN, EXT_SEND_MAX);
  const extLane = extPrepLane;

  // ===== BỘ NGẮT SỨC KHỎE EXTENSION KHI GỬI (CIRCUIT BREAKER) =====
  // Mọi lệnh REPLY_INBOX_PHOTO đều đi qua đúng 1 Pancake Extension. Nếu Extension
  // nghẽn/mất phản hồi mà vẫn tiếp tục nạp lệnh, mỗi lệnh giữ lane 35s rồi timeout
  // theo cụm 6 — đúng cảnh cả nghìn chat phía sau bị "khung delay" ăn hết thời gian.
  // Sau 3 timeout liên tiếp: NGỪNG nạp thêm lệnh Ext trong 45s (tăng dần tối đa
  // 180s), chat chưa bắn Ext sẽ đi Socket/API ngay hoặc chờ Pass 2. Hết giờ nghỉ
  // chỉ cho 1 lệnh THĂM DÒ; có phản hồi thì mở lại, timeout tiếp thì nghỉ tiếp.
  // Lệnh đã bắn rồi mà timeout vẫn là "không rõ" — chỉ kiểm chứng bằng lịch sử
  // tin, TUYỆT ĐỐI không bắn lại mò (lệnh gốc có thể vẫn nằm trong Extension).
  // 🔥 [FIX-TỐC-ĐỘ] Chịu được 12 timeout liên tiếp trước khi ngắt (thay vì 3) — tránh dừng Ext vì
  // vài ca chat chết riêng lẻ. Nghỉ 15s (thay vì 45s) nếu thật sự mở ngắt.
  // [v1.91.97] Ngưỡng ngắt phải co giãn theo số làn: 64 làn bay cùng lúc thì "12 lần liên tiếp
  // không phản hồi" xảy ra thường xuyên hơn 24 làn rất nhiều ⇒ giữ 12 sẽ tự bóp làn liên tục
  // (đúng thứ đã xảy ra ở lô 09:16: ngắt mở 45s, gửi được có 226 tin trong 78s).
  // 12 → 30 (tỉ lệ với số làn), và trần nghỉ 45s → 15s. Vẫn là "thăm dò" chứ không mò: lệnh đã
  // bắn mà quá hạn vẫn KHÔNG bao giờ gửi lại, chỉ kiểm chứng lịch sử để nâng ⚠→✅.
  // [v1.92.1] 30 → 150. Lô 09:34 mất thẳng 267 chat vì bộ ngắt mở giữa lô:
  //   🧯 "bỏ qua lúc Ext quá tải 267" — những chat đó ĐÃ bị Socket từ chối, còn Ext thì bị
  //   chính script chặn, nên rơi vào ❌ oan (mỗi chat chỉ được thử 1 lần/kênh).
  // Giờ Socket đi trước nên Ext chỉ là làn bù; ngắt giữa lô đắt hơn nhiều so với việc chịu
  // thêm timeout. Ngưỡng 150 đủ để chỉ ngắt khi Extension CHẾT THẬT, không ngắt vì một cụm
  // chat khó. Nghỉ vẫn 8–15s.
  const EXT_SEND_BREAKER_THRESHOLD = 150;
  const EXT_SEND_BREAKER_BASE_MS = 8000;
  const EXT_SEND_BREAKER_MAX_MS = 15000;
  const extSendCtl = { timeoutStreak: 0, openUntil: 0, openStreak: 0, probeInFlight: false, probeToken: 0, fastStreak: 0,
    // [v1.92.6] Vòng mẫu độ trễ THẬT của Extension (chỉ ca CÓ phản hồi — ca quá hạn là số
    // liệu bị cắt cụt, đưa vào p90 sẽ tự ru ngủ chính nó). Dùng để suy timeout, xem extTimeoutMs().
    // [v1.92.45] Nay chỉ lấy ca THÀNH CÔNG — ca lỗi trả lời rất nhanh (HAR: p50 0,34–1,0 s) nên
    // đưa vào mẫu sẽ siết timeout xuống sàn 2,5 s và làm cổng quá hạn nổ oan.
    latSamples: [],
    lastOutcomeOk: false, // kết quả lần gửi Ext gần nhất (dùng cho AIMD + mẫu độ trễ)
    peakActive: 0 };      // [v1.92.45] đỉnh số lệnh Ext đang bay — so với trần làn để biết nút cổ chai
  const EXT_LAT_RING = 24;
  /** p90 độ trễ phản hồi Ext gần nhất; 0 = chưa có số đo. */
  function extLatP90() {
    const a = extSendCtl.latSamples;
    if (!a.length) return 0;
    const b = a.slice().sort((x, y) => x - y);
    return b[Math.min(b.length - 1, Math.floor(b.length * 0.9))] || 0;
  }
  /**
   * [v1.92.6] Timeout Extension SUY TỪ SỐ ĐO, không còn là hằng số 2,5 s.
   *
   * Bằng chứng (hai lần chạy cùng cơ chế, chỉ khác timeout):
   *   09:24 · 1 457 chat · timeout 7 s   → Ext quá hạn 114 · kiểm chứng THẤY TIN 69 (60 %)
   *   09:44 · 3 653 chat · timeout 2,5 s → Ext quá hạn 225 · kiểm chứng THẤY TIN   0 ( 0 %)
   * Cắt 7 s → 2,5 s không cứu thêm ca nào mà biến 60 % ca "quá hạn" thành mất trắng: lệnh gửi
   * nằm trong hàng đợi cầu nối, timeout bắn trước khi lệnh kịp chạy ⇒ KHÔNG có gì để kiểm chứng.
   * Nay: timeout = 3 × p90 đo được (sàn 2,5 s, trần 9 s); chưa có mẫu ⇒ 7 s (mức đã đo là có
   * 60 % ca đến nơi). Ext trả nhanh thì tự siết về 2,5 s; Ext ì thì tự nới, tối đa 9 s.
   * Không thể sinh tin trùng: ca quá hạn vẫn chỉ đánh ⚠ + kiểm chứng nền, KHÔNG BAO GIỜ gửi lại.
   */
  function extTimeoutMs() {
    const p90 = extLatP90();
    const want = p90 > 0 ? p90 * 3 : 7000;
    return Math.min(9000, Math.max(2500, Math.round(want)));
  }

  // ==== [v1.92.8] BẮT PHẢN HỒI MUỘN CỦA EXTENSION — không thêm một request nào ====
  // Trong __ExtensionAdapter__.send (@715835 của _app):
  //   setTimeout(() => { delete this.pendingMessages[taskId]; resolve({success:false,data:null}); }, timeout)
  // và listener window "message" CHỈ gọi handler khi taskId CÒN nằm trong pendingMessages
  // ("null!=e.data.taskId&&e.data.taskId in this.pendingMessages").
  // ⇒ Phản hồi của Extension đến sau mốc timeout bị VỨT BỎ, dù tin đã gửi xong. Đó chính là
  //   các dòng "⚠ Ext: Extension không phản hồi (quá hạn)" rồi ~20 s sau lại "🔎 tin ĐÃ đến nơi".
  // Cách sửa: gọi adapter với timeout DÀI để GIỮ CHỖ CHỜ, chỉ await tới mốc mềm extTimeoutMs().
  // Quá mốc thì nhả làn như cũ và gắn .then() vào chính promise đó: phản hồi muộn về ⇒ nâng
  // ⚠→✅ NGAY TẠI CHỖ, không cần đọc lịch sử, không gửi lại ⇒ không thể sinh tin trùng.
  // Giá trị trả về khi quá hạn vẫn là { success:false, data:null } — đúng hình dạng adapter
  // trả khi hết giờ, nên toàn bộ luồng xử lý phía sau giữ nguyên 100 %.
  /* [v1.93.13] ĐỐI CHIẾU ADAPTER THẬT CỦA APP (`_app-…v6.js`, `window.__ExtensionAdapter__`):
   *   `send(e,t={}){ … let n=this.currentTaskId++, o=t.timeout || (u.has(e.type)?d:l) … }`
   *   `let l=3e4, d=12e4, u=new Set(["CONFIG_ROUTING_APP","CACHE_PAGES_ROUTING_APP"])`
   * ⇒ app chờ **30 s** (`l`) cho mọi lệnh thường, **120 s** (`d`) cho lệnh config.
   * `REPLY_INBOX_PHOTO` KHÔNG thuộc `u` ⇒ app chờ 30 s.
   * Script để 60 s — KHÔNG phải giá trị của app. Hạ về 30 s cho khớp:
   * app còn để bộ ngắt 45 s (`refresh_app`/`stop` có chỗ dùng 45 000) nên 30 s là mức an toàn,
   * và `softMs` (2,5 s) vẫn là mức phản hồi thực tế; hằng này chỉ là TRẦN để không giữ lane vô hạn.
   * Đổi 60 s → 30 s chỉ làm lane được NHẢ SỚM HƠN; ca quá hạn vẫn đi đúng đường cũ
   * (⚠ + kiểm chứng nền, KHÔNG BAO GIỜ gửi lại) nên không mở thêm đường gửi trùng. */
  const EXT_ADAPTER_HOLD_MS = 30000;
  const EXT_SOFT_MARK = { soft: true };
  const extLateStats = { ok: 0, fail: 0, silent: 0 };
  function sendExtWithLateWatch(adapter, payload, conv, opt) {
    const softMs = Math.max(1000, Number(opt && opt.softMs) || 2500);
    const startedAt = (opt && opt.startedAt) || Date.now();
    const myRun = runSeq;
    let raw;
    try {
      raw = adapter.send(payload, { timeout: Math.max(EXT_ADAPTER_HOLD_MS, softMs) });
    } catch (e) {
      return Promise.reject(e); // giữ nguyên hành vi cũ: extSendLane bọc thành "Lỗi kênh:"
    }
    let timer = null;
    const soft = new Promise((resolve) => { timer = bgClock.after(softMs, () => resolve(EXT_SOFT_MARK)); });
    return Promise.race([raw, soft]).then((first) => {
      if (timer) { try { timer(); } catch (eS) { /* ignore */ } timer = null; }
      if (first !== EXT_SOFT_MARK) return first; // phản hồi kịp hạn — y như trước
      Promise.resolve(raw).then((late) => {
        const good = !!(late && late.success);
        if (!good) {
          if (late && late.data) extLateStats.fail++; else extLateStats.silent++;
          return;
        }
        extLateStats.ok++;
        // Extension CÓ trả lời ⇒ nó không chết. Không để chuỗi timeout mở bộ ngắt oan.
        try { extSendCtl.timeoutStreak = 0; } catch (e) { /* ignore */ }
        if (myRun !== runSeq) return;
        if (deliveredIds[conv.id] || finalFailedIds[conv.id]) return;
        const lateMs = Date.now() - startedAt;
        try { markDelivered(conv.id, 'ext'); } catch (e) { /* ignore */ }
        try { postSendSideEffects(conv); } catch (e) { /* ignore */ }
        try {
          logFailGrouped((conv.name || conv.id),
            'Extension trả lời SAU mốc quá hạn (' + (Math.round(lateMs / 100) / 10) + 's), tin ĐÃ đi — tính ✅ Ext, không gửi lại', '✅', conv.id);
        } catch (e) { /* ignore */ }
        try { updateBatchSummaryUI(); } catch (e) { /* ignore */ }
      }).catch(() => { extLateStats.fail++; });
      return { success: false, data: null };
    });
  }
  function isExtBreakerOpen() {
    return Date.now() < extSendCtl.openUntil;
  }
  async function acquireExtSendPermit() {
    while (!state.stopRequested) {
      const now = Date.now();
      if (now < extSendCtl.openUntil) return null; // đang nghỉ hồi sức — bỏ qua Ext ngay
      if (extSendCtl.probeInFlight) { await sleepUntil(Date.now() + 10000, 'ext-probe'); continue; } // [v1.92.9] thức NGAY khi lệnh thăm dò có kết quả
      if (extSendCtl.openUntil) {
        extSendCtl.probeInFlight = true;
        extSendCtl.probeToken++;
        return { probe: true, token: extSendCtl.probeToken };
      }
      return { probe: false, token: 0 };
    }
    return null;
  }
  function releaseExtSendPermit(permit) {
    if (permit && permit.probe && extSendCtl.probeToken === permit.token) {
      extSendCtl.probeInFlight = false;
      softNotify('ext-probe'); // [v1.92.9] đánh thức mọi làn đang chờ kết quả thăm dò
    }
  }
  function noteExtSendOutcome(kind, permit, latencyMs) {
    try {
      const now = Date.now();
      if (kind === 'responded') {
        // Extension CÓ trả lời (dù thành công hay báo lỗi rõ ràng) = còn sống.
        extSendCtl.timeoutStreak = 0;
        /* [v1.92.45] HAI SỬA Ở ĐÂY — cả hai đều bắt nguồn từ network-log.har của làn Ext
         * (90 request của extension Pancake v2 trong lúc tool chạy): 90/90 CÓ phản hồi, p50
         * 0,99 s, max 2,13 s — nhưng 90/90 là LỖI (1545041 ×86, 1545012 ×4, payload null).
         *
         * 1) MẪU ĐỘ TRỄ chỉ lấy ca THÀNH CÔNG. `latSamples` nuôi `extLatP90()` → `extTimeoutMs()`
         *    = 3 × p90. Trước đây ca lỗi cũng vào mẫu; lỗi thì luôn nhanh (p50 0,34–1,0 s) nên
         *    timeout bị SIẾT về sàn 2,5 s trong khi ca thành công thật lại chậm hơn ⇒ cổng quá
         *    hạn nổ oan, mỗi ca sinh thêm vòng kiểm chứng 20 s + đọc lại 45 s.
         *
         * 2) AIMD KHÔNG được tăng làn bằng ca LỖI. Bản cũ: `latencyMs < 5000` ⇒ +2 slot/10 lần.
         *    Với 90 ca lỗi mà vẫn trả lời trong <2,2 s, làn sẽ leo 64 → 96 (trần) sau ~160 lệnh
         *    TOÀN HỎNG — đúng hình dạng "Ext nhanh mà cứu 0" trong log. Nay chỉ ca success mới
         *    được tăng; `responded` không còn đồng nghĩa với "khoẻ".
         * Chú thích cũ ghi "tối đa 24" là SAI: lane bị kẹp [EXT_SEND_MIN 48, EXT_SEND_MAX 96]. */
        if (kind === 'responded' && extSendCtl.lastOutcomeOk && latencyMs != null && latencyMs > 0) {
          extSendCtl.latSamples.push(latencyMs);
          if (extSendCtl.latSamples.length > EXT_LAT_RING) extSendCtl.latSamples.shift();
        }
        if (extSendCtl.lastOutcomeOk && latencyMs != null) {
          if (latencyMs < 5000) {
            extSendCtl.fastStreak++;
            if (extSendCtl.fastStreak >= 10) {
              extSendCtl.fastStreak = 0;
              extSendLane.setLimit(extSendLane.getLimit() + 2);
            }
          } else {
            extSendCtl.fastStreak = Math.max(0, extSendCtl.fastStreak - 2);
          }
        } else {
          extSendCtl.fastStreak = 0; // ca lỗi: không tăng, và cắt chuỗi "nhanh" đang tích
        }
        if (permit && permit.probe) {
          releaseExtSendPermit(permit);
          extSendCtl.openUntil = 0;
          extSendCtl.openStreak = 0;
          logLine('🟢 Extension đã phản hồi lại — đóng bộ ngắt quá tải, gửi qua Ext bình thường.');
        } else if (!extSendCtl.probeInFlight && extSendCtl.openUntil && now >= extSendCtl.openUntil) {
          extSendCtl.openUntil = 0;
          extSendCtl.openStreak = 0;
        }
        return;
      }
      if (kind !== 'timeout') { releaseExtSendPermit(permit); return; }
      // Timeout = Extension đang ì: cắt chuỗi tăng + giảm ngay limit làn Ext gửi
      // (×0.6, sàn 6) trước cả khi bộ ngắt 3-timeout kịp mở.
      extSendCtl.fastStreak = 0;
      extSendLane.setLimit(extSendLane.getLimit() * 0.6);
      // Đang có lệnh thăm dò quyết định sức khỏe: kết quả của các lệnh thường
      // phát ra từ trước lúc mở ngắt không được tự ý mở/đóng ngắt nữa.
      if (!permit || !permit.probe) {
        if (extSendCtl.probeInFlight) return;
      }
      if (permit && permit.probe) {
        releaseExtSendPermit(permit);
        extSendCtl.openStreak = Math.min(4, (extSendCtl.openStreak || 0) + 1);
        const backoffMs = Math.min(EXT_SEND_BREAKER_MAX_MS,
          EXT_SEND_BREAKER_BASE_MS * Math.pow(2, extSendCtl.openStreak - 1));
        extSendCtl.openUntil = now + backoffMs;
        extSendCtl.timeoutStreak = 0;
        logLine('🧯 Extension vẫn không phản hồi ở lệnh thăm dò — tạm ngừng bắn Ext '
          + Math.round(backoffMs / 1000) + 's; chat sau đi Socket/API hoặc chờ Pass 2.');
        return;
      }
      extSendCtl.timeoutStreak++;
      if (extSendCtl.timeoutStreak >= EXT_SEND_BREAKER_THRESHOLD && !isExtBreakerOpen()) {
        extSendCtl.openStreak = 1;
        extSendCtl.openUntil = now + EXT_SEND_BREAKER_BASE_MS;
        extSendCtl.timeoutStreak = 0;
        logLine('🧯 Extension không phản hồi ' + EXT_SEND_BREAKER_THRESHOLD
          + ' lần liên tiếp — tạm ngừng bắn Ext 45s để tránh cả nghìn lệnh cùng chờ 35s; chat sau sẽ thử Socket/API trước.');
      }
    } catch (e) { releaseExtSendPermit(permit); }
  }
  // [v1.92.19] Làn riêng cho "bắn lại Socket 1 lần" ở đường bắn-nhả. Không dùng pageLane vì retry
  // chạy SAU khi wave đã nhả ghế — chen vào đây sẽ chiếm ghế của wave kế tiếp (chậm đều cả lô).
  const socketWaveRetryLane = makeLane(48);
  const socketLane = makeLane(BUS_PARALLEL_SOCKET);
  const pageSocketLanes = {};
  function getPageSocketLane(pageId) {
    const pid = String(pageId || '');
    if (!pid) return socketLane;
    if (!pageSocketLanes[pid]) {
      pageSocketLanes[pid] = makeAdaptivePriorityLane(BUS_PARALLEL_SOCKET, SOCKET_LANE_HARD_FLOOR, SOCKET_LANE_MAX);
      socketPageLaneCtl[pid] = { fastOk: 0, slowAck: 0, noAckStreak: 0 };
    }
    return pageSocketLanes[pid];
  }
  const sideEffectLane = makeLane(SIDE_EFFECT_PARALLEL);
  function busEnqueue(fn) {
    return extPrepLane(fn);
  }

  function isPageSocketReady(pageId) {
    try {
      const h = window.__MqttHelper__;
      const sk = h && h.SOCKETS && h.SOCKETS[pageId];
      return isSocketSynced(sk);
    } catch (e) { return false; }
  }

  // Chuẩn bị chung ngữ cảnh (full, threadId, globalId, nonReusableFbId) TRƯỚC KHI chọn kênh bắn:
  //   • Ở Làn 1 (ctx.fastOnly): chạy SONG SONG (Promise.all) cả resolveGlobalId (GET /messages ~150ms)
  //     và uploadOneTimePhoto (POST /contents/facebook ~350ms) để cắt giảm 30% thời gian chờ HTTP!
  //     Nếu chat chưa có globalId trên Server Pancake (deferredToExt), fbId vừa tạo được cất ngay vào
  //     spareFbIdPool[pageId] để chat sống kế tiếp dùng ở 0ms (tuyệt đối không lãng phí!).
  //   • Ở Làn 2 (!ctx.fastOnly): giải quyết globalId trước, chỉ upload ảnh khi chat có thể gửi được.
  async function prepareDirectCtx(conv, photo, ctx) {
    ctx = ctx || {};
    if (!conv || conv.type === 'comment') return ctx;
    const full = await ctxFull(conv, ctx);
    if (!full) return ctx;
    const pageId = full.page_id || full.pageId || conv.pageId || String(conv.id || '').split('_')[0];
    if (!ctx.threadResolved) {
      let threadId = full.thread_id || full.threadId || conv.threadId || '';
      if (!threadId && !ctx.fastOnly && typeof window.__syncMissingThreadId__ === 'function') {
        try {
          threadId = await window.__syncMissingThreadId__(pageId, full.id || conv.id);
          if (threadId) {
            full.thread_id = threadId;
            full.threadId = threadId;
            conv.threadId = threadId;
            const rConv = getReduxConvById(conv.id, 0);
            const tKey = (rConv && (rConv.thread_key || rConv.threadKey)) || full.thread_key || ('t_' + threadId);
            full.thread_key = tKey;
            conv.threadKey = tKey;
          }
        } catch (e) { /* ignore */ }
      }
      if (!threadId && ctx.fastOnly) {
        ctx.deferredToExt = true;
        return ctx;
      }
      ctx.threadId = threadId || null;
      ctx.threadResolved = true;
    }
    if (!ctx.gidResolved && ctx.threadId) {
      const _tGid0 = Date.now();
      const _gidUnknownBefore = gidStats.unknown || 0;
      ctx.gid = await resolveGlobalId(full, ctx.threadId, conv.id, conv.fromPsid, ctx.gidForceFind, ctx);
      /* [v1.92.53] ĐO RIÊNG KHÂU DÒ global_id — đây là phần còn lại lớn nhất chưa có số trong
       * "còn lại 5 741 ms" của lô 8 509 (555 ca "lần dò chưa ra", Ext p90 0 ms → timeout 7 000 ms).
       * Chỉ ĐO, không đổi đường dò.
       * [v1.92.54] TÁCH LƯỢT 1 / LƯỢT 2 — để chứng minh con số 13 475 ms/ca của lô 13:31 là
       * HAI lượt dò nối tiếp nhau chứ không phải một lượt chờ 13,5 s (mọi hạn chờ đơn lẻ trong
       * file đều ≤ 10 000 ms). `lượt 2` = lượt mà TRƯỚC đó đã có ≥1 lần dò chưa ra trên cùng
       * tiến trình ⇒ chính là ca bị bắn lại qua hàng đợi Ext / thử lại Socket. */
      try {
        const _g = Math.max(0, Date.now() - _tGid0);
        const _pass2 = (gidStats.unknown || 0) > _gidUnknownBefore && _gidUnknownBefore > 0;
        waveDiag.prepGidN++; waveDiag.prepGidMs += _g;
        if (_pass2) { waveDiag.prepGidP2N++; waveDiag.prepGidP2Ms += _g; }
        else { waveDiag.prepGidP1N++; waveDiag.prepGidP1Ms += _g; }
      } catch (eG) { /* ignore */ }
      if (ctx.deferredToExt) {
        recycleUnusedFbId(pageId, ctx);
        return ctx;
      }
      ctx.gidResolved = true;
    }
    // Nếu không tìm thấy cả globalId thật lẫn xác nhận hội thoại từ Extension → không tốn công upload ảnh
    const canSend = !!((ctx.gid && !ctx.gidFromPsid) || (ctx.threadId && !ctx.noGidConfirmedByExt));
    if (!canSend) {
      recycleUnusedFbId(pageId, ctx);
      return ctx;
    }
    if (photo && !ctx.nonReusableFbId && !ctx.nonReusableFbIds && canSend) {
      const _tBind0 = Date.now();
      const up = await uploadOneTimePhoto(pageId, photo, conv.id, ctx, false);
      /* [v1.92.53] TÁCH BIND ẢNH RA KHỎI KHỐI "CHUẨN BỊ" — để lần sau trả lời được
       * "5 741 ms giữ slot gồm những gì" bằng số, không phải bằng suy đoán. */
      try { const _b = Math.max(0, Date.now() - _tBind0); waveDiag.prepBindN++; waveDiag.prepBindMs += _b; } catch (eB) { /* ignore */ }
      if (up && up.ok && up.fbId) ctx.nonReusableFbId = up.fbId;
      if (up && up.ok && up.fbIds && up.fbIds.length > 1) ctx.nonReusableFbIds = up.fbIds;
    }
    return ctx;
  }

  function pickBestDirectOrder(conv, pageId, ctx, baseSeq) {
    const seq = (baseSeq || ['ext', 'socket', 'api']).slice();
    if (!conv || conv.type === 'comment') return seq;
    // [v1.91.89] Chế độ "toàn bộ qua Extension": Ext trước, API dự phòng, KHÔNG dùng Socket.
    if (forceExtMode) {
      // [v1.91.90] Cùng endpoint HTTP, nhưng làn API có 76–96 luồng còn Ext chỉ 48 ⇒ lô toàn
      // khách vắng (HAR: mỗi ca ~908ms) nhanh hơn rõ rệt khi đi API trước. Ext vẫn là dự phòng.
      const httpPlan = ['api', 'ext'].concat(seq.filter((x) => x !== 'api' && x !== 'ext' && x !== 'socket'));
      if (httpPlan.length) return httpPlan;
    }
    // [v1.91.86] Né Socket khi page chứng minh là gửi không tới.
    // [v1.92.40] Điều kiện đổi từ "ACK chết" (suy diễn) sang "bằng chứng giao hàng" (pageSocketUsable).
    // Chỉ đổi thứ tự làn (bỏ 'socket'), Extension/API vẫn là đường gửi thật như cũ.
    if (pageId && !pageSocketUsable(pageId)) {
      // [v1.92.13] Dò lại định kỳ thay vì né Socket mù 10 phút (xem chú thích ở PAGE_ACK_DEAD_TTL_MS).
      // [v1.92.36] LÔ TÍ HON (≤ 20 chat) KHÔNG DÒ LẠI KÊNH ACK CHẾT.
      // Lô 3 chat 15:48: page đã bị đánh dấu ACK chết từ lượt trước, nhưng vì tới hạn dò nên
      // 1 chat vẫn được bắn thử Socket ⇒ chờ ACK 8 s rồi mới chốt ⚠, kéo cả lượt 3 tin lên 13 s.
      // Dò chỉ đáng giá khi còn nhiều chat để hưởng lợi; lô nhỏ thì đi thẳng Ext/API cho dứt điểm.
      const tinyBatchNoProbe = !!(batchStats && batchStats.total > 0 && batchStats.total <= 20);
      const sinceProbe = socketPickDiag.deadSkip - socketPickDiag.deadSkipAtProbe;
      // [v1.92.34] 50 → 20 ca: lô 13:38 né Socket 1 697 lần nhưng chỉ dò lại 34 lần (≈5 s/lần
      // thì đúng ra phải ~85) và 0 lần hồi. Dò dày hơn = biết sớm hơn làn nào còn sống,
      // giá mỗi lần dò chỉ 1 tin đi Socket (nếu ACK chết thì mất đúng hạn chờ của 1 tin).
      const hasExtNet = !!(window.__ExtensionAdapter__ && typeof window.__ExtensionAdapter__.send === 'function');
      if (hasExtNet && !tinyBatchNoProbe
          && (sinceProbe >= 20 || Date.now() - (pageAckDeadProbeAt[pageId] || 0) >= SOCK_DEAD_PROBE_MS)) {
        pageAckDeadProbeAt[pageId] = Date.now();
        socketPickDiag.deadSkipAtProbe = socketPickDiag.deadSkip;
        if (seq.indexOf('socket') > -1) {
          socketPickDiag.probe++;
          return ['socket'].concat(seq.filter((x) => x !== 'socket'));
        }
      }
      socketPickDiag.deadSkip++;
      /* [v1.92.55] TÁCH LÝ DO — `pageSocketUsable` trả false vì 1 trong 2 luật khác nhau. */
      try {
        /* [v1.92.62] Đếm theo LÝ DO THẬT (socketSkipReason) — trước đây nhãn "mất tin" cộng cả
         * ca `lost` mà chính nó đã bị cộng oan (xem chú thích ở sockRoute/socksProof). */
        const _why = socketSkipReason(pageId);
        if (_why === 'lostSock' || _why === 'lostSock+ackDead') socketPickDiag.skipLost++;
        else socketPickDiag.skipAckDead++;
      } catch (eSk) { /* ignore */ }
      const noSock = seq.filter((x) => x !== 'socket');
      if (noSock.length) return noSock;
    }
    const hasSock = seq.indexOf('socket') > -1;
    const hasExt = seq.indexOf('ext') > -1;
    if (!hasSock || !hasExt) return seq;
    const hint = channelHints[conv.id];
    const isSmallBatch = !!(batchStats && batchStats.total > 0 && batchStats.total <= 20);
    // Ở lô nhỏ (<=20 tin): chỉ ưu tiên Socket khi Socket của page ĐÃ ẤM SẴN (isPageSocketReady);
    // nếu Socket đang phải khởi tạo từ đầu (socketWarmPromises), bắn ngay qua Extension (~0.8s)
    // để không phải đứng đợi getBusinessWSContext + sendInitMessages (~3s).
    const sockReady = isPageSocketReady(pageId) || (!isSmallBatch && !!(pageId && socketWarmPromises[pageId]));
    const hasRealGid = !!(ctx && ctx.gid && !ctx.gidFromPsid);
    if (!sockReady) socketPickDiag.notReady++;
    else if (!hasRealGid) socketPickDiag.noGid++;
    // Khớp 100% với __sendBySocketCacheFB__ trong _app (@927067 & @937200):
    // Ưu tiên bắn qua Socket trước khi WebSocket đang kết nối (hoặc đang khởi động ở đầu lượt lô lớn) VÀ ĐÃ CÓ global_id THẬT (hasRealGid)!
    // Tuyệt đối không ưu tiên Socket khi chưa có global_id thật (vì Socket không nhận from_psid).
    const preferSocket = sockReady && hasRealGid && (hint === 'socket' || hasRealGid);
    const first = preferSocket ? 'socket' : 'ext';
    const second = preferSocket ? 'ext' : 'socket';
    const rest = seq.filter((x) => x !== 'socket' && x !== 'ext');
    return [first, second].concat(rest);
  }

  // API (nhanh) → Extension ⇄ Socket (Smart Dual-Engine cho cả text lẫn ảnh)
  // CHỈ gửi hàng loạt — KHÔNG còn cơ chế gửi từng con qua giao diện.
  // Chống TRÙNG TIN: kênh nào báo "không rõ kết quả" (tin có thể đã đi) → DỪNG ngay,
  // không thử kênh khác, không gửi thêm. Lỗi là lỗi — báo trong log, không gửi lại, không kiểm tra lại.
  async function sendOne(conv, text, photo, opts) {
    opts = opts || {};
    // v1.82.5 — 1 chat chỉ được bắn 1 lần/lượt: đã đến nơi hoặc Socket đang chờ ACK thì KHÔNG bắn thêm
    if (conv && conv.id && deliveredIds[conv.id]) {
      return { ok: true, id: '', sendBy: deliveredIds[conv.id], sent: true };
    }
    if (conv && conv.id && sockFiredPending.has(conv.id)) {
      return { ok: true, id: '', sendBy: 'socket', sent: true, fired: true };
    }
    if (conv && conv.id && outboundLock[conv.id]) {
      return { ok: true, id: '', sendBy: deliveredIds[conv.id] || 'dup-block', sent: true, fired: true };
    }
    // ⚡ CHẾ ĐỘ NHANH — ĐÚNG PLAN CỦA APP (_app @936800, @945200):
    //   • TEXT hoặc ẢNH ngoài cửa sổ 24h + !dr(): đi thẳng Extension ⇄ Socket trước (bắn API trước
    //     100% bị FB từ chối (#551)/(#10)). Việc chọn ưu tiên Socket hay Extension được quyết định ĐỘNG
    //     ngay tại thời điểm chuẩn bị xong ctx, kết hợp làn Cao Tốc (0ms Fast-Path) khi đã có sẵn global_id!
    //   • Chat trong cửa sổ 24h hoặc có cờ dr() (quảng cáo ≤7 ngày): bắn API trước như thường.
    if (opts.quick && !opts.skipApi && conv.type !== 'comment') {
      const full = peekConv(conv) || conv;
      const hint = channelHints[conv.id];
      const idleDiff = getConvIdleMs(conv, full);
      const idleLong = !isNaN(idleDiff) && idleDiff > 86400000;
      // [v1.91.94] BẰNG CHỨNG HAR — CỜ is_record_ctx_7_days XOÁ SẠCH (#10):
      //   • CÓ  cờ: 19 success · 5 (#551) · **0 (#10)**
      //   • KHÔNG cờ: 24 (#10) · 4 (#551) · **0 success**
      // Từ v1.91.80 script LUÔN gửi is_record_ctx_7_days=true (cả multipart lẫn JSON), nên
      // tiền đề cũ "chat ngoài 24h gọi API 100% bị từ chối ⇒ đi thẳng Ext" KHÔNG còn đúng.
      // Logic cũ đó là lý do cả lô 3 384 chat chỉ có [API: 13 · Ext: 1 870] — 96 làn HTTP
      // đứng không, mọi thứ dồn vào Ext bị tuần tự hoá ~22 tin/giây.
      // Nay: chat idle >24h VẪN thử API trước (31ms p50). Chỉ khi API trả lỗi thật cho ĐÚNG
      // chat đó mới rơi xuống Ext — cơ chế alreadyTriedApi/dynamicDirect đã có sẵn, không
      // bao giờ gửi lại 2 lần (API lỗi ⇒ chưa phát sinh tin).
      // [v1.91.96] SỬA LẠI KẾT LUẬN SAI CỦA v1.91.94.
      // Chú thích cũ ở đây (v1.91.94) nói "is_record_ctx_7_days xoá sạch (#10)" — SAI.
      // (#10) có HAI e_subcode:
      //   • 2018300 "một ứng dụng khác đang kiểm soát thread"  → cờ ctx7 có tác dụng
      //   • "Tin nhắn này được gửi NGOÀI KHOẢNG THỜI GIAN cho phép" → cờ ctx7 KHÔNG cứu được
      // 19 ca "thành công + có cờ" trong HAR đều là chat TRONG 24h ⇒ chỉ là tương quan,
      // không phải nhân quả. Log thật 09:15 chứng minh: chat ngoài 24h bị (#10)-window và
      // (#551), sau đó Ext gửi ĐƯỢC ngay.
      // Giá phải trả khi bắt API đi trước (1.91.94/1.95): mỗi chat chờ queue 1 218ms +
      // fetch 1 067ms rồi mới rơi về Ext. Lô 312 chat: 2,91 tin/s (so với 20,77 tin/s của
      // 1.91.93 khi Ext đi trước). Vì vậy: chat đã ngoài 24h ⇒ Ext/Socket TRƯỚC như cũ.
      const textOutWin = !photo && idleLong && !isRecordCtx7Days(full);
      const photoOutWin = !!photo && idleLong && !isRecordCtx7Days(full);
      const noApiPhoto = !!(photo && !photo.fbId);
      const alreadyTriedApi = !!(opts.deferredCtx && Array.isArray(opts.deferredCtx.triedChannels) && opts.deferredCtx.triedChannels.indexOf('api') > -1);
      const pidQuick = (full && (full.page_id || full.pageId)) || conv.pageId || String(conv.id || '').split('_')[0];
      const goDirect = batchSkipApi
        || isApiBlockedForPage(pidQuick)
        || alreadyTriedApi
        || noApiPhoto
        || (photo && hint && hint !== 'api')
        || textOutWin
        || photoOutWin;
      if (goDirect) {
        let directOpts;
        if (textOutWin || photoOutWin || noApiPhoto) {
          // Với chat đã ngoài cửa sổ 24h (!isRecordCtx7Days) khi chạy lô lớn (>50 chat):
          // không gọi lại Graph API ở cuối (vì 100% bị FB trả #551/#10, tốn hàng trăm request HTTP vô ích!)
          const skipFutileApi = batchSkipApi || alreadyTriedApi || noApiPhoto || ((textOutWin || photoOutWin) && batchStats && batchStats.total > 50);
          const baseOutPlan = ['ext', 'socket', 'api'].filter((x) => !(skipFutileApi && x === 'api'));
          directOpts = {
            plan: baseOutPlan,
            dynamicDirect: true,
            fastOnly: !!opts.fastOnly,
            deferredCtx: opts.deferredCtx || null,
            sockFired: !!opts.sockFired,
            wave200Mode: !!opts.wave200Mode,
            isSocketRetryPass: !!opts.isSocketRetryPass,
          };
        } else if (batchSkipApi || alreadyTriedApi) {
          directOpts = {
            skipApi: true,
            dynamicDirect: true,
            fastOnly: !!opts.fastOnly,
            deferredCtx: opts.deferredCtx || null,
            sockFired: !!opts.sockFired,
            wave200Mode: !!opts.wave200Mode,
            isSocketRetryPass: !!opts.isSocketRetryPass,
          };
        } else {
          directOpts = {
            directChain: true,
            dynamicDirect: true,
            fastOnly: !!opts.fastOnly,
            deferredCtx: opts.deferredCtx || null,
            sockFired: !!opts.sockFired,
            wave200Mode: !!opts.wave200Mode,
            isSocketRetryPass: !!opts.isSocketRetryPass,
          };
        }
        directOpts.prioritySocket = !!opts.prioritySocket || !!opts.isSocketRetryPass;
        if (opts.awaitDirect) {
          return sendOne(conv, text, photo, directOpts);
        }
        const myRun = runSeq;
        sendOne(conv, text, photo, directOpts).then((r) => {
          if (myRun !== runSeq) return;
          const nm2 = conv.name || conv.id;
          if (r.ok) {
            if (r.fired) return; // bắn-nhả: xác nhận nền tự ghi nhận khi ACK về — không chốt sớm
            markDelivered(conv.id, r.sendBy || 'ext');
            postSendSideEffects(conv);
            logFailGrouped(nm2, 'gửi THÀNH CÔNG qua '
              + (r.sendBy === 'socket' ? 'Socket' : r.sendBy === 'extension' ? 'Extension' : 'API'), '✅', conv.id);
            return;
          }
          // [v1.91.83] CỨU CA KHÔNG CÓ global_id — chỗ rò 57 tin/lô (0,53%).
          // Với lô lớn, chat im >24h bị cắt làn API (skipFutileApi) ⇒ plan chỉ còn
          // ['ext','socket']. Nhưng khi KHÔNG có global_id thì: Ext bị noGidGate chặn,
          // Socket bắt buộc phải có gid ⇒ CẢ HAI đều bất khả, dù làn API là làn DUY NHẤT
          // không cần gid (HAR: URL gửi chỉ dùng convId, 58/58 request không chứa global_id).
          // Nay: gặp đúng tình huống đó thì chuyển sang làn API một lần duy nhất.
          // An toàn chống trùng: fireApiAndWatch đi qua acquireOutbound(conv.id) — nếu chat
          // đã được bắn ở làn khác thì trả dupBlocked, không sinh tin thứ hai.
          if (!r.ok && !r.uncertain && !r.recipientUnavailable
              && (r.gidUnknown || /globalId/i.test(String(r.error || '')))) {
            try {
              sendDiag.apiNoGidFallback = (sendDiag.apiNoGidFallback || 0) + 1;
              logFailGrouped(nm2, 'không có global_id (Ext/Socket đều bất khả) — chuyển làn API', '🛟', conv.id);
              fireApiAndWatch(conv, text, photo);
              return;
            } catch (e0) { /* rơi xuống xử lý cũ */ }
          }
          if (r.uncertain) {
            if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
            logFailGrouped(nm2, '' + r.error + ' (không rõ — không gửi thêm)', '⚠', conv.id);
          } else {
            if (r.windowClosed) windowBlocked++;
            logFailGrouped(nm2, '' + r.error, '❌', conv.id);
          }
          // cửa sổ 24h VẪN bù kênh khác (Thanh Binh); khách khóa nick (recipientUnavailable) hoặc hết kênh → tự bỏ
          if (!r.ok && !r.uncertain && !r.recipientUnavailable && isRetryableLoss(r.error)) {
            chotFailKhongBu(conv);
          } else if (!r.ok && !r.uncertain) {
            if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
          }
        });
        return { ok: true, id: '', sendBy: 'direct', sent: true, fired: true };
      }
      if (opts.wave200Mode && !opts.syncMultiPart) {
        // Wave 200 + Gửi nhanh: đưa API qua apiSendLane (48 luồng), nhường worker ngay;
        // phản hồi OK/lỗi rõ/không rõ vẫn được chốt ở nền như luồng gốc v1.91.72.
        return fireApiAndWatch(conv, text, photo);
      }
      if (!opts.syncMultiPart) {
        return fireApiAndWatch(conv, text, photo);
      }
    }
    // ngữ cảnh dùng chung cho các kênh của CÙNG 1 chat: conversation, threadId, globalId, nonReusableFbId…
    const ctx = (opts.deferredCtx && typeof opts.deferredCtx === 'object') ? opts.deferredCtx : {};
    ctx.fastOnly = !!opts.fastOnly;
    ctx.sockFired = !!opts.sockFired;
    ctx.wave200Mode = !!opts.wave200Mode;
    ctx.isSocketRetryPass = !!opts.isSocketRetryPass;
    ctx.prioritySocket = !!opts.prioritySocket || !!opts.isSocketRetryPass;
    if (ctx.isSocketRetryPass) {
      ctx.socketRetriedOnce = true;
      ctx.wave200Mode = false;
      ctx.nonReusableFbId = null;
      ctx.nonReusableFbIds = null;
    }
    ctx.hasTextMsg = !!(text && String(text).trim().length > 0);
    ctx.deferredToExt = false;
    if (!ctx.fastOnly && ctx.gidResolved && !ctx.gid) {
      ctx.gidResolved = false;
    }
    const channels = {
      api: async () => {
        const r = await sendViaApi(conv, text, photo, ctx);
        // [v1.92.28] ĐẾM đường API ĐỒNG BỘ (`sendViaApi`) — trước đây KHÔNG được đếm ở đâu cả.
        // Lô 10:21: 481 lệnh API thật (đường cứu "thiếu global_id") mà dòng "🌐 API NỀN" vẫn in
        // queued/started/fetch 0/0/0 vì chỉ `fireApiAndWatch` (đường nền) tăng bộ đếm ⇒ số liệu
        // vô dụng khi truy nguyên. `queued` vẫn là của đường nền (đường này không qua hàng đợi).
        if (!(r && r.dupBlocked)) {
          sendDiag.apiStarted++;
          if (r && r.ok) sendDiag.apiSuccess++;
          else if (r && r.sent === 'maybe') sendDiag.apiUnknown++;
          else sendDiag.apiRejected++;
        }
        if (!r.ok && r.sent !== 'maybe' && isThreadControlError(r.error)) {
          apiThreadBlockStreak++;
          if (apiThreadBlockStreak >= 3 && !batchSkipApi) {
            batchSkipApi = true;
            markApiBlockedForPage(conv.pageId || String(conv.id || '').split('_')[0]);
            try { logLine('⛔ API bị chặn cấp page (' + apiThreadBlockStreak + ' ca thread-control liên tiếp) — các chat sau đi thẳng Ext/Socket.'); } catch (e0) { /* ignore */ }
          }
        } else if (r.ok) {
          apiThreadBlockStreak = 0;
        }
        return r;
      },
      socket: () => sendViaSocket(conv, text, photo, ctx),
      ext: () => sendViaExtension(conv, text, photo, ctx),
    };
    const order = (conv.type === 'comment') ? ['api', 'ext'] : ['api', 'ext', 'socket'];
    let seq;
    if (opts.plan && opts.plan.length) {
      seq = opts.plan.slice();
    } else {
      const hint = channelHints[conv.id];
      seq = (hint && order.indexOf(hint) > -1)
        ? [hint].concat(order.filter((x) => x !== hint))
        : order.slice();
      if (batchSkipApi || (photo && !photo.fbId && conv.type !== 'comment')) {
        seq = seq.filter((x) => x !== 'api');
      }
      if (opts.skipApi) seq = seq.filter((x) => x !== 'api');
      if (opts.directChain) {
        seq = seq.filter((x) => x !== 'api');
        if (!batchSkipApi && !(photo && !photo.fbId)) seq.push('api');
      }
    }

    // 🚀 LÀN CAO TỐC 0ms (ULTRA-TURBO FAST-PATH CHO CẢ TEXT VÀ ẢNH):
    // Nếu là luồng gửi thẳng ngoài 24h (dynamicDirect):
    //   • Kiểm tra đồng bộ 0ms xem chat này đã có sẵn global_id thật trong RAM/Cache/WebSocket chưa (peekFastGlobalId).
    //   • Nếu ĐÃ CÓ SẴN global_id thật: điền thẳng vào ctx ở 0ms và KHÔNG vào extPrepLane.
    //     [v1.92.52] ĐÍNH CHÍNH: dòng cũ ở đây ghi "BỎ QUA HOÀN TOÀN extPrepLane" cho cả trường
    //     hợp KÈM ẢNH — SAI. Nhánh fast-path bên dưới (dòng ~7402) vẫn gọi
    //     `uploadOneTimePhoto()` để bind fbId riêng cho chat đó (is_reusable=false) rồi mới publish.
    //     Bằng chứng số (lô 8 509 chat, 12:24, bản 1.92.51): `📷 bind fbId 8 186 ca · TB 842 ms`
    //     và giữ slot 5 741 ms/chat (lô KHÔNG ảnh chỉ 1 362 ms/chat) ⇒ bind ảnh nằm TRONG slot,
    //     chiếm ~842/5 741 ≈ 15 % thời gian giữ slot. Chú thích sai này từng làm báo cáo kết luận
    //     nhầm là "ảnh không nằm trong slot".
    //   • Nếu chưa có trong RAM: vào prepareDirectCtx (chạy song song resolveGlobalId + uploadOneTimePhoto).
    const peeked0 = peekConv(conv) || conv;
    const pid0 = (peeked0 && (peeked0.page_id || peeked0.pageId)) || conv.pageId || String(conv.id || '').split('_')[0];
    if (opts.dynamicDirect && conv.type !== 'comment' && (seq[0] === 'ext' || seq[0] === 'socket')) {
      const fastGid0 = peekFastGlobalId(conv, peeked0, '');
      const tid0 = (peeked0 && (peeked0.thread_id || peeked0.threadId)) || conv.threadId || '';
      if (fastGid0 && (tid0 || isPageSocketReady(pid0) || (pid0 && socketWarmPromises[pid0]))) {
        const srvGid0 = peeked0 && (gidFromPayload(peeked0) || peeked0.globalId
          || (peeked0.customers && peeked0.customers[0] && peeked0.customers[0].global_id));
        if (!ctx.fastHitCounted) {
          ctx.fastHitCounted = true;
          gidStats.cacheHit++;
        }
        ctx.full = peeked0;
        ctx.fullLoaded = true;
        if (tid0) {
          ctx.threadId = String(tid0);
          ctx.threadResolved = true;
        }
        ctx.gid = String(fastGid0);
        ctx.gidResolved = true;
        ctx.gidFromPsid = false;
        ctx.gidFromServerOrCache = !!(srvGid0 && String(srvGid0) === String(fastGid0));
      } else {
        await extPrepLane(() => prepareDirectCtx(conv, photo, ctx));
        if (ctx.deferredToExt) {
          return { ok: false, sent: false, deferredToExt: true, deferredCtx: ctx };
        }
        if (ctx.noGidConfirmedByExt && (!ctx.gid || ctx.gidFromPsid)) {
          if (ctx.gidGateSkipExt) {
            // GATE NO-GID: HTTP/Batch/WS/Ext đều đã xác nhận không có global_id ở khâu dò.
            // Không bắn REPLY_INBOX_PHOTO thread-only nữa — đây là nút nghẽn 6 luồng ở đuôi lô.
            recycleUnusedFbId(pid0, ctx);
            // [v1.92.26] LỖ RÒ 51 TIN (lô 10:04): gate này trả ❌ mà KHÔNG thử làn API, dù
            // lệnh gửi API chỉ dùng conversation_id (HAR: 58/58 request gửi không có
            // global_id). Đó là lý do log ghi "🌐 API NỀN queued 0 · fallback 0" trong khi
            // 51 chat (2,1% lô) không hề được gửi ở kênh nào. Nay: còn làn API dùng được thì
            // đi thẳng làn API; chưa bắn gì nên tuyệt đối không thể trùng.
            const canApiNoGid = !batchSkipApi && !isApiBlockedForPage(pid0)
              && seq.indexOf('api') < 0 && !(photo && !photo.fbId) && conv.type !== 'comment';
            if (canApiNoGid) {
              seq.push('api');
              ctx.apiNoGidFirst = true;
              ctx.gidUnknown = false;
              ctx.noGidConfirmedByExt = false;
              ctx.extThreadOnlyRescue = true;
              ctx.gid = null;
              ctx.gidFromPsid = false;
              ctx.gidResolved = true;
              sendDiag.apiNoGidFallback++;
              ctx.apiNoGidDone = true; // [v1.92.28] đã xử lý ⇒ không chạy lại khối cứu bên dưới (tránh 2 dòng 🛟/ca)
              logFailGrouped((conv.name || conv.id),
                'server/Batch/WS/Ext đều không có global_id ⇒ chuyển làn API bằng conversation_id'
                + ' (HAR: lệnh gửi API không cần global_id)', '🛟', conv.id);
            } else {
              return {
                ok: false, sent: false, gidUnknown: true, noGidGate: true,
                discoveryState: ctx.gidDiscoveryState || 'ext-responded-no-gid',
                error: 'Không tìm được global_id để gửi (server/Batch/WS/Ext đều không có) — bỏ qua Ext thread-only cho nhanh',
              };
            }
          }
          // Chưa hề có tin nào được bắn cho chat này, nên cứu hộ ở đây không thể gây trùng:
          // thử Extension bằng thread_id trước, sau đó API bằng conversation_id (đúng fallback
          // của luồng gửi tay trong _app: extension -> socket -> api). Không còn chốt oan
          // "khách đã khóa nick" chỉ vì bước DÒ global_id trả null.
          if (!ctx.apiNoGidDone) {
            ctx.noGidConfirmedByExt = false;
            ctx.extThreadOnlyRescue = true;
            ctx.gid = null;
            ctx.gidFromPsid = false;
            ctx.gidResolved = true;
            const canApiRescue = !batchSkipApi && seq.indexOf('api') < 0 && !(photo && !photo.fbId);
            if (canApiRescue) seq.push('api');
            logFailGrouped((conv.name || conv.id),
              'chưa dò được global_id; chưa kết luận khách khóa nick, sẽ thử Extension theo thread_id'
              + (canApiRescue ? ' và API theo conversation_id như đường gửi tay' : ''), '🛟', conv.id);
          }
        }
      }
      const pid = (ctx.full && (ctx.full.page_id || ctx.full.pageId)) || pid0;
      seq = pickBestDirectOrder(conv, pid, ctx, seq);
      // [v1.92.26] Không có global_id ⇒ Ext/Socket chắc chắn bất khả, chỉ còn làn API:
      // đưa lên đầu để khỏi tốn 3 lượt thử vô ích cho mỗi ca.
      if (ctx.apiNoGidFirst) seq = ['api'].concat(seq.filter((x) => x !== 'api'));
    }

    const tried = Array.isArray(ctx.triedErrors) ? ctx.triedErrors.slice() : [];
    const triedCh = Array.isArray(ctx.triedChannels) ? ctx.triedChannels.slice() : [];
    // Chỉ đánh dấu "gid chưa rõ" khi một kênh thật sự cho biết đang thiếu gid.
    // Lỗi API độc lập (chưa hề cần gid) không được kéo cả chat sang Pass 2 oan.
    let sawGidUnknown = !!(ctx.gidUnknown && !ctx.gid && conv.type !== 'comment');
    // [v1.92.13] Chat bị CHÍNH BỘ NGẮT QUÁ TẢI của Ext chặn (chưa hề bắn lệnh nào ⇒ chắc chắn
    // chưa đi) — phải phân biệt với "khách chết" để còn xếp lại, xem runMainItem.
    let sawExtOverload = false;
    if (triedCh.length) {
      seq = seq.filter((x) => triedCh.indexOf(x) < 0);
    }
    for (let i = 0; i < seq.length; i++) {
      const ch = seq[i];
      if (state.stopRequested) break;
      // Trong Làn Nhanh (ctx.fastOnly === true): không giữ chân worker để đứng chờ Extension (extSendLane),
      // mà đẩy sang hồ nền extBacklogQueue xử lý nốt!
      if (ctx.fastOnly && ch === 'ext') {
        ctx.triedErrors = tried.slice();
        ctx.triedChannels = triedCh.slice();
        return { ok: false, sent: false, deferredToExt: true, deferredCtx: ctx };
      }
      const r = (ch === 'api')
        ? await channels[ch]()
        : (ctx.fullLoaded && ctx.gidResolved
          ? await channels[ch]()
          : await busEnqueue(() => channels[ch](), ch));
      if (r && r.deferredToSocketRetry) {
        return { ok: false, sent: false, deferredToSocketRetry: true, deferredCtx: r.deferredCtx || ctx };
      }
      if (r && r.deferredToExt) {
        ctx.triedErrors = tried.slice();
        ctx.triedChannels = triedCh.slice();
        return { ok: false, sent: false, deferredToExt: true, deferredCtx: ctx };
      }
      if (r.ok) {
        markChannel(conv.id, ch);
        return { ok: true, id: r.id || '', sendBy: r.sendBy || ch, sent: true, fired: !!r.fired };
      }
      triedCh.push(ch);
      tried.push((ch === 'ext' ? 'Ext' : ch) + ': ' + (r.error || 'fail'));
      if (r.gidUnknown) sawGidUnknown = true;
      // [v1.92.40] KHÔNG tăng extOverloadSkips ở đây nữa — đã tăng ngay chỗ bộ ngắt chặn
      // (sendViaExtension), nếu không mỗi ca bị đếm 2 lần.
      if (r.extBreakerOpen) sawExtOverload = true;
      // [v1.92.30] `sent:false` nhưng là PHÁN ĐOÁN (Socket bị FB từ chối / Ext trả lỗi có lý do /
      // API success:false) ⇒ KHÔNG chạy kênh kế ngay tại đây. Chuyển sang cổng "chứng minh vắng
      // mặt": nếu hội thoại ĐÃ CÓ tin thì hủy bù (chặn lặp), chứng minh được vắng mặt thì mới bắn.
      // Worker được giải phóng NGAY (trả về đây) ⇒ tốc độ lô không bị bù chồng giữ lại.
      // KHÔNG áp cho 2 ca mà code đã có bằng chứng riêng: khách không nhận được tin
      // (recipientUnavailable — FB trả mã 1545041 / "không có mặt") và token hỏng.
      if (r.ambiguous && !r.recipientUnavailable && !(r.error && r.error.indexOf('Token') === 0)) {
        recycleUnusedFbId(pid0, ctx);
        sendDiag.buProofGated++;
        scheduleBuRetry(conv, text, photo, (conv.name || conv.id),
          (ch === 'ext' ? 'Extension' : (ch === 'socket' ? 'Socket' : 'API')) + ' báo lỗi ('
            + clip(String(r.error || 'không rõ'), 70) + ')',
          triedCh.slice(), { ambiguous: true, via: ch, sentAt: Date.now() });
        return {
          ok: false, gated: true, sent: 'maybe', tried: triedCh.slice(),
          error: tried.join(' | ') + ' — đang chứng minh vắng mặt trước khi bù (không bắn mù)',
        };
      }
      // "không rõ" = tin CÓ THỂ đã đi — thử tiếp kênh khác sẽ gửi TRÙNG → dừng ngay
      if (r.sent === 'maybe') {
        recycleUnusedFbId(pid0, ctx);
        return { ok: false, uncertain: true, sent: 'maybe', tried: triedCh.slice(), error: tried.join(' | ') };
      }
      // Khách đã khóa nick/chặn page được chính Extension xác nhận bằng global_id thật
      // (fbErrorCode 1545041) hoặc (#100) không tìm thấy người dùng → dừng luôn
      /* [v1.92.45] DANH SÁCH KÊNH ĐÃ CẠN + FB ĐÃ NÓI RÕ LÝ DO ⇒ chốt ⚠ NGAY, không cổng 10 s.
       * `seq` ở đây là các kênh CÒN LẠI. Rỗng nghĩa là đã thử hết mọi kênh mà không kênh nào
       * nhận; cộng với việc lý do là loại dứt khoát (khách không có mặt / ngoài 24h / thread bị
       * app khác giữ / 1545012 tạm thời) ⇒ không còn gì để chờ. Không đánh ✅ oan (vẫn ⚠ +
       * danh sách gửi tay), chỉ bỏ 10 s chờ vô ích.
       * Ca mơ hồ thật (Socket mất ACK, Ext quá hạn) KHÔNG đi qua đây vì chúng trả `ambiguous`
       * hoặc `sent:'maybe'` với lý do không khớp `isDefinitiveNotSent`. */
      if (!seq.length && isDefinitiveNotSent(r.error || '') && !r.recipientUnavailable) {
        recycleUnusedFbId(pid0, ctx);
        return {
          ok: false, sent: false, definiteFail: true, definitiveNotSent: true,
          tried: triedCh.slice(),
          error: tried.join(' | ') + ' — FB từ chối dứt khoát ở mọi kênh đã thử (chốt ngay, không chờ xác nhận)',
        };
      }
      if (r.recipientUnavailable || /\(#100\)|Không tìm thấy người dùng phù hợp/i.test(r.error || '')) {
        recycleUnusedFbId(pid0, ctx);
        /* ═══ [v1.93.5] FB ĐÃ BÁO KHÔNG NHẬN ĐƯỢC ⇒ CẮT BÙ LUÔN, KHÔNG DÒ EXT, KHÔNG GỬI TAY ═══
         * ĐO ĐƯỢC trên 28 log — đây là nhóm lỗi thật nhiều nhất:
         *   534 dòng `❌ … Ext: Extension không gửi được (… "Người này hiện không có mặt." …)`
         *   307 dòng `❌ … bù Extension không được: … không có mặt`
         *   262 dòng `🛟 Socket: FB từ chối — chuyển Extension 1 lần` + `⏳ … đang bù qua Extension…`
         *   222 dòng `⚠ … đã đo N ca thì Extension cũng bị chặn ⇒ GIỮ ⚠, vào danh sách gửi tay`
         * Người dùng đã kiểm: nhóm này KHÔNG nhận được tin. Ngân sách dò Ext cũng đã tự đo và
         * đóng (`extFallback1545Allowed()` trả false) — tức chính code đã kết luận "Ext cũng bị
         * chặn", nhưng vẫn còn 3 nhánh nữa tiếp tục dò/bù/gửi tay.
         * NAY: `isFbRejected()` (đã được ghi ở sendViaExtension / API #551 / ACK rejected) là
         * chốt chặn cuối ⇒ chốt ❌ ngay, KHÔNG chuyển Ext, KHÔNG vào danh sách gửi tay.
         * Không thêm một lệnh gửi nào — đây là BỎ các lần thử đã được đo là 0/N cứu được.
         * Ca KHÔNG có dấu FB-từ-chối (vd only `#100` chưa qua Ext) vẫn đi đường cũ. */
        if (isFbRejected(conv.id) && !conv.__extFallback1545) {
          fbRejectStats.blockedBu = (fbRejectStats.blockedBu || 0) + 1;
          return { ok: false, sent: false, recipientUnavailable: true, fbRejected: true,
            tried: triedCh.slice(), error: 'FB đã báo KHÔNG NHẬN ĐƯỢC — cắt bù (không dò Ext, không gửi tay)' };
        }
        /* [v1.92.41] "NGƯỜI NÀY HIỆN KHÔNG CÓ MẶT" (1545041) là lỗi CỦA KÊNH, không phải bằng
         * chứng khách chặn: Socket đã bị từ chối như vậy 5 800 lần trong 2 lô 16:07/16:11, trong
         * khi Extension — đi qua tab Facebook thật — gửi được 186 tin. Chưa có tin nào được gửi
         * ⇒ thử Extension 1 lần là an toàn tuyệt đối, và có ngân sách dò 200 ca để tự đóng nếu
         * Extension cũng bị chặn y như vậy. */
        const _isNoFace1545 = /1545041|không có mặt/i.test(String(r.error || ''));
        const _extAvail1545 = !!(window.__ExtensionAdapter__ && typeof window.__ExtensionAdapter__.send === 'function');
        if (_isNoFace1545 && ch !== 'ext' && _extAvail1545 && !conv.__extFallback1545) {
          if (extFallback1545Allowed()) {
            conv.__extFallback1545 = true;
            noteExt1545Attempt();
            scheduleBuRetry(conv, text, photo, (conv.name || conv.id),
              'FB báo "người này hiện không có mặt" ở kênh ' + ch, triedCh.slice(),
              { ambiguous: false, fromUncertain: true, via: ch, sentAt: Date.now() });
            return {
              ok: false, gated: true, sent: 'maybe', tried: triedCh.slice(),
              error: 'FB báo "người này hiện không có mặt" ở kênh ' + ch
                + ' — tin CHƯA gửi ⇒ thử Extension 1 lần (không thể trùng)',
            };
          }
          conv.__extFallback1545 = true;
          /* ═══ [v1.92.66] CÂU NÀY TỪNG LÀ LỜI NÓI DỐI — ĐÃ SỬA ═══
           * Bản cũ in CỐ ĐỊNH: "đã đo 200 ca thì Extension cũng bị chặn". Lô 19:48 lặp câu đó
           * 3 611 lần trong khi `extTry1545.tried` = 0 và KHÔNG có dòng 🔒 nào ⇒ chưa từng đo
           * 200 ca nào. Nay in SỐ THẬT, và nói đúng việc đang xảy ra: ca này CHƯA được thử qua
           * Ext (vì ngân sách đang đóng), nên nó vẫn có thể gửi được nếu bạn gửi tay. */
          /* [v1.93.5] FB ĐÃ BÁO KHÔNG NHẬN ĐƯỢC (1545041) ⇒ ❌, KHÔNG vào danh sách gửi tay.
           * Chốt của người dùng: "cái nào báo lỗi thật thì cắt bù luôn, khỏi tốn thời gian".
           * Giữ ⚠ chỉ cho ca CHƯA từng bị FB từ chối. */
          if (isFbRejected(conv.id)) {
            fbRejectStats.blockedBu = (fbRejectStats.blockedBu || 0) + 1;
            return { ok: false, sent: false, recipientUnavailable: true, fbRejected: true,
              tried: triedCh.slice(), error: 'FB đã báo KHÔNG NHẬN ĐƯỢC (1545041) — chốt ❌, không gửi tay' };
          }
          return {
            ok: false, sent: false, uncertain: true, tried: triedCh.slice(),
            error: 'FB báo "người này hiện không có mặt" · ngân sách dò Ext đang ĐÓNG (đã định bắn '
              + extTry1545.tried + ' ca, cứu ' + extTry1545.saved + ' ⇒ Ext coi như cũng bị chặn)'
              + ' — ca này CHƯA thử qua Ext · GIỮ ⚠ (chưa gửi), vào danh sách gửi tay',
          };
        }
        // [v1.92.34] Chốt ❌ NGAY (không bù, không kiểm chứng trong lượt — chống gửi lặp),
        // nhưng ghi vào sổ để SAU LÔ tự đọc lại lịch sử: nếu tin thật ra đã tới thì lật ✅.
        /* [v1.93.5] KHÔNG HẬU KIỂM 25 s CHO CA FB ĐÃ TRẢ LỜI DỨT KHOÁT.
         * Số đo 2 lô của chính cơ chế này (1.92.42): 1 338 ca dò lại ⇒ 0 ca thấy tin.
         * Người dùng đã kiểm: nhóm 1545041 KHÔNG nhận được tin ⇒ hậu kiểm chỉ tốn thời gian.
         * Ca CÓ từ chối nhưng KHÔNG phải 1545041 (`deadUserHint` từ nguồn khác) vẫn hậu kiểm
         * như cũ — đường này CHỈ ĐỌC nên giữ lại không hại gì. */
        if (r.deadUserHint && !isFbRejected(conv.id)) queueDeadUserRecheck(conv, text, photo, Date.now());
        return { ok: false, sent: false, recipientUnavailable: true, tried: triedCh.slice(), error: tried.join(' | ') };
      }
      // Nếu vừa dùng from_psid phỏng đoán (ctx.gidFromPsid === true) hoặc lỗi thiếu globalId/thread_id:
      // bắt buộc mở khóa ctx.gidResolved = false để kênh kế tiếp dò lại global_id thật (nhỡ WebSocket
      // hoặc Extension vừa nạp xong), tuyệt đối không bắn tiếp bằng from_psid sai!
      // Riêng Ext INCORRECT THREAD khi CHƯA có globalId thật: KHÔNG reset
      // gidDiscoveryRan — Socket kế tiếp vẫn được kiểm tra cache/WS ở 0ms
      // trong resolveGlobalId, nhưng không mở lại toàn bộ cuộc đua
      // HTTP/WS/Ext lần thứ hai cho cùng một ca.
      const incorrectThreadNoGid = /INCORRECT THREAD/i.test(r.error || '') && !(ctx && ctx.gid && !ctx.gidFromPsid);
      if ((ctx && ctx.gidFromPsid) || (conv.fromPsid && /globalId|thread_id/i.test(r.error || '')) || incorrectThreadNoGid) {
        ctx.gidForceFind = true;
        ctx.gidResolved = false;
        ctx.gidFromPsid = false;
        ctx.gid = null;
      }
      // [v1.92.27] THIẾU global_id Ở BẤT KỲ KÊNH NÀO ⇒ vẫn còn làn API.
      // Lệnh gửi API chỉ cần conversation_id (HAR: 0/58 request gửi có global_id), nên chat
      // không dò được gid vẫn PHẢI được gửi. Trước đây plan ['api','ext','socket'] mà api bị
      // loại (ngoài 24h) thì Ext/Socket đều bất khả ⇒ kết thúc ❌ mà chưa hề gửi.
      if (r.gidUnknown && !batchSkipApi && conv.type !== 'comment'
          && !(photo && !photo.fbId) && seq.indexOf('api') < 0) {
        const pidLoop = (ctx.full && (ctx.full.page_id || ctx.full.pageId)) || conv.pageId
          || String(conv.id || '').split('_')[0];
        if (pidLoop && !isApiBlockedForPage(pidLoop)) {
          seq.push('api');
          sendDiag.apiNoGidFallback++;
        }
      }
      if (r.error && r.error.indexOf('Token') === 0) {
        recycleUnusedFbId(pid0, ctx);
        return r; // token hỏng — dừng hẳn
      }
    }
    recycleUnusedFbId(pid0, ctx);
    return {
      ok: false, sent: false, tried: triedCh.slice(),
      extOverloaded: sawExtOverload && !deliveredIds[conv.id],
      gidUnknown: !!(sawGidUnknown && !(ctx.gid && !ctx.gidFromPsid)),
      discoveryState: (ctx && ctx.gidDiscoveryState) || '',
      /* [v1.92.53] `windowClosed` CHƯA BAO GIỜ ĐƯỢC GÁN ⇒ `🚫 n lần API bị chặn ngoài cửa sổ 24h`
       * luôn in 0 hoặc 1. Bằng chứng số (lô 8 509, 12:24): 375 ca ❌ ghi
       * "api: (#10) ngoài 24h | Ext: không gid | socket: không gid" và 167 ca ❌ ghi
       * "api: (#551) không có mặt" ⇒ tổng ≥ 542 ca bị chặn cửa sổ, nhưng TỔNG HỢP in
       * "🚫 1 lần". Hai chỗ đọc `r.windowClosed` (7309, 10948) chưa từng thấy giá trị true.
       * Nay suy thẳng từ chuỗi lỗi cuối cùng — chỉ đọc thêm, KHÔNG đổi nhánh gửi/bù nào. */
      windowClosed: isWindowClosedError(tried.join(' | ')),
      error: tried.join(' | '),
    };
  }

  // ===== CACHE BỀN VỮNG GLOBAL_ID (LOCALSTORAGE + INDEXEDDB "fb_meta_data") & VÁ MQTTHELPER =====
  // 1) Lưu mọi global_id THẬT (!gidFromPsid) vào localStorage (ssb_global_id_cache_v1) + nạp toàn bộ
  //    IndexedDB "fb_meta_data" (2 bảng "global_user_ids" & "global_user_ids_2" của Pancake @814000)
  //    vào RAM ngay khi chạy → sau F5 vẫn có sẵn global_id của hàng nghìn chat ở 0ms!
  // 2) Vá trực tiếp lỗi nội tại của window.__MqttHelper__ trong bundle Pancake (@822420–828800):
  //    - triggerLoadMoreThreads(e, t) của Pancake truyền nhầm `t` (Object) thay vì `t.step` (Array)
  //      vào findBlockAction(t, "setBusinessThreadInfo") → luôn trả null → mỗi trang loadThread (~15
  //      chat) bị ngủ cứng hết setTimeout 5.000ms (5s/trang = 3 chat/s, mất 59s cho 12 trang đầu ở
  //      log 10:15:26→10:16:25 và >8 phút cho 1.500 chat!). Vá truyền đúng `t.step` + kiểm tra đủ
  //      setBusinessThreadInfo / deleteThenInsertThread / updateFilteredThreadsRanges → giải phóng
  //      loading_thread_{pageId} ngay khi gói WS về (~80ms/trang thay vì 5.000ms/trang — nhanh gấp 60x).
  //    - initLoadThread / resolveSearchGlobalIdTask giới hạn maxLoadThreadCount = 10 (15 trang ~ 225
  //      chat) và tự gán -1 dừng sớm → nâng lên 500 trang (7.500+ chat) suốt phiên gửi.
  const GID_LS_KEY = 'ssb_global_id_cache_v1';
  const persistentGidMap = {};
  try {
    const rawGids = JSON.parse(localStorage.getItem(GID_LS_KEY) || '{}');
    if (rawGids && typeof rawGids === 'object') {
      // lọc bỏ gid đã nhiễm '[object Object]' từ các phiên cũ — không nạp lại vào RAM
      Object.keys(rawGids).forEach((k) => { if (!/^\[object /.test(String(rawGids[k]))) persistentGidMap[k] = rawGids[k]; });
    }
  } catch (e) { /* ignore */ }

  let gidSaveTimer = null;
  let gidFlushIdleHandle = null;
  /* [v1.92.57] GHI CACHE GID KHÔNG ĐƯỢC CHẶN MAIN THREAD GIỮA LÚC ĐANG THAO TÁC.
   * Đo trên Chromium 153 (tools/_bench_gidflush.mjs): JSON.stringify + setItem cả map
   *   2 000 khoá →   1,5 ms   20 000 →  18,7 ms   60 000 → 34,2 ms   120 000 → 65,8 ms
   * Trong lúc TẢI danh sách, mỗi chat gọi `__botfakeSaveGid__` ⇒ hẹn flush 400 ms; mỗi lần
   * flush là ngần ấy ms chặn main thread, đúng lúc người dùng đang Alt-click chọn chuỗi.
   * Nay: chờ lúc máy RẢNH (requestIdleCallback timeout 2000) — vẫn ghi, chỉ không chen vào
   * giữa cú click. Không có rIC (trình duyệt cũ) thì setTimeout 0 như mọi timer khác.
   * Không mất dữ liệu: 'pagehide' vẫn gọi persistLogStorage + gid flush ngay (xem bên dưới). */
  function flushPersistentGids() {
    gidSaveTimer = null;
    gidFlushIdleHandle = null;
    try { localStorage.setItem(GID_LS_KEY, JSON.stringify(persistentGidMap)); } catch (e) { /* ignore */ }
  }
  /* ═══ [v1.92.66] CHIA SẺ CACHE global_id GIỮA CÁC TAB — TRƯỚC ĐÂY MỖI TAB TỰ DÒ LẠI ═══
   * Người dùng chạy 2–3 page trên 2–3 tab cùng lúc. `ssb_global_id_cache_v1` là
   * localStorage (DÙNG CHUNG giữa các tab cùng origin), nhưng code chỉ ĐỌC nó MỘT LẦN lúc
   * nạp trang (`JSON.parse(localStorage.getItem(GID_LS_KEY))` ở đầu file) và KHÔNG hề nghe
   * sự kiện `storage`. Grep cả file: `addEventListener('storage'` = **0**.
   * Hệ quả: tab B mở sau tab A vẫn phải dò lại từ đầu những gid mà tab A đã dò xong — đo được
   * ở lô 19:48: `dò gid 230 ca · TB 9 894 ms` (lượt 1: 154 ca/TB 11 646 ms). Đó là 230 slot-giây
   * nằm TRONG thời gian giữ slot, tức chặn trực tiếp đường gửi.
   * Nay: nghe `storage` ⇒ nạp phần gid tab khác vừa thêm vào RAM của tab này (chỉ ĐỌC, không
   * ghi ngược ⇒ hai tab không đè nhau), rồi `softNotify('gid')` để mọi chỗ đang chờ gid thức
   * ngay thay vì chờ hết hạn dò. Không thêm lệnh gửi nào; gid vẫn là dữ liệu chỉ đọc.
   * CHỐNG HỒI QUY: nếu sự kiện này bắn dồn (nhiều tab cùng ghi) thì vẫn rẻ — mỗi lần chỉ so
   * số khoá, và `applyPeerGidPayload` bỏ qua khoá đã có cùng giá trị. */
  function applyPeerGidPayload(rawObj) {
    if (!rawObj || typeof rawObj !== 'object') return 0;
    let applied = 0;
    Object.keys(rawObj).forEach((k) => {
      const v = rawObj[k];
      if (!v || /^\[object /.test(String(v))) return;
      const s = String(v);
      if (persistentGidMap[k] === s) return;
      persistentGidMap[k] = s;
      putGidToMemCaches(k, s);
      applied++;
    });
    if (applied) { try { softNotify('gid'); } catch (eN) { /* ignore */ } }
    return applied;
  }
  try {
    window.addEventListener('storage', (ev) => {
      try {
        if (!ev || ev.key !== GID_LS_KEY || !ev.newValue) return;
        applyPeerGidPayload(JSON.parse(ev.newValue));
      } catch (eSt) { /* ignore */ }
    }, false);
  } catch (eStAdd) { /* ignore */ }
  /* [v1.92.57] LỊCH GHI: TỐI THIỂU 1 500 ms GIỮA HAI LẦN, và ghi lúc máy RẢNH.
   * Bản nháp đầu của tôi chỉ đẩy sang `requestIdleCallback` mà KHÔNG giữ khoảng cách:
   * rIC bắn rất sớm khi trang rảnh ⇒ hoá ra ghi DÀY HƠN cả bản cũ 400 ms. Đo A/B trên
   * Chromium 153 với 60 000 khoá: bản nháp đó chiếm 31,2 % CPU (1 252 ms long task) so với
   * 12,6 % của bản cũ — tức là tự làm chậm đi. Nay phải đủ CẢ HAI điều kiện:
   *   1) đã qua ≥ 1 500 ms kể từ lần ghi trước (gộp nhiều lần ghi thành một), VÀ
   *   2) máy đang rảnh (không chen vào giữa cú click của người dùng).
   * Gid là CACHE: mất tối đa 1,5 s gần nhất khi tab sập là chấp nhận được (nó dò lại được),
   * đổi lại không còn khựng main thread giữa lúc thao tác. 'pagehide' vẫn ghi nốt ngay. */
  let gidFlushDueAt = 0;
  function scheduleGidFlush() {
    if (gidSaveTimer || gidFlushIdleHandle) return;
    const now = Date.now();
    const wait = Math.max(0, gidFlushDueAt - now);
    gidSaveTimer = setTimeout(() => {
      gidSaveTimer = null;
      gidFlushDueAt = Date.now() + 1500;
      try {
        if (typeof requestIdleCallback === 'function') {
          gidFlushIdleHandle = requestIdleCallback(() => { gidFlushIdleHandle = null; flushPersistentGids(); }, { timeout: 1000 });
          return;
        }
      } catch (e) { /* ignore */ }
      flushPersistentGids();
    }, wait < 1500 ? 1500 : wait);
  }

  function putGidToMemCaches(key, val) {
    if (!key || !val || /^\[object /.test(String(val))) return; // chặn gid nhiễm '[object Object]'
    const s = String(val);
    persistentGidMap[key] = s;
    try {
      if (!window.__tempGlobalIdCache__) {
        const m = new Map();
        window.__tempGlobalIdCache__ = { get: (k) => m.get(k), set: (k, v) => m.set(k, v) };
      }
      window.__tempGlobalIdCache__.set(key, s);
      if (window.__GlobalIdCacheTest__ && typeof window.__GlobalIdCacheTest__.set === 'function') {
        window.__GlobalIdCacheTest__.set(key, s);
      }
    } catch (e) { /* ignore */ }
  }

  // Khôi phục sẵn các global_id từ localStorage vào RAM ngay lúc nạp script
  try {
    if (!window.__tempGlobalIdCache__) {
      const m0 = new Map();
      window.__tempGlobalIdCache__ = { get: (k) => m0.get(k), set: (k, v) => m0.set(k, v) };
    }
    Object.keys(persistentGidMap).forEach((k) => putGidToMemCaches(k, persistentGidMap[k]));
  } catch (e) { /* ignore */ }

  window.__botfakeSaveGid__ = function (convId, pageId, threadId, gid) {
    if (!gid || /^\[object /.test(String(gid))) return; // chặn gid nhiễm '[object Object]'
    const s = String(gid);
    if (convId) putGidToMemCaches(String(convId), s);
    if (pageId && threadId) putGidToMemCaches(String(pageId) + '_' + String(threadId), s);
    softNotify('gid'); // [v1.92.9] mọi chỗ đang chờ gid thức ngay
    scheduleGidFlush();
    try {
      const fbStore = window.__FBMetaDataStore__;
      if (fbStore && typeof fbStore.insertGlobalId === 'function' && pageId && threadId) {
        fbStore.insertGlobalId(String(pageId), String(threadId), s, 'global_user_ids_2');
      }
    } catch (e) { /* ignore */ }
  };

  let idbPreloaded = false;
  /* [v1.92.57] ĐÃ NẠP CHƯA? `putGidToMemCaches` LUÔN ghi vào CẢ BA nơi (persistentGidMap,
   * __tempGlobalIdCache__, __GlobalIdCacheTest__) nên sau lần đổ ĐẦU TIÊN ở khởi động (dòng
   * `Object.keys(persistentGidMap).forEach(putGidToMemCaches)` gần `__botfakeSaveGid__`), hai
   * cache RAM đã có ĐỦ mọi khoá ⇒ nạp lại là làm thừa đúng bằng toàn bộ cache.
   * Vì sao phải sửa: `warmUpSockets()` gọi hàm này ở MỖI LẦN người dùng chọn chat/chuỗi
   * (`computeMatches` → `schedulePreloadSelectedChats` → `preloadSelectedChats` → `warmUpSockets`).
   * Đo trên Chromium 153 với 60 000 khoá: 15 ms/lần, chặn main thread ngay giữa lúc đang thao tác.
   * Nay chỉ nạp lại phần CÒN THIẾU: quét tìm khoá nào cache RAM chưa có — bình thường (đã đủ)
   * là một lượt `Map.get`/gán, không tạo mảng mới, không gọi set hàng chục nghìn lần.
   * KHÔNG đổi hành vi: vẫn bảo đảm mọi gid trong persistentGidMap có mặt trong cache RAM. */
  let gidMemPrimed = false;
  function preloadPersistentGlobalIds() {
    try {
      if (!gidMemPrimed) {
        Object.keys(persistentGidMap).forEach((k) => putGidToMemCaches(k, persistentGidMap[k]));
        gidMemPrimed = true;
      }
      /* Không cần nhánh "vá khoá thiếu": `putGidToMemCaches` là ĐƯỜNG GHI DUY NHẤT vào
       * persistentGidMap và nó LUÔN ghi kèm vào __tempGlobalIdCache__ ⇒ sau lần đổ đầu, mọi
       * khoá đều đã có trong cache RAM, không bao giờ thiếu. Thêm một vòng `for..in` đối chiếu
       * ở đây chỉ tốn thêm ~11 ms/lần chọn chat (đã đo) mà không đổi kết quả. */
    } catch (e) { /* ignore */ }
    if (idbPreloaded || typeof indexedDB === 'undefined') return;
    idbPreloaded = true;
    try {
      const req = indexedDB.open('fb_meta_data');
      req.onsuccess = (ev) => {
        try {
          const db = ev && ev.target && ev.target.result;
          if (!db) return;
          ['global_user_ids', 'global_user_ids_2'].forEach((storeName) => {
            try {
              if (!db.objectStoreNames || !db.objectStoreNames.contains(storeName)) return;
              const tx = db.transaction(storeName, 'readonly');
              const st = tx.objectStore(storeName);
              const allReq = st.getAll();
              allReq.onsuccess = () => {
                const rows = allReq.result || [];
                rows.forEach((r) => {
                  if (r && r.pageId && r.threadId && r.globalId) {
                    putGidToMemCaches(String(r.pageId) + '_' + String(r.threadId), String(r.globalId));
                  }
                });
              };
            } catch (e2) { /* ignore */ }
          });
        } catch (e1) { /* ignore */ }
      };
    } catch (e) { /* ignore */ }
  }
  preloadPersistentGlobalIds();

  function syncSocketMappingsToCache(helper, pageId) {
    try {
      const sk = helper && helper.SOCKETS && helper.SOCKETS[pageId];
      const ip = sk && sk.context && sk.context.initPageData;
      if (!ip) return;
      // Khởi tạo sẵn cả threadMapping & threadMappingStoreV2 là {} để chặn đứng lỗi TypeError
      // tại o.context.initPageData.threadMapping[c] trong resolveSearchGlobalIdTask (@823506 của _app)!
      if (!ip.threadMapping || typeof ip.threadMapping !== 'object') ip.threadMapping = {};
      if (!ip.threadMappingStoreV2 || typeof ip.threadMappingStoreV2 !== 'object') ip.threadMappingStoreV2 = {};
      /* ═══ [v1.92.58] ĐÂY LÀ CHỖ GÂY "GIỮ ALT CHỌN 1 CON LÀ KHỰNG". ═══
       * Bản cũ duyệt Object.keys(threadMapping) + Object.keys(threadMappingStoreV2) NGAY TẠI ĐÂY,
       * đồng bộ, mỗi lần gọi. Hàm này chạy mỗi lần người dùng CHỌN một chat:
       *   onDocClick → setRangeStart → computeMatches → schedulePreloadSelectedChats
       *     → preloadSelectedChats → warmUpSockets → syncSocketMappingsToCache.
       * `threadMapping` KHÔNG phải vài dòng: chính script này nâng `maxLoadThreadCount` lên
       * 5000 trang (~75 000 chat) và app đổ mọi thread đã biết vào đó. Mỗi khoá còn gọi
       * putGidToMemCaches (nối chuỗi + 3 lần ghi cache) ⇒ cú click phải gánh hàng chục nghìn
       * phép ghi. Đo (tools/_bench_click.mjs, Chromium 153, 20 000 thread): putGidToMemCaches
       * chiếm 4,1–8,1 % CPU ngay trong khung hình của cú click, khung hình dài nhất 68–97 ms.
       *
       * NAY: phần ĐỒNG BỘ chỉ còn việc ĐÁNH THỨC PENDING_MESSAGES (số phần tử = số chat đang
       * chờ gid, thường 0–40; tra thẳng ip.threadMapping[tid] nên vẫn chính xác tức thời).
       * Phần SAO CHÉP map → cache RAM chạy NỀN (setTimeout 0) và không quá 1 lần/3 giây cho
       * mỗi page — gid vẫn vào cache, chỉ không chen vào giữa cú click.
       * KHÔNG mất dữ liệu: ensureConvCtx() vẫn đọc thẳng ip.threadMapping/threadMappingStoreV2
       * làm nguồn dự phòng, và mọi gid thật đi qua __botfakeSaveGid__ vẫn ghi ngay lập tức. */
      const nowMs = Date.now();
      if (!ip.__botfakeMirrorAt || nowMs - ip.__botfakeMirrorAt > 3000) {
        ip.__botfakeMirrorAt = nowMs;
        const pid = String(pageId);
        /* CHIA LÔ: duyệt 2 × N một lượt vẫn tạo MỘT long task (đo được 78 ms với 20 000 thread)
         * — đúng cái "khựng một cái" mà người dùng thấy. Nay mỗi lượt chỉ làm tối đa 1 500 khoá
         * rồi nhường lại cho khung hình sau ⇒ không khung hình nào bị chặn quá ~5 ms. */
        const CHUNK = 1500;
        const maps = [ip.threadMapping, ip.threadMappingStoreV2].filter((mp) => mp && typeof mp === 'object');
        let mi = 0, keys = null, ki = 0;
        const step = () => {
          try {
            let done = 0;
            while (mi < maps.length && done < CHUNK) {
              const mp = maps[mi];
              if (!keys) { keys = Object.keys(mp); ki = 0; }
              while (ki < keys.length && done < CHUNK) {
                const tid = keys[ki++];
                const v = tid ? mp[tid] : null;
                if (!v) continue;
                const key = pid + '_' + String(tid);
                const sv = typeof v === 'string' ? v : String(v);
                /* BỎ QUA KHOÁ ĐÃ CÓ ĐÚNG GIÁ TRỊ — thường là 100 % sau lần sao chép đầu:
                 * cache RAM đã đầy từ lúc khởi động, nên lần sao chép thứ hai trở đi chỉ cần
                 * ĐỌC và bỏ qua, không gọi putGidToMemCaches (nối chuỗi + 3 lần ghi + Map.set).
                 * Đo được: đây là phần làm cú click thứ hai vẫn khựng 89 ms. */
                if (persistentGidMap[key] === sv) continue;
                putGidToMemCaches(key, sv);
                done++;
              }
              if (ki >= keys.length) { mi++; keys = null; }
            }
            if (mi < maps.length) {
              try { setTimeout(step, 0); } catch (eS2) { /* ignore */ }
            }
          } catch (eM) { /* ignore */ }
        };
        try { setTimeout(step, 0); } catch (eS) { /* ignore */ }
      }
      // Đánh thức NGAY LẬP TỨC (0ms) mọi PENDING_MESSAGES['find_global_id_|{pageId}_|{tid}'] đang chờ,
      // không bao giờ để bị treo 4.5s chờ wsTimer nổ khi origResolve của _app gặp lỗi!
      if (helper.PENDING_MESSAGES && typeof helper.PENDING_MESSAGES === 'object') {
        const prefix = 'find_global_id_|' + String(pageId) + '_|';
        Object.keys(helper.PENDING_MESSAGES).forEach((k) => {
          if (!k || k.indexOf(prefix) !== 0) return;
          const tid = k.slice(prefix.length);
          if (!tid || tid === '__botfake_keepalive__') return;
          const foundGid = ip.threadMapping[tid] || ip.threadMappingStoreV2[tid] || persistentGidMap[String(pageId) + '_' + tid];
          if (foundGid) {
            const pm = helper.PENDING_MESSAGES[k];
            delete helper.PENDING_MESSAGES[k];
            if (pm) {
              if (pm.clearTimeout) clearTimeout(pm.clearTimeout);
              if (typeof pm.callback === 'function') {
                try { pm.callback({ success: true, data: String(foundGid) }); } catch (e2) { /* ignore */ }
              }
            }
          }
        });
      }
    } catch (e) { /* ignore */ }
  }

  function patchMqttHelper(helper) {
    if (!helper || typeof helper !== 'object' || helper.__botfakePatched) return;
    helper.__botfakePatched = true;
    try {
      // 1) Vá triggerLoadMoreThreads (@822420): truyền đúng parsed.step (Array) thay vì parsed (Object)
      helper.triggerLoadMoreThreads = function (pageId, parsed) {
        try {
          syncSocketMappingsToCache(this, pageId);
          const step = (parsed && parsed.step) ? parsed.step : parsed;
          const hasData = step && typeof this.findBlockAction === 'function' && (
            this.findBlockAction(step, 'setBusinessThreadInfo')
            || this.findBlockAction(step, 'deleteThenInsertThread')
            || this.findBlockAction(step, 'updateFilteredThreadsRanges')
          );
          const key = 'loading_thread_' + pageId;
          if (hasData && this.PENDING_MESSAGES && this.PENDING_MESSAGES[key]) {
            clearTimeout(this.PENDING_MESSAGES[key].clearTimeout);
            const cb = this.PENDING_MESSAGES[key].callback;
            delete this.PENDING_MESSAGES[key];
            if (typeof cb === 'function') cb(parsed);
          }
        } catch (e) { /* ignore */ }
      };
      // 2) Bọc initLoadThread (@828800) & loadThread (@827500): nâng giới hạn từ 10 trang (~150 chat) lên 5000 trang (~75.000 chat)
      //    và đảm bảo sock.lastApplyCursor luôn có .get('205') để loadThread không bao giờ văng lỗi
      if (typeof helper.initLoadThread === 'function') {
        const origInitLoad = helper.initLoadThread;
        helper.initLoadThread = function (sock) {
          const r = origInitLoad.apply(this, arguments);
          if (sock && typeof sock === 'object') {
            sock.maxLoadThreadCount = Math.max(sock.maxLoadThreadCount || 0, 5000);
          }
          return r;
        };
      }
      if (typeof helper.loadThread === 'function') {
        const origLoadThread = helper.loadThread;
        helper.loadThread = function (pageId) {
          try {
            const sock = this.SOCKETS && this.SOCKETS[pageId];
            if (sock && (!sock.lastApplyCursor || typeof sock.lastApplyCursor.get !== 'function')) {
              sock.lastApplyCursor = new Map([['205', null]]);
            }
          } catch (e0) { /* ignore */ }
          return origLoadThread.apply(this, arguments);
        };
      }
      // 3) Vá lỗi thứ 4 trong loadThread (@827500): _app gửi task với queue_name === 'trq' (label: '313' / '145')
      //    và truyền nhầm reference_thread_key: a.filterThreadParams.referenceActivityTimestamp thay vì referenceThreadKey.
      //    LƯU Ý QUAN TRỌNG: KHÔNG mở khóa loading_thread_{pageId} ngay khi pubPromise (Gói 1 ACK) resolve!
      //    Vì Gói 1 chỉ là ACK của task 313, chưa chứa updateFilteredThreadsRanges & deleteThenInsertThread (nằm ở Gói 2
      //    push về sau đó ~30ms). Nếu mở khóa sớm ở Gói 1, loadThread sẽ gửi tiếp với CÙNG referenceActivityTimestamp cũ
      //    và bị kẹt ở 300 mess đầu! Việc mở khóa loading_thread_{pageId} phải do triggerLoadMoreThreads / resolveSearchGlobalIdTask
      //    thực hiện đúng lúc Gói 2 (chứa updateFilteredThreadsRanges / deleteThenInsertThread / setBusinessThreadInfo) về tới!
      if (typeof helper.publish === 'function') {
        const origPublish = helper.publish;
        helper.publish = function (pageId, topic, frame, qos) {
          try {
            if (topic === '/ls_req' && frame && Array.isArray(frame.tasks) && frame.tasks.length === 1) {
              const t0 = frame.tasks[0];
              if (t0 && (t0.queue_name === 'trq' || t0.label === '313' || t0.label === '145') && typeof t0.payload === 'string') {
                const sock = this.SOCKETS && this.SOCKETS[pageId];
                const fp = sock && sock.filterThreadParams;
                if (fp && fp.referenceThreadKey !== undefined && fp.referenceThreadKey !== fp.referenceActivityTimestamp) {
                  const pl = JSON.parse(t0.payload);
                  if (pl && pl.reference_thread_key === fp.referenceActivityTimestamp) {
                    pl.reference_thread_key = fp.referenceThreadKey;
                    t0.payload = JSON.stringify(pl);
                  }
                }
                // Rút ngắn timeout dự phòng của loading_thread_{pageId} từ 5000ms xuống 1200ms (phòng khi đã hết trang cuối)
                const key = 'loading_thread_' + pageId;
                const pm = this.PENDING_MESSAGES && this.PENDING_MESSAGES[key];
                if (pm && pm.clearTimeout) {
                  clearTimeout(pm.clearTimeout);
                  const self = this;
                  pm.clearTimeout = setTimeout(() => {
                    try {
                      if (self.PENDING_MESSAGES && self.PENDING_MESSAGES[key]) {
                        const cb = self.PENDING_MESSAGES[key].callback;
                        delete self.PENDING_MESSAGES[key];
                        if (typeof cb === 'function') cb({ success: false, data: null });
                      }
                    } catch (e3) { /* ignore */ }
                  }, 1200);
                }
              }
            }
          } catch (e0) { /* ignore */ }
          return origPublish.apply(this, arguments);
        };
      }
      // 4) Bọc resolveSearchGlobalIdTask (@823506):
      //    - Khởi tạo sẵn o.context.initPageData.threadMapping = {} TRƯỚC khi origResolve chạy (chặn đứng lỗi
      //      TypeError: Cannot read properties of undefined tại o.context.initPageData.threadMapping[c] trong _app
      //      vốn là nguyên nhân làm treo các chat đợi wsTimer 4.5s!).
      //    - Đồng bộ ngay globalId mới vào cache RAM + đánh thức PENDING_MESSAGES ở 0ms!
      if (typeof helper.resolveSearchGlobalIdTask === 'function') {
        const origResolve = helper.resolveSearchGlobalIdTask;
        helper.resolveSearchGlobalIdTask = function (pageId, parsed) {
          try {
            const sk0 = this.SOCKETS && this.SOCKETS[pageId];
            if (sk0 && sk0.context && sk0.context.initPageData) {
              if (!sk0.context.initPageData.threadMapping) sk0.context.initPageData.threadMapping = {};
              if (!sk0.context.initPageData.threadMappingStoreV2) sk0.context.initPageData.threadMappingStoreV2 = {};
            }
            if (this.PENDING_MESSAGES && (state.sending || batchStats.active)) {
              const kaKey = 'find_global_id_|' + pageId + '_|__botfake_keepalive__';
              if (!this.PENDING_MESSAGES[kaKey]) {
                this.PENDING_MESSAGES[kaKey] = { callback: function () {}, clearTimeout: null };
              }
            } else if (this.PENDING_MESSAGES) {
              delete this.PENDING_MESSAGES['find_global_id_|' + pageId + '_|__botfake_keepalive__'];
            }
          } catch (e0) { /* ignore */ }
          const r = origResolve.apply(this, arguments);
          try {
            syncSocketMappingsToCache(this, pageId);
            const sock = this.SOCKETS && this.SOCKETS[pageId];
            if (sock && (state.sending || batchStats.active)) {
              sock.maxLoadThreadCount = Math.max(sock.maxLoadThreadCount || 0, 5000);
            }
            this.triggerLoadMoreThreads(pageId, parsed);
          } catch (e) { /* ignore */ }
          return r;
        };
      }
    } catch (e) { /* ignore */ }
  }

  // Làm nóng Socket TRƯỚC khi gửi: lần dùng Socket đầu tiên trong phiên (nhất là ngay sau F5)
  // phải trả phí kết nối + đồng bộ thread map ~10s (initSocket). Làm nóng ngay lúc bắn lô —
  // chạy song song các bắn API — nên khi nào cần bù Socket thì chỉ còn ~1–2s của sendMessage.
  const socketWarmPromises = {}; // pageId → Promise kết nối socket (đang chạy dở)
  const batchGidFetchedPages = {};
  /* [v1.93.13] Page nào đã bật khớp-theo-tên cho ext (`ENABLE_FIND_THREAD_BY_USERNAME`).
   * Mỗi page chỉ gửi 1 lần — cờ đó nằm trong SW của ext, gửi lại vô ích. */
  const nameSearchEnabled = new Set();
  const batchGidPromises = {}; // pageId → Promise BATCH_GET_GLOBAL_ID đang chạy

  // Nạp HÀNG LOẠT { threadId → globalId } mà Extension đã biết trong IndexedDB:
  // 1 lệnh/page thay vì dò từng chat. Chỉ đánh dấu "đã nạp" khi THÀNH CÔNG; lần
  // gọi hỏng/timeout được phép gọi lại ở lượt sau hoặc trước Pass 2, vì IndexedDB
  // của Extension liên tục được loadThread/gửi tay bổ sung thêm mapping mới.
  /* ═══════════════════ [v1.93.9] DOC_ID — GỐC CỦA "batch nạp 0/0" ═══════════════════
   * BẰNG CHỨNG (0.5.62_0/assets/background.js):
   *   class Ct {                                  // BATCH_GET_GLOBAL_ID
   *     async init(){ if (!O.get(rt, st)) return Promise.reject(`Missing doc_id ${rt} or ${st}`); ... }
   *   }
   *   rt = "MessengerThreadlistWebGraphQLQuery"   st = "MessengerThreadlistQuery"
   *
   * `O` = `self.GraphQLDocId` (class Ll). Nó CHỈ nạp doc_id bằng 2 đường:
   *   ① constructor → populateDocIdsMap() → q.getItem("GraphQLDocId_docIdsMap")   (localStorage)
   *   ② preloadDocIds() → fetch "business.facebook.com/latest/inbox/facebook?asset_id=…"
   *      → makeResourceMap(html) → G(html,'"resource_map":') (hoặc '"rsrcMap":')
   *      + setResourceMap\(([^)]+), \[\]\)
   *   TTL: `kl = 3600*1e3*5` = **5 giờ** — quá hạn thì `has()` tự xoá.
   *
   * Script này trước đây: docIdsMap 0 · isFeatureReady 0 · "resource_map" 0 · KHÔNG gửi
   * PRELOAD_DOC_IDS ⇒ doc_id chưa bao giờ có ⇒ BATCH_GET_GLOBAL_ID luôn reject
   * "Missing doc_id" ⇒ đúng với `batch nạp 0/0` ở MỌI log.
   * Và vì `Ee` (dò gid từng chat) cũng dùng `O.get(rt,st)` / `O.get(ge)`, đường dò LẺ cũng
   * hỏng theo ⇒ 2 246 ca/lô `Ext: không gid`.
   *
   * Cách A dưới đây KHÔNG cần đăng nhập Facebook: chỉ regex trên HTML đã có trong tay.
   * Toàn bộ khối này là đường CHỈ ĐỌC — không gửi tin, không thể sinh tin trùng. */

  /* TÊN doc_id THẬT — trích nguyên văn từ 0.5.62_0/assets/background.js (không đoán).
   *   rt = "MessengerThreadlistWebGraphQLQuery"                        → BATCH + findThread
   *   st = "MessengerThreadlistQuery"                                  → BATCH
   *   Jt = "PagesManagerInboxAdminAssignerRootQuery"                    → Ee nguồn ①
   *   Zt = "PagesManagerInboxQueryUtilCommItemHeaderMercuryQuery"       → Ee nguồn ②
   *   ge = "BizInboxCustomerRelaySearchSourceQuery"                     → Ee nguồn ④ (tìm theo tên)
   *   Da = "MessengerThreadsWebGraphQLQuery" / Sa = "MessengerThreadsQuery" → LOAD_FACEBOOK_MESSAGES
   *   ta = "CometProfileSwitchMutation"                                 → switchProfile (SEND_COMMENT)
   *   ia.inbox = [Jt, Zt]  ⇒ `isFeatureReady('inbox')` chỉ đòi 2 mã này */
  const DOCID_KEEP = {
    MessengerThreadlistWebGraphQLQuery: 1,
    MessengerThreadlistQuery: 1,
    PagesManagerInboxAdminAssignerRootQuery: 1,
    PagesManagerInboxQueryUtilCommItemHeaderMercuryQuery: 1,
    BizInboxCustomerRelaySearchSourceQuery: 1,
    MessengerThreadsWebGraphQLQuery: 1,
    MessengerThreadsQuery: 1,
    BizInboxCommentThreadListContainerQuery: 1,
    BizInboxCommentDetailViewHeaderContainerQuery: 1,
    InstagramMessageThreadsWebGraphQLQuery: 1,
    InstagramMessageThreadItemsWebGraphQLQuery: 1,
    InstagramMessageThreadItemsQuery: 1,
    BizInboxSearchResultListContainerQuery: 1,
    BizInboxSearchResultFacebookListQuery: 1,
  };
  /* [v1.93.13] bỏ `loadedFromLs` (đường đọc localStorage trang không tồn tại — map nằm ở
   * `chrome.storage.local` của ext). `viaExtOk` nay = "đã GỬI lệnh", không phải "đã nạp". */
  /* [v1.93.14] `viaExtWaited` = số lần phải CHỜ hết hạn (case `PRELOAD_DOC_IDS` của ext
   * không trả `_SUCCESS` vì nó không `await` `O.preloadDocIds`). Tách khỏi `viaExtOk`
   * để không báo "đã nạp" khi thực tế mới chỉ "đã chờ". */
  const docIdStats = { seenHtml: 0, htmlWithMap: 0, saved: 0, viaExtOk: 0, viaExtWaited: 0, viaExtEmpty: 0 };
  /* Tên doc_id bóc được từ HTML — CHỈ để đối chiếu/ghi log, không dùng để quyết định gì. */
  const docIdSeenFromHtml = Object.create(null);
  /* Page nào đã được gửi PRELOAD_DOC_IDS (gửi 1 lần/page, không lặp). */
  const docPreloadSent = new Set();
  const DOCID_NAMES = DOCID_KEEP;   // giữ tên cũ cho chỗ dùng bên dưới

  /* ═══ [v1.93.13] doc_id KHÔNG đọc được từ trong trang — bỏ hẳn ảo giác này ═══
   * Bản trước đọc `window.GraphQLDocId` và coi đó là "bộ doc_id của extension".
   * KIỂM LẠI NGUỒN: `self.GraphQLDocId = O` là dòng trong **service worker** của extension
   * 0.5.62 (`const O=new Ll; O.prepareDocIdsMap(); self.GraphQLDocId=O`). Trang web
   * Pancake KHÔNG có biến đó: `grep -c GraphQLDocId _app-…v6.js` = **0**.
   * Toàn repo chỉ có đúng hàm này đọc nó ⇒ `docIdApi()` LUÔN trả `null` ⇒
   * `docIdReady()` LUÔN `false` ⇒ mọi log in ra
   *   `batch rỗng — THIẾU doc_id ⇒ extension reject "Missing doc_id" (chưa chạy được lần nào)`
   * (16/16 dòng, đúng 100 % 30 log). Đó là **câu in ra**, không phải sự thật về extension:
   * extension có `chrome.storage.local` riêng và tự có doc_id.
   *
   * ⇒ Nay KHÔNG đọc gì từ trang nữa (hàm `docIdReady()` đã xoá). Việc nạp do chính
   *   extension làm trong SW (`case"PRELOAD_DOC_IDS"` → `O.preloadDocIds`, nạp
   *   `[Jt,Zt,rt,st]` qua khối `ee.preloadDocIds`). Ta chỉ BẢO ĐẢM ĐÃ GỬI lệnh, rồi để
   *   `BATCH_GET_GLOBAL_ID` trả lời thật (nó tự reject `Missing doc_id` nếu ext chưa có). */

  /* Có `__ExtensionAdapter__` nghĩa là extension Pancake 0.5.62 đang chạy và tự giữ doc_id
   * trong SW của nó. Đây là điều kiện DUY NHẤT ta kiểm được từ phía trang. */
  function extAdapter() {
    const a = window.__ExtensionAdapter__;
    return (a && typeof a.send === 'function') ? a : null;
  }
  /* CÁCH A — bóc {"resource_map":…} / {"rsrcMap":…} từ HTML BẤT KỲ.
   * Danh sách tên cần lấy: ưu tiên bảng tĩnh DOCID_KEEP; nếu chưa biết tên thì gom theo
   * hậu tố *GraphQLQuery* (doc_id thật của FB luôn có dạng đó). */
  function harvestDocIdsFromHtml(html, where) {
    if (!html || typeof html !== 'string' || html.length < 500) return 0;
    if (!html.includes('resource_map') && !html.includes('rsrcMap') && !html.includes('setResourceMap(')) return 0;
    docIdStats.seenHtml++;
    /* [v1.93.13] KHÔNG ghi vào `window.GraphQLDocId` nữa (không tồn tại trong trang).
     * Đường bóc HTML này từ trước tới nay KHÔNG BAO GIỜ chạy được (api luôn null) ⇒
     * `docIdStats.saved` luôn 0. Vẫn giữ phép bóc để đếm/ghi log, nhưng KHÔNG tính là
     * "đã có doc_id" — chỉ extension mới nạp được doc_id cho chính nó. */
    let saved = 0;
    const take = (name, val) => {
      if (!name || !val) return;
      const n = String(name), v = String(val);
      if (!/GraphQLQuery|GraphQL|Query$/.test(n)) return;
      let keep = false;
      if (DOCID_KEEP[n]) keep = true;
      else if (DOCID_NAMES && DOCID_NAMES[n]) keep = true;
      else if (/GraphQLQuery$/.test(n)) keep = true;   // dạng chuẩn của FB
      if (!keep) return;
      saved++;   // đếm được tên, KHÔNG ghi (xem chú thích trên)
      try { docIdSeenFromHtml[n] = v; } catch (e) { /* ignore */ }
    };
    // 1) khối JSON: "resource_map":{...}  ·  "rsrcMap":{...}
    for (const key of ['"resource_map":', '"rsrcMap":']) {
      let at = html.indexOf(key);
      while (at > -1) {
        const brace = html.indexOf('{', at + key.length - 1);
        if (brace > -1) {
          // quét ngoặc cân bằng, bỏ qua chuỗi
          let depth = 0, inStr = false, esc = false, end = -1;
          for (let i = brace; i < html.length && i < brace + 400000; i++) {
            const c = html[i];
            if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
            if (c === '"') { inStr = true; continue; }
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
          }
          if (end > brace) {
            try {
              const obj = JSON.parse(html.slice(brace, end + 1));
              Object.keys(obj).forEach((k) => {
                const v = obj[k];
                if (v && typeof v === 'object') take(k, v.value || v.doc_id || v.docId);
                else take(k, v);
              });
            } catch (e) { /* khối hỏng — bỏ */ }
          }
        }
        at = html.indexOf(key, at + key.length);
      }
    }
    // 2) setResourceMap({...}, [])
    try {
      const re = /setResourceMap\((\{[\s\S]{0,200000}?\}),\s*\[\]\)/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        try {
          const obj = JSON.parse(m[1]);
          Object.keys(obj).forEach((k) => {
            const v = obj[k];
            if (v && typeof v === 'object') take(k, v.value || v.doc_id || v.docId);
            else take(k, v);
          });
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
    if (saved) {
      docIdStats.htmlWithMap++;
      docIdStats.saved += saved;
      try {
        logLine('🧩 [doc_id] thấy ' + saved + ' tên doc_id trong HTML (' + where + ')'
          + ' — CHỈ ghi nhận để đối chiếu, KHÔNG nạp được vào extension'
          + ' (doc_id của ext nằm ở chrome.storage.local, không đọc/ghi được từ trang)');
      } catch (e) { /* ignore */ }
    }
    return saved;
  }
  /* Nhận HTML từ mọi nguồn ta đã tải (không thêm request nào). */
  function harvestDocIdsFromResponse(res) {
    try {
      if (!res) return 0;
      const t = typeof res === 'string' ? res : (res.text || res.html || '');
      return harvestDocIdsFromHtml(t, 'response');
    } catch (e) { return 0; }
  }
  /* CÁCH B — nhờ extension nạp hộ. NAY BẬT (đã bỏ cờ `__botfakeTryPreloadDocIds__`).
   *
   * ═══ [v1.93.13] SỬA LỖI: `PRELOAD_DOC_IDS` **CÓ** case trong extension 0.5.62 ═══
   * Chú thích cũ ở đây nói "switch của extension 0.5.62 KHÔNG có case đó (đã grep 86 case)"
   * ⇒ SAI, và vì tin vào nó nên script gửi tên bịa `PRELOAD_DOC_IDS_CANDIDATE`,
   * extension bỏ qua (default case), `doc_id` không bao giờ có ⇒ `batch nạp 0/0` ở MỌI log.
   *
   * Case THẬT trong `0.5.62_0/assets/background.js` @400547:
   *   case"PRELOAD_DOC_IDS":{await Z(); const{pageId:_,isBusiness:g}=r.data;
   *     O.preloadDocIds({pageId:_, isBusiness:g});       // ← KHÔNG await, không postMessage
   *     q.setItem("country", r.data.country); break}
   * Và `O.preloadDocIds({html,pageId,isBusiness})`:
   *   · `html` bỏ trống ⇒ ext tự fetch `makeInboxViewUrl(pageId,isBusiness)`
   *     = `business.facebook.com/latest/inbox/facebook?asset_id=…`
   *   · cần `docNames` [ge, Oe, Ra, Oa] — bộ doc của đường Instagram
   *   · nạp vào `O` = `chrome.storage.local` key `GraphQLDocId_docIdsMap`
   *     (`persistToLocalStorage(){ … q.setItem(yr, …) }`, `q` = `chrome.storage.local`)
   *   · `O.preloadDocIds()` là **hàm tổng** (được `ot()` gộp 20 s): nó tự lọc
   *     `featureNeedsPreloadDocIds = ["inbox","comment","sendCommerceProduct","switchProfile","businessInboxComment"]`,
   *     bỏ qua feature đã sẵn, rồi gọi `ee.preloadDocIds` — CHÍNH khối nạp `[Jt,Zt,rt,st]`
   *     mà `BATCH_GET_GLOBAL_ID` cần. ⇒ đúng lệnh, đúng bộ doc_id.
   *
   * ⇒ Tên ĐÚNG là `PRELOAD_DOC_IDS`, tham số đúng là `{pageId, isBusiness, country}`.
   *   KHÔNG có `_SUCCESS`/`_FAILURE` ⇒ `adapter.send` sẽ **timeout** (30 s) rồi trả
   *   `{success:false, data:null}` — nhưng side-effect đã xảy ra. Vì vậy:
   *   · hạn chờ ngắn (4 s) để không giữ lane,
   *   · phán quyết dựa vào phản hồi THẬT của `BATCH_GET_GLOBAL_ID` (lệnh duy nhất biết sự thật),
   *   · không bao giờ coi "không trả lời" là "đã nạp".
   * Đây là đường CHỈ ĐỌC + ghi cache của extension, KHÔNG gửi tin ⇒ không thể sinh tin trùng. */
  function tryPreloadDocIdsViaExt(pid) {
    /* [v1.93.13] BỎ CỜ `window.__botfakeTryPreloadDocIds__`.
     * Cờ này không ai trong repo set ⇒ hàm return false ngay dòng đầu, tức là dù đã sửa
     * đúng tên lệnh thì lệnh VẪN CHƯA TỪNG ĐƯỢC GỬI. Nay gửi thật.
     * An toàn: đây là lệnh CHỈ ĐỌC + ghi cache của extension, không gửi tin, không thể sinh
     * tin trùng. `PRELOAD_DOC_IDS` không có `_SUCCESS`/`_FAILURE` nên phán quyết KHÔNG dựa
     * vào `res` mà dựa vào phản hồi THẬT của lệnh kế tiếp (`BATCH_GET_GLOBAL_ID`). */
    const adapter = extAdapter();
    if (!adapter) return Promise.resolve(false);
    if (!pid) return Promise.resolve(false);
    /* ═══ [v1.93.14] PHẢI CHỜ, VÌ EXT KHÔNG CHỜ ═══
     * Nguồn `0.5.62_0/assets/background.js`:
     *   case "PRELOAD_DOC_IDS": { await Z();
     *     const { pageId:_, isBusiness:g } = r.data;
     *     O.preloadDocIds({ pageId:_, isBusiness:g }), q.setItem("country", r.data.country);
     *     break }                                    ← KHÔNG `await`, KHÔNG `_SUCCESS/_FAILURE`
     * `O.preloadDocIds` là hàm async thật (class `Ll`):
     *   async preloadDocIds(e, t = this.featureNeedsPreloadDocIds) { … for (let r of a) await r.preloadDocIds(e) }
     * với `a` = các feature CHƯA sẵn sàng ⇒ `inbox` ⇒ `ee.preloadDocIds` ⇒ `GET
     * https://business.facebook.com/latest/inbox/messenger?asset_id=…` + tải JS + bóc
     * `[Jt, Zt, rt, st]`. Việc đó mất HÀNG GIÂY.
     * Ext `break` ngay ⇒ KHÔNG có phản hồi ⇒ adapter `send` hết hạn (4 000 ms cũ) rồi trả
     * `{success:false, data:null}`. Trước bản này script coi "hết hạn" là "đã nạp"
     * (`docIdStats.viaExtOk++`) rồi gọi `BATCH_GET_GLOBAL_ID` NGAY ⇒ `Ct.init()` thấy
     * `!O.get(rt, st)` ⇒ reject `Missing doc_id rt or st` ⇒ `batch nạp 0/0` ở MỌI log.
     *
     * ĐO ĐƯỢC trên toàn bộ log: `batch nạp 0/0 mapping (lỗi 0)` — 0 mapping, 0 lỗi.
     * Đúng dấu hiệu "lệnh chạy trước khi doc_id có".
     *
     * Nay: `PRELOAD_DOC_IDS` KHÔNG trả lời được ⇒ chờ đủ lâu (doc_id nạp 1 lần/page,
     * cache 5 h) và coi hết hạn là BÌNH THƯỜNG; nếu `res.success === true` (không xảy ra
     * với case này) thì thoát sớm. Sau đó `BATCH_GET_GLOBAL_ID` mới được phép chạy —
     * và nếu vẫn rỗng thì đọc lại theo nhịp, vẫn CHỈ ĐỌC, không sinh tin. */
    return Promise.resolve()
      .then(() => adapter.send({
        type: 'PRELOAD_DOC_IDS',
        pageId: String(pid),
        isBusiness: false,
        country: (function () { try { return localStorage.getItem('country') || 'vn'; } catch (e) { return 'vn'; } })(),
      }, { timeout: 25000 }))
      .then((res) => {
        /* `PRELOAD_DOC_IDS` KHÔNG trả `_SUCCESS`/`_FAILURE` (case chỉ `break`), nên
         * `adapter.send` sẽ hết hạn rồi trả `{success:false, data:null}` — đó KHÔNG phải lỗi,
         * side-effect đã xảy ra trong SW. Vì vậy: thử đọc lại qua `BATCH_GET_GLOBAL_ID`
         * (lệnh duy nhất cho biết sự thật) thay vì đoán từ `res`.
         * Ở đây chỉ ghi nhận "đã gửi", không kết luận gì về doc_id. */
        /* [v1.93.14] HẾT HẠN KHÔNG PHẢI "ĐÃ NẠP". Case `PRELOAD_DOC_IDS` của extension
         * `break` ngay sau khi gọi một hàm async KHÔNG `await` ⇒ không bao giờ có
         * `_SUCCESS`. Nên `res.success === true` là ca KHÔNG XẢY RA; `res.success === false`
         * chỉ nói "đã chờ đủ 25 s", không nói doc_id đã có.
         * Sự thật duy nhất kiểm được là `BATCH_GET_GLOBAL_ID` trả mapping hay không
         * (`batch nạp N/M`). Vì vậy đếm RIÊNG, không gộp vào `viaExtOk`. */
        if (res && res.success) docIdStats.viaExtOk++; else docIdStats.viaExtWaited++;
        try {
          logLine('🧩 [doc_id] đã gửi PRELOAD_DOC_IDS cho page ' + pid
            + ' và chờ 25 000 ms (ext KHÔNG await `O.preloadDocIds` nên không có _SUCCESS)'
            + ' — kết quả thật xem ở dòng `batch nạp N/M`');
        } catch (e) { /* ignore */ }
        return true;
      })
      .catch(() => { docIdStats.viaExtEmpty++; return false; });
  }
  async function ensureDocIds(pid) {
    /* [v1.93.13] ĐỌC LẠI NGUỒN — 2 đường cũ đều KHÔNG THỂ chạy, đã bỏ:
     *  ① `localStorage.getItem('GraphQLDocId_docIdsMap')` — SAI CHỖ.
     *     `q` của extension = **`chrome.storage.local`** (không phải localStorage):
     *       q={getItem:async n=>(await chrome.storage.local.get(n))[n], setItem:(n,e)=>chrome.storage.local.set({[n]:e})}
     *     và `persistToLocalStorage(){ … q.setItem(yr, JSON.stringify(e)) }` với `yr="GraphQLDocId_docIdsMap"`.
     *     `chrome.storage.local` KHÔNG nhìn thấy được từ trang (khác origin, không qua DOM)
     *     ⇒ dòng cũ luôn `null` ⇒ `docIdStats.loadedFromLs` luôn 0.
     *  ② `window.GraphQLDocId` — biến của SW (`self.GraphQLDocId=O`), không có trong trang.
     *
     * ⇒ Chỉ còn 1 đường thật: nhờ CHÍNH extension nạp (nó có cookie Facebook, có SW,
     *   có `chrome.storage.local`, và nạp đúng bộ `[Jt,Zt,rt,st]` mà `BATCH_GET_GLOBAL_ID` cần).
     * Giữ tên hàm; trả `true` khi đã gửi lệnh (không chờ, không chặn đường gửi tin). */
    if (!extAdapter()) return false;
    const key = String(pid || '');
    if (!key) return false;
    /* Gửi MỘT lần cho MỖI page (doc_id là cache dùng chung cho mọi page nên ext chỉ cần
     * nạp lại khi cache hết hạn 5 giờ; gọi lại sau TTL là việc của ext, không phải của ta). */
    if (docPreloadSent.has(key)) return true;
    docPreloadSent.add(key);
    Promise.resolve().then(() => tryPreloadDocIdsViaExt(key)).catch(() => { /* ignore */ });
    return true;
  }

  function requestBatchGlobalIds(pid, force) {
    if (!pid || typeof pid === 'object') return Promise.resolve(0);
    const pageId = String(pid || '').trim();
    if (!pageId || pageId.indexOf('[object') > -1) return Promise.resolve(0);
    if (batchGidPromises[pageId]) return batchGidPromises[pageId];
    if (batchGidFetchedPages[pageId]) return Promise.resolve(0);
    const adapter = window.__ExtensionAdapter__;
    if (!adapter || typeof adapter.send !== 'function') return Promise.resolve(0);
    /* [v1.93.9] `Ct.init()` của extension reject ngay `Missing doc_id` nếu chưa nạp.
     * Không bảo đảm doc_id thì mọi lần gọi batch đều vô ích ⇒ gọi đúng 1 lần trước. */
    /* [v1.93.13] Điều kiện duy nhất kiểm được từ trang là CÓ adapter (đã kiểm ở trên).
     * Không còn câu "chưa có doc_id" — ta KHÔNG đọc được doc_id của extension nên không
     * được phát ngôn về nó. Chỉ bảo đảm đã gửi lệnh nạp, rồi để chính extension trả lời. */
    try { logLine('🧩 [doc_id] bảo đảm extension đã nạp doc_id trước khi gọi batch…'); } catch (e) { /* ignore */ }
    const promise = Promise.resolve().then(() => ensureDocIds(pageId)).then(() => adapter.send({
      type: 'BATCH_GET_GLOBAL_ID',
      pageId: pageId,
      // Khớp payload app (@897543): app luôn kèm timeRangeMin. Gửi 0 = lấy mọi mốc,
      // tránh Extension hiểu thiếu trường là không có mapping nào trong khoảng lọc.
      timeRangeMin: 0,
      /* [v1.93.13] `maxThreadCount` LÀ THAM SỐ QUYẾT ĐỊNH SỐ LƯỢT GRAPHQL.
       * Nguồn `0.5.62_0/assets/background.js`:
       *   const yn=50, ul=250
       *   class Ct{ constructor({pageId, timeRangeMin, maxThreadCount}){ … this.maxThreadCount = maxThreadCount || ul } }
       *   async init(){ … for(;;){ let c=yn;
       *       if(this.maxThreadCount && this.maxThreadCount-s<yn) c=this.maxThreadCount-s;
       *       const l=await this.getFacebookThreads(a,c);  … } }
       * ⇒ Mỗi lượt lấy `yn = 50` thread; trần `ul = 250` ⇒ **5 lượt graphqlbatch**.
       * Script KHÔNG kèm `maxThreadCount` ⇒ ext dùng trần 250 (đúng ý ta), nhưng lại chỉ
       * chờ **2 000 ms**. 5 lượt graphql thật không thể xong trong 2 s ⇒ phán quyết rơi vào
       * nhánh timeout ⇒ `batch nạp 0/0` ở mọi log, dù doc_id đã có.
       * ⇒ nâng hạn chờ lên 30 000 ms (đúng hạn adapter cho mọi lệnh thường: `l = 3e4`).
       * Lệnh này CHỈ ĐỌC + trả mapping; chờ lâu hơn không sinh thêm lệnh gửi nào.
       * Không kèm `maxThreadCount` để giữ trần 250 như app. */
    }, { timeout: 30000 })).then((res) => {
      delete batchGidPromises[pageId];
      const list = res && res.success && res.data && res.data.threadsWithGlobalId;
      /* ═══ [v1.93.6] ĐỪNG ĐÁNH DẤU "ĐÃ NẠP" KHI CHƯA NẠP ĐƯỢC GÌ ═══
       * ĐO ĐƯỢC trên TOÀN BỘ 28 log (không có ngoại lệ):
       *   `🧭 Chẩn đoán globalId: … batch nạp 0/0 mapping (lỗi 0) …`
       * ⇒ `batchReturned = 0` và `batchFail = 0` cùng lúc. Hai số đó chỉ cùng bằng 0 khi
       * nhánh `!Array.isArray(list)` KHÔNG chạy (nó cộng batchFail) và list cũng rỗng.
       * Nghĩa là lệnh trả `success` nhưng KHÔNG có `data.threadsWithGlobalId` — và vì dòng
       * ngay trên đã đặt `batchGidFetchedPages[pageId] = true` TRƯỚC khi kiểm, page bị khoá
       * VĨNH VIỄN trong phiên: mọi lần gọi sau đều `return Promise.resolve(0)`
       * (dòng `if (batchGidFetchedPages[pageId]) return`).
       * Chú thích của chính hàm này ghi "Chỉ đánh dấu 'đã nạp' khi THÀNH CÔNG" — code làm
       * NGƯỢC lại. Đây là đường nạp global_id HÀNG LOẠT duy nhất (1 lệnh/page thay vì dò
       * từng chat), nên khoá nó = mọi chat sau phải dò lẻ từng con.
       * Nay: chỉ khoá khi THẬT SỰ nhận được danh sách khác rỗng. Lỗi/không có dữ liệu thì
       * lần sau còn gọi lại được (batchGidPromises vẫn chống gọi trùng trong 1 thời điểm).
       * Đường này CHỈ ĐỌC (không gửi tin) ⇒ nới nó không thể sinh tin trùng. */
      if (!Array.isArray(list)) {
        gidStats.batchFail++;
        /* [v1.93.9] PHÂN BIỆT 2 NGUYÊN NHÂN — trước đây cả hai đều in "lỗi 0" nên không thể biết.
         *   a) thiếu doc_id ⇒ extension reject "Missing doc_id …"  (KHÔNG BAO GIỜ chạy được)
         *   b) extension trả success nhưng không có data.threadsWithGlobalId  (lệnh lạ)
         * Hai nguyên nhân có cách sửa KHÁC NHAU ⇒ phải in ra. */
        /* [v1.93.13] NÓI THEO PHẢN HỒI THẬT, không đoán.
         * `Ct.init()` reject `Missing doc_id …` ⇒ ext gửi `BATCH_GET_GLOBAL_ID_FAILURE` ⇒
         * adapter trả `{success:false, data:{type:"BATCH_GET_GLOBAL_ID_FAILURE",taskId}}`.
         * Hết hạn 30 s ⇒ `{success:false, data:null}` (KHÔNG có type).
         * Phân biệt được 3 ca, in đúng ca nào: */
        const _rd = (res && res.data) || null;
        const whyNoList = !res
          ? 'adapter không trả gì (không có __ExtensionAdapter__?)'
          : (!res.success && _rd && /FAILURE$/.test(String(_rd.type || ''))
            ? 'extension TRẢ _FAILURE (nhiều khả năng `Missing doc_id` — Ct.init reject)'
            : (!res.success && !_rd
              ? 'extension KHÔNG phản hồi trong 30 s (adapter hết hạn — lệnh chưa xong hoặc ext không chạy case này)'
              : 'extension trả success nhưng không có data.threadsWithGlobalId (danh sách rỗng)'))
        try { logLine('🧩 [doc_id] batch rỗng — ' + whyNoList); } catch (e) { /* ignore */ }
        return 0;
      }
      if (!list.length) return 0;
      batchGidFetchedPages[pageId] = true;
      gidStats.batchReturned += list.length;
      let applied = 0;
      list.forEach((it) => {
        if (it && it.threadId && it.globalId && typeof window.__botfakeSaveGid__ === 'function') {
          const mapKey = String(pageId) + '_' + String(it.threadId);
          if (!persistentGidMap[mapKey]) applied++;
          window.__botfakeSaveGid__(mapKey, pageId, it.threadId, String(it.globalId));
        }
      });
      gidStats.batchMappings += applied;
      if (list.length > 0) {
        try { logLine('🧭 BATCH_GET_GLOBAL_ID ' + pageId + ': threadsWithGlobalId=' + list.length + ' · nạp mới=' + applied); } catch (e) { /* ignore */ }
      }
      return applied;
    }).catch(() => {
      /* [v1.93.6] Timeout/lỗi mạng KHÔNG phải "đã nạp xong" — xem chú thích đầu hàm.
       * Trước đây nhánh này cũng khoá page vĩnh viễn ⇒ một lần Ext quá hạn 2 s là cả lô
       * mất luôn đường nạp global_id hàng loạt. */
      gidStats.batchFail++;
      delete batchGidPromises[pageId];
      return 0;
    });
    batchGidPromises[pageId] = promise;
    return promise;
  }

  /* [v1.91.75] Nạp global_id cho TOÀN BỘ page của một lượt gửi TRƯỚC khi bắn.
   * Bằng chứng HAR: response HTTP (GET /conversations, GET /messages) KHÔNG hề có trường
   * `global_id` — chỉ có `thread_id` (48/48 conversation) và `thread_key` (`t_<thread_id>`).
   * Và trong _app, threadMapping[threadId] = globalId được dựng từ HAI CỘT KHÁC NHAU
   * (globalId = cột 2/9, threadId = cột 3/65) ⇒ thread_id KHÔNG phải global_id.
   * Vì vậy KHÔNG được "đoán" gid từ thread_id (gửi sai thread). Nguồn duy nhất biết
   * {threadId → globalId} là BATCH_GET_GLOBAL_ID của Extension + socket threadMapping,
   * nên phải nạp chúng cho mọi page ngay từ đầu lô. */
  function prefetchGidsForBatch(groups) {
    const adapter = window.__ExtensionAdapter__;
    const h = window.__MqttHelper__;
    if (!adapter || typeof adapter.send !== 'function') return;
    const seen = {};
    const pages = [];
    (groups || []).forEach((g) => {
      (g && g.list ? g.list : []).forEach((c) => {
        const pid = String((c && (c.pageId || String(c.id || '').split('_')[0])) || '');
        if (!pid || seen[pid]) return;
        seen[pid] = true;
        pages.push(pid);
      });
    });
    pages.forEach((pid) => {
      requestBatchGlobalIds(pid, false);
      try { if (h) syncSocketMappingsToCache(h, pid); } catch (e) { /* ignore */ }
    });
    if (pages.length > 1) {
      try { logLine('🧭 Nạp trước global_id cho ' + pages.length + ' page (BATCH_GET_GLOBAL_ID) trước khi bắn.'); } catch (e) { /* ignore */ }
    }
  }

  function warmUpSockets(targets, opts) {
    try {
      preloadPersistentGlobalIds();
      const h = window.__MqttHelper__;
      const adapter = window.__ExtensionAdapter__;
      if (h) patchMqttHelper(h);
      const seen = {};
      (targets || []).forEach((c) => {
        const pid = c.pageId || String(c.id || '').split('_')[0];
        if (!pid || seen[pid]) return;
        seen[pid] = true;
        // 1) Gọi BATCH_GET_GLOBAL_ID (@897543 trong _app) 1 lần/page trong phiên để nạp hàng loạt { threadId, globalId }
        if (adapter && typeof adapter.send === 'function') requestBatchGlobalIds(pid, false);
        if (!h || typeof h.initSocket !== 'function') return;
        syncSocketMappingsToCache(h, pid);
        try {
          if (h.PENDING_MESSAGES && (state.sending || batchStats.active)) {
            const kaKey = 'find_global_id_|' + pid + '_|__botfake_keepalive__';
            if (!h.PENDING_MESSAGES[kaKey]) {
              h.PENDING_MESSAGES[kaKey] = { callback: function () {}, clearTimeout: null };
            }
          }
          if (h.SOCKETS && h.SOCKETS[pid]) {
            h.SOCKETS[pid].maxLoadThreadCount = Math.max(h.SOCKETS[pid].maxLoadThreadCount || 0, 5000);
            if (isSocketSynced(h.SOCKETS[pid]) && typeof h.wakingUpLoadThread === 'function') {
              h.wakingUpLoadThread(pid);
            }
          }
        } catch (e0) { /* ignore */ }
        // KHÔNG dựa vào sock.instance để bỏ qua: socket chết mà instance vẫn còn thì bắn là thua.
        // initSocket của app TỰ trả về ngay khi kết nối còn đang chạy (guard isRunning()) — gọi là đủ.
        if (socketWarmPromises[pid]) return; // đang kết nối dở — khỏi làm trùng
        socketWarmPromises[pid] = Promise.resolve()
          .then(() => h.initSocket(pid))
          .then(async (res) => {
            await waitForSocketSynced(h, pid, 2500);
            delete socketWarmPromises[pid];
            syncSocketMappingsToCache(h, pid);
            // Chủ động kích hoạt cuộn tải trước threadMappingStoreV2 ở nền sau khi socket đã subscribe /ls_resp
            try {
              if (h.SOCKETS && h.SOCKETS[pid]) {
                h.SOCKETS[pid].maxLoadThreadCount = Math.max(h.SOCKETS[pid].maxLoadThreadCount || 0, 5000);
              }
              if (typeof h.wakingUpLoadThread === 'function' && h.SOCKETS && h.SOCKETS[pid] && isSocketSynced(h.SOCKETS[pid])) {
                h.wakingUpLoadThread(pid);
              }
            } catch (e2) { /* ignore */ }
            return res;
          })
          .catch(() => { delete socketWarmPromises[pid]; return null; });
      });
    } catch (e) { /* ignore */ }
  }

  // Đồng bộ tức thì (0ms) global_id từ WebSocket RAM cache trước khi bắn — tuyệt đối không chặn đầu lượt!
  /* [v1.92.15] QUYẾT ĐỊNH KÊNH CỦA CẢ LÔ NẰM Ở ~2 GIÂY ĐẦU.
   * Cùng một lô mà lúc chạy Socket (125 tin/s), lúc dồn hết vào Ext (29,7 tin/s) chỉ vì:
   *   `pickBestDirectOrder` chọn Socket TRƯỚC chỉ khi `isPageSocketReady(pid)` (SOCKETS[pid] đã
   *   sync: connectAt + 1000ms VÀ requestId >= 1). Wave 1 chạy trước lúc sync xong ⇒ kế hoạch
   *   ['ext','socket'] ⇒ Ext trả lời trước (0,8-3s) và THẮNG ⇒ Socket không bao giờ được thử.
   *
   * KHÔNG DÙNG HẠN CHỜ TỰ ĐẶT: `warmUpSockets` đã tạo sẵn `socketWarmPromises[pid]` — một
   * promise resolve ĐÚNG lúc socket connect xong và đã chờ sync (bên trong nó gọi
   * waitForSocketSynced(2500) rồi tự xoá). Vậy chỉ cần await CHÍNH promise đó: thức ngay khi
   * socket báo xong (thường 0,3-2s), và nếu mạng hỏng thì nó tự bỏ cuộc theo đúng hạn sync mà
   * code đã dùng ở mọi nơi khác — không có con số 4s nào do tôi bịa ra.
   * Không có promise (đã resolve từ trước) thì hỏi thẳng waitForSocketSynced cùng hạn đó. */
  async function waitSocketsReadyForSend(targets) {
    const h = window.__MqttHelper__;
    if (!h || typeof h.initSocket !== 'function') return { waited: 0, ready: 0, pages: 0 };
    const seen = {};
    const pages = [];
    (targets || []).forEach((c) => {
      const pid = (c && (c.pageId || String(c.id || '').split('_')[0])) || '';
      if (pid && !seen[pid]) { seen[pid] = true; pages.push(pid); }
    });
    if (!pages.length) return { waited: 0, ready: 0, pages: 0 };
    const pending = pages.filter((pid) => !isPageSocketReady(pid));
    if (!pending.length) return { waited: 0, ready: pages.length, pages: pages.length };
    const t0 = Date.now();
    try { logLine('🔌 Chờ Socket báo sync (thức ngay khi xong, không có hạn chờ cứng)…'); } catch (e0) { /* ignore */ }
    const waits = pending.map((pid) => {
      const warm = socketWarmPromises[pid];
      if (warm && typeof warm.then === 'function') return Promise.resolve(warm).catch(() => null);
      return waitForSocketSynced(h, pid).catch(() => null);
    });
    // LƯỚI CHỐNG TREO (không phải hạn chờ tối ưu): nếu initSocket không bao giờ trả về thì
    // vẫn phải chạy lô, không đứng chờ vô hạn. Đường bình thường luôn thức bằng SỰ KIỆN.
    const SOCK_SYNC_HANG_GUARD_MS = 8000;
    const guard = sleepUntil(Date.now() + SOCK_SYNC_HANG_GUARD_MS, 'sock-sync').then(() => 'guard');
    // Bấm Dừng thì thoát ngay, không đứng chờ socket.
    const winner = await Promise.race([
      Promise.all(waits).then(() => 'ready'),
      guard,
      stopSignal().then(() => 'stop'),
    ]);
    if (winner === 'guard') {
      try { logLine('⚠ Socket không báo sync sau ' + SOCK_SYNC_HANG_GUARD_MS + 'ms (initSocket treo) — chạy tiếp, không đứng chờ.'); } catch (eg) { /* ignore */ }
    }
    const ready = pages.filter((pid) => isPageSocketReady(pid)).length;
    const waited = Date.now() - t0;
    if (ready === pages.length) {
      try { logLine('✅ Socket đã sync ' + ready + '/' + pages.length + ' page sau ' + waited + 'ms — lô này đi làn Socket trước.'); } catch (e1) { /* ignore */ }
    } else {
      try {
        logLine('⏳ Socket CHƯA sync (' + ready + '/' + pages.length + ' page) sau ' + waited + 'ms — lô này sẽ đi Extension trước, '
          + 'chậm hơn ~4 lần so với Socket. Bấm ⏹ Dừng + F5 rồi chạy lại NGAY sẽ lấy lại được làn Socket.');
      } catch (e2) { /* ignore */ }
    }
    return { waited, ready, pages: pages.length };
  }

  async function waitInitialGidWarmup(targets) {
    try {
      const h = window.__MqttHelper__;
      if (h) {
        const seen = {};
        (targets || []).forEach((c) => {
          const pid = (c && c.pageId) || String((c && c.id) || '').split('_')[0];
          if (pid && !seen[pid]) { seen[pid] = true; syncSocketMappingsToCache(h, pid); }
        });
      }
    } catch (e) { /* ignore */ }
  }

  /* ===== BÙ VÒNG 2 — chống mất tin khi server nghẽn ngay sau khi bắn dồn ===== */
  const BU_RETRY_EXT_MS = 50;   // Ext: bù TỨC THÌ (50ms) — không chờ 1s
  // THỐNG KÊ BÙ theo lượt (in vào dòng TỔNG HỢP cuối log): bù là đường dễ gây LẶP nhất
  // ở lô lớn — đếm theo lý do kích hoạt + số lượt bù bị HỦY vì tin đã đến nơi trong lúc
  // chờ lane, để khỏi phải mò trong log vài nghìn dòng khi truy nguyên nhân lặp
  const buStats = { ok: 0, cancelled: 0, byWhy: {} };
  // Đếm các lần BẮN LẠI cùng nội dung ngay trong 1 lần gửi Socket (retry khi FB báo
  // rejected + bắn lại riêng ảnh) — in vào TỔNG HỢP để đối chiếu với phản ánh lặp của khách
  /** Cửa sổ NGHE ACK (giữ entry PENDING lại) — phủ max ACK đã đo 7 988 ms + biên đồng hồ.
   *  Trần 30 000 ms = đúng trần tự xoá của app (`_app` @815747 b=3e4).
   *  [v1.92.48] Khai báo SỚM (trước sendDiag) để dòng log 📡 dùng được — các hằng số ACK_LISTEN_*
   *  nằm trong cùng scope, không có TDZ. */
  function ackListenMsFor(holdMs) {
    const h0 = Math.round(Number(holdMs) || 0) || 1200;
    const h = Math.min(h0, ACK_LISTEN_MAX_MS); // không bao giờ vượt trần tự xoá của app
    return Math.min(ACK_LISTEN_MAX_MS, Math.max(h, Math.max(h + 6000, 12000)));
  }
  const sendDiag = {
    sockRetry: 0, sockRetryRecovered: 0, sockRetryRejected: 0, sockRetryOther: 0, photoRetry: 0,
    recipientUnavailable: 0,
    // [v1.92.26] Ca bị FB từ chối lần 1 mà KHÔNG thử lại (ngân sách đã đóng) và ca được
    // cứu sang làn API vì không có global_id (trước đây bị bỏ luôn -> mất tin).
    sockRetryBudgetSkipped: 0, apiNoGidFallback: 0,
    // [v1.92.13] Số ca bị CHÍNH bộ ngắt quá tải của Ext chặn trước khi bắn (chưa hề gửi lệnh nào)
    // mà kế hoạch không còn kênh nào khác ⇒ bị tính ❌ oan. Lô 15:54: 1 526 ca.
    extOverloadSkips: 0,
    socketAckOk: 0, socketAckRejected: 0, socketNoAck: 0,
    socketAckMsTotal: 0, socketAckMsMax: 0,
    socketAckLt250: 0, socketAck250To999: 0, socketAck1To2s: 0, socketAck2To5s: 0, socketAckGte5s: 0,
    // [v1.92.48] TÁCH "CẮT ACK" KHỎI "IM LẶNG THẬT" — tiêu chí nghiệm thu của lần chạy sau:
    //   sockAckHoldExpired phải về 0 khi ACK thật đang về; sockAckLateOk là số ca được CỨU
    //   (␣→✅) nhờ nghe muộn ⇒ mỗi ca ở đây là MỘT TIN KHÔNG BỊ TRÙNG.
    sockAckHoldExpired: 0, sockAckSilent: 0, sockLateAck: 0, sockLateOk: 0, sockLateRejected: 0,
    sockLateAckErr: 0, sockLateUnapplied: 0, sockLateNoack: 0,
    apiQueued: 0, apiStarted: 0, apiFetchAttempts: 0, apiSuccess: 0, apiRejected: 0, apiUnknown: 0,
    api429: 0, api429Retries: 0, apiCancelled: 0, apiFallback: 0,
    apiQueueWaitMsTotal: 0, apiQueueWaitMsMax: 0, apiFetchMsTotal: 0, apiFetchMsMax: 0,
    // [v1.92.7] Vòng mẫu fetchMs để tính p50. TB bị max kéo lệch nên không phân biệt được
    // "mọi request chậm" với "vài request kẹt"; p50 mới so được với HAR (xem docs §32).
    apiFetchSamples: [],
    apiStatusCounts: Object.create(null),
    // [v1.92.30] Cổng chứng minh vắng mặt trước khi bù: bao nhiêu ca HỦY được bù vì tin ĐÃ tới
    // (buProofPresent = số lần lặp chặn được), bao nhiêu ca chứng minh được vắng mặt, không rõ,
    // và bao nhiêu ca dùng lại kết quả đã dò (không tốn thêm request).
    buProofPresent: 0, buProofAbsent: 0, buProofUnknown: 0, buProofCached: 0,
    /* [v1.93.14] `fbDirectPresent` = số lần Pancake nói "chưa thấy" NHƯNG đọc thẳng FB thấy tin
     * ⇒ chặn được 1 lần bù ⇒ chặn được 1 tin trùng. Đây là thước đo trực tiếp của §28/§25.2. */
    fbDirectPresent: 0,
    buProofGated: 0, buProofCancelled: 0,
    // [v1.92.44] số ca bị khoá chống trùng chặn lại (KHÔNG phải lệnh gửi thật)
    dupBlocked: 0,
    /* [v1.92.45] ĐUÔI CHỜ XÁC NHẬN — đo đúng cái người dùng phàn nàn: "gửi 100 con mà chờ
     * 1–2 con xác nhận lâu quá". Tách 3 số để biết thời gian nằm ở đâu:
     *   tailChats   = số chat phải chờ xác nhận nền sau khi đã phát xong lệnh
     *   tailMaxMs   = ca chờ lâu nhất (từ lúc phát tới lúc có kết luận)
     *   unavailFast = số ca chốt "khách không nhận được" NGAY trong làn gửi (không vào cổng chờ) */
    tailChats: 0, tailMaxMs: 0, unavailFast: 0,
  };
  const waveDiag = {
    waveSize: 0, configuredGapMs: 0, quickEnabled: false, plannedWaves: 0, wavesStarted: 0,
    gateWaitMsTotal: 0, gateWaitMsMax: 0,
    maxMainInFlight: 0, mainCapMinObserved: 0, mainCapFinal: 0, mainCapDownshifts: 0, mainCapUpshifts: 0,
    maxSocketRetryQueue: 0, maxSocketRetryActive: 0,
    maxSocketCooldown: 0, maxSocketLaneActiveTotal: 0, maxSocketLaneWaitingTotal: 0,
    maxSocketLaneActivePerPage: 0, maxSocketLaneWaitingPerPage: 0,
    maxExtQueue: 0, maxExtActive: 0, maxApiWaiting: 0,
    // [v1.92.28] ĐẾM AI GIỮ CỔNG: 4 lý do chặn mở wave, để biết cái gì làm lô chậm.
    gateBlockInflight: 0, gateBlockRetry: 0, gateBlockExt: 0, gateBlockApi: 0,
    /* [v1.92.52] TÁCH "ĐANG BAY" THÀNH 3 MỨC — LÔ 12:24 (8 509 chat) KHÔNG GIẢI THÍCH ĐƯỢC BẰNG
     * `gateBlockInflight` GỘP.
     * Số đo: 19 dòng wave in "main đang bay 163" y nguyên; 18 cổng giữ tổng 253,6 s / 404 s
     * (63 % thời gian lô), riêng wave 15 giữ 106,0 s. Trước bản này chỉ có MỘT bộ đếm
     * `gateBlockInflight`, nên không phân biệt được:
     *     (a) đang bay > 92 % cap (176)  → chặn hẳn, chờ slot thoát thật sự
     *     (b) đang bay 164…176           → vượt 75 % (144) nên KHÔNG mở được bằng nhánh nhanh,
     *                                      chỉ chờ nhánh mềm 85 % (163 ≤ 163 ⇒ mở được)
     *     (c) đang bay ≤ 163 nhưng chưa đủ 25 % item xong → chờ TIẾN ĐỘ, không phải chờ slot
     * Ba số dưới đây tách đúng 3 mức đó. Chỉ ĐẾM, không đổi một nhánh mở cổng nào.
     * (1 180 ms ≈ 2 nhịp kiểm 60 ms; 174 = floor(192 × 0,92) − 2; 161 = floor(192 × 0,85) − 2.) */
    gateBlockHard: 0, gateBlockSoft: 0, gateBlockProgress: 0,
    /* [v1.92.55] ĐO CẢ NHÁNH "CHỜ VIỆC XONG" — LÔ 14:03 KHÔNG GIẢI THÍCH ĐƯỢC BẰNG 3 SỐ CŨ.
     * Wave 24 giữ cổng **25 013 ms** với `main đang bay 0`: không có worker nào đang chạy, tức
     * cũng không thể có ai đang xếp hàng chờ slot ⇒ cả 3 số cũ (cứng/mềm/tiến độ) đều bằng 0 dù
     * cổng bị giữ 25 s. Lý do thật: `waveDoneCount < waveSlice.length` mà chưa đạt nhánh mở nào
     * ⇒ cổng chờ ĐẾM XONG, và cái đếm đó bị 51 ca treo trong sổ chờ xác nhận giữ lại.
     * Nay đếm thêm 2 nhóm để lần sau đọc được bằng số, KHÔNG đổi nhánh mở nào:
     *   gateWaitDone   = số lượt kiểm mà cổng bị giữ CHỈ vì chưa xong việc (không backpressure)
     *   gateBgPendingMax = đỉnh số ca còn treo trong sổ chờ xác nhận lúc cổng đang giữ
     *   gateNoWorkerSeen = số lượt kiểm thấy `main đang bay 0` mà cổng vẫn giữ */
    gateWaitDone: 0, gateBgPendingMax: 0, gateNoWorkerSeen: 0,
    /* [v1.92.52] ĐO "CHỜ SLOT ĐÃ NHƯỜNG" — giả thuyết về wave 15 giữ 106 s.
     * `acquireMainSlot()` ở dòng ~11255 gọi `runMainItem()` gần như TỨC THÌ sau `await` (không có
     * I/O ở giữa), nên khi một slot vừa nhả, worker nhận lại slot TRƯỚC KHI `bgClock.every(60)`
     * kịp chạy `evaluateGate()` ⇒ `inFlightMainCount` gần như KHÔNG BAO GIỜ đo được ≤ 163
     * (0,85 × 192) ở nhịp 60 ms. Đây là GIẢ THUYẾT, chưa phải kết luận.
     * Hai số dưới đây đo đúng chỗ đó, KHÔNG đổi nhịp kiểm cổng:
     *   gateIdleSeen  = số lần evaluateGate() thấy đang bay ≤ 144 (75 % cap)
     *   gateIdleMax   = giá trị "đang bay" THẤP NHẤT từng thấy sau khi đã đạt 25 % item xong
     * Nếu lô sau `gateIdleSeen` = 0 mà vẫn giữ cổng hàng chục giây ⇒ giả thuyết ĐÚNG.
     * Nếu `gateIdleSeen` lớn mà cổng vẫn giữ ⇒ giả thuyết SAI, phải tìm nguyên nhân khác. */
    gateIdleSeen: 0, gateIdleMax: -1,
    // [v1.92.43] ĐO THỜI GIAN GIỮ SLOT MAIN theo pha. Log 16:52/17:03: 192 slot mà chỉ
    // 17,75/18,45 tin/s ⇒ mỗi chat giữ slot ~10,7 s (192 ÷ 18). Trước đây KHÔNG có số nào
    // tách được thời gian đó nằm ở đâu ⇒ mọi phỏng đoán đều là đoán. Nay tách 3 phần:
    //   chờ slot · chuẩn bị (ctx/tên/ảnh) · bản thân lần gọi kênh (gid + publish + ACK chờ).
    slotN: 0, slotAcquireMs: 0, slotHoldMs: 0, slotPrepMs: 0,
    /* [v1.92.53] XẺ "CÒN LẠI" THÀNH 3 PHẦN — LÔ 8 509 KHÔNG ĐÓNG ĐƯỢC BẰNG 2 CON SỐ.
     * Lô 12:24 in `chờ 662 · chuẩn bị 0 · còn lại 5 741 · tổng 5 741`. Đối chiếu vật lý:
     *   PHÁT = 260,5 s cho 8 509 lệnh = 21,10 lệnh giây-gốc; 21,10 × 5 741 ms = 121 slot luôn bận.
     *   Chỉ 192 slot × 260,5 s = 50 016 slot-giây ⇒ 8 509 chat ⇒ **sàn cứng 5 879 ms/chat**.
     *   Nhưng giữ slot in ra 5 741 < 5 879 ⇒ 2 số KHÔNG cùng một mẫu số: `slotN` chỉ tăng sau
     *   `sendOneAndLog`, còn chat bị chặn/hoãn theo lô nền/comment thì vẫn giữ slot mà không
     *   cộng vào `slotN`. Vì vậy "chờ 662" thực chất nằm TRONG "còn lại", không phải cộng thêm.
     * ĐÃ KIỂM TRONG CODE: ACK KHÔNG nằm trong slot. Nhánh `ctx.sockFired` (dòng ~5237) trả về
     * ngay sau `await slotStartedPromise`; `finalizeSockBg` xử lý ACK ở NỀN. Vì vậy đừng đi tìm
     * "chờ ACK" trong `còn lại` — phải chia theo phần TRƯỚC khi publish.
     * Nay đo 3 lát cắt của đúng khoảng "giữ slot → sendOneAndLog trả về":
     *   prepGidMs       = dò/cứu global_id (phần đắt nhất của prepareDirectCtx)
     *   prepBindMs      = bind fbId ảnh (is_reusable=false) bên trong prepareDirectCtx
     *   slotAcqN/acqPos = số lần PHẢI CHỜ slot + tổng ms chờ. `chờ 662` của lô 8 509 gần như
     *                     chắc chắn SAI: `releaseMainSlot()` chuyền slot trực tiếp cho người
     *                     chờ kế (shift → resolve(true), biến đếm không đổi) nên ca phải xếp
     *                     hàng mới có ms. Nếu lô sau vẫn ra 0 thì con số cũ là số ảo.
     * Ba số này + `bind fbId` + `giữ cổng` phải xấp xỉ `còn lại`; phần dôi ra là CPU bị bóp. */
    prepGidMs: 0, prepGidN: 0, prepBindMs: 0, prepBindN: 0, slotAcqN: 0, slotAcqPosMs: 0,
    /* [v1.92.54] tách LƯỢT DÒ 1 vs LƯỢT DÒ 2 của khâu global_id (xem chỗ cộng trong prepareDirectCtx) */
    prepGidP1Ms: 0, prepGidP1N: 0, prepGidP2Ms: 0, prepGidP2N: 0,
  };

  /* ===== [v1.92.28] TỈ LỆ FB TỪ CHỐI TRÊN CỬA SỔ GẦN NHẤT =====
   * Ngân sách thử lại Socket (1.92.26) đóng theo tỉ lệ từ chối TÍCH LUỸ. Lô 10:21 (12 407 chat):
   * tỉ lệ tích luỹ đầu lô > 70% (mấy wave đầu nhiều khách chết) nên ngân sách chỉ đóng sau
   * **657** lần thử (đáng lẽ ~40) ⇒ vẫn phí 5% lưu lượng socket.
   * Nay đo trên 200 ACK GẦN NHẤT: burst-reject thật (FB chặn tạm cả page) cho ~100%, còn
   * "lô nhiều khách chết" cho ~40–60% ⇒ phân biệt được ngay từ đầu lô.
   */
  const SOCK_ACK_RECENT_N = 200;
  const sockAckRecent = { ring: new Uint8Array(SOCK_ACK_RECENT_N), i: 0, n: 0, ok: 0, rejected: 0, noack: 0 };
  function resetSockAckRecent() {
    sockAckRecent.i = 0; sockAckRecent.n = 0;
    sockAckRecent.ok = 0; sockAckRecent.rejected = 0; sockAckRecent.noack = 0;
  }
  function noteSockAckRecent(kind) {
    const c = kind === 'ok' ? 1 : (kind === 'rejected' ? 2 : (kind === 'noack' ? 3 : 0));
    if (!c) return;
    const R = sockAckRecent;
    if (R.n === R.ring.length) {
      const old = R.ring[R.i];
      if (old === 1) R.ok--; else if (old === 2) R.rejected--; else if (old === 3) R.noack--;
    } else R.n++;
    R.ring[R.i] = c;
    R.i = (R.i + 1) % R.ring.length;
    if (c === 1) R.ok++; else if (c === 2) R.rejected++; else R.noack++;
  }
  /** % bị từ chối trên cửa sổ gần nhất; -1 = chưa đủ mẫu để kết luận (coi như chưa biết). */
  function socketRejectPctRecent(minSamples) {
    const R = sockAckRecent;
    const min = Number(minSamples) || 40;
    if (R.n < min) return -1;
    const total = R.ok + R.rejected + R.noack;
    return total ? (R.rejected * 100 / total) : 0;
  }
  function recordSocketAckOutcome(kind, elapsedMs, pageId) {
    try {
      const ms = Math.max(0, Number(elapsedMs) || 0);
      noteSocketPageLaneOutcome(pageId, kind, ms);
      if (kind === 'ok') sendDiag.socketAckOk++;
      else if (kind === 'rejected') sendDiag.socketAckRejected++;
      else if (kind === 'noack') sendDiag.socketNoAck++;
      noteSockAckRecent(kind); // [v1.92.28] cửa sổ 200 ACK gần nhất (dùng cho ngân sách thử lại)
      // [v1.92.29] Ca 'noack' mang thời gian HẾT HẠN CHỜ (vd 5 263 ms), không phải ACK thật:
      // lô 13:42 in "ACK TB/max 5263/5263 · bucket ≥5s = 1" cho một ca mất ACK ⇒ p50/p90 lệch
      // ⇒ "ngưỡng nhanh" sai. Chỉ ok/rejected mới là ACK.
      if (kind === 'ok' || kind === 'rejected') {
        sendDiag.socketAckMsTotal += ms;
        sendDiag.socketAckMsMax = Math.max(sendDiag.socketAckMsMax, ms);
        if (ms < 250) sendDiag.socketAckLt250++;
        else if (ms < 1000) sendDiag.socketAck250To999++;
        else if (ms < 2000) sendDiag.socketAck1To2s++;
        else if (ms < 5000) sendDiag.socketAck2To5s++;
        else sendDiag.socketAckGte5s++;
      }
    } catch (e) { /* diagnostics must never affect sending */ }
  }
  function buWhyBucket(why) {
    const w = String(why || '');
    if (w.indexOf('API từ chối') === 0) return 'API tu choi';
    if (w.indexOf('Socket bị từ chối') === 0) return 'Socket tu choi';
    if (w.indexOf('gửi thẳng') === 0) return 'Gui thang fail';
    if (w.indexOf('gửi chưa được') === 0) return 'Lan dau fail';
    if (w.indexOf('bù ') === 0) return 'Chuoi bu';
    if (w.indexOf('kiểm chứng') > -1) return 'Kiem chung ACK';
    return 'Khac';
  }
  const BU_RETRY_MS = 1000;     // Socket: kênh dự phòng cuối (1s)
  const BU_SPREAD_MS = 50;      // rải nhẹ 50ms — hàng đợi Socket/Ext vốn đã tự điều tiết
  const buRetryDone = {}; // convId → đã bù trong lượt này
  const ctx7Retried = {}; // convId → đã gửi lại 1 lần kèm cờ ctx-7-days trong lượt này (chống lặp vô hạn)
  let buRetrySeq = 0;
  // [v1.92.31] đếm số dòng ❌ "bỏ thử lần 2" đã in ĐỦ LÝ DO (20 dòng đầu) — sau đó in bản gọn
  // để 5 178 dòng trùng nhau không nhấn chìm log.
  let buQuietBudgetNote = 0;
  let runSeq = 0; // mỗi lượt gửi 1 số — bù của lượt cũ tự hủy khi có lượt mới (chống gửi lẫn/lặp)
  const deliveredIds = {}; // convId → ĐÃ có kênh báo thành công trong lượt này ('api'|'ext'|'socket') — tuyệt đối không gửi lại
  const claimedSendIds = {}; // convId → đã nhận quyền bắn trong lượt này (chống 2 worker / 2 câu cùng 1 chat)
  const outboundLock = {}; // convId → đang/đã bắn tin (chưa xác nhận fail) — chặn POST/publish chồng
  const buRetryTimer = {}; // convId → timeout bù đang chờ (chống 2 chuỗi bù chạy song song)
  const buLateRetryCount = {}; // [v1.92.40] số lần hẹn thử lại vì Ext bị bộ ngắt chặn (tối đa 2)
  /* [v1.92.41] NGÂN SÁCH DÒ EXT CHO CA FB TỪ CHỐI "NGƯỜI NÀY HIỆN KHÔNG CÓ MẶT" (1545041).
   * Số đo 2 lô 16:07/16:11 (1.92.38): Socket bị FB từ chối 3 425 + 2 367 ca; script KHÔNG thử
   * kênh nào khác ⇒ chốt ❌ 3 311 + 2 214 ca, trong khi làn API và Ext gần như TRỐNG
   * (API 15/45 lệnh, Ext queue 0/0). Đó là lý do hai lô chỉ đạt 43,1 % và 60,1 %.
   * Nhưng không được bù mù: nếu Ext cũng bị đúng lỗi đó thì 5 500 lệnh chỉ làm chậm lô.
   * Vì vậy DÒ CÓ ĐO: thử Ext cho tối đa 200 ca đầu; cứu được ≥1 ⇒ giữ mở; 0 cứu ⇒ ĐÓNG và
   * phần còn lại vào danh sách gửi tay (⚠ "chưa gửi"), KHÔNG chốt ❌ oan. */
  /* [v1.92.45] NGÂN SÁCH DÒ 1545041 — đóng SỚM theo chuỗi liên tiếp, không chờ 200 ca.
   *
   * Số đo cũ (log 16:11 / 16:20) + HAR làn Ext: dò 799 ca cứu 0, dò 1 431 ca cứu 0; HAR 90
   * lệnh của extension Pancake v2 trả 1545041 ở 86/86 ca kể cả khi làn Ext HOÀN TOÀN RỖI.
   * Nghĩa là với nhóm khách này KHÔNG kênh nào gửi được. Ngân sách cũ đòi đủ 200 ca mới đóng
   * ⇒ mỗi lô mất ~200 lệnh + 200 s ở đuôi chỉ để học lại một điều đã biết.
   *
   * Nay đóng khi: `tried >= PROBE (200)` như cũ **HOẶC** 30 ca LIÊN TIẾP toàn 1545041 mà
   * `saved = 0`. Bất kỳ ca cứu được nào (saved++) là reset chuỗi — nếu Ext thật sự gửi được
   * thì ngân sách mở lại ngay, không bao giờ đóng oan.
   * Vẫn giữ nguyên hệ quả: ca bị đóng ⇒ ⚠ "chưa gửi" + danh sách gửi tay, KHÔNG chốt ❌ oan. */
  const extTry1545 = { tried: 0, saved: 0, closed: false, PROBE: 200, streak: 0, STREAK_MAX: 30,
    unknown: 0, sinceProbe: 0, PROBE_REOPEN_EVERY: 200, closedWhy: '' };
  /* [v1.92.47] CẦU DAO ĐƯỜNG DÒ GLOBAL ID QUA EXTENSION — cùng loại ngân sách với `extTry1545`,
   * nhưng dành cho khâu DÒ chứ không phải khâu GỬI.
   * Bằng chứng ĐO ĐƯỢC:
   *   • network-log2.har: 73 request / 81,4 s, trong đó **63/63** lượt phân trang danh sách
   *     (`MessengerGraphQLThreadlistFetcher`) đều bắt đầu từ CÙNG một con trỏ
   *     `before=1794874125000` — tức khối "load trang kế" nổ lỗi parse rồi bị thử lại vô hạn
   *     (nhiều cặp khối trùng nội dung 100 %, chỉ khác `__req`), mãi không tiến được con trỏ.
   *   • Log console Pancake v2: `FAIL TO GET GLOBAL ID --> INCORRECT THREAD <id>, undefined VS
   *     undefined` lặp lại cho ĐÚNG 4 thread (1515207651668552 · 1513207581868559 ·
   *     1471973704859890 · 1513112878544696), mỗi thread 2 lần — extension không nhớ "đã hỏng".
   * `noteGidExtResult` chỉ giảm làn ×0,7 khi quá hạn (sàn 3) nên ca Ext trả lời "không có gid"
   * KHÔNG BAO GIỜ đóng đường dò: mỗi chat vẫn tốn 2 lệnh Ext + 250 ms + chờ WS. Nay đóng hẳn
   * đường dò Ext cho cả lượt khi dồn đủ ca "trả lời mà không có gid", và đóng sớm hơn nếu
   * CÙNG MỘT thread id hỏng lặp lại (đúng hình dạng 4 thread trong log). */
  const gidBreaker = { noGid: 0, sameThread: 0, lastThread: '', closed: false,
    NO_GID_MAX: 40, SAME_THREAD_MAX: 3 };
  function gidExtFinderAllowed() { return !gidBreaker.closed; }
  function noteGidFinderNoGid(threadId) {
    if (gidBreaker.closed) return;
    const t = String(threadId || '');
    gidBreaker.noGid++;
    if (t && t === gidBreaker.lastThread) gidBreaker.sameThread++;
    else { gidBreaker.lastThread = t; gidBreaker.sameThread = t ? 1 : 0; }
    if (gidBreaker.noGid < gidBreaker.NO_GID_MAX && gidBreaker.sameThread < gidBreaker.SAME_THREAD_MAX) return;
    gidBreaker.closed = true;
    try {
      logLine('🔒 Đóng đường dò global_id qua Extension cho lượt này: '
        + (gidBreaker.sameThread >= gidBreaker.SAME_THREAD_MAX
          ? 'thread ' + gidBreaker.lastThread + ' trả lời "không có gid" ' + gidBreaker.sameThread + ' lần'
          : gidBreaker.noGid + ' lần liên tiếp Ext trả lời mà không có gid')
        + ' ⇒ giống hệt lỗi parse GraphQL của extension (log: "INCORRECT THREAD …, undefined VS'
        + ' undefined"). Từ giờ chỉ dò bằng HTTP/WebSocket; ca không dò được vẫn giữ ⚠ (chưa gửi),'
        + ' KHÔNG chốt ❌ oan.');
    } catch (e0) { /* ignore */ }
  }
  /* [v1.92.49] GHI NHẬN KẾT QUẢ CỦA LẦN BÙ EXT — ĐÚNG MỘT CHỖ, GỌI TỪ MỌI NHÁNH.
   * Sổ 11:05 (6 920 chat): TỔNG HỢP in "🛟 Dò Ext cho ca FB từ chối: thử 2 768 · cứu 0"
   * mà KHÔNG có chữ "ĐÓNG". Nghĩa là cầu dao ngân sách 200 ca CHƯA BAO GIỜ đóng dù tried
   * gấp 13,8 lần PROBE. Nguyên nhân đọc được từ code: `noteExt1545Fail()` chỉ được gọi ở
   * 3 nhánh .then của chuỗi bù; còn nhánh "ngân sách thử lại Socket đã đóng" bắn bù bằng
   * scheduleBuRetry() rồi return NGAY, và nếu chuỗi bù đó vướng sockFiredPending/outboundLock
   * (socket vẫn đang bay) thì chuỗi .then KHÔNG BAO GIỜ chạy ⇒ streak không tăng ⇒ không đóng.
   * Hàm dưới đây gộp 1 chỗ: sổ chỉ đóng khi có BẰNG CHỨNG (Ext cũng bị chặn), còn trường hợp
   * "chưa có kết quả" (quá hạn / không rõ) chỉ tính vào bộ đếm riêng, KHÔNG đóng sổ. */
  function noteExt1545Outcome(kind) {
    if (!extTry1545) return;
    if (kind === 'saved') { extTry1545.saved++; extTry1545.streak = 0; return; }
    if (kind === 'blocked') noteExt1545Fail();          // 1545041 / không gửi được: bằng chứng
    else extTry1545.unknown = (extTry1545.unknown || 0) + 1; // quá hạn / không rõ
  }
  /* ═══ [v1.92.66] CẦU DAO EXT: `closed` PHẢI TỰ ĐÓNG ĐƯỢC TRONG CÙNG LƯỢT, VÀ PHẢI CÓ LOG ═══
   *
   * BỆNH (đo trên lô 19:48:22, 15 336 chat, page 881264518397934):
   *   3 600 ca ⚠ in câu "đã đo 200 ca thì Extension cũng bị chặn" (grep = 3 611 lần), nhưng:
   *     • `🔒 Đóng ngân sách` — **0 dòng** trong cả file log;
   *     • `🛟 Dò Ext cho ca FB từ chối: thử …` — **0 dòng**, tức `extTry1545.tried` = 0;
   *     • `noteExt1545Fail()` chỉ chạy khi `kind === 'blocked'` mà hàm đó CHỈ được gọi từ
   *       `.then` của chuỗi bù Ext ⇒ nếu chuỗi đó không chạy (bị `sockFiredPending`/
   *       `outboundLock` chặn) thì `saved` và `streak` đứng nguyên 0.
   *   ⇒ Cả hai đường đóng (`byStreak` và `byProbe`) đều KHÔNG THỂ chạm. `closed` = false.
   *   ⇒ Vậy 3 600 ca đó KHÔNG đi vào nhánh 5373. Chúng đi qua chính `extFallback1545Allowed()`
   *      trả **true** ở nhánh 7830 — nghĩa là script ĐÃ ĐỊNH bắn bù qua Ext, đánh ⚠, và câu
   *      "đã đo 200 ca thì Extension cũng bị chặn" chỉ là **CHUỖI CỐ ĐỊNH VIẾT SẴN**, không
   *      phải sự thật. Đó là lý do con số "200" trong 3 611 dòng luôn là 200, không bao giờ tăng.
   *
   * SỬA (3 việc, không thêm lệnh gửi nào):
   *   1) Câu log KHÔNG ĐƯỢC NÓI ĐIỀU CHƯA ĐO. Nay in số thật + nhánh rõ ràng (xem 7830).
   *   2) Thêm PHANH CỨNG theo chính lô: `tried` tăng ở MỌI chỗ định bắn Ext (cả 5353 và 7817),
   *      nên đếm `tried` là thứ luôn nhìn thấy được. Đủ `PROBE` ca đã định-bắn mà cứu 0 ⇒ đóng,
   *      và IN RA LÝ DO + số thật. Không phụ thuộc `.then` nào cả.
   *   3) Đóng thì có ĐƯỜNG MỞ: đã đóng vẫn dò lại 1 ca mỗi `PROBE_REOPEN_EVERY` ca bị bỏ
   *      (giống `sockRetryBudgetState` đã làm). Lô này bỏ 3 600 ca ⇒ sẽ có ~18 ca được dò lại;
   *      cứu được 1 ca là mở ngay. Trước đây `closed` là VĨNH VIỄN tới hết lượt.
   *
   * Vì sao "đo rồi đóng" là đúng ở đây: `PROBE` = 200 ca là mẫu rất lớn. Nếu 200 ca liên tiếp
   * định bắn Ext mà cứu được 0, thì Ext đang bị FB chặn thật (đúng như chú thích 1.92.41), và
   * 3 600 ca còn lại mà cứ bắn Ext là 3 600 lệnh vô ích giữ lane. Nhưng phải ĐO ĐƯỢC VIỆC ĐÓ —
   * chính là thứ bản 1.92.65 không làm được. */
  function extFallback1545Allowed() {
    if (!extTry1545.closed) return true;
    /* Đã đóng: chỉ cho phép 1 ca DÒ LẠI mỗi PROBE_REOPEN_EVERY ca bị bỏ.
     * [v1.92.66] KHÔNG reset `sinceProbe` ở đây — việc reset chuyển sang `noteExt1545Attempt()`.
     * Lý do: hàm này là câu hỏi "có được thử không?", nó được gọi ở MỌI ca và có thể bị gọi
     * nhiều lần cho một ca (kiểm tra rồi mới bắn). Nếu reset ngay trong câu hỏi thì chỉ cần hỏi
     * 200 lần là cầu dao tự mở, kể cả khi không ca nào thật sự được bắn. Reset phải gắn với
     * HÀNH ĐỘNG đã thực sự thử. */
    return extTry1545.sinceProbe >= extTry1545.PROBE_REOPEN_EVERY;
  }
  /** Ghi nhận MỘT CA ĐÃ ĐỊNH BẮN QUA EXT (không cần biết kết quả). Đây là bộ đếm mà bản cũ
   *  thiếu: `tried` cũ chỉ tăng ở 2 nhánh, và không nhánh nào tự kiểm tra ngưỡng. */
  function noteExt1545Attempt() {
    /* PHANH CỨNG — đây chính là chỗ 1.92.65 thiếu. `tried` là bộ đếm DUY NHẤT mà cả hai nhánh
     * định-bắn Ext đều đi qua, nên nó luôn nhìn thấy sự thật dù `.then` của chuỗi bù có chạy hay
     * không. Đủ PROBE ca đã định bắn mà cứu được 0 ⇒ đóng, kèm lý do in ra được.
     * KHÔNG đóng khi đã có `saved > 0` (Ext vẫn sống thì đừng tắt). */
    if (!extTry1545.closed) {
      extTry1545.tried++;
      if (extTry1545.tried >= extTry1545.PROBE && extTry1545.saved === 0) closeExt1545('probe');
      return;
    }
    /* Đã đóng ⇒ lần gọi này CHỈ xảy ra khi `extFallback1545Allowed()` vừa cho qua (ca dò lại).
     * Tăng `tried` để con số trong TỔNG HỢP phản ánh cả các ca dò lại, và reset `sinceProbe`
     * để đếm 200 ca bị bỏ TIẾP THEO. */
    extTry1545.tried++;
    extTry1545.probes = (extTry1545.probes || 0) + 1;
    extTry1545.sinceProbe = 0;
  }
  function noteExt1545Fail() {
    if (extTry1545.closed) return;
    extTry1545.streak = (extTry1545.streak || 0) + 1;
    const byStreak = extTry1545.streak >= extTry1545.STREAK_MAX && extTry1545.saved === 0;
    const byProbe = extTry1545.tried >= extTry1545.PROBE && extTry1545.saved === 0;
    if (!byStreak && !byProbe) return;
    closeExt1545(byStreak ? 'streak' : 'probe');
  }
  function closeExt1545(why) {
    if (extTry1545.closed) return;
    extTry1545.closed = true;
    extTry1545.closedWhy = why;
    extTry1545.sinceProbe = 0;
    try {
      logLine('🔒 Đóng ngân sách dò Extension cho ca "người này hiện không có mặt": '
        + (why === 'streak'
          ? extTry1545.streak + ' ca LIÊN TIẾP toàn bị FB từ chối'
          : 'đã ĐỊNH bắn ' + extTry1545.tried + ' ca')
        + ' · cứu được ' + extTry1545.saved + ' ⇒ Extension cũng bị FB chặn. Phần còn lại vào '
        + 'danh sách gửi tay (⚠ chưa gửi), không chốt ❌ oan. Vẫn dò lại 1 ca mỗi '
        + extTry1545.PROBE_REOPEN_EVERY + ' ca để mở lại nếu Ext sống lại.');
    } catch (e0) { /* ignore */ }
  }
  const finalFailedIds = {}; // convId → đã thất bại hẳn (hết kênh hoặc khách khóa nick)
  const uncertainIds = {};   // convId → không rõ kết quả ('maybe')
  const skippedLateIds = {}; // convId → bỏ qua lúc gửi (tag cấm / icon điện thoại vừa gắn)
  // Sổ tin bắn-nhả đang chờ xác nhận nền + WATCHDOG: quá 90s mà không kênh nào chốt
  // (fetch treo, ACK mất, bù văng lỗi…) → tự chốt ⚠ để pending về 0: TỔNG HỢP luôn kết thúc,
  // nút Chạy/Dừng luôn nhả. KHÔNG gửi lại (tránh trùng); ACK thật về sau markDelivered tự sửa số.
  const pendingBg = {}; // convId → { at, name, via }
  /* [v1.92.55] đếm số ca ĐANG TREO trong sổ chờ xác nhận — dùng cho số đo cổng (xem waveDiag).
   * Lô 14:03: wave 24 giữ cổng 25 013 ms với `main đang bay 0` và còn 51 ca treo ⇒ giả thuyết
   * "cổng chờ ĐẾM XONG bị chính sổ chờ giữ lại" chỉ kiểm được khi có con số này. */
  function pendingBgCount() { try { return Object.keys(pendingBg).length; } catch (e) { return 0; } }
  // Sổ kiểm chứng sau khi Socket mất ACK (khai báo sớm tại đây để getBatchSummaryCounts
  // tính được số ca đang chờ kiểm chứng vào "pending" — lượt không kết thúc, nút Gửi không
  // nhả cho tới khi kiểm chứng chốt, tránh người dùng bấm lượt mới làm hủy đường bắn cứu).
  const sockVerifyPending = {}; // convId → runSeq đang có kiểm chứng chờ (chống đăng ký trùng)
  const sockVerifyFired = {}; // convId → runSeq đã bắn cứu sau kiểm chứng (mỗi lượt tối đa 1 lần/chat)
  // [v1.91.85] HÀNG ĐỢI KIỂM CHỨNG SOCKET — chống bão đọc lịch sử.
  // Khi ACK mất hàng loạt, mỗi lần mất là 1 vòng kiểm chứng tới 4 lần đọc, giãn cách 2/4/6s.
  // Với 192 kênh song song thì có thể có hàng trăm vòng đọc cùng lúc ⇒ 429 tràn sang cả
  // đường Extension bù ⇒ mọi thứ chậm. Nay chỉ chạy tối đa 12 vòng kiểm chứng cùng lúc;
  // phần còn lại xếp hàng FIFO. KHÔNG đổi logic phán xử (vẫn cần 2 lần đọc rỗng liên tiếp
  // mới dám kết luận "chưa tới"), chỉ giới hạn số vòng đọc đồng thời.
  // [v1.92.3] 12 → 32. §29.5: `GET …/messages?customer_id=…` đo trên 217 request trong 12 HAR
  // có p50 = 43ms, p90 = 132ms (không phải ~900ms như giả định cũ). Kiểm chứng lịch sử vì thế
  // rất rẻ, trong khi ca no-ACK thật ~5 % (1/14 và 1/27 HAR) sẽ được chốt nhanh hơn nhiều.
  // Đây chỉ là ĐỌC lịch sử để nâng ⚠→✅ — không bao giờ gửi lại, không thêm tải lên đường gửi.
  /* [v1.92.43b] 32 → 96. Số đo 2 lô lớn: no-ACK/phải kiểm chứng 1 266 ca (lô A) và 1 881 ca
   * (lô B); mỗi ca giữ vòng kiểm chứng ~10 s (chờ mốc chứng minh vắng mặt BU_PROOF_WAIT_MS) ⇒
   * 1 266 ÷ 32 × 10 s ≈ 396 s đuôi. Đường này CHỈ ĐỌC lịch sử (GET …/messages, p50 43 ms theo
   * §29.5), không gửi, không chiếm ghế làn gửi ⇒ nâng 32 → 96 rút đuôi còn ~1/3.
   * Trần 96 = đúng trần làn ctx đang dùng, không tạo thêm tải mới. */
  const SOCK_VERIFY_PARALLEL = 96;
  let sockVerifyRunning = 0;
  const sockVerifyQueue = [];
  function pumpSockVerify() {
    while (sockVerifyRunning < SOCK_VERIFY_PARALLEL && sockVerifyQueue.length) {
      const fn = sockVerifyQueue.shift();
      sockVerifyRunning++;
      Promise.resolve()
        .then(fn)
        .catch(() => { /* lỗi từng vòng đã được xử lý bên trong */ })
        .then(() => { sockVerifyRunning--; pumpSockVerify(); });
    }
  }
  function enqueueSockVerify(fn) {
    sockVerifyQueue.push(fn);
    pumpSockVerify();
  }
  const verifyStats = { found: 0, held: 0, unknown: 0 }; // theo lượt — in ở dòng TỔNG HỢP (held = giữ ⚠, không bắn lại)
  const sockRescueStats = { tried: 0 }; // [v1.92.37] số ca đã chứng minh vắng mặt ⇒ gửi cứu 1 lần
  /* ═══ [v1.93.1] FB ĐÃ BÁO "KHÔNG NHẬN ĐƯỢC" THÌ KHÔNG BÙ NỮA ═══
   * ĐO ĐƯỢC trên log 21/11 19:44 (lô 4 281 chat, CÓ sổ kiểm chứng 10 717 dòng):
   *   • 573 ca có dòng `🔁 ACK muộn = FB TỪ CHỐI (…) — tin chưa đi`   ← FB NÓI RÕ chưa nhận
   *   • 577 ca có dòng `🛟 … ⇒ GỬI CỨU 1 lần qua Extension`
   *   • GIAO NHAU: 573/577 — tức gần như TOÀN BỘ ca bị bù là ca FB đã báo không nhận.
   * Chuỗi sự kiện mỗi ca (lấy thẳng từ sổ kiểm chứng):
   *   1. Socket bắn   → ⚠ "không có ACK"
   *   2. +12 s        → 🔁 "ACK muộn = FB TỪ CHỐI — tin CHƯA ĐI"
   *   3. +vài s       → 🛟 "hội thoại KHÔNG có tin (chứng minh vắng mặt)"   ← đúng, vì nó chết
   *   4.              → ⏳ "đang bù qua Extension"  ⇒ bù vào ca ĐÃ BIẾT LÀ CHẾT
   *   5.              → ✅ "đánh dấu ĐÃ TỚI NƠI qua ext"  ⇒ tự mâu thuẫn với bước 2
   * Nguyên nhân: `socksProof === 'absent'` chỉ nói "hội thoại không đổi". Nó KHÔNG phân biệt
   *   (a) kênh gửi còn sống, khách chưa nhận  → bù là ĐÚNG
   *   (b) FB đã trả lời dứt khoát "không nhận được" → bù là VÔ ÍCH (và sinh ✅ sai)
   * Nay tách (b) ra bằng một sổ riêng, ghi tại đúng chỗ FB trả lời từ chối.
   * AN TOÀN: chỉ THÊM một điều kiện DỪNG. Không nới bất kỳ điều kiện gửi nào, không đổi
   * cổng chứng minh vắng mặt, không đổi số lần gửi của bất kỳ ca nào khác. Ca bị chặn bù
   * vẫn được chốt ❌ + vào danh sách gửi tay y như ca ❌ bình thường (không im lặng mất tin). */
  const fbRejectedIds = new Map(); // convId → { at, why } FB đã trả lời dứt khoát "chưa nhận được"
  function noteFbRejected(convId, why) {
    if (!convId) return;
    try { fbRejectedIds.set(String(convId), { at: Date.now(), why: String(why || '') }); } catch (e) { /* ignore */ }
  }
  function isFbRejected(convId) {
    try { return !!(convId && fbRejectedIds.has(String(convId))); } catch (e) { return false; }
  }
  const fbRejectStats = { blockedBu: 0 }; // số lần chặn được 1 lần bù vô ích
  /* [v1.92.37] DANH SÁCH GỬI TAY — mọi chat kết thúc ở ⚠ ("không rõ"): máy KHÔNG dám nói đã gửi.
   * Trước đây những ca này chỉ nằm im trong sổ ⚠, người dùng không biết chat nào cần bấm tay.
   * Nay gom lại, in ở 💾 .txt và đếm ở dòng TỔNG HỢP. Không gửi gì thêm — chỉ để người đọc. */
  const manualResendList = [];
  /* ═══ [v1.92.66] CHỐNG TRÙNG BẰNG Set, KHÔNG QUÉT TUYẾN TÍNH ═══
   * Bản cũ `noteManualResend()` quét cả mảng (tới 5 000 phần tử) cho MỖI ca ⚠; `dropManualResend()`
   * cũng quét ngược toàn mảng. Lô 19:48 có 3 600 ca ⚠ ⇒ ~3 600 × 1 800 so sánh ≈ 6,5 triệu phép
   * so, chạy xen giữa 192 worker đang bận CPU. Nay:
   *   • `manualResendIds` (Set) quyết định "đã có chưa" trong O(1);
   *   • `manualResendById` (Map) cho `dropManualResend()` xoá thẳng trong O(1) khỏi mảng;
   *   • mọi lối xoá đều đi qua `dropManualResend()` để hai cấu trúc không lệch nhau.
   * `manualResendList` GIỮ NGUYÊN hình dạng + THỨ TỰ (mới nhất ở cuối) vì 💾 .txt và bảng
   * TỔNG HỢP duyệt trực tiếp mảng này — chỉ cách TRA CỨU đổi, dữ liệu xuất ra không đổi. */
  const manualResendIds = new Set();
  const manualResendById = new Map();   // id → object trong manualResendList
  function noteManualResend(cid) {
    if (!cid) return;
    const k = String(cid);
    if (manualResendIds.has(k)) return;
    const rec = { id: k, name: nameById[cid] || '', t: Date.now(), reason: '' };
    manualResendList.push(rec);
    manualResendIds.add(k);
    manualResendById.set(k, rec);
    if (manualResendList.length > 5000) {
      const old = manualResendList.shift();
      if (old && old.id) {
        // Chỉ xoá chỉ mục nếu bản ghi trong Map đúng là bản ghi vừa rời mảng (có thể đã bị
        // ghi đè bởi lần note lại cùng id sau khi nó rời đi — khi đó Map đang giữ bản mới).
        if (manualResendById.get(old.id) === old) manualResendById.delete(old.id);
        manualResendIds.delete(old.id);
      }
    }
  }
  function dropManualResend(cid) {
    if (!cid) return;
    const k = String(cid);
    const rec = manualResendById.get(k);
    if (rec) {
      const i = manualResendList.indexOf(rec);
      if (i >= 0) manualResendList.splice(i, 1);
      manualResendById.delete(k);
    }
    manualResendIds.delete(k);
  }
  /* [v1.92.38] "ĐANG CỨU" ≠ "CẦN GỬI TAY".
   * Ca ⚠ vào danh sách gửi tay NGAY lúc hết hạn ACK (~5 s), nhưng cổng chứng minh vắng mặt phải
   * chờ tới mốc 10 s mới dám kết luận ⇒ có ~6 s chat vừa nằm trong danh sách vừa đang được cứu.
   * Nếu người dùng bấm 💾 .txt đúng lúc đó rồi gửi tay thì tin đi 2 lần. Vì vậy tách riêng:
   * chat đang cứu in ở mục ⏳ "ĐANG CỨU — ĐỪNG gửi tay", quá 60 s không có kết luận mới trả về
   * danh sách gửi tay (an toàn: thà chậm 1 phút còn hơn gửi đôi). */
  const rescueInFlight = {}; // convId → thời điểm bắt đầu cứu
  const RESCUE_INFLIGHT_STALE_MS = 60000;
  function isRescuing(cid, now) {
    const k = String(cid);
    const at = rescueInFlight[k];
    if (!at) return false;
    if ((now || Date.now()) - at > RESCUE_INFLIGHT_STALE_MS) { delete rescueInFlight[k]; return false; }
    return true;
  }
  /* [v1.92.56] TRƯỚC: `countRescuing()` + `countManualResendWait()` mỗi hàm duyệt TOÀN BỘ
   * `manualResendList` (tới 5 000 phần tử), và chỗ dựng TỔNG HỢP gọi mỗi hàm HAI lần
   * (`(x ? '…'+x : '')` gọi lại lần 2) ⇒ 4 lượt duyệt cho một lần dựng bảng.
   * Đo: 163 ms / 200 lần gọi khi list = 5 000.
   * Nay: MỘT lượt duyệt trả cả hai số; chỗ gọi dùng lại kết quả, không gọi lại. */
  function countResendSplit() {
    const now = Date.now();
    let rescuing = 0;
    for (let i = 0; i < manualResendList.length; i++) {
      if (isRescuing(manualResendList[i].id, now)) rescuing++;
    }
    return { rescuing: rescuing, waiting: manualResendList.length - rescuing };
  }
  function countRescuing() { return countResendSplit().rescuing; }
  function countManualResendWait() { return countResendSplit().waiting; }
  const extVerifyPending = {}; // convId → runSeq đang chờ kiểm chứng sau khi Ext timeout
  // [v1.91.79] Ca ĐỌC LẠI nhịp giãn: KHÔNG được tính vào "đang chờ" của bảng TỔNG HỢP.
  // Log 19:01→19:04 (10672 tin): phát lệnh xong 19:01:29 nhưng mãi 19:04:25 mới chốt vì
  // 16 ca đọc-lại giữ lượt suốt 176s, trong khi kết quả cuối vẫn là "thấy tin 0". Đọc lại
  // là việc phụ trợ — để nó chạy nền, không bắt người dùng chờ.
  const tailSeen = {}; // [v1.92.50] convId → đã đếm vào "đuôi chờ xác nhận" của lượt này
  const extRecheckPending = {}; // convId → runSeq đang đọc lại (không giữ lượt)
  const uncertainVerifyPending = {}; // convId → runSeq đang chờ kiểm chứng ca "không rõ kết quả" (API timeout/5xx)

  /* ==========================================================================
   * [v1.92.56] BỘ ĐẾM O(1) CHO 3 SỔ ĐANG CHỜ KIỂM CHỨNG — SỬA O(N²)
   *
   * ĐO ĐƯỢC TRƯỚC KHI SỬA (`/tmp/bench.mjs`, trích nguyên văn getBatchSummaryCounts
   * từ chính file này rồi chạy với dữ liệu thật):
   *     n = 12 410 chat  ⇒  9 946 ms CPU  (801 µs mỗi lần gọi)
   * Nguyên nhân: mỗi lần MỘT chat chốt xong, `getBatchSummaryCounts()` chạy
   *     Object.keys(sockVerifyPending).filter(...)      ← tạo mảng mới + quét
   *     Object.keys(extVerifyPending).filter(...)       ← làm 3 lần như vậy
   *     Object.keys(uncertainVerifyPending).filter(...)
   * Ba sổ này giữ MỌI chat đang chờ kiểm chứng ⇒ chi phí O(k) mỗi lần, và lần nào
   * cũng cấp phát mảng mới ⇒ tổng O(n²).
   *
   * ĐÂY CŨNG LÀ LÝ DO "ẨN DANH SÁCH VẪN LAG": phép tính này KHÔNG đọc DOM, không vẽ
   * gì. Ẩn danh sách hay để giao diện trống cũng không bớt được một phép duyệt nào.
   *
   * Nay: 3 biến đếm, tăng lúc GHI khoá, giảm lúc XOÁ khoá. Đọc là O(1).
   * Các hàm ghi/xoá: markSockVerify / clearSockVerify / markExtVerify / clearExtVerify /
   * markUncertainVerify / clearUncertainVerify — TẤT CẢ chỗ đụng 3 sổ đều phải đi qua đây.
   * Test `tools/test-verify.mjs` có ca khoá lại (không cho quay về Object.keys).
   * ========================================================================== */
  const verifyPendingCount = { sock: 0, ext: 0, uncertain: 0 };

  function markSockVerify(id) {
    if (sockVerifyPending[id]) return false;
    sockVerifyPending[id] = runSeq;
    verifyPendingCount.sock++;
    return true;
  }
  function clearSockVerify(id) {
    if (!sockVerifyPending[id]) return;
    delete sockVerifyPending[id];
    if (verifyPendingCount.sock > 0) verifyPendingCount.sock--;
  }
  function markExtVerify(id, recheck) {
    const store = recheck ? extRecheckPending : extVerifyPending;
    if (store[id]) return false;
    store[id] = runSeq;
    /* Lần ĐỌC LẠI (recheck) cố ý KHÔNG cộng vào "đang chờ" của bảng TỔNG HỢP —
     * giữ đúng hành vi cũ (xem chú thích [v1.91.79] ngay dưới). */
    if (!recheck) verifyPendingCount.ext++;
    return true;
  }
  function clearExtVerify(id, recheck) {
    const store = recheck ? extRecheckPending : extVerifyPending;
    if (!store[id]) return;
    delete store[id];
    if (!recheck && verifyPendingCount.ext > 0) verifyPendingCount.ext--;
  }
  function markUncertainVerify(id) {
    if (uncertainVerifyPending[id]) return false;
    uncertainVerifyPending[id] = runSeq;
    verifyPendingCount.uncertain++;
    return true;
  }
  function clearUncertainVerify(id) {
    if (!uncertainVerifyPending[id]) return;
    delete uncertainVerifyPending[id];
    if (verifyPendingCount.uncertain > 0) verifyPendingCount.uncertain--;
  }
  /** Đặt lại cả 3 sổ + bộ đếm (đầu mỗi lượt / khi Dừng). */
  function resetVerifyPending() {
    Object.keys(sockVerifyPending).forEach((k) => delete sockVerifyPending[k]);
    Object.keys(extVerifyPending).forEach((k) => delete extVerifyPending[k]);
    Object.keys(extRecheckPending).forEach((k) => delete extRecheckPending[k]);
    Object.keys(uncertainVerifyPending).forEach((k) => delete uncertainVerifyPending[k]);
    verifyPendingCount.sock = 0;
    verifyPendingCount.ext = 0;
    verifyPendingCount.uncertain = 0;
  }
  /* [v1.93.2] `claimedUnverified` = số ca Extension báo success nhưng CHƯA có bằng chứng tin đã
   * tới (trước đây những ca này được đánh ✅ ngay). `notFound` = đã đọc lại lịch sử hết lượt mà
   * KHÔNG thấy tin ⇒ chốt ❌. `unknown` = không đọc được lịch sử ⇒ giữ ⚠ + gửi tay (không chốt oan). */
  const extTimeoutStats = { timeout: 0, skipped: 0, found: 0, notFound: 0, unknown: 0, claimedUnverified: 0, claimedDenied: 0, fbRetry2: 0 }; // theo lượt — in ở dòng TỔNG HỢP
  // [v1.93.10] fbRetry2 = extension trả canRetryUsingSocket + mã 1545012 = ĐÃ upload lại mà VẪN lỗi
  let bgWatchdogTimer = null;
  // ⚡ [FIX-5] Với bắn-nhả 192 slot, đuôi hàng đợi retry Socket/Ext có thể chờ >90s khi lô lớn.
  // 180s đủ dung sai — không chốt ⚠ oan khi lane còn việc thật.
  const BG_SETTLE_DEADLINE_MS = 180000;
  function noteBgPending(conv, via) {
    if (!conv || !conv.id) return;
    /* [v1.92.45] ĐO ĐUÔI CHỜ XÁC NHẬN. Người dùng phàn nàn đúng chỗ này: "gửi list 100 con
     * mà chờ xác nhận 1–2 con tới chưa lâu quá". Trước bản này không có con số nào cho biết
     * cái đuôi đó dài bao nhiêu và do ca nào giữ ⇒ mọi tối ưu đều là đoán. Ghi mốc phát lệnh
     * ở đây, chốt độ dài ở markDelivered/clearBgPending. */
    pendingBg[conv.id] = { at: Date.now(), name: conv.name || conv.id, via: via || '' };
    /* [v1.92.50] ĐẾM THEO CHAT, KHÔNG ĐẾM LẦN GỌI. Log 11:34 in "⏳ Đuôi chờ xác nhận: 9 263 ca
     * vào sổ chờ" trong khi lô chỉ có 9 242 lệnh — nhiều hơn số chat là bất khả. Gốc: một chat đi
     * qua 2 chuỗi bù (⏳ rồi 🛟 rồi ❌) gọi noteBgPending 2–3 lần ⇒ cộng dồn. Nay chỉ đếm chat MỚI
     * (chưa có trong pendingBg và chưa từng vào sổ ở lượt này). */
    if (!tailSeen[conv.id]) {
      tailSeen[conv.id] = 1;
      sendDiag.tailChats = (sendDiag.tailChats || 0) + 1;
    }
    if (!bgWatchdogTimer) bgWatchdogTimer = bgClock.every(5000, sweepBgPending);
  }
  function clearBgPending(convId) {
    if (!convId) return;
    const e = pendingBg[convId];
    if (e && e.at) {
      const ms = Math.max(0, Date.now() - e.at);
      if (ms > (sendDiag.tailMaxMs || 0)) sendDiag.tailMaxMs = ms;
    }
    delete pendingBg[convId];
  }
  let bgLaneBusyAt = 0;
  function sendLanesBusy() {
    try {
      const lanes = [apiSendLane, extPrepLane, extSendLane, photoUploadLane, gidExtLane];
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i].waitingCount() > 0 || lanes[i].activeCount() > 0) return true;
      }
      const ks = Object.keys(pageSocketLanes);
      for (let i = 0; i < ks.length; i++) if (pageSocketLanes[ks[i]].waitingCount() > 0) return true;
    } catch (e) { /* ignore */ }
    return false;
  }
  function sweepBgPending() {
    const now = Date.now();
    // Lô lớn: tin ở đuôi hàng đợi lane có thể chờ >90s mới tới lượt bắn — lane còn việc
    // thì KHÔNG được coi là treo (chốt oan + TỔNG HỢP chốt sai + nhả nút Chạy sớm)
    if (sendLanesBusy()) bgLaneBusyAt = now;
    let forced = 0;
    Object.keys(pendingBg).forEach((id) => {
      const e = pendingBg[id];
      if (!e) return;
      if (deliveredIds[id] || finalFailedIds[id] || uncertainIds[id] || skippedLateIds[id]) { delete pendingBg[id]; return; }
      if (now - Math.max(e.at || 0, bgLaneBusyAt) >= BG_SETTLE_DEADLINE_MS) {
        delete pendingBg[id];
        try { sockFiredPending.delete(id); } catch (e0) { /* ignore */ }
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(id, 'uncertain', 'quá ' + Math.round(BG_SETTLE_DEADLINE_MS / 1000) + 's chưa có xác nhận nền');
        forced++;
      }
    });
    if (forced) {
      logLine('⏱ ' + forced + ' tin quá 90s chưa có xác nhận nền — chốt ⚠ không rõ (không gửi lại để tránh trùng) để TỔNG HỢP kết thúc.');
      updateBatchSummaryUI();
    }
    if (!Object.keys(pendingBg).length && bgWatchdogTimer) {
      try { bgWatchdogTimer(); } catch (e0) { /* ignore */ }
      bgWatchdogTimer = null;
    }
  }
  // v1.82.6 — khóa tin đang bay: đã POST/publish thì kênh khác không bắn thêm, trừ khi kênh trước
  // XÁC NHẬN thất bại (releaseOutbound). 'maybe' giữ khóa → không gửi lần 2.
  function dupBlockedResult(convId) {
    // [v1.92.28] `dupBlocked` để nơi gọi ĐẾM được là "đã chặn trùng", không nhầm thành 1 lệnh gửi thật.
    return { ok: true, id: '', sendBy: deliveredIds[convId] || 'dup-block', sent: true, fired: true, dupBlocked: true };
  }
  function acquireOutbound(convId) {
    if (!convId) return true;
    if (deliveredIds[convId] || sockFiredPending.has(convId) || outboundLock[convId]) return false;
    outboundLock[convId] = 1;
    return true;
  }
  function releaseOutbound(convId) {
    if (convId) delete outboundLock[convId];
  }
  // Bộ đếm O(1) chống O(N²) khi chạy 20.000–30.000 tin (không gọi Object.keys() 60.000 lần)
  const summaryCounters = { okApi: 0, okExt: 0, okSocket: 0, fail: 0, unsure: 0, skipLate: 0 };
  let summaryUiTimer = null;
  let windowBlocked = 0; // số lần API từ chối "(#10)/(#551)… ngoài cửa sổ 24h" trong lượt (đều được bù kênh khác)
  const SUMMARY_LS_KEY = 'ssb_last_summary_v1';
  const batchStats = {
    active: false,
    total: 0,
    skippedPre: 0,
    startedAt: 0,
    loopFinished: false,
    loopFinishedAt: 0,   // [v1.92.63] Date.now() lúc phát xong — mốc của ân hạn chốt bảng
    finalLogged: false,
  };

  function getBatchSummaryCounts() {
    const okApi = summaryCounters.okApi;
    const okExt = summaryCounters.okExt;
    const okSocket = summaryCounters.okSocket;
    const okTotal = okApi + okExt + okSocket;
    const failTotal = summaryCounters.fail;
    const unsureTotal = summaryCounters.unsure;
    const skipLateTotal = summaryCounters.skipLate;
    const settled = okTotal + failTotal + unsureTotal + skipLateTotal;
    /* [v1.92.56] O(1) thay vì O(k) — xem khối chú thích dài ở `verifyPendingCount`.
     * Ba dòng cũ tạo 3 mảng mới + quét toàn bộ 3 sổ MỖI LẦN một chat chốt xong:
     * đo được 9 946 ms cho lô 12 410 chat. Nay đọc biến đếm.
     * `resetVerifyPending()` / `markXxx` / `clearXxx` giữ 3 biến này khớp với 3 sổ. */
    const verifyPendingNow = verifyPendingCount.sock;
    const extVerifyPendingNow = verifyPendingCount.ext;
    const uncertainVerifyPendingNow = verifyPendingCount.uncertain;
    /* [v1.92.36] CHỐT LƯỢT KHÔNG ĐỢI KIỂM CHỨNG NỀN.
     * Lô 3 chat (15:48): phát lệnh 0,6 s nhưng bảng TỔNG HỢP chỉ in sau 13 s; lô 90 chat (15:44):
     * 0,6 s phát, 31,4 s chờ. Mọi chat đã có kết luận từ lâu, phần chờ là 3 lượt ĐỌC LẠI lịch sử
     * (chỉ có thể nâng ⚠ → ✅, không bao giờ gửi thêm). Nay `pendingSend` = số chat CHƯA có kết luận
     * (dùng để chốt lượt), `pending` giữ nguyên nghĩa cũ (dùng để hiện "đang kiểm chứng nền").
     * Kiểm chứng xong mà có lật ⚠ → ✅ thì in thêm 1 dòng cập nhật, không mở lại cả bảng. */
    const pendingSend = Math.max(0, (batchStats.total || 0) - settled);
    const pending = pendingSend + verifyPendingNow + extVerifyPendingNow + uncertainVerifyPendingNow;
    return {
      total: batchStats.total || 0,
      okTotal, okApi, okExt, okSocket,
      failTotal, unsureTotal,
      skipTotal: (batchStats.skippedPre || 0) + skipLateTotal,
      settled, pending, pendingSend,
    };
  }

  function flushBatchSummaryUI() {
    summaryUiTimer = null;
    try {
      if (!batchStats.active && !batchStats.total) return;
      const c = getBatchSummaryCounts();
      const pct = c.total ? ((c.okTotal / c.total) * 100).toFixed(1) : '0.0';
      const elapsedMs = batchStats.startedAt ? Math.max(1, Date.now() - batchStats.startedAt) : 0;
      const elapsedSec = elapsedMs ? Math.max(1, Math.round(elapsedMs / 1000)) : 0;
      const elapsedExactSec = elapsedMs / 1000;
      // [v1.92.10] TÁCH 2 CHẶNG: "phát lệnh" (đẩy lệnh đi) vs "chờ xác nhận" (ACK/kiểm chứng nền).
      // Trước đây chỉ có tổng, nên lô phát xong trong 0,1s mà đuôi kiểm chứng 10s vẫn hiện
      // "0,39 tin/giây" — đọc thành script chậm, trong khi phát lệnh gần như tức thì.
      const dispatchEndAt = batchStats.dispatchEndedAt || (batchStats.loopFinished ? Date.now() : 0);
      const dispatchMs = (dispatchEndAt && batchStats.startedAt) ? Math.max(1, dispatchEndAt - batchStats.startedAt) : 0;
      const confirmMs = dispatchMs ? Math.max(0, elapsedMs - dispatchMs) : 0;
      const dispatchPerSec = dispatchMs > 0 ? (c.total / (dispatchMs / 1000)) : 0;
      const settledPerSec = elapsedExactSec > 0 ? c.settled / elapsedExactSec : 0;
      const successPerSec = elapsedExactSec > 0 ? c.okTotal / elapsedExactSec : 0;
      // [v1.92.26] Mục tiêu khả thi = tổng - (khách FB xác nhận không nhận được) - (ca bị từ
      // chối lần 1 mà ngân sách đã đóng, tức nhóm đã đo được 0/N cứu lại). Nhờ vậy con số
      // "thành công/…" phản ánh việc script làm được, không bị 860 khách chết của FB kéo xuống.
      /* [v1.92.66] KHÔNG trừ nhóm "ngân sách đã đóng" khỏi mẫu số nữa — xem khối chú thích ở
       * dòng in TỐC ĐỘ. Nhóm đó CHƯA được đo trong chính lô này (bản 1.92.65 "đóng ngân sách"
       * bằng một nhánh không thể chạm tới), nên đem nó ra khỏi mẫu số là bóp mẫu số bằng giả
       * định chứ không bằng số đo. Giữ lại biến để các chỗ khác dùng, chỉ đổi công thức. */
      const eligibleAfterUnavailable = Math.max(0, c.total - sendDiag.recipientUnavailable);
      const eligibleSuccessPct = eligibleAfterUnavailable ? (c.okTotal / eligibleAfterUnavailable) * 100 : 0;
      const socketAckCount = sendDiag.socketAckOk + sendDiag.socketAckRejected + sendDiag.socketNoAck;
      const socketAckAvgMs = socketAckCount ? Math.round(sendDiag.socketAckMsTotal / socketAckCount) : 0;
      const socketLaneFinal = getPageSocketLaneStats();
      /* [v1.92.56] Tính MỘT lần rồi dùng cho cả hai nhãn (trước đây gọi 2 hàm × 2 lần). */
      const resendSplit = countResendSplit();
      const apiStartedSafe = Math.max(1, sendDiag.apiStarted);
      const apiFetchSafe = Math.max(1, sendDiag.apiFetchAttempts);
      const apiStatuses = Object.keys(sendDiag.apiStatusCounts).sort((a, b) => Number(a) - Number(b))
        .map((status) => status + '×' + sendDiag.apiStatusCounts[status]).join(', ') || 'không có';
      const byCh = [];
      if (c.okApi) byCh.push('API: ' + c.okApi);
      if (c.okExt) byCh.push('Ext: ' + c.okExt);
      if (c.okSocket) byCh.push('Socket: ' + c.okSocket);
      const chStr = byCh.length ? ' [' + byCh.join(' · ') + ']' : '';
      /* [v1.92.63] `isDoneAll` quyết định có in dòng "TỔNG HỢP CHỐT LƯỢT GỬI" hay không.
       * Trong ân hạn (còn kiểm chứng nền) thì CHƯA chốt — chỉ vẽ bảng tiến độ. */
      const verifyLeftChk = Math.max(0, c.pending - c.pendingSend);
      const inGrace = !!(!state.stopRequested && batchStats.loopFinished && c.pendingSend === 0
        && verifyLeftChk > 0 && batchStats.loopFinishedAt
        && (Date.now() - batchStats.loopFinishedAt) < SUMMARY_GRACE_MS);
      const isDoneAll = !inGrace && batchStats.loopFinished && (c.pendingSend === 0 || state.stopRequested);
      const html = (isDoneAll ? '🏁 <b>TỔNG HỢP:</b> ' : '📊 <b>Đang gửi:</b> ')
        + '<span style="color:#4ade80;font-weight:700">✅ Thành công: ' + c.okTotal + '/' + c.total + ' (' + pct + '%)' + chStr + '</span>'
        + (c.pendingSend > 0 && !state.stopRequested ? ' · <span style="color:#38bdf8">⏳ Đang xử lý: ' + c.pendingSend + '</span>' : '')
        + (c.pending > c.pendingSend ? ' · <span style="color:#a78bfa">🔎 kiểm chứng nền: ' + (c.pending - c.pendingSend) + '</span>' : '')
        + (c.failTotal > 0 ? ' · <span style="color:#f87171">❌ Lỗi: ' + c.failTotal + '</span>' : (isDoneAll ? ' · ❌ Lỗi: 0' : ''))
        + (c.unsureTotal > 0 ? ' · <span style="color:#fbbf24">⚠ Không rõ: ' + c.unsureTotal + '</span>' : '')
        + (c.skipTotal > 0 ? ' · <span style="color:#94a3b8">🧹 Bỏ qua: ' + c.skipTotal + '</span>' : '')
        + (elapsedSec > 0 ? ' · <span style="color:#94a3b8">⏱ ' + elapsedSec + 's</span>' : '');
      const sumEl = shadow && shadow.getElementById('ssb-summary');
      if (sumEl) {
        sumEl.style.display = '';
        sumEl.innerHTML = html;
      }
      /* [v1.92.60] dải tiến trình thu nhỏ đọc CÙNG nguồn số với bảng tổng hợp. */
      try { updateMiniProgressUI(); } catch (eMini) { /* ignore */ }
      /* [v1.92.63] BẢNG CHỐT KHÔNG ĐƯỢC CHỐT BẰNG SỐ CÒN ĐANG ĐỔI.
       * Log 20:41:43 (5 chat, bản 1.92.62): TỔNG HỢP in lúc 20:41:22
       *     `⚠ Không rõ: 5 | 🖐 CẦN GỬI TAY: 5 chat`
       * rồi 8 s sau, đúng 5 chat đó lật ⚠ → ✅ (`🔎 Cập nhật … ✅ 0 → 5 · ⚠ 5 → 0`).
       * Người dùng đọc bảng chốt ⇒ tưởng 5 chat chưa gửi ⇒ GỬI TAY ⇒ khách nhận 2 tin.
       * Nguyên nhân: `isDoneAll` chỉ đòi `pendingSend === 0` (mọi chat ĐÃ có kết luận ⚠),
       * không đòi `pending === pendingSend` (không còn ca kiểm chứng nền). Mà ca ⚠ nào cũng
       * đã có kiểm chứng nền đang chạy ⇒ bảng chốt trước khi kiểm chứng xong là CHẮC CHẮN.
       * Nay: trong dòng TỔNG HỢP, nếu còn ca kiểm chứng nền thì ghi rõ "chưa chốt" và CẤM
       * câu khẳng định "CẦN GỬI TAY" (đổi thành "tạm ⚠ — đang kiểm chứng, CHƯA gửi tay"),
       * kèm mốc hẹn. Không chặn việc in bảng (vẫn phải thấy tiến độ) — chỉ không nói sai.
       * Điều kiện ĐỦ để khẳng định "cần gửi tay": ca đó đã hết kiểm chứng và vẫn không có ✅. */
      const verifyLeftNow = Math.max(0, c.pending - c.pendingSend);
      if (c.total > 0) setProgress(c.settled, c.total, c.okTotal, c.pending);
      if (isDoneAll || c.total <= 200) {
        try { localStorage.setItem(SUMMARY_LS_KEY, html); } catch (e) { /* ignore */ }
      }
      if (isDoneAll) markSendIdleIfSettled();
      // [v1.92.36] Đã in TỔNG HỢP mà kiểm chứng nền sau đó lật ⚠ → ✅ (hoặc ngược lại) ⇒ in ĐÚNG
      // MỘT dòng cập nhật, không mở lại cả bảng. Đây là hệ quả của việc chốt lượt không đợi
      // kiểm chứng — số trong bảng vẫn luôn là số ĐÃ TỚI NƠI thật, chỉ là in sớm hơn.
      if (isDoneAll && batchStats.finalLogged && batchStats.lastLoggedCounts) {
        const pv = batchStats.lastLoggedCounts;
        const changed = pv.ok !== c.okTotal || pv.unsure !== c.unsureTotal || pv.fail !== c.failTotal;
        const verifyLeft = Math.max(0, c.pending - c.pendingSend);
        const nowT = Date.now();
        // Lô lớn có thể có cả trăm ca kiểm chứng nền ⇒ KHÔNG in mỗi lần lật (sẽ thành 100 dòng,
        // quay lại đúng lỗi log cũ). Chỉ in: khi đã sạch kiểm chứng, hoặc 15 s/lần.
        const dueByTime = nowT - (batchStats.lastDeltaLogAt || 0) >= 15000;
        if (changed && (verifyLeft === 0 || dueByTime)) {
          logLine('🔎 Cập nhật sau khi chốt lượt (kiểm chứng nền — KHÔNG gửi lại tin nào): ✅ '
            + pv.ok + ' → ' + c.okTotal
            + (pv.unsure !== c.unsureTotal ? ' · ⚠ ' + pv.unsure + ' → ' + c.unsureTotal : '')
            + (pv.fail !== c.failTotal ? ' · ❌ ' + pv.fail + ' → ' + c.failTotal : '')
            + (verifyLeft ? ' · còn ' + verifyLeft + ' ca đang kiểm chứng' : ''));
          batchStats.lastLoggedCounts = { ok: c.okTotal, unsure: c.unsureTotal, fail: c.failTotal };
          batchStats.lastDeltaLogAt = nowT;
        }
      }
      if (isDoneAll && !batchStats.finalLogged && c.total > 0) {
        batchStats.finalLogged = true;
        batchStats.lastLoggedCounts = { ok: c.okTotal, unsure: c.unsureTotal, fail: c.failTotal };
        try { localStorage.setItem(SUMMARY_LS_KEY, html); } catch (e) { /* ignore */ }
        logLine('🫥 CHẠY NỀN: ' + bgClock.describe());
        logLine('📊 TỔNG HỢP CHỐT LƯỢT GỬI: ✅ Đã gửi thành công ' + c.okTotal + '/' + c.total
          + ' tin (' + pct + '%)' + chStr
          + ' | ❌ Lỗi: ' + c.failTotal
          + (c.unsureTotal ? ' | ⚠ Không rõ: ' + c.unsureTotal : '')
          + (extTry1545.tried
            ? ' | 🛟 Dò Ext cho ca FB từ chối: ĐÃ ĐỊNH bắn ' + extTry1545.tried + ' · cứu ' + extTry1545.saved
              + (extTry1545.unknown ? ' · chưa có kết quả ' + extTry1545.unknown : '')
              /* [v1.92.66] Nói rõ ĐÓNG VÌ LÝ DO GÌ (streak hay đủ mẫu) — bản cũ chỉ in "ĐÓNG"
               * nên không phân biệt được "đã đo 200 ca" với "30 ca liên tiếp bị từ chối". */
              + (extTry1545.closed
                ? ' · ĐÓNG (' + (extTry1545.closedWhy === 'streak'
                    ? extTry1545.streak + ' ca liên tiếp bị từ chối'
                    : 'đủ ' + extTry1545.PROBE + ' ca đã định bắn') + ', cứu 0 ⇒ phần còn lại vào danh sách gửi tay)'
                : '')
            : ' | 🛟 Dò Ext cho ca FB từ chối: KHÔNG có ca nào (không có lỗi 1545041)')
          /* [v1.92.45] ĐO TRẦN THẬT CỦA LÀN EXT — để lần sau không tối ưu sai chỗ.
           * HAR làn Ext (90 lệnh / 6,74 s) cho thấy trần ~13,4 lệnh/s và đỉnh in-flight chỉ 42
           * trong khi làn đặt 48–96 ⇒ nâng sàn/trần làn KHÔNG làm lô nhanh hơn. In số đo thật
           * (p90 phản hồi + đỉnh in-flight) ngay trong TỔNG HỢP để so với HAR mỗi lô. */
          + ((extSendCtl.latSamples.length || extSendCtl.peakActive)
            ? ' | 🛰 Ext: p90 phản hồi ' + (extLatP90() ? (extLatP90() / 1000).toFixed(1).replace('.', ',') + ' s' : '—')
              + ' · đỉnh in-flight ' + (extSendCtl.peakActive || 0) + '/' + extSendLane.getLimit()
              + ((extSendCtl.peakActive || 0) < extSendLane.getLimit()
                ? ' (làn CHƯA đầy ⇒ nút cổ chai là Extension, không phải làn)' : ' (làn ĐÃ đầy ⇒ nâng làn mới có ích)')
            : '')
          + (resendSplit.rescuing ? ' | ⏳ ĐANG CỨU tự động: ' + resendSplit.rescuing + ' chat (Extension, ~10–13 s)' : '')
          /* [v1.92.63] KHÔNG ĐƯỢC KHẲNG ĐỊNH "CẦN GỬI TAY" KHI CÒN CA ĐANG KIỂM CHỨNG.
           * Log 20:41:43: in `🖐 CẦN GỬI TAY: 5 chat` lúc 22 s, rồi 30 s CẢ 5 ca lật ✅.
           * Câu đó là lệnh mời người dùng gửi tay ⇒ gửi là khách nhận 2 tin.
           * Nay tách 2 câu, chỉ dùng từ "CẦN GỬI TAY" khi đã hết kiểm chứng: */
          + (resendSplit.waiting
            ? (verifyLeftNow > 0
              ? ' | ⏳ TẠM ⚠ chưa kết luận: ' + resendSplit.waiting + ' chat — ĐANG kiểm chứng, CHƯA gửi tay'
                + ' (chờ dòng 🔎/🛟 rồi hẵn quyết)'
              : ' | 🖐 CẦN GỬI TAY: ' + resendSplit.waiting + ' chat (đã hết kiểm chứng — xem 💾 .txt)')
            : '')
          + (c.skipTotal ? ' | 🧹 Bỏ qua: ' + c.skipTotal : '')
          + ((buStats.ok || buStats.cancelled)
            ? ' | 🔁 Bù OK: ' + buStats.ok + ' (' + Object.keys(buStats.byWhy).map((k) => k + ': ' + buStats.byWhy[k]).join(' · ') + ') · hủy bù tránh trùng: ' + buStats.cancelled
            : '')
          + ((verifyStats.found || verifyStats.held || verifyStats.unknown || sockRescueStats.tried)
            ? ' | 🔎 Kiểm chứng ACK: đã đến nơi ' + verifyStats.found + ' · giữ ⚠ (không bắn lại) ' + verifyStats.held
              + ' · không kiểm chứng được ' + verifyStats.unknown
              + (sockRescueStats.tried ? ' · 🛟 chứng minh vắng mặt ⇒ gửi cứu 1 lần ' + sockRescueStats.tried : '')
              /* [v1.93.1] Cổng mới phải TỰ KHAI. Số này càng lớn thì càng nhiều lần bù vô ích
               * đã chặn được (log 21/11: 577 ca bù, 573 trong đó là ca FB đã báo không nhận). */
              + (fbRejectStats.blockedBu ? ' · 🚫 FB báo không nhận ⇒ KHÔNG bù ' + fbRejectStats.blockedBu + ' ca (chốt ❌, vào gửi tay)' : '')
            : '')
          + ((sendDiag.buProofGated || sendDiag.buProofPresent || sendDiag.buProofCancelled)
            ? ' | 🛡 Cổng chống lặp: chặn bù mù ' + sendDiag.buProofGated + ' ca · tin ĐÃ tới (hủy bù) ' + sendDiag.buProofCancelled
              + ' · chứng minh vắng mặt ' + sendDiag.buProofAbsent + ' · không chứng minh được ' + sendDiag.buProofUnknown
              + ' · dùng lại kết quả ' + sendDiag.buProofCached
            : '')
          + (sendDiag.dupBlocked
            ? ' | 🛡 Chặn trùng: ' + sendDiag.dupBlocked + ' ca đã có lệnh bay nên KHÔNG bắn thêm (không tính là đã gửi)'
            : '')
          /* [v1.92.45] ĐUÔI CHỜ XÁC NHẬN — in số thật thay vì để người dùng đoán.
           * `unavailFast` = ca FB từ chối dứt khoát nên chốt ngay (bản cũ bắt chờ cổng 10 s).
           * `tailMaxMs` = ca chờ lâu nhất sau khi đã phát xong lệnh. */
          + ((sendDiag.tailChats || sendDiag.unavailFast || sendDiag.transientRetries)
            ? ' | ⏳ Đuôi chờ xác nhận: ' + (sendDiag.tailChats || 0) + ' ca vào sổ chờ · lâu nhất '
              + ((sendDiag.tailMaxMs || 0) / 1000).toFixed(1).replace('.', ',') + ' s'
              + ' · chốt NGAY vì FB từ chối dứt khoát ' + (sendDiag.unavailFast || 0) + ' ca (không chờ 10 s)'
              + (sendDiag.transientRetries
                ? ' · thử lại tạm thời ' + sendDiag.transientRetries + ' ca (cứu ' + (sendDiag.transientRetryOk || 0) + ')'
                : '')
            : '')
          + ((extTimeoutStats.timeout || extTimeoutStats.skipped || extTimeoutStats.found || extTimeoutStats.notFound || extTimeoutStats.unknown || extTimeoutStats.fbRetry2)
            ? ' | 🧯 Ext quá hạn ' + extTimeoutStats.timeout + ' · kiểm chứng thấy tin ' + extTimeoutStats.found + ' · chưa thấy trong lịch sử ' + extTimeoutStats.notFound + ' · không kiểm chứng được ' + extTimeoutStats.unknown + ' · bỏ qua lúc Ext quá tải ' + extTimeoutStats.skipped
              + (extTimeoutStats.fbRetry2
                ? ' | 🔁 Ext đã upload lại mà VẪN lỗi 1545012 (canRetryUsingSocket) ' + extTimeoutStats.fbRetry2 + ' ca — KHÔNG phải khách chết, không chốt ❌'
                : '')
              + (extTimeoutStats.claimedUnverified
                ? ' | 🔍 Ext báo success nhưng CHƯA xác nhận ' + extTimeoutStats.claimedUnverified + ' ca · đọc lại lịch sử: thấy tin ' + extTimeoutStats.found + ' · KHÔNG thấy ⇒ chốt ❌ ' + extTimeoutStats.claimedDenied + ' ca (không gửi tay)'
                : '')
              + ' · phản hồi MUỘN (đã tính ✅) ' + extLateStats.ok + ' · muộn-mà-lỗi ' + extLateStats.fail
              + ' · im lặng hẳn ' + extLateStats.silent
            : '')
          /* [v1.92.47] CẦU DAO ĐƯỜNG DÒ GLOBAL ID — in khi đã đóng, để phân biệt
           * "lô chậm vì FB từ chối" với "lô chậm vì khâu dò Ext hỏng" (network-log2.har:
           * 63/63 lượt phân trang lặp lại cùng con trỏ vì extension không parse được phản hồi). */
          + (gidBreaker.closed
            ? ' | 🔒 Đã đóng đường dò global_id qua Extension (' + gidBreaker.noGid + ' lần trả lời không có gid'
              + (gidBreaker.sameThread >= gidBreaker.SAME_THREAD_MAX
                ? ', riêng thread ' + gidBreaker.lastThread + ' lặp ' + gidBreaker.sameThread + ' lần' : '')
              + ') — phần còn lại chỉ dò HTTP/WebSocket'
            : '')
          + (dispatchMs
            ? ' | ⏱ Phát lệnh ' + (Math.round(dispatchMs / 100) / 10) + 's'
              + ' · chờ xác nhận ' + (Math.round(confirmMs / 100) / 10) + 's'
              + ' · tổng ' + elapsedSec + 's'
            : ' | ⏱ Tổng thời gian: ' + elapsedSec + 's'));
        logLine('⚡ TỐC ĐỘ: ' + (dispatchMs
          ? 'PHÁT ' + c.total + ' lệnh trong ' + (Math.round(dispatchMs / 100) / 10) + 's = '
            + dispatchPerSec.toFixed(2) + '/giây (' + (dispatchPerSec * 60).toFixed(0) + '/phút) · đuôi xác nhận ' + (Math.round(confirmMs / 100) / 10) + 's · '
          : '')
          + 'đã chốt ' + c.settled + '/' + c.total + ' (' + settledPerSec.toFixed(2) + '/giây; '
          + (settledPerSec * 60).toFixed(0) + '/phút) · thành công ' + c.okTotal + ' (' + successPerSec.toFixed(2)
          + '/giây; ' + (successPerSec * 60).toFixed(0) + '/phút)'
          /* ═══ [v1.92.66] MẪU SỐ CỦA "% THÀNH CÔNG" TỪNG BỊ BÓP SAI ═══
           * Lô 19:48 in: "(unavailable 87 + bỏ thử lần 2 3600 …) → mục tiêu còn 11 649,
           * thành công 11 648/11 649 (100.0%)". Kiểm số: 15 336 − 87 − 3 600 = 11 649 ✔ khớp,
           * NHƯNG 3 600 ca đó KHÔNG phải "khách không nhận": chúng là ca Socket bị từ chối
           * lần 1, Extension CHƯA hề được thử (ngân sách đóng), và ngân sách đóng đó lại đóng
           * vì lý do KHÔNG ĐO ĐƯỢC (xem `extFallback1545Allowed`). Đem chúng trừ khỏi mẫu số
           * rồi in 100.0% là tự khen mình bằng một giả định chưa được kiểm chứng.
           * Nay TÁCH LÀM HAI CON SỐ, không trộn nhóm đã-đo với nhóm-chưa-thử:
           *   ① trên TOÀN BỘ lô            — c.okTotal / c.total
           *   ② trên nhóm ĐÃ ĐO là không nhận — chỉ trừ `recipientUnavailable` (FB trả lời dứt
           *      khoát, có bằng chứng từ chính FB), KHÔNG trừ nhóm ngân sách.
           * Nhóm "bỏ thử lần 2" vẫn được IN RA nhưng ghi rõ là CHƯA THỬ. */
          + ' · FB báo không nhận được (đã đo): ' + sendDiag.recipientUnavailable
          + (sendDiag.sockRetryBudgetSkipped
            ? ' · bỏ thử lại Socket, CHƯA thử Extension: ' + sendDiag.sockRetryBudgetSkipped : '')
          + ' → trên nhóm ĐÃ ĐO là không nhận: ' + c.okTotal + '/'
          + Math.max(0, c.total - sendDiag.recipientUnavailable) + ' ('
          + (Math.max(0, c.total - sendDiag.recipientUnavailable)
            ? ((c.okTotal / Math.max(1, c.total - sendDiag.recipientUnavailable)) * 100).toFixed(1) : '0.0')
          + '%) · trên TOÀN BỘ: ' + c.okTotal + '/' + c.total + ' (' + pct + '%) · đang chờ ' + c.pendingSend
          + (c.pending > c.pendingSend ? ' · kiểm chứng nền ' + (c.pending - c.pendingSend) : '')
          + ' · lỗi ' + c.failTotal + ' · không rõ ' + c.unsureTotal + ' · bỏ qua ' + c.skipTotal
          + (sendDiag.extOverloadSkips
            ? ' · ⏸ Ext tự nghẽn chặn trước khi bắn (tính lỗi oan): ' + sendDiag.extOverloadSkips
            : ''));
        logLine('🌊 WAVE: script ' + APP_VERSION + ' · ' + waveDiag.wavesStarted + '/' + waveDiag.plannedWaves + ' wave · size ' + waveDiag.waveSize
          + ' · gap cấu hình ' + waveDiag.configuredGapMs + 'ms · Gửi nhanh ' + (waveDiag.quickEnabled ? 'BẬT' : 'TẮT')
          + ' · main cap ' + waveDiag.mainCapMinObserved + '–96 (cuối ' + waveDiag.mainCapFinal + ', hạ/tăng ' + waveDiag.mainCapDownshifts + '/' + waveDiag.mainCapUpshifts + ') / active max ' + waveDiag.maxMainInFlight
          + ' · Socket/page cap ' + socketLaneFloor + '–' + SOCKET_LANE_MAX + (socketLaneFloor !== SOCKET_LANE_MIN ? ' (sàn tự đặt)' : '') + ' · wave→cổng TB/max '
          + (waveDiag.wavesStarted ? Math.round(waveDiag.gateWaitMsTotal / waveDiag.wavesStarted) : 0) + '/' + waveDiag.gateWaitMsMax + 'ms'
          + ' · peak Socket queue/active/cool ' + waveDiag.maxSocketRetryQueue + '/' + waveDiag.maxSocketRetryActive + '/' + waveDiag.maxSocketCooldown
          + ' · peak Ext queue/active ' + waveDiag.maxExtQueue + '/' + waveDiag.maxExtActive
          + ' · peak Socket/page active total/per-page ' + waveDiag.maxSocketLaneActiveTotal + '/' + waveDiag.maxSocketLaneActivePerPage
          + ' · peak Socket/page waiting total/per-page ' + waveDiag.maxSocketLaneWaitingTotal + '/' + waveDiag.maxSocketLaneWaitingPerPage
          + ' · Socket/page limits cuối [' + socketLaneFinal.limits + ']'
          + ' · backoff chậm/no-ACK ' + SOCKET_LANE_SLOW_ACK_BACKOFF_THRESHOLD + '/' + SOCKET_LANE_NOACK_BACKOFF_THRESHOLD
          + ' · peak API waiting ' + waveDiag.maxApiWaiting
          + (waveDiag.slotN
            /* [v1.92.50] NHÃN ĐƠN VỊ BẮT BUỘC — bốn số dưới đây là ms/chat TRUNG BÌNH, không phải
             * tổng thời gian của lượt. Log 11:34 in "còn lại 3 855ms" cạnh "⏱ Phát lệnh 296,8s" nên
             * rất dễ đọc thành tổng (chính vì vậy một báo cáo trước đã kết luận nhầm là số tích luỹ).
             * Nay ghi rõ "ms/chat" + "tổng" và n (số LẦN giữ slot của lượt này, không phải số chat —
             * ở lô 11:34 hai số đó tình cờ bằng nhau vì 1 chat giữ slot 1 lần).
             * Đọc đúng: giữ slot TB × (số chat ÷ main cap) ≈ thời gian phát của lô. */
            ? ' · ⏱ GIỮ SLOT (ms/chat): chờ ' + Math.round(waveDiag.slotAcquireMs / waveDiag.slotN)
              + ' · chuẩn bị ' + Math.round(waveDiag.slotPrepMs / waveDiag.slotN)
              + ' · còn lại ' + Math.round(Math.max(0, waveDiag.slotHoldMs - waveDiag.slotPrepMs) / waveDiag.slotN)
              + ' · tổng ' + Math.round(waveDiag.slotHoldMs / waveDiag.slotN)
              + ' (n=' + waveDiag.slotN + ' lần giữ slot)'
              /* [v1.92.53] XẺ "CÒN LẠI" — ba số dưới đây phải cộng lại xấp xỉ `còn lại`.
               * `phải chờ slot` in CẢ số lần (n) vì nếu n = 0 thì con số "chờ 662" của lô 8 509
               * là số ẢO, không phải chuyện nhỏ (xem chú thích ở waveDiag.slotAcqN). */
              + ' · phải chờ slot ' + (waveDiag.slotAcqN
                ? waveDiag.slotAcqN + ' ca · TB ' + Math.round(waveDiag.slotAcqPosMs / waveDiag.slotAcqN) + 'ms'
                : '0 ca')
              + ' · dò gid ' + (waveDiag.prepGidN
                ? waveDiag.prepGidN + ' ca · TB ' + Math.round(waveDiag.prepGidMs / waveDiag.prepGidN) + 'ms'
                  /* [v1.92.54] TÁCH LƯỢT 1 / LƯỢT 2 — 13 475 ms/ca ở lô 13:31 vượt MỌI hạn chờ đơn
                   * lẻ trong file (≤10 000 ms) ⇒ phải là 2 lượt nối tiếp. Nếu lô sau ra
                   * "lượt 1 TB ~7 000ms · lượt 2 TB ~6 500ms" thì giả thuyết đúng, và chỗ cắt
                   * đúng là lượt 2 của nhóm "server đã nói không có gid". */
                  + ' (lượt 1: ' + waveDiag.prepGidP1N + ' ca/TB ' + Math.round(waveDiag.prepGidP1Ms / Math.max(1, waveDiag.prepGidP1N)) + 'ms'
                  + ' · lượt 2: ' + waveDiag.prepGidP2N + ' ca/TB ' + Math.round(waveDiag.prepGidP2Ms / Math.max(1, waveDiag.prepGidP2N)) + 'ms)'
                : '0 ca')
              + ' · chuẩn bị ctx (không tính bind) '
                + Math.round(Math.max(0, waveDiag.slotPrepMs - waveDiag.prepBindMs) / waveDiag.slotN) + 'ms'
              /* [v1.92.49] SỐ ĐO KHÂU ẢNH — để lần sau khỏi suy đoán "3 406 ms còn lại" là gì.
               * Mỗi chat có ảnh phải bind fbId riêng (is_reusable=false) TRƯỚC khi bắn. */
              + (photoUpStats.n
                ? ' · 📷 bind fbId: ' + photoUpStats.n + ' ca · TB ' + Math.round(photoUpStats.ms / photoUpStats.n)
                  + 'ms/ca · max ' + photoUpStats.max + 'ms · lỗi ' + photoUpStats.fail
                : '')
            : '')
          + ' · giữ cổng (bay/retry/ext/api) ' + waveDiag.gateBlockInflight + '/' + waveDiag.gateBlockRetry
          + '/' + waveDiag.gateBlockExt + '/' + waveDiag.gateBlockApi
          /* [v1.92.52] "CHI TIẾT GIỮ CỔNG" tách 3 mức của "đang bay" — xem chú thích ở waveDiag.
           * Đọc: cứng = quá 92 % cap (chờ slot thật) · mềm = trong (75 %, 85 %] (chỉ nhánh mềm
           * mở được) · tiến độ = slot còn dư nhưng chưa đủ 25 % item xong. */
          + ' · chi tiết giữ cổng: cứng ' + waveDiag.gateBlockHard + ' · mềm ' + waveDiag.gateBlockSoft
          + ' · tiến độ ' + waveDiag.gateBlockProgress
          + ' · slot thoát ≤75% cap: ' + waveDiag.gateIdleSeen + ' lần (thấp nhất ' + waveDiag.gateIdleMax + ')'
          /* [v1.92.55] NHÁNH "CHỜ VIỆC XONG" — lô 14:03 giữ cổng 25 013 ms với `main đang bay 0`
           * mà cả 3 số cứng/mềm/tiến độ đều 0 ⇒ thiếu đúng số này. `không còn worker` phải > 0
           * mới chứng minh được "cổng chờ ĐẾM XONG bị sổ chờ xác nhận giữ lại". */
          + ' · chờ việc xong: ' + waveDiag.gateWaitDone + ' lượt'
          + ' (không còn worker ' + waveDiag.gateNoWorkerSeen + ' lượt · treo chờ xác nhận đỉnh '
          + waveDiag.gateBgPendingMax + ')');
        logLine('📡 SOCKET: ACK OK/rejected/no-ACK ' + sendDiag.socketAckOk + '/' + sendDiag.socketAckRejected + '/' + sendDiag.socketNoAck
          + ' · ACK TB/max ' + socketAckAvgMs + '/' + sendDiag.socketAckMsMax + 'ms'
          + ' · buckets <250/250-999/1-2s/2-5s/≥5s '
          + sendDiag.socketAckLt250 + '/' + sendDiag.socketAck250To999 + '/' + sendDiag.socketAck1To2s + '/'
          + sendDiag.socketAck2To5s + '/' + sendDiag.socketAckGte5s
          + ' · retry wave ' + (sendDiag.sockWaveRetry || 0)
          + ' · retry lần ' + sendDiag.sockRetry + ' (cứu ' + sendDiag.sockRetryRecovered + ' · rejected '
          + sendDiag.sockRetryRejected + ' · khác ' + sendDiag.sockRetryOther           + ' · retry ảnh ' + sendDiag.photoRetry
          + ' · bỏ thử lần 2 (ngân sách) ' + sendDiag.sockRetryBudgetSkipped
          + ' · khách không nhận được ' + sendDiag.recipientUnavailable + ' (chỉ đếm, không lưu)');
        /* [v1.92.48] Dòng riêng cho CỬA SỔ NGHE ACK — đây là dòng để nghiệm thu lần chạy sau.
         * Đọc: hold-expired > 0 mà lateOk = 0 ⇒ hạn chờ giữ slot vẫn đang cắt (nên xem lại
         * p90/p95); lateOk > 0 ⇒ cửa sổ nghe đã cứu được đúng số tin trước đây bị bù Ext oan. */
        logLine('🔔 CỬA SỔ NGHE ACK: giữ slot ' + ackHoldMsFor(sockAckP90()) + 'ms · nghe ' + ackListenMsFor(ackHoldMsFor(sockAckP90()))
          + 'ms · hết hạn chờ (còn nghe tiếp) ' + (sendDiag.sockAckHoldExpired || 0)
          + ' · im lặng THẬT hết cửa sổ ' + (sendDiag.sockAckSilent || 0)
          + ' · ACK về MUỘN đã phân xử ' + (sendDiag.sockLateAck || 0)
          + ' (trong đó ✅ ' + (sendDiag.sockLateOk || 0) + ' · FB từ chối ' + (sendDiag.sockLateRejected || 0) + ')'
          + ' · muộn-không-payload ' + (sendDiag.sockLateNoack || 0)
          + ' · lỗi xử lý muộn ' + (sendDiag.sockLateAckErr || 0)
          + ' · p90/p95 ' + sockAckP90() + '/' + (sockAckP95() || 0) + 'ms (' + ackLatRing.length + ' mẫu)');
        logLine('🌐 API NỀN: queued(nền)/started(nền+đồng bộ)/fetch ' + sendDiag.apiQueued + '/' + sendDiag.apiStarted + '/' + sendDiag.apiFetchAttempts
          + ' · OK/rejected/không rõ ' + sendDiag.apiSuccess + '/' + sendDiag.apiRejected + '/' + sendDiag.apiUnknown
          + ' · HTTP status [' + apiStatuses + '] · 429/retry ' + sendDiag.api429 + '/' + sendDiag.api429Retries
          + ' · fallback ' + sendDiag.apiFallback + ' · cứu thiếu globalId ' + sendDiag.apiNoGidFallback
          + ' · hủy ' + sendDiag.apiCancelled
          + ' · queue wait TB/max ' + Math.round(sendDiag.apiQueueWaitMsTotal / apiStartedSafe) + '/' + sendDiag.apiQueueWaitMsMax + 'ms'
          + ' · fetch TB/max ' + Math.round(sendDiag.apiFetchMsTotal / apiFetchSafe) + '/' + sendDiag.apiFetchMsMax + 'ms'
          + ' · fetch p50 ' + (() => { const a = (sendDiag.apiFetchSamples || []).slice().sort((x, y) => x - y);
              return a.length ? a[Math.floor(a.length / 2)] : 0; })() + 'ms');
        logLine('🧭 Chẩn đoán globalId: cache ' + gidStats.cacheHit
          + ' · HTTP ' + gidStats.httpHit
          + ' · WS ' + gidStats.wsHit
          + ' · Ext ' + gidStats.extHit
          + ' · HTTP không có gid ' + gidStats.httpNoGid
          + ' · HTTP lỗi ' + gidStats.httpFail + ' (429×' + gidStats.http429 + ')'
          + ' · Ext chưa rõ ' + gidStats.extUnknown
          + ' · lần dò chưa ra ' + gidStats.unknown
          + ' · batch nạp ' + gidStats.batchMappings + '/' + gidStats.batchReturned + ' mapping (lỗi ' + gidStats.batchFail + ')'
          /* [v1.93.14] doc_id: ext KHÔNG trả _SUCCESS cho `PRELOAD_DOC_IDS` (không `await`
           * `O.preloadDocIds`) ⇒ `viaExtOk` gần như luôn 0, `viaExtWaited` = số lần đã chờ đủ.
           * Trước bản này 3 bộ đếm này thu thập rồi KHÔNG in ở đâu ⇒ không thể biết lệnh nạp
           * có được gửi hay không. In ra để đọc được. */
          /* [v1.93.14] Đọc lịch sử TRỰC TIẾP TỪ FB: `tin N · gid M` và số lần nó CHẶN được
           * một lần bù (`cứu K`). `cứu > 0` = Pancake nói "chưa thấy" nhưng FB có tin ⇒
           * nếu không có đường này thì đã bù ⇒ khách nhận 2 tin. */
          + ' · đọc thẳng FB: tin ' + gidStats.fbDirectMessages
          + ' · gid ' + gidStats.fbDirectSavedGid
          + ' · cứu ' + sendDiag.fbDirectPresent
          + ' · doc_id gửi ' + (docIdStats.viaExtOk + docIdStats.viaExtWaited)
          + ' (chờ hết hạn ' + docIdStats.viaExtWaited + ' · gửi lỗi ' + docIdStats.viaExtEmpty + ')'
          + ' · Ext trả không có gid ' + gidStats.extRespondedNoGid
          + ' (trong đó INCORRECT THREAD ' + (gidStats.extIncorrectThread || 0) + ')'
          + ' · Ext p90 ' + (extLatP90() || 0) + 'ms → timeout ' + extTimeoutMs() + 'ms'
          + ' · ACK p50/p90 ' + (sockAckP50() || 0) + '/' + sockAckP90() + 'ms → ngưỡng nhanh ' + fastAckMs() + 'ms'
          + ' · bỏ nới lane ' + sockRampSkipped + ' lần (đuôi p95 > ' + SOCK_RAMP_P95_MAX_MS + 'ms: '
          + sockRampSkippedTail + ' · có no-ACK trong ' + SOCK_RAMP_QUIET_N + ' ca gần nhất: ' + sockRampSkippedNoAck + ')'
          + ' · can_inbox=false ' + ((sendDiag && sendDiag.canInboxFalse) || 0) + '/' + ((sendDiag && sendDiag.canInboxSeen) || 0)
           + ' · gate bỏ Ext no-gid ' + gidStats.gateSkip
           + ' · chờ dò ngắn (server nói không có gid) ' + (gidStats.shortNoGidWait || 0) + ' ca'
           + ' · chọn kênh: Ext-trước(socket chưa sync) ' + socketPickDiag.notReady
           + ' / thiếu gid ' + socketPickDiag.noGid
           + ' / Socket bị né (mất tin ' + socketPickDiag.skipLost
             + ' · ACK chết ' + socketPickDiag.skipAckDead + ') ' + socketPickDiag.deadSkip
           + ' · dò lại ACK chết ' + socketPickDiag.probe + ' (hồi ' + socketPickDiag.probeOk + ')'
          + ' · lane HTTP ' + ctxFetchLane.getLimit()
          + ' / Ext dò ' + gidExtLane.getLimit()
          /* [v1.92.54] `Ext dò` ĐỨNG Y Ở SÀN 4 suốt 2 lô (13:25 và 13:31) chứng minh đường hồi
           * 1.92.52 KHÔNG CHẠY (nó đòi waitingCount ≥ 12, mà làn 4 chỗ chỉ giữ được ≤4 lượt).
           * Nay in thêm ĐỈNH để lô sau kiểm được: đỉnh phải > 4. Nếu vẫn = 4 ⇒ lại sai, đọc số ảo. */
          + ' (đỉnh ' + gidExtPeak + ')'
          + ' / Ext gửi ' + extSendLane.getLimit()
          + ' / Socket/page ' + getPageSocketLaneRange());
        // [v1.92.34] Lô đã chốt ⇒ chạy hậu kiểm 1545041 (chỉ đọc lịch sử, không bắn lại).
        try { void startDeadUserRecheck(); } catch (eDU) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  }

  /* ═══ [v1.92.63] ÂN HẠN CHỐT BẢNG: "NỚI RA MỘT CHÚT" ĐÚNG CHỖ CÓ BẰNG CHỨNG ═══
   * Vấn đề đo được (log 20:41:43, 5 chat): mọi chat đã có kết luận ⚠ ⇒ `pendingSend = 0` ⇒
   * `isDoneAll = true` ⇒ bảng TỔNG HỢP in NGAY, trong khi 5 ca ⚠ đó còn kiểm chứng nền đang
   * chạy và 8 s sau lật cả 5 sang ✅. Bảng in `🖐 CẦN GỬI TAY: 5 chat` = lời mời gửi tay
   * ⇒ làm theo là khách nhận 2 tin. Đây là dạng sai nguy hiểm nhất: không mất tin nhưng
   * DẠY người dùng gây trùng.
   * Vì sao không chờ hết kiểm chứng: 2 lô lớn cho thấy đuôi kiểm chứng dài 28 s / 3 phút
   * (lô 14 815: 'lâu nhất 28,2 s'; lô 8 518: '⏳ ĐANG CỨU 35 chat'), chờ hết là lùi đúng cái
   * tối ưu 1.92.36 đã bỏ.
   * Nay: ân hạn NGẮN, chỉ khi CÒN ca kiểm chứng nền.
   *   • `verifyPending > 0` mà mới quá `loopFinished` < SUMMARY_GRACE_MS ⇒ HOÃN in bảng.
   *   • Hết ân hạn ⇒ in như cũ, nhưng câu về gửi tay đổi thành "TẠM ⚠ — chưa kết luận"
   *     (xem chỗ dựng câu) ⇒ người dùng không bị mời gửi tay khi máy còn đang kiểm chứng.
   * Không thêm lệnh gửi nào, không đổi phán quyết của ca nào ⇒ không thể sinh tin trùng. */
  const SUMMARY_GRACE_MS = 2500;
  function updateBatchSummaryUI() {
    // Trong khi phát từng chat, chưa cần quét các map pending và dựng lại tổng hợp liên tục.
    // Defer thẳng trước khi tính counter, tránh tạo thêm CPU load cho tất cả các tab.
    const isLargeSending = batchStats.total > 200 && state.sending && !batchStats.loopFinished;
    if (isLargeSending) {
      if (!summaryUiTimer) summaryUiTimer = setTimeout(flushBatchSummaryUI, 1000);
      return;
    }
    const c = getBatchSummaryCounts();
    const isDoneAll = batchStats.loopFinished && (c.pendingSend === 0 || state.stopRequested);
    /* [v1.92.63] ÂN HẠN: còn ca kiểm chứng nền thì đừng chốt bảng vội (xem SUMMARY_GRACE_MS). */
    const verifyLeftUi = Math.max(0, c.pending - c.pendingSend);
    if (!state.stopRequested && batchStats.loopFinished && c.pendingSend === 0 && verifyLeftUi > 0) {
      if (!batchStats.loopFinishedAt) batchStats.loopFinishedAt = Date.now();
      if (Date.now() - batchStats.loopFinishedAt < SUMMARY_GRACE_MS) {
        if (!summaryUiTimer) summaryUiTimer = setTimeout(flushBatchSummaryUI, 400);
        return;
      }
    }
    // Khi lô lớn còn ACK/bù nền, chỉ dựng lại tổng hợp 1 lần/giây; chốt cuối vẫn flush ngay.
    if (!isDoneAll && c.total > 200) {
      if (!summaryUiTimer) summaryUiTimer = setTimeout(flushBatchSummaryUI, 1000);
      return;
    }
    if (summaryUiTimer) { clearTimeout(summaryUiTimer); summaryUiTimer = null; }
    flushBatchSummaryUI();
  }

  /* [v1.92.35] SỐ "THÀNH CÔNG" PHẢI LÀ SỐ ĐÃ TỚI NƠI THẬT.
   * Lô 14:28 (8 851 chat): dòng tiến độ in `thành công 8564/8851` (96,8 %) lúc 14:30:02,
   * 3 giây sau TỔNG HỢP chốt 5 095 (57,6 %). Nguyên nhân: chế độ wave trả `{ok:true, fired:true}`
   * NGAY KHI BẮN (chưa có ACK) nên biến `ok` trong vòng lặp cộng luôn; 3 411 ca ACK `rejected`
   * về sau chỉ chốt ❌ ở nền mà không trừ `ok`. Nay tiến độ đọc `summaryCounters.ok*` — chỉ tăng
   * khi `markDelivered()` thật sự chạy (ACK OK / API 200 / Ext trả success) và tự giảm khi lật lại. */
  function confirmedOkCount() {
    return summaryCounters.okApi + summaryCounters.okExt + summaryCounters.okSocket;
  }
  function markDelivered(convId, via) {
    if (!convId) return;
    clearBgPending(convId);
    const ch = (via === 'ext' || via === 'extension') ? 'ext' : (via === 'socket' ? 'socket' : 'api');
    // [v1.92.33] SỔ KIỂM CHỨNG: ghi MỌI lần đánh dấu "đã tới nơi" (kể cả lần trùng kênh ở dưới).
    // 1 chat bị đánh dấu ≥ 2 lần ⇒ dấu hiệu xác nhận sai / gửi lặp ⇒ file .txt liệt kê riêng.
    try {
      let hist = deliverHits.get(convId);
      if (!hist) { hist = []; deliverHits.set(convId, hist); }
      const tNow = Date.now();
      const last = hist[hist.length - 1];
      // GỘP các lần gọi lặp CÙNG kênh trong 2 s (watchdog/ACK gọi lại — KHÔNG phải gửi lặp).
      // Còn khác kênh, hoặc cách nhau > 2 s ⇒ ghi thành lần riêng: đó mới là dấu hiệu gửi lặp.
      if (!last || last.by !== ch || (tNow - last.t) > 2000) {
        hist.push({ t: tNow, by: ch });
        if (hist.length > 20) hist.shift();
        auditPush('✅', convId, '', 'đánh dấu ĐÃ TỚI NƠI qua ' + ch);
      }
    } catch (e0) { /* ignore */ }
    const prev = deliveredIds[convId];
    if (prev === ch) { updateBatchSummaryUI(); return; }
    if (prev === 'ext') summaryCounters.okExt = Math.max(0, summaryCounters.okExt - 1);
    else if (prev === 'socket') summaryCounters.okSocket = Math.max(0, summaryCounters.okSocket - 1);
    else if (prev === 'api') summaryCounters.okApi = Math.max(0, summaryCounters.okApi - 1);
    if (finalFailedIds[convId]) { delete finalFailedIds[convId]; summaryCounters.fail = Math.max(0, summaryCounters.fail - 1); }
    if (uncertainIds[convId]) { delete uncertainIds[convId]; summaryCounters.unsure = Math.max(0, summaryCounters.unsure - 1); }
    deliveredIds[convId] = ch;
    dropManualResend(convId); // đã xác nhận tới nơi ⇒ khỏi danh sách gửi tay
    delete rescueInFlight[convId]; // hết "đang cứu" — đã có kết luận
    /* [v1.92.63] SỔ ĐỊNH TUYẾN PHẢI HỒI VỚI MỌI KÊNH GIAO ĐƯỢC — không chỉ Socket.
     * Bản 1.92.40 chỉ hồi khi `ch === 'socket'`. Hệ quả đo được trên log 20:41:43 (5 chat):
     *   • 5 ca Socket không ACK ⇒ `absent++` (chẩn đoán, không ban) — nhưng bộ đếm vẫn nằm đó;
     *   • Ext cứu xong ⇒ `markDelivered(id,'ext')` ⇒ nhánh cũ KHÔNG chạy ⇒ sổ vẫn y nguyên;
     *   • ca sau đọc sổ ⇒ tưởng page vẫn "mất tin" dù vừa giao thành công 5/5.
     * Nay: BẤT KỲ kênh nào giao được (socket/ext/api) đều là BẰNG CHỨNG DƯƠNG ⇒ cộng `dlv`
     * và xoá `lostSock`/`lostExt` (tự hồi như thiết kế 1.92.40, chỉ là áp cho mọi kênh).
     * Chỉ `dlv++` là thay đổi thật; KHÔNG nới điều kiện ban Socket (vẫn chỉ `lostSock` được ban).
     * `absent` KHÔNG xoá ở đây: nó là số chẩn đoán của Socket, xoá đi là mất dấu vết điều tra. */
    if (ch === 'socket' || ch === 'ext' || ch === 'api') {
      try {
        const _st = sockRoute[String(String(convId).split('_')[0])];
        if (_st) { _st.dlv++; _st.lostSock = 0; _st.lostExt = 0; }
      } catch (eSt2) { /* ignore */ }
    }
    softNotify('delivered'); // [v1.92.9] chỗ chờ "đã giao" thức ngay, khỏi chờ mù 220 ms
    // Lượt đã kết thúc bình thường (không bấm Dừng) thì sentIds đã được dọn ở cuối sendToAll —
    // ACK trễ KHÔNG được nạp lại, nếu không lượt sau bỏ qua oan gần hết chat (mất tin im lặng)
    if (convId && !(batchStats.loopFinished && !state.stopRequested)) {
      state.sentIds.add(convId);
      saveSentIds();
    }
    if (ch === 'ext') summaryCounters.okExt++;
    else if (ch === 'socket') summaryCounters.okSocket++;
    else summaryCounters.okApi++;
    updateBatchSummaryUI();
  }

  /* [v1.93.13] `reason` (tuỳ chọn, tham số 3) chỉ dùng để GHI SỔ ca ⚠ — xem khối chú thích
   * trong nhánh `uncertain`. Không đổi phán quyết, không thêm lệnh gửi. */
  window.__botfakeTrackStatus__ = function (convId, kind, reason) {
    if (!convId || deliveredIds[convId]) return;
    clearBgPending(convId);
    if (kind === 'fail') {
      // đã từng bị watchdog chốt ⚠ mà sau đó bù chốt lỗi hẳn → chuyển nhóm, không đếm 2 lần
      if (uncertainIds[convId]) { delete uncertainIds[convId]; summaryCounters.unsure = Math.max(0, summaryCounters.unsure - 1); }
      dropManualResend(convId); // đã chốt ❌ (khách không nhận) ⇒ không còn là "cần gửi tay"
      delete rescueInFlight[convId];

      if (!finalFailedIds[convId]) { finalFailedIds[convId] = true; summaryCounters.fail++; }
    } else if (kind === 'uncertain') {
      if (!uncertainIds[convId] && !finalFailedIds[convId]) { uncertainIds[convId] = true; summaryCounters.unsure++; }
      /* ═══ [v1.93.13] GHI SỔ CHO CA ⚠ — TRƯỚC ĐÂY KHÔNG CÓ DÒNG NÀO ═══
       * ĐO ĐƯỢC (log 22/11 09:54, lô 8 572 chat, bản W200.124):
       *   • TỔNG HỢP ghi `⚠ Không rõ: 3 547` và `🖐 CẦN GỬI TAY: 3 547 chat`
       *   • Sổ kiểm chứng chỉ có 5 025 chat; `8 572 − 5 025 = 3 547` — KHỚP CHÍNH XÁC
       *   • Trong sổ: ✅ 5 006 · ❌ 47 · ⏳ 33 · 🔎 19 · 🛟 1 ⇒ **0 dòng ⚠**
       *   • 2 000 dòng đầu của 🖐 CẦN GỬI TAY: giao với sổ = **0/2 000**
       * ⇒ Nhánh này chỉ tăng bộ đếm + đưa vào danh sách gửi tay, **không ghi dòng sổ nào**.
       *   Mọi ca được gọi từ đường nào (ACK rejected, quá hạn ACK, …) đều biến mất khỏi sổ.
       *
       * Hệ quả thật: đây đúng là câu hỏi treo từ lô 08:32 (570 ca ⚠) — KHÔNG truy được
       * nguồn vì ca ⚠ không có dòng sổ. Nay ghi sổ, kèm LÝ DO nếu chỗ gọi đưa vào.
       * Chỉ ghi nhận — không thêm lệnh gửi, không đổi phán quyết. */
      auditPush('⚠', convId, '', 'chốt KHÔNG RÕ (vào danh sách gửi tay)'
        + (reason ? ' · ' + String(reason) : ''));
      noteManualResend(convId); // ⚠ = máy không chắc đã gửi ⇒ vào danh sách gửi tay
    } else if (kind === 'skip') {
      if (!skippedLateIds[convId]) { skippedLateIds[convId] = true; summaryCounters.skipLate++; }
    }
    updateBatchSummaryUI();
  };

  /* ===== NGÂN SÁCH THỬ LẠI SOCKET — TỰ ĐO RỒI TỰ ĐÓNG (v1.92.26) =====
   * Thử lại Socket 1 lần chỉ có MỘT mục đích: phân biệt "burst-reject tạm thời" với
   * "khách không nhận được". Lô 10:04 (2 413 chat, bản 1.92.25): thử lại 861 lần, cứu 0
   * (ACK rejected 1 722 = 861 x 2) trong khi tổng lưu lượng socket là 3 223 lệnh thay vì
   * 2 413 => 27% lưu lượng là công vô ích, kèm 861 dòng log và 861 ACK phải phân tích.
   * Luật mới — đo rồi mới kết luận, không đoán:
   *   - chưa thử đủ 40 ca            => vẫn thử lại như cũ;
   *   - đã thử >= 40 ca mà cứu 0 VÀ tỉ lệ FB từ chối >= 10% (burst thật thì tỉ lệ thấp)
   *                                  => ĐÓNG ngân sách: ca sau chốt ❌ ngay, ghi rõ;
   *   - đã đóng vẫn dò lại 1 ca mỗi 200 ca bị bỏ; cứu được 1 ca là MỞ LẠI ngay.
   */
  const sockRetryBudgetState = { tried: 0, saved: 0, skipped: 0, sinceProbe: 0, closed: false, closePct: -1 };
  function resetSockRetryBudget() {
    resetSockAckRecent();
    // [v1.92.29] Chuỗi no-ACK phải bắt đầu lại từ 0 mỗi lượt. Lô 13:42 (4 chat, 1 ca mất ACK)
    // vẫn in "🐢 Socket no-ACK lặp 2 lần — giảm lane xuống 64" vì chuỗi 1 ca còn dư từ lô trước.
    try {
      Object.keys(socketPageLaneCtl).forEach(function (k) { socketPageLaneCtl[k].noAckStreak = 0; });
    } catch (e) { /* ignore */ }
    sockRetryBudgetState.tried = 0;
    sockRetryBudgetState.saved = 0;
    sockRetryBudgetState.skipped = 0;
    sockRetryBudgetState.sinceProbe = 0;
    sockRetryBudgetState.closed = false;
    sockRetryBudgetState.closePct = -1;
  }
  const SOCK_RETRY_BUDGET_MIN = 40;
  const SOCK_RETRY_PROBE_EVERY = 200;
  // [v1.92.28] Đo trên CỬA SỔ GẦN NHẤT (200 ACK), không dùng tỉ lệ tích luỹ:
  //   • < 15%  ⇒ lô gần như sạch, chuyện thử lại rất ít ⇒ cứ thử (không đóng);
  //   • 15–85% ⇒ "nhiều khách chết" ⇒ đóng sau 40 ca (đúng mục tiêu);
  //   • > 85%  ⇒ gần như MỌI ca đều bị từ chối = burst-reject/sự cố ⇒ KHÔNG đóng.
  const SOCK_RETRY_MIN_REJECT_PCT = 15;
  const SOCK_RETRY_MAX_REJECT_PCT = 85;
  function sockRetryBudgetAllows(budget) {
    if (!budget || !budget.closed) return true;
    return budget.sinceProbe >= SOCK_RETRY_PROBE_EVERY;
  }
  function sockRetryBudgetNote(budget, outcome, rejectPct) {
    if (!budget) return;
    if (outcome === 'skipped') { budget.skipped++; budget.sinceProbe++; return; }
    if (outcome === 'probe') { budget.sinceProbe = 0; return; }
    if (outcome === 'tried') budget.tried++;
    if (outcome === 'saved') { budget.saved++; budget.closed = false; budget.sinceProbe = 0; return; }
    const pct = Number(rejectPct);
    if (!budget.closed && budget.saved === 0 && budget.tried >= SOCK_RETRY_BUDGET_MIN
        && pct >= SOCK_RETRY_MIN_REJECT_PCT && pct <= SOCK_RETRY_MAX_REJECT_PCT) {
      budget.closed = true;
      budget.closePct = Math.round(pct);
      budget.sinceProbe = 0;
    }
  }
  function isRetryableLoss(err) {
    const s = String(err || '');
    // (#100) Không tìm thấy người dùng phù hợp = tài khoản FB không tồn tại → không kênh nào gửi được
    if (/\(#100\)|Không tìm thấy người dùng phù hợp/i.test(s)) return false;
    // "(#10)/(#551)… ngoài cửa sổ…" → kênh KHÁC vẫn có thể gửi được (Ext cứu — Thanh Binh,
    // log 07:36; tinnhan.har [59]/[64] → [72]/[75]) → bù sang kênh chưa thử.
    if (isWindowClosedError(s)) return true;
    // CHỈ các lỗi kênh xác nhận "chưa gửi" — không đụng 'không rõ/maybe', token, dữ liệu thiếu
    return /server báo gửi thất bại|Extension không gửi được|Socket không kết nối|Không thấy Extension|Extension Pancake chưa kết nối/.test(s);
  }

  // BÙ — mỗi kênh ĐÚNG 1 LẦN/chat (đúng luật "bù tối đa 1 lần/1 kênh"): kênh vừa thua KHÔNG được
  // thử lại, nhưng kênh CHƯA thử vẫn PHẢI thử tiếp (chuỗi như plan của app: api → extension ⇄ socket).
  // Cả Extension lẫn Socket đều hỗ trợ gửi cả chữ lẫn ảnh (cho chat inbox). Bình luận (comment) chỉ
  // hỗ trợ API/Extension. 'maybe'/đã đến nơi → DỪNG tuyệt đối (chống trùng).
  function scheduleBuRetry(conv, text, photo, name, why, tried, opts) {
    if (!conv) return;
    // [v1.92.30] `opts.ambiguous` = phán quyết lỗi là SUY LUẬN (không phải bằng chứng) ⇒ phải
    // chứng minh vắng mặt trước khi bắn lần 2. `opts.sentAt` = mốc bắt đầu lần gửi đầu.
    const buGated = !!(opts && opts.ambiguous);
    // [v1.92.38] `opts.fromUncertain` = cứu ca ⚠ ĐÃ CÓ BẰNG CHỨNG vắng mặt (socket no-ACK).
    // Chat vẫn nằm trong sổ ⚠ để lượt không bị mở lại (xem chú thích ở scheduleSocketVerify),
    // nên phải cho đi qua cửa chặn "đã chốt ⚠ thì không bù" — nhưng CHỈ khi có cờ này.
    const buFromUncertain = !!(opts && opts.fromUncertain);
    const buSentAt = (opts && Number(opts.sentAt)) || Date.now();
    const buVia = (opts && opts.via) || 'socket';
    if (buRetryTimer[conv.id]) return; // đã có chuỗi bù đang chờ — không chạy song song (chống gửi 2 lần)
    if (sockFiredPending.has(conv.id)) {
      // Socket đã bắn và ACK chưa chốt — bù kênh khác lúc này có thể gây TRÙNG câu. Chờ xác nhận nền chốt.
      logLine('⏳ ' + name + ' — đang chờ xác nhận Socket (bắn-nhả) — không bù chồng để tránh trùng');
      return;
    }
    if (deliveredIds[conv.id]) {
      // đã có kênh XÁC NHẬN thành công thật — không gửi lại (chống trùng). Có log để không im lặng.
      logLine('✓ ' + name + ' — tin đã đến nơi (xác nhận) — không bù.');
      return;
    }
    if (finalFailedIds[conv.id] || (uncertainIds[conv.id] && !buGated && !buFromUncertain)) {
      // Đã có nơi chốt cuối cho chat này (watchdog chốt ⚠ quá hạn / đã chốt ❌) — chốt đó là
      // TUYỆT ĐỐI theo luật chống trùng: kết quả Socket về muộn không được kích bù nữa,
      // nếu không sẽ bắn lần 2 lên tin có thể đã đến nơi (lặp ít, chủ yếu tin ảnh chốt chậm)
      logFailGrouped(name, 'đã chốt trạng thái cuối (⚠/❌) — không bù thêm để tránh trùng', '✓', conv.id);
      return;
    }
    if (pendingBg[conv.id]) pendingBg[conv.id].at = Date.now(); // chuỗi bù còn đang chạy — gia hạn watchdog
    const triedCh = (tried || []).slice();
    const done = buRetryDone[conv.id] || (buRetryDone[conv.id] = []); // kênh ĐÃ bù trong lượt
    const hasExt = !!(window.__ExtensionAdapter__ && typeof window.__ExtensionAdapter__.send === 'function');
    let baseCandidates = (conv.type === 'comment')
      ? ['ext']
      : (hasExt ? ['ext', 'socket'] : ['socket']);
    // [v1.92.36] Page đang bị đánh dấu ACK CHẾT mà vẫn còn Extension ⇒ bù bằng Ext (có câu trả lời
    // dứt khoát trong 1–3 s) thay vì bắn Socket rồi chờ hết hạn ACK ~5 s để rồi vẫn "không rõ".
    // Lô 90 chat 15:44: ca Nguyễn Quỳnh mất 5 s đúng vì lý do này. Không đổi số lệnh gửi.
    try {
      const buPid = conv.pageId || String(conv.id || '').split('_')[0];
      if (hasExt && buPid && isPageAckDead(buPid)) {
        baseCandidates = baseCandidates.filter((x) => x !== 'socket');
      }
    } catch (eBs) { /* ignore */ }
    const remaining = baseCandidates.filter((c) => triedCh.indexOf(c) < 0 && done.indexOf(c) < 0);
    if (!remaining.length) {
      /* [v1.92.40] ❌ OAN VÌ BỘ NGẮT QUÁ TẢI — vá đúng gốc của lô 9 455 chat (§45: "bỏ qua lúc Ext
       * quá tải 1 526" ca, không ca nào từng được BẮN, tất cả bị tính ❌).
       * Bộ ngắt của Ext chỉ nghỉ 8–15 s rồi tự đóng. Vậy: chat bị bộ ngắt chặn (chưa hề gửi) thì
       * KHÔNG chốt ❌ — đặt ⚠ "chưa gửi" rồi hẹn bắn lại qua Ext sau 9 s (tối đa 2 lần). Nếu vẫn
       * không xong thì mới tính ❌, và chat vẫn nằm trong danh sách gửi tay. */
      const extAliveNow = !!(window.__ExtensionAdapter__ && typeof window.__ExtensionAdapter__.send === 'function');
      const lateN = buLateRetryCount[conv.id] || 0;
      if (extAliveNow && conv.__extSkippedOverload && lateN < 2 && !state.stopRequested) {
        buLateRetryCount[conv.id] = lateN + 1;
        try { delete conv.__extSkippedOverload; } catch (eLo) { /* ignore */ }
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
        logFailGrouped(name, 'Extension đang nghỉ hồi sức (bộ ngắt quá tải) — chat CHƯA được gửi lần nào '
          + '⇒ hẹn thử lại sau 9 s (lần ' + (lateN + 1) + '/2), không chốt ❌ oan', '⏳', conv.id);
        const myLateRun = runSeq;
        bgClock.after(9000, () => {
          if (myLateRun !== runSeq || state.stopRequested) return;
          if (deliveredIds[conv.id] || finalFailedIds[conv.id]) return;
          scheduleBuRetry(conv, text, photo, name, 'thử lại sau khi Extension hồi sức', ['api', 'socket'],
            { ambiguous: false, fromUncertain: true, via: 'ext', sentAt: Date.now() });
        });
        return;
      }
      const seen = {};
      const names = triedCh.concat(done).filter((x) => (seen[x] ? false : (seen[x] = true)));
      if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
      logFailGrouped(name, 'đã thử hết kênh (' + (names.join(', ') || 'không rõ') + ')'
        + (conv.type === 'comment' ? ' — bình luận chỉ API/Extension gửi được (Socket không hỗ trợ)' : '')
        + ' — không bù nữa (mỗi kênh đúng 1 lần)', '❌', conv.id);
      return;
    }
    const myRun = runSeq;
    // Chỉ bật gidForceFind khi đã từng thử 'ext' hoặc 'socket' bị từ chối thực sự; nếu mới chỉ thử 'api'
    // hoặc đang cứu ca Socket mất ACK thì global_id trong cache/GET /messages vẫn hoàn toàn hợp lệ!
    const isNoAckRescue = /mất ACK/i.test(String(why || ''));
    const isApi551 = /\(#551\)|Người này hiện không có mặt/i.test(String(why || ''));
    const hadDirectFail = !isNoAckRescue && (triedCh.indexOf('ext') > -1 || triedCh.indexOf('socket') > -1 || done.length > 0);
    const delay = hadDirectFail ? (150 + Math.min(buRetrySeq++, 6) * BU_SPREAD_MS) : BU_RETRY_EXT_MS;
    // [v1.92.34] Gộp theo lý do như mọi dòng khác (lô 13:38 in 23 dòng ⏳ gần trùng nhau).
    logFailGrouped(name, why + ' — đang bù'
      + (remaining.length > 1 ? ' (Socket/Extension)' : (' qua ' + (remaining[0] === 'ext' ? 'Extension' : 'Socket'))) + '…', '⏳', conv.id);
    buRetryTimer[conv.id] = bgClock.after(delay, () => {
      buRetryTimer[conv.id] = null;
      if (myRun !== runSeq) return; // có lượt gửi mới — bù của lượt cũ bỏ (tránh gửi lẫn 2 lượt)
      if (state.stopRequested) {
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
        logLine('⏸ ' + name + ' — bỏ bù (đang dừng).');
        return;
      }
      if (deliveredIds[conv.id]) return; // trong lúc chờ, tin đã đến nơi qua đường khác — thôi
      if (finalFailedIds[conv.id] || (uncertainIds[conv.id] && !buGated && !buFromUncertain)) return; // watchdog đã chốt ⚠/❌ trong lúc chờ bù — không bắn lần 2 (trừ ca cứu có bằng chứng)
      const buCtx = { gidForceFind: hadDirectFail, isBuRetry: true, apiRejected551: isApi551 };
      const actuallySendBu = () => busEnqueue(async () => {
        // Kiểm tra LẠI ngay trước khi bắn: trong lúc xếp hàng chờ lane (có thể cả phút ở
        // lô lớn), ACK của lần đầu có thể đã về hoặc watchdog đã chốt — kiểm tra ở timer
        // là chưa đủ, cứ bắn là LẶP (đây là nguồn của đoàn "bù thành công" cuối log)
        if (deliveredIds[conv.id]) {
          buStats.cancelled++;
          logFailGrouped(name, 'tin đã đến nơi trong lúc chờ bù — hủy bù (tránh trùng)', '✓', conv.id);
          return { ch: null, delivered: true };
        }
        if (finalFailedIds[conv.id] || (uncertainIds[conv.id] && !buGated && !buFromUncertain)) {
          buStats.cancelled++;
          logFailGrouped(name, 'đã chốt trạng thái cuối trong lúc chờ bù — hủy bù (tránh trùng)', '✓', conv.id);
          return { ch: null, delivered: true };
        }
        await prepareDirectCtx(conv, photo, buCtx);
        const pid = (buCtx.full && (buCtx.full.page_id || buCtx.full.pageId)) || conv.pageId || String(conv.id || '').split('_')[0];
        const ordered = (remaining.length > 1)
          ? pickBestDirectOrder(conv, pid, buCtx, remaining)
          : remaining.slice();
        const ch = ordered.find((c) => triedCh.indexOf(c) < 0 && done.indexOf(c) < 0) || remaining[0];
        done.push(ch);
        const r = (ch === 'ext')
          ? await sendViaExtension(conv, text, photo, buCtx)
          : await sendViaSocket(conv, text, photo, buCtx);
        return { ch, r };
      }).then((out) => {
        if (out && out.delivered) return; // đã hủy bù vì tin đến nơi / đã chốt cuối — không chốt lỗi
        if (!out || !out.ch) {
          // bước chuẩn bị bù văng lỗi (lane trả {ok:false}) — phải chốt, không im lặng kẹt pending
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
          logFailGrouped(name, 'bù lỗi: ' + clip((out && out.error) || 'không rõ', 90), '❌', conv.id);
          return;
        }
        const ch = out.ch;
        const r = out.r;
        const hasMoreAfterSocket = (ch === 'socket') && !isApi551 && remaining.some((c) => c !== 'socket' && triedCh.indexOf(c) < 0 && done.indexOf(c) < 0);
        if (r && r.ok) {
          markDelivered(conv.id, ch);
          postSendSideEffects(conv);
          markChannel(conv.id, ch); // lần gửi sau vào thẳng kênh vừa thắng
          if (conv.__extFallback1545) noteExt1545Outcome('saved'); // [v1.92.49] Ext CỨU ĐƯỢC ca 1545041
          buStats.ok++;
          buStats.byWhy[buWhyBucket(why)] = (buStats.byWhy[buWhyBucket(why)] || 0) + 1;
          // [v1.92.52] noAudit = true: markDelivered() ngay trên đã ghi ✅ vào sổ cho cùng lần gửi này.
          logFailGrouped(name, 'bù THÀNH CÔNG qua ' + (ch === 'ext' ? 'Extension' : 'Socket'), '✅', conv.id, true);
        } else if (r && r.sent === 'maybe' && r.extClaimedSuccess && r.extSuccessNoId) {
          /* [v1.93.14] `success` mà KHÔNG `messageId` ⇒ FB trả `error_payload` ⇒ KHÔNG có tin.
           * Đây KHÔNG phải "chưa xác nhận" mà là BẰNG CHỨNG VẮNG MẶT ⇒ ghi sổ "FB đã từ chối"
           * (để ca này không bị coi là "cần gửi tay" oan) và KHÔNG gửi thêm lệnh nào. */
          try { noteFbRejected(conv.id, 'Ext báo success nhưng không có messageId = error_payload ⇒ FB từ chối'); } catch (eFbR) { /* ignore */ }
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
          logFailGrouped(name, 'bù qua Extension: success nhưng KHÔNG có messageId ⇒ FB trả error_payload, KHÔNG có tin — không gửi lại', '❌', conv.id);
        } else if (r && r.sent === 'maybe' && r.extClaimedSuccess) {
          /* ═══ [v1.93.2] EXT BÁO `success` KHI BÙ: KHÔNG CHỐT ✅ ═══
           * Đây chính là đường sinh ra 554 ca ✅ giả của lô 21/11 20:28: r.ok=true ⇒
           * markDelivered ⇒ ✅ + `dropManualResend()` ⇒ chat biến mất khỏi danh sách gửi tay
           * dù chưa có một bằng chứng nào là khách đã nhận.
           * Nay: giữ ⚠ "chưa xác nhận" + ghi sổ `extClaimSuccess` để lượt đọc lịch sử quyết định
           * (đã đăng ký trong sendViaExtension). Thấy tin ⇒ ✅ · hết lượt không thấy ⇒ ❌.
           * KHÔNG gửi thêm lệnh nào — số lần gửi của ca này không đổi. */
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
          logFailGrouped(name, 'bù qua Extension: Extension báo success nhưng CHƯA xác nhận — giữ ⚠, đọc lại lịch sử (không gửi lại)', '⚠', conv.id);
        } else if (r && r.sent === 'maybe') {
          /* [v1.92.43] NGÂN SÁCH DÒ EXT PHẢI ĐÓNG Ở CẢ NHÁNH NÀY.
           * Log 16:52/17:03: dò Ext in 'thử 799 · cứu 0' và 'thử 1 431 · cứu 0' — tức ngân sách
           * 200 ca KHÔNG BAO GIỜ đóng, vì ca Ext quá hạn rơi vào nhánh 'maybe' chứ không phải
           * nhánh recipientUnavailable mà tôi chỉ gắn cờ đóng. Nay tính cả nhánh này. */
          if (conv.__extFallback1545) noteExt1545Outcome('unknown'); // quá hạn: chưa phải bằng chứng
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
          logFailGrouped(name, 'bù không rõ kết quả — KHÔNG gửi thêm (chống trùng)', '⚠', conv.id);
        } else if (r && r.recipientUnavailable && !hasMoreAfterSocket) {
          if (conv.__extFallback1545) noteExt1545Outcome('blocked'); // Ext cũng bị chặn — đo tiếp
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
          // ĐÂY là nơi tín hiệu "khách không nhận được" xuất hiện nhiều nhất (Extension trả
          // {"errorDescription":"Người này hiện không có mặt."}). Chỉ ĐẾM cho dòng chẩn đoán —
          // KHÔNG lưu gì, KHÔNG lọc gì ở các lượt sau (cơ chế nhớ đã bị xoá ở v1.92.21).
          sendDiag.recipientUnavailable++;
          logFailGrouped(name, 'bù ' + (ch === 'ext' ? 'Extension' : 'Socket') + ' không được: '
            + clip((r && r.error) || 'lỗi không rõ', 90) + ' — khách hiện không nhận được tin (không thử tiếp kênh khác)', '❌', conv.id);
        } else {
          if (conv.__extFallback1545) noteExt1545Outcome('blocked');
          logFailGrouped(name, 'bù ' + (ch === 'ext' ? 'Extension' : 'Socket') + ' không được: '
            + clip((r && r.error) || 'lỗi không rõ', 90) + ' — sang kênh kế nếu còn', '❌', conv.id);
          // CHUỖI BÙ: kênh kế CHƯA thử (mỗi kênh đúng 1 lần — không lặp kênh vừa thua)
          scheduleBuRetry(conv, text, photo, name,
            'bù ' + (ch === 'ext' ? 'Extension' : 'Socket') + ' không được', triedCh.concat([ch]));
        }
      }).catch((e) => {
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
        logFailGrouped(name, 'bù lỗi: ' + (e && e.message || e), '❌', conv.id);
      });
      /* [v1.92.30] CỔNG CHỨNG MINH VẮNG MẶT — chỉ cho phán quyết SUY LUẬN.
       * Phán quyết là BẰNG CHỨNG (socket chết trước publish, lỗi trước khi bắn) đi thẳng:
       * 0 request, 0 chờ ⇒ giữ nguyên tốc độ cũ. */
      if (!buGated) { actuallySendBu(); return; }
      noteBgPending(conv, 'bu-proof');
      const afterProof = (v) => {
        if (myRun !== runSeq) { clearBgPending(conv.id); return; }
        if (v === 'yes') {
          clearBgPending(conv.id);
          buStats.cancelled++;
          sendDiag.buProofCancelled++;
          markDelivered(conv.id, buVia);
          logFailGrouped(name, 'hội thoại ĐÃ CÓ tin vừa gửi ⇒ tin đã tới nơi, HỦY bù — KHÔNG gửi lần 2 (chặn lặp)', '✅', conv.id);
          updateBatchSummaryUI();
          return;
        }
        if (v === 'absent') logFailGrouped(name, 'chứng minh VẮNG MẶT (hội thoại không đổi sau lúc gửi) ⇒ bù an toàn', '🔎', conv.id);
        else logFailGrouped(name, 'chưa chứng minh được vắng mặt ⇒ bù như cũ (ưu tiên không sót)', '🔎', conv.id);
        actuallySendBu();
      };
      // [v1.92.44] truyền photo: ca có ảnh được dò bằng "hội thoại vừa động" thay vì so chữ
      proveAbsentBeforeBu(conv, text, buSentAt, !!photo).then(afterProof).catch(() => { actuallySendBu(); });
    });
  }

  // Chốt ❌ KHÔNG bù — dùng cho mọi đường fail NGOÀI lỗi API bị từ chối rõ ràng
  // (Socket bị từ chối/không rõ, gửi thẳng fail…): từ v1.91.42, các đường này không
  // được bắn thêm qua kênh khác (nguồn gửi lặp ở lô lớn). Riêng scheduleBuRetry chỉ
  // còn được gọi từ fireApiAndWatch khi API bị FB TỪ CHỐI MINH BẠCH (tin chắc chắn
  // chưa đi — bù qua Ext/Socket không thể gây lặp).
  function chotFailKhongBu(conv) {
    if (!conv) return;
    if (uncertainIds[conv.id] || finalFailedIds[conv.id]) return; // đã có chốt cuối (⚠/❌) — giữ nguyên
    if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
  }

  /* ===== KIỂM CHỨNG SAU KHI SOCKET MẤT ACK (v1.91.44) =====
   * Tại thời điểm mất ACK (noack) không thể phân biệt "tin chưa đi (socket chết ngầm)"
   * với "tin đã đi nhưng gói /ls_resp bị mất" → vẫn chốt ⚠ và cấm bắn lại như cũ.
   * Kiểm chứng chạy NỀN bằng kênh độc lập — đọc lại lịch sử chat qua API:
   *   • Thấy tin của page khớp nội dung + mốc giờ → tin ĐÃ đến nơi (chỉ mất ACK)
   *     → lật ✅ (markDelivered tự sửa số trong TỔNG HỢP, đúng mẫu "ACK trễ").
   *   • Đọc được lịch sử mà KHÔNG thấy tin → tin chắc chắn chưa tới FB (publish rơi
   *     vào socket chết ngầm) → nhả khóa outbound, mở lại chốt ⚠, bù đúng 1 vòng
   *     qua scheduleBuRetry (đủ guard chống trùng như đường bù API).
   *   • Không đọc được lịch sử / thiếu dữ kiện → GIỮ NGUYÊN ⚠, tuyệt đối không bắn mò. */
  const SOCK_VERIFY_DELAY_MS = 1500; // chờ 1.5s sau thời điểm mất ACK (lúc này đã qua 8–15s kể từ publish) rồi đọc lịch sử và bắn cứu ngay nếu chưa có tin
  // sockVerifyPending / sockVerifyFired / verifyStats: khai báo ở vùng sổ nền (cạnh pendingBg)
  // để getBatchSummaryCounts tính được ca đang chờ kiểm chứng vào "pending" giữ lượt.

  function reopenUncertain(convId) {
    if (!convId || !uncertainIds[convId]) return;
    delete uncertainIds[convId];
    summaryCounters.unsure = Math.max(0, summaryCounters.unsure - 1);
    updateBatchSummaryUI();
  }

  function normalizeMsgText(s) {
    return String(s == null ? '' : s)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/div>\s*<div[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;|&apos;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ===== PHÂN XỬ LỊCH SỬ CHAT — 3 KẾT LUẬN, KHÔNG ĐOÁN (v1.91.73) =====
   *   'yes'     : thấy ĐÚNG tin của page (khớp nội dung, hoặc khớp ảnh khi không có chữ)
   *               tạo trong [sentAt-5s, now] → tin ĐÃ tới nơi.
   *   'no'      : đọc được lịch sử VÀ có MỐC NƯỚC — tin mới nhất của cả chat vẫn cũ hơn
   *               sentAt-3s → chưa có gì mới đi ra. Đây là bằng chứng DƯƠNG tính duy nhất
   *               được phép dùng để kết luận "chưa gửi".
   *   'unknown' : mọi trường hợp còn lại (không thấy tin nhưng lịch sử đã có tin mới hơn
   *               sentAt, thiếu mốc giờ, lịch sử lạ…) → KHÔNG kết luận, KHÔNG bù.
   *
   * Hai lỗi của bản cũ đã sửa:
   *   1) FALSE-POSITIVE: dòng "t >= sentAt-2000 && (normMsg || có ảnh)" coi MỌI tin của page
   *      sau sentAt-2s là "đã gửi" — kể cả tin khác nội dung (tin của wave trước, quick reply…)
   *      → chốt ✅ oan, tin thật KHÔNG BAO GIỜ được bù ⇒ mất tin im lặng.
   *   2) FALSE-NEGATIVE: "không thấy tin" bị coi là "chưa gửi" chỉ sau 1 lần đọc ⇒ bù ⇒ LẶP CÂU
   *      khi API lịch sử của Pancake trễ vài giây. Nay 'no' đòi hỏi mốc nước + đọc lặp.
   * minTime vẫn chặn nhìn lùi về lượt trước (chống khớp nhầm tin cũ). */
  /* [v1.92.27] KHỚP ẢNH — thay cho "có attachment là chốt".
   * HAR: attachment trong lịch sử KHÔNG có trường id; chỉ có {type,url} và
   * image_data{width,height} (230 mẫu: image_data 161 · ad 55 · comment 4 · khác 10).
   * Ảnh ta gửi có content_id (đôi khi) + width/height đúng như request gửi đi, nên chỉ chốt khi:
   *   • id khớp (cả hai cùng có), hoặc
   *   • ĐÚNG cặp width×height trong image_data.
   * Không đủ thông tin để khớp ⇒ KHÔNG chốt (để 'unknown' ⇒ giữ ⚠, không bao giờ bắn lại).
   */
  function attachmentMatches(m, photo) {
    const items = photo && (Array.isArray(photo.items) ? photo.items : [photo]);
    if (!Array.isArray(items) || !items.length) return false;
    const ids = [];
    const dims = [];
    for (const p of items) {
      if (!p) continue;
      if (p.id) ids.push(String(p.id));
      const w = Number(p.w) || 0;
      const h = Number(p.h) || 0;
      if (w && h) dims.push(w + 'x' + h);
    }
    if (!ids.length && !dims.length) return false;
    const atts = Array.isArray(m.attachments) ? m.attachments : [];
    for (const a of atts) {
      if (!a) continue;
      if (a.id && ids.indexOf(String(a.id)) > -1) return true;
      const im = a.image_data || a.imageData;
      if (im && dims.length) {
        const key = (Number(im.width) || 0) + 'x' + (Number(im.height) || 0);
        if (dims.indexOf(key) > -1) return true;
      }
    }
    return false;
  }

  /* ===== [v1.92.29] BẰNG CHỨNG DƯƠNG CHO THREAD DÀI =====
   * ĐO TRÊN TOÀN BỘ 12 HAR, đối chiếu chéo 3 cách độc lập:
   *   • GET …/conversations/{id}/messages trả 25 tin **CŨ NHẤT**, sắp TĂNG DẦN — 89/89 response.
   *   • 34 response trả đúng 25 tin: tin mới nhất trong đó cũ hơn lúc đọc TRUNG VỊ 4 330 s
   *     (max ~295 ngày). Ghép `message_count` của list: thread 465 tin → 25 tin trả về chỉ
   *     trải 2 ngày đầu; thread 39 tin → trải 3 ngày đầu.
   *   ⇒ Với thread > 25 tin, tin vừa gửi **KHÔNG BAO GIỜ** nằm trong response ⇒ kiểm chứng
   *     kiểu đọc lịch sử không thể nâng ⚠→✅ (đúng như đo: 0/26 lô 10:39, 0/1 lô 13:42).
   *   • FB **không dội lại** tin page tự gửi qua WebSocket: 14/14 lần gửi không xuất hiện lại
   *     trong 225 khung WS (trong khi tin của khách thì có) ⇒ không có khung ACK nào để bắt.
   * Nguồn DUY NHẤT trong HAR có tin CUỐI:
   *   GET /v1/conversations/customer/{psid}?pages[<pid>]=0
   *   → conversations[] có `snippet` (= tin cuối), `updated_at`, `last_sent_by.id`, `message_count`.
   *   Đo: 2/2 lần gọi đều phản ánh đúng tin vừa gửi, trễ 7,2 / 9,1 / 10,0 s (nhỏ, 1 request).
   * LUẬT: chỉ ĐỌC. Khớp ⇒ nâng ⚠→✅. Không khớp ⇒ giữ ⚠. KHÔNG BAO GIỜ gửi lại từ đây.
   */
  function msgTimeMs(raw) {
    const t = String(raw || '');
    if (!t) return NaN;
    // HAR: inserted_at = "2026-10-19T10:10:19.000000" — UTC, KHÔNG kèm Z, 6 chữ số phần lẻ.
    return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : t + 'Z');
  }
  function newestMsgTimeMs(msgs) {
    let best = 0;
    for (let i = 0; i < (msgs ? msgs.length : 0); i++) {
      const t = msgTimeMs(msgs[i] && msgs[i].inserted_at);
      if (!isNaN(t) && t > best) best = t;
    }
    return best;
  }
  function psidOf(conv, full) {
    const f = full || conv || {};
    const s = String(f.from_psid || f.fromPsid || (f.from && f.from.id) || '');
    if (s) return s;
    const id = String((conv && conv.id) || ''); // pageId_psid
    const i = id.indexOf('_');
    return i > 0 ? id.slice(i + 1) : '';
  }
  // `snippet` bị cắt ~50 ký tự và có thể dính "...." ở cuối ⇒ bỏ đuôi chấm trước khi so.
  function snippetText(s) {
    return normalizeMsgText(s).replace(/[.\u2026\s]+$/, '').trim();
  }
  /* [v1.92.44] CỔNG CHỨNG MINH VẮNG MẶT KHI TIN CÓ KÈM ẢNH.
   * Bản cũ chỉ so `want = text`; ca gửi ảnh kèm chữ (text + photo) mà phía gọi truyền text
   * rỗng hoặc phía nhận chỉ lưu mô tả ảnh ⇒ `normalizeMsgText(want).length < 12`
   * ⇒ `proveAbsentBeforeBu` trả 'unknown' NGAY, không dò gì ⇒ bù mù, gửi lặp.
   * Nay: ca có ảnh được phép dò, và được coi là "đã tới" khi hội thoại vừa động đúng lúc
   * gửi (không so chữ). An toàn: chữ < 12 ký tự vẫn không dùng để kết luận 'yes'. */
  function photoMovedVerdict(convs, convId, pageId, psid, sentAt) {
    if (!Array.isArray(convs) || !convs.length) return 'unknown';
    const at = Number(sentAt) || 0;
    if (!at) return 'unknown';
    const skew = (typeof serverSkewMs === 'number') ? serverSkewMs : 0;
    for (let i = 0; i < convs.length; i++) {
      const c = convs[i];
      if (!c) continue;
      const cid = String(c.id || '');
      const pid = String(c.page_id || (cid.indexOf('_') > 0 ? cid.slice(0, cid.indexOf('_')) : ''));
      if (pageId && pid && pid !== String(pageId)) continue;
      const fromPsid = String(c.from_psid || (c.customers && c.customers[0] && c.customers[0].fb_id) || '');
      const isThis = (cid && convId && cid === String(convId))
        || (fromPsid && psid && fromPsid === String(psid) && (!pageId || pid === String(pageId)));
      if (!isThis) continue;
      const t = msgTimeMs(c.updated_at);
      if (!t || isNaN(t)) continue;
      const by = c.last_sent_by && (c.last_sent_by.id || c.last_sent_by.uid);
      if (by && pageId && String(by) !== String(pageId)) continue;
      /* Hội thoại động ĐÚNG quanh lúc gửi ⇒ tin vừa gửi đã tới.
       * BẤT ĐỐI XỨNG có chủ đích: chỉ nới về TRƯỚC 15 s (đủ bù việc đồng hồ máy lệch và mốc
       * `sentAt` được lấy sớm hơn thời điểm server nhận), còn về SAU thì không giới hạn vì tin
       * gửi xong luôn có `updated_at` MUỘN hơn `sentAt` — chặn cả phía sau sẽ làm cổng vô dụng.
       * Bản nháp đầu tiên dùng ±60 s: SAI, vì tin của LƯỢT GỬI TRƯỚC (cách 50 s) vẫn lọt vào
       * cửa sổ ⇒ cửa sổ này "chứng minh" tin đã tới cho một ca vừa gửi HỎNG ⇒ chốt ✅ oan,
       * đúng bệnh mất tin mà script phải tránh. 15 s hẹp hơn nhịp gửi thật (≥1,2 s/chat nhưng
       * cách nhau hàng chục giây giữa 2 lượt) nên không còn nuốt tin của lượt trước. */
      if (t >= at + skew - 15000) return 'yes';
    }
    return 'unknown';
  }
  function snippetVerdict(convs, convId, pageId, psid, want, sentAt) {
    if (!Array.isArray(convs) || !convs.length) return 'unknown';
    const w = normalizeMsgText(want);
    // Text < 12 ký tự ("Dạ", "Ok") khớp bừa rất dễ ⇒ thà giữ ⚠ còn hơn chốt ✅ oan.
    if (w.length < 12) return 'unknown';
    const at = Number(sentAt) || 0;
    const skew = (typeof serverSkewMs === 'number') ? serverSkewMs : 0;
    for (let i = 0; i < convs.length; i++) {
      const c = convs[i];
      if (!c) continue;
      const cid = String(c.id || '');
      const pid = String(c.page_id || (cid.indexOf('_') > 0 ? cid.slice(0, cid.indexOf('_')) : ''));
      if (pageId && pid && pid !== String(pageId)) continue;      // khác page ⇒ bỏ
      const fromPsid = String(c.from_psid || (c.customers && c.customers[0] && c.customers[0].fb_id) || '');
      const isThis = (cid && convId && cid === String(convId))
        || (fromPsid && psid && fromPsid === String(psid) && (!pageId || pid === String(pageId)));
      if (!isThis) continue;                                      // khác hội thoại ⇒ bỏ
      const sn = snippetText(c.snippet);
      if (!sn) continue;
      const textOk = (sn === w)
        || (sn.length >= 12 && w.indexOf(sn) === 0)               // snippet là phần ĐẦU của text (bị cắt)
        || (w.length >= 12 && sn.indexOf(w) === 0);
      if (!textOk) continue;
      // Tin cuối phải MỚI — nếu không, một tin CÙNG NỘI DUNG gửi hôm trước sẽ bị tính "đã tới".
      // updated_at dùng đồng hồ SERVER (nhanh hơn máy ~5–40 s) ⇒ trừ skew, cho dư 60 s.
      const t = msgTimeMs(c.updated_at);
      if (at && !isNaN(t) && t < at + skew - 60000) continue;
      const by = c.last_sent_by && (c.last_sent_by.id || c.last_sent_by.uid);
      if (by && pageId && String(by) !== String(pageId)) continue; // tin cuối do page/người khác gửi
      return 'yes';
    }
    return 'unknown';
  }
  async function confirmViaSnippet(conv, full, pageId, convId, want, sentAtMs) {
    try {
      const psid = psidOf(conv, full);
      if (!pageId || !psid) return 'unknown';
      if (normalizeMsgText(want).length < 12) return 'unknown';
      const url = apiBase() + '/v1/conversations/customer/' + encodeURIComponent(psid)
        + '?pages[' + encodeURIComponent(pageId) + ']=0';
      const res = await ctxFetchLane(() => fetchJson(url, 1, { timeoutMs: 8000 }));
      if (!res || !res.ok || !res.data || res.data.success === false) return 'unknown';
      const convs = res.data.conversations || (res.data.data && res.data.data.conversations) || [];
      return snippetVerdict(convs, convId, pageId, psid, want, sentAtMs);
    } catch (e) { return 'unknown'; }
  }

  /* ===== [v1.92.30] CỔNG "CHỨNG MINH VẮNG MẶT" TRƯỚC MỌI LẦN BẮN THỨ 2 =====
   * LỖI GỐC CỦA VIỆC LẶP: bù chỉ được phép chạy khi `sent === false`, mà trong code có 6 nguồn trả
   * `sent:false` — chỉ 3 nguồn là BẰNG CHỨNG (tin chưa từng được phát: socket chết trước publish,
   * gate no-gid, upload ảnh lỗi, Ext đang nghỉ hồi sức), còn 3 nguồn là SUY LUẬN:
   *   • Socket `markOptimisticMessageFailed` — khung không nói nó thuộc tin nào;
   *   • Ext `success:false` CÓ kèm lý do — lý do có thể đến từ bước SAU khi chữ đã đi;
   *   • API `success:false` / 4xx — lỗi có thể của bước phụ hoặc của gateway.
   * Ba nguồn đó mà kết luận sai ⇒ bù ⇒ khách nhận 2 tin. Vì vậy: TRƯỚC khi bắn lần 2 cho một
   * phán quyết SUY LUẬN, hỏi thẳng hội thoại 1–2 request (endpoint snippet, trễ đo được 7,2–10,0 s):
   *   'yes'    → tin ĐÃ ở trong hội thoại ⇒ HỦY bù (đây là ca chặn được lặp);
   *   'absent' → chứng minh vắng mặt (hội thoại KHÔNG hề đổi sau lúc gửi ≥ 30 s) ⇒ bù an toàn;
   *   'unknown'→ không chứng minh được ⇒ bù như cũ (ưu tiên KHÔNG SÓT, giữ nguyên hành vi).
   * Toàn bộ chạy ở buProbeLane + bgClock, KHÔNG giữ lane gửi ⇒ tốc độ lô không đổi. */
  /* [v1.92.48] 10 000 → BU_PROOF_NOT_BEFORE_MS: phải đứng SAU cửa sổ nghe ACK (12 000 ms).
   * Đây là "mức 9 chỗ" (mức C) đã được duyệt: cổng không được phán 'absent' khi ACK ✅ còn
   * có thể về, vì phán sớm ⇒ bù Ext ⇒ khách nhận 2 tin. Điều kiện chỉ CHẶT HƠN, không nới. */
  const BU_PROOF_WAIT_MS = 14000;   // = BU_PROOF_NOT_BEFORE_MS (phải khai báo cùng trị số)
  const BU_PROOF_STALE_MS = 30000;  // hội thoại phải im ≥ 30 s trước lúc gửi (dư sức vượt độ trễ 10 s)
  /* [v1.92.48] CỔNG CHỨNG MINH VẮNG MẶT PHẢI ĐỨNG SAU CỬA SỔ NGHE ACK — nếu không nó là
   * ĐƯỜNG SINH TIN TRÙNG DUY NHẤT khi ta vừa nới cửa sổ nghe.
   * Lô 10:01: 101 ca no-ACK ⇒ 101 lần "chứng minh vắng mặt" ⇒ 101 ca bù Ext (log
   * "bù THÀNH CÔNG qua Extension" 101). Với 1.92.48, cửa sổ nghe là 12 000 ms, mà cổng chỉ
   * chờ `BU_PROOF_WAIT_MS = 14 000` ⇒ cổng có thể phán 'absent' khi ACK ✅ vẫn đang trên đường
   * về ⇒ bù Ext ⇒ khách nhận 2 tin. Nay: KHÔNG phán 'absent' trước `sentAt + BU_PROOF_NOT_BEFORE_MS`
   * (= 14 000 ms > cửa sổ nghe 12 000 ms + 2 000 ms biên đồng hồ). Quá mốc đó ⇒ 'unknown'.
   * Đây là điều kiện CHẶT HƠN (bớt bù), không bao giờ làm mất tin: ca 'unknown' giữ ⚠ + vào
   * danh sách gửi tay như cũ. */
  const BU_PROOF_NOT_BEFORE_MS = 14000; // > cửa sổ nghe ACK (12 000) + 2 000 ms biên đồng hồ
  const buProofCache = new Map();   // convId|mốc → { at, promise } — 1 chat chỉ chứng minh 1 lần
  const buProbeLane = makeLane(96); // [v1.92.43b] 32 → 96: cùng lý do trên, đọc lịch sử rất rẻ

  function absenceVerdict(convs, convId, pageId, psid, want, sentAt, late, lateAtMs) {
    if (!Array.isArray(convs) || !convs.length) return 'unknown';
    if (snippetVerdict(convs, convId, pageId, psid, want, sentAt) === 'yes') return 'yes';
    if (!late) return 'unknown'; // dò sớm: "chưa thấy" KHÔNG có nghĩa là "chưa đi" (trễ 7–10 s)
    const at = Number(sentAt) || 0;
    if (!at) return 'unknown';
    const skew = (typeof serverSkewMs === 'number') ? serverSkewMs : 0;
    let hit = null;
    for (let i = 0; i < convs.length; i++) {
      const c = convs[i];
      if (!c) continue;
      const cid = String(c.id || '');
      const pid = String(c.page_id || (cid.indexOf('_') > 0 ? cid.slice(0, cid.indexOf('_')) : ''));
      if (pageId && pid && pid !== String(pageId)) continue;
      const fromPsid = String(c.from_psid || (c.customers && c.customers[0] && c.customers[0].fb_id) || '');
      const isThis = (cid && convId && cid === String(convId))
        || (fromPsid && psid && fromPsid === String(psid) && (!pageId || pid === String(pageId)));
      if (isThis) { hit = c; break; }
    }
    if (!hit) return 'unknown';
    const t = msgTimeMs(hit.updated_at);
    if (!t || isNaN(t)) return 'unknown';
    if (t >= at + skew - BU_PROOF_STALE_MS) return 'unknown'; // hội thoại vừa động ⇒ không dám kết luận
    // [v1.92.48] Không phán "vắng mặt" khi cửa sổ nghe ACK còn đang mở (xem BU_PROOF_NOT_BEFORE_MS)
    if (!(Number(lateAtMs) >= at + BU_PROOF_NOT_BEFORE_MS)) return 'unknown';
    return 'absent';
  }

  /* ═══ [v1.93.14] ĐỌC LỊCH SỬ **TRỰC TIẾP TỪ FACEBOOK** (không qua Pancake) ═══
   * VÌ SAO CẦN — đo được: mọi cổng "chứng minh vắng mặt" hiện tại đều hỏi Pancake
   *   `/v1/conversations/customer/{psid}` (snippet). Đường đó phụ thuộc Pancake ĐÃ ĐỒNG BỘ
   *   tin từ FB về; khi FB đã nhận mà Pancake chưa kéo về thì snippet nói "vắng mặt" SAI.
   *   Đó đúng là nhóm 3 547 ca ⚠ (ACK rejected 3 552 − FB-báo-không-nhận 5).
   * Extension có sẵn đường đọc thẳng FB — `class He` / case `LOAD_FACEBOOK_MESSAGES`:
   *   case"LOAD_FACEBOOK_MESSAGES": { … new He(r.data).init()
   *     .then(({messages, globalId}) => postMessage({type:"LOAD_FACEBOOK_MESSAGES_SUCCESS",
   *                                    taskId, messages, globalId})) … }
   *   async loadFacebookMessages(){ O.isFeatureReady("loadMessages") || await He.preloadDocIds(...);
   *     const a = await this.getGlobalId();              // ← TỰ LẤY gid nếu không truyền
   *     return { messages: (await t.graphqlbatch({batchName:"MessengerGraphQLThreadFetcher",
   *                graphqlQueries: this.getGraphqlQueries(a, this.before)}))[0]
   *                .data.message_thread.messages.nodes, globalId: a } }
   *   getGraphqlQueries(e,t){ const a = O.get(Da,Sa); if(!a) throw `Missing doc_id …`;
   *     return [{doc_id:a, query_params:{id:e, load_messages:!0, message_limit:40, before:t}}] }
   *
   * ⇒ Lợi ích kép:
   *   ① `messages` là tin THẬT trên FB, không phụ thuộc đồng bộ Pancake ⇒ phán 'absent' đúng hơn;
   *   ② `globalId` là gid THẬT của hội thoại — đúng thứ 56 ca "HTTP không có gid" đang thiếu,
   *      và nó đến từ `Ee.init()` (4 nguồn Jt/Zt/rt-st/ge) mà KHÔNG cần `ENABLE_FIND_THREAD_BY_USERNAME`.
   *
   * CHỈ ĐỌC. Không gửi tin, không tạo tin. `message_limit: 40` đủ cho cửa sổ ±vài phút.
   * Hạn chế: cần `[Da,Sa]` doc_id — nếu ext chưa nạp thì reject `Missing doc_id` ⇒ trả ['unknown'].
   * Không đoán, không bịa. */
  /* ═══ [v1.93.14] PHÂN XỬ TIN CỦA `He` (FB trực tiếp) — TRƯỜNG KHÁC HẲN PANCAKE ═══
   * Node do `MessengerGraphQLThreadFetcher` trả (đọc từ `He.findInternalMessage` của ext):
   *   { timestamp_precise: "<ms>",          // ms, phải chia 1e3 rồi parseInt để ra GIÂY
   *     message_sender: { id },             // id NGƯỜI GỬI (page id nếu page gửi)
   *     message: { text },                  // nội dung
   *     blob_attachments: [{ preview: { uri } }] }
   * Khác Pancake: KHÔNG có `inserted_at` ISO, KHÔNG có `from.id`, KHÔNG có `type`, KHÔNG `attachments`.
   * Phép khớp của chính ext (đó là chuẩn, không phải suy đoán):
   *   parseInt(parseInt(m.timestamp_precise)/1e3) == insertedAt     // giây
   *   text.trim() == message.trim()
   *   ${m.message_sender.id} == ${from.id}   (hoặc == globalId khi gửi bằng vai page)
   * Script KHÔNG có `insertedAt` của FB, nên dùng CỬA SỔ THỜI GIAN thay vì khớp giây tuyệt đối,
   * và chỉ nhận tin DO PAGE gửi (`message_sender.id === pageId`).
   * Thiếu trường nào ⇒ 'unknown'. KHÔNG suy diễn 'absent' từ việc không khớp. */
  function fbMessagesVerdict(msgs, pageId, want, photo, sentAtMs) {
    if (!Array.isArray(msgs) || !msgs.length) return 'unknown';
    const at = Number(sentAtMs) || 0;
    /* Lệch đồng hồ: `timestamp_precise` là đồng hồ FB, `sentAtMs` là đồng hồ máy. Script đã đo
     * `serverSkewMs`; dùng nếu có, nếu không thì nới cửa sổ về phía QUÁ KHỨ (không nới tương lai). */
    const skew = (typeof serverSkewMs === 'number') ? serverSkewMs : 0;
    const minT = at + skew - 5000;
    const maxT = at + skew + 120000;   // đồng bộ trễ tối đa; quá mốc này không phải tin của ta
    const norm = String(want || '').trim();
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (!m) continue;
      const tRaw = parseInt(parseInt(m.timestamp_precise) / 1e3);   // ms → giây (đúng như ext)
      if (!tRaw || isNaN(tRaw)) continue;
      const tMs = tRaw * 1000;
      if (tMs < minT || tMs > maxT) continue;
      const sender = m.message_sender && m.message_sender.id;
      if (!sender || String(sender) !== String(pageId)) continue;   // chỉ tin DO PAGE gửi
      if (norm) {
        const txt = (m.message && m.message.text) ? String(m.message.text).trim() : '';
        if (txt && (txt === norm || (norm.length >= 20 && txt.indexOf(norm) > -1))) return 'yes';
        /* chuẩn hoá giống `normalizeMsgText` của Pancake để bắt được khác biệt unicode */
        const t2 = normalizeMsgText(m.message && m.message.text);
        if (t2 && (t2 === normalizeMsgText(norm))) return 'yes';
      } else if (photo) {
        const ba = m.blob_attachments;
        if (Array.isArray(ba) && ba.length > 0) {
          const uri = ba[0] && ba[0].preview && ba[0].preview.uri;
          if (uri) {
            const got = photoNameOf(uri);
            const exp = photo ? photoNameOf(photo.url || photo) : '';
            if (got && exp && got === exp) return 'yes';
          }
          return 'yes';   // có tệp đính kèm, do page gửi, đúng cửa sổ ⇒ đủ
        }
      }
    }
    return 'unknown';
  }
  function photoNameOf(u) {
    try {
      const parts = String(u).split('?')[0].split('/');
      return parts[parts.length - 1] || '';
    } catch (e) { return ''; }
  }

  const fbMsgCache = new Map();
  function fetchFbMessagesDirect(conv, fallback) {
    return Promise.resolve().then(() => {
      const ad = (window.__ExtensionAdapter__ && typeof window.__ExtensionAdapter__.send === 'function')
        ? window.__ExtensionAdapter__ : null;
      if (!ad) return null;
      const fullC = (fallback && fallback.page_id) ? fallback : (peekConv(conv) || conv);
      const pageId = (fullC && (fullC.page_id || fullC.pageId)) || conv.pageId || String(conv.id || '').split('_')[0];
      const threadId = (fullC && (fullC.thread_id || fullC.threadId)) || conv.threadId || '';
      if (!pageId || !threadId || !/^\d+$/.test(String(threadId))) return null;
      const ck = String(pageId) + '|' + String(threadId);
      const hit = fbMsgCache.get(ck);
      if (hit && Date.now() - hit.at < 8000) return hit.promise;
      const entry = { at: Date.now(), promise: null };
      /* `platform: 'facebook'` ⇒ case của ext KHÔNG xoá `customerName` và KHÔNG đổi pageId
       * (`r.data.platform != "instagram_official" && (r.data.customerName = void 0)` — chỉ xoá tên,
       *  không ảnh hưởng). `before: undefined` ⇒ lấy 40 tin MỚI NHẤT. */
      entry.promise = ad.send({
        type: 'LOAD_FACEBOOK_MESSAGES',
        pageId: String(pageId),
        threadId: String(threadId),
        threadKey: (fullC && (fullC.thread_key || fullC.threadKey)) || ('t_' + threadId),
        isBusiness: true,
        platform: 'facebook',
        customerName: (fullC && (fullC.name || fullC.customerName)) || conv.name || '',
        conversationUpdatedTime: (fullC && (fullC.updated_at || fullC.conversationUpdatedTime)) || Date.now(),
        convType: 'INBOX', postId: null, convId: null,
      }, { timeout: 20000 }).then((res) => {
        if (!res || !res.success || !res.data || !Array.isArray(res.data.messages)) return null;
        try { gidStats.fbDirectMessages++; } catch (e) { /* ignore */ }
        /* ═══ [v1.93.14] `globalId` TỪ CHÍNH PHẢN HỒI NÀY = NGUỒN GID THẬT, MIỄN PHÍ ═══
         * `He.getGlobalId()` trả gid của hội thoại (`this.globalId` nếu app truyền vào, nếu không
         * thì `new Ee({…convType:"INBOX"}).init()` — đúng 4 nguồn Jt/Zt/rt-st/ge của ext).
         * Ta ĐÃ trả giá cho lệnh này rồi ⇒ lưu luôn vào sổ gid, khỏi dò lại bằng
         * `GET_GLOBAL_ID_FOR_CONV` (đắt hơn) hay `MAKE_MESSENGER_LINK` (đắt nhất).
         * CHỈ ĐỌC: `window.__botfakeSaveGid__` ghi cache, không gửi tin, không đổi số lệnh gửi. */
        const gid = res.data.globalId;
        if (gid && /^\d+$/.test(String(gid))) {
          try {
            const mapKey = String(pageId) + '_' + String(threadId);
            if (!persistentGidMap[mapKey] && typeof window.__botfakeSaveGid__ === 'function') {
              window.__botfakeSaveGid__(mapKey, String(pageId), String(threadId), String(gid));
              gidStats.fbDirectSavedGid++;
            }
          } catch (eG) { /* ignore */ }
        }
        return res.data;   // { messages:[…], globalId }
      }).catch(() => null);
      fbMsgCache.set(ck, entry);
      if (fbMsgCache.size > 3000) {
        const now = Date.now();
        fbMsgCache.forEach((v, k) => { if (now - v.at > 60000) fbMsgCache.delete(k); });
      }
      return entry.promise;
    });
  }

  async function probeBuVerdict(conv, pageId, convId, want, sentAtMs, late, hasPhoto) {
    try {
      const psid = psidOf(conv, peekConv(conv) || conv);
      if (!psid || !pageId) return 'unknown';
      const url = apiBase() + '/v1/conversations/customer/' + encodeURIComponent(psid)
        + '?pages[' + encodeURIComponent(pageId) + ']=0';
      const res = await buProbeLane(() => fetchJson(url, 1, { timeoutMs: 8000 }));
      if (!res || !res.ok || !res.data || res.data.success === false) return 'unknown';
      const convs = res.data.conversations || (res.data.data && res.data.data.conversations) || [];
      // [v1.92.48] truyền cả MỐC ĐỌC THẬT của lần dò này để cổng không phán sớm
      const v = absenceVerdict(convs, convId, pageId, psid, want, sentAtMs, late, Date.now());
      if (v === 'yes') return v;
      // [v1.92.44] ca có ảnh: chữ ngắn/không khớp được vẫn kết luận được nếu hội thoại vừa động
      if (hasPhoto && photoMovedVerdict(convs, convId, pageId, psid, sentAtMs) === 'yes') return 'yes';
      /* ═══ [v1.93.14] PANCAKE NÓI "CHƯA THẤY" ⇒ HỎI THẲNG FACEBOOK ═══
       * Snippet của Pancake chỉ đúng khi Pancake ĐÃ ĐỒNG BỘ tin từ FB. Trước khi kết luận
       * 'absent' (cho phép bù ⇒ nguy cơ khách nhận 2 tin), đọc thẳng FB 1 lần.
       * Thấy tin ⇒ 'yes' (HỦY bù — đây chính là ca chặn được tin trùng).
       * Không thấy / không đọc được ⇒ giữ nguyên phán quyết cũ của snippet.
       * CHỈ ĐỌC, không gửi. */
      const fbd = await fetchFbMessagesDirect(conv, peekConv(conv) || conv);
      if (fbd && Array.isArray(fbd.messages) && fbd.messages.length) {
        const fbV = fbMessagesVerdict(fbd.messages, pageId, want, hasPhoto ? 'photo' : null, sentAtMs);
        if (fbV === 'yes') { sendDiag.buProofPresent++; sendDiag.fbDirectPresent++; return 'yes'; }
      }
      return v;
    } catch (e) { return 'unknown'; }
  }

  function proveAbsentBeforeBu(conv, text, sentAtMs, hasPhoto) {
    if (!conv || !conv.id) return Promise.resolve('unknown');
    const want = String(text || '');
    /* [v1.92.44] Text < 12 ký tự ("Dạ", "Ok") khớp bừa rất dễ ⇒ không dùng SNIPPET để kết
     * luận. Nhưng trước đây luật này chặn LUÔN cả ca CÓ ẢNH, dù ảnh là bằng chứng độc lập
     * (hội thoại vừa động đúng lúc gửi + do chính page này gửi) ⇒ cổng chống lặp bị vô hiệu
     * ở đúng nhóm tin dễ lặp nhất (gửi ảnh + câu ngắn). Nay ca có ảnh vẫn được dò. */
    if (normalizeMsgText(want).length < 12 && !hasPhoto) return Promise.resolve('unknown');
    const at = Number(sentAtMs) || Date.now();
    const key = conv.id + '|' + Math.round(at / 20000);
    const cached = buProofCache.get(key);
    if (cached) { sendDiag.buProofCached++; return cached.promise; }
    const entry = { at: Date.now(), promise: null };
    entry.promise = (async () => {
      try {
        const fullC = peekConv(conv) || conv;
        const pageId = (fullC && (fullC.page_id || fullC.pageId)) || conv.pageId || String(conv.id).split('_')[0];
        if (!pageId) return 'unknown';
        const v1 = await probeBuVerdict(conv, pageId, conv.id, want, at, false, hasPhoto);
        if (v1 === 'yes') { sendDiag.buProofPresent++; return 'yes'; } // chặn được 1 lần lặp
        const target = at + BU_PROOF_WAIT_MS;
        if (Date.now() < target) await sleepUntil(target, 'bu-proof');
        const v2 = await probeBuVerdict(conv, pageId, conv.id, want, at, true, hasPhoto);
        if (v2 === 'yes') sendDiag.buProofPresent++;
        else if (v2 === 'absent') sendDiag.buProofAbsent++;
        else sendDiag.buProofUnknown++;
        return v2;
      } catch (e) { sendDiag.buProofUnknown++; return 'unknown'; }
    })();
    buProofCache.set(key, entry);
    if (buProofCache.size > 4000) { // dọn bộ nhớ khi lô vài nghìn chat
      const now = Date.now();
      buProofCache.forEach((v, k) => { if (now - v.at > 120000) buProofCache.delete(k); });
    }
    return entry.promise;
  }

  function historyVerdict(msgs, pageId, want, photo, sentAt) {
    /* [v1.92.25] PHÂN XỬ LỊCH SỬ CHỈ CÒN HAI KẾT LUẬN: yes (bằng chứng dương) và unknown.
     * Đã BỎ hẳn kết luận 'no' ("mốc nước rỗng ⇒ chắc chắn chưa đi") vì nó là PHÁN ĐOÁN chứ
     * không phải bằng chứng: nó so inserted_at (đồng hồ server) với publishedAt (đồng hồ máy),
     * mà lệch giữa hai đồng hồ đo được lên tới hàng chục giây; API lịch sử lại trễ vài giây tới
     * vài phút và chỉ trả tin mới sau khi thread được làm mới. Chính kết luận no đó là mắt xích
     * tạo ra chuỗi gửi trùng ở lô 09:46 (§58). Nay "chưa thấy tin" = unknown ⇒ giữ ⚠.
     */
    if (!Array.isArray(msgs) || !msgs.length) return 'unknown';
    const at = Number(sentAt) || 0;
    if (!at) return 'unknown';
    // Hiệu chỉnh lệch đồng hồ đã ĐO (header Date); không đo được thì 0.
    const skew = (typeof serverSkewMs === 'number') ? serverSkewMs : 0;
    const atServer = at + skew;
    const batchStart = ((batchStats && batchStats.startedAt) || at) + skew;
    const minTime = Math.max(batchStart - 3000, atServer - 5000);
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (!m || m.is_removed) continue;
      const rawT = String(m.inserted_at || '');
      if (!rawT) continue;
      // HAR (batmesss/guisot/guikhachcu): inserted_at = "2026-10-19T10:10:19.000000" — UTC
      // KHÔNG kèm Z, 6 chữ số phần lẻ; Date.parse của V8 nhận đúng dạng này (đã kiểm chứng).
      const t = msgTimeMs(rawT);
      if (isNaN(t)) continue;
      if (!m.from || String(m.from.id) !== String(pageId)) continue; // chỉ tin DO PAGE gửi
      // HAR: 1 311 tin lịch sử = 1 305 INBOX + 6 COMMENT. Bình luận KHÔNG phải tin inbox nên
      // không được dùng để chốt "reply_inbox đã gửi".
      if (m.type && String(m.type).toUpperCase() !== 'INBOX') continue;
      if (t < minTime) continue;
      const hasAtt = Array.isArray(m.attachments) && m.attachments.length > 0;
      if (want) {
        const normMsg = normalizeMsgText(m.message);
        // [v1.92.27] KHỚP CHẶT: khớp ĐÚNG (sau chuẩn hoá) luôn là bằng chứng; khớp kiểu "chứa"
        // chỉ nhận khi chuỗi ta gửi đủ dài (≥ 20 ký tự). Nếu không, một tin NGẮN ("Dạ", "Ok")
        // sẽ khớp bừa với tin khác của page ⇒ chốt ✅ oan ⇒ mất tin im lặng.
        if (normMsg && (normMsg === want || (want.length >= 20 && normMsg.indexOf(want) > -1))) return 'yes';
      } else if (hasAtt && attachmentMatches(m, photo)) {
        return 'yes';
      }
    }
    // Không khớp được tin nào ⇒ 'unknown' (KHÔNG kết luận "chưa đi" — xem chú thích đầu hàm).
    return 'unknown';
  }

  // Tương thích chỗ gọi cũ: chỉ coi là "đã tới" khi verdict chắc chắn 'yes'.
  function isMessageDeliveredInHistory(msgs, pageId, want, photo, sentAt) {
    return historyVerdict(msgs, pageId, want, photo, sentAt) === 'yes';
  }

  function scheduleSocketVerify(conv, text, photo, publishedAtMs) {
    if (!conv || !conv.id) return;
    const want = normalizeMsgText(text);
    if (!want && !photo) return;
    if (sockVerifyPending[conv.id]) return; // đã có 1 kiểm chứng đang chờ cho chat này
    if (sockVerifyFired[conv.id] === runSeq) return; // lượt này đã cứu 1 lần rồi — giữ ⚠, không cứu vòng 2
    const myRun = runSeq;
    if (!markSockVerify(conv.id)) return;   // [v1.92.56] đi qua bộ đếm O(1)
    const nm = conv.name || conv.id;
    const sentAt = publishedAtMs || Date.now();
    const verifyDelay = (batchStats && batchStats.total > 50) ? 3000 : SOCK_VERIFY_DELAY_MS;
    const __sockVerifyBody = async () => {
      try {
        if (myRun !== runSeq) return; // đã sang lượt mới — giữ nguyên ⚠ lượt cũ, không bắn lẫn
        if (state.stopRequested) return; // đang dừng — không bắn cứu
        if (deliveredIds[conv.id] || finalFailedIds[conv.id]) return; // kênh khác đã chốt xong
        let f = null;
        try { f = peekConv(conv); } catch (e) { f = null; }
        if (!f || !(f.page_id || f.pageId)) {
          try { f = await ctxFull(conv, {}); } catch (e) { f = null; }
        }
        f = f || conv;
        const pageId = f.page_id || f.pageId || conv.pageId || String(conv.id || '').split('_')[0];
        const convId = f.id || conv.id;
        const custId = String(f.customerId || conv.customerId
          || (f.customers && f.customers[0] && f.customers[0].id)
          || (conv.customers && conv.customers[0] && conv.customers[0].id) || '');
        if (!pageId) { verifyStats.unknown++; return; }
        const url = apiBase() + '/v1/pages/' + pageId
          + '/conversations/' + encodeURIComponent(convId)
          + '/messages?customer_id=' + encodeURIComponent(custId)
          + '&user_view=true&is_new_api=true&separate_pos=true';
        // ===== ĐỌC LẠI NHIỀU LẦN TRƯỚC KHI KẾT LUẬN =====
        // API lịch sử của Pancake trễ vài giây so với thời điểm FB nhận tin qua Socket.
        // Bản cũ đọc ĐÚNG 1 LẦN sau 1.5s (3s với lô >50) rồi kết luận "chưa tới" ⇒ bắn cứu
        // ⇒ tin thật về sau đó ⇒ khách nhận 2 lần (đây chính là "bù gây lặp câu").
        // Nay: chỉ kết luận 'no' khi thấy MỐC NƯỚC RỖNG ở HAI LẦN ĐỌC LIÊN TIẾP, cách nhau
        // vài giây; 'yes' chốt ngay; còn lại giữ ⚠ (không bù).
        let verdict = 'unknown';
        let histTruncatedOld = false; // response đúng 25 tin VÀ tin mới nhất đã cũ ⇒ cửa sổ là ĐẦU thread
        // [v1.91.88] Page đã đánh dấu kênh ACK chết ⇒ Socket gần như chắc chắn KHÔNG giao được
        // (lô 08:19: 0/74 tin tới qua Socket). Vẫn phải kiểm chứng để không bù trùng, nhưng
        // luật "2 lần đọc rỗng liên tiếp" đã đủ ⇒ rút 4 → 2 lần đọc, giảm nửa số request.
        // [v1.92.24] Bỏ nhánh "page ACK chết ⇒ rút còn 2 lần đọc": lần đọc này giờ CHỈ để nâng
        // ⚠ → ✅ (không còn bắn cứu) nên đọc thêm không thể gây trùng, chỉ giúp cứu thêm ca
        // ACK trễ thật. Mọi page đọc cùng số lần.
        const maxReads = (batchStats && batchStats.total > 50) ? 4 : 3;
        /* [v1.92.38] Chạy CỔNG CHỨNG MINH VẮNG MẶT song song với các lần đọc lịch sử.
         * Trước đây cổng chỉ được gọi SAU khi đọc xong (lô >50: đọc 4 lần tới mốc +15 s ⇒ cứu
         * xong ~+19 s). Cổng bắt buộc phải chờ mốc gửi +10 s nên chạy song song thì kết quả về
         * đúng ~+10 s bất kể số lần đọc. Không thêm request: đây chính là request mà cổng vẫn
         * phải gọi sau đó, chỉ khác thời điểm. */
        let proofP = null;
        /* [v1.92.45] CỔNG PHẢI CHẠY SONG SONG NGAY TỪ ĐẦU — đây là gốc của "chờ 1–2 con lâu".
         * Bản cũ khởi động `proofP` MUỘN (bên trong vòng đọc, sau lần đọc đầu) và cổng phải chờ
         * mốc `gửi + 10 s`. Vì vậy tổng thời gian chờ = (3 s + lần đọc 1) + 2 + 4 + 6 = ~15 s
         * rồi MỚI tới hạn 10 s của cổng ⇒ ca xấu nhất ~25–35 s. Trong khi cổng chỉ cần mốc +10 s
         * tính từ `sentAt`: khởi động ngay tại đây thì kết quả về đúng +10 s, độc lập số lần đọc.
         * Không thêm request nào (đó chính là request cổng vẫn sẽ gọi sau). */
        try { proofP = proveAbsentBeforeBu(conv, text, sentAt, !!photo); } catch (eP0) { proofP = null; }
        for (let attempt = 0; attempt < maxReads; attempt++) {
          if (attempt > 0) {
            await sleepUntil(Date.now() + (attempt === 1 ? 2000 : (attempt === 2 ? 4000 : 6000))); // [v1.92.9]
            if (myRun !== runSeq || state.stopRequested) return;
            if (deliveredIds[conv.id] || finalFailedIds[conv.id]) return;
          }
          let res = null;
          try { res = await ctxFetchLane(() => fetchJson(url, 2)); } catch (e) { res = null; }
          if (!res || !res.ok || !res.data || res.data.success === false) {
            if (attempt === 0) {
              logFailGrouped(nm, 'chưa đọc được lịch sử (' + ((res && res.error) || 'lỗi') + ') — thử lại…', '🔎', conv.id);
            }
            continue;
          }
          try {
            const hGid = gidFromPayload(res.data);
            const tid = f.thread_id || f.threadId || conv.threadId || '';
            if (hGid && typeof window.__botfakeSaveGid__ === 'function') {
              window.__botfakeSaveGid__(convId, pageId, tid, String(hGid));
            }
          } catch (e0) { /* ignore */ }
          const msgs = res.data.messages || (res.data.data && res.data.data.messages) || null;
          if (!Array.isArray(msgs)) continue;
          verdict = historyVerdict(msgs, pageId, want, photo, sentAt);
          if (verdict === 'yes') break; // có bằng chứng dương là dừng đọc ngay
          // [v1.92.45] cổng đã khởi động TRƯỚC vòng đọc (xem chú thích phía trên) — không khởi động lại
          // [v1.92.29] Response đúng 25 tin + tin mới nhất đã cũ hơn 60 s ⇒ 25 tin này là ĐẦU
          // thread (HAR: 34 ca như vậy, trung vị cũ hơn 4 330 s) ⇒ đọc thêm chỉ ra đúng 25 tin
          // đó, tốn 2–3 request vô ích. Dừng và chuyển sang kiểm bằng `snippet`.
          if (msgs.length >= 25) {
            const newest = newestMsgTimeMs(msgs);
            if (newest && (Date.now() - newest) > 60000) { histTruncatedOld = true; break; }
          }
        }
        // [v1.92.29] Đường thay thế: 1 request hội thoại của khách → `snippet` = tin CUỐI.
        if (verdict !== 'yes') {
          const snip = await confirmViaSnippet(conv, f, pageId, convId, want, sentAt);
          if (snip === 'yes') {
            // Chốt luôn + thoát, không in thêm dòng "tin ĐÃ đến nơi" cho khỏi 2 dòng/ca.
            verifyStats.found++;
            markDelivered(conv.id, 'socket');
            try { postSendSideEffects(conv); } catch (e) { /* ignore */ }
            logFailGrouped(nm, 'kiểm chứng bằng HỘI THOẠI: snippet = tin vừa gửi, do chính page này gửi — tính ✅ Socket', '🔎', conv.id);
            return;
          }
        }
        if (verdict === 'yes') {
          verifyStats.found++;
          markDelivered(conv.id, 'socket');
          try { postSendSideEffects(conv); } catch (e) { /* ignore */ }
          logFailGrouped(nm, 'kiểm chứng: tin ĐÃ đến nơi (Socket chỉ mất ACK) — tính ✅ Socket', '🔎', conv.id);
          return;
        }
        /* [v1.92.37] KHÔNG ĐƯỢC IM LẶNG ĐỂ MẤT TIN — ca Đinh Thị Loan (lô 3 chat 15:48):
         * Socket bắn → không có ACK → đọc lịch sử 3 lần không thấy → theo luật 1.92.24/25 thì
         * GIỮ ⚠ vĩnh viễn: khách không nhận được gì, script cũng không cứu, người dùng phải
         * gửi tay. Nay đọc thêm **CỔNG CHỨNG MINH VẮNG MẶT** — đúng cổng đang dùng trước mỗi lần
         * bù: dò MUỘN (≥ BU_PROOF_WAIT_MS = 14 s sau lúc gửi) + hội thoại phải IM ≥ 30 s và
         * không đổi so với lúc gửi. Chỉ khi đó mới dám kết luận "tin chưa đi" ⇒ GỬI CỨU 1 LẦN
         * qua kênh KHÁC (Extension), rồi khoá `sockVerifyFired` để không cứu vòng 2.
         * Không chứng minh được ⇒ vẫn giữ ⚠ và đưa vào DANH SÁCH GỬI TAY (không im lặng nữa). */
        let socksProof = 'unknown';
        try { socksProof = await (proofP || proveAbsentBeforeBu(conv, text, sentAt, !!photo)); } catch (ePv) { socksProof = 'unknown'; }
        // Chỉ cứu được khi CÒN kênh khác: bù của script chỉ đi Extension/Socket, mà Socket vừa
        // thất bại ⇒ cần Extension. Không có Extension thì giữ ⚠ (vào danh sách gửi tay),
        // KHÔNG chốt ❌ oan — người dùng vẫn gửi tay được.
        const hasExtNow = !!(window.__ExtensionAdapter__ && typeof window.__ExtensionAdapter__.send === 'function');
        if (socksProof === 'absent') {
          /* [v1.92.62] ĐÂY LÀ CHỖ GÂY "MẤT TIN". Bản 1.92.40 cộng `_st.lost++` cho page ở nhánh
           * này với giả định "không có tin ⇒ Socket làm mất tin". Giả định đó SAI: bước kiểm
           * chứng này chạy cho MỌI ca Socket không có ACK, kể cả ca **khách vắng mặt** — đúng
           * nhóm FB từ chối (log 19:00:54: 4 624 ca). "Hội thoại không đổi" chỉ nói lên khách
           * không trả lời, KHÔNG nói gì về việc Socket có giao được tin hay không.
           * Đo trên log: 5 ca chứng minh vắng mặt thật, nhưng 774 ca bị né Socket ⇒ 2 ca đầu
           * tiên đã gỡ cả page khỏi làn Socket, phần còn lại dồn sang Extension nghẽn.
           * Nay: chỉ đếm `absent` (chẩn đoán). `lostSock` chỉ tăng khi có bằng chứng DƯƠNG về
           * việc Socket đánh rơi tin của chính nó — xem markSocketProofLost(). */
          try {
            const _st = sockRouteOf(pageId);
            if (_st) _st.absent++;
          } catch (eSt3) { /* ignore */ }
        }

        if (socksProof === 'absent' && !hasExtNow) {
          logFailGrouped(nm, 'kiểm chứng: hội thoại KHÔNG có tin nhưng KHÔNG còn kênh gửi (Extension chưa nối) — GIỮ ⚠, vào danh sách gửi tay', '🔎', conv.id);
        }
        /* [v1.93.1] FB ĐÃ BÁO KHÔNG NHẬN ⇒ KHÔNG GỬI CỨU.
         * Log 21/11 19:44: 573/577 ca "chứng minh vắng mặt ⇒ gửi cứu" chính là ca FB vừa trả
         * lời "từ chối nhận tin". Bù vào đó không cứu được tin nào — nó chỉ sinh thêm một lần
         * gửi chắc chắn thất bại, rồi tự đánh ✅ qua ext (xem sổ: sau ✅ ext KHÔNG có dòng nào).
         * Nay: chốt ❌ + vào danh sách gửi tay, KHÔNG bù. Người dùng vẫn thấy chat này. */
        if (socksProof === 'absent' && isFbRejected(conv.id)
            && myRun === runSeq && !state.stopRequested
            && !deliveredIds[conv.id] && !finalFailedIds[conv.id]) {
          fbRejectStats.blockedBu = (fbRejectStats.blockedBu || 0) + 1;
          const _info = fbRejectedIds.get(String(conv.id)) || {};
          /* Dùng ĐÚNG hàm chốt trạng thái có sẵn (nó tự trừ ⚠ rồi cộng ❌, tự chuyển nhóm, tự
           * vẽ lại bảng). Không tự sửa `summaryCounters` bằng tay — đó là cách sinh lệch sổ. */
          try { window.__botfakeTrackStatus__(conv.id, 'fail'); } catch (eTk) {
            if (!finalFailedIds[conv.id]) { finalFailedIds[conv.id] = true; summaryCounters.fail++; }
            if (uncertainIds[conv.id]) { delete uncertainIds[conv.id]; summaryCounters.unsure = Math.max(0, summaryCounters.unsure - 1); }
          }
          /* `__botfakeTrackStatus__(..., 'fail')` GỠ chat khỏi danh sách gửi tay (vì ❌ là kết
           * luận chắc chắn). Nhưng ở CA NÀY ta muốn người dùng thấy: FB báo không nhận, khách
           * nhiều khả năng đã chết ⇒ vẫn đưa vào danh sách để họ tự quyết. */
          noteManualResend(conv.id);
          logFailGrouped(nm, 'FB đã báo KHÔNG NHẬN ĐƯỢC (' + (String(_info.why || '').slice(0, 70) || 'từ chối nhận tin')
            + ') ⇒ KHÔNG gửi cứu — chốt ❌, vào danh sách GỬI TAY', '🚫', conv.id);
          return;
        }
        /* ═══ [v1.93.4] ĐÃ CHỨNG MINH VẮNG MẶT RỒI THÌ ĐỪNG ĐỌC LẠI — ĐUÔI DÀI VÔ ÍCH ═══
         * ĐO ĐƯỢC trên log 21/11 19:44 (4 281 chat): 1 176 dòng 🔎 (4 lượt đọc × 294 ca) mà
         * "Kiểm chứng ACK: đã đến nơi 0 · giữ ⚠ 0 · không kiểm chứng được 0" — tức 0 ca nào
         * được cứu, và 0 ca nào đổi kết luận. Đồng thời 612 dòng 🔁 (ACK muộn = FB TỪ CHỐI) vẫn
         * chạy tiếp vào cổng ⇒ sinh 612 dòng 🛟 + ⏳ + ✅ = 1 836 dòng cuối log.
         * Log 21:05: 430 dòng 🛟 ở đuôi.
         * Nay: ca mà cổng `proveAbsentBeforeBu` đã phán 'absent' (hội thoại không đổi sau ≥14 s,
         * KHÔNG có tin) thì KHÔNG đọc lại lịch sử lần nữa — kết quả đã biết, đọc thêm 4 lượt chỉ
         * tốn request và làm hậu kiểm kéo dài (đuôi 16,1 s ở lô 19:44).
         * Không đổi kết luận: ca đó vẫn KHÔNG được bắn lại (giữ khoá, giữ ⚠/❌ như luồng hiện có).
         * Đây là đường CHỈ ĐỌC ⇒ bỏ nó không thể sinh tin trùng. */
        /* [v1.93.2] CA EXTENSION KHAI SUCCESS: KHÔNG để cổng nội suy biến nó thành ✅.
         * Đã có 1 lượt đọc lịch sử THẬT đang chạy cho chính ca này (scheduleExtTimeoutVerify);
         * nếu cổng ở đây cũng kết luận 'absent' thì có 2 nguồn cùng phán một ca. Giữ ⚠, để lượt
         * đọc thật quyết định (thấy tin ⇒ ✅ · hết lượt không thấy ⇒ ❌). */
        if (socksProof === 'absent' && extClaimSuccess.has(String(conv.id))) {
          verifyStats.held = (verifyStats.held || 0) + 1;
          return;
        }
        if (socksProof === 'absent' && hasExtNow && myRun === runSeq && !state.stopRequested
            && !deliveredIds[conv.id] && !finalFailedIds[conv.id]) {
          sockVerifyFired[conv.id] = runSeq; // khoá: mỗi chat chỉ được cứu 1 lần / lượt
          /* [v1.92.38] KHÔNG gọi reopenUncertain() nữa. Bản 1.92.37 mở lại sổ ⚠ ⇒
           * summaryCounters.unsure-- ⇒ pendingSend = 1 ⇒ bảng TỔNG HỢP bị CHẶN thêm ~11–14 s
           * chỉ để chờ một ca cứu — đúng cái chậm mà 1.92.36 vừa bỏ. Chat này đã CÓ kết luận
           * (⚠) nên cứ để lượt chốt; khi cứu xong thì markDelivered/trackStatus tự chuyển
           * ⚠ → ✅/❌ (cả hai hàm đều trừ unsure trước khi cộng nhóm mới). */
          rescueInFlight[conv.id] = Date.now();
          sockRescueStats.tried++;
          logFailGrouped(nm, 'kiểm chứng: hội thoại KHÔNG có tin (đã chứng minh vắng mặt sau '
            + ((Math.max(0, Date.now() - sentAt)) / 1000).toFixed(1).replace('.', ',')
            + ' s) ⇒ GỬI CỨU 1 lần qua Extension', '🛟', conv.id);
          scheduleBuRetry(conv, text, photo, nm,
            'Socket không có ACK + đã chứng minh hội thoại không có tin', ['socket'],
            { ambiguous: false, fromUncertain: true, via: 'socket', sentAt: sentAt });
          return;
        }
        /* ═══ [v1.93.4] ĐÃ CHỨNG MINH VẮNG MẶT RỒI THÌ ĐỪNG ĐỌC LẠI — ĐUÔI DÀI VÔ ÍCH ═══
         * ĐO ĐƯỢC trên log 21/11 19:44 (4 281 chat): 1 176 dòng 🔎 (4 lượt đọc) nhưng dòng chốt
         * ghi "Kiểm chứng ACK: đã đến nơi 0 · giữ ⚠ 0 · không kiểm chứng được 0" ⇒ 0 ca được cứu.
         * Cùng lúc 612 dòng 🔁 (ACK muộn = FB TỪ CHỐI) chạy tiếp vào cổng ⇒ sinh 612 × (🛟 + ⏳ +
         * ✅) = 1 836 dòng cuối log. Log 21:05: 430 dòng 🛟 ở đuôi.
         * Nay: ca mà cổng đã phán 'absent' (hội thoại KHÔNG đổi sau ≥14 s, không có tin) và
         * KHÔNG được cứu (đã bị chặn 🚫 hoặc không còn kênh) thì KHÔNG đọc lại lịch sử nữa —
         * kết quả đã biết. Giữ ⚠, KHÔNG bắn thêm (đúng luồng cũ).
         * Đặt SAU các cổng quyết định, để không vô hiệu hoá cổng 🚫 của 1.93.1.
         * Đường này CHỈ ĐỌC ⇒ bỏ nó không thể sinh tin trùng, không thể chốt ✅ oan. */
        if (socksProof === 'absent') {
          /* ═══ [v1.93.13] TRƯỚC KHI BỎ CUỘC: ÉP PANCAKE KÉO LẠI TIN TỪ FB ═══
           * Đây đúng là ca "hội thoại KHÔNG có tin" ⇒ nếu FB ĐÃ nhận mà Pancake chưa đồng bộ
           * thì `proveAbsentBeforeBu` sẽ nói 'absent' SAI. Extension có sẵn đường sửa:
           * `Oc.trigger_to_pancake()` → `POST /v1/pages/{pageId}/rescue_mode_inbox {message_ids}`.
           * (xem chú thích đầy đủ ở `rescueInboxMessages`)
           *
           * GIỚI HẠN THẬT: hàm đó cần `message_id` CỦA FB. Script chỉ có id tin Pancake.
           * Vì vậy ở đây chỉ gọi khi TA CÓ id nghi vấn; không có thì thôi (không bịa id,
           * không gọi tràn lan). Dù vậy hàm này KHÔNG gửi tin ⇒ gọi vô hại.
           * Sau khi gọi, đọc lại lịch sử 1 lần nữa: nếu thấy tin ⇒ ✅ thật (không gửi lại). */
          /* Nguồn id THẬT duy nhất script có: `extMsgIdByConv[conv.id]` — sổ ghi `messageId`
           * từ `REPLY_INBOX_PHOTO_SUCCESS` (extension trả `messageId = payload.actions[0].message_id`,
           * xem `parseSuccessResponse`). Đó LÀ id tin trên FB ⇒ dùng được cho `message_ids`.
           * Ca chưa từng đi qua Extension thì không có id ⇒ không gọi (không bịa id). */
          const _rec = extMsgIdByConv[conv.id];
          const _rid = _rec && _rec.messageId && /^\d+$/.test(String(_rec.messageId))
            ? [String(_rec.messageId)] : null;
          if (_rid && _rid.length && !verifyStats.rescued) {
            verifyStats.rescued = 1;
            return Promise.resolve()
              .then(() => rescueInboxMessages(pageId, _rid))
              .then((okRescue) => {
                if (!okRescue) return null;
                return new Promise((res) => {
                  bgClock.wait(1500).then(() => {
                    confirmViaSnippet(conv, f, pageId, convId, want, sentAt)
                      .then((sn2) => res(sn2)).catch(() => res(null));
                  });
                });
              })
              .then((sn3) => {
                if (sn3 === 'yes' && myRun === runSeq && !deliveredIds[conv.id]) {
                  markDelivered(conv.id, 'socket');
                  try { postSendSideEffects(conv); } catch (e) { /* ignore */ }
                  logFailGrouped(nm, 'sau rescue_mode_inbox: hội thoại ĐÃ có tin ⇒ tính ✅ Socket (không gửi lại)', '🔎', conv.id);
                  return;
                }
                verifyStats.held = (verifyStats.held || 0) + 1;
              })
              .catch(() => { verifyStats.held = (verifyStats.held || 0) + 1; })
              .then(() => { try { updateBatchSummaryUI(); } catch (e) { /* ignore */ } });
          }
          verifyStats.held = (verifyStats.held || 0) + 1;
          return;
        }
        // [v1.92.25] Không có bằng chứng dương sau các lần đọc ⇒ GIỮ ⚠. Đây là đường duy nhất
        // còn lại sau khi bỏ 'no' + bỏ "bắn cứu": không bao giờ gửi lại từ kiểm chứng.
        // [v1.92.28] Chỉ tính "giữ ⚠" — trước đây tăng CẢ unknown lẫn held cho cùng một ca
        // nên dòng tổng kết in "giữ ⚠ 5 · không kiểm chứng được 5" trong khi chỉ có 5 ca.
        verifyStats.held = (verifyStats.held || 0) + 1;
        logFailGrouped(nm, 'kiểm chứng: ' + (histTruncatedOld
          ? 'lịch sử chỉ trả 25 tin CŨ NHẤT (thread dài) và hội thoại chưa hiện tin này'
          : 'đọc ' + maxReads + ' lần chưa thấy tin') + ' — GIỮ ⚠, KHÔNG bắn lại (chống trùng)', '🔎', conv.id);
      } catch (e) {
        verifyStats.unknown++;
        logFailGrouped(nm, 'kiểm chứng lỗi (' + (e && e.message || e) + ') — giữ ⚠ như cũ, không gửi lại', '🔎', conv.id);
      } finally {
        clearSockVerify(conv.id); // [v1.92.56] nhả sổ + GIẢM bộ đếm ở mọi lối ra
        // Dù kiểm chứng thấy/không thấy/lỗi cũng phải tính lại pending và
        // nhả nút Đang gửi; thiếu bước này UI treo ở “còn 1 tin đang xác
        // nhận/bù nền” dù ca đó đã được đếm ⚠ từ trước.
        try { updateBatchSummaryUI(); } catch (e) { /* ignore */ }
        try { markSendIdleIfSettled(); } catch (e) { /* ignore */ }
      }
    };
    bgClock.wait(verifyDelay).then(() => { enqueueSockVerify(__sockVerifyBody); });
  }

  // KIỂM CHỨNG SAU KHI EXTENSION TIMEOUT: lệnh Ext đã phát đi nhưng adapter
  // không trả phản hồi. Khác Socket mất ACK, lệnh Ext gốc vẫn có thể nằm trong
  // hàng đợi của Extension và đi sau đó — vì vậy kiểm chứng này CHỈ được phép
  // lật ⚠ thành ✅ khi thấy đúng tin trong lịch sử. Không thấy tin thì vẫn giữ
  // ⚠, không bắn cứu, không mở khóa outbound (tránh trùng tuyệt đối).
  const EXT_VERIFY_DELAY_MS = 20000; // [v1.92.6] adapter timeout nay 2,5–9 s (suy từ p90) → 20 s vẫn dư ~11 s trước khi phân xử
  // [v1.91.78] ĐỌC LẠI THEO NHỊP GIÃN cho ca Extension quá hạn.
  // Log lô 4296 tin: 27 ca kết thúc ở "⚠ bù không rõ kết quả" vì lần đọc DUY NHẤT
  // (sau ~20s) chưa thấy tin — nhưng "chưa thấy" ở 20s KHÔNG phải bằng chứng "chưa đi":
  // server Pancake thường chỉ trả tin mới sau khi thread được làm mới. Nay đọc lại thêm
  // 2 lần ở nhịp giãn (≈+65s, ≈+185s). RÀNG BUỘC: các lần đọc lại CHỈ được lật ⚠ → ✅,
  // không bao giờ bắn lại, không mở khóa gửi ⇒ không thể sinh tin trùng.
  /* [v1.92.43] ĐUÔI XÁC NHẬN BÙ: BỎ LƯỢT DÒ LẠI 120 s.
   * Số đo 2 lô lớn (1.92.42):
   *   lô 7 073 chat : '🧯 Ext quá hạn 623 · kiểm chứng thấy tin 0 · chưa thấy trong lịch sử 516'
   *   lô 13 204 chat: '847 · thấy tin 0 · 822'
   * ⇒ 1 338 ca dò lại (20 s + 45 s + 120 s mỗi ca) CỨU ĐƯỢC 0 chat, nhưng giữ sổ ở trạng thái
   * "chờ xác nhận" tới 3 phút sau khi lô xong. Giữ lại MỘT lượt 45 s (đủ cho adapter chậm p90
   * 8,3 s + hàng đợi) rồi chốt thẳng ⚠ 'Ext quá hạn — chưa thấy tin'. */
  /* ═══ [v1.93.4] BỎ HẲN LƯỢT ĐỌC LẠI 45 s — ĐUÔI XÁC NHẬN DÀI VÔ ÍCH ═══
   * ĐO ĐƯỢC (chính khối chú thích ngay trên, 2 lô lớn 1.92.42):
   *   lô 7 073 chat : Ext quá hạn 623 · kiểm chứng thấy tin 0 · chưa thấy 516
   *   lô 13 204 chat: Ext quá hạn 847 · kiểm chứng thấy tin 0 · chưa thấy 822
   * ⇒ 1 338 ca dò lại (20 s + 45 s + 120 s) CỨU ĐƯỢC 0 chat, nhưng giữ sổ "chờ xác nhận"
   *   tới 3 phút sau khi lô xong. Chú thích trên đã hạ xuống còn MỘT lượt 45 s nhưng vẫn còn
   *   giữ đúng cái lượt 45 s đó — mà chính số đo nói lượt này cứu 0 ca.
   * Người dùng phản ánh "đoạn cuối dài quá, tốn thời gian" (log 19:44: phát lệnh 19,6 s mà tổng
   * 36 s, đuôi 16,1 s; log 21:05: tổng 36 s).
   * NAY: 0 lượt đọc lại. Ca Ext quá hạn kết thúc ở ⚠ ngay sau lượt đọc 20 s như trước đây vẫn
   * làm khi hết lượt — KHÔNG đổi kết luận (vẫn ⚠, không bắn lại), chỉ bỏ thời gian chờ.
   * Đây là đường CHỈ ĐỌC: bỏ nó không thể sinh tin trùng, không thể chốt ✅ oan. */
  const EXT_RECHECK_DELAYS = { 2: 0, 1: 0 };
  /* [v1.93.2] SỔ CHO CA EXTENSION KHAI `success` MÀ CHƯA CÓ BẰNG CHỨNG.
   * `extClaimSuccess`  : convId → true, đang chờ đọc lại lịch sử để xác nhận.
   * `extClaimUnsure`   : convId → true, có ÍT NHẤT một lượt đọc KHÔNG đọc được lịch sử ⇒ KHÔNG
   *                      được chốt ❌ (đó là "máy không biết", không phải "khách chặn").
   * Cả hai chỉ dùng để GHI NHẬN; không đổi số lệnh gửi nào. */
  const extClaimSuccess = new Set();
  const extClaimUnsure = Object.create(null);
  /* [v1.93.2] `claimedOk` = ca Extension báo success nhưng CHƯA có bằng chứng (xem sendViaExtension).
   * Khi đó: đánh ⚠ "chưa xác nhận" ngay, KHÔNG vào danh sách gửi tay (đang đọc lại); hết lượt đọc
   * mà không thấy tin ⇒ chốt ❌ trong `finally` (xem dưới). `recheck` giữ nguyên nghĩa cũ. */
  function scheduleExtTimeoutVerify(conv, text, photo, sentAtMs, roundsLeft, recheck, delayOverride, claimedOk) {
    if (!conv || !conv.id || !sentAtMs) return;
    const want = normalizeMsgText(text);
    if (!want && !photo) return;
    if (deliveredIds[conv.id] || finalFailedIds[conv.id]) return;
    // Đánh ⚠ ngay (chỉ 1 lần, ở lượt đọc đầu) — để bảng TỔNG HỢP và danh sách gửi tay phản ánh
    // đúng "chưa xác nhận", không phải ✅.
    if (claimedOk && !recheck) {
      extClaimSuccess.add(String(conv.id));
      delete extClaimUnsure[String(conv.id)];
      try {
        logFailGrouped(conv.name || conv.id,
          'Extension báo success nhưng KHÔNG có bằng chứng tin đã tới — đánh ⚠, đọc lại lịch sử (không gửi lại)', '⚠', conv.id);
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
      } catch (eCk) { /* ignore */ }
    }
    const myRun = runSeq;
    if (!markExtVerify(conv.id, recheck)) return; // [v1.92.56] đi qua bộ đếm O(1)
    const nm = conv.name || conv.id;
    // [v1.91.79] Chỉ còn 1 lần đọc lại: 3 lượt liên tiếp cho 'thấy tin 0' ⇒ đọc nhiều là vô ích,
    // chỉ tốn request trên máy yếu.
    const left = (typeof roundsLeft === 'number') ? roundsLeft : 1;
    const isRecheck = !!recheck; // lần đọc lại: KHÔNG cộng vào thống kê chốt
    const delayMs = (delayOverride || EXT_VERIFY_DELAY_MS) + Math.floor(Math.random() * 5000); // rải nhịp khi timeout theo cụm
    bgClock.wait(delayMs).then(async () => {
      try {
        if (myRun !== runSeq) return;
        if (state.stopRequested) return;
        if (deliveredIds[conv.id] || finalFailedIds[conv.id]) return;
        let f = null;
        try { f = peekConv(conv); } catch (e) { f = null; }
        if (!f || !(f.page_id || f.pageId)) {
          try { f = await ctxFull(conv, {}); } catch (e) { f = null; }
        }
        f = f || conv;
        const pageId = f.page_id || f.pageId || conv.pageId || String(conv.id || '').split('_')[0];
        const convId = f.id || conv.id;
        const custId = String(f.customerId || conv.customerId
          || (f.customers && f.customers[0] && f.customers[0].id)
          || (conv.customers && conv.customers[0] && conv.customers[0].id) || '');
        if (!pageId) { extTimeoutStats.unknown++; return; }
        const url = apiBase() + '/v1/pages/' + pageId
          + '/conversations/' + encodeURIComponent(convId)
          + '/messages?customer_id=' + encodeURIComponent(custId)
          + '&user_view=true&is_new_api=true&separate_pos=true';
        const res = await ctxFetchLane(() => fetchJson(url, 1, { timeoutMs: 8000 }));
        if (!res || !res.ok || !res.data || res.data.success === false) {
          if (!isRecheck) extTimeoutStats.unknown++;
          extClaimUnsure[String(conv.id)] = true; // [v1.93.2] không đọc được ⇒ không được chốt ❌
          return;
        }
        const msgs = res.data.messages || (res.data.data && res.data.data.messages) || null;
        if (!Array.isArray(msgs)) {
          if (!isRecheck) extTimeoutStats.unknown++;
          extClaimUnsure[String(conv.id)] = true; // [v1.93.2]
          return;
        }
        let found = isMessageDeliveredInHistory(msgs, pageId, want, photo, sentAtMs);
        // [v1.92.29] Thread > 25 tin thì đọc lịch sử không bao giờ thấy tin mới ⇒ kiểm thêm
        // bằng `snippet`. Chỉ nâng ⚠→✅, không bao giờ gửi lại.
        if (!found) found = (await confirmViaSnippet(conv, f, pageId, convId, want, sentAtMs)) === 'yes';
        if (found) {
          extTimeoutStats.found++;
          markDelivered(conv.id, 'ext');
          try { postSendSideEffects(conv); } catch (e) { /* ignore */ }
          logFailGrouped(nm, 'kiểm chứng Ext: tin ĐÃ đến nơi dù Extension không trả phản hồi — tính ✅ Ext', '🔎', conv.id);
          return;
        }
        if (!isRecheck) extTimeoutStats.notFound++;
        // Không log từng ca "chưa thấy" để tránh ngập log khi timeout theo cụm;
        // số tổng nằm ở dòng TỔNG HỢP. Vẫn giữ ⚠ và không bắn lại.
      } catch (e) {
        if (!isRecheck) extTimeoutStats.unknown++;
        extClaimUnsure[String(conv.id)] = true; // [v1.93.2] lỗi đọc ⇒ không được chốt ❌
      } finally {
        clearExtVerify(conv.id, isRecheck); // [v1.92.56] nhả sổ + GIẢM bộ đếm
        /* [v1.93.2] HẾT LƯỢT ĐỌC LẠI MÀ KHÔNG THẤY TIN (ca Extension khai success) ⇒ CHỐT ❌.
         * Người dùng chốt: "tôi bảo chặn là chặn, gửi không được, gửi tay cũng không được".
         * ⇒ Không giữ ⚠, KHÔNG đưa vào danh sách gửi tay. Chỉ chốt khi đã đọc HẾT các lượt và
         * mọi lượt đều đọc ĐƯỢC lịch sử mà không thấy tin (`extTimeoutStats.unknown` không tăng,
         * đánh dấu qua `extClaimUnsure[conv.id]`) — nếu có lượt nào không đọc được thì GIỮ ⚠ để
         * anh tự xem, vì đó là "máy không biết", không phải "khách chặn".
         * KHÔNG gửi thêm lệnh nào: đây chỉ là đường GHI NHẬN kết quả. */
        const _claimKey = String(conv.id);
        if (extClaimSuccess.has(_claimKey)) {
          if (left <= 0 && !deliveredIds[conv.id] && !finalFailedIds[conv.id]
              && !extClaimUnsure[_claimKey]) {
            try {
              extClaimSuccess.delete(_claimKey);
              extTimeoutStats.claimedDenied++;
              if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
              dropManualResend(conv.id); // người dùng: chặn là chặn ⇒ KHÔNG gửi tay
              logFailGrouped(nm,
                'Extension báo success nhưng đọc lại lịch sử KHÔNG thấy tin ⇒ CHỐT ❌ (khách không nhận được — không gửi tay)', '🚫', conv.id);
            } catch (eCd) { /* ignore */ }
          }
        }
        // [v1.91.78] Hẹn lần đọc lại kế tiếp (chỉ đọc, không bắn).
        try {
          if (left > 0 && !state.stopRequested && runSeq === myRun
              && !deliveredIds[conv.id] && !finalFailedIds[conv.id]) {
            // [v1.93.4] `|| 45000` biến 0 thành 45000 ⇒ phải kiểm tra sự tồn tại, không dùng ||.
            const nd = Object.prototype.hasOwnProperty.call(EXT_RECHECK_DELAYS, left) ? EXT_RECHECK_DELAYS[left] : 45000;
            scheduleExtTimeoutVerify(conv, text, photo, sentAtMs, left - 1, true, nd);
          }
        } catch (e1) { /* ignore */ }
        // Ca Ext timeout đã được đếm ⚠ ngay khi timeout; kiểm chứng nền
        // chỉ có thể lật ✅ nếu thấy tin. Khi nó kết thúc mà không thấy
        // tin, vẫn phải tính lại pending để lượt gửi chốt hẳn, không treo
        // UI ở trạng thái đang xác nhận.
        try { updateBatchSummaryUI(); } catch (e) { /* ignore */ }
        try { markSendIdleIfSettled(); } catch (e) { /* ignore */ }
      }
    });
  }

  /* ===== [v1.92.34] HẬU KIỂM CÁC CA CHỐT "1545041 — KHÁCH KHÔNG NHẬN ĐƯỢC" =====
   * Lô 13:38 chốt ❌ 1 089 ca chỉ vì MỘT kênh (Ext) trả 1545041 — mà làn Ext của lô đó gửi
   * 0 thành công, nên "khách chết" và "Ext hỏng" không phân biệt được. Người dùng chốt:
   *   • trong lượt: kết luận NGAY, KHÔNG bù, KHÔNG kiểm chứng (để không bắn lặp);
   *   • sau lô: TỰ ĐỘNG đọc lại lịch sử từng ca — thấy đúng tin ⇒ lật ✅ (kèm postSendSideEffects).
   * Toàn bộ khối này CHỈ ĐỌC: không có lệnh gửi nào ⇒ không thể sinh tin trùng. */
  const DEAD_RECHECK_MAX = 400;        // đọc tối đa 400 ca / lượt (phần dư để lượt sau, khỏi ngập request)
  const DEAD_RECHECK_CONC = 8;         // 8 luồng đọc — chạy SAU lô nên không tranh làn gửi
  const DEAD_RECHECK_DELAY_MS = 25000; // tin vừa đi cần thời gian vào lịch sử
  const deadRecheckQueue = [];
  let deadRecheckRunning = false;
  function queueDeadUserRecheck(conv, text, photo, sentAtMs) {
    try {
      if (!conv || !conv.id) return;
      if (deadRecheckQueue.length >= 5000) return;
      const want = normalizeMsgText(text);
      if (!want && !photo) return;
      deadRecheckQueue.push({ conv: conv, want: want, photo: photo || null, sentAt: Number(sentAtMs) || Date.now() });
    } catch (e) { /* ignore */ }
  }
  async function startDeadUserRecheck() {
    if (deadRecheckRunning || !deadRecheckQueue.length) return;
    deadRecheckRunning = true;
    const myRun = runSeq;
    const list = deadRecheckQueue.slice(0, DEAD_RECHECK_MAX);
    deadRecheckQueue.splice(0, list.length);
    let seen = 0, flipped = 0, unknown = 0;
    try {
      logLine('🔎 HẬU KIỂM ' + list.length + ' ca chốt ❌ vì "1545041 khách không nhận được": đọc lại lịch sử '
        + 'sau ~' + Math.round(DEAD_RECHECK_DELAY_MS / 1000) + 's (CHỈ ĐỌC — không bắn lại; thấy tin ⇒ lật ✅).');
      await bgClock.wait(DEAD_RECHECK_DELAY_MS + Math.floor(Math.random() * 5000));
      const one = async (it) => {
        if (myRun !== runSeq) return;
        try {
          let f = null;
          try { f = peekConv(it.conv); } catch (e0) { f = null; }
          f = f || it.conv;
          const pageId = f.page_id || f.pageId || it.conv.pageId || String(it.conv.id || '').split('_')[0];
          const convId = f.id || it.conv.id;
          const custId = String(f.customerId || it.conv.customerId
            || (f.customers && f.customers[0] && f.customers[0].id)
            || (it.conv.customers && it.conv.customers[0] && it.conv.customers[0].id) || '');
          if (!pageId) { unknown++; return; }
          const url = apiBase() + '/v1/pages/' + pageId
            + '/conversations/' + encodeURIComponent(convId)
            + '/messages?customer_id=' + encodeURIComponent(custId)
            + '&user_view=true&is_new_api=true&separate_pos=true';
          const res = await ctxFetchLane(() => fetchJson(url, 1, { timeoutMs: 8000 }));
          if (!res || !res.ok || !res.data || res.data.success === false) { unknown++; return; }
          const msgs = res.data.messages || (res.data.data && res.data.data.messages) || null;
          if (!Array.isArray(msgs)) { unknown++; return; }
          seen++;
          let found = isMessageDeliveredInHistory(msgs, pageId, it.want, it.photo, it.sentAt);
          if (!found) found = (await confirmViaSnippet(it.conv, f, pageId, convId, it.want, it.sentAt)) === 'yes';
          if (!found) return;
          flipped++;
          markDelivered(convId, 'ext');
          try { postSendSideEffects(it.conv); } catch (e2) { /* ignore */ }
          auditPush('🔎', convId, it.conv.name || '', 'hậu kiểm 1545041: THẤY tin trong lịch sử ⇒ lật ✅ (không gửi lại)');
          logFailGrouped(it.conv.name || convId,
            'hậu kiểm 1545041: tin ĐÃ tới nơi (Ext báo không có mặt nhưng lịch sử có tin) — tính ✅, không gửi lại',
            '🔎', convId);
        } catch (e) { unknown++; }
      };
      let idx = 0;
      const worker = async () => {
        while (idx < list.length && myRun === runSeq) { const it = list[idx++]; await one(it); }
      };
      await Promise.all(Array.from({ length: DEAD_RECHECK_CONC }, () => worker()));
    } catch (e) {
      try { logLine('🔎 HẬU KIỂM 1545041 dừng giữa đường: ' + (e && e.message || e)); } catch (e2) { /* ignore */ }
    } finally {
      deadRecheckRunning = false;
      try {
        logLine('🔎 HẬU KIỂM 1545041 xong: đọc ' + seen + '/' + list.length + ' ca · thấy tin ⇒ lật ✅ '
          + flipped + ' ca · không đọc được/chưa rõ ' + unknown
          + (deadRecheckQueue.length ? ' · còn ' + deadRecheckQueue.length + ' ca để lượt sau' : '')
          + (flipped ? ' — ' + flipped + ' ca này KHÔNG được gửi lại (tin đã có trong lịch sử).'
            : ' — không ca nào có tin ⇒ chốt ❌ "khách không nhận được" là ĐÚNG.'));
      } catch (e3) { /* ignore */ }
    }
  }

  /* ===== KIỂM CHỨNG CA "KHÔNG RÕ KẾT QUẢ" (API timeout / 5xx / mất mạng) =====
   * Trước đây ca này chỉ chốt ⚠ rồi BỎ — tin có thể chưa hề đi (timeout trước khi tới FB)
   * và không bao giờ được bù ⇒ MẤT TIN. Nay kiểm chứng bằng nguồn ĐỘC LẬP (đọc lịch sử):
   *   • 'yes' → tin đã tới → ✅ (ACK trễ)
   *   • 'no'  (mốc nước rỗng 2 lần liên tiếp, đọc sau ≥9s) → chắc chắn chưa đi → bù 1 vòng
   *   • còn lại → GIỮ ⚠, tuyệt đối không bắn mò (chống trùng)
   * Chỉ chạy khi có nội dung để đối chiếu; mỗi chat 1 lần/lượt. */
  const UNCERTAIN_VERIFY_FIRST_MS = 9000; // chờ 9s rồi đọc lần 1 (đủ để tin "đang bay" kịp vào lịch sử)
  const UNCERTAIN_VERIFY_GAP_MS = 7000;   // đọc lần 2 sau 7s — xác nhận mốc nước rỗng
  function scheduleUncertainVerify(conv, text, photo, sentAtMs, why) {
    if (!conv || !conv.id) return;
    const want = normalizeMsgText(text);
    if (!want && !photo) return;
    if (uncertainVerifyPending[conv.id]) return;
    if (deliveredIds[conv.id] || finalFailedIds[conv.id]) return;
    const myRun = runSeq;
    if (!markUncertainVerify(conv.id)) return; // [v1.92.56] đi qua bộ đếm O(1)
    const nm = conv.name || conv.id;
    const sentAt = sentAtMs || Date.now();
    bgClock.wait(UNCERTAIN_VERIFY_FIRST_MS).then(async () => {
      try {
        if (myRun !== runSeq || state.stopRequested) return;
        if (deliveredIds[conv.id] || finalFailedIds[conv.id]) return;
        let f = null;
        try { f = peekConv(conv); } catch (e) { f = null; }
        if (!f || !(f.page_id || f.pageId)) {
          try { f = await ctxFull(conv, {}); } catch (e) { f = null; }
        }
        f = f || conv;
        const pageId = f.page_id || f.pageId || conv.pageId || String(conv.id || '').split('_')[0];
        const convId = f.id || conv.id;
        const custId = String(f.customerId || conv.customerId
          || (f.customers && f.customers[0] && f.customers[0].id)
          || (conv.customers && conv.customers[0] && conv.customers[0].id) || '');
        if (!pageId) return;
        const url = apiBase() + '/v1/pages/' + pageId
          + '/conversations/' + encodeURIComponent(convId)
          + '/messages?customer_id=' + encodeURIComponent(custId)
          + '&user_view=true&is_new_api=true&separate_pos=true';
        let verdict = 'unknown';
        let histTruncatedOld = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt) {
            await sleepUntil(Date.now() + UNCERTAIN_VERIFY_GAP_MS); // [v1.92.9] ngắt được khi Dừng
            if (myRun !== runSeq || state.stopRequested) return;
            if (deliveredIds[conv.id] || finalFailedIds[conv.id]) return;
          }
          let res = null;
          try { res = await ctxFetchLane(() => fetchJson(url, 2)); } catch (e) { res = null; }
          if (!res || !res.ok || !res.data || res.data.success === false) continue;
          const msgs = res.data.messages || (res.data.data && res.data.data.messages) || null;
          if (!Array.isArray(msgs)) continue;
          verdict = historyVerdict(msgs, pageId, want, photo, sentAt);
          if (verdict === 'yes') break; // có bằng chứng dương là dừng đọc ngay
          if (msgs.length >= 25) {
            const newest = newestMsgTimeMs(msgs);
            if (newest && (Date.now() - newest) > 60000) { histTruncatedOld = true; break; }
          }
        }
        if (verdict !== 'yes') {
          if ((await confirmViaSnippet(conv, f, pageId, convId, want, sentAt)) === 'yes') verdict = 'yes';
        }
        if (verdict === 'yes') {
          markDelivered(conv.id, 'api');
          try { postSendSideEffects(conv); } catch (e) { /* ignore */ }
          logFailGrouped(nm, 'kiểm chứng: tin ĐÃ tới (API chỉ trả lời trễ) — tính ✅ API', '🔎', conv.id);
          return;
        }
        // [v1.92.25] Không có bằng chứng dương ⇒ GIỮ ⚠, không bao giờ gửi lại từ kiểm chứng.
        verifyStats.held = (verifyStats.held || 0) + 1; // [v1.92.28] không đếm đôi (xem scheduleSocketVerify)
        logFailGrouped(nm, 'kiểm chứng KHÔNG kết luận được (' + clip(why || 'không rõ', 60) + ') — giữ ⚠, KHÔNG bắn lại (chống trùng)', '🔎', conv.id);
      } catch (e) {
        // kiểm chứng lỗi → giữ nguyên ⚠
      } finally {
        clearUncertainVerify(conv.id); // [v1.92.56] nhả sổ + GIẢM bộ đếm
        try { updateBatchSummaryUI(); } catch (e) { /* ignore */ }
        try { markSendIdleIfSettled(); } catch (e) { /* ignore */ }
      }
    });
  }

  // Nhóm chat theo NỘI DUNG sẽ gửi: chat thuộc câu nào → ĐÚNG chữ của câu đó;
  // chat lẻ (không thuộc câu nào) → câu đang gõ trên ô textarea. Trả về [{text, list}].
  function buildSendGroups(matches, savedLists, typedText) {
    return [{ text: typedText || '', list: (matches || []).slice() }];
  }

  async function readClipboardText() {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        const txt = await Promise.race([
          navigator.clipboard.readText(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard timeout')), 800)),
        ]);
        if (typeof txt === 'string' && txt.trim()) {
          state.lastCopiedText = txt;
          return txt;
        }
      }
    } catch (e) { /* trình duyệt chưa cấp quyền hoặc chặn readText -> dùng bản copy gần nhất trên trang */ }
    return state.lastCopiedText || '';
  }

  /* [v1.92.43] KHOÁ GỬI GIỮA CÁC TAB — chống "tranh nhau gửi".
   * Mỗi tab là một bản script độc lập: mỗi tab mở client Socket riêng, tự dựng làn riêng (192 main
   * + 384/page + 128 Ext) nhưng cùng dùng chung MỘT page Facebook và MỘT hạn mức ACK. Hai tab chạy
   * cùng lúc = 2× làn trên cùng một kênh ⇒ ACK chậm gấp đôi, lane tự hạ, cả hai cùng chậm
   * (đúng dấu hiệu: ACK TB 3 053 ms và lane 384→16 khi người dùng chạy nhiều tab).
   * Nay: tab nào bấm Chạy trước thì giữ khoá (heartbeat 2 s, TTL 6 s); tab khác bị chặn kèm lời
   * nhắn rõ. Bỏ chặn khi thật sự muốn: window.__botfakeAllowMultiTab__(true). */
  const TAB_ID = 'tab_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
  /* [v1.92.43] Khoá TÍNH THEO PAGE: tranh chấp thật nằm ở ACK/làn của TỪNG page. Hai tab mở hai
   * page khác nhau thì KHÔNG đụng nhau (mỗi tab một Socket client, một hạn mức ACK riêng) ⇒ vẫn
   * cho chạy song song. Chỉ chặn khi hai tab cùng một page — đó mới là cảnh 2× làn trên 1 kênh. */
  const SEND_LOCK_KEY_BASE = 'ssb_send_tab_lock_v2';
  const SEND_LOCK_TTL_MS = 6000;
  let sendLockTimer = null;
  let allowMultiTab = false;
  try { window.__botfakeAllowMultiTab__ = (v) => { allowMultiTab = !!v; return allowMultiTab; }; } catch (eMt) { /* ignore */ }
  function sendLockKey() {
    let pid = '';
    try { pid = pageIdFromLocation ? pageIdFromLocation() : ''; } catch (e0) { pid = ''; }
    return SEND_LOCK_KEY_BASE + (pid ? ':' + pid : '');
  }
  function readSendLock() {
    try { return JSON.parse(localStorage.getItem(sendLockKey()) || 'null'); } catch (e) { return null; }
  }
  function writeSendLock() {
    try {
      localStorage.setItem(sendLockKey(), JSON.stringify({
        tab: TAB_ID, at: Date.now(), total: (batchStats && batchStats.total) || 0,
        href: String(location.href || '').slice(0, 120),
      }));
    } catch (e) { /* ignore */ }
  }
  const sleepMs = (ms) => new Promise((res) => setTimeout(res, ms));
  async function acquireSendLock() {
    if (allowMultiTab) return true;
    const cur = readSendLock();
    if (cur && cur.tab !== TAB_ID && (Date.now() - (cur.at || 0)) < SEND_LOCK_TTL_MS) {
      logLine('🛑 TAB KHÁC ĐANG GỬI CÙNG PAGE NÀY (bắt đầu ' + Math.round((Date.now() - (cur.at || 0)) / 1000)
        + 's trước, ' + (cur.total || 0) + ' chat) — không chạy song song: hai tab sẽ tranh cùng '
        + 'một kênh Socket/ACK ⇒ cả hai chậm và dễ nhiễu. Chờ tab kia xong, hoặc '
        + 'window.__botfakeAllowMultiTab__(true) nếu bạn thật sự muốn.');
      return false;
    }
    /* Chống bấm gần như đồng thời ở 2 tab: localStorage KHÔNG có phép "ghi nếu chưa có" (CAS),
     * nên cả hai tab đều ghi được. Cách chắc chắn: ghi → chờ 150 ms → ĐỌC LẠI. Tab nào thấy
     * khoá mang ID của chính mình thì thắng; tab còn lại thấy ID người khác ⇒ nhường. Chỉ một
     * tab chạy được, kể cả khi bấm cách nhau vài mili-giây. */
    writeSendLock();
    await sleepMs(150);
    const chk = readSendLock();
    if (!chk || chk.tab !== TAB_ID) {
      const who = chk && chk.at ? Math.round((Date.now() - chk.at) / 1000) : 0;
      logLine('🛑 Một tab KHÁC vừa giành quyền gửi page này cùng lúc (' + who
        + 's trước) — tab này nhường để không tranh làn. Bấm lại khi tab kia xong.');
      return false;
    }
    if (sendLockTimer) clearInterval(sendLockTimer);
    writePeerPresence(true);
    sendLockTimer = setInterval(() => {
      if (!state.sending) { releaseSendLock(); return; }
      writeSendLock();
      writePeerPresence(true);
    }, 2000);
    return true;
  }
  function releaseSendLock() {
    if (sendLockTimer) { clearInterval(sendLockTimer); sendLockTimer = null; }
    try { writePeerPresence(false); } catch (eP) { /* ignore */ }
    const cur = readSendLock();
    if (cur && cur.tab === TAB_ID) { try { localStorage.removeItem(sendLockKey()); } catch (e) { /* ignore */ } }
  }
  try { window.__botfakeReleaseTabLock__ = releaseSendLock; } catch (eRl) { /* ignore */ }
  /* [v1.92.43] CHIA NGÂN SÁCH SLOT GIỮA CÁC TAB ĐANG GỬI (khác page ⇒ KHÔNG chặn nhau, chỉ chia tải).
   * Người dùng luôn chạy 2 page trên 2 tab. Hai tab không tranh ACK (mỗi page một client Socket),
   * nhưng tranh CPU/network của CÙNG một máy: mỗi tab 192 slot main + 384/page + 128 Ext ⇒ tổng
   * 384 slot main, mỗi slot là một chuỗi promise + fetch + logLine ⇒ main thread quá tải, callback
   * trễ (đúng dòng '🫥 tab ẩn bị bóp … trễ 10 840 lần' của lô 16:11).
   * Nay: tab tự đếm đồng nghiệp đang gửi (presence TTL 8 s) rồi chia đôi/ba ngân sách slot main:
   *   1 tab  → 192 slot   (như cũ)
   *   2 tab  →  96 mỗi tab ⇒ TỔNG vẫn 192, không nặng hơn chạy 1 tab
   *   ≥3 tab →  64 mỗi tab
   * Tab đang bị ẩn (không nhìn thấy) nhường thêm 25 % CPU cho tab đang xem. Đổi tay:
   *   window.__botfakeMainSlotCap__(n)  (0 = tự động). */
  try {
    document.addEventListener('visibilitychange', () => { writePeerPresence(!!state.sending); }, false);
  } catch (eVis) { /* ignore */ }
  const PEERS_KEY = 'ssb_peers_v2';
  const PEER_TTL_MS = 8000;
  let mainCapOverride = 0;
  try { window.__botfakeMainSlotCap__ = (n) => { mainCapOverride = Math.max(0, Number(n) || 0); return mainCapOverride || 'auto'; }; } catch (eCap) { /* ignore */ }
  function readPeerMap() {
    try { return JSON.parse(localStorage.getItem(PEERS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writePeerPresence(running) {
    try {
      const m = readPeerMap();
      const now = Date.now();
      Object.keys(m).forEach((k) => { if (!m[k] || now - (m[k].at || 0) > PEER_TTL_MS) delete m[k]; });
      if (running) m[TAB_ID] = { at: now, pid: (typeof pageIdFromLocation === 'function' ? pageIdFromLocation() : ''), running: true };
      else delete m[TAB_ID];
      localStorage.setItem(PEERS_KEY, JSON.stringify(m));
    } catch (e) { /* ignore */ }
  }
  function peerSendingCount() {
    const m = readPeerMap();
    const now = Date.now();
    let n = 0;
    Object.keys(m).forEach((k) => {
      const v = m[k];
      if (k === TAB_ID || !v) return;
      if (v.running && now - (v.at || 0) < PEER_TTL_MS) n++;
    });
    return n;
  }
  /* ═══ [v1.92.62] BỎ PHÂN LUỒNG GIỮA 2 TAB — mọi tab dùng HẾT slot ═══
   * Người dùng: "bỏ luôn cơ chế phân luồng khi gửi 2 tab đi, cho nó bắn hết tốc lực như trước".
   * Bản 1.92.43b chia slot: tab ẩn chỉ 128/192, 3 tab thì 144/112 — tức TỰ BÓP tốc độ của tab
   * đang gửi khi có tab khác. Log 14:03 cho thấy `main cap 128–96` và log 17:03 bị bóp tương tự,
   * trong khi `wave→cổng` vẫn 4–5 s. Nay: KHÔNG tab nào nhường slot nữa, mỗi tab dùng trọn
   * `WAVE_MAIN_TOTAL_CAP` (192) — chạy 2 tab thì tổng 384, đúng "hết tốc lực".
   * GIỮ LẠI hai thứ KHÔNG liên quan tốc độ:
   *   • khoá chống gửi trùng (`acquireSendLock`) — 2 tab không bao giờ gửi cùng một chat;
   *   • cờ "đang gửi" để tab khác biết (chỉ dùng cho LOG/đếm, không dùng để cắt slot). */
  /* `peersMock`/`tabMock` chỉ dùng cho công cụ kiểm (tools/_check_slots.mjs) — đường chạy thật
   * luôn gọi với 1 tham số nên đọc số tab thật. */
  function computeMainSlotCap(baseCap, peersMock, tabMock) {
    if (mainCapOverride) return { cap: baseCap, peers: 0, hiddenTrim: false, focused: true, override: true };
    let peers = 0;
    if (typeof peersMock === 'number') peers = peersMock;
    else { try { peers = peerSendingCount(); } catch (e) { peers = 0; } }
    /* [v1.92.62] KHÔNG còn nhánh nào giảm `cap` theo số tab, tab ẩn, hay tab không focus.
     * Mỗi tab dùng TRỌN `baseCap` — đúng yêu cầu "bắn hết tốc lực như trước". */
    const focused = tabMock ? tabMock.focused !== false : true;
    return { cap: baseCap, peers, hiddenTrim: false, focused };
  }
  let sendLockPending = false; // chặn bấm đúp TRONG 150 ms chờ kiểm khoá (state.sending chưa bật)
  async function sendToAll() {
    try { markSendIdleIfSettled(); } catch (e0) { /* ignore */ }
    if (state.sending || state.confirmingSend || sendLockPending) return; // chặn bấm đúp / gọi đúp → gửi TRÙNG
    sendLockPending = true;
    try {
      if (!(await acquireSendLock())) return;
    } finally {
      sendLockPending = false;
    }
    if (state.sendListFrozen) {
      logLine('⏳ Danh sách đang được xử lý — chờ lượt gửi/cập nhật hiện tại hoàn tất rồi chạy lượt mới.');
      return;
    }
    // [v1.92.12] KHÔNG gửi khi danh sách còn ĐANG TẢI.
    // Log 14:43:03–14:43:06: người dùng chốt chuỗi chọn (Nguyễn Hằng → Nguyễn Thanh), script
    // bắt đầu quét danh sách, rồi bấm Gửi sau ~1s ⇒ gửi 37 chat trong lúc lượt quét 346 chat
    // còn chạy, quét xong mới in "Không tìm thấy đủ 2 đầu chuỗi" (báo động giả — xem completeRange).
    // Chuỗi chọn lúc đó mới chỉ có PHẦN đầu danh sách ⇒ có thể gửi THIẾU chat so với dải đã chọn.
    // Nay: chờ ĐÚNG sự kiện quét xong (softNotify 'scan-done', không sleep mù) rồi mới chụp danh sách.
    if (state.scanning) {
      state.confirmingSend = true; // khóa bấm đúp trong lúc chờ
      applyRunStopButtons();
      logLine('⏳ Danh sách đang tải dở — chờ tải xong rồi mới chụp đúng danh sách để gửi (tránh gửi thiếu chat)…');
      await waitCond(() => !state.scanning, 'scan-done', 180000);
      state.confirmingSend = false;
      if (state.scanning) {
        applyRunStopButtons();
        logLine('⛔ Danh sách vẫn đang tải — CHƯA gửi. Bấm ⏹ Dừng tải (hoặc chờ) rồi gửi lại.');
        return;
      }
      logLine('▶ Danh sách đã tải xong — dùng đúng lựa chọn sau khi tải để gửi.');
      render();
    }
    /* [v1.92.44] DANH SÁCH THIẾU MỘT PHẦN ⇒ VẪN CHO GỬI PHẦN ĐÃ CHỌN.
     * Bản cũ chặn TOÀN BỘ ở đây: chỉ cần 1 page lỗi là không gửi được chat nào, buộc phải
     * tải lại tới khi hết lỗi. Nhưng "danh sách thiếu" chỉ có nghĩa là CÓ THỂ SÓT chat —
     * nó không làm cho những chat ĐANG ĐƯỢC CHỌN trở nên sai. Người dùng đã nhìn thấy tên
     * và tick từng chat trước khi bấm Chạy.
     * Nguy hiểm thật chỉ nằm ở "chọn tất cả": chọn theo danh sách thiếu ⇒ gửi thiếu người
     * mà tưởng là đủ. Chặn đúng chỗ đó (mode === 'all'), cảnh báo với chuỗi/chat lẻ.
     * Tin không mất: chat nằm ngoài danh sách đã tải thì cũng không nằm trong lựa chọn. */
    if (state.listIncomplete) {
      if (state.mode === 'all') {
        alert('Đang CHỌN TẤT CẢ trên danh sách tải CHƯA ĐẦY ĐỦ nên có thể sót chat.\n'
          + 'Hãy bấm “⚡ Tải danh sách” để tải lại cho đủ, hoặc thu hẹp lựa chọn (Alt+Click chọn chuỗi/từng chat).');
        logLine('⛔ Chặn "chọn tất cả" vì danh sách tải chưa đầy đủ — chọn chuỗi/từng chat thì vẫn gửi được.');
        return;
      }
      const nSel = state.matches.filter((m) => m && m.checked).length;
      const okGo = confirm('Danh sách tải CHƯA ĐẦY ĐỦ (còn page lỗi).\n\n'
        + 'Vẫn gửi ' + nSel + ' chat ĐANG CHỌN?\n'
        + '• Những chat đã chọn vẫn gửi bình thường.\n'
        + '• Chỉ những chat KHÔNG nằm trong danh sách đã tải là không được gửi (không mất tin, chỉ thiếu người).');
      if (!okGo) {
        logLine('⏸ Người dùng hủy gửi vì danh sách chưa đầy đủ.');
        return;
      }
      logLine('🟡 Vẫn gửi ' + nSel + ' chat đã chọn dù danh sách chưa đầy đủ (người dùng đã xác nhận).');
    }
    state.confirmingSend = true;
    // Chốt lần cuối ngay trước hộp xác nhận: kể cả checklist cũ/stale vẫn không đưa ID đã nhớ vào snapshot gửi.
    const selectedSnapshot = state.matches.filter((m) => m && m.checked).map((m) => ({ ...m }));
    if (!selectedSnapshot.length) {
      state.confirmingSend = false;
      applyRunStopButtons();
      alert('Chưa có đoạn chat nào được chọn.\nHãy bấm ⚡ Tải danh sách rồi ☑ Chọn tất cả (hoặc Alt+Click chọn chat).');
      return;
    }
    freezeSendChecklist();
    let sendConfirmed = false;
    let typedText = '';
    const useClipboardMode = state.msgSource === 'clipboard';
    try {
      if (useClipboardMode) {
        const rawClip = await readClipboardText();
        typedText = String(rawClip || '').trim();
        const clipPreviewEl = shadow && shadow.getElementById('ssb-clip-preview-text');
        if (clipPreviewEl) {
          clipPreviewEl.textContent = typedText
            ? ('Nội dung Clipboard vừa đọc: “' + clip(typedText, 120) + '”')
            : '(Clipboard hiện đang trống hoặc chưa cấp quyền đọc Clipboard)';
        }
      } else {
        const msgEl = shadow && shadow.getElementById('ssb-msg');
        typedText = (msgEl && msgEl.value || '').trim() || ((state.quickReply && state.quickReply.text) || '');
      }
      // [v1.92.9] Nhường ĐÚNG một khung hình (rAF) thay vì 20 ms mù — chu kỳ keydown/keyup của Tab
      // xong ở nhịp vẽ kế tiếp, không cần chờ đồng hồ.
      await nextFrame();
      const imgState = state.image || null;
      let targets = selectedSnapshot.slice();
      {
        const seenIds = new Set();
        const uniq = [];
        targets.forEach((m) => {
          if (!seenIds.has(m.id)) { seenIds.add(m.id); uniq.push(m); }
        });
        if (uniq.length !== targets.length) {
          logLine('⚠ Loại ' + (targets.length - uniq.length) + ' dòng trùng lặp trong danh sách gửi');
        }
        targets = uniq;
      }
      if (state.sentIds && state.sentIds.size > 0) {
        const before = targets.length;
        targets = targets.filter((m) => !state.sentIds.has(m.id));
        if (targets.length < before) {
          logLine('⏩ Bỏ qua ' + (before - targets.length) + ' chat đã gửi — chỉ gửi phần còn lại.');
        }
      }
      let sendGroups = buildSendGroups(targets, state.savedLists, typedText);
      const textsAll = sendGroups.map((g) => g.text).filter((t) => t && t.trim());
      if (!textsAll.length && !imgState && !(state.quickReply && state.quickReply.items && state.quickReply.items.length)) {
        if (useClipboardMode) {
          alert('📋 Đang ở chế độ gửi bằng dữ liệu Clipboard nhưng Clipboard hiện đang trống (hoặc chưa cho phép quyền đọc Clipboard).\nHãy copy nội dung tin cần gửi rồi bấm Chạy / phím Tab lại.');
        } else {
          alert('Hãy nhập nội dung câu cần gửi (hoặc chọn ảnh).');
        }
        return;
      }
      const names = targets.slice(0, MAX_NAME_LIST).map((m) => m.name || m.id).join(', ')
        + (targets.length > MAX_NAME_LIST ? ', …' : '');
      const nComment = targets.filter((m) => m.type === 'comment').length;
      const warnComment = nComment
        ? '\n\n⚠ Trong đó ' + nComment + ' chat loại BÌNH LUẬN — sẽ gửi dưới dạng TRẢ LỜI BÌNH LUẬN (công khai dưới bài viết)!'
        : '';
      const imgNote = imgState ? '\n\n📷 Kèm ảnh: ' + (imgState.name || 'ảnh')
        : (state.quickReply && state.quickReply.items && state.quickReply.items.length)
          ? '\n\n⚡ Câu nhanh "' + state.quickReply.shortcut + '" — ' + state.quickReply.items.length + ' ảnh (bắt bằng Alt+Q)' : '';
      const modeTag = useClipboardMode ? ' [📋 TỪ CLIPBOARD]' : ' [📝 CÂU TRÊN GIAO DIỆN]';
      const textNote = textsAll.length > 1
        ? '\n\n📝 ' + textsAll.length + ' nội dung — mỗi câu được gửi đúng chữ đã lưu: '
          + textsAll.map((t) => '“' + clip(t, 40) + '”').join(', ')
        : '';
      if (!confirm('Gửi ' + (textsAll.length > 1 ? textsAll.length + ' nội dung' : (textsAll.length ? '1 câu' + modeTag : 'ảnh'))
        + ' tới ' + targets.length + ' đoạn chat đã chọn?\n\n'
        + (textsAll.length === 1 ? '“' + clip(textsAll[0] || '(chỉ gửi ảnh)', 160) + '”' : '(mỗi câu đúng nội dung đã lưu)')
        + textNote + imgNote + '\n\nNhận: ' + names + warnComment)) return;
      clearHighlightRowsNow();
      sendConfirmed = true;
    } finally {
      state.confirmingSend = false;
      if (!sendConfirmed) {
        unfreezeSendChecklist(selectedSnapshot.map((m) => m.id));
        render();
      }
    }
    if (state.matches.length) {
      clearSelection();
      logLine('🧹 Đã xóa checkbox/chọn chat ngay khi bắt đầu lượt gửi.');
    }
    const imgState = state.image || null;
    let targets = selectedSnapshot.slice();
    {
      const seenIds = new Set();
      const uniq = [];
      targets.forEach((m) => {
        if (!seenIds.has(m.id)) { seenIds.add(m.id); uniq.push(m); }
      });
      targets = uniq;
    }
    if (state.sentIds && state.sentIds.size > 0) {
      targets = targets.filter((m) => !state.sentIds.has(m.id));
    }
    let sendGroups = buildSendGroups(targets, state.savedLists, typedText);

    // ĐÁNH DẤU ĐANG GỬI NGAY từ trước bước lọc: bước lọc tag/tải ảnh có thể chờ API —
    // không chặn đúp ở đây thì bấm lần 2 chạy song song lần 1 (log hiện 2 dòng lọc)
    state.sending = true;
    state.stopRequested = false;
    // [v1.92.32] mỗi lượt gửi có sổ log riêng ⇒ "Copy log/.txt" chỉ ra đúng lượt này
    logAllReset();
    logGroupReset();
    auditReset(); // [v1.92.33] sổ kiểm chứng từng chat cũng tính lại từ đầu mỗi lượt
    // [v1.92.34] NẠP TÊN MỘT LẦN CHO CẢ DANH SÁCH: markDelivered()/watchdog chỉ có convId nên
    // trước đây 2 951 dòng ✅ của lô 13:38 in tên "-" (không truy được ca gửi lặp theo tên).
    // Nạp ở đây là đủ cho mọi kênh (Socket/API/Ext/bù/hậu kiểm) vì tất cả đều qua auditPush.
    try {
      (Array.isArray(targets) ? targets : []).forEach((c) => {
        if (!c || !c.id) return;
        const nm = c.name || c.customerName
          || (c.customers && c.customers[0] && c.customers[0].name) || '';
        if (nm && String(nm) !== String(c.id)) nameById[c.id] = String(nm);
      });
    } catch (eNm) { /* ignore */ }
    try { deadRecheckQueue.length = 0; } catch (eDq) { /* ignore */ }
    // [v1.92.48] sổ ACK phải tính lại từ đầu mỗi lượt (tránh mang "im lặng" của lô trước sang)
    try {
      sockRecentOutcome.length = 0;
      sockRampSkipped = 0; sockRampSkippedTail = 0; sockRampSkippedNoAck = 0;
      Object.keys(pageAckSilentRun).forEach((k) => { delete pageAckSilentRun[k]; });
      Object.keys(pageAckHoldExpired).forEach((k) => { delete pageAckHoldExpired[k]; });
    } catch (eAckRing) { /* ignore */ }
    // [v1.92.35] LÀN SOCKET KHÔNG ĐƯỢC MANG TRẦN CỦA LÔ TRƯỚC.
    // Lô 14:23 kết thúc ở [384×1]; lô 14:28 mở màn đã `lane 384×1` dù ACK p50 của lô trước là
    // 2 449 ms. Vì limit đã bằng trần nên điều kiện `getLimit() < SOCKET_LANE_MAX` sai ngay từ
    // đầu ⇒ C2 (`rampAllowed`) chưa từng được gọi — dòng "bỏ nới lane 0 lần" là 0 vô nghĩa.
    // Nay mỗi lô tự đánh giá lại: p50 lô trước (ackLatRing giữ qua các lô) chưa đủ mẫu hoặc
    // > 1 800 ms ⇒ hạ mọi làn page về BUS_PARALLEL_SOCKET (256) — đúng mức thiết kế; ACK nhanh
    // thì trong lô làn tự leo lại 384. Muốn tắt: đặt LANE_CARRY_CLAMP = false.
    try {
      const LANE_CARRY_CLAMP = true;
      if (LANE_CARRY_CLAMP) {
        /* [v1.92.48] CANH ĐUÔI p95, KHÔNG CANH p50 — cùng lý do như rampAllowed().
         * Lô 10:01 mở màn ở 256 (đúng) nhưng lại leo lên 384 vì p50 1 739 ms lọt cổng 1 800. */
        const p95Prev = sockAckP95();
        const capStart = (!p95Prev || p95Prev > SOCK_RAMP_P95_MAX_MS) ? BUS_PARALLEL_SOCKET : SOCKET_LANE_MAX;
        const clamped = [];
        Object.keys(pageSocketLanes).forEach((pid) => {
          const lane = pageSocketLanes[pid];
          if (!lane || typeof lane.setLimit !== 'function') return;
          const before = lane.getLimit();
          if (before > capStart) { lane.setLimit(capStart); clamped.push(pid + ' ' + before + '→' + capStart); }
        });
        if (clamped.length) {
          logLine('🐢 Làn Socket mang từ lô trước bị hạ về ' + capStart + ': ' + clamped.join(' · ')
            + ' — ' + (p95Prev ? ('ACK p95 lô trước ' + p95Prev + 'ms > ' + SOCK_RAMP_P95_MAX_MS + 'ms')
              : 'chưa đủ mẫu ACK')
            + ' ⇒ lô mới khởi động ở mức an toàn, ACK nhanh thì lane tự leo lại.');
        }
      }
    } catch (eLane) { /* ignore */ }
    if (preloadSelectedTimer) { clearTimeout(preloadSelectedTimer); preloadSelectedTimer = null; }
    preloadSelectedSeq++;
    applyRunStopButtons();
    startKeepAliveAudio();
    batchSkipApi = false;
    windowBlocked = 0;
    try { bgClock.reset(); } catch (e0) { /* ignore */ }
    // trạng thái theo LƯỢT gửi: chat đã đến nơi trong lượt này không bao giờ bị gửi lại;
    // bù của lượt trước đang chờ sẽ tự hủy (runSeq) — không gửi lẫn vào lượt mới
    runSeq++;
    /* [v1.92.56] Sổ đang-chờ-kiểm-chứng cũng phải về 0 mỗi lượt, cùng lúc với các sổ
     * per-run khác ngay dưới đây. TRƯỚC ĐÂY KHÔNG CÓ BƯỚC NÀY ⇒ khoá của lượt cũ
     * (kiểm chứng chưa xong đã bị huỷ) nằm lại vĩnh viễn trong 3 sổ ⇒ bộ đếm (và cả
     * 3 lần quét cũ) ĐẾM CAO hơn thực tế, đồng thời bảng TỔNG HỢP hiện "đang kiểm chứng
     * nền" mãi không về 0. */
    try { resetVerifyPending(); } catch (eVR) { /* ignore */ }
    buRetrySeq = 0;
    Object.keys(buRetryDone).forEach((k) => { delete buRetryDone[k]; });
    Object.keys(deliveredIds).forEach((k) => { delete deliveredIds[k]; });
    Object.keys(claimedSendIds).forEach((k) => { delete claimedSendIds[k]; });
    Object.keys(outboundLock).forEach((k) => { delete outboundLock[k]; });
    // [v1.92.22] buRetryTimer giờ giữ HÀM HUỶ (bgClock.after) — gọi là huỷ, không có id số.
    Object.keys(buRetryTimer).forEach((k) => { try { buRetryTimer[k](); } catch (e0) { /* ignore */ } delete buRetryTimer[k]; });
    sockFiredPending.clear();
    Object.keys(pendingBg).forEach((k) => { delete pendingBg[k]; });
    Object.keys(finalFailedIds).forEach((k) => { delete finalFailedIds[k]; });
    Object.keys(uncertainIds).forEach((k) => { delete uncertainIds[k]; });
    Object.keys(skippedLateIds).forEach((k) => { delete skippedLateIds[k]; });
    Object.keys(spareFbIdPool).forEach((k) => { delete spareFbIdPool[k]; });
    Object.keys(socketRejectStreak).forEach((k) => { delete socketRejectStreak[k]; });
    Object.keys(socketConfirmedDeadStreak).forEach((k) => { delete socketConfirmedDeadStreak[k]; });
    gidHttpCtl.good = 0;
    gidHttpCtl.bad = 0;
    gidHttpCtl.backoffStreak = 0;
    if (ctxFetchLane && typeof ctxFetchLane.setLimit === 'function' && ctxFetchLane.getLimit() < CTX_FETCH_INITIAL) {
      ctxFetchLane.setLimit(CTX_FETCH_INITIAL);
    }
    summaryCounters.okApi = 0;
    summaryCounters.okExt = 0;
    summaryCounters.okSocket = 0;
    summaryCounters.fail = 0;
    summaryCounters.unsure = 0;
    summaryCounters.skipLate = 0;
    batchStats.active = true;
    batchStats.total = 0;
    batchStats.skippedPre = 0;
    batchStats.startedAt = Date.now();
    batchStats.loopFinished = false;
    batchStats.loopFinishedAt = 0; // [v1.92.63] mốc phát xong — dùng cho ân hạn chốt bảng
    batchStats.dispatchEndedAt = 0;
    buStats.ok = 0; buStats.cancelled = 0; buStats.byWhy = {};
    logProgressMark.pct = 0; // [v1.92.31] mốc tiến độ tính lại từ đầu mỗi lượt
    buQuietBudgetNote = 0;
    // [v1.92.30] cổng chống lặp: reset sổ mỗi lượt (cache chứng minh cũng xoá để không dùng
    // kết quả của lượt trước).
    sendDiag.buProofGated = 0; sendDiag.buProofPresent = 0; sendDiag.buProofAbsent = 0;
    sendDiag.buProofUnknown = 0; sendDiag.buProofCached = 0; sendDiag.buProofCancelled = 0;
    try { buProofCache.clear(); } catch (eBp) { /* ignore */ }
    verifyStats.found = 0; verifyStats.held = 0; verifyStats.unknown = 0;
    try {
      manualResendList.length = 0; sockRescueStats.tried = 0;
      try { fbRejectedIds.clear(); } catch (eFbr) { /* ignore */ }
      fbRejectStats.blockedBu = 0;
      /* [v1.92.66] PHẢI xoá cả hai chỉ mục — nếu không, lần note lại CÙNG chat ở lượt sau sẽ bị
       * `manualResendIds.has()` chặn (bỏ sót chat cần gửi tay) hoặc `dropManualResend()` xoá
       * nhầm vị trí. Đây là bẫy im lặng: chỉ lộ ra khi chạy 2 lượt liên tiếp trên cùng máy. */
      try { manualResendIds.clear(); manualResendById.clear(); } catch (eMrIdx) { /* ignore */ }
      Object.keys(rescueInFlight).forEach((k) => delete rescueInFlight[k]);
    } catch (eMr) { /* ignore */ }
    /* [v1.92.49] NGÂN SÁCH DÒ EXT PHẢI RESET MỖI LƯỢT.
     * Lô 11:10:50 (3 chat, API 2 · Socket 1, 0 lỗi) vẫn in nguyên "🛟 Dò Ext cho ca FB từ
     * chối: thử 2 768 · cứu 0" của lô 6 920 chat trước ⇒ con số trên bảng TỔNG HỢP đang là
     * số TÍCH LUỸ, đọc lên hiểu sai hoàn toàn là "lô này vừa dò 2 768 ca". Nay reset như mọi
     * bộ đếm khác; giữ `closed` của lượt trước (nếu Ext đã bị chặn thì không phải dò lại). */
    /* [v1.92.66] Reset `sinceProbe` cùng `tried`: nếu để lại, lượt sau `extFallback1545Allowed()`
     * có thể mở cửa dò lại NGAY ở ca đầu (vì sinceProbe còn ≥ 200 từ lượt trước) — tức cầu dao
     * mất tác dụng đúng lúc cần nhất. `closed`/`closedWhy` GIỮ NGUYÊN (như chú thích 1.92.49). */
    extTry1545.tried = 0; extTry1545.saved = 0; extTry1545.streak = 0; extTry1545.unknown = 0;
    extTry1545.sinceProbe = 0;
    /* [v1.92.50] `photoUpStats` LÀ SỐ TÍCH LUỸ GIỮA CÁC LƯỢT — ĐÃ KIỂM CHỨNG, ĐO RA SAI.
     * Lô 2 413 chat (11:30) in "📷 12 362 ca · TB 1 312 ms · max 9 480 ms · lỗi 0";
     * lô 9 242 chat (11:34) in ĐÚNG Y NGUYÊN 12 362 / 1 312 / 9 480 / 0. Hai lô khác số chat,
     * khác câu, khác ảnh ⇒ không thể trùng cả 4 số. Gốc: `photoUpStats` (dòng 5750) không nằm
     * trong `sendDiag`/`waveDiag` nên vòng reset chung bên dưới KHÔNG chạm tới ⇒ cộng dồn mãi.
     * (Kèm `tailSeen` của bộ đếm đuôi — xem noteBgPending: 9 263 > 9 242 lệnh.)
     *
     * GHI CHÚ ĐÍNH CHÍNH: có một báo cáo trước nói `waveDiag.slot*` cũng tích luỹ — SAI.
     * `waveDiag` đã được reset đủ khoá ở `Object.keys(waveDiag).forEach((k) => { waveDiag[k] = 0; })`
     * (dòng dưới). Vấn đề thật của dòng GIỮ SLOT chỉ là ĐƠN VỊ/ĐỌC SAI (ms/chat bị đọc thành
     * tổng, và "n" bị in mà không nói là số lần giữ slot) ⇒ đã sửa bằng nhãn ở phần in, không
     * cần reset thêm. Giữ reset dưới đây cho chắc, không hại gì. */
    photoUpStats.n = 0; photoUpStats.ms = 0; photoUpStats.max = 0; photoUpStats.fail = 0;
    try { Object.keys(tailSeen).forEach((k) => delete tailSeen[k]); } catch (eTs) { /* ignore */ }
    waveDiag.slotN = 0; waveDiag.slotAcquireMs = 0; waveDiag.slotPrepMs = 0; waveDiag.slotHoldMs = 0;
    extTimeoutStats.timeout = 0; extTimeoutStats.skipped = 0; extTimeoutStats.found = 0;
    extTimeoutStats.notFound = 0; extTimeoutStats.unknown = 0;
    extTimeoutStats.claimedUnverified = 0; extTimeoutStats.claimedDenied = 0;
  extTimeoutStats.fbRetry2 = 0;
    try { extClaimSuccess.clear(); } catch (eCS) { /* ignore */ }
    try { Object.keys(extClaimUnsure).forEach(function (k) { delete extClaimUnsure[k]; }); } catch (eCU) { /* ignore */ }
    extSendCtl.probeInFlight = false; // lượt mới không được kẹt bởi thăm dò của lượt cũ đã dừng
    resetStopSignal(); // [v1.92.9] lượt mới: tín hiệu Dừng phải sống lại
    softNotify('ext-probe');
    resetGidStats();
    // [v1.92.10] FIX HỒI QUY (vào từ 1.92.7): reset cũ đặt MỌI khoá = 0, kể cả apiFetchSamples[].
    // Sau đó timedFetch chạy `sendDiag.apiFetchSamples.push(...)` trong finally ⇒ 0.push KHÔNG phải
    // hàm ⇒ văng ⇒ làn API ném 'Lỗi kênh:' ⇒ mọi tin API bị chấm "không rõ kết quả" rồi chờ kiểm
    // chứng ~10s, dù HTTP 200 và tin ĐÃ tới. Reset nay theo KIỂU: mảng → rỗng, map → mới, số → 0.
    Object.keys(sendDiag).forEach((k) => {
      const cur = sendDiag[k];
      if (k === 'apiStatusCounts' || (cur && typeof cur === 'object' && !Array.isArray(cur))) sendDiag[k] = Object.create(null);
      else if (Array.isArray(cur)) cur.length = 0;
      else sendDiag[k] = 0;
    });
    Object.keys(waveDiag).forEach((k) => { waveDiag[k] = 0; });
    Object.keys(socketPickDiag).forEach((k) => { socketPickDiag[k] = 0; });
    batchStats.finalLogged = false;
    reportExtJob({ phase: 'send', pct: 0, ok: 0, total: 0 }); // sau reset — không bị lượt cũ đổi thành idle
    render();
    // Khởi động warmUpSockets + BATCH_GET_GLOBAL_ID NGAY TỪ ĐẦU (chạy song song với lọc tag + upload ảnh)
    try { warmUpSockets(targets, { forceBatch: true }); } catch (e) { /* ignore */ }
    // [v1.91.75] warmUpSockets(targets) chỉ thấy các chat được đưa vào của lô hiện tại. Với
    // 10k chat trải trên nhiều page, phải quét TOÀN BỘ danh sách để mỗi page đều được nạp
    // BATCH_GET_GLOBAL_ID (1 lệnh/page, idempotent nhờ batchGidPromises/batchGidFetchedPages)
    // TRƯỚC khi làn gửi bắt đầu — thay vì dò lẻ từng chat giữa lúc đang gửi (chậm + đói làn).
    try { prefetchGidsForBatch(sendGroups); } catch (e) { /* ignore */ }


    // Chuẩn bị ảnh (nếu có): upload 1 lần → gắn attachment cho từng page
    let photo = null;
    const fbIdByPage = {};
    const apiFbIdsByPage = {};
    const contentIdByPage = {};
    const qrPhotoByPage = {};
    const qrSel = state.quickReply;
    if (qrSel && Array.isArray(qrSel.items) && qrSel.items.length) {
      // ===== NGUỒN CÂU NHANH (bắt bằng Alt+Q): đúng cách gửi tay — 1 câu lệnh "/" đã gồm cả
      // chữ lẫn ảnh. Ảnh câu nhanh có sẵn content_id của Pancake nên bind fbId chỉ ~30ms/chat
      // (guianh1.har) thay vì ~1,47s/chat khi bind bằng URL (guicau.har). Câu nhanh là dữ
      // liệu của TỪNG page: page nào trong danh sách cũng phải có đúng shortcut này mới
      // được gửi; page thiếu sẽ được báo rõ từng chat ở khâu bắn (không gửi chữ trơ thiếu ảnh).
      logLine('⚡ Dùng câu nhanh "' + qrSel.shortcut + '" (' + qrSel.items.length + ' ảnh) cho lượt này…');
      const qrPages = [];
      targets.forEach((c) => {
        const p = c.pageId || String(c.id || '').split('_')[0];
        if (p && qrPages.indexOf(p) === -1) qrPages.push(p);
      });
      for (const pid of qrPages) {
        if (state.stopRequested) break;
        // Đối chiếu ĐOẠN theo page: page nguồn lấy thẳng parts đã chọn; page khác nạp lại
        // câu nhanh của chính page đó rồi khớp theo shortcut (dữ liệu từng page riêng).
        let parts = null;
        if (pid === qrSel.pageId && Array.isArray(qrSel.parts) && qrSel.parts.length) parts = qrSel.parts;
        if (!parts) {
          const recs = await fetchQuickRepliesForPage(pid);
          const m = recs.map(normalizeQuickReply).filter((q) => q.shortcut === qrSel.shortcut)[0];
          if (m && m.parts && m.parts.length) parts = m.parts;
        }
        const flatItems = parts ? parts.reduce((a, pt) => a.concat(pt.items || []), []) : [];
        if (parts && parts.length && flatItems.length) {
          // Bind trước fbId (reusable) cho TỪNG đoạn có ảnh để kênh API dùng ngay;
          // Socket/Ext vẫn tự bind bản non-reusable riêng khi gửi như cũ.
          const resolvedParts = [];
          for (const pt of parts) {
            const rp = { text: pt.text || '', items: pt.items || [], apiFbIds: [] };
            if (rp.items.length) {
              const bind = await uploadPhotoForPage(pid, { items: rp.items });
              if (bind.ok) rp.apiFbIds = bind.fbIds || [bind.fbId];
            }
            resolvedParts.push(rp);
          }
          const firstIt = flatItems[0];
          qrPhotoByPage[pid] = { items: flatItems, url: firstIt.url, id: firstIt.id, w: firstIt.w || 0, h: firstIt.h || 0, parts: resolvedParts };
          const allFb = resolvedParts.reduce((a, rp) => a.concat(rp.apiFbIds), []);
          apiFbIdsByPage[pid] = allFb;
          fbIdByPage[pid] = allFb[0] || '';
          logLine('⚡ Page ' + pid + ': câu nhanh OK — ' + resolvedParts.length + ' đoạn, ' + flatItems.length + ' ảnh (content_id)');
        } else {
          logLine('⚠ Page ' + pid + ': KHÔNG có câu nhanh "' + qrSel.shortcut + '" — chat thuộc page này sẽ bị bỏ qua kèm log (không gửi thiếu ảnh)');
        }
      }
      photo = { qr: true, shortcut: qrSel.shortcut, items: qrSel.items, parts: (Array.isArray(qrSel.parts) && qrSel.parts.length) ? qrSel.parts : [{ text: qrSel.text || '', items: qrSel.items }], url: qrSel.items[0].url, id: qrSel.items[0].id, w: qrSel.items[0].w || 0, h: qrSel.items[0].h || 0 };
    } else if (imgState && (imgState.file || imgState.url)) {
      if (imgState.file) {
        logLine('☁️ Đang tải ảnh lên Pancake…');
        const up = await uploadContentFile(imgState.file);
        if (!up.ok) {
          logLine('⛔ Không tải được ảnh (' + up.error + ') — HỦY gửi để tránh gửi thiếu ảnh.');
          state.sending = false;
          batchStats.active = false;
          unfreezeSendChecklist();
            reportExtJob({ phase: 'idle' });
          stopKeepAliveAudio();
          render();
          return;
        }
        photo = { url: up.url, id: up.id, fbId: '', w: imgState.w || 0, h: imgState.h || 0 };
        logLine('☁️ Ảnh đã tải lên — đang gắn attachment cho từng page…');
      } else {
        // Ảnh chọn bằng cách click trên giao diện: đã có URL ảnh gốc → gắn attachment
        // cho từng page bằng URL như cũ (không qua bước tải file lên nữa).
        photo = { url: imgState.url, id: '', fbId: '', w: imgState.w || 0, h: imgState.h || 0 };
        logLine('🖼 Dùng ảnh đã chọn trên giao diện — đang gắn attachment cho từng page…');
      }
      const pageIds = [];
      targets.forEach((c) => {
        const p = c.pageId || String(c.id || '').split('_')[0];
        if (p && pageIds.indexOf(p) === -1) pageIds.push(p);
      });
      for (let i = 0; i < pageIds.length; i++) {
        if (state.stopRequested) break;
        let pagePhoto = photo;
        if (!photo.id && photo.url) {
          const cid = await resolveContentIdForPageUrl(pageIds[i], photo.url);
          if (cid) {
            contentIdByPage[pageIds[i]] = cid;
            pagePhoto = Object.assign({}, photo, { id: cid });
          }
        }
        const up2 = await uploadPhotoForPage(pageIds[i], pagePhoto);
        if (up2.ok) {
          fbIdByPage[pageIds[i]] = up2.fbId;
          apiFbIdsByPage[pageIds[i]] = up2.fbIds || [up2.fbId];
          logLine('☁️ Page ' + pageIds[i] + ': gắn ảnh OK' + (contentIdByPage[pageIds[i]] ? ' (content_id)' : ''));
        } else {
          logLine('⚠ Page ' + pageIds[i] + ': không gắn được ảnh (' + up2.error + ') — chat page này sẽ báo lỗi');
        }
      }
    }
    // Gửi theo lượt: hỗ trợ tới 50.000 tin/lượt cho quy mô 20.000–30.000 tin nhắn
    const waveEl = shadow && shadow.getElementById('ssb-wave');
    const gapEl = shadow && shadow.getElementById('ssb-gap');
    const WAVE_SIZE = Math.max(1, Math.min(100000, parseInt((waveEl && waveEl.value) || '200', 10) || 200));
    const gapRaw = parseInt((gapEl && gapEl.value) || '250', 10);
    const WAVE_GAP = isNaN(gapRaw) ? 250 : Math.max(0, Math.min(60000, gapRaw));
    // gửi theo từng nhóm nội dung (câu khác câu → chữ khác chữ)
    sendGroups = buildSendGroups(targets, state.savedLists, typedText);
    // v1.82.5 — cùng 1 chat chỉ nằm 1 nhóm: nếu 2 câu cùng chứa 1 chat thì giữ lần đầu, không bắn 2 lần.
    {
      const seenG = new Set();
      let nDupG = 0;
      sendGroups.forEach((g) => {
        const keep = [];
        (g.list || []).forEach((m) => {
          if (!m || !m.id) return;
          if (seenG.has(m.id)) { nDupG++; return; }
          seenG.add(m.id);
          keep.push(m);
        });
        g.list = keep;
      });
      sendGroups = sendGroups.filter((g) => g.list && g.list.length);
      if (nDupG) logLine('⚠ Loại ' + nDupG + ' chat trùng giữa các câu — mỗi đoạn chat chỉ gửi 1 lần trong lượt.');
    }
    if (!imgState && !photo) {
      const emptyGs = sendGroups.filter((g) => !g.text.trim());
      if (emptyGs.length) {
        const nEmpty = emptyGs.reduce((n2, g) => n2 + g.list.length, 0);
        logLine('⚠ Bỏ ' + nEmpty + ' chat chưa có nội dung (câu rỗng + ô cần gửi trống) — không gửi chữ trống.');
        sendGroups = sendGroups.filter((g) => g.text.trim());
      }
    }
    const totalAll = sendGroups.reduce((n2, g) => n2 + g.list.length, 0);
    waveDiag.waveSize = WAVE_SIZE;
    waveDiag.configuredGapMs = WAVE_GAP;
    // runGroupWaves200 vẫn chạy 1 wave đơn cho lô ≤ WAVE_SIZE; luôn đếm đúng số wave dự kiến.
    waveDiag.plannedWaves = sendGroups.reduce((n2, g) => n2 + Math.ceil(g.list.length / WAVE_SIZE), 0);
    batchStats.total = totalAll;
    batchStats.startedAt = Date.now();
    resetSockRetryBudget(); // [v1.92.26] ngân sách thử lại Socket đo lại từ đầu mỗi lượt
    updateBatchSummaryUI();
    const useWaves = totalAll > WAVE_SIZE;
    logLine(useWaves
      ? '🚀 Bắt đầu gửi ' + totalAll + ' chat THEO WAVE ' + WAVE_SIZE + ' TIN (4 làn chính + 2 làn bù song song)…'
      : '🚀 Bắt đầu gửi ' + totalAll + ' chat (Wave tối đa ' + WAVE_SIZE + ' tin — 4 làn chính + 2 làn bù)…');

    let ok = 0, fail = 0, done = 0, unsure = 0, firedN = 0;
    let lastSpeedLogAt = Date.now();
    // [v1.92.32] cho dòng gộp biết tiến độ hiện tại (chỉ để IN log)
    logGroupCtx = () => (done + '/' + totalAll);
    logGroupReset();
    const quickEl0 = shadow && shadow.getElementById('ssb-quick');
    const quickOn = !!(quickEl0 && quickEl0.checked);
    waveDiag.quickEnabled = quickOn;

    // CÂU NHANH NHIỀU ĐOẠN: gửi từng đoạn theo đúng thứ tự như gửi tay — mỗi đoạn qua
    // sendOne như 1 tin thường. Chưa đoạn nào đến nơi mà lỗi → trả nguyên kết quả để xử lý
    // kênh/bù như 1 tin thường; đã có đoạn đến nơi rồi mới lỗi → chốt ⚠ (uncertain) để
    // TUYỆT ĐỐI không bắn lại từ đầu gây trùng các đoạn đã đi.
    const sendQrParts = async (c, parts, sendOpts) => {
      let sentCount = 0;
      let anyFired = false;
      let lastOk = null;
      for (let i = 0; i < parts.length; i++) {
        if (state.stopRequested) {
          return sentCount
            ? { ok: false, uncertain: true, partialSent: true, error: 'Đã dừng giữa câu nhanh (' + sentCount + '/' + parts.length + ' đoạn đã gửi)' }
            : { ok: false, sent: false, error: 'Đã hủy gửi' };
        }
        const pt = parts[i];
        const pArg = (pt.items && pt.items.length)
          ? { items: pt.items, url: pt.items[0].url, id: pt.items[0].id, fbId: (pt.apiFbIds && pt.apiFbIds[0]) || '', fbIds: pt.apiFbIds || [], w: pt.items[0].w || 0, h: pt.items[0].h || 0 }
          : null;
        // CÂU NHIỀU ĐOẠN: MỌI đoạn đều gửi ĐỒNG BỘ (kể cả đoạn 0) nhưng vẫn giữ dynamicDirect
        // (0ms Fast-Path chọn Socket cho chat ngoài 24h). Đoạn 1+ dùng prioritySocket để phát
        // nối đuôi ngay sau đoạn 0 mà không bị xếp sau hàng đợi của các chat khác.
        const ptOpts = Object.assign({}, sendOpts, {
          quick: sendOpts.quick,
          awaitDirect: true,
          sockFired: false,
          syncMultiPart: true,
          prioritySocket: i > 0,
        });
        if (i > 0) {
          ptOpts.fastOnly = false;
          ptOpts.deferredCtx = null;
          try { sockFiredPending.delete(c.id); } catch (e0) { /* ignore */ }
          releaseOutbound(c.id);
        }
        const rr = await sendOne(c, pt.text || '', pArg, ptOpts);
        if (rr && rr.ok) {
          sentCount++;
          if (rr.fired) anyFired = true;
          lastOk = rr;
          continue;
        }
        if (!sentCount) return rr; // lỗi ngay đoạn đầu (hoặc cần hoãn Ext) — chưa gì đến nơi, xử lý như tin thường
        return {
          ok: false, uncertain: true, partialSent: true,
          error: 'Câu nhanh gửi dở ' + sentCount + '/' + parts.length + ' đoạn — đoạn ' + (i + 1) + ' lỗi (' + ((rr && rr.error) || 'không rõ') + '), không gửi lại từ đầu để tránh trùng',
        };
      }
      return { ok: true, sendBy: (lastOk && lastOk.sendBy) || 'socket', sent: true, fired: anyFired, partsSent: sentCount };
    };

    const sendOneAndLog = async (c, gtext, itemOpts) => {
      const isDeferredPass = !!(itemOpts && itemOpts.deferredCtx);
      // v1.82.5 — khóa cứng 1 chat = 1 lần bắn trong lượt.
      // Làn chậm (deferredCtx) là TIẾP TỤC cùng 1 lần đã khóa ở làn nhanh → được vào.
      // Worker thứ 2 / câu thứ 2 cùng id → bỏ, không bắn thêm (chống gửi 2 lần).
      if (c && c.id && deliveredIds[c.id]) {
        return { ok: true, skippedDup: true, sent: true, sendBy: deliveredIds[c.id] };
      }
      if (c && c.id && claimedSendIds[c.id] && !isDeferredPass) {
        return { ok: true, skippedDup: true, sent: true };
      }
      if (c && c.id) claimedSendIds[c.id] = 1;
      // 🚀 Tối ưu quyết định cho 20.000–30.000 tin:
      // Nếu đang bật Chế độ nhanh (quickOn) và chat ngoài 24h ĐÃ CÓ SẴN global_id thật trong RAM/WebSocket
      // hoặc Socket đang mở → bỏ qua pre-ctx ở ngoài (để resolveGlobalId bên trong tự gọi ensureConvCtx khi cần).
      // Wave 200: không giữ worker để nạp ctx trước riêng lẻ; sendOne/prepareDirectCtx tự lấy dữ liệu thiếu.
      let skipPreCtx = isDeferredPass || !!(itemOpts && itemOpts.wave200Mode);
      if (!skipPreCtx && quickOn && c.type !== 'comment') {
        const full0 = peekConv(c) || c;
        const pid0 = (full0 && (full0.page_id || full0.pageId)) || c.pageId || String(c.id || '').split('_')[0];
        const idleDiff0 = getConvIdleMs(c, full0);
        const isIdleLong0 = !isNaN(idleDiff0) && idleDiff0 > 86400000;
        if (!isIdleLong0 || idleDiff0 > 7 * 86400000 || isPageSocketReady(pid0) || peekFastGlobalId(c, full0, '')) {
          skipPreCtx = true;
        }
      }
      const _tPrep0 = Date.now();
      if (!skipPreCtx) {
        await ensureConvCtx(c);
      }
      { const _p = Date.now() - _tPrep0; if (_p > 0) { try { waveDiag.slotPrepMs += _p; } catch (eS2) { /* ignore */ } } }
      const sendOpts = {
        quick: quickOn,
        awaitDirect: true,
        fastOnly: !!(itemOpts && itemOpts.fastOnly),
        deferredCtx: (itemOpts && itemOpts.deferredCtx) || null,
        wave200Mode: !!(itemOpts && itemOpts.wave200Mode),
        isSocketRetryPass: !!(itemOpts && itemOpts.isSocketRetryPass),
        // 🔥 [FIX-TỐC-ĐỘ] Bật bắn-nhả: worker chỉ giữ ~6ms (pace + publish), ACK do firedCb xử lý nền.
        // Không bật → 96 slot × (1/2,5s ACK) = 38 tin/s trần cứng. Bật → pace là limiter (~250/s/page).
        // Vẫn giữ chống trùng qua sockFiredPending + outboundLock. ACK rejected → tự bù qua scheduleBuRetry.
        sockFired: true,
      };
      let r;
      if (photo) {
        const p = c.pageId || String(c.id).split('_')[0];
        const qrPage = photo.qr ? qrPhotoByPage[p] : null;
        if (photo.qr && !qrPage) {
          // page này không có câu nhanh đang chọn → KHÔNG gửi chữ trơ (thiếu ảnh), báo rõ từng ca
          done++;
          fail++;
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'fail');
          logLine('❌ [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — page này chưa có câu nhanh "' + photo.shortcut + '" nên không gửi (tránh thiếu ảnh)');
          setProgress(done, totalAll);
          return { ok: false, sent: false, error: 'Page chưa có câu nhanh đã chọn' };
        }
        const multiParts = (qrPage && Array.isArray(qrPage.parts) && qrPage.parts.length > 1) ? qrPage.parts : null;
        if (multiParts) {
          // Câu nhanh NHIỀU ĐOẠN → gửi từng đoạn lần lượt theo đúng thứ tự của câu lệnh
          r = await sendQrParts(c, multiParts, sendOpts);
        } else {
          const photoArg = photo.qr
            ? { items: qrPage.items, url: qrPage.url, id: qrPage.id, fbId: fbIdByPage[p] || '', fbIds: apiFbIdsByPage[p] || [], w: qrPage.w || 0, h: qrPage.h || 0 }
            : { url: photo.url, id: photo.id || contentIdByPage[p] || '', fbId: fbIdByPage[p] || '', w: photo.w, h: photo.h };
          const fbId = photoArg.fbId || '';
          if (!fbId && c.type === 'comment') {
            done++;
            fail++;
            if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'fail');
            logLine('❌ [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — không có attachment ảnh cho page này');
            setProgress(done, totalAll);
            return { ok: false, sent: false, error: 'Không có attachment ảnh' };
          }
          r = await sendOne(c, gtext, photoArg, sendOpts);
        }
      } else {
        r = await sendOne(c, gtext, null, sendOpts);
      }
      // Nếu đang ở Làn Nhanh (fastOnly) mà chat này cần hỏi Extension / gửi qua Extension → đẩy sang hồ nền
      // extBacklogQueue mà chưa tăng done, giúp worker của Làn Nhanh giải phóng ngay ở 0ms!
      if (r && (r.deferredToExt || r.deferredToSocketRetry)) {
        return r;
      }
      /* [v1.92.44] "ĐÃ BỊ CHẶN VÌ TRÙNG" KHÔNG PHẢI "ĐÃ GỬI".
       * `dupBlockedResult()` trả `{ ok:true, sent:true, fired:true, dupBlocked:true }` (đúng:
       * nó KHÔNG bắn gì, chỉ báo "chat này đã có lệnh bay rồi"). Nhưng sendOneAndLog chỉ nhìn
       * `r.ok` ⇒ tăng `ok++`, `firedN++`, gọi `noteBgPending()` và đẩy vào bảng TỔNG HỢP như
       * một lệnh gửi thật. Ca bị chặn vì trùng (2 worker cùng chat sau khi mở khoá outbound,
       * hoặc bù chồng lên ca đang bay) vì thế bị đếm "đã phát" ⇒ số liệu lệch và dòng
       * "đã gửi" có thể hiện cho chat CHƯA hề được bắn ở lượt này. Nay đếm riêng. */
      if (r && r.dupBlocked) {
        sendDiag.dupBlocked = (sendDiag.dupBlocked || 0) + 1;
        done++;
        logFailGrouped((c.name || c.id),
          'đã có lệnh gửi bay cho chat này trong lượt — KHÔNG bắn thêm (chống trùng)', '✓', c.id);
        return r;
      }
      if (r && r.recipientUnavailable) sendDiag.recipientUnavailable++;
      if (itemOpts && (itemOpts.isSocketRetryPass || itemOpts.isExtBacklogPass)) clearBgPending(c.id);
      const via = r.ok ? (r.sendBy === 'direct' ? ' — gửi thẳng Socket/Ext'
        : r.sendBy === 'socket' ? ' — qua Socket'
        : r.sendBy === 'extension' ? ' — qua Extension' : '') : '';
      done++;
      if (r.ok) {
        ok++;
        // fired = chỉ ĐÃ BẮN request — CHƯA xác nhận server nhận. Đánh dấu "đã đến nơi" cho
        // kết quả fired sẽ chặn nhầm bước bù nền → "báo gửi nhưng không gửi gì" (bug v1.39.0).
        // Chỉ đánh dấu khi kênh XÁC NHẬN thành công thật (kể cả xác nhận nền — fireApiAndWatch).
        if (!r.fired) { markDelivered(c.id, r.sendBy || 'api'); postSendSideEffects(c); }
        if (r.fired) { firedN++; noteBgPending(c, r.sendBy); } // vào sổ watchdog — quá 90s tự chốt, không kẹt
        // [v1.92.31] KHÔNG in từng dòng "đã gửi" nữa — chỉ in mốc tiến độ (xem logProgress).
        // [v1.92.35] `ok` ở đây là "đã phát" (ca fired chưa có ACK) ⇒ KHÔNG dùng để báo thành công.
        const cOkNow = confirmedOkCount();
        logProgress(done, totalAll, cOkNow, unsure, fail, Math.max(0, done - cOkNow - unsure - fail));
      } else if (r.gated) {
        // [v1.92.30] Phán đoán sai (không phải bằng chứng) ⇒ cổng chứng minh vắng mặt đang chạy
        // ở làn riêng. Vẫn tính ⚠ (để sổ sách đúng) và vẫn ghi uncertainIds — cổng có quyền đi
        // xuyên qua chốt đó vì nó dựa trên BẰNG CHỨNG, không phải phán đoán.
        unsure++;
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'uncertain');
        logFailGrouped((c.name || c.id), r.error, '🔎', c.id);
      } else if (r.definiteFail || (r.uncertain && r.definitiveNotSent)) {
        /* [v1.92.45] CHẮC CHẮN KHÔNG GỬI ĐƯỢC THÌ ĐỪNG BẮT NGƯỜI DÙNG CHỜ.
         * Trước bản này, ca FB trả lời dứt khoát "khách không nhận được / ngoài cửa sổ 24h /
         * thread do app khác giữ / 1545012 lỗi tạm thời" vẫn bị xếp vào diện "không rõ" ⇒ vào
         * cổng chứng minh vắng mặt 10 s (+ có khi đọc lại 45 s). Lô 100 chat phát xong ~5 s mà
         * bảng TỔNG HỢP treo thêm 10–35 s chỉ để chờ đúng những ca đã biết là không đi.
         * Nay chốt ⚠ NGAY (vẫn KHÔNG phải ✅ nên không báo oan là đã gửi; vẫn vào danh sách gửi
         * tay để người dùng bấm được). Chỉ đúng những ca mà FB đã nói rõ — ca mơ hồ thật
         * (Socket mất ACK, Ext quá hạn, API timeout) vẫn đi cổng 10 s như cũ. */
        unsure++;
        sendDiag.unavailFast = (sendDiag.unavailFast || 0) + 1;
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'uncertain');
        noteManualResend(c.id);
        logFailGrouped((c.name || c.id),
          clip(String(r.error || 'FB không nhận tin'), 160) + ' — FB đã từ chối DỨT KHOÁT ⇒ chốt luôn, không chờ xác nhận',
          '⚠', c.id);
      } else if (r.uncertain) {
        unsure++;
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'uncertain');
        // [v1.92.34] Lý do từ làn gửi đã có sẵn câu "không gửi thêm để tránh trùng" ⇒ in thêm
        // một lần nữa chỉ làm dòng log dài gấp đôi mà không thêm thông tin.
        logFailGrouped((c.name || c.id),
          r.error + (/tránh trùng/i.test(String(r.error || '')) ? '' : ' — không rõ tin đã đi chưa (không gửi thêm để tránh trùng)'),
          '⚠', c.id);
      } else if (r && r.extOverloaded && !photo
                 && typeof window !== 'undefined' && window.__ExtensionAdapter__
                 && typeof window.__ExtensionAdapter__.send === 'function'
                 && (buLateRetryCount[c.id] || 0) < 2 && !state.stopRequested) {
        /* [v1.92.40] ❌ OAN VÌ BỘ NGẮT QUÁ TẢI (gốc của lô 9 455 chat, §45: 1 526 ca).
         * `extOverloaded` đã được tính từ trước nhưng KHÔNG AI ĐỌC — chat bị bộ ngắt Ext chặn
         * trước khi bắn (chưa hề gửi) vẫn bị tính ❌. Bộ ngắt chỉ nghỉ 8–15 s.
         * Nay: đặt ⚠ "chưa gửi", hẹn bắn lại qua Ext sau 9 s (tối đa 2 lần/chat), cùng lượt.
         * Chỉ áp cho TIN CH: gửi lại ca ảnh phải dựng lại ảnh, không đáng đổi rủi ro. */
        const lateN0 = buLateRetryCount[c.id] || 0;
        buLateRetryCount[c.id] = lateN0 + 1;
        unsure++;
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'uncertain');
        logFailGrouped((c.name || c.id), 'Extension nghẽn (bộ ngắt quá tải) chặn TRƯỚC KHI BẮN — chat CHƯA gửi lần nào'
          + ' ⇒ không chốt ❌ oan, hẹn thử lại sau 9 s (lần ' + (lateN0 + 1) + '/2)', '⏳', c.id);
        const myLateRun2 = runSeq;
        const lateC = c;
        bgClock.after(9000, () => {
          if (myLateRun2 !== runSeq || state.stopRequested) return;
          if (deliveredIds[lateC.id] || finalFailedIds[lateC.id]) return;
          scheduleBuRetry(lateC, gtext, null, (lateC.name || lateC.id),
            'thử lại sau khi Extension hồi sức', ['api'],
            { ambiguous: false, fromUncertain: true, via: 'ext', sentAt: Date.now() });
        });
      } else {
        fail++;
        if (r.windowClosed) windowBlocked++;
        logFailGrouped((c.name || c.id), r.error, '❌', c.id);
        // cửa sổ 24h VẪN bù kênh khác (Thanh Binh); kênh đã thử hết → scheduleBuRetry tự bỏ
        if (!r.uncertain && !r.recipientUnavailable && isRetryableLoss(r.error)) {
          const p2 = c.pageId || String(c.id).split('_')[0];
          chotFailKhongBu(c);
        } else {
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'fail');
        }
      }
      updateBatchSummaryUI();
      // 📊 ĐỒNG HỒ TỐC ĐỘ (mỗi 30s): tin/phút thực tế + dự kiến thời gian còn lại cho lô lớn
      if (totalAll > 200 && Date.now() - lastSpeedLogAt >= 30000) {
        lastSpeedLogAt = Date.now();
        const elapsedS = Math.max(1, (Date.now() - batchStats.startedAt) / 1000);
        const rate = done / elapsedS; // chat đã xử lý/giây từ đầu lượt
        // [v1.92.35] thành công = ĐÃ TỚI NƠI (không phải "đã phát"), phần còn lại là đang bay.
        const cOkSpeed = confirmedOkCount();
        const pendingSpeed = Math.max(0, done - cOkSpeed - unsure - fail);
        const successRate = cOkSpeed / elapsedS;
        const remainS = rate > 0 ? Math.round((totalAll - done) / rate) : 0;
        const fmtDur = (sec) => sec >= 3600 ? (sec / 3600).toFixed(1) + ' giờ' : Math.max(1, Math.round(sec / 60)) + ' phút';
        logLine('📊 Đã xử lý ' + done + '/' + totalAll + ' · tốc độ xử lý ' + (rate * 60).toFixed(0) + '/phút'
          + ' · thành công ' + cOkSpeed + '/' + totalAll + ' (' + (successRate * 60).toFixed(0) + ' tin/phút)'
          + (pendingSpeed ? ' · chờ xác nhận ' + pendingSpeed : '')
          + ' · dự kiến còn ~' + fmtDur(remainS) + ' nữa');
      }
      return r;
    };

    // Gửi được điều phối ngay trong tab Pancake hiện tại (không dispatch từng target qua service worker).
    // Wave 200: worker chính có semaphore tổng; ACK/socket retry và Extension chạy ở hàng đợi riêng.
    const settleInternalError = (c, e) => {
      done++; unsure++;
      if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'uncertain');
      logLine('⚠ ' + (c.name || c.id) + ' — lỗi nội bộ (' + clip(String(e && e.message || e), 80)
        + ') — không rõ tin đã đi chưa, KHÔNG gửi thêm');
      return { ok: false, uncertain: true, error: 'lỗi nội bộ' };
    };
    // 🔥 [FIX-TỐC-ĐỘ] Nâng từ 96 → 192 main slots. Với sockFired: true, mỗi slot quay vòng ~10ms
    // → 192 × 100/s = 19.200/s theoretical, chỉ bị paceSocketPublish (4ms) chặn.
    // Ext tăng 32→128, Socket retry tăng 44→96 để bù khi có rejected hàng loạt.
    // [v1.92.11] Hai hằng này KHÔNG còn dùng để chia việc — wave nay một hàng đợi chung.
    // Giữ lại để đọc log cũ và để đối chiếu lịch sử (xem docs §43).
    const WAVE_MAIN_LANES = 4;
    const WAVE_PER_LANE = 48;
    const WAVE_MAIN_TOTAL_CAP = 192;
    /* [v1.92.43] Trần slot main của TAB NÀY — tính lại ở đầu mỗi wave theo số tab đang gửi. */
    let mainCap = WAVE_MAIN_TOTAL_CAP;
    let lastLoggedMainCap = 0;
    const refreshMainCap = () => {
      const info = computeMainSlotCap(WAVE_MAIN_TOTAL_CAP);
      mainCap = info.cap;
      if (info.peers > 0 && info.cap !== lastLoggedMainCap) {
        lastLoggedMainCap = info.cap;
        logLine('🧩 Có ' + info.peers + ' tab khác đang gửi (page khác) — tab này dùng ' + info.cap
          + '/' + WAVE_MAIN_TOTAL_CAP + ' slot main'
          + (info.hiddenTrim ? ' (tab đang ẨN ⇒ nhường)' : (info.focused ? ' (tab đang gõ ⇒ ưu tiên)' : ' (tab hiện nhưng không focus ⇒ nhường)'))
          + ' ⇒ chạy song song vẫn nhanh hơn chạy một tab mà không dồn CPU.');
      } else if (info.peers === 0 && lastLoggedMainCap) {
        lastLoggedMainCap = 0;
        logLine('🧩 Không còn tab nào khác gửi — tab này trở lại ' + WAVE_MAIN_TOTAL_CAP + ' slot main.');
      }
      waveDiag.mainCapMinObserved = waveDiag.mainCapMinObserved
        ? Math.min(waveDiag.mainCapMinObserved, mainCap) : mainCap;
      return info;
    };
    const WAVE_SOCKET_RETRY_WORKERS = 96;
    const WAVE_EXT_WORKERS = 128;
    const WAVE_EXT_BACKLOG_HIGH_WATER = 96;
    /* [v1.92.42] TRẦN RIÊNG CHO VIỆC *CHẶN CỔNG PHÁT LỆNH* — không dùng 96 nữa.
     * Lô 16:07 (11 954 chat, 1.92.38): 17 wave đầu chạy êm (8 368 chat trong ~195 s ≈ 43/s,
     * Ext queue/active 0/0). Từ wave 18, ~2 300 chat dồn sang Extension (trần thật ~18 tin/s) ⇒
     * `extBacklogQueue.length + activeExtWorkers > 96` đúng ở MỌI lần kiểm tra (nhịp 60 ms) ⇒
     * cổng bị giữ **6 426 lần**, wave 19–24 mất 45–91 s MỖI wave dù `main đang bay 0` và
     * `retry 0/0/0`. 6 wave cuối = **~400 s trong tổng 652 s** chỉ để chờ một hàng đợi chạy nền.
     * Hàng đợi Ext KHÔNG làm lệnh phát nhanh hơn khi bị chặn — nó chỉ bị đẩy lùi. Nay cổng chỉ
     * giữ khi hàng đợi Ext vượt 1 200 ca (mức an toàn bộ nhớ), phần còn lại để Ext chạy song song.
     * Bất biến: KHÔNG tăng số làn Ext, KHÔNG đổi tốc độ gửi — chỉ bỏ việc bắt cả lô xếp hàng sau nó. */
    const GATE_EXT_BACKLOG_LIMIT = 1200;
    const WAVE_API_BACKLOG_HIGH_WATER = 96;

    const runGroupWaves200 = async (gtext, fullList) => {
      // Điều phối worker, retry và wave ngay trong tab Pancake; không chuyển job sang service worker.
      const socketRetryQueue = [];
      const socketRetryWaiters = [];
      const socketCoolTimers = new Map();
      const extBacklogQueue = [];
      const extWaiters = [];
      const allMainPromises = [];
      let mainWavesLoopDone = false;
      let inFlightMainCount = 0;
      let pendingSocketCoolCount = 0;
      let activeSocketRetryWorkers = 0;
      let activeExtWorkers = 0;
      let waveGateCheckFn = null;
      const mainSlotWaiters = [];
      let lastSocketPressureSampleAt = 0;
      waveDiag.mainCapMinObserved = waveDiag.mainCapMinObserved
        ? Math.min(waveDiag.mainCapMinObserved, WAVE_MAIN_TOTAL_CAP) : WAVE_MAIN_TOTAL_CAP;
      const recordWavePressure = () => {
        waveDiag.maxMainInFlight = Math.max(waveDiag.maxMainInFlight, inFlightMainCount);
        waveDiag.maxSocketRetryQueue = Math.max(waveDiag.maxSocketRetryQueue, socketRetryQueue.length);
        waveDiag.maxSocketRetryActive = Math.max(waveDiag.maxSocketRetryActive, activeSocketRetryWorkers);
        waveDiag.maxSocketCooldown = Math.max(waveDiag.maxSocketCooldown, pendingSocketCoolCount);
        waveDiag.maxExtQueue = Math.max(waveDiag.maxExtQueue, extBacklogQueue.length);
        waveDiag.maxExtActive = Math.max(waveDiag.maxExtActive, activeExtWorkers);
        waveDiag.maxApiWaiting = Math.max(waveDiag.maxApiWaiting, apiSendLane.waitingCount());
        // Telemetry-only scan: sample per-page lane maps at most 10 times/second instead of
        // iterating all page lanes on every send/ACK callback. This does not throttle send work.
        const now = Date.now();
        if (now - lastSocketPressureSampleAt < 100) return;
        lastSocketPressureSampleAt = now;
        const socketLaneStats = getPageSocketLaneStats();
        waveDiag.maxSocketLaneActiveTotal = Math.max(waveDiag.maxSocketLaneActiveTotal, socketLaneStats.activeTotal);
        waveDiag.maxSocketLaneWaitingTotal = Math.max(waveDiag.maxSocketLaneWaitingTotal, socketLaneStats.waitingTotal);
        waveDiag.maxSocketLaneActivePerPage = Math.max(waveDiag.maxSocketLaneActivePerPage, socketLaneStats.activeMaxPerPage);
        waveDiag.maxSocketLaneWaitingPerPage = Math.max(waveDiag.maxSocketLaneWaitingPerPage, socketLaneStats.waitingMaxPerPage);
      };

      // Fixed main semaphore: retain the tested 96-flight ceiling; only telemetry/UI work is throttled.
      const acquireMainSlot = () => {
        if (state.stopRequested) return Promise.resolve(false);
        if (inFlightMainCount < mainCap) {
          inFlightMainCount++;
          recordWavePressure();
          return Promise.resolve(true);
        }
        return new Promise((resolve) => mainSlotWaiters.push(resolve));
      };
      const releaseMainSlot = () => {
        if (state.stopRequested) {
          inFlightMainCount = Math.max(0, inFlightMainCount - 1);
          while (mainSlotWaiters.length) mainSlotWaiters.shift()(false);
        } else if (mainSlotWaiters.length) {
          // Pass the released slot directly to the next waiter; in-flight count remains unchanged.
          mainSlotWaiters.shift()(true);
        } else {
          inFlightMainCount = Math.max(0, inFlightMainCount - 1);
        }
        recordWavePressure();
      };
      const isAllGroupWorkDone = () => mainWavesLoopDone
        && inFlightMainCount <= 0
        && pendingSocketCoolCount <= 0
        && socketRetryQueue.length === 0
        && activeSocketRetryWorkers <= 0
        && extBacklogQueue.length === 0
        && activeExtWorkers <= 0;

      const checkWakeAllWaiters = () => {
        if (waveGateCheckFn) { try { waveGateCheckFn(); } catch (e) { /* ignore */ } }
        if (isAllGroupWorkDone() || state.stopRequested) {
          while (socketRetryWaiters.length) socketRetryWaiters.shift()(null);
          while (extWaiters.length) extWaiters.shift()(null);
        }
      };

      const enqueueReadySocketRetry = (item) => {
        if (state.stopRequested || !item || !item.c || deliveredIds[item.c.id]) {
          if (item && item.c && item.c.id) {
            clearBgPending(item.c.id);
            releaseOutbound(item.c.id);
          }
          checkWakeAllWaiters();
          return;
        }
        if (socketRetryWaiters.length) socketRetryWaiters.shift()(item);
        else socketRetryQueue.push(item);
        recordWavePressure();
        if (waveGateCheckFn) { try { waveGateCheckFn(); } catch (e) { /* ignore */ } }
      };

      const pushToSocketRetry = (item) => {
        if (!item || !item.c || !item.c.id) return;
        // [v1.92.26] NGÂN SÁCH: hết ngân sách thì chốt ❌ ngay, không bắn thêm 1 lệnh socket
        // mà 40 ca trước đã chứng minh là chắc chắn bị từ chối y hệt (lô 10:04: 0/861 cứu được).
        const rejectPct = socketRejectPctRecent(); // [v1.92.28] cửa sổ 200 ACK gần nhất (-1 = chưa đủ mẫu)
        if (!sockRetryBudgetAllows(sockRetryBudgetState)) {
          sockRetryBudgetNote(sockRetryBudgetState, 'skipped', rejectPct);
          sendDiag.sockRetryBudgetSkipped++;
          clearBgPending(item.c.id);
          releaseOutbound(item.c.id);
          done++; fail++;
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(item.c.id, 'fail');
          // [v1.92.32] Lô 20 259 chat từng in 5 178 dòng y hệt nhau (chỉ khác tên chat) ⇒ đây là
          // nguồn phình log lớn nhất. Nay GỘP: cùng lý do ⇒ 1 dòng đếm / 2 giây, kèm [done/total],
          // số chat và 4 tên ví dụ. Lý do đầy đủ in ở dòng đầu tiên của nhóm (buQuietBudgetNote === 1).
          buQuietBudgetNote++;
          logFailGrouped(item.c.name || item.c.id,
            'Socket: FB từ chối lần 1 — KHÔNG thử lần 2 (đã thử ' + sockRetryBudgetState.tried
              + ' ca, cứu được 0, từ chối gần đây '
              + (sockRetryBudgetState.closePct >= 0 ? sockRetryBudgetState.closePct + '%' : '—')
              + ' ⇒ thử nữa chỉ tốn lệnh)', '❌', item.c.id);
          updateBatchSummaryUI();
          checkWakeAllWaiters();
          return;
        }
        if (sockRetryBudgetState.closed) sockRetryBudgetNote(sockRetryBudgetState, 'probe', rejectPct);
        sockRetryBudgetNote(sockRetryBudgetState, 'tried', rejectPct);
        // [v1.92.30] Khung `markOptimisticMessageFailed` là PHÁN ĐOÁN ⇒ chứng minh vắng mặt
        // TRƯỚC khi bắn lại. Bắt đầu ngay tại đây để thời gian chờ (≈10 s) chạy SONG SONG với
        // lúc item nằm trong hàng đợi — worker chỉ việc chờ kết quả, không tốn thêm lane.
        if (!item.proof) {
          try {
            const pAt = (item.deferredCtx && item.deferredCtx.firstRejectedAt) || Date.now();
            item.proof = proveAbsentBeforeBu(item.c, gtext, pAt, !!photo);
          } catch (e0) { item.proof = Promise.resolve('unknown'); }
        }
        noteBgPending(item.c, 'wave200-socket-retry');
        const pid = item.c.pageId || String(item.c.id).split('_')[0];
        const deadStreak = socketConfirmedDeadStreak[pid] || 0;
        const firstAt = (item.deferredCtx && item.deferredCtx.firstRejectedAt) || Date.now();
        const coolTargetMs = deadStreak >= 3
          ? 260 + Math.floor(Math.random() * 190)
          : 620 + Math.floor(Math.random() * 280);
        const waitMs = Math.max(0, coolTargetMs - (Date.now() - firstAt));
        if (waitMs <= 15) { enqueueReadySocketRetry(item); return; }
        pendingSocketCoolCount++;
        const timerId = bgClock.after(waitMs, () => {
          socketCoolTimers.delete(timerId);
          pendingSocketCoolCount = Math.max(0, pendingSocketCoolCount - 1);
          enqueueReadySocketRetry(item);
          checkWakeAllWaiters();
        });
        socketCoolTimers.set(timerId, item);
      };

      const pushToExtBacklog = (item) => {
        if (!item || !item.c || !item.c.id) return;
        noteBgPending(item.c, 'wave200-extension');
        if (extWaiters.length) extWaiters.shift()(item);
        else extBacklogQueue.push(item);
        recordWavePressure();
        if (waveGateCheckFn) { try { waveGateCheckFn(); } catch (e) { /* ignore */ } }
      };

      const popQueueItem = (queue, waiters) => {
        if (queue.length) return Promise.resolve(queue.shift());
        if (isAllGroupWorkDone() || state.stopRequested) return Promise.resolve(null);
        return new Promise((resolve) => waiters.push(resolve));
      };

      const settleInternalError = (c, e) => {
        if (c && c.id) {
          clearBgPending(c.id);
          releaseOutbound(c.id);
        }
        done++; unsure++;
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'uncertain');
        logLine('⚠ ' + (c.name || c.id) + ' — lỗi nội bộ (' + clip(String(e && e.message || e), 80)
          + ') — không rõ tin đã đi chưa, KHÔNG gửi thêm');
        updateBatchSummaryUI();
      };

      const runSocketRetryWorker = async () => {
        while (!state.stopRequested) {
          const item = await popQueueItem(socketRetryQueue, socketRetryWaiters);
          if (!item) break;
          activeSocketRetryWorkers++;
          recordWavePressure();
          try {
            if (state.stopRequested || deliveredIds[item.c.id]) {
              clearBgPending(item.c.id);
              releaseOutbound(item.c.id);
              continue;
            }
            if (item.proof) {
              let pv = 'unknown';
              try { pv = await item.proof; } catch (e0) { pv = 'unknown'; }
              if (pv === 'yes') {
                clearBgPending(item.c.id);
                releaseOutbound(item.c.id);
                markDelivered(item.c.id, 'socket');
                done++; ok++;
                sendDiag.buProofCancelled++;
                logFailGrouped((item.c.name || item.c.id),
                  'FB báo "không gửi được" nhưng hội thoại ĐÃ CÓ tin ⇒ tin đã đi, KHÔNG bắn lần 2 (chặn lặp)', '✅', item.c.id);
                updateBatchSummaryUI();
                checkWakeAllWaiters();
                continue;
              }
            }
            releaseOutbound(item.c.id);
            sendDiag.sockRetry++;
            const r = await sendOneAndLog(item.c, gtext, {
              fastOnly: false,
              wave200Mode: false,
              isSocketRetryPass: true,
              deferredCtx: item.deferredCtx || {},
            });
            if (r && r.ok && !r.skippedDup) { sendDiag.sockRetryRecovered++; sockRetryBudgetNote(sockRetryBudgetState, 'saved', 0); }
            else if (r && r.recipientUnavailable) sendDiag.sockRetryRejected++;
            else sendDiag.sockRetryOther++;
            if (r && r.deferredToExt) pushToExtBacklog({ c: item.c, deferredCtx: r.deferredCtx || item.deferredCtx || {} });
            else if (r && r.deferredToSocketRetry) pushToSocketRetry({ c: item.c, deferredCtx: r.deferredCtx || item.deferredCtx || {} });
          } catch (e) { sendDiag.sockRetryOther++; settleInternalError(item.c, e); }
          finally {
            activeSocketRetryWorkers = Math.max(0, activeSocketRetryWorkers - 1);
            recordWavePressure();
            checkWakeAllWaiters();
          }
        }
      };

      const runExtWorker = async () => {
        while (!state.stopRequested) {
          const item = await popQueueItem(extBacklogQueue, extWaiters);
          if (!item) break;
          activeExtWorkers++;
          recordWavePressure();
          try {
            if (state.stopRequested || deliveredIds[item.c.id]) {
              clearBgPending(item.c.id);
              continue;
            }
            const r = await sendOneAndLog(item.c, gtext, {
              fastOnly: false,
              wave200Mode: true,
              isExtBacklogPass: true,
              deferredCtx: item.deferredCtx || {},
            });
            if (r && r.deferredToSocketRetry) pushToSocketRetry({ c: item.c, deferredCtx: r.deferredCtx || item.deferredCtx || {} });
            else if (r && r.deferredToExt) pushToExtBacklog({ c: item.c, deferredCtx: r.deferredCtx || item.deferredCtx || {} });
          } catch (e) { settleInternalError(item.c, e); }
          finally {
            activeExtWorkers = Math.max(0, activeExtWorkers - 1);
            recordWavePressure();
            checkWakeAllWaiters();
          }
        }
      };

      const socketWorkers = Array.from({ length: Math.min(WAVE_SOCKET_RETRY_WORKERS, Math.max(1, fullList.length)) }, () => runSocketRetryWorker());
      const extensionWorkers = Array.from({ length: Math.min(WAVE_EXT_WORKERS, Math.max(1, fullList.length)) }, () => runExtWorker());

      let gidPrefetchBusy = false;
      const prefetchNextWaveGids = (items) => {
        if (gidPrefetchBusy || !items || !items.length || state.stopRequested) return;
        gidPrefetchBusy = true;
        runPool(items, async (c) => {
          if (state.stopRequested || !c || !c.id || c.type === 'comment') return;
          if (gidStats.httpNoGid >= 12 && gidStats.httpHit === 0) return;
          const full = peekConv(c) || c;
          const idleMs = getConvIdleMs(c, full);
          if (isNaN(idleMs) || idleMs <= 86400000 || peekFastGlobalId(c, full, '')) return;
          if (ctxFetchLane.waitingCount() > 24) return;
          try { await ensureConvCtx(c, { force: true }); } catch (e) { /* prefetch is opportunistic */ }
        }, 8).catch(() => {}).finally(() => { gidPrefetchBusy = false; });
      };

      const computeSmartGap = () => {
        if (WAVE_GAP <= 0) return 0;
        const retryLoad = socketRetryQueue.length + activeSocketRetryWorkers + pendingSocketCoolCount;
        const extLoad = extBacklogQueue.length + activeExtWorkers;
        /* ═══ [v1.92.66] GAP PHẢI ĐO ĐÚNG THỨ ĐANG CHẶN, KHÔNG PHẢI "SLOT CÓ RẢNH KHÔNG" ═══
         * Bản cũ: `if (inFlightMainCount <= mainCap * 0.6 …) return 0;` — tức chỉ về 0 khi số slot
         * đang bay ≤ 60 % cap. Nhưng CỔNG WAVE chặn ở 92 % cap (gateActiveLimit) và worker nhận
         * lại slot TỨC THÌ khi một slot vừa nhả (releaseMainSlot chuyền trực tiếp cho người chờ).
         * Kết quả đo trên lô 19:48:22: `main đang bay` đứng ở **163** suốt 16/16 wave, tức
         * 163 > 0,6 × 192 = 115 ⇒ NHÁNH `return 0` CHƯA BAO GIỜ CHẠY. Mọi wave đều in
         * "gap kế tiếp 120ms" ⇒ 15 × 120 = 1,8 s bị chờ mù, và thông điệp "chỉ chờ khi có tải"
         * trong chú thích là SAI so với hành vi thật.
         *
         * Đo lại: điều kiện đúng để bỏ gap KHÔNG phải "slot rảnh" mà là "KHÔNG có hàng đợi nào
         * đang dồn" — vì gap sinh ra để các làn bù (retry/Ext/API) có nhịp thở. Số slot đang bay
         * không nói gì về việc đó: 163 slot đang bay với 0 hàng đợi là trạng thái KHOẺ NHẤT
         * (mọi worker đều đang bận gửi, không ai phải xếp hàng).
         * Nay: gap 0 khi cả 3 làn bù đều dưới ngưỡng thật; chỉ chờ khi có hàng đợi dồn.
         * GIỮ NGUYÊN `WAVE_GAP` của người dùng như một TRẦN, không phải giá trị mặc định. */
        const queuePressure = retryLoad > 60 || extLoad > 100 || apiSendLane.waitingCount() > 40;
        if (!queuePressure) return 0;
        if (retryLoad <= 100 && extLoad <= 150) return Math.min(WAVE_GAP, 30);
        return Math.min(Math.max(WAVE_GAP, 60), 120);
      };
      const totalWaves = Math.max(1, Math.ceil(fullList.length / WAVE_SIZE));
      try {
        for (let waveStart = 0; waveStart < fullList.length && !state.stopRequested; waveStart += WAVE_SIZE) {
          const waveSlice = fullList.slice(waveStart, waveStart + WAVE_SIZE);
          const waveNo = Math.floor(waveStart / WAVE_SIZE) + 1;
          const waveStartedAt = Date.now();
          waveDiag.wavesStarted++;
          refreshMainCap(); // [v1.92.43] mỗi wave chia lại slot theo số tab đang gửi
          // [v1.92.11] BỎ CHIA KHÚC TĨNH. Bản cũ chia wave thành WAVE_MAIN_LANES khúc cố định, mỗi
          // khúc một pool riêng ⇒ khúc nào nhiều ca chậm (FB từ chối → chờ ACK lâu) thì 48 làn của
          // khúc đó ùn, còn 144 làn của 3 khúc kia HẾT VIỆC rồi ngồi không, wave chỉ kết thúc khi
          // khúc chậm nhất xong. Log 14:27 (2 393 chat): wave→cổng TB 2 510 ms nhưng MAX 6 270 ms
          // — chênh 2,5 lần, đúng dấu của mất cân bằng tĩnh. Nay cả wave dùng CHUNG một hàng đợi,
          // 192 làn rút việc chung ⇒ làn rảnh nhận việc ngay, không chờ khúc khác.
          let waveDoneCount = 0;
          // 🔥 [FIX-TỐC-ĐỘ] Mở wave N+1 khi wave N đạt 40% (thay vì 78%) → gối wave sớm, tổng thời gian wave không bị "rỗng".
          const fastGateTarget = Math.max(1, Math.ceil(waveSlice.length * 0.4));
          const softGateTarget = Math.max(1, Math.ceil(waveSlice.length * 0.25));
          let resolveGate = null;
          let gateOpened = false;
          const openGate = () => {
            if (gateOpened) return;
            gateOpened = true;
            const gateWaitMs = Math.max(0, Date.now() - waveStartedAt);
            waveDiag.gateWaitMsTotal += gateWaitMs;
            waveDiag.gateWaitMsMax = Math.max(waveDiag.gateWaitMsMax, gateWaitMs);
            if (resolveGate) { const resolve = resolveGate; resolveGate = null; resolve(); }
          };
          const evaluateGate = () => {
            recordWavePressure();
            if (gateOpened) return;
            if (state.stopRequested) { openGate(); return; }
            const retryBacklog = socketRetryQueue.length + pendingSocketCoolCount + activeSocketRetryWorkers;
            const extBacklog = extBacklogQueue.length + activeExtWorkers;
            const apiBacklog = apiSendLane.waitingCount();
            // Gate theo phần trăm cap hiện tại để bộ điều tiết vẫn gối wave đúng khi tự hạ luồng.
            // 🔥 [FIX-TỐC-ĐỘ] Cho phép ~92% cap trước khi chặn (thay vì 65%) — tận dụng hết slot.
            const gateActiveLimit = Math.floor(mainCap * 0.92);
            const fastActiveLimit = Math.floor(mainCap * 0.75);
            const softActiveLimit = Math.floor(mainCap * 0.85);
            // Có backpressure: không mở wave mới khi lane bù hoặc hàng đợi API đã quá sâu.
            /* [v1.92.52] PHÂN LOẠI TRƯỚC KHI CHẶN (chỉ đếm). `>=` để mọi lần kiểm đều rơi vào
             * đúng một trong ba nhóm; thứ tự ưu tiên trùng với thứ tự chặn bên dưới. */
            if (retryBacklog <= 80 && extBacklog <= GATE_EXT_BACKLOG_LIMIT && apiBacklog <= WAVE_API_BACKLOG_HIGH_WATER) {
              // [v1.92.52] đo "đã có lúc nào slot thoát xuống ≤ 75 % cap không" (xem waveDiag)
              if (inFlightMainCount <= fastActiveLimit) waveDiag.gateIdleSeen++;
              if (waveDoneCount >= softGateTarget
                  && (waveDiag.gateIdleMax < 0 || inFlightMainCount < waveDiag.gateIdleMax)) {
                waveDiag.gateIdleMax = inFlightMainCount;
              }
              if (inFlightMainCount > gateActiveLimit) waveDiag.gateBlockHard++;
              else if (inFlightMainCount > softActiveLimit) waveDiag.gateBlockSoft++;
              else waveDiag.gateBlockProgress++;
            }
            if (inFlightMainCount > gateActiveLimit || retryBacklog > 80
                || extBacklog > GATE_EXT_BACKLOG_LIMIT
                || apiBacklog > WAVE_API_BACKLOG_HIGH_WATER) {
              // [v1.92.28] Ghi lại LÝ DO chặn (đếm trên mỗi lần kiểm tra 60ms). Lô 10:21 có
              // gate TB 6,8 s / max 22,96 s nhưng không biết ai giữ ⇒ thêm số đo thay vì đoán.
              if (inFlightMainCount > gateActiveLimit) waveDiag.gateBlockInflight++;
              else if (retryBacklog > 80) waveDiag.gateBlockRetry++;
              else if (extBacklog > GATE_EXT_BACKLOG_LIMIT) waveDiag.gateBlockExt++;
              else waveDiag.gateBlockApi++;
              return;
            }
            /* [v1.92.55] CHỈ ĐO — nằm sau mọi nhánh chặn, trước các nhánh MỞ.
             * Lô 14:03: wave 24 giữ 25 013 ms với `main đang bay 0` ⇒ phải có số cho đúng nhánh này. */
            if (!gateOpened) {
              waveDiag.gateWaitDone++;
              if (inFlightMainCount <= 0) waveDiag.gateNoWorkerSeen++;
              const _bgN = (typeof pendingBgCount === 'function') ? pendingBgCount() : 0;
              if (_bgN > waveDiag.gateBgPendingMax) waveDiag.gateBgPendingMax = _bgN;
            }
            if (waveDoneCount >= waveSlice.length) { openGate(); return; }
            if (waveDoneCount >= fastGateTarget && inFlightMainCount <= fastActiveLimit) { openGate(); return; }
            if (Date.now() - waveStartedAt >= 1600 && waveDoneCount >= softGateTarget && inFlightMainCount <= softActiveLimit) openGate();
          };
          waveGateCheckFn = evaluateGate;
          const gateTimer = bgClock.every(60, evaluateGate);
          const gatePromise = new Promise((resolve) => { resolveGate = resolve; evaluateGate(); });

          const runMainItem = async (c) => {
            if (state.stopRequested) return null;
            const _tAcq0 = Date.now();
            const gotMainSlot = await acquireMainSlot();
            if (!gotMainSlot) return null;
            /* [v1.92.53] ĐO ĐÚNG CHỖ CHỜ SLOT. `_tAcq0 → sau acquireMainSlot` là TOÀN BỘ thời gian
             * chờ, kể cả khi slot được CHUYỀN TRỰC TIẾP (releaseMainSlot → shift → resolve(true)),
             * ca không phải chờ vẫn ra ~0 ms. Vì vậy chỉ cộng vào `slotAcqPosMs` khi thực sự > 0;
             * `slotAcqN` đếm số ca PHẢI CHỜ (khác 0). Nếu lô sau `slotAcqN` = 0 thì "chờ slot"
             * không phải nút cổ chai — đúng như suy ra từ `releaseMainSlot()`. */
            { const _w = Date.now() - _tAcq0; if (_w > 0) { try { waveDiag.slotAcqN++; waveDiag.slotAcqPosMs += _w; } catch (eA) { /* ignore */ } } }
            try {
              let r;
              const _tHold0 = Date.now();
              try { r = await sendOneAndLog(c, gtext, { fastOnly: true, wave200Mode: true }); }
              catch (e) { settleInternalError(c, e); return null; }
              try {
                waveDiag.slotN++;
                waveDiag.slotAcquireMs += Math.max(0, _tHold0 - _tAcq0);
                waveDiag.slotHoldMs += Math.max(0, Date.now() - _tHold0);
              } catch (eS) { /* ignore */ }
              if (r && r.deferredToSocketRetry) pushToSocketRetry({ c, deferredCtx: r.deferredCtx || {} });
              else if (r && r.deferredToExt) pushToExtBacklog({ c, deferredCtx: r.deferredCtx || {} });

              else if (r && !r.ok && r.error && r.error.indexOf('Token') === 0) {
                logLine('⛔ Dừng sớm vì token không còn hợp lệ.');
                state.stopRequested = true;
                fireStopSignal();
              }
              return r;
            } finally {
              waveDoneCount++;
              releaseMainSlot();
              evaluateGate();
              checkWakeAllWaiters();
            }
          };

          // Một pool duy nhất: runPool đã rút việc động bằng biến next chung (không chia khúc).
          const wavePromise = runPool(waveSlice, runMainItem, mainCap);
          allMainPromises.push(wavePromise);
          if (waveStart + WAVE_SIZE < fullList.length) {
            prefetchNextWaveGids(fullList.slice(waveStart + WAVE_SIZE, waveStart + 2 * WAVE_SIZE));
          }
          try { await gatePromise; }
          finally {
            try { gateTimer(); } catch (eGate) { /* ignore */ }
            if (waveGateCheckFn === evaluateGate) waveGateCheckFn = null;
          }
          if (waveStart + WAVE_SIZE < fullList.length && !state.stopRequested) {
            const smartGap = computeSmartGap();
            const socketLaneNow = getPageSocketLaneStats();
            logLine('🌊 Wave ' + waveNo + '/' + totalWaves + ' — qua cổng ' + waveDoneCount + '/' + waveSlice.length
              + ' sau ' + Math.max(0, Date.now() - waveStartedAt) + 'ms; main đang bay ' + inFlightMainCount
              + ' · retry Socket queue/active/cool ' + socketRetryQueue.length + '/' + activeSocketRetryWorkers + '/' + pendingSocketCoolCount
              + ' · Ext queue/active ' + extBacklogQueue.length + '/' + activeExtWorkers
              + ' · Socket/page active/wait ' + socketLaneNow.activeTotal + '/' + socketLaneNow.waitingTotal
              + ' (max/page ' + socketLaneNow.activeMaxPerPage + '/' + socketLaneNow.waitingMaxPerPage + '; lane ' + socketLaneNow.limits + ')'
              + ' · API đang chờ ' + apiSendLane.waitingCount() + ' — gap kế tiếp ' + smartGap + 'ms.');
            if (smartGap > 0) await sleepUntil(Date.now() + smartGap);
          } else if (!state.stopRequested) {
            const socketLaneNow = getPageSocketLaneStats();
            logLine('🌊 Wave ' + waveNo + '/' + totalWaves + ' — cổng cuối ' + waveDoneCount + '/' + waveSlice.length
              + ' sau ' + Math.max(0, Date.now() - waveStartedAt) + 'ms; main đang bay ' + inFlightMainCount
              + ' · retry Socket queue/active/cool ' + socketRetryQueue.length + '/' + activeSocketRetryWorkers + '/' + pendingSocketCoolCount
              + ' · Ext queue/active ' + extBacklogQueue.length + '/' + activeExtWorkers
              + ' · Socket/page active/wait ' + socketLaneNow.activeTotal + '/' + socketLaneNow.waitingTotal
              + ' (max/page ' + socketLaneNow.activeMaxPerPage + '/' + socketLaneNow.waitingMaxPerPage + '; lane ' + socketLaneNow.limits + ')'
              + ' · API đang chờ ' + apiSendLane.waitingCount() + '.');
          }
        }
        await Promise.all(allMainPromises);
      } finally {
        mainWavesLoopDone = true;
        /* [v1.92.50] MỐC PHÁT XONG = LÚC CỔNG WAVE CUỐI MỞ, KHÔNG PHẢI LÚC ĐUÔI CHẠY HẾT.
         * Log 11:34 in "PHÁT 9 242 lệnh trong 296,8s = 31,14/giây" trong khi 19 cổng wave đã mở
         * hết lúc 11:37:34 (166 s) — 131 s sau đó chỉ để chốt ~2 chat/s ở đuôi (Ext/kiểm chứng).
         * Gốc: dispatchEndedAt được đặt MỘT LẦN ở sendToAll (dòng 11425), SAU `await Promise.all(
         * [...socketWorkers, ...extensionWorkers])` ⇒ đã gồm cả đuôi. Nay đóng dấu ngay khi vòng
         * wave xong; sendToAll giữ nguyên dấu sớm hơn (nếu có) thay vì ghi đè.
         * Hệ quả đọc số: "PHÁT …/s" = tốc độ thật của khâu phát; "đuôi xác nhận" = phần còn lại. */
        if (!batchStats.dispatchEndedAt) batchStats.dispatchEndedAt = Date.now();
        if (state.stopRequested) {
          socketCoolTimers.forEach((item, timerId) => {
            try { if (typeof timerId === 'function') timerId(); } catch (e) { /* ignore */ }
            if (item && item.c && item.c.id) {
              clearBgPending(item.c.id);
              releaseOutbound(item.c.id);
            }
          });
          socketCoolTimers.clear();
          pendingSocketCoolCount = 0;
          while (socketRetryQueue.length) {
            const item = socketRetryQueue.shift();
            if (item && item.c && item.c.id) {
              clearBgPending(item.c.id);
              releaseOutbound(item.c.id);
            }
          }
          while (extBacklogQueue.length) {
            const item = extBacklogQueue.shift();
            if (item && item.c && item.c.id) {
              clearBgPending(item.c.id);
              releaseOutbound(item.c.id);
            }
          }
        }
        waveDiag.mainCapFinal = mainCap;
        checkWakeAllWaiters();
      }

      await Promise.all([...socketWorkers, ...extensionWorkers]);
    };

    let sendErr = null;
    try {
      try {
        await waitInitialGidWarmup(targets, 1500);
      } catch (e) { /* làm nóng lỗi không được làm hỏng lô */ }
      // [v1.92.14] Lô lớn: chờ socket sync TRƯỚC wave đầu (lô nhỏ ≤50 chat giữ nguyên chiến lược
      // "Ext ngay cho nhanh" — 3–4s chờ làm nho; đổi lại cả lô 9 455 chat đi làn chậm là lỗ lớn).
      try {
        const nTargets = (targets || []).length;
        if (nTargets > 50) await waitSocketsReadyForSend(targets);
      } catch (e) { /* chờ socket lỗi không được làm hỏng lô */ }
      // SW gửi inbox thất bại: jwt → #551; cookie jar → Invalid access_token. Chỉ tab pancake.vn.
      for (let gi = 0; gi < sendGroups.length && !state.stopRequested; gi++) {
        const g = sendGroups[gi];
        if (sendGroups.length > 1) {
          logLine('📤 [' + (gi + 1) + '/' + sendGroups.length + '] nội dung “' + clip(g.text, 50) + '” → ' + g.list.length + ' chat');
        }
        await runGroupWaves200(g.text, g.list);
      }
    } catch (e) {
      sendErr = e;
      logLine('⚠ Gửi lỗi giữa chừng (' + (e && e.message || e) + ') — vẫn xóa câu đã gửi + bỏ chọn để không gửi trùng.');
    }

    batchStats.loopFinished = true;
    batchStats.loopFinishedAt = Date.now(); // [v1.92.63] mốc bắt đầu ân hạn chốt bảng
    // [v1.92.50] KHÔNG ghi đè mốc đã đóng ở cuối vòng wave (xem runGroupWaves200.finally) — mốc
    // đó mới là lúc PHÁT xong; ghi đè ở đây (sau khi đuôi chạy hết) làm "PHÁT …/s" bị tính cả đuôi.
    if (!batchStats.dispatchEndedAt) batchStats.dispatchEndedAt = Date.now();
    // Chưa chốt idle ở đây: còn tin đang xác nhận/bù ở nền — overlay giữ nguyên tới khi
    // markSendIdleIfSettled() chốt xong (pending = 0) mới ẩn
    try {
      const c0 = getBatchSummaryCounts();
      reportExtJob({ phase: 'send', pct: c0.total ? Math.round((c0.settled / c0.total) * 100) : 0, ok: c0.okTotal, total: c0.total, done: c0.settled });
    } catch (e) { reportExtJob({ phase: 'send' }); }
    if (state.stopRequested && done < totalAll) {
      logLine('⏸ Đã dừng sớm sau ' + done + '/' + totalAll + ' chat.');
    }
    // Chỉ giữ sentIds khi dừng giữa chừng. Nút ▶/⏹ không hạ ngay — còn tin đang xác nhận
    // thì vẫn Đang gửi, ⏹ Dừng vẫn bấm được (tránh xám Dừng / hiện lại Chạy giữa chừng).
    if (!(state.stopRequested && done < totalAll)) {
      state.sentIds.clear();
      localStorage.removeItem('SSB_SENT_IDS');
    }
    markSendIdleIfSettled();
    if (!sendErr) {
      // chốt per page: check_inbox + contents/touch (app gọi sau gửi — HAR/file "post")
      try {
        const seenPg = {};
        targets.forEach((c) => {
          const pg = (c.pageId || String(c.id || '').split('_')[0]) || '';
          if (pg && !seenPg[pg]) { seenPg[pg] = true; postSendSideEffects({ pageId: pg }, { perConv: false, perPage: true }); }
        });
      } catch (e) { /* ignore */ }
      const sumNow = getBatchSummaryCounts();
      flushErrGroup(); // [v1.92.32] in nốt dòng gộp còn đang gom trước mốc 🏁
      logLine('🏁 Hoàn tất vòng phát lệnh: đã xác nhận ' + sumNow.okTotal + '/' + totalAll + ' thành công'
        + (sumNow.pending > 0 ? ' (còn ' + sumNow.pending + ' tin đang xác nhận/bù nền — bảng TỔNG HỢP sẽ tự chốt khi xong hết)' : '')
        + ', ' + sumNow.failTotal + ' lỗi.'
        + (sumNow.unsureTotal ? ' ' + sumNow.unsureTotal + ' tin không rõ kết quả (không gửi thêm).' : '')
        + (windowBlocked ? ' 🚫 ' + windowBlocked + ' lần API bị chặn ngoài cửa sổ 24h.' : '')
        + (sumNow.pending > 0
          /* [v1.92.51] PHẢI LÀ MỐC PHÁT, KHÔNG PHẢI "BÂY GIỜ". Log 12:06 in ở đây "Đã phát lệnh xong
           * trong 107s" nhưng dòng ⚡ cùng lượt in "PHÁT … trong 54,5s" — vì chỗ này lấy
           * Date.now() tại lúc IN (sau khi đuôi đã chạy một phần), không lấy dispatchEndedAt.
           * Hai dòng nói hai số khác nhau về cùng một việc ⇒ không dùng để nghiệm thu được. */
          ? ' ⏱ Đã phát lệnh xong trong ' + ((((batchStats.dispatchEndedAt || Date.now()) - batchStats.startedAt) / 1000).toFixed(0)) + 's — tốc độ chốt xem ở dòng TỔNG HỢP cuối cùng.'
          : ' ⏱ Tổng thời gian: ' + (((Date.now() - batchStats.startedAt) / 60000).toFixed(1)) + ' phút'
            + ' (trung bình ' + (totalAll / Math.max(1, (Date.now() - batchStats.startedAt) / 1000) * 60).toFixed(0) + ' tin/phút).'));
    }
    updateBatchSummaryUI();
    render();
  }

  /* ============================ GIAO DIỆN (SHADOW DOM) ============================ */

  let shadow = null;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
      .ssb-m-match { background: rgba(34,197,94,.16) !important; box-shadow: inset 3px 0 0 0 #22c55e !important; outline: 2px solid #22c55e !important; outline-offset: -2px !important; border-radius: 6px; }
      .ssb-m-target { background: rgba(59,130,246,.22) !important; box-shadow: inset 3px 0 0 0 #3b82f6 !important; outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; border-radius: 6px; }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ===== CỬA SỔ PHÓNG TO (list/log) — kéo tiêu đề để di chuyển, kéo góc dưới-phải để đổi cỡ =====
     Bảng gốc được ĐƯA VÀO cửa sổ nổi (mọi nút/kéo thả bên trong vẫn chạy nguyên), thu nhỏ = trả
     bảng về đúng chỗ cũ trong panel. Vị trí + cỡ lưu localStorage — giữ qua F5. */
  const floatWins = {}; // key → { win, content, ph, cleanup }

  function toggleFloat(key, contentEl, title, btnEl, openLabel, closeLabel, def) {
    const existing = floatWins[key];
    if (existing) {
      // THU NHỎ: trả nội dung về chỗ cũ + gỡ cửa sổ + tháo listener kéo/đổi cỡ
      existing.ph.parentNode.insertBefore(existing.content, existing.ph);
      existing.ph.parentNode.removeChild(existing.ph);
      existing.cleanup();
      existing.win.remove();
      delete floatWins[key];
      if (btnEl) btnEl.textContent = openLabel;
      // [v1.92.31] thu nhỏ về panel ⇒ log vẫn ở cuối
      try { requestAnimationFrame(() => logScrollToBottom()); } catch (e) { /* ignore */ }
      return false;
    }
    if (!contentEl || !contentEl.parentNode) return false;
    // PHÓNG TO: đánh dấu chỗ cũ rồi đưa bảng vào cửa sổ nổi
    const ph = document.createComment('ssb-ph-' + key);
    contentEl.parentNode.insertBefore(ph, contentEl);
    const win = document.createElement('div');
    win.className = 'floatwin';
    const headEl = document.createElement('div');
    headEl.className = 'fw-head';
    headEl.title = 'Kéo để di chuyển cửa sổ';
    const titleEl = document.createElement('span');
    titleEl.className = 'fw-title';
    titleEl.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'minibtn fw-close';
    closeBtn.textContent = '✕ Thu nhỏ';
    headEl.appendChild(titleEl);
    headEl.appendChild(closeBtn);
    const bodyEl = document.createElement('div');
    bodyEl.className = 'fw-body';
    bodyEl.appendChild(contentEl);
    const rsEl = document.createElement('div');
    rsEl.className = 'rs';
    rsEl.title = 'Kéo góc này để đổi cỡ — đúp chuột để về mặc định';
    win.appendChild(headEl);
    win.appendChild(bodyEl);
    win.appendChild(rsEl);
    shadow.appendChild(win);
    // [v1.92.31] phóng to bảng log ⇒ đặt điểm nhìn ở cuối ngay khi mở
    if (contentEl && contentEl.id === 'ssb-log') {
      try {
        flushLogUI(true);
        requestAnimationFrame(() => logScrollToBottom(contentEl));
        setTimeout(() => logScrollToBottom(contentEl), 120);
      } catch (e) { /* ignore */ }
    }

    // vị trí/cỡ: đã chỉnh thì giữ qua F5, chưa thì mặc định (lúc mở mới tính theo màn hình)
    let geo = null;
    try { geo = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { /* ignore */ }
    const w = (geo && geo.w) || def.w;
    const h = (geo && geo.h) || def.h;
    win.style.width = w + 'px';
    win.style.height = h + 'px';
    win.style.left = Math.round((geo && typeof geo.left === 'number') ? geo.left : def.left()) + 'px';
    win.style.top = Math.round((geo && typeof geo.top === 'number') ? geo.top : def.top()) + 'px';

    const save = () => {
      try {
        // đọc từ style (giá trị ta tự set cho position:fixed — không phụ thuộc offset* của trình duyệt);
        // isNaN chứ KHÔNG phải ||default — 0px là hợp lệ, không được nuốt
        const px = (v, fb) => { const n = parseInt(v, 10); return isNaN(n) ? fb : n; };
        localStorage.setItem(key, JSON.stringify({
          left: px(win.style.left, 0), top: px(win.style.top, 0),
          w: px(win.style.width, def.w), h: px(win.style.height, def.h),
        }));
      } catch (e) { /* ignore */ }
    };
    // kéo tiêu đề = DI CHUYỂN, kéo góc dưới-phải = ĐỔI CỠ — giữ cửa sổ ló ≥40px trong màn hình
    let dg = null, rs = null;
    headEl.addEventListener('mousedown', (e) => {
      if (e.target && e.target.closest && e.target.closest('button')) return; // bấm nút ≠ kéo
      dg = { x: e.clientX, y: e.clientY, left: win.offsetLeft, top: win.offsetTop };
      e.preventDefault();
    });
    rsEl.addEventListener('mousedown', (e) => {
      rs = { x: e.clientX, y: e.clientY, w: win.offsetWidth, h: win.offsetHeight };
      e.preventDefault();
    });
    rsEl.addEventListener('dblclick', () => {
      win.style.width = def.w + 'px';
      win.style.height = def.h + 'px';
      win.style.left = Math.round(def.left()) + 'px';
      win.style.top = Math.round(def.top()) + 'px';
      save();
    });
    const onMove = (e) => {
      if (dg) {
        const left = Math.min(Math.max(0, dg.left + e.clientX - dg.x), Math.max(0, window.innerWidth - 60));
        const top = Math.min(Math.max(0, dg.top + e.clientY - dg.y), Math.max(0, window.innerHeight - 40));
        win.style.left = left + 'px';
        win.style.top = top + 'px';
      }
      if (rs) {
        win.style.width = Math.max(280, Math.min(window.innerWidth - 12, rs.w + e.clientX - rs.x)) + 'px';
        win.style.height = Math.max(180, Math.min(window.innerHeight - 12, rs.h + e.clientY - rs.y)) + 'px';
      }
    };
    const onUp = () => {
      if (dg || rs) save();
      dg = null;
      rs = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    closeBtn.addEventListener('click', () => {
      toggleFloat(key, contentEl, title, btnEl, openLabel, closeLabel, def);
    });
    floatWins[key] = { win, content: contentEl, ph, cleanup };
    if (btnEl) btnEl.textContent = closeLabel;
    return true;
  }

  function buildPanel() {
    const existingHost = document.getElementById(PANEL_ID);
    if (existingHost) {
      if (existingHost.getAttribute('data-tab-clip') === '1' && shadow) return;
      try { existingHost.remove(); } catch (e0) { /* ignore */ }
      shadow = null;
    }
    ensureStyle();
    const host = document.createElement('div');
    host.id = PANEL_ID;
    host.setAttribute('data-tab-clip', '1');
    host.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483646;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
        .wrap { width: 280px; background: #0f172a; color: #e2e8f0; border: 1px solid #334155;
                border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45); overflow: hidden; font-size: 12px;
                position: relative; display: flex; flex-direction: column; }
        .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #1e293b; cursor: move; }
        .title { font-weight: 700; font-size: 13px; flex: 1; color: #f8fafc; }
        .badge { font-size: 10px; padding: 2px 8px; border-radius: 999px; cursor: pointer; border: none; }
        .badge.on  { background: #16a34a; color: white; }
        .badge.off { background: #64748b; color: white; }
        .minibtn { background: #334155; color: #e2e8f0; border: none; border-radius: 6px;
                   padding: 3px 8px; cursor: pointer; font-size: 11px; }
        .minibtn:hover { background: #475569; }
        .body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
                max-height: 52vh; overflow: auto; flex: 1 1 auto; min-height: 0; }
        .label { color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
        .snippet-box { background: #1e293b; border: 1px solid #334155; border-radius: 8px;
                       padding: 8px; color: #a7f3d0; word-break: break-word; max-height: 64px; overflow: auto; }
        .row { display: flex; gap: 6px; flex-wrap: wrap; }
        button.b { border: none; border-radius: 8px; padding: 7px 10px; cursor: pointer;
                   font-size: 11px; font-weight: 600; }
        .b-blue  { background: #2563eb; color: #fff; } .b-blue:hover  { background: #1d4ed8; }
        .b-green { background: #16a34a; color: #fff; } .b-green:hover { background: #15803d; }
        .b-gray  { background: #334155; color: #e2e8f0; } .b-gray:hover { background: #475569; }
        .b-red   { background: #dc2626; color: #fff; } .b-red:hover   { background: #b91c1c; }
        button:disabled { opacity: .45; cursor: not-allowed; }
        textarea { width: 100%; min-height: 48px; resize: vertical; border-radius: 8px; border: 1px solid #334155;
                   background: #0b1220; color: #f1f5f9; padding: 8px; font-size: 12px; outline: none; }
        textarea:focus { border-color: #2563eb; }
        input[type=number] { width: 84px; background: #0b1220; color: #f1f5f9; border: 1px solid #334155;
                             border-radius: 6px; padding: 5px 6px; font-size: 11px; }
        select { background: #0b1220; color: #f1f5f9; border: 1px solid #334155;
                 border-radius: 6px; padding: 5px 6px; font-size: 11px; cursor: pointer; }
        .list { border: 1px solid #334155; border-radius: 8px; max-height: 180px; overflow: auto; background: #0b1220; }
        .item { display: flex; gap: 6px; align-items: flex-start; padding: 6px 8px; border-bottom: 1px solid #1e293b; }
        .item:last-child { border-bottom: none; }
        .item input { margin-top: 2px; }
        .item .nm { color: #f8fafc; font-weight: 600; font-size: 11px; }
        .item .sn { color: #7dd3fc; font-size: 10px; word-break: break-word; }
        .item .tm { color: #64748b; font-size: 10px; margin-left: auto; white-space: nowrap; }
        .prog { height: 8px; border-radius: 999px; background: #1e293b; overflow: hidden; }
        .prog > i { display: block; height: 100%; width: 0%; background: #22c55e; transition: width .25s; }
        .prog.scan > i { background: #38bdf8; }
        .prog-stat { font-size: 11px; font-weight: 700; color: #4ade80; text-align: center; margin-top: 4px; }
        .prog-stat.scan { color: #7dd3fc; }
        .summary-box { background: #132033; border: 1px solid #334155; border-radius: 8px; padding: 6px 8px;
                       font-size: 11px; line-height: 1.45; color: #e2e8f0; display: none; word-break: break-word; }
        /* [v1.92.31] 150 → 340px: đủ nhìn ~20 dòng một lúc và copy được đoạn dài.
           Đệm dưới để dòng cuối không dính sát mép khi tự cuộn xuống. */
        .log { background: #0b1220; border: 1px solid #334155; border-radius: 8px; padding: 8px 8px 14px;
               min-height: 120px; max-height: min(340px, 42vh); overflow: auto; font-size: 10.5px; line-height: 1.55; color: #cbd5e1;
               white-space: pre-wrap; word-break: break-word; overscroll-behavior: contain; }
        /* ===== cửa sổ PHÓNG TO (list/log): kéo tiêu đề để di chuyển, kéo góc dưới-phải để đổi cỡ ===== */
        .floatwin { position: fixed; z-index: 2147483647; background: #0f172a; color: #e2e8f0;
                    border: 1px solid #334155; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.55);
                    display: flex; flex-direction: column; overflow: hidden; font-size: 12px; }
        .fw-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #1e293b;
                   cursor: move; user-select: none; flex: 0 0 auto; }
        .fw-title { font-weight: 700; font-size: 12px; flex: 1; color: #f8fafc; }
        .fw-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 8px; }
        .fw-body .log { flex: 1 1 auto; max-height: none; height: 100%; font-size: 12px; }
        .fw-body #ssb-sec-sl { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
        .fw-body #ssb-sec-sl .saved-lists { flex: 1 1 auto; max-height: none; min-height: 0; }
        /* hộp thoại SỬA CÂU (tên + nội dung nhiều dòng) */
        .edit-ov { position: fixed; inset: 0; background: rgba(2,6,23,.55); z-index: 2147483647;
                   display: flex; align-items: center; justify-content: center; }
        .edit-card { background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 12px;
                     width: min(520px, 92vw); padding: 14px; display: flex; flex-direction: column; gap: 8px;
                     box-shadow: 0 12px 40px rgba(0,0,0,.55); }
        .edit-title { font-weight: 700; font-size: 13px; color: #f8fafc; }
        .edit-card input[type=text] { width: 100%; background: #0b1220; color: #f1f5f9; border: 1px solid #334155;
                                      border-radius: 6px; padding: 6px 8px; font-size: 12px; }
        .edit-card textarea { min-height: 120px; }
        /* tay nắm KÉO THẢ ĐỔI CỠ panel (góc dưới-phải; đúp chuột = về mặc định) */
        .rs { position: absolute; right: 0; bottom: 0; width: 20px; height: 20px; cursor: nwse-resize;
              background: linear-gradient(135deg, transparent 55%, #475569 55%, #475569 66%,
                          transparent 66%, transparent 76%, #475569 76%, #475569 87%, transparent 87%);
              border-bottom-right-radius: 12px; z-index: 5; }
        .rs:hover { background: linear-gradient(135deg, transparent 55%, #7dd3fc 55%, #7dd3fc 66%,
                    transparent 66%, transparent 76%, #7dd3fc 76%, #7dd3fc 87%, transparent 87%); }
        /* panel đã kéo cỡ → danh sách chat + log giãn ra theo */
        .wrap.sized .body { max-height: none; }
        .wrap.sized #ssb-sec-sl { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 90px; }
        .wrap.sized #ssb-sec-sl .saved-lists { flex: 1 1 auto; max-height: none; min-height: 60px; }
        .wrap.sized .log { flex: 1 1 auto; max-height: none; min-height: 60px; }
        .sl-cb { accent-color: #22c55e; margin: 0; cursor: pointer; }
        .hint { color: #64748b; font-size: 10px; line-height: 1.5; }
        .empty { color: #64748b; padding: 10px; text-align: center; }
        .count { color: #38bdf8; font-weight: 700; }
        #ssb-bubble { position: relative; display: none; background: transparent; border: none; padding: 0; cursor: grab;
                      line-height: 0; filter: drop-shadow(0 6px 14px rgba(88,101,242,.45));
                      transition: transform .15s ease; }
        #ssb-bubble:hover { transform: scale(1.1) rotate(-4deg); }
        #ssb-bubble:active { transform: scale(.96); cursor: grabbing; }
        /* [v1.92.65] BIỂU TƯỢNG GIỮ NGUYÊN 40 px — CHỈ SỐ TO LÊN.
         * Người dùng đính chính 1.92.64: "ý là cho cái số to ra thôi còn biểu tượng nhỏ như cũ
         * á". Vậy trả bóng về đúng 40×40 như 1.92.61, chỉ giữ việc phóng badge.
         * Vì bóng nhỏ nên badge PHẢI đặt CAO HƠN để không đè lên mặt logo (đo bằng số):
         *   • 1.92.61 (chữ 10 px, line-height 15, viền 1): cao 17 px, top −8
         *     ⇒ đáy badge ở +9 px ⇒ đè 9/40 = 22 % bóng (đúng phần TAI, không chạm mặt logo)
         *   • chữ 17 px, line-height 25, viền 2 ⇒ cao 29 px. Để đè đúng 9 px như bản cũ:
         *     top = −(29 − 9) = −20 px. (top −14 hay −18 sẽ đè 15/11 px = 38 %/28 % — lấn
         *     vào mặt logo.) */
        /* top: -20 (đo ở trên) */
        #ssb-bubble svg { width: 40px; height: 40px; display: block; }
        /* [v1.92.60] Số tiến trình ngay trên BÓNG LOGO (panel thu nhỏ) — nhìn được cả khi
           panel đóng, không cần mở gì. Chỉ ghi khi số đổi (updateMiniProgressUI). */
        .bubble-badge { position: absolute; left: 50%; top: -20px; transform: translateX(-50%);
                        background: #0f172a; color: #4ade80; border: 2px solid #22c55e;
                        border-radius: 999px; padding: 0 9px; font-size: 17px; font-weight: 800;
                        line-height: 25px; white-space: nowrap; letter-spacing: .1px;
                        font-variant-numeric: tabular-nums;
                        box-shadow: 0 3px 10px rgba(0,0,0,.55); pointer-events: none; }
        .bubble-badge.busy { color: #7dd3fc; border-color: #38bdf8; }
        .title .logo { width: 17px; height: 17px; vertical-align: -3px; margin-right: 3px; }
        .saved-lists { border: 1px solid #334155; border-radius: 8px; max-height: 132px; overflow: auto; background: #0b1220; }
        .sl-row { display: flex; gap: 6px; align-items: center; padding: 5px 8px; cursor: pointer; border-bottom: 1px solid #1e293b; }
        .sl-row:last-child { border-bottom: none; }
        .sl-row:hover { background: #132033; }
        .sl-row.active { background: #173052; }
        .sl-row.dragging { opacity: .55; background: #1e3a5f !important; outline: 1px dashed #38bdf8; outline-offset: -1px; }
        .saved-lists.dragging-mode { cursor: grabbing; user-select: none; -webkit-user-select: none; }
        .sl-handle { cursor: grab; color: #64748b; user-select: none; font-size: 13px; line-height: 1;
                     touch-action: none; padding: 2px 3px; border-radius: 4px; }
        .sl-handle:hover { color: #7dd3fc; }
        .sl-handle:active { cursor: grabbing; }
        .sl-handle:hover { color: #7dd3fc; }
        .sl-name { flex: 1; color: #f8fafc; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sl-n { color: #64748b; }
        .sl-btn { border: none; background: transparent; cursor: pointer; color: #94a3b8; font-size: 12px; padding: 2px 5px; border-radius: 5px; line-height: 1; }
        .sl-btn:hover { background: #1e293b; color: #f8fafc; }
      </style>
      <div class="wrap" id="ssb-wrap">
        <div class="head" id="ssb-head">
          <span class="title"><svg class="logo" viewBox="0 0 50 52" width="17" height="17" xmlns="http://www.w3.org/2000/svg"><path d="M10 2 L14 11" stroke="#5865F2" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M40 2 L36 11" stroke="#5865F2" stroke-width="5" stroke-linecap="round" fill="none"/><rect x="0" y="12" width="50" height="40" rx="6" fill="#5865F2"/><rect x="12" y="31" width="12" height="4" rx="2" fill="#fff"/><rect x="26" y="31" width="12" height="4" rx="2" fill="#fff"/></svg>BOTFAKE <span style="color:#64748b;font-weight:400;font-size:11px">v${APP_VERSION}</span></span>
          <button class="badge on" id="ssb-toggle" title="Bật/tắt tính năng">BẬT</button>
          <button class="badge on" id="ssb-tab" title="Bật/tắt GỬI BẰNG PHÍM TAB — TẮT thì phím Tab chỉ chuyển ô như bình thường, muốn gửi bấm nút ▶">TAB: BẬT</button>
          <button class="minibtn" id="ssb-close" title="Tắt panel (F5 hoặc Alt+Shift+B để hiện lại)">✕</button>
          <button class="minibtn" id="ssb-min" title="Thu nhỏ">—</button>
        </div>
        <div class="body" id="ssb-body">
          <div class="row" style="align-items:center;gap:6px">
            <button class="b b-green" id="ssb-send" style="flex:1" title="Bấm nút này hoặc nhấn phím Tab để chạy (có bảng xác nhận trước khi gửi)">▶ Chạy (Tab)</button>
            <button class="b b-red" id="ssb-stop" disabled style="flex:1">⏹ Dừng</button>
          </div>
          <div class="prog"><i id="ssb-bar"></i></div>
          <div class="prog-stat" id="ssb-progstat">0% · ✅ 0/0</div>
          <div>
            <div class="label">1) Đang chọn</div>
            <div class="snippet-box" id="ssb-target">Chưa chọn — bấm ⚡ Tải danh sách rồi <b>Chọn tất cả</b></div>
            <div class="row" style="margin-top:6px">
              <button class="b b-blue" id="ssb-selall" title="Chọn toàn bộ chat trong danh sách đã tải">☑ Chọn tất cả</button>
              <button class="b b-gray" id="ssb-deselect-one" title="Bấm nút này, rồi click một đoạn chat trên danh sách Pancake để bỏ chọn chat đó">⊖ Bỏ chọn 1 chat</button>
              <button class="b b-gray" id="ssb-to-end">⬇ Từ đây xuống cuối</button>
              <button class="b b-gray" id="ssb-clear">Xóa</button>
            </div>
          </div>
          <div class="row" style="margin:2px 0 4px;align-items:center">
            <button class="b b-gray" id="ssb-scan" title="Bấm là tải lại TOÀN BỘ danh sách từ đầu (không cần giữ Shift) — các nút chọn khác không tự tải">⚡ Tải danh sách</button>
            <span class="hint">đã chọn: <span class="count" id="ssb-count">0</span></span>
          </div>
          <div class="prog scan"><i id="ssb-scanbar"></i></div>
          <div class="prog-stat scan" id="ssb-scanstat">Tải DS: 0%</div>
          <div>
            <div class="row" style="align-items:center;justify-content:space-between;margin-bottom:4px">
              <div class="label" style="margin:0">2) Câu cần gửi</div>
              <button class="b b-blue" id="ssb-msg-mode" type="button" style="padding:3px 8px;font-size:11px" title="Bấm để chuyển đổi qua lại giữa 2 chế độ: Gửi bằng câu trên giao diện ↔ Gửi bằng dữ liệu đang copy trên Clipboard">📝 Chế độ: Câu trên giao diện</button>
            </div>
            <textarea id="ssb-msg" placeholder="Nhập 1 câu sẽ gửi cho tất cả đoạn chat ở trên…"></textarea>
            <div class="snippet-box" id="ssb-clip-box" style="display:none;border-color:#a855f7;color:#f3e8ff;background:#1e1033">
              📋 <b>Đang bật: Gửi bằng dữ liệu trên Clipboard</b><br>
              <span id="ssb-clip-preview-text" style="color:#d8b4fe;font-size:10.5px">Khi bấm <b>▶ Chạy</b> hoặc nhấn phím <b>Tab</b>, script sẽ tự lấy nội dung đang copy trên Clipboard và hiện hộp xác nhận trước khi gửi.</span>
            </div>
            <div class="row" style="align-items:center">
              <button class="b b-gray" id="ssb-img-pick" title="Bấm nút này rồi CLICK vào 1 ảnh bất kỳ trên giao diện Pancake (ảnh trong chat, ảnh mẫu…) — ảnh đó sẽ được dùng làm ảnh gửi">🖼 Chọn ảnh trên trang</button>
              <span class="hint" id="ssb-img-info">Chưa chọn — bấm nút rồi click 1 ảnh trên giao diện (hoặc Ctrl+V dán ảnh)</span>
              <button class="b b-gray" id="ssb-img-clear" style="display:none">✕ Bỏ ảnh</button>
            </div>
            <div id="ssb-img-preview-wrap" style="display:none;margin:2px 0 4px"><img id="ssb-img-preview" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #475569;display:block" title="Ảnh đang chọn để gửi"></div>
            <div class="row" style="align-items:center">
              <button class="b b-gray" id="ssb-qr-capture" title="Bắt câu như gửi tay: bấm nút này (hoặc Alt+Q) rồi gõ / trong khung chat Pancake, click vào 1 câu — BOTFAKE bắt câu đó (cả ảnh) làm câu gửi, KHÔNG gửi vào chat đang mở">🎯 Bắt câu (Alt+Q)</button>
              <span class="hint" id="ssb-qr-info">Câu nhanh: chưa chọn — gõ tay như cũ</span>
              <button class="b b-gray" id="ssb-qr-clear" style="display:none" title="Bỏ chọn câu nhanh">✕</button>
            </div>
            <div id="ssb-qr-photos" style="display:none;margin:2px 0 4px;gap:6px;flex-wrap:wrap;align-items:center" title="Ảnh của câu nhanh đang chọn — bấm vào ảnh để mở lớn"></div>
            <div class="row" style="align-items:center">
              <span class="hint">Mỗi đợt:</span>
              <input type="number" id="ssb-wave" value="200" min="1" max="100000" step="25" style="width:72px" title="Số chat mỗi đợt Wave 200 (mặc định 200)">
              <span class="hint">chat — nghỉ</span>
              <input type="number" id="ssb-gap" value="250" min="0" step="50" style="width:72px" title="Nghỉ tối đa giữa các đợt; cổng Wave 200 tự điều chỉnh theo tải">
              <span class="hint">ms giữa các đợt</span>
              <label class="hint" style="display:flex;align-items:center;gap:4px;cursor:pointer" title="Bắn API không chờ server xác nhận — nhanh hơn hẳn; chat bị API từ chối rõ ràng sẽ tự bù Socket/Ext trong nền">
                <input type="checkbox" id="ssb-quick" checked style="accent-color:#22c55e;margin:0"> ⚡ Gửi nhanh
              </label>
            </div>
            <div class="row" style="align-items:center">
              <label class="hint" style="display:flex;align-items:center;gap:4px;cursor:pointer" title="Khi Alt/Ctrl nhấp chọn chuỗi: KHÔNG cho app tự cuộn danh sách về đầu mỗi lần đổi điểm cuối. Bỏ tick nếu thấy cần hành vi cũ.">
                <input type="checkbox" id="ssb-noscroll" checked style="accent-color:#22c55e;margin:0"> Giữ nguyên vị trí danh sách khi chọn chuỗi
              </label>
            </div>
          </div>
          <div class="row" style="align-items:center;justify-content:space-between">
            <span class="label">LOG <span id="ssb-logcount" style="color:#64748b;font-weight:400;text-transform:none;letter-spacing:0">0 dòng</span></span>
            <span style="display:flex;gap:4px;align-items:center">
              <button class="minibtn" id="ssb-logcopy" title="Copy TOÀN BỘ log của lượt này (không chỉ phần đang thấy)">📋 Copy log</button>
              <button class="minibtn" id="ssb-logsave" title="Tải file .txt: log gọn + SỔ KIỂM CHỨNG TỪNG CHAT (id, tên, mọi kết quả, giờ) — dùng để truy ca xác nhận sai gây gửi lặp">💾 .txt</button>
              <button class="minibtn" id="ssb-logzoom" title="Phóng to / thu nhỏ bảng log — kéo tiêu đề để di chuyển, kéo góc dưới-phải để đổi cỡ">⛶ Phóng to</button>
            </span>
          </div>
          <div class="summary-box" id="ssb-summary"></div>
          <!-- [v1.92.61] Ô LOG ĐÃ BỎ HẲN KHỎI PANEL — giao diện gọn lại đúng như người dùng yêu cầu:
               "phần ô log bỏ đi sẽ làm giao diện gọn lại". Thanh tiến trình vẫn ở DƯỚI NÚT CHẠY
               như trước (.prog #ssb-bar + #ssb-progstat, xem flushProgressUi). Log chỉ sống trong
               cửa sổ "⛶ Phóng to log"; khi panel được THU NHỎ thành bóng logo thì số tiến trình
               hiện trên badge của bóng (#ssb-bubble-badge). -->
<div id="ssb-logwrap" style="display:none"><div class="log" id="ssb-log"></div></div>
        </div>
        <div class="rs" id="ssb-rs" title="Kéo góc này để đổi cỡ panel — đúp chuột để về mặc định"></div>
      </div>
      <button id="ssb-bubble" type="button" style="display:none" title="Mở panel BOTFAKE (bấm để mở lại)"><span id="ssb-bubble-badge" class="bubble-badge" style="display:none">0/0</span><svg viewBox="0 0 50 52" width="40" height="40" xmlns="http://www.w3.org/2000/svg"><path d="M10 2 L14 11" stroke="#5865F2" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M40 2 L36 11" stroke="#5865F2" stroke-width="5" stroke-linecap="round" fill="none"/><rect x="0" y="12" width="50" height="40" rx="6" fill="#5865F2"/><rect x="12" y="31" width="12" height="4" rx="2" fill="#fff"/><rect x="26" y="31" width="12" height="4" rx="2" fill="#fff"/></svg></button>
    `;
    (document.body || document.documentElement).appendChild(host);
    wireEvents(shadow);
    render();
    watchList(); // tự tô lại màu khi virtual list render lại dòng
  }

  function wireEvents(root) {
    const on = (id, ev, fn) => {
      const el = root.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };
    on('ssb-toggle', 'click', () => {
      state.enabled = !state.enabled;
      if (!state.enabled) state.deselectMode = false;
      highlightRows(); // bật: tô lại / tắt: gỡ hết màu
      render();
    });
    on('ssb-tab', 'click', () => {
      state.tabSend = !state.tabSend;
      try { localStorage.setItem('ssb_tab_send_on', state.tabSend ? '1' : '0'); } catch (e0) { /* ignore */ }
      logLine(state.tabSend
        ? '⌨️ ĐÃ BẬT: bấm phím Tab = mở hộp xác nhận gửi (vẫn hỏi trước khi gửi).'
        : '⌨️ ĐÃ TẮT: phím Tab chỉ chuyển ô như bình thường, muốn gửi thì bấm nút ▶.');
      render();
    });
    on('ssb-min', 'click', () => {
      // thu nhỏ = biến panel thành BÓNG LOGO (con quỷ botfake) ở góc màn hình
      const wrapEl = root.getElementById('ssb-wrap');
      const bubble = root.getElementById('ssb-bubble');
      if (wrapEl) wrapEl.style.display = 'none';
      if (bubble) bubble.style.display = 'block';
    });
    on('ssb-bubble', 'click', () => {
      if (justDragged) return; // vừa KÉO bóng xong → không mở panel
      // bấm bóng logo → mở lại panel đầy đủ
      const wrapEl = root.getElementById('ssb-wrap');
      const bubble = root.getElementById('ssb-bubble');
      if (wrapEl) wrapEl.style.display = '';
      if (bubble) bubble.style.display = 'none';
    });
    // [v1.92.32] COPY / TẢI TOÀN BỘ LOG của lượt (đọc từ logAll, không phải phần đang thấy)
    const copyTextToClipboard = (txt) => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(txt).then(() => true).catch(() => false);
        }
      } catch (e) { /* rơi xuống cách cũ */ }
      try {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return Promise.resolve(!!ok);
      } catch (e2) { return Promise.resolve(false); }
    };
    on('ssb-logcopy', 'click', () => {
      flushErrGroup(); // [v1.92.32] in nốt dòng gộp đang chờ 2 giây để bản copy không thiếu dòng cuối
      const txt = (logAll.length ? logAll : state.log).join('\n')
        + '\n\n(Sổ kiểm chứng TỪNG CHAT — dùng khi nghi gửi lặp — nằm trong file "💾 .txt")';
      copyTextToClipboard(txt).then((ok) => {
        logLine(ok ? ('📋 Đã copy ' + logAll.length + ' dòng log vào clipboard')
          : '⛔ Trình duyệt chặn clipboard — bấm "💾 .txt" để tải file thay thế');
      });
    });
    on('ssb-logsave', 'click', () => {
      try {
        flushErrGroup();
        // [v1.92.33] File .txt = log gọn + SỔ KIỂM CHỨNG TỪNG CHAT (không gộp). Đây là bản đủ để
        // truy khi có ca xác nhận sai gây lặp: mỗi chat có id, tên, mọi kết quả và thời điểm.
        const head = ['BOTFAKE ' + APP_VERSION + ' · log lượt gửi',
          'Xuất lúc ' + fmtClock(Date.now()) + ' · ' + logAll.length + ' dòng log gọn · '
          + auditRows.length + ' dòng sổ kiểm chứng',
          'Mục 1: LOG GỌN (đúng như bảng log trên màn hình).',
          'Mục 2: SỔ KIỂM CHỨNG TỪNG CHAT — không gộp, để tra ca xác nhận sai gây gửi lặp.',
          ''].join('\n');
        const txt = head + (logAll.length ? logAll : state.log).join('\n') + '\n\n' + buildAuditText() + '\n';
        const d = new Date();
        const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
          + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + String(d.getSeconds()).padStart(2, '0');
        const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'botfake-log-' + stamp + '.txt';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e2) { /* ignore */ } }, 1000);
        logLine('💾 Đã tải log ra file botfake-log-' + stamp + '.txt · ' + logAll.length + ' dòng log gọn + '
          + auditRows.length + ' dòng sổ kiểm chứng từng chat');
      } catch (e) { logLine('⛔ Không tạo được file log: ' + (e && e.message || e)); }
    });
    // phóng to bảng LOG / bảng LIST → cửa sổ nổi kéo thả + đổi cỡ (xem toggleFloat)
    on('ssb-logzoom', 'click', () => {
      const el = root.getElementById('ssb-log');
      const btn = root.getElementById('ssb-logzoom');
      if (!el) return;
      const wasOpen = !!(floatWins && floatWins.ssb_win_log);
      /* [v1.92.60] Log CHỈ vẽ khi cửa sổ này mở. Ngay TRƯỚC khi đưa khung log ra cửa sổ nổi
       * phải vẽ một lần (không thì thấy khung trống); ngay SAU khi thu nhỏ thì thôi không vẽ. */
      if (!wasOpen) { try { logRenderedSig = ''; flushLogUI(true); } catch (eA) { /* ignore */ } }
      toggleFloat('ssb_win_log', el, 'LOG', btn, '⛶ Phóng to log', '🗕 Thu nhỏ log', {
        w: 640, h: 480,
        left: () => 24,
        top: () => Math.round(window.innerHeight * 0.1),
      });
      if (!wasOpen) {
        // vừa mở: vẽ lại theo cỡ cửa sổ nổi + đặt điểm nhìn ở cuối
        try {
          logRenderedSig = '';
          flushLogUI(true);
          requestAnimationFrame(() => logScrollToBottom(el));
        } catch (eO) { /* ignore */ }
      }
    });
    on('ssb-close', 'click', () => {
      const host = document.getElementById(PANEL_ID);
      if (host) host.style.display = 'none'; // F5 hoặc Alt+Shift+B để hiện lại
    });
    // chọn ảnh kèm theo: CLICK VÀO 1 ẢNH TRÊN GIAO DIỆN (không mở hộp chọn file nữa)
    const imgInfo = root.getElementById('ssb-img-info');
    const imgClearBtn = root.getElementById('ssb-img-clear');
    const imgPreviewWrap = root.getElementById('ssb-img-preview-wrap');
    const imgPreview = root.getElementById('ssb-img-preview');
    const clearQrSelection = () => {
      if (!state.quickReply) return;
      // chọn ảnh tay → bỏ câu nhanh đang chọn (2 nguồn ảnh không dùng chung 1 lượt)
      state.quickReply = null;
      try { localStorage.removeItem('ssb_qr_v1'); } catch (e) { /* ignore */ }
      const qi = root.getElementById('ssb-qr-info');
      if (qi) qi.textContent = 'Câu nhanh: chưa chọn — gõ tay như cũ';
      const qc = root.getElementById('ssb-qr-clear');
      if (qc) qc.style.display = 'none';
      const qp = root.getElementById('ssb-qr-photos');
      if (qp) { qp.style.display = 'none'; qp.innerHTML = ''; }
    };
    const updateImgPreview = () => {
      const im = state.image;
      if (imgPreview && imgPreviewWrap) {
        if (im && im.url) { imgPreview.src = im.url; imgPreviewWrap.style.display = ''; }
        else { imgPreview.removeAttribute('src'); imgPreviewWrap.style.display = 'none'; }
      }
      if (imgClearBtn) imgClearBtn.style.display = im ? '' : 'none';
    };
    const setImg = (file) => {
      if (file) clearQrSelection();
      if (state.image && state.image.file && state.image.url) { try { URL.revokeObjectURL(state.image.url); } catch (e) { /* ignore */ } }
      state.image = file ? { file, name: file.name || 'ảnh', url: URL.createObjectURL(file), w: 0, h: 0 } : null;
      // đọc kích thước ảnh — request thật của app gửi kèm width/height
      if (file && state.image && typeof createImageBitmap === 'function') {
        createImageBitmap(file).then((bm) => {
          if (state.image && state.image.file === file) { state.image.w = bm.width; state.image.h = bm.height; }
          if (bm.close) bm.close();
        }).catch(() => { /* không đọc được thì gửi thiếu width/height */ });
      }
      if (imgInfo) {
        imgInfo.textContent = file
          ? '📷 ' + (file.name || 'ảnh') + ' (' + Math.round((file.size || 0) / 1024) + ' KB)'
          : 'Chưa chọn — bấm “Chọn ảnh trên trang” rồi click 1 ảnh trên giao diện';
      }
      updateImgPreview();
    };
    // URL ảnh trên trang hay là bản thu nhỏ (_thumb) → gỡ hậu tố về ảnh GỐC
    const originalImgUrl = (u) => String(u || '').split('?')[0].replace(/_thumb(\.[a-z0-9]+)$/i, '$1');
    const setImgUrl = (url, name) => {
      const clean = originalImgUrl(url);
      if (!clean) return;
      clearQrSelection();
      if (state.image && state.image.file && state.image.url) { try { URL.revokeObjectURL(state.image.url); } catch (e) { /* ignore */ } }
      state.image = { file: null, url: clean, name: name || 'ảnh trên trang', w: 0, h: 0, web: true };
      const probe = new Image();
      probe.onload = () => {
        if (state.image && state.image.url === clean) { state.image.w = probe.naturalWidth || 0; state.image.h = probe.naturalHeight || 0; }
      };
      probe.src = clean;
      if (imgInfo) imgInfo.textContent = '🖼 Đã chọn ảnh trên trang: ' + (name || clean.split('/').pop() || 'ảnh');
      updateImgPreview();
      logLine('🖼 Đã chọn 1 ảnh trên giao diện để gửi: ' + (name || clean));
    };
    // ===== CHẾ ĐỘ CHỌN ẢNH TRÊN TRANG: bấm nút → rê chuột thấy ảnh nào viền tím, click là chọn =====
    const IMG_PICK_BADGE_ID = 'ssb-img-pick-badge';
    let imgPickHover = null;
    const clearImgPickHover = () => {
      if (imgPickHover) { try { imgPickHover.style.outline = ''; imgPickHover.style.cursor = ''; } catch (e) { /* ignore */ } imgPickHover = null; }
    };
    const setImgPickBadge = (on2) => {
      let b = document.getElementById(IMG_PICK_BADGE_ID);
      if (on2) {
        if (!b) {
          b = document.createElement('div');
          b.id = IMG_PICK_BADGE_ID;
          b.textContent = '🖼 BOTFAKE ĐANG CHỌN ẢNH: click vào 1 ẢNH bất kỳ trên giao diện để dùng ảnh đó gửi đi (Esc để hủy)';
          Object.assign(b.style, {
            position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 2147483647, background: '#5865F2', color: '#fff', padding: '8px 14px',
            borderRadius: '8px', font: '600 13px system-ui, sans-serif',
            boxShadow: '0 4px 18px rgba(0,0,0,.35)', pointerEvents: 'none', maxWidth: '92vw', textAlign: 'center',
          });
          document.body.appendChild(b);
        }
      } else if (b) b.remove();
    };
    const setImgPick = (on2, silent) => {
      if (on2 && state.qrCapture && typeof window.__botfakeQrCapture__ === 'function') window.__botfakeQrCapture__(false);
      state.imgPick = !!on2;
      setImgPickBadge(state.imgPick);
      const btn = root.getElementById('ssb-img-pick');
      if (btn) {
        btn.textContent = state.imgPick ? '🖼 Đang chọn ảnh… (Esc hủy)' : '🖼 Chọn ảnh trên trang';
        btn.style.background = state.imgPick ? '#5865F2' : '';
        btn.style.color = state.imgPick ? '#fff' : '';
      }
      if (!state.imgPick) clearImgPickHover();
      if (state.imgPick && !silent) logLine('🖼 BẬT chọn ảnh: click vào 1 ảnh bất kỳ trên giao diện Pancake để dùng ảnh đó gửi đi. Esc để hủy.');
    };
    window.__botfakeImgPick__ = (on2) => setImgPick(on2 == null ? !state.imgPick : on2);
    const findImgEl = (t) => {
      if (!t || !t.closest) return null;
      return t.closest('img') || (t.querySelector ? t.querySelector('img') : null);
    };
    const imgUrlFromElement = (t) => {
      const img = findImgEl(t);
      if (img) return img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('src') || '';
      try {
        const bg = window.getComputedStyle(t).backgroundImage;
        const m = bg && bg.match(/url\(["']?(.*?)["']?\)/);
        return m ? m[1] : '';
      } catch (e) { return ''; }
    };
    const onImgPickHover = (e) => {
      if (!state.imgPick) return;
      const t = e.target;
      if (!t || t.id === PANEL_ID) return; // hover trong panel BOTFAKE → bỏ qua
      const img = findImgEl(t);
      if (!img || img === imgPickHover) return;
      clearImgPickHover();
      imgPickHover = img;
      try { img.style.outline = '3px solid #5865F2'; img.style.cursor = 'copy'; } catch (err) { /* ignore */ }
    };
    const onImgPickClick = (e) => {
      if (!state.imgPick) return;
      const t = e.target;
      if (!t || t.id === PANEL_ID) return; // click trong panel BOTFAKE → để panel tự xử lý
      const url = imgUrlFromElement(t);
      if (!url) return; // click không trúng ảnh nào → giữ nguyên chế độ chờ
      // Chặn TRƯỚC app: click này chỉ để CHỌN ảnh, không mở ảnh/không chèn vào chat
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      setImgPick(false, true);
      const img = findImgEl(t);
      setImgUrl(url, (img && (img.alt || img.title)) || '');
    };
    document.addEventListener('mouseover', onImgPickHover, true);
    document.addEventListener('click', onImgPickClick, true);
    // ===== CÂU NHANH: chọn/bỏ chọn + khôi phục sau F5 =====
    const qrInfo = root.getElementById('ssb-qr-info');
    const qrClearBtn = root.getElementById('ssb-qr-clear');
    const qrPhotosEl = root.getElementById('ssb-qr-photos');
    const QR_STORE_KEY = 'ssb_qr_v1';
    // Hiển thị ẢNH của câu đang chọn ngay trên panel — nhìn là biết đã bắt ĐÚNG câu chưa
    // (các câu sale thường mở đầu giống hệt nhau, chỉ khác ảnh/giá phía sau).
    const renderQrPhotos = (qr) => {
      if (!qrPhotosEl) return;
      const items = (qr && Array.isArray(qr.items)) ? qr.items.filter((x) => x && x.url) : [];
      if (!items.length) { qrPhotosEl.style.display = 'none'; qrPhotosEl.innerHTML = ''; return; }
      qrPhotosEl.innerHTML = '<span class="hint">🖼 ' + items.length + ' ảnh:</span>' + items.map((x) =>
        '<a href="' + esc(x.url) + '" target="_blank" rel="noopener"><img src="' + esc(x.url) + '" '
        + 'style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid #475569;display:block"></a>').join('');
      qrPhotosEl.style.display = 'flex';
    };
    const applyQr = (qr) => {
      state.quickReply = qr || null;
      try {
        if (qr) localStorage.setItem(QR_STORE_KEY, JSON.stringify(qr));
        else localStorage.removeItem(QR_STORE_KEY);
      } catch (e) { /* ignore */ }
      if (qrInfo) qrInfo.textContent = qr
        ? '⚡ Câu nhanh "' + qr.shortcut + '" — ' + qr.items.length + ' ảnh (bind bằng content_id, nhanh như gửi tay)'
        : 'Câu nhanh: chưa chọn — gõ tay như cũ';
      if (qrClearBtn) qrClearBtn.style.display = qr ? '' : 'none';
      renderQrPhotos(qr);
    };
    // ===== BẮT CÂU NHANH NHƯ GỬI TAY (Alt+Q): gõ "/" trong khung chat app → click 1 câu trong popup =====
    // Popup câu nhanh của app (HTML thật người dùng gửi): danh sách #qr_autocomplete, mỗi câu
    // là .suggestion-element, chữ nằm ở .suggestion-text, ảnh ở .suggestion-photos img — KHÔNG
    // có .shortcut-tag nên không đối chiếu theo mã câu được. Khi chế độ
    // bắt đang bật, BOTFAKE chặn click Ở PHA BẮT (capture) trước khi app kịp chèn câu vào
    // composer → câu KHÔNG bị gửi/chèn vào chat đang mở; BOTFAKE đối chiếu shortcut với dữ
    // liệu câu nhanh của đúng page đó (fetchQuickRepliesForPage) để lấy đủ CHỮ + ẢNH
    // (content_id) rồi đặt làm câu gửi cho lượt hàng loạt — y như chọn bằng lệnh "/".
    const QR_CAPTURE_BADGE_ID = 'ssb-qr-capture-badge';
    let qrCaptureTimer = null;
    const setQrCaptureBadge = (on2) => {
      let b = document.getElementById(QR_CAPTURE_BADGE_ID);
      if (on2) {
        if (!b) {
          b = document.createElement('div');
          b.id = QR_CAPTURE_BADGE_ID;
          b.textContent = '🎯 BOTFAKE ĐANG BẮT CÂU: gõ / trong khung chat rồi CLICK vào 1 câu cần dùng (Alt+Q hoặc Esc để hủy — câu bị bắt sẽ KHÔNG gửi vào chat đang mở)';
          Object.assign(b.style, {
            position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 2147483647, background: '#5865F2', color: '#fff', padding: '8px 14px',
            borderRadius: '8px', font: '600 13px system-ui, sans-serif',
            boxShadow: '0 4px 18px rgba(0,0,0,.35)', pointerEvents: 'none', maxWidth: '92vw', textAlign: 'center',
          });
          document.body.appendChild(b);
        }
      } else if (b) b.remove();
    };
    const setQrCapture = (on2, silent) => {
      if (on2 && state.imgPick && typeof window.__botfakeImgPick__ === 'function') window.__botfakeImgPick__(false);
      state.qrCapture = !!on2;
      if (qrCaptureTimer) { clearTimeout(qrCaptureTimer); qrCaptureTimer = null; }
      setQrCaptureBadge(state.qrCapture);
      const btn = root.getElementById('ssb-qr-capture');
      if (btn) {
        btn.textContent = state.qrCapture ? '🎯 Đang bắt câu… (Alt+Q hủy)' : '🎯 Bắt câu (Alt+Q)';
        btn.style.background = state.qrCapture ? '#5865F2' : '';
        btn.style.color = state.qrCapture ? '#fff' : '';
      }
      if (state.qrCapture) {
        qrCaptureTimer = setTimeout(() => {
          if (state.qrCapture) {
            setQrCapture(false, true);
            logLine('🎯 Đã tự tắt chế độ bắt câu (quá 2 phút chưa chọn câu nào)');
          }
        }, 120000);
        if (!silent) logLine('🎯 BẬT bắt câu: gõ / trong khung chat Pancake → click vào câu cần dùng. BOTFAKE bắt câu đó (cả ảnh) làm câu gửi — KHÔNG gửi vào chat đang mở.');
      }
    };
    window.__botfakeQrCapture__ = (on2) => setQrCapture(on2 == null ? !state.qrCapture : on2);
    const onQrCaptureClick = (e) => {
      if (!state.qrCapture) return;
      const t = e.target;
      const item = (t && t.closest) ? t.closest('#qr_autocomplete .suggestion-element') : null;
      if (!item) return; // click ngoài popup câu nhanh → giữ nguyên chế độ chờ
      // Chặn TRƯỚC app: câu không được chèn/gửi vào chat đang mở
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      // HTML THẬT người dùng gửi cho thấy: dòng suggestion KHÔNG có .shortcut-tag, và nhiều
      // câu MỞ ĐẦU GIỐNG HỆT NHAU (chỉ khác giá/ảnh phía sau) → bản cũ đối chiếu 40 ký tự
      // đầu nên bấm dòng nào cũng trúng câu đầu tiên. Nay đối chiếu bằng: TOÀN VĂN của
      // đúng dòng đã click (lấy từ .suggestion-text, đã gột bỏ icon/<style>/<svg>) +
      // ẢNH thumbnail trong dòng + VỊ TRÍ dòng trong popup — chấm điểm từng câu, lấy
      // câu điểm cao nhất, không còn "khớp trước thắng".
      const shortcut = String(((item.querySelector('.shortcut-tag') || {}).textContent) || '').trim();
      const allItems = Array.from(document.querySelectorAll('#qr_autocomplete .suggestion-element'));
      const clickIdx = allItems.indexOf(item);
      const cleanTextOf = (el) => {
        const src = (el.querySelector && el.querySelector('.suggestion-text')) || el;
        const clone = src.cloneNode(true);
        clone.querySelectorAll('.suggestion-header-section, style, script, svg').forEach((n) => n.remove());
        return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
      };
      const photoKey = (u) => String(u || '').split('?')[0].replace(/_thumb(\.[a-z0-9]+)$/i, '$1').split('/').pop().toLowerCase();
      const clickedText = cleanTextOf(item);
      const clickedPhotos = Array.from(item.querySelectorAll('.suggestion-photos img'))
        .map((im) => im.getAttribute('src') || '').filter(Boolean);
      setQrCapture(false, true);
      (async () => {
        const pid = currentPanelPageId();
        const recs = await fetchQuickRepliesForPage(pid);
        const list = recs.map(normalizeQuickReply).filter((q) => q.text || q.items.length);
        const normT = (v) => String(v || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
        const ct = normT(clickedText);
        const cKeys = clickedPhotos.map(photoKey).filter(Boolean);
        const scoreOf = (x) => {
          let sc = 0;
          if (shortcut && x.shortcut === shortcut) sc += 10000;
          const xt = normT(x.text);
          if (ct && xt) {
            if (ct === xt) sc += 5000;
            else {
              let i = 0;
              const m = Math.min(ct.length, xt.length);
              while (i < m && ct.charCodeAt(i) === xt.charCodeAt(i)) i++;
              sc += i; // tiền tố chung càng dài càng đúng câu (phân biệt các câu mở đầu giống nhau)
              if (ct.indexOf(xt) > -1 || xt.indexOf(ct) > -1) sc += Math.min(ct.length, xt.length);
            }
          }
          if (cKeys.length && x.items && x.items.length) {
            const xKeys = x.items.map((it) => photoKey(it.url));
            cKeys.forEach((k) => { if (xKeys.indexOf(k) > -1) sc += 3000; });
          }
          return sc;
        };
        let q = null;
        let bestScore = -1;
        list.forEach((x) => { const sc = scoreOf(x); if (sc > bestScore) { bestScore = sc; q = x; } });
        // điểm suýt soát nhau (câu gần như giống hệt) → tin VỊ TRÍ dòng đã click trong popup
        if (clickIdx > -1 && list[clickIdx] && q !== list[clickIdx] && scoreOf(list[clickIdx]) >= bestScore - 30) {
          q = list[clickIdx];
          bestScore = scoreOf(q);
        }
        if (!q || bestScore < 10) {
          // Không khớp được dữ liệu app → vẫn dùng ĐÚNG dòng đã click (chữ + ảnh lấy từ popup,
          // ảnh gỡ hậu tố _thumb về ảnh gốc) còn hơn là gửi nhầm câu khác.
          if (clickedText || clickedPhotos.length) {
            q = {
              shortcut: shortcut || ('câu dòng ' + (clickIdx + 1)),
              text: clickedText,
              items: clickedPhotos.map((u) => ({ id: '', url: u.split('?')[0].replace(/_thumb(\.[a-z0-9]+)$/i, '$1'), w: 0, h: 0 })),
              parts: null,
            };
            q.parts = [{ text: q.text, items: q.items }];
            logLine('🎯 Không khớp được dữ liệu câu nhanh của app — dùng thẳng nội dung dòng ' + (clickIdx + 1) + ' vừa click (' + q.items.length + ' ảnh từ popup).');
          }
        }
        if (!q) {
          logLine('⚠ Đã bắt được click nhưng không đọc được nội dung dòng đã chọn — bấm 🎯 Bắt câu rồi click lại.');
          return;
        }
        setImg(null); // bỏ ảnh chọn tay — dùng ảnh của câu vừa bắt
        applyQr({ shortcut: q.shortcut, text: q.text, pageId: pid, items: q.items, parts: q.parts });
        const msgEl = root.getElementById('ssb-msg');
        if (msgEl) msgEl.value = q.text;
        // dọn đúng ký tự lệnh còn sót trong composer (chỉ khi composer đang chứa đúng "/" hoặc đúng shortcut)
        try {
          const comp = document.getElementById('replyBoxComposer');
          if (comp && (comp.value.trim() === '/' || (shortcut && comp.value.trim() === shortcut))) {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
            if (setter && setter.set) setter.set.call(comp, ''); else comp.value = '';
            comp.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } catch (e2) { /* composer giữ nguyên cũng không sao — chưa hề gửi */ }
        logLine('🎯 ĐÃ BẮT câu "' + q.shortcut + '" (' + q.items.length + ' ảnh, ' + q.text.length + ' ký tự chữ' + (q.parts && q.parts.length > 1 ? ', ' + q.parts.length + ' đoạn — sẽ gửi lần lượt theo thứ tự' : '') + ') — bấm ▶ Chạy để gửi cho danh sách đã chọn');
      })().catch((err) => logLine('⚠ Bắt câu lỗi: ' + (err && err.message || err)));
    };
    document.addEventListener('click', onQrCaptureClick, true);
    on('ssb-qr-capture', 'click', () => setQrCapture(!state.qrCapture));
    on('ssb-qr-clear', 'click', () => { applyQr(null); });
    // khôi phục câu nhanh đã chọn từ lần trước (dữ liệu người dùng phải sống qua F5)
    try {
      const savedQr = JSON.parse(localStorage.getItem(QR_STORE_KEY) || 'null');
      if (savedQr && savedQr.shortcut && Array.isArray(savedQr.items) && savedQr.items.length) {
        state.quickReply = savedQr;
        if (qrInfo) qrInfo.textContent = '⚡ Câu nhanh "' + savedQr.shortcut + '" (' + savedQr.items.length + ' ảnh) — đã lưu từ trước, bấm Chạy là dùng';
        if (qrClearBtn) qrClearBtn.style.display = '';
        renderQrPhotos(savedQr);
      }
    } catch (e) { /* ignore */ }
    on('ssb-img-pick', 'click', () => setImgPick(!state.imgPick));
    on('ssb-img-clear', 'click', () => {
      setImgPick(false, true);
      setImg(null);
    });
    // Ctrl+V: copy ảnh (screenshot, ảnh trên web…) rồi dán thẳng vào trang
    document.addEventListener('paste', (e) => {
      try {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        // đang gõ trong ô nhập của app (composer/comment…) → để app tự xử lý, không cướp paste
        const t = e.target;
        const editable = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
        if (editable && !(t && t.id === PANEL_ID)) return;
        let file = null;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it && it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) {
            file = it.getAsFile();
            if (file) break;
          }
        }
        if (!file) return; // clipboard không có ảnh → paste chữ bình thường
        e.preventDefault();
        if (!file.name) {
          // bitmap copy (screenshot) thường không có tên file
          try { file = new File([file], 'clipboard.png', { type: file.type || 'image/png' }); } catch (e2) { /* giữ file gốc */ }
        }
        setImg(file);
        logLine('📷 Đã dán ảnh từ clipboard: ' + (file.name || 'ảnh'));
      } catch (err) { /* ignore */ }
    });
    on('ssb-deselect-one', 'click', () => {
      if (!state.enabled || state.sendListFrozen || state.confirmingSend) return;
      state.deselectMode = !state.deselectMode;
      if (state.deselectMode) state.pickMode = false;
      logLine(state.deselectMode
        ? '👆 Bỏ chọn 1 chat: giờ hãy click đúng dòng chat trong danh sách Pancake (Esc để hủy).'
        : 'Đã hủy chế độ bỏ chọn 1 chat.');
      render();
    });
    on('ssb-selall', 'click', async () => {
      if (state.sendListFrozen) return;
      if (!state.allRows || !state.allRows.size || state.allRowsPartial) {
        logLine('⚡ Chưa tải đủ danh sách — tự tải toàn bộ rồi chọn tất cả…');
        await scanFullList({ full: true, restartIfBusy: true, skipIfBusy: true });
      }
      const rows = sourceRows();
      if (!rows.length) {
        logLine('⚠ Không có chat nào trong danh sách.');
        render();
        return;
      }
      state.mode = 'all';
      state.target = null;
      state.rangeStart = null;
      state.rangeEnd = null;
      computeMatches();
      const skippedUnavailable = state.matches.filter((m) => m.knownUnavailable).length;
      logLine('☑ Đã tải ' + state.matches.length + ' chat; đã chọn ' + (state.matches.length - skippedUnavailable)
        + ', tự bỏ chọn ' + skippedUnavailable + ' ID lỗi đã nhớ');
      render();
    });
    on('ssb-to-end', 'click', async () => {
      if (state.sendListFrozen) return;
      // Chọn TẤT CẢ chat từ chat đang mở (trong app) trở xuống cuối danh sách
      const info = selectedRowInfo();
      if (!info) {
        logLine('⚠ Không có chat nào đang được chọn — hãy bấm mở chat đó trong danh sách trước');
        render();
        return;
      }
      const btn = root.getElementById('ssb-to-end');
      if (btn) btn.disabled = true;
      try {
        if (normalizeListForReuse()) {
          logLine('⬇ Dùng danh sách đã tải (' + state.allRows.size + ' chat, ' + listAgeText()
            + ' trước) để lấy từ ' + (info.name || info.id) + ' tới cuối — KHÔNG gọi lại API.');
        } else {
          logLine('⚡ Chưa có danh sách — tải một lần để lấy từ ' + (info.name || info.id) + ' tới cuối…');
          await scanFullList({ full: true, restartIfBusy: true });
        }
        const rows = sourceRows();
        const idx = rows.findIndex((r) => r.id === info.id);
        if (idx < 0) {
          logLine('⚠ Không tìm thấy chat đang chọn trong danh sách — bấm "⚡ Tải danh sách" rồi làm lại');
          return;
        }
        const last = rows[rows.length - 1];
        state.mode = 'range';
        state.target = null;
        state.rangeStart = {
          id: info.id, name: info.name, snippet: info.snippet,
          snippetRaw: info.snippetRaw, time: info.time,
        };
        state.rangeEnd = {
          id: last.id, name: last.name, snippet: last.snippet,
          snippetRaw: last.snippetRaw, time: last.time,
        };
        computeMatches();
        logLine('⬇ CHỌN TỪ ĐÂY XUỐNG CUỐI: ' + (info.name || info.id) + ' → cuối danh sách — '
          + state.matches.length + ' chat trong lựa chọn');
        schedulePreloadSelectedChats(true);
      } finally {
        if (btn) btn.disabled = false;
        render();
      }
    });
    on('ssb-clear', 'click', () => {
      if (state.sendListFrozen) return;
      clearSelection();
      logLine('Đã xóa lựa chọn');
      render();
    });
    on('ssb-scan', 'click', async (e) => {
      if (state.sendListFrozen) return;
      if (state.scanning) {
        state.scanStopRequested = true;
        logLine('⏹ Đã yêu cầu dừng tải danh sách — dùng ngay số chat vừa tải!');
        applyScanButtons();
        return;
      }
      // [v1.92.43d] Bấm ⚡ = TẢI MỚI (không cần SHIFT). Không còn nhánh "dùng lại danh sách" ở đây.
      await scanFullList({ full: true, force: true });
      render();
    });
    // Nhóm chat của lượt gửi gần nhất — chọn lại tại chỗ, không quét lại danh sách
    // ===== KHÔI PHỤC SAU F5: câu đang tick + ô nội dung đang gõ + nhật ký — dữ liệu không mất =====
    try {
      const ui = JSON.parse(localStorage.getItem(UI_KEY) || 'null');
      if (ui && ui.msg) {
        const msgEl3 = root.getElementById('ssb-msg');
        if (msgEl3 && !msgEl3.value) msgEl3.value = String(ui.msg);
      }
      const oldLog = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
      if (Array.isArray(oldLog) && oldLog.length) {
        state.log = oldLog.slice(-1500);
        // [v1.92.32] sau F5 vẫn copy/tải được cả phần log đã khôi phục
        logAll.length = 0;
        for (let li = 0; li < state.log.length; li++) logAll.push(state.log[li]);
        const elLog = root.getElementById('ssb-log');
        /* [v1.92.60] Chỉ vẽ khung log nếu cửa sổ phóng to đang mở (xem flushLogUI). */
        if (elLog && logWindowOpen()) elLog.textContent = state.log.join('\n');
        const cntEl = root.getElementById('ssb-logcount');
        if (cntEl) cntEl.textContent = logAll.length + ' dòng';
      }
      const oldSum = localStorage.getItem(SUMMARY_LS_KEY) || '';
      if (oldSum) {
        const elSum = root.getElementById('ssb-summary');
        if (elSum) { elSum.style.display = ''; elSum.innerHTML = oldSum; }
      }
    } catch (e) { /* ignore — hỏng dữ liệu phụ thì làm việc mới */ }
    // ô nội dung đang gõ: lưu dần — F5 không mất chữ đã gõ dở
    {
      const msgElD = root.getElementById('ssb-msg');
      if (msgElD) {
        let tD = null;
        msgElD.addEventListener('input', () => {
          if (tD) clearTimeout(tD);
          tD = setTimeout(persistUiState, 400);
        });
      }
    }
    // ===== KÉO THẢ ĐỔI CỠ PANEL (tay nắm góc dưới-phải; đúp chuột = về mặc định) =====
    {
      const rsEl = root.getElementById('ssb-rs');
      const wrapEl = root.getElementById('ssb-wrap');
      const applySize = (w, h, save) => {
        wrapEl.classList.add('sized');
        wrapEl.style.width = w + 'px';
        wrapEl.style.height = h + 'px';
        if (save) {
          try { localStorage.setItem('ssb_panel_size', JSON.stringify({ w: w, h: h })); } catch (e) { /* ignore */ }
        }
      };
      if (rsEl && wrapEl) {
        try {
          const saved = JSON.parse(localStorage.getItem('ssb_panel_size') || 'null');
          if (saved && saved.w && saved.h) applySize(saved.w, saved.h, false);
        } catch (e) { /* ignore */ }
        let rsDrag = null;
        rsEl.addEventListener('mousedown', (e) => {
          rsDrag = { x: e.clientX, y: e.clientY, w: wrapEl.offsetWidth, h: wrapEl.offsetHeight };
          e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
          if (!rsDrag) return;
          const w = Math.max(300, Math.min(window.innerWidth - 24, rsDrag.w + e.clientX - rsDrag.x));
          const h = Math.max(260, Math.min(window.innerHeight - 24, rsDrag.h + e.clientY - rsDrag.y));
          applySize(w, h, false);
        });
        window.addEventListener('mouseup', () => {
          if (!rsDrag) return;
          rsDrag = null;
          try {
            localStorage.setItem('ssb_panel_size',
              JSON.stringify({ w: wrapEl.offsetWidth, h: wrapEl.offsetHeight }));
          } catch (e) { /* ignore */ }
        });
        rsEl.addEventListener('dblclick', () => {
          wrapEl.classList.remove('sized');
          wrapEl.style.width = '';
          wrapEl.style.height = '';
          try { localStorage.removeItem('ssb_panel_size'); } catch (e) { /* ignore */ }
        });
      }
    }
    // thiết lập gửi: nạp giá trị đã lưu (giữ qua F5) + ghi lại khi chỉnh
    {
      const waveEl = root.getElementById('ssb-wave');
      const gapEl = root.getElementById('ssb-gap');
      const quickEl = root.getElementById('ssb-quick');
      const noScrollEl = root.getElementById('ssb-noscroll');
      try {
        const w = localStorage.getItem('ssb_wave_size_w200_v1');
        if (w && waveEl) waveEl.value = w;
        const g = localStorage.getItem('ssb_wave_gap_w200_v1');
        if (g !== null && g !== '' && gapEl) gapEl.value = g;
        const q = localStorage.getItem('ssb_quick');
        if (q !== null && q !== '' && quickEl) quickEl.checked = q !== '0';
        const ns = localStorage.getItem('ssb_keep_list_on_select');
        if (ns !== null && ns !== '' && noScrollEl) noScrollEl.checked = ns !== '0';
        if (noScrollEl) state.keepListOnSelect = noScrollEl.checked;
      } catch (e) { /* ignore */ }
      if (noScrollEl) noScrollEl.addEventListener('change', () => {
        state.keepListOnSelect = noScrollEl.checked;
        try { localStorage.setItem('ssb_keep_list_on_select', noScrollEl.checked ? '1' : '0'); } catch (e) { /* ignore */ }
        logLine(noScrollEl.checked
          ? '🔒 Chọn chuỗi: giữ nguyên vị trí danh sách (app không tự cuộn).'
          : '↕ Chọn chuỗi: để app tự cuộn danh sách như mặc định.');
      });
      if (waveEl) waveEl.addEventListener('change', () => {
        try { localStorage.setItem('ssb_wave_size_w200_v1', String(waveEl.value)); } catch (e) { /* ignore */ }
      });
      if (gapEl) gapEl.addEventListener('change', () => {
        try { localStorage.setItem('ssb_wave_gap_w200_v1', String(gapEl.value)); } catch (e) { /* ignore */ }
      });
      if (quickEl) quickEl.addEventListener('change', () => {
        try { localStorage.setItem('ssb_quick', quickEl.checked ? '1' : '0'); } catch (e) { /* ignore */ }
      });
    }
    // làm nóng Socket NGAY khi mở panel — kịp kết nối trước khi user bấm Gửi
    // (kể cả khi gửi vùi thì socket cũng đã sẵn, không còn cảnh 'Socket không kết nối')
    try {
      const st0 = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      const pagesArr = (st0 && st0.pages && st0.pages.activated) || [];
      warmUpSockets(pagesArr.map((x) => ({ pageId: x && x.id })));
    } catch (e) { /* ignore */ }
    const applyMsgSourceModeUI = () => {
      const modeBtn = root.getElementById('ssb-msg-mode');
      const msgEl2 = root.getElementById('ssb-msg');
      const clipBox = root.getElementById('ssb-clip-box');
      const isClip = state.msgSource === 'clipboard';
      if (modeBtn) {
        modeBtn.textContent = isClip ? '📋 Chế độ: Dữ liệu Clipboard' : '📝 Chế độ: Câu trên giao diện';
        modeBtn.style.background = isClip ? '#9333ea' : '#2563eb';
        modeBtn.style.color = '#fff';
      }
      if (msgEl2) msgEl2.style.display = isClip ? 'none' : '';
      if (clipBox) clipBox.style.display = isClip ? '' : 'none';
    };
    applyMsgSourceModeUI();
    on('ssb-msg-mode', 'click', async () => {
      state.msgSource = (state.msgSource === 'clipboard') ? 'ui' : 'clipboard';
      try { localStorage.setItem(MSG_MODE_KEY, state.msgSource); } catch (e) { /* ignore */ }
      applyMsgSourceModeUI();
      if (state.msgSource === 'clipboard') {
        const previewEl = root.getElementById('ssb-clip-preview-text');
        const txt = String(await readClipboardText() || '').trim();
        if (previewEl) {
          previewEl.textContent = txt
            ? ('Đang có trên Clipboard: “' + clip(txt, 120) + '” — bấm ▶ Chạy (hoặc phím Tab) để xác nhận & gửi.')
            : 'Khi bấm ▶ Chạy hoặc nhấn phím Tab, script sẽ tự lấy nội dung đang copy trên Clipboard và hiện hộp xác nhận trước khi gửi.';
        }
        logLine('📋 Đã chuyển sang chế độ: GỬI BẰNG DỮ LIỆU TRÊN CLIPBOARD');
      } else {
        logLine('📝 Đã chuyển sang chế độ: GỬI BẰNG CÂU TRÊN GIAO DIỆN');
      }
    });
    const triggerSendRun = () => {
      try { markSendIdleIfSettled(); } catch (e0) { /* ignore */ }
      if (state.confirmingSend) return;
      if (state.sending) {
        logLine('⏳ Đang trong lượt gửi — hãy chờ hoàn tất hoặc bấm ⏹ Dừng trước khi chạy lượt mới.');
        return;
      }
      if (state.sentIds && state.sentIds.size > 0) {
        logLine('⏩ Có ' + state.sentIds.size + ' chat đã gửi ở lượt trước — sẽ bỏ qua, chỉ gửi phần còn lại.');
      }
      sendToAll().catch((err) => {
        state.confirmingSend = false;
        // Đường chốt cuối: exception nào thoát khỏi sendToAll cũng phải nhả nút + tắt overlay
        logLine('⛔ Lỗi ngoài dự kiến khi gửi: ' + (err && err.message || err) + ' — dừng lượt.');
        state.stopRequested = true;
        fireStopSignal();
        batchStats.loopFinished = true;
        batchStats.dispatchEndedAt = Date.now();
        markSendIdleIfSettled();
        if (!state.sending) {
          unfreezeSendChecklist();
          }
        reportExtJob({ phase: 'idle' });
        render();
      });
    };
    window.__botfakeTriggerSend__ = triggerSendRun;
    on('ssb-send', 'click', triggerSendRun);
    const requestStop = () => {
      if (!state.sending) return;
      state.stopRequested = true;
      fireStopSignal(); // [v1.92.9] cắt ngay mọi chỗ đang chờ mềm
      try {
        if (extBgAvailable()) extCall({ type: 'BOTFAKE_BG_STOP' });
      } catch (e0) { /* ignore */ }
      logLine('⏸ Đã bấm Dừng — ngắt lượt gửi, không bắn thêm.');
      applyRunStopButtons();
      if (batchStats.loopFinished) markSendIdleIfSettled();
    };
    on('ssb-stop', 'click', requestStop);
    on('ssb-stop', 'pointerdown', (e) => {
      if (!state.sending) return;
      try { e.preventDefault(); } catch (err) { /* ignore */ }
      requestStop();
    });
    // kéo thả panel (header) VÀ bong bóng logo — di chuyển >4px mới tính là KÉO
    // (để bấm vào bóng vẫn mở panel, kéo bóng chỉ dời chỗ)
    const head = root.getElementById('ssb-head');
    const bubbleEl = root.getElementById('ssb-bubble');
    const wrap = root.getElementById('ssb-wrap');
    let drag = null;
    let justDragged = false;
    const startDrag = (e) => {
      const hostEl = document.getElementById(PANEL_ID);
      const rect = hostEl.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, r: rect, moved: false };
      e.preventDefault();
    };
    head.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      startDrag(e);
    });
    if (bubbleEl) bubbleEl.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
      if (!drag.moved) return;
      const hostEl = document.getElementById(PANEL_ID);
      if (!hostEl) return;
      hostEl.style.right = 'auto';
      hostEl.style.bottom = 'auto';
      // giữ panel/bóng luôn ló ≥40px trong màn hình (không kéo mất hẳn ra ngoài)
      const left = Math.min(Math.max(0, drag.r.left + e.clientX - drag.x), Math.max(0, window.innerWidth - 40));
      const top = Math.min(Math.max(0, drag.r.top + e.clientY - drag.y), Math.max(0, window.innerHeight - 40));
      hostEl.style.left = left + 'px';
      hostEl.style.top = top + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (drag && drag.moved) {
        justDragged = true; // nuốt click ngay sau khi kéo — không mở panel khi dời bóng
        setTimeout(() => { justDragged = false; }, 150);
      }
      drag = null;
    });
    void wrap;
  }

  let logFlushTimer = null;
  let logPersistTimer = null;
  function persistLogStorage() {
    if (logPersistTimer) { clearTimeout(logPersistTimer); logPersistTimer = null; }
    /* [v1.92.60] Chỉ cần 300 dòng gần nhất để NHÌN LẠI sau F5 — toàn bộ log của lượt vẫn nằm
     * trong `logAll` (nút 📋 Copy / 💾 .txt). Đo trên Chromium 153 với 1 500 dòng:
     *   JSON.stringify(1 500 dòng, 104 KB) + localStorage.setItem = 1,03 ms/lần, ghi mỗi 1 s
     *   cùng phép đó với 300 dòng                                  = 0,10 ms/lần  (nhanh 10×)
     * Đây là chi phí CHỈ có khi panel mở/đang chạy — đúng loại "làm gì cũng lag" người dùng tả. */
    try { localStorage.setItem(LOG_KEY, JSON.stringify(state.log.slice(-300))); } catch (e) { /* ignore */ }
  }
  function scheduleLogStorageSave() {
    if (logPersistTimer) return;
    // Log giữ tối đa 300 dòng; không ghi toàn bộ JSON vào localStorage mỗi 80ms khi chạy lô lớn.
    logPersistTimer = setTimeout(persistLogStorage, 1000);
  }
  // Người dùng có đang ở sát đáy không? (nếu họ đã cuộn lên xem lỗi thì KHÔNG kéo họ xuống)
  function logNearBottom(el) {
    try { return (el.scrollHeight - el.scrollTop - el.clientHeight) <= 48; } catch (e) { return true; }
  }
  function logScrollToBottom(el) {
    const e = el || (shadow && shadow.getElementById('ssb-log'));
    if (!e) return;
    try { e.scrollTop = e.scrollHeight; } catch (e2) { /* ignore */ }
  }
  /* [v1.92.32] NÉN LÝ DO LỖI LẶP — log mẫu cho thấy ~95 % khối lượng log là 3 câu lặp:
   *   "Ext: Không tìm được global_id để gửi — bỏ qua Ext thread-only cho nhanh"
   *   "socket: Không tìm thấy globalId thật cho Socket"
   *   "api: (#10) Tin nhắn này được gửi ngoài khoảng thời gian cho phép. ... policy-overview"
   * Chỉ ĐỔI CÁCH IN, không đổi kết quả và không bỏ thông tin: vẫn đủ mã lỗi (vd #10/#551).
   * Đặt ở phạm vi module để cả sendOne (làn gửi) lẫn wave đều dùng được; KHÔNG đụng logic gửi. */
  const ERR_ABBR = [
    [/Ext: Không tìm được global_id để gửi[^|]*/g, 'Ext: không gid'],
    [/Ext: Không tìm được globalId[^|]*/g, 'Ext: không gid'],
    [/socket: Không tìm thấy globalId thật cho Socket/g, 'socket: không gid'],
    [/\(#10\) Tin nhắn này được gửi ngoài khoảng thời gian[^|]*/g, '(#10) ngoài 24h'],
    [/\(#551\) Người này hiện không có mặt\.?/g, '(#551) không có mặt'],
    [/Trang này hiện không khả dụng[^|]*/g, 'trang không khả dụng'],
    // [v1.92.34] RÚT GỌN chuỗi 1545041: adapter Ext / Socket chuyển nguyên khối JSON của FB
    // vào lý do lỗi (98 byte) ⇒ mỗi dòng dài gấp ba mà không thêm thông tin nào so với mã.
    [/\{[^{}]*"e_subcode"\s*:\s*1545041[^{}]*\}/g, '(#1545041) khách không nhận được'],
    [/\{[^{}]*"e_code"\s*:\s*551[^{}]*\}/g, '(#551) không có mặt'],
    [/INCORRECT THREAD/gi, 'sai thread (chưa chắc có globalId)'],
  ];
  const compressErr = (str) => {
    let t = String(str == null ? '' : str);
    for (let i = 0; i < ERR_ABBR.length; i++) { t = t.replace(ERR_ABBR[i][0], ERR_ABBR[i][1]); }
    t = t.replace(/\s*\|\s*/g, ' | ').trim(); // chuỗi bị nén hay dính khoảng trắng quanh "|"
    return clip(t, 140);
  };
  /* ================== SỔ KIỂM CHỨNG TỪNG CHAT (audit) ==================
   * Yêu cầu: bảng log phải GỌN, NHƯNG khi có ca xác nhận sai gây GỬI LẶP thì phải còn đủ dấu vết
   * để truy. Nên tách làm hai:
   *   • Màn hình  = dòng gộp (1 dòng / 2 giây / lý do) — để nhìn.
   *   • auditRows = MỌI kết quả từng chat, KHÔNG gộp, KHÔNG cắt theo cửa sổ hiển thị — xuất ra
   *                 file "💾 .txt" (mục SỔ KIỂM CHỨNG) để truy ca lặp.
   * Ghi ở đây chỉ là GHI NHẬN, không đổi kết quả gửi. */
  const auditRows = [];
  const AUDIT_MAX = 60000;
  const nameById = Object.create(null);
  const deliverHits = new Map();          // id chat → [{t, by}] mọi lần markDelivered
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
  function fmtClock(ts) {
    const d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }
  function auditPush(tag, cid, name, reason) {
    try {
      if (cid && name && String(name) !== String(cid)) nameById[cid] = name;
      // [v1.92.34] TÊN KHÔNG ĐƯỢC RƠI: markDelivered()/watchdog chỉ biết convId nên gọi
      // auditPush('✅', convId, '', …) ⇒ lô 13:38 in ra 2 951 dòng ✅ với tên "-" (không truy
      // được ca gửi lặp theo tên). Nay tra nameById (nạp 1 lần cho cả danh sách ở đầu lượt).
      const nmUse = name ? String(name) : (cid && nameById[cid] ? String(nameById[cid]) : '');
      auditRows.push({ t: Date.now(), tag: tag, id: cid ? String(cid) : '', name: nmUse, reason: String(reason == null ? '' : reason) });
      if (auditRows.length > AUDIT_MAX) auditRows.shift();
    } catch (e) { /* ghi nhận lỗi không được làm hỏng luồng gửi */ }
  }
  function auditReset() { auditRows.length = 0; deliverHits.clear(); }
  /* Xuất sổ kiểm chứng: (1) chat nghi gửi lặp, (2) dòng thời gian từng chat, (3) tổng theo chat. */
  function buildAuditText() {
    const out = [];
    out.push('=== SỔ KIỂM CHỨNG TỪNG CHAT (' + auditRows.length + ' dòng, KHÔNG gộp, KHÔNG cắt) ===');
    out.push('Dùng khi nghi XÁC NHẬN SAI gây gửi lặp: tra id/tên chat ở đây sẽ thấy đủ mọi kết quả');
    out.push('(✅ tới nơi · ⚠ không rõ · ❌ lỗi · 🔎 kiểm chứng · 🔁 bắn lại · 🛟 chuyển làn) kèm giờ.');
    if (!auditRows.length) {
      out.push('⚠ SỔ ĐANG TRỐNG: sổ kiểm chứng nằm trong RAM, tải lại trang (F5) là mất. File .txt');
      out.push('   xuất NGAY sau khi lượt gửi chốt (hoặc trước khi F5) mới có chi tiết từng chat.');
    }
    // [v1.92.37] DANH SÁCH GỬI TAY — để không bao giờ im lặng mất tin.
    out.push('');
    /* [v1.92.63] "CẦN GỬI TAY" PHẢI RỖNG VỚI MỌI CHAT ĐÃ TỪNG CÓ ✅ — yêu cầu nghiệm thu.
     * Bản trước lọc duy nhất theo `isRescuing`. Nhưng một chat có thể ĐÃ ✅ rồi vẫn còn nằm
     * trong `manualResendList` (được thêm lúc ⚠, mà lần `markDelivered` gần nhất chạy TRƯỚC
     * khi ca đó được thêm lại — đúng trường hợp log 20:41:43 nếu bảng chốt sớm). Khi đó file
     * .txt in chat đã tới nơi vào mục "CẦN GỬI TAY" ⇒ người dùng gửi tay ⇒ 2 tin cho khách.
     * Nay có BA tầng lọc (mọi tầng đều chỉ ĐỌC, không đổi lần gửi nào):
     *   1. `deliveredIds[id]`            — đã có xác nhận tới nơi ⇒ KHÔNG BAO GIỜ vào danh sách;
     *   2. `deliverHits` có ≥1 lần ✅     — từng được đánh dấu tới nơi rồi bị lật ⇒ vẫn loại;
     *   3. `isRescuing`                   — đang được cứu tự động ⇒ tách sang mục "ĐANG CỨU". */
    const _mz = { wait: [], rescuing: [], delivered: 0 };
    const _nowMr = Date.now();
    manualResendList.forEach((m) => {
      const already = !!deliveredIds[m.id]
        || (deliverHits.has(m.id) && deliverHits.get(m.id).length > 0);
      if (already) { _mz.delivered++; return; }   // tầng 1 + 2
      (isRescuing(m.id, _nowMr) ? _mz.rescuing : _mz.wait).push(m);
    });
    out.push('=== 🖐 CẦN GỬI TAY (' + _mz.wait.length + ' chat) — máy KHÔNG xác nhận được đã gửi ===');
    if (_mz.delivered) {
      out.push('(đã loại ' + _mz.delivered + ' chat khỏi danh sách này vì ĐÃ có dấu ✅ tới nơi — '
        + 'gửi tay cho chúng là gửi 2 lần)');
    }
    if (!_mz.wait.length) {
      out.push('(không có — mọi chat đều có kết quả chắc chắn: ✅ đã tới nơi hoặc ❌ khách không nhận)');
    } else {
      out.push('Các chat dưới đây kết thúc ở ⚠ "không rõ". Mở đúng hội thoại: CHƯA thấy tin thì gửi tay,');
      out.push('ĐÃ thấy tin thì bỏ qua (đừng gửi lại — sẽ thành 2 tin cho khách).');
      _mz.wait.slice(0, 2000).forEach((m) => {
        out.push('   ' + m.id + ' · ' + (m.name || nameById[m.id] || '?') + ' · ' + fmtClock(m.t));
      });
      if (_mz.wait.length > 2000) out.push('   … còn ' + (_mz.wait.length - 2000) + ' chat');
    }
    if (_mz.rescuing.length) {
      out.push('');
      out.push('=== ⏳ ĐANG CỨU (' + _mz.rescuing.length + ' chat) — ĐỪNG GỬI TAY ===');
      out.push('Script đã chứng minh hội thoại KHÔNG có tin và đang gửi cứu qua Extension (~10–13 s).');
      out.push('Chờ dòng "🛟 … GỬI CỨU" / "🔎 Cập nhật sau khi chốt lượt" rồi hẵn quyết.');
      _mz.rescuing.slice(0, 500).forEach((m) => {
        out.push('   ' + m.id + ' · ' + (m.name || nameById[m.id] || '?') + ' · ' + fmtClock(m.t));
      });
    }
    const dup = [];
    deliverHits.forEach((hits, id) => { if (hits && hits.length > 1) dup.push({ id: id, hits: hits }); });
    out.push('');
    out.push('(chat bị đánh dấu "đã tới nơi" ≥2 lần KHÁC kênh hoặc cách nhau >2 s = dấu hiệu gửi lặp)');
    out.push('⚠ NGHI GỬI LẶP: ' + dup.length + ' chat'
      + (dup.length ? ' — chat bị đánh dấu "đã tới nơi" từ 2 lần trở lên:' : ' (không có — mỗi chat chỉ được đánh dấu "đã tới nơi" 1 lần)'));
    dup.slice(0, 300).forEach((d) => {
      out.push('   ' + d.id + ' · ' + (nameById[d.id] || '?') + ' · ' + d.hits.length + ' lần: '
        + d.hits.map((h) => fmtClock(h.t) + ' qua ' + h.by).join(' ; '));
    });
    if (dup.length > 300) out.push('   … còn ' + (dup.length - 300) + ' chat (xem mục tổng theo chat)');
    out.push('');
    out.push('--- DÒNG THỜI GIAN (mỗi dòng = 1 kết quả của 1 chat) ---');
    for (let i = 0; i < auditRows.length; i++) {
      const r = auditRows[i];
      out.push(fmtClock(r.t) + '  ' + r.tag + '  ' + (r.id || '-') + '  ' + (r.name || '-') + '  ' + r.reason);
    }
    // tổng theo chat: số lần đã tới nơi / không rõ / lỗi + kênh
    const per = new Map();
    for (let i = 0; i < auditRows.length; i++) {
      const r = auditRows[i];
      const k = r.id || ('?' + r.name);
      let a = per.get(k);
      if (!a) { a = { id: r.id, name: r.name, ok: 0, unsure: 0, fail: 0, other: 0, by: '', first: r.t, last: r.t }; per.set(k, a); }
      if (r.tag === '✅') a.ok++; else if (r.tag === '⚠' || r.tag === '🔎') a.unsure++;
      else if (r.tag === '❌') a.fail++; else a.other++;
      if (!a.name && r.name) a.name = r.name;
      a.last = r.t;
    }
    out.push('');
    out.push('--- TỔNG THEO CHAT (' + per.size + ' chat có dấu vết) ---');
    out.push('id · tên · #đã tới nơi · #không rõ/kiểm chứng · #lỗi · #khác · từ lúc → đến lúc');
    const lastBy = new Map();
    deliverHits.forEach((hits, id) => { if (hits && hits.length) lastBy.set(String(id), hits[hits.length - 1].by); });
    per.forEach((a) => {
      const by = lastBy.get(String(a.id)) || '';
      out.push(a.id + ' · ' + (a.name || nameById[a.id] || '?') + ' · ' + a.ok + ' · ' + a.unsure + ' · ' + a.fail + ' · ' + a.other
        + ' · ' + (by ? ('kênh ' + by + ' · ') : '') + fmtClock(a.first) + ' → ' + fmtClock(a.last));
    });
    return out.join('\n');
  }

  /* [v1.92.33] GỘP DÒNG TRÊN MÀN HÌNH — MỖI LÝ DO MỘT SỔ RIÊNG.
   * Bản 1.92.32 chỉ có MỘT khe chờ: hai lý do xen kẽ nhau (vd "FB từ chối nhận tin" ↔ "KHÔNG
   * thử lần 2") đẩy nhau ra liên tục ⇒ 93 dòng lỗi cho lô 2 251 chat. Nay mỗi lý do có sổ riêng
   * nên xen kẽ kiểu gì cũng chỉ 1 dòng / 2 giây / lý do. */
  let logGroupCtx = null; // runSend gán = () => done + '/' + totalAll
  const errGroups = new Map();
  const GROUP_FLUSH_MS = 2000;
  const GROUP_MAX = 200;
  const GROUP_LABEL = { '❌': 'cùng lỗi', '⚠': 'cùng lỗi', '🔎': 'cùng tình huống', '🛟': 'cùng tình huống', '🔁': 'cùng tình huống', '✅': 'cùng kết quả', '🛡': 'cùng tình huống', '⏳': 'cùng tình huống', '✓': 'cùng kết quả' };
  /* Khoá nhóm: bỏ các con số ĐỔI THEO THỜI GIAN (đã thử 40→44 ca…) để không chẻ nhóm.
   * Chỉ dùng cho việc GỘP; nội dung in ra vẫn lấy bản mới nhất (nên vẫn thấy "đã thử 44 ca"). */
  const VOLATILE_NUM = [
    [/đã thử \d+ ca/g, 'đã thử N ca'],
    [/từ chối gần đây \d+%/g, 'từ chối gần đây N%'],
    [/\(muộn \d+(?:[.,]\d+)?s\)/g, '(muộn Ns)'],
    [/đọc \d+ lần/g, 'đọc N lần'],
    [/sau \d+ ?ms/gi, 'sau N ms'],
  ];
  const groupKeyOf = (tag, t) => {
    let k = t;
    for (let i = 0; i < VOLATILE_NUM.length; i++) k = k.replace(VOLATILE_NUM[i][0], VOLATILE_NUM[i][1]);
    return tag + '\u0001' + k;
  };
  /* [v1.92.63] DÒNG GỘP IN THEO THỨ TỰ ĐÃ XẢY RA, KHÔNG THEO THỨ TỰ GỘP.
   * Log 20:41:43 (5 chat): sổ kiểm chứng ghi rõ
   *   20:41:30.013 🛟 GỬI CỨU Ext → 20:41:30.164 ✅ ĐÃ TỚI NƠI qua ext  (thứ tự ĐÚNG)
   * nhưng bảng log hiện
   *   20:41:32 🛟 … GỬI CỨU  →  20:41:32 ✅ bù THÀNH CÔNG qua Extension
   * đọc lên thành "nó vẫn gửi cứu SAU KHI đã báo ✅" ⇒ tưởng bị gửi trùng.
   * Nguyên nhân: mỗi lý do có khe gộp riêng chờ 2 s; khe nào tới hạn trước thì in trước,
   * KHÔNG liên quan tới thứ tự sự kiện thật. Nay mỗi khe ghi lại mốc sự kiện ĐẦU của nó
   * (`g.t0`) và khi in thì chèn đúng vị trí theo mốc đó — dòng log vẫn gộp 1 dòng/2 s (không
   * quay lại lỗi ngập log), nhưng ai đọc theo thứ tự cũng hiểu đúng.
   * Không đổi bất kỳ quyết định gửi nào. */
  /* [v1.92.63] THỨ TỰ IN PHẢI LÀ THỨ TỰ SỰ KIỆN THẬT.
   * Log 20:41:43 (5 chat): sổ kiểm chứng ghi
   *   20:41:30.013 🛟 GỬI CỨU Ext  →  20:41:30.164 ✅ ĐÃ TỚI NƠI qua ext   (đúng)
   * nhưng bảng log in
   *   20:41:32 🛟 … GỬI CỨU   →   20:41:32 ✅ bù THÀNH CÔNG qua Extension
   * đọc thành "vẫn gửi cứu SAU KHI đã báo ✅" ⇒ tưởng gửi trùng.
   * Gốc: mỗi lý do một khe gộp 2 s; khe tới hạn trước in trước, không liên quan thứ tự thật.
   * Nay ghi mốc sự kiện ĐẦU của khe (`g.t0`) và khi một khe tới hạn, XẢ TRƯỚC mọi khe có
   * `t0` nhỏ hơn đang chờ. Vẫn gộp 1 dòng/2 s/lý do (không ngập log), chỉ khác thứ tự in.
   * Không đổi bất kỳ quyết định gửi nào. */
  function flushGroup(g, _guard) {
    if (!g) return;
    if (g.timer) { clearTimeout(g.timer); g.timer = null; }
    if (!g.n) return;
    if (!_guard) {
      let older = null;
      errGroups.forEach((o) => {
        if (o !== g && o.n > 0 && o.t0 && g.t0 && o.t0 < g.t0 && (!older || o.t0 < older.t0)) older = o;
      });
      if (older) { flushGroup(older, true); }
    }
    if (errGroups.get(g.key) === g) errGroups.delete(g.key);
    const head = (logGroupCtx ? '[' + logGroupCtx() + '] ' : '');
    const what = GROUP_LABEL[g.tag] || 'cùng lỗi';
    const names = g.names.length ? ' · vd: ' + g.names.join(', ') : '';
    logLine(g.tag + ' ' + head + (g.n > 1
      ? '×' + g.n + ' chat ' + what + ' — ' + g.display + names
      : (g.names[0] ? g.names[0] + ' — ' : '') + g.display));
    g.n = 0; g.names = [];
  }
  function flushErrGroup() {
    const list = Array.from(errGroups.values());
    for (let i = 0; i < list.length; i++) flushGroup(list[i]);
  }
  function logFailGrouped(name, reason, tag, cid, noAudit) {
    tag = tag || '❌';
    const display = compressErr(reason);
    // [v1.92.52] `noAudit` = chỉ in lên bảng log, KHÔNG ghi sổ kiểm chứng. Dùng cho đúng một chỗ:
    // dòng "bù THÀNH CÔNG qua Extension/Socket" — vì ngay sau đó `markDelivered()` đã ghi ✅ cho
    // cùng lần gửi ấy ⇒ sổ có 2 dòng ✅ cho 1 chat, đọc lên tưởng gửi 2 lần.
    // Bằng chứng (lô 8 509 chat, 12:24, bản 1.92.51): 6 chat có 2 dòng ✅, ví dụ
    //   12:30:50 🛟 kiểm chứng: hội thoại KHÔNG có tin ⇒ GỬI CỨU 1 lần qua Extension
    //   12:30:51 ✅ bù THÀNH CÔNG qua Extension       ← logFailGrouped
    //   12:30:51 ✅ đánh dấu ĐÃ TỚI NƠI qua ext       ← markDelivered
    // Đây KHÔNG phải gửi trùng (một lần gửi, một tin), chỉ là ghi 2 dòng. Thứ tự hai dòng đảo
    // nhau giữa các ca ⇒ không thể sửa bằng cách so thời gian ở chỗ khác.
    if (!noAudit) auditPush(tag, cid, name, display);   // sổ kiểm chứng: KHÔNG gộp, ghi trước khi gộp màn hình
    const k = groupKeyOf(tag, display);
    const now = Date.now();
    let g = errGroups.get(k);
    if (!g) {
      if (errGroups.size >= GROUP_MAX) flushGroup(errGroups.values().next().value);
      g = { key: k, tag: tag, n: 0, names: [], display: display, timer: null, t0: now };
      errGroups.set(k, g);
    }
    if (!g.n) g.t0 = now; // khe vừa cạn ⇒ đây là sự kiện ĐẦU của lượt gộp mới
    g.n++;
    g.display = display;                                   // hiện số liệu MỚI NHẤT
    if (name && g.names.length < 4 && g.names.indexOf(name) < 0) g.names.push(name);
    if (!g.timer) g.timer = setTimeout(() => flushGroup(g), GROUP_FLUSH_MS);
  }
  function logGroupReset() {
    errGroups.forEach((g) => { if (g && g.timer) clearTimeout(g.timer); });
    errGroups.clear();
  }
  /* [v1.92.33] Nới lane đi từng nấc +8 ⇒ lô 2 251 chat in 16 dòng liền nhau. Gom lại: chỉ in
   * MỘT dòng sau khi nấc cuối đứng yên 2,5 s, kèm khoảng nới và số nấc. */
  /* [v1.92.34] DÒNG 🐢 PHẢI CÓ NGHĨA: lô 13:38 in 55 dòng "🐢 … giảm lane page … xuống 64" và
   * 1 dòng "xuống 307" — 55 dòng đầu là NO-OP (làn đã ở sàn 64, setLimit kẹp lại = 64). Nay:
   *   • chỉ ghi khi `to < from` (giảm THẬT),
   *   • gộp mọi nấc trong 2 s thành 1 dòng: "🐢 Socket no-ACK lặp 2 lần — lane page 123: 384 → 64 (3 lần hạ)". */
  const laneDrop = new Map(); // pid → {from, to, steps, why, timer}
  function logLaneDrop(pid, from, to, why) {
    if (!(Number(to) < Number(from))) return;
    const key = String(pid || '');
    let r = laneDrop.get(key);
    if (!r) { r = { from: from, to: to, steps: 0, why: why, timer: null }; laneDrop.set(key, r); }
    r.to = to; r.steps++; r.why = why || r.why;
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(() => {
      laneDrop.delete(key);
      try {
        logLine('🐢 ' + r.why + ' — giảm lane page ' + key + ': ' + r.from + ' → ' + r.to
          + (r.steps > 1 ? ' (' + r.steps + ' lần hạ)' : '') + '.');
      } catch (e) { /* ignore */ }
    }, 2000);
  }
  const laneRamp = new Map(); // pid → {from, to, steps, timer}
  function logLaneRamp(pid, from, to) {
    const key = String(pid || '');
    let r = laneRamp.get(key);
    if (!r) { r = { from: from, to: to, steps: 0, timer: null }; laneRamp.set(key, r); }
    r.to = to; r.steps++;
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(() => {
      laneRamp.delete(key);
      try {
        logLine('⚡ Socket ACK nhanh ổn định — nới lane page ' + key + ': ' + r.from + ' → ' + r.to
          + ' (' + r.steps + ' nấc)');
      } catch (e) { /* ignore */ }
    }, 2500);
  }

  /* ═══ [v1.92.59] ĐÂY LÀ NGUYÊN NHÂN "LAG CHỈ KHI MỞ GIAO DIỆN SCRIPT". ═══
   * Người dùng phát hiện đúng: đóng panel thì Alt-click mượt, mở panel thì khựng.
   * Đo trong trang thật (Chromium 153, có panel + 1 500 node "app" + 1 500 dòng log):
   *     el.textContent = state.log.join('\n')                        →   0,35 ms
   *     ... + el.scrollTop = el.scrollHeight                        → 547,40 ms
   *     ... + (el.scrollHeight - el.scrollTop - el.clientHeight)     → 581,00 ms
   * Gán textContent chỉ 0,35 ms; nhưng ĐỌC scrollHeight/clientHeight NGAY SAU ĐÓ buộc trình
   * duyệt LAYOUT LẠI TOÀN TRANG (app Pancake có hàng nghìn dòng hội thoại đang mở) — 547 ms.
   * `logNearBottom()` còn đọc cả 3 thuộc tính. Hàm này chạy mỗi lần có dòng log (khi không
   * gửi lô lớn) và trong render() ⇒ mỗi cú Alt-click phải gánh 1–3 lần layout toàn trang.
   *
   * NAY: (1) chỉ ghi lại text khi NỘI DUNG ĐỔI (so độ dài + dòng cuối — rẻ, không đụng DOM),
   *      (2) KHÔNG đọc scrollHeight nữa: tự đếm vị trí cuộn bằng 'scroll' listener (rẻ) và
   *          dùng `scrollTo` mặc định của CSS `overflow-anchor` sẵn có,
   *      (3) việc cuộn xuống đáy làm SAU khung hình, và chỉ khi thật sự cần. */
  /* [v1.92.60] Log chỉ được VẼ khi cửa sổ phóng to đang mở. */
  function logWindowOpen() {
    return !!(floatWins && floatWins.ssb_win_log);
  }

  /* ═══ [v1.92.61] SỐ TIẾN TRÌNH TRÊN BÓNG LOGO (khi panel THU NHỎ) ═══
   * Người dùng: "ý là nó sẽ hiển thị tiến trình ở cái bong bóng thu nhỏ khi tôi thu nhỏ giao diện
   * lại á, còn thanh tiến trình vẫn ở dưới nút chạy như trước đây, phần ô log bỏ đi sẽ làm giao
   * diện gọn lại".
   * ⇒ Trong panel: KHÔNG có dải tiến trình nào thêm (thanh sẵn có #ssb-bar/#ssb-progstat dưới nút
   *   Chạy vẫn là nơi hiện tiến trình). Ô log: bỏ trống cho gọn.
   * ⇒ Bóng logo: badge hiện "đã gửi / tổng số" của lô — nhìn thấy được cả khi panel đã thu nhỏ.
   * Hàm này CHỈ ghi DOM khi SỐ ĐỔI (so chuỗi đã vẽ), nên gọi từ render() (2 lần/cú click) không
   * làm cú Alt-click nặng thêm. */
  let miniPainted = '';
  /* ═══ [v1.92.64] SỐ TRÊN BÓNG LOGO PHẢI ĐỌC ĐƯỢC, và KHÔNG ĐƯỢC TRÀN MÀN HÌNH ═══
   * Người dùng: "cho cái số tổng hợp hiển thị khi đóng bảng trên biểu tượng thu nhỏ to ra hơn
   * nữa cho dễ nhìn". Đã phóng badge 10 → 17 px + bóng 40 → 56 px (xem CSS .bubble-badge).
   * Nhưng to hơn thì phải xử lý chỗ mà bản 10 px chưa từng chạm:
   *   • badge canh GIỮA bóng ⇒ chuỗi dài ló ra 2 bên. Đo với chữ số tabular-nums 17 px/800
   *     (số 0,62 em · dấu / 0,42 em · padding 9 px · viền 2 px):
   *       "9/9"            ≈ 50 px  → nằm gọn trong bóng 56 px
   *       "64/137"         ≈ 82 px  → ló 13 px mỗi bên (chấp nhận được)
   *       "14 815/14 815"  ≈ 135 px → ló 39 px mỗi bên
   *     Bóng đặt ở `right:12px` ⇒ mép badge ra NGOÀI màn hình ~27 px. Chữ bị cắt, số đọc sai.
   *   • Nặng hơn: người dùng KÉO bóng sát mép phải thì badge tràn hẳn.
   * Nay hai việc, đều là ĐỌC/ĐO rồi ghi style — không đổi con số nào:
   *   1. `MAX_BADGE_PX = 132`: chuỗi dài hơn ngưỡng thì thu cỡ chữ theo tỉ lệ, sàn 11 px
   *      (vẫn to hơn bản cũ 10 px). Ước bề rộng bằng số ký tự — KHÔNG đọc layout
   *      (đọc `getBoundingClientRect` mỗi lần số đổi sẽ là đúng cái bẫy layout đã đo 547 ms).
   *   2. `clampBadgeToViewport()`: sau khi đặt chữ, so mép badge với mép màn hình và dịch
   *      badge vào trong bằng `translateX`. Chỉ chạy khi số ĐỔI, không chạy mỗi khung hình.
   * Cả hai chỉ tác động badge; nhịp ghi DOM vẫn khoá bằng `miniPainted` như cũ. */
  const MAX_BADGE_PX = 132;      // bề rộng tối đa ước lượng của badge trước khi thu chữ
  const MIN_BADGE_FONT = 11;     // sàn cỡ chữ (bản 1.92.61 là 10 px)
  const BADGE_FONT_MAX = 17;     // cỡ chữ mặc định — xem CSS .bubble-badge
  /** Ước bề rộng badge theo số ký tự (không đọc layout). Khớp với CSS: padding 9, viền 2. */
  function estBadgeWidth(text, fontPx) {
    let em = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      em += (ch >= '0' && ch <= '9') ? 0.62 : (ch === '/' ? 0.42 : 0.52);
    }
    return em * fontPx + 18 + 4;
  }
  /** Dịch badge vào trong màn hình nếu nó ló ra ngoài (chỉ gọi khi số đổi). */
  function clampBadgeToViewport(badge) {
    try {
      badge.style.transform = ''; // đo ở vị trí gốc trước
      const r = badge.getBoundingClientRect();
      if (!r || !r.width) return;
      const pad = 4;
      let shift = 0;
      if (r.left < pad) shift = pad - r.left;
      else if (r.right > (window.innerWidth - pad)) shift = (window.innerWidth - pad) - r.right;
      if (shift) badge.style.transform = 'translateX(calc(-50% + ' + Math.round(shift) + 'px))';
    } catch (e) { /* ignore — thà lệch vài px còn hơn ném lỗi */ }
  }
  function updateMiniProgressUI() {
    const badge = shadow && shadow.getElementById('ssb-bubble-badge');
    if (!badge) return;
    const ok = summaryCounters.okApi + summaryCounters.okExt + summaryCounters.okSocket;
    const total = batchStats.total || 0;
    const chosen = (state.matches || []).filter((m) => m && m.checked).length;
    const done = !!batchStats.loopFinished;
    const show = total > 0 || chosen > 0;
    const text = total > 0 ? (ok + '/' + total) : (chosen + ' chat');
    const sig = show ? (text + '|' + (done ? 'done' : 'busy')) : '';
    if (sig === miniPainted) return; // KHÔNG đụng DOM khi số không đổi
    miniPainted = sig;
    if (!show) { badge.style.display = 'none'; return; }
    badge.style.display = 'block';
    badge.textContent = text;
    badge.className = 'bubble-badge' + (done ? '' : ' busy');
    /* Thu cỡ chữ nếu chuỗi quá dài — giữ badge trong bề rộng đọc được. */
    let fontPx = BADGE_FONT_MAX;
    while (fontPx > MIN_BADGE_FONT && estBadgeWidth(text, fontPx) > MAX_BADGE_PX) fontPx -= 1;
    if (fontPx !== BADGE_FONT_MAX) {
      badge.style.fontSize = fontPx + 'px';
      badge.style.lineHeight = Math.round(fontPx * 1.48) + 'px';
    } else {
      badge.style.fontSize = '';
      badge.style.lineHeight = '';
    }
    clampBadgeToViewport(badge);
  }

  let logStickBottom = true;      // người dùng đang ở sát đáy? (tự cập nhật bằng 'scroll')
  let logScrollBound = false;
  let logRenderedSig = '';        // chữ ký nội dung đã vẽ — để bỏ qua khi không đổi
  let logSigScrolled = '';        // chữ ký lần cuối đã cuộn xuống đáy
  let logPaintDeferTimer = null;
  /* [v1.92.59] Số dòng TỐI ĐA vẽ lên màn hình log. Toàn bộ log vẫn giữ trong logAll (60 000). */
  const LOG_PAINT_MAX = 200;
  function bindLogScrollWatcher(el) {
    if (logScrollBound || !el || !el.addEventListener) return;
    logScrollBound = true;
    // CHỈ phép tính rẻ trên số đã có trong event, KHÔNG đọc layout.
    el.addEventListener('scroll', () => {
      try {
        logStickBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) <= 48;
      } catch (e) { /* ignore */ }
    }, { passive: true });
  }
  function logSignature() {
    const n = state.log.length;
    return n + '|' + (n ? state.log[n - 1] : '');
  }
  function flushLogUI(forceBottom) {
    logFlushTimer = null;
    scheduleLogStorageSave();
    const cnt = shadow && shadow.getElementById('ssb-logcount');
    if (cnt) cnt.textContent = logAll.length + ' dòng';
    /* ═══ [v1.92.60] KHUNG LOG KHÔNG NẰM TRONG PANEL NỮA ═══
     * Người dùng: "khi mở giao diện thì làm gì cũng lag… bỏ luôn hiển thị log khi mở giao diện,
     * chỉ cần xem log khi ấn vào nút phóng to log".
     * Trước đây mỗi lần có dòng log, panel fixed phải vẽ lại ~200–1 500 dòng chữ ⇒ trình duyệt
     * layout/paint lại vùng chứa CẢ TRANG. Nay #ssb-log nằm trong #ssb-logwrap (display:none)
     * và chỉ được đưa ra cửa sổ nổi khi bấm ⛶ Phóng to log ⇒ ngoài lúc đó KHÔNG vẽ gì cả.
     * `logAll` (để 📋 Copy / 💾 .txt) không đổi. Panel KHÔNG có gì thay thế — ô log bỏ trống cho
     * gọn; tiến trình vẫn hiện ở thanh dưới nút Chạy, và trên badge bóng logo khi thu nhỏ. */
    if (!logWindowOpen()) return;
    const el = shadow && shadow.getElementById('ssb-log');
    if (!el) return;
    bindLogScrollWatcher(el);
    /* (1) KHÔNG đổi nội dung ⇒ KHÔNG gán textContent (gán lại toàn bộ làm mất vị trí cuộn
     * của người dùng và tạo việc vẽ vô ích). */
    const sig = logSignature();
    if (sig !== logRenderedSig) {
      /* ═══ CHỈ VẼ PHẦN ĐUÔI + KHÔNG VẼ KHI NGƯỜI DÙNG ĐANG CHỌN ═══
       * Panel là `position: fixed` + box-shadow trong shadow DOM; đổi text của nó buộc trình
       * duyệt VẼ LẠI vùng chứa cả trang. Đo (tools/_bench_click.mjs, panel MỞ, 1 500 dòng log):
       * cú Alt-click 1 496–2 408 ms; CÙNG cú click khi panel đóng: 0 ms. Toàn bộ log vẫn nằm
       * trong `logAll` (copy/.txt dùng cái đó) — màn hình chỉ cần phần đuôi.
       * 1) Chỉ vẽ tối đa LOG_PAINT_MAX dòng cuối.
       * 2) Đang giữ Alt/Ctrl chọn chat (userSelectingNow) ⇒ HOÃN vẽ 500 ms, vẽ đúng 1 lần sau. */
      if (typeof userSelectingNow === 'function' && userSelectingNow()) {
        if (!logPaintDeferTimer) logPaintDeferTimer = setTimeout(() => { logPaintDeferTimer = null; try { flushLogUI(); } catch (e0) { /* ignore */ } }, 500);
        return;
      }
      logRenderedSig = sig;
      const n = state.log.length;
      const from = n > LOG_PAINT_MAX ? n - LOG_PAINT_MAX : 0;
      el.textContent = (from ? '… (' + from + ' dòng trước — bấm 📋 Copy log để lấy đủ)\n' : '')
        + state.log.slice(from).join('\n');
    }
    /* (2) KHÔNG đọc scrollHeight/clientHeight để quyết định cuộn — đó là chỗ ép layout 547 ms.
     * Dùng cờ `logStickBottom` (do 'scroll' listener cập nhật) + `forceBottom`.
     * (3) BÁM ĐÁY BẰNG `scrollTop = 1e9`, KHÔNG đọc `scrollHeight`: đọc nó là ép layout cả
     * trang (đo 547 ms); còn GHI một số lớn thì trình duyệt tự kẹp về đáy — không đọc gì.
     * (4) Chỉ cuộn khi NỘI DUNG ĐỔI (đã gán textContent ở trên) — không cuộn lại vô ích khi
     * `render()` gọi hàm này mà log không có gì mới (đo được: đó vẫn là ~600 ms/lần). */
    if (forceBottom) logStickBottom = true;
    if (logStickBottom && sig !== logSigScrolled) {
      logSigScrolled = sig;
      try { requestAnimationFrame(() => { try { el.scrollTop = 1e9; } catch (e2) { /* ignore */ } }); }
      catch (e) { /* ignore */ }
    }
  }
  try { window.addEventListener('pagehide', persistLogStorage); } catch (e) { /* ignore */ }

  /* [v1.92.31] Tiến độ thay cho từng dòng "✅ đã gửi".
   * Lô 20 259 chat sinh 14 167 dòng "đã gửi" gần như trùng nhau ⇒ lỗi/mốc quan trọng bị đẩy
   * khỏi tầm mắt và log phải cuộn hàng nghìn dòng. Nay chỉ in mốc: lô > 500 chat in mỗi 10%,
   * lô nhỏ in mỗi 25% (vẫn thấy tiến độ, không mất thông tin vì TỔNG HỢP cuối có số chính xác). */
  const logProgressMark = { pct: 0 };
  function logProgress(done, total, ok, unsure, fail, inflight) {
    const t = Number(total) || 0;
    if (!t) return;
    const d = Number(done) || 0;
    const pct = Math.min(100, Math.floor((d * 100) / t));
    const step = t > 500 ? 10 : 25;
    if (pct < logProgressMark.pct + step || pct >= 100) return;
    logProgressMark.pct = pct - (pct % step);
    logLine('🟢 Đang gửi ' + d + '/' + t + ' (' + pct + '%) · ✅ ' + (ok || 0)
      + (inflight ? ' · ⏳ chờ xác nhận ' + inflight : '')
      + (fail ? ' · ❌ ' + fail : '') + (unsure ? ' · ⚠ ' + unsure : ''));
  }

  /* [v1.92.32] HAI SỔ SONG SONG:
   *   • state.log  = cửa sổ hiển thị (1 500 dòng) — dựng lại DOM mỗi giây nên phải nhỏ.
   *   • logAll     = TOÀN BỘ log của lượt (trần 60 000 dòng) — nút "📋 Copy log" / "💾 .txt"
   *                  đọc từ đây, nên KHÔNG bao giờ bị cắt như copy phần đang nhìn thấy.
   * Lý do: lô 9 335 chat sinh ~4 500 dòng; lô 20 259 chat sinh ~20 000 dòng ⇒ cửa sổ 1 500
   * dòng luôn thiếu phần đầu. */
  const logAll = [];
  const LOG_ALL_MAX = 60000;
  function logAllReset() { logAll.length = 0; }

  function logLine(s) {
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')
      + ':' + String(t.getSeconds()).padStart(2, '0');
    const full = '[' + hh + '] ' + s;
    logAll.push(full);
    /* [v1.92.57] `shift()` trên mảng tới 60 000 phần tử là memmove O(n) cho TỪNG dòng log.
     * Đo trên Chromium 153: mảng đầy 60 000 ⇒ mỗi `shift()` ~0,05–0,15 ms; nhịp in của đường
     * tải/socket vài chục dòng/giây ⇒ vài ms/giây chỉ để dồn mảng, cộng dồn thành khựng.
     * Nay: để mảng dài tới 2× rồi CẮT MỘT LẦN (`splice` nửa đầu) — chi phí amortized O(1)/dòng,
     * bộ nhớ đỉnh 120 000 dòng, và `logAll` vẫn luôn chứa ĐÚNG các dòng gần nhất. */
    if (logAll.length > LOG_ALL_MAX * 2) logAll.splice(0, logAll.length - LOG_ALL_MAX);
    state.log.push(full);
    // [v1.92.31] 300 → 1500 dòng: đủ giữ cả một lượt lớn để copy ra ngoài.
    if (state.log.length > 1500) state.log.shift();
    const el = shadow && shadow.getElementById('ssb-log');
    if (!el) {
      /* [v1.92.57] KHÔNG stringify cả bộ log 1 500 dòng cho TỪNG dòng log mới.
       * Đoạn cũ gọi `localStorage.setItem(LOG_KEY, JSON.stringify(state.log))` ngay tại đây —
       * mỗi dòng log là một lần tuần tự hoá ~1 500 dòng (~120 KB) + ghi đồng bộ. Đường tải
       * danh sách/socket in hàng chục dòng mỗi giây ⇒ main thread bị chặn liên tục đúng lúc
       * người dùng Alt-click chọn chuỗi (panel có thể chưa dựng xong, hoặc đã bị đóng).
       * Nay: gộp lại ghi 1 lần sau 1 000 ms bằng `scheduleLogStorageSave()` — CHÍNH hàm mà
       * `flushLogUI()` vẫn dùng (đã có sẵn cơ chế gộp + 'pagehide' ghi nốt). */
      scheduleLogStorageSave();
      console.log('[SSB]', s);
      return;
    }
    // Khi chạy lô lớn (>200 chat): chỉ cập nhật DOM log 1 lần/giây;
    // nhịp gửi/counters không bị chặn, chỉ phần trình bày log được gộp.
    if (state.sending && batchStats.total > 200) {
      /* [v1.92.43b] Tab đang ẨN mà có tab khác chạy: không ai nhìn panel này ⇒ gộp log 2,5 s/lần
       * thay vì 1 s. Cắt CPU vẽ chữ của tab ẩn để tab đang xem không bị khựng. Số liệu gửi và
       * logAll (để copy) KHÔNG đổi — chỉ nhịp vẽ DOM thưa hơn. */
      const hiddenHeavy = !!(document && document.hidden) && peerSendingCount() > 0;
      if (!logFlushTimer) logFlushTimer = setTimeout(flushLogUI, hiddenHeavy ? 2500 : 1000);
      return;
    }
    /* [v1.92.59] GỘP NHỊP VẼ khi panel đang mở — trước đây mỗi dòng log gọi `flushLogUI()` NGAY.
     * Mỗi lần vẽ là một lần dựng lại text của panel fixed trong shadow DOM; đo được 56–600 ms
     * mỗi lần tuỳ số dòng đang vẽ, trong khi đường tải/socket in vài chục dòng mỗi giây ⇒ khựng
     * liên tục đúng lúc người dùng Alt-click. Gộp 200 ms/lần: log vẫn hiện gần như tức thì với
     * người đọc, mà số lần vẽ giảm cả chục lần. `logAll` (để copy) KHÔNG bị ảnh hưởng. */
    if (!logFlushTimer) logFlushTimer = setTimeout(flushLogUI, 200);
  }

  function applyScanButtons() {
    if (!shadow) return;
    const scan = shadow.getElementById('ssb-scan');
    if (!scan) return;
    if (state.sendListFrozen) {
      scan.disabled = true;
      scan.textContent = '🔒 Đang gửi — tạm khóa tải danh sách';
      return;
    }
    scan.disabled = false;
    if (state.scanning) {
      scan.textContent = state.scanStopRequested
        ? '⏳ Đang dừng tải…'
        : ('⏹ Dừng tải' + (state.allRows && state.allRows.size ? ' (' + state.allRows.size + ' chat)' : ''));
    }
  }

  function applyRunStopButtons() {
    if (!shadow) return;
    const send = shadow.getElementById('ssb-send');
    const stop = shadow.getElementById('ssb-stop');
    const busy = !!state.sending;
    const locked = !!(state.sendListFrozen || state.confirmingSend);
    ['ssb-selall', 'ssb-deselect-one', 'ssb-to-end', 'ssb-clear'].forEach((id) => {
      const btn = shadow.getElementById(id);
      if (btn) btn.disabled = locked || (id === 'ssb-deselect-one' && !state.enabled);
    });
    if (send) {
      send.disabled = busy || locked;
      send.textContent = busy
        ? (state.stopRequested ? '⏳ Đang dừng…' : '⏳ Đang gửi…')
        : (locked ? '🔒 Đang khóa danh sách…' : '▶ Chạy (Tab)');
    }
    if (stop) {
      stop.disabled = !busy;
      stop.textContent = '⏹ Dừng';
      stop.style.opacity = busy ? '1' : '';
      stop.style.pointerEvents = busy ? 'auto' : '';
      stop.style.cursor = busy ? 'pointer' : '';
    }
  }

  function markSendIdleIfSettled() {
    if (!state.sending) return;
    if (!batchStats.loopFinished && !state.stopRequested) return;
    if (state.stopRequested) {
      state.sending = false;
      try { releaseSendLock(); } catch (eRl3) { /* ignore */ }
      unfreezeSendChecklist();
      applyRunStopButtons();
      stopKeepAliveAudio();
      reportExtJob({ phase: 'idle' });
      render();
      return;
    }
    let pending = 0;
    try { pending = getBatchSummaryCounts().pendingSend; } catch (e) { pending = 0; }
    if (pending > 0) {
      applyRunStopButtons();
      return;
    }
    state.sending = false;
    try { releaseSendLock(); } catch (eRl2) { /* ignore */ } // [v1.92.43] nhả khoá tab
    unfreezeSendChecklist();
    applyRunStopButtons();
    stopKeepAliveAudio();
    reportExtJob({ phase: 'idle' });
    render();
  }

  let progressUiTimer = null;
  let progressUiLastAt = 0;
  let pendingProgressSnapshot = null;
  function flushProgressUi() {
    progressUiTimer = null;
    const snap = pendingProgressSnapshot;
    pendingProgressSnapshot = null;
    if (!snap) return;
    progressUiLastAt = Date.now();
    const bar = shadow && shadow.getElementById('ssb-bar');
    if (bar) bar.style.width = snap.pct + '%';
    const st = shadow && shadow.getElementById('ssb-progstat');
    if (st) st.textContent = snap.pct + '% · ✅ ' + (snap.ok || 0) + '/' + (snap.total || 0);
    reportExtJob({ phase: 'send', pct: snap.pct, ok: snap.ok, total: snap.total, done: snap.done,
      pending: (typeof snap.pending === 'number') ? snap.pending : undefined });
  }
  function setProgress(done, total, ok, pendingCount) {
    const snap = {
      pct: total ? Math.min(100, Math.round((done / total) * 100)) : 0,
      ok: (ok != null) ? ok : done,
      total: total || 0,
      done: done || 0,
      /* [v1.92.56] Cho người gọi TRUYỀN số `pending` đã tính sẵn (flushBatchSummaryUI vừa
       * gọi getBatchSummaryCounts) để reportExtJob không phải tính lại lần nữa. */
      pending: (typeof pendingCount === 'number') ? pendingCount : undefined,
    };
    const immediate = total <= 200 || done >= total || !state.sending;
    const elapsed = Date.now() - progressUiLastAt;
    if (immediate || elapsed >= 250) {
      if (progressUiTimer) { clearTimeout(progressUiTimer); progressUiTimer = null; }
      pendingProgressSnapshot = snap;
      flushProgressUi();
      return;
    }
    pendingProgressSnapshot = snap;
    if (!progressUiTimer) progressUiTimer = setTimeout(flushProgressUi, Math.max(1, 250 - elapsed));
  }

  function setScanProgress(n, pct) {
    const bar = shadow && shadow.getElementById('ssb-scanbar');
    const st = shadow && shadow.getElementById('ssb-scanstat');
    const p = (pct == null) ? null : Math.max(0, Math.min(100, Math.round(pct)));
    if (bar) {
      if (p != null) bar.style.width = p + '%';
      else bar.style.width = Math.min(95, 8 + Math.round(Math.log10(Math.max(1, n) + 1) * 28)) + '%';
    }
    if (st) {
      st.textContent = (p != null)
        ? ('Tải DS: ' + p + '% · ' + (n || 0) + ' chat')
        : ('Tải DS: đang chạy · ' + (n || 0) + ' chat');
    }
    const shown = (p != null) ? p : Math.min(95, 8 + Math.round(Math.log10(Math.max(1, n) + 1) * 28));
    reportExtJob({ phase: 'scan', pct: shown, done: n, total: n });
  }

  function render() {
    if (!shadow) return;
    // Kết quả confirmed-unavailable có thể được ghi nhớ trong lúc gửi; sau khi checklist mở lại,
    // hạ tick ngay nhưng không sửa snapshot đang khóa để tránh đổi người nhận giữa lượt.
    const tgl = shadow.getElementById('ssb-toggle');
    if (tgl) {
      tgl.textContent = state.enabled ? 'BẬT' : 'TẮT';
      tgl.className = 'badge ' + (state.enabled ? 'on' : 'off');
    }
    const tglTab = shadow.getElementById('ssb-tab');
    if (tglTab) {
      tglTab.textContent = 'TAB: ' + (state.tabSend ? 'BẬT' : 'TẮT');
      tglTab.className = 'badge ' + (state.tabSend ? 'on' : 'off');
    }
    const deselectBtn = shadow.getElementById('ssb-deselect-one');
    if (deselectBtn) {
      deselectBtn.textContent = state.deselectMode ? '👆 Click chat cần bỏ chọn… (Esc hủy)' : '⊖ Bỏ chọn 1 chat';
      deselectBtn.style.background = state.deselectMode ? '#b45309' : '';
      deselectBtn.style.color = state.deselectMode ? '#fff' : '';
    }
    const checkedMatchCount = state.matches.filter((m) => m && m.checked && !m.knownUnavailable).length;
    const tgt = shadow.getElementById('ssb-target');
    if (tgt) {
      if (state.mode === 'range' && state.rangeStart && state.rangeEnd) {
        tgt.innerHTML = '🔗 Chuỗi: <b>' + esc(state.rangeStart.name || '?') + '</b> (' + esc(state.rangeStart.time || '') + ')'
          + ' → <b>' + esc(state.rangeEnd.name || '?') + '</b> (' + esc(state.rangeEnd.time || '') + ')'
          + '<br>' + state.matches.length + ' chat trong chuỗi · đang chọn ' + checkedMatchCount;
      } else if (state.mode === 'range' && state.rangeStart) {
        tgt.innerHTML = '🅰 Đã chọn & đặt ĐẦU CHUỖI: <b>' + esc(state.rangeStart.name || '?') + '</b> · ' + esc(state.rangeStart.time || '')
          + '<br>Giữ Alt nhấp tiếp dòng <b>CUỐI chuỗi</b> (hoặc bấm Chạy nếu chỉ gửi 1 chat này)…<br>Đang chọn: ' + checkedMatchCount;
      } else if (state.mode === 'all' && state.matches.length) {
        tgt.innerHTML = '☑ Đã chọn <b>' + checkedMatchCount + '/' + state.matches.length + ' chat</b>';
      } else if (state.mode === 'pick' && state.matches.length) {
        tgt.innerHTML = '☑ Đã chọn lẻ <b>' + checkedMatchCount + ' chat</b>';
      } else {
        tgt.innerHTML = 'Chưa chọn — Alt+Click chọn chat/chuỗi hoặc bấm ⚡ Tải danh sách';
      }
    }
    const cnt = shadow.getElementById('ssb-count');
    if (cnt) cnt.textContent = String(checkedMatchCount);

    const list = getBotChecklistElement();
    if (list && !state.sendListFrozen) {
      // Với chuỗi hàng nghìn chat: chỉ dựng lại HTML danh sách khi ĐỔI danh sách/tick —
      // không build lại mỗi lần render (tiến độ gửi cập nhật liên tục sẽ gây đơ).
      const listKey = state.matches.map((m) => m.id + '~' + (m.checked ? 1 : 0) + '~' + (m.knownUnavailable ? 1 : 0)).join('|');
      if (listKey !== state.listKey) {
        state.listKey = listKey;
        if (!state.matches.length) {
          list.innerHTML = '<div class="empty">Trống</div>';
        } else {
          list.innerHTML = state.matches.map((m, i) => `
          <label class="item">
            <input type="checkbox" data-i="${i}" ${m.checked && !m.knownUnavailable ? 'checked' : ''} ${m.knownUnavailable ? 'disabled title="Đã lưu lỗi Socket: FB từ chối nhận tin (khách hiện không có mặt / đã khóa nick)"' : ''}>
            <span style="flex:1">
              <span class="nm">${esc(m.name || m.id)}${
                m.mark === 'start' ? ' <span style="color:#3b82f6">(đầu chuỗi)</span>'
                : m.mark === 'end' ? ' <span style="color:#3b82f6">(cuối chuỗi)</span>'
                : m.mark === 'target' ? ' <span style="color:#3b82f6">(nguồn snippet)</span>' : ''
              }${
                m.type === 'comment' ? ' <span style="color:#f59e0b" title="Bình luận bài viết — gửi bằng TRẢ LỜI BÌNH LUẬN công khai; mặc định bỏ tick">[bình luận]</span>'
                : (m.type === 'inbox' ? '' : ' <span style="color:#64748b" title="Không xác định loại">[?]</span>')
              }${m.knownUnavailable ? ' <span style="color:#f87171" title="Chỉ lưu do Socket xác nhận đúng lỗi khách vắng mặt/đã khóa nick">[tự bỏ qua: lỗi đã nhớ]</span>' : ''}</span><br>
              <span class="sn">${esc(clip(m.snippetRaw || m.snippet, 90))}</span>
            </span>
            <span class="tm">${esc(m.time || '')}</span>
          </label>`).join('');
          list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
            cb.addEventListener('change', () => {
              const i = parseInt(cb.getAttribute('data-i'), 10);
              if (state.matches[i]) {
                state.matches[i].checked = cb.checked;
                schedulePreloadSelectedChats();
              }
            });
          });
        }
      }
    }
    applyRunStopButtons();
    applyScanButtons();

    /* [v1.92.59] KHÔNG dựng lại log ở đây nữa. render() chạy 2 lần cho mỗi cú Alt-click, và
     * mỗi lần đoạn cũ gán `textContent = state.log.join('\n')` (1 500 dòng) rồi ĐỌC
     * `scrollHeight` — chính là phép ép layout 547 ms toàn trang. Log chỉ cần vẽ khi nội dung
     * đổi; `flushLogUI()` đã làm việc đó và đã chống trùng bằng chữ ký nội dung. */
    /* [v1.92.60] Dải tiến trình thu nhỏ: tự bỏ qua khi số không đổi (so chữ ký), nên gọi ở
     * đây KHÔNG làm cú Alt-click nặng thêm — chỉ tốn 1 lần so chuỗi. */
    updateMiniProgressUI();
    scheduleHighlight(); // mọi thay đổi trạng thái → vẽ lại màu trên danh sách
  }

  /* ============================ SỰ KIỆN TOÀN CỤC ============================ */

  /* ---- KHÔNG CHO APP MỞ CHAT KHI ĐANG CHỌN CHUỖI (Alt+Click · Ctrl+Click · "2 nhấp") ----
   * App Pancake mở hội thoại NGAY Ở chuỗi pointer/mouse (pointerdown → mousedown → mouseup),
   * không phải ở 'click' — vì vậy chỉ chặn 'click' (bản cũ) thì Alt+Click vẫn nhảy vào chat.
   * Nay ta chặn cả 6 event của chuột, nhưng CHỈ khi thật sự đang chọn:
   *   - Alt hoặc Ctrl/Cmd đang được GIỮ (đọc trực tiếp từ event + theo dõi keydown/keyup),
   *   - hoặc đang bật chế độ "Chọn chuỗi (2 nhấp)".
   * CLICK THƯỜNG: thoát ngay ở dòng đầu, KHÔNG preventDefault / KHÔNG stop* / KHÔNG render →
   * app mở chat, gõ tin, mọi thứ y như khi không cài script.
   * Luôn BẬT: Alt/Ctrl+Click chỉ chọn, không mở hội thoại.
   */
  const ROW_GUARD_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick', 'dblclick'];
  const MOD_FRESH_MS = 900;        // chỉ tin "phím đang giữ" trong 900ms gần nhất (keyup lỡ mất thì tự hết hạn)
  const modState = { altAt: 0, ctrlAt: 0 };

  // Chặn event không cho app thấy. KHÔNG preventDefault cho pointerdown/pointerup để trình
  // duyệt vẫn phát sinh 'click' (hủy pointerdown ở một số bản Chrome sẽ nuốt luôn click).
  function swallowRowEvent(e, keepClick) {
    try { if (!keepClick && e.preventDefault) e.preventDefault(); } catch (err) { /* ignore */ }
    try { e.stopPropagation(); } catch (err) { /* ignore */ }
    try { if (e.stopImmediatePropagation) e.stopImmediatePropagation(); } catch (err) { /* ignore */ }
  }

  function rowGuardOn() { return true; }

  // Alt/Ctrl có đang được giữ NGAY LÚC NÀY không?
  //  - ưu tiên cờ của chính event (chính xác nhất),
  //  - dự phòng bằng mốc keydown gần nhất (người dùng nhả Alt hơi sớm trước khi click phát sinh).
  function altHeldNow(e) {
    if (e && e.altKey) return true;
    return !!(modState.altAt && Date.now() - modState.altAt < MOD_FRESH_MS);
  }
  function ctrlHeldNow(e) {
    if (e && (e.ctrlKey || e.metaKey)) return true;
    return !!(modState.ctrlAt && Date.now() - modState.ctrlAt < MOD_FRESH_MS);
  }

  // Dòng chat dưới con trỏ (null nếu là panel BOTFAKE hoặc không phải dòng chat)
  function convRowTarget(e) {
    if (!state.enabled) return null;
    const t = e && e.target;
    if (!t || !t.closest) return null;
    const host = document.getElementById(PANEL_ID);
    if (host && (host === t || host.contains(t))) return null; // bấm trong panel → để panel tự xử lý
    const item = t.closest('.conversation-list-item');
    if (!item) return null;
    return rowInfo(item);
  }

  // Chặn ở các event "down/up" của chuột — app không được mở chat khi đang chọn chuỗi
  function onRowGesture(e) {
    if (state.sendListFrozen) return;
    if (state.deselectMode) {
      const info = convRowTarget(e);
      if (info) swallowRowEvent(e, true); // giữ default để click tiếp theo vẫn tới onDocClick
      return;
    }
    if (!rowGuardOn()) return;
    if (!altHeldNow(e) && !ctrlHeldNow(e) && !state.pickMode) return;
    const info = convRowTarget(e);
    if (!info) return;
    swallowRowEvent(e, e.type === 'pointerdown' || e.type === 'pointerup');
  }

  function onDocClick(e) {
    if (state.sendListFrozen) return;
    // Xử lý click trong panel BOTFAKE (#ssb-list): Ctrl+click chọn/bỏ chọn cùng snippet
    const listEl = getBotChecklistElement();
    if (listEl && listEl.contains(e.target)) {
      const row = e.target.closest && e.target.closest('.item');
      if (row) {
        const cb = row.querySelector('input[type="checkbox"][data-i]');
        if (cb && (e.ctrlKey || e.metaKey)) {
          const i = parseInt(cb.getAttribute('data-i'), 10);
          const m = state.matches[i];
          if (m) {
            const snippet = m.snippetRaw || m.snippet;
            const same = state.matches.filter((mm) => (mm.snippetRaw || mm.snippet) === snippet);
            if (same.length) {
              const allChecked = same.every((mm) => mm.checked);
              same.forEach((mm) => { mm.checked = !allChecked; });
              logLine((allChecked ? '✅ Bỏ chọn' : '✅ Chọn') + ' ' + same.length + ' đoạn cùng snippet: “' + clip(snippet, 60) + '”');
            }
            e.preventDefault();
            e.stopPropagation();
            render();
            return;
          }
        }
      }
      // Click thường trong panel → để checkbox change listener xử lý bình thường
      return;
    }

    if (!state.enabled) return;
    if (state.deselectMode) {
      const item = e.target && e.target.closest && e.target.closest('.conversation-list-item');
      if (!item) return;
      const info = rowInfo(item);
      if (!info) return;
      swallowRowEvent(e, false);
      state.deselectMode = false;
      const match = state.matches.find((m) => m && String(m.id) === String(info.id));
      if (!match) {
        logLine('⚠ Chat "' + (info.name || info.id) + '" không có trong checklist hiện tại nên không có gì để bỏ chọn.');
      } else if (!match.checked) {
        logLine('ℹ Chat "' + (info.name || info.id) + '" đã bỏ chọn sẵn.');
      } else {
        match.checked = false;
        preloadSelectedSeq++;
        schedulePreloadSelectedChats();
        logLine('⬜ Đã bỏ chọn chat: ' + (info.name || info.id));
      }
      highlightRows();
      render();
      return;
    }
    const isCtrl = ctrlHeldNow(e);
    const isAlt = !isCtrl && altHeldNow(e);
    const pickAct = !!(state.pickMode && !isCtrl && !isAlt);

    // CLICK THƯỜNG = mở chat như bình thường: không preventDefault, không stop*, không render.
    // (Đây là đường đi của 99% cú click — giữ nó tuyệt đối "trong suốt" với app.)
    if (!isAlt && !isCtrl && !pickAct) return;

    const item = e.target && e.target.closest && e.target.closest('.conversation-list-item');
    if (!item) return;
    const info = rowInfo(item);
    if (!info) return;

    // Đang chọn chuỗi → CHẶN app mở chat (xem chú thích onRowGesture)
    if (rowGuardOn()) swallowRowEvent(e, false); // ô chặn đang tắt → để app mở chat, ta chỉ chọn
    modState.altAt = 0; modState.ctrlAt = 0;

    // Chế độ "Chọn chuỗi (2 nhấp)": nhấp 1 = đầu chuỗi, nhấp 2 = cuối chuỗi (không cần giữ Alt)
    if (pickAct) {
      if (state.mode === 'range' && state.rangeStart && !state.rangeEnd) {
        state.pickMode = false;
        completeRange(info).catch((err) => logLine('⚠ Lỗi khi tạo chuỗi: ' + err));
      } else {
        setRangeStart(info);
        logLine('👉 Đã đặt đầu chuỗi — nhấp tiếp dòng CUỐI chuỗi (Esc để hủy)');
      }
      render();
      return;
    }

    // Ctrl/Cmd + click: chọn/bỏ chọn TẤT CẢ đoạn cùng snippet trong danh sách hiện tại (nếu đoạn vừa nhấp đang nằm trong danh sách và có nhiều đoạn trùng câu),
    // hoặc chọn/bỏ chọn & tự nạp trực tiếp đoạn chat vừa nhấp!
    if (isCtrl) {
      const snippet = info.snippetRaw || info.snippet;
      const idx = state.matches.findIndex((m) => m.id === info.id);
      const same = state.matches.filter((m) => (m.snippetRaw || m.snippet) === snippet);
      if (idx >= 0 && same.length > 1) {
        const allChecked = same.every((m) => m.checked);
        same.forEach((m) => { m.checked = !allChecked; });
        logLine((allChecked ? '✅ Bỏ chọn' : '✅ Chọn') + ' ' + same.length + ' đoạn cùng snippet: “' + clip(snippet, 60) + '”');
        schedulePreloadSelectedChats(true);
      } else if (idx >= 0) {
        state.matches[idx].checked = !state.matches[idx].checked;
        logLine((state.matches[idx].checked ? '✅ Đã chọn lại & tự nạp: ' : '⬜ Đã bỏ chọn: ') + (info.name || info.id));
        highlightRows();
        if (state.matches[idx].checked) schedulePreloadSelectedChats(true);
      } else {
        const rich = enrichRowWithRedux(info);
        state.mode = 'pick';
        state.matches.push({
          ...rich,
          checked: rich.type !== 'comment',
          isTarget: true,
          mark: 'target',
        });
        logLine('✅ Đã chọn & tự nạp đoạn chat: ' + (rich.name || rich.id) + ' (đã chọn ' + state.matches.length + ' chat)');
        highlightRows();
        schedulePreloadSelectedChats(true);
      }
      render();
      return;
    }

    const now = Date.now();
    // Alt + click cùng 1 đoạn 2 lần → chọn từ đoạn này xuống hết cuối danh sách (tùy chọn A)
    if (isAlt && state.lastAltClickId === info.id && now - state.lastAltClickTime < 800) {
      state.lastAltClickId = null;
      state.lastAltClickTime = 0;
      (async () => {
        if (normalizeListForReuse()) {
          logLine('⬇ Dùng danh sách đã tải (' + state.allRows.size + ' chat, ' + listAgeText()
            + ' trước) để lấy từ ' + (info.name || info.id) + ' xuống cuối — KHÔNG gọi lại API.');
        } else {
          logLine('⚡ Chưa có danh sách — tải một lần để lấy từ ' + (info.name || info.id) + ' xuống cuối…');
          await scanFullList({ full: true, restartIfBusy: true });
        }
        state.mode = 'range';
        state.target = null;
        state.rangeStart = enrichRowWithRedux(info);
        const rows = sourceRows();
        const lastRow = rows[rows.length - 1];
        if (lastRow) {
          state.rangeEnd = {
            ...lastRow,
            id: lastRow.id, name: lastRow.name, snippet: lastRow.snippet,
            snippetRaw: lastRow.snippetRaw, time: lastRow.time,
          };
          computeMatches();
          logLine('🅰⬇ Chọn từ ' + (info.name || info.id) + ' xuống hết cuối danh sách — ' + state.matches.length + ' chat');
          schedulePreloadSelectedChats(true);
        } else {
          state.rangeEnd = null;
          computeMatches();
        }
        render();
      })().catch((err) => logLine('⚠ Lỗi khi chọn xuống cuối: ' + err));
      return;
    }

    if (isAlt) {
      state.lastAltClickId = info.id;
      state.lastAltClickTime = now;
      // Alt+Click lần 1 = đầu chuỗi, lần 2 = cuối chuỗi → chọn tất cả ở giữa; lần 3 = bắt đầu chuỗi mới
      if (state.mode === 'range' && state.rangeStart && !state.rangeEnd) {
        completeRange(info).catch((err) => logLine('⚠ Lỗi khi tạo chuỗi: ' + err));
      } else {
        setRangeStart(info);
      }
      render();
      return;
    }

    render();
  }

  function onKeydown(e) {
    if (!e || e.__botfakeKeyHandled) return;
    const isTabKey = (e.key === 'Tab' || e.code === 'Tab' || e.keyCode === 9 || e.which === 9);
    // Công tắc TAB đang TẮT ⇒ nhường phím Tab cho trang (không preventDefault, không kích hoạt gửi)
    if (isTabKey && !state.tabSend && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) return;
    // Phím Tab: kích hoạt nút ▶ Chạy (luôn hiện hộp xác nhận trước khi gửi)
    if (isTabKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.isComposing) {
      if (!state.enabled || !isPancakeHost()) return;
      e.__botfakeKeyHandled = true;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (e.repeat) return;
      if (!shadow || !document.getElementById(PANEL_ID)) {
        try { showBotfakePanel(); } catch (e0) { /* ignore */ }
      }
      if (typeof window.__botfakeTriggerSend__ === 'function') {
        window.__botfakeTriggerSend__();
      } else {
        try { markSendIdleIfSettled(); } catch (e1) { /* ignore */ }
        if (!state.sending && !state.confirmingSend) {
          sendToAll().catch(() => {
            state.confirmingSend = false;
            if (!state.sending) { unfreezeSendChecklist(); render(); }
          });
        }
      }
      return;
    }
    if (e.key === 'Escape' && state.imgPick) {
      e.__botfakeKeyHandled = true;
      if (typeof window.__botfakeImgPick__ === 'function') window.__botfakeImgPick__(false);
      logLine('🖼 Đã hủy chọn ảnh');
      return;
    }
    // Alt+Q: bật/tắt chế độ BẮT CÂU NHANH (chờ click vào popup "/" của app)
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'q' || e.key === 'Q' || e.code === 'KeyQ' || e.keyCode === 81 || e.which === 81)) {
      e.__botfakeKeyHandled = true;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (e.repeat) return;
      if (!shadow || !document.getElementById(PANEL_ID)) {
        try { showBotfakePanel(); } catch (e0) { /* ignore */ }
      }
      if (typeof window.__botfakeQrCapture__ === 'function') window.__botfakeQrCapture__();
      return;
    }
    if (e.key === 'Escape' && state.qrCapture) {
      e.__botfakeKeyHandled = true;
      if (typeof window.__botfakeQrCapture__ === 'function') window.__botfakeQrCapture__(false);
      logLine('🎯 Đã hủy chế độ bắt câu');
      return;
    }
    if (e.key === 'Escape' && state.deselectMode) {
      e.__botfakeKeyHandled = true;
      state.deselectMode = false;
      logLine('Đã hủy chế độ bỏ chọn 1 chat; danh sách chọn không đổi.');
      render();
      return;
    }
    if (e.key === 'Escape' && (state.pickMode || (state.rangeStart && !state.rangeEnd))) {
      e.__botfakeKeyHandled = true;
      state.pickMode = false;
      if (state.rangeStart && !state.rangeEnd) {
        state.rangeStart = null;
        state.mode = null;
        state.matches = [];
        highlightRows();
        logLine('Đã hủy chọn chuỗi');
      } else {
        logLine('Đã tắt chế độ chọn');
      }
      render();
      return;
    }
    if (e.altKey && e.shiftKey && (e.key === 'B' || e.key === 'b' || e.code === 'KeyB')) {
      e.__botfakeKeyHandled = true;
      if (e.repeat) return;
      const host = document.getElementById(PANEL_ID);
      if (host) {
        const showing = host.style.display === 'none';
        host.style.display = showing ? '' : 'none';
        if (showing && shadow) {
          const wrapEl = shadow.getElementById('ssb-wrap');
          const bubble = shadow.getElementById('ssb-bubble');
          if (wrapEl) wrapEl.style.display = '';
          if (bubble) bubble.style.display = 'none';
        }
      }
    }
    if (e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd' || e.code === 'KeyD')) {
      e.__botfakeKeyHandled = true;
      if (e.repeat) return;
      const info = selectedRowInfo();
      if (info) setTarget(info, 'Alt+Shift+D');
    }
  }

  /* ============================ KHỞI ĐỘNG ============================ */

  hookNetwork();

  // Theo dõi sự kiện copy/cut trên trang và khi quay lại tab để cập nhật ngay bản xem trước Clipboard
  const onCopyOrCut = (e) => {
    try {
      let copied = '';
      if (e && e.clipboardData && typeof e.clipboardData.getData === 'function') {
        copied = e.clipboardData.getData('text/plain') || '';
      }
      if (!copied && window.getSelection) {
        copied = String(window.getSelection() || '');
      }
      if (!copied) {
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') && typeof ae.selectionStart === 'number') {
          copied = String(ae.value || '').slice(ae.selectionStart, ae.selectionEnd);
        }
      }
      if (copied && copied.trim()) {
        state.lastCopiedText = copied;
        const previewEl = shadow && shadow.getElementById('ssb-clip-preview-text');
        if (previewEl) {
          previewEl.textContent = 'Đang có trên Clipboard: “' + clip(copied.trim(), 120) + '” — bấm ▶ Chạy (hoặc phím Tab) để xác nhận & gửi.';
        }
      }
    } catch (err) { /* ignore */ }
  };
  window.addEventListener('copy', onCopyOrCut, true);
  window.addEventListener('cut', onCopyOrCut, true);
  window.addEventListener('focus', () => {
    if (state.msgSource === 'clipboard' && !state.confirmingSend) {
      readClipboardText().then((txt) => {
        const clean = String(txt || '').trim();
        const previewEl = shadow && shadow.getElementById('ssb-clip-preview-text');
        if (clean && previewEl) {
          previewEl.textContent = 'Đang có trên Clipboard: “' + clip(clean, 120) + '” — bấm ▶ Chạy (hoặc phím Tab) để xác nhận & gửi.';
        }
      }).catch(() => {});
    }
  });

  // GẮN LISTENER CHUỘT NGAY TẠI ĐÂY (script chạy ở document-start → TRƯỚC khi JS của app
  // gắn listener của nó). Đây là lý do phải gắn sớm: nếu app đăng ký listener capture trên
  // window trước ta thì stopImmediatePropagation của ta vô hiệu (listener đăng ký trước chạy trước).
  // Gắn ở CAPTURE của window (không phải document) để chạy trước cả listener ở document/root
  // của app — nhờ vậy Alt+Click / Ctrl+Click KHÔNG còn mở chat, chỉ chọn chuỗi.
  window.addEventListener('click', onDocClick, true);
  ROW_GUARD_EVENTS.forEach((ev) => window.addEventListener(ev, onRowGesture, true));
  window.addEventListener('keydown', onKeydown, true);
  document.addEventListener('keydown', onKeydown, true);

  // Theo dõi Alt / Ctrl THẬT SỰ đang được giữ (dùng khi event click không còn kèm altKey/ctrlKey
  // do người dùng nhả phím hơi sớm). Có keyup + blur + đáo hạn 900ms nên KHÔNG bao giờ "dính" lâu
  // và không thể chặn nhầm một cú click thường về sau.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') modState.altAt = Date.now();
    else if (e.key === 'Control' || e.key === 'Meta') modState.ctrlAt = Date.now();
    else if (e.altKey) modState.altAt = Date.now();
    else if (e.ctrlKey || e.metaKey) modState.ctrlAt = Date.now();
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') modState.altAt = 0;
    else if (e.key === 'Control' || e.key === 'Meta') modState.ctrlAt = 0;
  }, true);
  window.addEventListener('blur', () => { modState.altAt = 0; modState.ctrlAt = 0; });
  /* [v1.92.43e] Nhả Alt/Ctrl hoặc chọn xong ⇒ tô lại ĐÚNG MỘT lần (trước đó đã tạm hoãn để không
   * vẽ giữa lúc rê chọn chuỗi). */
  const flushDeferredHighlight = () => {
    if (!hlDeferredBySelect) return;
    hlDeferredBySelect = false;
    scheduleHighlight();
  };
  window.addEventListener('keyup', (e) => {
    if (e && (e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta')) flushDeferredHighlight();
  }, true);
  document.addEventListener('pointerup', flushDeferredHighlight, true);
  document.addEventListener('click', flushDeferredHighlight, true);

  function showBotfakePanel() {
    buildPanel();
    const host = document.getElementById(PANEL_ID);
    if (host) host.style.display = '';
    if (shadow) {
      const wrapEl = shadow.getElementById('ssb-wrap');
      const bubble = shadow.getElementById('ssb-bubble');
      if (wrapEl) wrapEl.style.display = '';
      if (bubble) bubble.style.display = 'none';
    }
    /* [v1.92.60] KHÔNG vẽ log khi mở panel nữa — panel nay chỉ có dải tiến trình thu nhỏ.
     * Log chỉ vẽ khi bấm ⛶ Phóng to log (logWindowOpen()). Chỉ cần vẽ lại dải tiến trình. */
    try { updateMiniProgressUI(); } catch (e) { /* ignore */ }
  }

  extListen((m, _s, sendResponse) => {
    if (m && m.type === 'BOTFAKE_SHOW_PANEL') {
      showBotfakePanel();
      sendResponse && sendResponse({ ok: true });
    }
  });

  function isPancakeHost() {
    const h = (location.hostname || '').toLowerCase();
    return /(^|\.)pancake\.(vn|ph|id|in|biz)$/.test(h)
      || h === 'pages.fm' || h.endsWith('.pages.fm') || h === 'socialos.vip';
  }

  function init() {
    if (!isPancakeHost()) return;
    showBotfakePanel();
    logLine('Sẵn sàng. Panel chỉ trên pancake.vn — tab khác chỉ hiện thanh tiến độ khi đang chạy.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Gỡ lỗi cho người nâng cao: window.__SSB__
  window.__SSB__ = {
    state,
    getToken,
    sendOne,
    sendViaApi,
    sendViaSocket,
    sendViaExtension,
    scanFullList,
    visibleRows,
    computeMatches,
    highlightRows,   // [v1.92.58] để kiểm chẩn đoán: tools/_check_highlight.mjs so màu đã tô
    // Bộ phụ thuộc của highlightRows — để phép kiểm chạy được CẢ bản cũ lẫn bản mới
    // trên cùng một state/DOM rồi so từng dòng (xem tools/_check_highlight.mjs).
    __hlDeps: { state, $$, rowInfo, markOf, hlClassSeen },
    clearSelection,
    getBatchSummaryCounts,
    setTargetByIndex(i) {
      const rows = visibleRows();
      if (rows[i]) setTarget(rows[i], 'debug');
    },
    /* [v1.92.60] Mở thêm đường ĐO/KIỂM cho công cụ chẩn đoán (tools/_check_mini.mjs):
     * cần gọi đúng hàm thật của panel để chứng minh log KHÔNG bị vẽ khi cửa sổ phóng to đóng. */
    render,
    logLine,
    /* [v1.92.62] Đường KIỂM cho tools/_check_sockban.mjs — chứng minh "khách vắng" không
     * còn gỡ Socket khỏi làn gửi (lỗi mất tin ở log 19:00:54). */
    /* [v1.92.62] Đường KIỂM cho tools/_check_slots.mjs — chứng minh mọi tab dùng HẾT slot
     * (không còn nhường theo số tab / theo tab ẩn). */
    __slotTest: {
      compute: (baseCap, peers, tab) => computeMainSlotCap(baseCap, peers, tab),
    },
    __sockTest: {
      noteAbsent: (pid) => { const st = sockRouteOf(pid); if (st) st.absent++; },
      noteLostSock: (pid) => { const st = sockRouteOf(pid); if (st) st.lostSock++; },
      noteLostExt: (pid) => { const st = sockRouteOf(pid); if (st) st.lostExt++; },
      noteDlv: (pid) => { const st = sockRouteOf(pid); if (st) { st.dlv++; st.lostSock = 0; st.lostExt = 0; } },
      usable: (pid) => pageSocketUsable(pid),
      skipReason: (pid) => socketSkipReason(pid),
      stats: (pid) => JSON.parse(JSON.stringify(sockRoute[String(pid)] || {})),
    },
    logAll,
    batchStats,
    summaryCounters,
    flushBatchSummaryUI,
    updateMiniProgressUI,
    setRangeByIndexes(i, j) {
      const rows = visibleRows();
      if (rows[i] && rows[j]) {
        setRangeStart(rows[i]);
        completeRange(rows[j]);
      }
    },
  };
})();
