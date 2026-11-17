# worker-send — tách đường gửi ra khỏi main thread

**Trạng thái: KHUNG CHẠY ĐƯỢC + TEST THẬT. Chưa bật mặc định trong userscript.**

Thư mục này **tách hẳn** khỏi `release/botfake-ext/` và `release/botfake-ext-stable/`:
không file nào ở đây được build vào 2 thư mục release đó, và ngược lại.

---

## 1. Vì sao phải làm (bằng chứng số)

Ba tab cùng chạy (16:27:05 / 16:27:14 / 16:27:18), cả ba đều 1.92.55:

| tab | PHÁT | ACK OK | **no-ACK** | giữ slot | 🫥 CPU-kẹt |
|---|---|---|---|---|---|
| 16:27:05 | 19,28/s | **77** | **5 601** | 5 372 ms | `+84 969 s` · trễ 15 925 lần · max 10,9 s |
| 16:27:14 | 16,23/s | 132 | 5 038 | — | — |
| 16:27:18 | 16,51/s | 5 080 | 2 033 | — | `+66 575 s` · trễ 15 015 lần · **max 45,9 s** |

Mà tab 1 ghi `chờ 364 ms · còn lại 5 372 ms` ⇒ **98,7 % thời gian giữ slot là KẸT**,
không phải I/O. `p90 ACK 6 572 ms > trần ACK_HOLD_CEIL_MS 6 000` ⇒ **cắt ACK thật**.

Chuỗi nhân quả: **CPU bị bóp → đồng hồ trễ → ACK về muộn hơn hạn chờ → mất ACK.**

Hạ nhịp VẼ DOM không cứu được: thủ phạm là promise/closure tạo **theo từng chat**
(`runPool` một closure/chat, `sleepUntil` ba promise mỗi lần gọi).

## 2. Cấu trúc

| file | chạy ở đâu | làm gì |
|---|---|---|
| `engine.mjs` | Worker **và** Node | lõi điều phối: chống trùng 3 lớp, slot, hạn chờ ACK, phân loại kết quả. **Không DOM, không localStorage, không fetch.** |
| `worker.js` | Web Worker | lớp vỏ: nhận `postMessage`, gọi `fetch` tới API Pancake, đẩy log/tick về trang |
| `bridge.js` | main thread (userscript) | tạo Worker từ Blob, đưa token/apiBase, nhận log, trả lời RPC |
| `test-engine.mjs` | Node | **46 test** lõi điều phối, đồng hồ giả, không cần mạng |
| `test-worker.mjs` | Node | **15 test** chạy **worker thật** + **HTTP server thật** |

## 3. Điều được bảo đảm (có test khoá)

- **KHÔNG gửi trùng.** 3 cổng: `delivered` · `failed` · `inFlight`. Cờ `inFlight` đặt
  **đồng bộ** trước khi vào lane — đây là chỗ bản đầu của tôi **sai** (đặt trong lane ⇒
  microtask sau ⇒ 3 lần gọi song song lọt hết). Test `K17`/`K43` khoá lại.
- **ACK không có = "chưa rõ", KHÔNG bắn lại mù** (`K23`–`K27`). Giữ ưu tiên
  *không mất tin im lặng* hơn tốc độ.
- **FB từ chối dứt khoát (#10/#551/1545041) = chốt, không bắn lại** (`K30`–`K32`).
- **`dead` (chưa bắn) KHÔNG bị chốt failed** ⇒ kênh khác còn cứu được (`K33`–`K34`).
- **Nhịp phát 4 ms/page, độc lập giữa các page** (`K35`–`K37`).
- Hằng số **giữ nguyên** bản 1.92.55: `SOCKET_MIN_PACE_MS 4` · `ACK_HOLD 1 200–6 000` ·
  `ACK_LISTEN 12 000–30 000`.

## 4. Chạy test

```bash
node worker-send/test-engine.mjs   # 46 test, ~0,2 s, không cần mạng
node worker-send/test-worker.mjs   # 15 test, chạy worker thật + HTTP server thật
```

## 5. Còn thiếu để bật được (theo thứ tự)

1. **RPC dò global_id.** Worker không đọc được Redux/IndexedDB → main thread phải trả lời
   qua `API.onRpc('gid', fn)`. Cầu nối **đã có sẵn chỗ này**, chỉ chưa nối vào hàm cũ.
2. **Đường gửi đang implement là HTTP API.** Đây là đường **an toàn nhất cho Worker**
   (fetch có sẵn, không cần DOM) nhưng **chậm hơn Socket**. Muốn dùng Socket trong Worker
   thì phải chuyển MQTT client sang worker — việc lớn, chưa làm.
3. **Bind fbId ảnh** (POST `/contents/facebook`) phải qua RPC vì cần token + logic bù.

## 6. Bật thử (không ảnh hưởng bản đang chạy)

```js
// Trong console trang Pancake, sau khi nạp bridge.js:
const b = window.__BOTFAKE_WORKER_SEND__;
b.setSources(ENGINE_SRC, WORKER_SRC);          // nội dung 2 file
b.setConfig({ mainCap: 96, apiBase: 'https://pages.fm/api/public_api/v1', accessToken: TOKEN });
b.on('log', r => console.log('[WS]', r));
b.start();
b.send([{ id: '123_456', pageId: '123', text: 'xin chào' }]);
```

Đường cũ **vẫn nguyên** — cái này chỉ chạy khi gọi `start()`/`send()`.
