# Giải phóng trạng thái lượt cũ — 1.93.18-W200.130

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
| Cuối lượt | cuối `updateBatchSummaryUI()`, **sau khi** `flushBatchSummaryUI()` đã in bảng TỔNG HỢP | Để trạng thái không nằm lại khi người dùng không chạy lượt kế tiếp. Đặt **sau** bước in để không làm sai một con số nào trong báo cáo. Chỉ chạy khi lượt đã chốt hẳn (`pendingSend === 0 || stopRequested`). |

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

Sau khi chạy 2 lượt liên tiếp trên cùng một tab, log phải có **`🧼 Giải phóng trạng thái lượt cũ`**
2 lần mỗi lượt (đầu + cuối), kèm số sổ đã xoá. Kiểm tiếp:

1. **Lượt 2 không thừa kế:** `🧭 Chẩn đoán globalId` của lượt 2 phải có `ACK p50/p90` tính từ mẫu
   của **chính lượt 2** (không phải số của lượt 1), và `chọn kênh: … Socket bị né` = **0**.
2. **Sàn làn không dính:** dòng `🌊 WAVE … Socket/page cap` của lượt 2 phải bắt đầu ở `64–256`
   (trừ khi người dùng tự đặt sàn — khi đó log ghi `(sàn tự đặt)`).
3. **Ext không khởi đầu trong trạng thái nghỉ:** 15 giây đầu lượt 2 **không** có
   `🧯 Extension … tạm ngừng bắn Ext`.
4. **Không đổi tỉ lệ gửi:** ✅/⚠/❌ của lượt 2 phải tương đương lượt 1 cùng quy mô — nếu ✅ **giảm**
   thì phải xem ngay, vì mọi thứ bị xoá đều là bộ nhớ *để dành*, không phải bộ nhớ *đã gửi*.
