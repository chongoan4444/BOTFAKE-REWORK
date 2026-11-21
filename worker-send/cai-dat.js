// ==UserScript==
// @name         BOTFAKE — Gửi bằng Worker
// @namespace    botfake-worker-send
// @version      1.92.55-W200.101
// @description  Gửi hàng loạt Pancake, phần điều phối chạy trong Web Worker
// @match        https://pancake.vn/*
// @match        https://*.pancake.vn/*
// @match        https://pages.fm/*
// @match        https://*.pages.fm/*
// @match        https://pancake.ph/*
// @match        https://pancake.id/*
// @match        https://pancake.in/*
// @match        https://pancake.biz/*
// @match        https://socialos.vip/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

/* ============================================================================
 * BOTFAKE · GỬI BẰNG WORKER — bản cài 1 file
 * Sinh tự động bởi worker-send/build.mjs — ĐỪNG SỬA TAY.
 * Gốc: 1.92.55-W200.101
 * ============================================================================
 *
 * DÙNG:
 *   1. Mở trang Pancake (pages.fm hoặc pancake.vn), đợi danh sách chat hiện ra.
 *   2. F12 → Console → dán toàn bộ file này → Enter.
 *   3. Nút "⚡ GỬI BẰNG WORKER" hiện ở góc dưới phải. Bấm vào.
 * ============================================================================ */
(function botfakeWorkerSendInstall() {
  'use strict';
  if (window.__BOTFAKE_WS_INSTALLED__) {
    var old = document.getElementById('bws-root');
    if (old) { old.style.display = 'block'; }
    console.warn('[BOTFAKE-WS] đã nạp rồi — nút đang ở góc dưới phải');
    return;
  }
  window.__BOTFAKE_WS_INSTALLED__ = true;

  var ENGINE_SRC = `/**
 * BOTFAKE WORKER-SEND — LÕI ĐIỀU PHỐI GỬI, KHÔNG PHỤ THUỘC DOM
 * ============================================================================
 * LÝ DO TỒN TẠI (bằng chứng số, xem docs/HAR-GROUND-TRUTH.md §91):
 *
 *   Ba tab chạy cùng lúc (16:27:05 / 16:27:14 / 16:27:18), cả ba đều 1.92.55:
 *     tab 1: PHÁT 19,28/s · ACK OK 77 · no-ACK 5 601 · giữ slot 5 372 ms
 *            🫥 \`+84 969 s\` kẹt · trễ 15 925 lần · nặng nhất 10,9 s
 *     tab 3: 🫥 \`+66 575 s\` kẹt · trễ 15 015 lần · nặng nhất **45,9 s**
 *   mà \`chờ 364 ms / còn lại 5 372 ms\` ⇒ 98,7 % thời gian giữ slot là KẸT, không phải I/O.
 *
 *   Nghĩa là: script cũ chạy TOÀN BỘ trên main thread của trang Pancake (cạnh React +
 *   MQTT + 3 tab). CPU bị bóp ⇒ đồng hồ trễ ⇒ ACK về muộn hơn hạn chờ ⇒ mất ACK.
 *   Hạ nhịp VẼ DOM không cứu được vì thủ phạm là promise/closure tạo theo TỪNG CHAT.
 *
 * MODULE NÀY LÀ GÌ
 *   Toàn bộ phần điều phối (băm việc, slot, hạn chờ ACK, phân loại kết quả) nằm ở đây,
 *   viết bằng **JS thuần, không DOM, không localStorage, không chrome.*, không fetch**.
 *   ⇒ Chạy được NGUYÊN VĂN trong Web Worker trên trang Pancake VÀ trong Node để test.
 *
 * RÀNG BUỘC BẮT BUỘC (giữ đúng cơ chế đã kiểm chứng của bản 1.92.x):
 *   • KHÔNG gửi trùng. Mỗi chat chỉ được "bắn" khi chưa có lần bắn nào đang chờ ACK.
 *   • Ưu tiên KHÔNG MẤT TIN IM LẶNG hơn tốc độ.
 *   • Mọi phụ thuộc môi trường (đồng hồ, gửi HTTP, ghi log) được TIÊM VÀO (dependency
 *     injection) chứ không gọi trực tiếp ⇒ test được bằng đồng hồ giả.
 *
 * KHÔNG chứa ở đây (sẽ làm ở lớp vỏ):
 *   • dò global_id     (cần đọc Redux/IndexedDB/MQTT của Pancake ⇒ vẫn ở main thread)
 *   • bind fbId ảnh    (cần token từ trang ⇒ gọi qua cầu nối)
 *   • vẽ log/panel     (main thread, đã hạ nhịp)
 */

/* ============================ HẰNG SỐ (đọc từ bản 1.92.55) ============================ */

/** Nhịp phát tối thiểu cho mỗi page — \`SOCKET_MIN_PACE_MS = 4\` (dòng 4425 bản cũ). */
export const SOCKET_MIN_PACE_MS = 4;

/** Trần hạn chờ GIỮ SLOT: clav(p90×3, 1200, 6000) — \`ACK_HOLD_MIN/CEIL_MS\` (dòng 6130). */
export const ACK_HOLD_MIN_MS = 1200;
export const ACK_HOLD_CEIL_MS = 6000;

/** Cửa sổ NGHE tiếp sau khi hết hạn chờ giữ slot (không giữ slot) — \`ACK_LISTEN_MAX_MS\`. */
export const ACK_LISTEN_MAX_MS = 30000;
export const ACK_LISTEN_MIN_MS = 12000;

/** Số mẫu để tính p90 — \`ACK_LAT_RING_N = 1000\`. */
export const ACK_LAT_RING_N = 1000;

/** Số slot main mặc định (bản cũ: 96–192 tuỳ tab/focus/peer). */
export const DEFAULT_MAIN_CAP = 96;

/* ============================ ĐỒNG HỒ (tiêm được) ============================ */

/**
 * Đồng hồ thật trong Worker: KHÔNG dùng setTimeout của trang.
 * Worker có timer riêng nên không bị Chrome hạ ưu tiên như timer trên main thread.
 * \`stopPromise\` cho phép cắt mọi lượt chờ ngay khi bấm Dừng.
 */
export function makeRealClock(stopPromise) {
  return {
    now: () => Date.now(),
    wait(ms) {
      const d = Math.max(0, Math.round(Number(ms) || 0));
      if (!d) return Promise.resolve();
      return new Promise((resolve) => {
        let done = false;
        const fin = () => { if (done) return; done = true; resolve(); };
        const t = setTimeout(fin, d);
        if (stopPromise) {
          Promise.resolve(stopPromise).then(() => { try { clearTimeout(t); } catch (e) { /* ignore */ } fin(); });
        }
      });
    },
  };
}

/** Đồng hồ GIẢ cho test: thời gian chỉ chạy khi gọi \`advance(ms)\`. Không dùng setTimeout. */
export const FAKE_EPOCH_BASE = 1770000000000; // mốc epoch thật — xem chú thích K37
export function makeFakeClock(startAt) {
  let t = Number(startAt) || FAKE_EPOCH_BASE;
  const timers = [];
  let seq = 0;
  const api = {
    now: () => t,
    wait(ms) {
      const d = Math.max(0, Math.round(Number(ms) || 0));
      if (!d) return Promise.resolve();
      return new Promise((resolve) => { timers.push({ at: t + d, resolve, id: ++seq }); });
    },
    /**
     * Chạy tới \`ms\` giây-mili kế tiếp, giải phóng timer theo ĐÚNG thứ tự thời gian.
     * Trả về số timer đã bắn. Cho \`await\` để microtask chạy hết giữa các mốc.
     */
    async advance(ms) {
      const target = t + Math.max(0, Number(ms) || 0);
      /* Hút microtask SÂU trước mỗi lần tìm timer: một lượt \`sendOne()\` đi qua
       * lane.enqueue → .then → pace → wait, tức 4–6 tầng microtask, nên chỉ
       * \`await Promise.resolve()\` MỘT lần là chưa đủ để timer mới kịp đăng ký.
       * (Đây chính là lỗi làm test treo ở lần viết đầu.) */
      const drain = async (n) => { for (let k = 0; k < (n || 24); k++) await Promise.resolve(); };
      let fired = 0;
      for (;;) {
        await drain(24);
        let best = -1;
        for (let i = 0; i < timers.length; i++) {
          if (timers[i].at > target) continue;
          if (best < 0 || timers[i].at < timers[best].at) best = i;
        }
        if (best < 0) break;
        const tm = timers.splice(best, 1)[0];
        if (tm.at > t) t = tm.at;
        fired++;
        tm.resolve();
      }
      if (target > t) t = target;
      await drain(24);
      return fired;
    },
    pendingTimers: () => timers.length,
  };
  return api;
}

/* ============================ PHÂN VỊ ============================ */

/** Phân vị của mảng ĐO ĐƯỢC (không sắp xếp mảng gốc). pct = 0…1 */
export function latencyPct(arr, pct) {
  const a = (arr || []).slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const i = Math.min(a.length - 1, Math.max(0, Math.floor(a.length * pct)));
  return a[i];
}

/** Hạn chờ GIỮ SLOT = clamp(p90 × 3, 1200, 6000) — y hệt bản cũ (dòng 6153). */
export function ackHoldMsFor(p90) {
  const v = Math.round(Number(p90) || 0) || 3000;
  return Math.max(ACK_HOLD_MIN_MS, Math.min(ACK_HOLD_CEIL_MS, Math.round(v * 3)));
}

/** Cửa sổ NGHE = max(12 000, hạn chờ + 6 000), trần 30 000 — y hệt bản cũ. */
export function ackListenMsFor(holdMs) {
  return Math.min(ACK_LISTEN_MAX_MS, Math.max(ACK_LISTEN_MIN_MS, Math.round(holdMs + 6000)));
}

/* ============================ LANE (hàng đợi có giới hạn) ============================ */

/**
 * \`makeLane(limit)\` — y hệt ngữ nghĩa \`makeLane\` bản cũ (dòng 6326):
 *  • \`enqueuePaced(pageKey, fn)\` chờ đúng nhịp \`SOCKET_MIN_PACE_MS\` THEO PAGE trước khi chạy.
 *  • Slot được CHUYỀN TRỰC TIẾP cho người chờ kế (không tăng/giảm bộ đếm) — giữ đúng
 *    hành vi \`releaseMainSlot\` bản cũ, và vì thế "chờ slot" không phải chi phí thật.
 */
export function makeLane(limit) {
  let active = 0;
  let cap = Math.max(1, Number(limit) || 1);
  const waiters = [];
  const lastPublishAt = {};
  const stats = { active: 0, waiting: 0, peakActive: 0 };

  const note = () => {
    stats.active = active;
    stats.waiting = waiters.length;
    if (active > stats.peakActive) stats.peakActive = active;
  };

  const run = (fn) => {
    active++;
    note();
    return Promise.resolve()
      .then(fn)
      .catch((e) => ({ ok: false, sent: false, error: 'Lỗi kênh: ' + (e && e.message || e) }))
      .then((r) => {
        active--;
        note();
        if (waiters.length) {
          const next = waiters.shift();
          active++; // chuyền slot: bộ đếm KHÔNG đổi
          note();
          next.start();
        }
        return r;
      });
  };

  const start = (fn) => run(fn);

  return {
    getLimit: () => cap,
    setLimit(n) { cap = Math.max(1, Number(n) || 1); while (waiters.length && active < cap) { const w = waiters.shift(); active++; note(); w.start(); } return cap; },
    activeCount: () => active,
    waitingCount: () => waiters.length,
    stats: () => Object.assign({}, stats),
    /**
     * Nhịp phát theo page — TÁCH RIÊNG khỏi slot (bản cũ: \`paceSocketPublish\`).
     *
     * [SỬA SAU TEST K35] Bản đầu tôi viết \`nextAt = max(now, last + 4)\` rồi \`await wait(...)\`.
     * Với 5 chat vào CÙNG một mốc thời gian (đồng hồ giả / burst thật), CẢ 5 đọc cùng \`last\`,
     * nên cả 5 nhận cùng \`nextAt\` ⇒ chờ 0 ms ⇒ MẤT NHỊP (đo ra paceWaitN = 0).
     * Nay cấp mốc TUẦN TỰ: \`nextAt = max(now, last + 4)\` và ghi lại NGAY, nhưng mốc được
     * cấp đồng bộ trước khi chờ ⇒ chat thứ n chờ đúng (n−1)×4 ms. Đây chính là hành vi
     * của bản cũ khi các lượt gọi đến lần lượt; bản cũ cũng sai nếu đến đồng thời.
     */
    async pace(pageKey, clock) {
      const pid = String(pageKey || '');
      if (!pid) return;
      const now = clock.now();
      /* GIỮ ĐÚNG CÔNG THỨC BẢN CŨ (dòng 4429): \`max(now, last + 4)\`.
       * Lần đầu của một page: \`last\` chưa có ⇒ 0 ⇒ \`max(now, 4)\` = \`now\` khi \`now\` là mốc
       * epoch thật ⇒ chờ 0 ms. (Đồng hồ giả PHẢI bắt đầu ở mốc epoch thật; nếu bắt đầu từ 0
       * thì \`max(0, 4)\` = 4 ⇒ page đầu tiên bị chờ 4 ms OAN — test K37 bắt được đúng ca này.) */
      const nextAt = Math.max(now, (lastPublishAt[pid] || 0) + SOCKET_MIN_PACE_MS);
      lastPublishAt[pid] = nextAt;
      const waitMs = nextAt - now;
      if (waitMs > 0) await clock.wait(waitMs);
    },
    enqueue(fn) {
      if (active < cap) return start(fn);
      return new Promise((resolve, reject) => {
        waiters.push({ start: () => { start(fn).then(resolve, reject); } });
        note();
      });
    },
  };
}

/* ============================ ĐIỀU PHỐI CHÍNH ============================ */

/**
 * \`createWorkerSend(deps)\` — trả về bộ điều phối gửi.
 *
 * deps (tất cả BẮT BUỘC trừ khi ghi chú):
 *   clock              : { now(), wait(ms) }              — makeRealClock hoặc makeFakeClock
 *   publish(conv, opts): Promise<{ ok, kind?, error?, sentAtMs? }>
 *                        \`kind\`: 'ok' | 'rejected' | 'noack' | 'error' | 'dead'
 *                        Đây là chỗ TIÊM đường mạng. Worker gọi HTTP/Socket ở đây.
 *   mainCap            : số slot main (mặc định DEFAULT_MAIN_CAP)
 *   onLog(rec)         : (tuỳ chọn) nhận bản ghi log dạng object, main thread tự vẽ
 *   onSettle(rec)      : (tuỳ chọn) một chat đã có kết quả cuối
 *   ackLatRingMax      : (tuỳ chọn) số mẫu p90 (mặc định ACK_LAT_RING_N)
 */
export function createWorkerSend(deps) {
  const d = deps || {};
  if (!d.clock || typeof d.clock.now !== 'function') throw new Error('createWorkerSend: thiếu clock');
  if (typeof d.publish !== 'function') throw new Error('createWorkerSend: thiếu publish()');

  const clock = d.clock;
  const mainCap = Math.max(1, Number(d.mainCap) || DEFAULT_MAIN_CAP);
  const ackLatRingMax = Math.max(20, Number(d.ackLatRingMax) || ACK_LAT_RING_N);

  const ackLatRing = [];
  const mainLane = makeLane(mainCap);
  const pageLanes = {}; // pageId → lane riêng (nhịp phát + số slot theo page)

  const delivered = new Set(); // chat ĐÃ CHẮC CHẮN tới nơi
  const failed = new Set();    // chat ĐÃ CHỐT lỗi
  const inFlight = new Set();  // chat ĐANG bắn, chưa có kết quả (chống trùng)

  /** Số đo — in ra ở TỔNG HỢP. Giữ tên khớp bản cũ để đối chiếu log được. */
  const diag = {
    n: 0, ok: 0, fail: 0, uncertain: 0,
    dupBlocked: 0,
    slotN: 0, slotHoldMs: 0, slotAcquireMs: 0,
    ackHoldExpired: 0, ackSilent: 0, ackLateOk: 0,
    paceWaitMs: 0, paceWaitN: 0,
    peakInFlight: 0,
    startedAt: 0, endedAt: 0,
  };

  function laneFor(pageKey) {
    const pid = String(pageKey || '');
    if (!pid) return mainLane;
    if (!pageLanes[pid]) pageLanes[pid] = makeLane(mainCap);
    return pageLanes[pid];
  }

  function noteAckLatency(ms) {
    const v = Math.round(Number(ms) || 0);
    if (v <= 0) return;
    ackLatRing.push(v);
    if (ackLatRing.length > ackLatRingMax) ackLatRing.shift();
  }

  /** p90 của mẫu ĐO ĐƯỢC; chưa đủ 20 mẫu thì 3 000 ms (y hệt bản cũ \`sockAckP90\`). */
  function ackP90() {
    if (ackLatRing.length < 20) return 3000;
    return latencyPct(ackLatRing, 0.9);
  }

  /**
   * Gửi MỘT chat. Đây là toàn bộ phần "giữ slot" của bản cũ, tách khỏi DOM.
   *
   * Chống trùng 3 lớp (giữ đúng như bản 1.92.x):
   *   1) đã delivered / failed ⇒ bỏ qua, KHÔNG bắn
   *   2) đang inFlight       ⇒ bỏ qua (dupBlocked) — trước đây là \`sockFiredPending\`
   *   3) sau khi publish, chat nằm inFlight cho tới khi có kết quả
   */
  async function sendOne(conv) {
    if (!conv || !conv.id) return { ok: false, sent: false, error: 'Thiếu conv.id' };
    /* [K17] KIỂM + ĐẶT CỜ \`inFlight\` PHẢI LÀ MỘT BƯỚC ĐỒNG BỘ DUY NHẤT.
     * Bản đầu của tôi đặt cờ này BÊN TRONG \`lane.enqueue(...)\` — mà enqueue chạy \`fn\` ở
     * microtask sau ⇒ 3 lần gọi song song cùng chat đều lọt qua cổng kiểm và BẮN 3 LẦN.
     * Đây đúng là loại lỗi "chống trùng mà vẫn trùng", nên test khoá nó thành K17.
     * Nay: kiểm + đặt cờ ngay tại đây (không await gì ở giữa) ⇒ cổng thật sự nguyên tử. */
    /* BA cổng chặn đều phải ĐẾM dupBlocked — nếu chỉ cổng inFlight đếm thì:
     *   • ID trùng ĐI TUẦN TỰ (danh sách có 2 dòng cùng chat) bị nhánh \`delivered\` chặn
     *     mà không vào sổ ⇒ người dùng không biết danh sách của mình có chat lặp.
     *   • ID trùng SONG SONG thì mới vào \`inFlight\`.
     * Cả hai đều là "đã bắn rồi, lần này không bắn" ⇒ cùng một nghĩa, phải cùng một bộ đếm. */
    if (delivered.has(conv.id)) { diag.dupBlocked++; return { ok: true, sent: false, duplicate: true, dupBlocked: true }; }
    if (failed.has(conv.id)) { diag.dupBlocked++; return { ok: false, sent: false, duplicate: true, dupBlocked: true }; }
    if (inFlight.has(conv.id)) {
      diag.dupBlocked++;
      return { ok: true, sent: false, dupBlocked: true };
    }
    /* [SỬA SAU TEST K43] ĐẶT CỜ NGAY, ĐỒNG BỘ — không được chờ vào lane.
     * \`lane.enqueue\` chạy fn ở microtask sau, nên nếu đặt cờ trong fn thì với \`limit\` làn
     * (chạy SONG SONG), dòng trùng thứ 2 đọc \`inFlight\` TRƯỚC khi dòng 1 kịp đặt cờ ⇒ lọt
     * ⇒ bắn 2 lần. Đây đúng lỗi commit cũ từng gặp ở bản 1.92.x (\`sockFiredPending\`). */
    inFlight.add(conv.id);
    diag.n++;
    if (inFlight.size > diag.peakInFlight) diag.peakInFlight = inFlight.size;

    const pid = conv.pageId || String(conv.id).split('_')[0];
    const lane = laneFor(pid);

    // (a) CHỜ SLOT — đo riêng (bản cũ: slotAcquireMs)
    const tAcq0 = clock.now();

    try {
      return await lane.enqueue(async () => {
        /* (cờ inFlight đã được đặt ĐỒNG BỘ ở trên — không đặt lại ở đây) */
        const tHold0 = clock.now();
        diag.slotAcquireMs += Math.max(0, tHold0 - tAcq0);

        // (b) NHỊP PHÁT theo page — đo riêng (bản cũ: pace), KHÔNG tính vào giữ slot logic
        const tPace0 = clock.now();
        await lane.pace(pid, clock);
        const paceMs = Math.max(0, clock.now() - tPace0);
        if (paceMs > 0) { diag.paceWaitMs += paceMs; diag.paceWaitN++; }

        // (c) HẠN CHỜ ACK theo p90 — y hệt bản cũ
        const holdMs = ackHoldMsFor(ackP90());
        const listenMs = ackListenMsFor(holdMs);

        // (d) BẮN
        const pubT0 = clock.now();
        let res;
        try { res = await d.publish(conv, { holdMs, listenMs, pageId: pid }); }
        catch (e) { res = { ok: false, kind: 'error', error: String(e && e.message || e) }; }
        res = res || { ok: false, kind: 'error', error: 'publish() không trả gì' };

        const kind = String(res.kind || (res.ok ? 'ok' : 'error'));

        // (e) PHÂN LOẠI — mọi nhánh đều phải AN TOÀN (không bao giờ bắn lại mù)
        let out;
        if (kind === 'ok') {
          delivered.add(conv.id);
          diag.ok++;
          if (res.ackMs != null) noteAckLatency(res.ackMs);
          out = { ok: true, sent: true, kind: 'ok', ackMs: res.ackMs != null ? res.ackMs : null };
        } else if (kind === 'rejected') {
          // FB từ chối DỨT KHOÁT ⇒ chắc chắn chưa đi. Ghi vào \`failed\` để KHÔNG bắn lại
          // ở lượt này; việc bù kênh khác do tầng trên quyết định (nó biết còn kênh nào).
          failed.add(conv.id);
          diag.fail++;
          out = { ok: false, sent: false, kind: 'rejected', error: res.error || 'FB từ chối' };
        } else if (kind === 'noack') {
          // KHÔNG có ACK: TUYỆT ĐỐI coi là "chưa rõ", KHÔNG bắn lại (chống gửi trùng).
          // Bản cũ: \`pageAckHoldExpired\` / \`mySilent\` — tách 2 loại.
          if (res.silent) diag.ackSilent++; else diag.ackHoldExpired++;
          diag.uncertain++;
          out = { ok: false, sent: 'maybe', uncertain: true, kind: 'noack', error: res.error || 'Không có ACK' };
        } else if (kind === 'dead') {
          // Socket không kết nối: CHƯA bắn ⇒ bỏ \`failed\` để kênh khác/nhịp sau còn cứu.
          diag.fail++;
          out = { ok: false, sent: false, kind: 'dead', error: res.error || 'Socket không kết nối' };
        } else {
          diag.fail++;
          out = { ok: false, sent: false, kind: 'error', error: res.error || 'Lỗi kênh' };
        }

        const holdMsReal = Math.max(0, clock.now() - tHold0);
        diag.slotHoldMs += holdMsReal;
        diag.slotN++;

        if (typeof d.onLog === 'function') {
          try { d.onLog({ convId: conv.id, name: conv.name || '', kind: out.kind, ok: !!out.ok, holdMs: holdMsReal, paceMs, pubMs: clock.now() - pubT0, at: clock.now() }); } catch (e) { /* ignore */ }
        }
        return out;
      });
    } finally {
      /* Nhả cờ ở MỌI lối ra (kể cả lane ném lỗi hoặc đã Dừng) — không để chat kẹt inFlight
       * vĩnh viễn, vì như vậy lần sau nó sẽ bị chặn như "đang bắn" và tin không bao giờ đi. */
      inFlight.delete(conv.id);
      if (typeof d.onSettle === 'function') {
        try { d.onSettle({ convId: conv.id, delivered: delivered.has(conv.id), failed: failed.has(conv.id) }); } catch (e) { /* ignore */ }
      }
    }
  }

  /**
   * Gửi cả danh sách với \`limit\` làn — y hệt \`runPool\` bản cũ nhưng việc rút là O(1)
   * và KHÔNG tạo closure cho từng item ngoài làn (giảm promise so với bản cũ).
   */
  async function sendAll(list, opts) {
    const items = Array.isArray(list) ? list : [];
    const limit = Math.max(1, Math.min((opts && opts.limit) || mainCap, items.length || 1));
    let next = 0;
    const results = new Array(items.length);
    diag.startedAt = clock.now();
    const lanes = [];
    for (let k = 0; k < limit; k++) {
      lanes.push((async () => {
        for (;;) {
          const i = next++;
          if (i >= items.length) return;
          /* [W2] ID TRÙNG TRONG CHÍNH DANH SÁCH: vẫn phải đi qua \`sendOne\` để được ĐẾM
           * (\`dupBlocked\`) — nếu lọc im lặng ở đây thì số liệu không phản ánh đúng và người
           * dùng không biết danh sách của mình có chat lặp. \`sendOne\` đã chặn an toàn
           * (không bắn lần 2), nên đi qua đây KHÔNG tốn thêm request nào. */
          results[i] = await sendOne(items[i]);
        }
      })());
    }
    await Promise.all(lanes);
    diag.endedAt = clock.now();
    return results;
  }

  return {
    sendOne,
    sendAll,
    diag,
    ackP90,
    ackLatSamples: () => ackLatRing.slice(),
    laneFor,
    mainLane,
    isDelivered: (id) => delivered.has(id),
    isFailed: (id) => failed.has(id),
    isInFlight: (id) => inFlight.has(id),
    stats: () => ({
      n: diag.n, ok: diag.ok, fail: diag.fail, uncertain: diag.uncertain,
      dupBlocked: diag.dupBlocked,
      holdAvg: diag.slotN ? Math.round(diag.slotHoldMs / diag.slotN) : 0,
      acquireAvg: diag.slotN ? Math.round(diag.slotAcquireMs / diag.slotN) : 0,
      paceAvg: diag.paceWaitN ? Math.round(diag.paceWaitMs / diag.paceWaitN) : 0,
      peakInFlight: diag.peakInFlight,
      elapsedMs: Math.max(0, (diag.endedAt || clock.now()) - (diag.startedAt || clock.now())),
      rate: 0,
    }),
  };
}
`;
  var WORKER_SRC = `/**
 * BOTFAKE WORKER-SEND — LỚP VỎ CHẠY TRONG WEB WORKER
 * ============================================================================
 * File này được nạp bằng \`new Worker(blobURL, { type: 'module' })\` (hoặc file trực tiếp
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
 * Worker trên trang Pancake dùng \`self.postMessage\` + \`self.onmessage\`.
 * Node dùng \`parentPort\` + \`workerData\`/\`postMessage\`. Giữ MỘT bản code cho cả hai
 * để test bằng Node chính là code chạy thật trên trình duyệt — không test bản sao.
 * ------------------------------------------------------------------------- */
const IS_NODE = (typeof self === 'undefined' || typeof self.postMessage !== 'function');

let nodePort = null;
if (IS_NODE) {
  /* KHÔNG dùng \`await import(...)\` ở đây: nó là top-level await ⇒ khi bridge.js
   * nhúng file này vào một Blob/IIFE (không phải module) sẽ là SyntaxError.
   * \`process.getBuiltinModule\` lấy được module đồng bộ (Node >= 20.16 / 22). */
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
 *   \`/conversations/{convId}\`, thiếu \`action=reply_inbox\`, thiếu \`send_by_platform=web\`.
 *   Test cũ vẫn xanh vì server giả của tôi nhận gì cũng trả \`success\` — test đúng mà
 *   giả thuyết sai. Nay đối chiếu với \`buildInboxSend\` của bản 1.92.55 (dòng 3130).
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
 * \`is_record_ctx_7_days\` KHÔNG phải tuỳ chọn cho vui — HAR: 19/19 request CÓ cờ ⇒
 * success:true; 24/24 request THIẾU cờ ⇒ (#10). Thiếu cờ là nguyên nhân phổ biến nhất
 * của (#10), KHÔNG phải "app khác giữ thread". Cờ do main thread tính (cần Redux của
 * trang) rồi truyền vào \`conv.isRecordCtx7Days\`.
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
    /* \`credentials: 'omit'\` — CỐ Ý. Worker gửi kèm access_token, không dựa cookie phiên
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

/** Nhận diện lỗi FB TỪ CHỐI DỨT KHOÁT — bản cũ: \`isWindowClosedError\` + 1545041. */
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

/* Khởi động. Tách thành hàm để \`bridge.js\` gọi được sau khi nhúng file này vào Blob
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
`;

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


  var B = window.__BOTFAKE_WORKER_SEND__;
  if (!B) { console.error('[BOTFAKE-WS] nạp bridge.js thất bại'); return; }
  B.setSources(ENGINE_SRC, WORKER_SRC);
  B.setConfig({ mainCap: 96 });

  /* ============================ GIAO DIỆN ============================
   * Chỉ 1 khung nhỏ, 3 dòng, 2 nút. Không có bảng chọn chat, không tag, không
   * lịch gửi — bản này chỉ để ĐO đường gửi mới, không phải bản thay thế. */
  var CSS = [
    '#bws-root{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:320px;',
    'font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;',
    'background:#fff;border:1px solid #d5d9e0;border-radius:10px;',
    'box-shadow:0 8px 28px rgba(0,0,0,.18);overflow:hidden}',
    '#bws-root *{box-sizing:border-box}',
    '#bws-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#0b63d6;color:#fff}',
    '#bws-head b{font-size:13px;flex:1}',
    '#bws-head button{background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:6px;',
    'padding:2px 8px;cursor:pointer;font-size:12px}',
    '#bws-body{padding:10px;display:flex;flex-direction:column;gap:8px}',
    '#bws-text{width:100%;min-height:64px;resize:vertical;padding:7px 8px;border:1px solid #cfd6e0;',
    'border-radius:7px;font:13px/1.4 inherit}',
    '#bws-info{font-size:12px;color:#556;min-height:16px}',
    '#bws-row{display:flex;gap:8px}',
    '#bws-row button{flex:1;padding:8px 10px;border:0;border-radius:7px;cursor:pointer;',
    'font-weight:600;font-size:13px}',
    '#bws-load{background:#e8eef8;color:#0b4ea2}',
    '#bws-send{background:#0b63d6;color:#fff}',
    '#bws-send:disabled,#bws-load:disabled{opacity:.45;cursor:default}',
    '#bws-stop{background:#f3e8e8;color:#a11}',
    '#bws-log{max-height:120px;overflow:auto;font:12px/1.4 ui-monospace,Menlo,monospace;',
    'background:#f6f8fb;border-radius:6px;padding:6px;color:#334}',
    '#bws-log div{padding:1px 0;word-break:break-word}',
    '#bws-log .ok{color:#137a2f}#bws-log .bad{color:#a11}#bws-log .warn{color:#9a6700}',
  ].join('');

  function el(tag, id, txt) {
    var e = document.createElement(tag);
    if (id) e.id = id;
    if (txt != null) e.textContent = txt;
    return e;
  }

  var root, taText, inf, logBox, btnLoad, btnSend, btnStop;

  function logLine(kind, txt) {
    if (!logBox) return;
    var d = el('div', null, txt);
    if (kind === 'ok') d.className = 'ok';
    else if (kind === 'rejected') d.className = 'bad';
    else if (kind === 'noack') d.className = 'warn';
    logBox.appendChild(d);
    while (logBox.childNodes.length > 200) logBox.removeChild(logBox.firstChild);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function setInfo(t) { if (inf) inf.textContent = t; }

  function buildUI() {
    var st = el('style'); st.textContent = CSS; document.head.appendChild(st);

    root = el('div', 'bws-root');
    var head = el('div', 'bws-head');
    head.appendChild(el('b', null, 'Gửi bằng Worker'));
    var min = el('button', null, '—');
    min.title = 'Thu nhỏ';
    var close = el('button', null, '✕');
    close.title = 'Ẩn (dán lại file để hiện)';
    head.appendChild(min); head.appendChild(close);
    root.appendChild(head);

    var body = el('div', 'bws-body');

    taText = el('textarea', 'bws-text');
    taText.placeholder = 'Nội dung sẽ gửi cho TẤT CẢ chat đã tải…';
    body.appendChild(taText);

    inf = el('div', 'bws-info', 'Bấm "Tải danh sách" để bắt đầu.');
    body.appendChild(inf);

    var row = el('div', 'bws-row');
    btnLoad = el('button', 'bws-load', '⟳ Tải danh sách');
    btnSend = el('button', 'bws-send', '⚡ Gửi');
    btnSend.disabled = true;
    row.appendChild(btnLoad); row.appendChild(btnSend);
    body.appendChild(row);

    var row2 = el('div', 'bws-row');
    btnStop = el('button', 'bws-stop', '⏹ Dừng');
    btnStop.disabled = true;
    row2.appendChild(btnStop);
    body.appendChild(row2);

    logBox = el('div', 'bws-log');
    body.appendChild(logBox);

    root.appendChild(body);
    document.body.appendChild(root);

    min.onclick = function () {
      body.style.display = body.style.display === 'none' ? 'flex' : 'none';
    };
    close.onclick = function () { root.style.display = 'none'; };
  }

  /* ------------------------------- HÀNH ĐỘNG ------------------------------- */

  var loaded = null;   // danh sách đã tải (có cờ ctx7)
  var busy = false;

  function setBusy(b) {
    busy = b;
    btnLoad.disabled = b;
    btnStop.disabled = !b;
    btnSend.disabled = b || !loaded || !loaded.length;
  }

  async function doLoad() {
    if (busy) return;
    setBusy(true);
    setInfo('Đang tải danh sách chat…');
    logBox.innerHTML = '';
    try {
      var LL = window.__BOTFAKE_WS_LOADLIST__;
      var token = LL.getToken();
      if (!token) throw new Error('Không tìm thấy access_token — tải lại trang Pancake rồi thử lại');
      B.setConfig({ apiBase: LL.apiBase(), accessToken: token });
      var got = await LL.load({
        maxPages: 200,
        onProgress: function (n) { setInfo('Đã tải ' + n + ' chat…'); },
      });
      if (!got.ok) throw new Error(got.error || 'tải thất bại');
      loaded = LL.decorate(got.items);
      var withCtx = loaded.filter(function (x) { return x.isRecordCtx7Days; }).length;
      setInfo(loaded.length + ' chat' + (got.incomplete ? ' (CHƯA HẾT — còn dữ liệu)' : '')
        + ' · bật cờ 7 ngày: ' + withCtx);
      btnSend.disabled = !loaded.length;
    } catch (e) {
      setInfo('LỖI: ' + (e && e.message || e));
      logLine('bad', String(e && e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function doSend() {
    if (busy || !loaded) return;
    var text = String(taText.value || '');
    if (!text.trim()) { setInfo('Chưa nhập nội dung'); taText.focus(); return; }
    var n = loaded.length;
    if (!window.confirm('Gửi tin này cho ' + n + ' chat?\n\n' + text.slice(0, 120))) return;

    setBusy(true);
    logBox.innerHTML = '';
    setInfo('Đang gửi ' + n + ' chat…');
    B.start();
    B.send(loaded.map(function (c) {
      return { id: c.id, pageId: c.pageId, name: c.name, text: text, isRecordCtx7Days: c.isRecordCtx7Days };
    }), 96);
  }

  B.on('done', function (m) {
    var s = (m && m.stats) || {};
    setInfo('XONG — bắn ' + (s.n || 0) + ' · ok ' + (s.ok || 0) + ' · từ chối ' + (s.fail || 0)
      + ' · CHƯA RÕ ' + (s.uncertain || 0));
    logLine('ok', 'XONG: ok ' + (s.ok || 0) + '/' + (s.n || 0)
      + (s.uncertain ? ' · ' + s.uncertain + ' CHƯA RÕ (đừng chạy lại toàn bộ!)' : ''));
    if (s.uncertain) logLine('noack', 'CẢNH BÁO: ' + s.uncertain + ' chat chưa rõ đã gửi hay chưa. Kiểm tay.');
    setBusy(false);
    B.terminate();
  });
  B.on('error', function (e) { logLine('bad', 'lỗi: ' + (e && e.message || e)); setBusy(false); });

  /* THỨ TỰ QUAN TRỌNG: phải VẼ GIAO DIỆN trước, rồi mới gán sự kiện — vì nút chỉ
   * tồn tại sau buildUI(). Bản trước gán trước khi vẽ ⇒ btnLoad là undefined ⇒
   * TypeError ngay khi dán file, và biểu hiện ra ngoài chỉ là "không thấy nút nào".
   * Test [I5]–[I9] bắt đúng lỗi này. */
  function wire() {
    buildUI();
    btnLoad.onclick = doLoad;
    btnSend.onclick = doSend;
    btnStop.onclick = function () { B.stop(); logLine('warn', 'đã bấm dừng'); setBusy(false); };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  window.BOTFAKE_WS = { bridge: B, load: function () { return doLoad(); } };
  console.log('%c[BOTFAKE-WS] đã nạp ✓', 'color:#0b63d6;font-weight:bold',
    '— nút "Gửi bằng Worker" ở góc dưới phải màn hình');
})();
