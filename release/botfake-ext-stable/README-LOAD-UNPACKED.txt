BOTFAKE — bản ổn định (tiện ích hoàn chỉnh)

Cài đặt:
  1. Tải cả folder này về máy (giữ nguyên cấu trúc bên trong).
  2. chrome://extensions → bật "Developer mode".
  3. "Load unpacked" → chọn ĐÚNG folder chứa manifest.json này.

Bên trong:
  manifest.json   khai báo MV3 (giống hệt bản gốc, chỉ khác đường dẫn script)
  extension/      service worker, content script, popup, icon
  scripts/        pancake-send-stable.user.js (toàn bộ logic gửi)

KHÁC BẢN GỐC DUY NHẤT Ở PHẦN LOG:
  · cuối lượt chỉ in 1 dòng: ✅ n/tổng (%) · ❌ · ⚠ · ⏱ · tin/giây
  · không in các dòng chẩn đoán dài (WAVE/SOCKET/API/globalId/CHẠY NỀN)
  · không in dòng tiến trình 🟢 giữa lượt (bảng TỔNG HỢP vẫn cập nhật)
Cơ chế gửi, làn, ngưỡng, giao diện panel, công tắc phím TAB: GIỐNG HỆT bản gốc.

Lưu ý: folder này sinh tự động từ mã nguồn ở gốc repo — không sửa trực tiếp.
Sửa ở nguồn rồi chạy: npm run build
