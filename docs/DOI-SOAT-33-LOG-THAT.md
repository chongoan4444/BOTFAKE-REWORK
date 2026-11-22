# Đối soát 33 log thật (16–22/11) — 215 085 chat

> Nguồn: 33 file `botfake-log-*.txt` trong `/tmp/arena-coding-uploads/` (73 MB, 13 847 dòng
> log gọn + sổ kiểm chứng từng chat). Phiên bản trải **1.92.33 → 1.93.17**. Đọc bằng script
> đếm, không đọc mắt từng dòng. Mọi số dưới đây **đo được**, chỗ suy luận ghi rõ.

## 0. Quy mô

| | |
|---|---|
| File | **33** (không phải ~30) |
| Dung lượng | 73 MB |
| Lượt gửi | **35** (2 file có nhiều lượt) |
| Tổng chat | **215 085** |
| ✅ thành công | **132 832 (61,8 %)** |
| ❌ lỗi | **32 170** |
| ⚠ không rõ | **50 083 (23,3 %)** |
| Phiên bản | 1.92.33 → 1.93.17 (33 mốc) |

Tỷ lệ thành công dao động **0 % → 100 %**, phổ biến 55–70 %. Đây là con số cần cải thiện,
và nó **không** phải "lỗi của FB" — xem §3.

## 1. ĐỘ TRỄ ACK THẬT — số quan trọng nhất của cả bộ log

Đo trên **2 945** ca có in độ trễ cụ thể (`ACK về MUỘN … (N ms)` / `ACK muộn = FB TỪ CHỐI (N ms)`):

| nhóm | n | p50 | p90 | p99 | max |
|---|---|---|---|---|---|
| ACK muộn — tin **ĐÃ tới** (✅) | 2 087 | **9 084 ms** | 12 841 ms | 15 936 ms | 21 646 ms |
| ACK muộn — FB **TỪ CHỐI** (❌) | 858 | 10 619 ms | 13 112 ms | 14 016 ms | 20 583 ms |
| **GỘP** | **2 945** | **9 313 ms** | **13 068 ms** | 15 818 ms | 21 646 ms |

Phân bố: **0 % ≤ 5 s** · 17,9 % ≤ 8 s · 62,8 % ≤ 10 s · **95,3 % ≤ 14 s** · 99,6 % ≤ 20 s.

### 1.1 Phát hiện: `nghe 12000ms` NGẮN HƠN p90 thật

Dòng 🔔 trong log ghi `giữ slot …ms · nghe 12000ms`. Nhưng ACK thật có **p90 = 13 068 ms**
⇒ cửa sổ nghe 12 s **cắt mất khoảng 10 % ACK**. Số max 21,6 s nằm ngoài cửa sổ hoàn toàn.

⚠ **Suy luận (chưa đo trực tiếp):** những ca bị cắt này rơi về "phân xử mà không loại được"
— xem §2. `timedFetch` 20 000 ms cũng ngắn hơn max đo được.

## 2. LỖ ĐEN GHI SỔ: 62 % ca "đã phân xử" nhưng KHÔNG ra ✅ cũng KHÔNG ra ❌

Dòng 🔔 in `ACK về MUỘN đã phân xử N (trong đó ✅ a · FB từ chối b)`. Cộng toàn bộ log:

| | số | % |
|---|---|---|
| đã phân xử | **9 401** | 100 % |
| → thành ✅ | 2 483 | **26 %** |
| → thành ❌ | 1 001 | 11 % |
| **→ KHÔNG phân loại được** | **5 917** | **62 %** |

Phân bố theo lô:
- **1.92.54** (12 410 chat): 1 238 phân xử → **1 238 mất dấu (100 %)**
- **1.92.55** (8 249 chat): 1 739 → **1 739 mất dấu (100 %)**
- 1.92.61: 885 + 941 → **1 826 mất dấu (100 %)**
- 1.92.55 (6 015): 388 → 388 mất dấu
- **Từ 1.92.66 trở đi mới có phân loại** (1.92.66: 1 767 ✅ / 573 ❌; 1.93.1: 714 ✅ / 41 ❌)

⇒ Đây là lỗi **ghi sổ**, đã được vá dần. Ở bản HEAD **cần kiểm lại** dòng 🔔 có phân loại đủ không.

**Đoạn code liên quan (HEAD):** dòng 5512–5522 — nhánh "KHÔNG bắn-nhả" chỉ tăng
`sockLateAck` + `sockLateUnapplied`, **không** phân loại ✅/❌. Khớp đúng hiện tượng.

## 3. CẢNH BÁO GỬI LẶP ở 1.93.1: **KHÔNG phải gửi lặp** — đếm trùng

Log `20261121-203141.txt` (1.93.1) in `⚠ NGHI GỬI LẶP: 96 chat`. Kiểm từng chat:

```
20:28:35.294 ⚠ Socket không rõ kết quả (không có ACK)
20:28:39.889 ✅ đánh dấu ĐÃ TỚI NƠI qua socket     ← ACK muộn 11 934 ms
20:28:39.889 🔎 ACK về MUỘN … tính ✅ Socket
20:28:46.212 ✅ đánh dấu ĐÃ TỚI NƠI qua socket     ← cùng kết quả, ghi LẦN 2
20:28:46.212 🔎 kiểm chứng: tin ĐÃ đến nơi
```

`grep` chat đó trong toàn file: **0 dòng bắn lại / gửi cứu / bù** ⇒ **mỗi chat chỉ gửi 1 lần**.
Cơ chế: ACK muộn phân xử ✅ (đường `lateP`), rồi **kiểm chứng nền đọc lại lịch sử** cũng thấy
tin và ghi ✅ **lần nữa**. Hai đường cùng ghi vào sổ ⇒ bộ đếm "2 lần đã tới nơi" tưởng là lặp.

⇒ **Tin nhắn KHÔNG bị trùng.** Nhưng **bộ đếm cảnh báo lặp là dương tính giả** — nó tự sinh
cảnh báo đỏ trong khi mọi thứ đúng. Vá ở **ghi sổ** (chỉ ghi ✅ 1 lần/chat/lượt), không đụng
đường gửi.

## 4. "Hết hạn chờ CỦA TOOL sau 7s (Extension tự có 30 s và VẪN ĐANG CHẠY)"

**Đo được:** 48 ca, **tất cả đều 7 s**. Extension thật có ngân sách **30 s**.
⇒ Script bỏ chờ khi Ext còn **23 s** ngân sách. Khớp ghi chú cũ `EXT_ADAPTER_HOLD_MS` và
dòng 6486 `extTimeoutStats.skipped`.

Đây là **cắt ngang việc đang chạy tốt**, không phải lỗi của ext. Nghi phạm cho các ca ⚠ ở làn Ext.

## 5. `doc_id` — vẫn hỏng

**Đo được:** `batch nạp 0/0` xuất hiện **32/35 lần**; `batch nạp 0/50` 2 lần; `batch nạp 25/250`
1 lần (1.93.13 — bản vá có tác dụng nhưng chỉ 10 %). `[doc_id] batch rỗng — THIẾU doc_id` **16 lần**,
`Missing doc_id` **31 lần**.

⇒ Đường `BATCH_GET_GLOBAL_ID` bằng ext gần như **luôn chết** ở mọi bản. Đúng như chú thích
đầu dòng 9779 trong HEAD. Hệ quả: gid phải lấy từ cache/HTTP, và 440+ ca/lô rơi vào
`server/Batch/WS/Ext đều không có global_id ⇒ chuyển làn API`.

## 6. Hai lỗi im lặng nuốt nguyên một lô

| log | hiện tượng | số |
|---|---|---|
| `20261117-20…` (1.92.62) | 5 chat, **0 thành công, 0 lỗi, 5 ⚠** | 0 % |
| `20261122-13…` (1.93.17) | 941 chat, **211 ✅ (22,4 %), 721 ⚠** | 22 % |
| `20261122-07…` (1.93.11) | 1 694 chat, 474 ✅ (28 %), 1 197 ⚠ | 28 % |
| `20261117-16…` (1.92.55) | 6 015 chat, **1 428 ✅ (23,7 %), 4 468 ⚠** | 23,7 % |

Điểm chung: ⚠ chiếm 70–100 %. Đây là **"không biết" chứ không phải "lỗi"** — người dùng phải
gửi tay. Tổng `🖐 CẦN GỬI TAY` trên 33 log: **> 40 000 chat**.

## 7. Các nguyên nhân ❌ đã đo (toàn bộ log)

| lý do | số dòng |
|---|---|
| `Ext: Extension không gửi được ({"errorDescription":"Người này hiện không có mặt."…` | 543 + 336 |
| `API từ chối ((#551) Người này hiện không có mặt.) — ngoài cửa sổ 24h` | 439 |
| `Socket: FB từ chối nhận tin (khách hiện không có mặt / đã khóa nick)` | 124 + 83 |
| `Socket: FB từ chối · đã đo N ca thì Extension cũng bị chặn ⇒ GIỮ ⚠` | 249 |
| `api: (#551) không có mặt \| socket: không gid \| Ext: …` | 44 |
| `bù Extension không được: Không tìm được global_id` | 36 |

⇒ Lỗi **thật** của FB gần như chỉ có một: **"Người này hiện không có mặt"** (#551 / #10).
Phần lớn 32 170 ❌ là ca này. Nhưng **50 083 ⚠ mới là vấn đề lớn hơn**.

## 8. Ảnh & "không có ACK" — chưa chứng minh được

`📡 SOCKET` cho thấy no-ACK thật (im lặng hết cửa sổ) rất ít ở các lô khoẻ: 0–6 ca.
Con số ⚠ lớn là **"hết hạn chờ giữ slot"**, không phải im lặng. Khác biệt này quan trọng:
- **hết hạn chờ** = ACK đến muộn/không kịp phân xử ⇒ vấn đề **ghi sổ + cửa sổ 12 s**;
- **im lặng thật** = FB không trả lời ⇒ vấn đề mạng/kênh.

Số liệu: `im lặng THẬT hết cửa sổ 0` ở **mọi** log có in dòng 🔔 ⇒ **chưa từng đo được
ca im lặng thật nào**. Nghi vấn "khách không nhận được" chưa có bằng chứng từ log.

## 9. Ba việc nên làm (xếp theo mức chắc chắn)

| # | việc | căn cứ | độ chắc |
|---|---|---|---|
| 1 | nâng `nghe` ACK ≥ **16–20 s** (hoặc thôi cắt theo 12 s) | p90 13 068 · p99 15 818 · max 21 646 ms | **đo được** |
| 2 | phân loại ✅/❌ ở nhánh "KHÔNG bắn-nhả" (dòng 5512) | 62 % ca phân xử không ra kết quả | **đo được** |
| 3 | chỉ ghi ✅ **1 lần/chat/lượt** để hết cảnh báo lặp giả | 96 ca 1.93.1, 0 lần bắn lại | **đo được** |

Việc 1 đụng hằng số thời gian ⇒ **phải đo lại sau khi sửa**, không suy luận.
Việc 2 và 3 chỉ sửa **ghi sổ**, đúng tiền đề đã duyệt.

## 10. Điều log này BÁC BỎ

| nghi vấn cũ | log nói |
|---|---|
| "gửi lặp 96 chat ở 1.93.1" | **0 lần bắn lại** — cảnh báo sai do ghi sổ 2 lần |
| "Socket mất ACK hàng loạt" | `im lặng THẬT 0` ở mọi log; ⚠ là **hết hạn chờ**, không phải mất |
| "chứng minh vắng mặt xong gửi cứu ⇒ trùng" | chờ **p50 108,7 s** (min 33,9 s) — ACK p99 chỉ 15,8 s, **không tranh chấp** |
