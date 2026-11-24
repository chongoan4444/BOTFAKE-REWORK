# Giải phóng trạng thái lượt cũ — 1.93.18-W200.132

**Yêu cầu:** "mỗi lượt gửi xong thì sẽ giải phóng hết tất cả dữ liệu cũ tránh gây lỗi ảnh hưởng lượt sau".

**Bản vá:** `scripts/pancake-send-lite.user.js` — thêm **một** hàm `releaseRunCarryover(where)`
và **hai** điểm gọi. Không thêm lệnh gửi nào, không đổi phán quyết ✅/❌/⚠ của bất kỳ chat nào.

---

## 1. Vì sao phải làm cơ chế này, không phải "thêm vài dòng reset"

Đếm trong chính file: **303 khai báo cấp module**; khối reset đầu lượt cũ (`logAllReset()` …
`render()`, @13591–13760) dọn **47 sổ**; còn **80 biến khai trước nó không được chạm tới**.

Trong 80 biến đó, phần lớn là hằng số/cache phải giữ. Nhưng **20 nhóm** là *trạng thái sống*
quyết định lượt sau đi kênh nào và nhanh hay chậm. Ba cái nguy hiểm nhất, đo trên chính mã:

| Biến | Dòng | Vì sao nguy hiểm |
|---|---|---|
| `sockRoute` | L7802 | **Không có lệnh xoá, không TTL.** `pageSocketUsable()` trả `false` khi `lostSock ≥ 2` ⇒ page bị né Socket **vĩnh viễn**. Hiện `lostSock` chỉ tăng từ hook test nên ngòi đã bị tháo — nhưng đó là may, không phải thiết kế. |
| `socketLaneFloor` | L7470 | Chú thích cũ ghi thẳng *"cầu dao giữ tới hết phiên"*. Log 16:52 (7 073 chat) chốt `Socket/page limits cuối [16×1]` ⇒ cả lô sau chạy **1/24 cấu hình**. |
| `convCtxCache` | L2755 | Cache `{ad_clicks, gid, fetched}` theo convId, **không có đường xoá nào trong file**. Chứa cờ `ctx-7-days` và global_id ⇒ lượt sau dùng lại phán đoán của lượt trước. |

Danh sách đầy đủ 20 nhóm (kèm lý do từng cái) nằm ngay trong khối chú thích của
`releaseRunCarryover()` — để lần sau không ai phải suy luận lại.

---

## 2. Cơ chế

```
releaseRunCarryover(where)     // ~40 dòng code, mọi nhóm đi qua wipe() có try/catch riêng
   ├── ① sockRoute                 (né Socket vĩnh viễn)
   ├── ②③④⑤ pageAckDeadAt / pageAckTimeoutRun / pageAckDeadProbeAt / pageLastAckWait
   ├── ⑥ socketPageLaneCtl.fastOk/slowAck/noAckStreak
   ├── ⑦ socketLaneFloor → SOCKET_LANE_MIN   (TÔN TRỌNG sàn người dùng đặt)
   ├── ⑧ extSendCtl (openUntil/openStreak/timeoutStreak/fastStreak; GIỮ latSamples)
   ├── ⑨ extSendLane → BUS_PARALLEL_EXT
   ├── ⑩⑪⑫ gidBreaker / extTry1545 / apiBlockedPages  (3 cầu dao "đóng rồi không mở")
   ├── ⑬ channelHints (+ HUỶ timer ghi trễ 400 ms)
   ├── ⑭ pageBlockStreak / apiThreadBlockStreak
   ├── ⑮ ctx7Retried / buLateRetryCount
   ├── ⑯ uncertainReasonById / extMsgIdByConv
   ├── ⑰ convCtxCache   ⑱ touchIdsByPage   ⑳ preBoundFbIds
   └── ⑲ docIdStats / extLateStats / gidExtCtl / gidHttpCtl.coolUntil / batchSeedConv
          / socketNoAckStreak / socketLastPublishAt / updatedGidConvSet / lastBgConvById
          / ackLatSorted + ackLatPctCache
```

**Hai điểm gọi — cần cả hai, và đây là lý do:**

| Điểm | Vị trí | Vì sao cần |
|---|---|---|
| Đầu lượt | trong `sendToAll`, ngay sau khối reset cũ, **trước** `warmUpSockets`/`BATCH_GET_GLOBAL_ID` | Lượt trước có thể bị F5 / đóng tab / bấm Dừng ⇒ **không bao giờ chạy được bước dọn cuối**. Đầu lượt là chỗ duy nhất bảo đảm "lượt mới luôn bắt đầu từ 0". |
| Xong lượt | cuối `updateBatchSummaryUI()`, **sau khi** `flushBatchSummaryUI()` đã in bảng TỔNG HỢP | Để trạng thái không nằm lại khi người dùng không chạy lượt kế tiếp. Đặt **sau** bước in để không làm sai một con số nào trong báo cáo. **Có cổng "1 lần/lượt"** (`runCarryoverDoneSeq`) và chỉ chạy khi **thật sự xong**: `loopFinished` + `pending === 0` (hết cả kiểm chứng nền) hoặc `stopRequested`. |

Cả hai lời gọi đều bọc `try/catch` riêng, và mỗi nhóm đi qua `wipe()` có `try/catch` riêng ⇒
một nhóm lỗi không chặn nhóm khác, và dọn dẹp không bao giờ làm hỏng lượt gửi.

---

## 3. CỐ Ý **KHÔNG** dọn (xoá là đổi hành vi hoặc mất tin)

| Giữ | Vì sao |
|---|---|
| `deliveredIds`, `finalFailedIds`, `uncertainIds`, `manualResendList/Ids/ById`, `pendingBg`, `sockVerifyPending`… | Sổ phán xử. Đã được dọn đúng ở khối @13591; dọn thêm **sau** khi chốt bảng sẽ làm sai số và có thể mở đường gửi lặp. |
| `state.sentIds` / `SSB_SENT_IDS` | "Chat đã gửi" **phải** sống qua lượt — đó chính là tính năng chống gửi trùng. Đã có luật dọn riêng cuối `sendToAll`. |
| `persistentGidMap`, `fbMsgCache`, `socketWarmPromises`, `socketReconnectPromises`, `batchGidPromises`, `batchGidFetchedPages`, `docPreloadSent/EverSent`, `docSeedPages`, `nameSearchEnabled`, `syncThreadIdTried` | Cache/promise **CHỈ ĐỌC**, có trần hoặc có TTL. Xoá chỉ làm lượt sau dò lại từ đầu (chậm hơn), không an toàn hơn. |
| `ackLatRing` | Giữ qua lượt là **cố ý**: `LANE_CARRY_CLAMP` (@13621) dùng p95 lượt trước để quyết định hạ làn đầu lượt. Xoá là mất chốt an toàn đó. |
| `extSendCtl.latSamples` | Độ trễ **thật** của Extension (trần 24 mẫu) nuôi `extTimeoutMs()`; xoá làm hạn chờ tụt về sàn 2,5 s oan. |
| `socketFloorUserSet` | Sàn do người dùng đặt bằng `__botfakeSetSockPageFloor__` phải được tôn trọng. |

---

## 4. Nghiệm thu

`npm test` → **601/601 ✓** (thêm **54** kịch bản; trước bản vá là 547).

Test **chạy thật** hàm `releaseRunCarryover()` được trích nguyên văn từ userscript, trên một
bộ trạng thái đã được "làm bẩn" (page `lostSock=3`, ACK chết, sàn tụt 16, Ext đang nghỉ 45 s,
3 cầu dao đã đóng, 1 chat đã "thắng" Ext trong `channelHints`…), rồi đọc lại **từng biến**.

Kiểm chứng test không "xanh rỗng" bằng **mutation** (sửa nguồn rồi chạy lại, đều ĐỎ đúng chỗ):

| Mutation | Kết quả |
|---|---|
| bỏ dọn `sockRoute` | ✗ 2/600 đỏ |
| bỏ lời gọi **cuối lượt** | ✗ 2/600 đỏ |
| xoá `ackLatRing` (thứ cố ý giữ) | ✗ 2/600 đỏ |
| bỏ huỷ timer `channelHints` | ✗ 1/601 đỏ |

`npm run check` ✓. `scripts/pancake-send-stable.user.js` **không bị chạm** (đối chiếu md5 với
bản trên origin: giống hệt) — `npm run check:stable` vẫn đỏ **có chủ ý** vì stable đứng ở bản base
cũ, và `@version` của stable chỉ được so BASE trong `tools/test-verify.mjs`.

---

## 5. Số đo cần đọc ở log lô sau

Mỗi lượt phải có **đúng 2 dòng** `🧼 Giải phóng lượt cũ` — một `(đầu lượt)`, một `(xong lượt)`
hoặc `(dừng lượt)`. Dòng chỉ dài ~35 ký tự: `🧼 Giải phóng lượt cũ (xong lượt): 32 sổ`.

> **Sửa lỗi W131 (log 18:12):** bản W131 gọi thẳng ở `updateBatchSummaryUI()` nên **mỗi lần bảng
> tổng hợp vẽ lại** (mỗi ca ⚠→✅) là một dòng 🧼 ⇒ **22 dòng "cuối lượt"** cho cùng một lô 739 chat,
> và lần dọn đầu tiên nổ khi còn **11 ca đang kiểm chứng nền**. Nay có cổng `runCarryoverDoneSeq`
> (1 lần/lượt) + điều kiện `pending === 0` thay cho `pendingSend === 0`.

Kiểm tiếp:

1. **Lượt 2 không thừa kế:** `🧭 Chẩn đoán globalId` của lượt 2 phải có `ACK p50/p90` tính từ mẫu
   của **chính lượt 2** (không phải số của lượt 1), và `chọn kênh: … Socket bị né` = **0**.
2. **Sàn làn không dính:** dòng `🌊 WAVE … Socket/page cap` của lượt 2 phải bắt đầu ở `64–256`
   (trừ khi người dùng tự đặt sàn — khi đó log ghi `(sàn tự đặt)`).
3. **Ext không khởi đầu trong trạng thái nghỉ:** 15 giây đầu lượt 2 **không** có
   `🧯 Extension … tạm ngừng bắn Ext`.
4. **Không đổi tỉ lệ gửi:** ✅/⚠/❌ của lượt 2 phải tương đương lượt 1 cùng quy mô — nếu ✅ **giảm**
   thì phải xem ngay, vì mọi thứ bị xoá đều là bộ nhớ *để dành*, không phải bộ nhớ *đã gửi*.

---

## 6. W200.132 — sửa hồi quy "gửi sót và gửi chậm" của W130/W131

Người dùng chạy W131 rồi báo: *"bản này ảnh hưởng tới đường gửi, gửi sót và gửi chậm"*.
**Đúng.** Lỗi nằm ở **luật dọn**, không phải ở ý tưởng dọn: W130/W131 xoá chung hai loại
trạng thái khác hẳn nhau về bản chất.

| Loại | Ví dụ | Đúng phải |
|---|---|---|
| **Bộ đếm TRONG LƯỢT** — chỉ có nghĩa trong một lô | `socketPageLaneCtl.fastOk`, `pageBlockStreak`, `ctx7Retried`, `buLateRetryCount`, `docIdStats`, `touchIdsByPage` | **XOÁ** mỗi lượt |
| **Kiến thức về ĐƯỜNG TRUYỀN** — là kết quả đo, còn giá trị tới khi đường truyền đổi | `ackLatRing/Sorted`, `sockRoute.lostSock`, `pageAckDeadAt`, `socketLaneFloor`, `channelHints`, `convCtxCache` (phần tốt), `preBoundFbIds`, `extMsgIdByConv` | **GIỮ** (đã có TTL/đường tự hồi riêng) |

### 6.1 Ba chỗ hỏng, kèm số đo

**(A) `ackLatSorted` bị xoá nhưng `ackLatRing` được giữ — đây là chỗ chậm 2,0×.**

```js
// W131 xoá:  ackLatSorted.length = 0;  ackLatPctCache = null;
// W131 giữ:  ackLatRing        (vì LANE_CARRY_CLAMP cần p95 lượt trước)
```

`sockAckP90()` đọc `latencyPctFromSorted()`, tức đọc `ackLatSorted` — **mảng vừa bị xoá**.
Nhưng nó chỉ rơi vào nhánh "chưa đủ mẫu ⇒ 3 000 ms" khi `ackLatRing.length < 20`; ring thì
vẫn đủ 1 000 mẫu ⇒ hàm trả **0**. Đo bằng cách trích nguyên văn các hàm thật từ userscript:

```
[trước khi dọn] p90 = 988 ms → hạn GIỮ SLOT = 2 964 ms
[sau khi dọn W131] p90 = 0   → hạn GIỮ SLOT = 6 000 ms     ← ACK_HOLD_MIN_MS
⇒ mỗi slot giữ lâu hơn 2,0× ⇒ phát lệnh chậm đi ~2,0×
⇒ p95 = 0 (giả) nên rampAllowed() = true ⇒ làn leo 384 BẤT CHẤP p95 thật
```

Slot là **mẫu số của tốc độ**. Và `rampAllowed()` thấy `p95 = 0` nên cho nới làn vô điều
kiện — đúng cái bẫy mà chú thích `@7685` đã ghi: p95 cao mà vẫn nới làn ⇒ dồn ACK ⇒ sập lô.
Ca ACK về muộn hơn hạn chờ bị chấm `noack` → kiểm chứng nền → không kịp trả lời trước khi
chốt bảng ⇒ **⚠ "không rõ"** — đúng hình dạng "gửi sót" người dùng thấy.

> Trạng thái đó là **nửa vời**: xoá mảng dùng để tính phân vị mà giữ cửa sổ mẫu. Hoặc giữ cả
> hai, hoặc xoá cả hai. W132 **giữ cả hai** — mẫu ACK là độ trễ của *kênh*, không phải phán
> quyết của chat nào, nên không có lý do gì để nó "của lượt trước".

**(B) `socketLaneFloor` bị kéo về 64 ở mọi lượt.** Sàn này chỉ bị hạ bởi cầu dao no-ACK
(25 ca liên tiếp) — tức *bằng chứng kênh ACK đang chết*. Ép về 64 đầu lượt = bắn lại đúng
25 ca no-ACK đầu tiên để **học lại điều vừa biết**. W132: `p95` khoẻ (≤ 2 200 ms) ⇒ hạ sàn cũ
về 64 như W130 muốn; `p95` xấu ⇒ **giữ** sàn và ghi log. Sàn do người dùng đặt vẫn tuyệt đối
không bị đụng.

**(C) `convCtxCache` bị xoá sạch.** Lượt sau `ensureConvCtx()` phải gọi lại `/messages`
(~150–800 ms/chat qua `ctxFetchLane` 48 làn) cho những chat **vừa gửi xong**. W132 chỉ xoá
entry **hỏng**: chưa `fetched`, còn `inflight` (promise của lượt cũ — giữ là treo), hoặc có
`httpState`/`httpError` (429/5xx).

Thêm ba chỗ cùng loại: **(D)** `channelHints` — xoá là mất ký ức "chat này đi Ext thì nhanh",
lô nhỏ quay lại dò Socket `getBusinessWSContext + sendInitMessages` (~3 s); **(E)**
`preBoundFbIds` (TTL 180 s, xoá sau lần dùng đầu) và `extMsgIdByConv` (nguồn id **duy nhất**
cho `rescue_mode_inbox` lấy tin từ FB về) — xoá là bỏ đúng thứ đang chống sót; **(F)**
`gidHttpCtl.coolUntil` — đặt 0 khi đang trong cơn 429 ⇒ đâm tiếp vào API đang chặn.

### 6.2 Sửa cổng "cuối lượt" của W131

W131 đòi `cEnd.pending === 0`, tức **cả kiểm chứng nền xong**, trong khi `markSendIdleIfSettled()`
chỉ chờ `pendingSend`. Ca ⚠/kiểm chứng hàng trăm giây ⇒ `pending > 0` suốt ⇒ **cổng không bao
giờ chạy** ⇒ phần lớn lô không có dòng 🧼 "xong lượt" (trái yêu cầu). Ngược lại ở lô lớn,
`pending` chạm 0 trong khoảnh khắc giữa hai đợt kiểm chứng ⇒ dọn **sớm** ⇒ ACK muộn về sau khi
đã dọn ⇒ chấm sai ⇒ ⚠ oan.

W132: thứ chặn dọn phải là thứ **đang chạy thật** — `pendingSend === 0` **và**
`tailBusy = pendingBg > 0 || buRetryTimer rỗng === false || sendLanesBusy()`. Bấm **Dừng** thì
dọn ngay (người dùng muốn dừng, không chờ đuôi).

### 6.3 Log: đúng 1 dòng/lượt, và số in ra là số thật

```
🧼 Giải phóng lượt cũ (xong lượt): 20 dọn · 9 giữ
🧼 Giải phóng lượt cũ (xong lượt): 20 dọn · 9 giữ · sàn 32→64
```

Lượt chạy trọn vẹn in **một** dòng ở cuối. Lượt kế tiếp gọi lại ở đầu (phòng F5/bấm Dừng) với
`quiet = true` khi biết chắc lượt trước đã dọn (`runCarryoverDoneSeq === runSeq - 1`) ⇒ **không
in thêm dòng rỗng**. Số đầu là số nhóm **thực sự đã chạy** (W131 in hằng số `32` vì `wipe()`
đếm cả nhóm rỗng), số sau là số sổ **giữ lại**.

### 6.4 Nghiệm thu

| Kiểm tra | Kết quả |
|---|---|
| `npm test` | **605/605 ✓** (thêm 1 kịch bản: `quiet` ⇒ 1 dòng 🧼) |
| `npm run check` | ✓ |
| `npm run check:stable` | ✗ **đúng chủ ý** (stable không bị chạm) |
| Mutation — xoá lại `ackLatSorted` | ✗ **4/605 đỏ** |
| Mutation — bỏ cổng `p95` khi hạ sàn | ✗ 1/605 đỏ |
| Mutation — xoá cả `convCtxCache` (kể cả entry tốt) | ✗ 1/605 đỏ |
| Mutation — trả cổng cuối lượt về `pending === 0` | ✗ 2/605 đỏ |
| Mutation — xoá `channelHints` | ✗ 2/605 đỏ |
| Mutation — bỏ cờ `quiet` | ✗ 1/605 đỏ |

### 6.5 Đọc gì ở log lô sau để biết đã hết sót/chậm

1. `🧭 … ACK p50/p90` của lượt **2** phải là số **thật** (không phải `0`) — nếu ra `0` thì
   phân vị lại bị xoá: dừng lại đọc mục 6.1(A).
2. Dòng `🔔 CỬA SỔ NGHE ACK: giữ slot …ms` của lượt 2 phải ≈ `3 × p90 lượt trước`, **không**
   phải 6 000 ms (6 000 = dấu hiệu p90 đang bị đọc thành 0).
3. `📡 SOCKET … bỏ nới lane N lần` phải > 0 khi p95 cao — `0` nghĩa là `p95` đang bằng 0 giả.
4. `🧼` xuất hiện **đúng 1 dòng** cho mỗi lượt (kể cả khi chạy liền nhiều lô nhỏ).
