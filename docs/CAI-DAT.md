# CÀI BẢN MỚI — hướng dẫn thực tế

> Viết ngày 2026-11-11, sau khi kiểm trực tiếp trong repo.
> Mọi số/đường dẫn dưới đây đã đối chiếu với file thật, không phải nhớ.

---

## 0. ĐỌC CÂU NÀY TRƯỚC — "bản vừa tạo để đỡ lag" CHƯA PHẢI BẢN CÀI ĐƯỢC

`worker-send/` mới là **khung + test**, chưa nối vào userscript:

```
grep -c "worker-send" scripts/pancake-send-lite.user.js   →  0
```

⇒ Bản `1.92.55` bạn đang chạy **KHÔNG chứa** worker này. Cài đè cũng không đỡ lag,
vì code chống lag chưa được gọi ở đâu cả.

**Bản 1.92.55 hiện tại đã sửa gì:** 3 số đo sai + 1 kết luận sai đã rút lại.
**Không đổi nhánh gửi.** Nên nếu bạn muốn "đỡ lag" thì:

| việc | hiệu quả | cần code? |
|---|---|---|
| **3 tab → 1 tab/page** | **10× ít lỗi hơn, cùng tốc độ** | KHÔNG |
| nạp `worker-send/` (đường gửi mới) | CPU main thread ~0 | CẦN — xem §3 |

---

## 1. CÀI EXTENSION (khuyến nghị — đường chuẩn)

### 1.1 Tải 2 thứ này

Từ máy bạn, mở GitHub (repo **public**, không cần đăng nhập):

```
https://github.com/chongoan4444/BOTFAKE-REWORK
```

Bấm **Code → Download ZIP**, giải nén. Rồi lấy thư mục:

```
BOTFAKE-REWORK/release/botfake-ext/
```

Đây là folder **tự chứa, hoàn chỉnh**: `manifest.json` + `extension/` + `scripts/`.
Đã kiểm: 14 file, version `1.92.55`, userscript `1.92.55-W200.101` khớp nguồn.

> Hoặc tải thẳng `dist/botfake.zip` (nếu đã build) — cùng nội dung.

### 1.2 Cài vào Chrome

1. Mở `chrome://extensions`
2. Bật **Developer mode** (góc trên phải)
3. Bấm **Load unpacked**
4. Chọn **ĐÚNG** thư mục `release/botfake-ext/` — thư mục **chứa `manifest.json`**
   (không chọn thư mục cha, không chọn `extension/`)

### 1.3 ⚠️ BẮT BUỘC: gỡ bản cũ trước

`manifest.json` **không có trường `key`** (đã kiểm) ⇒ bản load unpacked ra **extension ID
KHÁC** bản `.crx` cũ. Nghĩa là Chrome coi là **hai extension riêng**, không nâng cấp.
`update_url` đã bị xoá ở v1.93.18 nên bản load unpacked sẽ KHÔNG bị kênh crx ghi đè nữa.

Hậu quả nếu để cả hai: hai bản cùng chèn vào trang Pancake.

**Đã kiểm là có lưới chặn:** `scripts/pancake-send-lite.user.js` dòng 48–60 có
`botfakeClaimSlot()` + `data-botfake-active` trên `<html>` ⇒ **bản chạy sau tự thoát**,
không bắn đôi. Nhưng **vẫn phải gỡ bản cũ** — nếu không bạn không biết bản nào đang chạy,
và số đo trong panel sẽ lẫn.

Cách gỡ: `chrome://extensions` → tìm **BOTFAKE LITE** → **Remove** (tất cả bản đang có).

### 1.4 Kiểm đã đúng bản mới

Mở Pancake → mở panel BOTFAKE. Tiêu đề panel phải ghi:

```
1.92.55-W200.101
```

Nếu vẫn thấy số cũ ⇒ Chrome đang chạy bản khác (kiểm lại §1.3), hoặc tab cũ chưa
tải lại: **Ctrl+Shift+R**.

---

## 2. CÀI USERSCRIPT (đơn giản hơn, không cần Developer mode)

1. Cài **Tampermonkey** (hoặc Violentmonkey).
2. Mở file `scripts/pancake-send-lite.user.js` bằng trình soạn thảo, **Ctrl+A → Ctrl+C**.
3. Tampermonkey → **Create a new script** → **Ctrl+A → Ctrl+V** → **Ctrl+S**.
4. **TẮT extension BOTFAKE** trong `chrome://extensions` (nếu không, hai bản cùng chèn —
   xem §1.3).
5. Tải lại trang Pancake. Kiểm tiêu đề panel = `1.92.55-W200.101`.

> Cách này **không** có popup/service worker của extension. Chỉ có panel trong tab Pancake.

---

## 3. ✅ ĐÃ XOÁ ĐƯỜNG `.crx` (v1.93.18) — cài bằng Load unpacked

**Trước v1.93.18** trong repo có `botfake.crx` và nó là **bẫy thật**: file bên trong là bản
**1.91.43** nhưng `update.xml` lại khai `version` MỚI (cuối cùng là `1.93.18`). Chrome cài qua
`update_url` đọc `update.xml`, thấy "có bản mới", tải `.crx` về — và chạy **code 1.91.43** cũ.
Bản mới cài tay thì bị ghi đè ở lần cập nhật sau. Không có khoá ký
(`installer/extension-signing-key.pem`, không có trong repo) thì **không thể** ký `.crx` mới,
nên đường này không bao giờ đúng được.

**Nay (người dùng chốt: "kệ cái file crx, xoá luôn đi"):** đã xoá

- `botfake.crx` và `update.xml`
- `update_url` trong `manifest.json`
- `npm run build:crx` + toàn bộ code ký CRX3 trong `tools/build.mjs`
- `*.crx` và `update.xml` đã vào `.gitignore` để không ai commit lại

**Cài đặt từ nay:**

| muốn dùng | làm thế này |
|---|---|
| Bản gốc | `chrome://extensions` → bật Developer mode → **Load unpacked** → chọn `release/botfake-ext/` |
| Bản ổn định | **Load unpacked** → chọn `release/botfake-ext-stable/` |
| Không dùng extension | cài userscript `scripts/pancake-send-lite.user.js` (hoặc `...-stable.user.js`) |

Máy đang cài từ `.crx` cũ: **gỡ hẳn** extension đó rồi làm theo bảng trên. Đừng cài chồng —
Chrome coi bản `.crx` và bản Load unpacked là hai extension khác nhau (khác khoá ký + khác
`update_url`), nên chúng **cùng chạy** và cùng gửi tin.

---

## 4. DÙNG `worker-send/` (đường gửi chạy trong Web Worker)

**Không phải extension.** Là 1 file JS dán vào console trang Pancake. Không cần
Developer mode, không cần cài gì.

### 4.1 Tạo file cài

```bash
node worker-send/build.mjs
# → dist/worker-send.install.js   (57,7 KB)
```

Hoặc tải `dist/worker-send.install.js` từ máy bạn sau khi chạy lệnh trên.

### 4.2 Nạp

1. Mở tab Pancake, **đợi danh sách chat tải xong**
2. `F12` → **Console**
3. Dán toàn bộ file → `Enter`

Thấy `[BOTFAKE-WS] đã nạp ✓` là được.

### 4.3 Dùng

```js
BOTFAKE_WS.help()
BOTFAKE_WS.run({ text: 'Xin chào', dryRun: true })   // CHẠY THỬ, không gửi
BOTFAKE_WS.run({ text: 'Xin chào' })                 // GỬI THẬT
BOTFAKE_WS.run({ text: '…', limit: 8, maxPages: 5 }) // 8 luồng, tải 5 trang
BOTFAKE_WS.stats()    // số đo
BOTFAKE_WS.results()  // chat nào OK / chat nào CHƯA RÕ
BOTFAKE_WS.stop()
```

**Luôn `dryRun: true` trước.** Nó báo: bao nhiêu chat, bao nhiêu có cờ `ctx7`, danh sách
có bị cắt giữa đường không.

### 4.4 Giới hạn (đọc trước khi tin)

- Đường gửi là **HTTP API, không phải Socket** ⇒ **chậm hơn** bản 1.92.55.
- Chưa chuyển MQTT vào Worker. Không có giao diện, chỉ console.
- **Đừng gửi cùng một danh sách bằng cả bản cũ và bản này** — lưới chống trùng của mỗi
  bên không thấy bên kia.
- Token hết hạn ⇒ `HTTP 401` ⇒ tải lại trang rồi dán lại file.

## 5. Bảng tra nhanh

| bạn đang có | làm gì |
|---|---|
| Extension load unpacked | Thay folder bằng `release/botfake-ext/` mới, bấm **Reload** ở `chrome://extensions` |
| Extension cài từ `.crx` cũ | **Gỡ hẳn**, rồi làm §1 (Load unpacked — đường .crx đã xoá) |
| Userscript Tampermonkey | Dán đè, Ctrl+S, tải lại trang |
| Vừa extension vừa userscript | **Gỡ một bên** — lưới chặn chỉ cứu một phần, số đo sẽ lẫn |

---

## 6. Việc NÊN LÀM NGAY, không cần cài gì

**3 tab → 1 tab/page.**

| cách chạy | tổng tốc độ | no-ACK |
|---|---|---|
| 3 tab song song | 52/s | **12 672** |
| 1 tab | 51/s | **1 246** |

Cùng tốc độ, **ít hơn 10× lỗi**. (Nguồn: log 16:27 vs lô 14:03.)
