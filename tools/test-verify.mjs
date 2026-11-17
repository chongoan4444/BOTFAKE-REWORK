#!/usr/bin/env node
/**
 * Test cho phần PHÂN XỬ LỊCH SỬ CHAT — trích thẳng hàm thật từ userscript
 * (không copy code, để test luôn khớp với bản đang chạy).
 *
 *   node tools/test-verify.mjs
 *
 * Bối cảnh: cơ chế bù chỉ được phép bắn khi BIẾT CHẮC tin chưa đi. Sai ở đây gây
 * đúng 2 bệnh đang phải sửa: chốt ✅ oan (mất tin) và bù oan (LẶP CÂU).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'scripts/pancake-send-lite.user.js'), 'utf8');

/** Cắt nguyên văn một `function ten(...) { ... }` theo cân bằng ngoặc. */
function extractFn(name) {
  const start = SRC.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`không tìm thấy hàm ${name} trong userscript`);
  let i = SRC.indexOf('{', start);
  let depth = 0;
  for (; i < SRC.length; i++) {
    const c = SRC[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error(`hàm ${name} không cân ngoặc`);
}

/** Bỏ chú thích // và /* *\/ để test khớp CODE thật, không khớp lời chú thích.
 *  (Đã mắc lỗi này 2 lần: test khớp chính chú thích của bản sửa ⇒ mutation vẫn xanh.) */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, ' ');
}

const code = [
  extractFn('normalizeMsgText'),
  extractFn('attachmentMatches'),
  extractFn('msgTimeMs'),
  extractFn('historyVerdict'),
  'return { normalizeMsgText, attachmentMatches, msgTimeMs, historyVerdict };',
].join('\n\n');

const batchStats = { startedAt: 0 };
const { historyVerdict, normalizeMsgText } = new Function('batchStats', code)(batchStats);

/* ------------------------------- tiện ích ------------------------------- */

const PAGE = '898735919982398';
const T0 = Date.parse('2026-11-11T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

/** tin nhắn trong lịch sử: fromId = id page (tin của shop) hoặc id khách */
const msg = (opts) => ({
  id: opts.id || 'm_x',
  message: opts.text != null ? opts.text : '',
  inserted_at: iso(opts.at),
  from: { id: opts.from || PAGE },
  attachments: opts.attachments || [],
  is_removed: !!opts.removed,
});

let pass = 0;
const fails = [];
/* ═══════════════════════════════════════════════════════════════════════════════
 * [v1.92.48] CỬA SỔ NGHE ACK — trích ĐÚNG hằng số + 2 hàm thuần từ userscript.
 * Nguyên tắc nghiệm thu:
 *   • HOLD (giữ slot) KHÔNG được đổi so với 1.92.47  ⇒ tốc độ không đổi.
 *   • LISTEN (nghe) phải phủ max ACK đã đo (7 988 ms) và không vượt trần app (30 000 ms).
 *   • "ACK chết" phải đòi bằng chứng (im lặng thật) và ≥ 5 ca, không phải 3 ca hết hạn chờ.
 *   • Nới làn phải canh ĐUÔI (p95), không canh p50 (đúng lỗi lô 10:01).
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** Trích một `const TÊN = <biểu thức>;` (số hoặc biểu thức số đơn giản) từ userscript. */
function extractConst(name) {
  const re = new RegExp(`const ${name} = ([^;]+);`);
  const m = SRC.match(re);
  if (!m) throw new Error(`không tìm thấy hằng ${name} trong userscript`);
  return m[1].trim();
}

const ackConsts = ['ACK_HOLD_MIN_MS', 'ACK_HOLD_CEIL_MS', 'ACK_LISTEN_MAX_MS', 'ACK_LAT_RING_N',
  'ACK_DEAD_PROOF_RUN', 'SOCK_RAMP_P95_MAX_MS', 'SOCK_RAMP_QUIET_N', 'BU_PROOF_NOT_BEFORE_MS',
  'BU_PROOF_WAIT_MS', 'SOCKET_LANE_RUNTIME_FLOOR', 'SOCKET_LANE_HARD_FLOOR'];

const ackCode = [
  ...ackConsts.map((n) => `const ${n} = ${extractConst(n)};`),
  extractFn('latencyPct'),
  extractFn('ackHoldMsFor'),
  extractFn('ackListenMsFor'),
  `return { ${ackConsts.join(', ')}, latencyPct, ackHoldMsFor, ackListenMsFor };`,
].join('\n\n');

const ACK = new Function(ackCode)();

// A1) Hạn chờ GIỮ SLOT giữ NGUYÊN công thức 1.92.47: clamp(p90×3, 1200, 6000)
check('A1 hold: p90 3000 → 6000 (trần cũ giữ nguyên)', ACK.ackHoldMsFor(3000), 6000);
check('A1 hold: p90 2484 → 6000 (lô 10:01 vẫn 6000, tốc độ không đổi)', ACK.ackHoldMsFor(2484), 6000);
check('A1 hold: p90 300 → 1200 (sàn cũ giữ nguyên)', ACK.ackHoldMsFor(300), 1200);
check('A1 hold: p90 0/không mẫu → 6000', ACK.ackHoldMsFor(0), 6000);

// A2) Cửa sổ NGHE phải phủ max ACK đã đo (7 988 ms)…
check('A2 listen: hold 6000 → 12000 (phủ max 7 988 ms đã đo)', ACK.ackListenMsFor(6000), 12000);
check('A2 listen: phủ max thật 7988', ACK.ackListenMsFor(6000) > 7988, true);
// …và không vượt trần tự xoá của app (b = 3e4)
check('A2 listen: không vượt trần app 30 000 ms', ACK.ackListenMsFor(60000) <= ACK.ACK_LISTEN_MAX_MS, true);
check('A2 listen: luôn ≥ hold', ACK.ackListenMsFor(6000) >= 6000, true);
check('A2 listen: hold nhỏ vẫn nghe đủ 12 s', ACK.ackListenMsFor(1200), 12000);

// A3) "ACK chết" phải đòi bằng chứng: ≥ 5 lần IM LẶNG THẬT (không phải 3 lần hết hạn chờ)
check('A3 ngưỡng chết = 5 lần im lặng thật', ACK.ACK_DEAD_PROOF_RUN, 5);

// A3b) Sàn làn lúc chạy không được thấp hơn mức làm tốc độ sập (lô 10:01: 32 làn = 20,8 chat/s)
check('A3b sàn làn chạy ≥ 96', ACK.SOCKET_LANE_RUNTIME_FLOOR >= 96, true);
check('A3b sàn làn chạy ≤ trần 384', ACK.SOCKET_LANE_RUNTIME_FLOOR <= 384, true);
check('A3b sàn vẫn trên sàn cứng của bộ điều tiết', ACK.SOCKET_LANE_RUNTIME_FLOOR > ACK.SOCKET_LANE_HARD_FLOOR, true);

// A4) Cổng chứng minh vắng mặt phải đứng SAU cửa sổ nghe
check('A4 cổng vắng mặt ≥ cửa sổ nghe + 1 s', ACK.BU_PROOF_NOT_BEFORE_MS >= ACK.ackListenMsFor(6000) + 1000, true);
check('A4 BU_PROOF_WAIT_MS = BU_PROOF_NOT_BEFORE_MS', ACK.BU_PROOF_WAIT_MS, ACK.BU_PROOF_NOT_BEFORE_MS);

// A5) Nới làn canh ĐUÔI: cửa sổ mẫu đủ dài + p95 là ngưỡng, p50 KHÔNG còn là ngưỡng
check('A5 cửa sổ mẫu 1 000 (không còn 200 ≈ 5 s cuối lô)', ACK.ACK_LAT_RING_N, 1000);
check('A5 canh p95 ≤ 2 200 ms', ACK.SOCK_RAMP_P95_MAX_MS, 2200);
check('A5 có cửa sổ canh no-ACK gần đây', ACK.SOCK_RAMP_QUIET_N > 0, true);
check('A5 p95 của 100 mẫu 1..100 = 96', ACK.latencyPct(Array.from({ length: 100 }, (_, i) => i + 1), 0.95), 96);
check('A5 p50 của 100 mẫu 1..100 = 51', ACK.latencyPct(Array.from({ length: 100 }, (_, i) => i + 1), 0.5), 51);
{
  /* Lô 10:01 (dòng 527): bucket ACK <250/250-999/1-2s/2-5s/≥5s = 0/5/3 081/3 389/340.
   * Cửa sổ 200 mẫu của bản cũ rơi vào đoạn "toàn 1,7 s" ⇒ p50 = 1 739 ms ⇒ LỌT cổng 1 800
   * ⇒ làn leo 256 → 384 dù đuôi ≥5 s còn 5 %. Vòng 1 000 mẫu thấy đúng cái đuôi đó. */
  const ring = []; // 1 000 mẫu mô phỏng tỉ lệ thật của lô
  const push = (n, v) => { for (let i = 0; i < n; i++) ring.push(v); };
  push(797, 3000); push(153, 3500); push(50, 6500); // ≈ 80 % / 15 % / 5 %
  for (let i = 0; i < 200; i++) ring[ring.length - 200 + i] = 1739; // 200 mẫu CUỐI LÔ (nhanh)
  const p95New = ACK.latencyPct(ring, 0.95);
  const p50Old200 = ACK.latencyPct(ring.slice(-200), 0.5); // bản cũ chỉ thấy 200 mẫu này
  check('A5 lô 10:01: cửa sổ 200 mẫu cũ cho p50 1 739 ⇒ LỌT cổng 1 800', p50Old200 <= 1800, true);
  check('A5 lô 10:01: vòng 1 000 mẫu cho p95 > 2 200 ⇒ CHẶN nới làn', p95New > ACK.SOCK_RAMP_P95_MAX_MS, true);
}


function check(name, got, want) {
  if (got === want) { pass++; return; }
  fails.push(`${name}\n     nhận: ${got} | mong đợi: ${want}`);
}

/**
 * Khẳng định KHÔNG rơi vào một kết luận nguy hiểm (vd không được là 'yes').
 *
 * [v1.92.58] LỖI NGHIÊM TRỌNG ĐÃ SỬA — test RỖNG:
 * Bản cũ so `got !== forbidden` bằng `!==`. Nhưng tôi truyền vào phần lớn chỗ là một
 * **đối tượng RegExp** (`checkNot(..., src, /Object\.keys\(mp\)/)`) ⇒ hai đối tượng RegExp
 * khác nhau nên `!==` LUÔN đúng ⇒ test LUÔN XANH dù code vi phạm. Nghĩa là MỌI test
 * checkNot dùng regex trong file này trước đây đều vô hiệu (mutation không bị bắt).
 * Nay: nếu `forbidden` là RegExp thì KHỚP THẬT trên `got` (chuỗi) và báo đỏ khi khớp.
 */
function checkNot(name, got, forbidden) {
  const re = (forbidden instanceof RegExp)
    ? forbidden
    : new RegExp(String(forbidden).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const hay = String(got);
  const m = re.exec(hay);
  if (!m) { pass++; return; }
  const at = Math.max(0, m.index - 60);
  fails.push(`${name}\n     KHỚP (phải KHÔNG khớp): ${JSON.stringify(m[0])}`
    + `\n     trong: …${hay.slice(at, m.index + m[0].length + 60)}…`);
}

/* --------------------------- kịch bản thật --------------------------- */

// 1) Tin của page khớp đúng nội dung, tạo sau lúc bắn → đã tới nơi
check('tin khớp nội dung → yes',
  historyVerdict([msg({ text: 'Dạ shop chào chị', at: T0 + 1500 })], PAGE, 'Dạ shop chào chị', null, T0),
  'yes');

// 2) Tin của page KHÁC nội dung, tạo sau lúc bắn (wave trước / quick reply).
//    Bản cũ trả true ("t >= sentAt-2s && có chữ") → chốt ✅ oan ⇒ mất tin.
check('tin page khác nội dung → unknown (bản cũ: true)',
  historyVerdict([msg({ text: 'Câu của lượt trước', at: T0 + 1000 })], PAGE, 'Câu mới cần gửi', null, T0),
  'unknown');

// 3) [v1.92.25] Lịch sử chỉ có tin CŨ hơn lúc bắn → 'unknown', KHÔNG còn 'no'.
//    Lý do: 'no' so inserted_at (đồng hồ server) với publishedAt (đồng hồ máy) ⇒ phán đoán,
//    không phải bằng chứng, và chính nó là mắt xích tạo chuỗi gửi trùng ở lô 09:46 (§58).
check('lịch sử cũ hơn lúc bắn → unknown (bản cũ: no)',
  historyVerdict([
    msg({ text: 'khách hỏi giá', from: '12345', at: T0 - 3600_000 }),
    msg({ text: 'shop trả lời cũ', at: T0 - 3500_000 }),
  ], PAGE, 'Câu mới cần gửi', null, T0),
  'unknown');

// 4) Có tin mới hơn lúc bắn nhưng không phải tin ta cần → chưa kết luận được
check('có tin mới nhưng không khớp → unknown',
  historyVerdict([
    msg({ text: 'khách nhắn tiếp', from: '12345', at: T0 + 4000 }),
  ], PAGE, 'Câu mới cần gửi', null, T0),
  'unknown');

// 5) Lịch sử chỉ có tin KHỚP nội dung nhưng thuộc LƯỢT TRƯỚC (quá xa sentAt).
//    Tuyệt đối không được coi là 'yes' — nếu không, tin của lượt này sẽ bị chốt ✅ oan.
checkNot('tin khớp nhưng của lượt trước → KHÔNG được yes',
  historyVerdict([msg({ text: 'Câu mới cần gửi', at: T0 - 120_000 })], PAGE, 'Câu mới cần gửi', null, T0), 'yes');

// 6) Gửi ảnh (không có chữ) → khớp bằng attachment
check('ảnh khớp attachment → yes',
  historyVerdict([msg({ at: T0 + 1200, attachments: [{ id: 'a1' }] })], PAGE, '', { items: [{ id: 'a1' }] }, T0),
  'yes');

// 7) Tin đã bị thu hồi → không tính
check('tin bị thu hồi → unknown',
  historyVerdict([msg({ text: 'Dạ shop chào chị', at: T0 + 1500, removed: true })], PAGE, 'Dạ shop chào chị', null, T0),
  'unknown');

// 8) Lịch sử không có mốc giờ → không kết luận
check('thiếu inserted_at → unknown',
  historyVerdict([{ id: 'm', message: 'x', from: { id: PAGE } }], PAGE, 'abc', null, T0),
  'unknown');

// 9) Không có dữ liệu → unknown (không bao giờ "no" khi mù)
check('msgs rỗng/null → unknown',
  String(historyVerdict(null, PAGE, 'abc', null, T0)) + String(historyVerdict([], PAGE, 'abc', null, T0)),
  'unknownunknown');

// 10) Tin khớp nhưng của KHÁCH gửi (không phải page) → không tính
check('khách gửi trùng nội dung → unknown',
  historyVerdict([msg({ text: 'Dạ shop chào chị', from: '999', at: T0 + 1500 })], PAGE, 'Dạ shop chào chị', null, T0),
  'unknown');

// 11) So khớp chịu được HTML/&nbsp;/khoảng trắng như UI Pancake trả về
check('khớp sau khi chuẩn hoá HTML',
  historyVerdict([msg({ text: 'Dạ&nbsp;shop <b>chào</b> chị', at: T0 + 900 })], PAGE,
    normalizeMsgText('Dạ shop chào chị'), null, T0),
  'yes');

// 12) "yes" phải thắng "no": lịch sử vừa có tin khớp vừa có mốc cũ
check('khớp nội dung thắng mốc nước',
  historyVerdict([
    msg({ text: 'khách cũ', from: '12345', at: T0 - 60_000 }),
    msg({ text: 'Câu mới cần gửi', at: T0 + 2000 }),
  ], PAGE, 'Câu mới cần gửi', null, T0),
  'yes');

// 13) [v1.92.25] KHÔNG BAO GIỜ trả 'no' — quét mọi ca "mốc nước rỗng"
{
  const cases = [
    [[msg({ text: 'cũ', from: '1', at: T0 - 10 * 86_400_000 })], 'abc'],
    [[msg({ text: 'cũ', at: T0 - 3000 })], 'abc'],
    [[msg({ text: 'x', from: '1', at: T0 - 1 })], 'abc'],
  ];
  const bad = cases.filter(([ms]) => historyVerdict(ms, PAGE, 'abc', null, T0) === 'no').length;
  check('không còn kết luận "no" ở bất kỳ ca nào', String(bad), '0');
}

// 14) Lệch đồng hồ: máy chậm 60 s so với server ⇒ tin vừa tới (mốc server = T0) vẫn phải khớp 'yes'
{
  const src2 = SRC;
  const code2 = [
    extractFn('normalizeMsgText'),
    extractFn('attachmentMatches'),
    extractFn('msgTimeMs'),
    extractFn('historyVerdict'),
    'return { historyVerdict };',
  ].join('\n\n');
  // serverSkewMs khai báo bằng `let` ở phạm vi ngoài hàm ⇒ giả lập bằng cách chèn biến cùng tên
  const fn2 = new Function('batchStats', 'serverSkewMs', code2)({ startedAt: 0 }, 60_000);
  const t0Local = Date.now(); // máy chậm 60 s ⇒ publishedAt(server) = t0Local + 60 000
  const msgServerClock = [{
    id: 'm', message: '<div>Câu mới</div>',
    inserted_at: new Date(t0Local + 60_000).toISOString().replace('Z', '').replace(/\.\d{3}/, '.000000'),
    from: { id: PAGE }, attachments: [], is_removed: false,
  }];
  check('lệch đồng hồ 60 s vẫn khớp đúng tin của mình',
    fn2.historyVerdict(msgServerClock, PAGE, 'Câu mới', null, t0Local), 'yes');
}

// 20) [v1.92.27] Tin NGẮN không được khớp bừa với tin khác của page
//     Lô thật: có tin chỉ là "Dạ"/"Ok" ⇒ nếu dùng "chứa" thì mọi tin khác đều khớp ⇒ ✅ oan.
{
  const hist = [msg({ text: 'Dạ shop chào chị, em gửi bảng size ngay ạ', at: T0 + 1500 })];
  checkNot('tin ngắn "Dạ" không được khớp với tin dài chứa nó',
    historyVerdict(hist, PAGE, 'Dạ', null, T0), 'yes');
  check('tin dài khớp kiểu "chứa" vẫn được chấp nhận (>= 20 ký tự)',
    historyVerdict([msg({ text: 'Dạ shop chào chị, em gửi bảng size ngay ạ', at: T0 + 1500 })],
      PAGE, 'em gửi bảng size ngay', null, T0), 'yes');
}

// 21) [v1.92.27] Tin COMMENT không được dùng để chốt tin INBOX đã gửi
checkNot('message COMMENT trùng nội dung KHÔNG chốt được',
  historyVerdict([Object.assign(msg({ text: 'Câu mới cần gửi', at: T0 + 1000 }), { type: 'COMMENT' })],
    PAGE, 'Câu mới cần gửi', null, T0), 'yes');
check('message INBOX trùng nội dung vẫn chốt được',
  historyVerdict([Object.assign(msg({ text: 'Câu mới cần gửi', at: T0 + 1000 }), { type: 'INBOX' })],
    PAGE, 'Câu mới cần gửi', null, T0), 'yes');

// 22) [v1.92.27] ẢNH: chỉ chốt khi khớp ĐÚNG width×height (hoặc id), không chốt "có attachment là xong"
{
  const photo = { items: [{ w: 1820, h: 2427 }] };
  const rightSize = [msg({
    at: T0 + 1200,
    attachments: [{ type: 'photo', url: 'https://content.pancake.vn/x.jpg', image_data: { width: 1820, height: 2427 } }],
  })];
  const wrongSize = [msg({
    at: T0 + 1200,
    attachments: [{ type: 'photo', url: 'https://content.pancake.vn/y.jpg', image_data: { width: 1080, height: 1080 } }],
  })];
  check('ảnh khớp đúng kích thước → yes', historyVerdict(rightSize, PAGE, '', photo, T0), 'yes');
  check('ảnh KHÁC kích thước → unknown (không chốt bừa)', historyVerdict(wrongSize, PAGE, '', photo, T0), 'unknown');
  check('ảnh không có thông tin để khớp (không id, không w/h) → unknown',
    historyVerdict(rightSize, PAGE, '', { items: [{}] }, T0), 'unknown');
}

// 23) [v1.92.27] Mẫu lệch đồng hồ RÁC không được làm bẩn phép hiệu chỉnh
{
  const s1 = SRC;
  const fnCode = [
    'let serverSkewMs = 0;',
    'let serverSkewSamples = 0;',
    extractFn('noteServerClock'),
    'return { noteServerClock, get: () => serverSkewMs, n: () => serverSkewSamples };',
  ].join('\n');
  const clock = new Function(fnCode)();
  const hdr = (v) => ({ get: () => v });
  clock.noteServerClock(hdr(new Date(Date.now() + 4000).toUTCString()));   // mẫu tốt +4s
  const afterGood = clock.get();
  clock.noteServerClock(hdr(new Date(Date.now() - 351388961).toUTCString())); // mẫu rác
  check('mẫu lệch hợp lệ được ghi nhận (~+4s)', String(afterGood > 2000 && afterGood < 6000), 'true');
  check('mẫu rác bị chặn, không kéo lệch phép hiệu chỉnh', String(clock.get() === afterGood), 'true');
  clock.noteServerClock(hdr('not a date'));
  check('header Date hỏng bị bỏ qua', String(clock.get() === afterGood), 'true');
}

/* ---------------- ngân sách thử lại Socket (v1.92.26) ---------------- */
// Lô 10:04: thử lại Socket 861 lần, cứu được 0 (ACK rejected 1 722 = 861 x 2) nhưng chiếm
// 27% lưu lượng socket ⇒ phải có luật "đo đủ thì dừng", và luật đó phải có test.

const budgetConsts = ['SOCK_RETRY_BUDGET_MIN', 'SOCK_RETRY_PROBE_EVERY', 'SOCK_RETRY_MIN_REJECT_PCT', 'SOCK_RETRY_MAX_REJECT_PCT']
  .map((n) => {
    const m = SRC.match(new RegExp('const ' + n + ' = (\\d+);'));
    if (!m) throw new Error('không tìm thấy hằng ' + n);
    return `const ${n} = ${m[1]};`;
  });

const budgetApi = new Function(budgetConsts.concat([
  extractFn('sockRetryBudgetAllows'),
  extractFn('sockRetryBudgetNote'),
  'return { sockRetryBudgetAllows, sockRetryBudgetNote };',
]).join('\n\n'))();

const { sockRetryBudgetAllows, sockRetryBudgetNote } = budgetApi;
const newBudget = () => ({ tried: 0, saved: 0, skipped: 0, sinceProbe: 0, closed: false, closePct: -1 });

/* cửa sổ 200 ACK gần nhất (v1.92.28) */
const recentCode = [
  SRC.match(/const SOCK_ACK_RECENT_N = \d+;/)[0],
  SRC.match(/const sockAckRecent = \{[^}]*\};/)[0],
  extractFn('resetSockAckRecent'),
  extractFn('noteSockAckRecent'),
  extractFn('socketRejectPctRecent'),
  'return { resetSockAckRecent, noteSockAckRecent, socketRejectPctRecent, sockAckRecent };',
].join('\n\n');
const recent = new Function(recentCode)();
const { resetSockAckRecent, noteSockAckRecent, socketRejectPctRecent } = recent;

// 15) Đúng tình huống lô 10:04 → đóng ngân sách
check('40 lần thử lại mà cứu 0 (FB từ chối 34%) → ĐÓNG ngân sách',
  (() => { const b = newBudget(); for (let i = 0; i < 40; i++) sockRetryBudgetNote(b, 'tried', 34); return b.closed; })(),
  true);
check('đã đóng ⇒ ca kế tiếp KHÔNG thử lại',
  (() => { const b = newBudget(); for (let i = 0; i < 40; i++) sockRetryBudgetNote(b, 'tried', 34); return sockRetryBudgetAllows(b); })(),
  false);

// 16) Tỉ lệ FB từ chối thấp = burst cục bộ ⇒ vẫn phải thử lại (không được đóng oan)
check('tử chối chỉ 2% ⇒ KHÔNG đóng (burst cục bộ vẫn đáng thử)',
  (() => { const b = newBudget(); for (let i = 0; i < 40; i++) sockRetryBudgetNote(b, 'tried', 2); return b.closed; })(),
  false);

// 16b) Từ chối gần như TOÀN BỘ (95%) = burst/sự cố ⇒ KHÔNG đóng, phải tiếp tục thử lại
check('từ chối 95% (burst toàn phần) ⇒ KHÔNG đóng',
  (() => { const b = newBudget(); for (let i = 0; i < 200; i++) sockRetryBudgetNote(b, 'tried', 95); return b.closed; })(),
  false);

// 17) Có cứu được ⇒ giữ thử lại; đã đóng mà cứu được ⇒ mở lại ngay
check('có cứu được 1 ca ⇒ không đóng',
  (() => {
    const b = newBudget();
    for (let i = 0; i < 31; i++) sockRetryBudgetNote(b, 'tried', 34);
    sockRetryBudgetNote(b, 'saved', 0);
    for (let i = 0; i < 20; i++) sockRetryBudgetNote(b, 'tried', 34);
    return b.closed;
  })(),
  false);
check('đã đóng mà cứu được ⇒ MỞ LẠI',
  (() => { const b = newBudget(); b.closed = true; sockRetryBudgetNote(b, 'saved', 0); return b.closed; })(),
  false);

// 18) Đã đóng vẫn dò lại đúng 1 ca / 200 ca bị bỏ (không bỏ hẳn vĩnh viễn)
{
  const b = newBudget();
  for (let i = 0; i < 40; i++) sockRetryBudgetNote(b, 'tried', 34);
  let probes = 0;
  for (let i = 0; i < 1000; i++) {
    if (sockRetryBudgetAllows(b)) {
      probes++;
      sockRetryBudgetNote(b, 'probe', 34);
      sockRetryBudgetNote(b, 'tried', 34);
    } else {
      sockRetryBudgetNote(b, 'skipped', 34);
    }
  }
  check('1000 ca sau khi đóng ⇒ đúng 4 lần dò lại', String(probes), '4');
  check('đếm đủ số ca bị bỏ', String(b.skipped), '996');
}

// 19) Không có ngân sách (đường cũ) ⇒ không chặn oan
check('không có ngân sách ⇒ cho thử lại', sockRetryBudgetAllows(null), true);

// 24) [v1.92.28] Cửa sổ 200 ACK gần nhất — phân biệt "lô nhiều khách chết" với "burst-reject"
{
  resetSockAckRecent();
  for (let i = 0; i < 39; i++) noteSockAckRecent('rejected');
  check('chưa đủ 40 mẫu ⇒ chưa kết luận (-1)', String(socketRejectPctRecent()), '-1');
  noteSockAckRecent('rejected');
  check('40 mẫu toàn rejected ⇒ 100%', String(Math.round(socketRejectPctRecent())), '100');

  resetSockAckRecent();
  for (let i = 0; i < 200; i++) noteSockAckRecent('ok');      // 200 ca OK cũ
  for (let i = 0; i < 200; i++) noteSockAckRecent('rejected'); // rồi 200 ca rejected
  check('cửa sổ chỉ tính 200 ca GẦN NHẤT ⇒ 100%', String(Math.round(socketRejectPctRecent())), '100');

  resetSockAckRecent();
  for (let i = 0; i < 200; i++) noteSockAckRecent(i % 2 ? 'rejected' : 'ok');
  check('nửa OK nửa rejected ⇒ 50%', String(Math.round(socketRejectPctRecent())), '50');

  resetSockAckRecent();
  check('reset ⇒ -1', String(socketRejectPctRecent()), '-1');
}

// 25) [v1.92.28] Luật đóng ngân sách: -1 (chưa đủ mẫu) và < 15% thì KHÔNG đóng
check('chưa đủ mẫu (-1) ⇒ không đóng ngân sách',
  (() => { const b = newBudget(); for (let i = 0; i < 80; i++) sockRetryBudgetNote(b, 'tried', -1); return b.closed; })(),
  false);
check('lô sạch (12% từ chối) ⇒ không đóng',
  (() => { const b = newBudget(); for (let i = 0; i < 80; i++) sockRetryBudgetNote(b, 'tried', 12); return b.closed; })(),
  false);
check('lô nhiều khách chết (50%) ⇒ đóng đúng ở ca thứ 40',
  (() => {
    const b = newBudget();
    for (let i = 0; i < 39; i++) sockRetryBudgetNote(b, 'tried', 50);
    const before = b.closed;
    sockRetryBudgetNote(b, 'tried', 50);
    return (before === false && b.closed === true) ? 'ok' : 'sai';
  })(),
  'ok');
check('đóng ngân sách ghi lại % để in vào log',
  (() => { const b = newBudget(); for (let i = 0; i < 40; i++) sockRetryBudgetNote(b, 'tried', 47.6); return String(b.closePct); })(),
  '48');

// 26) [v1.92.29] Kiểm chứng bằng `snippet` của hội thoại — nguồn DUY NHẤT thấy tin CUỐI
//     (HAR: đọc lịch sử chỉ trả 25 tin cũ nhất nên thread dài không bao giờ khớp).
{
  const scode = [
    extractFn('normalizeMsgText'),
    extractFn('msgTimeMs'),
    extractFn('snippetText'),
    extractFn('snippetVerdict'),
    'return { snippetVerdict, snippetText };',
  ].join('\n\n');
  const S = new Function('serverSkewMs', scode)(0);
  const P = '898735919982398';
  const PSID = '39224298167184827';
  const CID = P + '_' + PSID;
  const t0 = Date.parse('2026-11-11T10:00:00Z');
  const sendTxt = 'Chị cho em xin chiều cao cân nặng của bé với ạ';
  const conv = (o) => Object.assign({
    id: CID, page_id: P, from_psid: PSID,
    snippet: sendTxt, updated_at: new Date(t0).toISOString().replace('Z', '').replace(/\.\d{3}/, '.000000'),
    last_sent_by: { id: P },
  }, o);

  check('snippet khớp đúng tin vừa gửi ⇒ yes',
    S.snippetVerdict([conv({})], CID, P, PSID, sendTxt, t0), 'yes');
  check('snippet bị cắt (~50 ký tự) vẫn nhận ra ⇒ yes',
    S.snippetVerdict([conv({ snippet: sendTxt.slice(0, 24) + '....' })], CID, P, PSID, sendTxt, t0), 'yes');
  check('snippet là tin CÙNG NỘI DUNG nhưng gửi từ hôm trước ⇒ KHÔNG chốt ✅',
    S.snippetVerdict([conv({ updated_at: new Date(t0 - 86400000).toISOString().replace('Z', '').replace(/\.\d{3}/, '.000000') })], CID, P, PSID, sendTxt, t0), 'unknown');
  check('tin cuối do người/page KHÁC gửi ⇒ KHÔNG chốt ✅',
    S.snippetVerdict([conv({ last_sent_by: { id: '123456789' } })], CID, P, PSID, sendTxt, t0), 'unknown');
  check('khác hội thoại ⇒ KHÔNG chốt ✅',
    S.snippetVerdict([conv({ id: P + '_999', from_psid: '999' })], CID, P, PSID, sendTxt, t0), 'unknown');
  check('khác page ⇒ KHÔNG chốt ✅',
    S.snippetVerdict([conv({ id: '111_222', page_id: '111', from_psid: '222' })], CID, P, PSID, sendTxt, t0), 'unknown');
  check('text ngắn (<12 ký tự) ⇒ không đủ chắc, giữ unknown',
    S.snippetVerdict([conv({ snippet: 'Dạ' })], CID, P, PSID, 'Dạ', t0), 'unknown');
  check('snippet rỗng ⇒ unknown',
    S.snippetVerdict([conv({ snippet: '' })], CID, P, PSID, sendTxt, t0), 'unknown');
  check('snippetText bỏ đuôi "...." và khoảng trắng',
    S.snippetText('<div>Chào chị ạ </div>....'), 'Chào chị ạ');
}

// 27) [v1.92.30] Cổng "chứng minh vắng mặt" trước lần bắn thứ 2 — chỗ chặn LẶP.
//     Bù chỉ được chạy khi: hoặc tin ĐÃ thấy (hủy bù), hoặc hội thoại CHỨNG MINH không đổi
//     sau lúc gửi. "Chưa thấy tin" một mình KHÔNG BAO GIỜ được coi là "chưa gửi".
{
  const acode = [
    extractFn('normalizeMsgText'),
    extractFn('msgTimeMs'),
    extractFn('snippetText'),
    extractFn('snippetVerdict'),
    extractFn('absenceVerdict'),
    'return { absenceVerdict };',
  ].join('\n\n');
  // [v1.92.48] cổng phải đứng SAU cửa sổ nghe ACK ⇒ tiêm thêm mốc BU_PROOF_NOT_BEFORE_MS
  const A = new Function('serverSkewMs', 'BU_PROOF_STALE_MS', 'BU_PROOF_NOT_BEFORE_MS', acode)(0, 30000, 14000);
  const P = '898735919982398';
  const PSID = '39224298167184827';
  const CID = P + '_' + PSID;
  const t0 = Date.parse('2026-11-11T10:00:00Z');
  const sendTxt = 'Chị cho em xin chiều cao cân nặng của bé với ạ';
  const raw = (ms) => new Date(ms).toISOString().replace('Z', '').replace(/\.\d{3}/, '.000000');
  const conv = (o) => Object.assign({ id: CID, page_id: P, from_psid: PSID, snippet: sendTxt, updated_at: raw(t0), last_sent_by: { id: P } }, o);

  const tLate = t0 + 14000; // đọc MUỘN đủ xa: sau cửa sổ nghe ACK (12 000) + biên
  check('cổng: tin ĐÃ có trong snippet ⇒ yes (hủy bù ngay, không chờ)', A.absenceVerdict([conv({})], CID, P, PSID, sendTxt, t0, false, t0), 'yes');
  check('cổng: dò SỚM thấy hội thoại chưa đổi ⇒ KHÔNG được kết luận vắng mặt', A.absenceVerdict([conv({ snippet: 'Tin cũ của shop', updated_at: raw(t0 - 600000) })], CID, P, PSID, sendTxt, t0, false, t0), 'unknown');
  check('cổng: dò MUỘN, hội thoại im từ trước lúc gửi ⇒ absent (bù an toàn)', A.absenceVerdict([conv({ snippet: 'Tin cũ của shop', updated_at: raw(t0 - 600000) })], CID, P, PSID, sendTxt, t0, true, tLate), 'absent');
  // [v1.92.48] ĐIỀU KIỆN MỚI: đọc ở +10 s (mốc cũ) mà ACK còn có thể về (cửa sổ nghe 12 s)
  // thì TUYỆT ĐỐI không được phán 'absent' ⇒ nếu phán sớm thì bù Ext ⇒ khách nhận 2 tin.
  check('cổng: đọc ở +10 s (trước mốc 14 s) ⇒ KHÔNG được absent', A.absenceVerdict([conv({ snippet: 'Tin cũ của shop', updated_at: raw(t0 - 600000) })], CID, P, PSID, sendTxt, t0, true, t0 + 10000), 'unknown');
  check('cổng: đọc ở +13,9 s vẫn chưa được absent', A.absenceVerdict([conv({ snippet: 'Tin cũ của shop', updated_at: raw(t0 - 600000) })], CID, P, PSID, sendTxt, t0, true, t0 + 13999), 'unknown');
  check('cổng: hội thoại VỪA động sau lúc gửi nhưng snippet khác ⇒ unknown (không dám bù)', A.absenceVerdict([conv({ snippet: 'Tin khác', updated_at: raw(t0 + 2000) })], CID, P, PSID, sendTxt, t0, true, tLate), 'unknown');
  check('cổng: thiếu updated_at ⇒ unknown', A.absenceVerdict([conv({ snippet: 'Tin cũ', updated_at: '' })], CID, P, PSID, sendTxt, t0, true, tLate), 'unknown');
  check('cổng: hội thoại khác ⇒ unknown', A.absenceVerdict([conv({ id: P + '_999', from_psid: '999', snippet: 'Tin cũ', updated_at: raw(t0 - 600000) })], CID, P, PSID, sendTxt, t0, true, tLate), 'unknown');
  check('cổng: danh sách rỗng ⇒ unknown', A.absenceVerdict([], CID, P, PSID, sendTxt, t0, true, tLate), 'unknown');
}

// 21) [v1.92.44] photoMovedVerdict — cổng "hội thoại vừa động" cho ca gửi ẢNH kèm chữ ngắn.
//     Cửa sổ PHẢI bất đối xứng: chỉ nới 15 s về trước; nới 60 s sẽ nuốt tin của LƯỢT TRƯỚC
//     (cách 50 s) ⇒ "chứng minh" tin đã tới cho ca vừa gửi HỎNG ⇒ chốt ✅ oan.
{
  const code3 = [
    extractFn('msgTimeMs'),
    extractFn('photoMovedVerdict'),
    'return { photoMovedVerdict };',
  ].join('\n\n');
  const A = new Function('serverSkewMs', code3)(0);
  const P = PAGE;
  const PSID = '39224298167184827';
  const CID = P + '_' + PSID;
  const t0 = T0;
  const conv = (o) => Object.assign({
    id: CID, page_id: P, from_psid: PSID,
    updated_at: new Date(t0).toISOString(), last_sent_by: { id: P },
  }, o);
  check('ảnh: hội thoại động ngay sau lúc gửi ⇒ yes',
    A.photoMovedVerdict([conv({ updated_at: new Date(t0 + 1500).toISOString() })], CID, P, PSID, t0), 'yes');
  check('ảnh: tin của LƯỢT TRƯỚC (cách 50 s) KHÔNG được kết luận đã tới',
    A.photoMovedVerdict([conv({ updated_at: new Date(t0 - 50000).toISOString() })], CID, P, PSID, t0), 'unknown');
  check('ảnh: server cập nhật MUỘN 10 s vẫn nhận ra tin vừa gửi (không chặn phía sau)',
    A.photoMovedVerdict([conv({ updated_at: new Date(t0 + 10000).toISOString() })], CID, P, PSID, t0), 'yes');
  check('ảnh: hội thoại do KHÁCH động (last_sent_by = khách) ⇒ unknown',
    A.photoMovedVerdict([conv({ updated_at: new Date(t0 + 1500).toISOString(), last_sent_by: { id: 'khach' } })], CID, P, PSID, t0), 'unknown');
  check('ảnh: hội thoại page khác ⇒ unknown',
    A.photoMovedVerdict([conv({ id: '1_2', page_id: '1', updated_at: new Date(t0 + 1500).toISOString() })], CID, P, PSID, t0), 'unknown');
  check('ảnh: thiếu updated_at ⇒ unknown',
    A.photoMovedVerdict([conv({ updated_at: '' })], CID, P, PSID, t0), 'unknown');
  check('ảnh: danh sách rỗng ⇒ unknown', A.photoMovedVerdict([], CID, P, PSID, t0), 'unknown');
}

// 22) [v1.92.45] PHÂN LOẠI "CHẮC CHẮN KHÔNG GỬI ĐƯỢC" — quyết định CHỜ 10 s hay CHỐT NGAY.
//     Sai ở đây theo hướng nào cũng tốn: nhận nhầm ca mơ hồ là "dứt khoát" ⇒ chốt ⚠ trong khi
//     tin có thể đã đi (mất cơ hội nâng ✅); bỏ sót ca dứt khoát ⇒ bắt người dùng chờ 10–35 s
//     cho một ca mà FB đã nói rõ là không nhận.
//     Bộ ca lấy ĐÚNG mã có trong network-log.har của làn Ext (1545041 ×86, 1545012 ×4).
{
  const code4 = [
    extractFn('isDefinitiveNotSent'),
    extractFn('isTransientServerError'),
    'return { isDefinitiveNotSent, isTransientServerError };',
  ].join('\n\n');
  const F = new Function(code4)();

  // --- phải là "dứt khoát" (chốt ngay, không chờ) ---
  check('1545041 · người này hiện không có mặt ⇒ dứt khoát',
    F.isDefinitiveNotSent('(#551) Người này hiện không có mặt.'), true);
  check('1545041 · chuỗi từ Ext (không có #551) ⇒ dứt khoát',
    F.isDefinitiveNotSent('Ext: FB từ chối — Người này hiện không có mặt'), true);
  check('1545012 · lỗi tạm thời ⇒ dứt khoát (server chưa tạo tin)',
    F.isDefinitiveNotSent('Đã xảy ra lỗi tạm thời, vui lòng thử lại.'), true);
  check('(#10) ngoài khoảng thời gian cho phép ⇒ dứt khoát',
    F.isDefinitiveNotSent('(#10) Tin nhắn này được gửi ngoài khoảng thời gian cho phép'), true);
  check('(#10) thread do app khác kiểm soát ⇒ dứt khoát',
    F.isDefinitiveNotSent('(#10) Không gửi được tin nhắn do một ứng dụng khác hiện đang kiểm soát thread này.'), true);
  check('(#100) không tìm thấy người dùng ⇒ dứt khoát',
    F.isDefinitiveNotSent('(#100) Không tìm thấy người dùng phù hợp'), true);

  // --- KHÔNG được coi là dứt khoát (vẫn phải chờ + kiểm chứng) ---
  check('Socket mất ACK ⇒ KHÔNG dứt khoát (phải chờ cổng)', F.isDefinitiveNotSent('Socket không rõ kết quả (không có ACK)'), false);
  check('Ext quá hạn ⇒ KHÔNG dứt khoát', F.isDefinitiveNotSent('Extension không phản hồi (quá hạn) — không gửi thêm để tránh trùng'), false);
  check('API timeout ⇒ KHÔNG dứt khoát', F.isDefinitiveNotSent('HTTP 504'), false);
  check('chuỗi rỗng ⇒ KHÔNG dứt khoát', F.isDefinitiveNotSent(''), false);

  // --- thử lại được (không thể trùng) ---
  check('1545012 ⇒ thử lại được', F.isTransientServerError('Đã xảy ra lỗi tạm thời, vui lòng thử lại.'), true);
  check('mã 1545012 trần ⇒ thử lại được', F.isTransientServerError('error 1545012'), true);
  check('1545041 ⇒ KHÔNG thử lại tự động', F.isTransientServerError('Người này hiện không có mặt'), false);
  // Bản nháp đầu bắt mọi chuỗi dạng "5xx" ⇒ khớp bừa id/token/số ngẫu nhiên trong lỗi.
  // Đây là ca chống hồi quy cho lỗi đó: các chuỗi sau KHÔNG được coi là lỗi tạm thời.
  check('chuỗi có số 512 không phải lỗi tạm thời', F.isTransientServerError('room 512 không tồn tại'), false);
  check('thread 500 không phải lỗi tạm thời', F.isTransientServerError('INCORRECT THREAD 500'), false);
  check('HTTP 502 ⇒ thử lại được', F.isTransientServerError('HTTP 502'), true);
  check('HTTP 429 ⇒ KHÔNG thử lại tự động', F.isTransientServerError('HTTP 429'), false);
}

// 23) [v1.92.45] NGÂN SÁCH DÒ 1545041 phải đóng theo CHUỖI LIÊN TIẾP, không chờ 200 ca —
//     nhưng KHÔNG được đóng khi còn ca cứu được (nếu Ext thật sự gửi được thì phải mở lại).
{
  const mk = () => ({ tried: 0, saved: 0, closed: false, PROBE: 200, streak: 0, STREAK_MAX: 30 });
  const note = (b) => {
    if (b.closed) return;
    b.streak = (b.streak || 0) + 1;
    if ((b.streak >= b.STREAK_MAX && b.saved === 0) || (b.tried >= b.PROBE && b.saved === 0)) b.closed = true;
  };

  const b1 = mk();
  for (let i = 0; i < 29; i++) note(b1);
  check('29 ca liên tiếp ⇒ ngân sách CÒN mở', b1.closed, false);
  note(b1);
  check('30 ca liên tiếp ⇒ ngân sách ĐÓNG (không chờ 200)', b1.closed, true);

  const b2 = mk();
  for (let i = 0; i < 29; i++) note(b2);
  b2.saved++; b2.streak = 0; // Ext cứu được 1 ca ⇒ reset chuỗi
  for (let i = 0; i < 29; i++) note(b2);
  check('cứu được ca nào thì chuỗi reset, không đóng oan', b2.closed, false);

  const b3 = mk();
  b3.tried = 200;
  note(b3);
  check('trần cũ 200 ca vẫn còn tác dụng', b3.closed, true);
}

// 24) [v1.92.47] BÓC TIỀN TỐ `for (;;);` TRƯỚC KHI JSON.parse — lỗi parse GraphQL của
//     extension Pancake v2 (network-log.har 90/90, network-log2.har 19/19 phản hồi gửi đều
//     có prefix). Không bóc thì `Unexpected non-whitespace character after JSON` ⇒
//     `Cannot read properties of null (reading 'error')` ⇒ CANNOT GET GLOBAL ID.
{
  const F = new Function(extractFn('stripJsonPrefix') + '\nreturn stripJsonPrefix;')();
  // chuỗi THẬT lấy nguyên văn từ network-log2.har (entry 35)
  const real = 'for (;;);{"__ar":1,"error":1545041,"errorSummary":"Kh\u00f4ng g\u1eedi \u0111\u01b0\u1ee3c",'
    + '"errorDescription":"Ng\u01b0\u1eddi n\u00e0y hi\u1ec7n kh\u00f4ng c\u00f3 m\u1eb7t.","isNotCritical":1,'
    + '"rid":"Aw40Lx-ryPMw2lqvbj2As_Y","payload":null,"lid":"7708931259765236803"}';
  let parsed = null;
  try { parsed = JSON.parse(F(real)); } catch (e) { parsed = 'THROW'; }
  check('có prefix for (;;); ⇒ parse được (ca 1545041 thật)', parsed && parsed.error, 1545041);
  check('prefix bị bóc hết, không còn ký tự lạ', String(F(real)).charAt(0), '{');
  check('biến thể không space "for(;;);" cũng bóc', JSON.parse(F('for(;;);{"a":1}')).a, 1);
  // JSON hợp lệ KHÔNG bị đụng: đây là đường chính của pancake.vn/api/v1
  check('JSON sạch giữ nguyên', F('{"success":true,"id":"1_2"}'), '{"success":true,"id":"1_2"}');
  check('JSON sạch có khoảng trắng đầu vẫn parse đúng', JSON.parse(F('\n  {"ok":1}')).ok, 1);
  // một phản hồi THẬT của /api/graphqlbatch/ có KHỐI JSON THỨ HAI nối sau `\r\n`
  // (47/47 phản hồi trong network-log2.har) — bóc prefix KHÔNG cứu được ca này, nên ghi
  // nhận đúng giới hạn thay vì giả vờ đã vá.
  const twoBlocks = '{"__q0__":{"data":{}}}\r\n   {"successful_results":1,"error_results":0}';
  let twoOk = true;
  try { JSON.parse(F(twoBlocks)); } catch (e) { twoOk = false; }
  check('2 khối JSON nối nhau ⇒ vẫn KHÔNG parse trần được (giới hạn đã biết)', twoOk, false);
}

// 25) [v1.92.47] CẦU DAO ĐƯỜNG DÒ GLOBAL ID QUA EXTENSION.
//     Hình dạng lỗi lấy từ log console Pancake v2: cùng một thread id trả "không có gid"
//     lặp lại (4 thread × 2 lần) mà extension không hề nhớ ⇒ thử lại y nguyên.
{
  const mkB = () => ({ noGid: 0, sameThread: 0, lastThread: '', closed: false, NO_GID_MAX: 40, SAME_THREAD_MAX: 3 });
  const note = (b, tid) => {
    if (b.closed) return;
    const t = String(tid || '');
    b.noGid++;
    if (t && t === b.lastThread) b.sameThread++;
    else { b.lastThread = t; b.sameThread = t ? 1 : 0; }
    if (b.noGid < b.NO_GID_MAX && b.sameThread < b.SAME_THREAD_MAX) return;
    b.closed = true;
  };

  const a = mkB();
  note(a, '1515207651668552');
  check('thread hỏng 1 lần ⇒ chưa đóng (1 lần có thể là nhiễu)', a.closed, false);
  note(a, '1515207651668552');
  check('thread hỏng 2 lần ⇒ vẫn chưa đóng', a.closed, false);
  note(a, '1515207651668552');
  check('CÙNG thread hỏng 3 lần ⇒ đóng ngay, không chờ 40 ca', a.closed, true);

  const b = mkB();
  for (let i = 0; i < 39; i++) note(b, '100000000000' + i);
  check('39 ca khác thread ⇒ còn mở', b.closed, false);
  note(b, 'thread-khac');
  check('40 ca "không có gid" ⇒ đóng', b.closed, true);

  // ca Ext QUÁ HẠN không được tính vào cầu dao: nó là "chưa rõ", không phải "trả lời không gid"
  const c = mkB();
  for (let i = 0; i < 5; i++) note(c, '');
  check('timeout/không threadId không tự đóng cầu dao', c.closed, false);

  // chống hồi quy ở mức NGUỒN: cầu dao phải thật sự chặn đường dò, và phải được ghi nhận
  check('nhánh dò Ext có bị chặn bởi cầu dao',
    /hasExtFinder && threadId && gidExtFinderAllowed\(\)/.test(SRC), true);
  check('ca "trả lời mà không có gid" có ghi vào cầu dao',
    /noteGidFinderNoGid\(threadId\)/.test(SRC), true);
  /* [v1.92.47b] NGƯỢC LẠI với bản 1.92.47: `fetchJson` là đường của KHÂU TẢI, người dùng
   * yêu cầu giữ nguyên ⇒ test phải KHOÁ lại là nó KHÔNG bị bọc, để lần sau không ai "tối ưu"
   * thêm vào đường tải nữa. */
  check('fetchJson giữ NGUYÊN như 1.92.46 (không bọc stripJsonPrefix)',
    /JSON\.parse\(stripJsonPrefix\(txt\)\)/.test(SRC), false);
  check('ACK Socket cũng bóc prefix trước khi parse',
    /JSON\.parse\(stripJsonPrefix\(g\.payload\)\)/.test(SRC), true);
}


/* ------------------ [v1.92.49] HAI BẪY ĐÃ SẬP THẬT — KHOÁ LẠI BẰNG TEST ------------------
 * Cả hai đều lộ ra từ SỐ trong log chứ không phải từ suy luận, nên test phải bám đúng số đó.
 */

/* (1) NGÂN SÁCH DÒ EXT PHẢI ĐÓNG SAU 200 CA THỬ MÀ CỨU 0.
 * Sổ 11:05 (6 920 chat) in "thử 2 768 · cứu 0" mà KHÔNG có chữ "ĐÓNG" ⇒ cầu dao 200 chưa
 * từng đóng. Test dựng lại đúng bộ ba nhánh ghi nhận và xác nhận nó đóng ở ca thứ 200. */
const extBudgetConsts = "const extTry1545 = { tried: 0, saved: 0, closed: false, PROBE: 200, streak: 0, STREAK_MAX: 30, unknown: 0 };";
/* Mỗi khối dùng MỘT bản sao sạch (sổ là state thật, không được dùng chung giữa các ca). */
const newExtBudget = () => new Function([
  extBudgetConsts,
  "const logLine = () => {};",
  extractFn('noteExt1545Fail'),
  extractFn('noteExt1545Outcome'),
  'return { extTry1545, noteExt1545Fail, noteExt1545Outcome };',
].join('\n\n'))();
{
  // Ngưỡng thật là STREAK_MAX = 30 ca LIÊN TIẾP, nên phải đóng từ rất lâu trước 200.
  // Log 11:05 in "thử 2 768 · cứu 0" mà vẫn MỞ ⇒ chứng tỏ hàm ghi nhận CHƯA TỪNG được gọi.
  const { extTry1545, noteExt1545Outcome } = newExtBudget();
  for (let i = 0; i < 29; i++) noteExt1545Outcome('blocked');
  check('29 ca Ext bị chặn liên tiếp ⇒ còn mở (chưa tới ngưỡng 30)', extTry1545.closed, false);
  noteExt1545Outcome('blocked');
  check('ca thứ 30 liên tiếp ⇒ ĐÓNG ngân sách (đúng cái log 11:05 thiếu)', extTry1545.closed, true);
}
{
  // ca "quá hạn / không rõ" KHÔNG được đóng sổ: chưa có bằng chứng Ext bị chặn
  const { extTry1545, noteExt1545Outcome } = newExtBudget();
  for (let i = 0; i < 500; i++) noteExt1545Outcome('unknown');
  check('500 ca Ext QUÁ HẠN (chưa rõ) ⇒ KHÔNG đóng sổ (không phải bằng chứng)', extTry1545.closed, false);
  check('nhưng phải ĐẾM riêng để bảng TỔNG HỢP nói được "chưa có kết quả"', extTry1545.unknown, 500);
}
{
  // cứu được 1 ca ⇒ streak về 0, không đóng oan
  const { extTry1545, noteExt1545Outcome } = newExtBudget();
  for (let i = 0; i < 30; i++) noteExt1545Outcome('blocked');
  check('30 ca liên tiếp bị chặn ⇒ đóng', extTry1545.closed, true);
  noteExt1545Outcome('saved');
  check('Ext cứu được 1 ca ⇒ đếm saved', extTry1545.saved, 1);
  check('Ext cứu được ⇒ streak về 0 (không đóng oan)', extTry1545.streak, 0);
}
// chống hồi quy ở mức NGUỒN: reset mỗi lượt + cả 3 nhánh bù đều phải gọi hàm ghi nhận
check('ngân sách dò Ext được RESET đầu mỗi lượt (log 11:10 in số tích luỹ 2 768)',
  /extTry1545\.tried = 0; extTry1545\.saved = 0; extTry1545\.streak = 0;/.test(SRC), true);
check('nhánh Ext quá hạn ghi nhận là "unknown", không phải "blocked"',
  /noteExt1545Outcome\('unknown'\)/.test(SRC), true);
check('nhánh Ext bị chặn ghi nhận là "blocked"',
  /noteExt1545Outcome\('blocked'\)/.test(SRC), true);

/* (2) PHÂN XỬ ACK MUỘN CHỈ ĐƯỢC CHẠY KHI THẬT SỰ QUÁ HẠN CHỜ.
 * Sổ 11:05 in "ACK về MUỘN đã phân xử 6 785" trong khi 📡 in "OK/rejected 3 909/2 876" —
 * 3 909 + 2 876 = 6 785 ⇒ đúng bằng số ACK ĐẾN ĐÚNG HẠN, tức mỗi tin bị đếm 2 lần.
 * Test khoá cả 3 mắt xích: cờ, chỗ bật cờ, và điều kiện giao gói cho đường muộn. */
check('có cờ ackTimedOut để phân biệt "về muộn" với "về đúng hạn"',
  /let ackTimedOut = false;/.test(SRC), true);
check('cờ ackTimedOut chỉ bật khi timer hết hạn chờ giữ slot nổ',
  /ackTimedOut = true; \/\/ \[v1\.92\.49\]/.test(SRC), true);
check('gói về ĐÚNG HẠN KHÔNG được giao cho đường phân xử muộn (nguồn của số 6 785)',
  /if \(lateRef && ackTimedOut && !mySilent\) lateRef\.resolve\(resp\);/.test(SRC), true);
check('nhánh "muộn mà không có payload" được đếm riêng, không im lặng',
  /sockLateNoack = \(sendDiag\.sockLateNoack \|\| 0\) \+ 1/.test(SRC), true);

/* (3) TRẦN LÀN SOCKET KHÔNG ĐƯỢC VƯỢT 256.
 * Số đo 2 lô cùng máy: làn 256 ⇒ 44,0 lệnh/s · 312–320 ⇒ 37,7 · 384 ⇒ 33,6 (tương quan ÂM).
 * Lô 11:05 nới 256→384 lúc 11:05:37 rồi không hạ lại dù p95 lên 2 618 ms. */
check('trần làn Socket/page = 256 (không leo lại 384)',
  /const SOCKET_LANE_MAX = 256;/.test(SRC), true);
check('sàn làn chạy vẫn = 96 (giữ nguyên quyết định 1.92.48)',
  /const SOCKET_LANE_RUNTIME_FLOOR = 96;/.test(SRC), true);

/* (4) ĐO KHÂU BIND fbId — trước đây KHÔNG có số nào nên mọi kết luận về tốc độ là suy đoán. */
check('có bộ đo riêng cho khâu upload/bind ảnh',
  /const photoUpStats = \{ n: 0, ms: 0, max: 0, fail: 0 \};/.test(SRC), true);
check('số đo bind ảnh được in trong dòng ⏱ GIỮ SLOT',
  /📷 bind fbId: ' \+ photoUpStats\.n/.test(SRC), true);

/* ------------- [v1.92.50] BỐN CHỖ ĐO SAI ĐÃ SẬP Ở LÔ 9 242 CHAT -------------
 * Tất cả đều lộ ra bằng SỐ trong sổ 11:34, không phải bằng suy luận.
 */

/* (5) NHÁNH "NGÂN SÁCH SOCKET ĐÃ ĐÓNG → BÙ EXT" PHẢI ĐÁNH DẤU CA.
 * Sổ 11:34: dồn 3 280 ca sang Ext, Ext trả "Người này hiện không có mặt" 3 122 ca, mà KHÔNG
 * có dòng 🔒 nào. Gốc: nhánh 5284 tăng extTry1545.tried mà không set conv.__extFallback1545,
 * nên noteExt1545Outcome() (chỉ ghi khi cờ bật) không bao giờ chạy. */
{
  const seg = SRC.slice(SRC.indexOf('if (hasExt1545 && extFallback1545Allowed()) {'),
                        SRC.indexOf('if (hasExt1545 && !extFallback1545Allowed()) {'));
  check('nhánh 5284 có set cờ __extFallback1545 (thiếu cờ ⇒ cầu dao Ext không bao giờ đóng)',
    /conv\.__extFallback1545 = true;/.test(seg), true);
  check('nhánh 5284 vẫn tăng extTry1545.tried như cũ',
    /extTry1545\.tried\+\+;/.test(seg), true);
}
/* Test hành vi: set cờ RỒI ghi nhận ⇒ sổ phải đóng sau 30 ca. */
{
  const { extTry1545, noteExt1545Outcome } = newExtBudget();
  const conv = {};
  for (let i = 0; i < 30; i++) {
    conv.__extFallback1545 = true;      // đúng việc nhánh 5284 làm
    if (conv.__extFallback1545) noteExt1545Outcome('blocked');
  }
  check('30 ca dồn-Ext bị Ext chặn, có cờ ⇒ ĐÓNG ngân sách (lô 9 242 thiếu 3 250 lệnh vì đây)',
    extTry1545.closed, true);
}

/* (6) HAI BỘ ĐO PHẢI RESET ĐẦU MỖI LƯỢT.
 * photoUpStats: 2 lô khác nhau in y nguyên 12 362 / 1 312 / 9 480 / 0 ⇒ số tích luỹ.
 * waveDiag.slot*: in "n=9 242" cho lô 9 242 chat sau 19 cổng wave ⇒ đơn vị lẫn. */
check('photoUpStats được reset đầu mỗi lượt (log in số cũ 12 362 cho lô khác)',
  /photoUpStats\.n = 0; photoUpStats\.ms = 0; photoUpStats\.max = 0; photoUpStats\.fail = 0;/.test(SRC), true);
/* ĐÍNH CHÍNH: waveDiag.slot* THỰC RA ĐÃ được reset qua vòng chung `Object.keys(waveDiag)`.
 * Báo cáo trước nói nó tích luỹ là SAI. Vấn đề thật chỉ là nhãn đơn vị ⇒ test bám đúng điều đó. */
check('waveDiag được reset đủ khoá qua vòng chung (đính chính: báo cáo trước nói sai chỗ này)',
  /Object\.keys\(waveDiag\)\.forEach\(\(k\) => \{ waveDiag\[k\] = 0; \}\);/.test(SRC), true);
/* photoUpStats là object RIÊNG (không phải khoá của sendDiag/waveDiag) ⇒ hai vòng reset chung
 * `Object.keys(sendDiag)` / `Object.keys(waveDiag)` KHÔNG chạm tới nó ⇒ cộng dồn qua các lượt.
 * Đây là gốc của việc hai lô khác nhau in y nguyên 12 362 / 1 312 / 9 480 / 0. */
{
  const objStart = SRC.indexOf('const sendDiag = {');
  const objEnd = SRC.indexOf('const waveDiag = {');
  const diagBlock = SRC.slice(objStart, objEnd);
  check('photoUpStats KHÔNG phải khoá của sendDiag (nên vòng reset chung bỏ sót)',
    /photoUpStats:/.test(diagBlock), false);
  check('photoUpStats KHÔNG phải khoá của waveDiag',
    /photoUpStats:/.test(SRC.slice(objEnd, SRC.indexOf('};', SRC.indexOf('slotN: 0, slotAcquireMs')))), false);
  check('vì vậy phải có lệnh reset RIÊNG cho photoUpStats',
    /photoUpStats\.n = 0; photoUpStats\.ms = 0; photoUpStats\.max = 0; photoUpStats\.fail = 0;/.test(SRC), true);
}
check('dòng GIỮ SLOT có NHÃN ĐƠN VỊ "ms/chat" (đọc cạnh 296,8s rất dễ hiểu sai thành tổng)',
  /GIỮ SLOT \(ms\/chat\)/.test(SRC), true);
check('dòng GIỮ SLOT nói rõ n là SỐ LẦN GIỮ SLOT, không phải số chat',
  /n=' \+ waveDiag\.slotN \+ ' lần giữ slot/.test(SRC), true);

/* (7) ĐUÔI CHỜ XÁC NHẬN ĐẾM THEO CHAT.
 * Log 11:34 in "9 263 ca vào sổ chờ" trong khi lô chỉ có 9 242 lệnh — nhiều hơn số chat là
 * bất khả. Gốc: một chat đi 2–3 chuỗi bù thì noteBgPending bị gọi 2–3 lần. */
check('tailChats chỉ đếm chat MỚI (có sổ tailSeen), không cộng dồn theo lần gọi',
  /if \(!tailSeen\[conv\.id\]\) \{/.test(SRC), true);
check('tailSeen được reset đầu mỗi lượt',
  /Object\.keys\(tailSeen\)\.forEach/.test(SRC), true);

/* (8) MỐC PHÁT XONG KHÔNG ĐƯỢC GỒM ĐUÔI.
 * Log 11:34 in "PHÁT 9 242 lệnh trong 296,8s" trong khi 19 cổng wave mở hết lúc 166 s.
 * Gốc: dispatchEndedAt đặt sau await Promise.all([...socketWorkers, ...extensionWorkers]). */
check('mốc phát xong đóng ở cuối vòng WAVE (trước khi chạy đuôi)',
  /if \(!batchStats\.dispatchEndedAt\) batchStats\.dispatchEndedAt = Date\.now\(\);/.test(SRC), true);
check('sendToAll KHÔNG ghi đè mốc đã đóng (ghi đè ⇒ tính cả đuôi 131 s vào PHÁT …/s)',
  (SRC.match(/if \(!batchStats\.dispatchEndedAt\) batchStats\.dispatchEndedAt = Date\.now\(\);/g) || []).length, 2);

/* --------- [v1.92.51] DÒNG 🏁 PHẢI IN MỐC PHÁT, KHÔNG PHẢI "BÂY GIỜ" ---------
 * Log 12:06 (6 920 chat): dòng 🏁 in "Đã phát lệnh xong trong 107s" nhưng dòng ⚡ cùng lượt in
 * "PHÁT … trong 54,5s" — 107 s là thời điểm IN (đuôi đã chạy được nửa), không phải lúc phát xong.
 * Hai dòng nói hai số khác nhau về cùng một việc ⇒ không nghiệm thu được. */
check('dòng 🏁 dùng dispatchEndedAt (mốc phát thật), không dùng Date.now() lúc in',
  /Đã phát lệnh xong trong ' \+ \(\(\(\(batchStats\.dispatchEndedAt \|\| Date\.now\(\)\) - batchStats\.startedAt\)/.test(SRC), true);
check('dòng 🏁 KHÔNG còn lấy Date.now() trực tiếp làm mốc phát',
  /Đã phát lệnh xong trong ' \+ \(\(\(Date\.now\(\) - batchStats\.startedAt\)/.test(SRC), false);

/* ------------- [v1.92.52] NĂM VÁ TỪ LÔ 8 509 CHAT (12:24, CÓ ẢNH, TAB NỀN) ------------- */

/* (9) BẢN IN "bù THÀNH CÔNG" KHÔNG ĐƯỢC GHI THÊM ✅ VÀO SỔ.
 * Sổ 12:24: 6 chat có 2 dòng ✅ cho MỘT lần gửi (markDelivered + logFailGrouped). */
check('logFailGrouped nhận cờ noAudit (mặc định không đổi hành vi 50 chỗ gọi cũ)',
  /function logFailGrouped\(name, reason, tag, cid, noAudit\)/.test(SRC), true);
check('auditPush chỉ chạy khi KHÔNG có noAudit',
  /if \(!noAudit\) auditPush\(tag, cid, name, display\);/.test(SRC), true);
check('dòng "bù THÀNH CÔNG" truyền noAudit = true (nguồn của 6 ca 2 dấu ✅)',
  /'bù THÀNH CÔNG qua ' \+ \(ch === 'ext' \? 'Extension' : 'Socket'\), '✅', conv\.id, true\);/.test(SRC), true);

/* (10) CỔNG: ĐO 3 MỨC CỦA "ĐANG BAY" + ĐO GIẢ THUYẾT "SLOT CHƯA KỊP NHƯỜNG".
 * Lô 12:24: 19 dòng wave in "main đang bay 163"; 18 cổng giữ 253,6 s / 404 s; wave 15 giữ 106 s.
 * floor(192 × 0,85) = 163 ⇒ "đang bay 163" chưa chứng minh được làn bị chặn ở 163. */
check('có 3 bộ đếm tách mức giữ cổng (cứng/mềm/tiến độ)',
  /gateBlockHard: 0, gateBlockSoft: 0, gateBlockProgress: 0,/.test(SRC), true);
check('có bộ đo "slot đã thoát xuống ≤75% cap" + giá trị thấp nhất',
  /gateIdleSeen: 0, gateIdleMax: -1,/.test(SRC), true);
check('3 bộ đếm chỉ ĐỌC biến, nằm TRƯỚC khối chặn (không đổi nhánh mở cổng nào)',
  (() => {
    const i = SRC.indexOf('waveDiag.gateBlockHard++');
    const j = SRC.indexOf('if (inFlightMainCount > gateActiveLimit || retryBacklog > 80');
    return i > 0 && j > 0 && i < j;
  })(), true);
check('dòng WAVE in chi tiết giữ cổng',
  /chi tiết giữ cổng: cứng '/.test(SRC), true);

/* (11) LÀN DÒ GID PHẢI CÓ ĐƯỜNG HỒI KHI EXT BỊ BÓP.
 * Lô 12:24: Ext dò = 4 suốt lô trong khi 551 ca thiếu globalId, 547 ca chốt ❌ "không gid". */
check('noteGidExtResult có đường hồi theo HÀNG ĐỢI (không chỉ 10 phản hồi nhanh)',
  /GID_EXT_QUEUE_RAMP_CAP/.test(SRC), true);
check('trần đường hồi = 12, THẤP HƠN khởi điểm 20 (không mở vùng vận hành mới)',
  /const GID_EXT_QUEUE_RAMP_CAP = 12;/.test(SRC)
  && /const GID_EXT_INITIAL = 20;/.test(SRC), true);
/* [v1.92.54] ĐIỀU KIỆN ĐÃ ĐỔI ĐẠI LƯỢNG: `waitingCount() >= 12` KHÔNG BAO GIỜ ĐÚNG.
 * Lô 13:25 và 13:31 (bản 1.92.53): `Ext dò` = 4 suốt cả hai lô (đúng sàn) dù 138/136 ca phải dò.
 * Lý do: làn 4 chỗ chỉ giữ được ≤4 lượt xếp hàng ⇒ waitingCount không thể tới 12.
 * Nay đếm TỒN ĐỌNG THẬT: `gidStats.unknown − rampAtUnknown`. */
check('[v1.92.54] đường hồi đếm TỒN ĐỌNG THẬT (không dùng waitingCount — đại lượng sai)',
  /backlogNoGid >= 12/.test(SRC) && /gidStats\.unknown \|\| 0\) - \(gidExtCtl\.rampAtUnknown/.test(SRC), true);
check('[v1.92.54] KHÔNG còn điều kiện waitingCount() >= 12 trong đường hồi',
  /gidExtLane\.waitingCount\(\) >= 12/.test(SRC), false);
check('đường hồi chỉ chạy sau ≥2 lần đã co (không nới khi làn còn khoẻ)',
  /\(gidExtCtl\.cooldowns \|\| 0\) >= 2 && backlogNoGid >= 12/.test(SRC), true);
check('[v1.92.54] trần đường hồi VẪN 12 (thấp hơn khởi điểm 20 ⇒ không mở vùng vận hành mới)',
  /const GID_EXT_QUEUE_RAMP_CAP = 12;/.test(SRC), true);
check('[v1.92.54] in ĐỈNH làn dò để lô sau kiểm được đường hồi có chạy thật',
  /' \(đỉnh ' \+ gidExtPeak/.test(SRC), true);
/* rampAtUnknown PHẢI khai báo = 0: nếu undefined thì (unknown - undefined) = NaN ⇒ >= 12 luôn false
 * ⇒ đường hồi chết y như 1.92.52. Đây là lỗi "số ảo" đúng loại đang sửa nên phải khoá riêng. */
check('[v1.92.54] rampAtUnknown khai báo tường minh = 0 (không để undefined ⇒ NaN)',
  /rampAtUnknown: 0 \}/.test(SRC), true);
check('[v1.92.54] mốc rampAtUnknown được cập nhật sau mỗi lần nới làn',
  /gidExtCtl\.rampAtUnknown = gidStats\.unknown \|\| 0;/.test(SRC), true);
check('[v1.92.54] dùng ?? hoặc || cho rampAtUnknown để không thể ra NaN',
  /\(gidStats\.unknown \|\| 0\) - \(gidExtCtl\.rampAtUnknown \|\| 0\)/.test(SRC), true);

/* (12) CHÚ THÍCH SAI VỀ BIND ẢNH PHẢI ĐƯỢC SỬA (nó từng gây kết luận sai).
 * Lô 12:24: 📷 8 186 ca · TB 842 ms; giữ slot 5 741 ms/chat vs 1 362 ms/chat ở lô KHÔNG ảnh. */
check('chú thích fast-path KHÔNG còn nói "BỎ QUA HOÀN TOÀN extPrepLane" cho trường hợp có ảnh',
  /BỎ QUA HOÀN TOÀN extPrepLane!/.test(SRC), false);
check('có ghi rõ bind ảnh nằm TRONG slot và số đo 842 / 5 741',
  /842\/5 741|842 \/ 5 741|842ms/.test(SRC) || /842/.test(SRC), true);

/* ------------- [v1.92.53] BA VÁ TỪ LÔ 8 509: ĐO THẬT THAY VÌ ĐOÁN ------------- */

/* (13) `windowClosed` PHẢI ĐƯỢC GÁN TỪ CHUỖI LỖI CUỐI.
 * Bằng chứng: lô 12:24 có 375 ca ❌ "(#10) ngoài 24h" + 167 ca ❌ "(#551) không có mặt"
 * nhưng TỔNG HỢP in "🚫 1 lần" ⇒ hai chỗ đọc `r.windowClosed` (7309, 10948) chưa từng
 * thấy giá trị true vì trước bản này KHÔNG nơi nào gán nó. */
check('windowClosed được gán trong kết quả cuối của sendOne',
  /windowClosed: isWindowClosedError\(tried\.join\(' \| '\)\)/.test(SRC), true);
check('KHÔNG còn chỗ đọc r.windowClosed mà không có nguồn gán',
  (SRC.match(/windowClosed/g) || []).length >= 3, true);

/* (14) "CHỜ SLOT" PHẢI ĐO ĐÚNG CHỖ (chỉ đếm ca thật sự phải xếp hàng).
 * Lô 12:24 in `chờ 662 ms/chat` nhưng `releaseMainSlot()` chuyền slot TRỰC TIẾP cho người
 * chờ kế (shift → resolve(true), inFlightMainCount không đổi) ⇒ ca được chuyền không có ms. */
check('đo số ca PHẢI CHỜ slot (slotAcqN) tách khỏi tổng thời gian chờ',
  /if \(_w > 0\) \{[^}]*waveDiag\.slotAcqN\+\+; waveDiag\.slotAcqPosMs \+= _w;/.test(SRC), true);
check('có in "phải chờ slot" kèm số ca (0 ca nghĩa là số "chờ 662" cũ là số ảo)',
  /' · phải chờ slot ' \+ \(waveDiag\.slotAcqN/.test(SRC), true);

/* (15) XẺ "CÒN LẠI" — phải đo được dò gid + chuẩn bị ctx, không tính trùng bind ảnh.
 * Số học lô 12:24: 192 slot × 260,5 s = 50 016 slot-giây ÷ 8 509 chat = SÀN 5 879 ms/chat,
 * nhưng log in 5 741 ⇒ "chờ" nằm TRONG "còn lại" chứ không cộng thêm. Muốn biết 4 237 ms
 * còn lại là gì thì phải có số của khâu dò gid. */
check('đo riêng khâu dò global_id (prepGidMs)',
  /waveDiag\.prepGidN\+\+; waveDiag\.prepGidMs \+= _g;/.test(SRC), true);
check('[v1.92.54] tách LƯỢT DÒ 1 / LƯỢT DÒ 2 (13 475ms vượt mọi hạn chờ đơn lẻ ⇒ phải 2 lượt)',
  /waveDiag\.prepGidP2N\+\+; waveDiag\.prepGidP2Ms \+= _g;/.test(SRC)
  && /waveDiag\.prepGidP1N\+\+; waveDiag\.prepGidP1Ms \+= _g;/.test(SRC), true);
check('[v1.92.54] in lượt 1 / lượt 2 trong dòng GIỮ SLOT',
  /' \(lượt 1: ' \+ waveDiag\.prepGidP1N/.test(SRC), true);
check('đo riêng khâu bind ảnh trong prepareDirectCtx (prepBindMs)',
  /waveDiag\.prepBindN\+\+; waveDiag\.prepBindMs \+= _b/.test(SRC), true);
check('"chuẩn bị ctx" trừ bind ra để không đếm 2 lần',
  /Math\.max\(0, waveDiag\.slotPrepMs - waveDiag\.prepBindMs\) \/ waveDiag\.slotN/.test(SRC), true);
check('có in "dò gid" trong dòng GIỮ SLOT',
  /' · dò gid ' \+ \(waveDiag\.prepGidN/.test(SRC), true);

/* ------------- [v1.92.55] SỬA NHỮNG GÌ ĐÃ CÓ BẰNG CHỨNG TỪ LÔ 12 410 CHAT ------------- */

/* (16) `đỉnh 0` KHI LÀN ĐANG 10 LÀ BẤT KHẢ ⇒ gidExtPeak phải ghi ở MỌI chỗ đổi làn.
 * Lô 14:03 in `Ext dò 10 (đỉnh 0)`: làn giảm 20→14→10 (do co ×0,7 hai lần) mà đỉnh vẫn 0
 * vì trước bản này chỉ gán trong nhánh NỚI (chưa từng chạy). */
check('[v1.92.55] gidExtPeak ghi cả ở nhánh CO ×0,7 (nếu không sẽ in đỉnh ảo = 0)',
  /gidExtLane\.setLimit\(gidExtLane\.getLimit\(\) \* 0\.7\);\s*\n\s*try \{ gidExtPeak = Math\.max/.test(SRC), true);
check('[v1.92.55] gidExtPeak ghi cả ở nhánh nới AIMD thường (+2/10 lần)',
  /setLimit\(gidExtLane\.getLimit\(\) \+ 2\);\s*\n\s*try \{ gidExtPeak = Math\.max/.test(SRC), true);
check('[v1.92.55] đỉnh in ra KHÔNG thể nhỏ hơn làn đang chạy (kiểm bằng công thức gán)',
  (SRC.match(/gidExtPeak = Math\.max\(gidExtPeak, gidExtLane\.getLimit\(\)\)/g) || []).length >= 3, true);

/* (17) NHÁNH "CHỜ VIỆC XONG" CỦA CỔNG PHẢI CÓ SỐ.
 * Lô 14:03: wave 24 giữ cổng 25 013 ms với `main đang bay 0`; cứng/mềm/tiến độ đều 0
 * ⇒ 3 số cũ KHÔNG giải thích được. Khi không còn worker thì cũng không ai xếp hàng chờ slot. */
check('[v1.92.55] đếm số lượt cổng bị giữ chỉ vì chưa xong việc (gateWaitDone)',
  /waveDiag\.gateWaitDone\+\+;/.test(SRC), true);
check('[v1.92.55] đếm số lượt thấy `main đang bay 0` mà cổng vẫn giữ (gateNoWorkerSeen)',
  /if \(inFlightMainCount <= 0\) waveDiag\.gateNoWorkerSeen\+\+;/.test(SRC), true);
check('[v1.92.55] đo đỉnh số ca treo trong sổ chờ xác nhận (gateBgPendingMax)',
  /gateBgPendingMax = _bgN/.test(SRC) && /function pendingBgCount\(\)/.test(SRC), true);
check('[v1.92.55] in "chờ việc xong" ra dòng WAVE',
  /' · chờ việc xong: ' \+ waveDiag\.gateWaitDone/.test(SRC), true);
check('[v1.92.55] số đo cổng nằm SAU khối chặn, TRƯỚC nhánh mở (không đổi nhánh mở nào)',
  SRC.indexOf('gateWaitDone++') > SRC.indexOf('waveDiag.gateBlockApi++')
  && SRC.indexOf('gateWaitDone++') < SRC.indexOf('if (waveDoneCount >= waveSlice.length) { openGate(); return; }'), true);

/* (18) "Socket bị né (ACK chết)" GỌI SAI TÊN CƠ CHẾ.
 * Lô 14:03: né 3 952 nhưng `hết hạn chờ 1 246` và `im lặng THẬT 0`. Cơ chế ACK-chết đòi 5 lần
 * im lặng thật liên tiếp ⇒ không chạy. Thủ phạm là `st.lost >= 2` (chứng minh MẤT TIN). */
check('[v1.92.55] tách Socket bị né thành 2 lý do (mất tin · ACK chết)',
  /skipLost: 0, skipAckDead: 0 \}/.test(SRC), true);
/* [v1.92.62] Luật đếm ĐÃ ĐỔI: nguồn là `socketSkipReason()` (tách lostSock khỏi absent/lostExt),
 * không còn đọc trực tiếp `_st.lost` — chính `_st.lost` cũ là thứ bị cộng oan. */
check('[v1.92.62] đếm lý do né Socket qua socketSkipReason (không đọc _st.lost trực tiếp)',
  /const _why = socketSkipReason\(pageId\);/.test(stripComments(SRC)), true);
checkNot('[v1.92.62] không còn cộng oan: Socket bị né không dựa vào _st.lost',
  stripComments(SRC), /_st\.lost >= 2/);
check('[v1.92.55] nhãn log KHÔNG còn gọi tất cả là "ACK chết"',
  /' \/ Socket bị né \(ACK chết\) '/.test(SRC), false);
check('[v1.92.55] nhãn mới có cả "mất tin" và "ACK chết"',
  /Socket bị né \(mất tin ' \+ socketPickDiag\.skipLost/.test(SRC), true);

/* ================= [v1.92.56] CHỐNG O(N²) TRONG ĐƯỜNG NÓNG =================
 * Ba sổ "đang chờ kiểm chứng" giữ MỌI chat chưa xong. Mỗi lần một chat chốt,
 * `getBatchSummaryCounts()` chạy để vẽ TỔNG HỢP. Bản 1.92.55 quét cả 3 sổ ở đó:
 *     Object.keys(sockVerifyPending).filter(...)          (×3)
 * Đo với lô 12 410 chat: 9 946 ms CPU. Và vì nó KHÔNG đọc DOM, ẩn danh sách cũng
 * không bớt được gì — đúng hiện tượng người dùng báo "ẩn danh sách vẫn lag".
 * Nay: 3 biến đếm O(1). Test dưới đây khoá lại để không ai vô tình quay về. */

{
  const fn = extractFn('getBatchSummaryCounts');
  checkNot('[v1.92.56] getBatchSummaryCounts KHÔNG quét sổ kiểm chứng',
    fn, /Object\.keys\(\s*(sockVerifyPending|extVerifyPending|uncertainVerifyPending)/);
  check('[v1.92.56] getBatchSummaryCounts đọc bộ đếm O(1)',
    /verifyPendingCount\.sock/.test(fn) && /verifyPendingCount\.ext/.test(fn) && /verifyPendingCount\.uncertain/.test(fn), true);
}

// 6 hàm đi qua bộ đếm phải tồn tại và tăng/giảm đúng chiều
{
  const markSock = extractFn('markSockVerify');
  const clearSock = extractFn('clearSockVerify');
  check('[v1.92.56] markSockVerify TĂNG bộ đếm', /verifyPendingCount\.sock\+\+/.test(markSock), true);
  check('[v1.92.56] clearSockVerify GIẢM bộ đếm', /verifyPendingCount\.sock--/.test(clearSock), true);
  check('[v1.92.56] clearXxx không xuống dưới 0', /> 0\) verifyPendingCount\.sock--/.test(clearSock), true);

  const markExt = extractFn('markExtVerify');
  check('[v1.92.56] markExtVerify: lần ĐỌC LẠI không cộng vào "đang chờ"',
    /if \(!recheck\) verifyPendingCount\.ext\+\+/.test(markExt), true);

  const resetFn = extractFn('resetVerifyPending');
  check('[v1.92.56] resetVerifyPending đặt lại CẢ 3 bộ đếm về 0',
    /verifyPendingCount\.sock = 0/.test(resetFn)
    && /verifyPendingCount\.ext = 0/.test(resetFn)
    && /verifyPendingCount\.uncertain = 0/.test(resetFn), true);
  check('[v1.92.56] resetVerifyPending xoá cả 4 sổ',
    /sockVerifyPending/.test(resetFn) && /extVerifyPending/.test(resetFn)
    && /extRecheckPending/.test(resetFn) && /uncertainVerifyPending/.test(resetFn), true);
}

// Mọi chỗ GHI/XOÁ 3 sổ phải đi qua hàm — nếu không, bộ đếm sẽ lệch khỏi thực tế.
{
  const body = SRC.slice(SRC.indexOf('const verifyPendingCount'),
    SRC.indexOf('function getBatchSummaryCounts'));
  const directWrites = (body.match(/(sockVerifyPending|extVerifyPending|uncertainVerifyPending)\[/g) || []).length;
  /* Trong khối định nghĩa 6 hàm + reset: mỗi sổ được ghi/xoá đúng 1 lần trong hàm của nó,
   * cộng resetVerifyPending dùng Object.keys. Con số dưới đây là mức trần hợp lý. */
  check('[v1.92.56] số chỗ đụng trực tiếp 3 sổ nằm gọn trong 6 hàm + reset (≤ 12)',
    directWrites <= 12, true);

  /* Kiểm chặt: MỌI chỗ ghi/xoá trực tiếp 3 sổ phải nằm TRONG khối bộ đếm
   * (từ `const verifyPendingCount` tới hết `resetVerifyPending`).
   *
   * Bản đầu của test này chỉ quét phần SAU `getBatchSummaryCounts` — nên khi tôi
   * mutation-test bằng cách thay `markSockVerify(conv.id)` (nằm TRƯỚC mốc đó) bằng
   * `sockVerifyPending[conv.id] = runSeq`, test KHÔNG bắt được. Nay xét cả hai phía. */
  const blockStart = SRC.indexOf('const verifyPendingCount');
  const blockEnd = SRC.indexOf('function getBatchSummaryCounts');
  const outside = SRC.slice(0, blockStart) + SRC.slice(blockEnd);
  checkNot('[v1.92.56] ngoài khối bộ đếm không ghi sockVerifyPending',
    outside, /sockVerifyPending\[[^\]]+\]\s*=/);
  checkNot('[v1.92.56] ngoài khối bộ đếm không xoá sockVerifyPending',
    outside, /delete sockVerifyPending\[/);
  checkNot('[v1.92.56] ngoài khối bộ đếm không ghi extVerifyPending',
    outside, /(?<!Recheck)extVerifyPending\[[^\]]+\]\s*=/);
  checkNot('[v1.92.56] ngoài khối bộ đếm không xoá extVerifyPending',
    outside, /delete extVerifyPending\[/);
  checkNot('[v1.92.56] ngoài khối bộ đếm không ghi uncertainVerifyPending',
    outside, /uncertainVerifyPending\[[^\]]+\]\s*=/);
  checkNot('[v1.92.56] ngoài khối bộ đếm không xoá uncertainVerifyPending',
    outside, /delete uncertainVerifyPending\[/);
  /* Và trong toàn file: số chỗ ghi trực tiếp 3 sổ phải bằng đúng số trong 6 hàm (3 ghi + 3 xoá
   * = 6 kèm `delete`, cộng reset dùng Object.keys nên không tính). */
  const allDirect = (SRC.match(/(sockVerifyPending|extVerifyPending|uncertainVerifyPending)\[[^\]]+\]\s*=/g) || []).length;
  /* Chỉ 2: markSockVerify và markUncertainVerify ghi trực tiếp; markExtVerify ghi qua
   * biến  (dùng chung cho extVerifyPending / extRecheckPending) nên không khớp mẫu. */
  check('[v1.92.56] toàn file chỉ còn 2 chỗ ghi trực tiếp (trong markSockVerify/markUncertainVerify)', allDirect, 2);
}

// Sổ kiểm chứng phải được đặt lại đầu mỗi lượt (đi kèm runSeq++)
{
  const i = SRC.indexOf('runSeq++;');
  const around = SRC.slice(i, i + 700);
  check('[v1.92.56] đầu mỗi lượt gọi resetVerifyPending()', /resetVerifyPending\(\)/.test(around), true);
}

// #2: reportExtJob không được tính lại tổng hợp khi người gọi đã truyền `pending`
{
  const fn = extractFn('reportExtJob');
  check('[v1.92.56] reportExtJob dùng extra.pending khi có',
    /typeof extra\.pending === 'number'/.test(fn), true);
  const setProg = extractFn('setProgress');
  check('[v1.92.56] setProgress nhận thêm pendingCount', /function setProgress\(done, total, ok, pendingCount\)/.test(setProg), true);
  check('[v1.92.56] flushBatchSummaryUI truyền c.pending xuống setProgress',
    /setProgress\(c\.settled, c\.total, c\.okTotal, c\.pending\)/.test(SRC), true);
}

// #3: đếm danh sách gửi tay MỘT lượt duyệt, không 4 lượt
{
  const fn = extractFn('countResendSplit');
  check('[v1.92.56] có countResendSplit (1 lượt duyệt trả cả 2 số)',
    /return \{ rescuing: rescuing, waiting: manualResendList\.length - rescuing \}/.test(fn), true);
  const cr = extractFn('countRescuing');
  const cm = extractFn('countManualResendWait');
  checkNot('[v1.92.56] countRescuing không tự duyệt nữa', cr, /for \(let i = 0; i < manualResendList\.length/);
  checkNot('[v1.92.56] countManualResendWait không tự duyệt nữa', cm, /for \(let i = 0; i < manualResendList\.length/);
  // chỗ dựng TỔNG HỢP chỉ gọi countResendSplit 1 lần
  const callsInSummary = (SRC.match(/countResendSplit\(\)/g) || []).length;
  check('[v1.92.56] countResendSplit được gọi 1 lần khi dựng TỔNG HỢP (ngoài 2 hàm bao)',
    callsInSummary >= 1 && callsInSummary <= 4, true);
}


/* ══════════════════════════════════════════════════════════════════════════════
 * [v1.92.57] KHOÁ 4 LỖI HIỆU NĂNG ĐO ĐƯỢC (Chromium 153, tools/_bench_ab.mjs)
 * A/B 4 lượt: main thread bận 18,3–19,4% → 8,6–9,3% · long task 508–641 ms → 260–291 ms
 * ══════════════════════════════════════════════════════════════════════════════ */
{
  /* 1) preloadPersistentGlobalIds KHÔNG được duyệt lại toàn bộ cache mỗi lần gọi.
   *    warmUpSockets() gọi hàm này MỖI LẦN chọn chat/chuỗi ⇒ 60 000 khoá = 15 ms/lần. */
  {
    const src = extractFn('preloadPersistentGlobalIds');
    check('[v1.92.57] preloadPersistentGlobalIds có cờ đã nạp (gidMemPrimed)',
      /gidMemPrimed/.test(src), true);
    check('[v1.92.57] preloadPersistentGlobalIds chỉ đổ cache ở lần đầu',
      /if \(!gidMemPrimed\)[\s\S]*gidMemPrimed = true/.test(src), true);
    checkNot('[v1.92.57] preloadPersistentGlobalIds không còn for..in đối chiếu mỗi lần gọi',
      src, /for \(const k in persistentGidMap\)/);
    const wu = extractFn('warmUpSockets');
    check('[v1.92.57] warmUpSockets vẫn nạp cache gid', /preloadPersistentGlobalIds\(\)/.test(wu), true);
  }

  /* 2) flushPersistentGids phải HẸN qua scheduleGidFlush có khoảng cách tối thiểu. */
  {
    const iSave = SRC.indexOf('window.__botfakeSaveGid__ = function');
    const save = SRC.slice(iSave, iSave + 1200);
    checkNot('[v1.92.57] __botfakeSaveGid__ không ghi localStorage đồng bộ',
      save, /setItem\(\s*GID_LS_KEY/);
    check('[v1.92.57] __botfakeSaveGid__ hẹn ghi qua scheduleGidFlush',
      /scheduleGidFlush\(\)/.test(save), true);
    /* ĐIỀU KIỆN SỐNG CÒN: phải có mốc 1 500 ms. Bản nháp đầu chỉ đẩy sang requestIdleCallback
     * mà không giữ khoảng cách ⇒ ghi DÀY hơn bản cũ, CPU flushPersistentGids 12,6% → 31,2%.
     * PHẢI bỏ chú thích trước khi khớp: bản đầu của test này khớp `1500` ngay trong lời chú
     * thích nên mutation "đổi thành }, 0)" vẫn XANH — test rỗng. */
    const sch = stripComments(extractFn('scheduleGidFlush'));
    check('[v1.92.57] scheduleGidFlush giữ khoảng cách tối thiểu 1 500 ms (trong CODE, không phải chú thích)',
      /1500/.test(sch), true);
    check('[v1.92.57] KHÔNG đặt timer 0 ms cho flush', /\},\s*0\)/.test(sch), false);
    check('[v1.92.57] flush vẫn ghi đủ map (không mất dữ liệu)',
      /JSON\.stringify\(persistentGidMap\)/.test(extractFn('flushPersistentGids')), true);
  }

  /* 3) logLine khi KHÔNG có panel: không stringify cả bộ log cho từng dòng. */
  {
    /* Bỏ chú thích: lời chú thích của chính tôi CÓ nhắc `setItem(LOG_KEY, ...)` nên bản đầu
     * của test khớp nhầm chú thích và mutation "trả lại stringify" vẫn XANH. */
    const ll = stripComments(extractFn('logLine'));
    checkNot('[v1.92.57] logLine không stringify state.log mỗi dòng khi thiếu panel (CODE)',
      ll, /setItem\(\s*LOG_KEY/);
    check('[v1.92.57] logLine dùng scheduleLogStorageSave khi thiếu panel',
      /scheduleLogStorageSave\(\)/.test(ll), true);
  }

  /* 4) logAll: không shift() trên mảng 60 000 mỗi dòng — cắt lô theo ngưỡng 2×. */
  {
    checkNot('[v1.92.57] không còn logAll.shift()', SRC, /logAll\.shift\(\)/);
    check('[v1.92.57] logAll cắt lô tại 2× LOG_ALL_MAX',
      /logAll\.length > LOG_ALL_MAX \* 2\)\s*logAll\.splice/.test(SRC), true);
    check('[v1.92.57] có hằng LOG_ALL_MAX', /LOG_ALL_MAX\s*=\s*\d+/.test(SRC), true);
  }
}


/* ══════════════════════════════════════════════════════════════════════════════
 * [v1.92.58] KHOÁ 3 SỬA CỦA CA "GIỮ ALT CHỌN 1 CON LÀ KHỰNG"
 * Profiler Chromium 153 (tools/_bench_click.mjs) chỉ đường gọi trong khung hình cú click:
 *   onDocClick → setRangeStart/completeRange → computeMatches → getReduxConversationListRows
 *     → visibleRows → rowInfo → querySelector   (đọc DOM 2 lần, dựng lại cả danh sách)
 *   onDocClick → setRangeStart → computeMatches → highlightRows → rowInfo (5 querySelector/dòng)
 * ══════════════════════════════════════════════════════════════════════════════ */
{
  /* 1) getReduxConversationListRows: phần đắt (convApiRow + cache gid) chỉ tính lại khi
   *    mảng Redux ĐỔI — không dựng lại cả nghìn-hàng chục nghìn dòng mỗi cú click. */
  {
    const g = stripComments(extractFn('getReduxConversationListRows'));
    check('[v1.92.58] getReduxConversationListRows có cache theo tham chiếu mảng Redux',
      /raw !== reduxRowsBaseRef/.test(g) && /reduxRowsBase = base/.test(g), true);
    check('[v1.92.58] convApiRow chỉ chạy trong nhánh cache-miss',
      g.indexOf('convApiRow(') > g.indexOf('raw !== reduxRowsBaseRef'), true);
    check('[v1.92.58] chỉ nhân bản dòng ĐANG có trên màn hình (visRows nhỏ)',
      /visRows\.length/.test(g) && /out = reduxRowsBase\.slice\(\)/.test(g), true);
  }

  /* 2) sourceRows: đọc visibleRows() MỘT lần rồi truyền xuống (bản cũ đọc 2 lần). */
  {
    const sr = stripComments(extractFn('sourceRows'));
    const visCalls = (sr.match(/visibleRows\(\)/g) || []).length;
    check('[v1.92.58] sourceRows chỉ gọi visibleRows() 1 lần', visCalls, 1);
    check('[v1.92.58] sourceRows truyền kết quả xuống getReduxConversationListRows',
      /getReduxConversationListRows\(visRaw\)/.test(sr), true);
  }

  /* 2b) syncSocketMappingsToCache: phần sao chép map → cache RAM KHÔNG được chạy đồng bộ
   *     trong cú click; phải chia lô + hẹn setTimeout, và có mốc giãn cách 3 s. */
  {
    const ss = stripComments(extractFn('syncSocketMappingsToCache'));
    checkNot('[v1.92.58] syncSocketMappingsToCache không còn Object.keys(mp).forEach chạy đồng bộ',
      ss, /Object\.keys\(mp\)\.forEach/);
    check('[v1.92.58] syncSocketMappingsToCache chia lô (CHUNK) và hẹn setTimeout',
      /CHUNK/.test(ss) && /setTimeout\(\s*step\s*,\s*0\s*\)/.test(ss), true);
    /* Sống còn: vòng sao chép phải được HẸN, không chạy đồng bộ trong cú click.
     * Bản đầu của test chỉ kiểm "có setTimeout(step,0) ở đâu đó" nên mutation thêm step()
     * gọi thẳng vẫn XANH. Nay: sau `const step = () => {` KHÔNG được có `step();` trần. */
    checkNot('[v1.92.58] syncSocketMappingsToCache không gọi step() đồng bộ',
      ss, /\};\s*\n\s*step\(\);/);
    check('[v1.92.58] syncSocketMappingsToCache giãn cách ≥ 3 000 ms giữa hai lần sao chép',
      /3000/.test(ss), true);
    check('[v1.92.58] bỏ qua khoá đã có đúng giá trị (không ghi lại vô ích)',
      /persistentGidMap\[key\] === sv/.test(ss), true);
  }

  /* 3) highlightRows: dùng id rẻ thay vì rowInfo (5 querySelector/dòng), và GIỮ ĐÚNG màu cũ:
   *    mark chỉ phụ thuộc id của rangeStart/rangeEnd/target (đúng như markOf(rowInfo(...)) cũ). */
  {
    const h = stripComments(extractFn('highlightRows'));
    /* stripComments đã bỏ chú thích — bản đầu của test này khớp chính lời chú thích "...KHÔNG
     * ĐƯỢC GỌI rowInfo()" nên mutation "thêm rowInfo(item)" vẫn XANH. Lần thứ 3 mắc bẫy này. */
    checkNot('[v1.92.58] highlightRows KHÔNG gọi rowInfo (5 querySelector/dòng)', h, /rowInfo\s*\(/);
    check('[v1.92.58] highlightRows tra id qua item.id (không đọc DOM sâu)',
      /idOfItem/.test(h) && /String\(item\.id \|\| ''\)/.test(h), true);
    check('[v1.92.58] highlightRows có dự phòng lấy id từ div[id] cha',
      /closest\('div\[id\]'\)/.test(h), true);
    check('[v1.92.58] màu target theo id của target/rangeStart/rangeEnd (như markOf cũ)',
      /markIds/.test(h) && /state\.rangeStart/.test(h) && /state\.rangeEnd/.test(h), true);
  }

  /* ══════════════════════════════════════════════════════════════════════════════════════
   * [v1.92.59] CA "LAG CHỈ KHI MỞ GIAO DIỆN SCRIPT" — khoá đúng 3 dòng gây khựng.
   * Đo được (tools/_bench_click.mjs, panel MỞ, log 1 500 dòng, 20 000 thread):
   *   bản 1.92.58: cú Alt-click 1 768 / 2 208 ms, CPU bận 90,9–94,8 %
   *   bản 1.92.59: cú Alt-click    16 ms,          CPU bận 12,8–13,9 %
   * (panel ĐÓNG: 0 ms ở cả hai bản ⇒ lỗi nằm ở đường VẼ panel, không phải đường tính.)
   * ══════════════════════════════════════════════════════════════════════════════════════ */
  {
    const r = stripComments(extractFn('render'));
    /* 1) render() KHÔNG được dựng lại text của log. Mỗi lần render là gán ~1 500 dòng rồi
     * ĐỌC scrollHeight ⇒ ép layout toàn trang; đo 547–581 ms cho MỘT lần đọc.
     * Test này bắt buộc phải chạy trên `stripComments` — bản đầu (nếu quên) sẽ khớp chính
     * lời chú thích giải thích lỗi và luôn XANH. */
    checkNot('[v1.92.59] render() không gán textContent cho log', r, /getElementById\('ssb-log'\)/);
    check('[v1.92.59] render() vẫn tô lại màu danh sách', /scheduleHighlight\(\)/.test(r), true);

    const f = stripComments(extractFn('flushLogUI'));
    /* 2) KHÔNG đọc scrollHeight/clientHeight trong flushLogUI.
     * Chỗ đọc layout là thứ đắt nhất: đo 547,40 ms (scrollTop = scrollHeight) và 581,00 ms
     * (đọc scrollHeight/scrollTop/clientHeight) trên trang có panel + 1 500 node app. */
    checkNot('[v1.92.59] flushLogUI không đọc scrollHeight (ép layout toàn trang)', f, /scrollHeight/);
    checkNot('[v1.92.59] flushLogUI không đọc clientHeight', f, /clientHeight/);
    checkNot('[v1.92.59] flushLogUI không gọi logNearBottom', f, /logNearBottom\s*\(/);
    /* 3) CHẠY THẬT flushLogUI trên DOM giả — không chỉ khớp tên biến.
     * Lần đầu tôi chỉ kiểm "/LOG_PAINT_MAX/.test(f)" nên mutation đổi 200 → 1 500 LỌT;
     * và "/logRenderedSig/" nên mutation bỏ chống trùng (`if (true)`) cũng LỌT. */
    {
      /* ĐỌC HẰNG SỐ THẬT từ mã — lần đầu tôi truyền cứng 200 nên mutation 200→1 500 LỌT
       * (test không hề kiểm giá trị trong mã, chỉ kiểm giá trị tôi tự bơm vào). */
      const mMax = /const LOG_PAINT_MAX = (\d+);/.exec(SRC);
      check('[v1.92.59] có hằng LOG_PAINT_MAX trong mã', !!mMax, true);
      const PAINT = mMax ? Number(mMax[1]) : 1500;
      check('[v1.92.59] LOG_PAINT_MAX ≤ 300 dòng (vẽ 1 500 dòng = 56–600 ms/lần)', PAINT <= 300, true);

      const body = f;
      const el = { textContent: '', scrollTop: 0, addEventListener() {} };
      const mk = (n) => {
        const log = [];
        for (let i = 0; i < n; i++) log.push('DONG ' + i);
        const state = { log };
        const stats = { writes: 0 };
        const shadow = { getElementById: (id) => (id === 'ssb-log' ? el : null) };
        const fn = new Function('state', 'shadow', 'logAll', 'scheduleLogStorageSave',
          'requestAnimationFrame', 'userSelectingNow', 'setTimeout', 'LOG_PAINT_MAX',
          'bindLogScrollWatcher', 'logSignature', 'logStickBottom', 'logRenderedSig',
          'logSigScrolled', 'logPaintDeferTimer', 'logWindowOpen',
          body.replace(/^function flushLogUI\(forceBottom\) \{/, 'return function (forceBottom) {')
            .replace(/\}$/, '};'));
        const env = { open: true }; // gia lập: cửa sổ phóng to ĐANG mở / ĐANG đóng
        const run = fn(state, shadow, log, () => {}, (cb) => cb(), () => false, () => 0, PAINT,
          () => {}, () => state.log.length + '|' + (state.log.length ? state.log[state.log.length - 1] : ''),
          true, '', '', null, () => env.open);
        // đếm số lần GHI textContent
        let txt = el.textContent;
        Object.defineProperty(el, 'textContent', {
          get: () => txt, set: (v) => { stats.writes++; txt = v; }, configurable: true,
        });
        return { run, stats, state, env, get text() { return txt; } };
      };
      const A = mk(1500);
      /* ═══ [v1.92.60] ĐÓNG CỬA SỔ LOG ⇒ KHÔNG VẼ GÌ. Người dùng yêu cầu "bỏ luôn hiển thị log
       * khi mở giao diện, chỉ cần xem log khi ấn nút phóng to". Nếu cờ này sai, mọi sửa về sau
       * đều vô nghĩa: panel lại phải vẽ chữ mỗi lần có dòng log. */
      A.env.open = false;
      A.run(false);
      check('[v1.92.60] log ĐÓNG ⇒ KHÔNG ghi textContent', A.stats.writes, 0);
      A.env.open = true;
      A.run(false);
      const painted = A.text.split('\n').length;
      check(`[v1.92.59] flushLogUI vẽ ≤ ${PAINT}+2 dòng (phần đuôi + dòng báo cắt)`,
        painted <= PAINT + 2, true);
      check('[v1.92.59] flushLogUI vẫn vẽ ĐÚNG dòng cuối cùng', /DONG 1499$/.test(A.text), true);
      check('[v1.92.59] flushLogUI báo rõ đã cắt bao nhiêu dòng', /1[0-9]{3} dòng trước/.test(A.text), true);
      /* Chống trùng: nội dung không đổi ⇒ KHÔNG ghi lại textContent. */
      A.run(false);
      check('[v1.92.59] nội dung không đổi ⇒ không ghi lại textContent', A.stats.writes, 1);
      /* Có dòng mới ⇒ ghi lại đúng 1 lần nữa. */
      A.state.log.push('DONG MOI');
      A.run(false);
      check('[v1.92.59] có dòng mới ⇒ ghi lại 1 lần', A.stats.writes, 2);
    }
    check('[v1.92.59] flushLogUI hoãn vẽ khi người dùng đang giữ Alt chọn', /userSelectingNow\(\)/.test(f), true);
    check('[v1.92.59] cuộn đáy bằng scrollTop = 1e9 (ghi số, không đọc layout)', /scrollTop\s*=\s*1e9/.test(f), true);

    /* 4) logLine KHÔNG vẽ ngay từng dòng — phải gộp nhịp. */
    const l = stripComments(extractFn('logLine'));
    checkNot('[v1.92.59] logLine không gọi flushLogUI() đồng bộ từng dòng', l, /\n\s*flushLogUI\(\);/);
    check('[v1.92.59] logLine gộp nhịp vẽ 200 ms', /setTimeout\(flushLogUI,\s*200\)/.test(l), true);
  }

  /* ══════════════════════════════════════════════════════════════════════════════════════
   * [v1.92.60] "BỎ LUÔN HIỂN THỊ LOG KHI MỞ GIAO DIỆN — chỉ xem khi bấm Phóng to"
   * + "khi đóng log thì hiện tiến trình trên hình thu nhỏ: số gửi thành công/tổng số".
   * Đo sau khi sửa (tools/_bench_click.mjs, panel MỞ, log 1 500 dòng):
   *   1.92.58: 1 624 / 2 424 ms, CPU 91,7–94 %  →  1.92.60: 16 ms, CPU 4,7 %.
   * ══════════════════════════════════════════════════════════════════════════════════════ */
  {
    /* 1) Khung log KHÔNG được nằm trong panel — phải bị ẩn, chỉ hiện trong cửa sổ phóng to. */
    check('[v1.92.60] khung log nằm trong #ssb-logwrap ẩn (display:none)',
      /id="ssb-logwrap" style="display:none"/.test(SRC), true);
    checkNot('[v1.92.60] panel không còn khung log hiện ngay sau bảng tổng hợp',
      SRC, /<div class="summary-box" id="ssb-summary"><\/div>\s*<div class="log"/);

    const lw = stripComments(extractFn('logWindowOpen'));
    check('[v1.92.60] logWindowOpen chỉ đúng khi CỬA SỔ LOG đang mở',
      /floatWins\.ssb_win_log/.test(lw), true);

    const f60 = stripComments(extractFn('flushLogUI'));
    check('[v1.92.60] flushLogUI thoát NGAY khi cửa sổ log đóng',
      /if \(!logWindowOpen\(\)\) return;/.test(f60), true);

    /* 2) [v1.92.61] Số tiến trình chỉ nằm trên BADGE BÓNG LOGO (panel thu nhỏ). Trong panel
     *    KHÔNG có dải tiến trình nào thêm — thanh #ssb-bar/#ssb-progstat dưới nút Chạy vẫn là
     *    nơi hiện tiến trình như trước. Ô log bỏ trống cho gọn. */
    const mini = stripComments(extractFn('updateMiniProgressUI'));
    check('[v1.92.61] updateMiniProgressUI chỉ ghi vào badge bóng logo',
      /ssb-bubble-badge/.test(mini) && !/ssb-mini\b/.test(mini), true);
    check('[v1.92.61] badge hiện "ok/total" (số gửi thành công / tổng số)',
      /\(ok \+ '\/' \+ total\)/.test(mini), true);
    check('[v1.92.61] chưa gửi lô nào ⇒ badge hiện số chat đang chọn',
      /chosen \+ ' chat'/.test(mini), true);
    check('[v1.92.61] badge KHÔNG ghi DOM khi số không đổi (chữ ký)',
      /if \(sig === miniPainted\) return;/.test(mini), true);
    checkNot('[v1.92.61] panel KHÔNG còn dải tiến trình #ssb-mini (người dùng không muốn thêm)',
      SRC, /id="ssb-mini"/);
    check('[v1.92.61] thanh tiến trình dưới nút Chạy vẫn còn nguyên',
      /id="ssb-bar"/.test(SRC) && /id="ssb-progstat"/.test(SRC), true);
    check('[v1.92.61] render() cập nhật badge', /updateMiniProgressUI\(\)/.test(stripComments(extractFn('render'))), true);

  /* ══════════════════════════════════════════════════════════════════════════════════════
   * [v1.92.62] SỬA MẤT TIN + BỎ PHÂN LUỒNG 2 TAB
   * ══════════════════════════════════════════════════════════════════════════════════════ */
  {
    /* 1) "Hội thoại không đổi" (khách vắng mặt) KHÔNG được gỡ Socket.
     * Đo trên log 19:00:54: chỉ 5 ca chứng minh vắng mặt thật, nhưng 774 chat bị né Socket
     * (gấp ~150×) ⇒ dồn sang Extension nghẽn ⇒ ❌ oan. */
    const st = stripComments(extractFn('sockRouteOf'));
    check('[v1.92.62] sổ định tuyến tách lostSock / lostExt / absent',
      /lostSock: 0, lostExt: 0, absent: 0/.test(st), true);

    const usable = stripComments(extractFn('pageSocketUsable'));
    check('[v1.92.62] chỉ lostSock mới được gỡ Socket',
      /st\.lostSock >= SOCK_LOST_BAN/.test(usable), true);
    checkNot('[v1.92.62] pageSocketUsable KHÔNG đọc st.lost (sổ cũ bị cộng oan)', usable, /st\.lost\b/);
    checkNot('[v1.92.62] pageSocketUsable KHÔNG ban vì absent', usable, /absent/);
    checkNot('[v1.92.62] pageSocketUsable KHÔNG ban vì lostExt', usable, /lostExt/);

    /* 2) Chỗ cộng sổ: "absent" chỉ đếm chẩn đoán, không cộng lost nữa. */
    const srcNoCmt = stripComments(SRC);
    checkNot('[v1.92.62] không còn _st.lost++ (nguồn gây né Socket 774 ca)',
      srcNoCmt, /_st\.lost\+\+/);
    check('[v1.92.62] ca "absent" chỉ tăng bộ đếm chẩn đoán', /_st\.absent\+\+/.test(srcNoCmt), true);

    /* 3) Bỏ phân luồng 2 tab: CHẠY THẬT computeMainSlotCap, không khớp chữ.
     * (Lần đầu tôi chỉ kiểm "/144/.test(cap) === false" nên mutation "tab ẩn ⇒ 128" LỌT.) */
    {
      const body = stripComments(extractFn('computeMainSlotCap'));
      const fn = new Function('mainCapOverride', 'peerSendingCount', 'sockRoute',
        body.replace(/^function computeMainSlotCap\(baseCap, peersMock, tabMock\) \{/, 'return function (baseCap, peersMock, tabMock) {')
            .replace(/\}\s*$/, '};'))(0, () => 0, {});
      const cases = [
        ['0 tab khác', 192, 0, undefined, 192],
        ['1 tab khác · đang xem', 192, 1, { focused: true }, 192],
        ['1 tab khác · tab ẨN', 192, 1, { focused: false }, 192],
        ['2 tab khác · tab ẨN', 192, 2, { focused: false }, 192],
        ['3 tab khác · không focus', 192, 3, { focused: false }, 192],
      ];
      for (const [name, base, peers, tab, want] of cases) {
        const got = fn(base, peers, tab);
        check(`[v1.92.62] slot = ${want} khi ${name}`, got && got.cap, want);
      }
    }
    /* 4) Khoá chống gửi trùng GIỮA 2 TAB phải còn và phải CHẶN THẬT — bỏ nhầm là 2 tab gửi
     * cùng một chat ⇒ đúng lỗi "chat có ≥2 dòng ✅" mà nghiệm thu cấm. */
    {
      const body = stripComments(extractFn('sendToAll'));
      check('[v1.92.62] sendToAll còn gọi acquireSendLock',
        /acquireSendLock/.test(body), true);
      check('[v1.92.62] khoá được kiểm TRƯỚC khi gửi (có nhánh return khi khoá thất bại)',
        /if \(!\(await acquireSendLock\(\)\)\) return;/.test(body), true);
    }
  }

    const r60 = stripComments(extractFn('render'));
    check('[v1.92.60] render() cập nhật dải tiến trình', /updateMiniProgressUI\(\)/.test(r60), true);
    const fb = stripComments(extractFn('flushBatchSummaryUI'));
    check('[v1.92.60] bảng tổng hợp và dải tiến trình dùng CÙNG nguồn số',
      /updateMiniProgressUI\(\)/.test(fb), true);

    /* 3) Nút Phóng to phải VẼ log trước khi mở (nếu không: khung trống). */
    check('[v1.92.60] nút Phóng to vẽ log ngay trước khi mở cửa sổ',
      /if \(!wasOpen\) \{ try \{ logRenderedSig = ''; flushLogUI\(true\); \}/.test(stripComments(SRC)), true);

    /* 4) Ghi localStorage sau F5 chỉ 300 dòng (104 KB → 20 KB; 1,03 → 0,10 ms/lần). */
    const pl = stripComments(extractFn('persistLogStorage'));
    check('[v1.92.60] persistLogStorage chỉ lưu 300 dòng gần nhất',
      /state\.log\.slice\(-300\)/.test(pl), true);
  }
}

/* ------------------------------- kết quả ------------------------------- */

if (fails.length) {
  console.log(`✗ ${fails.length}/${pass + fails.length} kịch bản THẤT BẠI:\n`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`✓ ${pass} kịch bản đều đúng (phân xử lịch sử + ngân sách thử lại Socket).`);
console.log('  (gồm 4 ca mà bản cũ kết luận sai: khác nội dung, lượt trước, thiếu mốc giờ, tin thu hồi)');
