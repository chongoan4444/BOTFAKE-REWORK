/**
 * BOTFAKE WORKER-SEND — LÕI ĐIỀU PHỐI GỬI, KHÔNG PHỤ THUỘC DOM
 * ============================================================================
 * LÝ DO TỒN TẠI (bằng chứng số, xem docs/HAR-GROUND-TRUTH.md §91):
 *
 *   Ba tab chạy cùng lúc (16:27:05 / 16:27:14 / 16:27:18), cả ba đều 1.92.55:
 *     tab 1: PHÁT 19,28/s · ACK OK 77 · no-ACK 5 601 · giữ slot 5 372 ms
 *            🫥 `+84 969 s` kẹt · trễ 15 925 lần · nặng nhất 10,9 s
 *     tab 3: 🫥 `+66 575 s` kẹt · trễ 15 015 lần · nặng nhất **45,9 s**
 *   mà `chờ 364 ms / còn lại 5 372 ms` ⇒ 98,7 % thời gian giữ slot là KẸT, không phải I/O.
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

/** Nhịp phát tối thiểu cho mỗi page — `SOCKET_MIN_PACE_MS = 4` (dòng 4425 bản cũ). */
export const SOCKET_MIN_PACE_MS = 4;

/** Trần hạn chờ GIỮ SLOT: clav(p90×3, 1200, 6000) — `ACK_HOLD_MIN/CEIL_MS` (dòng 6130). */
export const ACK_HOLD_MIN_MS = 1200;
export const ACK_HOLD_CEIL_MS = 6000;

/** Cửa sổ NGHE tiếp sau khi hết hạn chờ giữ slot (không giữ slot) — `ACK_LISTEN_MAX_MS`. */
export const ACK_LISTEN_MAX_MS = 30000;
export const ACK_LISTEN_MIN_MS = 12000;

/** Số mẫu để tính p90 — `ACK_LAT_RING_N = 1000`. */
export const ACK_LAT_RING_N = 1000;

/** Số slot main mặc định (bản cũ: 96–192 tuỳ tab/focus/peer). */
export const DEFAULT_MAIN_CAP = 96;

/* ============================ ĐỒNG HỒ (tiêm được) ============================ */

/**
 * Đồng hồ thật trong Worker: KHÔNG dùng setTimeout của trang.
 * Worker có timer riêng nên không bị Chrome hạ ưu tiên như timer trên main thread.
 * `stopPromise` cho phép cắt mọi lượt chờ ngay khi bấm Dừng.
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

/** Đồng hồ GIẢ cho test: thời gian chỉ chạy khi gọi `advance(ms)`. Không dùng setTimeout. */
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
     * Chạy tới `ms` giây-mili kế tiếp, giải phóng timer theo ĐÚNG thứ tự thời gian.
     * Trả về số timer đã bắn. Cho `await` để microtask chạy hết giữa các mốc.
     */
    async advance(ms) {
      const target = t + Math.max(0, Number(ms) || 0);
      /* Hút microtask SÂU trước mỗi lần tìm timer: một lượt `sendOne()` đi qua
       * lane.enqueue → .then → pace → wait, tức 4–6 tầng microtask, nên chỉ
       * `await Promise.resolve()` MỘT lần là chưa đủ để timer mới kịp đăng ký.
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
 * `makeLane(limit)` — y hệt ngữ nghĩa `makeLane` bản cũ (dòng 6326):
 *  • `enqueuePaced(pageKey, fn)` chờ đúng nhịp `SOCKET_MIN_PACE_MS` THEO PAGE trước khi chạy.
 *  • Slot được CHUYỀN TRỰC TIẾP cho người chờ kế (không tăng/giảm bộ đếm) — giữ đúng
 *    hành vi `releaseMainSlot` bản cũ, và vì thế "chờ slot" không phải chi phí thật.
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
     * Nhịp phát theo page — TÁCH RIÊNG khỏi slot (bản cũ: `paceSocketPublish`).
     *
     * [SỬA SAU TEST K35] Bản đầu tôi viết `nextAt = max(now, last + 4)` rồi `await wait(...)`.
     * Với 5 chat vào CÙNG một mốc thời gian (đồng hồ giả / burst thật), CẢ 5 đọc cùng `last`,
     * nên cả 5 nhận cùng `nextAt` ⇒ chờ 0 ms ⇒ MẤT NHỊP (đo ra paceWaitN = 0).
     * Nay cấp mốc TUẦN TỰ: `nextAt = max(now, last + 4)` và ghi lại NGAY, nhưng mốc được
     * cấp đồng bộ trước khi chờ ⇒ chat thứ n chờ đúng (n−1)×4 ms. Đây chính là hành vi
     * của bản cũ khi các lượt gọi đến lần lượt; bản cũ cũng sai nếu đến đồng thời.
     */
    async pace(pageKey, clock) {
      const pid = String(pageKey || '');
      if (!pid) return;
      const now = clock.now();
      /* GIỮ ĐÚNG CÔNG THỨC BẢN CŨ (dòng 4429): `max(now, last + 4)`.
       * Lần đầu của một page: `last` chưa có ⇒ 0 ⇒ `max(now, 4)` = `now` khi `now` là mốc
       * epoch thật ⇒ chờ 0 ms. (Đồng hồ giả PHẢI bắt đầu ở mốc epoch thật; nếu bắt đầu từ 0
       * thì `max(0, 4)` = 4 ⇒ page đầu tiên bị chờ 4 ms OAN — test K37 bắt được đúng ca này.) */
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
 * `createWorkerSend(deps)` — trả về bộ điều phối gửi.
 *
 * deps (tất cả BẮT BUỘC trừ khi ghi chú):
 *   clock              : { now(), wait(ms) }              — makeRealClock hoặc makeFakeClock
 *   publish(conv, opts): Promise<{ ok, kind?, error?, sentAtMs? }>
 *                        `kind`: 'ok' | 'rejected' | 'noack' | 'error' | 'dead'
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

  /** p90 của mẫu ĐO ĐƯỢC; chưa đủ 20 mẫu thì 3 000 ms (y hệt bản cũ `sockAckP90`). */
  function ackP90() {
    if (ackLatRing.length < 20) return 3000;
    return latencyPct(ackLatRing, 0.9);
  }

  /**
   * Gửi MỘT chat. Đây là toàn bộ phần "giữ slot" của bản cũ, tách khỏi DOM.
   *
   * Chống trùng 3 lớp (giữ đúng như bản 1.92.x):
   *   1) đã delivered / failed ⇒ bỏ qua, KHÔNG bắn
   *   2) đang inFlight       ⇒ bỏ qua (dupBlocked) — trước đây là `sockFiredPending`
   *   3) sau khi publish, chat nằm inFlight cho tới khi có kết quả
   */
  async function sendOne(conv) {
    if (!conv || !conv.id) return { ok: false, sent: false, error: 'Thiếu conv.id' };
    /* [K17] KIỂM + ĐẶT CỜ `inFlight` PHẢI LÀ MỘT BƯỚC ĐỒNG BỘ DUY NHẤT.
     * Bản đầu của tôi đặt cờ này BÊN TRONG `lane.enqueue(...)` — mà enqueue chạy `fn` ở
     * microtask sau ⇒ 3 lần gọi song song cùng chat đều lọt qua cổng kiểm và BẮN 3 LẦN.
     * Đây đúng là loại lỗi "chống trùng mà vẫn trùng", nên test khoá nó thành K17.
     * Nay: kiểm + đặt cờ ngay tại đây (không await gì ở giữa) ⇒ cổng thật sự nguyên tử. */
    /* BA cổng chặn đều phải ĐẾM dupBlocked — nếu chỉ cổng inFlight đếm thì:
     *   • ID trùng ĐI TUẦN TỰ (danh sách có 2 dòng cùng chat) bị nhánh `delivered` chặn
     *     mà không vào sổ ⇒ người dùng không biết danh sách của mình có chat lặp.
     *   • ID trùng SONG SONG thì mới vào `inFlight`.
     * Cả hai đều là "đã bắn rồi, lần này không bắn" ⇒ cùng một nghĩa, phải cùng một bộ đếm. */
    if (delivered.has(conv.id)) { diag.dupBlocked++; return { ok: true, sent: false, duplicate: true, dupBlocked: true }; }
    if (failed.has(conv.id)) { diag.dupBlocked++; return { ok: false, sent: false, duplicate: true, dupBlocked: true }; }
    if (inFlight.has(conv.id)) {
      diag.dupBlocked++;
      return { ok: true, sent: false, dupBlocked: true };
    }
    /* [SỬA SAU TEST K43] ĐẶT CỜ NGAY, ĐỒNG BỘ — không được chờ vào lane.
     * `lane.enqueue` chạy fn ở microtask sau, nên nếu đặt cờ trong fn thì với `limit` làn
     * (chạy SONG SONG), dòng trùng thứ 2 đọc `inFlight` TRƯỚC khi dòng 1 kịp đặt cờ ⇒ lọt
     * ⇒ bắn 2 lần. Đây đúng lỗi commit cũ từng gặp ở bản 1.92.x (`sockFiredPending`). */
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
          // FB từ chối DỨT KHOÁT ⇒ chắc chắn chưa đi. Ghi vào `failed` để KHÔNG bắn lại
          // ở lượt này; việc bù kênh khác do tầng trên quyết định (nó biết còn kênh nào).
          failed.add(conv.id);
          diag.fail++;
          out = { ok: false, sent: false, kind: 'rejected', error: res.error || 'FB từ chối' };
        } else if (kind === 'noack') {
          // KHÔNG có ACK: TUYỆT ĐỐI coi là "chưa rõ", KHÔNG bắn lại (chống gửi trùng).
          // Bản cũ: `pageAckHoldExpired` / `mySilent` — tách 2 loại.
          if (res.silent) diag.ackSilent++; else diag.ackHoldExpired++;
          diag.uncertain++;
          out = { ok: false, sent: 'maybe', uncertain: true, kind: 'noack', error: res.error || 'Không có ACK' };
        } else if (kind === 'dead') {
          // Socket không kết nối: CHƯA bắn ⇒ bỏ `failed` để kênh khác/nhịp sau còn cứu.
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
   * Gửi cả danh sách với `limit` làn — y hệt `runPool` bản cũ nhưng việc rút là O(1)
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
          /* [W2] ID TRÙNG TRONG CHÍNH DANH SÁCH: vẫn phải đi qua `sendOne` để được ĐẾM
           * (`dupBlocked`) — nếu lọc im lặng ở đây thì số liệu không phản ánh đúng và người
           * dùng không biết danh sách của mình có chat lặp. `sendOne` đã chặn an toàn
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
