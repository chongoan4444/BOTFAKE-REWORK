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

/* 4. Bỏ nhớ/lọc chat lỗi --------------------------------------------------- */
rep(`  function isRememberedUnavailable(convId) {
    return !!convId && unavailableConversationIds.has(String(convId));
  }`,
`  function isRememberedUnavailable(convId) {
    // [STABLE] YÊU CẦU: bỏ hẳn cơ chế nhớ/lọc chat gửi lỗi. Luôn trả false ⇒ không chat nào
    // bị loại khỏi danh sách, không tự bỏ tick, không có "danh sách đen" tích qua các lần gửi.
    return false;
  }`, 'no-filter');

rep(`  function rememberConfirmedSocketUnavailable(conv, result) {
    if (!conv || !conv.id || !result || !result.recipientUnavailable) return false;`,
`  function rememberConfirmedSocketUnavailable(conv, result) {
    // [STABLE] Không ghi nhớ ID lỗi nữa (không lưu localStorage, không lọc lần sau).
    return false;
    if (!conv || !conv.id || !result || !result.recipientUnavailable) return false;`, 'no-remember');

rep('<button class="b b-gray" id="ssb-clear-unavailable" title="Xóa các ID lỗi đã nhớ; thao tác cần xác nhận hai lần">🧹 Xóa nhớ lỗi (0)</button>',
  '<button class="b b-gray" id="ssb-clear-unavailable" style="display:none" title="Không dùng ở bản ổn định">🧹 Xóa nhớ lỗi</button>', 'hide-clear-btn');

/* 5. Công tắc phím Tab ----------------------------------------------------- */
rep('          <button class="badge on" id="ssb-toggle" title="Bật/tắt tính năng">BẬT</button>',
`          <button class="badge on" id="ssb-toggle" title="Bật/tắt tính năng">BẬT</button>
          <button class="badge off" id="ssb-tab" title="Bật/tắt GỬI BẰNG PHÍM TAB (mặc định TẮT — bấm Tab chỉ chuyển ô như bình thường)">TAB: TẮT</button>`, 'tab-btn');

rep('    confirmingSend: false,  // đang mở hộp xác nhận gửi / đọc clipboard — chặn bấm đúp Tab/Chạy',
`    confirmingSend: false,  // đang mở hộp xác nhận gửi / đọc clipboard — chặn bấm đúp Tab/Chạy
    // [STABLE] Công tắc phím Tab: TẮT mặc định (người dùng mới bấm Tab để chuyển ô sẽ không
    // vô tình kích hoạt gửi). Bật/tắt bằng nút "TAB:" trên tiêu đề panel, nhớ qua localStorage.
    tabSend: (() => { try { return localStorage.getItem('ssb_tab_send_on') === '1'; } catch (e) { return false; } })(),`, 'state-tabsend');

rep(`    on('ssb-toggle', 'click', () => {
      state.enabled = !state.enabled;
      if (!state.enabled) state.deselectMode = false;
      highlightRows(); // bật: tô lại / tắt: gỡ hết màu
      render();
    });`,
`    on('ssb-toggle', 'click', () => {
      state.enabled = !state.enabled;
      if (!state.enabled) state.deselectMode = false;
      highlightRows(); // bật: tô lại / tắt: gỡ hết màu
      render();
    });
    // [STABLE] Công tắc phím Tab
    on('ssb-tab', 'click', () => {
      state.tabSend = !state.tabSend;
      try { localStorage.setItem('ssb_tab_send_on', state.tabSend ? '1' : '0'); } catch (e0) { /* ignore */ }
      logLine(state.tabSend
        ? '⌨️ ĐÃ BẬT: bấm phím Tab = mở hộp xác nhận gửi (vẫn hỏi trước khi gửi).'
        : '⌨️ ĐÃ TẮT: phím Tab chỉ chuyển ô như bình thường, muốn gửi thì bấm nút ▶.');
      render();
    });`, 'tab-handler');

rep(`    const tgl = shadow.getElementById('ssb-toggle');
    if (tgl) {
      tgl.textContent = state.enabled ? 'BẬT' : 'TẮT';
      tgl.className = 'badge ' + (state.enabled ? 'on' : 'off');
    }`,
`    const tgl = shadow.getElementById('ssb-toggle');
    if (tgl) {
      tgl.textContent = state.enabled ? 'BẬT' : 'TẮT';
      tgl.className = 'badge ' + (state.enabled ? 'on' : 'off');
    }
    const tglTab = shadow.getElementById('ssb-tab');
    if (tglTab) {
      tglTab.textContent = 'TAB: ' + (state.tabSend ? 'BẬT' : 'TẮT');
      tglTab.className = 'badge ' + (state.tabSend ? 'on' : 'off');
    }`, 'tab-render');

rep(`    const isTabKey = (e.key === 'Tab' || e.code === 'Tab' || e.keyCode === 9 || e.which === 9);
    // Phím Tab: kích hoạt nút ▶ Chạy (luôn hiện hộp xác nhận trước khi gửi)`,
`    const isTabKey = (e.key === 'Tab' || e.code === 'Tab' || e.keyCode === 9 || e.which === 9);
    // [STABLE] Công tắc TẮT ⇒ nhường phím Tab cho trang, không preventDefault, không kích hoạt gửi.
    if (isTabKey && !state.tabSend && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) return;
    // Phím Tab: kích hoạt nút ▶ Chạy (luôn hiện hộp xác nhận trước khi gửi)`, 'tab-keyguard');

rep('title="Bấm nút này hoặc nhấn phím Tab để chạy (có bảng xác nhận trước khi gửi)">▶ Chạy (Tab)</button>',
  'title="Bấm nút này để chạy (có bảng xác nhận trước khi gửi). Muốn dùng phím Tab thì bật công tắc TAB trên tiêu đề.">▶ Chạy</button>', 'send-btn-tip');
rep("'Khi bấm ▶ Chạy hoặc nhấn phím Tab, script sẽ tự lấy nội dung đang copy trên Clipboard và hiện hộp xác nhận trước khi gửi.'",
  "'Khi bấm ▶ Chạy (hoặc phím Tab nếu đã bật công tắc TAB), script sẽ tự lấy nội dung đang copy trên Clipboard và hiện hộp xác nhận trước khi gửi.'", 'clip-tip');

/* 6. Log cuối gọn ---------------------------------------------------------- */
for (const [a, b, label] of [
  ["logLine('🧾 GHI NHỚ LỖI: thêm mới '", "logDiag('🧾 GHI NHỚ LỖI: thêm mới '", 'diag-ghinho'],
  ["logLine('⚡ TỐC ĐỘ: '", "logDiag('⚡ TỐC ĐỘ: '", 'diag-tocdo'],
  ["logLine('🌊 WAVE: script '", "logDiag('🌊 WAVE: script '", 'diag-wave'],
  ["logLine('📡 SOCKET: ACK OK/rejected/no-ACK '", "logDiag('📡 SOCKET: ACK OK/rejected/no-ACK '", 'diag-socket'],
  ["logLine('🌐 API NỀN: queued/started/fetch '", "logDiag('🌐 API NỀN: queued/started/fetch '", 'diag-api'],
  ["logLine('🧭 Chẩn đoán globalId: cache '", "logDiag('🧭 Chẩn đoán globalId: cache '", 'diag-gid'],
]) rep(a, b, label);

/* 7. Ghi / kiểm tra -------------------------------------------------------- */
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
