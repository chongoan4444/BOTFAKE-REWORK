/** Đo flushPersistentGids (JSON.stringify + localStorage.setItem) theo số khoá. */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/tmp/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/extralibs/lib' },
});
const ctx = await browser.newContext();
await ctx.route('**/*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>x</body></html>' }));
const page = await ctx.newPage();
await page.goto('https://pancake.vn/1/x');

const out = await page.evaluate(() => {
  const res = [];
  const KEY = 'ssb_global_id_cache_v1';
  for (const N of [2000, 20000, 60000, 120000]) {
    const m = {};
    for (let i = 0; i < N; i++) m['694078980461601_' + i] = 'gid_' + i + '_' + 'x'.repeat(8);
    // đo đúng y như flushPersistentGids
    const t0 = performance.now();
    const json = JSON.stringify(m);
    const tStr = performance.now() - t0;
    const t1 = performance.now();
    try { localStorage.setItem(KEY, json); } catch (e) { /* quota */ }
    const tSet = performance.now() - t1;
    res.push({ N, kb: Math.round(json.length / 1024), tStr: +tStr.toFixed(1), tSet: +tSet.toFixed(1), total: +(tStr + tSet).toFixed(1) });
  }
  return res;
});

console.log('══ flushPersistentGids(): JSON.stringify + localStorage.setItem (đồng bộ trên main thread) ══');
for (const r of out) {
  console.log(`  ${String(r.N).padStart(7)} khoá (${String(r.kb).padStart(5)} KB) → stringify ${String(r.tStr).padStart(6)} ms + ghi ${String(r.tSet).padStart(5)} ms = ${String(r.total).padStart(6)} ms`);
}
const n60 = out.find((r) => r.N === 60000);
console.log(`\n  Trong lúc TẢI danh sách, hàm này chạy ~mỗi 400 ms ⇒ 10 giây tải = ~25 lần × ${n60.total} ms ≈ ${Math.round(25 * n60.total)} ms chặn main thread`);
await browser.close();
