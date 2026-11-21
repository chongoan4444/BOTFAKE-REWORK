import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath:'/tmp/chromium', args:['--no-sandbox'], env:{...process.env, LD_LIBRARY_PATH:'/tmp/extralibs/lib'} });
const ctx = await b.newContext(); const p = await ctx.newPage();
await ctx.route('**/*', r => r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><body>'}));
await p.goto('https://pancake.vn/x');
const r = await p.evaluate(() => {
  const log = []; for (let i=0;i<1500;i++) log.push('[10:00:00] dòng log thứ '+i+' — ✅ đã gửi chat 694078980461601_'+(300000+i));
  const t=(f,k=20)=>{f();const s=performance.now();for(let i=0;i<k;i++)f();return (performance.now()-s)/k;};
  return {
    stringify: +t(()=>{ void JSON.stringify(log); }).toFixed(2),
    setItem: +t(()=>{ localStorage.setItem('k', JSON.stringify(log)); }).toFixed(2),
    stringify300: +t(()=>{ void JSON.stringify(log.slice(-300)); }).toFixed(2),
    setItem300: +t(()=>{ localStorage.setItem('k', JSON.stringify(log.slice(-300))); }).toFixed(2),
    bytes: JSON.stringify(log).length,
  };
});
console.log(JSON.stringify(r,null,1));
await b.close();
