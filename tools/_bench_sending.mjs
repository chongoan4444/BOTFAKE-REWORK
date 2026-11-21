/** ĐO CA "PANEL MỞ + ĐANG GỬI" — ca người dùng báo lag khi gửi.
 *  Mô phỏng đúng nhịp thật của log trong lúc gửi (đọc từ log 19:00:48: 187 dòng log gọn
 *  trong 188 s, nhưng sổ kiểm chứng 17 406 dòng ⇒ mỗi chat chốt xong đều gọi logFailGrouped/
 *  markDelivered + render). Đo TỔNG thời gian main thread bị chiếm trong 6 s.
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const SRC = process.env.EXT_NEW || '/home/user/BOTFAKE-REWORK/scripts/pancake-send-lite.user.js';
const SCRIPT = readFileSync(SRC, 'utf8');
const PAGE = `<!doctype html><html><body>
<div id="conversationList" style="width:340px;height:900px;overflow:auto;float:left"></div>
<div id="app" style="width:760px;height:900px;overflow:auto;float:left"></div>
<script>
const dl=document.getElementById('conversationList');
for(let i=0;i<40;i++){const r=document.createElement('div');r.id='694078980461601_'+(200000+i);
 r.innerHTML='<div class="media conversation-list-item"><img src="/i.svg"></div>';dl.appendChild(r);}
const ap=document.getElementById('app');
for(let i=0;i<1500;i++){const d=document.createElement('div');d.textContent='Hội thoại dòng '+i+' — '+'x'.repeat(40);ap.appendChild(d);}
const data=[];for(let i=0;i<12000;i++)data.push({id:'694078980461601_'+(200000+i),page_id:'694078980461601',thread_id:'t'+i,
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
await page.addScriptTag({ content: SCRIPT });
await page.waitForFunction(() => !!window.__SSB__);

// Long Task observer
await page.evaluate(() => {
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ s: e.startTime, d: e.duration }); })
    .observe({ entryTypes: ['longtask'] }); } catch (e) {}
});

const out = await page.evaluate(async () => {
  const S = window.__SSB__.state;
  const M = window.__SSB__;
  // 1 500 dòng log đã có sẵn (đúng trạng thái sau một lô dài)
  S.log = [];
  for (let i = 0; i < 1500; i++) S.log.push('[18:57:0' + (i % 10) + '] dòng log cũ thứ ' + i);
  // lô đang gửi
  M.batchStats.total = 14815; M.batchStats.loopFinished = false;
  M.summaryCounters.okApi = 5000;
  M.render();
  await new Promise((r) => setTimeout(r, 300));

  const t0 = performance.now();
  window.__lt.length = 0;
  /* NHỊP THẬT khi gửi (từ log 19:00:48): 30 chat chốt xong / giây (79 lệnh/s),
   * mỗi chat ⇒ 1 dòng log + đôi khi render() + updateBatchSummaryUI.
   * Chạy 6 giây, đúng nhịp đó. */
  const PER_SEC = 30;
  const rounds = 6;
  let logs = 0, renders = 0;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < PER_SEC; i++) {
      M.logLine('✅ [' + (r * PER_SEC + i) + '/14815] chat 694078980461601_' + (300000 + r * PER_SEC + i) + ' đánh dấu ĐÃ TỚI NƠI qua socket');
      logs++;
    }
    M.summaryCounters.okApi += PER_SEC;
    // mỗi chat chốt xong đều cập nhật tiến độ (setProgress → flushProgressUi)
    try { M.flushBatchSummaryUI(); renders++; } catch (e) {}
    await new Promise((res) => setTimeout(res, 1000));
  }
  const wall = performance.now() - t0;
  const lt = window.__lt.slice();
  const busy = lt.reduce((a, e) => a + e.d, 0);
  return {
    wallMs: Math.round(wall),
    logs, renders,
    longTasks: lt.length,
    longTaskMaxMs: lt.length ? Math.round(Math.max(...lt.map((e) => e.d))) : 0,
    longTaskSumMs: Math.round(busy),
    busyPct: +((100 * busy) / wall).toFixed(1),
    panel: (() => { const sr = document.getElementById('ssb-root').shadowRoot;
      const w = sr.getElementById('ssb-logwrap'); return w ? ('logwrap display=' + (w.style.display || '(trống)')) : 'không có logwrap'; })(),
  };
});
console.log(JSON.stringify(out, null, 1));
if (errs.length) console.log('LỖI TRANG:', errs.slice(0,2));
await b.close();
