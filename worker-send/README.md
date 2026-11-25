# worker-send

**Cách dùng: xem [HUONG-DAN.md](HUONG-DAN.md) — 3 bước, bấm nút.**

File cài: **`cai-dat.js`** (62,7 KB, sinh tự động — đừng sửa tay).

| file | chạy ở | nội dung |
|---|---|---|
| `engine.mjs` | Worker + Node | lõi điều phối, không DOM/localStorage/fetch |
| `worker.js` | Web Worker | vỏ: postMessage + `fetch` + tương thích Node |
| `loadlist.js` | main thread | hook token, tải danh sách, cờ `ctx7` |
| `bridge.js` | main thread | tạo Worker từ Blob, cấp cấu hình, nhận log |
| `build.mjs` | Node | gộp 4 file trên → `cai-dat.js` + kiểm parse |
| `cai-dat.js` | trang Pancake | **FILE DUY NHẤT CẦN DÙNG** |

## Test — 154 ca

```bash
npm run test:worker
```

| file | ca |
|---|---|
| `test-engine.mjs` | 46 |
| `test-worker.mjs` | 17 |
| `test-bridge.mjs` | 26 |
| `test-loadlist.mjs` | 32 |
| `test-install.mjs` | 33 (dán file → **bấm nút** → server thật) |

## Sửa file rồi build lại

```bash
node worker-send/build.mjs     # → cai-dat.js
```

## Giới hạn

Đường gửi là **HTTP API, chưa phải Socket** ⇒ chậm hơn bản 1.92.55. Không thay thế bản cũ.
Đừng gửi cùng một danh sách bằng cả hai bản.
