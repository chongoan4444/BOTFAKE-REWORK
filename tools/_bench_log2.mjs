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
  S.matches = [{ id: '694078980461601_200000', checked: true }];
  const sr = document.getElementById('ssb-root').shadowRoot;
  const el = sr.getElementById('ssb-log');
  const R = {};
  const time = (f, k = 10) => { f(); const t = performance.now(); for (let i = 0; i < k; i++) f(); return (performance.now() - t) / k; };

  // gọi ĐÚNG các hàm thật qua đường công khai
  R.render = time(() => { S.log = S.log; window.__SSB__.render ? window.__SSB__.render() : null; });
  R.flushLogUI = time(() => { try { window.__SSB__._flushLogUI(); } catch (e) {} });

  // và tách thành phần trong CHÍNH trang này
  R.textContent = time(() => { el.textContent = S.log.join('\n'); });
  R.textContentPlusScroll = time(() => { el.textContent = S.log.join('\n'); el.scrollTop = el.scrollHeight; });
  R.textContentPlusNearBottom = time(() => { el.textContent = S.log.join('\n'); void (el.scrollHeight - el.scrollTop - el.clientHeight) <= 48; });
  R.noText = time(() => { /* chỉ để so */ });
  return R;
});
console.log('══ trong trang THẬT có panel + app (1 500 dòng log) ══');
for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(24)} ${v.toFixed(2)} ms`);
await browser.close();
