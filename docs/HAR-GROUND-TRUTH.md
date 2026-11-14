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
