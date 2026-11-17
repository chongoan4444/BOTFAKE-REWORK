/** CHỨNG MINH nhân quả: CÙNG đoạn mã, chỉ khác panel đang MỞ hay ĐÓNG.
 *  Đo đúng 2 phép mà render()/flushLogUI() bản 1.92.58 làm:
 *     (1) el.textContent = state.log.join('\n')   — 1 500 dòng
 *     (2) el.scrollTop = el.scrollHeight          — ĐỌC layout
 */
import { chromium } from 'playwright-core';
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
 body{margin:0;font:12px system-ui}
 #conversationList{width:340px;height:900px;overflow:auto;float:left}
 .row{padding:8px;border-bottom:1px solid #eee;height:46px;box-sizing:border-box}
 #app{width:760px;height:900px;overflow:auto;float:left}
 .m{padding:6px;border-bottom:1px solid #eee}
 /* panel fixed + shadow-box như panel thật */
 #host{position:fixed;right:16px;top:60px;width:380px;max-height:70vh;background:#0f172a;color:#e2e8f0;
       border:1px solid #334155;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.55);
       display:flex;flex-direction:column;overflow:hidden}
 #log{background:#0b1220;overflow:auto;white-space:pre-wrap;word-break:break-word;
      font-size:10.5px;line-height:1.55;min-height:120px;max-height:min(340px,42vh);padding:8px}
</style></head><body>
<div id="conversationList"></div><div id="app"></div>
<div id="host"><div id="log"></div></div>
<script>
const L=document.getElementById('conversationList');
for(let i=0;i<40;i++){const d=document.createElement('div');d.className='row';
 d.innerHTML='<b>Khách '+i+'</b><br>Tin nhắn cuối '+i;L.appendChild(d);}
const A=document.getElementById('app');
for(let i=0;i<1500;i++){const d=document.createElement('div');d.className='m';d.textContent='Hội thoại dòng '+i+' — '+'x'.repeat(40);A.appendChild(d);}
window.__L=[];for(let i=0;i<1500;i++)window.__L.push('[18:57:0'+(i%10)+'] dòng log thứ '+i+' — ✅ đã gửi chat 694078980461601_'+(300000+i));
window.__M={};
// (1) chỉ gán chữ
window.__M.textOnly = () => { const t=performance.now(); document.getElementById('log').textContent = window.__L.join('\\n'); return performance.now()-t; };
// (2) gán chữ RỒI đọc scrollHeight (đúng như bản cũ)
window.__M.withLayoutRead = () => { const t=performance.now(); const el=document.getElementById('log');
  el.textContent = window.__L.join('\\n'); el.scrollTop = el.scrollHeight; return performance.now()-t; };
</script></body></html>`;
const b = await chromium.launch({ executablePath:'/tmp/chromium', args:['--no-sandbox','--disable-dev-shm-usage'],
  env:{...process.env, LD_LIBRARY_PATH:'/tmp/extralibs/lib'} });
const ctx = await b.newContext({ viewport:{width:1400,height:1000} });
await ctx.route('**/*', r => r.request().resourceType()==='document'
  ? r.fulfill({status:200,contentType:'text/html',body:PAGE}) : r.fulfill({status:200,body:'{}'}));
const p = await ctx.newPage();
await p.goto('https://pancake.vn/694078980461601/x', { waitUntil:'domcontentloaded' });
const out = await p.evaluate(() => {
  const med = (f, k=7) => { const a=[]; for(let i=0;i<k;i++) a.push(f()); a.sort((x,y)=>x-y); return +a[Math.floor(k/2)].toFixed(2); };
  const R = {};
  // PANEL ĐANG MỞ
  R.panelOpen = { textOnly: med(window.__M.textOnly), withLayoutRead: med(window.__M.withLayoutRead) };
  // ĐÓNG PANEL  (đúng như bấm nút ✕ — host display:none)
  document.getElementById('host').style.display = 'none';
  R.panelClosed = { textOnly: med(window.__M.textOnly), withLayoutRead: med(window.__M.withLayoutRead) };
  return R;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
