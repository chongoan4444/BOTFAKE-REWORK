/** Đo flushLogUI / render THẬT trong trang có panel shadow DOM + danh sách chat + app. */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const SRC = readFileSync('/home/user/BOTFAKE-REWORK/scripts/pancake-send-lite.user.js', 'utf8');
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
 body{margin:0;font:12px system-ui}
 #conversationList{width:340px;height:1000px;overflow:auto;float:left}
 .conversation-list-item{display:flex;gap:6px;padding:8px;border-bottom:1px solid #eee;height:46px;box-sizing:border-box}
 #app{width:760px;height:1000px;overflow:auto;float:left}
 .arow{padding:6px;border-bottom:1px solid #eee}
</style></head><body>
<div id="conversationList"></div><div id="app"></div>
<script>
(function(){
  const holder = document.getElementById('conversationList');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 40; i++) {
    const row = document.createElement('div');
    row.id = '694078980461601_' + (200000 + i);
    row.innerHTML = '<div class="media conversation-list-item"><div class="tag-wrap"><img src="/icons/envelope.svg"></div>'
      + '<img src="https://cdn.pancake.vn/pages/694078980461601/avatar/x.jpg">'
      + '<div><span class="name-text">Khách ' + i + '</span><span class="snippet-text">Tin ' + i + '</span>'
      + '<span class="time-modul">10:2' + (i % 6) + '</span></div></div>';
    frag.appendChild(row);
  }
  holder.appendChild(frag);
  const app = document.getElementById('app');
  for (let i = 0; i < 1500; i++) { const d = document.createElement('div'); d.className = 'arow'; d.textContent = 'Hội thoại dòng ' + i + ' — ' + 'x'.repeat(40); app.appendChild(d); }
  const data = [];
  for (let i = 0; i < 12000; i++) data.push({ id: '694078980461601_' + (200000 + i), page_id: '694078980461601', thread_id: 't' + i, type: 'INBOX', snippet: 'x', customers: [{ id: 'c', fb_id: 'f' + i, global_id: 'g' + i, ad_clicks: [] }] });
  window.__pancakeReduxStore__ = { getState: () => ({ conversations: { data, filteredConversationsCloneList: data, filteredTag: 'ALL' },
    pages: { currentPageId: '694078980461601', currentSettings: {}, activated: [] }, messages: {}, auth: {} }) };
  const img = document.createElement('img'); img.src = '/a.jpg?access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnopqrstuvwxyz';
  document.body.appendChild(img);
  window.__MqttHelper__ = { SOCKETS: {}, initSocket: () => Promise.resolve() };
  window.__ExtensionAdapter__ = { send: () => Promise.resolve({ ok: true }) };
})();
</script></body></html>`;

const browser = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/extralibs/lib' } });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.route('**/*', (r) => r.request().resourceType() === 'document'
  ? r.fulfill({ status: 200, contentType: 'text/html', body: PAGE })
  : r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));
const page = await ctx.newPage();
await page.goto('https://pancake.vn/694078980461601/x', { waitUntil: 'domcontentloaded' });
await page.addScriptTag({ content: SRC });
await page.waitForFunction(() => !!window.__SSB__);

const out = await page.evaluate(() => {
  const S = window.__SSB__.state;
  S.log = [];
  for (let i = 0; i < 1500; i++) S.log.push('[10:00:' + String(i % 60).padStart(2, '0') + '] dòng log thứ ' + i + ' — ✅ đã gửi chat 694078980461601_' + (300000 + i));
  const host = document.getElementById('ssb-root');
  const sr = host.shadowRoot;
  const el = sr.getElementById('ssb-log');
  const med = (f, k = 7) => { const a = []; for (let i = 0; i < k; i++) a.push(f()); a.sort((x, y) => x - y); return +a[Math.floor(k / 2)].toFixed(2); };
  // ĐÚNG hai phép bản 1.92.58 làm trong render() + flushLogUI()
  const textOnly = () => { const t = performance.now(); el.textContent = S.log.join('\n'); return performance.now() - t; };
  const joinOnly = () => { const t = performance.now(); void S.log.join('\n'); return performance.now() - t; };
  const readSH = () => { const t = performance.now(); void (el.scrollHeight - el.scrollTop - el.clientHeight); return performance.now() - t; };
  const scrollOnly = () => { const t = performance.now(); el.scrollTop = 1e9; return performance.now() - t; };
  const withLayoutRead = () => { const t = performance.now(); el.textContent = S.log.join('\n'); el.scrollTop = el.scrollHeight; return performance.now() - t; };
  const R = {};
  const wrap = sr.getElementById('ssb-logwrap');
  // (A) BỐ CỤC BẢN 1.92.58: khung log HIỆN trong panel, panel MỞ  ← đúng ca người dùng báo lag
  if (wrap) wrap.style.display = 'block';
  R['A. panel MỞ + khung log HIỆN (bố cục 1.92.58)'] = { textOnly: med(textOnly), withLayoutRead: med(withLayoutRead),
    joinOnly: med(joinOnly), readSH_stable: med(readSH), readSH_afterText: med(() => { textOnly(); return readSH(); }),
    scrollOnly: med(scrollOnly) };
  // (B) panel MỞ nhưng khung log ẨN  ← bố cục 1.92.61
  if (wrap) wrap.style.display = 'none';
  R['B. panel MỞ + khung log ẨN (bố cục 1.92.61)'] = { textOnly: med(textOnly), withLayoutRead: med(withLayoutRead) };
  // (C) ĐÓNG PANEL hẳn (bấm ✕) — khung log vẫn hiện nhưng cả panel bị display:none
  if (wrap) wrap.style.display = 'block';
  host.style.display = 'none';
  R['C. panel ĐÓNG hẳn (bấm ✕)'] = { textOnly: med(textOnly), withLayoutRead: med(withLayoutRead) };
  host.style.display = '';
  return R;
});
console.log('══ CÙNG đoạn mã, CÙNG 1 500 dòng log — chỉ khác panel MỞ/ĐÓNG ══');
for (const [k, v] of Object.entries(out)) {
  console.log(`  ${k}`); for (const [kk, vv] of Object.entries(v)) console.log(`      ${kk.padEnd(20)} ${String(vv).padStart(8)} ms`);
}
await browser.close();
