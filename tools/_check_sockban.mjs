/** KIỂM HÀNH VI: cái gì mới được phép gỡ Socket khỏi làn gửi.
 *  Trước 1.92.62: 2 ca "hội thoại không đổi" (khách vắng) ⇒ né Socket cả page  → MẤT TIN.
 *  Sau 1.92.62: chỉ 2 ca SOCKET thật sự đánh rơi tin mới gỡ.
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const SRC = readFileSync('/home/user/BOTFAKE-REWORK/scripts/pancake-send-lite.user.js', 'utf8');
const PAGE = `<!doctype html><html><body><div id="conversationList"></div><script>
const dl=document.getElementById('conversationList');
for(let i=0;i<5;i++){const r=document.createElement('div');r.id='694078980461601_'+(200000+i);dl.appendChild(r);}
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
  const M = window.__SSB__;
  const T = M.__sockTest;
  const R = {};
  const PID = '694078980461601';
  // (1) 3 ca "hội thoại không đổi" (khách vắng mặt) — KHÔNG được né Socket
  for (let i = 0; i < 3; i++) T.noteAbsent(PID);
  R['3 ca khách vắng (absent) ⇒ Socket còn dùng được?'] = T.usable(PID);
  R['  sổ ghi nhận'] = T.stats(PID);
  // (2) 1 ca SOCKET thật sự đánh rơi tin — vẫn còn dùng (ngưỡng 2)
  T.noteLostSock(PID);
  R['1 ca lostSock ⇒ Socket còn dùng được?'] = T.usable(PID);
  // (3) 2 ca lostSock ⇒ né
  T.noteLostSock(PID);
  R['2 ca lostSock ⇒ Socket còn dùng được?'] = T.usable(PID);
  R['  lý do né'] = T.skipReason(PID);
  // (4) một lần giao được ⇒ tự hồi
  T.noteDlv(PID);
  R['giao được 1 lần ⇒ Socket còn dùng được?'] = T.usable(PID);
  R['  sổ sau khi hồi'] = T.stats(PID);
  // (5) lostExt không bao giờ ban Socket
  T.noteLostExt(PID); T.noteLostExt(PID); T.noteLostExt(PID);
  R['5 ca Extension không tới ⇒ Socket còn dùng được?'] = T.usable(PID);
  return R;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
