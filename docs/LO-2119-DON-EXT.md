# Lô 21:19 (6 676 chat, bản 1.93.18) — vì sao dồn vào Extension và cách sửa

Nguồn: `botfake-log-20261122-211904.txt` (1.93.18-W200.128, xuất 21:19:04, 9 023 dòng sổ).
Đối chiếu: extension thật `0.5.62_0` (chỉ đọc) và các HAR trong repo. Bản vá: **1.93.18-W200.129**.

## 1. Số đo của lượt đó

| Chỉ số | Số |
|---|---|
| Chốt ✅ / ⚠ / 🔎 / ❌ / ⏳ | 4 954 · 3 948 · 114 · 4 · 3 (chat: 4 940 ✅ · 1 732 cần gửi tay) |
| markDelivered theo kênh | socket **4 770** · ext **128** · api **42** (4 940 dòng) |
| `⏳ Socket CHƯA sync (0/1 page) sau 17ms` | vòng chờ kết thúc ở **17 ms** |
| `chọn kênh: Ext-trước(socket chưa sync)` | **625** chat |
| `peak Ext queue/active` | **369/128** |
| `Ext p90 phản hồi` | **6,2 s** (HAR làn Ext: p50 21 ms, p90 66 ms) |
| `🚫 … hasExt1545 is not defined` | **1 732** chat (⚠, **0 dòng ✅, 0 dòng 🔎**) |
| dòng `🛟` (chuyển Ext cho ca FB từ chối) | **0** |

## 2. Gốc thứ nhất — `hasExt1545` (chiếm 1 732/1 860 chat ⚠)

`const hasExt1545` khai **bên trong** khối `if (!sockRetryBudgetAllows(...)) {` (chỉ chạy khi
ngân sách thử lại Socket **đã đóng**), nhưng được dùng ở hai nhánh **ngoài** khối đó — trạng
thái bình thường của mọi lô (ngân sách còn mở). Khối ngoài đứng ở depth 1 nên `const` trong
khối con không nhìn thấy ⇒ **ReferenceError** → `.catch` của `settleAndFinalize` bắt và chốt ⚠.

Hệ quả: cả đường "chuyển Ext cho ca FB từ chối" **không chạy một lần nào** (0 dòng 🛟), và 1 732
chat đó không có bất kỳ bằng chứng nào là đã gửi.

**Vá (p1):** khai `hasExt1545` **một lần ở depth 1**, trước mọi nhánh dùng. Không thêm lệnh gửi.

## 3. Gốc thứ hai — vì sao 625 chat đi Ext trước

`waitForSocketSynced()` được viết để **chờ**, nhưng thoát ngay ở vòng lặp đầu tiên khi
`SOCKETS[pageId]` **chưa tồn tại** (`isSocketAlive(undefined) === false`). Vì vậy:

1. `warmUpSockets()` chạy khi `window.__MqttHelper__` chưa có ⇒ `return` sớm, không tạo promise;
2. `waitSocketsReadyForSend()` chỉ chờ promise đã có ⇒ không có gì để chờ, kết thúc ở **17 ms**;
3. wave đầu lên kế hoạch `['ext','socket']` ⇒ Extension trả lời trước (p50 21 ms/HTTP) ⇒ **thắng**;
4. 625 chat dồn vào làn Ext 128 ghế ⇒ hàng đợi 369, p90 6,2 s, 14 ca quá hạn chờ của tool.

**Vá (p2):** chỉ coi là **chết** khi `SOCKETS[pageId]` đã có đối tượng mà `isRunning()` false.
Chưa có đối tượng **mà đang có tiến trình tạo** (`socketWarmPromises`/`socketReconnectPromises`)
⇒ chờ tiếp (thức bằng `sleepUntil`, tới hạn 2 500 ms đã dùng ở mọi nơi khác). Không có gì đang
tạo ⇒ trả về ngay như cũ (một page không có socket không bị bắt chờ 2,5 s/chat).
`waitSocketsReadyForSend()` thiếu promise thì **tự gọi `h.initSocket(pid)`** (idempotent).

## 4. Đã đo, nhưng CỐ Ý KHÔNG vá — làn Ext khai 64 mà mở ở 48

Dòng 🛰 của lô in `đỉnh in-flight 64/48`: `extSendLane.getLimit()` = **48** trong khi hằng số
khai `BUS_PARALLEL_EXT = 64`. Lý do: hằng `EXT_SEND_MIN = 48` (sàn) **đè** giá trị khởi điểm.

Vì sao chưa sửa: HAR làn Ext (90 lệnh / 6,74 s ⇒ ~13,4 lệnh/s, đỉnh in-flight 42/48) cho thấy
làn **không phải** nút cổ chai — chính Extension tự tuần tự hoá. Mở 48 → 64 chỉ có ích **sau**
khi p2 làm cả lô đi làn Socket; đổi cùng lúc sẽ không quy được kết quả cho nguyên nhân nào.
Nếu lô sau vẫn còn `Ext queue` cao thì đổi **một dòng**: `makeAdaptiveLane(BUS_PARALLEL_EXT, …)`
→ `makeAdaptiveLane(EXT_SEND_MAX_OPEN…)` như mô tả trong chú thích tại chỗ.

## 5. Không sửa: "Extension báo success nhưng KHÔNG có bằng chứng" (114 ca)

Trong extension thật `0.5.62_0`: `isResponseSuccess()` trả **truthy khi `payload.error_payload`
tồn tại**, còn `parseSuccessResponse()` khi đó trả `{}` (không `messageId`) ⇒ `sendInboxSuccess`
vẫn post `REPLY_INBOX_PHOTO_SUCCESS`. Nhánh fallback trong `background.js` lại post
`messageId: taskId` (không phải mid thật).

Nhưng **cả 114/114 ca của lô này đã về ✅** bằng đường đọc lại lịch sử (62 ca) + phản hồi muộn
(14 ca) + kiểm chứng nền tiếp theo (38 ca), và **0 ca bị gửi tay oan**. Vì vậy: chỉ **ghi nhận**,
**không** hạ tiêu chí ✅ — hạ tiêu chí là mở đường mất tin.

## 6. Nghiệm thu lô sau (đọc đúng 4 con số)

1. `🚫 … hasExt1545 is not defined` = **0**
2. dòng `🛟` > 0 khi có ACK rejected, và `🛟` → ✅ phần lớn
3. `chọn kênh: Ext-trước(socket chưa sync)` phải **giảm mạnh**; `Socket đã sync 1/1 page sau …ms`
   xuất hiện trước wave 1
4. `peak Ext queue/active` và `Ext p90` phải giảm theo — nếu không giảm thì mới được đổi làn Ext (mục 4)
