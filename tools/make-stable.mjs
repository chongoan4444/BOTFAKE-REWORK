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

/* 1. Nhận diện ------------------------------------------------------------- */
rep('// @name         BOTFAKE LITE (Wave 200 · Tab + Clipboard)',
  '// @name         BOTFAKE LITE — BẢN ỔN ĐỊNH (gửi hàng loạt Pancake)', 'name');
rep('// @namespace    salescript\n', '// @namespace    salescript-stable\n', 'namespace');
rep(`// @version      ${base}-${build.toLowerCase()}`,
  `// @version      ${base}-stable`, 'version');
rep('// @description  BOTFAKE — nền v1.91.72 Tab + Clipboard, điều phối Wave 200 cục bộ trong tab Pancake (4 làn chính + 2 làn bù song song).',
  '// @description  Bản ổn định cho người dùng: gửi hàng loạt trong tab Pancake. KHÔNG nhớ/lọc chat lỗi, có công tắc phím Tab, log cuối gọn.', 'description');

rep("const PANEL_ID = 'ssb-root';          // ssb = SaleScript Bulk — không đụng pk-*/adj-*/pancake-* của script khác",
  "const PANEL_ID = 'ssb-root-stable';   // [STABLE] id riêng — không đụng panel của bản gốc", 'panel-id');
rep(`const APP_VERSION = '${base}-${build}'; // hiện ở tiêu đề panel — đối chiếu với @version trong header`,
  `const APP_VERSION = '${base}-STABLE'; // [STABLE] hiện ở tiêu đề panel`, 'app-version');

/* 2. Cờ chống gửi trùng ---------------------------------------------------- */
rep(`  if (window.__BOTFAKE_TAB_CLIPBOARD_ACTIVE__ || !botfakeClaimSlot('lite')) return;
  window.__BOTFAKE_TAB_CLIPBOARD_ACTIVE__ = true;`,
`  /* [STABLE] CHỐNG GỬI TRÙNG KHI CÀI CẢ HAI BẢN:
   * Bản gốc thoát nếu \`__BOTFAKE_TAB_CLIPBOARD_ACTIVE__\` đã có. Bản ổn định:
   *   - nếu BẢN GỐC đang chạy trước → tự tắt;
   *   - nếu CHÍNH NÓ chạy trước → chiếm luôn cờ của bản gốc để bản gốc cũng tự tắt.
   * Nhờ vậy trong một tab LUÔN chỉ có đúng một bộ gửi, không bao giờ hai bộ cùng bắn. */
  if (window.__BOTFAKE_TAB_CLIPBOARD_ACTIVE__ || window.__BOTFAKE_STABLE_ACTIVE__ || !botfakeClaimSlot('stable')) {
    try { console.warn('[BOTFAKE STABLE] Đã có bản khác chạy trong tab này — bản ổn định tự tắt để tránh gửi trùng.'); } catch (e0) { /* ignore */ }
    return;
  }
  window.__BOTFAKE_STABLE_ACTIVE__ = true;
  window.__BOTFAKE_TAB_CLIPBOARD_ACTIVE__ = true;
  const IS_STABLE_BUILD = true;`, 'guard');

/* 3. Log chẩn đoán --------------------------------------------------------- */
rep('  function logLine(s) {',
`  // [STABLE] Chỉ in dòng tổng kết + tiến trình. Các dòng chẩn đoán dài (SOCKET/API/WAVE/globalId)
  // đi qua logDiag() và bị tắt ở bản này để log cuối gọn, người dùng thường không cần đọc.
  const DIAG_LOGS = !IS_STABLE_BUILD; // bản ổn định: false ⇒ tắt hết dòng chẩn đoán dài
  function logDiag(s) { if (!DIAG_LOGS) return; try { logLine(s); } catch (e) { /* ignore */ } }
  function logLine(s) {`, 'logdiag-def');

/* 4. Nhớ/lọc chat lỗi ------------------------------------------------------ */
// [v1.92.21] BẢN GỐC ĐÃ XOÁ HẲN cơ chế này (không lưu localStorage, không lọc, không còn nút
// "🧹 Xóa nhớ lỗi"). Bản ổn định vì thế không cần sửa gì nữa — hai bản dùng chung đúng một hành vi.
// (Giữ khối ghi chú này để lần sau không ai đi tìm mấy phép thay thế đã bị xoá.)


/* 5. Công tắc phím Tab: ĐỔI MẶC ĐỊNH (nút đã có sẵn ở bản gốc) ----------------- */
// Bản gốc: công tắc "TAB:" mặc định BẬT (giữ đúng hành vi cũ: bấm Tab = Chạy).
// Bản ổn định: cùng nút đó nhưng mặc định TẮT — người dùng mới bấm Tab để chuyển ô sẽ không
// vô tình mở hộp xác nhận gửi. Người dùng vẫn bật/tắt được y như bản gốc, nhớ qua localStorage.
rep("    tabSend: (() => { try { return localStorage.getItem('ssb_tab_send_on') !== '0'; } catch (e) { return true; } })(),",
  "    // [STABLE] mặc định TẮT (bản gốc mặc định BẬT) — xem ghi chú ngay trên trong tools/make-stable.mjs\n    tabSend: (() => { try { return localStorage.getItem('ssb_tab_send_on') === '1'; } catch (e) { return false; } })(),", 'tab-default-off');


rep('title="Bấm nút này hoặc nhấn phím Tab để chạy (có bảng xác nhận trước khi gửi)">▶ Chạy (Tab)</button>',
  'title="Bấm nút này để chạy (có bảng xác nhận trước khi gửi). Muốn dùng phím Tab thì bật công tắc TAB trên tiêu đề.">▶ Chạy</button>', 'send-btn-tip');
rep("'Khi bấm ▶ Chạy hoặc nhấn phím Tab, script sẽ tự lấy nội dung đang copy trên Clipboard và hiện hộp xác nhận trước khi gửi.'",
  "'Khi bấm ▶ Chạy (hoặc phím Tab nếu đã bật công tắc TAB), script sẽ tự lấy nội dung đang copy trên Clipboard và hiện hộp xác nhận trước khi gửi.'", 'clip-tip');

/* 6. Kênh riêng với tiện ích bản ổn định ------------------------------------ */
// Bản gốc nói chuyện với extension qua kênh \`__botfake\` + dấu <html data-botfake-ext="1">.
// Bản ổn định dùng kênh RIÊNG (__botfakeS / data-botfake-ext-stable, xem tools/build.mjs):
// cài cả hai tiện ích thì mỗi bên chỉ trả lời lệnh của chính nó ⇒ không thể cùng gửi một tin.
repAll("ev.data.__botfake !== 1", "ev.data.__botfakeS !== 1", 'chan-recv', 2);
rep("window.postMessage({ __botfake: 1, dir: 'to_sw', id: id, payload: payload }, '*');",
  "window.postMessage({ __botfakeS: 1, dir: 'to_sw', id: id, payload: payload }, '*');", 'chan-send');
rep("getAttribute('data-botfake-ext') === '1'",
  "getAttribute('data-botfake-ext-stable') === '1'", 'chan-attr');
rep('  function extCall(payload, waitMs) {',
`  // [STABLE] Kênh nói chuyện với tiện ích: kênh RIÊNG (__botfakeS + data-botfake-ext-stable),
  // xem tools/build.mjs. Cài cả hai tiện ích thì mỗi bên chỉ trả lời lệnh của chính nó
  // ⇒ không thể cùng gửi một tin.
  function extCall(payload, waitMs) {`, 'chan-note');

/* 7. Log cuối gọn ---------------------------------------------------------- */
for (const [a, b, label] of [
  ["logLine('⚡ TỐC ĐỘ: '", "logDiag('⚡ TỐC ĐỘ: '", 'diag-tocdo'],
  ["logLine('🌊 WAVE: script '", "logDiag('🌊 WAVE: script '", 'diag-wave'],
  ["logLine('📡 SOCKET: ACK OK/rejected/no-ACK '", "logDiag('📡 SOCKET: ACK OK/rejected/no-ACK '", 'diag-socket'],
  ["logLine('🌐 API NỀN: queued/started/fetch '", "logDiag('🌐 API NỀN: queued/started/fetch '", 'diag-api'],
  ["logLine('🧭 Chẩn đoán globalId: cache '", "logDiag('🧭 Chẩn đoán globalId: cache '", 'diag-gid'],
]) rep(a, b, label);

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
