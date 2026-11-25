/**
 * PROFILER CPU cho ĐÚNG thao tác "Alt chọn chuỗi" trong Chromium thật.
 * Trang giả lập app Pancake: danh sách ảo hoá 40 dòng + Redux 12 000 hội thoại.
 * Đo: Alt+Click lần 1 (đặt đầu) và lần 2 (đặt cuối + tự tải).
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('/home/user/BOTFAKE-REWORK/scripts/pancake-send-lite.user.js', 'utf8');
const ALL = Number(process.env.ALLROWS || 12000);

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
 body{margin:0;font:12px system-ui}
 #conversationList{width:360px;height:900px;overflow:auto}
 .conversation-list-item{display:flex;gap:6px;padding:8px;border-bottom:1px solid #eee;height:46px;box-sizing:border-box}
 .ssb-m-match{background:#dbeafe}.ssb-m-target{background:#fde68a}
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
  for (let i = 0; i < ${ALL}; i++) data.push({
    id: '694078980461601_' + (200000 + i), page_id: '694078980461601', thread_id: 't' + i, type: 'INBOX',
    snippet: 'Tin ' + i, updated_at: '2026-11-11T09:00:00',
    customers: [{ id: 'c' + i, fb_id: 'f' + i, name: 'K' + i, global_id: 'g' + i, ad_clicks: [] }],
  });
  window.__pancakeReduxStore__ = { getState: () => ({
    conversations: { data, filteredConversationsCloneList: data, filteredTag: 'ALL' },
    pages: { currentPageId: '694078980461601', currentSettings: {}, activated: [] },
    messages: {}, auth: { accessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnopqrstuvwxyz' } }) };
  const img = document.createElement('img');
  img.src = '/a.jpg?access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnopqrstuvwxyz';
  document.body.appendChild(img);
  window.__longTasks = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  window.__MqttHelper__ = { SOCKETS: {}, initSocket: () => Promise.resolve(), wakingUpLoadThread: () => {} };
  window.__ExtensionAdapter__ = { send: () => Promise.resolve({ ok: true }) };
})();
</script></body></html>`;

const browser = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/extralibs/lib' } });

async function run(label, useAllRows) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  let pageHost = 0;
  await ctx.route('**/*', (r) => {
    if (r.request().resourceType() === 'document') return r.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
    if (r.request().url().includes('/conversations?')) {
      pageHost++;
      const convs = [];
      const base = pageHost * 40;
      for (let i = 0; i < 40; i++) convs.push({ id: '694078980461601_' + (900000 + base + i), page_id: '694078980461601',
        thread_id: 'tt' + i, type: 'INBOX', snippet: 'x', customers: [{ id: 'c', fb_id: 'f', global_id: 'g' + i }] });
      const j = { conversations: convs, next_cursor: pageHost < 300 ? 'c' + pageHost : null, success: true };
      return r.fulfill({ status: 200, contentType: 'text/plain', body: Buffer.from(JSON.stringify(j)).toString('base64') });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await page.goto('https://pancake.vn/694078980461601/x', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: SRC });
  await page.waitForFunction(() => !!window.__SSB__);

  if (useAllRows) {
    await page.evaluate((N) => {
      const S = window.__SSB__.state;
      S.allRows = new Map();
      for (let i = 0; i < N; i++) {
        const id = '694078980461601_' + (200000 + i);
        S.allRows.set(id, { id, pageId: '694078980461601', name: 'K' + i, snippet: 's' + i,
          snippetRaw: 'Tin nhắn cuối của khách số ' + i, time: '10:2' + (i % 6), type: 'inbox', order: i });
      }
      S.allRowsPartial = false;
    }, ALL);
  }

  const cdp = await ctx.newCDPSession(page);
  async function prof(tag, fn, settle = 2500) {
    await page.evaluate(() => { window.__longTasks.length = 0; });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');
    await fn();
    await page.waitForTimeout(settle);
    const { profile: p } = await cdp.send('Profiler.stop');
    const lt = await page.evaluate(() => window.__longTasks.slice());
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const dt = new Map();
    for (const id of p.samples) dt.set(id, (dt.get(id) || 0) + 1);
    const self = new Map();
    for (const [id, c] of dt) {
      const n = byId.get(id); if (!n) continue;
      const f = n.callFrame || {};
      const k = `${f.functionName || '(anon)'} @${String(f.url || '').split('/').pop().slice(0, 14)}:${f.lineNumber}`;
      self.set(k, (self.get(k) || 0) + c);
    }
    const total = p.samples.length || 1;
    const busy = [...self.entries()].filter(([k]) => !/\(idle\)|\(program\)|\(garbage/.test(k)).reduce((a, b) => a + b[1], 0);
    console.log(`\n── ${tag}`);
    console.log(`   main thread bận ≈ ${(100 * busy / total).toFixed(0)}% · long task ${lt.length} cái, dài nhất ${lt.length ? Math.max(...lt).toFixed(0) : 0} ms, tổng ${lt.reduce((a, b) => a + b, 0).toFixed(0)} ms`);
    for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9)) {
      console.log(`   ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
    }
  }

  async function altClick(idx) {
    const box = await page.locator(`#conversationList > div:nth-child(${idx}) .conversation-list-item`).boundingBox();
    await page.keyboard.down('Alt');
    await page.mouse.click(box.x + 40, box.y + 12);
    await page.keyboard.up('Alt');
  }

  console.log(`\n══════ ${label} (allRows=${useAllRows ? ALL : 'null'}) ══════`);
  await prof('Alt+Click lần 1 (đặt ĐẦU chuỗi)', () => altClick(2), 1200);
  await prof('Alt+Click lần 2 (đặt CUỐI chuỗi)', () => altClick(20), 1200);
  const st = await page.evaluate(() => ({ mode: window.__SSB__.state.mode, matches: window.__SSB__.state.matches.length,
    allRows: window.__SSB__.state.allRows && window.__SSB__.state.allRows.size, scanning: window.__SSB__.state.scanning }));
  console.log('   state:', JSON.stringify(st));
  console.log('   lỗi JS:', errs.length ? errs.slice(0, 2) : 'không');
  await ctx.close();
}

await run('A) CHƯA tải danh sách', false);
await run('B) ĐÃ tải danh sách', true);
await browser.close();
