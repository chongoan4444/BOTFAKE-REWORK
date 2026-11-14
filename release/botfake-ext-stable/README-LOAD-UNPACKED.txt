BOTFAKE STABLE — tiện ích hoàn chỉnh, chạy ĐỘC LẬP với bản gốc

Cài đặt:
  1. Tải cả folder này về máy (giữ nguyên cấu trúc bên trong).
  2. chrome://extensions → bật "Developer mode".
  3. "Load unpacked" → chọn ĐÚNG folder chứa manifest.json này.

Bên trong:
  manifest.json   MV3, tên riêng "BOTFAKE STABLE"
  extension/      service worker, content script, popup, icon
  scripts/        pancake-send-stable.user.js (toàn bộ logic gửi)

Khác bản gốc: KHÔNG nhớ/lọc chat gửi lỗi · công tắc phím TAB (mặc định TẮT)
               · log cuối chỉ còn dòng tổng kết.

Lưu ý: folder này sinh tự động từ mã nguồn ở gốc repo — không sửa trực tiếp.
Sửa ở nguồn rồi chạy: npm run build
