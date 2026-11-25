/**
 * ĐO ĐÚNG CÚ "GIỮ ALT CHỌN 1 CON" — với MQTT helper có dữ liệu THẬT.
 *
 * Lần trước harness của tôi để __MqttHelper__ rỗng ({SOCKETS:{}}) nên warmUpSockets()
 * thoát ngay ở `if (!ip) return`. Trên máy thật, ip.threadMapping + threadMappingStoreV2
 * chứa MỌI thread của page (script này tự nâng maxLoadThreadCount lên 5000 trang ≈ 75 000
 * chat) ⇒ syncSocketMappingsToCache() duyệt 2 × N mỗi lần chọn.
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const OLD = readFileSync(process.env.EXT_OLD || '/tmp/ext_old_19256.js', 'utf8');
const NEW = readFileSync(process.env.EXT_NEW || '/tmp/ext_new_19257.js', 'utf8');
const THREADS = Number(process.env.THREADS || 20000);

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
  for (let i = 0; i < 12000; i++) data.push({ id: '694078980461601_' + (200000 + i), page_id: '694078980461601',
    thread_id: 't' + i, type: 'INBOX', snippet: 'Tin ' + i, updated_at: '2026-11-11T09:00:00',
    customers: [{ id: 'c' + i, fb_id: 'f' + i, name: 'K' + i, global_id: 'g' + i, ad_clicks: [] }] });
  window.__pancakeReduxStore__ = { getState: () => ({
    conversations: { data, filteredConversationsCloneList: data, filteredTag: 'ALL' },
    pages: { currentPageId: '694078980461601', currentSettings: {}, activated: [] },
    messages: {}, auth: { accessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnopqrstuvwxyz' } }) };

  /* ══ MQTT helper GIỐNG THẬT: mỗi page giữ map thread→globalId của TOÀN BỘ thread ══ */
  const N = ${THREADS};
  const threadMapping = {}, threadMappingStoreV2 = {};
  for (let i = 0; i < N; i++) {
    threadMapping['t' + i] = 'gid' + i;
    if (i % 2 === 0) threadMappingStoreV2['t' + i] = 'gid' + i;
  }
  window.__MqttHelper__ = {
    SOCKETS: {
      '694078980461601': {
        context: { initPageData: { threadMapping, threadMappingStoreV2 } },
        maxLoadThreadCount: 5000,
      },
    },
    PENDING_MESSAGES: {},
    initSocket: () => Promise.resolve(),
    wakingUpLoadThread: () => {},
    findBlockAction: () => null,
    isRunning: () => true,
  };
  window.__ExtensionAdapter__ = { send: () => Promise.resolve({ ok: true }) };

  const img = document.createElement('img');
  img.src = '/a.jpg?access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnopqrstuvwxyz';
  document.body.appendChild(img);
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ d: e.duration, t: e.startTime }); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  /* Event Timing: ĐO THẲNG cú click — đúng cái người dùng cảm thấy là "khựng". */
  window.__clicks = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.name === 'click') window.__clicks.push({ dur: e.duration, proc: e.processingEnd - e.processingStart });
      }
    }).observe({ type: 'event', durationThreshold: 0, buffered: true });
  } catch (e) {}
})();
</script></body></html>`;

const browser = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/extralibs/lib' } });

async function bench(tag, src) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.route('**/*', (r) => {
    if (r.request().resourceType() === 'document') return r.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"conversations":[]}' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await page.goto('https://pancake.vn/694078980461601/x', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const m = {};
    for (let i = 0; i < 40000; i++) m['694078980461601_' + i] = 'gid' + i + 'xxxxxxx';
    localStorage.setItem('ssb_global_id_cache_v1', JSON.stringify(m));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: src });
  await page.waitForFunction(() => !!window.__SSB__);

  /* ĐÚNG LUỒNG THẬT: người dùng đã bấm ⚡ Tải danh sách trước, rồi mới Alt-chọn.
   * Nếu để allRows = null thì mỗi cú Alt thứ hai sẽ TỰ TẢI 20 trang qua API — nhiễu phép đo. */
  if (process.env.PRELOADED !== '0') {
    await page.evaluate((N) => {
      const S = window.__SSB__.state;
      S.allRows = new Map();
      for (let i = 0; i < N; i++) {
        const id = '694078980461601_' + (200000 + i);
        S.allRows.set(id, { id, pageId: '694078980461601', name: 'K' + i, snippet: 's' + i,
          snippetRaw: 'Tin nhắn cuối của khách số ' + i, time: '10:2' + (i % 6), type: 'inbox', order: i });
      }
      S.allRowsPartial = false;
      S.listLoadedAt = Date.now();
    }, 12000);
  }

  /* ══ CHUẨN BỊ THEO CA ĐO ══
   * LOGFULL=1 ⇒ nhồi 1 500 dòng vào state.log (đúng trạng thái sau một lô dài).
   * PANEL=off  ⇒ ẩn panel (display:none) để so với PANEL=on. */
  await page.evaluate(({ logFull, panelOff }) => {
    const S = window.__SSB__.state;
    if (logFull) {
      S.log = [];
      for (let i = 0; i < 1500; i++) S.log.push('[' + String(10 + (i % 12)) + ':00:' + String(i % 60).padStart(2, '0') + '] ' + 'dòng log thứ ' + i + ' — ✅ đã gửi chat 694078980461601_' + (300000 + i));
    }
    const host = document.getElementById('ssb-root');
    if (panelOff && host) { host.style.display = 'none'; window.__SSB__.state.panelHiddenForBench = true; }
  }, { logFull: process.env.LOGFULL === '1', panelOff: process.env.PANEL === 'off' });

  const cdp = await ctx.newCDPSession(page);

  // ── ĐO ĐÚNG CÚ CLICK: giữ Alt, click 1 dòng, đo khung hình dài nhất + hàm nào chạy
  async function altClickOnce(idx) {
    const box = await page.locator(`#conversationList > div:nth-child(${idx}) .conversation-list-item`).boundingBox();
    await page.evaluate(() => { window.__lt = []; window.__clicks = []; window.__cnt = {}; window.__clickAt = performance.now(); });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');
    await page.keyboard.down('Alt');
    await page.mouse.click(box.x + 40, box.y + 12);
    await page.keyboard.up('Alt');
    await page.waitForTimeout(800);
    const { profile: p } = await cdp.send('Profiler.stop');
    const lt = await page.evaluate(() => window.__lt.map((x) => ({ d: x.d, rel: x.t - window.__clickAt })));
    const clicks = await page.evaluate(() => window.__clicks.slice());
    const cnt = await page.evaluate(() => window.__cnt || {});
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const dt = new Map();
    for (const id of p.samples) dt.set(id, (dt.get(id) || 0) + 1);
    const self = new Map();
    for (const [id, c] of dt) {
      const n = byId.get(id); if (!n) continue;
      const f = n.callFrame || {};
      const k = f.functionName || '(anon)';
      self.set(k, (self.get(k) || 0) + c);
    }
    const total = p.samples.length || 1;
    const busy = [...self.entries()].filter(([k]) => !/^\(idle\)|^\(program\)|^\(garbage/.test(k)).reduce((a, b) => a + b[1], 0);
    const early = lt.filter((x) => x.rel < 150);        // NGAY LÚC CLICK — cái người dùng thấy
    const late = lt.filter((x) => x.rel >= 150);        // chạy nền về sau
    return {
      cnt: await page.evaluate(() => window.__cnt || {}),
      longTask: early.length ? Math.max(...early.map((x) => x.d)) : 0,
      earlySum: early.reduce((a, b) => a + b.d, 0), earlyN: early.length,
      lateMax: late.length ? Math.max(...late.map((x) => x.d)) : 0,
      lateSum: late.reduce((a, b) => a + b.d, 0), lateN: late.length,
      clickDur: clicks.length ? Math.max(...clicks.map((c) => c.dur)) : 0,
      clickProc: clicks.length ? Math.max(...clicks.map((c) => c.proc)) : 0,
      busyPct: +((100 * busy) / total).toFixed(1),
      top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${(100 * v / total).toFixed(1)}%`),
      paths: (() => {
        const parentOf = new Map();
        for (const n of p.nodes) for (const c of (n.children || [])) parentOf.set(c, n.id);
        const out = [];
        const topSelf = [...self.entries()].filter(([k]) => !/^\(idle\)|^\(program\)|^\(garbage/.test(k)).slice(0, 3);
        for (const [name] of topSelf) {
          const anyId = [...dt.entries()].filter(([nid]) => { const n = byId.get(nid); return n && ((n.callFrame || {}).functionName || '(anon)') === name; })[0];
          if (anyId) {
            const n0 = byId.get(anyId[0]); const f0 = n0.callFrame || {};
            const par = parentOf.get(anyId[0]); const pn = par ? byId.get(par) : null;
            const pf = pn ? (pn.callFrame || {}) : {};
            out.push(`[self ${name}] dòng ${f0.lineNumber}:${f0.columnNumber} url=${String(f0.url || '').split('/').pop().slice(0, 18)} ← cha: ${pf.functionName || '(anon)'}:${pf.lineNumber}`);
          }
          const id = [...dt.entries()].map(([nid, c]) => [nid, c]).find(([nid]) => {
            const n = byId.get(nid); return n && (n.callFrame || {}).functionName === name;
          });
          if (!id) continue;
          const chain = [];
          let cur = id[0];
          for (let g = 0; g < 12 && cur != null; g++) {
            const n = byId.get(cur); if (!n) break;
            const f = n.callFrame || {};
            chain.push((f.functionName || '(anon)') + ':' + f.lineNumber);
            cur = parentOf.get(cur);
          }
          out.push(chain.reverse().join(' → '));
        }
        return out;
      })(),
    };
  }

  /* KIỂM ĐÚNG ĐẮN: 2 bản phải tô ĐÚNG cùng một tập dòng. Chọn vài dòng rồi so class. */
  const paint = await page.evaluate(() => {
    const S = window.__SSB__.state;
    S.enabled = true;
    window.__SSB__.computeMatches({ silentMissingLog: true });
    const out = [];
    document.querySelectorAll('.conversation-list-item').forEach((it) => {
      const c = it.className || '';
      out.push((it.id || '?').slice(-4) + ':' + (c.indexOf('ssb-m-target') >= 0 ? 'T' : c.indexOf('ssb-m-match') >= 0 ? 'M' : '-'));
    });
    return out.join(',');
  });
  console.log(`   tô màu: ${paint.split(',').filter((x) => !x.endsWith(':-')).join(' ') || '(không dòng nào)'}`);

  const runs = [];
  for (const idx of [2, 6, 9, 14]) {
    runs.push(await altClickOnce(idx));
    await page.waitForTimeout(400);
  }
  const r1 = { ...runs[0] };
  const r2 = { ...runs[1] };
  const st = await page.evaluate(() => ({ mode: window.__SSB__.state.mode, matches: window.__SSB__.state.matches.length }));
  console.log(`\n── ${tag}  (threadMapping ${THREADS} thread)`);
  for (const [i, r] of runs.entries()) {
    console.log(`   click ${i + 1}: ⏱ SỰ KIỆN CLICK = ${r.clickDur.toFixed(0)} ms (xử lý JS ${r.clickProc.toFixed(0)} ms) · khung hình dài nhất ngay lúc click ${r.longTask.toFixed(0)} ms`);
    console.log(`             số lần gọi trong cú click: ${JSON.stringify(r.cnt)}`);
    console.log(`             chạy nền sau đó: khung dài nhất ${r.lateMax.toFixed(0)} ms (${r.lateN} cái, tổng ${r.lateSum.toFixed(0)} ms) · CPU bận ${r.busyPct}%`);
    console.log(`             ${r.top.join(' · ')}`);
    if (process.env.PATHS) for (const pth of r.paths) console.log(`             ↳ ${pth}`);
  }
  console.log(`   state: ${JSON.stringify(st)}${errs.length ? ' · lỗi: ' + errs[0] : ''}`);
  await ctx.close();
}

await bench('1.92.56 (cũ)', OLD);
await bench('1.92.57 (mới)', NEW);
await browser.close();
