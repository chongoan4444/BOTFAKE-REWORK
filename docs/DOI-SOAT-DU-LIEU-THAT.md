# Đối soát 6 file dữ liệu trên `main` — số liệu THẬT (2026-11-22)

> Nguồn: `network-log.har` · `network-log2.har` · `logtest4.har` · `2gg.har`
> (tất cả trên nhánh **`main`**, commit `9edbe06`, KHÔNG có trên nhánh làm việc).
> Mọi con số dưới đây đọc trực tiếp từ response HTTP, không suy đoán.

## 0. Tổng quan 4 file

| file | entries | request gửi thật | nội dung |
|---|---|---|---|
| `network-log.har` | 94 | **90** | toàn ca LỖI: 86×`1545041` + 4×`1545012` |
| `network-log2.har` | 73 | 19 | 19×`1545041` + 52 `graphqlbatch` |
| `logtest4.har` | 54 | **21** | **toàn ca THÀNH CÔNG** + 31 `graphqlbatch` |
| `2gg.har` | 647 | 0 | **326 lượt upload ảnh** qua `contents/facebook` |
| `Trace-*.json.gz` | — | — | trace Chrome (chưa mở) |

Cộng lại: **130 request `business.facebook.com/messaging/send/`** — 21 thành công, 109 lỗi.

## 1. Hình dạng THẬT của response gửi tin

### THÀNH CÔNG (21/21 — `logtest4.har`)

```
for (;;);{"__ar":1,"rid":"AtCTIFnd3C88KFnZNiGCfNS",
 "payload":{"actions":[{
   "thread_id":"", "thread_fbid":"", "other_user_fbid":"100020637382323",
   "action_type":"ma-type:send-message", "client_thread_id":null,
   "message_id":"mid.$cAAHRUeMK-26oL4jqPmh_kOIrVZpp",
   "client_message_id":"7529896403050797673",
   "status":1, "timestamp":1795267207742,
   "attachments":[], "graphql_payload":null,
   "for_page":true, "is_one_way_sent":false}],
  "payload_source":"server_send_message"},
 "lid":"7710613942028198107"}
```

`actions[0]` có **13 trường**, luôn đủ ở 21/21 ca. `message_id` luôn có tiền tố `mid.$`.

### LỖI (109/109 — `network-log*.har`)

```
for (;;);{"__ar":1,"error":1545041,
 "errorSummary":"Không gửi được tin nhắn",
 "errorDescription":"Người này hiện không có mặt.",
 "isNotCritical":1,"rid":"…","payload":null,"lid":"…"}
```

**Lỗi nằm ở cấp CAO NHẤT (`error`), `payload` = `null`.**

### ① KẾT LUẬN QUAN TRỌNG NHẤT: `error_payload` KHÔNG TỒN TẠI

Đếm trên **cả 130 response gửi thật**:

| | số ca |
|---|---|
| có `payload.actions` (thành công) | 21 |
| có `error` ở cấp cao nhất | 109 |
| **có chuỗi `"error_payload"`** | **0** |

`isResponseSuccess` của extension:
```js
case"facebook": return e && e.payload && (e.payload.actions && e.payload.actions[0].message_id
                                          || e.payload.error_payload)
```
`payload` = `null` khi lỗi ⇒ `e.payload` falsy ⇒ hàm trả **falsy** ⇒ đi `getErrorHandler`.
Nghĩa là **nhánh `error_payload` trong `parseSuccessResponse` không bao giờ chạy trên dữ liệu này**.

⇒ Kết luận ghi ở §28 (`error_payload` ⇒ `success` không `messageId`) là **đúng về mã nhưng
không xảy ra trong thực tế**. Tuỳ `fbErrorCode`, Fb có thể trả `error_payload:true` trong
`payload` với một số mã khác — nhưng **130 ca ở đây đều không**.

**Hệ quả cho script:** ca `success:true` mà script nhận được **chính là ca thành công thật**
(có `messageId`). Ca thất bại luôn đến qua `REPLY_INBOX_PHOTO_FAILURE`.

## 2. `messageId` ↔ `offline_threading_id` — LIÊN KẾT 1-1 (21/21)

| | |
|---|---|
| request gửi `offline_threading_id` | `7529896403050797673` |
| request gửi `message_id` | `7529896403050797673` (**cùng giá trị**) |
| response trả `client_message_id` | `7529896403050797673` (**cùng giá trị**) |
| **khớp** | **21/21** |

⇒ Script **tự sinh** id tin (offline_threading_id) và **biết trước** nó sẽ là `client_message_id`.
Đây là khoá đối chiếu mạnh hơn `messageId`: ta không cần extension trả gì, chỉ cần đọc lịch sử
và tìm tin có `client_message_id` = id mình đã sinh.

### ĐÃ KIỂM NGAY: script **KHÔNG** sinh `offline_threading_id`

```
grep -n "offline_threading_id" scripts/pancake-send-lite.user.js   →  0 kết quả
```

⇒ Script **không có** khoá này. Chỉ **extension** sinh (bên trong SW) rồi gửi; script không biết
giá trị ⇒ **không thể** dùng `client_message_id` để đối chiếu lịch sử. Đây là khoá mạnh nhất
mà script đang **bỏ phí** — nhưng muốn dùng thì phải: (a) script tự sinh và truyền qua
`REPLY_INBOX_PHOTO` (`buildSendParams` **sẽ ghi đè** bằng `ps()` của extension ⇒ **không dùng
được**), hoặc (b) extension trả `client_message_id` về (hiện `sendInboxSuccess` **không** trả).

⇒ **Không có đường nào dùng được** với extension hiện tại. Kết luận: bỏ hướng này.

## 3. Request body THẬT (21 ca thành công, 35 tham số)

Bắt buộc phải có (xuất hiện 21/21):

```
body=<text>                    offline_threading_id=<ms>
source=source:page_unified_inbox   timestamp=<ms>   request_user_id=<pageId>
specific_to_list[0]=fbid:<globalUserId>
specific_to_list[1]=fbid:<pageId>
other_user_fbid=<globalUserId>     message_id=<offline_threading_id>
client=mercury                 action_type=ma-type:user-generated-message
ephemeral_ttl_mode=0           has_attachment=undefined
```
Cùng các tham số phiên: `__user __a __req __csr __beoa __pc dpr __ccg __rev __hsi __hs
__comet_req __spin_r __spin_b __spin_t __s fb_dtsg jazoest lsd __usid`

**`has_attachment=undefined`** — extension gán `f.has_attachment = r&&r.length>0`; khi `r`
không phải mảng (tin chữ) thì ra chuỗi `"undefined"`. Facebook vẫn nhận. Đây là **hành vi
thật của extension**, không phải lỗi.

`action_type=ma-type:user-generated-message` khi gửi, response trả `ma-type:send-message`.

## 4. Thời gian — số đo thật

| loại | p50 | p90 | max |
|---|---|---|---|
| gửi lỗi `1545041` (90 ca) | **990 ms** | 1 447 ms | 2 134 ms |
| gửi lỗi `1545012` (4 ca) | **297–358 ms** | — | 358 ms |
| gửi THÀNH CÔNG (21 ca) | **920 ms** | 1 457 ms | 1 762 ms |
| upload ảnh (326 ca) | 367 ms | 621 ms | 849 ms |

`1545012` trả về **nhanh gấp 3** (≈0,3 s vs ≈1,0 s) — khớp nhận định cũ "lỗi nhanh, chưa tạo tin".

⇒ **Facebook trả lời trong ~1 s.** Mọi khoảng chờ 10–35 s trong log là do **script** (cổng chứng
minh vắng mặt 14 s, đuôi xác nhận) hoặc do extension tự retry bên trong (`restartInbox`).

## 5. Đường retry BÊN TRONG extension (suy từ request đếm được)

`network-log.har` có **90 request** cho lỗi `1545041`; `1545041` **không** nằm trong trần retry
`r=[1357004,1545012,1545006,3252001,1390008]` ⇒ `cannotRetry` ⇒ **không** retry bên trong.
Phù hợp: mỗi ca chỉ 1 request.

`1545012` **có** trong trần, nhưng chỉ 4 ca xuất hiện và **không thấy request thứ hai** trong
cùng file ⇒ với `retry=0` nó rơi vào `restartInbox` **trong bộ nhớ** rồi gửi lại; lần gửi lại
nếu thành công sẽ là response `actions` — mà file này **không có ca `actions` nào** ⇒ có thể
các lần gửi lại nằm ngoài phạm vi ghi của HAR. **Không kết luận** — cần thêm dữ liệu.

## 6. Upload ảnh — `contents/facebook` (326 ca)

```
POST https://pancake.vn/api/v1/pages/881264518397934/contents/facebook
     ?access_token=cookie_session&is_reusable=false&async=false
body: {"content_ids":"[\"1adec15a-…\"]","conv_id":"881264518397934_…"}
resp: {"success":true,"fb_ids":["1792719841809264"]}      ← 326/326
```

| | |
|---|---|
| cờ query thực tế | **`is_reusable=false`** (326/326) — KHÔNG có `try_resize`, KHÔNG `force_cache` |
| `success` | 200 với **326/326** |
| trả `fb_ids` | **326/326** |
| thời gian | p50 367 ms · p90 621 ms · max 849 ms |

So với `uploadFacebookPhoto` trong source extension:
```js
Ne(a, `/v1/pages/${e}/contents/facebook?is_reusable=false&try_resize=${r}&force_cache=true`)
```
⇒ **khác nhau**: HAR là đường của **trang Pancake** (`access_token=cookie_session`, có `conv_id`,
`async=false`), không phải đường của extension. Hai đường khác nhau, **không so trực tiếp được**.

## 7. `graphqlbatch` — 83 request, 100 % thành công

| | |
|---|---|
| batch_name | **`MessengerGraphQLThreadlistFetcher`** (83/83) |
| doc_id | **`38892042767077350`** (83/83 — cùng một doc) |
| có `"errors"` trong response | **0/83** |
| tham số | `limit=20`, `tags=["INBOX"]`, `isWorkUser=false`, `includeDeliveryReceipts=true`, `includeSeqID=false`, `is_work_teamwork_not_putting_muted_in_unreads=false`, `threadlistViewFieldsOnly=false` |

Khớp **chính xác** `class Ct.getFacebookThreads` trong source. Không có `429`, không có
`Rate limit exceeded` trong 83 ca này.

## 8. Đối chiếu với 12 HAR cũ trong nhánh làm việc

| | 12 HAR cũ (nhánh) | 4 HAR mới (`main`) |
|---|---|---|
| POST tới `facebook.com` | **0** | **130** |
| upload ảnh | 0 | 326 |
| graphqlbatch | 0 | 83 |

⇒ Lần trước tôi kết luận "HAR không có request gửi thật" là **chỉ đúng với 12 file cũ**.
4 file trên `main` mới là dữ liệu của làn Extension.

## 9. Những gì dữ liệu này BÁC BỎ trong docs cũ

| khẳng định cũ | thực tế |
|---|---|
| "`error_payload` là ca thứ 3 hay gặp" (§28) | **0/130** — payload=null khi lỗi |
| "ACK rejected 3 552" chia 3 nhóm có `error_payload` | nhóm đó **không tồn tại** trong dữ liệu này |
| "`make-stable`/`1552012` retry bên trong sinh request thứ 2" | không thấy request thứ 2 ⇒ **chưa xác nhận** |

## 10. Việc còn để ngỏ — KHÔNG tự sửa khi chưa có yêu cầu

1. ~~sinh `offline_threading_id`~~ — **ĐÃ KIỂM, không khả thi**: script không sinh, và
   `buildSendParams` của extension ghi đè bằng `ps()` ⇒ không chuyển được sang.
2. `messageId` có dạng `mid.$…` ⇒ **dùng được** để đối chiếu trực tiếp trong
   `LOAD_FACEBOOK_MESSAGES` (cần kiểm `class He` trả `message_id` cho từng tin).
3. 2 file `Trace-*.json.gz` (9,3 MB) chưa mở — là Chrome trace, ít khả năng có response HTTP.
