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
KHÁC** bản `.crx`. Nghĩa là Chrome coi là **hai extension riêng**, không nâng cấp.

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

## 3. ⚠️ KHÔNG có bản `.crx` mới — đây là bẫy

Trong repo có `botfake.crx`, **nhưng nó là bản 1.91.43 CŨ** (đã giải nén kiểm bên trong).

`manifest.json` có `update_url` trỏ về
`https://chongoan4444.github.io/SALESCRIPT/update.xml`, và file đó khai `version='1.92.55'`.
Nghĩa là **Chrome đang cài từ `.crx` sẽ tự tải bản cũ từ trang đó**, không phải bản ở đây.

Chính `npm run build` cũng in cảnh báo này:

```
! botfake.crx chứa bản userscript CŨ (khác scripts/pancake-send-lite.user.js).
  Chrome đang cài từ .crx sẽ vẫn chạy code cũ → chạy "node tools/build.mjs --crx" với khoá ký.
```

Muốn có `.crx` mới thì cần **khoá ký riêng** (`installer/extension-signing-key.pem`) —
**không có trong repo** (đã `.gitignore`). Việc này phải làm trên máy bạn.

---

## 4. THỬ `worker-send/` (đường gửi mới, chưa bật mặc định)

Đây **không phải** bản cài. Là đường chạy **song song**, bật bằng tay trong console.
Code cũ vẫn là đường gửi chính.

```js
// 1) Mở trang Pancake, F12 → Console. Dán NGUYÊN nội dung 3 file:
//    worker-send/bridge.js
//    rồi gán nội dung 2 file còn lại:
const ENGINE = `...nội dung worker-send/engine.mjs...`;
const WORKER = `...nội dung worker-send/worker.js...`;

// 2) Bật
const b = window.__BOTFAKE_WORKER_SEND__;
b.setSources(ENGINE, WORKER);
b.setConfig({
  mainCap: 96,
  apiBase: 'https://pages.fm/api/public_api/v1',   // kiểm lại base đúng của bạn
  accessToken: '<access_token trong localStorage/cookie Pancake>',
});
b.on('log', r => console.log('[WS]', r));
b.start();

// 3) Gửi thử 1 chat
b.send([{ id: '111_222', pageId: '111', text: 'xin chào' }]);
```

Kiểm: `b.stats()` phải có `ok: 1`, và **server Pancake nhận đúng 1 tin**.

**Giới hạn phải biết (không tô hồng):**
- Đường gửi là **HTTP API, chưa phải Socket** ⇒ chậm hơn đường cũ.
- **Chưa chuyển MQTT vào Worker.**
- RPC dò `global_id` mới có khung (`b.onRpc('gid', fn)`), chưa nối vào hàm cũ.
- **Chưa có giao diện** — chỉ console.

---

## 5. Bảng tra nhanh

| bạn đang có | làm gì |
|---|---|
| Extension load unpacked | Thay folder bằng `release/botfake-ext/` mới, bấm **Reload** ở `chrome://extensions` |
| Extension cài từ `.crx` | **Gỡ hẳn**, rồi làm §1 (vì `.crx` trong repo là 1.91.43) |
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
