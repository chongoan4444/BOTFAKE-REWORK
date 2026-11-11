# AGENTS — BOTFAKE

## Mục đích

Repository chứa extension BOTFAKE LITE (Chrome MV3) + userscript gửi hàng loạt Pancake,
kèm source tham chiếu lấy từ website thật. Mục đích chính là để AI phân tích cấu trúc
website và sửa/tạo JavaScript hoạt động phù hợp với website thực tế.

## Bố cục bắt buộc

```
manifest.json          khai báo MV3
version.json           NGUỒN VERSION DUY NHẤT { base, build } — đừng sửa version ở nơi khác
update.xml             manifest tự cập nhật
botfake.crx            bản đóng gói đang phát hành
extension/             background.js, bridge.js, overlay.js, popup.html, popup.js, icons/
scripts/               pancake-send-lite.user.js  (toàn bộ logic gửi trong tab Pancake)
tools/build.mjs        đồng bộ version + kiểm tra đường dẫn + đóng gói
```

- `manifest.json` trỏ đường dẫn tính từ **gốc repo** (`extension/...`, `scripts/...`).
- `chrome.scripting.executeScript({ files: [...] })` trong `extension/background.js`
  và `extension/popup.js` cũng dùng đường dẫn tính từ gốc repo — di chuyển file là phải sửa cả hai chỗ.
- Sau khi sửa code, chạy `npm run check` (hoặc `npm run build`) — nó phát hiện version lệch,
  file manifest trỏ tới không tồn tại, và `.crx` đang phát hành bị cũ.

## Quy tắc quan trọng

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
- Không commit khoá ký (`*.pem`), token, cookie hay `dist/`.

## Source hiện có

- `html.txt`: HTML được lưu từ website (danh sách đoạn chat).
- `html2.txt`: HTML khi mở đoạn chat.
- `html3.txt`, `html comment list`: HTML danh sách/khung bình luận.
- `taodon`: HTML tab tạo đơn.
- `_app-9331d46f21a84eb1.v6.js`: JavaScript website tải (logic gửi tin, `executeByApi`).
- `dashboard-fa168c408c705d9e.v6.js`: JavaScript dashboard.
- `pancake.vn2.har` + các `*.har`: network khi dùng website (API, Socket, token).
- `MESSAGE POST`, `post`, `lại là POST`: mẫu curl request gửi tin / fill_admin_name.
- `BOTFAKE FULL`, `BOTFAKE.TXT`: bản userscript cũ (v1.90.4) — chỉ để đối chiếu lịch sử.

Các file trên là nguồn tham khảo chính để phân tích website.
