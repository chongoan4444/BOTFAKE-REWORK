/**
 * BOTFAKE WORKER-SEND — TẢI DANH SÁCH CHAT (main thread)
 * ============================================================================
 * `worker.js` KHÔNG đọc được danh sách chat: nó không có Redux, không có DOM.
 * Phần này chạy ở **main thread** (nơi có `window.__pancakeReduxStore__`, token,
 * cookie) và trả ra mảng item ĐÚNG định dạng `sendAll()` cần:
 *
 *     { id, pageId, name, snippet }
 *
 * VÌ SAO KHÔNG DÙNG ENDPOINT BỊA: tôi đã đối chiếu `buildListRequest` của bản
 * 1.92.55 (dòng 1525) với HAR. Endpoint và tham số dưới đây lấy NGUYÊN từ đó:
 *   • nhiều page  → GET  /api/v1/conversations?pages[p]=0&…&cursor_mode=true
 *   • một page    → GET  /api/v1/pages/{id}/conversations?current_count=60&…
 *   • phân trang bằng `next_cursor` (Erlang term, mã hoá base64) — chỉ cần chuyển
 *     tiếp nguyên chuỗi, KHÔNG tự giải mã.
 *
 * KHÔNG đụng tới script cũ: file này độc lập, chỉ đọc state của trang.
 */

/* eslint-disable no-var */
(function botfakeWorkerSendLoadList() {
  'use strict';

  var NS = '__BOTFAKE_WS_LOADLIST__';
  if (window[NS]) return;

  /** Redux store của trang Pancake (script cũ cũng đọc đúng chỗ này — dòng 1514). */
  function getReduxState() {
    try {
      var s = window.__pancakeReduxStore__;
      return s && typeof s.getState === 'function' ? s.getState() : null;
    } catch (e) { return null; }
  }

  /** apiBase — y như `apiBase()` của bản cũ (dòng 731). */
  function apiBase() {
    try {
      if (location.hostname === 'dev.pages.fm') return 'https://dev.pancake.vn/api';
      return location.origin.replace(/\/$/, '') + '/api';
    } catch (e) { return '/api'; }
  }

  /**
   * Token: trang pancake.vn dùng chuỗi 'cookie_session' (HAR taidanhsach.har), còn
   * pages.fm dùng JWT. Bản cũ làm y hệt ở `getToken()` (dòng 767).
   * Có truyền `override` thì dùng luôn — để người dùng tự dán khi cần.
   */
  var capturedToken = '';

  /**
   * HOOK MẠNG — BẮT BUỘC, và đây là chỗ tôi từng thiếu.
   *
   * Trên `pages.fm`, token là JWT thật và KHÔNG nằm trong localStorage/__NEXT_DATA__;
   * nó chỉ xuất hiện trong query string của các request `/api/v1/...` mà CHÍNH TRANG
   * đang gửi. Bản cũ hook `fetch`/`XHR` ngay khi nạp (dòng 13730) nên kịp bắt.
   * `loadlist.js` bản đầu KHÔNG hook ⇒ `getToken()` trả rỗng ⇒ `run()` báo
   * "Không có access_token" dù trang đang chạy bình thường.
   *
   * Test `test-install.mjs` [I11] bắt được đúng lỗi này.
   */
  function hookNetwork() {
    if (hookNetwork.__done) return;
    hookNetwork.__done = true;
    try {
      var origFetch = window.fetch;
      if (typeof origFetch === 'function') {
        window.fetch = function (input) {
          try {
            grabTokenFromUrl(typeof input === 'string' ? input : (input && input.url) || '');
          } catch (e) { /* ignore */ }
          return origFetch.apply(this, arguments);
        };
      }
    } catch (e) { /* ignore */ }
    try {
      var XO = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
      if (XO && XO.open) {
        var origOpen = XO.open;
        XO.open = function (method, url) {
          try { grabTokenFromUrl(String(url || '')); } catch (e) { /* ignore */ }
          return origOpen.apply(this, arguments);
        };
      }
    } catch (e) { /* ignore */ }
  }

  function grabTokenFromUrl(url) {
    var m = /access_token=([A-Za-z0-9._-]+)/.exec(String(url || ''));
    if (!m || !m[1]) return;
    if (m[1] === 'cookie_session' || m[1].split('.').length === 3) capturedToken = m[1];
  }
  function getToken(override) {
    if (override) return override;
    if (/(^|\.)pancake\.vn$/i.test(location.hostname || '')) return 'cookie_session';
    try {
      var entries = performance.getEntriesByType('resource');
      for (var i = entries.length - 1; i >= 0; i--) {
        grabTokenFromUrl(entries[i].name);
        if (capturedToken) return capturedToken;
      }
    } catch (e) { /* ignore */ }
    if (capturedToken) return capturedToken;
    try {
      var nd = document.getElementById('__NEXT_DATA__');
      if (nd) {
        var j = JSON.parse(nd.textContent || '{}');
        var t = j && j.props && j.props.initialState && j.props.initialState.auth
          && j.props.initialState.auth.accessToken;
        if (t) { capturedToken = t; return t; }
      }
    } catch (e) { /* ignore */ }
    try {
      for (var k = 0; k < localStorage.length; k++) {
        var v = localStorage.getItem(localStorage.key(k)) || '';
        var mm = /eyJ[A-Za-z0-9._-]{20,}/.exec(v);
        if (mm && mm[0].split('.').length === 3) { capturedToken = mm[0]; return capturedToken; }
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  /**
   * Dựng URL danh sách — BÁM SÁT `buildListRequest` (dòng 1525) nhưng chỉ giữ phần
   * tối thiểu cần cho việc gửi hàng loạt: không lọc tag/type, lấy hết.
   */
  function buildListUrl(opts) {
    opts = opts || {};
    var st = getReduxState() || {};
    var pgs = st.pages || {};
    var multi = !!pgs.multiplePageMode;

    var ids = Array.isArray(opts.pageIds) && opts.pageIds.length
      ? opts.pageIds.slice()
      : (opts.singlePageId
        ? [String(opts.singlePageId)]
        : (multi
          ? (Array.isArray(pgs.multiplePageIds) ? pgs.multiplePageIds.slice() : [])
          : (pgs.currentPageId ? [pgs.currentPageId] : [])));

    if (!ids.length) {
      /* Không có Redux (script chạy lúc store chưa sẵn sàng) ⇒ đọc pageId từ URL. */
      var m = /\/pages\/(\d+)/.exec(location.pathname || '')
        || /[?&]page_id=(\d+)/.exec(location.search || '');
      if (m) ids = [m[1]];
    }
    if (!ids.length) return { url: '', ids: [], error: 'Không xác định được page_id (Redux chưa sẵn sàng?)' };

    var token = getToken(opts.accessToken);
    if (!token) return { url: '', ids: ids, error: 'Không tìm thấy access_token — tải lại trang Pancake' };

    var q = [];
    var push = function (k, v) { q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); };

    if (multi) {
      for (var i = 0; i < ids.length; i++) push('pages[' + ids[i] + ']', '0');
      push('mode', 'OR');
    }
    push('current_count', String(opts.count || 60));
    if (opts.cursor) push('next_cursor', opts.cursor);
    push('unread_first', 'true');
    push('tags', JSON.stringify('ALL'));
    push('except_tags', JSON.stringify([]));
    push('access_token', token);
    push('cursor_mode', 'true');
    push('from_platform', 'web');

    var path = (multi ? '/v1/conversations' : ('/v1/pages/' + encodeURIComponent(ids[0]) + '/conversations'));
    return { url: apiBase() + path + '?' + q.join('&'), ids: ids, multi: multi, token: token };
  }

  /** Một dòng API → đúng field `sendAll()` cần. */
  function toItem(c) {
    var id = String((c && c.id) || '');
    if (!id) return null;
    var from = (c && c.from) || {};
    var cust = (c && c.customers && c.customers[0]) || {};
    return {
      id: id,
      pageId: String((c && (c.page_id || c.pageId)) || id.split('_')[0] || ''),
      name: String((c && c.name) || from.name || from.username || cust.name || id),
      snippet: String((c && c.snippet) || ''),
      /* Thông tin để main thread tự tính is_record_ctx_7_days nếu muốn (cần Redux). */
      last_customer_interactive_at: String((c && c.last_customer_interactive_at) || ''),
      updated_at: String((c && c.updated_at) || ''),
    };
  }

  /**
   * Tải danh sách.
   *   opts = { maxPages, count, onProgress, cursor, accessToken, pageIds, singlePageId }
   * Trả { ok, items, pages, cursor, incomplete, error }
   *
   * `incomplete: true` = còn `next_cursor` mà đã dừng ⇒ NGƯỜI DÙNG PHẢI BIẾT, không
   * được để họ tưởng đã lấy hết. Bản cũ cũng trả cờ này (dòng 1856).
   */
  async function load(opts) {
    opts = opts || {};
    var maxPages = Math.max(1, Number(opts.maxPages) || 200);
    var items = [];
    var seen = Object.create(null);
    var cursor = opts.cursor || null;
    var pages = 0;
    var lastErr = '';

    for (var guard = 0; guard < maxPages; guard++) {
      var req = buildListUrl({
        cursor: cursor,
        count: opts.count,
        accessToken: opts.accessToken,
        pageIds: opts.pageIds,
        singlePageId: opts.singlePageId,
      });
      if (!req.url) return { ok: false, items: items, pages: pages, error: req.error };

      var res;
      try {
        res = await fetch(req.url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
      } catch (e) {
        return { ok: false, items: items, pages: pages, cursor: cursor, error: 'fetch lỗi: ' + String(e && e.message || e) };
      }
      if (!res.ok) {
        lastErr = 'HTTP ' + res.status;
        if (res.status === 401) lastErr += ' — token hết hạn, tải lại trang Pancake';
        return { ok: false, items: items, pages: pages, cursor: cursor, error: lastErr };
      }
      var j = null;
      try { j = await res.json(); } catch (e) { j = null; }
      if (!j) return { ok: false, items: items, pages: pages, cursor: cursor, error: 'JSON hỏng' };

      var convs = j.conversations || [];
      var added = 0;
      for (var i = 0; i < convs.length; i++) {
        var it = toItem(convs[i]);
        if (!it || seen[it.id]) continue;
        seen[it.id] = true;
        items.push(it);
        added++;
      }
      pages++;
      if (typeof opts.onProgress === 'function') {
        try { opts.onProgress(items.length, items); } catch (e) { /* ignore */ }
      }
      cursor = (convs.length && j.next_cursor) ? j.next_cursor : null;
      if (!cursor || !convs.length || !added) break;
    }

    return { ok: true, items: items, pages: pages, cursor: cursor, incomplete: !!cursor };
  }

  /**
   * `is_record_ctx_7_days` — CỜ QUAN TRỌNG NHẤT của việc gửi.
   * HAR: 19/19 request CÓ cờ ⇒ success; 24/24 THIẾU cờ ⇒ (#10).
   * Phần quyết định nằm ở Redux của trang (bản cũ: `isRecordCtx7Days`, dòng 2455),
   * nên phải tính Ở ĐÂY rồi truyền sang worker qua từng item.
   */
  function ctx7ForItem(item) {
    try {
      var st = getReduxState();
      if (!st) return false;
      var idle = item.last_customer_interactive_at || item.updated_at || '';
      if (idle) {
        var t = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(idle) ? idle : idle + 'Z');
        if (!isNaN(t) && (Date.now() - t) < 86400000) return false; // khách vừa nhắn <1 ngày
      }
      var pages = st.pages || {};
      var map = pages.activatedMap || {};
      var arr = pages.activated || [];
      var pid = item.pageId || String(item.id).split('_')[0];
      var p = map[pid];
      if (!p) for (var i = 0; i < arr.length; i++) if (arr[i] && String(arr[i].id) === pid) { p = arr[i]; break; }
      if (!p || !p.platform_extra_info || !p.platform_extra_info.ctx_7_days_enabled) return false;
      var plat = p.platform || p.currentPlatform || st.currentPlatform || '';
      if (plat && ['facebook', 'instagram_official', 'whatsapp_official'].indexOf(plat) < 0) return false;
      return true;
    } catch (e) { return false; }
  }

  hookNetwork();

  window[NS] = {
    hookNetwork: hookNetwork,
    load: load,
    buildListUrl: buildListUrl,
    getToken: getToken,
    apiBase: apiBase,
    getReduxState: getReduxState,
    ctx7ForItem: ctx7ForItem,
    /** Gắn cờ ctx7 vào cả danh sách trước khi đưa sang worker. */
    decorate: function (items) {
      return (items || []).map(function (it) {
        return Object.assign({}, it, { isRecordCtx7Days: ctx7ForItem(it) });
      });
    },
  };
})();
