# Đối soát 2 spec chính thức của Pancake vs code (2026-11-22)

> Nguồn: `api2.txt` = **Pancake Webhooks** OpenAPI 3.0 · `apo.txt` = **Pancake API Library**
> OpenAPI 3.0 (BẢN CHÍNH THỨC của nhà cung cấp, có cả mục "For AI assistants").
> Đọc trực tiếp, không suy đoán. Đối chiếu với `scripts/pancake-send-lite.user.js` (v1.93.19).

## 0. Hai file là gì

| file | phạm vi | có gì dùng được |
|---|---|---|
| `apo.txt` (185 KB) | REST API: `/pages`, `/conversations`, `/messages`, `/upload_contents`, thống kê, ads | **schema chính thức** của endpoint gửi tin mà script đang dùng |
| `api2.txt` (40 KB) | **Webhooks** — Pancake gọi vào server của bạn | `WebhookPayload`, `Message`, `Conversation`; **không** có endpoint gửi |

⚠ `api2.txt` **không** giúp gì cho việc gửi tin (nó là chiều Pancake → bạn). Giữ nó để đối chiếu
schema `Message` khi đọc lịch sử.

## 1. Endpoint gửi tin — spec nói gì (CHÍNH XÁC)

```
POST https://pages.fm/api/public_api/v1/pages/{page_id}/conversations/{conversation_id}/messages
  ?page_access_token=<token>
```

Code script dùng: `apiBase() + '/v1/pages/' + pageId + '/conversations/' + conv.id + '/messages'`
→ **khớp**. Hai `⚠` quan trọng trong spec:

### 1.1 `message` và `content_ids` là LOẠI TRỪ NHAU

> ⚠️ **IMPORTANT**: `message` and `content_ids` are **MUTUALLY EXCLUSIVE**.
> Do **NOT** send both simultaneously or API returns error.

Schema `InboxMessage`: `required: [action, message]`.

**Code hiện tại dựng body như sau (LUÔN gửi cả hai khoá):**
```js
const jsonBody = {
  action: 'reply_inbox',
  message: text == null ? '' : text,          // luôn có, kể cả ''
  content_ids: items.map((x) => x.id || ''),  // luôn có, kể cả []
  attachment_ids: fbIds, content_urls: …, dimensions: …, send_by_platform: 'web',
};
```

⇒ Khi **gửi tin chữ**: `content_ids: []` (mảng rỗng) vẫn được gửi kèm.
⇒ Khi **gửi ảnh**: `message: ''` (chuỗi rỗng) vẫn được gửi kèm.

**Chưa kết luận được là lỗi** — thực tế 21/21 ca thành công trong `logtest4.har` **không** bị
từ chối vì chuyện này, và mảng rỗng thường được server coi như "không có". Nhưng spec nói rõ
"mutually exclusive", nên đây là **điểm cần đo**: nếu về sau thấy lỗi kiểu
`invalid_upload_fb_attachments_result` hoặc 500, đây là nghi phạm đầu tiên.
**Không sửa khi chưa có log chứng minh.**

### 1.2 `200` KHÔNG có nghĩa là đã gửi

> a `200` HTTP status does **not** guarantee the message was sent — always check the `success`
> field in the body. When `success` is `false`, a `message_code` explains why.

**Code script ĐÚNG**: đã kiểm `res.ok && data && data.success` trước khi chốt ✅ (dòng 3723).

### 1.3 Trường lỗi chính thức: **`message_code`**

```yaml
message_code:
  description: Machine-readable error code, present when `success` is `false`.
                 For example `invalid_upload_fb_attachments_result`
```

**Code script ĐỌC `message_code`** nhưng chỉ ở **2 chỗ** (dòng 3306, 3926) và chỉ để đổ vào
`code` của kết quả. Trong `sendViaApi` (đường chính), `msg` dựng bằng
`data.message || data.error` ⇒ **KHÔNG đọc `message_code`** ⇒ khi Pancake trả
`{success:false, message_code:'…', message:''}` thì `msg` rơi về `'HTTP 200'`.

⇒ **Đây là lỗ hổng thật, cùng loại với ca `success:false` không kèm mã đã vá ở v1.93.19**
(đã vá bằng cách thêm chuỗi `success:false (không kèm mã lỗi)`, nhưng vẫn **không đọc được
`message_code`** — thiếu thông tin, không sai kết luận).

### 1.4 `id` của tin khi thành công

```yaml
id: { description: "ID of the sent message (present when `success` is `true`)" }
```
ví dụ `"1471242102982974_xxxxxxxxxxxxxxx"`.

⇒ **Bằng chứng dương thứ hai**, độc lập với `messageId` của extension. Script hiện **bỏ qua**
trường `id` này khi chốt ✅ API (chỉ dựa `success:true`).

## 2. Giới hạn `content_ids` theo nền tảng — spec nói rõ

| Platform | Max `content_ids` / call |
|---|---|
| **Facebook** | **30** |
| Instagram | 10 |
| personal_zalo | 30 |
| Telegram · Chat plugin · booking.com · mercado_libre | 10 |
| **all other platforms** | **1** |

⇒ Script gom nhiều ảnh vào 1 request khi `items.length > 1`. Với Facebook trần là **30**.
Cần kiểm: script có chặn khi ảnh > 30 không → **chưa thấy chặn** trong `buildInboxSend`.

## 3. `content_id` CÓ HẠN — cảnh báo chính thức

> a `content_id` is only valid on Facebook's side for a **limited time**, so reusing an old one
> fails. First, re-upload the file to get a **fresh** `content_id` and resend.
> If it still fails after re-uploading (**mostly with video**), retrying alone will not help.
> **file size < 25 MB**, **H.264 codec**, **≈ 30 fps** or lower.

### ĐÃ SOÁT CODE — có 2 chỗ dùng lại, 1 chỗ RỦI RO

**(a) Dùng lại cho `contents/touch`** (`contentIdsForTouch`, v1.93.15) — **an toàn**. Đây chỉ là
đánh dấu ảnh đã dùng, không gửi tin.

**(b) Dùng lại `photo.items[].id` khi GỬI** — **RỦI RO THEO SPEC**.

`normalizePhotoItems(photo)` trả `photo.items` và `buildInboxSend` lấy `x.id` làm `content_ids`:

```js
content_ids: items.map((x) => x.id || ''),
```

Spec nói `content_id` **chỉ sống một thời gian giới hạn** phía Facebook, và
"**reusing an old one fails**". Nếu `photo.items[].id` được sinh từ lần chụp/tải ảnh **trước**
mà người dùng dùng lại ở lượt gửi **sau**, thì `content_id` có thể đã hết hạn ⇒ lỗi.

Chỗ này **khác** với `fbId` (`is_reusable=false`): script có cơ chế rõ ràng cho `fbId`
(`uploadOneTimePhoto`, `spareFbIdPool`, `forceFresh`, tách `nonReusableFbIds`) — nghĩa là
**fbId** được quản lý chặt. Nhưng **`content_id`** (`x.id`) **không** có cơ chế tương đương:
`normalizePhotoItems` trả nguyên `photo.items` cũ.

**Chưa kết luận là lỗi đang xảy ra** — 21/21 ca thành công trong `logtest4.har` không có ca nào
báo `invalid_upload_fb_attachments_result`. Nhưng đây là **điểm mù thật** theo tài liệu chính
thức, và là nghi phạm số 1 nếu có lô ảnh bị từ chối hàng loạt.

**Cách kiểm mà không cần sửa:** tìm trong log các dòng `invalid_upload_fb_attachments_result`
hoặc lỗi khi gửi ảnh, rồi soát `photo.items[].id` của lượt đó có được tạo từ **lượt trước** không.


## 4. `filename` cho tin dạng tài liệu

```yaml
filename: "only supported when a attachment type is document. If omitted, defaults to `Document`"
```
Script **không gửi** `filename`. Nếu có gửi file tài liệu, tên sẽ là "Document". Không ảnh hưởng
gửi chữ/ảnh.

## 5. `sender_id` và `reply_message_id` — script không dùng

Spec có 2 trường:
- `sender_id`: "User must have the required subscription plan and page permissions"
- `reply_message_id`: "ID of the message you want to reply to"

Script **không gửi** cả hai ⇒ tin gửi dưới danh nghĩa page, không phải reply. Đúng ý định.

## 6. Đọc lịch sử — `GET …/messages`

```
GET /pages/{page_id}/conversations/{conversation_id}/messages?current_count=<index>
  → MessagesResponse { success, conversation_id, messages[], conv_from, customers, … }
```
- `current_count` = **vị trí chỉ số**, trả **30 tin trước** vị trí đó.
- `messages` sắp **mới → cũ**.
- `Message` có 33 trường; các trường script dùng: `id`, `from.id`, `inserted_at`, `type`,
  `message`, `attachments`, `is_removed`.

⚠ **Spec KHÔNG có `global_id`** trong `Message`/`MessagesResponse` — nó bị **comment out**:
```yaml
# global_id:
#   type: string
#   nullable: true
#   description: Customer's global Facebook ID.
```
⇒ **Xác nhận bằng tài liệu chính thức**: không có đường lấy `global_id` qua REST API.
Script dò gid qua extension (`GET_GLOBAL_ID_FOR_CONV`, `BATCH_GET_GLOBAL_ID`) là **đúng và
là đường duy nhất**. Đây là kết luận có căn cứ, thay cho suy đoán trước đây.

## 7. `Message` schema — hợp đồng đọc lịch sử

`id, conversation_id, page_id, type, message, original_message, from, inserted_at, seen,
has_phone, is_hidden, is_parent_hidden, is_removed, removed_by, is_parent, parent_id,
comment_count, like_count, user_likes, is_livestream_order, show_info, can_comment, can_like,
can_hide, can_remove, can_reply_privately, private_reply_conversation, rich_message,
edit_history, message_tags, phone_info, attachments`

⚠ **KHÔNG có `message_code`** và **KHÔNG có `client_message_id`** ⇒ không đối chiếu được
`offline_threading_id` qua đường REST. Khớp kết luận §2 của `DOI-SOAT-DU-LIEU-THAT.md`.

## 8. Webhooks (`api2.txt`) — không dùng cho gửi, nhưng có 1 điểm đáng biết

`WebhookPayload` = `{ page_id, event_type: 'messaging', data: { conversation, message, post } }`.
`Conversation` có `version` — **"monotonically increasing… apply an update only if its `version`
is greater than the last one you processed"** ⇒ nếu sau này đọc webhook để biết tin đã tới, phải
so `version`, không được tin thứ tự đến.

Cũng có cảnh báo: webhook bị **tạm ngưng** nếu tỉ lệ lỗi cao trong 30 phút. Script **không**
dùng webhook ⇒ không ảnh hưởng.

## 9. Tổng hợp: 3 việc ĐÁNG LÀM (chưa làm — cần quyết định)

| # | việc | căn cứ |
|---|---|---|
| 1 | đọc `message_code` trong `sendViaApi` để log có mã thật | spec §1.3 — hiện `msg` bỏ qua trường này |
| 2 | dùng `id` của response thành công làm bằng chứng dương thứ hai | spec §1.4 |
| 3 | chặn/ tách khi `items.length > 30` (Facebook) | spec §2 |

Riêng việc 1 **rẻ và an toàn** (chỉ thêm thông tin vào log, không đổi quyết định gửi).
Việc 2 và 3 cần đo thêm trước.

## 10. Điều spec BÁC BỎ trong docs cũ

| khẳng định cũ | spec nói |
|---|---|
| "lấy `global_id` qua REST `/messages`" | `global_id` bị **comment out** — không tồn tại |
| "`message_code` không có, chỉ có `e_code`/`e_subcode`" | `message_code` **có** trong spec chính thức (§1.3) |
