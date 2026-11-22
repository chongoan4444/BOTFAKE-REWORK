# Đối soát lô 5 281 chat (bản 1.93.19, log `botfake-log-20261122-174641.txt`)

> Mục đích: trả lời **"tại sao cả lô bị đẩy hết vào Extension / tại sao không phản hồi"** bằng
> số đo trong chính file log, chỉ rõ **file + dòng code** cho từng kết luận. Tách rõ **ĐO ĐƯỢC**
> và **SUY LUẬN**.

## 0. Kết luận trước, chứng minh sau

> **⚠ SỬA LẠI 23/11 — bản §0 đầu tiên đã SAI, xin lỗi.**
> Bản đầu tôi đọc sổ kiểm chứng và kết luận "99,2 % đã tới nơi". **Người dùng kiểm bằng mắt:
> hơn 4 000 chat KHÔNG nhận được tin** — đúng. Các dòng `✅ đánh dấu ĐÃ TỚI NƠI qua ext` đó là
> **✅ GIẢ** (§7). Bài học: sổ kiểm chứng tự ghi ✅ thì không thể dùng sổ đó để chứng minh ✅.

**Lô này HỎNG thật.** Trong 5 281 chat:

| Chỉ số | Số đo | Nguồn |
|---|---|---|
| Socket bắn nhưng **0 phản hồi** | 4 884 lần · ACK `0/0/4884` | `📡 SOCKET` |
| Được "GỬI CỨU qua Extension" | 4 844 ca | sổ: `🛟 … GỬI CỨU 1 lần` |
| Dòng `✅ … đánh dấu ĐÃ TỚI NƠI qua ext` | 4 844 — **KHÔNG có lệnh gửi nào tương ứng** | §7 |
| Lệnh Ext thật sự hoàn tất | **0** (`🧯 Ext quá hạn` 0 · `Ext báo success` 0 · `gửi THÀNH CÔNG qua Extension` 0) | log gọn |
| API thật sự OK | 397 | `🌐 API NỀN` |
| Người dùng phải gửi lại bằng tay | **hơn 4 000** | người dùng xác nhận |

Ba lỗi code **báo cáo sai** (vá ở v1.93.20 / W200.130): §2 · §3 · §4. **Một lỗi gây hậu quả
thật** — cả lô bị đẩy sang Ext và chốt ✅ khống (vá ở v1.93.21 / W200.131): §7 · §8.

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

---

# PHẦN BỔ SUNG 23/11 — vì sao cả lô bị đẩy sang Extension và vì sao sổ ghi ✅ khống

## 7. Lỗi gây hậu quả thật: `dupBlockedResult()` trả `ok:true` cho ca CHƯA bắn

**ĐO ĐƯỢC** (log 22/11, lô 5 281 chat):

| Dòng | Số |
|---|---|
| `✅ … bù THÀNH CÔNG qua Extension` (đếm `×N`, 100 dòng gộp) | **4 843** |
| `✅ đánh dấu ĐÃ TỚI NƠI qua ext` | **4 844** |
| `🧯 Ext quá hạn` / `Ext báo success…` / `gửi THÀNH CÔNG qua Extension` | **0 / 0 / 0** |
| `🌐 API NỀN`: fetch / OK | 422 / **397** |
| `📡 SOCKET` ACK | **0** |

Nếu 4 843 ca kia thật sự được Extension gửi thành công thì làn Ext **phải** in ít nhất một
trong ba dòng chẩn đoán của nó. Cả ba đều **0** ⇒ không có lệnh nào hoàn tất ⇒ các dòng ✅ đó
**không có lệnh gửi nào tương ứng**. Khớp với việc người dùng kiểm bằng mắt: hơn 4 000 chat
vẫn chưa nhận tin, phải gửi lại bằng tay.

**GỐC (code):** `dupBlockedResult(convId)` trả
`{ ok: true, sendBy: deliveredIds[convId] || 'dup-block', sent: true, fired: true, dupBlocked: true }`
— tức **"đã bị chặn vì trùng"** lại được khai báo là **"đã gửi"**. `sendOneAndLog` có nhánh
riêng cho `dupBlocked` (nên dòng tổng hợp của vòng chính không sai), nhưng **nhánh bù** thì
không: nó chỉ đọc `if (r && r.ok) markDelivered(conv.id, ch)` ⇒ ca **không bắn gì** được ghi
✅ rồi `dropManualResend()` ⇒ chat biến mất khỏi danh sách gửi tay. Đây là loại lỗi tệ nhất:
báo đã gửi trong khi chưa gửi.

Ngoài ra `markDelivered()` **không nhả `outboundLock`**, nên khoá còn lại của lần bắn trước
biến chính ca đã-giao (hoặc đang-bay) thành `dupBlocked` ở mọi chuỗi bù về sau — nguồn thứ hai
của cùng hiện tượng.

**VÁ (v1.93.21):**
1. `dupBlockedResult()` ⇒ `ok:false`, `sent:'maybe'`, `uncertain:true`, `dupBlocked:true`.
   Không bắn thêm lệnh nào — vẫn chặn trùng y như cũ.
2. Nhánh bù: `if (r && r.ok && !r.dupBlocked)` mới được `markDelivered`.
3. `markDelivered()` nhả `outboundLock` ngay tại nguồn sự thật (đã giao). Nhả ở đây **không**
   mở đường trùng vì `acquireOutbound()` đã tự chặn bằng `deliveredIds`.

## 8. Vì sao cả lô bị đẩy sang Extension — chuỗi nhân quả có số đo

Không phải "ưu tiên Ext" (thứ tự làn vẫn đúng). Chuỗi thật:

1. **Socket bắn 4 884 lần, page không trả một `/ls_resp` nào.**
   `peak Socket/page active 151/151` trong khi trần làn 256 ⇒ **không phải làn chặn**.
   Mỗi ca chờ hết hạn giữ slot ⇒ chốt ⚠.
2. **Mỗi ca ⚠ đăng ký kiểm chứng** (`scheduleSocketVerify`) → cổng `proveAbsentBeforeBu()`.
   Log ghi `🧭 … đọc thẳng FB: tin 610 · gid 0 · cứu 0` và `HTTP 0` globalId ⇒ **đường xác
   nhận độc lập không chạy được**. Lô này gửi ảnh cho **5 306/5 281** chat, nên
   `photoMovedVerdict()` không bao giờ trả `'yes'`; `absenceVerdict()` rơi xuống `'absent'`
   chỉ vì `updated_at` cũ hơn mốc gửi.
3. **`socksProof === 'absent' && hasExtNow` ⇒ `🛟 GỬI CỨU 1 lần qua Extension` cho 4 844 ca.**
   Đây chính là "cả lô bị đẩy hết vào extension".
4. Nhánh bù đó chốt ✅ qua `dupBlockedResult()` ⇒ sổ ghi ✅ khống (§7).

**VÁ (v1.93.21):** thêm `socketZeroAckRescueAllowed(pageId)` — khi page đã bắn
≥ `SOCK_ZERO_ACK_MIN = 30` lần mà **0 ACK thật**, cổng chỉ cho cứu tối đa
`SOCK_ZERO_ACK_RESCUE_MAX = 40` ca (giữ mẫu, không bỏ sót ca lẻ); phần còn lại **GIỮ ⚠ + vào
danh sách gửi tay**, in 1 dòng `🛟 Socket 0 ACK suốt lượt … KHÔNG tự bắn cứu qua Extension`.
Đây là **thu hẹp** đường bắn thêm, không mở đường nào ⇒ không thể sinh tin trùng.

Hai hằng số trên là **ngưỡng đo từ chính log này** (4 844 ca cứu trên 4 844 ca 0 ACK) và
**phải đo lại** ở lô sau:
- nếu phần lớn ca cứu vẫn tới nơi thật ⇒ nâng `SOCK_ZERO_ACK_RESCUE_MAX`;
- nếu cứu 0 % ⇒ hạ về 0 (tắt hẳn đường cứu khi 0 ACK).

## 9. Nghiệm thu lần chạy sau — 4 con số quyết định

1. `🛟 Socket 0 ACK suốt lượt … KHÔNG tự bắn cứu` **> 0** ⇒ cổng mới có tác dụng.
2. `✅ … bù THÀNH CÔNG qua Extension` **phải ≤ số lệnh Ext thật sự hoàn tất**. Nếu lại lớn hơn,
   đọc ngay `🧯 Ext quá hạn` / `Ext báo success` / `gửi THÀNH CÔNG qua Extension`.
3. Dòng `🛡 Chặn trùng` + `dupBlocked` — ca `dupBlocked` **không được** xuất hiện trong sổ với ✅.
4. Đối chiếu **TỔNG THEO CHAT** (`#đã tới nơi > 0`) với số người dùng kiểm bằng mắt trên Pancake.
   Hai số này là nguồn duy nhất đáng tin cho "đã tới nơi"; dòng ✅ của sổ chỉ đáng tin sau khi
   mục 1–3 sạch.

---

# PHẦN ĐÁNH GIÁ 23/11 — "cách này có thật sự hữu dụng?" (tự phản biện)

## 10. Những gì tôi đã kết luận SAI, và vì sao

| Lần | Kết luận | Sai ở đâu | Bằng chứng lật lại |
|---|---|---|---|
| 1 | "99,2 % đã tới nơi, chỉ là báo cáo in sớm" | Dùng chính **sổ kiểm chứng** để chứng minh sổ đúng — vòng tròn lập luận | Người dùng kiểm tay: 4 000+ chat chưa nhận tin |
| 2 | "4 843 dòng ✅ là do `dupBlockedResult()` trả `ok:true`" | Suy từ đọc code, **không đối chiếu log** | Log: `🛡 Chặn trùng` = **0** ⇒ không ca `dupBlocked` nào |
| 3 | "cổng `absent` cho qua nên cứu 4 844 ca qua Ext" | Nhầm **số ca đi qua nhánh ⚠** với **số ca được bắn cứu** | Dòng chốt: `🛟 chứng minh vắng mặt ⇒ gửi cứu 1 lần` = **423**, không phải 4 844 |

**Bài học (ghi lại để không tái phạm):** mỗi kết luận phải đối chiếu **một con số in ra trong log
của chính lượt đó**, không phải suy từ đường code. Tôi đã 3 lần suy từ code trước rồi mới tìm
số — đúng cái "check tù mù" mà người dùng đã cấm.

## 11. Đánh giá trung thực các bản vá

### 11.1 CÓ hại — cổng chặn cứu Ext (ĐÃ GỠ)

Tôi thêm `SOCK_ZERO_ACK_MIN/RESCUE_MAX`: page 0 ACK thì chỉ cho cứu 40 ca. **Đây là chặn sai chỗ:**
- `🛟 gửi cứu` chỉ **423 ca** trên 5 281 chat (8 %) ⇒ không phải "cứu hàng loạt".
- 423 ca đó là những ca **đã được chứng minh vắng mặt** (cổng đọc hội thoại 2 lượt) — đúng thứ
  đang cứu được. Chặn chúng = bỏ đúng đường cứu duy nhất còn lại.
- Trong khi đó **4 844 ca còn lại** đi đường khác: cổng phán `absent` ⇒ **KHÔNG cứu**
  (`🛟` 423 < 4 844) ⇒ chúng nằm ở ⚠ rồi được lật ✅ bởi một nhánh **chưa xác định được**.
- Hệ quả nếu giữ: thêm 383 ca ⚠ vào danh sách gửi tay mà không cứu được ca nào.

⇒ **Đã gỡ hoàn toàn.** Hai bộ đếm `pageSockSent`/`pageAckGot` giữ lại nhưng chỉ để ĐO
(`pageSocketAckState()`), không chặn gì.

### 11.2 CÓ hại một phần — `dupBlockedResult()`

Sửa `ok:true` → `ok:false` là **đúng về mặt logic** (ca không bắn thì không được coi là đã gửi),
nhưng:
- **Không phải nguyên nhân của lô này**: log ghi `🛡 Chặn trùng = 0` ⇒ chưa từng xảy ra.
- **Có thể làm chậm**: `sendViaSocket` đường bắn-nhả trả `ok:true` cho ca "đã bắn rồi, đang chờ
  ACK"; nếu khoá còn mà ca đó chưa ✅ thì nay nhánh bù sẽ **chờ kiểm chứng** thay vì đi tiếp.
  Đây là **đổi tốc độ**, người dùng ưu tiên tốc độ ⇒ cần đo ở lô sau, và nếu đuôi xác nhận dài
  ra thì phải hoàn nguyên riêng thay đổi này.
- `markDelivered()` nhả `outboundLock` là **an toàn** (giữ, vì `acquireOutbound` đã chặn bằng
  `deliveredIds`).

### 11.3 HỮU DỤNG THẬT — nhãn bằng chứng trên mỗi dòng ✅

Đây là thay đổi duy nhất trả lời đúng câu hỏi "tại sao lại thế này mà không kiểm được":
mỗi dòng sổ ✅ nay có `[bằng chứng: messageId | history | ack | http200 | extSuccess | unknown]`
và dòng chốt in tổng theo nhãn. Ca nào `unknown` là ca **không có bằng chứng nào** — đúng loại
đã sinh 4 844 dòng ✅ khống mà không ai phát hiện.

Không đổi phán quyết, không đổi số lệnh gửi, **không thể sinh tin trùng** (chỉ ghi thêm chữ).

### 11.4 Vẫn ĐÚNG, giữ nguyên

- `hasExt1545 is not defined` (775 ca/1 000 mẫu) — lỗi ReferenceError thật, sửa là đúng.
- `noteSocketPageLaneOutcome` return sớm ⇒ sổ ACK không đếm (log tự mâu thuẫn
  `no-ACK 4884` vs `50 ca gần nhất: 0`) — sửa là đúng.
- Hoãn dòng chốt khi còn chuỗi bù (`SUMMARY_TAIL_MAX_MS = 300 s`) — đúng, vì dòng chốt in lúc
  17:37:34 rồi ✅ còn lật tới 17:45:13.

## 12. Vì sao bị đẩy hết vào Ext — trả lời bằng số ĐO ĐƯỢC, không suy đoán

**(a) Đường chính: `fastOnly` → `deferredToExt`.**
`prepareDirectCtx()` ở làn 1 đặt `ctx.deferredToExt = true` khi thiếu `thread_id` **và**
`ctx.fastOnly`. Log: `🧭 … sync thread_id 8` (chỉ 8 ca) ⇒ gần như mọi ca vào làn Ext.

**(b) Đường phụ đã ĐO ĐƯỢC: Extension tự trả lời SAU hạn chờ của tool.**

| Mốc | Số |
|---|---|
| `gửi THÀNH CÔNG qua Extension` (làn Ext đồng bộ) | **0** |
| `bù THÀNH CÔNG qua Extension` (nhánh bù, khác dòng trên) | 4 843 |
| `✅ đánh dấu ĐÃ TỚI NƠI qua ext` | 4 844 |
| Lật ✅ theo thời gian | 17:37:34 → … → **17:45:13** (7,5 phút) |
| Đường `markDelivered(…, 'ext')` **không in dòng nào** | nhánh `sendExtWithLateWatch`: `extLateStats.ok++` rồi `markDelivered` — `extLateStats` chỉ in **khi làn Ext có mẫu**, và log này không có |

Đây là **nhánh im lặng**: ext trả lời sau `extTimeoutMs()` (≈2,5 s) nhưng vẫn `success` ⇒ script
coi là đã gửi rồi `markDelivered` **mà không in dòng nào**. Nó giải thích được cả ba điều:
số ✅ tăng dần 8 phút sau khi phát lệnh; 0 dòng chẩn đoán Ext; và người dùng thấy 4 000+ chat
không có tin (nếu ext báo success mà FB không tạo tin).

**(c) Kết luận trung thực:** với log này **không thể phân biệt** "tin đã đi" và "ext báo success
khống" — vì cả hai đều không để lại bằng chứng trong log. Đó chính là thứ §11.3 vá: lô sau mỗi
dòng ✅ sẽ mang nhãn, và `extSuccess` mà CÓ nhãn đó thì biết ngay nó là loại không có
`messageId`.

**Việc cần làm tiếp (chưa làm, cần người dùng đồng ý vì đụng đường gửi):**
1. `sendExtWithLateWatch` phải ghi sổ + in 1 dòng khi `extLateStats.ok++` ⇒ hết nhánh im lặng.
2. Ext báo `success` **mà không `message_id`** thì **không** được `markDelivered` — chỉ ⚠ +
   kiểm chứng lịch sử (đã có sẵn đường này ở nhánh `res.success` chính, chỉ nhánh late-watch
   là chưa áp).
