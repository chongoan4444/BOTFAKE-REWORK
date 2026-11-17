/** KIỂM ĐÚNG ĐẮN cho thay đổi 1.92.59: log hiển thị đúng đuôi, copy vẫn đủ, không cuộn sai. */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const SRC = readFileSync('/home/user/BOTFAKE-REWORK/scripts/pancake-send-lite.user.js', 'utf8');
const PAGE = `<!doctype html><html><body>
<div id="conversationList" style="width:340px;height:900px;overflow:auto"></div>
<div id="app"></div>
<script>
 const dl=document.getElementById('conversationList');
 for(let i=0;i<40;i++){const r=document.createElement('div');r.id='694078980461601_'+(200000+i);
   r.innerHTML='<div class="media conversation-list-item"><img src="/i.svg"></div>';dl.appendChild(r);}
 const data=[];for(let i=0;i<200;i++)data.push({id:'694078980461601_'+(200000+i),page_id:'694078980461601',thread_id:'t'+i,
   customers:[{id:'c',fb_id:'f'+i,global_id:'g'+i,ad_clicks:[]}]});
 window.__pancakeReduxStore__={getState:()=>({conversations:{data,filteredConversationsCloneList:data,filteredTag:'ALL'},
   pages:{currentPageId:'694078980461601',currentSettings:{},activated:[]},messages:{},auth:{}})};
 window.__MqttHelper__={SOCKETS:{},initSocket:()=>Promise.resolve()};
</script></body></html>`;
const b = await chromium.launch({ executablePath:'/tmp/chromium', args:['--no-sandbox','--disable-dev-shm-usage'],
  env:{...process.env, LD_LIBRARY_PATH:'/tmp/extralibs/lib'} });
const ctx = await b.newContext({ viewport:{width:1400,height:1000} });
await ctx.route('**/*', r => r.request().resourceType()==='document'
  ? r.fulfill({status:200,contentType:'text/html',body:PAGE}) : r.fulfill({status:200,body:'{"success":true}'}));
const page = await ctx.newPage();
await page.goto('https://pancake.vn/694078980461601/x', { waitUntil:'domcontentloaded' });
await page.addScriptTag({ content: SRC });
await page.waitForFunction(() => !!window.__SSB__);
const r = await page.evaluate(async () => {
  const S = window.__SSB__.state;
  const sr = document.getElementById('ssb-root').shadowRoot;
  const el = sr.getElementById('ssb-log');
  S.log = [];
  for (let i = 0; i < 1500; i++) S.log.push('DONG ' + i);
  // gọi đường thật: thêm 1 dòng qua logLine rồi chờ gộp 200 ms
  window.__SSB__.logLine ? window.__SSB__.logLine('DONG CUOI') : null;
  await new Promise((res) => setTimeout(res, 600));
  const txt = el.textContent;
  const lines = txt.split('\n');
  return {
    paintedLines: lines.length,
    hasHeader: /dòng trước — bấm/.test(txt),
    lastPainted: lines[lines.length - 1],
    hasFirst: /DONG 0$/.test(txt),
    scrollAtBottom: Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) <= 2,
    logAllCount: window.__SSB__.logAll ? window.__SSB__.logAll.length : -1,
  };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
