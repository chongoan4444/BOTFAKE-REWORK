/**
 * KIỂM ĐÚNG ĐẮN của highlightRows() sau khi đổi sang tra id (v1.92.58).
 * Không phải bench: so class được tô với tập mong đợi, trên DOM có đủ các ca khó:
 *   • id nằm ở div cha            • id có hậu tố __2            • dòng có khung [role=row]
 *   • dòng không có trong lựa chọn  • chat đã bỏ tick            • mark = start/end/target
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const NEW = readFileSync('/home/user/BOTFAKE-REWORK/scripts/pancake-send-lite.user.js', 'utf8');
const OLD = readFileSync('/tmp/ext_old_19256.js', 'utf8');

const PAGE = `<!doctype html><html><body><div id="conversationList"></div><script>
window.__pancakeReduxStore__ = { getState: () => ({ conversations: { data: [], filteredConversationsCloneList: [], filteredTag: 'ALL' },
  pages: { currentPageId: '694078980461601', currentSettings: {}, activated: [] }, messages: {}, auth: {} }) };
const img = document.createElement('img');
img.src = '/a.jpg?access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnopqrstuvwxyz';
document.body.appendChild(img);
window.__MqttHelper__ = { SOCKETS: {}, initSocket: () => Promise.resolve() };
window.__ExtensionAdapter__ = { send: () => Promise.resolve({ ok: true }) };
document.addEventListener('DOMContentLoaded', () => {});
</script></body></html>`;

const browser = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/extralibs/lib' } });
const ctx = await browser.newContext();
await ctx.route('**/*', (r) => r.request().resourceType() === 'document'
  ? r.fulfill({ status: 200, contentType: 'text/html', body: PAGE })
  : r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));
/* Trích hàm highlightRows từ MỖI bản rồi chạy trực tiếp trên state/DOM của trang thật:
 * cùng dữ liệu vào ⇒ so kết quả tô. Đây là phép so đúng đắn (không phải cảm giác nhanh/chậm). */
function bodyOf(src) {
  const i = src.indexOf('function highlightRows(');
  if (i < 0) throw new Error('không thấy highlightRows');
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(src.indexOf('{', i) + 1, k); }
  }
  throw new Error('không cân ngoặc');
}

async function run(src, body) {
const page = await ctx.newPage();
await page.goto('https://pancake.vn/694078980461601/x', { waitUntil: 'domcontentloaded' });
await page.addScriptTag({ content: src });
await page.waitForFunction(() => !!window.__SSB__);
await page.evaluate((b) => {
  console.log("HLDEPS", !!window.__SSB__, Object.keys(window.__SSB__ || {}).slice(0,20).join(","));
  window.__runHighlight__ = new Function('state', '$$', 'rowInfo', 'markOf', 'hlClassSeen',
    'function highlightRows() {' + b + '} return highlightRows;')(
    window.__SSB__.state, window.__SSB__.__hlDeps.$$, window.__SSB__.__hlDeps.rowInfo,
    window.__SSB__.__hlDeps.markOf, window.__SSB__.__hlDeps.hlClassSeen);
}, body);

const res = await page.evaluate(() => {
  const P = '694078980461601_';
  /* 6 dòng thử:
   *  r1: id ở div cha, có [role=row] ngoài cùng      → trong lựa chọn, có mark  ⇒ TARGET
   *  r2: id ngay trên .conversation-list-item          → trong lựa chọn, không mark ⇒ MATCH
   *  r3: id có hậu tố __2                              → trong lựa chọn ⇒ MATCH
   *  r4: trong lựa chọn nhưng ĐÃ BỎ TICK               → KHÔNG tô
   *  r5: không có trong lựa chọn                       → KHÔNG tô
   *  r6: knownUnavailable                              → KHÔNG tô
   */
  const holder = document.getElementById('conversationList');
  const mk = (html) => { const d = document.createElement('div'); d.innerHTML = html; holder.appendChild(d); return d; };
  mk('<div role="row" id="' + P + 'r1"><div class="media conversation-list-item">' +
     '<span class="name-text">A</span><span class="snippet-text">s</span><span class="time-modul">1</span></div></div>');
  mk('<div class="media conversation-list-item" id="' + P + 'r2">' +
     '<span class="name-text">B</span><span class="snippet-text">s</span></div>');
  mk('<div class="media conversation-list-item" id="' + P + 'r3__2">' +
     '<span class="name-text">C</span><span class="snippet-text">s</span></div>');
  mk('<div class="media conversation-list-item" id="' + P + 'r4">' +
     '<span class="name-text">D</span><span class="snippet-text">s</span></div>');
  mk('<div class="media conversation-list-item" id="' + P + 'r5">' +
     '<span class="name-text">E</span><span class="snippet-text">s</span></div>');
  mk('<div class="media conversation-list-item" id="' + P + 'r6">' +
     '<span class="name-text">F</span><span class="snippet-text">s</span></div>');

  const S = window.__SSB__.state;
  S.enabled = true;
  S.sendListFrozen = false;
  S.matches = [
    { id: P + 'r1', checked: true, mark: 'start' },
    { id: P + 'r2', checked: true, mark: '' },
    { id: P + 'r3', checked: true, mark: 'target' },
    { id: P + 'r4', checked: false, mark: '' },
    { id: P + 'r6', checked: true, knownUnavailable: true, mark: '' },
  ];
  /* Dọn lớp tô cũ (nếu có) để phép so không dính dư âm của lần chạy trước. */
  holder.querySelectorAll('.ssb-m-target,.ssb-m-match').forEach((e) => e.classList &&
    e.classList.remove('ssb-m-target', 'ssb-m-match'));
  /* Bản cũ KHÔNG export highlightRows ⇒ không gọi được từ ngoài. Cả 2 bản chạy CÙNG một file
   * thử bằng cách thay body của highlightRows bằng bản cũ/mới trích ra (xem below). */
  window.__runHighlight__();

  const cls = (el) => el ? (el.className || '') : '';
  const kind = (c) => (c.indexOf('ssb-m-target') >= 0 ? 'TARGET' : c.indexOf('ssb-m-match') >= 0 ? 'MATCH' : 'none');
  const rows = Array.from(holder.querySelectorAll('.conversation-list-item'));
  const got = rows.map((r, i) => kind(cls(r)));
  const rowOuter = kind(cls(holder.querySelector('[role=row]')));
  return { got, rowOuter, ids: rows.map((r) => r.id) };
});
await page.close();
return res;
}

const oldRes = await run(OLD, bodyOf(OLD));
const res = await run(NEW, bodyOf(NEW));

const fmt = (r) => r.got.join(' ');
console.log('  bản CŨ  (1.92.56): ' + fmt(oldRes) + '  | role=row: ' + oldRes.rowOuter);
console.log('  bản MỚI (1.92.58): ' + fmt(res) + '  | role=row: ' + res.rowOuter);
const ok = fmt(oldRes) === fmt(res) && oldRes.rowOuter === res.rowOuter;
console.log(ok ? '  ✓ HAI BẢN TÔ GIỐNG NHAU TỪNG DÒNG — đổi sang tra id không đổi kết quả'
               : '  ✗ KHÁC NHAU — đổi sang tra id đã làm đổi kết quả tô màu');
await browser.close();
process.exit(ok ? 0 : 1);
