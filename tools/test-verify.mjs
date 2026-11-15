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

const code = [
  extractFn('normalizeMsgText'),
  extractFn('historyVerdict'),
  'return { normalizeMsgText, historyVerdict };',
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

function check(name, got, want) {
  if (got === want) { pass++; return; }
  fails.push(`${name}\n     nhận: ${got} | mong đợi: ${want}`);
}

/** Khẳng định KHÔNG rơi vào một kết luận nguy hiểm (vd không được là 'yes'). */
function checkNot(name, got, forbidden) {
  if (got !== forbidden) { pass++; return; }
  fails.push(`${name}\n     nhận: ${got} | KHÔNG được là: ${forbidden}`);
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
const newBudget = () => ({ tried: 0, saved: 0, skipped: 0, sinceProbe: 0, closed: false });

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

/* ------------------------------- kết quả ------------------------------- */

if (fails.length) {
  console.log(`✗ ${fails.length}/${pass + fails.length} kịch bản THẤT BẠI:\n`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`✓ ${pass} kịch bản đều đúng (phân xử lịch sử + ngân sách thử lại Socket).`);
console.log('  (gồm 4 ca mà bản cũ kết luận sai: khác nội dung, lượt trước, thiếu mốc giờ, tin thu hồi)');
