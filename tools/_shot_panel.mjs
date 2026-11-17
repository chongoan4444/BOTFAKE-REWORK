/** Chụp panel + cửa sổ log phóng to để NHÌN bằng mắt (không chỉ tin test). */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const SRC = readFileSync('/home/user/BOTFAKE-REWORK/scripts/pancake-send-lite.user.js', 'utf8');
const PAGE = `<!doctype html><html><head><style>body{margin:0;font:13px system-ui;background:#f5f6f8}
#conversationList{width:340px;height:900px;overflow:auto;float:left;background:#fff}
#app{padding:10px;float:left;width:800px}.m{padding:8px;border-bottom:1px solid #eee}</style></head><body>
<div id="conversationList"></div><div id="app"></div>
<script>
const dl=document.getElementById('conversationList');
for(let i=0;i<40;i++){const r=document.createElement('div');r.id='694078980461601_'+(200000+i);
 r.innerHTML='<div class="media conversation-list-item" style="display:flex;gap:8px;align-items:center;padding:8px">'
 +'<img src="/i.svg" width="28" height="28"><div><b>Khách hàng '+i+'</b><br><span style="color:#888">Tin nhắn cuối '+i+'</span></div></div>';
 dl.appendChild(r);}
const ap=document.getElementById('app');for(let i=0;i<40;i++){const d=document.createElement('div');d.className='m';d.textContent='Hội thoại — dòng '+i;ap.appendChild(d);}
const data=[];for(let i=0;i<200;i++)data.push({id:'694078980461601_'+(200000+i),page_id:'694078980461601',thread_id:'t'+i,
 customers:[{id:'c',fb_id:'f'+i,global_id:'g'+i,ad_clicks:[]}]});
window.__pancakeReduxStore__={getState:()=>({conversations:{data,filteredConversationsCloneList:data,filteredTag:'ALL'},
 pages:{currentPageId:'694078980461601',currentSettings:{},activated:[]},messages:{},auth:{}})};
window.__MqttHelper__={SOCKETS:{},initSocket:()=>Promise.resolve()};
</script></body></html>`;
const b = await chromium.launch({ executablePath:'/tmp/chromium', args:['--no-sandbox'], env:{...process.env, LD_LIBRARY_PATH:'/tmp/extralibs/lib'} });
const ctx = await b.newContext({ viewport:{width:1280,height:900} });
await ctx.route('**/*', r => r.request().resourceType()==='document'
  ? r.fulfill({status:200,contentType:'text/html',body:PAGE}) : r.fulfill({status:200,body:'{"success":true}'}));
const page = await ctx.newPage();
await page.goto('https://pancake.vn/694078980461601/x', { waitUntil:'domcontentloaded' });
await page.addScriptTag({ content: SRC });
await page.waitForFunction(() => !!window.__SSB__);
// trạng thái ĐANG GỬI một lô để thấy dải tiến trình có số
await page.evaluate(() => {
  const S = window.__SSB__.state;
  S.matches = Array.from({ length: 10 }, (_, i) => ({ id: '694078980461601_' + (200000 + i), checked: true, name: 'Khách ' + i }));
  const bs = window.__SSB__.batchStats; bs.total = 137; bs.loopFinished = false;
  window.__SSB__.summaryCounters.okApi = 64; window.__SSB__.summaryCounters.fail = 3;
  for (let i = 0; i < 60; i++) window.__SSB__.logLine('✅ Đã gửi chat 694078980461601_' + (300000 + i));
  window.__SSB__.render();
  window.__SSB__.flushBatchSummaryUI();
});
await page.waitForTimeout(500);
// cuộn phần thân panel xuống đáy để thấy dải tiến trình + nút log
await page.evaluate(() => {
  const sr = document.getElementById('ssb-root').shadowRoot;
  const body = sr.querySelector('.body');
  if (body) body.scrollTop = body.scrollHeight;
});
await page.waitForTimeout(300);
await page.screenshot({ path: '/home/user/BOTFAKE-REWORK/tools/_shot_panel.png' });
// bấm phóng to log
await page.evaluate(() => document.getElementById('ssb-root').shadowRoot.getElementById('ssb-logzoom').click());
await page.waitForTimeout(500);
await page.screenshot({ path: '/home/user/BOTFAKE-REWORK/tools/_shot_logzoom.png' });
// thu nhỏ panel ⇒ bóng logo phải có số tiến trình
await page.evaluate(() => {
  const sr = document.getElementById('ssb-root').shadowRoot;
  sr.getElementById('ssb-logzoom').click();          // đóng cửa sổ log
  sr.getElementById('ssb-min').click();               // thu nhỏ panel
});
await page.waitForTimeout(400);
await page.screenshot({ path: '/home/user/BOTFAKE-REWORK/tools/_shot_bubble.png' });
console.log('đã chụp 3 ảnh');
await b.close();
