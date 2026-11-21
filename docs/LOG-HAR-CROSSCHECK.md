# Đối chiếu 12 HAR ↔ 28 log — cái nào là "lỗi thật"

Mục đích: mỗi câu lỗi script in ra phải truy được về **một phản hồi thật trong HAR**.
Câu nào không truy được thì **không được** dùng làm căn cứ để cắt đường bù.

## 1. HAR nói gì (ground truth)

Quét toàn bộ 58 request `POST /api/v1/pages/{p}/conversations/{c}/messages` trong 12 HAR:

| kết quả | n | body |
|---|---:|---|
| thành công | **23** | `{"id":"m_iZsc-…","success":true,"original_error":null}` |
| `#551` | **11** | `{"e_code":551,"e_subcode":1545041,"message":"(#551) Người này hiện không có mặt.","success":false}` |
| `#10` | **24** | `{"e_code":10,"e_subcode":2018300,"message":"(#10) Không gửi được tin nhắn do một ứng dụng khác hiện đang kiểm soát thread này.","success":false}` |

**Chỉ có 2 mã lỗi gửi tin.** Không có mã thứ ba.

Các chuỗi script đang bắt nhưng **KHÔNG tồn tại trong bất kỳ HAR nào**:

| chuỗi | số lần trong 12 HAR |
|---|---:|
| `1545012` | **0** |
| `Đã xảy ra lỗi tạm thời` | **0** |
| `INCORRECT THREAD` | **0** |
| `429 Too many requests` | 0 ở endpoint gửi (**chỉ** 2 endpoint danh sách) |

⇒ Ba chuỗi đầu là **suy đoán**, không có bằng chứng. Chúng vẫn nằm trong code; xử lý chúng
KHÔNG được coi là "theo HAR".

Hai điểm nữa đã kiểm lại:

- **base64**: HAR này lưu JSON dạng text thường (58/58), không phải base64 như ghi ở §0b.
  Vẫn phải chấp nhận cả hai dạng khi đọc.
- **`global_id`**: **0/58** request gửi có `global_id`. ⇒ `api` không cần gid.
  Vì vậy câu `Ext: không gid | socket: không gid` **không** phải "FB từ chối" — nó là
  **script không dò được gid**, tức lỗi của ta.

## 2. `#551` có cứu được bằng kênh khác không? — KHÔNG

Theo HAR: 6 hội thoại dính `#551`, **0** hội thoại có lần gửi thành công nào sau đó.
（3 ca còn lại gửi lại và nhận `#551` thêm 2 lần nữa.）

Theo log thật, dòng tổng kết của cơ chế "dò Ext cho ca FB từ chối":

```
🛟 Dò Ext cho ca FB từ chối: thử <N> · cứu <M>
```

| thử | cứu |
|---:|---:|
| 12 lô | **8 782** | **0** |

Đối chiếu với đường bù cho ca **mơ hồ** (`Socket không có ACK` — *không phải* lỗi thật):

| loại bù | số ca bù thành công |
|---|---:|
| bù vì Socket mơ hồ | **2 383** (một lô duy nhất) |
| bù vì FB trả `#551` | **0** / 8 782 thử |

⇒ **Cắt bù cho `#551` là đúng; cắt bù cho "mơ hồ" là sai.** Đây là ranh giới.

## 3. Bảng đối chiếu: câu script in → nguồn thật → được phép cắt bù?

| câu trong log | số ca (log 21/11) | nguồn | lỗi thật? | cắt bù? |
|---|---:|---|---|---|
| `Socket không rõ kết quả (không có ACK)` | 2 340 · 2 960 | không có phản hồi | **không** — 1 747 ca được cứu ✅ bằng đọc lịch sử | **KHÔNG BAO GIỜ** |
| `kiểm chứng: tin ĐÃ đến nơi` → ✅ | 1 747 | lịch sử có tin | không phải lỗi | — |
| `ACK về MUỘN … tin ĐÃ tới nơi` | 636 | ACK muộn | không phải lỗi | — |
| `🛟 chứng minh vắng mặt ⇒ GỬI CỨU` | 504 · 560 | cổng vắng mặt | không phải lỗi | không cắt (đã chứng minh, cần cứu) |
| `Ext: Extension không gửi được (… không có mặt …)` | 534 (28 log) | `#551` 1545041 | **CÓ** | **CẮT** — 1.93.5 |
| `bù Extension không được: … không có mặt` | 307 | `#551` 1545041 | **CÓ** | **CẮT** — 1.93.5 |
| `API từ chối ((#551) không có mặt) — đang bù` | 18 | `#551` | **CÓ** | **CẮT** — 1.93.5 |
| `api: (#551) không có mặt \| Ext: không gid` | 927 | `#551` + gid hỏng | CÓ (phần api) | cắt phần bù `#551`, **giữ** phần dò gid |
| `api: (#10) ngoài 24h \| Ext: không gid` | 549 | cửa sổ 24h + gid hỏng | cửa sổ = thật, gid = ta | **KHÔNG cắt** (Ext đã cứu được theo §22) |
| `Ext: không gid \| socket: không gid` | trong 2 246 ở trên | **không có trong HAR** | **KHÔNG** — lỗi dò gid của ta | **KHÔNG cắt** |
| `Ext: Extension không phản hồi (quá hạn)` | 183 | im lặng | **KHÔNG** — 0/203 ca kiểm chứng thấy tin, nhưng cũng 0 ca chứng minh là chết | không cắt bù; chỉ bỏ lượt đọc lại (1.93.4) |
| `bù không rõ kết quả — KHÔNG gửi thêm` | 160 | chống trùng | không phải lỗi | chính sách đúng, giữ |

## 4. Kết luận

1. **Chỉ `#551 / 1545041` là "lỗi thật" đã được chứng minh** — bằng cả HAR (0/6 cứu được)
   và log (0/8 782 lần dò Ext).
2. `#10 / 2018300` là lỗi thật **nhưng cắt bù là sai**: theo §22, Ext gửi được sau `#10`.
   HAR cũng không có ca `#10` nào được cứu, nhưng log thì có đường bù `ngoài 24h` sinh ✅,
   nên **không đụng**.
3. `không gid` là **lỗi của script**, không phải của Facebook. Cắt bù ở đây sẽ mất tin của
   khách còn sống. Hướng đúng là sửa dò gid, không phải cắt.
4. `không có ACK` / `quá hạn` **không phải lỗi** — là "chưa biết". Đường đọc lịch sử của
   nhóm này cứu được 1 747 ca/lô ⇒ đây là đường **không được cắt**.

## 5. Đã áp vào code

| bản | nội dung | căn cứ |
|---|---|---|
| 1.93.1 | ACK muộn = FB từ chối ⇒ không bù | log: bù nhóm này cứu 0 |
| 1.93.2 | Ext `success` không được tự chốt ✅ | HAR: `success:true` là tin đã đi, nhưng log cho thấy Ext khai success rồi bị từ chối |
| 1.93.3 | ACK rejected ⇒ ❌ ngay, không vào gửi tay | 630 − 18 = 612 khớp tuyệt đối |
| 1.93.4 | bỏ lượt đọc lại 45 s + ca đã chứng minh vắng mặt | 1 338 ca dò lại ⇒ 0 ca cứu |
| 1.93.5 | `#551` ⇒ ❌ ngay, không dò Ext, không hậu kiểm 25 s, không gửi tay | HAR 0/6 · log 0/8 782 |
