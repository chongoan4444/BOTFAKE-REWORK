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

tools/
  build.mjs                       # đồng bộ version + kiểm tra + đóng gói zip/crx

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
