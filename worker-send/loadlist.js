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
   * Dựng URL danh sách — BÁM SÁT `buildListRequest` (bản cũ dòng 1525).
   *
   * ĐÃ ĐỐI CHIẾU HAR: server trả **40 chat/trang**, kèm `next_cursor` (đôi khi còn
   * `list_page_users: []`). `current_count` mặc định của app LÀ 40 — không phải 60.
   * Bản trước tôi để 60 là sai với HAR (loaddanhsach.har, guikhachcu.har).
   */
  var PAGE_SIZE = 40;

  function buildListUrl(opts) {
    opts = opts || {};
    var st = getReduxState() || {};
    var pgs = st.pages || {};
    /* QUAN TRỌNG: `singlePageId` nghĩa là "CHỈ page này" ⇒ KHÔNG được dùng endpoint
     * nhiều page, dù Redux đang bật multiplePageMode.
     *
     * Bản trước tính `multi` từ Redux mà bỏ qua `singlePageId` ⇒ khi tải 10 page song
     * song, CẢ 10 chuỗi đều gọi `/v1/conversations?pages[…tất cả…]` (endpoint gộp),
     * rồi mỗi chuỗi lại khử trùng với nhau ⇒ mỗi page chỉ ra 80/160 chat rồi dừng.
     * Đây đúng lỗi người dùng báo "chỉ tải được 40 là dừng" (40, 80, 120 tuỳ số page). */
    var multi = !opts.singlePageId && !!pgs.multiplePageMode;

    var ids = Array.isArray(opts.pageIds) && opts.pageIds.length
      ? opts.pageIds.slice()
      : (opts.singlePageId
        ? [String(opts.singlePageId)]
        : (multi
          ? (Array.isArray(pgs.multiplePageIds) ? pgs.multiplePageIds.slice() : [])
          : (pgs.currentPageId ? [pgs.currentPageId] : [])));

    if (!ids.length) {
      /* Không có Redux (store chưa sẵn sàng) ⇒ đọc pageId từ URL. */
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
    push('current_count', String(opts.count || PAGE_SIZE));
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
      last_customer_interactive_at: String((c && c.last_customer_interactive_at) || ''),
      updated_at: String((c && c.updated_at) || ''),
    };
  }

  /**
   * fetchJson — BẰNG BẢN CŨ (`fetchJson`, dòng 1445). Đây là chỗ tôi làm THIẾU
   * và nó gây đúng lỗi người dùng báo: "chỉ tải được 40 là dừng".
   *
   *   • Bản trước: 1 lần fetch, `if (!res.ok) return lỗi` ⇒ trang 2 dính 429 là
   *     DỪNG LUÔN ở 40 chat, và trả `ok:false` ⇒ panel báo lỗi.
   *   • Bản cũ: thử lại 3 lần, nghỉ 400·t ms, có timeout 15 s, và `next_cursor`
   *     được truyền đúng ⇒ qua được cơn bóp tốc độ.
   *
   * Trả `{ ok, data }` hoặc `{ ok:false, error }` — cùng hình dạng bản cũ.
   */
  /* 🧯 CƠN 429 DÙNG CHUNG (bản cũ dòng 1773: "hễ 1 request dính 429 → TOÀN BỘ luồng
   * nghỉ chung 2,5s"). Không có cái này thì 10 chuỗi song song cùng đâm vào server
   * đang bóp ⇒ tất cả cùng thất bại ⇒ lại đúng lỗi "dừng ở 40 chat". */
  var rlUntil = 0;        // mốc hết cơn 429
  var rlHits = 0;         // số lần dính 429 (để báo người dùng)
  var RL_REST_MS = 2500;

  async function waitRateLimit() {
    var now = Date.now();
    if (rlUntil > now) await sleep(rlUntil - now);
  }

  function note429() {
    rlHits++;
    /* Nghỉ dài dần khi dính liên tiếp: 2,5s → 5s → 7,5s (tối đa 10s). */
    rlUntil = Date.now() + Math.min(RL_REST_MS * rlHits, 10000);
  }

  async function fetchJson(url, tries, timeoutMs) {
    var max = tries || 3;
    var lastErr = '';
    for (var t = 1; t <= max; t++) {
      await waitRateLimit();
      var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
      var timer = null;
      if (ctl) timer = setTimeout(function () { try { ctl.abort(); } catch (e) { /* ignore */ } }, timeoutMs || 15000);
      try {
        var r = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: ctl ? ctl.signal : undefined,
        });
        if (timer) { clearTimeout(timer); timer = null; }

        if (r.status === 429) {
          lastErr = 'HTTP 429 (server giới hạn tốc độ)';
          note429();
          if (t < max) { await sleep(300 * t); continue; }
          return { ok: false, error: lastErr };
        }
        if (r.status >= 500) {
          lastErr = 'HTTP ' + r.status;
          if (t < max) { await sleep(400 * t); continue; }
          return { ok: false, error: lastErr };
        }
        if (!r.ok) {
          var body = '';
          try { body = (await r.text() || '').slice(0, 140); } catch (e) { /* ignore */ }
          return { ok: false, error: 'HTTP ' + r.status + (body ? ' · ' + body : '') };
        }
        var txt = await r.text();
        if (!txt || !txt.trim()) return { ok: true, data: { conversations: [] } }; // body rỗng = hết
        var parsed = null;
        try { parsed = JSON.parse(txt); } catch (e) {
          /* HAR: có response nén/mã hoá base64 (loaddanhsach.har) ⇒ phải giải. */
          try { parsed = JSON.parse(atob(txt)); } catch (e2) {
            return { ok: false, error: 'Phản hồi không phải JSON' };
          }
        }
        if (!parsed) return { ok: false, error: 'Phản hồi rỗng' };
        if (parsed.success === false) {
          return { ok: false, error: String(parsed.message || parsed.error || 'server trả success:false') };
        }
        return { ok: true, data: parsed };
      } catch (e) {
        if (timer) { try { clearTimeout(timer); } catch (eT) { /* ignore */ } }
        lastErr = (e && e.name === 'AbortError')
          ? 'quá ' + Math.round((timeoutMs || 15000) / 1000) + 's chưa phản hồi'
          : 'Lỗi mạng: ' + (e && e.message || e);
        if (t < max) { await sleep(400 * t); continue; }
        return { ok: false, error: lastErr };
      }
    }
    return { ok: false, error: lastErr || 'không rõ lỗi' };
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, Math.max(0, ms)); });
  }

  /**
   * Tải MỘT chuỗi cursor (một page). Trả { items, pages, cursor, complete, error }
   *
   * `complete` = đi hết được tới `next_cursor = null` (hoặc hết dữ liệu).
   * Nếu chỉ dừng vì `maxPages` thì `complete=false` nhưng KHÔNG phải lỗi.
   */
  async function loadOneChain(pageId, opts) {
    var items = []; var seen = Object.create(null);
    var cursor = null; var pages = 0;
    var maxPages = Math.max(1, Number(opts.maxPages) || 500);
    var added = 0;
    var stall = 0;

    for (var guard = 0; guard < maxPages; guard++) {
      var req = buildListUrl({
        cursor: cursor, count: opts.count, accessToken: opts.accessToken,
        singlePageId: pageId,
      });
      if (!req.url) return { items: items, pages: pages, cursor: cursor, complete: false, error: req.error };

      var res = await fetchJson(req.url, opts.tries || 3, opts.timeoutMs || 15000);
      if (!res.ok) {
        /* Dừng chuỗi này, GIỮ những gì đã tải, và NÓI RÕ lỗi — không im lặng. */
        return { items: items, pages: pages, cursor: cursor, complete: false, error: res.error };
      }
      var j = res.data || {};
      /* Bản cũ (dòng 9590) đọc ĐƯỢC CẢ HAI dạng:
       *   res.data.conversations  HOẶC  res.data.data.conversations
       * Thiếu vế thứ hai ⇒ ca "response bọc trong data" trả 0 chat mà vẫn ok:true
       * ⇒ người dùng thấy "tải được 0" không rõ vì sao. */
      var convs = j.conversations || (j.data && j.data.conversations) || [];
      var nextCur = j.next_cursor || (j.data && j.data.next_cursor) || null;
      added = 0;
      for (var i = 0; i < convs.length; i++) {
        var it = toItem(convs[i]);
        if (!it || seen[it.id]) continue;
        seen[it.id] = true;
        items.push(it); added++;
      }
      pages++;
      if (typeof opts.onProgress === 'function') {
        try { opts.onProgress(items.length); } catch (e) { /* ignore */ }
      }
      cursor = (convs.length && nextCur) ? nextCur : null;
      if (!cursor || !convs.length) break;
      /* Server trả lại ĐÚNG trang cũ (bỏ qua cursor) ⇒ `added=0` nhưng vẫn có cursor.
       * Bản trước break ngay ⇒ trông như "hết". Nhưng nếu cứ lặp thì vô hạn.
       * Cách đúng: đếm số trang liên tiếp KHÔNG thêm được gì, quá 2 thì dừng + báo. */
      if (!added) {
        /* Đếm stall PHẢI LÀ BIẾN CỤC BỘ của chuỗi này. Bản trước để
         * `loadOneChain._stall` (thuộc tính trên FUNCTION) ⇒ 10 page chạy song song
         * DÙNG CHUNG một biến đếm ⇒ page này bị page kia đẩy lên 2 rồi báo lỗi oan. */
        stall++;
        if (stall >= 2) return { items: items, pages: pages, cursor: cursor, complete: false, error: 'server trả lặp trang cũ 2 lần (cursor bị bỏ qua)' };
      } else {
        stall = 0;
      }
    }
    return { items: items, pages: pages, cursor: cursor, complete: !cursor };
  }

  /**
   * Tải danh sách. NHIỀU PAGE: chạy các chuỗi cursor SONG SONG (giới hạn 10, như bản
   * cũ dòng 1744) — mỗi page một chuỗi riêng để `next_cursor` của page này không
   * chặn page kia.
   *
   *   opts = { maxPages, count, tries, timeoutMs, onProgress, cursor,
   *            accessToken, pageIds, singlePageId }
   * Trả { ok, items, pages, incomplete, errors, perPage }
   */
  async function load(opts) {
    opts = opts || {};
    var st = getReduxState() || {};
    var pgs = st.pages || {};
    var multi = !!pgs.multiplePageMode;

    /* Danh sách page cần tải */
    var ids = Array.isArray(opts.pageIds) && opts.pageIds.length
      ? opts.pageIds.slice()
      : (opts.singlePageId ? [String(opts.singlePageId)]
        : (multi ? (Array.isArray(pgs.multiplePageIds) ? pgs.multiplePageIds.slice() : [])
          : (pgs.currentPageId ? [pgs.currentPageId] : [])));
    if (!ids.length) {
      var m = /\/pages\/(\d+)/.exec(location.pathname || '') || /[?&]page_id=(\d+)/.exec(location.search || '');
      if (m) ids = [m[1]];
    }
    if (!ids.length) return { ok: false, items: [], pages: 0, error: 'Không xác định được page_id (Redux chưa sẵn sàng?)' };

    var token = getToken(opts.accessToken);
    if (!token) return { ok: false, items: [], pages: 0, error: 'Không tìm thấy access_token — tải lại trang Pancake' };

    var o = {
      count: opts.count, tries: opts.tries, timeoutMs: opts.timeoutMs,
      maxPages: opts.maxPages, accessToken: token,
      onProgress: function () {
        if (typeof opts.onProgress === 'function') {
          try { opts.onProgress(total, ids.length); } catch (e) { /* ignore */ }
        }
      },
    };

    var total = 0;
    var allItems = [];
    var seenAll = Object.create(null);
    var pagesDone = 0;
    var errors = [];
    var perPage = Object.create(null);

    /* Giới hạn 10 chuỗi song song (bản cũ dòng 1744). */
    var CONC = 10;
    var nextIdx = 0;
    var workers = [];
    var nW = Math.min(CONC, ids.length);
    for (var w = 0; w < nW; w++) {
      workers.push((async function () {
        for (;;) {
          var k = nextIdx++;
          if (k >= ids.length) return;
          var pid = String(ids[k]);
          var r = await loadOneChain(pid, o);
          pagesDone += r.pages;
          perPage[pid] = { items: r.items.length, pages: r.pages, complete: r.complete, error: r.error || '' };
          if (r.error) errors.push(pid + ': ' + r.error);
          for (var i = 0; i < r.items.length; i++) {
            var it = r.items[i];
            if (seenAll[it.id]) continue;
            seenAll[it.id] = true;
            allItems.push(it);
          }
          total = allItems.length;
        }
      })());
    }
    await Promise.all(workers);

    /* Sắp lại ĐÚNG thứ tự app: ghim trên cùng → chưa đọc → mới nhất trước.
     * (bản cũ: "ghim trên cùng → chưa đọc → đã đọc, trong nhóm theo updated_at giảm dần") */
    allItems.sort(function (a, b) {
      var ta = Date.parse(a.updated_at) || 0;
      var tb = Date.parse(b.updated_at) || 0;
      return tb - ta;
    });

    /* `ok` = TẢI TRỌN VẸN. Có page lỗi thì `ok:false` — NHƯNG vẫn trả items đã tải
     * được, để người dùng không mất công và thấy rõ phần nào thiếu.
     * Bản trước luôn trả `ok:true` dù có lỗi ⇒ panel coi như thành công, chỉ hiện
     * "0 chat" mà KHÔNG nói vì sao (đúng lỗi "tải được 40 rồi dừng" không rõ nguyên nhân). */
    return {
      ok: errors.length === 0,
      items: allItems,
      pages: pagesDone,
      incomplete: errors.length > 0,
      errors: errors,
      perPage: perPage,
      rateLimited: rlHits,
    };
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
