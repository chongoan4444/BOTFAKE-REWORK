#!/usr/bin/env node
/**
 * BOTFAKE WORKER-SEND — test lõi điều phối
 * ============================================================================
 * Chạy: node worker-send/test-engine.mjs
 *
 * Nguyên tắc: mỗi test khoá MỘT ràng buộc an toàn đã trả giá bằng lỗi thật trong log.
 * Cố ý viết test SAO CHO GỠ ĐÚNG DÒNG CODE đó thì test ĐỎ — không có test rỗng.
 */

import {
  SOCKET_MIN_PACE_MS, ACK_HOLD_MIN_MS, ACK_HOLD_CEIL_MS,
  ackHoldMsFor, ackListenMsFor, latencyPct,
  makeFakeClock, makeLane, createWorkerSend, FAKE_EPOCH_BASE,
} from './engine.mjs';

let pass = 0;
const fails = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fails.push(`${name}\n     nhận: ${JSON.stringify(got)} | mong đợi: ${JSON.stringify(want)}`);
}
function ok_(name, cond) { check(name, !!cond, true); }

const flush = async (n = 6) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

/* ---------------------------------------------------------------- hằng số */
check('[K1] nhịp phát giữ nguyên 4 ms/page (SOCKET_MIN_PACE_MS)', SOCKET_MIN_PACE_MS, 4);
check('[K2] sàn hạn chờ giữ slot = 1 200 ms', ACK_HOLD_MIN_MS, 1200);
check('[K3] trần hạn chờ giữ slot = 6 000 ms', ACK_HOLD_CEIL_MS, 6000);
check('[K4] ackHoldMsFor: p90 nhỏ ⇒ kẹp sàn', ackHoldMsFor(100), 1200);
check('[K5] ackHoldMsFor: p90 1 808 ⇒ 5 424 (đúng như lô 13:31)', ackHoldMsFor(1808), 5424);
check('[K6] ackHoldMsFor: p90 6 773 ⇒ KẸP TRẦN 6 000 (đây là gốc mất ACK lô 16:27)', ackHoldMsFor(6773), 6000);
check('[K7] ackListenMsFor ≥ 12 000', ackListenMsFor(1200), 12000);
check('[K8] ackListenMsFor trần 30 000', ackListenMsFor(60000), 30000);
check('[K9] latencyPct rỗng ⇒ 0', latencyPct([], 0.9), 0);
check('[K10] latencyPct p90 của 1..100', latencyPct(Array.from({ length: 100 }, (_, i) => i + 1), 0.9), 91);

/* ------------------------------------------------------------ đồng hồ giả */
{
  const c = makeFakeClock(0);
  const order = [];
  c.wait(30).then(() => order.push('a'));
  c.wait(10).then(() => order.push('b'));
  c.wait(20).then(() => order.push('c'));
  await c.advance(100);
  check('[K11] đồng hồ giả bắn timer theo ĐÚNG thứ tự thời gian', order, ['b', 'c', 'a']);
  check('[K12] đồng hồ giả hết timer', c.pendingTimers(), 0);
  check('[K13] now() = mốc cuối (đồng hồ giả bắt đầu ở epoch thật + 0)', c.now(), FAKE_EPOCH_BASE + 100);
}

/* ------------------------------------------------------------------- lane */
{
  const lane = makeLane(2);
  let peak = 0;
  const job = () => new Promise((r) => { peak = Math.max(peak, lane.activeCount()); setTimeout(r, 1); });
  const ps = [job(), job(), job(), job()];
  await flush(0);
  await new Promise((r) => setTimeout(r, 30));
  await Promise.all(ps);
  check('[K14] lane không vượt giới hạn 2 slot', peak <= 2, true);
}
{
  const lane = makeLane(1);
  lane.setLimit(5);
  check('[K15] setLimit nâng được', lane.getLimit(), 5);
  lane.setLimit(0);
  check('[K16] setLimit kẹp sàn 1 (không cho 0 ⇒ chết làn)', lane.getLimit(), 1);
}

/* ----------------------------------------------- CHỐNG GỬI TRÙNG (quan trọng) */
{
  const c = makeFakeClock(0);
  let publishes = 0;
  const ws = createWorkerSend({
    clock: c, mainCap: 4,
    publish: async () => { publishes++; return { ok: true, kind: 'ok', ackMs: 40 }; },
  });
  const conv = { id: 'p1_9' };
  // Bắn 3 lần CÙNG chat, không await giữa chừng ⇒ lần 2, 3 phải bị chặn.
  const p1 = ws.sendOne(conv);
  const p2 = ws.sendOne(conv);
  const p3 = ws.sendOne(conv);
  await c.advance(100);            // publish() trả ngay, chỉ cần nhường microtask
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  await flush();
  check('[K17] 3 lần gọi song song cùng chat chỉ BẮN 1 lần', publishes, 1);
  check('[K18] lần 1 thành công', r1.ok, true);
  check('[K19] lần 2/3 bị chặn vì đang inFlight (dupBlocked)', [!!r2.dupBlocked, !!r3.dupBlocked], [true, true]);
  check('[K20] đếm dupBlocked = 2', ws.diag.dupBlocked, 2);
  // Gọi lại SAU khi đã delivered ⇒ không bắn nữa.
  const p4 = ws.sendOne(conv);
  await c.advance(100);
  const r4 = await p4;
  check('[K21] gọi lại sau khi ĐÃ TỚI NƠI ⇒ không bắn lại', publishes, 1);
  check('[K22] trả duplicate, không phải lỗi', [r4.ok, !!r4.duplicate], [true, true]);
}

/* ------------------------- ACK KHÔNG CÓ ⇒ phải là "chưa rõ", KHÔNG được bắn lại */
{
  const c = makeFakeClock(0);
  let publishes = 0;
  const ws = createWorkerSend({
    clock: c, mainCap: 2,
    publish: async () => { publishes++; return { ok: false, kind: 'noack', error: 'Không có ACK' }; },
  });
  const pA = ws.sendOne({ id: 'p2_1' });
  await c.advance(100);
  const r = await pA;
  check('[K23] noack ⇒ ok:false nhưng sent:"maybe" (KHÔNG nói đã gửi, KHÔNG nói chưa gửi)', [r.ok, r.sent], [false, 'maybe']);
  check('[K24] noack ⇒ uncertain:true (để tầng trên đưa vào sổ chờ xác nhận)', r.uncertain, true);
  check('[K25] noack KHÔNG bị đánh dấu failed (còn cứu được)', ws.isFailed('p2_1'), false);
  const pB = ws.sendOne({ id: 'p2_1' });
  await c.advance(100);
  const r2 = await pB;
  check('[K26] noack ⇒ gọi lại VẪN bắn được (chưa chốt) ⇒ publish=2, chống mất tin', publishes, 2);
  check('[K27] đếm hết hạn chờ giữ slot', ws.diag.ackHoldExpired, 2);
}
{
  const c = makeFakeClock(0);
  const ws = createWorkerSend({
    clock: c, mainCap: 2,
    publish: async () => ({ ok: false, kind: 'noack', silent: true }),
  });
  { const px = ws.sendOne({ id: 'p3_1' }); await c.advance(100); await px; }
  check('[K28] noack+silent ⇒ đếm riêng "im lặng THẬT" (nghiệm thu phải = 0)', ws.diag.ackSilent, 1);
  check('[K29] im lặng THẬT KHÔNG bị đếm vào hết hạn chờ', ws.diag.ackHoldExpired, 0);
}

/* -------------------------------------------------- FB TỪ CHỐI ⇒ chốt, không bắn lại */
{
  const c = makeFakeClock(0);
  let publishes = 0;
  const ws = createWorkerSend({
    clock: c, mainCap: 2,
    publish: async () => { publishes++; return { ok: false, kind: 'rejected', error: '#551 không có mặt' }; },
  });
  { const px = ws.sendOne({ id: 'p4_1' }); await c.advance(100); await px; }
  check('[K30] rejected ⇒ đánh dấu failed', ws.isFailed('p4_1'), true);
  { const py = ws.sendOne({ id: 'p4_1' }); await c.advance(100);
    check('[K31] rejected ⇒ sent:false (biết chắc CHƯA đi)', (await py).sent, false); }
  check('[K32] rejected ⇒ lần sau KHÔNG bắn lại (publish vẫn 1)', publishes, 1);
}
{
  const c = makeFakeClock(0);
  let publishes = 0;
  const ws = createWorkerSend({
    clock: c, mainCap: 2,
    publish: async () => { publishes++; return { ok: false, kind: 'dead', error: 'Socket không kết nối' }; },
  });
  { const px = ws.sendOne({ id: 'p5_1' }); await c.advance(100); await px; }
  check('[K33] dead ⇒ CHƯA bắn nên KHÔNG chốt failed (kênh khác còn cứu được)', ws.isFailed('p5_1'), false);
  { const py = ws.sendOne({ id: 'p5_1' }); await c.advance(100); await py; }
  check('[K34] dead ⇒ gọi lại vẫn bắn (publish=2)', publishes, 2);
}

/* ------------------------------------------------------------ nhịp phát/page */
{
  const c = makeFakeClock(0);
  const ws = createWorkerSend({
    clock: c, mainCap: 10,
    publish: async () => ({ ok: true, kind: 'ok', ackMs: 10 }),
  });
  // 5 chat CÙNG page: nhịp 4 ms/page ⇒ tổng chờ pace ≥ 16 ms
  const ps = ['a', 'b', 'c', 'd', 'e'].map((k) => ws.sendOne({ id: 'pX_' + k }));
  await c.advance(500);
  await Promise.all(ps);
  ok_('[K35] có đo thời gian chờ nhịp phát (paceWaitN > 0)', ws.diag.paceWaitN > 0);
  ok_('[K36] nhịp phát cộng dồn ≥ 4×(5−1) = 16 ms', ws.diag.paceWaitMs >= 16);
}

/* ------------------------------------------- NHIỀU PAGE: nhịp phát độc lập */
{
  const c = makeFakeClock(0);
  const ws = createWorkerSend({
    clock: c, mainCap: 10,
    publish: async () => ({ ok: true, kind: 'ok', ackMs: 10 }),
  });
  const ps = [ws.sendOne({ id: 'pageA_1' }), ws.sendOne({ id: 'pageB_1' })];
  await c.advance(200);
  await Promise.all(ps);
  check('[K37] 2 page KHÁC nhau ⇒ không phải chờ nhịp của nhau (chờ 0 ms)', ws.diag.paceWaitMs, 0);
}

/* ---------------------------------------------------- sendAll + giữ slot/TB */
{
  const c = makeFakeClock(0);
  /* publish() PHẢI dùng clock (không setTimeout) — đồng hồ giả thì setTimeout thật không
   * bao giờ trùng mốc, và test sẽ treo. Đây cũng đúng là cách lớp vỏ thật sẽ làm: mọi
   * lượt chờ đi qua clock được tiêm. */
  const ws = createWorkerSend({
    clock: c, mainCap: 8,
    publish: async () => { await c.wait(5); return { ok: true, kind: 'ok', ackMs: 30 }; },
  });
  const list = Array.from({ length: 40 }, (_, i) => ({ id: 'pg_' + i, name: 'C' + i }));
  const p = ws.sendAll(list, { limit: 8 });
  for (let i = 0; i < 12; i++) await c.advance(1000);
  const res = await p;
  check('[K38] sendAll trả đủ 40 kết quả', res.length, 40);
  check('[K39] tất cả thành công', res.every((x) => x.ok), true);
  check('[K40] đếm ok = 40', ws.diag.ok, 40);
  check('[K41] slotN = 40 (mỗi chat 1 lần giữ slot)', ws.diag.slotN, 40);
  ok_('[K42] peakInFlight không vượt cap 8', ws.diag.peakInFlight <= 8);
}

/* -------------------------------------------- chống trùng ở MỨC sendAll */
{
  const c = makeFakeClock(0);
  let publishes = 0;
  const ws = createWorkerSend({
    clock: c, mainCap: 6,
    publish: async () => { publishes++; return { ok: true, kind: 'ok', ackMs: 5 }; },
  });
  // Danh sách có ID TRÙNG (lỗi thật: cùng chat xuất hiện 2 lần trong danh sách)
  const list = [{ id: 'dup_1' }, { id: 'dup_1' }, { id: 'dup_2' }];
  const p = ws.sendAll(list, { limit: 6 });
  await c.advance(500);
  await p;
  check('[K43] danh sách có ID trùng ⇒ chỉ bắn 2 lần (không gửi trùng)', publishes, 2);
}

/* ------------------------------------ p90 phải cập nhật theo ACK ĐO ĐƯỢC */
{
  const c = makeFakeClock(0);
  const ws = createWorkerSend({
    clock: c, mainCap: 4,
    publish: async () => ({ ok: true, kind: 'ok', ackMs: 5000 }),
  });
  check('[K44] chưa đủ mẫu ⇒ p90 = 3 000 ms', ws.ackP90(), 3000);
  const ps = [];
  for (let i = 0; i < 25; i++) ps.push(ws.sendOne({ id: 'q_' + i }));
  await c.advance(2000);
  await Promise.all(ps);
  check('[K45] đủ 25 mẫu 5 000 ms ⇒ p90 = 5 000', ws.ackP90(), 5000);
  check('[K46] ackHold = clamp(5000×3) = KẸP TRẦN 6 000', ackHoldMsFor(ws.ackP90()), 6000);
}

/* ------------------------------------------------------------------ kết quả */
if (fails.length) {
  console.log(`✗ ${fails.length}/${pass + fails.length} test THẤT BẠI:\n`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`✓ ${pass} test đều đúng (lõi điều phối worker-send).`);
console.log('  Khoá: chống gửi trùng 3 lớp · ACK không có = "chưa rõ" · FB từ chối = chốt · nhịp theo page.');
