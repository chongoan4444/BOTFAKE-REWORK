# worker-send — đường gửi chạy trong Web Worker

**Cài: 1 file dán vào console. Không cần extension, không cần Developer mode.**

---

## 1. DÙNG NGAY (3 bước)

### Bước 1 — tạo file cài

```bash
node worker-send/build.mjs
# → dist/worker-send.install.js   (57,7 KB)
```

### Bước 2 — nạp vào trang Pancake

1. Mở tab Pancake (`pancake.vn` hoặc `pages.fm`), **đợi danh sách chat tải xong**
2. `F12` → tab **Console**
3. Dán **toàn bộ** `dist/worker-send.install.js` → `Enter`

Thấy `[BOTFAKE-WS] đã nạp ✓` là xong.

### Bước 3 — chạy thử rồi mới gửi thật

```js
BOTFAKE_WS.help()                                   // xem hướng dẫn
BOTFAKE_WS.run({ text: 'Xin chào', dryRun: true })  // CHẠY THỬ — đọc danh sách, KHÔNG gửi
BOTFAKE_WS.run({ text: 'Xin chào' })                // GỬI THẬT
```

Khi xong, console in:

```
[BOTFAKE-WS] XONG
  bắn: 240 · ok: 238 · từ chối: 2 · CHƯA RÕ: 0 · chặn trùng: 0
```

**Luôn chạy `dryRun: true` trước.** Nó cho biết sẽ gửi cho bao nhiêu chat, bao nhiêu chat
có cờ `ctx7` bật, và danh sách có bị cắt giữa đường không.

---

## 2. Ba thứ lấy tự động (bạn không phải dán token)

| thứ | lấy từ đâu | file |
|---|---|---|
| **token** | hook `fetch`/`XHR` của trang + `__NEXT_DATA__` + localStorage | `loadlist.js` |
| **apiBase** | `location.origin + '/api'` (cùng quy tắc bản cũ, dòng 731) | `loadlist.js` |
| **danh sách chat** | `GET /api/v1/…/conversations` + `next_cursor` | `loadlist.js` |
| **cờ `is_record_ctx_7_days`** | Redux của trang (`pages.activatedMap`) | `loadlist.js` |

Worker **không** đọc được Redux/DOM — nên 4 thứ trên tính ở main thread rồi truyền sang.

---

## 3. Đường gửi dùng ĐÚNG request thật của Pancake

Bản đầu của tôi bịa endpoint nên request **vô hiệu** mà test vẫn xanh (server giả nhận gì
cũng trả `success`). Nay đối chiếu `buildInboxSend` của bản 1.92.55 (dòng 3130):

```
POST {apiBase}/v1/pages/{page_id}/conversations/{convId}/messages?access_token=…
   chữ / 1 ảnh  → multipart/form-data: action=reply_inbox · [is_record_ctx_7_days=true] ·
                  message · [content_id · attachment_id · content_url · width · height] ·
                  send_by_platform=web
   ≥ 2 ảnh      → application/json: { action, message, content_ids, attachment_ids,
                  content_urls, dimensions, send_by_platform: 'web' }
```

**`is_record_ctx_7_days` là cờ quan trọng nhất.** HAR: 19/19 request CÓ cờ ⇒ `success:true`;
24/24 request THIẾU cờ ⇒ `(#10)`. Thiếu cờ là nguyên nhân phổ biến nhất của `#10`,
không phải "app khác giữ thread".

---

## 4. Được bảo đảm (có test khoá)

- **KHÔNG gửi trùng** — 3 cổng `delivered` / `failed` / `inFlight`; cờ `inFlight` đặt
  **đồng bộ** trước mọi `await`. (Bản đầu đặt trong `lane.enqueue` ⇒ microtask sau ⇒
  3 lần gọi song song cùng chat **bắn 3 lần** — K17 khoá lại.)
- **Không ACK = "chưa rõ", KHÔNG bắn lại mù** — ưu tiên không mất tin im lặng > tốc độ.
- **FB từ chối dứt khoát** (`#10`/`#551`/`1545041`) = chốt, không bắn lại.
- **`dead` (chưa bắn) KHÔNG chốt failed** ⇒ kênh khác còn cứu được.
- Nhịp 4 ms/page, hằng số ACK giữ nguyên bản 1.92.55.

## 5. Test — 148 ca, chạy thật

```bash
npm run test:worker
```

| file | ca | đo cái gì |
|---|---|---|
| `test-engine.mjs` | 46 | lõi điều phối, đồng hồ giả, không mạng |
| `test-worker.mjs` | 17 | `worker.js` trong `worker_threads` + HTTP server thật |
| `test-bridge.mjs` | 26 | bundle thật chạy trong `vm` (giả lập trình duyệt) |
| `test-loadlist.mjs` | 32 | tải danh sách + phân trang + `ctx7`, dữ liệu từ HAR thật |
| `test-install.mjs` | 27 | **bản cài end-to-end**: dán file → `BOTFAKE_WS.run()` → server nhận |

Mutation-test (gỡ code ⇒ test phải đỏ): bỏ hook token ⇒ H2/H3 đỏ · bỏ cờ `ctx7` ⇒ I22 đỏ ·
đổi URL về dạng bịa ⇒ I18 đỏ · gỡ strip `export` ⇒ B1/B3 đỏ · bỏ `async` ⇒ B3/B4/B9 đỏ.

## 6. GIỚI HẠN — đọc trước khi tin

1. **Đường gửi là HTTP API, KHÔNG phải Socket** ⇒ chậm hơn bản 1.92.55. Mục đích chính là
   **đo** CPU/ACK khi đường gửi không còn chiếm main thread.
2. **Chưa chuyển MQTT/Socket vào Worker.**
3. **Không có giao diện** — chỉ console.
4. **Không thay thế bản 1.92.55.** Hai đường chạy được cùng lúc nhưng **đừng gửi cùng một
   danh sách bằng cả hai** — lưới chống trùng của mỗi bên không thấy bên kia.
5. **Token hết hạn** ⇒ báo `HTTP 401 — token hết hạn, tải lại trang Pancake`. Tải lại trang
   rồi dán lại file cài.

## 7. Bản đầu đã sai ở đâu (giữ lại để không lặp)

| lỗi | biểu hiện | test bắt |
|---|---|---|
| Bịa endpoint `…/pages/{id}/messages` | request vô hiệu, server thật trả lỗi | I18 |
| Thiếu `action=reply_inbox` | Pancake không hiểu lệnh gửi | I19 |
| Bundle thiếu strip `export` + hàm không `async` | **Worker chết câm, panel không có log** | B1/B3/B4 |
| `loadlist.js` không hook mạng | `pages.fm`: "Không có access_token" dù trang chạy bình thường | H2/H3 |
| `inFlight` đặt sau microtask | chống trùng mà vẫn bắn 3 lần | K17 |
| `stats.n` hiểu sai | tưởng thiếu 1 lần gọi | W2 |
