# GỬI BẰNG WORKER — cách cài

## Cách 1 (KHUYÊN): Tampermonkey — cài 1 lần, dùng mãi

Sau khi cài, **mỗi lần mở Pancake nút tự hiện**. Không phải dán gì nữa.

1. Cài extension **Tampermonkey** (Chrome Web Store)
2. Mở link này, Tampermonkey sẽ tự bật bảng cài đặt:
   **`worker-send/cai-dat.js`** → bấm **Install**
3. Mở Pancake → khung **"Gửi bằng Worker"** hiện ở góc dưới phải

> `cai-dat.js` có sẵn header `// ==UserScript==` nên Tampermonkey nhận trực tiếp.
> Nếu trình duyệt hiện chữ thay vì bảng cài: bấm icon Tampermonkey → **Create a new
> script** → Ctrl+A → dán → Ctrl+S.

## Cách 2: dán console (dùng thử 1 lần)

1. Mở `worker-send/cai-dat.js`, **Ctrl+A → Ctrl+C**
2. Mở Pancake, `F12` → **Console** → `Ctrl+V` → `Enter`
3. Khung hiện ở góc dưới phải

---

# Dùng

```
┌─────────────────────────────┐
│ Gửi bằng Worker         —  ✕│
├─────────────────────────────┤
│ [ Nhập nội dung…          ] │
│ 1 600 chat · cờ 7 ngày: 412 │
│ [⟳ Tải danh sách] [⚡ Gửi]  │
│ [⏹ Dừng]                    │
└─────────────────────────────┘
```

1. **⟳ Tải danh sách** — chờ tới khi hiện số chat
2. Nhập nội dung
3. **⚡ Gửi** → xác nhận

Nút **Gửi bị khoá** cho tới khi tải xong danh sách — để bạn thấy trước sẽ gửi cho bao nhiêu.

---

# Tải danh sách — đã sửa lỗi "dừng ở 40"

Lỗi bạn gặp có **3 nguyên nhân**, cả 3 đã sửa và có test khoá:

| # | nguyên nhân | trước | sau |
|---|---|---|---|
| 1 | tải nhiều page mà gọi **endpoint gộp** ⇒ các page khử trùng lẫn nhau | 440/1600 chat | **1600/1600** |
| 2 | dính **429** là dừng luôn | dừng ở 40 | thử lại 3 lần + nghỉ chung 2,5 s |
| 3 | chỉ đọc `data.conversations` | 0 chat mà báo thành công | đọc cả `data.data.conversations` |

Số thật theo HAR: **40 chat/trang** kèm `next_cursor` (bản trước tôi để 60 — sai).

Nếu vẫn thiếu, panel **nói rõ**: `Tải THIẾU: … — vẫn đi tiếp với N chat`. Không im lặng.

---

# Trước khi tin bản này

- Đường gửi là **HTTP API**, chưa phải Socket ⇒ **chậm hơn** bản 1.92.55
- **Đừng gửi cùng một danh sách** bằng cả hai bản
- Hiện **"CHƯA RÕ"** nghĩa là server không trả lời — **đừng chạy lại toàn bộ**, gửi trùng

## Lỗi thường gặp

| hiện tượng | cách sửa |
|---|---|
| Không thấy khung | Đúng tab Pancake, đợi trang tải xong |
| "Không tìm thấy access_token" | F5 tải lại trang rồi bấm Tải danh sách lại |
| Tải được 40 rồi dừng | Đã sửa — nếu còn, gửi tôi dòng log `Tải THIẾU:` |
| "HTTP 401" | Token hết hạn, F5 |
