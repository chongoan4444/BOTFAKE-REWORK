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
  const A = new Function('serverSkewMs', 'BU_PROOF_STALE_MS', acode)(0, 30000);
  const P = '898735919982398';
  const PSID = '39224298167184827';
  const CID = P + '_' + PSID;
  const t0 = Date.parse('2026-11-11T10:00:00Z');
  const sendTxt = 'Chị cho em xin chiều cao cân nặng của bé với ạ';
  const raw = (ms) => new Date(ms).toISOString().replace('Z', '').replace(/\.\d{3}/, '.000000');
  const conv = (o) => Object.assign({ id: CID, page_id: P, from_psid: PSID, snippet: sendTxt, updated_at: raw(t0), last_sent_by: { id: P } }, o);

  check('cổng: tin ĐÃ có trong snippet ⇒ yes (hủy bù ngay, không chờ)', A.absenceVerdict([conv({})], CID, P, PSID, sendTxt, t0, false), 'yes');
  check('cổng: dò SỚM thấy hội thoại chưa đổi ⇒ KHÔNG được kết luận vắng mặt', A.absenceVerdict([conv({ snippet: 'Tin cũ của shop', updated_at: raw(t0 - 600000) })], CID, P, PSID, sendTxt, t0, false), 'unknown');
  check('cổng: dò MUỘN, hội thoại im từ trước lúc gửi ⇒ absent (bù an toàn)', A.absenceVerdict([conv({ snippet: 'Tin cũ của shop', updated_at: raw(t0 - 600000) })], CID, P, PSID, sendTxt, t0, true), 'absent');
  check('cổng: hội thoại VỪA động sau lúc gửi nhưng snippet khác ⇒ unknown (không dám bù)', A.absenceVerdict([conv({ snippet: 'Tin khác', updated_at: raw(t0 + 2000) })], CID, P, PSID, sendTxt, t0, true), 'unknown');
  check('cổng: thiếu updated_at ⇒ unknown', A.absenceVerdict([conv({ snippet: 'Tin cũ', updated_at: '' })], CID, P, PSID, sendTxt, t0, true), 'unknown');
  check('cổng: hội thoại khác ⇒ unknown', A.absenceVerdict([conv({ id: P + '_999', from_psid: '999', snippet: 'Tin cũ', updated_at: raw(t0 - 600000) })], CID, P, PSID, sendTxt, t0, true), 'unknown');
  check('cổng: danh sách rỗng ⇒ unknown', A.absenceVerdict([], CID, P, PSID, sendTxt, t0, true), 'unknown');
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

/* ------------------------------- kết quả ------------------------------- */

if (fails.length) {
  console.log(`✗ ${fails.length}/${pass + fails.length} kịch bản THẤT BẠI:\n`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`✓ ${pass} kịch bản đều đúng (phân xử lịch sử + ngân sách thử lại Socket).`);
console.log('  (gồm 4 ca mà bản cũ kết luận sai: khác nội dung, lượt trước, thiếu mốc giờ, tin thu hồi)');
