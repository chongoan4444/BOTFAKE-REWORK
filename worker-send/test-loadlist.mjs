/**
 * TEST loadlist.js — tải danh sách chat (main thread) bằng HTTP server THẬT.
 *
 * Dữ liệu mẫu KHÔNG bịa: khung conversation dưới đây copy từ HAR thật
 * (`batmesss.har`, response /api/v1/conversations) — đủ các field mà `toItem` đọc:
 * id, page_id, name, snippet, from{}, customers[], last_customer_interactive_at.
 *
 * Điều quan trọng nhất test này khoá: URL danh sách phải giống `buildListRequest`
 * của bản 1.92.55 (dòng 1525). Bản đầu của tôi đã bịa endpoint send, nên ở đây
 * kiểm cả endpoint LIST trước khi tin.
 */
import http from 'node:http';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, 'loadlist.js'), 'utf8');

let pass = 0; let fail = 0;
function check(name, got, want) {
  const a = JSON.stringify(got); const b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      nhận: ' + a + '\n      mong: ' + b); }
}

/* Một conversation THẬT (batmesss.har) — rút gọn field không dùng. */
const REAL_CONV = {
  id: '689375157595846_29617688761165549',
  type: 'INBOX',
  tags: [],
  seen: true,
  from: { email: '29617688761165549@facebook.com', id: '29617688761165549', name: 'Thao Quyên' },
  snippet: 'Em chào chị ạ !!!',
  updated_at: '2026-10-19T10:11:08.000000',
  page_id: '689375157595846',
  thread_id: '1137132978999031',
  customers: [{ fb_id: '29617688761165549', id: '6023b3fa-93b2-4ff4-af79-ec0bb4eca874', name: 'Thao Quyên' }],
  is_combined: false,
  has_phone: false,
  from_psid: '29617688761165549',
  last_customer_interactive_at: null,
};

function startSrv(pages) {
  const st = { urls: [], calls: 0 };
  const srv = http.createServer((req, res) => {
    st.calls++;
    st.urls.push(req.url || '');
    const idx = st.calls - 1;
    const p = pages[Math.min(idx, pages.length - 1)];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(p));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, st, port: srv.address().port })));
}

/** Chạy loadlist.js trong ngữ cảnh giả lập trang (có Redux, location, localStorage). */
function makePage(port, redux, pathname) {
  const ctx = {
    window: {},
    location: { hostname: 'pancake.vn', origin: 'http://127.0.0.1:' + port, pathname: pathname || '/pages/689375157595846/inbox', search: '' },
    localStorage: { length: 0, key() { return null; }, getItem() { return null; } },
    performance: { getEntriesByType() { return []; } },
    document: { getElementById() { return null; } },
    fetch, console, Date, JSON, Object, String, Array, Math, Number, isNaN, encodeURIComponent, RegExp, Promise, Error,
  };
  ctx.window.__pancakeReduxStore__ = { getState: () => redux };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'loadlist.js' });
  return ctx.window.__BOTFAKE_WS_LOADLIST__;
}

/* ============================================================== */
console.log('\n[1] buildListUrl — endpoint & tham số');

const REDUX_ONE = {
  pages: { multiplePageMode: false, currentPageId: '689375157595846' },
  auth: {}, conversations: {},
};
const LL = makePage(1, REDUX_ONE);

{
  const r = LL.buildListUrl({});
  const u = r.url;
  check('[L1] một page ⇒ endpoint /api/v1/pages/{id}/conversations',
    /\/api\/v1\/pages\/689375157595846\/conversations\?/.test(u), true);
  check('[L2] dùng cookie_session cho pancake.vn (HAR taidanhsach)',
    /access_token=cookie_session/.test(u), true);
  check('[L3] có cursor_mode=true', /cursor_mode=true/.test(u), true);
  check('[L4] có from_platform=web', /from_platform=web/.test(u), true);
  check('[L5] có current_count', /current_count=60/.test(u), true);
  check('[L6] có tags=ALL', /tags=%22ALL%22/.test(u), true);
  check('[L7] có except_tags=[]', /except_tags=%5B%5D/.test(u), true);
}

const REDUX_MULTI = {
  pages: { multiplePageMode: true, multiplePageIds: ['111', '222'] },
  auth: {}, conversations: {},
};
{
  const LL2 = makePage(1, REDUX_MULTI);
  const u = LL2.buildListUrl({}).url;
  check('[L8] nhiều page ⇒ endpoint /api/v1/conversations', /\/api\/v1\/conversations\?/.test(u), true);
  check('[L9] nhiều page ⇒ có pages[111]', /pages%5B111%5D=0/.test(u), true);
  check('[L10] nhiều page ⇒ có mode=OR', /mode=OR/.test(u), true);
}

{
  const LL3 = makePage(1, { pages: {} });
  const r = LL3.buildListUrl({ pageIds: ['999'], accessToken: 'JWT.abc.def' });
  check('[L11] override pageIds + token vẫn chạy',
    /pages\/999\/conversations/.test(r.url) && /access_token=JWT\.abc\.def/.test(r.url), true);
}

console.log('\n[2] load() — phân trang, khử trùng, cờ incomplete');

/* Trang 1: 2 chat + cursor. Trang 2: 1 chat MỚI + 1 chat TRÙNG + hết cursor. */
{
  const p2 = {
    conversations: [REAL_CONV, Object.assign({}, REAL_CONV, { id: '111_222', page_id: '111', from: { name: 'Khách B' } })],
    next_cursor: 'CURSOR_1',
  };
  const p3 = {
    conversations: [Object.assign({}, REAL_CONV, { id: '333_444', page_id: '333', from: { name: 'Khách C' } }), REAL_CONV],
    next_cursor: null,
  };
  const { srv, st, port } = await startSrv([p2, p3]);
  const LLx = makePage(port, REDUX_ONE);
  const got = await LLx.load({});
  srv.close();

  check('[L12] tải 2 trang ⇒ 2 request', st.calls, 2);
  check('[L13] trang 2 có next_cursor=…', /next_cursor=CURSOR_1/.test(st.urls[1]), true);
  check('[L14] khử TRÙNG giữa 2 trang (3 chat, không phải 4)', got.items.length, 3);
  check('[L15] đã hết ⇒ incomplete=false', got.incomplete, false);
  check('[L16] item đầu đúng id từ HAR', got.items[0].id, '689375157595846_29617688761165549');
  check('[L17] pageId lấy từ page_id', got.items[0].pageId, '689375157595846');
  check('[L18] name lấy từ from.name', got.items[0].name, 'Thao Quyên');
  check('[L19] snippet giữ nguyên', got.items[0].snippet, 'Em chào chị ạ !!!');
  check('[L20] giữ last_customer_interactive_at để tính ctx7',
    'last_customer_interactive_at' in got.items[0], true);
}

/* Còn cursor mà bị maxPages chặn ⇒ PHẢI báo incomplete, không được im lặng */
{
  const { srv, st, port } = await startSrv([
    { conversations: [REAL_CONV], next_cursor: 'C1' },
    { conversations: [Object.assign({}, REAL_CONV, { id: 'z_1' })], next_cursor: 'C2' },
  ]);
  const LLy = makePage(port, REDUX_ONE);
  const got = await LLy.load({ maxPages: 2 });
  srv.close();
  check('[L21] dừng vì maxPages mà còn cursor ⇒ incomplete=true', got.incomplete, true);
  check('[L22] đúng số trang đã tải', st.calls, 2);
}

console.log('\n[3] lỗi & thiếu cấu hình');

{
  /* pathname KHÔNG có page id + Redux rỗng ⇒ không nguồn nào xác định được page.
   * (Nếu pathname có `/pages/<id>/` thì fallback đọc từ URL vẫn chạy — đó là hành vi
   * ĐÚNG, nên test phải tách bạch hai trường hợp.) */
  const LLz = makePage(1, { pages: {} }, '/inbox');
  const got = await LLz.load({});
  check('[L23] không xác định được page ⇒ ok=false, KHÔNG gọi mạng', got.ok, false);
  check('[L24] có thông báo lỗi nói rõ page_id', /page_id/.test(String(got.error)), true);
}

{
  /* CÓ page id trong URL ⇒ fallback phải cứu được, không báo lỗi page */
  const LLf = makePage(1, { pages: {} }, '/pages/777/inbox');
  const u = LLf.buildListUrl({}).url;
  check('[L24b] Redux rỗng nhưng URL có /pages/777/ ⇒ đọc được page 777',
    /pages\/777\/conversations/.test(u), true);
}

{
  /* Server trả 401 ⇒ dừng và nói rõ token hết hạn, không lặp vô hạn */
  const srv = http.createServer((req, res) => { res.writeHead(401); res.end('{}'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const LLw = makePage(port, REDUX_ONE);
  const got = await LLw.load({});
  srv.close();
  check('[L25] HTTP 401 ⇒ ok=false', got.ok, false);
  check('[L26] 401 ⇒ nói rõ token hết hạn', /token hết hạn/.test(String(got.error)), true);
}

console.log('\n[4] ctx7 (is_record_ctx_7_days) — cờ quyết định (#10)');

{
  const redux = {
    pages: {
      multiplePageMode: false, currentPageId: 'P1',
      activatedMap: { P1: { id: 'P1', platform: 'facebook', platform_extra_info: { ctx_7_days_enabled: true } } },
      activated: [],
    },
    auth: {}, conversations: {},
  };
  const L = makePage(1, redux);
  /* Khách vừa tương tác HÔM NAY ⇒ KHÔNG bật cờ (bản cũ: <1 ngày thì false) */
  const today = new Date().toISOString();
  const old = new Date(Date.now() - 5 * 86400000).toISOString();
  check('[L27] khách vừa nhắn <1 ngày ⇒ ctx7=false',
    L.ctx7ForItem({ id: 'P1_1', pageId: 'P1', last_customer_interactive_at: today }), false);
  check('[L28] khách im 5 ngày + page bật ctx_7_days ⇒ ctx7=TRUE',
    L.ctx7ForItem({ id: 'P1_1', pageId: 'P1', last_customer_interactive_at: old }), true);
  check('[L29] decorate gắn cờ vào từng item',
    L.decorate([{ id: 'P1_1', pageId: 'P1', last_customer_interactive_at: old }])[0].isRecordCtx7Days, true);
}

{
  /* Page KHÔNG bật ctx_7_days ⇒ phải là false, không được bật bừa */
  const redux = {
    pages: { multiplePageMode: false, currentPageId: 'P2',
      activatedMap: { P2: { id: 'P2', platform: 'facebook', platform_extra_info: { ctx_7_days_enabled: false } } }, activated: [] },
    auth: {}, conversations: {},
  };
  const L = makePage(1, redux);
  const old = new Date(Date.now() - 5 * 86400000).toISOString();
  check('[L30] page KHÔNG bật ctx_7_days ⇒ false',
    L.ctx7ForItem({ id: 'P2_1', pageId: 'P2', last_customer_interactive_at: old }), false);
}

{
  /* Không có Redux ⇒ false, KHÔNG được ném */
  const ctx = {
    window: {}, location: { hostname: 'x', origin: 'http://x', pathname: '/', search: '' },
    localStorage: { length: 0, key() { return null; }, getItem() { return null; } },
    performance: { getEntriesByType() { return []; } }, document: { getElementById() { return null; } },
    console, Date, JSON, Object, String, Array, Math, isNaN, encodeURIComponent, RegExp, Promise, Error,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'loadlist.js' });
  const L = ctx.window.__BOTFAKE_WS_LOADLIST__;
  let threw = false;
  try { L.ctx7ForItem({ id: 'a_1' }); } catch (e) { threw = true; }
  check('[L31] không có Redux ⇒ ctx7=false, không ném', threw, false);
}

console.log('\n' + (fail === 0 ? '✓ ' + pass + ' test đều đúng — loadlist.js CHẠY THẬT.' : '✗ ' + fail + '/' + (pass + fail) + ' test ĐỎ'));
process.exit(fail === 0 ? 0 : 1);
