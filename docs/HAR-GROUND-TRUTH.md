# Sự thật gốc rút từ HAR (12 file, ~59 MB)

Tài liệu này ghi lại **mọi kết luận đã kiểm chứng bằng dữ liệu HAR**, để không phải suy đoán lại.
Cập nhật: 2026-11-11, script 1.91.80.

## 0. Phạm vi chính xác (đã đếm lại)

**12 file** `.har`, tổng 60 868 KB:

| File | entries | File | entries |
|---|---|---|---|
| batmesss | 348 | loadnhanh | 735 |
| guianh1 | 37 | pancake.vn2 | 58 |
| guicau | 284 | taidanhsach | 100 |
| guikhachcu | 275 | tinnhan | 216 |
| guisot | 170 | tinnhan1 | 31 |
| loaddanhsach | 50 | tinnhanthread | 93 |

> Trước đây tài liệu ghi "13 file" — **sai**, chỉ có 12. Đã sửa.

## 0b. Cách đọc — điều đầu tiên phải biết

Pancake trả phản hồi dạng **base64-encoded JSON**: chuỗi `eyJzdWNjZXNzIjp0cnVl…` giải mã ra `{"success":true…`.
Mọi phân tích đọc text thô mà không giải mã đều **sai**. Đây là nguồn gốc của nhiều kết luận sai trước đây.

Phạm vi đã đọc hết: 1619 request/response, 225 khung WebSocket, 58 request gửi, 91 lần đọc tin, 54 phản hồi danh sách.

## 1. Mã lỗi gửi tin — chỉ có 2 mã

| e_code | e_subcode | Nội dung | Bản chất |
|---|---|---|---|
| 10 | 2018300 | `(#10) … do một ứng dụng khác đang kiểm soát thread này` | thread bị app khác giữ, **hoặc** thiếu cờ ctx-7-days |
| 551 | 1545041 | `(#551) Người này hiện không có mặt.` | khách chết / chặn page (theo từng người) |

35/35 ca lỗi trong 60 MB chỉ rơi vào hai mã này. Không có mã thứ ba.

Mã phụ ở đường **đọc** (không phải gửi):

- `Hội thoại này không tồn tại` — thread đã bị xoá/không còn.
- `Too many requests` — 41 POST + 32 GET, **toàn bộ ở endpoint danh sách**.
- `success:false` với `message: null` — một số GET chi tiết.

## 1b. Chỉ có ĐÚNG MỘT đường gửi (đã kiểm bằng cách liệt kê toàn bộ endpoint)

Toàn bộ đường dẫn con dưới `/messages/` — **không có đường gửi nào khác**:

| Endpoint | Số | Loại |
|---|---|---|
| POST `/messages/fill_admin_name` | 153 | metadata (body `{timestamp}`) |
| GET `/messages/recent_orders` | 92 | metadata |
| POST `/messages/load_shop_page_customers` | 92 | metadata |
| GET `/messages/customer_info` | 89 | metadata |

Đường gửi duy nhất: `POST /pages/{pageId}/conversations/{convId}/messages`.

Mã lỗi trên **toàn bộ hệ thống** (không chỉ đường gửi): `e_code` **10** (24 lần), **551** (11 lần),
`error_code` **429** (73 lần). **Không có mã nào khác** trong 59 MB.
`graph.facebook.com/{psid}/picture` trả **400** ở 8 lần — app lấy avatar trực tiếp từ FB và bị chặn; vô hại.

Dấu hiệu dứt điểm cho hội thoại đã xoá: `{"existed":false,"message":"Hội thoại này không tồn tại","success":false}`
— dùng cờ `existed:false`, đáng tin hơn so khớp chuỗi.

## 2. Hợp đồng gửi tin (POST …/conversations/{convId}/messages)

52/52 request đều `action=reply_inbox`. Field đầy đủ:

```
action=reply_inbox
is_record_ctx_7_days=true          ← chỉ 24/58 request có; xem bảng dưới (thiếu cờ ⇒ (#10))
message=<nội dung>
content_id=<uuid>                  ← chỉ khi có ảnh
attachment_id=<fb_id>              ← chỉ khi có ảnh
content_url=https://content.pancake.vn/…
width / height
send_by_platform=web
```

Nhiều ảnh dùng JSON: `content_ids`, `attachment_ids`, `content_urls`, `dimensions`, `send_by_platform`.

Phản hồi thành công: `{"id":"m_<base64url>","success":true,"original_error":null}` (19 ca có `original_error`, 4 ca không).
**23/23 ca thành công đều có `id`; 0 ca `success:true` mà thiếu id.**
Request gửi **không có** header xác thực riêng (chỉ `content-type`) và **không có** khoá idempotency
⇒ Facebook không có chống trùng phía server; "có id mới là bằng chứng" là lớp bảo vệ duy nhất.

## 3. Chuỗi gửi ảnh

```
content_id (uuid)
   └─► POST /pages/{pageId}/contents/facebook?access_token=…&is_reusable=…&async=false
       body: {"content_ids":"[\"<uuid>\"]","conv_id":"<pageId>_<psid>"}
       resp: {"success":true,"fb_ids":["1761420001631103"]}     ← fb_ids[0] = attachment_id
   └─► POST …/messages mang CẢ content_id (uuid) + attachment_id (fb_id) + content_url + width/height
```

- Đo thực tế: **đăng ký → gửi chỉ 0,03–0,08 s**. App không chờ FB xử lý ảnh ⇒ không được chèn delay.
- `/contents/facebook` **có thể trả 500** ⇒ nếu vẫn gửi với `attachment_id` rỗng thì ảnh mất mà tin vẫn đi.
- Trong 13 HAR **không có** request tải file thô nào (mọi ảnh đến từ thư viện nội dung có sẵn)
  ⇒ nếu ảnh lỗi, nghi khâu tạo `content_id` phía Pancake, không phải đường gửi.

## 4. global_id — 3 nguồn, và bằng chứng không thể suy đoán

| Nguồn | Số liệu | Ghi chú |
|---|---|---|
| `GET …/messages` (cấp 1) | **33/91** có, 58 null | cùng request dùng để kiểm chứng |
| `POST /customers/{id}/update_global_id` | 7 ca, body `{"global_id","conversation_id","source":"send_inbox"}` | app tự ghi sau khi gửi |
| `POST /logs/pancake_exception_log` | context `{current_page_id, global_id, from_id}` | app tự khai cặp (page, from) → gid |

Chứng minh **không thể suy gid từ psid/thread_id**:

```
from_psid       = "29450322741322977"   (17 chữ số)
customers.fb_id = "29450322741322977"   (cùng giá trị)
global_id thật  = "100061610676863"     (15 chữ số)
```

Khác cả độ dài lẫn giá trị; danh sách hội thoại **không hề** chứa `global_id` (0/54 phản hồi).
Đối chiếu chéo: `update_global_id` ghi `100061610676863` cho conv `834072796450267_29151391154486551`,
và `GET …/messages` của đúng conv đó trả `global_id = 100061610676863` — khớp tuyệt đối.

## 5. Nguồn xác nhận giao tin

1. **`id` trong phản hồi gửi** — bằng chứng duy nhất tuyệt đối.
2. **`read_watermarks`** trong phản hồi đọc tin (dạng list):
   ```json
   [{"message_id":"m_G1Fm…","psid":"39224298167184827","watermark":1792404620,"is_group_conv":null}]
   ```
   `watermark` là unix giây của tin cuối. Dùng được để **phát hiện có tin mới hơn mốc gửi**.
   ⚠ Chỉ được kết luận "đã giao", **không** được kết luận "chưa giao" (là mốc đã đọc, có thể trễ).
3. **`snippet` + `last_sent_by` của danh sách** — xác nhận hàng loạt, rẻ cho máy yếu.
   Nhưng 73/73 lần 429 dồn đúng endpoint này ⇒ phải giãn nhịp, chỉ dùng để lật ⚠→✅.
4. **WebSocket: KHÔNG dùng được.** 225 khung đều binary MQTT-Lightspeed (`mqttwsclient`,
   `/ls_app_settings`, `/ls_foreground_state`, `/ls_resp`), không có khung báo tin đã giao.
   (Điểm này khớp cơ chế ACK `/ls_req` ↔ `/ls_resp` đang dùng.)

## 6. Trạng thái khách

| Trường | Quan sát | Dùng được? |
|---|---|---|
| `can_inbox` | 4 `false` / 87 `true`, chỉ có ở **chi tiết thread** | Chỉ nên đếm/telemetry; **không** dùng để bỏ gửi (mẫu quá nhỏ, sợ lọt khách sống) |
| `is_banned` / `banned_count` | luôn `false` / `0` | không |
| `read_watermarks` | list 69 / null 22 | xem mục 5 |

`POST /check_inbox` **không phải** kiểm tra khách còn sống: body rỗng, trả `{"success":true}`
— đó là thao tác nhận/đánh dấu đã đọc hộp thư.

## 7. Lỗi hạ tầng

| Status | Nơi xảy ra | Đánh giá |
|---|---|---|
| 301 (527) | chuyển hướng ảnh/avatar | vô hại |
| 404 (10) | **toàn bộ** `/pages/{id}/avatar/…` | vô hại |
| 500 (4) | `/contents/facebook`, `/conversations` ×2, `/customers/{id}` | ảnh + danh sách, không phải gửi |
| 429 (73) | chỉ 2 endpoint danh sách | gửi tin miễn nhiễm |
| 0 (85) | gọi chi tiết thread bị trình duyệt huỷ | đừng dò gid song song quá nhiều |

## 7b. Trình tự thật của app quanh một lần gửi (đọc dòng thời gian)

```
GET  …/messages            ← nạp thread trước khi gửi
POST …/contents/facebook   ← đăng ký ảnh (nếu có), +0,07 s là gửi
POST …/messages            ← gửi
GET  …/messages            ← đọc lại sau ~1,3 s
POST …/messages            ← tin tiếp theo của cùng hội thoại
POST …/check_inbox         ← SAU khi gửi, không phải trước
POST …/contents/touch
```

Kết luận: `check_inbox` **không** phải bước "nhận hội thoại" trước khi gửi (giả thuyết liên quan `#10` bị bác bỏ).
Không được thêm nó vào trước đường gửi để "chắc ăn" — chỉ tốn request.

## 7c. Cơ chế phân trang danh sách — lý do KHÔNG nên nạp danh sách bằng API

Đo trên 187 request danh sách:

| Số liệu | Giá trị |
|---|---|
| Kích thước trang | **luôn 40 hội thoại** (110/110 phản hồi `len=40`) |
| Tham số xin trang lớn hơn (`limit`, `page_size`, `per_page`) | **KHÔNG tồn tại** |
| Tỉ lệ bị 429 | **73/187 = 39%** |
| Nhịp app tự gửi | median **0,13 s**, min 0,0 s — app **không** backoff |

Tham số thật của endpoint danh sách: `pages`, `unread_first`, `mode`, `tags`, `except_tags`,
`cursor_mode`, `from_platform`, `current_count`, `next_cursor`, `access_token`.

`next_cursor` là base64 của khối nhị phân không đọc được (`…1881264518397934:881264518397934_…`) ⇒
**không thể tự dựng cursor**, chỉ có thể nhận rồi trả lại nguyên vẹn.

Hệ quả: nạp 11 000 chat qua API = **~275 request tuần tự**, trong đó ~39% bị 429.
⇒ Giữ nguyên chiến lược đọc danh sách từ trang/extension, **không** xây bộ nạp danh sách bằng API.
(Điều này khớp với chẩn đoán `HTTP 0` của script.)

## 7d. Các giả thuyết đã KIỂM và BÁC BỎ

| Giả thuyết | Kết quả |
|---|---|
| `check_inbox` là bước "nhận hội thoại" trước khi gửi, thiếu nó sinh `#10` | **Sai** — nó luôn nằm SAU khi gửi |
| `global_id`/`can_inbox` chỉ có khi gửi `is_new_api=true` | **Sai** — 91/91 phản hồi đều có `can_inbox` + `read_watermarks` bất kể cờ; `global_id` có 33/91 độc lập với cờ |
| Có endpoint gửi thứ hai | **Sai** — xem mục 9 |
| Danh sách có `global_id` | **Sai** — 0/54 |

Số liệu phân bố chuẩn của lần đọc tin (91 mẫu): `can_inbox` **luôn có mặt** (4 false / 87 true),
`read_watermarks` **luôn có mặt**, `global_id` chỉ **33/91 (36%)** — phần còn lại dịch vụ trả `null` thật.

## 9c. Vì sao lịch sử thiếu tin? ĐÃ TÌM RA — không phải do tin ảnh

Giả thuyết "tin chỉ có ảnh (không chữ) bị lịch sử bỏ sót" ⇒ **SAI**. Bảng đối chiếu 23 ca gửi thành công:

| Loại tin | Thấy trong lịch sử | Không thấy |
|---|---|---|
| ảnh, không chữ | **3/3** | 0 |
| chữ | 13/16 | 3 |
| gửi dạng JSON nhiều ảnh | 2/4 | 2 |

Tin ảnh **luôn được ghi nhận đúng**. Cái thiếu là tin **chữ**.

Nguyên nhân thật: **lần đọc chỉ trả về một CỬA SỔ 5–13 tin** (median 8; phân bố 5/7/8/9/10/13).
Tin nào rơi ra ngoài cửa sổ đó thì không bao giờ thấy — dù đã gửi thành công.
Cộng với việc server có độ trễ ghi (17/23 thấy sau ~1,3 s, 5/23 không thấy trong toàn bộ phiên),
điều này giải thích đủ 22% thiếu hụt mà **không cần** giả thuyết nào về ảnh.

⇒ Hệ quả kỹ thuật quan trọng: mọi logic "kiểm chứng bằng lịch sử" chỉ nhìn được ~8 tin gần nhất.
Với chat sôi động, tin của ta có thể bị đẩy ra ngoài cửa sổ trong vài giây ⇒ **không bao giờ** được
dùng kết quả "không thấy" để kết luận "chưa gửi". (Xem mục 9b.)

## 7f. CỜ ctx7 — ĐÃ SỬA SỐ LIỆU SAI VÀ XÁC NHẬN BẰNG BẢNG CHÉO

Trước đây tài liệu (và tôi) ghi "52/52 request đều có cờ". **SAI** — con số đó lấy từ một chú thích
trong code, không phải từ đếm thật. Đếm lại trên 58 request gửi:

| Cờ ctx7 | OK | `#10` | `#551` | Tổng |
|---|---|---|---|---|
| **CÓ cờ** | **19** | **0** | 5 | 24 |
| **THIẾU cờ** | 4 | **24** | 6 | 34 |

Kết luận (mạnh hơn cả chú thích cũ):

- **24/24 ca `#10` đều THIẾU cờ — không có ca `#10` nào khi có cờ.**
- Tỉ lệ thành công: có cờ **19/24 = 79 %** · thiếu cờ **4/34 = 12 %**.
- Cờ **không** cứu được `#551` (khách chết) — 5 ca có cờ vẫn `#551`.

⇒ Thay đổi 1.91.80 (luôn gửi cờ) là **đúng và đã được kiểm bằng dữ liệu**, không phải theo chú thích.
Đồng thời đây là lời giải thích cho việc lô thực tế không còn dòng `🚫 API bị chặn ngoài cửa sổ 24h`.

## 7e. KẾT QUẢ ĐO THỰC TẾ (lô 10 660 tin, 1.91.82, 347 s)

| Chỉ số | Kết quả | So với trước |
|---|---|---|
| Thành công / mục tiêu thật | **8 979/9 053 = 99,2 %** | 99,3 % (ngang) |
| Tốc độ | 30,73 tin/s | 28,19 → **nhanh hơn** |
| `🚫 API bị chặn ngoài cửa sổ 24h` | **KHÔNG còn xuất hiện** | 7 → **0** ✅ |
| `can_inbox=false` | **0/57** | mới đo |
| ACK TB/max | 3 431/6 831 ms | 1 346 ms → **chậm hơn 2,5×** |
| Socket/page cap cuối | **[64×1]** | [192×1] → bộ điều tốc tự hạ |
| `retry lần` | 0 | 0 ✅ |

**Đối soát khít 100 %:** ❌ 1 664 = **1 607** khách chết (đã ghi nhớ) + **57** không có global_id.
Không có lỗi nào khác. Đây là bằng chứng mạnh rằng phân loại hiện tại **không còn lọt dạng lỗi nào chưa biết**.

**Kết luận về `can_inbox`: LOẠI BỎ khỏi hướng đi.** 57 ca đọc tin mà **không ca nào** `can_inbox=false`,
trong khi 1 607 khách chết là có thật ⇒ cờ này **không** phản ánh việc khách chặn page. Không dùng để lọc.

**Việc còn lại duy nhất (0,53 %):** 57 ca `HTTP không có gid` mỗi lô. Theo HAR, endpoint gửi
`POST /pages/{pageId}/conversations/{convId}/messages` **chỉ dùng convId, không có tham số global_id**,
nên về lý thuyết làn API gửi được cho các chat này. Hiện code dừng ở cổng `noGidGate` của làn Extension
và chưa thử API ⇒ cần đọc kỹ `sendOne` + `sendViaApi` trước khi sửa.

## 8. Những thứ KHÔNG có trong HAR (vùng mù — không được suy diễn)

1. Kênh **Extension ↔ trang** (không phải HTTP).
2. Khâu **tải file thô** lên thư viện nội dung.
3. `thuhetkenh.har` trên `main` bị cắt đúng **500.000 byte**, chỉ chứa CSS/HTML, 0 request API — không dùng được.

## 9. Các kết luận SAI đã đính chính

| Từng nói | Thực tế |
|---|---|
| "Danh sách/đọc tin không có global_id" | Có, nhưng phải **giải base64** mới thấy (33/91) |
| "HAR không có khung WebSocket" | Có 225 khung (vẫn không dùng được để xác nhận) |
| "Có endpoint gửi thứ hai `POST /conversations/{convId}`" | Không — đó chính là 58 request `/messages`, tên bị cắt khi in |
| "Code chưa đọc global_id từ payload chat" | Đã đọc từ trước (dòng 2107, 1098) — 52 ca "không có gid" là Pancake trả null thật |

## 9b. BẰNG CHỨNG QUYẾT ĐỊNH: lịch sử tin KHÔNG đáng tin

Đo trực tiếp trên 23 lần gửi **thành công** (có `id` trả về) trong HAR:

| Kiểm tra | Kết quả |
|---|---|
| `id` có trong lần ĐỌC ngay sau (~1,3 s) | 17/23 |
| `id` có trong **một** lần đọc sau đó | 18/23 (trễ 0,8–1,2 s khi thấy) |
| `id` **không bao giờ** thấy trong toàn bộ HAR | **5/23 (22%)** |

⇒ **"Không thấy tin trong lịch sử" KHÔNG phải bằng chứng "chưa gửi".**

Hệ quả bắt buộc:

1. **KHÔNG được tự động gửi lại** ca "kiểm chứng không thấy tin". Nếu làm, tỉ lệ gửi trùng sẽ xấp xỉ 20%+ — đúng lỗi người dùng cấm.
2. Chính sách hiện tại của code (giữ ⚠, không bắn lại) là **đúng**, và giờ đã có số liệu bảo vệ.
3. 16–27 tin ⚠ mỗi lô **không phải là "lọt khách còn sống"**: một phần trong đó nhiều khả năng đã giao thật.
   Tỉ lệ thành công thật có thể **cao hơn** con số 99,3% đang báo.
4. Đọc lại nhiều nhịp (1.91.78) cũng không cứu được điều này — nó chỉ tốn thời gian. Đã rút ở 1.91.79.

## 10. Trạng thái việc làm

- ✅ 1.91.79 — đọc lại Ext không còn giữ lượt (bỏ 176 s chờ vô ích).
- ✅ 1.91.80 — luôn gửi `is_record_ctx_7_days` (bảng chéo 7f: thiếu cờ ⇒ 24/24 ca `#10`).
- ❌ **HUỶ** kế hoạch gửi lại ca "không rõ" — xem mục 9b (22% ca đã gửi vẫn không thấy trong lịch sử).
- ⬜ Xác nhận hàng loạt bằng `snippet`/`last_sent_by`/`read_watermarks` (chỉ lật ⚠→✅, không bao giờ kết luận ngược).
- ⬜ Đếm `can_inbox=false` để đối chiếu với số ❌ thực tế (telemetry, chưa dùng để quyết định).
- ⬜ Coi `Hội thoại này không tồn tại` là kết luận dứt điểm (cân nhắc: chỉ khi gặp 2 lần, tránh lỗi tạm thời).

## 11. Tối ưu tốc độ — số liệu và cách tự tìm điểm ngọt

Từ lô 10 660 tin (347 s, 30,7 tin/s, 192 in-flight, ACK TB 3 431 ms):

- Trần lý thuyết theo định luật Little: 192 ÷ 3,431 s ≈ **56 tin/s**; thực tế 30,7 ⇒ đạt **55 %**.
- Nút thắt chính: **Socket/page cap bị bộ điều tốc hạ 192 → 64** (`backoff chậm/no-ACK 4/2`),
  trong khi bucket ACK lớn nhất là 2–5 s (9 134 tin).
- `wave→cổng 18,4 s` **không phải** nút thắt: wave 1 000 tin phát trong ~1 s nhưng cổng xả
  30 tin/s nên phải đợi 33 s. Đổi wave size chỉ đổi độ trễ nhìn thấy, không đổi thông lượng.

### Cách tự thử (không cần build lại)

Mở Console của trang Pancake khi đang chạy script:

```js
__botfakeSetSockPageFloor__(128)   // sàn 128; thử 96 / 128 / 192
__botfakeSetSockPageFloor__(64)    // về mặc định
```

Giá trị lưu ở `localStorage['botfake_sock_page_floor']`, áp dụng cho lượt gửi kế tiếp.
Dòng `🌊` trong log sẽ hiện `Socket/page cap <sàn>–192 (sàn tự đặt)` khi khác mặc định.

### Cách đánh giá một lần thử (1 lô là đủ)

| Giữ sàn cao nếu | Trả về 64 nếu |
|---|---|
| ACK TB ≤ 4 000 ms | ACK TB > 5 000 ms |
| `no-ACK` = 0 | `no-ACK` > 0 |
| tốc độ tin/s tăng | tốc độ không tăng hoặc ❌ tăng |

Muốn vượt trần 56 tin/s một cách chắc chắn thì phải **tăng số page chạy song song** —
giới hạn nằm ở từng page của Facebook, không phải ở máy.

## §12 — Bão mất ACK giữa lô (log thật 19:03, 11/11) và hai van an toàn 1.91.85

**Hiện tượng.** Tới tin ~[1082/9963] thì *mọi* tin qua Socket đều `không có ACK`
liên tục (không rải rác), kéo theo mỗi chat một vòng `kiểm chứng 4 lần đọc`
(rỗng cả 4) → `bắn cứu 1 vòng qua Extension` → `bù THÀNH CÔNG`. Kết quả: 6
round-trip/chat thay vì 1, toàn bộ tải dồn sang đường Extension ⇒ gửi rất chậm.

**Chẩn đoán.** Không phải lỗi một chat: no-ACK *đồng loạt và đột ngột* sau ~1 100
tin là dấu hiệu Pancake bóp ACK khi có quá nhiều kết nối socket cùng lúc. Bộ điều
tiết cũ chỉ co lane xuống **sàn 64/page**, vẫn quá cao ⇒ mất ACK tiếp.

**Van 1 — cầu dao ACK toàn cục.** `sockNoAckRun` đếm no-ACK liên tiếp; đạt 25 thì
hạ **sàn** lane 64→32→16 (giữ tới hết phiên) và hạ luôn limit trang đang chạy.
ACK hồi ⇒ `sockNoAckRun` reset, upshift vẫn đưa lane về tới 192 như cũ.
Log: `🧯 Mất ACK liên tục 25 tin — hạ SÀN socket xuống 32/page`.

**Van 2 — hàng đợi kiểm chứng.** Tối đa **12 vòng kiểm chứng chạy song song**,
số còn lại xếp FIFO. **Không đổi logic phán xử**: vẫn cần 2 lần đọc rỗng liên
tiếp mới kết luận "chưa tới" ⇒ không tăng nguy cơ gửi trùng. Mục tiêu là chặn
hàng trăm vòng đọc đồng thời (nguồn 429 tràn sang cả đường Extension bù).

**Cách A/B.** Chạy một lô lớn và đọc dòng tổng kết: nếu thấy `🧯` xuất hiện thì
cầu dao có tác dụng; so `ACK TB` và số ca `bù qua Extension` với lô 19:03.
Nếu `🧯` không xuất hiện mà vẫn no-ACK hàng loạt ⇒ hạ `SOCK_ACK_STORM_RUN`
hoặc đặt sàn tay `__botfakeSetSockPageFloor__(32)` trước khi chạy.

## §13 — Lô xác nhận sau 1.91.85 (19:54, 11/11): kỷ lục 71,96 tin/giây

**Cấu hình:** 1.91.85-W200.27 · 12 wave · size 500 · gap 250 ms · Gửi nhanh BẬT · 1 page
(`Socket/page limits cuối [192×1]`).

| Chỉ số | Lô B (21:10) | Lô C (21:52) | **Lô này (19:54)** |
|---|---|---|---|
| Tin đã gửi | 10 602 | 9 337 | **5 897** |
| Tốc độ | 47,41/s | 27,97/s | **71,96/s (4 318/phút)** |
| Thời gian | 224 s | 334 s | **82 s** |
| ACK TB / max | 1 359 / 3 854 ms | 1 360 / 12 680 ms | **1 507 / 3 900 ms** |
| no-ACK | có | có | **0** |
| `🧯` cầu dao | — | — | **không xuất hiện** |

**Đọc kết quả:** `📡 ACK OK/rejected/no-ACK 5738/55/0` ⇒ **không mất một ACK nào**,
nên cầu dao `🧯` và hàng đợi kiểm chứng **không phải kích hoạt** — đúng thiết kế.
Tỉ lệ tới đích `5841/5882 = 99,3%`; `❌16` lỗi; `⚠40` đều là `Ext quá hạn`
(kiểm chứng thấy tin **0**, chưa thấy **40**) ⇒ giữ ⚠, không gửi lại, không trùng.

**Kết luận về nhịp gửi.** Bão mất ACK ở §12 xuất hiện khi nhịp quá dày; giảm xuống
`500/250 ms` đưa no-ACK về **0** và tốc độ lên gấp **1,5× lô B** và **2,6× lô C**.
Bài học: *một round-trip nhanh luôn thắng sáu round-trip chậm*. Cấu hình này chưa
đặt làm mặc định — cần thêm 1–2 lô nữa trước khi đổi.

**Đuôi còn lại:** 40 ca `Ext quá hạn` (0,7%). Đây là chỗ duy nhất còn đáng tối ưu;
mọi thứ khác trong lô đã chạm trần lý thuyết (192 in-flight × ACK 1,5 s ≈ 128/s,
thực đạt 72/s).

## §14 — "Dính" ở lô nhỏ KHÔNG phải do tải: là kênh ACK đã chết (1.91.86)

**Bằng chứng (log 20:03–20:38, 11/11 — các lô 5, 6, 7, 10, 20, 68 chat).**

| Lô | Tin đi Socket | ACK no-ACK | Độ trễ ACK đo được |
|---|---|---|---|
| 68 chat | 5 | **5** | **20 016 / 20 042 ms** |
| 7 chat | 1 | 1 | 8 002 ms |
| 5 chat | 1 | 1 | 8 000 ms |
| 10 chat | 1 | 1 | 8 003 ms |
| 20 chat (20:03) | 1 | 0 | 1 554 ms (kênh còn sống) |

**Đọc con số.** Độ trễ **đúng bằng hạn chờ** (8 000 ms và 20 000 ms, sai số 2–42 ms)
nghĩa là **không có phản hồi nào** — không phải server trả chậm. Kênh ACK của page
đã chết; Socket vẫn gửi được nhưng không bao giờ biết kết quả ⇒ mỗi tin như vậy tốn
`hạn chờ + 4 lần đọc kiểm chứng + Ext bù` ⇒ lô 5 tin mất **13 s**, lô 68 tin mất **28 s**.

Vì sao chỉ 1 tin đi Socket mỗi lô nhỏ: `pickBestDirectOrder` chỉ ưu tiên Socket khi
`isPageSocketReady()` VÀ có `global_id` thật; phần lớn chat đi làn API. Tin cuối lô
rơi vào Socket ⇒ trúng đúng kênh chết ⇒ đuôi dài.

**Sửa (1.91.86).** `pageAckTimeoutRun[pageId]`: đếm no-ACK có độ trễ ≥ 6 s (tức đã
chờ hết hạn). Đạt **2** ⇒ `pageAckDeadAt[pageId] = now` và `pickBestDirectOrder`
**bỏ 'socket' khỏi thứ tự làn** ⇒ đi Extension (~1 s) thay vì Socket-rồi-chờ-20 s.
ACK thành công (`kind==='ok'`) ⇒ xoá dấu. Hết hạn 120 s ⇒ tự thử lại Socket.

**An toàn:** chỉ đổi **thứ tự kênh**, không thêm lệnh gửi, không gửi lặp, không mở
khoá outbound. Log: `🧯 Socket ACK của page … coi như CHẾT (2 lần no-ACK đủ hạn chờ ~20s)`.

**Kỳ vọng:** đuôi 13–28 s của lô nhỏ rút còn ~2–3 s; lô lớn không đổi (kênh còn sống
thì cờ không bao giờ bật).

## §15 — Bỏ "chờ cứng" ACK: hạn chờ thích ứng (1.91.87)

**Phát hiện khi đọc lại code + HAR.** Hai mốc 8 000 ms và 20 000 ms **không phải do
Pancake** — chúng là hằng số script tự đặt tại một dòng duy nhất:

```js
const ackWaitMs = (batchStats.total > 0 && batchStats.total <= 30) ? 8000 : 20000;
```

Vì vậy "chờ 20 s rồi vẫn no-ACK" ở §14 chỉ là **hệ quả của chính hạn chờ đó**.
HAR xác nhận ACK là frame `/ls_resp` echo `request_id` trên `wss://edge-chat.facebook.com/chat`
(không có endpoint HTTP nào trả kết quả gửi) ⇒ muốn biết kết quả sớm hơn thì phải
**rút hạn chờ**, không có đường khác.

**Sửa.** (a) Đo độ trễ ACK thật, giữ vòng 200 mẫu, tính p90. (b) Hạn chờ =
`clamp(3 × p90, 2500, mức cũ)` — lô 5 897 tin có p90 ≈ 2–3 s ⇒ chờ ~6–8 s thay vì 20 s;
kênh chết thì ~2,5–4,5 s. (c) No-ACK có độ trễ **≥95 % hạn chờ vừa áp dụng** ⇒ bộ đếm
giờ đã nổ, không có phản hồi nào ⇒ **1 lần** là đủ đánh dấu kênh chết (trước là 2 lần,
tốn thêm trọn một hạn chờ).

**Vì sao không bỏ chờ hoàn toàn.** Không có ACK thì *không biết tin đã đi hay chưa*;
bỏ chờ ⇒ kết luận sớm ⇒ bù Ext ⇒ **gửi trùng**. Đây là ranh giới không được vượt.
Mức tối ưu hợp lệ là: chờ *vừa đủ* theo dữ liệu đo được, rồi hoặc chốt ✅, hoặc đánh
dấu kênh chết để **những tin sau không phải chờ nữa** (đã làm ở §14).

**Ước tính:** lô nhỏ 5–10 chat: đuôi 13 s → ~3–5 s; lô lớn: hạn chờ 20 s → 6–8 s,
số ca `⚠ không rõ` giảm vì ít lần cắt oan ACK chậm hơn.

## §16 — Lô 08:19 (1.91.87): 74/74 no-ACK, 0 ACK OK — vì sao cờ "chết" chưa cứu được lô đầu (1.91.88)

**Số liệu.** 77 chat · `✅ 77/77 · [API 3 · Ext 74]` · **`ACK OK/rejected/no-ACK 0/0/74`** ·
`ACK TB/max 7463/8229ms` (toàn bộ rơi vào bucket ≥5s) · `🧯 Mất ACK liên tục 25 tin —
hạ SÀN socket xuống 16/page` · `wave→cổng 779ms` · tổng **30s**.

**Đọc.** Kênh ACK chết **ngay từ tin đầu** (0 ACK OK trong 74 lần) và Socket **không giao
được tin nào** — cả 74 phải bù Extension, bù thành công 100%. Tức khi ACK chết thì kênh
Socket mất giá trị gần như tuyệt đối.

**Vì sao 1.91.86/87 chưa cắt được lô này.** Toàn bộ 77 chat được phát trong **779 ms**,
còn ACK đầu tiên chỉ mất sau ~7,5 s ⇒ **mọi tin đã lên đường trước khi có thông tin đầu
tiên**. Trong cùng một wave, không có cách nào "biết trước" để né Socket. Giá trị thật của
cờ `pageAckDeadAt` là **giữ qua các lô**.

**Sửa 1.91.88.** (a) TTL cờ 2 phút → **10 phút** để lô sau đi Ext ngay từ tin đầu.
(b) Khi page đã đánh dấu chết: kiểm chứng rút **4 → 2 lần đọc** (luật "2 lần rỗng liên tiếp"
đã đủ để kết luận) ⇒ giảm một nửa request đọc, vẫn **không** nới điều kiện bù ⇒ không sinh
tin trùng. Log: `🧯 … page có kênh ACK chết ⇒ kiểm chứng rút còn 2 lần đọc`.

**Hướng triệt để còn lại (chưa làm, cần cân nhắc).** "Lô dò": phát 1–2 tin qua Socket trước,
chờ tối đa ~3 s; nếu không ACK thì đánh dấu chết rồi mới phát phần còn lại qua Ext. Đổi lại:
mỗi lô trả giá ~3 s cố định, kể cả khi kênh khoẻ.

## §17 — So sánh HAR: HTTP vs Socket, và nút "Toàn bộ qua Ext" (1.91.89)

**Đo trên 12 file HAR, 303 request `POST /pages/{pageId}/conversations/{convId}/messages`:**

| Chỉ số | Giá trị |
|---|---|
| Thời lượng p50 | **37 ms** |
| p90 | 999 ms |
| TB | 283 ms |
| max | 6 651 ms |
| HTTP 200 + `success:true` | 244 |
| HTTP 200 + `success:false` (`#551` khách vắng) | 35 |
| HTTP 200 không rõ / status 0 (hủy) | 10 / 14 |

Đối chiếu Socket (log thật): ACK TB **1 507 ms** khi khoẻ, **7 463–8 229 ms** khi kênh ACK chết,
và khi chết thì **0/74 tin giao được**. Kết luận: HTTP **nhanh hơn** và **dứt khoát hơn**
(p50 37 ms), Socket chỉ thắng khi cần >48 làn song song ở lô rất lớn.

**Nút mới (1.91.89):** checkbox `🛰 Toàn bộ qua Ext` trên panel (lưu qua F5, khoá
`localStorage['ssb_force_ext']`, setter `__botfakeForceExt__(true|false)`).
Bật ⇒ `pickBestDirectOrder` trả `['ext', 'api']` — **bỏ hẳn Socket**, nên:
không chờ ACK, không có ca `⚠ không rõ`, không vòng kiểm chứng lịch sử.
API vẫn giữ làm dự phòng khi Ext lỗi (vẫn là HTTP, không phải Socket).

## §18 — Lô 08:34 (1.91.89): vì sao Ext KHÔNG THỂ nhanh — và vì sao phải đi API trước

**Số liệu.** 2 413 chat · `✅ 1 503 (62,3%) [API 1 · Ext 1 502]` · `❌ 850` · `⚠ 60` ·
226 s ⇒ **10,65 tin/giây**. `peak Ext queue/active 401/128` · `wave→cổng TB/max 40 414/105 325 ms`
· `người nhận rejected cuối 754` (31 % danh sách là khách vắng).

**Ba phát hiện.**

1. **Ext bị tuần tự hoá.** 128 làn Ext "active" nhưng chỉ đạt 10,65 tin/giây; với 0,9 s/ca
   (HAR §17) và 128 làn thì đáng lẽ ~140/s. Chênh 13× ⇒ Extension xử lý **lần lượt**
   (mỗi tab một hàng đợi), không song song như HTTP fetch. Vì vậy "gửi full Ext" **không thể**
   nhanh bằng làn API; trần thực tế ~10–15 tin/giây.
2. **754 ca khách vắng × 0,9 s** là phần lớn thời gian lô này — và chúng bị thử lại mỗi lô vì
   localStorage đầy nên không ghi được ID (§17). Log `⚠ Không lưu được ID unavailable` xuất
   hiện ~700 lần.
3. **~135 ca `Không tìm được global_id … bỏ qua Ext thread-only`**: làn Ext cần `global_id`,
   trong khi 283 ca `HTTP không có gid` + 96 `gate bỏ Ext no-gid`. Làn **API không cần gid**
   (HAR: body chỉ có `conv_id`) ⇒ đi API trước vừa nhanh hơn vừa cứu được nhóm này.

**Sửa 1.91.90–1.91.91.** `🛰 Toàn bộ qua Ext` nay chạy **API trước (96 làn HTTP), Ext dự phòng**;
localStorage đầy thì dọn 40 % khóa cũ **tối đa 1 lần/60 s** (chống dọn lặp + spam log).

**Kỳ vọng:** 850 lỗi ⇒ phần lớn thành công; tốc độ 10,65/s ⇒ chục đến hàng trăm tin/giây tuỳ
số ca khách vắng (mỗi ca vẫn ~0,9 s vì server trả lời chậm — không tránh được).

## §19 — Kiểm HAR trước khi đổi tên/mặc định: API và Ext là CÙNG một đường (1.91.92)

**Kiểm trên 303 request `POST /pages/{pageId}/conversations/{convId}/messages` trong 12 HAR:**

| Kiểm | Kết quả |
|---|---|
| `origin` | **`https://pancake.vn` × 297**, không có request nào `chrome-extension://` |
| header `x-api-key` / `authorization` riêng | **0** |
| `global_id` trong body | **0** |
| field body thấy được | `action` 58 · `message` 211 · `send_by_platform` 56 · `is_record_ctx_7_days` 24 · `content_id`/`attachment_id` 6 |

⇒ API (fetch từ trang) và Ext (qua cầu nối Extension) **gọi đúng cùng endpoint, cùng ngữ cảnh
trang, cùng cookie**. Khác biệt duy nhất là cây cầu — và chính nó bị tuần tự hoá (§18).
Không có rủi ro chức năng nào khi đặt API làm đường đầu.

**Thay đổi 1.91.92.** Nút đổi tên thành **`🛰 Toàn bộ qua HTTP (API→Ext)`**, **bật mặc định**
(chưa từng chỉnh ⇒ bật; người dùng tắt ⇒ lưu `0`). Thứ tự làn: `['api','ext']`, **không** Socket.

## §20 — Cờ `is_record_ctx_7_days` xoá sạch `(#10)` (v1.91.94)

Quét 303 `POST …/conversations/{id}/messages` trên 12 HAR, parse **multipart form-data**
(lần trước parse JSON nên tưởng cờ này hiếm — thực ra nó là field form).

| nhóm | có cờ | không cờ |
|---|---|---|
| `success:true` | **19** | **0** |
| `(#10) …ứng dụng khác kiểm soát thread` (`e_subcode 2018300`) | **0** | **24** |
| `(#551) Người này hiện không có mặt` | 5 | 4 |

Kết luận: `(#10)` **không** phải "app khác giữ thread" — đó là cách FB từ chối khi gửi vào
thread đã quá 24h mà không khai báo context. `is_record_ctx_7_days=true` mở cửa sổ 7 ngày.
`(#551)` là người dùng thật sự không tồn tại ⇒ không sửa được bằng cờ.

Hệ quả code: từ v1.91.80 script **luôn** gửi cờ (multipart `fd.append`, JSON `jsonBody`), nhưng
logic chọn làn vẫn giữ tiền đề cũ `textOutWin = idleLong && !isRecordCtx7Days(full)` ⇒ chat
ngoài 24h bị đẩy thẳng sang Ext. Đó là lý do lô 3 384 chat ghi `[API: 13 · Ext: 1 870]` và
96 làn HTTP đứng không. v1.91.94 vô hiệu hoá tiền đề đó: chat ngoài 24h vẫn thử API trước.
Cơ chế `alreadyTriedApi`/`dynamicDirect` lo fallback Ext khi API lỗi thật. Không gửi trùng.

## §21 — Vì sao API bị từ chối 1 952/1 958 mà Ext gửi được (cần dữ liệu mới)

Lô 09:10 (1.91.94, 1 958 chat): `[API: 6 · Ext: 1 148]`, và dòng chẩn đoán nền:

```
🌐 API NỀN: queued/started/fetch 1958/1958/1958 · OK/rejected 6/1952 · HTTP 200×1958 · fallback 1952
```

HTTP 200 nhưng `success:false` ⇒ FB/Pancake từ chối ở tầng ứng dụng, không phải mạng.
Cùng những chat đó Ext gửi được 1 148 ca ⇒ API và Ext KHÔNG tương đương trên thực tế, dù §19
chứng minh chúng cùng endpoint/cookie/origin.

`buildInboxSend` đã `fd.append('is_record_ctx_7_days','true')` **vô điều kiện** và nhánh JSON
cũng `jsonBody.is_record_ctx_7_days = true` ⇒ lý do từ chối **không phải** thiếu cờ.

Chưa đủ dữ liệu để kết luận. v1.91.95 thêm máy ghi request (`__botfakeSetRec__(true)`,
`__botfakeDumpRec__()`) để bắt **cặp trên cùng một chat**: request API thất bại + request Ext
thành công, kèm body/status/thời gian. Chỉ khi có cặp đó mới được sửa tiếp.

Điều đã biết chắc: trần hiện tại do làn Ext quyết định (~10–22 tin/s), và gate wave không
phải nút cổ chốt (500 tin/5,4 s ⇒ gate 92 tin/s so với thực 17,7 tin/s).

## §22 — SỬA SAI §20/§21: cờ ctx7 KHÔNG mở được cửa sổ 24h

`(#10)` có **hai** `e_subcode` khác nghĩa:

| e_subcode | Thông điệp | Cờ `is_record_ctx_7_days` |
|---|---|---|
| 2018300 | "một ứng dụng khác đang kiểm soát thread này" | có tác dụng |
| (window) | "Tin nhắn này được gửi **ngoài khoảng thời gian cho phép**" | **KHÔNG cứu được** |

§20 kết luận "cờ xoá sạch #10" là **sai vì nhiễu**: 19 ca "thành công + có cờ" trong HAR đều là
chat **trong** 24h ⇒ tương quan, không phải nhân quả. Log thật 09:15 chứng minh: chat ngoài 24h
bị `#10`-window hoặc `#551` từ API, sau đó **Extension gửi được ngay** lúc cờ vẫn đang được gửi.

Hệ quả đo được (cùng loại danh sách, cùng máy):

| bản | thứ tự làn | tốc độ |
|---|---|---|
| 1.91.93 | Ext trước | **20,77 tin/s** |
| 1.91.94 | API trước | 17,74 tin/s |
| 1.91.95 | API trước | **2,91 tin/s** |

Giá của "API đi trước" với chat ngoài 24h: `queue wait TB 1 218ms` + `fetch TB 1 067ms` cho
MỖI chat, rồi mới rơi về Ext (`rejected 311/312`, `fallback 311`). v1.91.96 revert: chat đã
ngoài 24h ⇒ Ext/Socket trước.

Kèm theo: `Ext timeout 12s → 7s`. Lô 09:16 có 30 ca "Ext quá hạn", kiểm chứng lịch sử chỉ
1 ca thật sự đến nơi ⇒ 12s chờ hầu như vô ích, nhưng 30 ca × 12s trên 24 làn đủ mở bộ ngắt
("12 lần liên tiếp không phản hồi") và pause cả làn 45s.

Trần hiện tại: làn Ext (~20–25 tin/s quan sát được ở cửa sổ 09:15:37–09:15:42). API không thể
thay thế cho chat ngoài 24h — đây là giới hạn của cửa sổ FB, không phải của code.

## §23 — Nâng thẳng làn Extension (v1.91.97)

Cơ sở: cửa sổ 09:15:37–09:15:42 của lô 312 chat có **hơn 100 tin ✅ trong 5 giây** ở 24 làn
⇒ ~20–25 tin/s ⇒ **~1 giây/lệnh**. Quan hệ tuyến tính theo số làn (đo được, không phải giả định):
48 làn ≈ 40–50 tin/s, 64 làn ≈ 55–65 tin/s.

| hằng số | cũ | mới |
|---|---|---|
| `BUS_PARALLEL_EXT` (khởi động) | 48 | **64** |
| `EXT_SEND_MIN` (sàn) | 24 | **48** |
| `EXT_SEND_MAX` (trần) | 64 | **96** |
| `EXT_SEND_BREAKER_THRESHOLD` | 12 | **30** |
| `EXT_SEND_BREAKER_BASE_MS` / `MAX_MS` | 15 000 / 45 000 | **8 000 / 15 000** |

Vì sao phải sửa kèm bộ ngắt: ngưỡng "12 lần không phản hồi liên tiếp" là con số đo cho 24 làn.
Ở 64 làn, cùng một tỉ lệ lỗi sinh ra chuỗi 12 dài gấp ~2,7 lần thường xuyên hơn ⇒ giữ nguyên
ngưỡng sẽ tự bóp làn liên tục. Đây chính là thứ đã xảy ra ở lô 09:16: ngắt mở 45s + thăm dò
30s, chỉ gửi được 226 tin trong 78s (2,91 tin/s) trong khi bản thân làn Ext chạy được 20–25 tin/s.

An toàn không đổi: lệnh đã bắn mà quá hạn **không bao giờ gửi lại** (chỉ ⚠ + kiểm chứng lịch
sử, nâng ⚠→✅). Nâng số làn không mở thêm bất kỳ đường gửi trùng nào.

## §24 — Ext không phản hồi ≠ gửi trượt (v1.91.98)

Lô 09:24 (1 457 chat, 1.91.97, làn Ext 48–96): `✅ 956 [API: 11 · Ext: 945] · 12,66 tin/s`,
`peak Ext queue/active 360/128`, và:

```
🧯 Ext quá hạn 114 · kiểm chứng thấy tin 69 · chưa thấy trong lịch sử 45
```

**69/114 (60 %) ca "Extension không phản hồi" thì tin ĐÃ đến nơi.** Nghĩa là Extension gửi
thành công nhưng không trả phản hồi về bridge. Chờ 7s cho phản hồi đó là giữ làn vô ích:
114 × 7s ÷ 48 làn ≈ 17 giây-làn.

HAR: ca lỗi thật trả về p50 **908 ms**, p90 **1 197 ms** ⇒ 2 500 ms đã phủ trên p99.
v1.91.98: `adapter.send` timeout **7 000 → 2 500 ms**. Ca quá hạn vẫn đi đúng đường cũ —
⚠ "không rõ" + `scheduleExtTimeoutVerify` (kiểm chứng lịch sử nền, chỉ nâng ⚠→✅, **không bao
giờ gửi lại**) — nên rút ngắn không tạo thêm bất kỳ khả năng gửi trùng nào.

Lưu ý về trần: `peak Ext queue/active 360/128` cho thấy hàng đợi 360 lệnh với 128 active —
làn Ext không còn là nút cổ chốt duy nhất, mà là băng thông thật của bridge Extension.

## §25 — Trần Extension là thật; trả mặc định về Socket để đo lại (v1.91.99)

Log 09:24 (làn Ext 48–96): `peak Ext queue/active 360/128` + `12,66 tin/s` ⇒ 360 lệnh xếp hàng,
128 đang bay, mỗi lệnh chiếm làn ~10 giây. **Tăng làn không tăng thông lượng** — bridge
Extension tuần tự hoá bên trong. Trần quan sát được của Extension qua 6 lô: **~12–21 tin/s**.
70–100 tin/s **không thể** đạt qua đường Extension.

Vì `ssb_force_ext` BẬT mặc định từ 1.91.92, làn Socket bị bỏ hẳn ⇒ **Socket chưa từng được thử
trên chat khoẻ**. Mọi dòng `📡 SOCKET: ACK 0/386` trong 6 lô là chat đã chết (chỉ còn lại sau
khi Ext trượt) — thiên lệch chọn mẫu. v1.91.99 trả `ssb_force_ext` về **TẮT mặc định** để đo lại
Socket trên chat khoẻ. Socket là kênh của chính Facebook, không qua bridge ⇒ đây là đường duy
nhất có thể đạt mức hàng nghìn tin/phút.

## §26 — Bỏ hẳn ô "Toàn bộ qua HTTP" (v1.92.0)

Theo yêu cầu: ô `#ssb-forceext` **bị xoá khỏi panel** (không chỉ mặc định tắt) và `forceExtMode`
**luôn = false**. Lý do kỹ thuật khớp với §25: bật chế độ đó đẩy cả lô vào trần ~12–21 tin/s
của bridge Extension, và từ 1.91.92 nó còn bỏ hẳn làn Socket. Không còn đường UI nào bật lại
⇒ một lần bấm nhầm không thể làm chậm cả lô. `__botfakeForceExt__(true)` vẫn còn trong console
để đo đối chứng khi cần.

## §27 — Socket là đường chính và ĐÃ ĐO ĐƯỢC (v1.92.1)

Lô 09:34 (1 432 chat, 1.92.0, `force_ext` tắt) — lần đầu Socket được thử trên chat khoẻ sau 7 lô:

```
📡 SOCKET: ACK OK/rejected/no-ACK 917/493/0 · ACK TB/max 1 199/2 760ms
✅ Đã gửi thành công 917/1 432 [Socket: 917]
⚡ 32,04 tin/giây (1 922/phút) · phát lệnh xong trong 24s  ⇒ 60 tin/s lúc phát
🌊 peak Socket/page active 192/192 · waiting 192/192
```

Kết luận: **Socket gửi được 917 tin.** Mọi dòng `ACK 0/386` trước đây là chat đã chết
(§25) — thiên lệch chọn mẫu, đã xác nhận.

Ba nút cổ chốt còn lại, đều thấy trong cùng dòng log:

| Hiện tượng | Thiệt hại | Sửa |
|---|---|---|
| `peak Socket/page active 192/192`, `waiting 192` | làn Socket bão hoà ở 192; ACK TB 1,2s ⇒ trần lý thuyết ~160 tin/s | `BUS_PARALLEL_SOCKET` 128→**256**, `SOCKET_LANE_MAX` 192→**384** |
| `bỏ qua lúc Ext quá tải 267` | 267 chat bị chặn Ext **bởi chính script**, mỗi chat chỉ được thử 1 lần/kênh ⇒ ❌ oan | `EXT_SEND_BREAKER_THRESHOLD` 30→**150** |
| `Ext quá hạn 65 · kiểm chứng 0` | không mất tin (kiểm chứng xác nhận chưa đến) | giữ timeout 2,5s |

Kèm một lỗi thật: `SOCKET_LANE_MAX` được khai báo **sau** khối đọc
`localStorage['botfake_sock_page_floor']` ⇒ mọi phép so sánh với nó ném TDZ, bị `catch` nuốt,
nên **sàn đặt qua localStorage âm thầm không có tác dụng**. Đã chuyển khai báo lên trước.

## §28 — Đo ACK Socket trực tiếp từ HAR (v1.92.2)

Decode base64 → Thrift/LS của `_webSocketMessages` trong 3 HAR, ghép `request_id` giữa
`/ls_req` (gửi) và `/ls_resp` (ACK):

| HAR | khớp | p50 | p90 | max | gap 2 lệnh gửi |
|---|---|---|---|---|---|
| batmesss | 13/14 | **234 ms** | 256 ms | 300 ms | p50 1 414 · min 0 |
| guisot | 26/27 | **326 ms** | 390 ms | 1 531 ms | p50 1 201 · min 0 |
| guikhachcu | 2/5 | 414 ms | 354 ms | 474 ms | p50 32 · min 0 |

Frame gửi tin (guisot) có dạng: `otid`, `send_type`, `source: 4456448`, `sync_group: 205`,
`text`, `mark_thread_read` — **không có `thread_fbid` trong payload** (định tuyến qua task queue).

Hai kết luận dùng được:

1. **ACK về sau ~0,3s**, không phải 2,5–7,5s. Code cũ `ackWaitMs = max(2500, p90×3)` giữ slot
   rất lâu ⇒ lô 09:34 chỉ phát 60 tin/s dù có 192 làn (mỗi lệnh ~3,2s). v1.92.2 đặt
   `ackWaitMs = clamp(3×p90, 1 200, 3 000 ms)`.
2. **~5% request không có `/ls_resp`** (1/14, 1/27) ⇒ ca no-ACK là có thật, phải xử lý bằng
   kiểm chứng lịch sử nền (chỉ nâng ⚠→✅, không gửi lại), không phải bằng cách giữ làn lâu.

`min 0ms` giữa hai lệnh gửi ⇒ FB không cần nhịp; không cần thêm gap nhân tạo.

## §29 — Quét lại TOÀN BỘ 12 HAR (11 lượt kiểm, mọi entry)

### 29.1 Kiểm kê file

| file | entries | pageIds |
|---|---|---|
| batmesss | 348 | **11 page** (448189508385420, 578746295327894, 675541385634278, 689375157595846, 694078980461601, 764740356715221, 769625892902516, 797813096755447, 834072796450267, 881264518397934, 898735919982398) |
| guianh1 | 37 | 834072796450267 |
| guicau | 284 | 435021089689053 |
| guikhachcu | 275 | 881264518397934 |
| guisot | 170 | 898735919982398 |
| loaddanhsach | 50 | 694078980461601 |
| loadnhanh | **735** | 881264518397934 |
| pancake.vn2 | 58 | (1 page, không rõ id) |
| taidanhsach | 100 | 435021089689053 |
| tinnhan | 216 | 834072796450267 |
| tinnhan1 | 31 | 435021089689053 |
| tinnhanthread | 93 | 578746295327894 |

Host: `pancake.vn` 1 762 · `content.pancake.vn` 560 · **`graph.facebook.com` 25** · google-analytics 42 ·
`wss:` 3 · `statics.pancake.vn` 2 · `fonts.googleapis.com` 1.
⇒ Đúng **một** host thật sự phục vụ gửi tin là `pancake.vn`; `graph.facebook.com` chỉ 25 request và
tất cả là `GET /{id}/picture` (avatar). **Không có** request GraphQL/`api/graphql` nào ⇒ trình duyệt
KHÔNG tự gửi tin qua Facebook; mọi đường gửi đều qua `pancake.vn` hoặc WebSocket `edge-chat`.

### 29.2 Endpoint thật (theo tần suất)

| method | path | n | vai trò |
|---|---|---|---|
| GET | `/api/v1/pages/{p}/avatar/{id}` | 537 | avatar |
| POST | `/api/v1/pages/{p}/contents/facebook` | **164** | **upload ảnh → trả `fb_ids`** (attachment_id) |
| GET | `/api/v1/pages/{p}/conversations` | 100 | tải danh sách |
| POST | `/api/v1/pages/{p}/conversations` | 87 | tải danh sách (phân trang) |
| GET | `/pos-api/.../customers/check_first_order` | 50 | POS |
| POST | `/api/v1/pages/{p}/check_inbox` | 33 | `{"success":true}` **33/33** |
| POST | `/api/v1/pages/{p}/conversations/{c}/messages` | 303 | **gửi tin** |
| GET | `/api/v1/pages/{p}/conversations/{c}/messages?customer_id=…&user_view=true&is_new_api=true&separate_pos=true` | 217 | đọc lịch sử |
| POST | `/api/v1/pages/{p}/customers/{id}/update_global_id` | 7 | lưu gid |
| POST | `/api/v1/conversations` | 13 | tải danh sách |

`contents/facebook`: body `conv_id` (161) + `urls` (155) + `content_ids` (9) → response
`{"success":true,"fb_ids":["1761420001631103"]}` (nhiều ảnh ⇒ nhiều fb_ids trong 1 lần).
⇒ đây là cách app lấy `attachment_id` **theo từng conv**, không cần dò từng chat.

### 29.3 Bảng mã lỗi đầy đủ trong 12 HAR

| mã | thông điệp | n |
|---|---|---|
| — | `{"error_code":429,"message":"Too many requests","success":false}` | **73** |
| 10 | `(#10) …một ứng dụng khác hiện đang kiểm soát thread này` | 24 |
| 551 | `(#551) Người này hiện không có mặt.` | 11 |
| — | `{"success":false}` (rỗng lý do) | 4 |
| — | `{"existed":false,"message":"Hội thoại này không tồn tại"}` | 2 |

**429 rơi 100 % vào endpoint DANH SÁCH** (41 `POST /conversations`, 32 `GET /conversations`),
**0 lần** vào `POST /messages` ⇒ đường gửi tin không bị 429; chỉ khâu tải danh sách bị.

`check_inbox` trả `success:true` **33/33** ⇒ không phải cổng chặn, đúng như đã kết luận.

`update_global_id` body thật: `{"global_id":"…","conversation_id":"…","source":"send_inbox","version":1}`
— khớp code (dòng ~4299).

### 29.4 Socket: op và payload

`ls_*` xuất hiện: `ls_req` (46 send) · `ls_resp` (96 receive, 3 send) · `ls_app_settings` (3) ·
`ls_foreground_state` (3).

Payload gửi tin (task `label 46`) — **đủ 7 field**, khớp 1:1 với code hiện tại:

```json
{"mark_thread_read":1,"otid":"7522294945565959207","send_type":1,
 "source":4456448,"sync_group":205,"text":"…","thread_id":"…"}
```

Request **không có** `/ls_resp`: guikhachcu 3 · batmesss 1 · guisot 1 ⇒ **~5 %**, có thật.

### 29.5 Độ trễ server (timings.wait)

| endpoint | n | p50 | p90 | max |
|---|---|---|---|---|
| `POST …/messages` | 279 | **24 ms** | 916 ms | 6 647 ms |
| `GET …/messages` (lịch sử) | 217 | **43 ms** | 132 ms | 2 701 ms |

⇒ **Kiểm chứng lịch sử chỉ tốn ~43 ms**, rẻ hơn nhiều so với giả định trước (900 ms).

### 29.6 Việc rút ra được (đã áp dụng)

1. ACK Socket p50 234–326 ms ⇒ `ackWaitMs` clamp 1 200–3 000 ms (v1.92.2).
2. `GET /messages` p50 43 ms ⇒ nới `SOCK_VERIFY_PARALLEL` 12 → 32 (v1.92.3): kiểm chứng nền
   rẻ, và ca no-ACK ~5 % được chốt nhanh hơn. Thuần đọc lịch sử, chỉ nâng ⚠→✅, không gửi lại.
3. Code Socket payload / history GET / update_global_id **khớp HAR** — không cần sửa.

### 29.7 Giả thuyết cần kiểm nhưng CHƯA đủ bằng chứng

- `batmesss.har` có **11 page** trong một phiên ⇒ nếu shop chạy nhiều page thì token/phiên theo page
  có thể là lý do một số ca API trả `#551`/`#10` trong khi Ext/Socket gửi được. Chưa có bằng chứng
  trực tiếp, KHÔNG sửa gì dựa trên giả thuyết này.

## §30 — Lô 09:44 (3 653 chat) + 09:45: làn Socket bị khoá ở sàn

### 30.1 Số liệu

| lô | chat | thời gian | chốt | thành công | kênh |
|---|---|---|---|---|---|
| 09:44 | 3 653 | 98 s | 37,32/s | 23,61/s | **`[Socket: 2 311]`** |
| 09:45a | 143 | 6 s | 22,23/s | **22,23/s (100 %)** | `[API: 128 · Socket: 15]` |
| 09:45b | 17 | 4 s | 4,18/s | **100 %** | `[API: 15 · Socket: 2]` |

```
📡 SOCKET ACK OK/rejected/no-ACK 2 311/1 261/3 · ACK TB 1 448ms · buckets 1-2s = 2 921
🌊 peak Socket/page active 384/384 · waiting 192/192 · Socket/page limits cuối [64×1]
```

### 30.2 Nguyên nhân làn tụt 384 → 64

`noteSocketPageLaneOutcome` tăng làn +8 mỗi **20 ca `fastOk`**, nhưng code cũ xoá `ctl.fastOk = 0`
cho **cả `rejected`**. Lô có 1 261/3 572 ca bị FB từ chối (35 %) ⇒ bộ đếm liên tục bị xoá,
**không bao giờ đạt 20** ⇒ làn chỉ nhận các nhịp giảm 0,8×, trôi về sàn 64 và nằm đó.
Đó là lý do phát lệnh ~37 tin/s dù ACK TB 1 448 ms (lý thuyết 384 ÷ 1,45 ≈ 265 tin/s).

v1.92.4: `rejected` **không** xoá bộ đếm, và nếu FB trả lời < 2 500 ms thì tính là một ca tốt
(kênh ACK đang sống, khác hẳn no-ACK).

### 30.3 Ext đóng góp 0 tin — hai lô liên tiếp

`[Socket: 2 311]` và `[API: 128 · Socket: 15]`: **không có `Ext:` nào**. Lô 09:44 có
`Ext quá hạn 225 · kiểm chứng thấy tin 0`, tức 225 ca bị đẩy sang Ext rồi chờ 2,5 s và không
cứu được ca nào. Chưa đủ để kết luận "Ext vô dụng" (mẫu 2 lô, và Ext chỉ nhận toàn ca Socket
đã từ chối), nhưng nếu lô sau vẫn 0 thì nên cắt đoạn đuôi này để lấy lại thời gian.

### 30.4 Bất thường CHƯA giải thích: API chậm hơn HAR 50–70 lần

| đo | p50 | TB |
|---|---|---|
| HAR `POST …/messages` | **24 ms** | 212 ms |
| Lô 09:45a (143 chat, API xong 128/128) | — | **fetch TB 1 766 ms · max 4 686 ms**, queue wait TB 1 330 ms |
| Lô 09:45b (17 chat) | — | fetch TB 1 320 ms · max 3 876 ms |

Cùng endpoint, cùng cookie, cùng máy. Chưa có lời giải thích có bằng chứng ⇒ **không sửa gì**
dựa trên nghi ngờ này; chỉ ghi nhận để đo tiếp.

---

## §31 — Đọc sâu 20 lượt (v1.92.5 → v1.92.6)

### 31.1 Vì sao `retry lần 0` KHÔNG phải làn bù chết

Đọc hết chuỗi: `pushToSocketRetry` → `pendingSocketCoolCount` → `runSocketRetryWorker` (96 worker,
`WAVE_SOCKET_RETRY_WORKERS = 96`). Worker có tăng `sendDiag.sockRetry++` (dòng ~8325). Chuỗi defer
`deferredToSocketRetry` được truyền đủ 3 tầng (sendViaSocket:4376 → sendOne:6193 → sendOneAndLog:8095
→ runMainItem:8455). **Không có chỗ nào nuốt kết quả.**

Nhưng điều kiện vào làn bù là:

```js
if (raw.kind === 'rejected' && ctx.wave200Mode && !ctx.isSocketRetryPass
    && !ctx.gidFromPsid && !ctx.socketRetriedOnce && !ctx.apiRejected551)
```

Chat có `ctx.gidFromPsid === true` bị **loại khỏi cả hai** nhánh retry (làn bù và bắn-lại-tại-chỗ).
Lý do lịch sử là đúng: gid lấy từ psid có thể sai, bắn lại cùng gid là vô ích. Nhưng hệ quả là
những ca đó rơi thẳng xuống `raw.kind === 'rejected'` cuối hàm (dòng ~4466) → trả lỗi thường →
`sendOne` thử kênh kế tiếp = **Extension**. Run 09:44 có **442 ca "HTTP không có gid"** đi đúng
đường này. Đó là nguồn của đuôi Ext 225 ca, và cũng là lý do `retry lần 0`.

### 31.2 Nguyên nhân thật của "Ext 0 thắng": timeout bị cắt quá tay

Hai lần chạy cùng cơ chế, chỉ khác hằng số timeout:

| lần chạy | timeout | Ext quá hạn | kiểm chứng **thấy tin** |
|---|---|---|---|
| 09:24 · 1 457 chat | 7 s | 114 | **69 (60 %)** |
| 09:44 · 3 653 chat | **2,5 s** | 225 | **0 (0 %)** |

Cơ chế: lệnh Ext nằm trong hàng đợi cầu nối (peak 360). Timeout 2,5 s bắn **trước khi lệnh kịp
chạy** ⇒ không có gì để kiểm chứng ⇒ "thấy tin 0". Ở lần 09:24, lệnh kịp chạy, tin đến nơi, chỉ
phản hồi về muộn ⇒ 60 % cứu được.

**Kết luận: 2,5 s là false economy.** Nó không cứu thêm ca nào mà biến 60 % ca "quá hạn" thành
mất trắng, đồng thời kích `extSendLane.setLimit(×0,6)` liên tục → làn Ext sụp về sàn.

### 31.3 Sửa: timeout Ext suy từ số đo (v1.92.6)

```js
function extTimeoutMs() {
  const p90 = extLatP90();                       // vòng 24 mẫu ca CÓ phản hồi
  const want = p90 > 0 ? p90 * 3 : 7000;         // chưa có mẫu ⇒ 7 s (mức đã đo có 60 % đến nơi)
  return Math.min(9000, Math.max(2500, Math.round(want)));
}
```

- Ca **quá hạn không được** đưa vào mẫu (số liệu bị cắt cụt, đưa vào sẽ tự ru ngủ chính nó).
- Ext trả nhanh ⇒ tự siết về 2,5 s; Ext ì ⇒ tự nới, trần 9 s.
- Dòng chẩn đoán mới: `· Ext p90 <x>ms → timeout <y>ms` — lần chạy sau đọc được ngay.
- `EXT_VERIFY_DELAY_MS` giữ 20 000 (dư >11 s so với trần 9 s ⇒ kiểm chứng không bao giờ chạy
  trước khi lệnh Ext kết thúc).

**Không thể sinh tin trùng:** timeout chỉ đánh ⚠ + `scheduleExtTimeoutVerify`; đọc lại toàn bộ
khối đó chỉ có `markDelivered`, **không có một lời gọi gửi nào** (đã kiểm từng dòng, lượt 18).

### 31.4 Xác nhận từ bundle app thật

`_app-9331d46f21a84eb1.v6.js`:

```js
let y = findAllBlockActions(step,"replaceOptimsiticMessage"),
    b = findAllBlockActions(step,"markOptimisticMessageFailed");
if (b.length > 0 && y.length === 0) return { success:false, sendBy:"socket", response:_ };
```

⇒ App cũng **thất bại ngay**, không có retry ẩn, không có phép thuật gid. Hành vi của mình là
đúng app. Đừng đi tìm "đường tắt" nữa — không có trong code của chính Pancake.

### 31.5 Đã kiểm và KHÔNG có lỗi (ghi lại để khỏi kiểm lại)

| nghi vấn | kết luận |
|---|---|
| rò `extSendPermit` khi timeout | Không. `releaseExtSendPermit` chỉ nhả cờ thăm dò; slot do làn tự quản |
| TDZ vì `extLatP90` khai báo sau chỗ dùng | Không. Cùng pattern `extSendLane`: chỉ gọi lúc chạy, không lúc init |
| `sleep(12000)` chặn đường gửi | Không. Toàn bộ là trần `Promise.race` cho init Socket |
| `innerHTML` chèn dữ liệu server | Không. 4 chỗ có nội suy đều từ dữ liệu nội bộ đã xử lý |
| prune cache unavailable | Đúng thiết kế: 40 % khoá, ≤1 lần/60 s |

---

## §32 — Hai HAR mới tải lên `main` (1gg.har, 2gg.har)

### 32.1 `1gg.har` — HỎNG, không dùng được

File dừng đúng ở **byte 100 000** (`Unterminated string in JSON at position 100000`).
Chỉ có **3 entry**, entry đầu là một `stylesheet` với khối CSS khổng lồ chiếm trọn 100 KB.
**0 lời gọi API, 0 frame WebSocket.** Cần tải lại (hoặc chia nhỏ) mới đọc được.

### 32.2 `2gg.har` — hợp lệ: đây là lúc app DỰNG danh sách hội thoại, không phải lúc gửi

| chỉ số | giá trị |
|---|---|
| entries | 647 trong **10,1 giây** (03:16:02 → 03:16:12 UTC) |
| status | **200 × 647** — không một lỗi, **không một 429** |
| `POST /messages` | **0** |
| frame WebSocket | **0** (bản export không bật WS) |

| endpoint | n |
|---|---|
| `POST /api/v1/pages/{p}/contents/facebook` | 326 |
| `POST …/conversations/{id}/messages/fill_admin_name` | 315 |
| `GET …/conversations/{id}/messages` | 4 |
| `POST …/customers/{id}/update_global_id` | 2 |

⇒ Đây là app render ~315 dòng hội thoại: mỗi dòng gọi `fill_admin_name` + resolve ảnh qua
`contents/facebook`. **Không có thông tin gì về đường gửi tin.** Nhưng có 3 số đo rất giá trị:

**1. Pancake chịu được 64 request/giây.** 647 request trong 10,1 s, toàn 200, không 429.
Khẳng định "Pancake throttle khi bắn nhiều" là **sai** với endpoint nội dung. 429 chỉ rơi vào
endpoint danh sách (đã ghi ở §29).

**2. `contents/facebook` = bộ phân giải ảnh theo `conv_id`, không phải theo khách.**

```
body : {"content_ids":"[\"1adec15a-…\"]","conv_id":"881264518397934_28142484778760027"}
resp : {"success":true,"fb_ids":["1792719841809264"]}
```

326/326 `success:true`, `fb_ids` **luôn khác rỗng**, `timings.wait` p50 **53 ms** / p90 202 / max 538.
Lưu ý `content_ids` là **chuỗi JSON lồng**, không phải mảng — nếu sau này dùng phải
`JSON.stringify` lần hai. Đây vẫn là đường ảnh, không phải global_id ⇒ giữ nguyên mức ưu tiên
thấp như §29.2 (các lô gần đây chỉ gửi chữ).

**3. `global_id` dạng PSID là HỢP LỆ.** Hai lệnh `update_global_id` được server nhận (200) với:

```
{"global_id":"100087887237372", …}   ← dạng FB-scoped
{"global_id":"61552937716477",  …}   ← dạng PSID (15 chữ số)
```

Điều này bác bỏ giả định ngầm rằng "gid lấy từ psid là đáng ngờ nên không cho vào làn bù"
(§31.1). Pancake chấp nhận cả hai dạng ⇒ việc loại `gidFromPsid` khỏi **cả hai** nhánh retry
là phòng xa quá mức, và chính nó đẩy 442 ca sang Extension. **Chưa sửa** vì cần một lô có đo
`Ext p90` mới để so; nhưng đây là ứng viên số 1 cho lô sau.

### 32.3 §30.4 — bí ẩn "API chậm 50–70×" đã có lời giải hợp lý

So sánh cũ là sai đơn vị đo:

| nguồn | đo cái gì | số |
|---|---|---|
| HAR `timings.wait` | chỉ thời gian **server** xử lý | p50 24 ms |
| `sendDiag.apiFetchMs` | trọn `fetch()`: **xếp hàng trình duyệt + kết nối + server + nhận** | TB 1 766 ms |

Bằng chứng: ngay trong lần chạy của chính app (2gg, tải rất nhẹ), `timings.blocked` p50 **130 ms**
/ p90 371 ms — tức **thời gian xếp hàng phía trình duyệt còn lớn hơn cả `wait`**. `fetch()` tính
cả phần đó, HAR `wait` thì không.

Thêm nữa: làn API của mình đặt `API_SEND_PARALLEL = 96`, tức tối đa **96 POST cùng lúc lên một
host**; app thật khi render danh sách chỉ bắn ~64 request/giây với độ song song thấp. Càng nhiều
luồng đồng thời, phần `blocked` càng phình ⇒ fetchMs càng lớn, dù server vẫn trả trong vài chục ms.

**Kết luận:** §30.4 nhiều khả năng là **thời gian xếp hàng phía client**, không phải Pancake chậm.
Chưa đủ để kết luận dứt điểm, nên v1.92.7 thêm số đo `fetch p50` (vòng 64 mẫu) vào dòng chẩn đoán:
- nếu `p50` **nhỏ** mà `TB` lớn ⇒ chỉ vài request kẹt (đuôi), server vẫn khoẻ;
- nếu `p50` **cũng lớn** ⇒ nghẽn thật, lúc đó mới hạ `API_SEND_PARALLEL`.

TB một mình không phân biệt được hai ca này — đó là lý do phải thêm p50 trước khi sửa gì.

---

## §33 — Lô 10:17 (8 419 chat, v1.92.6-W200.48) — chốt: ỔN, không sửa thêm

| chỉ số | giá trị | so với tốt nhất trước đó |
|---|---|---|
| thời gian | 211 s tổng · 179 s phát lệnh | — |
| chốt | **39,86/giây (2 392/phút)** | 1.92.3: 37,32 (2 239) |
| thành công | **6 043 (71,8 %) · 28,61/giây (1 717/phút)** | 1.92.3: 23,61 (1 417) |
| kênh | `[API: 50 · **Ext: 245** · Socket: 5 748]` | 1.92.3: `Ext 0` ×3 lô |

### 33.1 Hai bản sửa đều có tác dụng đo được

**a) Timeout Ext động (v1.92.6) — cứu được đúng thứ nó nhắm tới.**
Dòng chẩn đoán mới: `Ext p90 1858ms → timeout 5574ms`. Timeout tự nới từ 2,5 s lên **5,57 s** theo
số đo, và Ext **thắng 245 ca** — chấm dứt chuỗi **3 lô liên tiếp 0 thắng**. Kết luận §31.2 đúng:
2,5 s cố định là thứ giết làn Ext, không phải "Extension chết".

**b) Sửa khoá sàn làn Socket (v1.92.4) — giữ được.**
`Socket/page limits cuối [192×1]`, `peak 256/256`. Trước đây cùng cảnh này kết ở `[64×1]`.

### 33.2 Điều log này BÁC BỎ

`🧭 HTTP không có gid` chỉ **4** (lô 09:44 là **442**). Nên con số 442 hôm trước là đặc thù của
danh sách đó, **không** phải tỉ lệ cố hữu — càng ít lý do để đụng vào nhánh `gidFromPsid`.

### 33.3 Điều vẫn còn treo (ghi lại, KHÔNG sửa vì người dùng đã chốt tốc độ là ổn)

- `📡 ACK OK/rejected/no-ACK 5748/1799/139` — 1 799 ca FB từ chối, và **2 055 ID mới** bị ghi nhớ
  "Socket confirmed-unavailable", nâng tổng lên **6 753**. Đây là danh sách **bỏ qua lâu dài**
  (chỉ tự xoá khi tải/chọn lại danh sách). Nếu có khách *đáng lẽ gửi được* mà bị bỏ qua, nguyên
  nhân nằm ở đây — không phải ở đường gửi.
- `🧯 Ext quá hạn 261 · kiểm chứng thấy tin 0 · chưa thấy 261` — vẫn y hệt cơ chế §31.2 nhưng
  ngược chiều: 261 ca này timeout rồi mà **không ca nào** để lại dấu vết trong lịch sử.
- `retry lần 0` — vẫn đúng như §31.1 (đường defer không đi qua bộ đếm này).
- `🌐 API NỀN queue wait TB/max 3/33ms` nhưng `fetch TB/max 1826/5875ms` ⇒ §30.4 **không phải**
  thời gian xếp hàng của làn mình; phần chậm nằm **bên trong `fetch()`**. Chưa cần biết thêm vì
  API chỉ chiếm 50/8 419 ca.

---

## §34 — Quét 50 lượt phần chưa từng đọc (v1.92.7)

### 34.1 Các file trước đây chưa ai đọc — kết luận

| file | dung lượng | thực chất là gì | giá trị |
|---|---|---|---|
| `html.txt` / `html2.txt` / `html3.txt` / `html comment list` | 5,3 MB | DOM đã render của Pancake, chỉ có 1 `__NEXT_DATA__` rỗng | **0** — không có `ls_req`, `can_inbox`, `send_by_platform`, `global_id`, `conv_id` |
| `dashboard-fa168c408c705d9e.v6.js` | 60 KB | webpack chunk CSS/trang cài đặt | **0** |
| `taodon` | 70 KB | DOM bảng đơn hàng | **0** |
| `BOTFAKE FULL` + `BOTFAKE.TXT` | 708 KB | **bản trùng nhau** của userscript 1.90.4 (`diff` = **0 dòng**, chỉ khác CRLF) | chỉ để đối chiếu lịch sử; **giữ 1 là đủ** |
| `download` | 105 B | ghi chú đường dẫn khoá ký | — |
| `MESSAGE POST`, `post`, `lại là POST` | 22 KB | 3 lệnh `curl` chụp tay | **có** (34.2–34.3) + **có JWT** (34.6) |

### 34.2 Hợp đồng body gửi tin — nay có nguồn thứ 3 xác nhận

Chụp `curl` một lần gửi thật của app, phần `multipart/form-data`:

```
action           = reply_inbox
message          = <nội dung>
send_by_platform = web
```

**Chỉ 3 trường**, không `is_record_ctx_7_days`, không `global_id`, không `send_type`.
Khớp 1:1 với `buildInboxSend` của mình (nhánh văn bản) và với suy luận §31.3.

### 34.3 Endpoint có trong bản chụp mà docs chưa ghi

| endpoint | body | khi nào |
|---|---|---|
| `POST /api/v1/pages/{p}/contents/touch` | `{"content_ids":[]}` | app đánh dấu nội dung đã dùng |
| `GET /api/v1/pages/unread_conv_pages_count` | — | đếm hội thoại chưa đọc |
| `POST /api/v1/logs/pancake_exception_log` | `{"payload":"TypeError: …"}` | app tự ghi lỗi của chính nó |
| `POST /api/v1/pages/{p}/customers/update_global_id` | **`{"global_ids":[…]}`** | **dạng BULK** — §29 trước đây chỉ ghi dạng từng khách |

`check_inbox` trong code app: chỉ gọi **SAU khi gửi thành công** (`if(i.success && !form && !repliedMessage)`)
như một side-effect, không dùng để quyết định gì ⇒ quyết định **không dùng `check_inbox` làm tín hiệu
bỏ qua** là đúng.

### 34.4 Sự thật về "Extension" — không phải extension của mình

```js
if(!window.__ExtensionAdapter__){ … window.__ExtensionAdapter__=h, t.Z=h }
```

`__ExtensionAdapter__` do **chính bundle của Pancake** gán. Trong repo mình **không file nào** định
nghĩa nó (`extension/*.js` chỉ làm overlay + jobs + fetch nền). Nghĩa là nhánh "Ext" = adapter của
**extension Pancake chính chủ** — một đường ống phía trình duyệt, một phiên FB duy nhứt ⇒ **không bao
giờ** mở rộng được như làn socket của mình. Đừng kỳ vọng Ext thành đường chính.

**Timeout chờ ACK của app:** `let b=3e4` (30 000 ms) cạnh `class k{async initSocket}`; `publish()` dùng
`PENDING_MESSAGES[pageId+"_"+requestId]` + `setTimeout(…, b)`. Của mình clamp 1,2–3 s — cố ý, và lô
10:17 chỉ có **139/7 686** ca no-ACK (1,8 %). Tham số thứ 4 của `publish` là **`type`** (2/3), không
phải timeout.

Bundle **không** chứa `#551`, `2018300` hay `HUMAN_AGENT` ⇒ client không có đường đặc biệt nào; mọi
phán quyết nằm ở server Pancake/FB.

### 34.5 localStorage — đủ 17 khoá, không còn khoá mồ côi

Toàn bộ khoá đều đi qua hằng số (không phải chuỗi literal) nên lần quét trước tưởng "chỉ ghi".
Kiểm lại: **mọi khoá đều có chỗ đọc**; `ssb_force_ext` đã biến mất hẳn từ v1.92.5.
Rủi ro còn lại: `ssb_last_sent_v1` (ảnh chụp lô vừa gửi) **không cắt bớt** — lô 8 419 chat là ~1,5 MB.
Khi đầy, `persistUnavailableConversationId` rơi vào `pruneUnavailableKeys` (xoá 40 %, tối thiểu 50 khoá,
≤1 lần/60 s) nên không mất dữ liệu im lặng.

### 34.6 🔴 BẢO MẬT — JWT còn hạn nằm trong repo CÔNG KHAI

`gh api repos/chongoan4444/BOTFAKE-REWORK` → `"private": false, "visibility": "public"`.

Ba file được git theo dõi chứa cookie `jwt=eyJ…` (không in giá trị ở đây):

| file | payload đọc được (không có chữ ký) |
|---|---|
| `MESSAGE POST` | `exp` **2027-01-07T02:57:17Z**, `uid` `299666bd…` |
| `post` | y hệt |
| `lại là POST` | y hệt |

⇒ Bất kỳ ai đọc repo đều lấy được phiên Pancake của tài khoản đó tới tháng 1/2027.
**Đã xoá 3 file khỏi nhánh này**, nhưng **lịch sử git vẫn còn** ⇒
**BẮT BUỘC** đăng xuất/đổi mật khẩu tài khoản đó để vô hiệu token cũ; xoá file không đủ.

---

## §35 — Đọc 11 HAR còn lại, từng request (v1.92.7)

### 35.1 Mỗi file một việc — không còn file nào chưa mở

| HAR | req | khoảng | WS | `POST /messages` | thực chất là gì |
|---|---|---|---|---|---|
| `batmesss.har` | 348 | 146 s | **118** | 18 | gửi + ACK (nguồn §28) |
| `tinnhanthread.har` | 93 | 314 s | 0 | **24** | **24 lần gửi HỎNG vào CÙNG một thread** |
| `tinnhan.har` | 216 | 54 s | 0 | 13 | gửi thật: 11 OK · 2 × `#551` |
| `guianh1.har` | 37 | 41 s | 0 | 2 | **gửi ảnh**: 2 lần, cả 2 `#551` |
| `guisot.har` | 170 | 28 s | **96** | 1 | gửi + ACK |
| `guikhachcu.har` | 275 | 29 s | 11 | 0 | duyệt khách cũ (recent_orders, customer_info) |
| `guicau.har` | 284 | 13 s | 0 | 0 | **chỉ dựng danh sách** (155 `contents/facebook` + 129 `fill_admin_name`) |
| `loadnhanh.har` | 735 | **11 s** | 0 | 0 | cuộn danh sách rất nhanh: 58 `GET /conversations` + 241 avatar trong 11 s |
| `loaddanhsach.har` | 50 | 32 s | 0 | 0 | 38 `GET /conversations` |
| `taidanhsach.har` | 100 | 28 s | 0 | 0 | **87 `POST /conversations`** = phân trang danh sách |
| `pancake.vn2.har` | 58 | 86 s | 0 | 0 | 36 `POST /g/collect` + 11 `POST /conversations` |

### 35.2 Ba hình dạng response của `POST /messages` — HTTP luôn 200

```json
THÀNH CÔNG : {"id":"m_WEqNIb…","success":true,"original_error":null}
#10        : {"e_code":10,"e_subcode":2018300,
              "message":"(#10) Không gửi được tin nhắn do một ứng dụng khác hiện đang kiểm soát thread này.",
              "success":false}
#551       : {"e_code":551,"e_subcode":1545041,
              "message":"(#551) Người này hiện không có mặt.","success":false}
```

⇒ Ai kiểm tra `response.ok` (HTTP) sẽ coi cả hai lỗi là **thành công**. Phải đọc `success` /
`e_code`. Code mình đọc đúng.

`#551` xuất hiện cho **cả tin chữ lẫn tin ảnh** (`guianh1`: gửi ảnh → `#551`; gửi chữ ngay sau →
`#551`) ⇒ đây là trạng thái **tài khoản người nhận**, không liên quan định dạng tin.

### 35.3 Cờ `is_record_ctx_7_days`: KHÔNG phải nguyên nhân thành công

Census **từng request** trên cả 11 HAR (không phải suy luận):

| cờ | kết quả | n |
|---|---|---|
| **0** | `#10` | 24 |
| **0** | `#551` | 6 |
| **0** | **`success:true`** | **4** ← mấu chốt |
| **1** | `#551` | 5 |
| **1** | `success:true` | 19 |

Bảng cũ trong `README.md` (§v1.91.73) kết luận *"(#10) phần lớn là do thiếu cờ"* dựa trên 19/19 vs
24/24. Nhưng **4 ca gửi THÀNH CÔNG mà không có cờ** ⇒ cờ **không bắt buộc**. Cách đọc đúng hơn:
cờ là **dấu hiệu thread còn tươi** (`dr()` đúng), và `#10` rơi vào thread cũ/đang bị phiên khác giữ —
tương quan, không nhân quả.

Đây là căn cứ cho thay đổi **v1.92.5** (chỉ gửi cờ khi `dr()` đúng, đúng như app). Lô 10:17 chạy
theo cách đó: API **50 OK / 55**, tức không hồi quy. Nếu sau này API tụt bất thường thì đảo lại chỉ
là 1 dòng.

`tinnhanthread.har` còn cho thấy: 24 ca `#10` đều vào **cùng một thread**, cách nhau **0,0–0,1 s** ⇒
có khả năng thứ hai: FB từ chối khi bắn dồn dập cùng một thread. Script mình không bao giờ ở tình
trạng đó (mỗi chat một lần một lượt, `SOCKET_MIN_PACE_MS = 4`).

### 35.4 Hợp đồng gửi ẢNH — khớp 100 % code mình

`guianh1` cho thấy app làm đúng thứ tự: `contents/facebook` (uuid → fb_id) **rồi** mới gửi.

```json
{"action":"reply_inbox","message":"",
 "content_ids":["4a52fa57-…","9216a540-…"],
 "attachment_ids":["1697243988205742","913682618480798"],
 "content_urls":["https://content.pancake.vn/2-2608/2026/8/16/…jpg","…"],
 "dimensions":[{"width":1505,"height":2007},{"width":963,"height":1634}],
 "send_by_platform":"web"}
```

Sau khi gửi, app gọi `check_inbox` + `contents/touch` với đúng các `content_ids` đó (side-effect).
`attachment_ids` chính là `fb_ids` trả về từ `contents/facebook` ⇒ nhánh ảnh của mình đúng.

### 35.5 Danh sách hội thoại — đường dữ liệu cho bài toán "chưa nhắn"

`POST /api/v1/pages/{p}/conversations?unread_first=true&mode=OR&tags=%22ALL%22&except_tags=%5B%5D`
body `type=ALL` → **40 hội thoại/trang**, response **base64 hoá** (`content.encoding: "base64"`).

Mỗi hội thoại có đủ: `id`, `thread_id`, `thread_key` (`t_…`), `from_psid`, `customers[].fb_id`,
`updated_at`, `message_count`, **`last_sent_by`**, `snippet`, `last_customer_interactive_at`.
Trong 1 680 hội thoại duy nhất của `taidanhsach.har`: **100 % có `thread_id` + `thread_key` +
`customers[0].fb_id`** ⇒ nếu cần global_id thì dữ liệu danh sách đã có sẵn, **không cần request
từng chat**.

`last_sent_by.id === from_psid` = tin cuối do khách gửi = page **chưa trả lời**. Trong mẫu này chỉ
**10/1 680** (vì đây là danh sách đã trả lời gần hết) — đây là tín hiệu **dựa trên dữ liệu**, đúng
tiêu chí "không đoán theo vị trí", nhưng **chưa dùng** vì việc lấy danh sách đã chốt theo hướng khác.

---

## §36 — Đọc phần UI/panel + các cơ chế nền (v1.92.7)

### 36.1 Bản đồ panel (40 phần tử, 28 listener)

Mọi nút gắn qua helper `on(id, 'click', fn)`. Nhóm chức năng:

| nút | việc |
|---|---|
| `ssb-scan` | ⚡ tải danh sách qua API (`next_cursor`, không cuộn) |
| Alt+Click dòng | đặt ĐẦU / CUỐI chuỗi (`setRangeStart` / `completeRange`) |
| `ssb-to-end` | **từ chat đang chọn tới cuối danh sách** |
| `ssb-selall` / `ssb-deselect-one` / `ssb-clear` | chọn tất cả / bỏ 1 / xoá chọn |
| `ssb-clear-unavailable` | **🧹 Xóa nhớ lỗi (N)** — đúng nút để xoá 6 753 ID đã nhớ |
| `ssb-send` → `triggerSendRun` · `ssb-stop` → `requestStop` | chạy / dừng |
| `ssb-wave`, `ssb-gap`, `ssb-quick`, `ssb-ms`, `ssb-rs`, `ssb-msg-mode`, `ssb-img-*`, `ssb-qr-*` | cấu hình lô, câu, ảnh, QR |

### 36.2 Bộ máy chọn `computeMatches` — đúng nguyên tắc "theo dữ liệu"

4 chế độ: `all` · `snippet` (so khớp nội dung) · `pick` (chọn lẻ) · `range` (chuỗi).

Chế độ `range` tìm vị trí 2 đầu trong **mảng dữ liệu**, theo thứ tự ưu tiên:
`state.allRows` (danh sách API, có trường `order`) → `getReduxConversationListRows()` → cuối cùng mới
`visibleRows()` (DOM). Nghĩa là **không dùng chỉ số DOM** trừ khi cả hai đầu không có trong dữ liệu.

Mặc định khi nạp danh sách: **tick tất cả** trừ `type === 'comment'` và các ID đã nhớ
"Socket confirmed-unavailable". Chat đã gửi ở lượt trước bị bỏ qua nhờ `state.sentIds`
(`⏩ Có N chat đã gửi ở lượt trước — sẽ bỏ qua`) ⇒ chạy lại không sinh tin trùng trong cùng phiên.

### 36.3 `next_cursor` là Erlang `term_to_binary` — và nó chứa MỐC THỜI GIAN

`parseErlangCursor` / `encodeErlangCursor` giải mã **từng byte**, đã đối chiếu `pancake.vn2.har #10`:

```
0x83 0x6c 00 00 00 03   LIST_EXT, 3 phần tử
0x61 <seen>             SMALL_INTEGER  (0/1)
0x6e 06 <6 byte LE>     SMALL_BIG      updated_at_ms
0x6d <4 byte len> <str> STRING         "{page_id}:{conv_id}"
0x6a                    NIL (đuôi)
```

⇒ Cursor **mang sẵn `updated_at_ms`**. Đây là cơ sở để (nếu sau này muốn) **nhảy thẳng tới mốc ngày**
thay vì lật từng trang đến vùng chat 10–20 ngày — đúng bài toán "tìm ranh giới bằng dữ liệu" ban đầu.
**Chưa làm**: việc lấy danh sách đã chốt theo hướng hiện tại, và cursor tự dựng cần kiểm chứng server
có chấp nhận `key` không khớp hay không.

### 36.4 Token: không lưu, và `'cookie_session'` là giá trị thật

```js
if (/(^|\.)pancake\.vn$/i.test(location.hostname)) return 'cookie_session';
```

Trên pancake.vn, `access_token` gửi lên **chính là chuỗi `cookie_session`** — server xác thực bằng
cookie phiên. Không có JWT nào bị lưu. Ngoài pancake.vn, token học được qua `hookNetwork`
(bọc `window.fetch` + `XMLHttpRequest.prototype.open`) và `performance.getEntriesByType('resource')`,
chỉ giữ trong biến bộ nhớ.

### 36.5 Keep-alive: 16 Hz siêu âm để tab không bị Chrome bóp

`startKeepAliveAudio()` tạo `OscillatorNode` 16 Hz, gain 0,01 trong lúc tải/gửi. Mục đích: Chrome
giảm nhịp `setTimeout`/timer của tab nền, làm chậm cả lượt gửi. Tần số 16 Hz **dưới ngưỡng nghe**,
gain 0,01 gần như không phát ra loa. Đây là lý do các lượt 200 s vẫn giữ được tốc độ.

### 36.6 Ảnh: `is_reusable:false` + bể fbId dự phòng

`uploadOneTimePhoto(pageId, photo, convId, ctx, forceFresh)`:
- fbId gắn **riêng từng hội thoại** (`is_reusable:false`), tuyệt đối không dùng chéo A→B;
- `spareFbIdPool[pageId]` giữ fbId dự phòng để retry không phải chờ upload lại;
- retry luôn `forceFresh = true` (xin fbId mới) vì fbId cũ đã bị FB đốt trong khung `/ls_req` lần 1;
- nhiều ảnh: bind cả mảng trong **1 lượt** `contents/facebook` — khớp §35.4.

### 36.7 Còn lại chưa đọc (nói thẳng)

- CSS + markup chi tiết của panel (~700 dòng trong `buildPanel`) — chỉ đọc phần tử và handler.
- Phần giữa `tools/build.mjs` (đồng bộ version / đóng gói) — đã đọc phần crx và `--check`.
- `_app-*.v6.js` còn nhiều module chưa mở, nhưng các câu hỏi cốt lõi (payload, cờ ctx7, 24h, ACK,
  adapter Ext) đã có đáp án.

---

## §37 — Thử nhảy `next_cursor` theo mốc thời gian: THẤT BẠI (có số)

### 37.1 Kết quả probe thật (page 448189508385420, 2026-11-14)

Cursor dựng tay đúng định dạng Erlang, `seen=0`, `key=""`, `current_count=0`:

| mốc | HTTP | trả về | mới nhất | cũ nhất |
|---|---|---|---|---|
| `2026-10-30` (15 ngày) | **200** | 40 hội thoại | **2026-11-14T03:22** | 2026-11-14T03:08 |
| `2026-11-09` (5 ngày) | **500** | 0 | — | — |

⇒ Server **không dùng phần thời gian** khi `key` rỗng: mốc 30/10 trả về **trang đầu danh sách
(hôm nay)**, còn mốc 09/11 thì **500**. Cursor hợp lệ về byte, nhưng **không phải con trỏ thời gian**.

### 37.2 Vì sao: cursor là KHOÁ VỊ TRÍ, không phải mốc

Cursor thật trong log:

```
83 6c 00000003 | 61 01 | 6e 06 <ts LE> | 6d 00000031 | "448189508385420:448189508385420_29133591229617236" | 6a
```

`key = {page_id}:{conv_id}` — server định vị **theo hội thoại**, thời gian chỉ là trường phụ.
Muốn nhảy tới ranh giới ngày, phải biết `conv_id` nằm đúng ranh giới đó — mà tìm được nó chính là
việc phải đi tìm bằng mắt. Vòng luẩn quẩn.

### 37.3 Còn đúng một khả năng, probe v2 kiểm trong 1 phút

`tools/list-jump-probe2.js`: giữ **nguyên key thật** (lấy từ request của app), chỉ đổi `ts`
(15 ngày / 60 ngày), so với đối chứng A.
- `A = B = C` ⇒ ts bị bỏ qua hoàn toàn ⇒ **ý tưởng chết, không làm nữa**.
- `A ≠ B/C` ⇒ ts có tác dụng khi key hợp lệ ⇒ còn đường.

### 37.4 Thứ đáng giá hơn phát hiện được trong chính log này

1. **429 xuất hiện trên request danh sách của CHÍNH APP** (2 lần, cùng cursor thật, `current_count=130`).
   Đây là bằng chứng trực tiếp cho §29: 429 chỉ rơi vào endpoint danh sách, và nó xảy ra ngay cả với
   app, không phải do script mình bắn nhiều.
2. **`tags=[7,8,9]` đang được áp dụng** — danh sách của page này đã được lọc theo thẻ, nên số trang
   cần tải nhỏ hơn nhiều so với "toàn bộ page".
3. **`New global_user_id added: <page>,<global_id>`** — hàng trăm cặp trong vài giây: đây chính là
   nguồn nuôi cache globalId (WS `threadMappingStoreV2`). Không cần dò từng chat.

---

## §38 — ĐÍNH CHÍNH bảng "tiềm năng" ở §35/§36 (đo lại, 2026-11-14)

### 38.1 Câu tôi nói SAI: "danh sách có sẵn global_id, không cần request từng chat"

Đo lại trên `taidanhsach.har` (1 840 dòng hội thoại, chưa khử trùng):

```
có global_id (ở conv hoặc customers[]): 0 / 1840
có customers[].fb_id                 : 1840 / 1840
các trường của customers[]           : fb_id, id, name      ← KHÔNG có global_id
```

⇒ Danh sách **không** chứa `global_id`. Nó chỉ có `fb_id` = **PSID**, đúng loại gid mà chính
script đã đánh dấu là yếu (`gidFromPsid`) và loại khỏi các nhánh retry (§31.1).

Và script **đã** khai thác phần có thể từ lâu: `cacheGidFromConvObj()` chạy cho **mọi dòng** khi
enrich và **mọi hội thoại** khi tải danh sách, nhưng nó chỉ nhận `global_id`/`globalId`
(không nhận `fb_id`). Vì vậy 3 949 lần dò `GET /messages` mỗi lượt là **những chat mà dữ liệu
không có global_id thật** — không phải chỗ script bỏ sót.

**Kết luận: không có việc gì để làm ở đây. Bỏ dòng đó khỏi danh sách tiềm năng.**

### 38.2 `last_sent_by` cũng không phải "chưa nhắn" như tôi nói

`last_sent_by.id === from_psid` chỉ nghĩa là **khách nói câu cuối** — tức *chưa được trả lời*,
KHÔNG phải *page chưa từng nhắn*. Một chat page đã nhắn 5 lần mà khách trả lời sau cùng vẫn thoả
điều kiện này. Muốn biết "page chưa từng nhắn" phải đọc lịch sử từng chat ⇒ trái với ràng buộc
"không request từng chat". **Hạ mức: không dùng được.**

### 38.3 Chấm lại 5 dòng "tiềm năng"

| dòng | kết luận thật |
|---|---|
| `customers[].fb_id` ⇒ global_id | **SAI** — chỉ có PSID, script đã khai thác hết phần có thể (38.1) |
| `contents/facebook` đường ảnh rẻ | Đúng số đo, nhưng **vô dụng hiện tại**: các lô đang gửi chữ; nhánh ảnh đã chạy đúng |
| bulk `update_global_id` | **Giá trị thấp**: đây là GHI vào DB Pancake, mà chính app đã làm qua WS (`New global_user_id added` hàng trăm dòng/giây) |
| `isRangeSatisfied` | **Đã chạy sẵn**, không phải cơ hội — chỉ là giải thích tại sao chọn 2 đầu sớm thì tải nhanh |
| Keep-alive 16 Hz | **Giải thích**, không phải cơ hội |

### 38.4 Rút ra

Loạt đọc này **đóng cửa nhiều hơn mở cửa**. Thứ duy nhất tạo ra tốc độ thật trong cả loạt là
**timeout Ext động** (Ext 0 → 245 thắng, 37,32 → 39,86 tin/giây). Các "phát hiện" còn lại phần lớn
là giải thích cơ chế hoặc chặn đường cụt. Việc còn lại có giá trị thật chỉ là: xoay JWT, dọn file
rác, và (tuỳ bạn) xoá cache unavailable.

---

## §39 — VÌ SAO "Extension không phản hồi (quá hạn)" — tìm ra trong bundle, đã vá 1.92.8

### 39.1 Nguyên nhân gốc: adapter VỨT BỎ phản hồi đến muộn

`__ExtensionAdapter__.send` (`_app…v6.js` @715835) — nguyên văn:

```js
send(e, t={}) {
  let n = this.currentTaskId++, o = t.timeout || (u.has(e.type) ? d : l); // l = 30 000
  return new Promise(t => {
    let s = n => { n.type === e.type + "_SUCCESS" ? t({success:true, data:n})
                 : n.type === e.type + "_FAILURE" && t({success:false, data:n}); };
    this.pendingMessages[n] = s;
    window.postMessage({...e, taskId:n, from:"WEBPAGE"}, "*");
    setTimeout(() => { delete this.pendingMessages[n]; t({success:false, data:null}); }, o);
  });
}
```

và listener khởi tạo:

```js
"WEBPAGE" !== e.data.from && null != e.data.taskId
  && e.data.taskId in this.pendingMessages
  && (this.pendingMessages[e.data.taskId](e.data), …)
```

Hai dòng cuối là mấu chốt: hết `timeout` thì `taskId` **bị xoá khỏi `pendingMessages`**, và listener
**chỉ gọi handler khi taskId còn trong map**. ⇒ Phản hồi của Extension về sau mốc đó bị **vứt bỏ
vĩnh viễn**, dù tin đã gửi xong.

Đó đúng là hình dạng trong log người dùng: `⚠ Ext: Extension không phản hồi (quá hạn)` rồi ~20 s
sau `🔎 kiểm chứng Ext: tin ĐÃ đến nơi dù Extension không trả phản hồi`. Không phải Extension chết —
là **script không giữ chỗ nhận** lâu đủ.

### 39.2 Vá 1.92.8 (không thêm một request nào)

`sendExtWithLateWatch()`: gọi adapter với `timeout: 60 000` để **giữ chỗ chờ**, nhưng chỉ `await`
tới mốc mềm `extTimeoutMs()` (2,5–9 s). Quá mốc ⇒ nhả làn như cũ, trả về đúng hình dạng
`{success:false, data:null}`, và gắn `.then()` vào chính promise đó. Phản hồi muộn về ⇒
`markDelivered()` + `postSendSideEffects()` + log `✅ (muộn Ns)`.

Hệ quả: 1) ⚠→✅ **ngay tại chỗ**, 2) lượt đọc lịch sử 20 s sau **tự bỏ** (verify đã có guard
`deliveredIds`), tức **giảm request** trên đường gửi, 3) `extSendCtl.timeoutStreak` được reset
khi có phản hồi muộn ⇒ bộ ngắt 150 không mở oan.

**Không gửi lại lần hai** ⇒ không thể sinh tin trùng. Bộ đếm mới trong dòng TỔNG HỢP:
`phản hồi MUỘN (đã tính ✅) N · muộn-mà-lỗi N · im lặng hẳn N`.

### 39.3 Khuếch đại: mỗi ⚠ cắt làn Ext ×0,6

`noteExtSendOutcome('timeout')` (≈:5700): `extSendLane.setLimit(getLimit() * 0.6)` — mỗi ca quá hạn
cắt 40 % số làn Ext, sàn 48. Với tỉ lệ quá hạn ~20 % (log 13:59, 2 687→2 973 trong 8 s ≈ **35,8 tin/s**),
làn 96 → 57 → 48 chỉ sau vài ca, rồi phải 10 phản hồi nhanh mới hồi +2 slot.

**Chưa sửa** — cố ý. Cắt làn có thể là backpressure ĐÚNG nếu phản hồi muộn vì 96 lệnh cùng bay.
Ba bộ đếm ở 39.2 sẽ trả lời dứt điểm sau lượt tới:
- `lateOk` lớn ⇒ Extension khoẻ, chỉ trả lời chậm ⇒ cắt làn ×0,6 là tự bóp oan ⇒ nới luật cắt.
- `silent`/`fail` lớn ⇒ Extension thật sự ì ⇒ giữ nguyên (hoặc siết hơn).

### 39.4 Ghi chú chi phí

Mỗi lệnh giữ một `pendingMessages` + một timer 60 s phía app (không huỷ được từ ngoài).
Ở ~36 lệnh/s ⇒ ~2 160 timer sống cùng lúc — chấp nhận được, nhưng nếu máy yếu thấy lag thì hạ
`EXT_ADAPTER_HOLD_MS` xuống 30 000 (vẫn phủ mốc kiểm chứng 20 s).

---

## §40 — Chờ mềm toàn bộ (1.92.9 / W200.51)

### 40.1 Kiểm kê trước khi sửa

| loại | số chỗ | ví dụ |
|---|---|---|
| `sleep()` chờ theo đồng hồ | **30** | `sleep(250)` chờ thăm dò Ext, `sleep(50)` quét scan, `sleep(150)` chờ 429 |
| `setTimeout` hẹn giờ | 33 | timeout fetch, hẹn kiểm chứng, debounce UI |
| vòng `while + continue` | 25 | phần lớn là retry/backoff |

### 40.2 Lõi mới

- `softNotify(key)` / `softWait(key)` — đánh thức **ngay trong cùng tick**; `softWait` tự gỡ khỏi Set khi hết chờ (không tích rác).
- `sleepUntil(ts, key)` — ngủ **đúng mốc**, thức sớm nếu có sự kiện hoặc bấm Dừng.
- `waitCond(cond, key, cap)` — chờ điều kiện; 250 ms chỉ còn là lưới an toàn cuối.
- `stopSignal()` — **một** promise dùng chung (không tạo resolver mới mỗi lần ngủ); `fireStopSignal()` gọi ở **5** chỗ đặt `stopRequested = true`; `resetStopSignal()` ở khối reset đầu lượt (nếu thiếu, lượt sau mọi sleep sẽ trả về ngay).
- `retryAfterMs(res, fallback)` — tôn trọng `Retry-After` của server.
- `nextFrame()` — nhường đúng 1 khung hình (rAF), tab ẩn thì lưới 34 ms.
- `makeLane` / `makeAdaptiveLane` có thêm `onChange()` → phát sự kiện mỗi khi active/hàng đợi đổi.

### 40.3 Đã chuyển (quét nhịp → sự kiện)

| chỗ | trước | sau |
|---|---|---|
| `acquireExtSendPermit` | `sleep(250)` quét `probeInFlight` | `sleepUntil(…,'ext-probe')`, `releaseExtSendPermit` phát sự kiện |
| `waitForGidDiscoveryIdle` | `sleep(200)` quét 2 lane | `onChange()` của `ctxFetchLane`/`gidExtLane` |
| chờ lượt quét cũ dừng | `sleep(50)` × 80 | `waitCond(…,'scan-done')`, finally của scan phát sự kiện |
| hết cơn 429 khi tải list | `sleep(150)` quét | `sleepUntil(rl.pauseUntil)` — đúng mốc |
| cooldown dò gid HTTP | `sleep(25–250)` quét | `sleepUntil(gidHttpCtl.coolUntil)` |
| `waitForSocketSynced` | `sleep(60)` quét | ngủ đúng mốc `connectAt + 1000`; 25 ms chỉ cho `requestId` |
| Ext finder chờ 250 ms | `sleep(250)` mù | `sleepUntil(…,'gid')` — `__botfakeSaveGid__` phát sự kiện |
| `extStartDelayMs` 80 ms | `sleep(80)` | `sleepUntil(…,'gid')` — WS có gid trước thì đi luôn |
| Socket retry 220–350 ms | `sleep(…)` mù | `sleepUntil(…,'delivered')` — `markDelivered` phát sự kiện |
| 429 khi gửi (3 chỗ) | `sleep(600)` / `350×n` | `retryAfterMs(res, …)` theo header |
| nhường Tab keydown | `sleep(20)` | `nextFrame()` |
| backoff còn lại (7 chỗ) | `await sleep(x)` | `sleepUntil(Date.now()+x)` — **ngắt được khi Dừng** |

### 40.4 Cố ý GIỮ là đồng hồ (không phải "chờ cứng")

- **6 chỗ `Promise.race([..., sleep(n)])`**: đó là *trần thời gian* của một phép chờ, không phải nhịp quét. Bỏ đi thì treo vô hạn: `findGlobalId` IDB 400 ms, `initSocket`/`warm` 12 000 ms, `mgr.all` 4 000 ms.
- **Nhịp phát Socket** (`SOCKET_MIN_PACE_MS`) — đây là bộ điều tốc chủ động; rút ngắn là tăng nguy cơ bóp/khoá, không phải tăng tốc.
- **Hẹn kiểm chứng** (20 s / 45 s / 120 s, `UNCERTAIN_VERIFY_GAP_MS`) — phụ thuộc độ trễ lan truyền phía server Pancake, không có sự kiện nào để bám.
- **Jitter chống dồn** (ngẫu nhiên 0–180 ms sau cơn 429, 0–5 s khi rải kiểm chứng) — mục đích là *làm lệch nhịp*, phải ngẫu nhiên mới đúng.
- **`smartGap`** — đã suy từ số đo, log 13:59 ra `0ms`.

### 40.5 Rủi ro đã kiểm

`node --check` ✓ · `npm run check` ✓ · `npm test` ✓ (12/12) · `npm run build` ✓.
Không đổi nhịp phát, không đổi timeout mạng, không đổi luật chống trùng ⇒ không mở thêm đường gửi lặp.

---

## §41 — HỒI QUY 1.92.7: mọi tin API bị chấm "không rõ" (vá ở 1.92.10)

### 41.1 Triệu chứng người dùng báo

Lô 14:09 (4 chat, script 1.92.9): phát xong trong **53 ms**, cả 4 tin ✅, `HTTP 200×4`,
nhưng TỔNG HỢP ghi **"10s · 0,39 tin/giây"** và 4 tin phải chờ **kiểm chứng 9 s** mới chốt.

### 41.2 Nguyên nhân — ba bộ đếm tự tố cáo nhau

| bộ đếm | log | nghĩa |
|---|---|---|
| `HTTP status [200×4]` | ghi trong `try` của `timedFetch` | request **đã** đi và trả 200 |
| `OK/rejected/không rõ 0/0/4` | ghi **sau** khi `timedFetch` trả về | `timedFetch` **không** trả về bình thường |
| `fetch p50 0ms` | mảng mẫu rỗng | `push` vào mẫu **thất bại** |

Ba dòng đó chỉ thẳng vào `finally` của `timedFetch`. Và đúng thế:

```js
// 8028 (từ 1.92.7):
Object.keys(sendDiag).forEach((k) => { sendDiag[k] = k === 'apiStatusCounts' ? Object.create(null) : 0; });
//                                       ↑ apiFetchSamples: []  →  bị đổi thành SỐ 0
// 2994:
const ar = sendDiag.apiFetchSamples;  ar.push(fetchMs);   // 0.push → TypeError
```

`push` nằm trong `finally` ⇒ văng ⇒ `timedFetch` ném ⇒ làn `makeLane` bọc thành `'Lỗi kênh:…'`
⇒ `.then(laneRes)` chấm **"⚠ không rõ kết quả (lỗi mạng/quá hạn)"** ⇒ `scheduleUncertainVerify`
⇒ đuôi kiểm chứng ~10 s ⇒ tốc độ hiển thị sụp.

**Lỗi vào từ 1.92.7** (lúc thêm vòng p50), không phải 1.92.8/1.92.9. Người dùng nhảy
1.92.6 → 1.92.9 nên chỉ thấy ở lô 14:09 — ba lô trước (13:47, 13:58, 13:59) đều chạy 1.92.6.

### 41.3 Vá

1. Reset theo **KIỂU**: mảng → `length = 0`, map → mới, số → `0`.
2. Chốt chặn thứ hai: `if (Array.isArray(ar)) { ar.push(...) }` — một khoá đổi kiểu không bao giờ
   được phép làm chết cả làn gửi.

### 41.4 Báo cáo: tách "phát lệnh" khỏi "chờ xác nhận"

Thêm `batchStats.dispatchEndedAt` (đặt khi `loopFinished = true`) và in **hai chặng**:

```
📊 … | ⏱ Phát lệnh 0.1s · chờ xác nhận 9.4s · tổng 10s
⚡ TỐC ĐỘ: PHÁT 4 lệnh trong 0.1s = 40.00/giây (2400/phút) · đuôi xác nhận 9.4s · đã chốt 4/4 (0.39/giây …)
```

Trước đây chỉ có "tổng", nên lô phát xong tức thì vẫn hiện 0,39 tin/giây — đọc thành script chậm.
Đuôi xác nhận là **cố ý** (kiểm chứng chỉ nâng ⚠→✅, không gửi lại), không phải tốc độ gửi.

### 41.5 Bài học

Một khoá chẩn đoán (`apiFetchSamples`) làm chết **đường gửi**. Mọi thao tác trong `finally`
phải coi mình là code không được phép ném. `npm test` không bắt được vì nó không chạy đường
mạng thật — chỉ log vận hành mới lộ.

---

## §42 — XÁC NHẬN 1.92.10 (log 14:12–14:13, cùng máy, cùng tài khoản)

### 42.1 Trước / sau

| lô | bản | phát lệnh | "không rõ" | đuôi xác nhận | kết quả |
|---|---|---|---|---|---|
| 14:09 (4 chat) | 1.92.9 | 53 ms | **4/4** | **9,4 s** | 4/4 ✅ nhưng báo 0,39 tin/giây |
| 14:09 (14 chat) | 1.92.9 | 141 ms | **11/11** | ~9 s | 14/14 ✅ nhưng báo 1,33 tin/giây |
| 14:13:02 (25 chat) | **1.92.10** | **0,4 s** | **0** | 2,3 s | 25/25 ✅ · **67,39 tin/giây (4 043/phút)** |
| 14:13:11 (18 chat) | **1.92.10** | **0,2 s** | **0** | 1,9 s | 18/18 ✅ · **72,29 tin/giây (4 337/phút)** |
| 14:13:18 (11 chat) | **1.92.10** | **0,2 s** | **0** | 1,4 s | 11/11 ✅ · **67,07 tin/giây (4 024/phút)** |

### 42.2 Hồi quy đã chết, đúng như chẩn đoán §41

- `HTTP status [200×25]` và `OK 25 / không rõ 0` **cùng tồn tại** — trước đây luôn là `OK 0 / không rõ N`.
- `fetch p50` nay có số thật: **874 / 984 / 1008 / 1104 ms** (trước là `0ms` vì mảng bị đổi thành số).

### 42.3 Đuôi xác nhận còn 1,4–2,3 s là **thời gian thật, không phải chờ mù**

Nó bằng đúng `fetch p50 ≈ 1 s` (Pancake trả lời) + ACK Socket `TB 1 310–1 391 ms`. Không còn
khoảng chờ đồng hồ nào chen vào: `queue wait` chỉ **57–153 ms**, `429/retry 0/0`, `bỏ qua 0`.

### 42.4 Ngưỡng Ext tự co theo số đo (1.92.6 chạy đúng)

`Ext p90 941ms → timeout 2823ms` — không còn hằng số 7 000 ms; vòng mẫu p90 hoạt động như thiết kế.

### 42.5 Lô nhỏ thì số thấp là **đúng bản chất**, không phải lỗi

Lô 4 chat: 3,87 tin/giây vì trần thời gian là **một lượt fetch ~0,9 s**, chia cho 4 lệnh. Từ ~20
lệnh trở lên, chi phí cố định đó bị chia nhỏ và tốc độ phát tiến tới mức ~67–72 tin/giây.

---

## §43 — Lô lớn đầu tiên của dòng 1.92.x (2 393 chat, 14:27)

### 43.1 Sổ sách khớp tuyệt đối — mọi chat đều có chỗ

```
1 500 ✅ + 813 chết-hẳn + 40 lỗi Ext + 40 không rõ = 2 393
thành công / mục tiêu còn lại = 1 500 / 1 580 = 94,9 %
```

- **813** = `Socket confirmed-unavailable` (khách xoá nick/khoá) → đúng là không gửi được.
- **40 lỗi Ext** = các ca Socket từ chối rồi Ext cũng trả `Người này hiện không có mặt`.
- **40 không rõ** = Ext không phản hồi; `kiểm chứng thấy tin 0 / chưa thấy 40` ⇒ thật sự chưa đi.

⇒ Sai sót **thật** của lượt = 40/2 393 = 1,7 %, và toàn bộ nằm ở làn Ext.

### 43.2 Tốc độ

| chỉ số | số đo |
|---|---|
| phát lệnh | **49,12 tin/giây (2 947/phút)** trong 48,7 s cho 2 393 chat |
| chốt (gồm đuôi) | 33,83/giây · thành công **21,21/giây** |
| đuôi xác nhận | 22 s (chủ yếu là 40 ca Ext chờ timeout 6,6 s + đọc lịch sử 20 s không thấy gì) |

### 43.3 Nút thắt tìm được: chia khúc TĨNH trong wave

`runPool` rút việc động **trong từng khúc**, nhưng cả wave bị chia thành **4 khúc cố định × 48 làn**
(`laneSize = ceil(len/4)`). Khúc nào nhiều ca chậm (FB từ chối → chờ ACK) thì 48 làn của khúc đó ùn,
**144 làn còn lại hết việc rồi ngồi không**; wave chỉ kết thúc khi khúc chậm nhất xong.

Dấu hiệu trong log: `wave→cổng TB 2 510 ms` nhưng `MAX 6 270 ms` — chênh **2,5 lần**.

**Vá 1.92.11**: bỏ chia khúc, cả wave dùng **một** `runPool(waveSlice, runMainItem, 192)`.
Tổng song song không đổi (192), mỗi chat vẫn chỉ được rút đúng một lần ⇒ không có đường gửi lặp.
`WAVE_PER_LANE`/`WAVE_MAIN_LANES` giữ lại chỉ để đọc log cũ.

### 43.4 Hai thứ KHÔNG phải nút thắt (đã kiểm, đừng sửa mù)

- `SOCKET_MIN_PACE_MS = 4` ⇒ trần 250 tin/giây/trang, không liên quan 49/s.
- Cổng wave **đã gối sẵn**: mở ở 40 % khối lượng hoặc sau 1 600 ms ở 25 %. `gateWaitMs` là *thời gian
  tới lúc mở cổng*, **không phải** thời gian làn rảnh — đừng đọc nhầm thành lãng phí.

### 43.5 Làn Ext trong lượt này: 0 tin thắng

`✅ [API: 6 · Socket: 1 494]` — Ext không đóng góp tin nào, chỉ tạo 40 ca "không rõ" và 22 s đuôi.
Nguyên nhân: mọi ca chuyển sang Ext đều là ca Socket **đã bị FB từ chối** (khách chết), nên Ext cũng
bị từ chối. Hành vi đúng thiết kế, nhưng cho thấy **thời gian đuôi của lượt chủ yếu là tiễn khách chết**.

### 43.6 Bộ đếm phản hồi muộn (mới ở 1.92.8) lần đầu có số

`phản hồi MUỘN (đã tính ✅) 0 · muộn-mà-lỗi 9 · im lặng hẳn 0` trên 40 ca quá hạn.
⇒ 9 ca Extension trả lời muộn và trả lời **lỗi thật** (không phải tin đã đi). Còn 31 ca chưa có kết quả
lúc in tổng hợp (mốc giữ chỗ 60 s chưa hết) — `im lặng hẳn` vì vậy đọc là "chưa tới hạn", không phải 0 ca.

## §44 — Bốn lượt NHỎ sau 1.92.11 (14:41–14:44) + sửa race "gửi khi danh sách đang tải"

### 44.1 Số đo (cùng một tab, cùng script 1.92.11-W200.53)

| lượt | n | PHÁT | chờ xác nhận | tổng | phát/s | chốt/s | API/Socket | lỗi |
|---|---|---|---|---|---|---|---|---|
| 1 (188) | 188 | 3,7 s | 4,5 s | 8 s | 51,39 | 22,94 | 170/17 (+1) | 1 |
| 2 (37)  | 37  | 0,5 s | 1,9 s | 2 s | 75,82 | 15,70 | 31/6 | 0 |
| 3 (54)  | 54  | 0,9 s | 1,9 s | 3 s | 59,60 | 19,31 | 49/5 | 0 |
| 4 (39)  | 39  | 0,5 s | 1,7 s | 2 s | 84,78 | 18,18 | 32/7 | 0 |
| 5 (24)  | 24  | 0,99 s| 1,7 s | 3 s | 24,27 | 9,08 | 19/5 | 0 |

Toàn bộ: `429/retry 0/0` · `fallback 0` · `bỏ qua 0` · HTTP `200×n` · fetch p50 **911–1 102 ms** (rất ổn định).

### 44.2 Vì sao lượt nhỏ "nhanh thật"

- `fetch p50 ≈ 1 s` là hằng số ⇒ n ≤ lane thì cả lượt xong trong ~1 lần fetch: `queue wait TB` chỉ **106–429 ms**, `peak API waiting 0`.
- n = 188 > lane ⇒ bắt đầu xếp hàng: `queue wait TB 2 485 / max 4 386 ms`, `peak API waiting 75`, `fetch TB 2 263 / max 6 026 ms` (server chậm lại khi bị dồn) ⇒ phát 51,39/s.
- Đuôi xác nhận **1,7–1,9 s KHÔNG co theo n** (nó là ACK của vài chat Socket chậm nhất: ACK TB 1 067–1 550 ms). Vì đuôi là hằng số nên n nhỏ ⇒ tỉ lệ nghịch: tổng ≈ n/phát + 1,8 s.
- Ở 4 lượt nhỏ, **API thắng 87–92 %** (khác lô lớn 14:34 chỉ 2/1 958) — khách mới còn trong cửa sổ nên API nhận ngay.

### 44.3 Lỗi thật phát hiện từ log: GỬI khi danh sách CÒN ĐANG TẢI

Dòng thời gian lượt 2:

```
14:43:02  (quét danh sách bắt đầu)
14:43:03  ⚡ Đang tự tải danh sách cho chuỗi đã chọn: Nguyễn Hằng → Nguyễn Thanh…
14:43:04  🧹 Đã xóa checkbox/chọn chat ngay khi bắt đầu lượt gửi.
14:43:04  🚀 Bắt đầu gửi 37 chat
14:43:06  ⚡ API: 346 chat (next_cursor hết)          ← quét xong SAU khi đã gửi
14:43:06  🔗 CHUỖI CHỌN: … ⚠ Không tìm thấy đủ 2 đầu chuỗi
```

Hai lỗi, cùng một gốc:

1. **`sendToAll` không chặn `state.scanning`** ⇒ lượt gửi chụp `state.matches` khi chuỗi chọn mới
   có phần đầu danh sách ⇒ **có thể gửi thiếu chat** so với dải đã chọn (không phải gửi trùng,
   nhưng sai tập gửi — đúng thứ người dùng cấm).
2. Dòng `⚠ Không tìm thấy đủ 2 đầu chuỗi` là **báo động giả**: `clearSelection()` của lượt gửi đã
   xoá `state.matches`, nên `completeRange` sau khi quét xong thấy `n = 0`.

### 44.4 Sửa ở 1.92.12-W200.54

- `sendToAll`: nếu `state.scanning` ⇒ khoá nút, log rõ, **chờ đúng sự kiện** `waitCond(() => !state.scanning, 'scan-done', 180 s)`
  (scan `finally` đã `softNotify('scan-done')` — không sleep mù), hết hạn vẫn đang quét thì **không gửi**.
  Chờ xong mới đọc lại `state.listIncomplete` và chụp `state.matches`.
- `completeRange`: chỉ in dòng `CHUỖI CHỌN`/`⚠` khi chuỗi chọn **còn nguyên** (`chainAlive`); bị lượt gửi cắt ngang thì im lặng.

## §45 — Lô 9 455 chat (15:54, 1.92.12): KHÔNG phải script chậm — Socket không được thử MỘT lần nào

### 45.1 Sổ sách

| chỉ số | số |
|---|---|
| ✅ | **7 185 (76,0 %)** — API 61 · **Ext 7 124** · Socket **0** |
| ❌ | 2 054 |
| ⚠ | 216 |
| FB unavailable | 524 → mục tiêu 8 931 → **80,5 %** |
| ⏱ | phát 318 s · chờ 23,9 s · tổng 342 s |
| PHÁT / chốt / thành công | 29,74/s · 27,65/s · **21,01/s** |
| WAVE | 19 wave × 500 · `wave→cổng TB 16 417 / max 37 041 ms` · main active max 192 |
| Ext | peak queue/active **468/128** · p90 3 203 ms → timeout 9 000 ms · quá hạn **633** · chưa thấy 226 · MUỘN-mà-OK 417 · muộn-mà-lỗi 181 · **bỏ qua vì bộ ngắt 1 526** |
| Socket | `ACK OK/rejected/no-ACK 0/0/0` · `peak active 0/0` · `limits cuối [64×1]` |
| API | 64 ca (61 OK · 3 rejected) · fetch p50 1 431 ms · `429/retry 0/0` |
| gid | cache **9 389** · Ext 1 · HTTP không gid 5 |

`7 185 + 2 054 + 216 = 9 455` ✔

### 45.2 Chuỗi nhân quả (đọc từ log + code, không suy đoán)

1. **Socket KHÔNG được thử lần nào.** Không phải "thử rồi thất bại": `active 0/0`, `ACK 0/0/0`,
   và `limits cuối [64×1]` = sàn 64 chưa từng được nâng (mỗi ACK OK sẽ nâng +8 và xoá cờ chết).
2. Đường DUY NHẤT xoá `'socket'` khỏi mọi kế hoạch là `pickBestDirectOrder` → `isPageAckDead(pageId)`.
   `PAGE_ACK_DEAD_TTL_MS = 600 000` (10 phút) **dài hơn cả lượt chạy 342 s** ⇒ một lần no-ACK ở
   lượt TRƯỚC đủ bóp toàn bộ lô này vào làn chậm nhất.
3. Còn lại `'ext'`: `skipFutileApi` (lô > 50 chat + chat ngoài 24 h) đã cắt `'api'` khỏi kế hoạch
   ⇒ kế hoạch co về đúng `['ext']`. Vì thế API chỉ có 64 ca.
4. Ext 48 luồng × p90 3,2 s ⇒ trần ~15–21 tin/s; hàng đợi Ext dâng tới **468**; bộ ngắt quá tải
   (3 timeout liên tiếp) mở ⇒ **1 526 chat bị chặn TRƯỚC KHI BẮN** (chưa hề gửi lệnh nào) nhưng
   không còn kênh nào để rơi xuống ⇒ bị tính ❌.
5. `wave→cổng 16,4 s` là **triệu chứng, không phải nguyên nhân**: cổng chỉ mở khi wave trước đã
   thoát gần hết, mà Ext rút 500 chat mất ~17 s.

Đối chiếu: cùng script, cùng tab, 70 phút trước — lô 1 958 chat có Socket ⇒ **PHÁT 125,30/s**,
`wave→cổng 1 844 ms`. Chênh lệch 4 lần này **không đến từ code đường gửi**, đến từ việc Socket bị
loại khỏi kế hoạch.

### 45.3 Sửa ở 1.92.13-W200.55

- **Dò lại cờ "ACK chết" thay vì né mù 10 phút**: cứ `SOCK_DEAD_PROBE_MS = 20 000` cho đúng MỘT
  chat đi Socket; ACK về ⇒ `noteSocketPageLaneOutcome('ok')` xoá cờ + nâng làn (+8) như cũ ⇒ tự hồi.
  Suốt 342 s chỉ tốn ~17 ca dò, đổi lại có thể lấy lại làn 384.
- **Đo được lý do chọn kênh** (thêm vào dòng 🧭): `Ext-trước(socket chưa sync) N / thiếu gid N /
  Socket bị né (ACK chết) N · dò lại ACK chết N (hồi N)`. Lô 15:54 mà có dòng này thì đã biết
  ngay, không phải suy luận.
- **Không để 1 526 ca biến mất trong cột ❌**: đếm riêng `⏸ Ext tự nghẽn chặn trước khi bắn (tính
  lỗi oan)`. Đây là lỗi DUNG LƯỢNG NỘI BỘ, khác hẳn "khách chết" — phải nhìn thấy nó.

### 45.4 Việc còn để ngỏ

Ca bị bộ ngắt Ext chặn vẫn đang bị tính ❌ chứ chưa được xếp lại. Muốn xếp lại phải đi qua
`sendOneAndLog` (nó đã `done++/fail++` trước khi trả về) nên không thể nhét thêm ở `runMainItem`
mà không lệch sổ — cần một đường "chưa bắn ⇒ trả về hàng đợi" đúng chỗ, làm riêng khi có log mới.

## §46 — Vì sao CÙNG MỘT LÔ lúc chạy Socket (125 tin/s) lúc dồn hết vào Ext (29,7 tin/s)

### 46.1 Chỗ rẽ nhánh chỉ có MỘT, và nó nằm ở 2 giây đầu

```js
// pickBestDirectOrder()
const sockReady = isPageSocketReady(pageId) || (!isSmallBatch && !!socketWarmPromises[pageId]);
const hasRealGid = !!(ctx && ctx.gid && !ctx.gidFromPsid);
const preferSocket = sockReady && hasRealGid && (hint === 'socket' || hasRealGid);
const first = preferSocket ? 'socket' : 'ext';   // ← đây là toàn bộ "lúc được lúc không"
```

`isPageSocketReady()` = `MqttHelper.SOCKETS[pageId]` đã **sync** — mà sync cần
`connectAt + 1000 ms` **và** `requestId ≥ 1` (xem `waitForSocketSynced`). Tức socket cần ~1–2 s
sau khi `initSocket()` mới "sẵn sàng".

Luồng đầu lô hiện tại: `warmUpSockets()` (bắn `initSocket`, KHÔNG ai chờ) →
`waitInitialGidWarmup()` (chỉ đồng bộ mapping, không chờ sync) → **wave 1 chạy ngay**.

⇒ Nếu wave 1 bắt đầu **trước** lúc socket sync xong: mỗi chat có kế hoạch `['ext','socket']`;
Ext trả lời trước (bắn nhả 0,8–3 s) và **thắng** ⇒ **Socket không bao giờ được thử**. Cả lô đi Ext.
⇒ Nếu socket kịp sync: `['socket','ext']` ⇒ Socket thắng ⇒ ACK về ⇒ cờ chết bị xoá + làn +8 ⇒
càng ngày càng nhanh (vòng tự củng cố).

Đây là **hai trạng thái bền** của cùng một danh sách. Khác biệt duy nhất: mạng/CPU/tab vừa F5
làm socket sync kịp hay không kịp trong ~2 s. Không phải ngẫu nhiên vô cớ.

### 46.2 Hai cái "chốt" làm trạng thái xấu KHÔNG tự hồi

| chốt | đặt khi | tự hồi? |
|---|---|---|
| `pageAckDeadAt` (né Socket) | **1** lần no-ACK đủ hạn chờ (`hitCeiling` gần như luôn đúng) | ❌ chỉ hồi khi có **ACK Socket** — mà né Socket thì không có ACK. Vòng tròn. TTL 10 phút |
| `socketLaneFloor` (sàn làn) | 25 no-ACK liên tiếp ⇒ 64→32→16 | ❌ code cũ ghi rõ "cầu dao giữ tới HẾT PHIÊN"; không có đường nâng lại |
| `apiBlockedPages` | 3 lỗi thread-control liên tiếp | TTL 4 giờ |

Cộng lại: một phút xui ở đầu phiên ⇒ né Socket 10 phút ⇒ sàn làn 16–32 tới khi F5 ⇒ API bị chặn
4 giờ. Ba hình phạt dồn lên đúng lúc hệ đang bận nhất.

Lưu ý: lô 15:54 **không chứng minh** được là cờ chết bật (Ext thắng 7 124 lần nên Socket đứng
thứ hai cũng không bao giờ được thử). Hai nguyên nhân cho cùng một triệu chứng ⇒ phải ĐO, không
đoán — đó là lý do thêm bộ đếm `chọn kênh:` ở §45.3.

### 46.3 Sửa ở 1.92.14-W200.56

1. **`waitSocketsReadyForSend(targets, 4000)`** — đầu lô > 50 chat, chờ đúng điều kiện
   `isPageSocketReady()` (thức bằng `softNotify('sock-sync')`, lưới an toàn 250 ms, hạn 4 s).
   Log rõ `✅ Socket đã sync N/N page sau Xms — lô này đi làn Socket trước.` hoặc
   `⏳ Socket CHƯA sync N/N sau Xms — lô này đi Extension trước…`. Lô ≤ 50 chat giữ nguyên
   chiến lược cũ (Ext ngay, không chờ).
2. **`need` 1 → 2** cho cờ "ACK chết": phải **2 lần no-ACK liên tiếp** mới kết luận. Lô 14:34 có
   117 no-ACK rải giữa 1 173 ACK OK ⇒ một ca trượt đơn lẻ không chứng minh được kênh chết.
3. **Sàn làn Socket tự hồi**: cứ 20 ACK nhanh liên tiếp thì `socketLaneFloor` +8 (trần
   `SOCKET_LANE_MIN = 64`), trừ khi người dùng tự đặt bằng `__botfakeSetSockPageFloor__`
   (cờ `socketFloorUserSet`).

## §47 — Bỏ hạn chờ cứng khi chờ Socket: await CHÍNH promise của nó

### 47.1 Bản 1.92.14 chưa đủ tốt ở đâu

`waitSocketsReadyForSend(targets, 4000)` đã là "chờ theo điều kiện" (thức bằng `softNotify('sock-sync')`,
lưới 250 ms), **không phải sleep mù**. Nhưng vẫn có 2 chỗ đáng chê:

1. **Con số 4 000 ms là do tôi chọn**, không đo từ đâu. Nếu máy chậm cần 4,5 s thì lô vẫn rơi vào Ext;
   nếu máy nhanh 0,4 s thì không sao (vì thức sớm) nhưng con số vẫn vô nghĩa.
2. Hết 4 s mà chưa sync thì **mất trắng 4 s** rồi mới chạy.

### 47.2 Cách đúng: không chờ "một khoảng", chờ ĐÚNG cái đang chạy

`warmUpSockets()` đã tạo `socketWarmPromises[pid]` — promise resolve **đúng lúc** `initSocket()` xong
và đã đi qua `waitForSocketSynced(h, pid, 2500)`, sau đó tự xoá khỏi map. Nghĩa là **đã có sẵn một
tín hiệu chính xác**; việc của ta chỉ là `await` nó:

```js
const waits = pending.map((pid) => {
  const warm = socketWarmPromises[pid];
  if (warm && typeof warm.then === 'function') return Promise.resolve(warm);
  return waitForSocketSynced(h, pid);   // cùng hạn sync mà toàn bộ code đang dùng (2 500 ms)
});
await Promise.race([Promise.all(waits), guard, stopSignal()]);
```

- Socket sync lúc 0,4 s ⇒ chờ 0,4 s. Sync lúc 3,1 s ⇒ chờ 3,1 s. **Không có mốc nào do người viết chọn.**
- Mạng hỏng ⇒ promise tự bỏ cuộc theo hạn sync có sẵn (2,5 s), không phải theo số tôi bịa.
- `SOCK_SYNC_HANG_GUARD_MS = 8 000` **chỉ là lưới chống treo** (`initSocket` không bao giờ trả về),
  không phải hạn chờ tối ưu; bắn ra log `⚠ Socket không báo sync sau 8000ms (initSocket treo)`.
- Bấm ⏹ Dừng là thoát ngay (`stopSignal()` trong race).

### 47.3 Trả lời thẳng: "cách hiện tại đã ổn chưa?"

| | 1.92.14 (4 s) | 1.92.15 (promise) |
|---|---|---|
| thức khi nào | quét 250 ms + softNotify | **đúng lúc promise resolve** |
| con số tự đặt | 4 000 ms | không có (chỉ lưới treo 8 s) |
| mất thời gian khi sync hỏng | 4 000 ms | 2 500 ms (hạn sync có sẵn) |
| ảnh hưởng lô ≤ 50 chat | không (có gate) | không (giữ gate) |

Điều **vẫn còn phải chờ** — và không thể tránh — là bản chất: `isPageSocketReady()` chỉ đúng khi
socket đã sync. Muốn cả lô đi Socket thì phải đợi đúng việc đó; giờ chỉ còn đợi **đúng bằng thời gian
nó cần**, không hơn một nhịp.

## §48 — Bản ổn định cho người dùng (`scripts/pancake-send-stable.user.js`)

Sinh từ bản gốc `scripts/pancake-send-lite.user.js` bằng bộ thay đổi có đánh dấu `[STABLE]`
(không sửa tay hai nơi — sửa bản gốc rồi sinh lại). Khác biệt **đúng 22 điểm**, tất cả đều
một chiều, không đụng vào đường gửi/nhịp/làn:

| # | thay đổi | lý do |
|---|---|---|
| 1 | `@name/@namespace/@version/@description` riêng (`1.92.15-stable`) | hai bản cài song song được, phân biệt rõ |
| 2 | `PANEL_ID = 'ssb-root-stable'`, `APP_VERSION = '1.92.15-STABLE'` | panel không đè nhau |
| 3 | **cờ chống gửi trùng**: nếu bản gốc đang chạy → tự tắt; nếu nó chạy trước → **chiếm luôn** `__BOTFAKE_TAB_CLIPBOARD_ACTIVE__` để bản gốc cũng tự tắt | trong 1 tab luôn chỉ có MỘT bộ gửi |
| 4 | `isRememberedUnavailable()` → `return false` | **bỏ lọc chat lỗi**: không chat nào bị loại khỏi danh sách |
| 5 | `rememberConfirmedSocketUnavailable()` → `return false` | **bỏ lưu** ID lỗi vào localStorage (không còn "danh sách đen" tích luỹ) |
| 6 | nút `🧹 Xóa nhớ lỗi` ẩn (`display:none`) | khỏi hiện nút vô dụng |
| 7 | thêm `state.tabSend` (mặc định **TẮT**, nhớ qua `ssb_tab_send_on`) + nút `TAB: BẬT/TẮT` trên tiêu đề + chặn ở `onKeydown` | người mới bấm Tab để chuyển ô sẽ **không vô tình gửi** |
| 8 | `logDiag()` cho 6 dòng chẩn đoán (`GHI NHỚ LỖI`, `TỐC ĐỘ`, `WAVE`, `SOCKET`, `API NỀN`, `Chẩn đoán globalId`) với `DIAG_LOGS = !IS_STABLE_BUILD` | **log cuối chỉ còn dòng tổng kết** `📊 TỔNG HỢP CHỐT LƯỢT GỬI` |

Giữ nguyên 100 %: Wave 200, làn Socket/Ext/API, soft-wait, chống trùng (`acquireOutbound`,
`sockFiredPending`), kiểm chứng nền chỉ nâng ⚠→✅, bù 1 lần/kênh, `waitSocketsReadyForSend`.

Ghi chú kỹ thuật:
- `logDiag` khai báo **trước** `logLine` nhưng gọi hàm khai báo (hoisting) — không lỗi.
- `DIAG_LOGS` là `const` trong IIFE, `logDiag` đọc qua closure.
- `state.tabSend` khởi tạo bằng IIFE `try/catch` quanh `localStorage` (chế độ chặn cookie vẫn chạy).
- `npm run build` copy **cả hai** script vào `release/botfake-ext/scripts/` (14 file); `manifest.json`
  vẫn chỉ nạp bản gốc làm content script — bản ổn định là file userscript độc lập, cài qua Tampermonkey.

## §49 — Lô 11 844 chat (19:52, 1.92.15): sửa §45–§46 đã ăn, nút thắt mới là LÀN SOCKET BỊ GHIM Ở 64

### 49.1 Sổ sách

| chỉ số | số |
|---|---|
| ✅ | **9 564 (80,7 %)** — API 325 · Ext 769 · **Socket 8 470** |
| ❌ / ⚠ | 1 767 / 513 |
| FB unavailable | **1 708** ⇒ mục tiêu 10 136 ⇒ **94,4 %** |
| **lỗi THẬT** | 1 767 − 1 708 = **59 ca (0,5 %)** |
| ⏱ | phát 280,6 s · chờ 46,6 s · tổng 327 s |
| PHÁT / chốt / thành công | **42,21/s** · 36,20/s · 29,23/s |
| WAVE | 24 wave × 500 · `wave→cổng TB 8 663 / max 12 580 ms` · main active max 192 |
| Socket | ACK OK/rej/no-ACK **8 470/1 759/459** · TB **3 163** / max 7 096 ms · buckets `0/0/745/9 668/275` |
| Socket/page | peak active **296/296** · waiting **251/251** · **limits cuối [64×1]** |
| API | 339 (325 OK) · queue wait TB **2 428** / max 9 310 ms · fetch TB 2 810 · p50 1 734 |
| chọn kênh | Ext-trước(socket chưa sync) **0** · thiếu gid 58 · **Socket bị né (ACK chết) 2 539** · dò lại ACK chết **5 (hồi 5)** |

### 49.2 Những gì đã đúng

- **Socket sống lại**: 8 470 tin (72 % sản lượng) so với **0** ở lô 15:54. `Ext-trước(socket chưa sync) = 0`
  ⇒ bước chờ sync đầu lô (§46) lần này không phải chờ ai: socket sẵn sàng trước wave 1.
- **Không còn ca chết vì Ext tự ngẽn**: `bỏ qua lúc Ext quá tải = 0` (lô trước 1 526).
- **Lỗi thật 59 ca** (0,5 %) — mọi ca ❌ còn lại là khách FB xác nhận vắng.
- Tốc độ **29,74 → 42,21 tin/s** (+42 %) trên lô lớn hơn.

### 49.3 Nút thắt mới: làn Socket bị GHIM ở sàn 64

```
peak Socket/page active 296/296 · waiting 251/251 · limits cuối [64×1]
ACK TB 3 163 ms · 9 668/10 688 ACK rơi vào 2–5 s
```

Thông lượng ≈ **làn ÷ thời gian mỗi lệnh**: 64 ÷ ~3,2 s ≈ 20–30 tin/s (đo được 42,21/s toàn lô).
Làn là mẫu số ⇒ không nâng làn thì không nhanh hơn được.

Vì sao làn KHÔNG THỂ tự nâng — đúng hai dòng code:

```js
if (kind === 'ok' && ms < 2500) { ctl.fastOk++; ... if (ctl.fastOk >= 20) lane.setLimit(+8); }
else { if (kind === 'ok') ctl.fastOk = 0; }        // ← ACK ≥ 2,5s XOÁ bộ đếm
```

- **Đường TĂNG** đòi 20 ACK **< 2 500 ms** liên tiếp. Page này ACK TB **3 163 ms** ⇒ không bao giờ đủ 20.
- **Đường GIẢM** chỉ cần 2 no-ACK (459 ca ⇒ ~229 nhịp × 0,8) ⇒ tụt thẳng về sàn 64.

Kết quả: chỉ có xuống, không có lên. Đây đúng **cùng một hình xoáy** như §43/§46, chỉ ở tầng khác.

### 49.4 Cái giá của cờ "ACK chết" (đo được, không phải suy đoán)

Cờ bật **5 lần**, mỗi lần dò lại sau tối đa 20 s ⇒ **2 539 chat bị né khỏi làn Socket**
(≈508 chat/lần), dồn sang Ext (Ext chỉ 48 làn, p90 1 575 ms) hoặc API (queue wait TB 2 428 ms).
`dò lại ACK chết 5 (hồi 5)` ⇒ cả 5 lần đều hồi ngay khi có 1 ACK — tức cờ này bật **quá nhạy**
so với thực tế kênh vẫn sống.

### 49.5 Sửa ở 1.92.16-W200.58

1. **Ngưỡng "ACK nhanh" bám số đo**, không còn hằng 2 500 ms:
   `fastAckMs() = clamp(p50 × 1,2, 2 500…6 000)` — dùng cho cả nhánh `ok` và `rejected`.
   ACK chậm **bất thường** (≥ 6 000 ms) vẫn bị phạt như cũ ⇒ không mở cửa cho kênh hỏng.
2. **Dò cờ "ACK chết" theo SỐ CHAT BỊ NÉ** (50) chứ không chỉ theo đồng hồ 20 s ⇒ hư hại tối đa
   ~50 chat/lần thay vì ~508.
3. In thêm `ACK p50/p90 → ngưỡng nhanh` vào dòng 🧭 để lần sau đọc là biết, khỏi đoán.

### 49.6 Việc còn để ngỏ

- `ackWaitMs` vẫn bị chặn trần **3 000 ms** trong khi ACK TB 3 163 ms ⇒ 459 no-ACK. Chưa sửa vì
  bằng chứng cũ (§43: 117 no-ACK, kiểm chứng lịch sử **thấy tin 0**) cho thấy phần lớn no-ACK là
  mất thật, nới hạn chờ không cứu được tin nào. Sẽ xem lại nếu log sau vẫn ≥ 4 % no-ACK.
- `wave→cổng 8 663 ms` là hệ quả của làn hẹp (wave chỉ mở khi wave trước thoát ≥ 40 %).

## §50 — Hai bản script thì cái nào chạy? (làm rõ + siết chống gửi trùng)

### 50.1 Đường nạp thực tế

| Cách dùng | Bản chạy |
|---|---|
| Extension (`manifest.json`) | **chỉ bản gốc** — `content_scripts` khai báo duy nhất `scripts/pancake-send-lite.user.js`. File `-stable` chỉ là file đi kèm trong `release/botfake-ext/`, **không** được nạp |
| Tampermonkey 1 file | đúng file đó |
| Tampermonkey 2 file | ai nạp trước thắng, người sau tự tắt |

Version trên tiêu đề panel là căn cước: `1.92.17-W200.59` (gốc) vs `1.92.17-STABLE`.

### 50.2 Vì sao vẫn phải siết chống gửi trùng

Cờ `window.__BOTFAKE_TAB_CLIPBOARD_ACTIVE__` chỉ dùng được khi cả hai bản chạy **chung page world**
(đúng với `@grant none` + `world: "MAIN"`). Nếu một trình quản lý chạy mỗi script trong sandbox
riêng thì cờ vô hình với nhau ⇒ **hai bộ cùng gửi** ⇒ gửi trùng. Vì vậy 1.92.17 thêm lưới thứ hai
trên **DOM** (luôn dùng chung giữa các world):

```js
function botfakeClaimSlot(name) {          // ai gọi trước thì giữ chỗ, người sau trả false
  const el = document.documentElement;     // chưa có <html> ⇒ cho qua, để cờ window quyết
  if (!el) return true;
  if (el.getAttribute('data-botfake-active')) return false;
  el.setAttribute('data-botfake-active', name);   // 'lite' | 'stable'
  return true;
}
```

Bản gốc: `if (window.__BOTFAKE_TAB_CLIPBOARD_ACTIVE__ || !botfakeClaimSlot('lite')) return;`
Bản ổn định: thêm `|| window.__BOTFAKE_STABLE_ACTIVE__ || !botfakeClaimSlot('stable')`, và vẫn
chiếm luôn cờ của bản gốc để bản gốc tự tắt.

## §51 — Bản ổn định thành một TIỆN ÍCH RIÊNG (`release/botfake-ext-stable/`)

### 51.1 Vì sao phải là tiện ích riêng

Một manifest chỉ khai báo được một bộ `content_scripts`. Bản ổn định muốn chạy thì hoặc chui vào
manifest của bản gốc (⇒ cài/gỡ dính nhau, `update_url` kéo nhầm bản), hoặc có manifest riêng.
Chọn manifest riêng:

| | `release/botfake-ext/` | `release/botfake-ext-stable/` |
|---|---|---|
| tên tiện ích | BOTFAKE LITE | **BOTFAKE STABLE** |
| content script | `scripts/pancake-send-lite.user.js` | `scripts/pancake-send-stable.user.js` |
| `update_url` | có | **không** (bản ổn định không tự cập nhật theo kênh bản gốc) |
| file bản kia | không chứa | không chứa |
| zip | `dist/botfake.zip` | `dist/botfake-stable.zip` |

### 51.2 Không thể cùng gửi một tin (kể cả cài cả hai)

Cài hai tiện ích thì mỗi tiện ích có bridge riêng, cùng nghe `window.postMessage` ⇒ nếu chung kênh
thì **một lệnh của userscript sẽ được hai background cùng trả lời**, và với `BOTFAKE_BG_FETCH`
POST là gửi trùng. Vì vậy folder ổn định được sinh với kênh riêng:

| | bản gốc | bản ổn định |
|---|---|---|
| kênh tin nhắn | `__botfake` | `__botfakeS` |
| dấu DOM | `data-botfake-ext` | `data-botfake-ext-stable` |
| overlay id | `botfake-ext-overlay` | `botfake-ext-overlay-stable` |

`extBgAvailable()` của bản ổn định chỉ nhìn `data-botfake-ext-stable` ⇒ nếu chỉ cài tiện ích bản
gốc thì bản ổn định **không** dùng service worker mà fetch thẳng trên trang (đúng cookie/token).
Ngược lại bản gốc cũng không thấy kênh của bản ổn định. Cộng với dấu `data-botfake-active`
(§50) ⇒ hai bộ không thể cùng tồn tại trong một tab.

### 51.3 Sinh tự động, không có bản sao thứ hai

`tools/build.mjs` dựng folder ổn định từ nguồn, chỉ khác 4 điểm bằng phép biến đổi chuỗi:

```
manifest.json        ← JSON của manifest.json: đổi name/mô tả, bỏ update_url + key,
                       content_scripts.js: lite → stable
extension/bridge.js  ← __botfake → __botfakeS · data-botfake-ext → data-botfake-ext-stable
extension/popup.js   ← scripts/pancake-send-lite.user.js → scripts/pancake-send-stable.user.js
extension/overlay.js ← id + cờ riêng của bản ổn định
scripts/…            ← scripts/pancake-send-stable.user.js (chỉ file này)
```

`npm run check` kiểm: manifest chỉ trỏ tới file có trong folder · folder **không** chứa bản gốc ·
không có file lệch/thừa. Vì folder là sản phẩm sinh, sửa tay sẽ bị build ghi đè — đúng ý
"làm một lần rồi để yên".

## §52 — Rà lại LOGIC BÙ + LOGIC NHẬN PHẢN HỒI GỬI (1.92.18)

### 52.1 Hai lỗi tìm ra (đã sửa)

**A. Vòng mẫu độ trễ ACK bị CẮT CỤT — đây là lý do 1.92.16 một mình chưa thể ăn.**

```js
if (kind === 'ok' && ms < fastAckMs()) { ...; noteAckLatency(ms); }   // ← chỉ ca "nhanh" được ghi
else if (kind === 'noack') { ... }
else if (kind === 'ok' || kind === 'rejected') { if (kind === 'ok') ctl.fastOk = 0; ... }
```

`noteAckLatency()` nằm **bên trong** nhánh "nhanh" ⇒ mọi ACK chậm hơn ngưỡng bị **vứt khỏi mẫu**.
Hệ quả dây chuyền trên page có ACK ~2–3 s:

1. vòng mẫu rỗng ⇒ `sockAckP50() = 0` ⇒ `fastAckMs() = 2 500 ms` (sàn);
2. ACK thật ~2 900 ms > 2 500 ⇒ không ca nào là "nhanh" ⇒ không ghi mẫu (quay lại 1);
3. `fastOk` không bao giờ đạt 20 ⇒ làn không tăng; 459 no-ACK vẫn cắt 0,8× ⇒ **`[64×1]`**.

Thống kê tự lừa chính nó. **Sửa:** ghi mẫu cho **mọi** ACK `ok`/`rejected` trước khi phân nhánh
(bỏ 2 lời gọi bên trong để không đếm đôi). Chỉ ghi nhận — không đổi đường gửi, hạn chờ ACK vẫn
bị chặn trần 3 000 ms.

**B. `/ls_resp` mang cờ lỗi vẫn bị chốt ✅.**

`classify()` chỉ tìm `markOptimisticMessageFailed`; payload **không có action nào** (kể cả
`error` / `error_code` / `success:false`) rơi thẳng xuống `{ kind: 'ok' }` ⇒ tính ✅, **không**
đăng ký kiểm chứng, **không** bù ⇒ mất tin im lặng — loại lỗi tệ nhất.
**Sửa:** thiếu `replaceOptimsiticMessage` **và** có cờ lỗi ⇒ `'noack'` (⚠ + kiểm chứng lịch sử,
tuyệt đối không bắn lại). `replaceOptimsiticMessage` vẫn là bằng chứng dương tính duy nhất.

**C. Dọn:** `ackCeiling` là tam phân vô nghĩa (`? 3000 : 3000`) → hằng 3 000 kèm lý do.

### 52.2 Đã rà và thấy ĐÚNG — không sửa

| hạng mục | kết luận |
|---|---|
| 3 lớp chống trùng (`deliveredIds` · `sockFiredPending` · `outboundLock`) | `acquireOutbound` kiểm cả 3; `dupBlockedResult` trả ok-giả để không kênh nào bắn lại; `outboundLock` xoá sạch đầu mỗi lượt ⇒ không rò giữa lượt |
| `sent:'maybe'` (không rõ) | không bao giờ thử kênh khác; chỉ đi kiểm chứng lịch sử — đúng luật |
| Nhánh DUY NHẤT được bắn lại | Socket `verdict 'no'` (2 lần đọc liên tiếp) và API `verdict 'no'` (2 lần) — cả hai đều `reopenUncertain()` + `releaseOutbound()` **trước** `scheduleBuRetry` (thiếu 1 trong 2 là chết im lặng: `scheduleBuRetry` tự chặn khi `uncertainIds` còn) |
| `historyVerdict` — múi giờ | HAR `loadnhanh.har`: `inserted_at` mới nhất `05:11:35.555` vs entry `05:13:47Z` ⇒ **UTC không kèm Z** ⇒ `rawT + 'Z'` là ĐÚNG |
| `historyVerdict` — lọc "tin do page gửi" (`from.id === pageId`) | cùng quy ước với `fetchCommentTarget` (đường trả lời bình luận đang chạy được) |
| `scheduleBuRetry` chống chồng | 6 lớp: `buRetryTimer` · `sockFiredPending` · `deliveredIds` · `uncertain/finalFailed` · `runSeq` · kiểm lại ngay trước khi bắn trong `busEnqueue` |
| Socket ACK khớp `request_id` | đọc id sát lệnh `publish` (1 microtask cũng không có); timeout chỉ xoá entry **của chính mình** (`PENDING_MESSAGES[myKey] === myEntry`) |
| Bấm Dừng khi frame còn xếp hàng | mọi lane resolve `{ok:false,'Đã dừng'}` **mà không gọi hàm trong hàng** ⇒ `.then` tự gọi `notifySlotStarted(false)` ⇒ worker không treo (đã kiểm để loại giả thuyết treo, không cần cờ chờ thêm) |

### 52.3 Ghi nhận có chủ ý (chưa đổi)

- **Bù không đưa API vào danh sách kênh cuối** (chỉ `ext`/`socket`): ca trong 24 h đã đi API trước
  đó; ca ngoài 24 h API gần như chắc `(#551)/(#10)`. Chỉ thêm nếu log sau có nhiều ❌ mà lịch sử
  xác nhận "chưa có tin".
- **Ext quá hạn bị phạt 0,6× làn** kể cả khi phản hồi muộn về sau (21 ca "muộn-mà-thành-công" ở
  lô 19:52): sàn `EXT_SEND_MIN 48` chặn thiệt hại; chưa thấy Ext kẹt sàn trong log.
- **Kiểm chứng Ext chỉ đọc lại 1 lần** (đã cắt từ 3) — giữ nguyên, đúng ý "không hành máy yếu".

## §53 — Lô 12 279 chat (20:28, 1.92.18): thang máy đã đúng chỗ, trần mới là làn 384

### 53.1 Số đo (so với lô 19:52)

| chỉ số | 19:52 (1.92.15) | 20:28 (1.92.18) | Δ |
|---|---|---|---|
| số chat | 11 844 | 12 279 | |
| **phát lệnh** | 42,21/s | **209,23/s** | **×4,96** |
| chốt sổ | 36,20/s | **66,23/s** | ×1,83 |
| thành công | 29,23/s | **53,44/s** | ×1,83 |
| ✅ / mục tiêu thật | 94,4 % | **96,8 %** | +2,4 |
| Socket/page limits cuối | **[64×1]** | **[384×1]** | trần |
| ACK TB / no-ACK | 3 163 ms / 459 | **1 383 ms / 1** | no-ACK −99,8 % |
| Socket bị né (ACK chết) | 2 539 | **0** | hết hẳn |
| wave→cổng TB/max | 8 663 / 12 580 ms | **1 984 / 3 332 ms** | ÷4,4 |
| ❌ trừ khách FB xác nhận vắng | 59 | **63** | |
| ⚠ | 513 | **260** (240 là "muộn-mà-lỗi") | ÷2 |

Ba fix đã trả tiền đúng như dự đoán: (1) §52.A — mẫu ACK không còn bị cắt cụt ⇒ p50/p90 đo được
**958/1 130 ms** ⇒ làn tăng 64→384; (2) §52.B — payload lỗi không còn bị chốt ✅; (3) 1.92.16 —
"ACK nhanh" theo p50 đo, cờ ACK-chết dò theo số chat bị né ⇒ 2 539 → 0.
`no-ACK 459 → 1`: ACK giờ về trong hạn gần như 100 % ⇒ gần như không còn ca phải kiểm chứng.

### 53.2 Cái còn tốn thời gian: 127 s đuôi + 63 ca mất vì thiếu global_id

- **Đuôi 126,7 s** gần như toàn bộ là **2 047 ca bù Extension cho chat FB đã từ chối** — Ext trả
  "Người này hiện không có mặt" **2 047/2 047 lần**, cứu được **0**. Đây là tiền chuộc của luật
  "một kênh nữa xác nhận trước khi tuyên bố khách chết", không phải lỗi.
- **63 ca ❌ còn lại** = đúng nhóm `🧭 lần dò chưa ra 63` / `can_inbox=false 0/63`: không có
  global_id ⇒ Socket/Ext bất khả; **API không cần gid** (HAR: URL chỉ dùng convId) nhưng lượt này
  API chỉ chạy 302 request (không có 63 ca cứu) ⇒ đường `🛟` không được gọi ở nhánh wave.

### 53.3 Sửa ở 1.92.19-W200.61 — khôi phục "bắn lại Socket 1 lần" cho đường bắn-nhả

Lô này có **2 307 ca rejected** nhưng dòng 📡 ghi **`retry lần 0`**: `settleSocketResult` trả
`deferredToSocketRetry` để xin bắn lại 1 lần (thoát burst-reject), nhưng ở đường **bắn-nhả** kết quả
đi thẳng vào `finalizeSockBg` — nơi **không ai xử tín hiệu đó** ⇒ nó rơi, và ca rejected chuyển
thẳng sang Ext bù (chính là 2 047 ca ở trên).

Nay: `finalizeSockBg` gặp `deferredToSocketRetry` ⇒ nhả khoá rồi **bắn lại đúng 1 lần qua Socket**
(`isSocketRetryPass` ⇒ không thể defer lần 2, `socketRetriedOnce` ⇒ không lặp), chạy trên làn riêng
48 luồng để không chiếm ghế của wave kế tiếp. An toàn: FB đã trả `markOptimisticMessageFailed`
⇒ tin CHƯA đi, gửi lại không thể trùng. Dòng 📡 in thêm **`retry wave N`** để lần sau đọc là biết.

## §54 — Nút bật/tắt phím TAB trên giao diện bản gốc (1.92.20)

Trước đây chỉ **bản ổn định** có công tắc `TAB:`; bản gốc luôn bật (bấm Tab = Chạy). Nay nút này
nằm ở **cả hai bản**, chỉ khác mặc định:

| | `pancake-send-lite.user.js` | `pancake-send-stable.user.js` |
|---|---|---|
| nút `TAB: BẬT/TẮT` trên tiêu đề panel | ✅ có | ✅ có (sinh tự động từ bản gốc) |
| mặc định | **BẬT** (`!== '0'`) — giữ nguyên hành vi cũ | **TẮT** (`=== '1'`) |
| nhớ lựa chọn | `localStorage 'ssb_tab_send_on'` | cùng key |

Chi tiết kỹ thuật (quan trọng để không tự phá hành vi cũ):

- Công tắc **chỉ** đổi cách xử lý phím Tab: TẮT ⇒ `onKeydown` **return ngay, không `preventDefault`**
  ⇒ phím Tab quay về đúng chức năng chuyển ô của trang.
- Mặc định của bản gốc đọc bằng `!== '0'` (không phải `=== '1'`): người đã dùng bản cũ **không có**
  key trong localStorage ⇒ vẫn BẬT như trước, không ai bị đổi hành vi sau khi cập nhật.
- Bấm nút ghi 1 dòng log (`⌨️ ĐÃ BẬT/TẮT…`) để người dùng biết mình vừa đổi gì.
- `tools/make-stable.mjs` không còn "thêm" nút nữa (nút đã có ở bản gốc) — chỉ còn **1 phép đổi
  mặc định**. Số thay đổi `[STABLE]` giảm 28 → 24, `npm run check` vẫn đối chiếu hai bản.

## §55 — XOÁ HẲN cơ chế "nhớ chat lỗi" (1.92.21)

### 55.1 Đã xoá những gì

| thứ bị xoá | chi tiết |
|---|---|
| bộ nhớ localStorage | mỗi ID lỗi từng được ghi thành **một khoá riêng** `SSB_CONFIRMED_UNAVAILABLE_CONV_ID_V1:<id>` + khoá JSON legacy |
| dọn quota | `pruneUnavailableKeys()` (dọn 2 800 khoá/lần khi localStorage đầy) — không còn gì để dọn |
| ghi nhớ / lọc | `rememberConfirmedSocketUnavailable()` và `isRememberedUnavailable()` giữ nguyên **tên hàm** để mọi chỗ gọi cũ không phải sửa, nhưng **luôn trả `false`** |
| UI | nút `🧹 Xóa nhớ lỗi (N)` + dòng hint "chỉ nhớ lỗi Socket xác nhận…" + handler xác nhận 2 lần + phần vẽ trạng thái nút |
| log | dòng `🧾 GHI NHỚ LỖI: thêm mới N ID …` ở cuối lượt |
| hành vi | lúc chốt danh sách gửi không còn vòng "tự bỏ tick ID đã nhớ" ⇒ **đúng những chat bạn tick là đúng những chat sẽ gửi** |

Khối bị xoá dài **105 dòng**, file gốc 10 840 → 10 735 dòng. `grep` toàn file: **0** lần còn
`unavailableConversationIds` / `unavailableAddedThisRun` / `clearRememberedUnavailableIds` /
`ssb-clear-unavailable`.

### 55.2 Vì sao bỏ là đúng (không chỉ vì người dùng muốn)

- Bộ nhớ này ghi **2 047 ID chỉ trong một lô** (§53) ⇒ localStorage phình, phải có cơ chế dọn quota
  riêng, mỗi lần dọn là một nhánh code có thể hỏng.
- **Không cải thiện tốc độ đo được**: chat vắng mặt vẫn bị loại ở lần gửi kế tiếp bằng phản hồi
  thật (Socket/Ext trả `1545041` trong ~0,9–1,4 s), trong khi bộ nhớ chỉ tiết kiệm đúng khoảng đó
  nhưng đổi lại là "danh sách tự co" mà người dùng không nhìn thấy.
- Nó tạo **trạng thái ẩn giữa các phiên**: cùng một danh sách tick, hôm nay gửi 500, mai gửi 450 mà
  không có dòng giải thích rõ ràng. Bỏ đi thì mọi thứ hiện trên màn hình.

### 55.3 Hệ quả cần biết

- Bản gốc **và** bản ổn định giờ hành xử giống nhau ở điểm này ⇒ `tools/make-stable.mjs` bỏ 3 phép
  thay thế (`no-filter`, `no-remember`, `hide-clear-btn`) và 1 phép log; số thay đổi `[STABLE]`
  giảm 24 → 20.
- Khoá cũ trong localStorage của người đã dùng bản trước **vẫn nằm đó** (script không đọc nữa).
  Muốn dọn sạch: DevTools → Application → Local Storage → xoá các khoá bắt đầu bằng
  `SSB_CONFIRMED_UNAVAILABLE_CONV_ID_V1:`.

## §56 — CHẠY NỀN: đồng hồ trong Web Worker (1.92.22)

### 56.1 Vì sao bản trước tụt tốc khi thu nhỏ cửa sổ

| giai đoạn | điều kiện | timer còn lại |
|---|---|---|
| bình thường | tab hiện, hoặc có âm thanh thật trong 30 s | đúng hẹn, sàn 4 ms |
| throttled | tab ẩn < 5 phút (hoặc chuỗi timer < 5) | **1 lần/giây** |
| intensive | ẩn > 5 phút + chuỗi timer ≥ 5 + im lặng | **1 lần/phút** |

WebSocket **không** được miễn (chỉ âm thanh thật và WebRTC được miễn) — nên việc Pancake có
socket chạy không cứu được gì. Đối chiếu với đường gửi của script:

| chỗ chờ | tab hiện | tab ẩn (bản ≤ 1.92.21) |
|---|---|---|
| `paceSocketPublish` (nhịp 4 ms/page) | 250 tin/s mỗi page | **~1 tin/s mỗi page** |
| `nextFrame()` (1 lần MỖI TIN) | ~16 ms | **~1 000 ms mỗi tin** |
| cổng wave (`setInterval` 60 ms) | 60 ms | 1 000 ms mỗi wave |
| đồng hồ soát tin nền (5 s) | 5 s | 60 s (⇒ chốt ⚠ oan/trễ đuôi) |
| hạn chờ ACK Socket | `ackWaitMs` | 60 s ⇒ kết quả không chốt, lane kẹt |

### 56.2 Đã làm (1.92.22)

**`bgClock`** — module nhỏ ngay sau `sleep`: tab **ẩn** thì mọi chỗ chờ đi qua `setTimeout`
**trong Web Worker** (Worker timer không bị bóp); tab **hiện** vẫn dùng `setTimeout` gốc
(chính xác nhất, không tốn IPC). Worker chỉ báo "đã tới giờ" — **không gửi, không quyết định
gì** ⇒ không thể sinh tin trùng. API: `wait(ms)` · `after(ms, fn)→huỷ` · `every(ms, fn)→dừng`.

Đã chuyển sang `bgClock`: `sleep`, `sleepUntil` (⇒ mọi `sleepUntil` trong file), `nextFrame`
(tab ẩn trả về NGAY — không có chu kỳ phím nào để chờ), nhịp phát Socket, `wsPoll` dò gid,
cổng wave, đồng hồ soát tin nền 5 s, **hạn chờ ACK Socket**, hạn chờ Extension trả gid,
nhịp "nguội" bắn lại Socket, hẹn bù (`buRetryTimer`), mốc mềm Extension, kiểm chứng sau
Socket/Ext, kiểm chứng "không rõ kết quả", hạn `fetch` (abort) và `fetchT`.

Thêm 2 lớp chống Chrome đóng băng tab: **Web Lock** giữ suốt lượt (Energy Saver không đóng
băng trang đang giữ lock) và **âm thanh giữ tab tỉnh** có sẵn — nay nếu Chrome chặn phát âm
thì tự thử `resume()` ở cú click/bấm phím kế tiếp thay vì bó tay.

### 56.3 Cách đọc dòng mới

Cuối mỗi lượt có dòng:

```
🫥 CHẠY NỀN: đồng hồ Worker ✓ (không bị bóp) · tab ẩn 87% số lần chờ · bị bóp 0 lần · không trễ thêm
```

- **`Worker ✓`** = đang chạy đúng cơ chế mới. `setTimeout (máy chặn Worker)` = CSP chặn Blob
  worker ⇒ quay lại đường cũ, phải giữ cửa sổ Pancake phía trước.
- **`bị bóp N lần`** = số lần một chỗ chờ ngắn (< 900 ms) thực tế kéo dài ≥ 900 ms — đây là
  con số ĐO ĐƯỢC của việc bị Chrome bóp, không phải suy đoán. Tab hiện thì luôn 0.

### 56.4 Những gì KHÔNG thể cứu từ userscript

| tình huống | userscript có cứu được? |
|---|---|
| Thu nhỏ cửa sổ / chuyển sang tab khác | ✅ đã cứu (Worker clock) |
| Cửa sổ bị che bởi cửa sổ khác nhưng không thu nhỏ | ✅ Chrome coi là "visible" — vốn đã không bị bóp |
| Chrome Memory Saver / Energy Saver đóng băng tab | ⚠ đỡ bằng Web Lock, không tuyệt đối |
| Máy sleep / gập laptop / tắt màn hình | ❌ không (cần Wake Lock mà spec tự nhả khi tab ẩn) |
| Đóng tab, đóng Chrome, kill trình duyệt | ❌ không — cần extension/service worker thật |
| Điện thoại khoá màn hình | ❌ không (hệ điều hành treo tab) |

Cách chạy nền chắc ăn nhất mà không phải sửa code: **mở Pancake ở một cửa sổ riêng, không
thu nhỏ** (che khuất vẫn tính là hiện). Nếu quen thu nhỏ: bản 1.92.22 giữ được tốc độ bằng
Worker; thêm `chrome://settings/performance` → tắt Memory Saver cho trang này nếu máy yếu.

## §58 — Vì sao lô 09:46 lặp tin, và đã bịt bằng gì (1.92.24)

### 58.1 Chuỗi nhân quả (đọc từ log, không suy đoán)

| # | số đo trong log | hệ quả |
|---|---|---|
| 1 | ACK TB **2 609 ms** · p50/p90 **2 490/3 086 ms** | nhịp ACK của page chậm hơn mọi lô trước (lô 20:28: p90 1 130 ms) |
| 2 | trần chờ ACK **cứng 3 000 ms** (`ackCeiling = 3000`) | hạn chờ **3 000 < p90 3 086** ⇒ **16 ca "no-ACK" OAN** — ACK chỉ chậm hơn 3 s, không hề mất |
| 3 | `need = 2`: 2 ca no-ACK liên tiếp (mỗi ca trượt đúng hạn chờ) | page bị tuyên bố **"ACK CHẾT"** (2 lần trong 5 s) ⇒ rút `maxReads` xuống 2 và đẩy kênh sang Extension |
| 4 | kiểm chứng đọc lịch sử **2 lần, cách nhau 2 s** | lịch sử Pancake trễ vài giây/vài phút ⇒ verdict `no` (chưa thấy tin) |
| 5 | `verdict === 'no'` ⇒ **`scheduleBuRetry` bắn cứu 1 vòng qua Extension** | **9 ca "✅ bù THÀNH CÔNG"** = khách nhận **2 lần** nếu tin Socket đã tới |

Tổng hợp lô: ✅ 166/188 (88,3 %) · ❌ 17 · ⚠ 5 · **Bù OK 9 (Kiểm chứng ACK: 9)** · kiểm chứng
"đã đến nơi 0 · bắn cứu 11 · không kiểm chứng được 5". Chính con số **bắn cứu 11 → bù OK 9** là
bằng chứng gửi trùng: 9 tin được cho là "chưa đi" rồi gửi lại lần hai.

### 58.2 Đã sửa

1. **BỎ HẲN nhánh "bắn cứu" sau kiểm chứng** (cả Socket no-ACK và API timeout/5xx).
   `verdict === 'no'` ⇒ **giữ ⚠, không gửi lại**. Kiểm chứng chỉ còn **một** quyền: nâng ⚠ → ✅.
   Đây đúng luật đã đặt từ đầu nhưng code còn vi phạm: "no-ACK nghĩa là frame ĐÃ giao cho
   socket, chỉ mất phản hồi ⇒ 'đọc 2 lần không thấy' KHÔNG chứng minh được là chưa đi".
2. **Trần chờ ACK bám số đo:** `ackCeiling = clamp(p90 × 1,6, 3000, 6000)` thay cho hằng
   `3000`. p90 nhỏ (HAR 256 ms) ⇒ vẫn 3 000 ms y như cũ; p90 lớn như lô này (3 086) ⇒ 4 938 ms
   ⇒ hết no-ACK oan.
3. **Kết luận "ACK chết" khó hơn:** `need` 2 → **3** ca no-ACK liên tiếp đủ hạn chờ.
4. **Bỏ nhánh "page ACK chết ⇒ rút còn 2 lần đọc"**: đọc lịch sử giờ chỉ để nâng ⚠→✅ nên đọc
   thêm không thể gây trùng, chỉ cứu thêm ca ACK trễ thật. Mọi page đọc cùng số lần (3–4).
5. Dòng TỔNG HỢP đổi `bắn cứu N` → **`giữ ⚠ (không bắn lại) N`** để log không còn cổ vũ hành vi
   gửi lại.

### 58.3 Giá phải trả (nói trước)

Ca socket chết ngầm **thật** (frame không tới FB) giờ nằm ở **⚠** thay vì được cứu bằng Extension.
Đây là lựa chọn có chủ ý: thà mất một tin còn hơn khách nhận hai lần. Nếu sau này muốn cứu nhóm
đó thì phải có bằng chứng **dương** (ví dụ lịch sử có mốc nước rỗng **mà** thread đã được server
làm mới), không được suy từ "chưa thấy tin".

## §59 — AUDIT LẠI TOÀN BỘ "PHÂN XỬ KẾT QUẢ GỬI" (1.92.25)

Mục tiêu: **không còn chỗ nào kết luận mà không có bằng chứng** ("phán tù mù"). Dưới đây là
bằng chứng đọc lại từ 12 HAR trong repo + bundle `_app-*.js`, rồi đối chiếu từng điểm quyết định
trong script. Mọi số liệu đều đếm được, không suy đoán.

### 59.1 Bằng chứng từ HAR — đường HTTP (⚠ ĐÃ SỬA SỐ ở §61.1)

> **ĐÍNH CHÍNH (1.92.27).** Bảng dưới đây ở bản đầu đếm **303** request vì lọc theo
> `POST …/messages*`, tức là **gộp cả hai endpoint phụ** `…/messages/fill_admin_name` (152) và
> `…/messages/load_shop_page_customers` (93) — hai endpoint này cũng trả `{success:true}` /
> `{success:true, customers…}` / `status 0` / `body rỗng`, nên các dòng 1, 2, 7, 8 là **sai
> nguồn**. Endpoint gửi tin THẬT chỉ có **58** request, và 58/58 đều `status 200` với đúng
> 3 dạng: 23 `success:true`, 24 `#10`, 11 `#551`. Bảng đúng ở §61.1; phần kết luận bên dưới
> không đổi (vẫn đúng với 58 mẫu thật).

Tổng **303** request "có đuôi `/messages*`" (58 gửi tin + 245 endpoint phụ), 8 dạng phản hồi:

| # | dạng phản hồi | số ca | kết luận ĐÚNG |
|---|---|---|---|
| 1 | `{success:true}` | 153 | ✅ đã gửi (phần lớn là endpoint phụ — xem đính chính) |
| 2 | `{success:true, customers…, reports_by_phone…}` | 68 | ✅ đã gửi (endpoint `load_shop_page_customers`) |
| 3 | `{success:true, id:"m_…", original_error:null}` | 19 | ✅ đã gửi (có cả id tin của FB) |
| 4 | `{success:true, id:"m_…"}` | 4 | ✅ đã gửi |
| 5 | `{success:false, e_code:10, e_subcode:2018300, message:"(#10) …ứng dụng khác…kiểm soát thread"}` | 24 | ❌ CHẮC CHẮN chưa đi (FB từ chối) |
| 6 | `{success:false, e_code:551, e_subcode:1545041, message:"(#551) Người này hiện không có mặt."}` | 11 | ❌ chắc chắn chưa đi, khách chết |
| 7 | `status=200` nhưng **body RỖNG** | 10 | ⚠ KHÔNG RÕ (endpoint phụ — KHÔNG có ca nào ở endpoint gửi) |
| 8 | `status=0`, `net::ERR_ABORTED` | 14 | ⚠ KHÔNG RÕ (endpoint phụ — KHÔNG có ca nào ở endpoint gửi) |

Ba điều đáng chú ý:
- `original_error` xuất hiện 19 lần và **luôn là `null`** ⇒ success:true không giấu lỗi.
- Ở **endpoint gửi thật** (58 ca) không hề có status 0 / body rỗng / non-JSON ⇒ hai dạng
  "không rõ" vẫn phải giữ trong code (mạng có thể hỏng), nhưng chưa từng thấy trong HAR.
- Ảnh hưởng tới logic: **không có**. `classify` của script xét `success:true` / `e_code` /
  "không rõ" độc lập với tên endpoint, nên việc bảng cũ gộp endpoint không làm sai phân xử —
  chỉ làm sai *số liệu dẫn chứng*.

### 59.2 Bằng chứng từ HAR — đường Socket (`/ls_req` → `/ls_resp`)

Giải mã 97 khung `/ls_resp` (base64 → JSON, `payload` lồng JSON): **chỉ có 1 khung liên quan
đến gửi tin**, và nó là **thất bại**:

```
payload.step = … taskExists → markOptimisticMessageFailed("7522294945565959207", "Không gửi được.")
                … updateSubscriptErrorMessage(<khách>, <otid>, "Không gửi được.")
```

Số khung có `replaceOptimsiticMessage` (dấu hiệu THÀNH CÔNG): **0**. Nghĩa là HAR **không** có
mẫu thành công của Socket ⇒ không thể tự suy ra hình dạng "success", phải đọc code của chính app.

### 59.3 Chuẩn phân xử của CHÍNH PANCAKE (`_app-*.js`, offset ~833 035)

Nguyên văn logic app dùng cho gửi qua socket:

```js
let g = await this.publish(e, '/ls_req', f, 3);
if (!(g?.payload)) return { success: false };                       // mất ACK ⇒ app coi là THẤT BẠI
let _ = JSON.parse(g.payload);
let y = findAllBlockActions(_.step, 'replaceOptimsiticMessage');     // tin được thay thế (kèm otid)
let b = findAllBlockActions(_.step, 'markOptimisticMessageFailed');  // tin bị đánh dấu hỏng
if (b?.length > 0 && y?.length == 0) return { success: false, response: _ };
if (!(y.length > 0)) return { success: true, … };                    // KHÔNG có replace ⇒ app vẫn coi là THÀNH CÔNG
… chờ tối đa 10 s khung insertMessage khớp otid … không thấy VẪN success: true
```

⇒ `classify()` của script đang bám **đúng** chuẩn này (kể cả nhánh "không thấy dấu hiệu gì ⇒ ✅"),
nên đó **không phải** phán đoán tự chế. Khác biệt duy nhất — và là khác biệt có lợi cho người
dùng: app coi "mất ACK" là THẤT BẠI, còn script coi là **KHÔNG RÕ** và không bao giờ gửi lại.

App còn cho thấy một **kênh bằng chứng dương** nữa (offset ~923 439): `processMessage` giữ
`pendingSendMessages[otid]` và resolve khi có khung `replaceOptimsiticMessage` mang **otid của
chính mình** (bất kỳ khung nào, không nhất thiết `/ls_resp`). Đây là hướng nâng ⚠→✅ rẻ nhất
cho tương lai (ghi lại để làm sau, chưa đưa vào bản này).

### 59.4 Bằng chứng từ HAR — API lịch sử (dùng cho kiểm chứng)

91 response `GET …/messages` có mảng tin; **mọi** object tin có cùng một shape:

| trường | giá trị thật | hệ quả cho `historyVerdict` |
|---|---|---|
| `inserted_at` | `"2026-10-19T10:10:19.000000"` — **UTC không kèm Z**, 6 chữ số lẻ | phải `+ 'Z'`; **đã kiểm chứng** `Date.parse` của V8 nhận đúng dạng 6 chữ số (trả về `.000Z`) |
| `from.id` (tin của shop) | `"769625892902516"` = **đúng id page** | so `String(m.from.id) === String(pageId)` là chính xác |
| `from.id` (tin của khách) | `"39224298167184827"` = PSID khách | không bị nhầm là tin page |
| `message` | HTML: `"<div>Áo shop SALE 30%…</div>"`, tin ảnh là `"<div></div>"` + `attachments` | `normalizeMsgText` bóc tag; ảnh khớp qua `attachments` |
| `is_removed` | có | tin thu hồi bị loại |

**Không đọc được gì từ HAR về độ trễ của lịch sử** (HAR không có mốc "tin vừa gửi xuất hiện ở
lần đọc nào") ⇒ mọi ngưỡng thời gian ở đây đều là **cửa sổ an toàn**, không phải bằng chứng.

### 59.5 Bằng chứng về LỆCH ĐỒNG HỒ

Header `Date` có mặt ở **2 283/2 368** response cùng origin. So `Date` với thời điểm nhận
(`startedDateTime + time`) trên chính bộ HAR đó: p50 **+1,9 s**, p90 **+10,8 s**, và có những
entry lệch tới **hàng chục giây** (máy chỉnh giờ sai / nhiều máy trộn trong HAR).

⇒ Mọi phép so `inserted_at` (đồng hồ server) với `publishedAt` (đồng hồ máy) **phải hiệu chỉnh
lệch**, và **không được dùng phép so đó để kết luận "chưa đi"**.

### 59.6 Từng điểm quyết định trong script

| # | chỗ quyết định | bằng chứng dùng | khi KHÔNG có bằng chứng | trạng thái |
|---|---|---|---|---|
| 1 | HTTP `success===true` | body JSON (244 ca HAR) | — | ✅ đúng |
| 2 | HTTP `success===false` + `e_code` | #10 (24) / #551 (11) | — | ✅ chắc chắn chưa đi ⇒ bù kênh khác an toàn |
| 3 | HTTP body rỗng / `ERR_ABORTED` / 408 / 499 / ≥500 | không có | ⚠ không rõ, không gửi lại | ✅ đúng |
| 4 | Socket `markOptimisticMessageFailed` & không `replace` | 1 khung HAR + code app | — | ✅ chắc chắn chưa đi ⇒ bù an toàn |
| 5 | Socket không payload / JSON hỏng | — | ⚠ `noack` | ✅ đúng |
| 6 | Socket có cờ lỗi & không `replace` | code app | ⚠ `noack` | ✅ đúng (v1.92.18) |
| 7 | Socket "không thấy dấu hiệu gì" ⇒ ✅ | **chuẩn của chính app** (§59.3) | — | ✅ giữ nguyên (không phải phán đoán tự chế) |
| 8 | Socket ảnh+chữ: chữ OK, ảnh bị từ chối | `replace`+`failed` cùng có | — | ✅ tách riêng phần ảnh |
| 9 | Socket `dead` trước khi publish | socket không kết nối | — | ✅ bù an toàn |
| 10 | Kiểm chứng lịch sử: khớp nội dung ⇒ ✅ | tin page + đúng chữ + cửa sổ giờ | — | ✅ chỉ nâng cấp |
| 11 | Kiểm chứng lịch sử: **không** khớp | — | trước 1.92.25: **'no' ⇒ bắn cứu** | 🔴→ đã bỏ cả 'no' lẫn bắn cứu |
| 12 | Ext `success:true` | response | — | ✅ |
| 13 | Ext `success:false` CÓ lý do | `errorDescription` / `fbErrorCode` | — | ✅ chắc chắn chưa đi |
| 14 | Ext `success:false` KHÔNG lý do / exception | — | ⚠ timeout, kiểm chứng nền | ✅ |
| 15 | Ext trả lời MUỘN | response muộn | — | ✅ chỉ nâng ⚠→✅ |
| 16 | Watchdog 180 s hết hạn chờ nền | — | ⚠ không rõ (không ❌) | ✅ |

### 59.7 Đã sửa trong 1.92.25

1. **BỎ HẲN kết luận `'no'`** trong `historyVerdict`. Hàm giờ chỉ trả `'yes'` (bằng chứng dương)
   hoặc `'unknown'`. Lý do: `'no'` là phép so **hai đồng hồ khác nhau** (§59.5) cộng giả định
   "lịch sử cập nhật ngay" — không phải bằng chứng. Chính nó là mắt xích của chuỗi gửi trùng §58.
2. **Đo lệch đồng hồ** bằng header `Date` (`noteServerClock`, làm trơn EMA 0,8/0,2) và **hiệu
   chỉnh** mọi mốc so sánh trong `historyVerdict` ⇒ khớp `'yes'` đúng cả khi máy chỉnh giờ sai.
   Không đo được ⇒ 0 (hành vi như cũ).
3. Bỏ 2 nhánh `verdict === 'no'` + biến `noStreak` ở cả hai đường kiểm chứng; nhánh "không chứng
   minh được" giờ là đường duy nhất và luôn **giữ ⚠, không bắn lại**.
4. Test: 12 → **14 kịch bản**, thêm ca "không bao giờ trả 'no'" và ca "lệch đồng hồ 60 s vẫn khớp
   đúng tin của mình". `npm test` = 14/14.

### 59.8 Điều KHÔNG chứng minh được (ghi lại để không ai tự tin quá)

- **Chưa có mẫu `/ls_resp` thành công** trong 12 HAR ⇒ không thể chứng minh "không có
  `markOptimisticMessageFailed` ⇒ tin đã tới". Ta chỉ biết nó khớp chuẩn của app. Vì vậy đường
  an toàn (⚠ + kiểm chứng chỉ nâng cấp) là bắt buộc, không phải tuỳ chọn.
- **Độ trễ cập nhật lịch sử của Pancake** không đo được từ HAR ⇒ mọi ngưỡng giờ ở đây là cửa sổ
  an toàn.
- Muốn có bằng chứng dương thật cho Socket: bắt khung `replaceOptimsiticMessage` mang **otid của
  mình** (§59.3) — hướng đã xác định, chưa làm.

## §60 — LÔ 10:04 (2 413 chat, 1.92.25): đọc số ra lỗi gì (1.92.26)

Log do người dùng gửi, **chưa sửa gì**. Việc đầu tiên: cộng lại xem các con số có khớp nhau
không, vì số không khớp là dấu hiệu code đếm sai chứ không phải khách chết.

### 60.1 Đối chiếu số (tất cả khớp tới từng đơn vị)

| phép tính | kết quả | nghĩa |
|---|---|---|
| ACK OK + rejected = 1 501 + 1 722 | **3 223** | số lệnh socket THỰC SỰ đã phát |
| 2 413 (chat) + 861 (`retry wave`) | **3 274** | 3 274 − 3 223 = **51** ⇒ 51 chat KHÔNG hề phát lệnh nào |
| 1 722 rejected = 861 × 2 | **861 lần thử lại, cứu 0** | mọi lần thử lại đều bị từ chối y hệt |
| ❌ 912 = 861 + 51 | **912** | "912 lỗi" thực chất = 861 bị FB từ chối + 51 bị bỏ sót |

⇒ Hai bệnh, cả hai đều là lỗi của script:

1. **51 chat (2,1%) không được gửi ở bất kỳ kênh nào.** Log ghi `gate bỏ Ext no-gid 51`,
   `🌐 API NỀN queued/started/fetch 0/0/0 · fallback 0`. Nguyên nhân: gate `gidGateSkipExt`
   trong `sendOne` (nhánh `dynamicDirect`) **return ❌ ngay** khi server/Batch/WS/Ext đều
   không có `global_id`, mà KHÔNG thử làn API — dù HAR đã chứng minh lệnh gửi API chỉ dùng
   `conversation_id` (§59.1: 58/58 request gửi không có `global_id`). Đường cứu `apiNoGidFallback`
   trong `sendDirect` không bao giờ chạy ở chế độ wave vì wave gọi `awaitDirect: true`.
2. **861 lần thử lại vô ích** — 27% lưu lượng socket (3 223 thay vì 2 413), 861 dòng log,
   861 ACK phải phân tích, và `retryBacklog > 80` **chặn cổng mở wave** (`evaluateGate`) nên
   trực tiếp làm lô chậm (wave→cổng TB 5 542 ms).

### 60.2 Đã sửa (1.92.26)

1. **Gate no-gid → đi làn API thay vì bỏ.** Còn làn API dùng được (`!batchSkipApi`,
   page chưa bị chặn, không phải comment, ảnh đã có `fbId`) thì `seq` được thêm `'api'` và
   đưa lên đầu; log `🛟 … chuyển làn API bằng conversation_id`. Chưa bắn gì trước đó ⇒
   **không thể trùng**. Chỉ khi API cũng không dùng được mới trả ❌ như cũ.
2. **Ngân sách thử lại Socket — tự đo, tự đóng** (`sockRetryBudgetAllows` / `sockRetryBudgetNote`,
   dùng chung cho **cả hai** đường thử lại: `finalizeSockBg` và `pushToSocketRetry`):
   * chưa thử đủ **40** ca ⇒ thử lại như cũ;
   * đã thử ≥ 40 ca, **cứu được 0**, và tỉ lệ FB từ chối trong khoảng **10–70%** ⇒ **đóng** ngân sách:
     ca sau chốt ❌ ngay với log `KHÔNG thử lần 2 (đã thử N ca, cứu được 0)`;
   * đã đóng vẫn **dò lại 1 ca mỗi 200 ca bị bỏ**; cứu được 1 ca là **mở lại** toàn bộ
     (tỉ lệ từ chối thấp = burst cục bộ, hoặc > 70% = burst/sự cố toàn phần ⇒ **không bao giờ
     đóng**, vì đó đúng là lúc cần thử lại nhất).
   * reset mỗi lượt (`resetSockRetryBudget`).
   Với lô 10:04: 40 lần thử + ~4 lần dò thay vì 861 ⇒ **bớt ~820 lệnh socket (−25% lưu lượng)**,
   bớt 820 dòng log, và `retryBacklog` không còn giữ cổng wave.
3. **Báo cáo trung thực hơn:** dòng TỐC ĐỘ tách `unavailable A + bỏ thử lần 2 B (cùng nhóm,
   đã đo 0 cứu được)`; mục tiêu tính theo cả A+B ⇒ `1501/1553 = 96,7%` vẫn đọc được, thay vì
   trộn 860 khách chết của FB vào "62,2%" như trước. Dòng SOCKET in thêm `bỏ thử lần 2 (ngân sách)`,
   dòng API in thêm `cứu thiếu globalId`.
4. Test: 14 → **23 kịch bản** (thêm 9 ca cho ngân sách: đóng đúng lúc, không đóng khi tỉ lệ
   thấp, không đóng khi từ chối 95%, mở lại khi cứu được, dò lại 1/200, không chặn khi không
   có ngân sách).

### 60.3 Điều KHÔNG sửa trong lượt này (và vì sao)

* **Tốc độ 59,73 lệnh/s** không phải do cổng wave: cổng chỉ mở khi 40% wave xong, nên
  "wave→cổng 5,5 s" là *hệ quả* của tốc độ xử lý mỗi chat (~36–60/s), không phải nguyên nhân.
  Muốn vượt phải đo riêng: chi phí main-thread cho mỗi khung `/ls_resp` (mỗi khung chứa hàng
  chục action) so với chi phí `publish`. Chưa có số đo ⇒ chưa đổi pacing (§59.8: không đoán).
* Tỉ lệ 96,7% trong log là **trên phần khả thi**, không phải 96,7% khách hàng thật.

## §61 — SOÁT 50 ĐIỂM TRƯỚC KHI TEST THỰC TẾ (1.92.27)

Soát lại **toàn bộ 12 HAR** trong repo + đọc lại từng nhánh quyết định trong script. Mỗi dòng
dưới đây là một phép kiểm tra đã **chạy thật** (script đếm trên HAR) hoặc **đọc code đối chiếu**
và ghi rõ kết quả. 7 điểm ✗/⚠ đã được sửa ngay trong 1.92.27.

### 61.1 Nhóm A — số liệu HAR (A1–A28)

| # | điểm kiểm tra | kết quả |
|---|---|---|
| A1 | số lệnh gửi tin THẬT (`POST …/conversations/<id>/messages`) | **58** (bản cũ ghi 303 — sai vì gộp 245 request của `fill_admin_name` + `load_shop_page_customers`) ✗→đính chính §59.1 |
| A2 | status của 58 lệnh gửi | 200 × 58 (không có 0/4xx/5xx) |
| A3 | `{success:true, id}` | 23 |
| A4 | `{success:true, id, original_error}` | 19 — `original_error` **luôn null** |
| A5 | `e_code 10 / sub 2018300` | 24 |
| A6 | `e_code 551 / sub 1545041` | 11 |
| A7 | body rỗng / ERR_ABORTED ở endpoint gửi | **0** (10 + 14 ca thuộc endpoint phụ) ✗→đính chính |
| A8 | request gửi có `global_id`? | **0/58** ⇒ làn API không cần global_id ✔ (cơ sở của bản sửa 1.92.26/27) |
| A9 | request gửi có `from_psid`? | 0/58 |
| A10 | `action` | `reply_inbox` × 58/58 |
| A11 | `send_by_platform` | `web` × 58/58 |
| A12 | multipart / JSON | 52 / 6 |
| A13 | cờ `is_record_ctx_7_days` × kết quả | có cờ: 19 OK + 5 ×#551 · không cờ: **24 ×#10** + 4 OK + 6 ×#551 ⇒ #10 **chỉ** xảy ra khi thiếu cờ (24/24) ✔ khớp chú thích `buildInboxSend` |
| A14 | request gửi ảnh | có `content_id`/`attachment_id`/`content_url`/`width`/`height` ✔ khớp `buildInboxSend` |
| A15 | URL lịch sử script dùng | `?customer_id&user_view=true&is_new_api=true&separate_pos=true` — đúng một dạng có trong HAR ✔ |
| A16 | số tin mỗi response lịch sử | min 1 · p50 11 · **max 25** ⇒ API trả cửa sổ tối đa 25 tin (không phân trang) |
| A17 | shape message trong lịch sử | 1 311 tin · **1 shape duy nhất** |
| A18 | `inserted_at` | `YYYY-MM-DDTHH:MM:SS.ffffff` — **không Z, không offset**, 100% mẫu ✔ `+ 'Z'` là đúng |
| A19 | `type` | INBOX 1 305 · COMMENT 6 ⇒ phải lọc COMMENT khi chốt "đã gửi" ✗→sửa |
| A20 | `from.id == pageId` cho tin của page | 1 230/1 230, không lẫn tin khách ✔ |
| A21 | tin khách có `from.uid == pageId` (gây nhầm) | 0/81 ✔ |
| A22 | attachment trong lịch sử | 230 mẫu nhưng **KHÔNG có trường `id`**; có `image_data{width,height}` 161 · ad 55 · comment 4 · khác 10 ⇒ không thể khớp ảnh bằng id ✗→sửa (khớp theo width×height) |
| A23 | thứ tự mảng lịch sử | tăng dần 89/89 response ⇒ phần tử cuối là tin mới nhất |
| A24 | `Date` header | 2 312 response; lệch p50 **+1,95 s** · p90 **+14,1 s** · max 15,1 s · **min −351 388 961 ms = RÁC** ✗→sửa (chặn mẫu rác) |
| A25 | khung WebSocket | 225 khung: `ls_resp` 98 · `ls_req` 46 · khác 81 |
| A26 | `ls_resp` parse được payload thật | 96/98 · `markOptimisticMessageFailed` **1** · `replaceOptimsiticMessage` **0** |
| A27 | khung thất bại có gì | `taskExists[19,"1"]` + `markOptimisticMessageFailed(<otid>, "Không gửi được.")` + `updateSubscriptErrorMessage` |
| A28 | publish của app có `otid` không | CÓ (`/ls_req`: `otid`, `thread_id`, `send_type`, `sync_group 205`) ⇒ **khớp otid là hướng chốt ✅ dương tính thật** (chưa làm) |

### 61.2 Nhóm B — logic phân xử (B1–B22)

| # | điểm kiểm tra | kết quả |
|---|---|---|
| B1 | `historyVerdict` chỉ trả `yes`/`unknown` | ✔ (test 13: 0 ca trả `no`) |
| B2 | khớp chữ theo kiểu "chứa" | ✗ tin ngắn (`Dạ`, `Ok`) khớp bừa mọi tin khác ⇒ **sửa: đúng-bằng, hoặc "chứa" khi ≥ 20 ký tự** |
| B3 | lọc `type` khi chốt | ✗ trước đây nhận cả COMMENT ⇒ **sửa: chỉ INBOX** |
| B4 | khớp ảnh | ✗ trước đây "có attachment là ✅" ⇒ **sửa: khớp id hoặc width×height; thiếu dữ kiện ⇒ unknown** |
| B5 | mốc `minTime` | `max(batchStart−3 s, atServer−5 s)` — không nhìn lùi quá lượt trước ✔ |
| B6 | hiệu chỉnh lệch đồng hồ | ✔ dùng `serverSkewMs`, nhưng ✗ **không chặn mẫu rác** ⇒ **sửa: |skew| > 120 s bị bỏ** |
| B7 | mẫu lệch có được lấy trên đúng đường verify | ✔ (verify gọi `fetchJson` → `noteServerClock`) |
| B8 | verify có bắn lại bao giờ chưa | ✔ không: chỉ nâng ⚠→✅ (test 14) |
| B9 | `classify` socket khớp chuẩn app | ✔ `failed && !replaced ⇒ rejected`; có `replaced` ⇒ ok; giống hệt app (§59.3) |
| B10 | ảnh + chữ: chữ OK mà ảnh bị từ chối | ✔ `photo_failed_text_ok` (chỉ bắn bù phần ảnh) |
| B11 | `noack` (mất ACK) | ✔ ⚠ + verify nền, **không** bắn lại |
| B12 | cờ lỗi trong payload mà không có `replace` | ✔ `noack` (từ 1.92.18) |
| B13 | gate no-gid ở nhánh `dynamicDirect` | ✗ trước đây **bỏ chat** ⇒ **sửa: đi làn API** |
| B14 | gate no-gid ở `sendViaExtension` | ✗ trước đây plan `['ext','socket']` kết thúc ❌ ⇒ **sửa: vòng lặp tự thêm `api`** |
| B15 | gate no-gid chạy TRƯỚC khi acquire outbound? | ✔ có (cả Ext và Socket đều return trước khi giữ khóa) ⇒ thêm `api` không thể trùng |
| B16 | fallback API tôn trọng chặn | ✔ `batchSkipApi`, `isApiBlockedForPage`, comment, ảnh thiếu `fbId` |
| B17 | ngân sách thử lại Socket | ✔ 40 ca · 0 cứu · 10–70% ⇒ đóng · dò 1/200 · cứu được ⇒ mở (test 15–19) |
| B18 | ngân sách dùng chung 2 đường (bắn-nhả & sync) | ✔ `sockRetryBudgetState` ở phạm vi module, reset mỗi lượt |
| B19 | đường bỏ thử lại (bắn-nhả) có đếm trùng không | ✔ không: wave đã đếm khi `fired`, nhánh này chỉ chốt ❌ + nhả khóa |
| B20 | đường bỏ thử lại (sync) | ✔ có `done++/fail++` + `releaseOutbound` + `clearBgPending` (đường này chưa đếm ở `sendOneAndLog`) |
| B21 | `eligibleAfterUnavailable` | ✔ `max(0, total − unavailable − bỏ thử lần 2)`, không âm, không chia 0 |
| B22 | HTTP "không rõ" | ✔ `ERR_ABORTED`/408/499/5xx/body rỗng ⇒ `sent:'maybe'` ⇒ không bù, không gửi thêm |

### 61.3 Nhóm C — đường Ext / watchdog / bù (C1–C8)

| # | điểm kiểm tra | kết quả |
|---|---|---|
| C1 | Ext `success:true` | ✅ |
| C2 | Ext `success:false` CÓ lý do | ❌ chắc chắn chưa đi ⇒ bù kênh khác |
| C3 | Ext `success:false` KHÔNG lý do (adapter hết giờ) | ⚠ + kiểm chứng nền |
| C4 | Ext văng exception giữa chừng | ⚠ `sent:'maybe'` — không kênh nào bắn lần 2 |
| C5 | Ext trả lời MUỘN | chỉ nâng ⚠→✅, không gửi lại |
| C6 | watchdog chờ nền hết hạn | ⚠ (không bao giờ ❌) |
| C7 | `scheduleBuRetry` có chống bù chồng | ✔ `buRetryTimer` + `sockFiredPending` |
| C8 | bù chỉ dùng kênh CHƯA thử | ✔ `triedChannels` loại kênh đã thử |

### 61.4 Việc còn để ngỏ (không sửa lần này)

1. **Chốt ✅ dương tính thật bằng `otid`** (A27/A28): publish của ta đã sinh `otid` cho từng task,
   và khung `/ls_resp` mang đúng `otid` đó khi FB thay thế / đánh dấu hỏng. Bắt khung
   `replaceOptimsiticMessage(<otid của ta>)` ở **mọi** `/ls_resp` sẽ là bằng chứng dương tính
   tuyệt đối, thay cho suy luận "không có dấu hiệu lỗi ⇒ ✅". Cần hook vào luồng frame của
   `__MqttHelper__` ⇒ làm thành bản riêng, có test, không gộp vào lượt này.
2. **Cửa sổ 25 tin của API lịch sử** (A16): chưa biết chắc trả 25 tin *mới nhất* hay *cũ nhất*.
   Nếu là cũ nhất thì verify sẽ luôn `unknown` cho chat dài (an toàn, không sai) — cần log
   `số tin đọc được + tuổi tin mới nhất` để kết luận bằng số.
3. **Tốc độ**: chưa có số đo chi phí main-thread/khung `/ls_resp`, nên chưa đổi pacing (§60.3).

## §62 — SOÁT LẠI "CƠ CHẾ XÁC NHẬN TIN" + LÔ 10:21 (1.92.28)

Yêu cầu: *"để không bù lung tung thì cơ chế xác nhận tin phải đúng"*. Vì vậy lần này soát
**mọi đường có thể sinh ra bù** (gửi thêm), không chỉ đường Socket.

### 62.1 Bốn đường có thể bù — và điều kiện thật của từng đường

| # | chỗ gọi | điều kiện vào | có bằng chứng "chắc chắn CHƯA gửi"? |
|---|---|---|---|
| 1 | `fireApiAndWatch` (lõi) | `certainFail = isCertainHttpNotSent(status, data, parsed)` | ✅ có (và `releaseOutbound` trước khi bù) |
| 2 | `scheduleBuRetry` (kênh kế) | sau khi kênh trước trả `sent === false` | ✅ có (mỗi kênh đúng 1 lần) |
| 3 | `finalizeSockBg` (bắn-nhả) | `!recipientUnavailable && sent === false` | ✅ có |
| 4 | **bù nền qua extension/background** (`BOTFAKE_BG_FALLBACK`) | nhánh `else if (r && !r.ok)` | 🔴 **KHÔNG** — nhánh này bao gồm cả `r.uncertain` |

### 62.2 Lỗ hổng tìm thấy (đã sửa)

`sendOne(...)` trả `{ok:false, uncertain:true, sent:'maybe'}` khi socket mất ACK / Ext quá hạn —
tức **tin CÓ THỂ đã đi**. Nhưng ở đường bù nền, `!r.ok` đúng với cả trường hợp này, nên script
vừa log ⚠ vừa gọi `scheduleBuRetry` ⇒ **gửi thêm trong khi tin có thể đã tới**. Hai lớp bảo vệ
khác không cứu được vì ở đường này `uncertainIds` chưa được ghi và `sockFiredPending` không dùng
(đường đồng bộ, không bắn-nhả).

**Nay**: nhánh `r.uncertain` riêng — ghi `uncertainIds`, log ⚠, **không gửi thêm**. Mọi đường bù
khác từ đó cũng tự chặn (scheduleBuRetry kiểm `uncertainIds` ở cả 3 thời điểm: lúc gọi, lúc
timer chạy, và ngay trước khi bắn trong lane).

### 62.3 Sáu sửa đổi của 1.92.28

1. **Chặn bù khi "không rõ"** ở đường bù nền (§62.2).
2. **Ngân sách thử lại Socket đo trên 200 ACK GẦN NHẤT** thay vì tỉ lệ tích luỹ. Lô 10:21:
   tích luỹ đầu lô > 70% (mấy wave đầu nhiều khách chết) ⇒ ngân sách chỉ đóng sau **657** lần
   thử (lẽ ra ~40). Luật mới: < 15% (lô sạch) hoặc > 85% (burst/sự cố) ⇒ **không đóng**;
   15–85% ⇒ đóng đúng ở ca thứ 40; vẫn dò lại 1 ca/200 và mở lại ngay nếu cứu được.
   Log khi bỏ in kèm `% từ chối gần đây` để lần sau đọc là hiểu.
3. **Bỏ dòng 🛟 lặp**: nhánh chuyển làn API (1.92.27) rơi tiếp xuống khối cứu cũ ⇒ 2 dòng/ca
   (481 ca ở lô 10:21). Nay đánh dấu `apiNoGidDone`.
4. **Hết đếm đôi ở dòng `🔎 Kiểm chứng`**: trước đây cùng một ca tăng cả `held` và `unknown`
   nên in "giữ ⚠ 5 · không kiểm chứng được 5" cho 5 ca.
5. **Đếm cả lệnh API gọi trực tiếp**: lô 10:21 có **481** lệnh API thật mà dòng `🌐 API NỀN`
   vẫn in `queued/started/fetch 0/0/0` (chỉ đường nền được đếm) ⇒ số liệu vô dụng.
6. **Đo AI GIỮ CỔNG WAVE**: thêm 4 bộ đếm `giữ cổng (bay/retry/ext/api)`. Lô 10:21 có
   `wave→cổng TB 6,8 s · max 22,96 s` nhưng không biết ai giữ ⇒ lần sau đọc số, không đoán.

### 62.4 Đối chiếu lô 10:21 (12 407 chat) — sổ sách khớp 100%

| phép tính | kết quả |
|---|---|
| ✅ 7 215 + ❌ 5 187 + ⚠ 5 | **12 407** ✓ |
| 12 407 − 481 (không publish được qua Socket) + 657 (thử lại) | **12 583** = ACK OK 7 215 + rejected 5 363 + no-ACK 5 ✓ |
| rejected 5 363 − 657 | **4 706** = 4 049 (ngân sách) + 657 (đã thử) ✓ |
| ❌ 5 187 = 4 706 + 481 | ✓ |

Nhận xét đo được:
- **67,67 lệnh/s** (lô trước 59,73/s).
- `cứu thiếu globalId 481` — đường rò "thiếu global_id" đã bịt; **0/481** gửi được (dòng ✅ chỉ
  có `[Socket: 7 215]`) ⇒ 481 ca đó đúng là khách không nhận được, không phải script bỏ sót.
- Thử lại vô ích: 657/12 583 = **5,2%** lưu lượng (lô trước 27%) — và 1.92.28 kéo xuống ~0,3%.
- `#551` của API **vẫn không** bị coi là "khách chết" (có bằng chứng ngược: log 07:36, API trả
  #551 rồi Ext gửi được) ⇒ giữ nguyên, đúng luật "không kết luận khi chưa đủ".

### 62.5 Test

14 → 23 → 33 → **42 kịch bản** (`npm test`): thêm cửa sổ 200 ACK (chỉ tính 200 ca gần nhất,
nửa OK nửa rejected = 50%, reset = -1), luật đóng ngân sách (-1 / 12% / 40 ca ở 50% / ghi %).

## §63 — KIỂM CHỨNG TIN: VÌ SAO 0/27 RỒI SỬA THẾ NÀO (1.92.29)

### 63.1 Đo trên 12 HAR (3 cách độc lập, khớp nhau)

`GET /v1/pages/{pid}/conversations/{cid}/messages?customer_id=…` trả **25 tin CŨ NHẤT**:

| cách kiểm | số đo |
|---|---|
| thứ tự trong response | **89/89 tăng dần** (cũ → mới), 0 response mới-trước |
| response đúng 25 tin vs lúc đọc | 34 ca: tin mới nhất cũ hơn lúc đọc **p50 4 330 s** (max ~295 ngày) |
| response < 25 tin (thread đủ) | 57 ca: tin mới nhất chỉ cũ hơn **p50 5 s** |
| ghép `message_count` của list ↔ số tin đọc được | thread **465 tin** → 25 tin trả về chỉ trải **2 ngày** đầu; thread **39 tin** → 3 ngày đầu |

⇒ **Thread > 25 tin thì tin vừa gửi KHÔNG BAO GIỜ có trong response** ⇒ kiểm chứng kiểu đọc
lịch sử không thể nâng ⚠→✅. Đúng bằng số đo thực tế: **0/26** (lô 10:39) và **0/1** (lô 13:42).

Kiểm thêm: **FB không dội lại tin page tự gửi qua WebSocket.** Trong 225 khung WS của 3 HAR có
WebSocket: tin của KHÁCH có mặt (action `insertMessage` / `upsertMessage` /
`setMessageDisplayedContentTypes` / `updateThreadSnippet`, kèm `mid.$…`), còn **14/14** tin do
page gửi **không** xuất hiện lại ở bất kỳ khung nào. ⇒ Không có khung ACK nào để bắt; đừng đi
tìm "khớp request_id tốt hơn".

Hai lý do phụ (đo được): **31/122** lần đọc lịch sử trả rỗng (24 ca `status 0` = request bị
Chrome huỷ, 7 ca body rỗng) ⇒ 3 lần đọc vẫn có thể trắng cả 3. Đồng hồ server nhanh hơn máy
**~5–40 s** (p50 delta = −5 s) ⇒ so thời gian mong manh, phải trừ `serverSkewMs`.

### 63.2 Nguồn thay thế duy nhất có trong HAR

`GET /v1/conversations/customer/{psid}?pages[<pid>]=0` → `conversations[]` với
**`snippet` = tin CUỐI**, `updated_at`, `last_sent_by.id`, `message_count`.

Đo trên 2 lần gọi có trong HAR (mỗi lần trả 2 hội thoại): cả 4 hội thoại đều phản ánh đúng tin
vừa gửi — trễ **7,2 s / 9,1 s / 10,0 s**. Mỗi lượt gửi chỉ dùng **1 page** nên chỉ cần 1 tham số
`pages[<pid>]=0`. Không cần `access_token`. Response ~1 KB ⇒ nhẹ hơn hẳn 3–4 lần đọc × 25 tin.

### 63.3 Đã sửa (1.92.29)

1. **Dừng đọc lịch sử vô ích**: response đúng 25 tin **và** tin mới nhất đã cũ > 60 s ⇒ biết ngay
   cửa sổ là đầu thread ⇒ thoát vòng đọc (bỏ 2–3 request/ca) và chuyển sang (2).
2. **Kiểm bằng `snippet`** (`confirmViaSnippet` + `snippetVerdict`) cho cả 3 đường kiểm chứng
   (Socket mất ACK, Extension quá hạn, API không rõ). Luật chốt ✅:
   đúng hội thoại (id hoặc psid+page) **và** snippet khớp phần đầu text đã gửi (≥ 12 ký tự)
   **và** `updated_at` không cũ hơn lúc gửi 60 s **và** `last_sent_by.id === pageId`.
   Không đủ 4 điều kiện ⇒ giữ ⚠. **Không bao giờ gửi lại từ kiểm chứng.**
3. **`noack` không còn trộn vào thống kê ACK** (lô 13:42 in "ACK TB/max 5263/5263 · bucket ≥5s = 1"
   cho đúng 1 ca mất ACK ⇒ p50/p90 và "ngưỡng nhanh" bị lệch).
4. **Chuỗi no-ACK reset mỗi lượt** (lô 13:42 báo "🐢 no-ACK lặp 2 lần — giảm lane xuống 64" khi
   lô chỉ có **1** ca mất ACK; chuỗi dư từ lô trước).
5. Test: 42 → **51 kịch bản** (thêm 8 ca cho `snippetVerdict` + 1 ca `snippetText`).

## §64 — LẶP CHỈ SINH Ở CƠ CHẾ BÙ: 3 PHÁN QUYẾT LÀ SUY LUẬN, KHÔNG PHẢI BẰNG CHỨNG (1.92.30)

### 64.1 Cửa vào duy nhất của mọi lần bắn thứ 2

`sendOne` chỉ chạy kênh kế khi `r.sent === false`; `scheduleBuRetry` cũng chỉ được gọi từ các
nhánh `sent:false`. Vậy **mọi ca lặp đều đi qua đúng một cửa: một phán quyết `sent:false`**.
Trong code có 6 nguồn `sent:false`:

| nguồn | bằng chứng? | vì sao |
|---|---|---|
| Socket `kind:'dead'` (socket chết TRƯỚC publish) | **có** | chưa hề phát frame nào |
| Gate no-gid / upload ảnh lỗi / Ext đang nghỉ hồi sức | **có** | chưa chạm tới lệnh gửi |
| Socket `markOptimisticMessageFailed` | **không** | khung **không nói** nó thuộc tin nào; code chỉ so `failed.length && !replaced.length` trên toàn bộ `resp.step` |
| Extension `success:false` **có kèm lý do** | **không** | lý do có thể đến từ bước SAU khi chữ đã đi (dò `global_id`, `thread_key`, fbId ảnh) |
| API `success:false` / 400·401·403·404·405·413·415·422·429 | **không** | `success:false` là cờ của một bước phụ; 4xx có thể do gateway trả sau khi request đã tới backend |

Ba nguồn dưới mà kết luận sai ⇒ bù ⇒ **khách nhận 2 tin**. Và toàn bộ lớp chống trùng cũ
(`deliveredIds`, `sockFiredPending`, `uncertainIds`, `buRetryDone`) chỉ chặn khi đã có phán quyết
**dương** — không có lớp nào hỏi lại hội thoại trước khi bắn lần 2. Đó chính là lỗ hổng.

### 64.2 Sửa: cổng "chứng minh vắng mặt" (`proveAbsentBeforeBu`)

Dùng đúng endpoint snippet của §63 (`/v1/conversations/customer/{psid}?pages[<pid>]=0`) nhưng
đọc theo hướng ngược lại — **chứng minh KHÔNG có**, không phải chỉ chứng minh CÓ:

| kết luận | điều kiện | hành động |
|---|---|---|
| `yes` | snippet khớp text đã gửi + đúng hội thoại + `updated_at` mới + `last_sent_by` = page | **HỦY bù** ⇒ chặn được lặp, không tốn lệnh gửi |
| `absent` | dò **muộn** (≥ `BU_PROOF_WAIT_MS` = 10 s sau lúc gửi, vượt trần trễ 10,0 s đo được) **và** `updated_at` vẫn cũ hơn lúc gửi ≥ `BU_PROOF_STALE_MS` = 30 s | bù — lần này là bắn có bằng chứng |
| `unknown` | dò sớm / hội thoại vừa động / thiếu `updated_at` / khác hội thoại / request lỗi / text < 12 ký tự | bù **như cũ** (ưu tiên KHÔNG SÓT, giữ nguyên hành vi) |

Nguyên tắc: **"chưa thấy tin" một mình không bao giờ là "chưa gửi"** — đúng bài học của
`historyVerdict` (§58, v1.92.25 bỏ hẳn kết luận `no`) và của `snippetVerdict` (§63).

### 64.3 Tốc độ — vì sao không chậm đi

1. **Chỉ ca phán quyết SUY LUẬN mới qua cổng.** Socket `dead`, gate no-gid, upload lỗi, Ext nghỉ
   hồi sức đi thẳng: **0 request, 0 chờ**, y như cũ.
2. **Worker được giải phóng NGAY.** `sendOne` không còn chạy kênh kế tại chỗ cho ca suy luận
   (trước đây một chat lỗi giữ ghế qua Ext 2,5 s rồi Socket). Nay trả về `gated` và để làn nền lo.
3. **Cổng chạy ở `buProbeLane` (32 làn riêng) + `bgClock`** — không bao giờ chiếm ghế của
   `busEnqueue` / `apiSendLane` / `extSendLane`, không nằm trong 96–384 làn gửi.
4. **Dò sớm ngay 0 ms**: nhiều ca tin đã kịp hiện ⇒ hủy bù tức thì (ít hơn 1 lệnh gửi so với trước).
5. **Retry Socket bắt đầu chứng minh NGAY lúc xếp hàng** ⇒ 10 s chờ chạy *song song* với lúc item
   nằm trong hàng đợi, gần như không thêm vào đuôi lô lớn.
6. **Cache theo `convId|mốc 20 s`** ⇒ một chat chỉ chứng minh 1 lần dù có nhiều đường gọi.
7. Trần phụ: 1–2 request/ca; ca `yes`/`absent` còn **bớt** được 1 request kiểm chứng về sau
   (`markDelivered` đóng luôn ca ⚠).

### 64.4 Số đo mới trong log

`🛡 Cổng chống lặp: chặn bù mù N ca · tin ĐÃ tới (hủy bù) X · chứng minh vắng mặt Y ·
không chứng minh được Z · dùng lại kết quả C`

- `X > 0` = số lần **lặp đã chặn được** (mỗi ca là một tin khách không nhận 2 lần).
- `Y` = số ca bù hợp lệ (tin thật sự chưa đi ⇒ không sót).
- `Z` = số ca không đủ bằng chứng ⇒ bù như cũ (đây là trần rủi ro còn lại, có đếm được).

### 64.5 Test

`npm test`: 51 → **58 kịch bản**, thêm 7 ca cho `absenceVerdict` (trong đó 2 ca then chốt:
*dò sớm thấy hội thoại chưa đổi ⇒ phải `unknown`, không được `absent`*; *hội thoại vừa động mà
snippet khác ⇒ `unknown`, không được bù*).

## §65 — BẢNG LOG: BÁM ĐÁY + BỎ DÒNG "ĐÃ GỬI" + CAO HƠN (1.92.31)

Đo trên lô thật 12:53 (**20 259 chat, 1.92.29**): log sinh **14 167** dòng `✅ [n/m] … đã gửi`
+ **5 178** dòng `❌ … KHÔNG thử lần 2 (đã thử 80 ca, cứu được 0, từ chối gần đây 15% …)`
⇒ ~19 300/20 000 dòng là **một trong hai câu gần như y hệt nhau**, đẩy dòng TỔNG HỢP và các
dòng lỗi thật ra khỏi tầm mắt; bảng log chỉ hiện 150 px nên càng không thấy gì.

### 65.1 Đã sửa

1. **Tự đặt điểm nhìn ở CUỐI** khi mở panel (`showBotfakePanel`), khi phóng to/thu nhỏ cửa sổ log
   (`toggleFloat`) — gọi `flushLogUI(true)` + `logScrollToBottom()` sau 1 nhịp vẽ
   (`requestAnimationFrame` + 120 ms) vì element vừa được hiện lại thì `scrollHeight` mới đúng.
2. **Bám đáy thông minh**: `flushLogUI` chỉ kéo xuống đáy khi người dùng đang ở sát đáy (≤ 48 px);
   nếu họ đã cuộn lên đọc lỗi thì **giữ nguyên vị trí** thay vì giật xuống mỗi giây.
3. **Bỏ dòng "đã gửi" từng chat**, thay bằng **mốc tiến độ**: `🟢 Đang gửi d/t (n%) · ✅ · ❌ · ⚠`
   — lô > 500 chat in mỗi **10 %**, lô nhỏ in mỗi **25 %**. Số chính xác vẫn nằm ở dòng TỔNG HỢP
   cuối lượt nên không mất thông tin.
4. **Nén câu lỗi lặp**: 20 dòng `❌ … KHÔNG thử lần 2` đầu giữ **đủ lý do** (còn truy nguyên),
   từ dòng 21 in gọn `❌ Tên — Socket: FB từ chối lần 1 (bỏ thử lần 2 — ngân sách đã đóng)`.
   Vẫn đủ **tên từng chat bị lỗi** để copy ra ngoài.
5. **Bảng log cao hơn**: `max-height` 150 px → `min(340px, 42vh)` (thêm 120 px đệm dưới giúp dòng
   cuối không dính mép + `overscroll-behavior: contain`), và bộ đệm log **300 → 1 500 dòng**
   ⇒ copy được cả một lượt lớn.

### 65.2 Không đụng gì tới đường gửi

Chỉ sửa trình bày: `logLine`/`flushLogUI`/CSS/`logProgress`. Không đổi một số làn, một ngưỡng,
một nhánh chốt ✅/⚠/❌ nào — nhịp gửi và số liệu TỔNG HỢP giữ nguyên.

## §66 — LOG GỌN ĐỂ COPY ĐƯỢC TRỌN: GỘP DÒNG THEO LÝ DO + NÚT COPY/TẢI (1.92.32)

Yêu cầu của người dùng: *"bảng log không chứa hết được, bản này đỡ một chút nhưng copy cũng
không hết nổi"*. Tức vấn đề không phải tốc độ gửi mà là **số dòng quá lớn** ⇒ không nhìn ra
chuyện gì đang xảy ra và **copy ra ngoài bị cắt**.

### 66.1 Vì sao trước đây copy không hết

1. Khung log chỉ giữ **1 500 dòng** (`state.log`, `shift()` khi vượt) — lô lớn sinh **hàng chục
   nghìn dòng** nên phần đầu mất hẳn.
2. Copy bằng bôi đen chỉ lấy được phần đang nằm trong vùng cuộn ⇒ **không bao giờ** đủ.
3. ~95 % số dòng là **cùng một câu, chỉ khác tên chat**:
   `❌ … Socket: FB từ chối lần 1 — KHÔNG thử lần 2 (…)` (3 559 dòng/4 giây ở log 13:13),
   `🛟 … server/Batch/WS/Ext đều không có global_id …` (~600 dòng),
   `❌ [d/t] … api: (#551) … | Ext: Không tìm được global_id … | socket: Không tìm thấy globalId thật`
   (~600 dòng).

### 66.2 Đã sửa (chỉ phần hiển thị)

1. **Gộp dòng theo lý do** — `logFailGrouped(name, reason, tag)` ở phạm vi module (dùng được cả
   trong `sendOne` lẫn wave). Cùng `tag` + cùng `reason` (sau khi nén) ⇒ gom tối đa **2 giây**,
   in **một** dòng: `❌ [done/total] ×120 chat cùng lỗi — <lý do> · vd: A, B, C, D`.
   Tag đang gộp: `❌ ⚠ 🔎 🛟 🔁 ✅` (nhãn chữ đổi theo tag: *cùng lỗi / cùng tình huống / cùng kết quả*).
   Đo bằng mô phỏng 30 giây của lô lớn: **4 800 dòng → 90 dòng** (giảm ~53 lần) mà **không mất
   mã lỗi nào** (`#10`, `#551`, `không gid` vẫn còn).
2. **Nén lý do** — `compressErr` + bảng `ERR_ABBR`: câu dài của FB/HAR rút còn `(#10) ngoài 24h`,
   `(#551) không có mặt`, `socket: không gid`, `Ext: không gid`, … (giữ mã lỗi, bỏ phần văn bản
   pháp lý/URL dài), trần 140 ký tự.
3. **Hai sổ log** — `logAll` (trần **60 000** dòng, đủ cả lượt) dùng cho copy/tải; `state.log`
   vẫn là cửa sổ **1 500** dòng để dựng DOM. `logAllReset()` đầu mỗi lượt; sau F5 khôi phục lại
   từ `state.log` đã lưu.
4. **Nút `📋 Copy log`** (copy **toàn bộ** log của lượt, không cần bôi đen; có đường lui
   `execCommand` khi trình duyệt chặn `navigator.clipboard`) và **`💾 .txt`** (tải
   `botfake-log-YYYYMMDD-HHMMSS.txt`). Cả hai **flush dòng gộp đang chờ** trước khi xuất nên
   không thiếu dòng cuối.
5. **Đếm dòng** ở tiêu đề bảng log (`LOG · N dòng`) để biết ngay lượt này sinh bao nhiêu dòng.

### 66.3 Không đụng gì tới đường gửi

Không đổi một số làn, một ngưỡng, một nhánh chốt ✅/⚠/❌, không đổi cơ chế bù/cổng chứng minh
vắng mặt. Chỉ thay **cách in**: `logLine` → `logFailGrouped` ở các dòng lặp, cộng CSS/thêm nút.
Sổ tên chat đầy đủ vẫn nằm trong `state`/`uncertainIds` và trong file `.txt`.

## §67 — GỘP LOG THEO TỪNG SỔ + SỔ KIỂM CHỨNG TỪNG CHAT (1.92.33)

Đo trên log thật 13:23:56–13:24:17 (**2 251 chat, 1.92.32**): **133 dòng**, nhưng **86 dòng dồn
vào 3 giây cuối** (13:24:11: 48 dòng, :12: 16, :13: 22). Nguyên nhân do chính bộ gộp của 1.92.32:

1. **Chỉ có MỘT khe chờ.** Hai lý do xen kẽ nhau (`FB từ chối nhận tin (xác nhận nền)` ↔
   `KHÔNG thử lần 2`) đẩy nhau ra liên tục ⇒ **93 dòng lỗi** mà đáng lẽ là 2 nhóm lớn:
   `FB từ chối nhận tin` in **27 dòng** lẻ, `KHÔNG thử lần 2` in **44 dòng** (toàn ×2, ×3, ×4).
2. **Khoá nhóm chứa số thay đổi**: `(đã thử 40 ca …)` → `41`, `42`, `43`, `44` ⇒ mỗi lần số nhảy
   là một nhóm mới (5 giá trị trong 3 giây).
3. **Nới lane từng nấc +8**: 16 dòng `⚡ tăng lane … lên 264…384` trong 2 giây.

### 67.1 Đã sửa (vẫn chỉ phần hiển thị)

1. **Mỗi lý do một sổ riêng** (`Map` khoá theo `tag + lý do đã nén`), in tối đa **1 dòng / 2 giây /
   lý do**; xen kẽ bao nhiêu lý do cũng không chẻ nhóm. Trần 200 sổ, quá thì đóng sổ cũ nhất.
2. **Chuẩn hoá số khi tạo khoá** (`đã thử \d+ ca`, `từ chối gần đây \d+%`, `(muộn \d+s)`,
   `đọc \d+ lần`, `sau \d+ ms` → `N`) — **chỉ để gộp**; nội dung in ra lấy **bản mới nhất**
   nên vẫn thấy "đã thử 44 ca".
3. **Nới lane gộp**: 1 dòng sau khi nấc cuối đứng yên 2,5 s —
   `⚡ … nới lane page <pid>: 256 → 384 (16 nấc)`.
4. Dựng lại đúng **977 sự kiện** từ log trên rồi chạy bộ gộp mới: **15 dòng** (thay vì 93).

### 67.2 SỔ KIỂM CHỨNG TỪNG CHAT — để truy ca xác nhận sai gây LẶP

Yêu cầu: log phải gọn **nhưng vẫn đủ dấu vết** để tìm hướng xử lý khi có gửi lặp. Nên tách hẳn:

* `auditRows` — **mọi** kết quả từng chat, **không gộp, không cắt theo cửa sổ hiển thị**
  (`auditPush` được gọi trong `logFailGrouped`, kèm **id chat** ở 35 điểm gọi, và trong
  `markDelivered`).
* `deliverHits` — **mọi lần** `markDelivered` (kể cả lần trùng kênh trước khi hàm return sớm).
  Chat bị đánh dấu "đã tới nơi" **≥ 2 lần** = dấu hiệu xác nhận sai/gửi lặp.
* Nút **`💾 .txt`** xuất: mục 1 log gọn, mục 2 **SỔ KIỂM CHỨNG** gồm
  (a) `⚠ NGHI GỬI LẶP: N chat` + từng lần đánh dấu kèm giờ/kênh,
  (b) **dòng thời gian** `HH:MM:SS.mmm · tag · id · tên · lý do` cho mọi kết quả,
  (c) **tổng theo chat**: `id · tên · #đã tới nơi · #không rõ · #lỗi · kênh · từ lúc → đến lúc`.
* `📋 Copy log` vẫn chỉ copy log gọn (dán nhanh), có ghi chú chỉ sang file `.txt` khi cần truy lặp.

Với lô 2 251 chat ở trên: sổ kiểm chứng ≈ **1 800 dòng** (1 324 ✅ có id + 977 kết quả lỗi/kiểm
chứng) — nằm trong **file**, không làm nặng bảng log trên màn hình.

### 67.3 Không đụng đường gửi

Không đổi một số làn, một ngưỡng, một nhánh chốt ✅/⚠/❌. `markDelivered` chỉ **thêm** một dòng
ghi nhận (trước `return` cũ), `logFailGrouped` chỉ **thêm** tham số id để ghi sổ.

## §68 — HAR CHỐT LẠI GỐC CỦA `1545041`: EXT TRẢ LỖI THẬT, KHÔNG PHẢI "GỬI SAI THREAD" (1.92.34)

Nguồn: lô `botfake-log-20261116-134405.txt` (4 573 chat, 1.92.33-W200.76) + 12 file HAR **trong repo**
(`batmesss`, `guicau`, `guikhachcu`, `guisot`, `guianh1`, `tinnhan`, `tinnhan1`, `tinnhanthread`,
`loaddanhsach`, `loadnhanh`, `taidanhsach`, `pancake.vn2`).

### 68.1 Bằng chứng request/response

* **11 request** `POST https://pancake.vn/api/v1/pages/{pid}/conversations/{pid}_{threadId}/messages`
  ⇒ response **98 byte**: `{"e_code":551,"e_subcode":1545041,"message":"(#551) Người này hiện không
  có mặt.","success":false}` — HTTP **200**, `success:false`.
* Chuỗi `1545041` xuất hiện trong **6** entry của `batmesss`, **2** của `guianh1`, **1** của `guisot`,
  **2** của `tinnhan`. Chuỗi `INCORRECT THREAD` xuất hiện **0 lần** trong **tất cả** HAR.
* `graph.facebook.com` chỉ có **20 request `GET /picture` (400)** — không có request gửi tin nào ra
  Graph API ⇒ mọi lệnh gửi đều đi qua endpoint Pancake ở trên.
* **0 request `chrome-extension://…`, 0 `reference_thread_key`** trong cả 12 HAR ⇒ **không có mẫu
  payload Extension thật** để đối chiếu; mọi suy đoán "Ext dựng sai thread" đều không có bằng chứng.

### 68.2 Đọc `_app-9331d46f21a84eb1.v6.js` (bundle của Pancake)

* `executeByExtOnce()` gọi `concurrentlyGetGLobalId(...)`; nếu `!C && !S` (không lấy được
  `globalUserId`) ⇒ trả `{success:false, error:'no_global_id_found'}` — **không hề gửi**.
* Sau khi gửi, chỉ có 2 kết quả được nhận: `REPLY_INBOX_PHOTO` / `REPLY_INBOX_PRODUCT`. Lỗi ⇒
  `errorMessage = payload.repliedMessage ? i18n('notification.extensionError') : 'extensionFailure'`.
* Payload Ext gồm `threadId`, `convId` (= `thread_key`), `globalUserId`, `customerName`, `photoUrls`
  — **không có** `reference_thread_key`.

⇒ **Extension không bao giờ trả chuỗi `1545041` hay `INCORRECT THREAD`.** Hai chuỗi đó trong log đến
từ **làn Socket/API** (cùng endpoint ở 68.1). Lỗi Ext thật chỉ là: `extensionFailure`,
`no_global_id_found`, `extensionDisconnected`, `uploadPhotoFail`.

### 68.3 Hệ quả — 1 089 ca bị chốt ❌ sai nguồn

`sendViaExtension()` chỉ coi là "khách không nhận được" khi **thiếu `globalUserId`**
(`deadUser && (!globalUserId || !ctx.gidFromPsid)`), nên ca **có** gid rơi vào nhánh `ambiguous`
⇒ bị đem đi *chứng minh vắng mặt* + *bù kênh khác* dù kết luận đã có. Lô 13:38: **1 089 ca**
`1545041`, trong đó **23** INCORRECT THREAD, **23** đi kiểm chứng, **23** bù Socket — 0 ca cứu được.

### 68.4 Đã đổi trong 1.92.34

| Mục | Thay đổi |
|---|---|
| **C1** | Làn page `makeAdaptivePriorityLane(…, socketLaneFloor, …)` chụp sàn **lúc tạo** ⇒ cầu dao hạ 64→32→16 bị `setLimit` kẹp ngược lên 64 (55 dòng `🐢 … xuống 64` là **no-op**). Nay `min = SOCKET_LANE_HARD_FLOOR = 16`, sàn thật vẫn do `socketLaneFloor` quản. |
| **C2** | Nới lane +8 chỉ khi `sockAckP50() ≤ 1 800 ms` (lô 13:38: p50 2 194 ms vẫn "nhanh" theo ngưỡng `p50×1,2` ⇒ nới 256→384 lúc 13:38:30, sập lúc 13:38:48: 1 343 chat sau đó **0 ✅**, 8,2 chat/s). Số lần bỏ nới in ở dòng `📡 SOCKET`. |
| **C3** | Dò lại Socket chết: `sinceProbe >= 50` → **20** ca (nhịp thời gian đã là `SOCK_DEAD_PROBE_MS = 20 s`; lô 13:38 né Socket 1 697 lần nhưng chỉ dò 34 lần, 0 lần hồi). Dòng `🧯` in đúng nhịp dò thay vì "2 phút". |
| **C4** | `1545041` ⇒ `recipientUnavailable` **bất kể có gid** ⇒ chốt ❌ ngay, **không bù, không kiểm chứng trong lượt** (chống lặp). Kèm `deadUserHint` ⇒ xếp vào sổ **HẬU KIỂM**: sau lô tự đọc lại lịch sử từng ca (`/messages?is_new_api=true` + `isMessageDeliveredInHistory` + `confirmViaSnippet`); **thấy tin ⇒ lật ✅** + `postSendSideEffects`, **không gửi lại**. Chỉ đọc, tối đa 400 ca/lượt, 8 luồng, chờ 25 s. |
| **A** | `🐢` chỉ in khi **thật sự giảm** + gộp 1 dòng/2 s (`384 → 196 (3 lần hạ)`); `⏳`/`✓` gộp theo lý do; bỏ cụm "không gửi thêm để tránh trùng" in hai lần; nén `1545041`/`INCORRECT THREAD` (98 → 36 ký tự). |
| **B** | Nạp `nameById` **một lần cho cả danh sách** ở đầu lượt ⇒ dòng `✅` (do `markDelivered` gọi `auditPush('✅', convId, '')`) **không còn mất tên**; sổ báo rõ khi trống sau F5. |

**Còn mở:** làn **API** (chỉ cần `conversation_id`) gửi được **4/33** ca trong nhóm "thiếu gid" của
lô 13:38 ⇒ có thể là đường cứu cho chính nhóm `1545041` (chưa làm vì người dùng chốt "chốt ❌ ngay").

## §69 — BA SỐ LIỆU SAI ĐỌC RA TỪ LÔ 14:28 (8 851 chat) VÀ CÁCH SỬA (1.92.35)

Lô 14:28: **94 s**, phát 95,13 lệnh/s (5 708/phút) · ✅ 5 095 (Socket 5 092 + API 3) · ❌ 3 755
(3 411 bỏ thử lần 2 + 60 khách không nhận + 284 API từ chối) · ⚠ 1. Sổ sách khớp tuyệt đối
(`5 095 + 3 755 + 1 = 8 851`; `🛟 287 = API 290 − 3`), nhưng **ba con số đọc ra đều gây hiểu sai**.

### 69.1 Dòng tiến độ báo "thành công" bằng số ĐÃ PHÁT (sai 57 %) — C1

| Mốc | Log cũ in | Thực tế |
|---|---|---|
| 14:30:02 | `thành công 8564/8851` (96,8 %) | **5 095 (57,6 %)** |

Nguyên nhân: chế độ wave trả `{ok:true, fired:true}` **ngay khi bắn** ⇒ biến `ok` trong vòng lặp
cộng luôn; 3 411 ca ACK `rejected` về sau chỉ chốt ❌ ở `finalizeSockBg` mà **không trừ `ok`**.

Nay: `logProgress()` và dòng 📊 tốc độ đọc `confirmedOkCount()` = `summaryCounters.okApi +
okExt + okSocket` — chỉ tăng khi `markDelivered()` chạy thật, tự giảm khi lật lại — và in thêm
`⏳ chờ xác nhận` = `done − đã tới nơi − ❌ − ⚠`:

```
🟢 Đang gửi 8844/8851 (99%) · ✅ 5095 · ⏳ chờ xác nhận 3469 · ❌ 280
```

### 69.2 Làn Socket mang trần 384 từ lô trước — C2

Lô 14:23 kết thúc `[384×1]`; lô 14:28 **mở màn đã `lane 384×1`** (`pageSocketLanes` không reset
giữa các lượt). Vì limit đã bằng trần, `getLimit() < SOCKET_LANE_MAX` sai ngay từ đầu ⇒
`rampAllowed()` **chưa từng được gọi** ⇒ dòng `bỏ nới lane (p50 > 1800ms) 0 lần` là **0 vô nghĩa**
dù p50 lô đó là 2 449 ms.

Nay đầu mỗi lô: p50 lô trước (ackLatRing giữ qua các lô) chưa đủ mẫu **hoặc** > 1 800 ms ⇒ hạ mọi
làn page về `BUS_PARALLEL_SOCKET` (256) + in 1 dòng `🐢 Làn Socket mang từ lô trước bị hạ về 256: …`.
Tắt nhanh: `LANE_CARRY_CLAMP = false`.

### 69.3 Đuôi lô: ca "server nói không có gid" bị giữ chờ 10 s — C3

`Wave 14/18 — qua cổng 500/500 sau 23 449ms` với `main bay 0 · Socket/page active 0/0 ·
Ext queue/active 0/96` — làn Socket **rỗng** vì 287 ca còn lại không có gid, và **mỗi ca chờ tới
10 s** (`wsWaitMs = extWaitMs = 10 000` cho WebSocket + Extension dò lại) dù HTTP `GET /messages`
đã trả lời rõ "hội thoại này không có gid". Đúng nhóm này Extension trả "không có gid" **287/287**
⇒ 10 s đó là **chờ suông**.

Nay ở lô lớn: `GID_NOGID_SHORT_WAIT_MS = 1 500` cho nhóm này (vẫn đủ cho `peekFastGlobalId`
60 ms và Ext phản hồi nhanh). Không ra thì đi tiếp y như cũ (`gidUnknown` → làn API).
Cửa gate Ext thread-only được giữ nguyên hệ quả đã đo — `(extFinderRespondedNoGid || shortNoGidWait)` —
để nhóm này **vẫn không** gửi Ext thread-only (chỉ trả `1545041`). Số ca in ở 🧭:
`chờ dò ngắn (server nói không có gid) N ca`. Tắt nhanh: `GID_NOGID_SHORT_WAIT_MS = 0`.

## §70 — "GỬI 3 CON MÀ XÁC NHẬN MÃI": CHỐT LƯỢT KHÔNG ĐỢI KIỂM CHỨNG NỀN (1.92.36)

Hai lô thật đo được cùng một bệnh:

| Lô | Phát lệnh | Chốt lượt | Kẹt ở đâu |
|---|---|---|---|
| 15:48 · **3 chat** | 0,6 s | **13 s** | 1 chat bị bắn thử Socket (page đang bị đánh dấu ACK chết) → chờ ACK **8 s**; rồi 3 lượt đọc lại lịch sử **5 s** |
| 15:44 · **90 chat** | 0,6 s | **31,4 s** | 5 chat Socket no-ACK (5 s) + **cổng chứng minh 10 s** + bù lại rơi Socket (5 s) + **13 s đọc lại lịch sử** |

Điểm chung: **mọi chat đã có kết luận từ lâu**, nhưng bảng `📊 TỔNG HỢP` chỉ in khi `pending == 0`,
mà `pending` **cộng cả số ca đang kiểm chứng nền** — thứ chỉ có thể nâng ⚠ → ✅, **không bao giờ
gửi thêm tin**. Với lô lớn phần này chạy song song trong lúc phát lệnh nên không lộ; lô nhỏ thì lộ ra
thành "chờ".

### 70.1 Sửa

1. **`pendingSend`** (mới) = `total − (✅ + ❌ + ⚠ + bỏ qua)` — số chat **chưa có kết luận**. Đây là
   con số quyết định `isDoneAll`, `markSendIdleIfSettled`, và nhãn `⏳ Đang xử lý`.
   `pending` giữ nghĩa cũ (gồm kiểm chứng) và chỉ dùng để hiện `🔎 kiểm chứng nền: M`.
2. **Dòng cập nhật sau chốt**: nếu kiểm chứng nền lật kết quả sau khi đã in TỔNG HỢP ⇒ in **một**
   dòng `🔎 Cập nhật sau khi chốt lượt (kiểm chứng nền — KHÔNG gửi lại tin nào): ✅ 2 → 3 …`,
   tối đa **1 dòng / 15 s** và luôn in lần cuối khi sạch kiểm chứng (lô lớn có thể có cả trăm ca).
3. **Lô ≤ 20 chat: không dò lại kênh ACK chết.** Lô 3 chat ở trên mất 8 s đúng vì tới hạn dò nên
   vẫn bắn thử Socket. Dò chỉ đáng khi còn nhiều chat hưởng lợi; lô nhỏ đi thẳng Ext/API.
4. **Bù không chọn Socket khi page đang ACK chết (còn Extension)** — ca `Nguyễn Quỳnh` mất 5 s
   chờ hạn ACK rồi vẫn "không rõ"; đi Ext có câu trả lời dứt khoát trong 1–3 s. **Không đổi số lệnh gửi.**

### 70.2 Kết quả dự kiến

| Lô | Trước | Sau |
|---|---|---|
| 3 chat | 13 s | **~2–4 s** (chốt khi chat cuối có kết luận) |
| 90 chat | 31,4 s | **~19 s** (− cổng 10 s vẫn giữ: đây là thứ chống gửi lặp) |

Cái **không** đụng: `BU_PROOF_WAIT_MS` 10 s (cổng chứng minh vắng mặt) và hạn chờ ACK —
hai thứ đó chính là thứ chặn gửi 2 tin cho cùng một khách.

## §71 — "GỬI TAY ĐƯỢC MÀ MÁY BÁO KHÔNG GỬI": CỨU TIN BẰNG BẰNG CHỨNG (1.92.37)

### 71.1 Ca thật (Đinh Thị Loan, lô 3 chat 15:48)

| Mốc | Việc |
|---|---|
| 15:48:23 | phát lệnh; 1 ca đi **Socket** (đây là ca **dò lại** kênh ACK đã bị đánh dấu chết từ 15:44) |
| 15:48:31 | không có ACK ⇒ `⚠ Socket không rõ kết quả` |
| 15:48:38 | kiểm chứng đọc **3 lần** không thấy tin ⇒ theo luật 1.92.24/25: **GIỮ ⚠, KHÔNG bắn lại** |

Kết quả: khách **không nhận được gì**, script cũng **không cứu**, người dùng phải gửi tay. Đây là
cái giá của luật "thà mất tin còn hơn gửi đôi" ban hành ở 1.92.24 (khi đó kiểm chứng chỉ có
`historyVerdict`, đọc 1 lần rồi kết luận `no` ⇒ đúng là nguồn gây lặp).

### 71.2 Sửa: hai lớp, không lớp nào là "bắn mò"

**Lớp 1 — CỨU BẰNG BẰNG CHỨNG.** Sau khi đọc lịch sử không thấy tin, chạy thêm đúng cổng đang
dùng trước mỗi lần bù — `proveAbsentBeforeBu()`:

| cổng trả | điều kiện | hành động |
|---|---|---|
| `absent` | dò **muộn** (≥ `BU_PROOF_WAIT_MS` = 10 s sau lúc gửi) **và** `updated_at` của hội thoại **im ≥ 30 s**, không đổi so với lúc gửi | **GỬI CỨU 1 LẦN** qua kênh khác (Extension), rồi khoá `sockVerifyFired` — mỗi chat tối đa 1 lần cứu/lượt |
| `yes` | snippet = tin vừa gửi | ✅ như cũ |
| `unknown` | dò sớm / hội thoại vừa động / thiếu `updated_at` / lỗi request | **giữ ⚠**, không gửi |

Khác biệt then chốt so với bản bị bỏ ở 1.92.24: bản cũ kết luận bằng **"đọc không thấy"**, bản này
kết luận bằng **"hội thoại không hề đổi sau 10 s"** — đúng chuẩn đã dùng cho mọi ca bù từ 1.92.30.

**Lớp 2 — DANH SÁCH GỬI TAY.** Mọi chat kết thúc ở ⚠ được gom vào `manualResendList`, in ở đầu
file `💾 .txt`:

```
=== 🖐 CẦN GỬI TAY (6 chat) — máy KHÔNG xác nhận được đã gửi ===
   694078980461601_xxxxx · Đinh Thị Loan · 15:48:23
```

và đếm ngay trong dòng TỔNG HỢP: `| 🖐 CẦN GỬI TAY: 6 chat (xem 💾 .txt)`.
Chat được xác nhận tới nơi (hoặc bị chốt ❌ khách không nhận) thì tự rời danh sách.

### 71.3 Số đo mới

`| 🔎 Kiểm chứng ACK: đã đến nơi N · giữ ⚠ (không bắn lại) M · không kiểm chứng được K ·
🛟 chứng minh vắng mặt ⇒ gửi cứu 1 lần R`

`R > 0` = số tin đã được cứu khỏi mất im lặng. Rủi ro lặp còn lại đúng bằng số ca mà hội thoại
**không đổi trong 10 s nhưng tin thật ra đã đi** — theo §64.2 đó là trần đã đo (trễ ACK tối đa
10,0 s) và là mức đánh đổi người dùng chọn: **không để mất tin**, sai thì gửi tay kiểm lại.

## §72 — TỐC ĐỘ: CỨU TIN KHÔNG ĐƯỢC LÀM CHẬM BẢNG TỔNG HỢP (1.92.38)

### 72.1 Lỗi tốc độ do chính 1.92.37 gây ra

1.92.37 gọi `reopenUncertain()` trước khi cứu. Hàm đó trừ `summaryCounters.unsure` ⇒
`pendingSend = total − settled` tăng lên 1 ⇒ `markSendIdleIfSettled()` **không cho chốt lượt**
cho tới khi ca cứu xong. Cổng chứng minh vắng mặt bắt buộc chờ mốc gửi **+10 s**, nên bảng
TỔNG HỢP của lô 3 chat bị đẩy từ ~2–4 s lên **~11–14 s** — đúng cái chậm mà 1.92.36 vừa bỏ.
Lô 100 chat có 6 ca ⚠ ⇒ chậm thêm chừng ấy giây, và nếu ca ⚠ nằm cuối hàng đợi thì cả bảng
chờ theo nó.

### 72.2 Sửa

| # | Việc | Tác dụng |
|---|---|---|
| 1 | **Bỏ `reopenUncertain`** trong nhánh cứu; chat vẫn giữ kết luận ⚠ nên lượt chốt ngay | bảng TỔNG HỢP không chờ ca cứu nữa; `markDelivered`/`trackStatus` vẫn tự trừ ⚠ rồi cộng ✅/❌ nên số cuối vẫn đúng |
| 2 | `scheduleBuRetry(..., { fromUncertain: true })` — cờ cho qua 3 cửa chặn "đã chốt ⚠ thì không bù" (lúc đăng ký, lúc timer nổ, lúc vào lane) | cứu vẫn bắn được dù chat đang ở sổ ⚠ |
| 3 | **Cổng chứng minh chạy SONG SONG** với các lần đọc lịch sử (khởi động ngay sau lần đọc đầu không thấy tin) | kết quả cổng về đúng ~+10 s thay vì ~+15…19 s ở lô >50; **không thêm request** |
| 4 | `rescueInFlight` + tách mục **⏳ ĐANG CỨU — ĐỪNG GỬI TAY** trong `💾 .txt`; dòng TỔNG HỢP in `⏳ ĐANG CỨU tự động: N` | không còn cảnh chat vừa nằm trong "cần gửi tay" vừa đang được cứu ⇒ người dùng gửi tay ⇒ khách nhận 2 tin |

### 72.3 Đường thời gian sau khi sửa (lô ≤ 50 chat, 1 ca phải cứu)

| Mốc (giây tính từ lúc bấm Chạy) | Việc |
|---|---|
| 0,6 | phát xong toàn bộ lệnh |
| ~5,5 | ca no-ACK hết hạn ACK ⇒ chốt ⚠ (đã "settled") ⇒ **bảng TỔNG HỢP in được ngay** |
| ~6 | cổng chứng minh trả `absent` ⇒ in `🛟 … GỬI CỨU 1 lần qua Extension` ⇒ bắn |
| ~7–8 | Extension trả kết quả ⇒ `✅ N → N+1`, ⚠ giảm 1, in `🔎 Cập nhật sau khi chốt lượt` |

Tức: **bảng vẫn ~6 s**, phần cứu chỉ thêm 1 dòng cập nhật — không kéo dài lượt. Ca không cứu
được (hội thoại vừa động, hoặc không có Extension) thì nằm nguyên trong `🖐 CẦN GỬI TAY`.

### 72.4 Bất biến giữ nguyên

`BU_PROOF_WAIT_MS` 10 s, hạn chờ ACK 5 s, `BU_PROOF_STALE_MS` 30 s, số làn, ngưỡng gửi,
cửa chống trùng 10 s / 5 s — **không đổi một số nào**. Mỗi chat tối đa **1 lần cứu/lượt**
(`sockVerifyFired`), chỉ qua kênh CHƯA thử (`['socket']` đã thử ⇒ còn `ext`).

## §73 — "GỬI TOÀN BỘ QUA API + EXT NHANH NHƯ SOCKET ĐƯỢC KHÔNG?" (1.92.39)

### 73.1 Ba số đo đã có sẵn trong repo (không suy đoán)

| Kênh | Thông lượng ĐO ĐƯỢC | Nguồn | Vì sao |
|---|---|---|---|
| **API** | **64 request/giây** · 647 request trong 10,1 s · **HTTP 200 × 647, 0 lần 429** | §29.6 | 1 request HTTP độc lập, 76–96 làn song song; 429 chỉ rơi vào endpoint DANH SÁCH, **0 lần** vào `POST /messages` |
| **Ext** | **10,65 tin/giây** (128 làn "active" mà chỉ được vậy) · trần thực tế **15–21 tin/s** ở p90 3,2 s | §18, §45 | Extension **tuần tự hoá bên trong nó** (mỗi tab một hàng đợi). Tăng làn chỉ làm hàng đợi dài thêm, không tăng tốc |
| **Socket** | **125,30 lệnh/giây** khi phát lô 1 958 chat | §45 | bắn-nhả PubSub, không chờ phản hồi ⇒ nhanh, nhưng ACK không đáng tin |

### 73.2 Bằng chứng ngược: lô 9 455 chat "toàn bộ API + Ext" ĐÃ chạy rồi (§45)

| | Số |
|---|---|
| ✅ | 7 185 · **API 61 · Ext 7 124 · Socket 0** |
| ⚠ | 216 · ❌ 2 054 |
| ⏱ | **342 s** (21,01 tin/giây) |
| Hàng đợi Ext | **dâng tới 468** · quá hạn 633 · bộ ngắt quá tải **chặn 1 526 chat TRƯỚC KHI BẮN** |
| Hậu quả | 1 526 ca bị tính ❌ **oan** — không phải khách từ chối, mà vì Ext nghẽn và không còn kênh nào để rơi xuống |

⇒ "Gửi toàn bộ qua Ext" cho lô lớn **không phải nhanh hơn mà là chậm 6× và mất tin**. Đây là lý do
ô bật/tắt "Toàn bộ qua Ext" bị **xoá khỏi panel từ 1.92.0** (vẫn còn `__botfakeForceExt__(true)`
trong console cho lần đo đối chứng).

### 73.3 Vậy làm gì cho đúng — ngưỡng 300 chat (1.92.39)

| Cỡ lô | Kế hoạch | Lý do |
|---|---|---|
| **≤ 300 chat** (và Extension đã nối) | **API → Ext, TẮT Socket** | Ext kham được: 300 ÷ ~18 tin/s ≈ 17 s, mà chỉ những chat API không gửi được mới phải đi Ext. Không còn ca ⚠ "Socket không rõ kết quả" nào |
| **> 300 chat**, hoặc không có Extension | giữ nguyên API/Ext/Socket | trên 300 chat, trần 15–21 tin/s của Ext biến thành hàng đợi + bộ ngắt quá tải ⇒ chậm và mất tin như §45 |

Cờ được in ngay trên dòng TỔNG HỢP: `🚫 Socket TẮT cho lô này (≤300 chat ⇒ API + Ext)` để không
bao giờ đổi cơ chế một cách âm thầm. Điều kiện `Extension đã nối` là bắt buộc: không có Extension
thì Socket là kênh duy nhất còn lại cho chat ngoài 24 h.

### 73.4 Điều KHÔNG hứa

API cũng không phải "chuẩn 100 %": chat ngoài cửa sổ 24 h mà FB trả `(#551)`/`(#10)` thì API từ chối
thật (đã có bằng chứng HAR), và API thỉnh thoảng trả "không rõ kết quả" (timeout/5xx) ⇒ ca đó vẫn
phải kiểm chứng + Ext. Nên thứ tự đúng luôn là **API trước (nhanh, rẻ) → Ext (chốt chắc, chậm)**.

## §74 — ĐỊNH TUYẾN THEO BẰNG CHỨNG GIAO HÀNG (1.92.40) — bỏ ngưỡng cỡ lô

### 74.1 Bản 1.92.39 SAI: ngưỡng "≤300 chat" không giải quyết gì

Nó chỉ đổi hành vi cho lô nhỏ, còn lô thật (4 573 chat lô 13:38, 9 455 chat lô 15:54) vẫn chạy
nguyên cơ chế cũ. Người dùng nói đúng: **vô dụng**. Đã gỡ bỏ hoàn toàn.

### 74.2 Lỗi gốc: "no-ACK" bị dùng như "kênh chết"

`no-ACK` chỉ nói **ACK không về**, không nói **tin có tới hay không**. Bản cũ suy diễn
`no-ACK ⇒ page chết ⇒ gỡ Socket 10 phút`. Suy diễn này sai cả hai chiều:

| Chiều sai | Bằng chứng trong repo | Thiệt hại |
|---|---|---|
| Dương tính giả (ACK mất, tin VẪN tới) | nhiều ca kiểm chứng lật ⚠ → ✅ bằng lịch sử | gỡ Socket oan ⇒ 100 % dồn Ext 15–21 tin/s ⇒ lô 9 455 chat **342 s** (§45), 1 526 ca ❌ |
| Âm tính giả (Socket gửi mà KHÔNG tới) | ca Đinh Thị Loan: 3 lần đọc + cổng = vắng mặt | vẫn thử tiếp ⇒ mỗi lần mất 1 tin + 5 s chờ ACK |

### 74.3 Luật mới — đo đúng thứ cần đo, áp cho MỌI cỡ lô

Sổ theo page: `sockRoute[pageId] = { sent, dlv, lost }`

- `dlv`  = số ca **xác nhận tin ĐÃ tới** qua Socket (ACK OK **hoặc** kiểm chứng lịch sử thấy tin)
- `lost` = số ca **chứng minh hội thoại KHÔNG có tin** sau khi bắn Socket (cổng `absent`, §71)

| Điều kiện | Kết luận |
|---|---|
| chưa có số liệu | **cho thử Socket** (đã có cổng cứu 1 lần ở §71 làm lưới) |
| `dlv ≥ 1` | Socket của page **dùng được** — một lần giao được thì xoá sạch `lost` (tự hồi, không cần TTL) |
| `lost ≥ 2` (không có lần nào tới) | **gỡ Socket** khỏi kế hoạch page này |
| `lost ≥ 1` **và** ACK chết | **gỡ Socket** — mất tin + mất ACK thì đừng đốt thêm tin |
| đang bị gỡ | vẫn dò lại 1 ca/20 chat bị né **và chỉ khi Extension đã nối** (để cứu được nếu mất) |

### 74.4 Vá lỗi ❌ OAN do bộ ngắt quá tải của Extension

§45: **1 526 chat bị tính ❌ mà CHƯA HỀ ĐƯỢC BẮN** — bộ ngắt Ext chặn trước khi bắn, kế hoạch
không còn kênh nào ⇒ chốt ❌. Bộ ngắt chỉ nghỉ **8–15 s** rồi tự đóng. Nay:

1. `sendViaExtension` đánh dấu `conv.__extSkippedOverload = true` khi bị bộ ngắt chặn.
2. Chỗ chốt "đã thử hết kênh": nếu có dấu đó ⇒ **KHÔNG chốt ❌**, đặt ⚠ "chưa gửi" và **hẹn bắn
   lại qua Ext sau 9 s** (tối đa 2 lần, cùng lượt, có kiểm tra `runSeq`/Dừng).
3. Bắn lại thành công ⇒ ⚠ tự chuyển ✅; thất bại thật ⇒ mới tính ❌ và chat nằm trong danh sách
   gửi tay.

`sendDiag.extOverloadSkips` trước đây **khai báo nhưng không ai tăng** — nay đếm đúng chỗ, để log
nói được "bộ ngắt đã chặn bao nhiêu ca".

### 74.5 Kỳ vọng số (lô 4 573 chat, giả định 24 % chat ngoài cửa sổ 24 h)

| Kênh | Trần đo được | Thời gian cho 3 484 chat trong cửa sổ | cho 1 089 chat ngoài cửa sổ |
|---|---|---|---|
| API | 64 req/s | ~55 s | — (FB từ chối #551/#10) |
| Socket | ~100 lệnh/s | dự phòng | **~11 s** (thay vì 54 s nếu dồn Ext) |
| Ext | 15–21 tin/s | — | 54 s + hàng đợi dâng ⇒ bộ ngắt ⇒ ❌ oan |

⇒ Với 74.4, "dồn Ext" chỉ còn là phương án cuối chứ không còn là án tử.

### 74.6 Chỗ ❌ oan thứ hai — và nó ở ĐƯỜNG CHÍNH, không phải đường bù

`sendOne` đã tính sẵn cờ `extOverloaded` (true khi có ca bị bộ ngắt Ext chặn mà chat chưa
được xác nhận)... nhưng **không ai đọc cờ đó**. `grep extOverloaded` trước 1.92.40 chỉ ra đúng
**một** dòng: chỗ tính. Vì vậy chat bị bộ ngắt chặn — chưa hề gửi lệnh nào — rơi thẳng vào
nhánh `fail++` và bị in `❌`. Đây chính là 1 526 ca của lô 15:54.

Nay nhánh chốt cuối đọc cờ: `extOverloaded` + còn Extension + chưa hẹn lại quá 2 lần ⇒
**đặt ⚠ "chưa gửi", hẹn bắn lại qua Ext sau 9 s** thay vì `❌`. Chỉ áp cho tin chữ (ca ảnh phải
dựng lại ảnh, không đáng đổi rủi ro). Chat vẫn vào danh sách gửi tay để người dùng thấy.

`sendDiag.extOverloadSkips` cũng được đếm đúng MỘT lần (ngay chỗ bộ ngắt chặn), trước đây vừa
không được tăng ở đâu, vừa có nguy cơ đếm đôi ở vòng lặp kênh.

## §75 — HAI LÔ 16:07 / 16:11 (1.92.38): 5 525 CA ❌ VÌ "NGÂN SÁCH" CHẶN OAN

### 75.1 Số đo

| | Lô 16:11 (5 919 chat) | Lô 16:07 (11 954 chat) |
|---|---|---|
| ✅ | **2 550 (43,1 %)** · API 15 · **Ext 2** · Socket 2 533 | **7 187 (60,1 %)** · API 45 · **Ext 186** · Socket 6 956 |
| ❌ | **3 369** | **4 713** |
| ⚠ / 🖐 | 0 / **0** (không có danh sách gửi tay) | 54 / 54 |
| 📡 ACK OK/rej/no-ACK | 2 533 / **3 425** / 2 | 6 878 / **2 367** / 161 |
| `bỏ thử lần 2 (ngân sách)` | **3 311** | **2 214** |
| `khách không nhận được` (1545041) | 58 | 1 891 |
| Peak Ext queue/active | **0/1** — làn Ext TRỐNG | 1 |
| Peak API waiting | 0 | 0 |
| ⏱ | phát 131 s · tổng 135 s | phát 652 s · tổng 653 s |

Toàn log có **1 781** lần mã `1545041` và **1 970** lần `"Người này hiện không có mặt."`

### 75.2 Nguyên nhân (một nhánh, một dòng log, một lỗi logic)

Mọi ca ❌ gần như đều in cùng một câu:

> `Socket: FB từ chối lần 1 — KHÔNG thử lần 2 (đã thử 40 ca, cứu được 0, từ chối gần đây 20 % ⇒ thử nữa chỉ tốn lệnh)`

Dòng này nằm ở nhánh `!sockRetryBudgetAllows(...)` — **ngân sách thử lại Socket** thêm ở 1.92.26.
Ngân sách đó ra đời để chặn việc **BẮN LẠI SOCKET** (861 lần thử, cứu 0). Nhưng khi viết, nó bị
cài thành **kết luận cho cả chat**:

```js
if (!sockRetryBudgetAllows(budget)) {
  trackStatus(conv.id, 'fail');   // ← ❌ và KHÔNG thử kênh nào khác
```

⇒ 3 311 + 2 214 = **5 525 chat bị chốt ❌ mà CHƯA HỀ thử Extension hay API**, trong khi
`peak Ext queue/active 0/1` (làn Ext trống) và API cũng trống. Hai lô đáng lẽ gửi được thêm
một phần lớn trong 5 525 ca đó.

### 75.3 Vì sao Socket bị từ chối nhiều thế — và vì sao Ext lại gửi được

`1545041 "Người này hiện không có mặt"` là **lỗi của KÊNH**, không phải bằng chứng khách chặn:
chat đã ra ngoài cửa sổ 24 h thì Socket/API bị FB chặn, còn Extension đi qua **tab Facebook thật**
nên gửi được — lô 16:07 có **186 tin ✅ qua Ext** đúng trong tình huống này (và code đã ghi nhận
hiện tượng này từ log 09:15, §30). Đây cũng là lý do API chỉ có 15–45 lệnh: chat ngoài 24 h bị
`skipFutileApi` bỏ API từ đầu, rồi rơi thẳng vào Socket — sai kênh.

### 75.4 Sửa (1.92.41)

1. **Ngân sách thử lại Socket chỉ còn quyền nói "không bắn lại Socket"**, không có quyền kết luận
   chat không gửi được. FB từ chối đứt khoát ⇒ **chưa có tin nào đi** ⇒ thử Extension 1 lần là
   **an toàn tuyệt đối** (không thể trùng). Nhánh đó nay gọi `scheduleBuRetry(['socket'])` ⇒ Ext.
2. **1545041 ở đường chính** (Socket/API) cũng đi đường đó, thay vì chốt ❌ ngay.
3. **Dò có đo, không bù mù:** `extTry1545 = { tried, saved, closed, PROBE 200 }`.
   - Thử Ext cho tối đa **200 ca** đầu.
   - Cứu được **≥ 1** ⇒ giữ mở, các ca sau đi Ext bình thường.
   - **0 cứu** sau 200 ca ⇒ **ĐÓNG** (Extension cũng bị FB chặn), phần còn lại vào
     **`🖐 CẦN GỬI TAY`** với trạng thái ⚠ "chưa gửi" — **không chốt ❌ oan** nữa.
4. Dòng TỔNG HỢP in: `🛟 Dò Ext cho ca FB từ chối: thử N · cứu M (· ĐÓNG …)`.

Chi phí tối đa của bước dò: 200 ca ÷ ~18 tin/s ≈ **11 s** — không đáng kể so với 131–652 s của
một lô. Nếu Ext cứu được thì 5 525 ca có cơ hội được gửi thật; nếu không thì người dùng nhận được
**danh sách gửi tay** thay vì một con số ❌ vô nghĩa.

## §76 — "QUÁ LÂU": BÓC THỜI GIAN HAI LÔ 16:07 / 16:11 (1.92.38)

### 76.1 Lô 16:07 — 11 954 chat, 652 s. Ba pha rõ rệt

| Pha | Thời gian | Số chat | Tốc độ | Trạng thái làn |
|---|---|---|---|---|
| **1. Chạy êm** (wave 1–17) | 16:07:09 → 16:10:30 = **201 s** | 8 368 (70 %) | **42 tin/s** | socket lane 384→96 · Ext queue/active **0/0–5** |
| **2. Kẹt cổng** (wave 18–24) | 16:10:30 → 16:17:10 = **400 s** | 3 586 (30 %) | **9 tin/s** | Ext active **pinned 96** · socket lane 16–64 · `main đang bay 0` |
| **3. Chốt sổ** | 16:17:10 → 16:18:02 = 52 s | 0 | — | — |

Câu chốt trong dòng WAVE: **`giữ cổng (bay/retry/ext/api) 20 827/0/6 426/0`** — cổng bị giữ
**6 426 lần vì hàng đợi Extension**, không phải vì làn gửi. Và wave 19/20/22/23/24 mất
**60 195 / 91 563 / 63 375 / 70 381 / 67 945 ms** — mỗi wave gần một phút, trong khi
`main đang bay 0`, `retry 0/0/0`, `API chờ 0`.

`wave→cổng TB/max = 24 521 / 91 563 ms` là hệ quả trực tiếp.

### 76.2 Cơ chế

`evaluateGate()` (nhịp 60 ms) giữ wave kế tiếp khi
`extBacklogQueue.length + activeExtWorkers > WAVE_EXT_BACKLOG_HIGH_WATER (96)`.

17 wave đầu: Ext rỗng ⇒ cổng mở, 42 tin/s. Từ wave 18, ~2 300 chat dồn sang Ext (trần thật
**~18 tin/s**) ⇒ điều kiện đó **luôn đúng** ⇒ cổng đóng suốt 400 s, cả lô xếp hàng sau một hàng
đợi chạy nền. Đây là **lỗi thiết kế**: cổng phát lệnh không được phụ thuộc vào một hàng đợi mà
tốc độ của nó (18/s) nhỏ hơn tốc độ phát (45–130/s).

### 76.3 Sửa (1.92.42)

Thêm `GATE_EXT_BACKLOG_LIMIT = 1200` **chỉ dùng cho cổng**: cổng chỉ giữ khi hàng đợi Ext vượt
1 200 ca (mức an toàn bộ nhớ). Hàng đợi Ext chạy song song, không chặn việc phát.
**Không** đổi số làn, không đổi tốc độ gửi, không đổi ngưỡng nào khác.

### 76.4 Hai thứ còn nợ (chưa sửa, cần log kế tiếp để chốt)

1. **Socket/page lane tụt 384 → 16–64 mà không có dòng `🐢` tương ứng.** Log 16:07 chỉ có
   `backoff chậm/no-ACK 4/2` (4 lần hạ theo ACK chậm, 2 lần no-ACK) — không đủ để đi từ 384
   xuống 16 (mỗi lần hạ chỉ ×0,8). Có đường hạ lane khác chưa được log ⇒ **phải tìm ra đường đó
   trước khi sửa**, nếu không sẽ lại sửa mò.
2. **`🫥 CHẠY NỀN: tab ẩn 81 % · bị bóp 4 772 lần + trễ 10 840 lần · cộng thêm 15 288 s`**
   (lô 16:11: 87 % · trễ 4 478 lần · +4 769 s). Đồng hồ Worker không bị bóp, nhưng callback vẫn
   trễ trung bình ~1,4 s/lần ⇒ **main thread quá tải** (192 slot + hàng nghìn promise + fetch).
   Đây là nghi phạm số 1 cho việc "phát 45 tin/s dù làn cho phép 265 tin/s", nhưng **chưa có
   phép đo tách bạch** ⇒ chưa đụng.

---

## §77 — BỐN VIỆC NGƯỜI DÙNG GIAO SAU HAI LÔ LỚN 1.92.42 (16:51 / 16:52)

Nguồn số: `…170052.txt` (7 073 chat · 398 s · 17,75 tin/s) và `…170324.txt` (13 204 chat ·
716 s · 18,45 tin/s), cả hai bản **1.92.42**. Kết luận bao trùm của §76 vẫn đúng: **cổng Ext đã
hết là nút thắt** (`giữ cổng ext` 6 426 → 2 957 / 3 753), nhưng **tổng thời gian gần như không
đổi** ⇒ nút thắt đã **chuyển sang slot main**.

### 77.1 Công thức thời gian lô (khớp 99 %)

`t ≈ số chat × 10,7 s ÷ 192`

| lô | dự đoán | thực tế |
|---|---|---|
| 7 073 chat | 394 s | 398 s |
| 13 204 chat | 736 s | 716 s |

⇒ Muốn nhanh thì phải **giảm thời gian giữ slot** (hiện ~10,7 s/chat), **không** phải tăng làn:
192 slot × 2 s ⇒ ~96 chat/s, tức nhanh gấp 5,3 lần. Nhưng **trước 1.92.43 repo KHÔNG có phép đo
nào tách 10,7 s đó ra thành phần** ⇒ mọi con số "ai giữ slot" chỉ là suy đoán.

### 77.2 Đã sửa: cầu dao ACK không còn bóp làn về 16 tới hết phiên

Tìm được **đúng đường hạ lane** đã nợ ở §76.4 (1):

```
16:52:36 🧯 Mất ACK liên tục 25 tin — hạ SÀN socket xuống 32 rồi 16/page (cầu dao giữ tới hết phiên)
        🔧 ACK hồi ổn định — nâng lại sàn Socket/page 24/64 → 48/64
        Socket/page limits cuối [16×1]   ← kết thúc lô vẫn ở 16 làn
```

Cơ chế: `SOCK_ACK_STORM_RUN = 25` ca no-ACK ⇒ sàn `socketLaneFloor` **chia đôi** (64 → 32 → 16,
đáy `16`), rồi `lane.setLimit(floor)`; nhánh "page ACK chết" cũng `setLimit(socketLaneFloor)`.
Đường **nâng lại** chỉ `+8` mỗi 20 ACK nhanh và **trần 64** ⇒ từ 16 lên 64 cần 120 ACK nhanh
liền, thực tế không bao giờ kịp. Kết quả: **1/24 cấu hình** cho phần còn lại của lô.

Sửa (1.92.43): sàn thấp nhất **32** (không phải 16) và khi ACK nhanh 20 nhịp liền thì
**nâng sàn dứt điểm về 64** thay vì +8.

### 77.3 Đã sửa: ngân sách dò Ext đóng đúng chỗ

`🛟 Dò Ext ca FB từ chối` = **thử 799 · cứu 0** (lô A) và **thử 1 431 · cứu 0** (lô B) dù ngân
sách thiết kế là 200 ca. Nguyên nhân: ca Ext **quá hạn** rơi vào nhánh `r.sent === 'maybe'`, mà
cờ đóng ngân sách trước đây chỉ gắn ở nhánh `recipientUnavailable`. Nay gọi `noteExt1545Fail()`
ở **mọi** nhánh thất bại (kể cả `maybe`) ⇒ `tried` không thể vượt ngân sách.

Bằng chứng "bù Ext vô ích" cho nhóm `1545041`: 2 230 lần thử, **cứu 0**.

### 77.4 Đã sửa: tải danh sách đúng 1 lần

Mỗi lần bấm `⚡ Tải danh sách` là một chuỗi request `next_cursor` **vào đúng endpoint danh sách**
(§29 HAR: 429 chỉ rơi vào endpoint này — 73/73). Người dùng chọn đi chọn lại nhiều lượt trên cùng
danh sách ⇒ tải lại vô ích và tự chuốc 429.

1.92.43: danh sách đã tải đủ, chưa quá **10 phút**, không phải tải dở ⇒ bấm ⚡ **dùng lại ngay**
(`♻ Dùng lại danh sách đã tải (N chat, Xs trước) — KHÔNG gọi lại API`). Muốn tải mới thật:
**bấm ⚡** — từ 1.92.43d bấm là tải mới toàn bộ, KHÔNG cần SHIFT (bỏ hẳn SHIFT).

### 77.5 Đã sửa: nhiều tab cùng cửa sổ tranh nhau gửi

Mỗi tab là một bản script độc lập: **client Socket riêng**, làn riêng (192 main · 384/page ·
128 Ext) nhưng **chung một page Facebook và chung một hạn mức ACK**. Hai tab chạy cùng lúc =
2× làn trên cùng một kênh ⇒ ACK chậm, lane tự hạ, cả hai cùng chậm.

1.92.43: khoá `ssb_send_tab_lock_v1` (heartbeat 2 s · TTL 6 s). Tab thứ hai bấm Chạy sẽ bị chặn
kèm `🛑 TAB KHÁC ĐANG GỬI (…)`. Bỏ chặn: `window.__botfakeAllowMultiTab__(true)`.

### 77.6 Đã sửa: đuôi xác nhận bù thôi giữ sổ 3 phút

| lô | Ext quá hạn | kiểm chứng **thấy tin** | chưa thấy |
|---|---|---|---|
| 7 073 | 623 | **0** | 516 |
| 13 204 | 847 | **0** | 822 |

1 338 ca dò lại (20 s + 45 s + **120 s** mỗi ca) **cứu 0 chat** nhưng giữ sổ "chờ xác nhận" tới
3 phút sau khi lô xong. 1.92.43 bỏ lượt 120 s, giữ **một** lượt 45 s (đủ cho adapter p90 8,3 s +
hàng đợi) rồi chốt thẳng `⚠ Ext quá hạn — chưa thấy tin`.

### 77.7 Thêm phép đo để chốt "ai giữ slot 10,7 s"

Dòng 🌊/WAVE nay in thêm:

```
⏱ GIỮ SLOT TB chờ Xms · chuẩn bị Yms · còn lại Zms (n=…)
```

- **chờ** = thời gian xếp hàng để có slot main (nếu lớn ⇒ cổng/làn là nút thắt, không phải gửi),
- **chuẩn bị** = `ensureConvCtx` (đọc conversation, ghép tên khách, ảnh),
- **còn lại** = thân lần gọi kênh (dò gid + publish + chờ ACK).

Chỉ khi có 3 số này mới được sửa tiếp phần gửi — §76.4 (2) (`tab ẩn bị bóp`, callback trễ
~1,4 s) vẫn là nghi phạm chưa có phép đo tách bạch.

### 77.8 Hai tab thì bây giờ ra sao (khoá tính theo PAGE)

Khoá `ssb_send_tab_lock_v2:<pageId>` — **theo từng page**, không phải toàn bộ trình duyệt:
hai tab mở **hai page khác nhau** vẫn chạy song song được (mỗi tab một Socket client, một hạn
mức ACK riêng, không tranh nhau); chỉ chặn khi **cùng một page** — đó mới là cảnh 2× làn trên
một kênh.

`localStorage` không có phép "ghi nếu chưa có", nên chống bấm đồng thời bằng: **ghi → chờ 150 ms
→ đọc lại**; tab nào đọc thấy khoá mang ID của chính mình thì thắng, tab kia nhường. Đã mô phỏng
đúng thuật toán đó (2 tab, chung localStorage) và kiểm 4 tình huống:

| tình huống | kết quả |
|---|---|
| tab A chạy trước, tab B bấm sau 1 s | B bị chặn · **1 tab chạy** |
| hai tab bấm gần như đồng thời (5 ms) | B bị chặn ở bước kiểm đầu · **1 tab chạy** |
| **đua thật**: cả hai cùng qua bước kiểm rồi cùng ghi | B thua ở bước đọc lại 150 ms · **1 tab chạy** |
| tab A chết (đóng tab) không nhả khoá | B chiếm lại sau **6 s** (TTL) |

Kèm chốt `sendLockPending` cho 150 ms đó: bấm đúp trong **cùng một tab** cũng không tạo 2 lượt.
Lượt xong (hoặc bấm ⏹) ⇒ nhả khoá ngay, tab kia bấm là chạy được. Heartbeat 2 s chỉ để tab còn
sống giữ khoá; tab đóng giữa lô thì khoá tự hết hạn sau 6 s.

### 77.9 Hai page / hai tab: chia ngân sách slot thay vì cộng dồn

Người dùng **luôn chạy 2 page khác nhau trên 2 tab**. Khoá ở §77.8 không chặn trường hợp này
(khác page ⇒ không tranh ACK), nhưng **tải máy thì vẫn cộng dồn**: 2 tab × 192 slot main = 384
chuỗi promise/fetch cùng lúc, chưa kể 384/page + 128 Ext mỗi tab ⇒ main thread quá tải (đúng
`🫥 tab ẩn bị bóp … trễ 10 840 lần · +15 288 s` của lô 16:11).

1.92.43: mỗi tab ghi presence `ssb_peers_v2` (heartbeat 2 s · TTL 8 s) và **tự chia** trần slot main:

| số tab đang gửi | slot main mỗi tab | tổng |
|---|---|---|
| 1 | 192 | 192 |
| 2 | 96 | **192** (không nặng hơn 1 tab) |
| 3 | 64 | 192 |

Tab **đang bị ẩn** nhường thêm 25 % (2 tab: tab ẩn 72 · tab đang xem 96). Tính lại ở **đầu mỗi
wave** nên bật/tắt tab giữa lô vẫn ăn ngay. Log khi đổi:

```
🧩 Có 1 tab khác đang gửi (page khác) — tab này dùng 96/192 slot main ⇒ tổng tải không tăng dù chạy nhiều tab.
🧩 Không còn tab nào khác gửi — tab này trở lại 192 slot main.
```

Đổi tay: `window.__botfakeMainSlotCap__(n)` (`0` = tự động). Đã mô phỏng đúng hàm chia (2 tab,
chung localStorage):

| tình huống | cap A / cap B | tổng |
|---|---|---|
| chỉ A chạy | 192 | 192 |
| B bấm chạy (khác page) | 96 / 96 (B ẩn: 72) | **192** |
| thêm tab C | 64 / 64 | 192 |
| B chết 9 s (quá TTL) | A về lại 192 | 192 |

**Đánh đổi phải nói rõ:** chia slot **không** làm tổng nhanh hơn 1 tab — nó giữ tổng tải bằng 1
tab để máy hết lag. Nếu máy còn dư CPU và bạn muốn 2 tab chạy hết công suất thì đặt
`window.__botfakeMainSlotCap__(192)` ở cả hai tab (chấp nhận lag).

### 77.10 Sửa lại §77.9 — chia ĐỀU là sai: tab đang xem phải giữ nguyên tốc độ

Người dùng phản hồi đúng chỗ: *"chạy 1 cái thì nhanh mà song song là lag"*. Chia 96+96 ở §77.9 giữ
tổng tải = 1 tab, tức **làm cả hai tab chậm đi một nửa** — không phải điều họ cần. Nay 3 mức ưu
tiên (không phải 2):

| tình huống tab này | slot main |
|---|---|
| chỉ một tab | 192 |
| 2 tab, tab có focus (đang gõ) | **192** |
| 2 tab, tab hiện nhưng không focus (2 cửa sổ cạnh nhau) | 144 |
| 2 tab, tab bị ẩn | 128 |
| ≥3 tab: focus / không focus / ẩn | 144 / 128 / 112 |

⇒ 2 tab điển hình = **192 + 128 = 320 slot (1,67× một tab)**, tức **song song vẫn nhanh hơn chạy
một tab** mà không dồn 384 slot như trước. Cần đúng như cũ: `window.__botfakeMainSlotCap__(192)`
ở cả hai tab.

Phần **giật** khi 2 tab còn được cắt thêm ở chỗ khác (không cắt tốc độ gửi): log DOM của tab ẩn
gộp **2,5 s/lần** thay vì 1 s (số liệu gửi và `logAll` để copy **không đổi**).

### 77.11 Đuôi bù + xác nhận: nút thắt là SỐ VÒNG SONG SONG, không phải 10 s chờ

Mỗi ca phải kiểm chứng giữ ~10 s (chờ mốc `BU_PROOF_WAIT_MS`), mà làn kiểm chứng chỉ **32 vòng**
song song:

| lô | ca cần kiểm chứng (no-ACK + rejected) | @32 vòng | @96 vòng |
|---|---|---|---|
| 7 073 | 1 266 | ≈ 396 s | **≈ 132 s** |
| 13 204 | 1 881 | ≈ 588 s | **≈ 196 s** |

`SOCK_VERIFY_PARALLEL` 32 → **96** và `buProbeLane` 32 → **96**. Đường này **chỉ đọc** lịch sử
(GET `…/messages`, p50 **43 ms** — §29.5), không gửi lại, không chiếm ghế làn gửi; 96 cũng đúng
bằng trần làn ctx đang dùng nên **không tạo thêm tải mới**.

**Không cắt** các mốc an toàn: 10 s chứng minh vắng mặt trước khi bù, 20 s kiểm chứng Ext, 45 s
dò lại — đây là sàn chống gửi trùng/gửi thiếu, không phải chờ mù.

### 77.12 Danh sách chỉ tải khi NGƯỜI DÙNG bấm — sửa 5 đường tự tải ngầm

Người dùng: *"tôi nói chỉ tải danh sách khi tôi ấn cơ mà, tại sao chọn khoảng và chọn chuỗi vẫn
phải tải lại?"* — đúng. `1.92.43` mới chỉ cho nút **⚡ Tải danh sách** dùng cache 10 phút; các
đường chọn khác vẫn gọi API **vô điều kiện**:

| đường | trước 1.92.43c | sau |
|---|---|---|
| Chọn chuỗi (nhấp 2 lần / Alt+click 2 dòng) | `scanFullList({forRange:true})` **luôn chạy** | dùng danh sách đã có nếu **đủ 2 đầu chuỗi**; chỉ tải bổ sung khi thật thiếu |
| Chọn từ đây xuống cuối (nút ⤓) | `scanFullList({full:true})` **luôn chạy** | dùng danh sách đã có |
| Alt+click 1 dòng 2 lần = xuống cuối | **luôn chạy** | dùng danh sách đã có |
| ▶ Chạy gặp danh sách hỏng | `restartIfBusy` ⇒ **giết** lượt quét đang chạy | `skipIfBusy`: nhường, không dừng lượt của người dùng |
| Bấm ⤓ / ▶ trong lúc lô đang gửi (`sendListFrozen`) | `return` **im lặng** | ghi rõ đang dùng danh sách giữ sẵn, vẫn khớp được |

Ba nguyên tắc:

1. **Tải danh sách = hành động của người dùng.** Chỉ nút ⚡ phát request `next_cursor`, và
   **bấm là tải mới toàn bộ** (1.92.43d bỏ SHIFT — người dùng: *"không cần shift, ấn là tải lại hết"*).
   Không đường chọn nào tự phát nữa.
2. **Không bao giờ gửi thiếu vì dùng lại danh sách.** `completeRange` kiểm 2 đầu chuỗi có trong
   danh sách đang giữ; thiếu ⇒ tải bổ sung (và nói rõ trong log). Vùng chọn tải dừng ở cuối chuỗi
   được đánh dấu `allRowsPartial` ⇒ "chọn tất cả" vẫn tự tải đủ.
3. **Lượt quét đang chạy không bị lệnh tự động giết.** `skipIfBusy` nhường thay vì `stopRequested`.

Log mới để đối chiếu: `🔗 Dùng danh sách đã tải (N chat, Xs trước) — KHÔNG gọi lại API.`
Nếu vẫn thấy `⚡ Danh sách hiện tại chưa đủ 2 đầu chuỗi` thì đó là ca **thật sự thiếu** (chuỗi vượt
ra ngoài vùng đã tải), không phải tải lại vô ích.

### 77.13 Bỏ SHIFT: bấm ⚡ là tải lại hết

| thao tác | 1.92.43c | 1.92.43d |
|---|---|---|
| bấm ⚡ (danh sách mới tải 10s trước) | dùng lại, đòi **SHIFT** mới tải mới | **tải mới toàn bộ** ngay |
| bấm ⚡ khi đang tải dở | dừng lượt cũ rồi **thoát** (phải bấm lần 2) | dừng lượt cũ rồi **chạy lượt mới ngay** |
| chọn chuỗi / ⬇ xuống cuối / Alt×2 | dùng danh sách đang giữ | không đổi (vẫn không tự tải) |

`LIST_CACHE_TTL_MS`/`listCacheFresh()` giữ tên nhưng **vô hiệu** (luôn 0) — không còn nhánh "dùng lại"
trong `scanFullList`, nên không thể có chuyện bấm ⚡ mà không tải. Tooltip nút ghi rõ: *"Bấm là tải lại
TOÀN BỘ danh sách từ đầu (không cần giữ Shift) — các nút chọn khác không tự tải"*.

### 77.14 Lag khi Alt chọn chuỗi — 4 nguyên nhân đo được trong code, không phải đoán

Người dùng hỏi *"có lí do gì gây ra tình trạng lag khi ấn alt chọn chuỗi không"*. Đọc code (không
sửa gì trước) thì thấy 4 chỗ cộng dồn, **tất cả đều nằm trên đường Alt/Ctrl-chọn**, không liên quan
đến gửi tin:

**1. Vòng lặp tự kích (nặng nhất).** `watchList()` gắn `MutationObserver` lên `#conversationList`
với `attributes: ['class','style']`. `highlightRows()` lại **đổi class** (`ssb-m-match` /
`ssb-m-target`) trên chính các dòng đó ⇒ observer nổ ⇒ `scheduleHighlight()` ⇒ `highlightRows()` …
`hlScheduled` chỉ gộp trong **1 animation frame**, nên sau mỗi lần đổi lựa chọn nó chạy liên tục
theo nhịp 60 fps. Mỗi vòng là `querySelectorAll` toàn danh sách + `rowInfo()` từng dòng (mỗi
`rowInfo` = 5 lần `querySelector`). Với danh sách 7 000 chat thì đây là hàng trăm nghìn phép đọc DOM
mỗi giây, đúng lúc đang thao tác.

**2. Không có "nghỉ" khi đang rê chọn.** Trong lúc giữ Alt / ở chế độ 2 nhấp, mỗi `pointerdown`,
`click`, `computeMatches` đều gọi `render()` → `scheduleHighlight()` (và `render()` còn dựng lại
danh sách kiểm chứng nếu `listKey` đổi).

**3. `computeMatches` cắt chuỗi bằng `rows.forEach(r => idxOf(r.id))`** — với nguồn `allRows`
(Map + sort theo `order`) là O(n log n) **mỗi lần** đổi đầu/cuối chuỗi, dù chỉ cần lấy dải
`[lo..hi]`.

**4. App tự cuộn danh sách.** Virtual list của Pancake tháo/gắn dòng theo `scrollTop`; mỗi lần
đổi điểm cuối, app nhảy cuộn ⇒ render lại cả dải dòng ⇒ giật. Script không chặn việc này.

**Đã sửa (1.92.43-W200.89):**

| chỗ | trước | sau |
|---|---|---|
| observer ↔ tô màu | tự kích 60 fps | chỉ nghe `childList`; thay đổi `class` **do chính script gây ra** bị bỏ qua (so với bản đã biết) |
| lưới an toàn | `setInterval(…, 400)` | `setInterval(…, 1500)` |
| đang rê chọn | vẫn tô mỗi frame | **hoãn tô màu** cho tới khi thả Alt / nhấp xong (tô lại đúng 1 lần) |
| cắt chuỗi | O(n) gọi `idxOf` từng dòng | cắt mảng `[lo..hi]`, có kiểm 2 đầu trước khi cắt |
| app tự cuộn | không chặn | ghim `scrollTop` trong ~700 ms sau cú chọn (công tắc **"Giữ nguyên vị trí danh sách khi chọn chuỗi"**, mặc định BẬT) |

**Không đụng** logic chọn (Alt 2 nhấp, Ctrl chọn cùng snippet, "2 nhấp" pickMode) và **không đụng**
đường gửi tin.

### 77.15 Bảy chỗ "mất tin trong im lặng" còn nằm trong bản 1.92.43 — đã vá ở 1.92.44-W200.90

Đối chiếu bản LITE người dùng đang chạy (1.91.55, 164 hàm) với bản trong repo (1.92.43-W200.89,
279 hàm) thì **LITE không có hàm nào HEAD thiếu** — ngược lại HEAD có **115 hàm LITE không có**
(vì thế phần lớn cơ chế chống mất tin đã có sẵn). Nhưng soi kỹ 3 nhóm lỗi thì thấy **cả hai bản
cùng mắc**, và đó mới là thứ đáng vá:

| # | chỗ | bản 1.92.43 làm gì | hậu quả thật | 1.92.44 |
|---|---|---|---|---|
| 1 | `rl.helperBudget` | khai `0`, chỉ **chia đôi** khi 429 ⇒ không bao giờ tăng; `if (rl.helperBudget > 0) spawnHelper()` và `for (s < Math.min(STRIDES, 0))` **không bao giờ chạy** | ~60 dòng "10 luồng phụ" là **code chết**; đọc code tưởng tải 11 luồng song song, thực tế 1 cursor tuần tự — đường dễ dính 429 nhất | ghi tường minh `RL_HELPER_BUDGET_START = 0` + chú thích: luồng phụ dựng cursor Erlang **giả** bằng lùi mốc thời gian ⇒ **hở chat** (đo được 88 → 73), nên **cố ý** không dùng |
| 2 | `loadListViaApi`, 1 request lỗi | `incompletePages.add(pid)` rồi `return` ngay | **mất toàn bộ** phần đã tải của page đó | giữ `seg.cursor`, thử lại **3 lần** (nghỉ 1,2 s / 2,4 s), lần thử lại không tính vào trần 1500 trang; log `⚠ Page … GIỮ N chat đã tải được.` |
| 3 | tải thiếu 1 page | **vứt cả danh sách** vừa tải rồi chạy lại từ đầu bằng đường khác | "chạy tới 90% rồi quay về 0" | thử đường chung **1 lần**; vẫn thiếu thì **gộp** phần đã có + phần đường chung (dedupe theo id, sort lại), trả `{ ok:true, incomplete:true, incompletePages, rowsKept:true }`; chỉ `{ ok:false }` khi **0 chat** |
| 4 | `scanFullList` nhánh thiếu | `state.allRows = prevAllRows || null` (thường `null`) | danh sách về rỗng | giữ danh sách một phần + `allRowsPartial = true`, log `🟡 Tải 2 lần vẫn thiếu … GIỮ N chat` |
| 5 | `sendToAll` | `state.listIncomplete` ⇒ **chặn mọi lựa chọn** | không gửi được chat nào dù đã tick đúng | vẫn chặn **"chọn tất cả"** (chọn theo danh sách thiếu = gửi thiếu người); chuỗi/chat lẻ thì `confirm()` rồi cho gửi |
| 6 | `dupBlockedResult` | trả `{ ok:true, sent:true, fired:true }` ⇒ `sendOneAndLog` tăng `ok++`/`firedN++` | ca **bị chặn vì trùng** bị đếm là **đã gửi** ⇒ số liệu lệch, dòng "đã gửi" hiện cho chat chưa hề bắn | nhánh riêng: `sendDiag.dupBlocked++`, log `✓ … KHÔNG bắn thêm (chống trùng)`, thêm dòng `🛡 Chặn trùng: N ca` vào TỔNG HỢP |
| 7 | gửi **ảnh + câu ngắn** | `proveAbsentBeforeBu` trả `unknown` ngay khi chữ **< 12 ký tự** ⇒ cổng chống lặp bị **vô hiệu** đúng ở nhóm dễ lặp nhất | gửi lặp ảnh không ai phát hiện | thêm `photoMovedVerdict()`: ca **có ảnh** được dò, kết luận "đã tới" khi hội thoại động quanh lúc gửi **và** `last_sent_by` là chính page |

**Cửa sổ của `photoMovedVerdict` là BẤT ĐỐI XỨNG −15 s / +∞, không phải ±60 s.** Bản nháp đầu
tiên dùng ±60 s và **sai**: tin của *lượt gửi trước* (cách 50 s cùng chat) vẫn lọt cửa sổ ⇒ cửa sổ
"chứng minh" tin đã tới cho một ca **vừa gửi hỏng** ⇒ chốt ✅ oan, đúng bệnh mất tin cần tránh.
Nới 15 s về trước chỉ để bù việc `sentAt` lấy sớm hơn lúc server nhận; phía sau không chặn vì tin
gửi xong luôn có `updated_at` muộn hơn `sentAt`.

**Test (65 kịch bản, `npm test`)** — 7 ca mới cho `photoMovedVerdict`: động ngay sau khi gửi ⇒
`yes`; **tin lượt trước cách 50 s ⇒ `unknown`** (ca chống hồi quy cho lỗi ±60 s ở trên); server cập
nhật muộn 10 s ⇒ `yes`; khách tự nhắn ⇒ `unknown`; page khác ⇒ `unknown`; thiếu `updated_at` ⇒
`unknown`; danh sách rỗng ⇒ `unknown`.

**Nguyên tắc rút ra (giữ cho các bản sau):**
1. **Thiếu danh sách ≠ danh sách sai.** Chỉ chặn đúng thao tác nguy hiểm (chọn tất cả), đừng chặn cả lượt gửi.
2. **"Bị chặn vì trùng" không phải "đã gửi".** Mọi kết quả `ok:true` mà **không bắn gì** phải được đếm riêng.
3. **Cờ 0 mà không có chú thích = bom chờ.** `helperBudget: 0` từng bị hiểu là "có 11 luồng tải".

### 77.16 Đuôi chờ xác nhận — vì sao "gửi 100 chat mà chờ 1–2 chat lâu" và đã cắt ở đâu (1.92.45-W200.91)

Nguồn: `network-log.har` người dùng push lên main — **94 request của extension Pancake v2 phát ra
trong lúc tool chạy**. Đây là lần đầu repo có bằng chứng về chính **làn Ext** (trước đó mọi kết luận
về làn này đều suy từ log). Số đo:

| chỉ số | giá trị |
|---|---|
| thời gian | 6,74 s cho **90 lệnh** `POST business.facebook.com/messaging/send/` |
| kết quả | **0 thành công / 90 thất bại** · `payload: null` ở 90/90 |
| mã lỗi | `1545041` ×**86** (khách không có mặt) · `1545012` ×**4** (lỗi tạm thời, `transientError:1`) |
| độ trễ phản hồi | p50 **0,99 s** · p90 1,45 s · max 2,13 s (⇒ **không ca nào chạm timeout 2,5–9 s**) |
| `1545012` vs `1545041` | p50 **0,34 s** vs 1,00 s (lỗi tạm thời trả về nhanh hơn) |
| song song thật | 90 lệnh / 6,74 s = **13,4 lệnh/s**, đỉnh in-flight **42** (làn 48–96 chưa bao giờ đầy) |
| 2 khách bị gửi 2 lần | cả 4 lệnh đều ra `1545012` ⇒ không có khoá chống trùng ở tầng request |

**Vì sao đuôi dài.** Có **hai** nguyên nhân cộng lại, không phải một:

1. **Cổng chứng minh vắng mặt khởi động MUỘN.** Trong `scheduleSocketVerify`, `proofP` được tạo
   *bên trong* vòng đọc (sau lần đọc đầu), mà cổng lại phải chờ mốc `sentAt + 10 s`. Tổng =
   3 s (chờ) + đọc lần 1 + 2 + 4 + 6 s rồi **mới** tới hạn 10 s của cổng ⇒ ca xấu nhất **25–35 s**
   cho một chat. Đo trên code, không phải đoán: `maxReads = 4` cho lô > 50, giãn cách 2/4/6 s.
2. **Ca chắc chắn không gửi được vẫn bị bắt chờ.** `1545041` / `1545012` / `(#10)` là FB nói rõ
   "tin không được nhận", nhưng chúng đi vào diện `ambiguous` ⇒ 10 s cổng + (nếu rơi nhánh
   `buProofGated`) tới **35 s** (`scheduleBuRetry` → `proveAbsentBeforeBu` chờ 10 s + `sleepUntil`
   25 s). Với lô 100 chat, chỉ **1–2 chat lỗi** là đủ giữ nguyên bảng TỔNG HỢP thêm nửa phút.

**Đã sửa (1.92.45):**

| chỗ | trước | sau |
|---|---|---|
| `scheduleSocketVerify` | cổng khởi động sau lần đọc 1 ⇒ 14–35 s | **khởi động ngay trước vòng đọc** ⇒ về đúng `+10 s`, không thêm request nào |
| ca dứt khoát | vào `ambiguous` ⇒ chờ 10 s | `isDefinitiveNotSent()` ⇒ chốt ⚠ **ngay trong làn gửi**, log ghi rõ "FB đã từ chối DỨT KHOÁT ⇒ chốt luôn" |
| `1545012` | **không có trong code** (grep = 0) | `isCertainHttpNotSent` coi là "chắc chắn chưa gửi" + `isTransientServerError` ⇒ **thử lại ngay 1 lần** sau 600 ms (server chưa tạo tin ⇒ không thể trùng) |
| hết kênh + lý do dứt khoát | bù mù rồi chờ cổng | `definiteFail` khi `seq` rỗng ⇒ chốt ngay |
| mẫu p90 độ trễ Ext | lấy **mọi** phản hồi | **chỉ ca thành công** (ca lỗi trả lời nhanh ⇒ siết timeout xuống sàn 2,5 s ⇒ cổng quá hạn nổ oan) |
| AIMD làn Ext | `latencyMs < 5000` ⇒ +2 slot | chỉ ca **success** mới tăng (HAR: 90 ca lỗi vẫn < 2,2 s ⇒ làn leo 64 → 96 bằng toàn lệnh hỏng) |
| đo đuôi | không có số | `tailChats` · `tailMaxMs` · `unavailFast` in ở TỔNG HỢP |

**Nguyên tắc rút ra:**
1. **"Có phản hồi" ≠ "khoẻ".** Mọi AIMD/mẫu độ trễ phải lọc theo `success`, nếu không làn sẽ leo
   bằng chính các ca hỏng.
2. **Cổng chờ phải khởi động cùng lúc với việc đọc**, không phải sau. Cái đắt không phải request
   mà là **thứ tự** các mốc chờ.
3. **Ca FB đã nói rõ thì đừng chờ.** Thời gian chờ chỉ có giá trị với ca *mơ hồ thật* (Socket mất
   ACK, Ext quá hạn, API timeout). Với `1545041`/`1545012`/`(#10)` chờ 10 s chỉ làm chậm lô.
4. **Trần của làn Ext ~13,4 lệnh/s** (đo thật). Nâng sàn/trần làn không làm lô nhanh hơn — sửa
   comment cũ ghi "48 làn ≈ 40–50 tin/s" để lần sau không tối ưu sai chỗ.

### 77.17 Đóng ngân sách dò 1545041 theo chuỗi liên tiếp + đo trần Ext ngay trong log (1.92.46-W200.92)

Nốt ba việc còn lại sau §77.16.

**1. Ngân sách dò `1545041` đóng SỚM (30 ca liên tiếp), không chờ 200.**

Số đo: dò 799 ca cứu **0**, dò 1 431 ca cứu **0** (log 16:11/16:20); HAR làn Ext trả `1545041` ở
**86/86** ca kể cả khi làn **hoàn toàn rỗng**. Ngân sách cũ đòi đủ `PROBE = 200` mới đóng ⇒ mỗi lô
mất ~200 lệnh + ~200 s ở đuôi chỉ để học lại điều đã biết.

Nay đóng khi `streak >= 30 && saved === 0` **hoặc** `tried >= 200 && saved === 0`. Bất kỳ ca
**cứu được** nào cũng `streak = 0` ⇒ nếu Extension thật sự gửi được thì ngân sách mở lại ngay,
không đóng oan. Hệ quả khi đóng giữ nguyên: ⚠ "chưa gửi" + danh sách gửi tay, **không chốt ❌ oan**.

**2. Đo trần thật của làn Ext ngay trong TỔNG HỢP.**

Thêm dòng `🛰 Ext: p90 phản hồi … · đỉnh in-flight N/limit` + kết luận tự động:
- `đỉnh < limit` ⇒ *"làn CHƯA đầy ⇒ nút cổ chai là Extension, không phải làn"* — đúng ca HAR
  (đỉnh 42/48–96), nên lần sau không ai nâng sàn/trần làn để "cho nhanh" nữa;
- `đỉnh = limit` ⇒ *"làn ĐÃ đầy ⇒ nâng làn mới có ích"*.

**3. Hai comment sai đã sửa.**

| chỗ | sai | đúng |
|---|---|---|
| `noteExtSendOutcome` | "AIMD tăng +2 slot tối đa **24**" | lane bị kẹp `[EXT_SEND_MIN 48, EXT_SEND_MAX 96]` |
| chú thích timeout Ext | "HAR đo ca lỗi p50 **908 ms**" | HAR mới: p50 990 ms · p90 1 450 ms · max 2 130 ms (mọi phản hồi); `1545012` p50 340 ms. 2,5 s vẫn phủ p99 ⇒ giữ nguyên timeout |

**4. `isTransientServerError` siết lại (bắt được lỗi của chính bản nháp §77.16).**

Bản nháp dùng `/(^|\D)5\d\d(\D|$)/` ⇒ khớp **bừa** mọi chuỗi lỗi có số 3 chữ số bắt đầu bằng 5
(vd `"room 512"`, `"INCORRECT THREAD 500"`) ⇒ sẽ thử lại những ca không hề tạm thời. Nay chỉ nhận:
mã `1545012` · câu "Đã xảy ra lỗi tạm thời" · `HTTP 5xx` · `(#n) 5xx`. Có **4 ca test chống hồi quy**
cho đúng lỗi này.

**Test: 86 kịch bản** (`npm test`) — thêm 8 ca: 4 ca siết `isTransientServerError`, 4 ca ngân sách
(29 ca còn mở / 30 ca đóng / cứu-được-thì-reset / trần 200 vẫn hiệu lực).

---

## §78 · network-log2.har — mẻ làn Ext thứ hai (73 entry) và cái nó xác nhận

### §78.1 Số đo (đo bằng script trên HAR, không suy luận)

| Chỉ số | network-log.har (mẻ 1) | network-log2.har (mẻ 2) |
|---|---|---|
| Thời điểm | 12:44:59–12:45:06 | 00:29:22–00:30:43 |
| Tổng entry | 94 | 73 |
| `POST /messaging/send/` | 90 | 19 |
| Mã lỗi FB | `1545041` ×86, `1545012` ×4 | `1545041` ×19 |
| HTTP status | 200 ×90 | 200 ×19 |
| Có prefix `for (;;);` | **90/90** | **19/19** |
| `payload: null` | 90/90 | 19/19 |
| Đỉnh in-flight | 42 | 18 |
| Tốc độ phát | 13,4 lệnh/s (90 / 6,74 s) | 8,8 lệnh/s (19 / 2,16 s) |
| p50 / p90 / max | 990 / 1 417 / 2 134 ms | 852 / 1 149 / 1 378 ms |
| fbid trùng | 2 (đều là ca `1545012`) | 0 |
| Trường JSON của lỗi | `error`, `errorSummary`, `errorDescription`, `isNotCritical`/`transientError`, `payload`, `lid` | như mẻ 1 |

**Kết luận 1 — `1545041` không phải "khách chết".** 6/19 ca của mẻ 2 khớp được với node hội thoại
của CHÍNH HAR đó (`threadlist`), và cả 6 đều có `cannot_reply_reason: "MESSENGER_BLOCKEE"`;
852/872 node còn lại là `null`. Trong cả HAR không có ca nào mang cờ đó mà FB lại nhận tin.
⇒ `cannot_reply_reason == "MESSENGER_BLOCKEE"` là bằng chứng MÁY ĐỌC ĐƯỢC của ca `1545041`,
chắc hơn việc đoán theo câu tiếng Việt. (13 ca còn lại không có node trong HAR — không kết luận.)

**Kết luận 2 — vì sao extension trả lỗi hàng loạt.** Mọi phản hồi gửi đều là `for (;;);{...}`.
Không bóc tiền tố ⇒ `Unexpected non-whitespace character after JSON` ⇒
`Cannot read properties of null (reading 'error')` ⇒ `CANNOT GET GLOBAL ID` ⇒ gửi sai thread ⇒
`1545041`. Chuỗi này là SUY LUẬN nối log console của extension với nội dung HAR — ta không có
stack trace của extension, nên ghi rõ là suy luận.

**Kết luận 3 — khối JSON thứ hai (chỉ mẻ 2 có).** 47/47 phản hồi `/api/graphqlbatch/` có dạng
`{"__q0__":{…}}\r\n{spaces}{"successful_results":1,…}` — **hai** khối JSON nối nhau. `JSON.parse`
trần ném đúng `Unexpected non-whitespace character after JSON … (line 2 column 1)` như trong log.
Vị trí lỗi ~37 000–40 500 ký tự của log khớp độ dài các khối này (1 086–137 779 ký tự).

**Kết luận 4 — vòng lặp phân trang vô hạn.** 63/63 lượt phân trang
(`batch_name=MessengerGraphQLThreadlistFetcher`, `doc_id=38892042767077350`) đều gửi **cùng một**
con trỏ `before=1794874125000`; có những cặp khối trùng nội dung 100 %, chỉ khác `__req`. Tức khối
"load trang kế" nổ lỗi parse → bị thử lại y nguyên → con trỏ không bao giờ tiến.

### §78.2 Vá ở 1.92.47 (W200.93) — ⛔ ĐÃ REVERT (xem §81) — giữ làm hồ sơ

| # | Sửa | Bằng chứng | Vì sao không phải "đoán" |
|---|---|---|---|
| 1 | `stripJsonPrefix()` bóc `for (;;);` / BOM / khoảng trắng đầu, áp cho `fetchJson` **và** ACK Socket | 90/90 + 19/19 phản hồi gửi có prefix | đếm trực tiếp trên HAR |
| 2 | `gidBreaker` đóng đường dò global_id qua Extension: `NO_GID_MAX 40` hoặc `SAME_THREAD_MAX 3` | 4 thread hỏng lặp 2 lần trong log; 63/63 lượt phân trang lặp | hai nguồn độc lập cùng chỉ về "dò lại vô ích" |
| 3 | Dòng TỔNG HỢP `🔒 Đã đóng đường dò global_id qua Extension (…)` | — | để lần sau đọc số được, không phải suy đoán |

**Không sửa (và lý do):**
- `extTry1545.PROBE/STREAK_MAX`: mẻ 2 **xác nhận** ngân sách đóng ở 30 ca là đúng (19/19 đều `1545041`).
- Không hạ `extTimeoutMs()`: p90 mẻ 2 là 1 149 ms, max 1 378 ms — vẫn dưới sàn 2 500 ms.
- Không tăng làn Ext: mẻ 2 đỉnh in-flight 18 với 19 lệnh, tức làn chưa đầy; nút cổ chai là FB từ chối.
- `cannot_reply_reason == "MESSENGER_BLOCKEE"`: **chưa** đưa vào code vì cần xác nhận khoá này có
  trong payload `pancake.vn/api/v1/.../messages` (11 HAR cũ chỉ có `"blocked"` trong `timings`) —
  chưa có bằng chứng.

### §78.3 Ca chống hồi quy (tools/test-verify.mjs, mục 24–25)
- `for (;;);{"__ar":1,"error":1545041,…}` (nguyên văn HAR) ⇒ parse ra `error = 1545041`.
- `for(;;);{...}` (không space) ⇒ vẫn bóc.
- JSON sạch ⇒ **không đổi một byte** (đường `pancake.vn/api/v1`).
- 2 khối JSON nối nhau ⇒ ghi nhận vẫn không parse trần được (giới hạn đã biết, không giả vờ đã vá).
- Cầu dao: 3 lần CÙNG thread ⇒ đóng; 40 ca khác thread ⇒ đóng; không threadId (timeout) ⇒ **không** đóng.

---

## §79 · Cơ chế TẢI DANH SÁCH và vì sao log 09:19–09:22 trông như "kẹt 429"

### §79.1 Cơ chế hiện tại (đọc code, không suy đoán)

| Bước | Hàm | Dòng |
|---|---|---|
| Nút ⚡ là ĐƯỜNG DUY NHẤT phát request danh sách | `scanFullList` | ~2306 |
| Tải qua API `next_cursor`, **không cuộn DOM** | `loadListViaApi` | ~1753 |
| 1 page ⇒ luồng gốc tuần tự theo `next_cursor` (+ luồng phụ Erlang, ngân sách **0**) | `loadSequentialOrStitch` | ~2040 |
| ≥2 page ⇒ mỗi page 1 chuỗi song song, pool 10 | nhánh A | ~1900 |
| Mỗi trang: `fetchJson` tự thử 3 lần (400 ms × lần), timeout 12 s | `fetchPage` | ~1808 |
| 429 ⇒ nghỉ **chung** + giảm nửa ngân sách luồng phụ | `rlNote429` | ~1790 |

**Ngân sách luồng phụ cursor giả = 0** (từ 1.92.44) vì nó nhảy mốc thời gian và làm hở danh sách
(đo được 88 → 73 chat). Nghĩa là **thực tế chỉ có 1 chuỗi `next_cursor` tuần tự** — đây là lý do
cấu trúc khiến mọi 429 đều rơi đúng vào một đường.

### §79.2 Vì sao ra 62 dòng log và 134,6 s

| Số | Nguồn |
|---|---|
| 62 lần 429 trong 134,6 s (~1 lần/2,2 s) | log user dán |
| Nghỉ **đúng 2,5 s cho MỌI lần** ⇒ tổng ≈ **155 s** nghỉ | đọc `rlNote429` |
| 155 s nghỉ > 134,6 s cả lượt ⇒ gần như toàn bộ thời gian là NGỒI CHỜ | phép chia |
| Mỗi trang lỗi in tối đa 1 dòng `⏸ … đang tự thử lại…` (cờ `errRetry === 1`) | đọc code |
| Con số trong dòng log là `seg0.items.length` — số chat **đã lấy**, tăng dần 160 → 7 440 | đọc code |
| 429 là THẬT, không phải lỗi script: HAR cũ 22–49 % request `next_cursor` bị 429 (loaddanhsach 7/32, taidanhsach 41/84, loadnhanh 24/56) | đo trên 3 HAR |
| Trần 1500 trang bị lần THỬ LẠI ăn mất slot ⇒ `truncated` ⇒ `scanFullList` tải lại **từ trang 1** | đọc 2 vòng lặp, so sánh |

### §79.3 Vá ở 1.92.48 (W200.94)

| # | Sửa | Vì sao |
|---|---|---|
| 1 | Nghỉ 429 **dài dần**: 2,5 → 5 → 7,5 → 10 s, rồi +1,5 s/lần (trần 20 s); reset khi có phản hồi thành công | 2,5 s cố định = quay lại đúng nhịp đã gây 429 |
| 2 | Trần **1500 trang ĐÃ LẤY** + ngân sách **40 lần thử lại** riêng | lần thử không còn ăn slot trang (đường A vốn đã làm đúng bằng `guard--`) |
| 3 | Trang hỏng ⇒ ghi `{cursor, after, jumpMs}` vào `errorPages`, **nhích cursor** sang trang kế rồi đi tiếp | không quay lại trang 1; không bỏ chat nào |
| 4 | Cuối lượt **tải bù đúng cursor đã lưu** (`resumeCursor`), ngân sách 30 s + 8 s/trang (trần 120 s) | chỉ đốt lại đúng trang thiếu |
| 5 | 3 trang LIÊN TIẾP lỗi ⇒ dừng hẳn, giữ phần đã tải | không đốt request khi server bóp cả loạt |
| 6 | Log mỗi mốc (lần 1, 5, 10, 20…) + "đã nghỉ tổng X s" | 62 dòng trùng nhau không cho biết cơn 429 nặng lên hay dịu đi |
| 7 | TỔNG HỢP in `N trang × p50 X ms/trang · đã nghỉ vì 429 tổng Y s · trang lỗi N (bù được M)` | tách "server chậm" khỏi "ta tự làm chậm bằng cách nghỉ" |

**Rủi ro đã biết, không giấu:** bước 3 phải nhích cursor bằng `shiftCursorBefore()` (lùi `1,2 × spanMs`
của trang). Nếu span ước lượng sai, có thể **nhảy qua 1 trang** — nhưng trang đó KHÔNG bị coi là đã
tải (nó vẫn nằm trong `errorPages` và được tải bù), nên không mất chat im lặng. Nếu không dịch được
cursor ⇒ **không nhích**, dừng và đánh dấu thiếu (thà thiếu còn hơn bịa cursor).

### §79.4 Ca chống hồi quy (mục 26–27)
- `waitFor(1)=2500`, `waitFor(2)=5000`, `waitFor(3)=10000`, `waitFor(40)=20000`.
- 62 lần 429 liên tiếp ⇒ tổng nghỉ > 155 s (bản cũ) — tức bản mới nghỉ ĐỦ LÂU để cơn dứt.
- 100 trang lỗi **không** ăn vào trần 1500 trang.
- Dịch cursor: mốc đúng ±0, `keyStr` giữ nguyên, cursor rác ⇒ `null` (không bịa), lùi quá mốc 0 ⇒ `null`.

---

## §80 · "Ấn tải phát dừng luôn, chả chạy được tí nào" — 5 chỗ chặn lượt tải

### §80.1 Nguyên nhân đọc được từ code (không phải suy đoán)

| # | Chỗ | Tại sao làm lượt tải chết ngay |
|---|---|---|
| 1 | `scanFullList` nhánh `!(api && api.ok && api.rows.length)` | Trước đây: gán `state.allRows = prevAllRows` ⇒ **vứt** đúng phần `syncLiveRows` vừa đổ vào. Không có chat ⇒ nút trở lại "⚡ Tải danh sách" như chưa bấm gì |
| 2 | `loadListViaApi` không có `try/catch` | Một exception giữa vòng lặp ⇒ thoát hàm, `api` = `undefined`, rơi vào nhánh (1) ⇒ **mất trắng**, chỉ in 1 dòng ⚠ |
| 3 | `consecFail >= 3 ⇒ truncated; break` (thêm ở 1.92.48) | 3 trang lỗi liền là **chuyện thường** khi server bóp (mỗi trang `fetchJson` đã cố 3 lần) ⇒ dừng cả lượt, đây là nguyên nhân TRỰC TIẾP của "dừng luôn" |
| 4 | `rlNote429` bị gọi 3 lần cho **một** trang | `fetchJson` tự thử 3 lần, mỗi lần 429 đều gọi `rlNote429` ⇒ `streak` nhảy 3 bậc cho trang ĐẦU TIÊN ⇒ nghỉ 10 s ngay (bản 1.92.48 nhân đôi) |
| 5 | `finally` của `scanFullList` | Nếu 0 chat + không có lỗi, nút về "⚡ Tải danh sách" và **không nói gì** ⇒ người dùng không biết đã chạy hay chưa |

### §80.2 Vá ở 1.92.49 (W200.95)

| # | Sửa |
|---|---|
| 1 | `loadListViaApi` bọc `try/catch`, trả `{ ok:false, error, rows: phần đã có }` — lỗi không còn giết im lặng |
| 2 | Nhánh lỗi **giữ** `state.allRows` đã đồng bộ: "🟡 … GIỮ N chat đã tải được. Gửi phần này vẫn được; *chọn tất cả* bị chặn cho tới khi tải đủ" |
| 3 | **BỎ** luật "3 trang lỗi liền ⇒ dừng". Chỉ thôi khi **ngân sách 40 lần thử lại** cạn |
| 4 | `rlNote429` gộp 3 lần thử của cùng một trang thành **1 bậc** (cờ `rl.pageAt`, cửa sổ 4 s) |
| 5 | Bậc nghỉ cố định đọc được: **2,5 → 4 → 6 → 8 s**, sau đó +1,5 s/lần, trần **15 s** (bản 1.92.48: 2,5 → 5 → 10 s ⇒ quá tay) |
| 6 | Kết thúc lượt mà 0 chat ⇒ in rõ 3 việc cần kiểm tra (đăng nhập / token / bộ lọc) và đổi nút thành "⚠ Tải 0 chat — bấm tải lại" |

**Không đổi:** trần 1500 trang tách khỏi 40 lần thử lại; sổ trang lỗi + tải bù đúng cursor; W200.88
(chỉ ⚡ phát `next_cursor`); "chọn tất cả" vẫn bị chặn khi danh sách chưa đầy.

### §80.3 Ca chống hồi quy (mục 26 cập nhật + mục 28)
- Bậc nghỉ: 2,5 / 4 / 6 / 9,5 / 15 s (trần), không vượt 15 s.
- Lỗi khâu tải + đã có 120 chat ⇒ `partial` (không phải `empty`).
- 3 trang lỗi liền mà còn ngân sách ⇒ **không** dừng; cạn ngân sách mới dừng.
- 3 lần 429 trong CÙNG trang ⇒ `streak = 1`; quá 4 s sang trang khác ⇒ `streak = 2`.
- Không còn chuỗi `consecFail >= 3` trong nguồn; có chuỗi "Lượt tải kết thúc mà KHÔNG lấy được chat nào".


---

## §81 · REVERT 1.92.47 → 1.92.49 (người dùng: "lỗi luôn? sửa quay lại cơ chế tải cũ đi")

### §81.1 Đã gỡ khỏi code (bằng `git checkout 0a12515 -- …`, không sửa tay)

| Bản | Nội dung bị gỡ | File |
|---|---|---|
| 1.92.47 (§78) | `stripJsonPrefix()` + cầu dao `gidBreaker` + dòng TỔNG HỢP 🔒 | userscript + test |
| 1.92.48 (§79) | nghỉ 429 dài dần, trần 1500 tách khỏi lần thử, sổ `errorPages`, tải bù `resumeCursor`, `loadListViaApi` → biểu thức, `shiftCursorBefore`, p50 ms/trang | userscript + test |
| 1.92.49 (§80) | bọc `try/catch` khâu tải, giữ `allRows` phần đã tải, bỏ luật 3-trang-lỗi, gộp 3 lần thử 429, bậc 2,5/4/6/8 s, cảnh báo 0 chat | userscript + test |

**Kiểm chứng revert (byte-exact):**
- `scripts/pancake-send-lite.user.js` == `git show 0a12515:…` ✔
- `tools/test-verify.mjs` == `git show 0a12515:…` ✔
- `npm test` = **86/86** (đúng số ca của 1.92.46, không còn ca 24–28)
- `npm run check` ✓ · `version.json` = `1.92.46 / W200.92`

### §81.2 Trạng thái cơ chế tải SAU REVERT (bản đang chạy, đọc từ code)

| Chỗ | Giá trị hiện tại |
|---|---|
| `loadListViaApi` | `async function` gốc (không tải bù, không `resumeCursor`) |
| 429 | `rl.pauseUntil = Date.now() + 2500` — **cố định 2,5 s cho mọi lần**, không dài dần |
| Luồng gốc | `while (guard++ < 1500 …)`, lỗi ⇒ `errRetry++`, `<= 8` thì `continue` sau **2 s** |
| Ngân sách luồng phụ | `RL_HELPER_BUDGET_START = 0` ⇒ thực tế **1 chuỗi `next_cursor` tuần tự** |
| `scanFullList` | không có nhánh giữ phần đã tải; lỗi ⇒ `⚠` rồi thôi |

### §81.3 Bài học rút ra (để không tái phát)
1. **Đừng đổi cơ chế TẢI khi chưa có log của chính người dùng về lần tải đó.** Hai lần liên tiếp
   sửa "theo suy luận từ log 429 cũ" đều làm hỏng thêm: thêm luật dừng, thêm bậc nghỉ nhân đôi,
   thêm đường tải bù — mỗi thứ đều là một nhánh mới có thể chặn lượt tải.
2. Đường tải đang có **một điểm chết sẵn** (lỗi giữa vòng lặp ⇒ mất phần đã tải) nhưng đó là hành vi
   người dùng đã quen và đang chạy được. Sửa nó **phải đi kèm log thật của lần chạy mới**, không
   gộp vào cùng lúc với 429.
3. Nếu cần làm lại: **một thay đổi mỗi bản**, và bản đó phải dựng lại được độc lập
   (`git revert` từng commit được: `5354fbe` §78, `ee2b2ae` §79, `2f5bcea` §80).


---

## §82 · PHẠM VI REVERT CHÍNH XÁC (1.92.47-W200.93b) — chỉ khâu TẢI về bản cũ

Người dùng chỉ đạo: **"cơ chế gửi xác nhận vẫn giữ của bản mới đúng không, chỉ quay về cơ chế tải
danh sách thôi chứ?"** ⇒ §81 đã revert QUÁ TAY: gỡ cả hai thứ **không nằm trên đường tải**.

### §82.1 Bản đang chạy = 1.92.46 + đúng 2 thứ

| Thành phần | Trạng thái | Vị trí |
|---|---|---|
| **Cơ chế TẢI danh sách** (429 nghỉ 2,5 s cố định, `errRetry <= 8` sau 2 s, trần `guard++ < 1500`, 1 chuỗi `next_cursor`, `async function loadListViaApi`) | **y hệt 1.92.46** | 1753, 1792, 2175 |
| **Cơ chế GỬI / XÁC NHẬN** (`isDefinitiveNotSent`, `isTransientServerError`, `tailChats`, `unavailFast`, `transientRetries`, `lastOutcomeOk`, `peakActive`, `extTry1545`, `extTimeoutMs`, TỔNG HỢP ⏳/🛰/🛡) | **y hệt 1.92.46** (đường gửi đi qua `timedFetch`, không qua `fetchJson`) | 3315, 3572… |
| `gidBreaker` (cầu dao **khâu DÒ global_id**, trước khi gửi) | **CÓ** (từ 1.92.47) | 7968 |
| `stripJsonPrefix()` | **CÓ**, nhưng **chỉ bọc ở ACK Socket** (4683) — **KHÔNG** bọc ở `fetchJson` | 3714, 4683 |

### §82.2 Bằng chứng "khâu tải không đổi" (đối chiếu máy)
`git diff 0a12515 -- scripts/pancake-send-lite.user.js` chỉ có 9 hunk; lọc các hunk rơi vào
khoảng dòng 1340–2500 (khâu tải) ⇒ **chỉ còn 1 hunk ở 1485, và đó là 3 dòng COMMENT** (giải thích
vì sao KHÔNG bọc `stripJsonPrefix`), không phải dòng thực thi:
```js
try { return { ok: true, data: JSON.parse(txt) }; } catch (e) {
```
Đúng nguyên văn của 1.92.46.

### §82.3 Bài học bổ sung
- Revert phải **theo phạm vi người dùng nêu**, không phải "càng sạch càng tốt": `stripJsonPrefix`
  và `gidBreaker` không nằm trên đường tải, gỡ chúng là mất 2 bản vá đã có bằng chứng mà **không**
  giải quyết lỗi đang báo.
- Test mục 25 nay **khoá ngược**: `fetchJson` KHÔNG được bọc `stripJsonPrefix` — để lần sau không
  ai "tối ưu" thêm vào đường tải nữa.

---

## §83 — "KHÔNG MẤT ACK" — đo, tính, và vá 4 con số (1.92.48 / W200.94)

Người dùng hỏi: *"cách nào để đảm bảo không mất ACK, kể cả phải giảm tốc một chút — vì mất ACK
vừa dễ gây trùng vừa chậm do phải bù lại"*. Chọn **mức B** (P1–P4). §83 ghi lại toàn bộ số đo để
lần sau không phải suy lại.

### 83.1 Trước hết: "mất ACK" ở lô 10:01 là do CHÍNH SCRIPT, không phải FB

| nguồn | có thật? | bằng chứng |
|---|---|---|
| FB không trả `/ls_resp` cho frame gửi (type 3) | **không có ca nào** | 3 HAR có `_webSocketMessages`, ghép `request_id`: batmesss **8/8**, guisot **20/20**, guikhachcu **2/2** ⇒ **30/30** lệnh gửi đều được trả lời (p50 234/326/474 ms, max 1 531 ms). 2 frame không khớp đều là `type: 2` (đồng bộ init) |
| Script tự cắt rồi **xoá chỗ nhận ACK** | **có — nguồn chính** | `socketPublishSend` cũ: hết `ackWaitMs` ⇒ `clearTimeout + delete helper.PENDING_MESSAGES[myKey]` ⇒ gói về sau không còn callback (app log `NOT_FOUND_CALLBACK_FOR_RESPONSE`) ⇒ `classify()` nhận `payload=null` ⇒ `noack` ⇒ ⚠ ⇒ kiểm chứng ⇒ bắn cứu Ext |
| Kênh ACK chết thật (30 s không gói nào) | **0 ca trong lô** | app tự đặt trần `b = 3e4` (`_app` @815747, xoá entry ở @819154); log chỉ chạy 350 s và mọi ca ⚠ được cứu trong 12–31 s |

### 83.2 Hai con số đo sai đã dẫn tới chuỗi sự cố

1. **Vòng mẫu ACK chỉ 200 mẫu** ≈ **5 giây cuối lô** (40 tin/s). Dòng log in `p50/p90 1739/2484`
   nhưng phân bố thật của cả lô (6 815 ACK, dòng 527 của log) là:

   | bucket | n | % | percentile suy ra |
   |---|---|---|---|
   | 250–999 ms | 5 | 0,07 % | — |
   | 1–2 s | 3 081 | 45,2 % | p50 ≈ **2,03 s** |
   | 2–5 s | 3 389 | 49,7 % | p90 ≈ **4,70 s** · p95 ≈ **5,00 s** |
   | ≥ 5 s | 340 | 5,0 % | max **7 988 ms** |

   ⇒ ngưỡng nới làn, trần chờ ACK và ngưỡng "ACK chậm" đều bị chỉnh theo **đuôi lô**, không theo cả lô.
2. **Trần cứng < max đo được**: hạn chờ hiệu dụng `clamp(p90×3, 1200, 6000)` = 3 974 ms (p90 200 mẫu),
   trong khi max ACK của chính lô là **7 988 ms** ⇒ 340 ca ≥5 s bị cắt theo định nghĩa.

### 83.3 Chuỗi sự cố 6 giây (log 10:01)

```
09:57:19  🧯 Socket ACK của page … coi như CHẾT (3 lần no-ACK liên tiếp)
09:57:20  🐢 ACK chậm liên tiếp 4 lần — giảm lane 384 → 64
09:57:21  🧯 Mất ACK liên tục 25 tin — hạ SÀN socket xuống 32/page
09:57:21  ⚠ ×91 chat cùng lỗi — Socket không rõ kết quả (không có ACK)
```
**84/101 ca no-ACK nổ trong CÙNG MỘT GIÂY** ⇒ "3 lần liên tiếp" bị thoả bởi 8 % frame của một giây,
không phải bởi kênh chết. Hệ quả đo được:

| mốc | chat | thời gian | tốc độ |
|---|---|---|---|
| 09:55:09 → 09:57:19 | 0 → 6 058 | 130 s | **46,6 /s** |
| 09:57:19 → 10:00:59 | 6 058 → 10 629 | 220 s | **20,8 /s** |

`Socket bị né (ACK chết) 7 665` · `dò lại ACK chết 384 (hồi 0)` · `limits cuối [56×1]`.
Nếu giữ 46,6 /s cho 4 571 chat còn lại: **98 s** thay vì 220 s ⇒ lô 228 s thay vì 350 s (**−35 %**).

### 83.4 Nới làn 256 → 384 vừa không nhanh hơn vừa gây mất ACK

Đo theo 12 dòng `🌊 Wave` (thời gian qua cổng của chính wave đó):

| làn | wave | tốc độ wave | TB |
|---|---|---|---|
| 256 | 1, 2, 3 | 48,9 · 48,2 · 34,8 | **44,0 chat/s** |
| 312–320 | 4, 5, 6 | 36,5 · 41,1 · 35,4 | **37,7 chat/s** |
| **384** | 7–12 | 36,5 · 25,8 · 41,6 · 37,5 · 36,2 · 24,2 | **33,6 chat/s** |

Cổng chặn nới làn cũ là `p50 ≤ 1 800 ms` trong khi p50 của lô = **1 739 ms** ⇒ **lọt**. Đây là lỗi
thiết kế: **dùng trung vị để canh đuôi**. p50 1 739 hoàn toàn tương thích với p95 5 000.

### 83.5 Tính chi phí tốc độ của "nghe ACK lâu hơn" (Little's law)

`tốc độ = làn ÷ E[thời gian giữ 1 frame]`; E[giữ] lấy từ chính phân bố ở 83.2:

| hạn chờ | E[giữ] | trần @ làn 256 | trần @ làn 384 |
|---|---|---|---|
| 6 s (đang chạy) | **2,62 s** | 97,7 tin/s | 146,6 tin/s |
| 8 s | 2,72 s | 94,1 tin/s | 141,2 tin/s |
| 12 s | 2,88 s | 88,9 tin/s | 133,3 tin/s |
| 30 s (trần app) | 3,15 s | 81,3 tin/s | 121,9 tin/s |

Tốc độ THẬT: 30,39 lệnh/s cả lô · 46,6 chat/s pha khoẻ · 20,8 chat/s pha sập.
⇒ Mọi phương án đều nằm **dưới** trần làn. **Nút cổ chai không phải hạn chờ ACK** ⇒ nới nó không
mua được gì. Vì vậy phương án "nới hạn chờ" đã **cân nhắc và BỎ** (xem 83.6): chỉ cần chỗ nhận
ACK sống lâu hơn, còn thời gian giữ slot giữ nguyên ⇒ **0 % tốc độ**.

### 83.6 Đã vá (1.92.48 / W200.94) — 4 việc, không thêm một lệnh gửi nào

| # | chỗ sửa | trước | sau | vì sao |
|---|---|---|---|---|
| P1 | `socketPublishSend` khi hết hạn chờ | `clearTimeout + delete PENDING[myKey]` ⇒ ACK muộn bị vứt | **không xoá**; giữ tới `ackListenMs` = max(12 000, hold+6 000) ≤ 30 000; hết cửa sổ mới dọn + đánh dấu `mySilent` | ACK muộn vẫn được phân xử thật qua `lateApply` (chỉ đọc: `markDelivered` / nhánh bù đã có). HOLD **không đổi** ⇒ tốc độ không đổi |
| P2 | `ackLatRing` | 200 mẫu (≈5 s cuối lô) | **1 000 mẫu** + `latencyPct()` + `sockAckP95()` | ngưỡng phải bám cả lô, không bám đuôi |
| P3 | "ACK chết" | 3 lần `noack` (mà `hitCeiling` gần như luôn đúng) | chỉ đếm ca **im lặng thật** (`mySilent`), ngưỡng **5**; sàn làn chạy 32 → **96** | 84 ca/1 giây không được là bằng chứng; 32 làn = 1/8 cấu hình = 20,8 chat/s |
| P4 | nới làn / phạt chậm | `p50 ≤ 1 800` · phạt khi `≥ 6 000 ms` ×0,8 | `p95 ≤ 2 200` **và** 0 no-ACK trong 50 ca gần nhất · phạt khi `> 1,5 × hạn chờ đang dùng` ×0,85 | canh đuôi; ngưỡng phạt phải bám hạn chờ của chính page |
| C | cổng chứng minh vắng mặt | chờ mốc `+10 000 ms` | `+14 000 ms` (`BU_PROOF_WAIT_MS` = `BU_PROOF_NOT_BEFORE_MS`) | cổng phải đứng **sau** cửa sổ nghe 12 s, nếu không nó là đường sinh tin trùng duy nhất khi vừa nới cửa sổ nghe |

Dòng log mới để nghiệm thu: `🔔 CỬA SỔ NGHE ACK: giữ slot …ms · nghe …ms · hết hạn chờ (còn nghe
tiếp) N · im lặng THẬT hết cửa sổ M · ACK về MUỘN đã phân xử K (✅ a · FB từ chối b) …`

### 83.7 Kỳ vọng lần chạy sau (tính từ số của chính lô 10:01)

| chỉ số | lô 10:01 | kỳ vọng |
|---|---|---|
| ACK bị cắt bởi hạn chờ | 101 | **0** (chỉ còn im lặng thật) |
| ⚠ cuối lượt | 156 | ≈ 0 |
| `Socket bị né (ACK chết)` | 7 665 | **0** |
| làn cuối | `[56×1]` | **256** |
| pha sau sự cố | 20,8 chat/s | ≈ 44 chat/s |
| tổng thời gian | 350 s | ≈ 228 s |
| rủi ro trùng | 101 lần đánh cược ở cổng chứng minh | **0** |

**Tiêu chí nghiệm thu:** `hết hạn chờ 0` · `im lặng thật ≤ 3` · `Socket bị né 0` ·
`dò lại ACK chết 0` · tốc độ pha giữa ≥ 40 chat/s · `Dò Ext 1545041` **không được xấu đi**.

### 83.8 Rủi ro còn lại (ghi để không phải phát hiện lại)

1. `PENDING_MESSAGES` giữ lâu hơn: ≈ làn × 12 s entry (256 × 12 — không đáng kể); app tự dọn ở 30 s.
2. Đuôi ⚠→✅ có thể dài hơn (tối đa ~12 s) vì ACK muộn giờ được tính thay vì bị vứt.
3. Kênh **chết thật** thì cứu Ext vẫn chạy như cũ, chỉ muộn hơn ~12 s.
4. Đường KHÔNG bắn-nhả (ảnh bù / lượt bù) chỉ **ghi nhận** ACK muộn (`sockLateUnapplied`) — không
   phân xử lại, vì quyết định đã trả về cho người gọi; nếu lô sau thấy số này lớn thì xem lại riêng.

---

## §84 — Lô 6 920 chat (11:05–11:09, bản 1.92.48-W200.94): số đo, ba bẫy, và bốn chỗ vá

Nguồn: log do người dùng dán trong hội thoại (không phải HAR). Mọi con số dưới đây **trích từ log**;
chỗ nào là đọc code thì ghi rõ "code", chỗ nào là suy luận thì ghi "suy luận".

### 84.1 Số đo của lô

| chỉ số | số trong log | đối chiếu |
|---|---|---|
| phát lệnh | 6 920 / 229 s = **30,22/s** | mục tiêu pha giữa ≥ 40/s ⇒ **chưa đạt** |
| ✅ | 3 915 = 56,6 % (16,83/s) | Socket 3 909 · API 6 · Ext 0 |
| ❌ / ⚠ | 2 780 / 225 | 225 = đúng số "CẦN GỬI TAY" |
| `ACK OK/rejected/no-ACK` | **3 909 / 2 876 / 0** | rejected = 41,7 % lưu lượng |
| ACK`TB/max` | 1 710 / 3 819 ms | p90/p95 = 2 399 / 2 618 |
| cổng wave `TB/max` | **7 629 / 12 017 ms** | 14 wave, 9 wave > 7 s |
| `giữ cổng` | 11 369 (toàn bộ là *bay*) | ⇒ cổng chỉ bị giữ vì 192 slot main đầy |
| làn Socket/page cuối | **[384×1]** | nới 256→384 lúc 11:05:37 (16 nấc) |
| nền | bóp 632 · trễ 5 930 lần · +7 236,9 s | đuôi thật chỉ ~3,7 s |

**Kết luận tốc độ (số, không suy đoán):** 192 slot ÷ 30,22 lệnh/s = **6,35 s giữ slot mỗi chat**.
Dòng ⏱ bóc 6,35 s đó thành: `GIỮ SLOT TB chờ 674 ms` + `chuẩn bị 0 ms` + `còn lại 3 406 ms`.
Vì `inFlightMainCount` luôn > 92 % cap ⇒ **trần là 192 slot, và mỗi slot bị giữ 6,35 s**.

### 84.2 Bẫy 1 — "ACK về MUỘN đã phân xử 6 785" là số ĐẾM HAI LẦN

Log: `ACK OK/rejected/no-ACK 3 909/2 876/0` và `ACK về MUỘN đã phân xử 6 785 (✅ 0 · FB từ chối 0)`.

**3 909 + 2 876 = 6 785** — đúng bằng số ACK **đến đúng hạn**. Nguyên nhân (code, `socketPublishSend`):
`lateP` nhận **mọi** gói `/ls_resp` qua wrapper `myEntry.callback`; điều kiện chống chạy lại
(`lateAckClosed`) lại nằm **bên trong** `onLateAck`, không nằm ở chỗ resolve. ⇒ Mỗi tin có ACK đúng
hạn vẫn chạy `classify(g, true)` lần 2 và tăng `sockLateAck`.

Hệ quả: **dòng 🔔 không dùng được để nghiệm thu**. Bằng chứng "không mất ACK" của lô này là
`hết hạn chờ (còn nghe tiếp) 0` · `im lặng THẬT 0` · `no-ACK 0` — cả ba đều đạt.

**Vá (1.92.49):** thêm cờ `ackTimedOut`, chỉ bật khi timer `ackWaitMs` nổ; `lateRef.resolve()` chỉ
được gọi khi `ackTimedOut`. Thêm bộ đếm `sockLateNoack` cho nhánh "muộn mà không payload"
(trước đây im lặng, nên `lỗi xử lý muộn 0` là 0 giả).

### 84.3 Bẫy 2 — ngân sách dò Ext không bao giờ đóng, và **không reset mỗi lượt**

Log: `🛟 Dò Ext cho ca FB từ chối: thử 2 768 · cứu 0` — **thiếu chữ "ĐÓNG"**.
`extTry1545` có `PROBE 200` + `STREAK_MAX 30` (code 8221), `saved = 0`, vậy đáng lẽ phải đóng từ lâu.

- **Nguyên nhân (code):** `noteExt1545Fail()` chỉ được gọi ở 3 nhánh `.then` của chuỗi bù
  (`9034–9058`). Nhánh "ngân sách thử lại Socket đã đóng" bắn bù rồi `return` **ngay**; nếu chuỗi
  bù đó vướng `sockFiredPending`/`outboundLock` thì `.then` **không bao giờ chạy** ⇒ `streak`
  đứng ở 0 ⇒ không đóng. Chi phí: 2 768 lệnh Ext mà cứu 0.
- **Bằng chứng thứ hai (số, rất rõ):** lô 11:10:50 chỉ có **3 chat, 0 lỗi, API 2 · Socket 1**
  mà vẫn in nguyên `thử 2 768 · cứu 0` ⇒ con số trên bảng TỔNG HỢP là **tích luỹ giữa các lượt**,
  không phải của lượt đang chạy. Đọc lên hiểu sai hoàn toàn.

**Vá:** gộp về một hàm `noteExt1545Outcome(kind)` — `saved` / `blocked` (bằng chứng Ext bị chặn)
/ `unknown` (quá hạn, KHÔNG đóng sổ); reset `tried/saved/streak/unknown` đầu mỗi lượt; in thêm
`chưa có kết quả N`.

### 84.4 Bẫy 3 — trần làn 384 làm CHẬM (tương quan âm)

Số đo 2 lô cùng máy/page: **256 ⇒ 44,0 lệnh/s · 312–320 ⇒ 37,7 · 384 ⇒ 33,6**.
Lô 11:05 nới 256→384 lúc 11:05:37 rồi **không hạ lại** suốt lô, dù p95 cuối lô 2 618 ms > trần
`SOCK_RAMP_P95_MAX_MS = 2200`. (Không mâu thuẫn: `rampAllowed()` canh p95 của **1 000 mẫu gần
nhất**, còn dòng TỔNG HỢP in p95 của cả vòng ⇒ hai con số khác nhau.)

**Vá:** `SOCKET_LANE_MAX` 384 → **256**. Đoạn `LANE_CARRY_CLAMP` đầu lô vốn đã hạ về 256 mỗi lần
chạy — nay trần chặn luôn đường leo trong lô.

### 84.5 Chỗ chưa kết luận được — và cách để lần sau biết

`còn lại 3 406 ms` sau ACK (chiếm 54 % thời gian giữ slot) chưa có số nào bóc tách. Ứng viên:
khâu bind ảnh `POST /contents/facebook` (`is_reusable=false`, 1 lệnh/chat có ảnh) chạy **trong**
lúc giữ slot. Không có số ⇒ không được kết luận.

**Vá (chỉ đo, không đổi hành vi):** bọc `uploadPhotoForPage` bằng bộ đo `photoUpStats`
(n / TB / max / lỗi) và in trong dòng `⏱ GIỮ SLOT` dưới nhãn `📷 bind fbId`.

**Lô sau đọc thế nào:** nếu `📷 bind fbId TB` ≈ 3 000 ms ⇒ nút cổ chai là khâu ảnh, xử lý riêng.
Nếu nó nhỏ ⇒ thời gian nằm ở cổng chờ ACK, phải xem lại `ackHoldMsFor()` (lô này giữ slot 6 000 ms
= trần `ACK_HOLD_CEIL_MS`, vì p90 2 399 × 3 = 7 197 bị kẹp trần).

### 84.6 Tiêu chí nghiệm thu lô sau

| chỉ số | lô 11:05 | lô sau phải là |
|---|---|---|
| `hết hạn chờ` / `im lặng THẬT` / `no-ACK` | 0 / 0 / 0 | giữ **0 / 0 / 0** |
| `ACK về MUỘN đã phân xử` | 6 785 (đếm 2 lần) | **≤ vài chục**, và `✅ muộn + từ chối muộn` phải ≤ số đó |
| `Dò Ext ... thử N · cứu 0` khi lô nhỏ | 2 768 (tích luỹ) | **0** khi lô không có ca 1545041 |
| `Dò Ext` khi có ca 1545041 | không có chữ ĐÓNG | phải có chữ **ĐÓNG** sau ≤ 30 ca liên tiếp |
| `Socket/page limits cuối` | `[384×1]` | **`[256×1]`** (hoặc thấp hơn nếu ACK chậm) |
| dòng `📷 bind fbId` | không có | **có**, kèm TB/max |
| phát lệnh pha giữa | 30,22/s | ≥ 40/s (chưa hứa đạt — xem 84.5) |

---

## §85 — LÔ 9 242 CHAT (11:34:48→11:39:49, bản 1.92.49-W200.95): BỐN CHỖ ĐO SAI ĐÃ SẬP

Nguồn: file `botfake-log-20261117-114016.txt` — Mục 1 (389 dòng) + Mục 2 (16 072 dòng sổ
kiểm chứng, 9 242 chat, có timestamp từng ca). Mọi số dưới đây tính TỪ SỔ, không suy luận.

### 85.1 Kết quả lô

| chỉ số | 2 413 chat (11:30) | **9 242 chat (11:34)** |
|---|---|---|
| phát lệnh (số in ra) | 85,67/s | **31,14/s** |
| ✅ thành công | 1 486 (61,6 %) | **5 696 (61,6 %)** |
| ❌ / ⚠ | 910 / 17 | **3 387 / 159** |
| `ACK muộn đã phân xử` | 0 | **3** (trước 1.92.49 là 6 785) |
| `Socket/page limits cuối` | `[256×1]` | **`[256×1]`** ✅ |
| `bỏ nới lane` | 0 | **0** ✅ |
| gửi trùng | 0 | **0** ✅ (không chat nào vừa ✅ vừa ❌) |

Tỉ lệ thành công **giống hệt** lô trước (61,6 % / 61,6 %) ⇒ code không xấu đi; khác biệt
tốc độ là do **quy mô** (2 413 chat vừa đủ 5 wave nên không chạm trần; 9 242 chat có 19 wave).

Tốc độ chốt thật theo cửa sổ 10 s (tính từ sổ):
`11:34:50 70,5/s · 11:35:20 63,8/s · 11:36:00 61,4/s · 11:36:20 43,2/s · 11:37:30 38,9/s · 11:37:40 0,2/s`.

### 85.2 BỐN CHỖ ĐO SAI (đã vá ở 1.92.50-W200.96)

**(1) Nhánh 5284 thiếu cờ ⇒ cầu dao Ext không bao giờ đóng.** Lô dồn **3 280 ca** sang Ext,
Ext trả `"Người này hiện không có mặt"` cho **3 122 ca**, mà KHÔNG có dòng `🔒` nào.
Gốc: `noteExt1545Outcome()` chỉ ghi khi `conv.__extFallback1545 === true`, mà cờ đó chỉ được
set ở nhánh FB-báo-1545041 (dòng 7546/7557). Nhánh "ngân sách Socket đã đóng → bù Ext"
tăng `tried` mà **không set cờ** ⇒ 3 280 ca vô hình với bộ đếm ⇒ `streak` đứng 0 ⇒
`PROBE 200` và `STREAK_MAX 30` đều không chạm. Đây là **lỗi để sót của 1.92.49**.
Vá: `conv.__extFallback1545 = true;` ngay sau `extTry1545.tried++`.

**(2) `photoUpStats` là số TÍCH LUỸ.** Lô 2 413 chat in `📷 12 362 ca · TB 1 312 · max 9 480 ·
lỗi 0`; lô 9 242 chat in **đúng y nguyên 4 số** ⇒ không thể là số của lượt. Gốc: `photoUpStats`
là object riêng, KHÔNG phải khoá của `sendDiag`/`waveDiag` ⇒ hai vòng reset chung bỏ sót.
Vá: reset riêng đầu mỗi lượt.

**(3) `Đuôi chờ xác nhận: 9 263 ca` > 9 242 lệnh — bất khả.** `sendDiag.tailChats` cộng dồn
theo LẦN GỌI `noteBgPending`, mà một chat đi 2–3 chuỗi bù (`⏳ → 🛟 → ❌`) bị gọi 2–3 lần.
Vá: `tailSeen` — chỉ đếm chat mới.

**(4) `PHÁT 9 242 lệnh trong 296,8 s` gộp cả đuôi.** 19 cổng wave mở hết lúc **11:37:34**
(= 166 s); 131 s sau đó chỉ chốt thêm ~2 chat/s. Gốc: `dispatchEndedAt` đặt sau
`await Promise.all([...socketWorkers, ...extensionWorkers])`. Vá: đóng dấu ở cuối vòng wave,
`sendToAll` không ghi đè. Đọc số sau vá: `PHÁT …/s` = tốc độ khâu phát thật.

### 85.3 ĐÍNH CHÍNH MỘT KẾT LUẬN SAI CỦA BÁO CÁO TRƯỚC

Báo cáo trước nói `waveDiag.slotN/slotAcquireMs/slotPrepMs/slotHoldMs` **tích luỹ giữa các lượt**.
**SAI**: `waveDiag` đã được reset đủ khoá bằng `Object.keys(waveDiag).forEach((k) => { waveDiag[k] = 0; })`.
Số `n=9 242` trùng số chat chỉ vì mỗi chat giữ slot đúng 1 lần ở lô này.
Vấn đề thật của dòng `⏱ GIỮ SLOT` là **đơn vị/đọc sai**: `chờ 571 · còn lại 3 855` là **ms/chat**,
in cạnh `⏱ Phát lệnh 296,8 s` nên rất dễ đọc thành tổng. Vá bằng nhãn `(ms/chat)` + `· tổng` +
`(n=… lần giữ slot)`, không phải bằng reset (reset vẫn giữ cho chắc, vô hại).

### 85.4 NÚT CỔ CHAI THẬT CỦA LÔ: 3 122 LỆNH EXT CHẾT, NẰM NGOÀI MỌI LÀN

Bằng số từ sổ: 3 122 chat có chuỗi `⏳ → 🛟 → ❌ "Người này hiện không có mặt"`.
Trễ `🛟 → ❌`: **p50 50 ms · p90 75 ms · max 84 ms** ⇒ Extension trả lời gần như tức thì
rồi từ chối; 3 122 lệnh này không sinh ra tin nào. Thời điểm dồn: **+70 s → +160 s**, trùng khít
lúc tốc độ rơi 61 → 39 chat/s.

Đối chiếu code: `extBacklogQueue` do `runExtWorker` phục vụ — **không đi qua `pageLane`,
không qua `acquireMainSlot`**; `WAVE_EXT_WORKERS = 128` nhưng trần thật của Extension
~13,4 lệnh/s (HAR, §đã ghi ở dòng 6005) ⇒ **128 worker đâm vào cống 13,4/s**:
3 122 ÷ 13,4 ≈ 233 s xếp hàng để nhận 3 122 câu từ chối.

### 85.5 CHỖ CHƯA KẾT LUẬN ĐƯỢC (đừng kết luận bằng suy luận)

1. **4 426 ms "còn lại" mỗi slot (chờ 571 + còn lại 3 855)** là khâu nào: bind ảnh / chờ
   `pageLane` (192 slot đâm 256 ghế) / chờ `gidExtLane` 1,5 s khi `can_inbox=false`.
   Với lô này chỉ có số `📷 12 362 ca · TB 1 312 ms` nhưng số đó **tích luỹ** ⇒ không dùng được.
   Lô sau (bản 1.92.50) mới có `📷` đúng của lượt + nhãn `ms/chat` ⇒ mới so được.
2. **Vì sao tốc độ rơi đúng lúc dồn Ext**: tương quan rất mạnh nhưng chưa tách được nguyên nhân
   (Ext làn riêng không chiếm slot main ⇒ nghi CPU/tab hoặc tranh chấp `pageLane`). Cần số.
3. `Ext quá hạn 0` + `muộn-mà-lỗi 108` + `⚠ Không rõ 17` (sổ ghi 158 ⚠) — lệch 141 ca, chưa
   đối chiếu được từng ca.

### 85.6 TIÊU CHÍ NGHIỆM THU LÔ SAU (bản 1.92.50-W200.96)

| số | lô 9 242 (1.92.49) | lô sau phải đạt |
|---|---|---|
| gửi trùng | 0 | **0** |
| `Socket bị né` / `im lặng THẬT` | 0 / 0 | **0 / 0** |
| `Dò Ext: thử N · cứu 0` | 3 280, **không có chữ ĐÓNG** | phải có **`🔒 Đóng ngân sách`** sau ≤ 30 ca liên tiếp |
| lệnh Ext chết (ca dồn-Ext) | 3 122 | **≤ 200** (đóng sau 30 ca ⇒ phần còn lại vào danh sách gửi tay) |
| `📷 bind fbId: N ca` | 12 362 (tích luỹ) | **= số chat có ảnh của lô** |
| `⏱ GIỮ SLOT (ms/chat)` | không có nhãn | **có nhãn**, và `chờ + chuẩn bị + còn lại = tổng` |
| `⏳ Đuôi chờ xác nhận: N ca` | 9 263 (> số lệnh) | **≤ số chat của lô** |
| `⚡ PHÁT …/s` | 31,14/s (gộp đuôi) | số phát thật, tách khỏi `đuôi xác nhận` |

---

## §86 — KIỂM CHỨNG BẢN 1.92.50 TRÊN LÔ 6 920 CHAT (12:06:38→12:08:26)

Nguồn: `botfake-log-20261117-120932.txt` — Mục 1 (158 dòng) + Mục 2 (7 842 dòng sổ, 6 920 chat).
Đây là lô ĐẦU TIÊN chạy bản 1.92.50-W200.96, nên đây là lần kiểm chứng 4 vá của §85.

### 86.1 Bốn vá đều chạy đúng

| vá | kỳ vọng | thực tế lô này | |
|---|---|---|---|
| (1) cầu dao Ext | có dòng `🔒`, dồn Ext ≤ 200 ca | **`🔒` xuất hiện lúc 12:07:11**, dồn Ext **364 ca** (lô trước 3 280) | ✅ |
| (2) `photoUpStats` | `📷` khớp lượt, không lặp số cũ | **không in `📷`** — ĐÚNG: lô này **không dùng câu nhanh** (0 dòng `câu nhanh`), không chat nào có ảnh | ✅ |
| (3) `tailChats` | ≤ số chat (6 920) | **6 920** (đúng bằng số chat; lô trước 9 263 > 9 242) | ✅ |
| (4) `dispatchEndedAt` | `PHÁT …/s` tách khỏi đuôi | **PHÁT 54,5 s · đuôi 53 s** — hai số riêng, 14 cổng wave mở hết 12:06:40→12:07:31 = **51 s** khớp | ✅ |

### 86.2 LÔ NÀY NHANH HƠN THẬT — 127,01 lệnh/s

| | lô 9 242 (1.92.49) | **lô 6 920 (1.92.50)** |
|---|---|---|
| PHÁT | 31,14/s (gộp đuôi) | **127,01/s** |
| phát (đo lại từ cổng wave) | 55,7/s | **135,7/s** (6 920 ÷ 51 s) |
| ✅ | 5 696 (61,6 %) | **3 912 (56,5 %)** |
| ❌ | 3 387 | **553** (−84 %) |
| ⚠ | 159 | **2 455** (xem 86.3) |
| `📡 ACK OK/rejected` | 5 686 / 3 392 | 3 904 / 2 924 |
| `⏱ GIỮ SLOT` | ms/chat 571+0+3 855 | **ms/chat 201+0+1 362 (tổng 1 362)** |

Tốc độ chốt theo cửa sổ 10 s: `12:06:41 153,2/s · 12:06:51 143,6 · 12:07:01 134,9 · 12:07:11 81,8 ·
12:07:21 121,0 · 12:07:31 45,5 · 12:07:41 2,5` (đuôi).
⇒ Tiêu chí §83.7 (≥ 40 chat/s) **đạt** ở pha giữa, và đạt cả khi tính bình quân.

### 86.3 ⚠ 2 455 KHÔNG PHẢI LỖI MỚI — đó là HỆ QUẢ TRỰC TIẾP của vá (1)

Sổ: **2 451 ca** kết thúc bằng đúng một câu:
`Socket: FB từ chối · đã đo 200 ca thì Extension cũng bị chặn ⇒ GIỮ ⚠ (chưa gửi), vào danh sách gửi tay`
(+ 4 ca `bù không rõ kết quả`). Toàn bộ rơi vào **12:07:10–12:08:25**.

Đây là nhánh dòng 5304–5307: sau khi `extTry1545.closed = true` thì MỌI ca Socket-bị-từ-chối
sau đó **không bắn lại Socket (biết chắc vô ích) và không bù Ext (đã đo Ext cũng chặn)** ⇒ giữ ⚠.
Trước vá (1), cầu dao không đóng nên các ca này bị đẩy sang Ext, Ext từ chối, rồi chốt **❌**
(lô 9 242: ❌ 3 387, ⚠ 159). Nay chúng thành **⚠** (lô này: ❌ 553, ⚠ 2 455).
Tổng `❌ + ⚠`: **3 546 → 3 008** (giảm 538), và **không ca nào bị chốt ❌ oan**.

⚠ **Đánh đổi phải nói rõ:** 2 455 chat này giờ nằm trong danh sách **gửi tay**. Không mất tin
im lặng (vẫn được liệt kê trong `.txt`), nhưng người dùng phải xử lý tay nếu muốn.

### 86.4 VÌ SAO ĐÓNG Ở 364 CHỨ KHÔNG PHẢI 30 (ngưỡng `STREAK_MAX`)

Đếm theo thời gian từ log:
```
t=0s   (12:07:10)  🛟 dồn Ext 364  ·  ❌ bù Ext bị chặn 61  ·  ⚠ giữ tay 209   🔒
t=5s               🛟 0            ·  ❌ 68                 ·  ⚠ 386
t=10s              🛟 0            ·  ❌ 98                 ·  ⚠ 675
t=15s              🛟 0            ·  ❌ 91                 ·  ⚠ 526
t=20s              🛟 0            ·  ❌ 42                 ·  ⚠ 610
t=25s+             🛟 0            ·  ❌ 0                  ·  ⚠ 37 (đuôi)
```
364 ca dồn trong **cùng 1–2 giây** vì `runMainItem` bắn một wave 192 slot và ACK rejected về
gần như đồng loạt (ACK TB 1 543 ms). `noteExt1545Outcome('blocked')` chỉ chạy **sau** khi Ext
bù trả lời; đến khi ca thứ 360 trả lời thì 364 ca đã vào hàng. Vì vậy `tried` (364) > `streak` (30)
⇒ log in `byProbe = tried >= PROBE`, không in `thử từng ca một`.
**Không phải lỗi logic**: sau khi đóng, 2 451 ca còn lại không dồn Ext thêm lần nào.

### 86.5 HAI CHỖ IN LỆCH NHAU (đã vá ở 1.92.51-W200.97)

- Dòng `🏁 … Đã phát lệnh xong trong **107 s**` và dòng `⚡ PHÁT … trong **54,5 s**` nói hai số
  khác nhau về cùng một việc. Gốc: chỗ in 🏁 lấy `Date.now()` tại **lúc in** (đuôi đã chạy ~53 s),
  không lấy `dispatchEndedAt`. Vá: dùng `batchStats.dispatchEndedAt`.
- **ĐÍNH CHÍNH §85.6:** dòng `📷 bind fbId` vắng mặt ở lô này **không phải lỗi reset** — lô không
  dùng câu nhanh. Muốn nghiệm thu `📷` phải chạy lô **có ảnh**.

### 86.6 TIÊU CHÍ LÔ SAU

| số | lô này | lô sau |
|---|---|---|
| gửi trùng | 0 | **0** |
| `Socket bị né` / `im lặng THẬT` / `hết hạn chờ` | 0 / 0 / 0 | **0 / 0 / 0** |
| pha giữa | 121–153/s ✅ | ≥ 40/s |
| `❌` | 553 | không tăng khi `⚠` giảm |
| `⚠` (vào gửi tay) | 2 455 | phải được người dùng xử lý tay, không bỏ qua |
| `📷 bind fbId` | không có (lô không ảnh) | **chạy lô CÓ ảnh** để nghiệm thu vá (2) |
| `⏱ GIỮ SLOT` | 201 + 0 + 1 362 | `chờ + chuẩn bị + còn lại = tổng`; theo dõi 1 362 ms còn ở đâu |
| dòng 🏁 vs ⚡ | 107 s vs 54,5 s (lệch) | **phải bằng nhau** |

---

## §87 — LÔ 8 509 CHAT CÓ ẢNH, TAB NỀN (12:24:19→12:31:03, bản 1.92.51)

Nguồn: `botfake-log-20261117-123347.txt` (407 dòng + sổ 9 505 dòng, 8 509 chat).
Bối cảnh người dùng nêu: **tab chạy nền, làm việc ở tab khác cùng cửa sổ**.

### 87.1 Kết quả
✅ 6 768 (79,5 %) · ❌ 786 · ⚠ 955 · PHÁT 32,66/s · đuôi 142,8 s · tổng 404 s
`📷 8 186 ca · TB 842 ms · max 18 978 ms · lỗi 0` (8 186 = 8 509 − 323 chat không ảnh)
`⏱ GIỮ SLOT 662 + 0 + 5 079 = 5 741 ms/chat` · `ACK TB 1 654 / p90 1 431` · gửi trùng **0**

### 87.2 HAI KẾT LUẬN CỦA TÔI Ở LƯỢT TRƯỚC ĐÃ SAI — ĐÍNH CHÍNH

**(a) "163 slot luôn bận, chỉ dùng 85 % cap ⇒ phải nâng cap".** **SAI.**
`floor(192 × 0,85) = 163` — đúng bằng `softActiveLimit` (dòng 11284). Con số "main đang bay 163"
KHÔNG phải "chỉ 163 slot được dùng", mà là **giá trị được ghi lại đúng tại thời điểm cổng đang
bị chặn**. Cổng chặn khi `inFlightMainCount > 176` (92 % cap) **hoặc** khi chưa đủ mục tiêu %
(dòng 11298/11299) ⇒ `slogan "163"` chỉ nói rằng lúc in, nhánh mềm vừa đủ điều kiện.
Bằng chứng phụ: `peak Socket/page active 256/256` — nếu main chỉ có 163 thì Socket/page không
thể đạt 256. ⇒ **KHÔNG nâng `WAVE_MAIN_TOTAL_CAP`** (đó là điều đã bị cấm từ đầu phiên).

**(b) "Bind ảnh nằm NGOÀI slot".** **SAI.** Đã kiểm trong code: nhánh fast-path (dòng ~7402)
sau khi có sẵn globalId **vẫn** gọi `uploadOneTimePhoto()` → `uploadPhotoForPage()` trước khi
publish. Số khớp: có ảnh 5 741 ms/chat vs không ảnh 1 362 ms/chat; 842 ms ≈ 15 % thời gian giữ
slot. Chú thích cũ trong code ghi "BỎ QUA HOÀN TOÀN extPrepLane" cho cả trường hợp có ảnh ⇒
đã sửa chú thích. **Bài học: chú thích sai trong code đã trực tiếp đẻ ra kết luận sai trong báo cáo.**

### 87.3 NÚT CỔ CHAI THẬT: 18 CỔNG GIỮ 253,6 s / 404 s = 63 % THỜI GIAN LÔ

| | |
|---|---|
| wave 15 | mở 12:26:21 → xong **12:28:07** = **106,0 s** (26 % cả lô) |
| wave 16/17/18 | 16,1 / 11,5 / 4,6 s |
| tổng 18 cổng | **253,6 s** |

Cơ chế (đọc code): cổng mở khi `done ≥ 40 %` **và** `inFlightMainCount ≤ 144` (75 %), hoặc sau
1 600 ms **và** `done ≥ 25 %` **và** `inFlightMainCount ≤ 163`. `acquireMainSlot()` gọi
`runMainItem()` gần như tức thì sau `await` ⇒ "đang bay" hiếm khi đo được ở mức thấp.
**Đây là GIẢ THUYẾT, chưa kết luận** ⇒ bản 1.92.52 thêm 4 số đo (xem 87.4), **không đổi nhịp
kiểm cổng, không đổi ngưỡng nào**.

### 87.4 BỐN VÁ CỦA 1.92.52

1. **Cổng — tách 3 mức "đang bay"** (`gateBlockHard` / `gateBlockSoft` / `gateBlockProgress`)
   + `gateIdleSeen` / `gateIdleMax` để kiểm chứng giả thuyết 87.3. **Chỉ đếm, nằm TRƯỚC khối chặn.**
2. **Sổ kiểm chứng — hết 2 dòng ✅ cho 1 lần gửi.** `logFailGrouped(..., noAudit)`; chỉ dùng ở
   dòng "bù THÀNH CÔNG" vì `markDelivered()` ngay đó đã ghi ✅. 50 chỗ gọi khác **không đổi**.
3. **`gidExtLane` có đường hồi.** Lô này `Ext dò = 4` suốt lô trong khi **551 ca** thiếu globalId
   (`lần dò chưa ra 555`, `Ext chưa rõ 555`), dẫn tới **547 ca ❌ "api (#10) | Ext không gid |
   socket không gid"**. Đường hồi cũ chỉ có 10 phản hồi nhanh < 5 s — bất khả khi Ext bị bóp.
   Nay: sau ≥ 2 lần đã co **và** còn ≥ 12 ca đang chờ ⇒ +2 mỗi 6 lần. **Trần 12, thấp hơn
   khởi điểm 20** ⇒ không mở vùng vận hành mới.
4. **Sửa chú thích sai** về bind ảnh (87.2b).

### 87.5 CHỖ CHƯA KẾT LUẬN ĐƯỢC
1. **4 237 ms "còn lại"** sau khi trừ bind ảnh (5 079 − 842) là gì: chờ `pageLane` / chờ ACK /
   chờ CPU bị bóp. Cần số `gateIdleSeen` + `chi tiết giữ cổng` của lô sau.
2. **Tab nền ảnh hưởng bao nhiêu?** `bị bóp 296 lần + trễ 3 312 lần · +5 374,7 s`. Chưa tách
   được bao nhiêu trong 5 741 ms/chat là do Chrome bóp. Muốn biết phải chạy **cùng lô, tab hiện**.
3. `⚠ 934 ca` = "GIỮ ⚠ vì đã đo 200 ca" ⇒ vào danh sách gửi tay. **Không mất tin im lặng.**

### 87.6 TIÊU CHÍ LÔ SAU
| số | lô này | lô sau |
|---|---|---|
| gửi trùng | 0 | **0** |
| chat có ≥2 dòng ✅ | 6 (cùng 1 lần gửi) | **0** |
| `Ext dò` | 4 suốt lô | phải > 4 khi còn ≥12 ca chờ |
| `slot thoát ≤75% cap` | không có số | nếu **0 lần** ⇒ giả thuyết 87.3 đúng |
| `chi tiết giữ cổng` | không có số | cứng/mềm/tiến độ phải cộng xấp xỉ `giữ cổng` |
| pha giữa | 32,66/s | ≥ 40/s (với lô không ảnh: đã đạt 127/s) |

---

## §88 — LÔ 8 509: BA LỖI ĐO ĐƯỢC + XẺ "CÒN LẠI" (1.92.53)

Tiếp §87. Lượt này **không đổi nhánh gửi nào**; chỉ sửa một lỗi đếm và thêm số đo.

### 88.1 SỐ HỌC CHỨNG MINH "CHỜ 662" LÀ SỐ ẢO

Lô 12:24: PHÁT 260,5 s · 8 509 lệnh · main cap 192 · `giữ slot 5 741 ms/chat`.

| | |
|---|---|
| 192 slot × 260,5 s | 50 016 slot-giây |
| ÷ 8 509 chat | **5 879 ms/chat = SÀN CỨNG** (không chat nào có thể giữ slot ít hơn, tính trung bình) |
| log in | **5 741** < 5 879 |

⇒ Hai số **không cùng mẫu số**: `slotN` chỉ tăng sau `sendOneAndLog` trả về; ca bị chặn/hoãn/comment vẫn giữ slot mà không cộng vào `slotN`. Và **"chờ 662" nằm TRONG "còn lại 5 741", không cộng thêm**. Đọc `662 + 0 + 5 741` như 3 phần độc lập là **sai** — đây là chỗ dễ đọc nhầm thứ ba của dòng log đó (hai chỗ trước: §86 đơn vị, §87.2a cap).

### 88.2 `chờ slot` GẦN NHƯ CHẮC CHẮN CŨNG LÀ SỐ ẢO

`releaseMainSlot()` (dòng ~11080): khi có người chờ, nó **chuyền slot trực tiếp**
(`mainSlotWaiters.shift()(true)`, `inFlightMainCount` không đổi). Nhưng `_tAcq0` được lấy
**trước** `await acquireMainSlot()`, nên ca được chuyền vẫn đo được vài ms khởi tạo promise ⇒
cộng dồn thành 662 ms/chat dù **không ai thật sự xếp hàng**.
Nay tách `slotAcqN` = số ca phải chờ **thật** (> 0 ms). **Nếu lô sau ra `0 ca` thì 662 ms là số ảo.**

### 88.3 `🚫 n lần API bị chặn ngoài cửa sổ 24h` LÀ LỖI ĐẾM — ĐÃ SỬA

`windowClosed` **chưa bao giờ được gán** trong toàn bộ file (0 chỗ gán, 2 chỗ đọc: dòng 7309 và
10948) ⇒ luôn `undefined` ⇒ tổng chỉ có thể là **0 hoặc 1** (1 do `windowBlocked++` ở dòng 3379).
Log in đúng **`🚫 1 lần`**.

Nhưng đếm trong cùng log: **375 ca ❌** `api: (#10) ngoài 24h` + **167 ca ❌** `api: (#551) không có mặt`
⇒ **≥ 542 ca** thật. Sai gấp 500 lần.

**Đã sửa**: `windowClosed: isWindowClosedError(tried.join(' | '))` trong kết quả cuối của `sendOne`.
Chỉ **đọc thêm**, không đổi nhánh gửi/bù.

### 88.4 SỐ CA ❌ KHÔNG PHẢI 786 LỖI CẦN SỬA CODE

`#10 ngoài 24h` (375 ca) và `#551 không có mặt` (167 ca) là **FB từ chối, không kênh nào gửi được**.
`Extension không gửi được (1545041)` (23 ca) cùng loại. Cộng ~565/786 ⇒ **~72 % số ❌ là bất khả**,
không phải lỗi phần mềm. Đây là lý do **không** được lấy 786 làm thước đo chất lượng.

### 88.5 BA SỐ ĐO MỚI (chỉ đo, không đổi hành vi)

| số | nghĩa | trả lời câu hỏi |
|---|---|---|
| `phải chờ slot n ca · TB x ms` | số ca **thật sự** xếp hàng chờ slot | `chờ 662` có thật không |
| `dò gid n ca · TB x ms` | thời gian `resolveGlobalId` | 555 ca "lần dò chưa ra" tốn bao nhiêu ms |
| `chuẩn bị ctx (không tính bind)` | `slotPrepMs − prepBindMs` | tách bind ảnh ra khỏi phần chuẩn bị |

Ba số này + `📷 bind fbId` + `giữ cổng` **phải cộng xấp xỉ `còn lại`**. Phần dôi ra = CPU bị bóp.

### 88.6 ĐIỀU ĐÃ KIỂM VÀ THẤY KHÔNG PHẢI VẤN ĐỀ

- **ACK không nằm trong slot.** `ctx.sockFired` trả về ngay sau `await slotStartedPromise`;
  `finalizeSockBg` xử lý ACK ở nền. Nên đừng tìm "chờ ACK" trong `còn lại`.
- **`extPrepLane` không phải làn hẹp**: `PREP_PARALLEL_EXT = 160` (dòng 6010) trên 192 slot.
- **`photoUploadLane` 96 làn**: cũng không chặn, vì slot thường đã có `ctx.nonReusableFbId`;
  nhánh upload lại chỉ chạy khi chưa có.
- **Âm thanh giữ tab ĐANG CHẠY**: log **0 lần** `⚠ Âm giữ tab chưa chạy` ⇒ cách C (mở khoá audio)
  **không còn gì để sửa**.

### 88.7 CÒN LẠI PHẢI LÀM (chưa làm lượt này)
1. **Cách A** — đưa POST `/contents/facebook` qua service worker khi tab ẩn. **Đã tìm ra chỗ chặn**:
   `swFetchJson` dựng body bằng `formFromObj` (background.js dòng 341, `headers` chỉ có `Accept`)
   trong khi API bind **đòi JSON + `Content-Type: application/json`** (dòng 5786). Muốn làm phải:
   thêm cờ `jsonBody` cho `BOTFAKE_BG_FETCH`, fallback về `fetch` trên trang khi SW lỗi,
   và kiểm `fb_ids` trả về đúng thứ tự. **Rủi ro: mất fbId ⇒ không gửi được tin.**
2. **Gom bind ảnh theo page** thay vì theo chat (8 186 → ~960). Lợi ích lớn hơn A nhưng
   phải chứng minh được `content_ids` dùng lại được cho nhiều `conv_id` — **chưa có bằng chứng**,
   trong khi code hiện tại ghi rõ *"tuyệt đối KHÔNG dùng lại fbId is_reusable=false của A cho B"*.

---

## §89 — HAI LÔ 1.92.53 (13:25 và 13:31): TỐC ĐỘ ĐÃ Ở TRẦN, VÁ 1.92.52 CÓ MỘT CÁI KHÔNG CHẠY

Nguồn: `botfake-log-20261117-132543.txt` (2 413 chat) · `botfake-log-20261117-133140.txt` (6 920 chat).
Cả hai bản 1.92.53-W200.99, **không ảnh**, tab ẩn 94 % / 40 %.

### 89.1 Kết quả

| | LOG 1 | LOG 2 |
|---|---|---|
| ✅ | 1 486 (61,6 %) | 3 908 (56,5 %) |
| ❌ / ⚠ | 349 / 578 | 191 / 2 821 |
| PHÁT | **142,3/s** | **147,1/s** |
| giữ slot | 1 242 ms | 1 183 ms |
| gửi trùng | 0 | 0 |

**Hiệu suất slot: LOG 1 = 15,6 s lý thuyết / 17 s thực = 92 %; LOG 2 = 42,6 / 47 = 91 %.**
⇒ đã sát trần (≈147/s = 192 slot ÷ 1,18 s × 0,91). Muốn nhanh hơn phải **giảm giữ slot**, không phải nới làn.

### 89.2 VÁ `🚫` CỦA 1.92.53 ĐÚNG — VÀ BÀI HỌC ĐẾM

| | sổ `#10` | sổ `#551` | tổng | `🚫` in |
|---|---|---|---|---|
| LOG 1 | 38 | 9 | **47** | **47** ✓ |
| LOG 2 | 1 | 134 | **135** | **135** ✓ |

**Quy tắc đếm: PHẢI đếm trên SỔ (Mục 2), KHÔNG đếm trên log gọn.**
`logFailGrouped` ghi sổ **trước** (1 dòng/ca) rồi mới gộp màn hình (1 dòng/×N) ⇒ đếm log gọn
ra 94 và 271 (gấp đôi) ⇒ dễ kết luận sai là "vá hỏng". Sổ ✅ cũng khớp tuyệt đối với TỔNG HỢP
(1 486 = 1 486 · 3 908 = 3 908) ⇒ **vá `noAudit` của 1.92.52 chạy đúng, không còn ✅ trùng**.

### 89.3 GIẢ THUYẾT §87.2a ĐƯỢC XÁC NHẬN

`slot thoát ≤75 % cap` = **294 lần (LOG 1) / 303 lần (LOG 2)**, **thấp nhất = 0**.
⇒ "163" tuyệt đối không phải "chỉ dùng 85 % cap" (§87.2a đúng). Cả 4 wave đều mở qua nhánh mềm
(≤163), không wave nào vượt 176.

### 89.4 VÁ 1.92.52 KHÔNG CHẠY: `Ext dò` đứng ở 4 suốt CẢ HAI LÔ

`Ext dò 4` = đúng sàn `GID_EXT_MIN`, dù có 138/136 ca phải dò (nếu đường hồi chạy thì phải lên ≥6).

**Nguyên nhân (đọc code + số khớp):** điều kiện cũ là `gidExtLane.waitingCount() >= 12`.
`resolveGlobalId` chạy từ ~192 slot main, mỗi lượt giữ **một** promise trên làn **4 chỗ** ⇒
**nhiều nhất 4 ca** xếp hàng ⇒ `waitingCount() ≥ 12` gần như không bao giờ đúng.
**Đo sai đại lượng**: đếm "đang xếp hàng trên làn" thay vì "còn bao nhiêu ca đang thiếu gid".

**Đã sửa (1.92.54):** đếm `gidStats.unknown − rampAtUnknown` (tồn đọng THẬT), mốc cập nhật sau
mỗi lần nới. Trần **vẫn 12** (thấp hơn khởi điểm 20 ⇒ không mở vùng vận hành mới).
In thêm `Ext dò (đỉnh N)` — lô sau **đỉnh phải > 4**, nếu vẫn 4 thì lại sai.

### 89.5 `dò gid` 13 475 ms = **2 LƯỢT DÒ** (số học khớp)

| | prepGidN | ca "lần dò chưa ra" | 2 × số đó |
|---|---|---|---|
| LOG 1 | 450 | 47 | 94 (chênh 356 — có ảnh hưởng của cứu Ext/Socket) |
| LOG 2 | **278** | **136** | **272** (chênh **6**) |

Gần như trùng khít ⇒ mỗi ca dò **2 lượt**. Và 13 475 ms/ca **vượt mọi hạn chờ đơn lẻ** trong file
(`GID_NOGID_SHORT_WAIT 1 500` · WS `6 000` · Ext `10 000` · ext p90 timeout `7 000` và có nhánh
`want = p90 × 3` = 21 000) ⇒ phải là nhiều lượt nối tiếp.

**Chưa sửa ngưỡng** — 1.92.54 chỉ thêm `dò gid (lượt 1: n/TB x ms · lượt 2: n/TB y ms)`.
`gidRetryPass` (dòng 3836) đã kiểm: **chỉ được đọc, không nơi nào set** ⇒ không phải nguyên nhân.
Lượt 2 đến từ nhánh **bắn lại** (`isSocketRetryPass` → đặt lại `gidResolved = false`, hoặc
`isExtBacklogPass`), chỗ **reset** ở dòng 7629–7630 (`ctx.gidForceFind = true; ctx.gidResolved = false`).

**Cắt ở đâu khi có số:** nhóm "server đã nói không có gid" đã có đường tắt 1,5 s
(`shortNoGidWait`, LOG 1 = 47 ca · LOG 2 = 138 ca). Nếu `lượt 2` phình to đúng nhóm này thì
chỗ cắt là **không dò lại lượt 2 cho ca đã có kết luận `server-no-gid`**.

### 89.6 BẪY ĐỌC SỐ (ghi lại để không lặp)

1. `thành công 3 908/4 042 (96,7 %)` **KHÔNG phải** tỉ lệ giao. Mẫu số 4 042 = 6 920 − 57 − 2 821.
   **2 821 ca bị loại khỏi mẫu số** ⇒ tỉ lệ thật **56,5 %**.
2. **Tổng thời gian cổng KHÔNG cộng dồn**: cổng wave N+1 chờ trong lúc wave N vẫn rút slot.
   LOG 2 có 36,7 s cổng trên lô 47 s nhưng thời gian cộng thêm thật chỉ ≈ **4,4 s**.
3. `🚫` phải đếm trên **sổ**, không đếm log gọn (89.2).

### 89.7 ĐÒN BẨY LỚN NHẤT CÒN LẠI — KHÔNG PHẢI CODE

`📡 SOCKET` LOG 2: `retry lần 0 (cứu 0 · rejected 0 · khác 0 · retry ảnh 0 · bỏ thử lần 2 (ngân sách) 2821)`.
**Số lần bắn lại thật = 0** — 2 821 ca chưa hề được thử lại lần nào.

Nguyên nhân: ngân sách thử lại chỉ mở khi tỉ lệ từ chối **thấp**, mà tỉ lệ thật:
**LOG 1 = 924/2 409 = 38,4 %** · **LOG 2 = 2 930/6 832 = 42,9 %**.

Code ghi rõ (`~6026`): *"Socket/page 128 khởi điểm, đủ cho pace 4ms × **2 page** = 500/s"* —
nhưng `Socket/page limits cuối [256×1]` = **1 page**, trong khi `SOCKET_MIN_PACE_MS = 4` ⇒
trần **250 khung/s/page**.
- 1 page: 6 832 ÷ 47 s = **145/s** (chưa trần)
- **2 page chia tải:** 4 200/2 632 ⇒ page nặng **89/s = 36 % trần** ⇒ dư địa lớn.

**Kết luận:** cần **chia tải qua ≥2 page**, KHÔNG phải nới làn. Với 2 page, tỉ lệ thành công kỳ vọng
≈ 75–80 % thay vì 56,5 % ⇒ **+1 500–1 800 tin/lô**. Đây là **suy luận có số** (cả 2 lô đều 1 page
nên chưa có bằng chứng nhân quả) ⇒ kiểm bằng cách chạy đúng lô đó với 2 page. **Không sửa code.**

---

## §90 — LÔ 12 410 CHAT (14:03, 1.92.54): 3 SỐ ĐOAN + 1 KẾT LUẬN CỦA TÔI SAI

Nguồn: `botfake-log-20261117-140300.txt`. Bản 1.92.54-W200.100, **không ảnh**, 25 wave.

### 90.0 Kết quả
✅ **8 650 (69,7 %)** · ❌ 2 292 · ⚠ 1 468 · PHÁT **51,0/s** · giữ slot **2 671 ms** · cổng TB/max **7 889 / 25 013 ms**.
So lô 13:31 (6 920 chat): thành công **3 908 → 8 650 (+121 %)** nhưng tốc độ **147 → 51,0/s**.

### 90.1 TÔI ĐÃ SAI: "chia tải qua ≥2 page" — BÁC BỎ BẰNG CHÍNH LÔ NÀY
Lô này **vẫn `[256×1]` = 1 page** như `SOCKET_MIN_PACE_MS = 4` cho phép 250/s/page và PHÁT 51/s
(vẫn dưới trần), nhưng thành công **8 650** so với 3 908. ⇒ Tỉ lệ từ chối 39–43 % ở 2 lô trước
**không do 1 page**, mà do **chất lượng danh sách chat** (lô này `khách không nhận 2 283`).
**Kết luận "cần 2 page" ở §89.7 là SAI — rút lại.** Bài học: suy luận từ 1 biến không kiểm được
là đoán, dù có số đi kèm.

### 90.2 BẰNG CHỨNG 1: HẠN CHỜ ACK BỊ KẸP DƯỚI p90 THẬT
| | lô 13:31 | **lô 14:03** |
|---|---|---|
| ACK p90/p95 | 1 808 / 1 913 | **6 773 / 7 321** |
| ACK TB | 1 379 | **4 136** |
| `hết hạn chờ` | 1 | **1 246** |

`buckets 2-5s: 5 247 · ≥5s: 3 772` ⇒ **9 019/12 357 = 73 % ACK đến sau 2 s**.
`ACK_HOLD_CEIL_MS = 6000` (dòng 6131) **< p90 6 773** ⇒ cắt ACK thật ⇒ `hết hạn chờ 1 246`
≈ `⚠ 1 468`. `retry lần 0` ⇒ không cứu được ca nào.
**Chưa sửa**: đây là MẪU SỐ CỦA TỐC ĐỘ (lane ÷ hạn chờ). Nới trần ⇒ giữ slot lâu hơn ⇒ chậm hơn.
Phải chọn có ý thức, chưa đo được cả 2 chiều.

### 90.3 BẰNG CHỨNG 2: CỔNG GIỮ 25 013 ms KHI KHÔNG CÒN WORKER
Wave 24: `qua cổng 500/500 sau 25 013ms; main đang bay 0`.
Khi `inFlightMainCount = 0` thì **không ai xếp hàng chờ slot** ⇒ cả 3 số cứng/mềm/tiến độ bằng 0
mà cổng vẫn giữ. Lý do thật: `waveDoneCount < waveSlice.length` ⇒ cổng chờ **ĐẾM XONG**, và cái
đếm bị **51 ca còn treo trong sổ chờ xác nhận** giữ lại. 8 wave cuối ≈ 60 s / 243 s (25 %).

### 90.4 BẰNG CHỨNG 3: `Ext dò 10 (đỉnh 0)` LÀ SỐ ĐO HỎNG
Làn giảm **20 → 14 → 10** (co ×0,7 hai lần) mà đỉnh in **0** ⇒ bất khả. Gốc: `gidExtPeak` chỉ
được gán trong nhánh **NỚI**, mà nhánh đó **chưa chạy lần nào**.
⇒ **Vá "đường hồi làn dò" của 1.92.52/54 chưa từng có tác dụng.** Con số 10 là do CO, không do nới.
(Tồn đọng chỉ **9** ca `lần dò chưa ra` < ngưỡng 12 ⇒ đúng là không được nới. Logic khớp.)
Không lặp lại lỗi §89.4 (nhận công cho thứ chưa chạy).

### 90.5 BẰNG CHỨNG 4: `Socket bị né (ACK chết) 3 952` GỌI SAI TÊN
`hết hạn chờ 1 246` · `im lặng THẬT 0`. Cơ chế tuyên bố "ACK chết" đòi **5 lần im lặng THẬT
liên tiếp** (dòng ~6583) ⇒ **không chạy**. Thủ phạm là `st.lost >= 2` (dòng 6308) — tức
**"đã 2 lần chứng minh hội thoại KHÔNG có tin sau khi bắn Socket"** (dòng 9851).
Đây là cơ chế **chống mất tin**, bị dán nhãn "ACK chết" ⇒ đọc log sẽ hiểu sai hoàn toàn.

### 90.6 ĐÃ SỬA Ở 1.92.55 (chỉ số đo + nhãn, KHÔNG đổi nhánh gửi nào)
1. `gidExtPeak` ghi ở **mọi** chỗ đổi làn (co ×0,7 · nới AIMD +2 · nới theo tồn đọng) ⇒
   lần sau đỉnh **không thể nhỏ hơn** làn đang chạy.
2. Cổng: thêm `chờ việc xong: N lượt (không còn worker X · treo chờ xác nhận đỉnh Y)`.
   Đo nằm **sau khối chặn, trước nhánh mở** ⇒ không đổi nhánh nào.
3. `Socket bị né (mất tin N · ACK chết M)` — tách 2 luật khác nhau, chỉ đổi **nhãn**.

### 90.7 LÔ SAU PHẢI TRẢ LỜI
| số | kỳ vọng | nếu sai |
|---|---|---|
| `Ext dò (đỉnh N)` | **N ≥ làn đang chạy** | số đo lại hỏng |
| `chờ việc xong: … không còn worker X` | **X > 0** ⇒ xác nhận 90.3 | X = 0 ⇒ giả thuyết 90.3 sai |
| `treo chờ xác nhận đỉnh Y` | Y ≈ số ca bị 90.3 | Y = 0 ⇒ cổng giữ vì lý do khác |
| `Socket bị né (mất tin … · ACK chết …)` | ACK chết ≈ 0 | ACK chết lớn ⇒ phải xem lại |

---

## §91 — CPU LÀ NGUYÊN NHÂN GỐC CỦA MẤT ACK (3 lô 16:27) + `worker-send/`

Nguồn: `botfake-log-20261117-162705.txt` · `...162714.txt` · `...162718.txt`, cả ba **1.92.55-W200.101**,
xuất cùng lúc 16:27 ⇒ **3 tab chạy song song**.

### 91.1 Ba tab cùng chạy: số liệu

| tab | PHÁT | ACK OK | **no-ACK** | giữ slot | 🫥 CPU-kẹt |
|---|---|---|---|---|---|
| 16:27:05 | 19,28/s | **77** | **5 601** | **5 372 ms** | `+84 969 s` · trễ 15 925 · **max 10,9 s** |
| 16:27:14 | 16,23/s | 132 | 5 038 | — | — |
| 16:27:18 | 16,51/s | 5 080 | 2 033 | — | `+66 575 s` · trễ 15 015 · **max 45,9 s** |

Tab 1: `chờ 364 · chuẩn bị 0 · còn lại 5 372` ⇒ **98,7 % giữ slot là KẸT**, không phải I/O.

### 91.2 Chuỗi nhân quả (người dùng phát hiện, số xác nhận)

**CPU bị bóp → đồng hồ trễ → ACK về muộn hơn hạn chờ → mất ACK.**

`p90 ACK 6 572 ms` (tab 1) và `8 292 ms` (tab 3) **> trần `ACK_HOLD_CEIL_MS = 6 000`**
(dòng 6131) ⇒ ACK thật bị cắt ⇒ `hết hạn chờ 5 601 ≈ ⚠ 1 468 + no-ACK`. `retry lần 0`.

### 91.3 VÌ SAO "ẨN DANH SÁCH" KHÔNG CỨU ĐƯỢC

Đã kiểm trong code — phần VẼ đã hạ nhịp từ trước: `flushLogUI` 1 s (2,5 s khi tab ẩn),
`setProgress` 250 ms, `recordWavePressure` ≤10 lần/s. **Thủ phạm không phải DOM:**

| nguồn | dòng | chi phí |
|---|---|---|
| `runPool` | 401 | **1 closure + 1 `await` cho MỖI chat** |
| `sleepUntil` | 317 | **3 promise mỗi lần gọi** (`bgClock.wait` + `stopSignal` + `softWait`) |
| `paceSocketPublish` | 4426 | gọi `sleepUntil` **trước mỗi lần publish** ⇒ mỗi tin 3 promise |

`bgClock.wait` chỉ dùng Worker khi `document.hidden` (dòng 215–221) ⇒ tab HIỆN dùng
`setTimeout` gốc và bị bóp.

### 91.4 TÁCH ĐƯỜNG GỬI RA WEB WORKER — `worker-send/` (thư mục riêng)

Không nằm trong `release/botfake-ext/` hay `release/botfake-ext-stable/` (đã kiểm).

| file | chạy ở | nội dung |
|---|---|---|
| `engine.mjs` | Worker + Node | lõi điều phối, **không DOM/localStorage/fetch** |
| `worker.js` | Web Worker | vỏ: postMessage + `fetch` + tương thích Node để test |
| `bridge.js` | main thread | tạo Worker từ Blob, cấp token/apiBase, trả lời RPC |
| `test-engine.mjs` | Node | **46 test** (đồng hồ giả, không mạng) |
| `test-worker.mjs` | Node | **15 test** chạy **worker thật + HTTP server thật** |

### 91.5 HAI LỖI CHỐNG TRÙNG PHÁT HIỆN KHI VIẾT TEST (đáng ghi lại)

1. **Đặt cờ `inFlight` trong `lane.enqueue` ⇒ CHỐNG TRÙNG MÀ VẪN TRÙNG.**
   `enqueue` chạy fn ở microtask sau ⇒ 3 lần gọi song song cùng chat đều lọt ⇒ **bắn 3 lần**.
   Test `K17` bắt được. Sửa: kiểm + đặt cờ **đồng bộ** ngay đầu `sendOne`.
2. **Item trùng trong danh sách bị lọc im lặng.** Nhánh `delivered` chặn nhưng **không đếm**
   ⇒ người dùng không biết danh sách có chat lặp. Nay cả 3 cổng đều tăng `dupBlocked`.

Cả hai đều thuộc loại "chống trùng mà vẫn trùng" — đúng lỗi bản 1.92.x từng gặp với
`sockFiredPending`. Mutation test: gỡ 7 chỗ then chốt ⇒ **cả 7 đều làm test đỏ**.

### 91.6 GIỚI HẠN HIỆN TẠI (nói rõ, không tô hồng)

1. **Đường gửi trong worker hiện là HTTP API**, không phải Socket. Lý do: `fetch` có sẵn
   trong Worker, và API chỉ cần `conversation_id + token` (HAR: 58/58 lệnh gửi API không có
   global_id) ⇒ **bỏ hẳn khâu dò gid**. Nhưng API chậm/hạn chế hơn Socket.
2. **Chưa chuyển MQTT/Socket vào Worker** — việc lớn, chưa làm.
3. **RPC dò global_id mới có khung** (`API.onRpc('gid', fn)`), chưa nối vào hàm cũ.
4. **Chưa bật mặc định.** Đường cũ nguyên vẹn; `worker-send` chỉ chạy khi gọi `start()`.

### 91.7 VIỆC NÊN LÀM NGAY (không cần code)

**Giảm 3 tab → 1 tab/page.** 3 tab cùng chạy: tổng 52/s nhưng **12 672 no-ACK**.
Một tab đơn lẻ ở lô 14:03 đạt **51/s với 1 246 no-ACK** — cùng tốc độ, **ít hơn 10× lỗi**.

### 91.8 LỖI `bridge.js` — bundle cho Worker là SyntaxError (đã sửa, có test)

`bridge.js` **không thể** `import` `engine.mjs`: nó chạy trong content script `world: MAIN`,
chỉ có URL của chính nó. Nên phải **ghép engine.mjs + worker.js thành 1 script classic**
rồi cho vào Blob. Bản đầu tôi làm thiếu 2 bước:

1. **Chỉ strip `export` của `engine.mjs`, quên `worker.js`** ⇒ `export function isRejectedError`
   và `export { boot }` nằm lại trong blob ⇒ **SyntaxError**.
2. **Bọc trong `(function(){…})` không `async`**, trong khi `worker.js` có `await` ⇒ **SyntaxError**.

**Biểu hiện ra ngoài: Worker chết ngay khi tạo, panel KHÔNG có một dòng log nào.** Đây là
loại lỗi tệ nhất — cài xong tưởng chạy mà thực ra chưa có gì chạy.

Cách phát hiện: dựng bundle bằng chính `buildWorkerCode()` rồi `new vm.Script(bundle)`.
`node --check` file riêng lẻ **không** bắt được vì mỗi file đều hợp lệ.

Đã sửa: bọc `async` · strip `export` sau khi ghép cả 2 file · thêm lưới chặn
`if (/^\s*(export|import)\s/m.test(code)) throw` · bỏ top-level `await` trong `worker.js`
(dùng `process.getBuiltinModule` thay `await import`).

**Test mới `worker-send/test-bridge.mjs` — 24 ca (B1–B24).** Chạy `bridge.js` thật →
bundle thật → `vm` giả lập trình duyệt (có `self`) → HTTP server thật. Mutation-test:
- gỡ strip `export` của worker ⇒ **B1, B3 đỏ**
- bỏ `async` ⇒ **B3, B4, B9 đỏ**

Tổng test worker-send nay **85** (46 + 15 + 24). Bản 1.92.55 vẫn **201/201**, build `--check` OK.

### 91.9 `worker-send/` DÙNG ĐƯỢC THẬT — 5 lỗi nữa phải sửa (có test)

Khung ở §91.5–91.8 vẫn **chưa dùng được**. Để dùng được phải qua 5 lỗi sau, mỗi lỗi
đều có test khoá:

**LỖI 1 — BỊA ENDPOINT (nặng nhất).** Tôi viết
`POST {apiBase}/v1/pages/{id}/messages` + body `{conversation_id, message}`.
Đối chiếu `buildInboxSend` (dòng 3130): request thật là
`POST …/pages/{page_id}/conversations/{convId}/messages` + **multipart** có
`action=reply_inbox`, `send_by_platform=web`. **Request của tôi vô hiệu hoàn toàn.**
Test cũ vẫn xanh vì server giả nhận gì cũng trả `success` ⇒ **test đúng, giả thuyết sai**.

**LỖI 2 — THIẾU CỜ `is_record_ctx_7_days`.** HAR trong chính script cũ: **19/19 request CÓ
cờ ⇒ success**; **24/24 THIẾU cờ ⇒ `(#10)`**. Thiếu cờ là nguyên nhân phổ biến nhất của
`#10`, KHÔNG phải "app khác giữ thread".

**LỖI 3 — `loadlist.js` KHÔNG HOOK MẠNG ⇒ token rỗng.** Bản cũ hook `fetch`/`XHR` ngay khi
nạp (dòng 13730). Trên `pages.fm`, JWT **không** nằm trong localStorage/`__NEXT_DATA__`,
chỉ xuất hiện trong query của request trang đang gửi ⇒ không hook thì `getToken()` trả `''`
⇒ báo "Không có access_token" **dù trang chạy bình thường**.

**LỖI 4 — bundle thiếu strip `export` + hàm không `async`** (§91.8): Worker chết câm.

**LỖI 5 — `run()` trả thiếu `items`, `results()` trả `undefined`** khi chưa xong.

Kết quả: **148 test** trong `worker-send/` (46 + 17 + 26 + 32 + 27), `npm run test:worker`.

Bản cài: `node worker-send/build.mjs` → `dist/worker-send.install.js` (57,7 KB) — dán vào
console trang Pancake, rồi `BOTFAKE_WS.run({text, dryRun:true})` để chạy thử.

Mutation-test: bỏ hook ⇒ H2/H3 đỏ · bỏ cờ ctx7 ⇒ I22 đỏ · URL bịa ⇒ I18 đỏ.

### 91.10 LỖI "CHỈ TẢI ĐƯỢC 40 LÀ DỪNG" — 3 nguyên nhân gốc (đã sửa, có test)

Người dùng báo: *"tải danh sách còn lỗi chỉ tải được 40 là dừng"*. Đối chiếu HAR
(`loaddanhsach.har` #8, `guikhachcu.har` #26): **server trả 40 chat/trang kèm `next_cursor`**,
`current_count` thật của app là **40** (bản trước tôi để 60 — sai).

**NGUYÊN NHÂN 1 — endpoint bị GỘP (nặng nhất).** `buildListUrl` tính
`multi = !!pgs.multiplePageMode` mà **bỏ qua `singlePageId`**. Khi tải nhiều page song song,
cả 10 chuỗi đều gọi `/v1/conversations?pages[…]` (endpoint gộp) rồi **khử trùng lẫn nhau**
⇒ mỗi page hụt chat. Đo được: **10 page × 4 trang × 40 = 440/1600 chat**, mỗi page 80/160.
Sửa: `multi = !opts.singlePageId && !!pgs.multiplePageMode`. Sau sửa: **1600/1600**.

**NGUYÊN NHÂN 2 — không thử lại khi 429.** Bản trước: 1 lần fetch, `if (!res.ok) return lỗi`
⇒ trang 2 dính 429 là **dừng LUÔN ở 40 chat**. Bản cũ (`fetchJson`, dòng 1445) thử lại **3 lần**,
nghỉ `400·t` ms, timeout 15 s, và có **cơn 429 dùng chung nghỉ 2,5 s** (dòng 1773). Nay làm lại
đúng: `fetchJson` + `waitRateLimit()` + `note429()`, đếm `rateLimited` để báo người dùng.

**NGUYÊN NHÂN 3 — chỉ đọc 1 dạng response.** Bản cũ (dòng 9590) đọc **cả**
`data.conversations` **và** `data.data.conversations`; bản trước chỉ đọc vế đầu ⇒ gặp dạng bọc
trả **0 chat mà vẫn `ok:true`**.

**HAI LỖI PHỤ CŨNG LÀ LỖI THẬT:**
- `loadOneChain._stall` — biến đếm đặt trên **function**, nên 10 page chạy song song **dùng chung**
  ⇒ page này bị page kia đẩy lên 2 ⇒ báo lỗi oan. Nay là biến cục bộ.
- `load()` luôn trả `ok:true` dù có page lỗi ⇒ panel coi là thành công, chỉ hiện "0 chat" mà
  không nói vì sao. Nay `ok = errors.length === 0`, vẫn trả `items` đã tải được.

**Test khoá: N1–N4** (10 page/40 chat/trang/1600 chat · 429 hai lần · `{data:{}}` · cursor bị bỏ qua).
Mutation: trả `multi` về tính từ Redux ⇒ N1b/N1d/N1e đỏ; bỏ thử lại 429 ⇒ N2/N2a/N2b đỏ;
bỏ đọc `{data:{}}` ⇒ N3 đỏ.

---

## §92 — HIỆU NĂNG: O(N²) TRONG ĐƯỜNG NÓNG (đã đo, đã sửa, 1.92.56)

Người dùng phản ánh: *"khi gửi tôi ẩn danh sách chat rồi, giao diện trống không vẫn lag"*.
Đây là bằng chứng quyết định — **lag không phải do vẽ DOM**, vì lúc đó không có gì để vẽ.

### 92.1 PHÉP ĐO (trích nguyên văn hàm từ chính userscript, chạy với dữ liệu thật)

| n (số chat) | `getBatchSummaryCounts()` gọi n lần |
|---|---|
| 2 000 | 163,9 ms |
| 4 000 | 806,5 ms |
| 8 000 | 4 052,1 ms |
| **12 410** | **9 945,7 ms** |

Tăng theo bình phương ⇒ O(n²) thật, không phải cảm giác.

### 92.2 NGUYÊN NHÂN

`getBatchSummaryCounts()` (dòng 8700–8702 bản 1.92.55):

```js
const verifyPendingNow        = Object.keys(sockVerifyPending).filter(...).length;
const extVerifyPendingNow     = Object.keys(extVerifyPending).filter(...).length;
const uncertainVerifyPendingNow = Object.keys(uncertainVerifyPending).filter(...).length;
```

Ba sổ này giữ **mọi chat đang chờ kiểm chứng**. Mỗi lần **một** chat chốt xong,
`updateBatchSummaryUI()` → `getBatchSummaryCounts()` ⇒ 3 lần `Object.keys` + `filter`
(cấp phát mảng mới cho cả 3 sổ). Tổng O(n²).

**Vì sao ẩn danh sách vô ích:** phép tính này **không đọc DOM, không đụng panel**.
Ẩn danh sách hay để giao diện trống **không bớt được một phép duyệt nào**. Đây là chỗ
tôi từng kết luận sai (§91 ghi "thủ phạm là promise/closure" và "highlightRows") — cả
hai đều không giải thích được hiện tượng "trống mà vẫn lag".

### 92.3 BA CHỖ ĐÃ SỬA

| # | sửa | trước | sau |
|---|---|---|---|
| 1 | 3 biến đếm `verifyPendingCount` thay 3 lần quét (6 hàm `markXxx`/`clearXxx` + `resetVerifyPending`) | **9 946 ms** (n=12 410) | **0,8 ms** |
| 2 | `reportExtJob` dùng `pending` người gọi đã tính, không gọi lại `getBatchSummaryCounts` | tính 2 lần/lần vẽ | 1 lần |
| 3 | `countResendSplit()` một lượt duyệt trả cả hai số; chỗ dựng TỔNG HỢP dùng lại | 4 lượt duyệt × 5 000 | 1 lượt |

Phát hiện thêm khi sửa: **3 sổ kiểm chứng không được reset đầu mỗi lượt** (trong khi mọi
sổ per-run khác đều được). Khoá của lượt cũ nằm lại vĩnh viễn ⇒ bộ đếm/bảng TỔNG HỢP
đếm cao hơn thực tế. Nay `resetVerifyPending()` chạy ngay cạnh `runSeq++`.

### 92.4 TEST KHOÁ (225 ca, +24)

- `getBatchSummaryCounts` **không được** chứa `Object.keys` trên 3 sổ
- 6 hàm `markXxx`/`clearXxx` tăng/giảm đúng chiều, không xuống dưới 0
- `markExtVerify` lần đọc-lại **không** cộng vào "đang chờ" (giữ hành vi cũ)
- **Ngoài khối bộ đếm không được ghi/xoá trực tiếp** 3 sổ (bản đầu của test chỉ quét phần
  sau `getBatchSummaryCounts` nên mutation ở phía trước **lọt**; đã sửa để xét cả hai phía)
- `resetVerifyPending()` phải có ngay sau `runSeq++`

Mutation-test 3 nhát: trả về `Object.keys` ⇒ đỏ · bỏ `resetVerifyPending` ⇒ đỏ · ghi trực
tiếp vào sổ ⇒ đỏ.

### 92.5 CÒN LẠI (chưa sửa, đã đo, chờ đo lại sau khi chạy thật)

| vị trí | vấn đề | đo |
|---|---|---|
| `sweepBgPending` 8636 | `Object.keys(pendingBg)` + `sendLanesBusy()` mỗi 5 s | 890 ms/phút khi pendingBg=8 000 |
| `getPageSocketLaneStats` 6668 | dựng thống kê mỗi lần cấp/nhả slot (chặn 100 ms) | nhỏ |
| `highlightRows` 1209 | quét cả danh sách, 5 `querySelector`/dòng | chỉ khi có list |
| `logAll.shift()` / `auditRows.shift()` | O(n) memmove khi mảng 60 000 đầy | nhỏ, liên tục |

---

## §93 — LAG NGAY Ở ĐOẠN "ALT CHỌN CHUỖI" (1.92.57): ĐO BẰNG CHROMIUM THẬT

Người dùng: *"vẫn lag lắm, lag ngay cả ở đoạn alt chọn chuỗi"*. Đây là lần đầu chỉ đích
danh một thao tác ⇒ đo được đúng chỗ, không phải suy luận.

### 93.1 CÁCH ĐO (khác hẳn các lần trước)

Lần trước tôi chỉ trích hàm ra chạy bằng Node — sai môi trường. Nay dựng **Chromium thật
trong sandbox** (`@sparticuz/chromium`, Chromium 153, kèm libnspr4/nss3 giải nén riêng),
nạp **nguyên bản** `scripts/pancake-send-lite.user.js` vào một trang giả lập app Pancake
(40 dòng DOM + Redux 12 000 hội thoại + cache 60 000 global_id), rồi dùng **CDP Profiler**
đo self-time từng hàm. Công cụ giữ lại: `tools/_bench_ab.mjs`, `tools/_bench_alt3.mjs`,
`tools/_bench_gidflush.mjs`. So sánh A/B **cùng một harness**, 4 lượt.

### 93.2 KẾT QUẢ A/B (4 lượt, ổn định)

| | 1.92.56 | 1.92.57 |
|---|---|---|
| main thread bận | 18,3–19,4 % | **8,6–9,3 %** |
| long task (tổng) | 508–641 ms | **260–291 ms** |
| `flushPersistentGids` | 6,0 % | **1,6 %** |
| `preloadPersistentGlobalIds` | 2,1 % | **0 %** |

### 93.3 BỐN LỖI ĐÃ SỬA (mỗi lỗi đều có số)

| # | chỗ | vấn đề đo được | sửa |
|---|---|---|---|
| 1 | `preloadPersistentGlobalIds` (7795) | `warmUpSockets()` gọi nó **mỗi lần chọn chat/chuỗi**; nó `Object.keys(persistentGidMap).forEach(putGidToMemCaches)` — 60 000 khoá = **15 ms/lần** | cờ `gidMemPrimed`: chỉ đổ cache RAM một lần lúc khởi động |
| 2 | `flushPersistentGids` (7750) | `JSON.stringify` + `setItem` **toàn bộ** map: 2 000 khoá 1,5 ms · 20 000 → 18,7 ms · **60 000 → 34,2 ms** · 120 000 → 65,8 ms, chạy mỗi 400 ms | `scheduleGidFlush()`: gộp + **≥1 500 ms** giữa hai lần + ghi lúc `requestIdleCallback` |
| 3 | `logLine` khi chưa có panel (13173) | `setItem(LOG_KEY, JSON.stringify(state.log))` cho **từng** dòng log (~1 500 dòng ≈ 120 KB) | `scheduleLogStorageSave()` (gộp 1 000 ms; `pagehide` ghi nốt) |
| 4 | `logLine` → `logAll.shift()` (13161) | `shift()` trên mảng tới 60 000 = memmove O(n) mỗi dòng | để mảng tới 2× rồi `splice` nửa đầu một lần |

### 93.4 BẪY ĐÃ TỰ MẮC — ghi lại để không lặp

- **Bản nháp #1 của tôi làm CHẬM ĐI**: chỉ đẩy flush sang `requestIdleCallback` mà không giữ
  khoảng cách ⇒ rIC bắn sớm khi trang rảnh ⇒ ghi **dày hơn** bản cũ 400 ms. Đo lại A/B:
  `flushPersistentGids` **12,6 % → 31,2 %**, long task 823 → **2 252 ms**. Đã thêm mốc 1 500 ms.
  → *Không được coi "chuyển sang idle" là xong; phải đo lại bằng cùng harness.*
- **Benchmark đầu của tôi sai**: server giả trả `next_cursor` mãi không hết ⇒ userscript tải
  liên tục trong lúc đo ⇒ số liệu nhiễu. Phải chờ `state.scanning === false` rồi mới đo.
- **Test khớp chú thích, không khớp code**: hai test mới (mốc `1500`, `setItem(LOG_KEY)`) khớp
  ngay lời chú thích tôi vừa viết ⇒ mutation vẫn xanh. Đã thêm `stripComments()` và cho cả
  hai test chạy trên code đã bóc chú thích. **5/5 mutation giờ đều bị bắt.**

### 93.5 ĐIỀU ĐÃ BỊ BÁC BỎ BẰNG SỐ (đừng sửa lại)

| giả thuyết | số đo | kết luận |
|---|---|---|
| `highlightRows()` quét 5 `querySelector`/dòng | 40 dòng 0,40 ms · 200 → 1,26 ms · 500 → 3,04 ms · 1 000 → 8,00 ms | **không phải thủ phạm** |
| `render()` dựng lại HTML cả checklist | **panel KHÔNG có `#ssb-list`** ⇒ nhánh đó là CODE CHẾT; render() thật 4–5 ms | không phải thủ phạm |
| `computeMatches()` trên chuỗi 12 000 chat | **12 ms** (enrichRowWithRedux 31 %, push 16 %) | đắt nhưng chưa đủ gây lag |
| Alt+Click khi ĐÃ tải danh sách | main thread bận **2 %**, 0 long task | đường này nhẹ |
| Alt+Click khi CHƯA tải (tự tải API) | bận **32 %**, long task 115 ms; profiler: `flushPersistentGids` 5,4 % + `putGidToMemCaches` 3,0 % + `fetchJson` 3,4 % | đúng chỗ người dùng kêu |

**Ghi chú kỹ thuật:** `#ssb-list` không tồn tại trong panel ⇒ ~40 dòng dựng HTML checklist +
`state.listKey` trong `render()` là code chết; `getBotChecklistElement()` luôn trả `null`.
Chưa xoá (không phải nguyên nhân lag, và xoá cần rà lại nhánh Ctrl+click) — ghi ở đây để
lần sau không mất công đo lại.

---

## §94 — "GIỮ ALT CHỌN 1 CON LÀ KHỰNG MỘT CÁI" (1.92.58)

Người dùng: *"vẫn lag, giữ alt chọn vào 1 con là lag luôn, khựng lại 1 cái"*.
Chọn **một** dòng mà khựng ⇒ việc nặng chạy **đồng bộ ngay trong sự kiện click**.

### 94.1 CÁCH TÌM RA ĐÚNG HÀM

Dựng Chromium 153, nạp nguyên bản userscript, đo **Event Timing** (`PerformanceObserver`
type `event` — cho đúng `duration` của sự kiện `click`, chính là cái người dùng cảm thấy)
+ **CDP Profiler in cả ĐƯỜNG GỌI** (không chỉ self-time). Đường gọi đọc được:

```
onDocClick → setRangeStart → computeMatches → getReduxConversationListRows
   → visibleRows → rowInfo → querySelector
onDocClick → setRangeStart → computeMatches → highlightRows → rowInfo (5 querySelector/dòng)
onDocClick → … → warmUpSockets → syncSocketMappingsToCache → Object.keys(threadMapping).forEach
```

### 94.2 BA SỬA (1.92.58)

| # | chỗ | vấn đề | sửa |
|---|---|---|---|
| 5 | `syncSocketMappingsToCache` | duyệt **cả** `threadMapping` + `threadMappingStoreV2` của page (script này tự nâng lên ~75 000 thread) **mỗi lần chọn** ⇒ `putGidToMemCaches` 4,1–8,1 % CPU trong khung hình cú click | chia lô 1 500 + `setTimeout` (nhường khung hình), giãn cách ≥3 s/page, bỏ qua khoá đã có đúng giá trị |
| 6 | `getReduxConversationListRows` | dựng lại **toàn bộ** danh sách mỗi lần gọi: `convApiRow` + `cacheGidFromConvObj` cho **từng** hội thoại (hàng nghìn–chục nghìn), và gọi `visibleRows()` (đọc DOM) **hai lần** | cache theo **tham chiếu mảng Redux** (`raw !== ref`), chỉ nhân bản những dòng **đang có trên DOM**; `sourceRows` đọc `visibleRows()` một lần rồi truyền xuống |
| 7 | `highlightRows` | gọi `rowInfo()` cho **mỗi dòng** = 5 `querySelector`/dòng (15 000 `querySelector` cho 3 000 dòng) | lấy `id` thẳng từ `item.id` / `div[id]` cha; màu `target` suy từ id của `target/rangeStart/rangeEnd` — **đúng** như `markOf(rowInfo(...))` cũ |

Đo `highlightRows` (cùng DOM, cùng state): **300 dòng 1,4 → 0,3 ms · 1 000 dòng 6,3 → 1,7 ms ·
3 000 dòng 16,4 → 3,4 ms** (4–5× nhanh). Kiểm đúng đắn: `tools/_check_highlight.mjs` chạy
**cả body bản cũ và bản mới trên cùng DOM/state** rồi so từng dòng — kết quả tô **giống hệt**
(`MATCH MATCH MATCH none none none`, khung `role=row` = MATCH).

Sự kiện click đo được: 24 ms → **24 ms** (ở tab trống của sandbox, cả hai bản đều dưới 1
khung hình; chênh lệch thật nằm ở CPU nền và ở bảng 20 000 thread — giảm 14,2 % → 7,3 %).

### 94.3 LỖI TEST NGHIÊM TRỌNG ĐÃ PHÁT HIỆN: `checkNot` LUÔN XANH

`checkNot(name, got, forbidden)` so `got !== forbidden`. Tôi truyền vào phần lớn chỗ một
**đối tượng RegExp** ⇒ hai RegExp khác nhau ⇒ `!==` luôn đúng ⇒ **test LUÔN XANH dù code vi
phạm**. Nghĩa là mọi test `checkNot(..., /regex/)` viết trước đó đều **vô hiệu** (đó là lý do
mutation "thêm `rowInfo(item)`", "trả lại `logAll.shift()`"… vẫn xanh). Nay `checkNot` khớp
RegExp thật trên chuỗi và in cả đoạn khớp khi đỏ.

Sau khi sửa: **6/6 mutation bị bắt** (rowInfo trong highlightRows · step() đồng bộ ·
`logAll.shift()` · stringify log từng dòng · bỏ cờ `gidMemPrimed` · `getBatchSummaryCounts`
quay lại `Object.keys`). Test 239 → **253 ca**.

### 94.4 CÒN LẠI (đo được, chưa sửa vì chưa phải nút cổ chai)

`render()` → `flushLogUI()` (mỗi dòng log ghi `el.textContent = state.log.join('\n')`, ~1 500
dòng) · `logNearBottom` đọc layout · `enrichRowWithRedux`/`cacheGidFromConvObj` trong
`completeRange` (đường thứ hai của cú Alt thứ 2). Nếu vẫn khựng, đo tiếp bằng
`tools/_bench_click.mjs` với `PATHS=1` và đọc đường gọi.

---

## §95 — "LAG CHỈ KHI MỞ GIAO DIỆN SCRIPT" (1.92.59)

### Dữ kiện người dùng cung cấp (quyết định hướng chẩn đoán)

> "tôi nhận ra nó chỉ lag khi tôi mở giao diện script, khi tôi đóng giao diện script thì alt
> click nó không lag nữa"

Một câu này phủ định toàn bộ số đo của §93–§94: harness cũ chạy với **panel ĐÓNG**, nên mọi
"click 24 ms" trước đó **không đại diện** cho ca thật. Phải dựng harness **panel MỞ + log đầy**
rồi mới được kết luận.

### Tái hiện (trước khi sửa) — `tools/_bench_click.mjs`, 20 000 thread

`PANEL=on LOGFULL=1` (1 500 dòng log) — đúng trạng thái sau một lô dài:

| ca | cú Alt-click | CPU bận nền |
|---|---|---|
| panel MỞ + log 1 500 dòng | **1 784 / 2 336 ms** | 93,3–94,8 % |
| panel MỞ + log rỗng | 24 ms | 5,8 % |
| panel ĐÓNG + log 1 500 dòng | **0 ms** | 4,8 % |

Cùng dữ liệu, cùng số dòng: **mở/đóng panel quyết định 2 336 ms hay 0 ms** ⇒ lỗi nằm ở đường
**VẼ panel**, không phải đường tính toán.

Profiler (`PATHS=1`) chỉ đích danh hai hàm: `render` 43,7 % + `flushLogUI` 35,9 %, còn
`computeMatches` chỉ 1 lần/cú click.

### Cơ chế đắt: ĐỌC `scrollHeight` sau khi gán `textContent`

Đo trong trang có panel + 1 500 node "app" (`tools/_bench_log2.mjs`), 1 500 dòng log:

```
el.textContent = state.log.join('\n')                        →   0,35 ms
... + el.scrollTop = el.scrollHeight                         → 547,40 ms
... + (el.scrollHeight - el.scrollTop - el.clientHeight)     → 581,00 ms
```

Gán text chỉ 0,35 ms. **Đọc `scrollHeight`/`clientHeight` sau đó ép trình duyệt LAYOUT LẠI TOÀN
TRANG** (app Pancake đang mở hàng nghìn dòng hội thoại) — 547 ms. `logNearBottom()` đọc cả 3
thuộc tính. Đường cũ có **3 chỗ** cùng làm việc này:

1. `render()` — cuối hàm: `el.textContent = state.log.join('\n')` + `el.scrollTop = el.scrollHeight`.
   `render()` chạy **2 lần** trong một cú Alt-click.
2. `flushLogUI()` — `logNearBottom(el)` rồi `el.scrollTop = el.scrollHeight`. Chạy **2–3 lần**/cú click.
3. `logLine()` — mỗi dòng log gọi `flushLogUI()` **ngay** khi panel mở (chỉ gộp khi `sending && total > 200`).

### Bốn sửa của 1.92.59

| # | chỗ | sửa |
|---|---|---|
| 8 | `render()` | BỎ HẲN khối dựng lại log + `scrollTop`. Log chỉ vẽ khi nội dung đổi; `flushLogUI()` lo việc đó. |
| 9 | `flushLogUI()` | Không đọc `scrollHeight`/`clientHeight`/`logNearBottom`. Bám đáy bằng **ghi** `scrollTop = 1e9` (ghi số thì trình duyệt tự kẹp, không đọc layout). Trạng thái "đang ở đáy" lấy từ `'scroll'` listener passive (`logStickBottom`), đặt trong `requestAnimationFrame`. |
| 10 | `flushLogUI()` | Chống trùng bằng chữ ký nội dung (`độ dài | dòng cuối`) ⇒ `render()` gọi mà log không đổi thì **không ghi gì**. Chỉ vẽ tối đa `LOG_PAINT_MAX = 200` dòng cuối (toàn bộ log vẫn nằm trong `logAll` — nút "📋 Copy log" / "💾 .txt" dùng `logAll`). Đang giữ Alt/Ctrl chọn chat (`userSelectingNow()`) ⇒ **hoãn vẽ 500 ms**, vẽ đúng 1 lần sau. |
| 11 | `logLine()` | Panel mở ⇒ gộp nhịp vẽ **200 ms/lần** thay vì vẽ ngay từng dòng. |

### Đo lại 2 chiều (sau khi sửa)

| ca | 1.92.58 | 1.92.59 |
|---|---|---|
| panel MỞ + log 1 500 dòng | **1 784 / 2 336 ms**, CPU 93,3–94,8 % | **16 / 16 ms**, CPU **12,5–13,7 %** |
| panel ĐÓNG + log 1 500 dòng | 0 ms | **0 ms** (không thoái hoá) |
| panel MỞ + log rỗng | 24 ms | **16 ms** |

Nhanh hơn **112–146×** ở đúng ca người dùng báo; CPU bận nền giảm ~7 lần.

### Kiểm đúng đắn (không chỉ nhanh)

`tools/_check_log.mjs` — chạy nguyên bản userscript trong Chromium trên trang giả có
`#conversationList` 40 dòng + Redux 200 conv:

```
paintedLines: 201        (200 dòng cuối + 1 dòng báo "… (1 300 dòng trước — bấm 📋 Copy log)")
lastPainted : "DONG 1499" (đúng dòng mới nhất)
hasFirst    : false       (dòng cũ nhất KHÔNG vẽ — đúng chủ ý)
scrollAtBottom: true      (vẫn bám đáy)
```

Test khoá: **269 ca** (`npm test`). Mutation **7/7 bị bắt** (M1 `render` dựng lại log · M2
`flushLogUI` đọc `scrollHeight` · M3 dùng `logNearBottom` · M4 `LOG_PAINT_MAX` 200→1 500 ·
M5 bỏ chống trùng chữ ký · M6 bỏ hoãn khi đang chọn · M7 `logLine` vẽ ngay).

Ba bẫy test đã mắc và đã vá trong đợt này:
- Test chỉ khớp **tên biến** (`/LOG_PAINT_MAX/`) ⇒ mutation đổi giá trị vẫn xanh. Nay test
  **chạy thật** `flushLogUI` trên DOM giả và **đọc hằng số từ mã**.
- Test truyền **cứng** `200` vào hàm dựng lại ⇒ không kiểm gì trong mã. Nay đọc `LOG_PAINT_MAX`
  từ `SRC`.
- `flushLogUI` phụ thuộc closure (`bindLogScrollWatcher`, `logSignature`, `logStickBottom`…) ⇒
  `new Function` phải bơm đủ; thiếu là `ReferenceError`, không phải "xanh".

---

## §96 — BỎ KHUNG LOG KHỎI PANEL + DẢI TIẾN TRÌNH THU NHỎ (1.92.60)

### Yêu cầu của người dùng

> "tôi có cảm giác đúng, khi mở giao diện thì làm gì cũng lag, đóng lại thì ok… bỏ luôn hiển
> thị log khi mở giao diện, chỉ cần xem log khi ấn vào nút phóng to log, thêm chức năng khi
> đóng log thì sẽ hiển thị tiến trình gửi trên hình thu nhỏ luôn — kiểu số gửi thành công/tổng
> số trong danh sách gửi"

1.92.59 đã cắt phần lớn (2 424 → 16 ms) nhưng vẫn còn một khung log đang tồn tại trong panel,
chỉ là được vẽ ít hơn. Nay **bỏ hẳn khỏi panel**: khung log chỉ sống trong cửa sổ "⛶ Phóng to".

### Năm sửa của 1.92.60

| # | chỗ | sửa |
|---|---|---|
| 12 | HTML panel | Khung `.log` chuyển vào `#ssb-logwrap` với `style="display:none"`. Panel KHÔNG còn phần tử log hiển thị; chỉ khi bấm "⛶ Phóng to" khung mới được `toggleFloat` đưa ra cửa sổ nổi. |
| 13 | `flushLogUI()` | Thoát ngay ở dòng đầu nếu `!logWindowOpen()` ⇒ ngoài lúc mở cửa sổ log, đường log **không ghi một byte nào vào DOM**. `logAll` (📋 Copy / 💾 .txt) không đổi. |
| 14 | Nút "⛶ Phóng to" | Vẽ log NGAY TRƯỚC khi mở (không thì khung trống), và vẽ lại + cuộn đáy sau khi mở. Thu nhỏ ⇒ ngừng vẽ. |
| 15 | `updateMiniProgressUI()` (mới) | Dải tiến trình thay chỗ khung log: `✅ 64/137 · còn 70 · ❌ 3 · 47%` + thanh %. Nguồn số = `summaryCounters` như bảng tổng hợp. Chưa gửi lô nào ⇒ hiện số chat ĐANG CHỌN. **Chống trùng bằng chữ ký** — `render()` gọi 2 lần/cú click mà chỉ so chuỗi. Cùng hàm cập nhật **badge trên bóng logo** (panel thu nhỏ): `64/137`. |
| 16 | `persistLogStorage()` | Chỉ lưu 300 dòng gần nhất thay vì 1 500. Đo: `JSON.stringify(1 500 dòng = 104 KB) + setItem` = **1,03 ms/lần, ghi mỗi 1 s**; với 300 dòng = **0,10 ms** (nhanh 10×). |

### Đo lại (panel MỞ, log 1 500 dòng, 20 000 thread)

| bản | cú Alt-click | khung hình dài nhất sau click | CPU bận nền |
|---|---|---|---|
| 1.92.58 | 1 624 / 2 424 ms | 568–597 ms | 91,7–94 % |
| 1.92.59 | 16 / 16 ms | 79–83 ms | 12,7–14,6 % |
| **1.92.60** | **16 / 16 ms** | **0 ms** | **4,7–5,4 %** |

CPU bận nền khi panel MỞ nay **bằng đúng lúc panel ĐÓNG (4,4–5,2 %)** — đúng câu "mở giao diện
thì làm gì cũng lag" đã hết.

### Kiểm đúng đắn (`tools/_check_mini.mjs`, chạy nguyên bản userscript trong Chromium)

```
hasMini                true
logHiddenInPanel       true
miniInitial            "✅ 0/0 | chưa chọn chat nào"
miniAfterSelect        "✅ 0/0 | 3 chat đang chọn — chưa gửi"
miniSending            "✅ 4/10 | còn 6 · 40% | width=40%"
miniDone               "✅ 8/10 | XONG · ❌ 2 · 80% | width=80% | class=mini done"
logNotPaintedWhileClosed   true      ← 50 dòng log mới, khung log KHÔNG đổi
logPaintedWhenZoomed       true      ← bấm Phóng to: hiện đủ 59 dòng
logNotPaintedAfterCollapse true      ← thu nhỏ: 20 dòng mới, KHÔNG vẽ
bubbleBadge            "block · 5/10 · bubble-badge busy"
bubbleBadgeDone        "block · 10/10 · bubble-badge"
```

Ảnh chụp bằng mắt: `tools/_shot_panel.png` (dải `✅ 64/137 · còn 70 · ❌ 3 · 47%`),
`tools/_shot_logzoom.png` (cửa sổ LOG nổi 640×480), `tools/_shot_bubble.png` (bóng logo + `64/137`).

Test: **281 ca** (`npm test`). Mutation **7/7 bị bắt** (M8 log hiện lại trong panel · M9 vẽ khi
log đóng · M10 mini ghi DOM mỗi lần · M11 render không cập nhật mini · M12 bỏ badge bóng logo ·
M13 lưu lại 1 500 dòng · M14 nút phóng to không vẽ trước).

### Ghi chú triển khai

- `window.__SSB__` mở thêm `render`, `logLine`, `logAll`, `batchStats`, `summaryCounters`,
  `flushBatchSummaryUI`, `updateMiniProgressUI` để công cụ kiểm gọi đúng hàm thật.
- Đệm chú thích HTML trong template literal: **không dùng dấu backtick** (đã một lần làm vỡ cú pháp).

---

## §97 — SỬA LẠI CHỖ HIỆN TIẾN TRÌNH (1.92.61) — người dùng đính chính yêu cầu

> "tôi nhầm, ý là nó sẽ hiển thị tiến trình ở cái bong bóng thu nhỏ khi tôi thu nhỏ giao diện lại
> á, còn thanh tiến trình vẫn ở dưới nút chạy như trước đây, phần ô log bỏ đi sẽ làm giao diện
> gọn lại"

1.92.60 đã hiểu sai: thêm dải `#ssb-mini` **trong** panel. Nay bỏ hẳn dải đó.

| hiểu sai (1.92.60) | đúng (1.92.61) |
|---|---|
| Thêm dải tiến trình mới trong panel | **Bỏ** — không thêm phần tử nào vào panel |
| — | Thanh tiến trình `#ssb-bar` + `#ssb-progstat` **dưới nút ▶ Chạy** giữ nguyên như trước |
| Ô log bỏ đi được thay bằng dải | Ô log bỏ đi để **trống cho gọn**; panel kết thúc ở hàng `LOG · 📋 Copy log · 💾 .txt · ⛶ Phóng to` |
| Badge bóng logo: có | Badge bóng logo: **đây mới là chỗ hiện số** khi panel thu nhỏ |

`updateMiniProgressUI()` nay chỉ còn một việc: ghi badge `#ssb-bubble-badge` (chữ ký chống trùng
giữ nguyên). Số lấy từ `summaryCounters` như bảng tổng hợp: `4/10` khi đang gửi (`busy`, viền
xanh dương), `10/10` khi xong (viền xanh lá); chưa gửi lô nào ⇒ `3 chat`.

### Kiểm (`tools/_check_mini.mjs`)

```
hasMiniPanelStrip        false      ← panel KHÔNG còn dải tiến trình
hasProgressUnderRunBtn   true       ← thanh dưới nút Chạy vẫn còn
logHiddenInPanel         true
barUnderRunBtn           "40% · 40% · ✅ 4/10"    ← tiến trình ở đúng chỗ cũ
badgeAfterSelect         "block · 3 chat · bubble-badge busy"
badgeSending             "block · 4/10 · badge busy"
badgeDone                "block · 8/10 · badge"
sau khi thu nhỏ: bubbleVisible "block", panelHidden "none", badge "10/10"
logNotPaintedWhileClosed / PaintedWhenZoomed / NotPaintedAfterCollapse: true/true/true
```

Ảnh: `tools/_shot_panel.png` (panel gọn, không còn ô log), `tools/_shot_logzoom.png`,
`tools/_shot_bubble.png` (bóng logo + `64/137`).

Đo lại hiệu năng (panel MỞ, log 1 500 dòng, 20 000 thread): **24 / 16 ms**, khung hình dài nhất
**0 ms**, CPU bận **4,7–5,2 %** — không thoái hoá so với 1.92.60.

Test **285 ca**. Mutation **4/4 bị bắt** (M15 thêm lại dải vào panel · M16 badge ghi DOM mỗi lần ·
M17 badge hiện số chat thay vì ok/total · M18 render không cập nhật badge).

---

## §98 — SỬA MẤT TIN + BỎ PHÂN LUỒNG 2 TAB (1.92.62)

Người dùng: *"sửa lỗi mất tin đi nhé, bỏ luôn cơ chế phân luồng khi gửi 2 tab đi, cho nó bắn hết
tốc lực như trước luôn"*.

### 1) MẤT TIN — "khách vắng mặt" bị tính là "Socket mất tin"

**Bằng chứng trong log 19:00:54 (lô 8 518 chat):**

| con số trong chính file log | giá trị |
|---|---|
| `Socket bị né (mất tin 774 · ACK chết 0) 774` | **774 chat bị đẩy KHỎI làn Socket** |
| `🔎 chứng minh VẮNG MẶT (hội thoại không đổi sau lúc gửi) ⇒ bù an toàn` | **5** |
| `❌ bù Extension không được` | 414 |
| `🔁 Bù OK: 13` | 13 |
| `Socket: FB từ chối` | 4 624 |

774 ca bị né trong khi chỉ **5** ca thật sự chứng minh được — lệch ~150×.

**Gốc (dòng ~10146 bản 1.92.61):** `proveAbsentBeforeBu()` trả `'absent'` khi *hội thoại không đổi
sau lúc gửi*, rồi cộng `_st.lost++`. Nhưng "không đổi" **không phải bằng chứng về Socket** — nó
chính là định nghĩa của **khách vắng mặt**, đúng nhóm FB từ chối. Rồi `lost ≥ 2` ⇒
`pageSocketUsable() = false` ⇒ gỡ Socket khỏi **cả page** ⇒ dồn sang Extension ⇒ Extension nghẽn
("bộ ngắt quá tải") ⇒ hẹn 9 s ⇒ vẫn nghẽn ⇒ ❌ oan. Vòng lặp này thấy rõ trong log: `lần 1/2`
**373** lần, `lần 2/2` **0** lần.

**Sửa:** tách sổ theo kênh.

| biến | nghĩa | có quyền gỡ Socket? |
|---|---|---|
| `lostSock` | chứng minh **Socket** đánh rơi tin | **CÓ** (ngưỡng 2) |
| `absent` | hội thoại không đổi (khách vắng) | **KHÔNG** — chỉ chẩn đoán |
| `lostExt` | Extension bắn mà không tới | **KHÔNG** |

Thêm `socketSkipReason()` để nhãn `Socket bị né (mất tin …)` đếm đúng nguồn.

**Chứng minh trước/sau** (`tools/_ab_lost.mjs`, chạy chính 2 phiên bản hàm trên cùng dữ liệu —
5 ca "khách vắng" như log):

```
1.92.61 (trước):  usableAfter5Absent = false   ← gỡ Socket  ⇒ MẤT TIN
1.92.62 (sau):    usableAfter5Absent = true    ← giữ Socket
```

Hành vi chi tiết (`tools/_check_sockban.mjs`, Chromium, chạy nguyên bản userscript):

```
3 ca khách vắng (absent)        ⇒ Socket còn dùng được?  true
1 ca lostSock                   ⇒ Socket còn dùng được?  true   (ngưỡng 2)
2 ca lostSock                   ⇒ Socket còn dùng được?  false  · lý do né: "lostSock"
giao được 1 lần                 ⇒ Socket còn dùng được?  true   (tự hồi)
5 ca Extension không tới        ⇒ Socket còn dùng được?  true   (lostExt không ban Socket)
```

### 2) BỎ PHÂN LUỒNG 2 TAB — mọi tab bắn hết tốc lực

Bản 1.92.43b chia slot: tab ẩn 128/192, 3 tab thì 144/112 — tự bóp tốc độ tab đang gửi. Log 14:03
ghi `main cap 128–96` trong khi `wave→cổng` vẫn 4–5 s.

Nay `computeMainSlotCap()` **luôn trả `baseCap`** (192). KIỂM (`tools/_check_slots.mjs`, gọi chính
hàm thật):

```
0 tab khác            → 192    1 tab khác · tab ẨN   → 192
1 tab khác · đang xem → 192    2 tab khác · tab ẨN   → 192
2 tab khác · đang xem → 192    3 tab khác · no focus → 192
__chốt: mọi cấu hình dùng hết slot? = true
```

**GIỮ LẠI (không liên quan tốc độ):** `acquireSendLock()` — khoá chống gửi trùng giữa 2 tab. Bỏ nó
thì 2 tab gửi cùng một chat ⇒ đúng lỗi "chat có ≥2 dòng ✅". Có test khoá: `sendToAll` phải còn
`if (!(await acquireSendLock())) return;`.

### Test

`npm test` **300 ca**. Mutation **5/5 bị bắt**: M19 `absent` lại cộng `lostSock` · M20
`pageSocketUsable` đọc lại `st.lost` · M21 ban Socket vì `lostExt` · M22 trả lại chia slot tab ẩn
128 · M23 bỏ khoá chống gửi trùng.

Hai bẫy test đã mắc và đã vá: M22 lọt vì test chỉ khớp `/144/` trong chuỗi (nay **chạy thật**
`computeMainSlotCap` với 5 cấu hình); M23 lọt vì chỉ kiểm tên `acquireSendLock` có xuất hiện (nay
kiểm cả nhánh `return` khi khoá thất bại).

### Đo lại hiệu năng (không thoái hoá)

Panel MỞ + đang gửi, 6 s, 180 dòng log (20 000 thread): **long task 0 · max 0 ms · main thread bận
0 % · wall 6 005 ms** (bản 1.92.58: 6 long task, max 1 828 ms, bận 51,3 %, wall 12 341 ms).

---

## §99 — BÁO CÁO SAI KHIẾN NGƯỜI DÙNG GỬI TAY (1.92.63)

**Nguồn:** `botfake-log-20261117-204143.txt` (5 chat, page `898735919982398`, bản 1.92.62-W200.108).
**Câu hỏi của người dùng:** *"sao mấy con này gửi k được, gửi tay được hết"*.

### Kết luận: tin KHÔNG mất — máy BÁO SAI

Chuỗi thật của mỗi chat (từ sổ kiểm chứng, không phải từ bảng tổng hợp):

```
20:41:21.989  ⚠   Socket không rõ kết quả (không có ACK)
20:41:30.013  🛟  kiểm chứng: hội thoại KHÔNG có tin ⇒ GỬI CỨU 1 lần qua Extension
20:41:30.164  ✅  đánh dấu ĐÃ TỚI NƠI qua ext
```

Cả 5/5 kết thúc `✅ … qua ext`, mỗi chat **1 dòng ✅**, `NGHI GỬI LẶP: 0`, mục
`🖐 CẦN GỬI TAY` của file .txt = **0 chat**. Tổng 15 s cho 5 chat.

Vậy vì sao người dùng thấy "không gửi được": **bảng TỔNG HỢP chốt trước khi kiểm chứng nền xong.**

```
20:41:22  📊 TỔNG HỢP CHỐT: ✅ 0/5 · ⚠ 5 · 🖐 CẦN GỬI TAY: 5 chat     ← bảng người dùng đọc
20:41:30  🔎 Cập nhật: ✅ 0 → 5 · ⚠ 5 → 0                              ← 8 s sau mới là sự thật
```

### Năm lỗi báo cáo, và sửa

| # | Lỗi | Bằng chứng (số dòng trong log) | Sửa |
|---|---|---|---|
| 1 | `markDelivered()` chỉ hồi sổ định tuyến khi `ch === 'socket'` | Ext giao 5/5 (dòng 61–65) mà `sockRoute` vẫn giữ `absent`/`lost` ⇒ máy tưởng page mất tin | hồi sổ với **mọi** kênh giao được (`socket`/`ext`/`api`) |
| 2 | Bảng chốt khi `pendingSend = 0` mà **còn** kiểm chứng nền | `TỔNG HỢP 20:41:22` vs `✅ đầu tiên 20:41:30` | thêm `SUMMARY_GRACE_MS = 2500` + `isDoneAll` tôn trọng `inGrace` |
| 3 | Câu **"🖐 CẦN GỬI TAY: 5 chat"** in khi còn kiểm chứng nền | như trên; làm theo là khách nhận **2 tin** | đổi thành `⏳ TẠM ⚠ chưa kết luận — ĐANG kiểm chứng, CHƯA gửi tay`; chữ "CẦN GỬI TAY" chỉ xuất hiện khi `verifyLeftNow === 0` |
| 4 | Danh sách gửi tay trong .txt chỉ lọc `isRescuing` | cùng 5 chat đã ✅ vẫn đủ điều kiện vào danh sách | thêm 2 tầng lọc: `deliveredIds[id]` và `deliverHits` có ≥1 lần ✅; .txt in rõ "đã loại N chat vì ĐÃ có dấu ✅" |
| 5 | Dòng gộp log in theo **hạn bộ đếm**, không theo thứ tự sự kiện | sổ: `🛟 30.013` → `✅ 30.164`; bảng log: `🛟 20:41:32` → `✅ 20:41:32` ⇒ đọc thành "gửi cứu SAU khi đã ✅" | mỗi khe gộp ghi `t0` (mốc sự kiện đầu); khi một khe tới hạn thì xả trước mọi khe có `t0` nhỏ hơn |

### Một giả thuyết ĐÃ THỬ VÀ HOÀN NGUYÊN (quan trọng)

Giả thuyết: `ACK p50/p90 4725/5544ms` + `giữ slot 6000ms` ⇒ cổng 6 000 quá sát p90 ⇒ ACK về muộn
bị coi là no-ACK oan. **Sai.** Đọc đúng dòng 📡 của chính lô đó:

```
📡 SOCKET: ACK OK/rejected/no-ACK 0/0/5 · buckets <250/250-999/1-2s/2-5s/≥5s 0/0/0/0/0 · ACK TB/max 0/0ms
🔔 CỬA SỔ NGHE ACK: hết hạn chờ 5 · im lặng THẬT 0 · ACK về MUỘN đã phân xử 0
```

Không có ACK nào về trễ ⇒ `p50/p90 4725/5544` **không phải** ACK của 5 lệnh này.

Đối chiếu 3 lô lớn để chắc chắn:

| lô | no-ACK | phân xử muộn | **cứu được ✅** | bucket ≥5s (ACK về ĐÚNG hạn) |
|---|---|---|---|---|
| 14:03 | 1 246 | 1 238 | **0** | 3 772 |
| 19:00:48 | 886 | 885 | **0** | 428 |
| 19:00:54 | 941 | 941 | **0** | 446 |

Ba lô, ~3 000 ca no-ACK, **cứu được 0 ca** — trong khi hàng nghìn ACK ≥5 s vẫn về đúng hạn. Nghĩa
là cổng 6 000 **không hề cắt oan**; no-ACK ở đây là Socket im lặng thật. Đã thử `ACK_HOLD_CEIL_MS`
9 000 rồi **hoàn nguyên về 6 000** và ghi lại bằng chứng ngay cạnh hằng số để không ai nới lần nữa
mà không có log (`buckets ≥5s > 0` hoặc `ACK về MUỘN đã phân xử > 0`).

⇒ **"Nới ra một chút" được thực hiện ở chỗ khác**: ân hạn 2 500 ms cho bảng chốt (mục 2). Nới cổng
giữ slot chỉ làm lô chậm — mọi phương án đã tính đều ≫ tốc độ thật của pha khoẻ.

### Test

`npm test` **317 ca** (thêm khối `[v1.92.63]`). Mutation **6/6 bị bắt**:

| mã | đột biến | kết quả |
|---|---|---|
| M24 | `markDelivered` trả lại `if (ch === 'socket')` | BẮT ĐƯỢC |
| M25 | bỏ lọc `deliveredIds` khỏi danh sách gửi tay | BẮT ĐƯỢC |
| M26 | bỏ lọc `deliverHits` khỏi danh sách gửi tay | BẮT ĐƯỢC |
| M27 | luôn khẳng định "CẦN GỬI TAY" | BẮT ĐƯỢC |
| M28 | bỏ ân hạn chốt bảng | BẮT ĐƯỢC |
| M29 | `flushGroup` in theo hạn bộ đếm | BẮT ĐƯỢC |

Ngoài ra **chạy THẬT** `buildAuditText()` với dữ liệu dựng đúng 5 chat của log: ra
`=== 🖐 CẦN GỬI TAY (0 chat) ===` + `(đã loại 5 chat … vì ĐÃ có dấu ✅ tới nơi)`.
A/B trên cùng dữ liệu: logic cũ (chỉ lọc `isRescuing`) = **5 chat**, logic mới = **0 chat**.

### Hệ quả với tiêu chí nghiệm thu

| tiêu chí | trước | sau |
|---|---|---|
| CẦN GỬI TAY chỉ chứa chat chưa từng có ✅ | ❌ (5 chat) | ✅ (0) |
| bảng chốt không mời gửi tay khi còn kiểm chứng | ❌ | ✅ |
| sổ định tuyến hồi khi Ext giao | ❌ | ✅ |
| thứ tự dòng log = thứ tự sự kiện | ❌ | ✅ |
| cổng giữ slot 6 000 ms | không cắt oan (đã đo) | giữ nguyên |
