import { chromium } from 'playwright-core';
const PAGE=`<!doctype html><html><body><div id="log" style="height:340px;overflow:auto;white-space:pre-wrap;font-size:10.5px"></div><script>
window.__M={};
window.__M.textOnly=()=>{const t=performance.now();const e=document.getElementById('log');e.textContent=window.__L.join('\\n');return performance.now()-t;};
window.__M.read=()=>{const t=performance.now();void document.getElementById('log').scrollHeight;return performance.now()-t;};
window.__M.writeScroll=()=>{const t=performance.now();document.getElementById('log').scrollTop=1e9;return performance.now()-t;};
window.__L=[];for(let i=0;i<1500;i++)window.__L.push('[18:57:01] dòng log thứ '+i+' — ✅ đã gửi chat 694078980461601_'+(300000+i));
</script></body></html>`;
const b=await chromium.launch({executablePath:'/tmp/chromium',args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/tmp/extralibs/lib'}});
const ctx=await b.newContext();await ctx.route('**/*',r=>r.request().resourceType()==='document'?r.fulfill({status:200,contentType:'text/html',body:PAGE}):r.fulfill({status:200,body:'{}'}));
const p=await ctx.newPage();await p.goto('https://pancake.vn/x');
console.log(await p.evaluate(()=>{const med=(f,k=9)=>{const a=[];for(let i=0;i<k;i++)a.push(f());a.sort((x,y)=>x-y);return +a[4].toFixed(2);};
 return {textContent:med(window.__M.textOnly), readScrollHeightAfterText:med(()=>{window.__M.textOnly();return window.__M.read();}), readScrollHeightStable:med(window.__M.read)};}));
await b.close();
