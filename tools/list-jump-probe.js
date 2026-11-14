/* ============================================================================
 * THỬ NGHIỆM: next_cursor có nhảy thẳng tới một MỐC THỜI GIAN được không?
 *
 * Dán NGUYÊN khối này vào Console của tab Pancake (đang mở danh sách hội thoại).
 * Không sửa gì trong repo, không đụng đường gửi, không gửi tin nào.
 *
 * Vì sao có thể nhảy: next_cursor là Erlang term_to_binary
 *   0x83 6c 00 00 00 03 | 0x61 <seen> | 0x6e 06 <6 byte LE: updated_at_ms>
 *   | 0x6d <len> "{page_id}:{conv_id}" | 0x6a
 * (đã đối chiếu từng byte với pancake.vn2.har — xem userscript parseErlangCursor)
 * ⇒ cursor mang sẵn mốc thời gian, nên có thể DỰNG cursor cho mốc mình muốn.
 *
 * Câu hỏi cần server trả lời: nó có chấp nhận cursor tự dựng (phần key rỗng)
 * và trả về đúng dải chat CŨ HƠN mốc đó hay không.
 * ========================================================================== */
(async () => {
  const src = performance.getEntriesByType('resource').map(e => e.name)
    .filter(n => /\/api\/v1\/(pages\/\d+\/)?conversations\?/.test(n))
    .pop();
  if (!src) return console.warn('[probe] Không thấy request danh sách nào. Cuộn danh sách một chút rồi chạy lại.');

  function encCursor(seen, tsMs, key) {
    const s = String(key || ''), n = s.length;
    const b = new Uint8Array(22 + n + 1);
    b[0] = 0x83; b[1] = 0x6c; b[2] = 0; b[3] = 0; b[4] = 0; b[5] = 3;
    b[6] = 0x61; b[7] = seen & 0xff; b[8] = 0x6e; b[9] = 6; b[10] = 0;
    let v = Math.max(0, Math.floor(tsMs));
    for (let i = 0; i < 6; i++) { b[11 + i] = v % 256; v = Math.floor(v / 256); }
    b[17] = 0x6d;
    b[18] = (n >>> 24) & 0xff; b[19] = (n >>> 16) & 0xff; b[20] = (n >>> 8) & 0xff; b[21] = n & 0xff;
    for (let i = 0; i < n; i++) b[22 + i] = s.charCodeAt(i) & 0xff;
    b[22 + n] = 0x6a;
    let bin = ''; for (const x of b) bin += String.fromCharCode(x);
    return btoa(bin);
  }

  const u = new URL(src);
  const target = Date.now() - 15 * 864e5;           // ← đổi 15 thành số ngày bạn muốn nhảy tới
  u.searchParams.set('next_cursor', encCursor(0, target, ''));
  u.searchParams.set('current_count', '0');
  console.log('[probe] GET', u.toString().replace(/access_token=[^&]*/, 'access_token=***'));

  const r = await fetch(u.toString(), { credentials: 'include', headers: { accept: 'application/json' } });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch (_) { try { j = JSON.parse(atob(txt)); } catch (_) { /* ignore */ } }
  if (!j) return console.warn('[probe] HTTP', r.status, '| không phải JSON:', txt.slice(0, 200));

  const convs = j.conversations || [];
  const t = c => c.updated_at || c.last_message_at || c.last_customer_interactive_at || '';
  console.log('[probe] HTTP', r.status, '| trả về', convs.length, 'hội thoại | còn next_cursor:', !!j.next_cursor);
  if (convs.length) console.log('[probe] mới nhất:', t(convs[0]), '| cũ nhất:', t(convs[convs.length - 1]));
  console.log('[probe] mốc muốn nhảy tới:', new Date(target).toISOString());
  console.log(convs.length
    ? '⇒ NẾU "cũ nhất" nằm NGAY DƯỚI mốc, server tôn trọng cursor tự dựng ⇒ nhảy thẳng được.'
    : '⇒ Trả rỗng: hoặc server từ chối key rỗng, hoặc mốc này nằm ngoài dải dữ liệu.');
})();
