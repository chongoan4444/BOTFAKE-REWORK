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

## 6. "bất globalId" — tìm ra 2 lỗi code thật (1.93.6)

### 6.1 đường nạp gid hàng loạt chưa bao giờ nạp được gì

Mọi log đều in:

```
🧭 Chẩn đoán globalId: … batch nạp 0/0 mapping (lỗi 0) …
```

`batchReturned = 0` **và** `batchFail = 0` cùng lúc. Hai số chỉ cùng bằng 0 khi nhánh
`!Array.isArray(list)` không chạy (nó cộng `batchFail`) **và** mảng cũng rỗng.

Nguyên nhân: `requestBatchGlobalIds()` đặt `batchGidFetchedPages[pageId] = true` **trước** khi
kiểm `list`, nên page bị khoá vĩnh viễn trong phiên — mọi lần sau `return Promise.resolve(0)`.
Nhánh `.catch` (timeout 2 s) cũng khoá y như vậy. Chú thích của chính hàm ghi
*"Chỉ đánh dấu 'đã nạp' khi THÀNH CÔNG"* — code làm ngược.

Hệ quả: đường nạp gid **hàng loạt** (1 lệnh/page) chết ⇒ mọi chat phải dò lẻ từng con. Đây là
lý do 2 246 ca/lô phải dò gid và đuôi lô bị kéo dài.

Sửa: chỉ khoá page khi mảng trả về **khác rỗng**; timeout thì cho phép gọi lại.
Đây là đường **chỉ đọc** ⇒ không thể sinh tin trùng.

### 6.2 `HTTP 0` trong chẩn đoán là số ẢO

0/28 log có `HTTP n` khác 0, dù cùng dòng đó in `cache 10976` / `cache 11796`. Điều kiện đếm
cũ là `entry.gidSource === 'http'`, nhưng `gidSource` nhận `'conv'` khi đọc từ đối tượng hội
thoại ⇒ gần như không bao giờ đúng ⇒ HTTP trả gid vẫn bị tính vào `cache`.

⇒ Mọi kết luận trước đây kiểu "HTTP không trả gid" **không có căn cứ**. Sửa để đếm mọi nguồn
(không phải cache). Chỉ sửa số đo.

### 6.3 HAR xác nhận: không có nguồn gid mới để lấy

- `GET …/messages` trả `"global_id": null` cho đúng ca bị `#551` (giải base64 entry #55
  `batmesss.har`). Server **thật sự** không có gid cho ca đó.
- `POST /customers/{psid}/update_global_id` chỉ **ghi** gid, không trả.
- `pancake_exception_log` chỉ chứa gid app **đã có sẵn** từ `findGlobalIdForConv` — không phải
  nguồn mới.
- `profile_info` chỉ ghi thông tin cá nhân, không trả gid.
- `api` + `socket` (làn dò gid) **không có** trong HAR (0 lần) — chưa có ground truth.

## 7. Đọc extension Pancake thật (`0.5.62_0/`) — vì sao "bất globalId"

Nguồn: `0.5.62_0/assets/background.js-EHsGnyIc.js` (413 KB), do người dùng push lên `main`.

### 7.1 `BATCH_GET_GLOBAL_ID` — trả gì, khi nào rỗng

```js
class Ct {                       // BatchGetGlobalId
  constructor({pageId, timeRangeMin, maxThreadCount}) {
    this.threadCache...; this.maxThreadCount = maxThreadCount || ul;   // ul = 250
  }
  async init() {
    if (!O.get(rt, st)) return Promise.reject(`Missing doc_id ${rt} or ${st}`);
    if (lr[this.pageId]) return Promise.reject("There is a running job");   // ← CHẶN SONG SONG
    ...
    for (;;) {
      const l = await this.getFacebookThreads(a, c);   // GraphQL MessengerGraphQLThreadlistFetcher
      ...
      if (l.length === 0) { i = "There's no thread left"; break; }
      if (maxThreadCount != null && s > maxThreadCount) break;   // ← TRẦN 250
      let d = parseInt(l[l.length-1].updated_time_precise);
      if (timeRangeMin != null && d < timeRangeMin) break;
      a = d - 1;
    }
    return Object.entries(r).map(([c, l]) => ({...l, threadId: c}));
  }
}
```

Đối chiếu với cách script gọi (`requestBatchGlobalIds`):

| extension cần | script gửi | hậu quả |
|---|---|---|
| `pageId` | ✅ có | |
| `timeRangeMin` | ✅ `0` | `0` falsy ⇒ `timeRangeMin != null` vẫn đúng nhưng `d < 0` không bao giờ xảy ra ⇒ quét tới hết |
| `maxThreadCount` | ❌ không gửi | mặc định `ul = 250` ⇒ **tối đa 250 thread/page** |
| `doc_id` (`MessengerThreadlistWebGraphQLQuery`/`MessengerThreadlistQuery`) | ❌ script không gửi | extension tự lấy qua `O.get(rt, st)`; nếu chưa preload ⇒ **reject "Missing doc_id"** |

Ba đường trả **rỗng** (không phải gid):

1. `Missing doc_id` — chưa preload view `/latest/inbox/messenger` cho page.
2. `There is a running job` — page đang chạy 1 job khác (chính là lý do script phải
   `batchGidPromises` chống gọi trùng, nhưng nếu lệnh trước timeout mà extension vẫn đang chạy thì
   lần sau vẫn bị chặn).
3. Quét hết thread còn sống ⇒ mảng rỗng.

⇒ `batch nạp 0/0` trong log **khớp** với (1) hoặc (3). Script **không thể** đọc được lý do vì
`BATCH_GET_GLOBAL_ID_FAILURE` chỉ có `taskId`, không có `err`.

**Trần 250 thread/page là giới hạn thật**, không phải lỗi script. Với page vài nghìn chat, batch
chỉ phủ được 250 thread gần nhất.

### 7.2 `GET_GLOBAL_ID_FOR_CONV` (chính là `findGlobalIdForConv`) — 4 nguồn, gửi thiếu 3

```js
class Ee {   // self.GetGlobalId
  constructor({pageId, postId, convId, convType, threadId, threadKey, isBusiness,
               conversationUpdatedTime, customerName, accessToken, allowSearchByName})
  init() {
    const {success, globalId, threadInfoToRecheck} = await <nguồn theo convType>;
    const o = bn(this.pageId) === true;             // findThreadByUsername_<pageId>
    if (convType === "INBOX" && !this.isThreadCorrect(threadInfoToRecheck) && !o)
      return reject("INCORRECT THREAD");            // ← TỪ CHỐI, không chỉ null
    if (success) return globalId; else reject();
  }
  isThreadCorrect(e) {
    // e rỗng / toàn null ⇒ false
    // e.includes(this.threadId) ⇒ true
  }
}
```

Bốn nguồn theo thứ tự (INBOX):

| # | nguồn | cần tham số | script gửi? |
|---|---|---|---|
| 1 | `PagesManagerInboxAdminAssignerRootQuery` (`Jt`) | `threadId` | ✅ |
| 2 | `PagesManagerInboxQueryUtilCommItemHeaderMercuryQuery` (`Zt`) | `threadKey` + `cquick_token` | ✅ |
| 3 | `findThread(...)` — duyệt threadlist | `threadId` **hoặc** `customerName` | ✅ |
| 4 | `getUserInboxByName` — tìm theo tên | **`customerName`** + `allowSearchByName` | ✅ (tên) |

Nhưng `finderPayload` của script **đặt `convId: null` và `postId: null`**:

```js
convType: 'INBOX', postId: null, convId: null,
```

Điều này **chặn cứng** hai biến thể:
- `convType: 'COMMENT'` dùng `this.convId.split('_')[1]` ⇒ `null.split` ⇒ crash.
- `convType: 'RATING'` cũng cần `convId`.
- Trong INBOX, `findThread` nhận `m = convId.replace(pageId+'_','')` làm phương án dự phòng cho
  `threadId` — luôn `null`.

Và `accessToken: this.pageAccessToken` không được gửi (script có token ở chỗ khác).

### 7.3 `INCORRECT THREAD` — script coi là "không rõ", extension coi là "từ chối"

`isThreadCorrect` trả `false` khi `threadInfoToRecheck` rỗng ⇒ extension `reject("INCORRECT THREAD")`.
Script bắt lỗi này ở dạng chuỗi và có nhánh riêng (`incorrectThreadNoGid`), nhưng **nó không gửi
`convId`** nên mất luôn nguồn dự phòng của extension.

### 7.4 Kết luận

1. `batch nạp 0/0` **không phải** lỗi của 1.93.6 — trần 250 thread và điều kiện `doc_id` là của
   extension. 1.93.6 chỉ bỏ việc khoá page vĩnh viễn (vẫn đúng: gọi lại được thì mới có cơ hội).
2. Đường **dò lẻ** (`GET_GLOBAL_ID_FOR_CONV`) có thể cải thiện **không cần đụng extension**: gửi
   thêm `convId`, `accessToken`, `allowSearchByName`. Đây là tham số extension **đã** nhận.
3. **Chưa chứng minh** phần nào trong 3 tham số thiếu là nguyên nhân thật. Muốn biết phải xem
   `C.error("FAIL TO GET GLOBAL ID --> INCORRECT THREAD …")` trong console của **extension**
   (service worker), không có trong log của userscript.

## 8. Đối chiếu script ↔ extension `0.5.62_0` — 3 sửa ở 1.93.7

Đường gửi + trả lỗi của extension, đọc từng bước:

```
content script  →  port "pancake_tab"  →  service worker
                                            case "REPLY_INBOX_PHOTO"
                                              → le(pageId)          （InboxNormal instance）
                                              → sendInbox(...)
                                                  → getGlobalUserId()  (nếu thiếu globalUserId)
                                                  → buildSendParams()  (specific_to_list, message_id…)
                                                  → de("https://business.facebook.com/messaging/send/", …)
                                                  → isResponseSuccess / getErrorHandler
                                              → sendInboxSuccess / sendInboxFail
                                            → postMessage REPLY_INBOX_PHOTO_{SUCCESS,FAILURE}
```

### 8.1 `sendInboxFail` chỉ có MỘT trường `error`

```js
sendInboxFail(e,t,a,r){return s=>{console.log(s);
  e.port.postMessage({type:"REPLY_INBOX_PHOTO_FAILURE",taskId,pageId,convId,error:s})}}
```

`s` nhận 3 hình dạng từ `sendInbox`:

| nhánh | `s` |
|---|---|
| `cannotRetry` | `{errorDescription, fbErrorCode}` |
| hết hạn nội bộ | `{success:false, retryReason:"execute task timeout"}` |
| `retryUsingSocket` | `{success:false, canRetryUsingSocket:true, retryReason:"blocked_3252001", fbErrorCode}` |
| lỗi mạng / sai URL | `undefined` |

**Shape thật** suy ra từ chính log (không đoán): log in
`Extension không gửi được ({"errorDescription":…,"fbErrorCode":1545041})` và chuỗi được dựng bằng
`' (' + why + ')'` ⇒ `why` **chính là object lồng đó**, tức `d.error` là object.

Script cũ đọc `d.errorMessage || d.error || d.reason || d.code` ⇒ `d.error` là object nên rơi vào
`JSON.stringify` ⇒ `deadUser` vẫn khớp (nhờ chuỗi "không có mặt"), **nhưng `fbErrorCode` là số nằm
trong object lồng nên không bao giờ đọc được**, và `retryReason` thì bị bỏ qua hoàn toàn.

### 8.2 `execute task timeout` = tin CHẮC CHẮN chưa đi

```js
const w = g ? ro(g) : "NO_TIMEOUT";
if (w === null) return b({success:false, retryReason:"execute task timeout"});
```

`ro(g)` trả `null` khi mốc hết hạn của chính lệnh đã qua ⇒ `return` NGAY, **trước** `buildSendParams`
và **trước** `de(...)` (lệnh fetch gửi tin). Không một byte nào tới Facebook.

Script cũ: `retryReason` không được đọc ⇒ `why === ''` ⇒ rơi vào nhánh "success:false không kèm lý
do" ⇒ `sent:'maybe'` + ⚠ + **vào danh sách gửi tay**. Nay: ❌ chắc chắn. (Chặt hơn, không sinh trùng.)

### 8.3 Ba mã FB từ chối khác — phải phân biệt

```js
const r = [1357004, 1545012, 1545006, 3252001, 1390008];
checkCanReuploadPhotos(t) = t.error===1545012
  && ["Tạm thời không thực hiện được","Temporary Failure"].includes(t.errorSummary)
  && ["Đã xảy ra lỗi tạm thời, vui lòng thử lại.",
      "There was a temporary error, please try again."].includes(t.errorDescription)
```

| mã | extension làm gì | phải hiểu là |
|---|---|---|
| `1545012` + đúng bộ ba trên | úp lại ảnh rồi gửi lại (`reuploadPhotos`) | **lỗi TẠM THỜI** — KHÔNG chốt ❌ |
| `1545006` | úp lại ảnh (`reuploadPhotos`) | lỗi ảnh — KHÔNG chốt ❌ |
| `3252001` / `1390008` | `retryUsingSocket` + `setUploadBlocked` **7 ngày** (`wl = 6048e5`) | **FB chặn page** ⇒ ghi sổ từ chối |
| `1357004` | nhánh `restartInbox` | không kết luận |

Đo trên 28 log: `3252001` = 0 · `1390008` = 0 · `1545012` = 0 · `1357004` = 0 · `1545006` = **13**.

### 8.4 Đối chứng (không phải suy luận)

| payload | cách cũ | 1.93.7 |
|---|---|---|
| `{error:{…1545041}}` | `'{…}'` → deadUser ✓ | không đổi |
| `{error:{…1545006}}` | `'{…}'` → deadUser ✓ | không đổi |
| `{error:1545012,…}` | `'1545012'` | không đổi |
| `{error:3252001,…}` | `'3252001'` | **+ ghi sổ CHẶN PAGE** |
| `{retryReason:"execute task timeout"}` | `''` ⇒ **KHÔNG RÕ** | **❌ chắc chắn chưa gửi** |
| `null` (adapter timeout) | `''` ⇒ KHÔNG RÕ | KHÔNG RÕ (giữ nguyên) |

Kiểm ngược 5 ca phổ biến: `deadUser` **giữ nguyên 5/5**, chỉ thêm hành vi cho 2 nhóm mới.

### 8.5 Rút lại một kết luận sai của tôi

Trước tôi nói script "thiếu `convId`" khi dò global_id. **Sai.** App cũng gửi `null`:

```js
getGlobalUserId(e){let t=to(e,["pageId","threadId","threadKey","isBusiness",
  "conversationUpdatedTime","customerName"]);
  return Object.assign(t,{postId:null,convId:null,convType:"INBOX"}), new Ee(t).init()}
```

`to()` chỉ copy 6 key rồi gán cứng `convId:null` ⇒ script gửi **giống hệt** app. Không sửa gì.
