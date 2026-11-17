# GỬI BẰNG WORKER — cách dùng

## Chỉ 3 bước

### 1. Mở file này

`worker-send/cai-dat.js` — bấm vào, rồi **Ctrl+A** chọn hết, **Ctrl+C** copy.

> File đã có sẵn trong repo. Không cần chạy lệnh gì cả.

### 2. Dán vào trang Pancake

1. Mở tab Pancake, **đợi danh sách chat hiện ra**
2. Bấm `F12`
3. Chọn tab **Console**
4. **Ctrl+V** dán → `Enter`

### 3. Bấm nút

Góc **dưới phải** màn hình hiện khung **"Gửi bằng Worker"**:

```
┌─────────────────────────────┐
│ Gửi bằng Worker         —  ✕│
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │ Nhập nội dung…          │ │
│ └─────────────────────────┘ │
│ 2 chat · bật cờ 7 ngày: 2   │
│ [⟳ Tải danh sách] [⚡ Gửi]  │
│ [⏹ Dừng]                    │
│ ┌─────────────────────────┐ │
│ │ XONG: ok 2/2            │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

- Bấm **⟳ Tải danh sách** → chờ vài giây, nó báo *"2 chat · bật cờ 7 ngày: 2"*
- Nhập nội dung
- Bấm **⚡ Gửi** → hỏi xác nhận → OK

**Hết.** Không có bước 4.

---

## Nếu bạn muốn gọn hơn nữa

| cách | số bước |
|---|---|
| **Dán console** (trên) | 3 |
| **Tampermonkey** — dán 1 lần, tự chạy mọi lần mở Pancake | 1 (làm 1 lần, dùng mãi) |

### Cài Tampermonkey (1 lần, dùng mãi)

1. Cài extension **Tampermonkey**
2. Bấm icon Tampermonkey → **Create a new script**
3. **Ctrl+A** xoá hết → **Ctrl+V** dán nội dung `cai-dat.js`
4. **Ctrl+S** lưu
5. Xong. Mỗi lần mở Pancake nút tự hiện.

Sau đó **không phải dán gì nữa**.

---

## Hai điều cần biết

**1. Phải tải danh sách trước.** Nút "Gửi" bị khoá cho tới khi bấm "Tải danh sách" —
để bạn thấy trước sẽ gửi cho bao nhiêu chat.

**2. Nếu hiện "CHƯA RÕ".** Nghĩa là server không trả lời cho mấy chat đó — **không biết
đã gửi hay chưa**. Khung sẽ cảnh báo. **Đừng bấm gửi lại toàn bộ** — sẽ gửi trùng.
Kiểm tay mấy chat đó trước.

---

## Đây là bản gì

Bản **thử nghiệm** để đo: khi đường gửi không còn chạy trên main thread thì CPU tab
có về ~0 và ACK còn bị mất không.

- **Không thay thế** bản 1.92.55 bạn đang dùng
- Dùng **HTTP API** (chậm hơn Socket của bản cũ)
- **Đừng gửi cùng một danh sách** bằng cả hai bản — chống trùng của mỗi bên không thấy bên kia

## Lỗi thường gặp

| hiện tượng | nguyên nhân | cách sửa |
|---|---|---|
| Không thấy nút nào | dán vào Console của trang khác, hoặc trang chưa tải xong | Đúng tab Pancake, đợi trang tải xong rồi dán lại |
| "Không tìm thấy access_token" | token chưa có trong request nào | Tải lại trang Pancake (F5) rồi dán lại |
| "Không xác định được page_id" | Redux chưa sẵn sàng | Đợi danh sách chat hiện ra rồi bấm Tải lại |
| Nút Gửi vẫn xám | chưa bấm "Tải danh sách", hoặc danh sách rỗng | Bấm "Tải danh sách" trước |
| Panel hiện "LỖI: HTTP 401" | token hết hạn | F5 tải lại trang rồi dán lại file |
