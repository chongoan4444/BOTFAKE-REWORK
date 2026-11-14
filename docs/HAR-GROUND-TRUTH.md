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
