BOTFAKE LITE — folder tiện ích hoàn chỉnh (tự chứa)

Cài đặt:
  1. Tải cả folder này về máy (giữ nguyên cấu trúc bên trong).
  2. chrome://extensions → bật "Developer mode".
  3. "Load unpacked" → chọn ĐÚNG folder chứa manifest.json này.

Bên trong:
  manifest.json   khai báo MV3
  extension/      service worker, content script, popup, icon
  scripts/        pancake-send-lite.user.js (toàn bộ logic gửi trong tab Pancake)

Lưu ý: đây là bản sinh tự động từ mã nguồn ở gốc repo — không sửa trực tiếp
trong folder này. Sửa ở nguồn rồi chạy: npm run build
