/** Kiểm dải TIẾN TRÌNH THU NHỎ + việc log KHÔNG vẽ khi cửa sổ phóng to đóng. */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const SRC = readFileSync('/home/user/BOTFAKE-REWORK/scripts/pancake-send-lite.user.js', 'utf8');
const PAGE = `<!doctype html><html><body>
<div id="conversationList" style="width:340px;height:900px;overflow:auto"></div><div id="app"></div>
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
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto('https://pancake.vn/694078980461601/x', { waitUntil:'domcontentloaded' });
await page.addScriptTag({ content: SRC });
await page.waitForFunction(() => !!window.__SSB__);

const out = await page.evaluate(async () => {
  const sr = document.getElementById('ssb-root').shadowRoot;
  const S = window.__SSB__.state;
  const R = {};
  const mini = sr.getElementById('ssb-mini');
  const logEl = sr.getElementById('ssb-log');
  const wrap = sr.getElementById('ssb-logwrap');
  R.hasMini = !!mini;
  R.logHiddenInPanel = wrap ? wrap.style.display === 'none' : 'khong-co-wrap';
  R.miniInitial = sr.getElementById('ssb-mini-ok').textContent + ' | ' + sr.getElementById('ssb-mini-sub').textContent;

  // 1) CHỌN 3 chat ⇒ dải phải hiện "3 chat đang chọn"
  S.matches = [
    { id: '694078980461601_200000', checked: true, name: 'A' },
    { id: '694078980461601_200001', checked: true, name: 'B' },
    { id: '694078980461601_200002', checked: true, name: 'C' },
  ];
  window.__SSB__.render();
  R.miniAfterSelect = sr.getElementById('ssb-mini-ok').textContent + ' | ' + sr.getElementById('ssb-mini-sub').textContent;

  // 2) GIA LẬP LÔ ĐANG GỬI: 10 chat, 4 đã xong
  const bs = window.__SSB__.batchStats;
  bs.total = 10;
  window.__SSB__.summaryCounters.okApi = 4;
  window.__SSB__.flushBatchSummaryUI ? window.__SSB__.flushBatchSummaryUI() : window.__SSB__.render();
  R.miniSending = sr.getElementById('ssb-mini-ok').textContent + ' | ' + sr.getElementById('ssb-mini-sub').textContent
    + ' | width=' + sr.getElementById('ssb-mini-fill').style.width;

  // 3) XONG LÔ
  bs.loopFinished = true;
  window.__SSB__.summaryCounters.okApi = 8;
  window.__SSB__.summaryCounters.fail = 2;
  window.__SSB__.flushBatchSummaryUI ? window.__SSB__.flushBatchSummaryUI() : window.__SSB__.render();
  R.miniDone = sr.getElementById('ssb-mini-ok').textContent + ' | ' + sr.getElementById('ssb-mini-sub').textContent
    + ' | width=' + sr.getElementById('ssb-mini-fill').style.width + ' | class=' + mini.className;

  // 4) LOG ĐÓNG ⇒ 50 dòng log mới KHÔNG được vẽ
  logEl.textContent = 'X';
  const before = logEl.textContent;
  for (let i = 0; i < 50; i++) window.__SSB__.logLine('dong thu ' + i);
  await new Promise((r) => setTimeout(r, 800));
  R.logNotPaintedWhileClosed = (logEl.textContent === before);
  R.logLineCount = (window.__SSB__.logAll || []).length;

  // 5) BẤM PHÓNG TO ⇒ log phải có nội dung
  sr.getElementById('ssb-logzoom').click();
  await new Promise((r) => setTimeout(r, 300));
  R.logPaintedWhenZoomed = (logEl.textContent || '').indexOf('dong thu 49') >= 0;
  R.logLinesWhenZoomed = (logEl.textContent || '').split('\n').length;
  // 6) THU NHỎ ⇒ ngừng vẽ
  sr.getElementById('ssb-logzoom').click();
  await new Promise((r) => setTimeout(r, 100));
  const t2 = logEl.textContent;
  for (let i = 0; i < 20; i++) window.__SSB__.logLine('sau khi thu nho ' + i);
  await new Promise((r) => setTimeout(r, 700));
  R.logNotPaintedAfterCollapse = (logEl.textContent === t2);

  // 7) BÓNG LOGO (panel thu nhỏ) phải hiện số tiến trình
  sr.getElementById('ssb-bubble-badge').style.display = 'none';
  bs.loopFinished = false;
  window.__SSB__.summaryCounters.okApi = 5;
  window.__SSB__.flushBatchSummaryUI();
  const badge = sr.getElementById('ssb-bubble-badge');
  R.bubbleBadge = badge.style.display + ' · ' + badge.textContent + ' · ' + badge.className;
  bs.loopFinished = true;
  window.__SSB__.summaryCounters.okApi = 10;
  window.__SSB__.summaryCounters.fail = 0;
  window.__SSB__.flushBatchSummaryUI();
  R.bubbleBadgeDone = badge.style.display + ' · ' + badge.textContent + ' · ' + badge.className;
  return R;
});
console.log(JSON.stringify(out, null, 1));
if (errs.length) console.log('LỖI TRANG:', errs.slice(0,3));
await b.close();
