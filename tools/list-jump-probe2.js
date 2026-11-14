/* ============================================================================
 * PROBE v2 — câu hỏi dứt điểm: server có dùng phần THỜI GIAN trong cursor
 * khi phần KEY là key THẬT (lấy từ chính request của app) hay không?
 *
 * Dán vào Console tab Pancake. Không gửi tin, không sửa gì.
 *
 * Cách làm: lấy cursor THẬT gần nhất app vừa dùng → gọi 3 lần:
 *   A. y nguyên cursor thật            (đối chứng)
 *   B. key y nguyên, ts = 15 ngày trước
 *   C. key y nguyên, ts = 60 ngày trước
 * Nếu A ≈ B ≈ C  ⇒ server BỎ QUA ts ⇒ nhảy theo mốc thời gian là BẤT KHẢ.
 * Nếu B/C khác A ⇒ ts có tác dụng khi key hợp lệ ⇒ còn đường.
 * ========================================================================== */
(async () => {
  const src = performance.getEntriesByType('resource').map(e => e.name)
    .filter(n => /\/api\/v1\/(pages\/\d+\/)?conversations\?/.test(n) && /next_cursor=/.test(n))
    .pop();
  if (!src) return console.warn('[v2] Không thấy request danh sách CÓ next_cursor. Cuộn danh sách một chút rồi chạy lại.');

  const u0 = new URL(src);
  const realCur = decodeURIComponent(u0.searchParams.get('next_cursor') || '');
  const bin = atob(realCur);
  if (bin.charCodeAt(0) !== 0x83 || bin.charCodeAt(6) !== 0x61 || bin.charCodeAt(8) !== 0x6e) {
    return console.warn('[v2] Cursor không đúng dạng đã biết — dừng.');
  }
  const seen = bin.charCodeAt(7) & 0xff;
  let ts = 0, mult = 1;
  for (let i = 0; i < 6; i++) { ts += (bin.charCodeAt(11 + i) & 0xff) * mult; mult *= 256; }
  const sLen = ((bin.charCodeAt(18) & 0xff) << 24 >>> 0) + ((bin.charCodeAt(19) & 0xff) << 16)
             + ((bin.charCodeAt(20) & 0xff) << 8) + (bin.charCodeAt(21) & 0xff);
  const key = bin.slice(22, 22 + sLen);
  console.log('[v2] cursor thật: seen =', seen, '| ts =', new Date(ts).toISOString(), '| key =', key);

  function enc(sb, tsMs, k) {
    const s = String(k || ''), n = s.length, b = new Uint8Array(22 + n + 1);
    b[0] = 0x83; b[1] = 0x6c; b[2] = 0; b[3] = 0; b[4] = 0; b[5] = 3;
    b[6] = 0x61; b[7] = sb & 0xff; b[8] = 0x6e; b[9] = 6; b[10] = 0;
    let v = Math.max(0, Math.floor(tsMs));
    for (let i = 0; i < 6; i++) { b[11 + i] = v % 256; v = Math.floor(v / 256); }
    b[17] = 0x6d;
    b[18] = (n >>> 24) & 0xff; b[19] = (n >>> 16) & 0xff; b[20] = (n >>> 8) & 0xff; b[21] = n & 0xff;
    for (let i = 0; i < n; i++) b[22 + i] = s.charCodeAt(i) & 0xff;
    b[22 + n] = 0x6a;
    let out = ''; for (const x of b) out += String.fromCharCode(x);
    return btoa(out);
  }

  const stamp = c => c.updated_at || c.last_message_at || '';
  async function run(label, cursor) {
    const u = new URL(src);
    u.searchParams.set('next_cursor', cursor);
    u.searchParams.set('current_count', '0');
    const r = await fetch(u.toString(), { credentials: 'include', headers: { accept: 'application/json' } });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (_) { try { j = JSON.parse(atob(txt)); } catch (_) {} }
    const c = (j && j.conversations) || [];
    console.log('[v2]', label, '| HTTP', r.status, '| n =', c.length,
      '| đầu:', c[0] ? (c[0].id + ' @ ' + stamp(c[0])) : '—',
      '| cuối:', c.length ? stamp(c[c.length - 1]) : '—');
    return c;
  }

  const A = await run('A: cursor THẬT nguyên bản     ', realCur);
  const B = await run('B: key thật, ts = 15 ngày trước', enc(seen, Date.now() - 15 * 864e5, key));
  const C = await run('C: key thật, ts = 60 ngày trước', enc(seen, Date.now() - 60 * 864e5, key));

  const sig = a => (a[0] ? a[0].id + '|' + stamp(a[0]) : 'rỗng');
  console.log('[v2] KẾT LUẬN:',
    (sig(A) === sig(B) && sig(B) === sig(C))
      ? 'A = B = C ⇒ server BỎ QUA ts ⇒ nhảy theo mốc thời gian BẤT KHẢ. Bỏ ý tưởng này.'
      : 'A khác B/C ⇒ ts CÓ tác dụng khi key hợp lệ ⇒ còn đường, báo lại để tôi làm tiếp.');
})();
