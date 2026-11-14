# SALESCRIPT / BOTFAKE

## Mục đích

Repo chứa **extension BOTFAKE LITE** (Chrome MV3) + **userscript** gửi hàng loạt tin nhắn
Pancake, cùng các file tham chiếu lấy từ website thật (HTML/JS/HAR) để phân tích cấu trúc
DOM & API trước khi sửa code.

## Cấu trúc

```
manifest.json                     # khai báo MV3 — nguồn sự thật về quyền/entry-point
version.json                      # NGUỒN VERSION DUY NHẤT { base, build }
update.xml                        # manifest tự cập nhật (Chrome đọc từ GitHub Pages)
botfake.crx                       # bản đóng gói đang phát hành (phải build lại khi sửa code)
package.json                      # lệnh build/check (không có dependency)

extension/                        # code tiện ích (service worker, content script, popup)
  background.js                   #   SW: gửi nền, overlay job, cookie jar, DNR rule, fetch proxy
  bridge.js                       #   isolated world ↔ MAIN world (chuyển tiếp chrome.runtime)
  overlay.js                      #   thanh tiến độ Pancake #1/#2 trên MỌI tab
  popup.html / popup.js           #   popup "Hiện panel"
  icons/icon16|32|48|128.png      #   icon (icon-src.png = ảnh gốc)

scripts/
  pancake-send-lite.user.js       # TOÀN BỘ logic gửi trong tab Pancake (panel, quét list, Wave 200)
                                  #   ↳ BẢN GỐC: dùng để tinh chỉnh, log đầy đủ (SOCKET/API/WAVE/globalId)
  pancake-send-stable.user.js     # BẢN ỔN ĐỊNH cho người dùng cuối — sinh từ bản gốc:
                                  #   • KHÔNG nhớ/lọc chat gửi lỗi (không có "danh sách đen")
                                  #   • có công tắc "TAB:" trên tiêu đề panel (mặc định TẮT gửi bằng Tab)
                                  #   • log cuối gọn: chỉ còn dòng tổng kết (✅/❌/⚠/thời gian)

release/
  botfake-ext/                    # folder phát hành BẢN GỐC (manifest nạp pancake-send-lite)
  botfake-ext-stable/             # folder phát hành BẢN ỔN ĐỊNH (tiện ích riêng, nạp pancake-send-stable)

tools/
  build.mjs                       # đồng bộ version + kiểm tra + đóng gói zip cho CẢ HAI folder
  make-stable.mjs                 # sinh scripts/pancake-send-stable.user.js từ bản gốc

# ---- file tham chiếu, KHÔNG tham gia build ----
html.txt, html2.txt, html3.txt, "html comment list", taodon   # DOM Pancake đã lưu
_app-*.v6.js, dashboard-*.v6.js                               # JS website tải về
*.har                                                          # network (rất nặng)
BOTFAKE FULL, BOTFAKE.TXT                                      # bản script cũ (đối chiếu lịch sử)
MESSAGE POST, post, "lại là POST"                              # mẫu curl API gửi tin
```

> `background.js`, `bridge.js`, `overlay.js`, `popup.*`, `pancake-send-lite.user.js`
> **phải** nằm đúng thư mục trên: `manifest.json` và các lệnh `chrome.scripting.executeScript`
> trỏ theo đường dẫn tuyệt đối tính từ gốc repo.

## Tải về dùng ngay (1 folder)

Trên GitHub đã có sẵn **`release/botfake-ext/`** — folder tiện ích **hoàn chỉnh, tự chứa**
(`manifest.json` + `extension/` + `scripts/`). Tải folder đó về → `chrome://extensions` →
Developer mode → **Load unpacked** → chọn đúng folder chứa `manifest.json`.

Bản ổn định có folder riêng: **`release/botfake-ext-stable/`** — tiện ích **độc lập**
(tên `BOTFAKE STABLE`, manifest riêng, chỉ nạp `scripts/pancake-send-stable.user.js`).
Cài/gỡ nó không ảnh hưởng bản gốc và ngược lại; hai folder này cũng không dùng chung
`update_url` nên bản ổn định không bị kéo về code của bản gốc.

Cả hai folder **sinh tự động** từ mã nguồn: đừng sửa trực tiếp trong đó, sửa ở nguồn rồi chạy
`npm run build`. `npm run check` sẽ cảnh báo nếu folder phát hành bị lệch so với nguồn.

## Hai bản script

| | `pancake-send-lite.user.js` | `pancake-send-stable.user.js` |
|---|---|---|
| dành cho | người tinh chỉnh theo log | người dùng cuối |
| nhớ chat lỗi | ✅ có (tự bỏ chọn lần sau) | ❌ **bỏ hẳn** — không lọc gì |
| phím Tab | **công tắc `TAB:`** trên panel, mặc định **BẬT** (bấm Tab = Chạy) | cùng công tắc đó, mặc định **TẮT** |
| log cuối | 📊 + ⚡TỐC ĐỘ + 🌊WAVE + 📡SOCKET + 🌐API + 🧭globalId | **chỉ 📊 tổng kết** |
| version hiển thị | `1.92.20-W200.62` | `1.92.20-STABLE` |

`scripts/pancake-send-stable.user.js` được sinh từ bản gốc bằng một loạt thay đổi có đánh dấu
`[STABLE]` — muốn sửa logic gửi thì **sửa bản gốc rồi sinh lại bản ổn định**, đừng sửa tay hai nơi.

Cài **một trong hai** là đủ. Nếu vô tình cài cả hai, chúng tự nhường nhau (bản nào nạp trước
thắng, bản sau tự tắt) nên **không bao giờ có hai bộ cùng gửi** trong một tab.

### Bản nào thực sự được nạp?

| Cách bạn dùng | Bản chạy |
|---|---|
| **Extension bản gốc** (`release/botfake-ext/`, `dist/botfake.zip`) | **bản gốc** — manifest chỉ khai báo `scripts/pancake-send-lite.user.js`; bản ổn định *không* có trong folder này |
| **Extension bản ổn định** (`release/botfake-ext-stable/`, `dist/botfake-stable.zip`) | **bản ổn định** — manifest khai báo `scripts/pancake-send-stable.user.js`, tên `BOTFAKE STABLE`, không có `update_url` |
| **Tampermonkey**, chỉ cài 1 file | đúng file bạn cài |
| **Tampermonkey**, cài cả 2 file | file nào Tampermonkey nạp trước thì thắng, file kia tự tắt (thứ tự không do ta quyết) |

Hai tiện ích nói chuyện với userscript trên **kênh riêng** (`__botfakeS` +
`<html data-botfake-ext-stable>`), nên cài cả hai cũng không thể cùng trả lời một lệnh gửi.
Dù vậy vẫn nên **cài một bản** cho gọn.

Muốn biết đang chạy bản nào: nhìn dòng version trên tiêu đề panel —
`1.92.17-W200.59` = bản gốc, `1.92.17-STABLE` = bản ổn định. Dấu `[STABLE]` cũng được in vào
`<html data-botfake-active="…">` trong DOM để kiểm tra bằng DevTools.

## Build & phát hành

Version chỉ khai báo **một lần** trong `version.json`:

```json
{ "base": "1.91.72", "build": "W200.14" }
```

| Nơi dùng | Giá trị |
|---|---|
| `manifest.json` → `version` | `base` (Chrome chỉ nhận số, tối đa 4 phần) |
| userscript → `// @version` | `base-build` (chữ thường) → `1.91.72-w200.14` |
| userscript → `APP_VERSION` | `base-build` → `1.91.72-W200.14` (hiện trên tiêu đề panel) |
| `update.xml` → `version` | `base` |

```bash
npm run check      # kiểm tra version + mọi đường dẫn manifest tồn tại (dùng cho CI, không ghi file)
npm run build      # đồng bộ version + xuất dist/botfake.zip
npm run build:crx  # thêm: ký & ghi botfake.crx (cần khoá ký)
```

Khoá ký **không bao giờ commit** (repo công khai):

```bash
installer/extension-signing-key.pem      # mặc định
CRX_SIGNING_KEY=/path/to/key.pem         # hoặc qua biến môi trường
```

Không có khoá → build vẫn xuất zip nhưng **giữ nguyên `botfake.crx` cũ**; `npm run check`
sẽ cảnh báo nếu crx đang phát hành chứa userscript khác bản hiện tại (Chrome cài từ `.crx`
sẽ chạy code cũ dù bạn đã sửa).

Quy trình phát hành: sửa code → tăng `base`/`build` trong `version.json` →
`npm run build:crx` → commit `botfake.crx` + `update.xml` → push (GitHub Pages phục vụ).

## Cơ chế gửi – nhận phản hồi – bù (v1.91.73)

Nguyên tắc: **chỉ bù khi có bằng chứng DƯƠNG TÍNH rằng tin chưa đi**. Không thấy tin
trong lịch sử *không phải* bằng chứng — API lịch sử của Pancake trễ vài giây.

### Bằng chứng từ HAR (54 request `reply_inbox`)

| Cờ `is_record_ctx_7_days` | Kết quả server | Số ca |
|---|---|---|
| **Có** | `success: true` | 19/19 |
| **Không** | `e_code 10`, `e_subcode 2018300` — "(#10) …ứng dụng khác đang kiểm soát thread" | 24/24 |
| Có / Không | `e_code 551`, `e_subcode 1545041` — "(#551) Người này hiện không có mặt" | 5 / 6 |

⇒ `(#10)` phần lớn là do **thiếu cờ**, không phải app khác giữ thread. Response lỗi thật
dùng `e_code`/`e_subcode` (không có `message_code`).

### Mất ACK ở lô lớn (v1.91.74)

`_app` @818834 — `publish()` gán **`request_id = ++sock.requestId` NGAY, đồng bộ, bên trong
hàm**, rồi lưu `PENDING_MESSAGES['{pageId}_{request_id}']`; `/ls_resp` echo `request_id` để
tra đúng entry. Bản cũ **đoán** id của mình bằng `sock.requestId + 1` đọc *trước* lệnh gọi
(cách nhau một microtask) ⇒ với 192 làn cùng page thì gần như luôn SAI. Nặng hơn: khi hết
15s nó `clearTimeout` + xoá `PENDING_MESSAGES[id đoán]` — tức entry của **tin khác** — làm
promise của tin đó không bao giờ resolve (timer của nó vừa bị xoá) ⇒ chat treo "chờ ACK"
tới watchdog 180 s.

Nay: đọc `requestId` **ngay sát** lệnh gọi (chính xác tuyệt đối) và khi timeout **chỉ** dọn
entry của chính mình, có so sánh tham chiếu object.

### Các thay đổi

1. **`(#10)` mà request thiếu cờ** → gửi lại **đúng 1 lần kèm cờ** trước khi kết luận.
   (`#10` = server chưa gửi ⇒ gửi lại không thể trùng.)
2. **Không chặn API cấp page vì 1 ca lẻ** — chỉ chặn khi lỗi lặp ≥ 3 lần liên tiếp; một ca
   thành công là reset. Trước đây 1 lần `#10` khoá page 4 giờ.
3. **Phân xử lịch sử 3 trạng thái** (`historyVerdict`): `yes` / `no` / `unknown`.
   - `no` chỉ khi có **mốc nước**: tin mới nhất của cả chat vẫn cũ hơn `sentAt − 3s`.
   - Bỏ dòng "mọi tin của page sau `sentAt−2s` đều tính là đã gửi" (chốt ✅ oan ⇒ mất tin).
4. **Kiểm chứng Socket đọc lặp** (3–4 lần, cách 2–6s) và chỉ bù khi `no` **hai lần liên tiếp**
   — đây là chỗ gây *lặp câu* do API lịch sử trễ.
5. **Ca "không rõ kết quả"** (timeout/5xx) trước đây chốt ⚠ rồi bỏ (mất tin) → nay kiểm chứng
   lịch sử sau 9s + 7s: `yes` → ✅, `no` → bù 1 vòng, còn lại giữ ⚠.

Chạy `npm test` để kiểm tra 12 kịch bản phân xử (test trích thẳng hàm thật từ userscript).

## Quy tắc khi viết script cho website

- Khi người dùng yêu cầu viết script cho website, trước tiên phải kiểm tra các file
  source trong repository có liên quan đến yêu cầu.
- Ưu tiên sử dụng thông tin thực tế từ source thay vì đoán selector, class, id,
  attribute hoặc cấu trúc DOM.
- Khi cần tìm một phần tử HTML, hãy xác định chính xác id, class, data-* attribute,
  cấu trúc cha/con và các đặc điểm liên quan từ source.
- Có thể tham khảo các file JavaScript trong repository để hiểu logic của website.
- Không tự ý giả định rằng một API, selector hoặc biến tồn tại nếu source không cho thấy điều đó.
- Nếu source hiện tại không đủ thông tin để xác định chính xác cách hoạt động,
  phải nói rõ phần nào chưa xác định được thay vì bịa ra.
- Khi viết JavaScript/Tampermonkey, ưu tiên script ổn định trước những thay đổi nhỏ
  của giao diện.
- Không sửa hoặc xóa source reference hiện có trừ khi người dùng yêu cầu.
- Khi trả về script, giải thích ngắn gọn script đang dựa vào phần nào của source.

## Cảnh báo bảo mật

- `MESSAGE POST`, `post`, `lại là POST`, các `*.har` có chứa **JWT/cookie phiên** thật
  (ảnh chụp network). Không tái sử dụng token trong đó và không thêm token mới vào repo.
- File `download` ghi chú vị trí khoá ký: `installer/extension-signing-key.pem` — không commit.
