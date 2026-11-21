/** KIỂM: bỏ phân luồng 2 tab — mọi tab dùng hết slot, bất kể tab ẩn/không focus/bao nhiêu tab. */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const SRC = readFileSync('/home/user/BOTFAKE-REWORK/scripts/pancake-send-lite.user.js', 'utf8');
const PAGE = `<!doctype html><html><body><div id="conversationList"></div><script>
document.getElementById('conversationList').innerHTML = '<div id="694078980461601_1"></div>';
window.__pancakeReduxStore__={getState:()=>({conversations:{data:[],filteredConversationsCloneList:[],filteredTag:'ALL'},
 pages:{currentPageId:'694078980461601',currentSettings:{},activated:[]},messages:{},auth:{}})};
window.__MqttHelper__={SOCKETS:{},initSocket:()=>Promise.resolve()};
</script></body></html>`;
const b = await chromium.launch({ executablePath:'/tmp/chromium', args:['--no-sandbox','--disable-dev-shm-usage'],
  env:{...process.env, LD_LIBRARY_PATH:'/tmp/extralibs/lib'} });
const ctx = await b.newContext();
await ctx.route('**/*', r => r.request().resourceType()==='document'
  ? r.fulfill({status:200,contentType:'text/html',body:PAGE}) : r.fulfill({status:200,body:'{"success":true}'}));
const page = await ctx.newPage();
await page.addScriptTag({ content: SRC });
await page.waitForFunction(() => !!window.__SSB__);
const out = await page.evaluate(() => {
  const C = window.__SSB__.__slotTest.compute;
  const R = {};
  R['0 tab khác']                      = C(192, 0);
  R['1 tab khác · tab này ĐANG XEM']    = C(192, 1, { focused: true });
  R['1 tab khác · tab này ẨN']          = C(192, 1, { focused: false });
  R['2 tab khác · tab này ẨN']          = C(192, 2, { focused: false });
  R['2 tab khác · đang xem']            = C(192, 2, { focused: true });
  R['3 tab khác · không focus']         = C(192, 3, { focused: false });
  // chốt: mọi cấu hình đều phải bằng baseCap
  const caps = Object.values(R).map((v) => v.cap);
  R['__chốt: mọi cấu hình dùng hết slot?'] = caps.every((c) => c === 192);
  return R;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
