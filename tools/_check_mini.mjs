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
  const mini = sr.getElementById('ssb-mini'); // [v1.92.61] phải là null
  const logEl = sr.getElementById('ssb-log');
  const wrap = sr.getElementById('ssb-logwrap');
  R.hasMiniPanelStrip = !!mini;                       // mong đợi: false
  R.hasProgressUnderRunBtn = !!sr.getElementById('ssb-bar') && !!sr.getElementById('ssb-progstat');
  R.logHiddenInPanel = wrap ? wrap.style.display === 'none' : 'khong-co-wrap';
  const badge0 = sr.getElementById('ssb-bubble-badge');
  R.badgeInitial = badge0.style.display + ' · ' + badge0.textContent;

  // 1) CHỌN 3 chat ⇒ dải phải hiện "3 chat đang chọn"
  S.matches = [
    { id: '694078980461601_200000', checked: true, name: 'A' },
    { id: '694078980461601_200001', checked: true, name: 'B' },
    { id: '694078980461601_200002', checked: true, name: 'C' },
  ];
  window.__SSB__.render();
  R.badgeAfterSelect = badge0.style.display + ' · ' + badge0.textContent + ' · ' + badge0.className;

  // 2) GIA LẬP LÔ ĐANG GỬI: 10 chat, 4 đã xong
  const bs = window.__SSB__.batchStats;
  bs.total = 10;
  window.__SSB__.summaryCounters.okApi = 4;
  window.__SSB__.flushBatchSummaryUI ? window.__SSB__.flushBatchSummaryUI() : window.__SSB__.render();
  R.badgeSending = badge0.style.display + ' · ' + badge0.textContent + ' · ' + badge0.className;
  R.barUnderRunBtn = sr.getElementById('ssb-bar').style.width + ' · ' + sr.getElementById('ssb-progstat').textContent;

  // 3) XONG LÔ
  bs.loopFinished = true;
  window.__SSB__.summaryCounters.okApi = 8;
  window.__SSB__.summaryCounters.fail = 2;
  window.__SSB__.flushBatchSummaryUI ? window.__SSB__.flushBatchSummaryUI() : window.__SSB__.render();
  R.badgeDone = badge0.style.display + ' · ' + badge0.textContent + ' · ' + badge0.className;

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

  // 7) THU NHỎ PANEL ⇒ badge trên BÓNG LOGO hiện số tiến trình
  const badge = sr.getElementById('ssb-bubble-badge');
  sr.getElementById('ssb-min').click();
  await new Promise((r) => setTimeout(r, 200));
  R.bubbleVisible = sr.getElementById('ssb-bubble').style.display;
  R.panelHidden = sr.getElementById('ssb-wrap').style.display;
  R.bubbleBadge = badge.style.display + ' · ' + badge.textContent + ' · ' + badge.className;
  bs.loopFinished = false;
  window.__SSB__.summaryCounters.okApi = 5;
  window.__SSB__.flushBatchSummaryUI();
  R.bubbleBadgeSending = badge.style.display + ' · ' + badge.textContent + ' · ' + badge.className;
  bs.loopFinished = true;
  window.__SSB__.summaryCounters.okApi = 10;
  window.__SSB__.summaryCounters.fail = 0;
  window.__SSB__.flushBatchSummaryUI();
  R.bubbleBadgeDone = badge.style.display + ' · ' + badge.textContent + ' · ' + badge.className;
  /* [v1.92.64] Đọc THÊM cỡ chữ thật của badge + bề rộng/khoảng ló để chứng minh "to hơn"
   * và "không tràn màn hình". Đây là số đo trong DOM thật, không phải suy từ CSS. */
  try {
    const cs = getComputedStyle(badge);
    const rb = badge.getBoundingClientRect();
    R.bubbleBadgeFont = cs.fontSize + ' · bề rộng ' + Math.round(rb.width) + 'px'
      + ' · ló trái ' + Math.round(rb.left) + 'px · ló phải '
      + Math.round(window.innerWidth - rb.right) + 'px';
  } catch (e) { R.bubbleBadgeFont = 'lỗi: ' + e.message; }
  // ca xấu nhất: lô 14 815 chat ⇒ phải thu chữ / kéo vào trong
  bs.total = 14815;
  window.__SSB__.summaryCounters.okApi = 14815;
  window.__SSB__.flushBatchSummaryUI();
  try {
    const cs2 = getComputedStyle(badge);
    const rb2 = badge.getBoundingClientRect();
    R.bubbleBadgeBig = badge.textContent + ' · chữ ' + cs2.fontSize + ' · bề rộng ' + Math.round(rb2.width)
      + 'px · ló phải ' + Math.round(window.innerWidth - rb2.right) + 'px'
      + ' · transform ' + (badge.style.transform || '(không)');
  } catch (e) { R.bubbleBadgeBig = 'lỗi: ' + e.message; }
  return R;
});
console.log(JSON.stringify(out, null, 1));
if (errs.length) console.log('LỖI TRANG:', errs.slice(0,3));
await b.close();
