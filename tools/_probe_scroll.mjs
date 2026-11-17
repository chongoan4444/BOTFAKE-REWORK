import { chromium } from 'playwright-core';
const PAGE = `<!doctype html><html><body>
<div id="list" style="width:340px;height:900px;overflow:auto;float:left"></div>
<div id="app" style="width:700px;height:900px;overflow:auto;float:left"></div>
<div id="lg" style="width:360px;height:340px;overflow:auto;white-space:pre-wrap;font-size:10.5px;line-height:1.55;float:left"></div>
<script>
const L=document.getElementById('list'), A=document.getElementById('app'), G=document.getElementById('lg');
for(let i=0;i<40;i++){const d=document.createElement('div');d.style.height='46px';d.textContent='chat '+i;L.appendChild(d);}
for(let i=0;i<1500;i++){const d=document.createElement('div');d.textContent='Hội thoại dòng '+i+' — '+'x'.repeat(40);A.appendChild(d);}
window.__L=[];for(let i=0;i<1500;i++)window.__L.push('[10:00:00] dòng log thứ '+i+' — ✅ đã gửi chat 694078980461601_'+(300000+i));
window.__M={};
window.__M.writeText = () => { G.textContent = window.__L.join('\\n'); };
window.__M.tReadSH = () => { const t=performance.now(); void G.scrollHeight; return performance.now()-t; };
window.__M.tScrollBottom = () => { const t=performance.now(); G.scrollTop=1e9; return performance.now()-t; };
window.__M.tScrollBottomReadSH = () => { const t=performance.now(); G.scrollTop=G.scrollHeight; return performance.now()-t; };
window.__M.full = () => { const t=performance.now(); G.textContent=window.__L.join('\\n'); G.scrollTop=G.scrollHeight; return performance.now()-t; };
</script></body></html>`;
const b = await chromium.launch({ executablePath: '/tmp/chromium', args:['--no-sandbox','--disable-dev-shm-usage'], env:{...process.env, LD_LIBRARY_PATH:'/tmp/extralibs/lib'} });
const ctx = await b.newContext({ viewport:{width:1400,height:1000} });
await ctx.route('**/*', r => r.request().resourceType()==='document' ? r.fulfill({status:200,contentType:'text/html',body:PAGE}) : r.fulfill({status:200,body:'{}'}));
const p = await ctx.newPage();
await p.goto('https://pancake.vn/x');
const out = await p.evaluate(() => {
  const M = window.__M, R = {};
  const seq = (name) => { const arr=[]; for(let i=0;i<8;i++){ M.writeText(); arr.push(M[name]()); } arr.sort((a,b)=>a-b); return arr[Math.floor(arr.length/2)]; };
  R.tReadSH = seq('tReadSH');
  R.tScrollBottom = seq('tScrollBottom');
  R.tScrollBottomReadSH = seq('tScrollBottomReadSH');
  const fulls=[]; for(let i=0;i<8;i++) fulls.push(M.full()); fulls.sort((a,b)=>a-b); R.full = fulls[4];
  return R;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
