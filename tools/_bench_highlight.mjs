/** Đo highlightRows() bản cũ vs mới — cùng DOM 3 000 dòng, cùng state. */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const NEW = readFileSync('/home/user/BOTFAKE-REWORK/scripts/pancake-send-lite.user.js', 'utf8');
const OLD = readFileSync('/tmp/ext_old_19256.js', 'utf8');

function bodyOf(src) {
  const i = src.indexOf('function highlightRows(');
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(src.indexOf('{', i) + 1, k); }
  }
  throw new Error('x');
}
const PAGE = `<!doctype html><html><body><div id="conversationList"></div><script>
window.__pancakeReduxStore__ = { getState: () => ({ conversations: { data: [], filteredConversationsCloneList: [], filteredTag: 'ALL' },
  pages: { currentPageId: '694078980461601', currentSettings: {}, activated: [] }, messages: {}, auth: {} }) };
const img = document.createElement('img'); img.src = '/a.jpg?access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnopqrstuvwxyz';
document.body.appendChild(img);
window.__MqttHelper__ = { SOCKETS: {}, initSocket: () => Promise.resolve() };
window.__ExtensionAdapter__ = { send: () => Promise.resolve({ ok: true }) };
</script></body></html>`;

const browser = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/extralibs/lib' } });
const ctx = await browser.newContext();
await ctx.route('**/*', (r) => r.request().resourceType() === 'document'
  ? r.fulfill({ status: 200, contentType: 'text/html', body: PAGE })
  : r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));
const page = await ctx.newPage();
await page.goto('https://pancake.vn/694078980461601/x', { waitUntil: 'domcontentloaded' });
await page.addScriptTag({ content: NEW });
await page.waitForFunction(() => !!window.__SSB__);

for (const N of [300, 1000, 3000]) {
  const r = await page.evaluate(({ N, oldBody, newBody }) => {
    const holder = document.getElementById('conversationList');
    holder.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < N; i++) {
      const row = document.createElement('div');
      row.id = '694078980461601_' + (200000 + i);
      row.innerHTML = '<div class="media conversation-list-item"><div class="tag-wrap"><img src="/icons/envelope.svg"></div>'
        + '<img src="https://cdn.pancake.vn/pages/694078980461601/avatar/x.jpg">'
        + '<div><span class="name-text">Khách ' + i + '</span><span class="snippet-text">Tin ' + i + '</span>'
        + '<span class="time-modul">10:2' + (i % 6) + '</span></div></div>';
      frag.appendChild(row);
    }
    holder.appendChild(frag);
    const d = window.__SSB__.__hlDeps;
    const mk = (b) => new Function('state', '$$', 'rowInfo', 'markOf', 'hlClassSeen',
      'function highlightRows() {' + b + '} return highlightRows;')(window.__SSB__.state, d.$$, d.rowInfo, d.markOf, d.hlClassSeen);
    const S = window.__SSB__.state;
    S.enabled = true; S.sendListFrozen = false;
    S.matches = [];
    for (let i = 0; i < N; i++) if (i % 3 === 0) S.matches.push({ id: '694078980461601_' + (200000 + i), checked: true, mark: '' });
    const oldFn = mk(oldBody), newFn = mk(newBody);
    const bench = (fn) => {
      fn();
      const K = 20, t = performance.now();
      for (let i = 0; i < K; i++) fn();
      return (performance.now() - t) / K;
    };
    return { old: bench(oldFn), new: bench(newFn) };
  }, { N, oldBody: bodyOf(OLD), newBody: bodyOf(NEW) });
  console.log(`  ${String(N).padStart(5)} dòng: cũ ${r.old.toFixed(1)} ms → mới ${r.new.toFixed(1)} ms  (${(r.old / r.new).toFixed(1)}× nhanh)`);
}
await browser.close();
