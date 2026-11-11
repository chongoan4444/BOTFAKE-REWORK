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

// 3) Lịch sử rỗng + mốc nước cũ hơn lúc bắn → chắc chắn chưa đi (được phép bù)
check('lịch sử cũ hơn lúc bắn → no',
  historyVerdict([
    msg({ text: 'khách hỏi giá', from: '12345', at: T0 - 3600_000 }),
    msg({ text: 'shop trả lời cũ', at: T0 - 3500_000 }),
  ], PAGE, 'Câu mới cần gửi', null, T0),
  'no');

// 4) Có tin mới hơn lúc bắn nhưng không phải tin ta cần → chưa kết luận được
check('có tin mới nhưng không khớp → unknown',
  historyVerdict([
    msg({ text: 'khách nhắn tiếp', from: '12345', at: T0 + 4000 }),
  ], PAGE, 'Câu mới cần gửi', null, T0),
  'unknown');

// 5) Lịch sử chỉ có tin KHỚP nội dung nhưng thuộc LƯỢT TRƯỚC (quá xa sentAt).
//    Tuyệt đối không được coi là 'yes' (nếu coi là yes thì tin của lượt này KHÔNG BAO GIỜ được bù).
//    Kết luận đúng là 'no' — mốc nước nói rằng chưa có gì mới đi ra.
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

/* ------------------------------- kết quả ------------------------------- */

if (fails.length) {
  console.log(`✗ ${fails.length}/${pass + fails.length} kịch bản THẤT BẠI:\n`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`✓ ${pass} kịch bản phân xử lịch sử đều đúng.`);
console.log('  (gồm 4 ca mà bản cũ kết luận sai: khác nội dung, lượt trước, thiếu mốc giờ, tin thu hồi)');
