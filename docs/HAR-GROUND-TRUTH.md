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
