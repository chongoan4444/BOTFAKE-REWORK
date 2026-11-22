#!/usr/bin/env node
/**
 * BOTFAKE — sinh BẢN ỔN ĐỊNH từ bản gốc
 * ---------------------------------------------------------------------------
 *   node tools/make-stable.mjs          # ghi scripts/pancake-send-stable.user.js
 *   node tools/make-stable.mjs --check  # chỉ kiểm tra bản ổn định có khớp bản gốc không
 *
 * Vì sao phải sinh tự động: bản ổn định là bản gốc + đúng một bộ thay đổi có đánh dấu
 * `[STABLE]`. Sửa tay hai nơi là chắc chắn lệch. Muốn đổi logic gửi → sửa
 * `scripts/pancake-send-lite.user.js` rồi chạy lại lệnh này.
 *
 * Bộ thay đổi (xem docs/HAR-GROUND-TRUTH.md §48):
 *   1. tên/namespace/version/panel-id riêng + cờ chống 2 bản cùng gửi trong 1 tab
 *   2. BỎ cơ chế nhớ/lọc chat gửi lỗi (không lọc, không ghi localStorage)
 *   3. công tắc phím TAB (mặc định TẮT), nhớ qua localStorage
 *   4. log cuối gọn: 6 dòng chẩn đoán đi qua logDiag() và bị tắt
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'scripts/pancake-send-lite.user.js';
const DST = 'scripts/pancake-send-stable.user.js';
const CHECK = new Set(process.argv.slice(2)).has('--check');

const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const ver = JSON.parse(read('version.json'));
const base = String(ver.base || '').trim();
const build = String(ver.build || '').trim();

let s = read(SRC);
const applied = [];

/** Thay đúng MỘT lần; sai lệch ⇒ dừng ngay (không sinh ra bản nửa vời). */
/** Thay TẤT CẢ (dùng cho neo xuất hiện nhiều lần, có kiểm số lần). */
function repAll(from, to, label, times) {
  const n = s.split(from).length - 1;
  if (n !== times) {
    console.error(`✗ [${label}] neo xuất hiện ${n} lần (cần ${times}) — bản gốc đã đổi, cập nhật tools/make-stable.mjs.`);
    process.exit(1);
  }
  s = s.split(from).join(to);
  applied.push(label);
}

function rep(from, to, label) {
  const n = s.split(from).length - 1;
  if (n !== 1) {
    console.error(`✗ [${label}] neo xuất hiện ${n} lần (cần đúng 1) — bản gốc đã đổi, cập nhật tools/make-stable.mjs.`);
    process.exit(1);
  }
  s = s.replace(from, to);
  applied.push(label);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * [v1.93.19] BẢN ỔN ĐỊNH = BẢN GỐC, CHỈ CẮT LOG.
 * Người dùng chốt: "tôi muốn bản stable giống bản gốc về mọi thứ kể cả trên giao diện,
 * nghĩa là bạn copy bản gốc ra, rồi sửa cắt mỗi cái log thôi".
 *
 * ⇒ CHỈ còn 3 phép thay đổi, tất cả đều nằm ngoài giao diện và ngoài cơ chế gửi:
 *   ① TẮT các dòng log chẩn đoán dài (đi qua `logDiag` → no-op).
 *   ② Gộp dòng tổng kết cuối thành MỘT dòng ngắn.
 *   ③ ẨN dòng tiến trình giữa lượt (🟢 "Đang gửi n/N …") — vẫn cập nhật bảng TỔNG HỢP.
 *
 * ĐÃ BỎ HẲN (so với bản trước):
 *   ✗ đổi @name / @namespace / @description / @version  → giữ y như bản gốc
 *   ✗ đổi PANEL_ID (`ssb-root-stable`)                   → giữ `ssb-root`
 *   ✗ đổi APP_VERSION sang `-STABLE`                     → giữ y như bản gốc
 *   ✗ IS_STABLE_BUILD + khoá chống trùng __BOTFAKE_STABLE_ACTIVE__
 *   ✗ kênh extension riêng (__botfakeS / data-botfake-ext-stable)
 *   ✗ công tắc phím Tab mặc định TẮT                     → giữ mặc định BẬT như bản gốc
 *   ✗ đổi 2 câu tooltip
 * Lý do bỏ: chúng làm GIAO DIỆN và HÀNH VI khác bản gốc. Cài cả hai bản cùng lúc vẫn an
 * toàn nhờ `botfakeClaimSlot()` (dùng chung `data-botfake-active`): bản nào nạp trước thì
 * chiếm chỗ, bản sau thấy cờ đã có ⇒ tự tắt. Cơ chế này CÓ SẴN trong bản gốc, không cần
 * thêm cờ riêng.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* 1. Chỉ đổi TÊN hiển thị trong header userscript (ngoài giao diện panel) ----- */
// Giữ nguyên @name/@namespace/@version/@description/@match: đó là thứ Tampermonkey dùng để
// nhận diện & cập nhật script. Đổi @name sẽ làm Tampermonkey coi đây là script KHÁC (cài
// chồng thay vì cập nhật) — đúng loại bẫy đã gặp với `.crx`.
// Người dùng cài trực tiếp file này nên chỉ cần phân biệt bằng TÊN FILE.

/* 2. Tắt log chẩn đoán dài ------------------------------------------------- */
rep('  function logLine(s) {',
`  // [STABLE] Log cuối chỉ in 1 dòng tổng kết. Các dòng chẩn đoán dài (SOCKET/API/WAVE/
  // globalId/CHẠY NỀN/Đuôi chờ) đi qua logDiag() và bị tắt ở bản này.
  // Cơ chế gửi, làn, ngưỡng, giao diện: GIỐNG HỆT bản gốc — không sửa gì.
  const DIAG_LOGS = false; // bản ổn định: tắt hết dòng chẩn đoán dài
  function logDiag(s) { if (!DIAG_LOGS) return; try { logLine(s); } catch (e) { /* ignore */ } }
  function logLine(s) {`, 'logdiag-def');

/* 3. Ẩn dòng tiến trình giữa lượt ----------------------------------------- */
// Người dùng chốt: log chỉ cần số thành công/thất bại + tốc độ ⇒ ẩn 🟢 "Đang gửi n/N (…%)"
// trong LÚC CHẠY. Bảng TỔNG HỢP trên panel vẫn cập nhật bình thường (updateBatchSummaryUI
// là đường riêng, không đi qua logLine) — chỉ dòng chữ trong khung log là không in.
// Tắt ĐÚNG dòng in bên trong `logProgress`, giữ nguyên mọi phép tính (mốc %, bước 10%).
// Không thay lời gọi ⇒ nếu bản gốc đổi cách gọi thì bản ổn định không lệch.
rep(`    logLine('🟢 Đang gửi ' + d + '/' + t + ' (' + pct + '%) · ✅ ' + (ok || 0)`,
  `    if (false) logLine('🟢 Đang gửi ' + d + '/' + t + ' (' + pct + '%) · ✅ ' + (ok || 0)`,
  'progress-off');
rep(`      + (fail ? ' · ❌ ' + fail : '') + (unsure ? ' · ⚠ ' + unsure : ''));`,
  `      + (fail ? ' · ❌ ' + fail : '') + (unsure ? ' · ⚠ ' + unsure : '')); // [STABLE] dòng 🟢 bị tắt`,
  'progress-off-note');

/* 4. Các dòng chẩn đoán dài → logDiag (bị tắt ở bản này) -------------------- */
for (const [a, b, label] of [
  ["logLine('⚡ TỐC ĐỘ: '", "logDiag('⚡ TỐC ĐỘ: '", 'diag-tocdo'],
  ["logLine('🫥 CHẠY NỀN: '", "logDiag('🫥 CHẠY NỀN: '", 'diag-chaynen'],
  ["logLine('🌊 WAVE: script '", "logDiag('🌊 WAVE: script '", 'diag-wave'],
  ["logLine('📡 SOCKET: ACK OK/rejected/no-ACK '", "logDiag('📡 SOCKET: ACK OK/rejected/no-ACK '", 'diag-socket'],
  ["logLine('🌐 API NỀN: queued(nền)/started(nền+đồng bộ)/fetch '", "logDiag('🌐 API NỀN: queued(nền)/started(nền+đồng bộ)/fetch '", 'diag-api'],
  ["logLine('🧭 Chẩn đoán globalId: cache '", "logDiag('🧭 Chẩn đoán globalId: cache '", 'diag-gid'],
]) rep(a, b, label);

/* 5. Dòng tổng kết cuối: 1 dòng ngắn -------------------------------------- */
// Chèn nhánh `if` NGAY TRƯỚC lời gọi cũ, KHÔNG cắt biểu thức 93 dòng (cắt bằng thay-chuỗi-
// nguyên-văn đã thử và hỏng: neo không khớp). Biểu thức cũ còn nguyên nên `node --check`
// luôn xanh, và số liệu không đổi (cùng `c`, cùng `elapsedSec`).
const STABLE_SUMMARY = `if (!DIAG_LOGS) logLine('📊 XONG: ✅ ' + c.okTotal + '/' + c.total + ' tin (' + pct + '%)'
          + ' · ❌ ' + c.failTotal + ' · ⚠ ' + c.unsureTotal
          + ' · ⏱ ' + elapsedSec + 's · ' + (elapsedSec > 0 ? (c.settled / elapsedSec).toFixed(1) : '0') + ' tin/giây');
        else logLine('📊 TỔNG HỢP CHỐT LƯỢT GỬI: ✅ Đã gửi thành công ' + c.okTotal + '/' + c.total`;
rep("logLine('📊 TỔNG HỢP CHỐT LƯỢT GỬI: ✅ Đã gửi thành công ' + c.okTotal + '/' + c.total",
  STABLE_SUMMARY, 'stable-summary');

/* 8. Ghi / kiểm tra -------------------------------------------------------- */
if (CHECK) {
  const cur = existsSync(path.join(ROOT, DST)) ? read(DST) : '';
  if (cur !== s) {
    console.error(`✗ ${DST} KHÔNG khớp bản gốc + bộ thay đổi [STABLE] — chạy "node tools/make-stable.mjs".`);
    process.exit(1);
  }
  console.log(`✓ ${DST} khớp (${applied.length} thay đổi [STABLE]).`);
} else {
  writeFileSync(path.join(ROOT, DST), s);
  console.log(`✓ Đã sinh ${DST} · ${base}-STABLE · ${applied.length} thay đổi [STABLE] · ${s.split('\n').length} dòng`);
}
