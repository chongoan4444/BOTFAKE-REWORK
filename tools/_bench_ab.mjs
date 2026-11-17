/**
 * SO SÁNH END-TO-END 1.92.56 (cũ) vs 1.92.57 (mới) — nạp CẢ userscript trong Chromium 153,
 * cùng một trang giả lập, cùng một thao tác, đo main thread + profiler CPU.
 *
 *   node tools/_bench_ab.mjs
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const OLD = readFileSync('/tmp/ext_old_19256.js', 'utf8');
const NEW = readFileSync('/tmp/ext_new_19257.js', 'utf8');
const ALL = 12000;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
 body{margin:0;font:12px system-ui}
 #conversationList{width:360px;height:900px;overflow:auto}
 .conversation-list-item{display:flex;gap:8px;padding:8px;border-bottom:1px solid #eee;height:46px;box-sizing:border-box}
 .ssb-m-match{background:#dbeafe}
</style></head><body><div id="conversationList"></div><script>
(function(){
  const holder = document.getElementById('conversationList');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 40; i++) {
    const row = document.createElement('div');
    row.id = '694078980461601_' + (200000 + i);
    row.innerHTML = '<div class="media conversation-list-item"><div class="tag-wrap"><img src="/icons/envelope.svg"></div>'
      + '<img src="https://cdn.pancake.vn/pages/694078980461601/avatar/x.jpg">'
      + '<div><span class="name-text">Khách ' + i + '</span><span class="snippet-text">Tin ' + i + '</span>'
      + '<span class="time-modul">10:2' + (i % 6) + '</span></div></div>';
    frag.appendChild(row);
  }
  holder.appendChild(frag);
  const data = [];
  for (let i = 0; i < ${ALL}; i++) data.push({ id: '694078980461601_' + (200000 + i), page_id: '694078980461601',
    thread_id: 't' + i, type: 'INBOX', snippet: 'Tin ' + i, updated_at: '2026-11-11T09:00:00',
    customers: [{ id: 'c' + i, fb_id: 'f' + i, name: 'K' + i, global_id: 'g' + i, ad_clicks: [] }] });
  window.__pancakeReduxStore__ = { getState: () => ({
    conversations: { data, filteredConversationsCloneList: data, filteredTag: 'ALL' },
    pages: { currentPageId: '694078980461601', currentSettings: {}, activated: [] },
    messages: {}, auth: { accessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnopqrstuvwxyz' } }) };
  const img = document.createElement('img');
  img.src = '/a.jpg?access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnopqrstuvwxyz';
  document.body.appendChild(img);
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  window.__MqttHelper__ = { SOCKETS: {}, initSocket: () => Promise.resolve(), wakingUpLoadThread: () => {} };
  window.__ExtensionAdapter__ = { send: () => Promise.resolve({ ok: true }) };
})();
</script></body></html>`;

const browser = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/extralibs/lib' } });

async function bench(tag, src) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  let nPages = 0;
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (r.request().resourceType() === 'document') return r.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
    if (u.includes('/conversations?')) {
      nPages++;
      const convs = [];
      for (let i = 0; i < 40; i++) convs.push({ id: '694078980461601_' + (900000 + nPages * 40 + i), page_id: '694078980461601',
        thread_id: 'tt' + i, type: 'INBOX', snippet: 'x', customers: [{ id: 'c', fb_id: 'f', global_id: 'g' + i, ad_clicks: [] }] });
      // CHỈ 20 trang rồi hết ⇒ tải xong, không chạy mãi trong lúc đo
      const j = { conversations: convs, next_cursor: nPages < 20 ? 'c' + nPages : null, success: true };
      return r.fulfill({ status: 200, contentType: 'text/plain', body: Buffer.from(JSON.stringify(j)).toString('base64') });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  // gieo cache gid lớn TRƯỚC khi nạp script (như máy đã dùng lâu)
  await page.goto('https://pancake.vn/694078980461601/x', { waitUntil: 'domcontentloaded' });
  await page.evaluate((N) => {
    const m = {};
    for (let i = 0; i < N; i++) m['694078980461601_' + i] = 'gid' + i + 'xxxxxxxxxxxxx';
    localStorage.setItem('ssb_global_id_cache_v1', JSON.stringify(m));
  }, 60000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: src });
  await page.waitForFunction(() => !!window.__SSB__);

  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(() => { window.__lt.length = 0; });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');

  // thao tác người dùng: Alt+Click 2 đầu chuỗi, rồi chọn lại 5 lần (mỗi lần = 1 computeMatches + preload)
  async function altClick(idx) {
    const box = await page.locator(`#conversationList > div:nth-child(${idx}) .conversation-list-item`).boundingBox();
    await page.keyboard.down('Alt');
    await page.mouse.click(box.x + 40, box.y + 12);
    await page.keyboard.up('Alt');
  }
  // chờ tải danh sách xong hẳn (nếu còn chạy thì phép đo bị nhiễu bởi chính đường tải)
  await page.waitForFunction(() => window.__SSB__.state.scanning === false, null, { timeout: 60000 }).catch(() => {});
  await altClick(2);
  await page.waitForTimeout(600);
  await altClick(20);
  await page.waitForTimeout(2500);
  // 5 lần chọn dòng nữa (đúng nhịp lúc người dùng đang dò danh sách)
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.__SSB__.computeMatches({ silentMissingLog: true }));
    await page.waitForTimeout(400);
  }

  const { profile: p } = await cdp.send('Profiler.stop');
  const lt = await page.evaluate(() => window.__lt.slice());
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const dt = new Map();
  for (const id of p.samples) dt.set(id, (dt.get(id) || 0) + 1);
  const self = new Map();
  for (const [id, c] of dt) {
    const n = byId.get(id); if (!n) continue;
    const f = n.callFrame || {};
    self.set(`${f.functionName || '(anon)'}`, (self.get(`${f.functionName || '(anon)'}`) || 0) + c);
  }
  const total = p.samples.length || 1;
  const busy = [...self.entries()].filter(([k]) => !/^\(idle\)|^\(program\)|^\(garbage/.test(k)).reduce((a, b) => a + b[1], 0);
  const focus = ['flushPersistentGids', 'preloadPersistentGlobalIds', 'putGidToMemCaches', 'logLine', 'render', 'computeMatches', 'highlightRows'];
  const detail = {};
  for (const f of focus) detail[f] = +((100 * (self.get(f) || 0)) / total).toFixed(1);
  const res = {
    tag,
    busyPct: +((100 * busy) / total).toFixed(1),
    ltCount: lt.length, ltMax: +(lt.length ? Math.max(...lt) : 0).toFixed(0), ltSum: +lt.reduce((a, b) => a + b, 0).toFixed(0),
    detail,
    errs: errs.slice(0, 2),
  };
  await ctx.close();
  return res;
}

const a = await bench('1.92.56 (cũ)', OLD);
const b = await bench('1.92.57 (mới)', NEW);
const show = (r) => {
  console.log(`\n── ${r.tag}`);
  console.log(`   main thread bận: ${r.busyPct}% · long task ${r.ltCount} cái, dài nhất ${r.ltMax} ms, tổng ${r.ltSum} ms`);
  console.log(`   theo hàm: ${JSON.stringify(r.detail)}`);
  if (r.errs.length) console.log('   lỗi JS:', r.errs);
};
show(a); show(b);
await browser.close();
