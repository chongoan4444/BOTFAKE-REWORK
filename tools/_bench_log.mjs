/**
 * Tách chi phí 2 thành phần gây "khựng 1 cái" khi panel MỞ (1 500 dòng log):
 *   A) el.textContent = state.log.join('\n')   — dựng lại toàn bộ text node
 *   B) logNearBottom(el)                        — đọc scrollHeight/clientHeight ⇒ ÉP LAYOUT
 *   C) el.scrollTop = el.scrollHeight           — ép layout + cuộn
 *   D) toàn bộ flushLogUI()
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('/home/user/BOTFAKE-REWORK/scripts/pancake-send-lite.user.js', 'utf8');
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
 body{margin:0;font:12px system-ui}
 #left{width:360px;height:900px;overflow:auto;float:left}
 #app{width:800px;height:900px;overflow:auto;float:left}
 .row{padding:6px;border-bottom:1px solid #eee}
 /* ĐÚNG CSS CỦA PANEL: .log max-height min(340px,42vh), white-space: pre-wrap */
 #ssb-log{background:#0b1220;border:1px solid #334155;border-radius:8px;padding:8px 8px 14px;
   min-height:120px;max-height:min(340px,42vh);overflow:auto;font-size:10.5px;line-height:1.55;
   color:#cbd5e1;white-space:pre-wrap;word-break:break-word}
</style></head><body>
<div id="left"></div><div id="app"></div><div id="ssb-log"></div>
<script>
(function(){
  // danh sách chat giả (để trang có layout thật như app)
  const left = document.getElementById('left');
  for (let i = 0; i < 200; i++) {
    const d = document.createElement('div'); d.className = 'row';
    d.innerHTML = '<b>Khách ' + i + '</b><br>Tin nhắn cuối của khách số ' + i;
    left.appendChild(d);
  }
  // "app" giả: 1 200 node để việc ép layout có chi phí thật
  const app = document.getElementById('app');
  for (let i = 0; i < 1200; i++) {
    const d = document.createElement('div'); d.className = 'row';
    d.textContent = 'Nội dung hội thoại dòng ' + i + ' — ' + 'x'.repeat(40);
    app.appendChild(d);
  }
  window.__lines = [];
  for (let i = 0; i < 1500; i++) {
    window.__lines.push('[' + String(10 + (i % 12)) + ':00:' + String(i % 60).padStart(2, '0') + '] dòng log thứ ' +
      i + ' — ✅ đã gửi chat 694078980461601_' + (300000 + i));
  }
})();
</script></body></html>`;

const browser = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/extralibs/lib' } });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.route('**/*', (r) => r.request().resourceType() === 'document'
  ? r.fulfill({ status: 200, contentType: 'text/html', body: PAGE })
  : r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));
const page = await ctx.newPage();
await page.goto('https://pancake.vn/694078980461601/x', { waitUntil: 'domcontentloaded' });

const out = await page.evaluate(() => {
  const el = document.getElementById('ssb-log');
  const L = window.__lines;
  const R = {};
  const time = (f, k = 10) => { f(); const t = performance.now(); for (let i = 0; i < k; i++) f(); return (performance.now() - t) / k; };
  l = null;
  // A) chỉ textContent
  R.textOnly = time(() => { el.textContent = L.join('\n'); });
  // B) textContent + logNearBottom (ép layout)
  R.withNearBottom = time(() => {
    el.textContent = L.join('\n');
    void (el.scrollHeight - el.scrollTop - el.clientHeight) <= 48;
  });
  // C) textContent + nearBottom + scrollTop
  R.full = time(() => {
    el.textContent = L.join('\n');
    const near = (el.scrollHeight - el.scrollTop - el.clientHeight) <= 48;
    el.scrollTop = near ? el.scrollHeight : el.scrollTop;
  });
  // D) join() riêng (không đụng DOM)
  R.joinOnly = time(() => { void L.join('\n'); });
  // E) ép layout 1 lần (đọc scrollHeight) khi DOM đã ổn định
  R.layoutReadOnly = time(() => { void el.scrollHeight; });
  // F) CSS khác: bỏ pre-wrap
  el.style.whiteSpace = 'normal'; el.style.wordBreak = 'normal';
  R.fullNoPreWrap = time(() => {
    el.textContent = L.join('\n');
    const near = (el.scrollHeight - el.scrollTop - el.clientHeight) <= 48;
    el.scrollTop = near ? el.scrollHeight : el.scrollTop;
  });
  return R;
});
let l;
console.log('══ 1 500 dòng log, panel MỞ (Chromium 153) ══');
for (const [k, v] of Object.entries(out)) {
  console.log(`  ${k.padEnd(16)} ${v.toFixed(2)} ms`);
}
await browser.close();
