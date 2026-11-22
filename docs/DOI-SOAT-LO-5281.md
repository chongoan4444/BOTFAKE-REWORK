# Đối soát lô 5 281 chat (bản 1.93.19, log `botfake-log-20261122-174641.txt`)

> Mục đích: trả lời **"tại sao cả lô bị đẩy hết vào Extension / tại sao không phản hồi"** bằng
> số đo trong chính file log, chỉ rõ **file + dòng code** cho từng kết luận. Tách rõ **ĐO ĐƯỢC**
> và **SUY LUẬN**.

## 0. Kết luận trước, chứng minh sau

**Lô này KHÔNG hỏng.** Sổ kiểm chứng của cùng file ghi **5 241/5 281 chat có ≥ 1 dòng ✅**
(99,2 %), chỉ **40 chat** còn ⚠. Con số `15,5 %` mà người dùng đọc được là **dòng chốt in
quá sớm**, không phải số tin đã gửi.

| Chỉ số | Dòng `📊 TỔNG HỢP` (17:37:34) | Sổ kiểm chứng (đọc hết file) |
|---|---|---|
| Đã tới nơi | 818 (15,5 %) | **5 241 (99,2 %)** |
| Còn ⚠ | 4 463 | **40** |
| Kênh cuối | API 397 · Ext 421 | API 397 · **Ext 4 844** |
| Giờ dòng ✅ cuối | — | **17:45:13** (trễ **458 s** so với dòng chốt) |

Ba lỗi code thật đã tìm ra và vá (v1.93.20 / W200.130), mỗi lỗi có số đo riêng ở §2–§4.

## 1. ĐO ĐƯỢC — bảng số của lô

- `🚀 5281 chat THEO WAVE 500`, 11 wave · phát lệnh **89,4 s** · tổng 96 s.
- `📡 SOCKET: ACK OK/rejected/no-ACK **0/0/4884**` · buckets `<250/250-999/1-2s/2-5s/≥5s
  0/0/0/0/0` · ACK TB/max `0/0 ms`.
- `🔔 CỬA SỔ NGHE ACK: giữ slot 6000ms · nghe 12000ms · hết hạn chờ (còn nghe tiếp) **4884** ·
  im lặng THẬT **0** · ACK về MUỘN đã phân xử **0** · p90/p95 2415/2675ms (1000 mẫu)`.
- `🌐 API NỀN`: 422 fetch · OK 397 · rejected 25 (#551) · 429 = 0.
- `🌊 WAVE`: `peak Socket/page active **151**/151` · `limits cuối [256×3]` · `📷 bind fbId
  **5 306 ca · TB 3 038 ms/ca · max 21 406 ms**` · `🧷 PRE-BIND ẢNH … dùng lại được **0 ca** ·
  hụt **4 867 ca**` · `⏱ GIỮ SLOT … còn lại 3 010 ms/chat` · `peak API waiting 233`.
- `🫥 CHẠY NỀN`: tab ẩn 15 % số lần chờ · bị bóp **76** lần + trễ **1 269** lần · **+1 516,3 s**.

Trong sổ kiểm chứng (24 765 dòng, 5 281 chat):

| Chuỗi | Số dòng |
|---|---|
| `⚠ Socket không rõ kết quả (không có ACK)` | 4 859 |
| `⏳ Socket không có ACK + đã chứng minh hội thoại không có tin — đang bù qua Extension…` | 4 844 |
| `✅ đánh dấu ĐÃ TỚI NƠI qua ext` | **4 844** |
| `✅ đánh dấu ĐÃ TỚI NƠI qua api` | 397 |
| `⚠ … · lỗi khi phân xử ACK Socket: hasExt1545 is not defined` | **775** |
| `🛟 kiểm chứng: hội thoại KHÔNG có tin … ⇒ GỬI CỨU 1 lần` | 4 844 |
| `🚫 FB đã báo KHÔNG NHẬN ĐƯỢC (API #551)` | 25 |

Độ trễ cứu: **4 844 ca ⚠ lật sang ✅**, `⚠→✅` p50 **256,4 s** · p90 **409,6 s** · max 459,5 s.
`✅ qua ext` rải từ 17:36 đến 17:45 (277/188/326/671/923/689/495/638/572/65 dòng mỗi phút).

## 2. Lỗi #1 — `hasExt1545 is not defined` (775 ca chốt ⚠ oan)

**ĐO ĐƯỢC:** 775 dòng sổ, và đây là **lý do duy nhất** trong nhóm `lỗi khi phân xử ACK Socket`
(`grep`: 1 biến thể duy nhất, không có lý do khác).

**GỐC (code):** trong `sendViaSocket()` (bản 1.93.19), `const hasExt1545 = …` được khai báo
**bên trong** nhánh `if (!sockRetryBudgetAllows(...))`, nhưng được dùng lại ở 2 nhánh **ngoài**
khối đó (nhánh `deferredToSocketRetry` và nhánh in `ngân sách dò Ext đang đóng`). Truy cập
`const` ngoài khối ⇒ `ReferenceError`.

**Hệ quả thật:** lỗi văng trong `.then()` của `settleAndFinalize()` ⇒ rơi vào `.catch()` ⇒ ca bị
chốt `⚠ "không rõ kết quả"` **dù FB vừa từ chối dứt khoát (chưa gửi tin nào)**. Đáng lẽ ca đó được
chuyển thẳng sang làn Extension (an toàn, không thể trùng) thì lại bị đẩy vào **danh sách gửi tay**.

**VÁ:** khai báo **một lần** ở phạm vi hàm `sendViaSocket`, mọi nhánh chỉ đọc.
Test khoá: `[v1.93.20] hasExt1545 khai báo Ở CẤP HÀM` + `chỉ khai báo ĐÚNG 1 lần`.

## 3. Lỗi #2 — sổ ACK không đếm được no-ACK (dòng 📡 tự mâu thuẫn)

**ĐO ĐƯỢC:** cùng một dòng `🧭` in `no-ACK 4 884` **và** `có no-ACK trong 50 ca gần nhất: 0`
**và** `ACK p50/p90 1050/2415ms (1000 mẫu)`. Ba số này không thể cùng đúng nếu mọi bộ đếm nhìn
cùng một luồng sự kiện.

**GỐC (code):** `noteSocketPageLaneOutcome()` bắt đầu bằng
`const lane = pid && pageSocketLanes[pid]; if (!lane) return;` — **trước** mọi bộ đếm:
`noteRecentOutcome()` (cửa sổ 50 ca), `noteAckLatency()` (mẫu p50/p90), `sockNoAckRun`,
`ctl.noAckStreak`. Mà `socketPageLaneCtl[pid]` chỉ được tạo **bên trong**
`if (!pageSocketLanes[pid])` của `getPageSocketLane()`. Page nào lần đầu đi qua nhánh không-có-làn
thì **mất sạch số đo** của mọi ca, và các nhánh sau đó gọi `lane.getLimit()` trên `null`
⇒ `TypeError` bị `catch` cuối hàm nuốt im lặng.

**VÁ:** `socketPageLaneCtl[pid]` khởi tạo **độc lập** với làn (trong `getPageSocketLane` và trong
chính hàm ghi nhận); mọi chỗ dùng làn đều kiểm `if (lane …)`. Không đổi đường gửi, không đổi làn.
Test khoá: `noteSocketPageLaneOutcome KHÔNG return sớm` + `socketPageLaneCtl khởi tạo độc lập`.

## 4. Lỗi #3 — dòng chốt in khi 4 461 ca còn đang cứu (nguồn của "15,5 %")

**ĐO ĐƯỢC:** dòng chốt in lúc 17:37:34, trong khi `✅ qua ext` còn chạy tới 17:45:13; dòng chốt
tự khai `⏳ ĐANG CỨU tự động: 2 chat` + `⏳ TẠM ⚠ chưa kết luận: **4 461 chat**` **ngay trong
chính nó**.

**GỐC (code):** `pendingSend = total − settled`, mà `settled` cộng cả `unsure`. Chat vừa bị chốt ⚠
để đưa vào danh sách gửi tay vẫn đang chạy chuỗi bù Extension (`pendingBg`) — nó bị tính là
"đã có kết luận" ⇒ `pendingSend = 0` ⇒ `isDoneAll = true` ⇒ in bảng chốt và đặt `finalLogged`.
Mọi lần lật ⚠→✅ sau đó chỉ in một dòng `🔎 Cập nhật` mỗi 15 s; **bảng chốt đứng im ở 15,5 %**.

Tác hại: bảng cuối là thứ duy nhất người dùng đọc, và nó **dạy gửi tay 4 461 chat đã nhận tin**
— đúng nguồn gửi trùng mà cả file này đang chống.

**VÁ:** thêm `bgUnsettled` (số chat còn trong `pendingBg`) vào số liệu tổng hợp; **hoãn đúng dòng
chốt** khi `bgUnsettled > 0 || countRescuing() > 0`, có in lý do hoãn 1 lần và **trần
`SUMMARY_TAIL_MAX_MS = 300 000`** để không bao giờ treo báo cáo. `pendingSend` **giữ nguyên**
⇒ nút Chạy vẫn nhả đúng như cũ (không kéo dài lượt thêm 8 phút).

## 5. Vì sao 0 ACK trên Socket — ĐO ĐƯỢC gì, CHƯA chứng minh được gì

- `🛟` = **4 844** và `✅ qua ext` = **4 844** ⇒ mọi ca Socket no-ACK đều được chứng minh
  **vắng mặt** rồi bù Extension thành công. Nghĩa là **tin không mất**, chỉ chậm.
- `ca 'Socket không kết nối' trong sổ = 0` ⇒ nhánh `{kind:'dead'}` (socket chết **trước**
  publish) **không xảy ra** ⇒ frame **đã** được `helper.publish` đẩy đi. Vậy "0 ACK" là
  **không nhận được `/ls_resp`**, không phải "không bắn".
- **SUY LUẬN (chưa chứng minh):** nhiều khả năng page thật sự ngừng trả `/ls_resp` trong ~10 phút
  (lô 11/11 19:03 đã có tiền lệ: "từ tin ~1082 trở đi MỌI tin qua Socket đều không có ACK").
  Script hiện **không có phép đo** phân biệt ba khả năng: socket chết giữa lô / app ngừng xử lý
  response / FB ngừng trả lời. ⇒ **Việc cần làm trước khi sửa tiếp là THÊM PHÉP ĐO**, không phải
  đổi ngưỡng.

## 6. Nghiệm thu lần chạy sau (đọc đúng 5 số này)

1. `📡 SOCKET` — nếu lại `no-ACK` lớn thì **`có no-ACK trong 50 ca gần nhất` phải > 0** (lỗi #2
   đã hết). Nếu vẫn = 0 trong khi no-ACK > 0 ⇒ còn một cửa ghi nhận khác bị chặn.
2. Sổ kiểm chứng: **không còn dòng `hasExt1545 is not defined`** (kỳ vọng 0).
3. `⏳ Chưa in dòng chốt: N chat…` rồi **`📊 TỔNG HỢP CHỐT`** — hai mốc giờ cách nhau bao lâu
   chính là **đuôi bù thật**. Nếu > 300 s thì phải nâng `SUMMARY_TAIL_MAX_MS` **bằng số đo**.
4. Đối chiếu `📊 … ✅ x/5281` với **TỔNG THEO CHAT** (đếm `#đã tới nơi > 0`): hai số này phải
   xấp xỉ nhau. Lệch > 1 % là bảng chốt vẫn in sớm.
5. `🧷 PRE-BIND ẢNH … dùng lại được 0 ca · hụt 4 867` — nếu vẫn 0 thì pre-bind **chưa có tác
   dụng**, và `📷 bind fbId TB 3 038 ms/ca` vẫn là chi phí nằm trong slot.
