#!/usr/bin/env node
/**
 * ĐO TỐC ĐỘ TỪ MỘT FILE HAR — trả lời đúng một câu: CHẬM VÌ PHẢN HỒI CHẬM, hay vì
 * CHỜ Ở PHÍA MÁY (nhịp, tuần tự hoá, khoảng trống giữa các lệnh)?
 *
 *   node tools/har-latency.mjs <file.har> [--top 12] [--only messages]
 *
 * Ba nhóm số, cố ý tách rời vì chúng dẫn tới ba cách sửa KHÁC NHAU:
 *
 *   1. PHÍA SERVER (`timings.wait` = thời gian chờ máy chủ trả lời byte đầu tiên).
 *      Cao ⇒ phản hồi chậm thật ⇒ chỉ có giảm số lệnh hoặc chia trang/đổi endpoint.
 *   2. PHÍA MÁY (gaps): tổng thời gian "không có lệnh nào đang bay". Đây là thời gian
 *      script TỰ BỎ RA: nhịp chờ giữa các wave, chờ ACK, chờ lane, chờ kiểm chứng.
 *      Cao ⇒ tăng làn / bỏ nhịp mới nhanh được; phản hồi server KHÔNG phải thủ phạm.
 *   3. ĐỘ SONG SONG: số lệnh đang bay tại mỗi thời điểm (p50/p90/max). Nếu p50 = 1 thì
 *      mọi thứ đang bị TUẦN TỰ HOÁ — thêm làn vô nghĩa, phải tìm chỗ chặn.
 *
 * Chia nguồn gốc:   wall = Σ(server wait) + Σ(gaps) + Σ(phần còn lại: DNS/TLS/queue...)
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const getArg = (k, d) => {
  const i = args.indexOf('--' + k);
  return i > -1 && args[i + 1] ? args[i + 1] : d;
};
const TOP = Number(getArg('top', 12));
const ONLY = getArg('only', '');

if (!file) {
  console.error('Dùng: node tools/har-latency.mjs <file.har> [--top 12] [--only chuỗi-con]');
  process.exit(2);
}

const raw = readFileSync(file, 'utf8');
/* ═══ ĐỌC ĐƯỢC CẢ FILE HAR BỊ CẮT CỤT ═══
 * `test123.har` trên main dài ĐÚNG 5 000 006 byte và JSON chưa đóng ⇒ `JSON.parse` ném
 * "Unterminated string". Nghĩa là file bị cắt lúc tải lên, KHÔNG phải HAR hỏng khi ghi.
 * Nhưng các entry ĐỨNG TRƯỚC chỗ cắt vẫn hoàn chỉnh và vẫn đo được ⇒ không được bỏ cả file.
 * Nay: thử parse chuẩn trước; hỏng thì quét `log.entries` bằng máy trạng thái (đếm ngoặc,
 * có hiểu chuỗi/escape) để nhặt từng object entry hoàn chỉnh, rồi báo rõ đã cứu được bao nhiêu. */
let entries = [];
let truncated = false;
const har0 = (() => { try { return JSON.parse(raw); } catch (e) { return null; } })();
if (har0 && har0.log && Array.isArray(har0.log.entries)) {
  entries = har0.log.entries;
} else {
  truncated = true;
  const ei = raw.indexOf('"entries"');
  const lb = ei > -1 ? raw.indexOf('[', ei) : -1;
  if (lb < 0) { console.error('Không tìm thấy log.entries trong file.'); process.exit(2); }
  let depth = 0, inStr = false, esc = false, start = -1, closed = false;
  for (let i = lb + 1; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; continue; }
    if (c === '}') {
      depth--;
      if (depth === 0 && start > -1) {
        try { entries.push(JSON.parse(raw.slice(start, i + 1))); } catch (e) { /* entry hỏng — bỏ */ }
        start = -1;
      }
      continue;
    }
    if (c === ']' && depth === 0) { closed = true; break; }
  }
  if (!entries.length) { console.error('File cụt và không cứu được entry nào.'); process.exit(2); }
  console.log('⚠ FILE BỊ CẮT CỤT (' + raw.length + ' byte, JSON ' + (closed ? 'đóng' : 'CHƯA đóng')
    + ') — đã cứu được ' + entries.length + ' lệnh hoàn chỉnh.');
  console.log('  Số đo dưới đây CHỈ tính các lệnh đó; phần đuôi bị mất không đo được.');
  console.log('');
}
if (!entries.length) { console.error('HAR không có entry nào.'); process.exit(2); }

/* ───────── tiện ích ───────── */
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))];
};
const sum = (arr) => arr.reduce((s, x) => s + x, 0);
const fmt = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms');
/* pad có CẮT: cắt bằng '…' để cột không bị dính vào nhau (bản nháp cắt cứng làm
 * `…/message` + `2` ⇒ đọc thành `…/message2` — sai số lệnh). */
const pad = (s, n) => {
  const t = String(s);
  return (t.length > n - 1 ? t.slice(0, n - 2) + '…' : t).padEnd(n);
};

/** Bỏ query + id số dài để gộp được: /v1/pages/123/conversations/456/messages → .../…/… */
function normPath(url) {
  let p = url;
  const m = String(url).match(/^[a-z]+:\/\/[^/]+(\/[^?#]*)/i);
  if (m) p = m[1];
  p = p.split('?')[0];
  p = p.replace(/\/\d{5,}/g, '/…').replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/…');
  return p;
}

const t0 = Math.min(...entries.map((e) => Date.parse(e.startedDateTime)).filter((x) => !isNaN(x)));
const recs = [];
for (const e of entries) {
  const startMs = Date.parse(e.startedDateTime);
  if (isNaN(startMs)) continue;
  const tm = e.timings || {};
  const total = Number(e.time) || 0;
  /* Nhóm thời gian theo HAR: blocked (chờ hàng đợi của trình duyệt) rất hay bị bỏ qua —
   * nếu blocked lớn thì "chậm" là do CHÍNH TRÌNH DUYỆT xếp hàng, không phải server. */
  const blocked = Math.max(0, Number(tm.blocked) || 0);
  const dns = Math.max(0, Number(tm.dns) || 0);
  const connect = Math.max(0, Number(tm.connect) || 0);
  const send = Math.max(0, Number(tm.send) || 0);
  const wait = Math.max(0, Number(tm.wait) || 0);
  const receive = Math.max(0, Number(tm.receive) || 0);
  const ssl = Math.max(0, Number(tm.ssl) || 0);
  recs.push({
    e, url: e.request && e.request.url || '',
    method: (e.request && e.request.method) || 'GET',
    status: (e.response && e.response.status) || 0,
    path: normPath(e.request && e.request.url || ''),
    start: startMs - t0, end: startMs - t0 + total, total,
    blocked, dns, connect, send, wait, receive, ssl: Math.min(ssl, connect),
    size: (e.response && e.response.content && Number(e.response.content.size)) || 0,
  });
}
recs.sort((a, b) => a.start - b.start);

/* ───────── 0. BỨC TRANH TỔNG ───────── */
const span = Math.max(...recs.map((r) => r.end)) - Math.min(...recs.map((r) => r.start));
const busy = sum(recs.map((r) => r.total));
const waits = recs.map((r) => r.wait);

/* Khoảng trống: hợp của các khoảng [start,end] rồi lấy phần bù. */
const iv = recs.map((r) => [r.start, r.end]).sort((a, b) => a[0] - b[0]);
let gap = 0, cur = iv[0] && iv[0][0];
let mergedEnd = iv[0] ? iv[0][1] : 0;
for (const [s, e] of iv) {
  if (s > mergedEnd) { gap += s - mergedEnd; mergedEnd = e; }
  else mergedEnd = Math.max(mergedEnd, e);
}

/* Concurrency theo thời điểm: quét điểm đầu/cuối. */
const ev = [];
recs.forEach((r) => { ev.push([r.start, 1]); ev.push([r.end, -1]); });
ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
let live = 0, maxLive = 0; const liveSamples = [];
for (const [t, d] of ev) { live += d; if (d === 1) { maxLive = Math.max(maxLive, live); liveSamples.push(live); } }

const totalWait = sum(waits);
const totalBlocked = sum(recs.map((r) => r.blocked));
console.log('══ TỔNG QUAN ═══════════════════════════════════════════════');
console.log('File            : ' + file);
console.log('Số lệnh         : ' + recs.length);
console.log('Khoảng thời gian: ' + fmt(span) + '  (từ lệnh đầu tới lệnh cuối xong)');
console.log('');
console.log('Chia nguồn gốc thời gian (cộng dồn mọi lệnh):');
const share = (x) => span ? ((x / span) * 100).toFixed(1) + '%' : '—';
console.log('  · chờ SERVER trả lời (wait) : ' + fmt(totalWait) + '   ' + share(totalWait));
console.log('  · KHÔNG có lệnh nào đang bay: ' + fmt(gap) + '   ' + share(gap) + '   ← phía MÁY tự bỏ ra');
console.log('  · trình duyệt xếp hàng      : ' + fmt(totalBlocked) + '   ' + share(totalBlocked));
console.log('  · tải/nhận dữ liệu (receive): ' + fmt(sum(recs.map((r) => r.receive))));
console.log('  · DNS + kết nối + TLS       : ' + fmt(sum(recs.map((r) => r.dns + r.connect + r.send))));
console.log('');
console.log('Độ song song (số lệnh đang bay):');
console.log('  p50 ' + pct(liveSamples, 0.5) + ' · p90 ' + pct(liveSamples, 0.9) + ' · max ' + maxLive);
console.log('');
const verdict = [];
if (gap > span * 0.4) verdict.push('PHẦN LỚN thời gian là MÁY CHỜ, không phải server chậm');
if (totalWait > span * 0.5) verdict.push('PHẦN LỚN thời gian là CHỜ SERVER');
if (pct(liveSamples, 0.5) <= 1) verdict.push('gần như TUẦN TỰ (p50 song song = 1)');
if (totalBlocked > span * 0.2) verdict.push('trình duyệt xếp hàng nhiều (blocked cao)');
console.log('⇒ ' + (verdict.length ? verdict.join(' · ') : 'không có nút thắt đơn lẻ rõ ràng'));
console.log('');

/* ───────── 1. THEO ENDPOINT ───────── */
const byPath = new Map();
for (const r of recs) {
  if (ONLY && r.path.toLowerCase().indexOf(ONLY.toLowerCase()) < 0) continue;
  const k = r.method + ' ' + r.path;
  let g = byPath.get(k);
  if (!g) { g = { n: 0, waits: [], totals: [], bad: 0 }; byPath.set(k, g); }
  g.n++; g.waits.push(r.wait); g.totals.push(r.total);
  if (r.status >= 400) g.bad++;
}
const rows = [...byPath.entries()].map(([k, g]) => ({
  k, n: g.n, bad: g.bad,
  w50: pct(g.waits, 0.5), w90: pct(g.waits, 0.9), wmax: Math.max(0, ...g.waits),
  t50: pct(g.totals, 0.5), tmax: Math.max(0, ...g.totals), wsum: sum(g.waits),
})).sort((a, b) => b.wsum - a.wsum);

console.log('══ PHẢN HỒI SERVER THEO ENDPOINT (xếp theo TỔNG thời gian chờ) ══');
console.log(pad('LỆNH', 56) + pad('n', 7) + pad('wait p50', 10) + pad('p90', 9) + pad('max', 9) + pad('tổng', 9) + 'lỗi');
for (const r of rows.slice(0, TOP)) {
  console.log(pad(r.k, 56) + pad(r.n, 7) + pad(fmt(r.w50), 10) + pad(fmt(r.w90), 9)
    + pad(fmt(r.wmax), 9) + pad(fmt(r.wsum), 9) + (r.bad ? r.bad : ''));
}
console.log('');

/* ───────── 2. NHÓM "GỬI TIN" — đúng đường người dùng hỏi ───────── */
const SEND = /messages|contents\/facebook|contents\/touch|conversations\?|threadlist|ls_req|rescue_mode/i;
const sendRows = recs.filter((r) => SEND.test(r.url));
if (sendRows.length) {
  const w = sendRows.map((r) => r.wait);
  const t = sendRows.map((r) => r.total);
  const spanSend = Math.max(...sendRows.map((r) => r.end)) - Math.min(...sendRows.map((r) => r.start));
  console.log('══ NHÓM LỆNH GỬI TIN (' + sendRows.length + ' lệnh) ══');
  console.log('  wait server : p50 ' + fmt(pct(w, 0.5)) + ' · p90 ' + fmt(pct(w, 0.9)) + ' · max ' + fmt(Math.max(...w)));
  console.log('  tổng 1 lệnh : p50 ' + fmt(pct(t, 0.5)) + ' · p90 ' + fmt(pct(t, 0.9)) + ' · max ' + fmt(Math.max(...t)));
  console.log('  trải ra     : ' + fmt(spanSend) + '  ⇒ trung bình '
    + (sendRows.length / Math.max(1, spanSend / 1000)).toFixed(1) + ' lệnh/giây');
  const statuses = new Map();
  sendRows.forEach((r) => statuses.set(r.status, (statuses.get(r.status) || 0) + 1));
  console.log('  mã HTTP     : ' + [...statuses.entries()].sort().map(([s, n]) => s + '×' + n).join(' · '));
  console.log('');
}

/* ───────── 3. TOP LỆNH CHẬM NHẤT ───────── */
console.log('══ 10 LỆNH CHẬM NHẤT (theo wait của server) ══');
recs.slice().sort((a, b) => b.wait - a.wait).slice(0, 10).forEach((r) => {
  console.log('  ' + pad(fmt(r.wait), 8) + pad('+' + fmt(r.blocked), 9) + pad(r.status, 6)
    + pad('+' + (r.start / 1000).toFixed(1) + 's', 11) + r.method + ' ' + r.path);
});
console.log('');
console.log('Ghi chú: `wait` = chờ máy chủ; `+blocked` = thời gian trình duyệt xếp hàng TRƯỚC lệnh đó.');
