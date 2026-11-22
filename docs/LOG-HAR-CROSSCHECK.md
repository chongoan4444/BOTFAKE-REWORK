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

## 9. Đào sâu: `ae.startCheck` và ngân sách 30 s (1.93.8)

### 9.1 `startCheck` — nhánh `r = true` BỎ QUA KẾT QUẢ

```js
static startCheck(e, t, a = !0, r = !1) {          // e = pageId, t = hàm gửi
  const s = () => ae.startCheck(e, t, a, !0);      // retry KHÔNG kèm cờ r
  r ? (C.log("SWITCH_PROFILE_BUT_NOT_HANDLE_ERROR"),
       new ae(e, a).init().then(()=>{}).catch(()=>{}).finally(t))   // ← kết quả bị bỏ
    : (C.log("FIRST_TRY_DOING_TASK_WITHOUT_SWITCH_PROFILE"), t(s));
}
```

`ae` = `ProfileSwitcher` (`self.ProfileSwitcher=ae`) — nó **đổi profile Facebook sang page**
(`checkValidProfile()` đọc `business.facebook.com`, gọi `switchProfile`).

| nơi gọi | có switch profile? |
|---|---|
| `case "SEND_COMMENT"` → `ae.startCheck(pageId, _, !0, !0)` | **CÓ** (và bỏ qua kết quả) |
| `case "UPLOAD_INBOX_PHOTO"` → `ae.startCheck(_, D)` (rỗng) | **KHÔNG** |
| `case "REPLY_INBOX_PHOTO"` | **KHÔNG** (`le(pageId).sendInbox`) |

⇒ Câu `Ext: Không tìm được global_id để gửi` (150 lần trong log) thuộc nhánh **upload ảnh**,
không phải nhánh gửi tin.

### 9.2 Khi nào `init()` "im lặng thành công"

```js
async checkValidProfile() {
  const {html, response} = await this.readMainPage();
  if (response?.status >= 500 || response?.status === 429) { this.switchNoResponse = true; return; }
  if (html) {
    const {currentProfile, profiles} = await this.getProfileSetting(html);
    if (this.confirmProfile && !currentProfile?.id) { this.switchNoResponse = true; return; }
    ...
  }
}
```

`getProfileSetting` dùng `G(html, '{"require":…RelayPrefetchedStreamCache…')`. Nếu HTML không còn
khối đó ⇒ `[]` ⇒ `currentProfile = {}` ⇒ `switchNoResponse = true; return` ⇒ **`switchResult`
không bao giờ được gán** ⇒ `init()` resolve ⇒ `.then(()=>{})` ⇒ `.finally(t)` chạy `t(s)`.

`Hh = new Set(["ok","not_needed","not_found"])` dùng để kiểm ở `$h` (đường *INVITE_LIKE_PAGE*),
**không** áp cho `startCheck` ⇒ `startCheck` nuốt mọi kết quả.

### 9.3 Ngân sách thời gian thật của extension = 30 s

```js
ao = 35e3
Wc = (fn, e = ao - 5e3) => { ... r[a] = true; setTimeout(() => { r[a] = false }, e); fn(a); }
ro = (n) => { ... if (r) { const s = ao - (now - a); return s > 0 ? s : null; } else return null; }
sendInbox: const w = g ? ro(g) : "NO_TIMEOUT";
           if (w === null) return b({success:false, retryReason:"execute task timeout"});
```

⇒ Trước **30 s**, extension **không bao giờ** tự bỏ lệnh. Script bỏ chờ ở **2,5 s**.

**Đo trên 28 log:** câu `Extension không phản hồi` = **2 588 lần** — nhóm "không rõ" lớn thứ nhì.
Và đo trước đó (bản 1.91.98): `Ext quá hạn 114 · kiểm chứng thấy tin 69` ⇒ **60 % tin ĐÃ đến nơi**.
Nguyên nhân: ta bỏ chờ khi extension còn đang chạy.

1.93.8 không đổi nhánh quyết định (vẫn `'maybe'` + kiểm chứng nền, tuyệt đối không bắn lại),
chỉ sửa **câu chữ** cho đúng sự thật: *"Hết hạn chờ CỦA TOOL sau 2,5s (Extension tự có 30 s và
VẪN ĐANG CHẠY)"*.

### 9.4 Sửa lỗi của chính 1.93.7

```js
// SAI (1.93.7): Number() bọc ngoài chuỗi || ⇒ d.error là object ⇒ Number(obj)=NaN ⇒ NaN||0=0
Number((d && (d.fbErrorCode || d.error)) || (_ee && _ee.fbErrorCode) || 0) || 0
// ĐÚNG (1.93.8): lấy số trước, bọc Number sau
Number((d&&d.fbErrorCode) || (_ee&&_ee.fbErrorCode)
       || (typeof d.error === 'number' ? d.error : 0) || 0) || 0
```

Đối chứng 7 payload: `1545041 lồng` → `1545041` · `3252001 lồng/phẳng` → `3252001` ·
`1390008 lồng` → `1390008` · `retryReason only` → `0` · `null` → `0`. **7/7 đúng.**

Kiểm ngược quyết định:

| payload | ghi sổ |
|---|---|
| `1545041`, `1545006`, `#100` | TỪ CHỐI |
| `3252001`, `1390008` | CHẶN PAGE |
| `1545012` (tạm thời) | **không ghi** — đúng, vì extension tự upload lại rồi gửi lại |
| `execute task timeout`, `null` | **không ghi** |

## 10. `doc_id` — gốc thật của "batch nạp 0/0" (1.93.9)

### 10.1 Chuỗi phụ thuộc

```js
// ① batch chặn ngay nếu thiếu doc_id
class Ct { async init(){ if (!O.get(rt, st)) return Promise.reject(`Missing doc_id ${rt} or ${st}`); } }
rt = "MessengerThreadlistWebGraphQLQuery"   st = "MessengerThreadlistQuery"

// ② O = self.GraphQLDocId (class Ll) — CHỈ nạp bằng 2 đường
constructor(){ this.docIdsMap = this.populateDocIdsMap(); }        // localStorage
async getDocIdsFromLocalStorage(){ q.getItem("GraphQLDocId_docIdsMap"); }
preloadDocIds(e){ ... await ee.preloadDocIds(e) ... }              // fetch HTML FB → bóc

// ③ bóc thật sự (makeResourceMap) — CHỈ regex trên HTML
let t = G(e,'"resource_map":');  t.length || (t = G(e,'"rsrcMap":'));
Array.from(e.matchAll(/setResourceMap\(([^)]+), \[\]\)/g)) ...

// ④ TTL 5 giờ
kl = 3600*1e3*5     has() quá hạn ⇒ delete()
```

Script trước 1.93.9: `docIdsMap` **0** · `isFeatureReady` **0** · `"resource_map"` **0** ·
`PRELOAD_DOC_IDS` **0** ⇒ `doc_id` chưa bao giờ có ⇒ `Ct.init()` luôn reject ⇒ `batch nạp 0/0`
ở **mọi** log. Và `Ee` (dò lẻ) cũng dùng `O.get(rt,st)` / `O.get(ge)` ⇒ dò lẻ cũng hỏng theo.

### 10.2 Tên doc_id thật (trích nguyên văn từ bundle)

| hằng | giá trị | dùng cho |
|---|---|---|
| `rt` | `MessengerThreadlistWebGraphQLQuery` | **batch** + `findThread` |
| `st` | `MessengerThreadlistQuery` | **batch** |
| `Jt` | `PagesManagerInboxAdminAssignerRootQuery` | `Ee` nguồn ① |
| `Zt` | `PagesManagerInboxQueryUtilCommItemHeaderMercuryQuery` | `Ee` nguồn ② |
| `ge` | `BizInboxCustomerRelaySearchSourceQuery` | `Ee` nguồn ④ (tìm theo tên) |
| `Da`/`Sa` | `MessengerThreadsWebGraphQLQuery` / `MessengerThreadsQuery` | LOAD_FACEBOOK_MESSAGES |
| `ta` | `CometProfileSwitchMutation` | `switchProfile` (SEND_COMMENT) |

`ia.inbox = [Jt, Zt]` ⇒ `isFeatureReady('inbox')` chỉ đòi 2 mã đầu.

### 10.3 Cách A — bóc từ HTML đã có trong tay (không thêm request)

Bọc `window.fetch` (đã có sẵn wrapper) → `res.clone().text()` → `harvestDocIdsFromHtml`.
Bóc 3 dạng: `"resource_map":{…}`, `"rsrcMap":{…}`, `setResourceMap({…}, [])`.
Chỉ nhận tên có trong bảng `DOCID_KEEP` (14 tên thật) hoặc kết thúc `GraphQLQuery`.
Ghi qua `GraphQLDocId.set(name, value)` — hàm này tự lưu localStorage + TTL 5 giờ.

**Đối chứng 5 kịch bản:**

| HTML | kết quả |
|---|---|
| `"resource_map":{…2 mã thật…, "RácKhácQuery"}` | **+2**, rác **không** lưu, `docIdReady()` = **true** |
| `"rsrcMap":{…doc_id…}` | **+1** |
| `setResourceMap({…}, [])` | **+1** |
| không có resource_map / chuỗi ngắn / `null` | **0**, không lỗi |
| JSON hỏng | **0**, không crash |

### 10.4 Cách B — hỏi extension, **mặc định TẮT**

Không gửi thẳng `PRELOAD_DOC_IDS`: switch của extension 0.5.62 **không có case đó** (đã liệt kê
86 case). Gửi thẳng = im lặng, và "im lặng" sẽ bị hiểu thành "không rõ" ⇒ sinh ⚠ (đúng bài học
`BATCH_GET_GLOBAL_ID`).

Nay dùng tên riêng `PRELOAD_DOC_IDS_CANDIDATE`, bật bằng
`window.__botfakeTryPreloadDocIds__ = true`, và **luôn đọc kết quả**: nếu `docIdReady()` sai thì
ghi rõ "extension không nạp được" chứ không coi là thành công.

### 10.5 Phân biệt 2 nguyên nhân batch rỗng

```js
const whyNoList = docIdReady()
  ? 'extension TRẢ LỜI nhưng không có data.threadsWithGlobalId (lệnh lạ/phiên bản khác)'
  : 'THIẾU doc_id ⇒ extension reject "Missing doc_id" (chưa chạy được lần nào)';
```

Trước đây cả hai đều in `lỗi 0` nên **không thể** phân biệt.

### 10.6 Cái CHƯA chứng minh được

Chưa có HAR nào bắt response **HTML** — 12 HAR chỉ chứa API JSON. Vì vậy tôi **không** khẳng định
cách A sẽ tìm ra `resource_map`. Điều đã chứng minh: nó **rẻ** (regex trên dữ liệu đã có, 0 request
mới), **chỉ đọc** (không thể sinh tin trùng), và khi không tìm thấy thì **không ảnh hưởng** đường
gửi nào.

## 11. `d` là CHUỖI + `canRetryUsingSocket` chưa từng đọc (1.93.10)

### 11.1 Bằng chứng: shape lỗi thật trên 28 log (16 142 dòng)

```
16 094  Extension không gửi được ({"errorDescription":"Người này hiện không có mặt.","fbErrorCode":N})
    48  Extension không gửi được (INCORRECT THREAD)
```

**Chỉ 2 hình dạng, cả hai là CHUỖI.** Không phải object ⇒ `d.fbErrorCode` = `undefined`
⇒ `_fbErrNum` **luôn = 0** ở mọi bản trước 1.93.10 (kể cả bản 1.93.8 vừa "sửa" `Number()`).

Nguyên nhân: kết quả đi qua `__ExtensionAdapter__` của app (không có trong repo) nên bị
`JSON.stringify` thêm một lần.

**Sửa:** nếu `d` là chuỗi và bắt đầu bằng `{` thì `JSON.parse(d)` rồi gán lại `d` + `res.data`.
Đọc thêm, **không đổi phán quyết** — chuỗi `why` giữ nguyên nên mọi đường đang dựa vào regex chuỗi
không bị ảnh hưởng.

### 11.2 `canRetryUsingSocket` — script chưa từng đọc (0 lần)

Extension trả cờ này ở 3 nhánh `getErrorHandler`:

| nhánh | điều kiện | nghĩa |
|---|---|---|
| (i) | `t.error === 1545012 && a === 1` | **ĐÃ** upload lại mà VẪN lỗi |
| (ii) | IG `error_payload:true`, không kèm `error` | IG |
| (iii) | `3252001` \| `1390008` | FB **chặn page** |

Trước 1.93.10 script gộp (i) vào "tạm thời" như lần 1. Nay tách:

- **(i) 1545012 lần 2** ⇒ **KHÔNG** chốt ❌, **KHÔNG** ghi sổ từ chối (chưa phải bằng chứng khách
  chết) — chỉ đếm riêng `extTimeoutStats.fbRetry2` và in ở TỔNG HỢP.
- **(iii)** ⇒ ghi sổ chặn page (giữ nguyên như 1.93.7).

### 11.3 Đối chứng 8/8 (`/tmp/v7.js`, payload đúng hình dạng CHUỖI của log thật)

| payload | số bóc | lần 2 | khách chết | ghi sổ |
|---|---|---:|---|---|
| `1545041` | 1545041 | – | **true** | ✅ "FB từ chối nhận tin" |
| `3252001` | 3252001 | – | false | ✅ "FB CHẶN PAGE" |
| `1390008` | 1390008 | – | false | ✅ "FB CHẶN PAGE" |
| `1545012` + canSock | 1545012 | **true** | false | **KHÔNG** |
| `1545012` thường | 1545012 | false | false | **KHÔNG** |
| `1545006` | 1545006 | false | false | **KHÔNG** |
| `INCORRECT THREAD` | – | – | – | **KHÔNG** |
| `execute task timeout` | – | – | – | **KHÔNG** |

### 11.4 Việc đã cân nhắc và **TỪ CHỐI** làm

Dùng 4 dấu hiệu "page bị chặn" của `Xc` (`"Bạn tạm thời bị chặn"`, `CometErrorRoot.react`,
2 câu "nội dung không khả dụng") để làm sổ chặn page.

**Lý do từ chối:** script **không bao giờ** fetch Facebook (đo: 22 lần `apiBase()`, 4 lần
`business.facebook.com` đều là **chú thích**) ⇒ `harvestDocIdsFromHtml` chỉ nhìn thấy HTML của
Pancake ⇒ 4 chuỗi đó **không bao giờ** xuất hiện. Làm sẽ là code chết.

### 11.5 Đã loại trừ dứt điểm 2 đường gửi còn lại

| đường | ai dựng | script có gửi lệnh đó? |
|---|---|---|
| `m.facebook.com/messages/send/` (`Bm`) | chỉ qua `.catch(km)` khi `attachmentType` **lạ** | **KHÔNG** (7 loại đều xử lý trước) |
| `m.facebook.com/a/comment.php` (`Gl`) | `SEND_STICKER_COMMENT` | **KHÔNG** (`grep = 0`) |

⇒ Đường gửi Facebook mà script chạm = **2/5**: `ee.sendInbox` (messaging/send) và
`Te.send` (GraphQL comment).

## 12. Bảng tổng hợp toàn bộ kết luận về extension 0.5.62 (1.93.9 → 1.93.11)

### 12.1 ĐÃ ÁP VÀO SCRIPT

| # | phát hiện | nguồn extension | phiên bản |
|---|---|---|---|
| 1 | `Ct.init()` reject `Missing doc_id` ⇒ batch chưa từng chạy | `if(!O.get(rt,st)) return Promise.reject(...)` | 1.93.9 |
| 2 | `preloadDocIds` bóc `"resource_map"`/`"rsrcMap"`/`setResourceMap(` | `makeResourceMap` | 1.93.9 |
| 3 | TTL doc_id **5 giờ** (`kl = 3600*1e3*5`) | `Ll.has()` | 1.93.9 |
| 4 | 14 tên doc_id THẬT (rt/st/Jt/Zt/ge/Da/Sa…) | khai báo hằng | 1.93.9 |
| 5 | `d` lỗi là **CHUỖI JSON** ⇒ `_fbErrNum` luôn 0 | 28 log, 2 hình dạng | 1.93.10 |
| 6 | `canRetryUsingSocket` chưa từng đọc; tách `1545012` lần 2 | `getErrorHandler` | 1.93.10 |
| 7 | `ensureDocIds()` **chưa** được gọi ở đường **dò gid** (chỉ ở batch) | `Ee.getGlobalIdFromInbox` cần 4 nguồn | 1.93.11 |
| 8 | `SEND_COMMENT_SUCCESS` trả `messageId`, script đọc `timestamp\|\|id` ⇒ rỗng | `case"SEND_COMMENT"` | 1.93.11 |

### 12.2 ĐÃ ĐỌC — KHÔNG CẦN SỬA

| # | phát hiện | lý do |
|---|---|---|
| 1 | `success` có thể sinh từ `error_payload` (`isResponseSuccess` kiểm `error_payload` TRƯỚC `actions[0].message_id`; `A&&B\|\|C` khiến `undefined\|\|error_payload` = truthy) | Script đã KHÔNG tin `res.success` từ 1.93.2 (⚠ + đọc lại lịch sử) ⇒ đã chặn sẵn |
| 2 | `makeParsable` chỉ bóc `for(;;);`, không bóc `while(1);` | Mọi endpoint script gọi đều trả JSON của Pancake; extension tự parse |
| 3 | `se.buildHeaders()` rỗng nếu HTML thiếu `MercuryServerRequestsConfig` | Phía extension; script không gửi request Facebook |
| 4 | `generateUsid()` trả `null` | Idempotency do `offline_threading_id` + `message_id` đảm nhiệm; script đã gửi đúng |
| 5 | `sendInbox` retry đệ quy (restartInbox / reuploadPhotos) — 1 lệnh app → N POST | Chỉ làm **tăng** khả năng tới; script đã chờ 2,5 s + kiểm chứng |
| 6 | `Wc` đặt `setTimeout(30 s)` rỗng ruột | Chỉ là dấu mốc; script đã biết ngân sách 30 s |
| 7 | `ot()` dedupe `preloadDocIds` (20 s) | Có lợi — script gọi idempotent |
| 8 | `Te.send()` `catch` trả `{success:!1}` **rỗng** (mất lý do) | Script đã xử lý `'maybe'` + không gửi lại |
| 9 | `Lm.aquire()` gõ sai | Chỉ ảnh hưởng `Am` (Zalo) |

### 12.3 ĐÃ LOẠI TRỪ (không thể chạm máy)

| đường | lý do |
|---|---|
| `Bm` — `m.facebook.com/messages/send/` | chỉ vào qua `.catch(km)` khi `attachmentType` **lạ**; 7 loại đều xử lý trước |
| `Gl` — `m.facebook.com/a/comment.php` | chỉ dựng từ `SEND_STICKER_COMMENT` — script **không** gửi (grep = 0) |
| Instagram / LINE / Zalo / lịch hẹn / livestream (~23 class) | script không gửi lệnh tương ứng |

### 12.4 TỪ CHỐI LÀM (có lý do đo được)

**Dùng 4 dấu hiệu "page bị chặn" của `Xc` làm sổ chặn page.**
Script **không bao giờ** fetch Facebook (22 lần `apiBase()`, 4 lần `business.facebook.com` đều là
**chú thích**) ⇒ `harvestDocIdsFromHtml` chỉ thấy HTML Pancake ⇒ 4 chuỗi đó không bao giờ xuất
hiện. Làm sẽ là code chết.

### 12.5 CÒN NGỎ (cần dữ liệu thật, không sửa được bằng suy luận)

| # | vấn đề | vì sao chưa sửa |
|---|---|---|
| 1 | `__ExtensionAdapter__` bọc `success` thế nào, `error` là object hay chuỗi | **Không có trong repo** (thuộc build app Pancake) |
| 2 | `ctx.loggedIn` của `Oc.listen()` không thấy phép gán nào trong bundle | Có thể gán động; chưa xác nhận được |
| 3 | `ACK_HOLD_CEIL_MS = 6000` đã bị chạm trần (min ACK 4 192 ms, p50 9 090–10 619 ms, 100 % là "muộn") | Sửa = **nới** hạn chờ ⇒ trái nguyên tắc "không nới đường sinh tin trùng" |
| 4 | `1545012` lần 2 = "hết đường" hay "từ chối hẳn" | Extension không nói rõ; chỉ đếm, không chốt |
| 5 | Sổ chặn upload 7 ngày **theo page** | Chưa có log nào cho thấy `3252001`/`1390008` (đo 28 log = **0**) |
| 6 | Nâng hạn chờ tool 2,5 s → gần 30 s | Chưa có `p90` riêng của làn Ext trong lô mới |

### 12.6 Đính chính một kết luận SAI của tôi

Tôi từng nói: *"`Vt` đọc `convName` nhưng khai báo `customerName` ⇒ `allowSearchByName` luôn
undefined"*. Đọc lại `findThread` cho thấy **sai**:

```js
let I = x.find(w => { …
  if (a) { const S = …messaging_actor.name; return S.includes(a) } });   // ← lượt CHÍNH dùng `a`
!I && a && bn(this.pageId) && (I = x.find(…))                            // ← `bn` chỉ gate lượt PHỤ
```

`customerName` được dùng ở lượt **chính**; `bn()` chỉ chặn lượt **phụ** (thử lại sau khi danh sách
đã tải). Và `getGlobalIdFromInbox` truyền `customerName: this.customerName` — đúng tham số.

⇒ Không sửa gì. Ghi lại để lần sau không "sửa" theo kết luận sai này.

## 13. 1 197 ca BỊ CHẶN THẬT bị chốt ⚠ ⇒ vào danh sách GỬI TAY (1.93.12)

### 13.1 Số đo — log 22/11 07:38 (lô 1 694 chat, bản 1.93.11)

```
✅ 474   ❌ 23   ⚠ 1 197        474 + 1 197 + 23 = 1 694  (khớp)
ACK OK/rejected/no-ACK  473/1204/0        ← no-ACK = 0
SOCKET: retry wave 0 · retry lần 0
🌊 Ext queue/active 0/17 · Ext gửi 48    ← Ext gần như không chạy
📡 buckets <250/250-999/1-2s/2-5s/≥5s 0/314/1279/84/0
```

`no-ACK = 0` ⇒ **mọi ca đều có phản hồi** ⇒ toàn bộ 1 197 ca ⚠ là ACK **REJECTED**.
Người dùng kiểm trực tiếp trong Pancake: **chỉ 474 ca có tin; 1 197 ca còn lại là khách CHẶN THẬT**.

### 13.2 Gốc — hai điều kiện chặn đường xử lý dứt khoát

```js
// settleSocketResult, nhánh rejected
if (rejected && ctx.apiRejected551) ctx.socketRetriedOnce = true;          // ← bật cờ, chặn dưới
if (rejected && (!ctx || !ctx.gidFromPsid) && !ctx.socketRetriedOnce) { …thử lại 1 lần… }  // ← bị chặn
…
const isConfirmedUnavailable = !!(ctx && ctx.socketRetriedOnce);           // ← false
return { ok:false, sent:false, ambiguous:true, recipientUnavailable:false, … };
```

`ambiguous: true` ⇒ vào cổng `if (r.ambiguous && !r.recipientUnavailable …)` ⇒
`scheduleBuRetry` ⇒ hết ngân sách ⇒ `{ uncertain: true, sent: 'maybe' }` ⇒
`trackStatus('uncertain')` ⇒ **⚠ + 🖐 CẦN GỬI TAY**.

Thêm một đường nữa: `resolveGlobalId` bước 4 (`psid-guess`) đặt `ctx.gidFromPsid = true` ⇒
điều kiện `!ctx.gidFromPsid` **sai** ⇒ nhánh thử lại **không bao giờ chạy** (log: `retry lần 0`).

### 13.3 Vì sao `gidFromPsid` KHÔNG làm phản hồi mất giá trị

`markOptimisticMessageFailed` là phản hồi cho **chính khung `/ls_req`** ta vừa publish
(`thread_fbid` + `offline_threading_id`). FB chỉ trả lời khi đã định tuyến được thread.
⇒ dù gid là PSID đoán, **câu trả lời "không nhận tin này" vẫn là dứt khoát**.

Đối chứng: log 21/11 21:05 (4 266 chat) — 630 ACK rejected, người dùng xác nhận **"đều là chết thật"**.
Log 22/11 07:38 — 1 204 ACK rejected, người dùng xác nhận **"1 197 ca là khách chặn thật"**.

### 13.4 Sửa

```js
const _psidRejected = !!(raw.kind === 'rejected' && ctx && ctx.gidFromPsid);
const isConfirmedUnavailable = _psidRejected || !!(ctx && ctx.socketRetriedOnce);
return { …, ambiguous: !isConfirmedUnavailable, recipientUnavailable: isConfirmedUnavailable, … };
```

Đường đi sau sửa: `recipientUnavailable: true` ⇒ `finalizeSockBg` dòng ~5617 ⇒
`trackStatus(conv.id,'fail')` ⇒ **❌ NGAY, `return`, không bù, không vào danh sách gửi tay**.

**KHÔNG thêm một lệnh gửi nào.** `ambiguous:false` + `recipientUnavailable:true` là **đường tắt**
tới ❌ — bỏ bù, bỏ gửi tay. Chỉ-đọc.

### 13.5 Đối chứng 3/3 (`/tmp/v9.js`)

| ca | 1.93.11 | 1.93.12 | `ambiguous` |
|---|---|---|---|
| `rejected` + gid là **PSID đoán** | `recipientUnavailable=false` | **true** | false |
| `rejected` + gid thật + đã thử lại | true | true | false |
| `rejected` + gid thật, **chưa** thử lại | false | false | **true** (giữ nguyên) |

### 13.6 Hệ quả đo được trên lô mẫu (nếu giữ nguyên 1 694 chat)

| chỉ số | 1.93.11 | 1.93.12 (dự kiến) |
|---|---:|---:|
| ⚠ "không rõ" | 1 197 | **≈ 0** |
| ❌ lỗi | 23 | **≈ 1 220** |
| 🖐 CẦN GỬI TAY | 1 197 | **≈ 0** |
| số lệnh gửi | 1 694 | **1 694 (không đổi)** |

⇒ Người dùng **không còn bị dụ gửi tay** vào 1 197 chat mà máy đã biết là chết.
Đây là "báo ✅ sai" theo chiều ngược lại — và là lỗi lớn nhất của cả phiên.

---

## 14. GỠ 1.93.12 — nhánh sửa đó CHẾT (1.93.13)

### 14.1 Điều kiện đã thêm không bao giờ đúng ở lô lớn

1.93.12 thêm:

```js
const _psidRejected = !!(raw && raw.kind === 'rejected' && ctx && ctx.gidFromPsid);
const isConfirmedUnavailable = _psidRejected || !!(ctx && ctx.socketRetriedOnce);
```

`ctx.gidFromPsid = true` chỉ được gán ở **đúng 2 chỗ**, cả hai đều là bước 4 `psid-guess`:

```
4114:  const isLargeBatch = !!(batchStats && batchStats.total > 50);
4119:    if (isLargeBatch) { ctx.gidUnknown = true; … return null; }   ← chặn 4127
4551:    if (isLargeBatch) { return null; }                            ← chặn 4559
4127:      ctx.gidFromPsid = true;
4559:        ctx.gidFromPsid = true;
```

⇒ Mọi lô **> 50 chat** không bao giờ có `gidFromPsid === true` ⇒ `_psidRejected` luôn `false`.

### 14.2 Đối chứng bằng log 1.93.12 (22/11 08:32, lô 1 672 chat)

```
script 1.93.12-W200.123
✅ 1 059 · ❌ 43 · ⚠ 570 · 🖐 gửi tay 570
khách không nhận được (đã đo): 0
chốt NGAY vì FB từ chối dứt khoát: 0 ca
retry lần 0
Chẩn đoán globalId: cache 1628 · HTTP 0 · WS 0 · Ext 0 · cứu thiếu globalId 43
```

`chốt NGAY = 0` và `khách không nhận được = 0` ⇒ đúng nhánh 1.93.12 **chưa từng chạy**.
`cache 1628 / cứu thiếu globalId 43` ⇒ gid đến từ cache và làn API, **không** từ PSID đoán.

### 14.3 Kết luận

Gỡ về đúng logic 1.93.11. Giữ lại khối chú thích để lần sau không sửa lại y hệt.

**Điều KHÔNG chứng minh được:** nguồn sinh 570 ca ⚠ của lô 08:32. `570 ⚠` khớp đúng
`570 ACK rejected`, nhưng log xuất **0 dòng sổ kiểm chứng** và `retry lần 0` ⇒ nhánh
`rejected` trong `settleSocketResult` không chạy lần nào. Chưa chỉ ra được dòng code nào
đã đặt ⚠. Cần log xuất **ngay sau khi lượt chốt, trước khi F5** để tra từng chat.

### 14.4 Đối chiếu extension 0.5.62 — phần đã đúng / còn thiếu

Nguồn: `0.5.62_0/assets/background.js-EHsGnyIc.js` (412 999 byte).

**ĐÚNG (khớp source):**
- `getSendAPIUrl` → `https://business.facebook.com/messaging/send/` — đường DUY NHẤT ext dùng
- `buildSendParams`: `offline_threading_id`, `source:"source:page_unified_inbox"`, `FormData`
- `getErrorHandler` 5 mã: `1357004 · 1545012 · 1545006 · 3252001 · 1390008`
- `REPLY_INBOX_PHOTO_FAILURE` chỉ có 1 trường `error` (+ 4 hình dạng của `s`)
- `canRetryUsingSocket`: extension có trả nhưng **không chỗ nào trong extension đọc lại** ⇒ script bỏ qua là đúng

**CÒN THIẾU (chứng minh được từ source, chưa sửa):**
- `REPLY_INBOX_PHOTO_SUCCESS` mang `messageId` (lấy từ `payload.actions[0].message_id`) và
  `timestamp`. Script đọc `res.data.timestamp || res.data.convId` ⇒ **vứt `messageId`** —
  đây là bằng chứng dương tính duy nhất FB trả về.
- Nhánh `restartInbox` của ext **chắc chắn chưa gửi**: mọi nhánh đó đều `v(...)` (reject),
  không nhánh nào `b(...)` (resolve). Script đang xếp nhóm này vào "không rõ" (⚠ + gửi tay).

---

## 15. Rà lại toàn bộ `sendInbox` của extension 0.5.62 (1.93.13)

### 15.1 ĐÃ THỬ và ĐÃ GỠ: chốt ❌ ngay khi API trả `#551`

414 dòng `⚠ … API từ chối ((#551) Người này hiện không có mặt.)` trên 30 log — nguồn ⚠ lớn nhất.
Đã thử chốt ❌ ngay. **SAI — đã gỡ.** Đối chứng sổ kiểm chứng:

```
380 tên ca từng bị #551  →  29 ca ĐƯỢC CỨU THẬT (7,6 %)
vd log 17/11 16:27, conv 769625892902516_28615693248109700 (Hà Hồ):
  16:15:41  ⚠  API từ chối ((#551) Người này hiện không có mặt.)
  16:20:30  ✅  bù THÀNH CÔNG qua Extension      ← sổ ghi "kênh ext"
```

⇒ `#551` là câu trả lời của **kênh API**, không phải bản án cho khách. Extension đi qua tab
Facebook thật vẫn gửi được. Chốt ❌ ở đây = **mất tin**.

Bài học: dòng `⚠` giữa lô KHÔNG phải trạng thái cuối. Muốn kết luận phải tra **sổ kiểm chứng**
theo `conv id`, không đếm dòng log.

### 15.2 ĐÃ SỬA: `messageId` của `REPLY_INBOX_PHOTO_SUCCESS` bị vứt

```
parseSuccessResponse → { messageId: payload.actions[0].message_id, globalUserId,
                         timestamp: payload.actions[0].timestamp }
sendInboxSuccess     → postMessage({type:"REPLY_INBOX_PHOTO_SUCCESS", taskId, pageId,
                         convId, messageId, globalUserId, timestamp, …})
```

Script cũ: `id: (res.data && (res.data.timestamp || res.data.convId))` ⇒ bỏ `messageId`.
Nay lưu `messageId` vào `extMsgIdByConv` và trả `extMessageId` để lượt đọc lịch sử đối chiếu.
**Không đổi quyết định** (vẫn ⚠ vì `success` chỉ là "extension không báo lỗi"), **không thêm lệnh gửi**.

### 15.3 ĐỌC LẠI và SỬA LỜI: `restartInbox` KHÔNG phải "chắc chắn chưa gửi"

Trước đó tôi nói `restartInbox` "mọi nhánh đều reject" — **SAI, đọc thiếu**. Code thật:

```js
case"restartInbox": this.init(a,!0).then(…).then(()=>this.sendInbox({...e,retry:1}))
                     .then(b).catch(v);    // ← CÓ .then(b) ⇒ CÓ THỂ THÀNH CÔNG
```

Đúng là `#551 → "cannotRetry"` (nhánh `jc(H)` = `![1545041].includes(H.error)` = false cho 1545041).
Nhánh `restartInbox` chỉ xảy ra ở lỗi KHÁC ⇒ **không phải bằng chứng khách chết**. Giữ nguyên đường cũ.

### 15.4 ĐÃ KIỂM, GIỮ NGUYÊN (có lý do)

| Điểm | Extension 0.5.62 | Script | Kết luận |
|---|---|---|---|
| `isResponseSuccess` | `actions&&actions[0].message_id \|\| error_payload` | coi `success:true` là chưa chứng minh | **Không bắt chước** — ext có thể resolve khi `error_payload` truthy, hoặc throw khi actions rỗng |
| `getGlobalUserId` khi thiếu gid | ext tự dò rồi mới gửi | script gate `noGidGate` | Giữ gate: `getGlobalUserId` cần `doc_id` (3 tầng chặn đã ghi §12) và không kiểm soát được chống trùng |
| `ao = 35e3`, `Wc = ao-5e3` | ext có 30 s/lệnh | script bỏ chờ 2,5 s | Không đổi — đã sửa câu chữ ở 1.93.8, quyết định đúng |
| `canRetryUsingSocket` | ext TRẢ nhưng **không chỗ nào đọc lại** | script bỏ qua | Đúng |
| `checkCanReuploadPhotos` | cần đủ 3 trường | script giữ 1545012 là "tạm thời" | Đúng (thiếu 2 trường ⇒ không đủ bằng chứng) |

---

## 16. Đối chiếu ADAPTER THẬT của app (`_app-…v6.js`) — không phải suy đoán

Nguồn: `_app-9331d46f21a84eb1.v6.js` (2 019 782 byte), `window.__ExtensionAdapter__` @869517.

```js
send(e){ let t=arguments[1]||{};
  for(let t of ["type"]) if(!Object.hasOwn(e,t)) throw "Message send to extension is missing "+t+" field";
  let n = this.currentTaskId++,
      o = t.timeout || (u.has(e.type) ? d : l);
  …
  this.pendingMessages[n] = s;
  window.postMessage({...e, taskId:n, from:"WEBPAGE"}, "*");
  setTimeout(()=>{ delete this.pendingMessages[n]; t({success:!1, data:null}) }, o);
}
let l=3e4, d=12e4, u=new Set(["CONFIG_ROUTING_APP","CACHE_PAGES_ROUTING_APP"])
```
Ghép kết quả: `n.type === e.type+"_SUCCESS"` ⇒ `{success:true, data:n}` · `"_FAILURE"` ⇒ `{success:false, data:n}`.
Listener lọc `"WEBPAGE"!==e.data.from && e.data.taskId in this.pendingMessages`.

### 16.1 ĐÃ SỬA — hạn giữ lane sai giá trị của app

| | App | Script (trước) | Nay |
|---|---|---|---|
| Trần chờ adapter | `l = 30 000` (`REPLY_INBOX_PHOTO` ∉ `u`) | `EXT_ADAPTER_HOLD_MS = 60000` | **30000** |
| Lệnh config | `d = 120 000` | không dùng | không đổi |

Đổi 60 s → 30 s chỉ **nhả lane sớm hơn**. Ca quá hạn vẫn đi đúng đường cũ (⚠ + kiểm chứng
nền, KHÔNG BAO GIỜ gửi lại) ⇒ không mở thêm đường gửi trùng.

### 16.2 ĐÃ KIỂM — `taskId` KHÔNG phải việc của script

`adapter.send` TỰ sinh `taskId = currentTaskId++` và tự ghép `_SUCCESS`/`_FAILURE`.
Script gửi `REPLY_INBOX_PHOTO` **không kèm `taskId`** — **ĐÚNG**, và đây là lý do script
nhận được `res.data.messageId`: adapter trả nguyên `data` của `REPLY_INBOX_PHOTO_SUCCESS`.

### 16.3 ĐÃ KIỂM — `threadKey` và `from` không dùng cho Facebook

Trong `case"REPLY_INBOX_PHOTO"` của extension:
- `threadKey` (T) chỉ truyền vào `.sendInbox({… threadKey:T …})` của `le(I)`. Extension **không**
  dùng `threadKey` khi dựng form gửi FB (`buildSendParams` không đọc nó).
- `from` (Q) chỉ dùng ở nhánh IG: `customerUsername: H || Q.name`.

⇒ Script thiếu 2 field này **không ảnh hưởng** đường Facebook. Chỉ khác nếu gửi IG (script không gửi IG).

### 16.4 ĐÃ KIỂM — các điểm khác, KHÔNG cần sửa

| Điểm | Kết luận |
|---|---|
| `isResponseSuccess` đọc ngược | **Không bắt chước.** App cũng dính (nhận `success:true` khi `error_payload` truthy) — nhưng bắt chước là nới sang "báo ✅ sai", đúng thứ đang cấm. Script đã chặn ở tầng trên. |
| `1357004` | Extension coi là lỗi FB, rơi vào `checkCanReuploadPhotos` → không khớp ⇒ `restartInbox`. Script không xử lý riêng = để đi đường chung. **0 lần** xuất hiện trong 30 log. |
| Đường verify Ext có so nội dung tin | **Có** — `isMessageDeliveredInHistory(msgs, pageId, want, photo, sentAtMs)` + `confirmViaSnippet`. Không phải "thấy tin bất kỳ là ✅". |
| `late-watch` chốt ✅ muộn | Chỉ chạy khi `late.success` — tức đã có `REPLY_INBOX_PHOTO_SUCCESS` = FB trả `message_id`. Không phải `res.success` trần. Chỉ **5 lần** / 30 log. |
| `payload.type` | Adapter REQUIRE `type` (throw nếu thiếu). Script có gửi. ✔ |

---

## 17. Đối chiếu nốt 3 lệnh còn lại (1.93.13)

### 17.1 ĐÃ SỬA — `GET_GLOBAL_ID_FOR_CONV_SUCCESS`: `globalId` nằm ở TOP-LEVEL

```js
// 0.5.62_0/assets/background.js
case"GET_GLOBAL_ID_FOR_CONV":{const{taskId:_}=r.data, g=new Ee(r.data),
  I=()=>e.port.postMessage({type:"GET_GLOBAL_ID_FOR_CONV_FAILURE",taskId:_});
  g.init().then(y=>{ y ? e.port.postMessage({type:"GET_GLOBAL_ID_FOR_CONV_SUCCESS",
                    success:!0, globalId:y, taskId:_}) : I() }).catch(()=>{I()}); }
```
`globalId` ở **cấp ngoài**, KHÔNG lồng trong `data`.

Adapter của app bọc `t({success:!0, data:n})` với `n` = nguyên message ⇒ `res.data.globalId` ✔ (script đã đúng).
Nhưng adapter RIÊNG (`__botfake`, nếu có) bọc phẳng `{success, globalId}` ⇒ script cũ **bỏ sót**.

Đã sửa: `_gidOf()` đọc **cả hai** đường, và loại `badGid` / chuỗi `"null"` / `"undefined"`.
Áp cho cả lần dò 1 và lần dò 2 (`4447` và `4461`).

### 17.2 ĐÃ KIỂM — `MAKE_MESSENGER_LINK` với `uiVersion: 6` là ĐÚNG

```js
class k_{ … handleFacebook(){ const e=this.uiVersion||await za.get(this.pageId);
  switch(e){ case 3: case 4: case 6: case 7: return this.getGlobalId().then(t=>({
      link:`https://business.facebook.com/latest/inbox/all?asset_id=…&selected_item_id=${t}`,
      globalId:t })); } }
  getGlobalId(){ return this.globalId ? Promise.resolve(this.globalId)
      : new Ee({pageId,threadId,threadKey,isBusiness,conversationUpdatedTime,customerName,…}).init() } }
```
⇒ `uiVersion` 3/4/6/7 mới **thực sự dò gid**; 1/2/5 chỉ trả link không có gid.
Script gửi `uiVersion: 6`, `globalId: null` ⇒ path đúng. **Không sửa.**
(Đây cũng là lý do ghi chú cũ "không bỏ `uiVersion: 6`" là đúng.)

### 17.3 ĐÃ KIỂM — `UPLOAD_INBOX_PHOTO` là fallback đúng, `convId`/`uploadId` không bắt buộc

```js
case"UPLOAD_INBOX_PHOTO":{ … const{pageId:_,convId:g,taskId:I,uploadId:y,photoUrl:b,name:v,platform:A}=r.data;
  S.upload(b,_,v,A,i).then(R=>e.port.postMessage({type:"UPLOAD_INBOX_PHOTO_SUCCESS",
    from:"EXTENSION",taskId:I,uploadId:y,fbId:R.fbid,previewUri:R.previewUri})) … }
```
- `convId`/`uploadId` **chỉ được echo lại** trong message trả về, không dùng để upload.
- Upload đi `upload-business.facebook.com/ajax/mercury/upload.php` — **khác** `/v1/contents` của script.
- Script chỉ gọi khi `/v1/contents` thất bại (fallback) ⇒ đúng thiết kế, **0 lần** trong 30 log.
- `uploadId` thiếu chỉ làm trường đó `undefined` ở response — script chỉ đọc `res.data.fbId`. ✔

### 17.4 ĐÃ KIỂM — `taskId` echo lại trong MỌI response

Cả 3 lệnh trên đều `postMessage({… taskId …})`. Việc đó **cần** khi app tự gửi (adapter ghép theo
`pendingMessages[taskId]`), nhưng `adapter.send` đã tự thêm `taskId` (`{...e, taskId:n}`) nên
script **không được** tự gửi `taskId` — gửi sẽ ghi đè bộ đếm và làm lệch ghép kết quả.
Script hiện **không gửi** ở cả 3 lệnh. ✔

---

## 18. Đối chiếu `PRELOAD_DOC_IDS` + `BATCH_GET_GLOBAL_ID` (1.93.13) — 2 LỖI THẬT

### 18.1 `PRELOAD_DOC_IDS` **CÓ** case trong extension — script gửi tên bịa

Chú thích cũ trong script: *"switch của extension 0.5.62 KHÔNG có case đó (đã grep 86 case)"*
⇒ **SAI**. Case thật @400547:

```js
case"PRELOAD_DOC_IDS":{await Z(); const{pageId:_,isBusiness:g}=r.data;
  O.preloadDocIds({pageId:_, isBusiness:g});          // ← KHÔNG await, KHÔNG postMessage
  q.setItem("country", r.data.country); break}
```

Script gửi `PRELOAD_DOC_IDS_CANDIDATE` — extension rơi vào default, **bỏ qua im lặng**.
Đó là lý do `batch nạp 0/0` ở **27/27 log** dù doc_id có sẵn.

Tham số đúng: `{pageId, isBusiness, country}`.
`O.preloadDocIds({html, pageId, isBusiness})`: `html` bỏ trống ⇒ ext tự fetch
`business.facebook.com/latest/inbox/facebook?asset_id=…`; nạp vào `O` (GraphQLDocId)
= localStorage `GraphQLDocId_docIdsMap`.

**Không có `_SUCCESS`/`_FAILURE`** ⇒ `adapter.send` sẽ timeout (30 s) rồi trả `{success:false,data:null}`
nhưng side-effect ĐÃ xảy ra. Vì vậy: hạn chờ 4 s (không giữ lane), phán quyết dựa DUY NHẤT vào
`docIdReady()` đọc lại localStorage. Đường CHỈ ĐỌC + ghi cache của extension, không gửi tin.

### 18.2 `BATCH_GET_GLOBAL_ID` cần 5 lượt graphql, script chỉ chờ 2 000 ms

```js
const yn=50, ul=250
class Ct{ constructor({pageId, timeRangeMin, maxThreadCount}){ … this.maxThreadCount = maxThreadCount || ul }
  async init(){ for(;;){ let c=yn;
      if(this.maxThreadCount && this.maxThreadCount-s<yn) c=this.maxThreadCount-s;
      const l=await this.getFacebookThreads(a,c);   // graphqlbatch "MessengerGraphQLThreadlistFetcher"
      … } } }
```

Mỗi lượt `yn = 50` thread, trần `ul = 250` ⇒ **5 lượt graphqlbatch**.
Script không kèm `maxThreadCount` (đúng — ext dùng trần 250), nhưng chờ **2 000 ms**.
5 lượt graphql không thể xong trong 2 s ⇒ luôn rơi nhánh timeout.

Đối chiếu app: `c.Z.send({type:"BATCH_GET_GLOBAL_ID", pageId:e, timeRangeMin:t.timeRangeMin})`
— **không kèm timeout** ⇒ dùng mặc định `l = 3e4` = **30 000 ms**, và **cũng không kèm
`maxThreadCount`**.

⇒ Sửa: `timeout: 2000` → `30000`. Chỉ đọc + trả mapping; chờ lâu hơn không sinh thêm lệnh gửi.

### 18.3 Đã đối chiếu, KHÔNG cần sửa

| Lệnh | Kết luận |
|---|---|
| `SEND_COMMENT` | Script đã đọc đúng `messageId` (sửa ở 1.93.11). `SEND_COMMENT_FAILURE` 2 hình dạng (`message` hoặc rỗng) — script đọc cả hai ✔ |
| `LISTEN_INBOX` / `LISTEN_WS` | Là lệnh **bật/tắt listener**, extension tự chạy `Oc`/`$a`. Script không điều khiển — đúng (ACK lấy qua lịch sử, không qua listener) |
| `timeRangeMin: 0` | `if(this.timeRangeMin!=null && d<this.timeRangeMin) break` ⇒ 0 = lấy mọi mốc ✔ |

---

## 19. Kiểm toàn bộ tên lệnh gửi cho extension + đường nạp doc_id

### 19.1 Bảng tên lệnh — 6/6 KHỚP sau khi sửa

Đối chiếu tự động: trích mọi `type: '…'` của script, so với **83 `case"…"`** của
`0.5.62_0/assets/background.js`.

| Tên script gửi | Có case? |
|---|---|
| `REPLY_INBOX_PHOTO` | ✔ |
| `SEND_COMMENT` | ✔ |
| `GET_GLOBAL_ID_FOR_CONV` | ✔ |
| `BATCH_GET_GLOBAL_ID` | ✔ |
| `MAKE_MESSENGER_LINK` | ✔ |
| `UPLOAD_INBOX_PHOTO` | ✔ |
| `PRELOAD_DOC_IDS` | ✔ (**vừa sửa** — trước gửi tên bịa `PRELOAD_DOC_IDS_CANDIDATE`) |

`BOTFAKE_BG_SEND` / `BOTFAKE_BG_FETCH` / `BOTFAKE_BG_STOP` / `BOTFAKE_JOB` **không phải** lệnh
extension: chúng đi qua `chrome.runtime.sendMessage` (hàm `extCall` @568) tới
`extension/bridge.js` của extension BOTFAKE — tách hoàn toàn khỏi `__ExtensionAdapter__`. ✔

### 19.2 `__ExtensionAdapter__` do extension **Pancake 0.5.62** cung cấp, KHÔNG phải extension trong repo

`extension/background.js` của repo (447 dòng) là extension BOTFAKE: overlay + gửi API trong SW,
`CONCURRENCY=24`, `jobs`/`bgCtl`. **Không có switch adapter, 0 case.**

`release/botfake-ext/manifest.json` chỉ có content script
`[scripts/pancake-send-lite.user.js, extension/bridge.js, extension/overlay.js]` — không inject
`window.__ExtensionAdapter__`.

⇒ Mọi `adapter.send(...)` **chỉ chạy được khi máy user có extension Pancake 0.5.62**; nếu không có
thì `adapter` là `undefined` và script rơi về `finishExt(null)` / `docIdReady()` đọc localStorage.
Điều này giải thích vì sao sửa hợp đồng lệnh **chỉ có tác dụng trên máy đã cài 0.5.62**.

### 19.3 Vì sao đường nạp doc_id qua Ext vẫn có thể 0/0 dù đã sửa tên

`tryPreloadDocIdsViaExt()` bị chặn bởi **công tắc riêng**:
```js
if (!window.__botfakeTryPreloadDocIds__) return Promise.resolve(false);
```
Không ai trong repo set cờ này ⇒ hàm **luôn trả `false` ngay dòng đầu**.
Cộng với `!docIdReady()` ở `requestBatchGlobalIds` (@9113) thì batch bị bỏ trước khi gửi lệnh.
⇒ 2 sửa ở §18 là **điều kiện cần, chưa đủ**: còn phải bật cờ (hoặc đổi mặc định) mới đo được.

### 19.4 Đã đối chiếu, KHÔNG sửa — `GET_FB_MSG` và tiêu chí khớp tin

`case"GET_FB_MSG"` → `findInternalMessage(sendParams, replyMessage)`; hàm này lọc và khớp **3 điều kiện**:
```js
y = parseInt(parseInt(I.timestamp_precise)/1e3) == t.insertedAt          // mốc giây
b = c ? c.trim() == I.message.text.trim() : true                          // nội dung
v = isFromPage ? String(I.message_sender.id)==String(t.from.id)
                : String(I.message_sender.id)==String(globalId)           // người gửi
```
Script dùng cùng logic (`isMessageDeliveredInHistory` + `confirmViaSnippet`) ⇒ **không lệch chuẩn**.
`GET_FB_MSG` là kênh phụ, script không cần gọi.

### 19.5 `jc = n => ![1545041].includes(n?.error)` — `1545041` là bộ lọc retry, KHÔNG phải nhãn "khách chặn"

```js
const Q = jc(H);              // Q = true khi error KHÁC 1545041
… case"restartInbox": … .then(()=>Q && Ze(t)) …      // chỉ restart khi lỗi KHÁC 1545041
… case"cannotRetry":   Q && Ze(t); v({fbErrorCode:H.error})
```
`1545041` ∉ `[1357004,1545012,1545006,3252001,1390008]` ⇒ `getErrorHandler` trả **`cannotRetry`**.
Extension **không có nhãn "khách chặn"** — chỉ có mã lỗi. Việc script coi `1545041` là
"FB từ chối nhận tin" là **diễn giải của script**, không phải hằng số của extension.

---

## 20. SỬA TOÀN BỘ ĐƯỜNG doc_id THEO EXTENSION THẬT (1.93.13 / W200.124)

Sau §18–§19 còn 3 chỗ sai **cấu trúc** khiến mọi sửa trước đó không có tác dụng.

### 20.1 `window.GraphQLDocId` KHÔNG TỒN TẠI trong trang — `docIdReady()` luôn `false`

```js
// 0.5.62_0/assets/background.js (SERVICE WORKER)
const O = new Ll;  O.prepareDocIdsMap();  self.GraphQLDocId = O;
```
`self` ở đây là **window của service worker**, không phải trang Pancake.
`grep -c GraphQLDocId _app-9331d46f21a84eb1.v6.js` = **0**; toàn repo chỉ có `docIdApi()` đọc nó.

⇒ `docIdApi()` luôn `null` ⇒ `docIdReady()` luôn `false` ⇒ câu in ra
`batch rỗng — THIẾU doc_id ⇒ extension reject "Missing doc_id" (chưa chạy được lần nào)`
xuất hiện **16/16 dòng trên 30 log**. Đó là **câu in ra**, không phải sự thật về extension:
extension tự giữ doc_id trong `chrome.storage.local` của nó và **vẫn chạy được**.

**Sửa:** xoá hẳn `docIdApi()`/`docIdReady()`; thêm `extAdapter()` (chỉ kiểm
`window.__ExtensionAdapter__`). Phán quyết về doc_id **chỉ** dựa vào phản hồi thật của
`BATCH_GET_GLOBAL_ID`.

### 20.2 doc_id map nằm ở `chrome.storage.local`, KHÔNG phải localStorage trang

```js
q = { getItem: async n => (await chrome.storage.local.get(n))[n],
      setItem: (n,e) => chrome.storage.local.set({[n]:e}) };
persistToLocalStorage(){ … q.setItem(yr, JSON.stringify(e)) }   // yr = "GraphQLDocId_docIdsMap"
```
`ensureDocIds()` cũ đọc `window.localStorage.getItem('GraphQLDocId_docIdsMap')` — **sai chỗ**,
luôn `null`. Đã bỏ hẳn (cùng với `docIdStats.loadedFromLs`).

### 20.3 `PRELOAD_DOC_IDS` nạp ĐÚNG bộ doc_id mà `BATCH_GET_GLOBAL_ID` cần

```js
O.preloadDocIds(e, t = this.featureNeedsPreloadDocIds)      // ["inbox","comment","sendCommerceProduct","switchProfile","businessInboxComment"]
  → getFeatureHandlerClass("inbox") = ee
  → ee.preloadDocIds: loadDocIdsFromView({html, docNames:[Jt,Zt,rt,st], isLoadCompleted:()=>O.isFeatureReady("inbox")})
```
`rt`/`st` = `MessengerThreadlistWebGraphQLQuery` / `MessengerThreadlistQuery` — đúng 2 mã
`Ct.init()` đòi. `ot()` gộp 20 s (`timeout:2e4`), `isAllDocIdLoaded` chặn gọi lặp.

⇒ `PRELOAD_DOC_IDS` là lệnh **đúng và đủ** cho `BATCH_GET_GLOBAL_ID`.

### 20.4 Bỏ cờ chặn — trước đó lệnh chưa từng được gửi

`if (!window.__botfakeTryPreloadDocIds__) return false;` — không ai set cờ ⇒ dù §18 đã sửa
đúng tên lệnh, **lệnh vẫn chưa bao giờ được gửi**. Đã bỏ. Nay gửi **1 lần/page**
(`docPreloadSent` là `Set`), đúng tham số `{pageId, isBusiness, country}`, hạn 4 s.

### 20.5 Log nói theo phản hồi thật

| Phản hồi adapter | Câu log |
|---|---|
| `data.type` kết thúc `_FAILURE` | `extension TRẢ _FAILURE (nhiều khả năng Missing doc_id — Ct.init reject)` |
| `success:false, data:null` | `extension KHÔNG phản hồi trong 30 s (adapter hết hạn…)` |
| `success:true` nhưng list rỗng | `trả success nhưng không có data.threadsWithGlobalId (danh sách rỗng)` |

### 20.6 Bảng "đã phủ / còn nợ" sau §20

**Đã phủ:** tên 7 lệnh gửi ext (6 + PRELOAD) · hình dạng 5 response · `taskId` · timeout
30 s · `getErrorHandler` 5 mã · `findInternalMessage` 3 điều kiện · nguồn doc_id · ai cấp
`__ExtensionAdapter__`.

**Còn nợ (chưa chứng minh):**
1. **Sửa này chưa chạy lần nào trên máy thật.** Cần 1 lô log mới để biết `batch nạp ?/?`.
2. **570 ca ⚠ lô 08:32** vẫn chưa truy được nguồn — cần log xuất **ngay sau lượt chốt, trước F5**.
3. **`ensureDocIds` không chờ ext nạp xong** (chỉ gửi). Nếu `BATCH_GET_GLOBAL_ID` chạy ngay
   sau, ext vẫn có thể chưa nạp xong ⇒ batch rỗng lần 1. `isAllDocIdLoaded` + `ot()` 20 s làm
   khả năng này thấp nhưng **chưa đo được**.
4. Lỗi gốc *"ca khách chặn thật bị chốt ⚠"* **vẫn chưa sửa** — §20 chỉ sửa đường gid.

---

## 21. LOG 22/11 09:54 — W200.124 (8 572 chat) — XÁC NHẬN SỬA doc_id ĐÃ CHẠY

### 21.1 Bằng chứng sửa §18–§20 có tác dụng

```
[09:51:58] 🧩 [doc_id] đã gửi PRELOAD_DOC_IDS cho page 769625892902516
             (ext tự nạp [Jt,Zt,rt,st]; phản hồi adapter: không có success — bình thường…)
[09:51:58] 🧭 BATCH_GET_GLOBAL_ID 769625892902516: threadsWithGlobalId=250 · nạp mới=25
…
🧭 Chẩn đoán globalId: … batch nạp 25/250 mapping (lỗi 0) …
```

| Chỉ số | 30 log cũ (1.93.12↓) | log này (W200.124) |
|---|---|---|
| `BATCH_GET_GLOBAL_ID` | **0 lần chạy** | **250 mapping** trả về |
| `batch nạp` | `0/0` ở **17/17** log | `25/250` |
| câu `THIẾU doc_id ⇒ Missing` | 16 dòng | **0 dòng** |

⇒ Sửa tên lệnh + timeout 30 s + bỏ cờ chặn **đã chạy đúng**. Đây là lần đầu đường gid
hàng loạt hoạt động sau nhiều bản.

### 21.2 Lỗi gốc "ca khách chặn bị chốt ⚠" — ĐÃ ĐI ĐÚNG ĐƯỜNG

6 ca chặn thật (`Đậu Huyền`, `Trần Hương`, `Lệ Hoàng`, `Loan Nguyen`, `Châu Nguyễn`, `Mai Mủm Mỉm`):
```
⏳ API từ chối ((#551) không có mặt) — đang bù
🔎 chứng minh VẮNG MẶT (hội thoại không đổi sau lúc gửi) ⇒ bù an toàn
❌ bù Socket không được: Socket: FB từ chối nhận tin (khách hiện không có mặt / đã khóa nick)
```
Kết thúc **❌**, **KHÔNG** vào 🖐 CẦN GỬI TAY. `⚠ Không rõ` không còn ca `#551` nào.
→ Riêng nhóm `#551` (19 ca = 100 % ca `#551` của lô) **đã đúng yêu cầu**.

### 21.3 NHƯNG: 3 547 ca ⚠ **KHÔNG có một dòng nào trong sổ kiểm chứng**

| | số |
|---|---|
| khai báo | 8 572 |
| chat có ≥1 dòng trong sổ | **5 025** |
| `8 572 − 5 025` | **3 547** = đúng `⚠ Không rõ` |
| trong sổ: ✅ / ❌ / ⏳ / 🔎 / 🛟 | 5 006 / 47 / 33 / 19 / 1 |
| dòng `⚠` trong sổ | **0** |
| 2 000 dòng đầu 🖐 giao với sổ | **0 / 2 000** |

⇒ Nhánh `kind === 'uncertain'` trong `__botfakeTrackStatus__` **chỉ tăng bộ đếm và gọi
`noteManualResend`, không hề ghi sổ**. Mọi ca chốt ⚠ — dù từ ACK rejected, quá hạn ACK hay
bù không rõ — **biến mất khỏi sổ**.

**Đây chính là lý do câu hỏi treo từ lô 08:32 (570 ca ⚠) không thể trả lời** — không phải
thiếu log, mà log **không có dòng để tra**.

### 21.4 SỬA: ghi sổ ca ⚠ + lý do

`window.__botfakeTrackStatus__(convId, kind, reason)` — thêm tham số 3 (tuỳ chọn), chỉ để ghi sổ.
`auditPush('⚠', convId, '', 'chốt KHÔNG RÕ … · ' + reason)`.
Lý do đã nối ở 4 chỗ: API không rõ · quá 180 s chưa xác nhận nền · bù không rõ ·
Socket FB từ chối + ngân sách dò Ext ĐÓNG.

**Không đổi phán quyết, không thêm lệnh gửi.** Lô sau sẽ thấy `⚠` trong sổ.

### 21.5 Phát hiện phụ — dòng "qua cổng" của wave bị mất

Tổng `qua cổng` của 17 wave ghi trong log = **5 890 / 8 572** ⇒ thiếu 2 682. Không phải script
tính sai: khi xuất, một số dòng wave bị gộp/bỏ (log gọn 89 dòng). **Không kết luận gì từ chỉ số này.**

---

## 22. BẢN ĐỒ ĐỐI SOÁT EXTENSION 0.5.62 — CÒN GÌ CHƯA LÀM

### 22.1 Số liệu thật (sửa lại con số cũ)

Trước đây ghi "extension có 83 case". **Đếm lại chính xác:**

| | |
|---|---|
| `case"…"` trong toàn file | **86** |
| — trong đó KHÔNG thuộc switch adapter (2 case `GET`/`POST` của hàm `fetch`, 3 `INBOX/COMMENT/RATING`, 11 lịch hẹn) | **18** |
| **case THẬT của switch adapter** (offset 391 879 → 412 772) | **68** |
| script đang gửi | **7** |
| **chưa đối soát** | **61** |

### 22.2 Đã đối soát xong (7)

`REPLY_INBOX_PHOTO` · `UPLOAD_INBOX_PHOTO` · `SEND_COMMENT` · `MAKE_MESSENGER_LINK` ·
`BATCH_GET_GLOBAL_ID` · `GET_GLOBAL_ID_FOR_CONV` · `PRELOAD_DOC_IDS`

### 22.3 61 case chưa đối soát, theo nhóm

| Nhóm | Case | Có ảnh hưởng script? |
|---|---|---|
| **Gửi tin** | `SEND_PRIVATE_REPLY` `REPLY_INBOX_PRODUCT` `REACT_MESSAGE` `SEND_STICKER_COMMENT` `VALIDATE_SEND_IGD_INBOX` `REPLY_INBOX_FILE_ZALO_OA` | **KHÔNG** — script chỉ gửi text/ảnh |
| **Kiểm chứng lịch sử** | `LOAD_FACEBOOK_MESSAGES` `GET_FB_MSG` `GET_IMG_FROM_SHARED_ATTACHMENT` | **CÓ — ưu tiên** |
| **Link/thread** | `ENABLE_FIND_THREAD_BY_USERNAME` `GET_IG_CONTACT_ID` `GET_POST_ID_FROM_LINK` | CÓ (đường dò gid) |
| **Listener** | 11 case `LISTEN_*`/`STOP_*`/`PLZ_DONT_STOP_*` | KHÔNG (script không điều khiển listener) |
| **Trạng thái ext** | `CHECK_EXTENSION` `CHECK_EXTENSION_VERSION` `REPORT_EXTENSION_STATUS` `WAKE_UP` | CÓ (chẩn đoán "Ext không phản hồi") |
| **Comment** | `EDIT_COMMENT` `REMOVE_COMMENT` | KHÔNG |
| **Khác** | 30 case (sticker, profile, appointment, LINE, Zalo, crawl, ecommerce, routing, block…) | KHÔNG |

### 22.4 `LOAD_FACEBOOK_MESSAGES` — điểm chưa đối soát quan trọng nhất

```js
case"LOAD_FACEBOOK_MESSAGES": … new He(r.data).init()
  .then(({messages:I, globalId:y}) => { e.port.postMessage({type:"LOAD_FACEBOOK_MESSAGES_SUCCESS", …}) })

class He{ init(){ switch(this.platform){ case"facebook": … return this.loadFacebookMessages(); … } }
  async loadFacebookMessages(){
    O.isFeatureReady("loadMessages") || await He.preloadDocIds({pageId, isBusiness});   // ← nạp [Da,Sa]
    const e = await le(this.pageId), t = new J({pageId, base:e.base}), a = await this.getGlobalId();
    return { messages: (await t.graphqlbatch({batchName:"MessengerGraphQLThreadFetcher",
      graphqlQueries: this.getGraphqlQueries(a, this.before)}))[0].data.message_thread.messages.nodes,
             globalId: a };
  }
  async getGlobalId(){ if(this.globalId) return this.globalId;
    return new Ee({...}).init(); }        // ← TỰ dò gid nếu thiếu
}
```

**Điểm đáng giá:** lệnh này trả **cả `messages` LẪN `globalId`** trong MỘT lần gọi, và
`getGlobalId()` tự dò nếu thiếu. Đây là đường "lấy gid + kiểm chứng lịch sử" gộp.
Khác `GET_FB_MSG` (phải truyền `sendParams` + `replyMessage`, khớp 3 điều kiện).

**Chưa khai thác** — chưa đo được lợi/hại. KHÔNG sửa cho tới khi có số.

### 22.5 Nhánh tự-dò gid BÊN TRONG `sendInbox` + trần 35 s

```js
sendInbox(e){ … return new Promise(async (b,v) => {
    if (c === "facebook" && !i)                        // i = globalUserId
      return this.getGlobalUserId({pageId, threadId, threadKey, isBusiness,
                                   conversationUpdatedTime, customerName})
        .then(M => { Object.assign(e, {globalUserId:M}); this.sendInbox(e).then(b).catch(v); })
    const A = await this.buildSendParams(e); …
    const w = g ? ro(g) : "NO_TIMEOUT";
    if (w === null) return b({success:!1, retryReason:"execute task timeout"});   // ← CHƯA GỬI
```
với `ao = 35e3`, `Wc(task, e = ao - 5e3)` (mốc hết hạn 30 s), `ro()` trả số ms **còn lại**.

⇒ **`execute task timeout` = CHƯA GỬI**, đúng như đã ghi. NHƯNG: nhánh tự-dò có thể
tiêu hết 30 s ⇒ gửi sau đó bị `execute task timeout`. Script đã tự dò gid TRƯỚC khi gọi
`REPLY_INBOX_PHOTO` nên nhánh này chỉ chạy khi script gửi `globalUserId` rỗng.
**Chưa đo** bao nhiêu ca rơi vào đây.

### 22.6 LỖI THẬT MỚI — `onRejected` chỉ được truyền ở 1/6 chỗ gọi

Đây là gốc của **3 547 ca ⚠** (khớp chính xác số học log 22/11):

```
SOCKET ACK OK/rejected/no-ACK : 4715 / 3552 / 0
⚠ Không rõ                    : 3547
FB báo không nhận (đã đo)     : 5
3 552 − 5 = 3 547             ← KHỚP CHÍNH XÁC
```

⇒ Toàn bộ 3 547 ca ⚠ là **ACK rejected ở lần bắn ĐẦU**, không phải mất ACK, không phải quá hạn.

Gốc: `socketPublishSend(…, opts)` chỉ gọi `onRejected` khi được truyền:
```js
const onRejected = (opts && typeof opts.onRejected === 'function') ? opts.onRejected : null;
…
if (!lateMode && onRejected) { try { onRejected(); } catch (eRJ) { /* ignore */ } }
```
Nhưng 6 chỗ gọi `socketPublishSend` trong `sendViaSocket` thì chỉ **1** (đường bắn-nhả
lần đầu @5769) truyền `onRejected`. Ba chỗ còn lại truyền `opts` mà thiếu `onRejected`:
- @5380 `raw = …` (bắn lại lần 2)
- @5398 / @5416 gửi ảnh bù (`retryPhotoOnly*`)
- @5840 `rawSync` (đường ĐỒNG BỘ — lần bắn đầu của lượt nhỏ)

Hệ quả kép:
1. Cổng 🚫 @11445 (`socksProof==='absent' && isFbRejected`) không kích hoạt ⇒ ca ACK rejected
   chạy tiếp vào đọc lịch sử rồi chốt ⚠ **vào danh sách gửi tay** dù FB đã nói rõ khách không nhận.
2. Cổng @5326 (`isFbRejected && !apiRejected551` → chốt ❌, KHÔNG thử lần 2) không bao giờ chạy
   cho ca lần-1 ⇒ vẫn thử lần 2 vô ích.

**ĐÃ SỬA:** truyền `onRejected` ở cả 6 chỗ (xác nhận bằng grep: 6/6).
Chỉ BỎ lần thử lại chắc chắn hỏng + chốt ❌ thay ⚠ — **không thêm lệnh gửi nào**.

### 22.7 Còn nợ (chưa chứng minh)

1. Bản sửa §22.6 **chưa chạy lần nào** — cần log mới để thấy `⚠` giảm và `❌` tăng tương ứng.
2. `LOAD_FACEBOOK_MESSAGES` chưa đo — tiềm năng nhưng chưa có số.
3. 30 case "Khác" chưa đối soát (sticker/profile/appointment/LINE/Zalo/crawl/ecommerce).
   Script không dùng ⇒ rủi ro thấp, **không phủ định** là có ẩn ý.

---

## 23. Đối soát tiếp: `ENABLE_FIND_THREAD_BY_USERNAME` + `INCORRECT THREAD`

### 23.1 `ENABLE_FIND_THREAD_BY_USERNAME` — case chỉ SET một biến trong SW

```js
case"ENABLE_FIND_THREAD_BY_USERNAME":{const{pageId:_,isEnabled:g}=r.data;
  const I=`findThreadByUsername_${_}`; self[I]=g;
  e.port.postMessage({type:"ENABLE_FIND_THREAD_BY_USERNAME_DONE",isEnabled:g}); break}
```
Đọc ở `bn(pageId)`:
```js
const bn = n => { try { return self[`findThreadByUsername_${n}`] || !1 } catch { return !1 } };
```
Dùng ở `Ee.getGlobalIdFromInbox()`:
```js
!I && a && bn(this.pageId) && (I = x.find(w =>
    w.all_participants.edges.map(({node:S})=>S.messaging_actor.name).includes(a)),
  C.log("THREAD FOUND BY MATCHING USER NAME:", I));
```
⇒ Bật cờ = ext có thêm 1 nguồn dò **khớp `customerName` với tên người tham gia**.

**Đo được vì sao đáng bật** (log 22/11 09:54): `Ext trả không có gid 2` · `lần dò chưa ra 29`
· `gate bỏ Ext no-gid 29` · `15 ca "thiếu gid"` ⇒ 14 ca kết thúc
❌ `Không tìm được global_id để gửi` rồi `Không tìm thấy globalId thật cho Socket` = hết kênh.
Cả 4 nguồn trước (`Jt`, `Zt`, `rt/st`, `ge`-tìm-theo-tên) đều đã chạy và cùng không ra.

**Rủi ro và lớp chặn:** khớp theo TÊN có thể trúng NGƯỜI KHÁC nếu 2 khách TRÙNG TÊN.
Ext có 1 lớp: `isThreadCorrect(threadInfoToRecheck)` phải chứa đúng `threadId`, nếu không
`Ee.init()` reject `"INCORRECT THREAD"`. NHƯNG lớp đó **so `threadId`**, mà `threadId` có thể
bị chính bước dò **gán lại**:
```js
p = Ct.isAllActorArePage(u);
p ? this.threadId = u.page_comm_item.id || m || this.threadId
  : this.threadId ||= u.page_comm_item.id;
```
⇒ Không đủ tin để coi là an toàn tuyệt đối.

**ĐÃ SỬA:** bật `ENABLE_FIND_THREAD_BY_USERNAME` **chỉ khi `onFinderNull`** (cả 4 nguồn đã cạn),
**1 lần/page** (`nameSearchEnabled` Set). Đây là lệnh set-biến, **không gửi tin** ⇒ không thể sinh
tin trùng. Nếu ext trả gid SAI thì tin đi nhầm người — nên chỉ bật ở chỗ mà phương án thay thế
là **❌ mất tin**. Log rõ mỗi lần bật để đối chiếu.

### 23.2 `INCORRECT THREAD` bị gộp vào "ext im lặng"

```js
init(){ … const{success:r,globalId:s,threadInfoToRecheck:i} = await a, o = bn(this.pageId)===!0;
  if(this.convType==="INBOX" && !this.isThreadCorrect(i) && !o)
    return C.error(`FAIL TO GET GLOBAL ID --> INCORRECT THREAD ${this.threadId}, ${this.threadKey} VS ${i}`),
           t("INCORRECT THREAD");
  r ? e(s) : (C.error("FAIL TO GET GLOBAL ID"), t()) }
isThreadCorrect(e){ Array.isArray(e)||(e=[e]);
  return e.length===0 || e.every(t=>!t) || !this.threadId ? !1 : e.includes(this.threadId) }
```
Script cũ bỏ `d2.error` ⇒ không phân biệt được:
- ext **trả lời rõ** "tìm được thread nhưng threadId không khớp" (`INCORRECT THREAD`), và
- ext **không phản hồi** (adapter hết hạn).

Cả hai đều `finishExt(null)` ⇒ `gidStats.extUnknown++` và
`noteGidExtResult(extFinderRespondedNoGid, …)` ⇒ bộ đếm sức khoẻ làn Ext nhận ca "mù" sai.

**ĐÃ SỬA:** đọc `errStr2`, tách `gidStats.extIncorrectThread`, log riêng, và **KHÔNG bật
khớp-theo-tên cho ca này** — vì `isThreadCorrect` chính là lớp đang bảo vệ.
Thêm vào dòng chẩn đoán: `Ext trả không có gid N (trong đó INCORRECT THREAD M)`.

### 23.3 Đã kiểm, KHÔNG cần sửa

| Case | Kết luận |
|---|---|
| `WAKE_UP` | Chỉ ghi `pancx-last-heartbeat` sau ≥9 s. Script không cần gửi |
| `CHECK_EXTENSION` | `await Fs(), await ks(e)` — không trả `_SUCCESS`; script dùng `adapter.checkConnection()` là đúng lớp |
| `REPORT_EXTENSION_STATUS` | Echo `r.data`; script không dùng |
| `PREINITIALIZE_PAGES` | Nạp trước `le(pageId)` cho từng page, nghỉ 2–5 s. Chỉ là làm nóng |
| `GET_FB_MSG` | Đã đối soát §19.4 |
| `LOAD_FACEBOOK_MESSAGES` | Trả `{messages, globalId}` 1 lệnh; ghi nhận, chưa dùng (chưa có số) |

### 23.4 Còn nợ

`LOAD_FACEBOOK_MESSAGES` (tiềm năng gộp "gid + kiểm chứng" 1 lệnh) · `GET_IMG_FROM_SHARED_ATTACHMENT`
· `GET_IG_CONTACT_ID` · `GET_POST_ID_FROM_LINK` · 11 listener · 2 comment · 30 case "Khác".
Chưa case nào có bằng chứng script cần dùng.

---

## 24. `MAKE_MESSENGER_LINK` — 5 000 ms quá ngắn + đọc thiếu top-level

### 24.1 Lệnh này KHÔNG chỉ "tạo link" — nó DÒ GID

```js
case"MAKE_MESSENGER_LINK": … new k_({…, uiVersion:b, globalId:v, …}).init() …
k_.handleFacebook(){ const e = this.uiVersion || await za.get(this.pageId);
  switch(e){ case 1: case 2: case 5: return { link: … }        // KHÔNG có gid
             case 3: case 4: case 6: case 7:
               return this.getGlobalId().then(t => ({ link: `…selected_item_id=${t}`, globalId: t })) } }
k_.getGlobalId(){ return this.globalId ? Promise.resolve(this.globalId)
                                       : new Ee({…, convType:"INBOX", …}).init() }
```
Script gửi `uiVersion: 6` + `globalId: null` ⇒ **luôn** vào `Ee.init()`.
`Ee.init()` → `getGlobalIdFromInbox()` gồm tối đa:
1. `await le(this.pageId)` — nạp base page
2. `await ee.preloadDocIds({…})` — fetch HTML + bóc doc_id
3. `a.graphql(Jt, …)` — nguồn 1
4. `a.graphql(Zt, …)` + gọi đệ quy `r()` — nguồn 2
5. `this.findThread({…})` → `graphqlbatch(rt/st)` — nguồn 3
6. `this.getUserInboxByName(a)` → fetch HTML + `loadDocIdsFromView` — nguồn 4

⇒ **4 request graphql + 2 lần fetch HTML**, mỗi bước có nhịp/retry riêng.

### 24.2 ĐÃ SỬA: `timeout: 5000` → `14000`

5 000 ms chỉ đủ khi `this.globalId` đã có sẵn (nhánh `Promise.resolve`). Ca phải **dò thật** —
đúng nhóm khó cần nhất — gần như chắc chắn hết hạn ⇒ adapter trả `{success:false, data:null}`
⇒ script kết luận "không ra gid" **trong khi ext vẫn đang chạy**.

Trần theo hợp đồng adapter: `REPLY_INBOX_PHOTO ∉ u`
(`u = Set(["CONFIG_ROUTING_APP","CACHE_PAGES_ROUTING_APP"])`) ⇒ trần chung `l = 3e4`.
Chọn **14 000 ms**: đủ 2–3 lượt graphql (đo `HTTP fetch p50 1461 ms`) mà vẫn dưới trần chung.
Lệnh **chỉ đọc** (trả link + gid) ⇒ chờ lâu hơn **không thể** sinh tin trùng.

### 24.3 ĐÃ SỬA: đọc `globalId` top-level

Ext trả `{type, taskId, link, globalId}`; adapter app bọc `{success, data:n}` ⇒ `mlRes.data.globalId`
(đường cũ, đúng). Adapter riêng `__botfake` bọc phẳng `{success, globalId}` ⇒ phải đọc thêm
`mlRes.globalId`, và `link` cũng vậy. Thêm lọc chuỗi `"null"`.

### 24.4 Đã kiểm — KHÔNG cần sửa

| Lệnh | Lý do |
|---|---|
| `Z()` (chạy trước mọi case) | Bộ đếm `requestCount`; >10 thì reset + `Fs()` nạp lại base. Không đổi kết quả |
| `ae.startCheck(pageId, fn, a=!0, r=!1)` | ĐỔI PROFILE FB rồi mới chạy `fn` (`FIRST_TRY_DOING_TASK_WITHOUT_SWITCH_PROFILE` → thử ngay, lỗi mới đổi). Script đi thẳng `REPLY_INBOX_PHOTO` ⇒ đúng, không cần tự đổi profile |
| `GET_IMG_FROM_SHARED_ATTACHMENT` | Trả `url` ảnh trong tin chia sẻ. Script tự upload qua `/v1/contents` |
| `GET_IG_CONTACT_ID` | Chỉ cho IG (`findContactId(customerName)`). Script gửi Facebook |
| `GET_POST_ID_FROM_LINK` | Comment/post. Script không dùng |
| `VALIDATE_SEND_IGD_INBOX` | Kiểm tra quyền gửi IGD. Script không gửi IGD |
| `REPLY_INBOX_PRODUCT` `REACT_MESSAGE` `SEND_STICKER_COMMENT` `SEND_PRIVATE_REPLY` `REPLY_INBOX_FILE_ZALO_OA` | Kênh khác (sản phẩm/reaction/sticker/riêng/Zalo) — script chỉ gửi text + ảnh |

### 24.5 Cập nhật bảng phủ

| | trước §22 | sau §23–§24 |
|---|---|---|
| case thật của adapter | 68 | 68 |
| đã đối soát | 7 | **13** |
| còn lại | 61 | **55** |

13 case đã phủ: 7 case script gửi + `ENABLE_FIND_THREAD_BY_USERNAME` + `WAKE_UP` +
`CHECK_EXTENSION` + `REPORT_EXTENSION_STATUS` + `PREINITIALIZE_PAGES` + `GET_FB_MSG`.

---

## 25. `class Oc` (LISTEN_INBOX) — listener CHẾT + `/rescue_mode_inbox` chưa dùng

### 25.1 `this.ctx.loggedIn` KHÔNG BAO GIỜ ĐƯỢC GÁN — listener chết ngay dòng đầu

```js
class Oc{ constructor(e,t){ this.accessToken=e; this.page_id=t;
                               this.ctx={clientID: (Math.random()*2147483648|0).toString(16)} }
  start(){ this.currentlyRunning || this.startup() }
  async startup(e){ const a = await k("https://www.facebook.com/"+this.page_id+"/inbox/");
    … t.ctx.userID / t.ctx.dtsg / t.ctx.ttstamp / t.ctx.server_revision / t.ctx.client_revision /
      t.ctx.sync_sequence_id / t.ctx.sequence_id …
    t.reset(); t.listen(); }                       // ← KHÔNG gán ctx.loggedIn
  listen(e){ if(this.shouldStop || !this.ctx.loggedIn) return;   // ← luôn TRUE ⇒ thoát
    …graphqlbatch(Dc="MessengerGraphQLThreadlistFetcher", Tc="1890618264322526", {limit:10,…})… } }
```

**Đo trên toàn bộ file (412 772 byte):**
- `loggedIn` xuất hiện **1 lần duy nhất** — chính dòng `!this.ctx.loggedIn` trên.
- `loggedIn =` / `loggedIn=` ⇒ **0 lần**.

⇒ `this.ctx.loggedIn` là `undefined` ⇒ `!undefined === true` ⇒ `listen()` **return ngay lần gọi đầu**.
Listener INBOX của extension 0.5.62 **chưa bao giờ chạy**: không `graphqlbatch`, không
`handle_list_threads`, không `load_list_messages`, không `trigger_to_pancake`.

**Đây là lỗi của extension, không phải của script.** Script không thể sửa. Ghi nhận vì:
- mọi kỳ vọng "extension sẽ tự đẩy tin vào Pancake" trong các bản trước là **SAI CƠ SỞ**;
- nó giải thích vì sao chỉ có đường Socket + đọc lịch sử mới phát hiện được tin đã tới.

### 25.2 `/rescue_mode_inbox` — đúng đường cần, script chưa từng gọi

```js
async trigger_to_pancake(e){ const {url:t, headers:a} =
    Ne(this.accessToken, `/v1/pages/${this.page_id}/rescue_mode_inbox`);
  return await Ce(t, { message_ids: e }, {}, { headers:a }) }
```
Endpoint này bảo **Pancake kéo lại** các `message_id` (id tin trên FB) từ Facebook về hội thoại.
Do §25.1, extension **không bao giờ** gọi nó.

**ĐO ĐƯỢC vì sao script cần** (log 22/11 09:54):
- `ACK rejected 3 552` ⇒ `3 547 ca ⚠` với lý do `kiểm chứng: đọc 4 lần chưa thấy tin — GIỮ ⚠`
- đồng thời `HTTP không có gid 56` · `can_inbox=false 0/56` ⇒ yêu cầu gửi **đã tới Pancake**
- Nghĩa: yêu cầu gửi đi được, FB trả "không nhận", Pancake không hiển thị tin ⇒ script không
  phân biệt được "FB không nhận" với "FB ĐÃ nhận nhưng Pancake chưa kéo về".

**ĐÃ THÊM** `rescueInboxMessages(pageId, messageIds)`:
- chỉ dùng id THẬT: lấy `extMsgIdByConv[conv.id].messageId` — sổ ghi từ
  `REPLY_INBOX_PHOTO_SUCCESS` (`parseSuccessResponse → messageId = payload.actions[0].message_id`).
  **Không bịa id**; ca không có id thì không gọi.
- gọi **1 lần/ca**, chỉ ở chỗ đã `socksProof === 'absent'` (đọc 4 lần không thấy) và sắp bỏ cuộc;
- sau khi gọi, `confirmViaSnippet` lại 1 lần: thấy tin ⇒ `markDelivered` ✅ (không gửi thêm).
- **KHÔNG gửi tin, KHÔNG tạo tin** — chỉ bảo Pancake đọc lại từ FB ⇒ không thể sinh tin trùng.

**Hạn chế phải nói rõ:** đường này chỉ chạy cho ca **đã từng đi qua Extension và có `messageId`**.
Ca Socket thuần (phần lớn 3 547 ca ⚠) **không có id FB** ⇒ script vẫn không cứu được bằng đường này.
Muốn cứu nhóm đó phải có id FB từ Socket — hiện **chưa có**.

### 25.3 Phần chạy TRƯỚC `switch` — mọi lệnh bị xếp hàng tuần tự

```js
chrome.runtime.onConnect.addListener(function(n){ … let t = Promise.resolve();
  n.onMessage.addListener(async function(a){ …
    const s = r.data.type, i = Ns(tab.url), o = Mm.has(s),
          c = t.then(() => o ? Ac(n.sender, r.data.accessToken, r.data.cookieSession===!0) : null);
    t = c.catch(() => null);                       // ← MỌI lệnh xếp hàng SAU lệnh trước
    const l = await c;
    if(o){ if(!l && Gm.has(s)) return; r.data.accessToken = l }
    switch(s){ … } }) })
```
- `Mm = {LISTEN_WS, LISTEN_INBOX, LISTEN_IG_COMMENT, CRAWL_ARTICLE_ZALO_OA, SEND_COMMENT,
  REPLY_INBOX_PHOTO, LOAD_ECOMMERCE_PRODUCT, UPLOAD_MEDIA_TO_PANCAKE}`
- `Gm = {LISTEN_WS, LISTEN_INBOX, LISTEN_IG_COMMENT, CRAWL_ARTICLE_ZALO_OA}`

⇒ `REPLY_INBOX_PHOTO` ∈ `Mm` nhưng **∉** `Gm` ⇒ lấy token thất bại vẫn chạy (`accessToken = null`).
⇒ `GET_GLOBAL_ID_FOR_CONV` / `BATCH_GET_GLOBAL_ID` / `PRELOAD_DOC_IDS` / `MAKE_MESSENGER_LINK` /
`UPLOAD_INBOX_PHOTO` **∉ `Mm`** ⇒ KHÔNG qua `Ac` ⇒ đi ngay.
⇒ NHƯNG mọi lệnh đều bị **serialize** bởi `t = c`. Ở lô 8 572 chat, script bắn 192 lệnh song song
thì extension xử lý **tuần tự** ⇒ phần lớn thời gian chờ là xếp hàng, không phải xử lý.
Đây là lý do `Ext p90 0ms → timeout 7000ms` và đỉnh `Ext dò 4 (đỉnh 14)`.

**Không sửa** — script không điều khiển được hàng đợi nội bộ extension. Ghi nhận để đọc đúng
số đo: `Ext: Extension không phản hồi` phần lớn là **chờ hàng**, không phải ext chết.

### 25.4 Cập nhật bảng phủ

14 case đã đối soát: 7 case script gửi + `ENABLE_FIND_THREAD_BY_USERNAME` + `WAKE_UP` +
`CHECK_EXTENSION` + `REPORT_EXTENSION_STATUS` + `PREINITIALIZE_PAGES` + `GET_FB_MSG` +
`LISTEN_INBOX` (kèm `class Oc` + `/rescue_mode_inbox`).

---

## 26. `jc()` + `getErrorHandler()` — vì sao 3 547 ca ⚠ và ext KHÔNG bù ảnh

### 26.1 `jc = n => ![1545041].includes(n.error)` — ext tự coi `1545041` là lỗi

```js
jc = n => ![1545041].includes(n?.error);        // @24390, cách ao=35e3 đúng 58 byte
const Q = jc(H);                                 // H = parseFbRes(response)
switch (await this.getErrorHandler(a, H, I)) { … }
```
`jc(H) === false` ⇔ `H.error === 1545041`.

### 26.2 Bảng quyết định THẬT của `getErrorHandler`

```js
getErrorHandler(e, t, a) {                       // a = số lần thử
  const r = [1357004, 1545012, 1545006, 3252001, 1390008];
  if (t?.error === 1545012 && a === 1) return "retryUsingSocket";       // "FALLBACK REPLY BY WS"
  if (!t) return "restartInbox";
  if (t?.payload?.error_payload === true && ["instagram","instagram_official"].includes(this.platform) && !t.error)
      return "retryUsingSocket";
  if (r.includes(t.error))
      return this.checkCanReuploadPhotos(t) || t.error === 1545006
        ? (await this.isUploadBlocked(e) ? "reuploadPhotosByApi" : "reuploadPhotos")
        : (t.error === 3252001 || t.error === 1390008 ? "retryUsingSocket" : "restartInbox");
  return "cannotRetry";                          // ← 1545041 RƠI VÀO ĐÂY
}
```

| `error` | Nhánh | Hệ quả |
|---|---|---|
| `1545012`, lần 1 | `retryUsingSocket` | ext tự gửi lại bằng WS |
| `1357004` / `1545006` | `reuploadPhotos`, `3252001`/`1390008` → `retryUsingSocket` | bù ảnh 1 lần |
| `3252001`, `1390008` | `retryUsingSocket` | ext tự gửi lại |
| **`1545041`** | `cannotRetry` | **ext BỎ, không gửi lại, không bù** |
| mọi mã khác | `cannotRetry` | ext BỎ |

⇒ Bán kính ảnh hưởng đúng bằng **nguyên nhân 3 547 ca ⚠ của script**:
`ACK rejected 3 552 − FB-báo-không-nhận 5 = 3 547`.
`1545041` = ext **không** bù, script **không** bù ⇒ 3 547 ca là **chung một nguyên nhân**.

### 26.3 `jc` còn bị dùng làm điều kiện `restartInbox`

```js
case "restartInbox": {
  C.warning("FAIL TO SEND MESSAGE TO FACEBOOK --> RESTARTING INBOX NORMAL AND RETRY"),
  this.init(a, !0)
      .then(() => Q && Ze(t))     // Q = jc(H) ⇒ CHỈ gửi lại khi error !== 1545041
      .then(() => this.init(a))
      …
}
```
Với `1545041` thì `Q === false` ⇒ **không** `Ze()` (không gửi lại). Nhưng nhánh này
không tới được vì `1545041` đã ra `cannotRetry` ngay.

### 26.4 `Z()` — ext tự reset mỗi 11 lệnh

```js
Z = async () => { let n = await q.getItem("requestCount") || 0;
  n > 10 ? (await q.setItem("requestCount", 0), await Fs()) : await q.setItem("requestCount", ++n) }
Fs = async () => { for (let t of Object.keys(await so())) { let a = await k("https://"+t, {headers:{…same-origin…}});
    a ? (t === "www.facebook.com" && it.ctxFromHtml(a), e[t] = !0, await In(e)) : (e[t] = !1, await In(e)) } }
```
Cứ **11 lệnh** ext đi `GET https://www.facebook.com` … cho **mọi** host trong `so()`,
tuần tự. Ở lô 8 572 chat đây là chi phí ẩn cộng dồn — cộng với hàng đợi tuần tự (§25.3)
giải thích `Ext p90 0ms → timeout 7000ms`.
`REPLY_INBOX_PHOTO` **có** `await Z()` đầu case; `GET_GLOBAL_ID_FOR_CONV`/`BATCH_GET_GLOBAL_ID`/`MAKE_MESSENGER_LINK` **không**.

---

## 27. ĐÍNH CHÍNH §26.3 + gốc thật của `batch nạp 0/0`

### 27.1 ĐÍNH CHÍNH — §26.3 viết SAI

§26.3 đã viết: *"`1545041` ⇒ `Q === false` ⇒ không `Ze()` (không gửi lại)"*. **SAI.** Đọc đủ `sendInbox`:

```js
async sendInbox(e){ … const w = g ? ro(g) : "NO_TIMEOUT";
  if (w === null) return b({success:!1, retryReason:"execute task timeout"});   // ← hết hạn ⇒ KHÔNG gửi
  … const H = this.base.parseFbRes(V);
  if (this.isResponseSuccess(H,c)) b({success:!0, …});
  else { const Q = jc(H);
    switch (await this.getErrorHandler(a,H,I)) {
      case "retryUsingSocket":  return v({success:!1, canRetryUsingSocket:!0,
                                          retryReason:"blocked_3252001", fbErrorCode:H?.error});
      case "restartInbox":      this.init(a,!0).then(()=>Q&&Ze(t)).then(()=>this.init(a))
                                    .then(()=>this.sendInbox({...e,retry:1,retryReason:"restartInbox"}))…  // ← CÓ gửi lại
      case "reuploadPhotos":    … then(()=>this.sendInbox({...e,files:N,retry:1,…}))                     // ← CÓ gửi lại
      case "reuploadPhotosByApi": …                                                                      // ← CÓ gửi lại
      case "cannotRetry":  Q && Ze(t), v(…)                                                              // ← CÓ gửi lại nếu Q
    } } }
```

- `Ze(n)` = **reload DNR rules** (`GET {origin}/check_origin` → `Bs()` → `chrome.declarativeNetRequest.updateDynamicRules`),
  **KHÔNG** phải "gửi lại". §26.3 gọi nó là "gửi lại" là **SAI**.
- `cannotRetry` **vẫn gọi `sendInbox({...e,retry:1,…})`** khi `Q === true`.

⇒ **`1545041` là mã DUY NHẤT extension bỏ hoàn toàn**: nó ra `cannotRetry` (§26.2) **và**
`Q = jc(H) = false` ⇒ không gửi lại. Mọi mã khác đều được ext thử lại ít nhất 1 lần.
Điều này **củng cố** kết luận §26 (3 547 ca ⚠ chung một nguyên nhân) nhưng **cách giải thích cũ sai**.

### 27.2 GỐC THẬT của `batch nạp 0/0` — ext KHÔNG `await` `O.preloadDocIds`

```js
case "PRELOAD_DOC_IDS": { await Z();
  const { pageId:_, isBusiness:g } = r.data;
  O.preloadDocIds({ pageId:_, isBusiness:g }), q.setItem("country", r.data.country);
  break }                                    // ← KHÔNG `await`, KHÔNG `_SUCCESS`/`_FAILURE`
```
`O.preloadDocIds` là hàm async thật (class `Ll`):
```js
async preloadDocIds(e, t = this.featureNeedsPreloadDocIds) {
  let a = t.filter(r => !this.isFeatureReady(r)).map(r => this.getFeatureHandlerClass(r)) …;
  for (let r of a) await r.preloadDocIds(e) }
```
`featureNeedsPreloadDocIds = ["inbox","comment","sendCommerceProduct","switchProfile","businessInboxComment"]`;
`inbox` ⇒ `ee.preloadDocIds` ⇒ `GET business.facebook.com/latest/inbox/messenger?asset_id=…`
+ tải JS + bóc `[Jt, Zt, rt, st]` (mất **hàng giây**).

⇒ Ext `break` ngay ⇒ adapter `send` **hết hạn** rồi trả `{success:false, data:null}`.
Bản trước dùng **4 000 ms** rồi coi "hết hạn = đã nạp" và gọi `BATCH_GET_GLOBAL_ID` **ngay**:
```js
async init(){ if(!O.get(rt,st)) return Promise.reject(`Missing doc_id ${rt} or ${st}`); … }
```
⇒ `BATCH_GET_GLOBAL_ID_FAILURE` ⇒ **`batch nạp 0/0` ở MỌI log** — đúng dấu hiệu "chạy trước khi doc_id có".

**ĐÃ SỬA:**
- `PRELOAD_DOC_IDS` timeout **4 000 → 25 000 ms** (doc_id cache 5 h, nạp 1 lần/page).
- Tách bộ đếm `docIdStats.viaExtWaited` — hết hạn **KHÔNG** còn bị tính là "đã nạp".
- **In** `doc_id gửi N (chờ hết hạn M · gửi lỗi K)` vào dòng chẩn đoán. Trước bản này 3 bộ đếm
  `docIdStats.*` được thu thập rồi **không in ở đâu** ⇒ không thể biết lệnh nạp có được gửi hay chưa.

### 27.3 `Ct.init()` còn 2 điều kiện script CHƯA từng biết

```js
class Ct{ constructor({pageId, timeRangeMin, maxThreadCount}){ this.maxThreadCount = maxThreadCount || ul }  // ul=250
  async init(){ const e = new Date().getTime();
    if(!O.get(rt,st)) return Promise.reject(`Missing doc_id ${rt} or ${st}`);
    if(lr[this.pageId]) return Promise.reject("There is a running job");      // ← KHOÁ THEO PAGE
    lr[this.pageId] = !0;
    try { … for(;;){ let c = yn;                                 // yn = 50
        if(this.maxThreadCount && this.maxThreadCount - s < yn) c = this.maxThreadCount - s;
        const l = await this.getFacebookThreads(a, c);
        … if(l.length === 0){ i = "There's no thread left"; break }
        … if(d < this.timeRangeMin){ i = "Reach min time range"; break }
        a = d - 1 }
      return Object.entries(r).map(([c,l]) => ({...l, threadId:c}))   // [{threadId, globalId, updatedAt}]
    } finally { lr[this.pageId] = !1 } }
  extractGlobalId(e){ if(Ct.isAllActorArePage(e)) return [e.thread_key.other_user_id,
                        {globalId: e.thread_key.other_user_id, updatedAt: parseInt(e.updated_time_precise), isCustomerUsePageRole: true}];
    return [e.page_comm_item.id || e.page_comm_item.comm_source_id,
            {globalId: e.thread_key.other_user_id, updatedAt: parseInt(e.updated_time_precise)}] } }
```
- **"There is a running job"**: `BATCH_GET_GLOBAL_ID` gửi **song song** cho cùng page ⇒ chỉ lệnh
  đầu chạy, các lệnh sau **reject ngay** ⇒ `_FAILURE` ⇒ bị đếm là `batchFail`.
  Script đã có `batchGidPromises[pageId]` chống gọi trùng ⇒ **không cần sửa**, nhưng nay đã biết
  vì sao chỉ 1 lệnh/page có tác dụng.
- **`timeRangeMin: 0`** script gửi là **đúng** (`d < 0` không bao giờ xảy ra ⇒ đi hết trần 250).
- `maxThreadCount` không gửi ⇒ ext dùng `ul = 250`, mỗi lượt `yn = 50` ⇒ **5 lượt graphql**.
  Timeout 30 000 ms hiện tại là hợp lý (5 lượt × ~1–2 s + `le(pageId)` init).

### 27.4 `MAKE_MESSENGER_LINK` — `uiVersion` của script có thể SAI

```js
case"MAKE_MESSENGER_LINK": { await Z(); … R = L => { new k_({pageId, threadId, threadKey, isBusiness, uiVersion:b, globalId:v, …}) } }
class k_{ async handleFacebook(){ const e = this.uiVersion || await za.get(this.pageId);
  switch(e){ case 1: case 2: case 5: { const t = e===5 ? "web.facebook.com" : this.isBusiness ? "business.facebook.com" : "facebook.com";
                return { link: … } }        // ← CHỈ TRẢ link
             case 3: … case 4: … case 6: … case 7: …   // ← gọi getGlobalId() rồi trả {link, globalId} } } }
```
`za.get(pageId)` là **tự phát hiện** version. `uiVersion` script gửi = **cứng `6`** cho **mọi page**.
Với page là v1/v2/v5 thật, ext **bị ép** vào nhánh 6 ⇒ đi `Ee.init()` (≈4 graphql + 2 fetch HTML),
đó chính là vì sao 5 000 ms cũ không đủ và vì sao `MAKE_MESSENGER_LINK` hay hết hạn.
**Không sửa**: script không biết version thật của từng page, và gửi `uiVersion: undefined`
sẽ khiến ext tự dò `za.get()` — **cần đo** trước. Ghi nhận, không đổi (tránh đổi dựa trên giả định).

### 27.5 Các điểm ĐÃ ĐỐI SOÁT, KHÔNG cần sửa (có căn cứ)

| Điểm | Căn cứ |
|---|---|
| `UPLOAD_INBOX_PHOTO` bọc `ae.startCheck(pageId, D)` | `r` mặc định `!1` ⇒ lần đầu chạy **KHÔNG** đổi profile (`FIRST_TRY_DOING_TASK_WITHOUT_SWITCH_PROFILE`); chỉ khi lỗi mới đổi. Timeout 25 000 ms của script là đủ cho lần đầu. |
| `SEND_COMMENT` cũng bọc `ae.startCheck(pageId,_,!0,!0)` | `r = !0` ⇒ **đổi profile ngay từ lần đầu**, không trả `_SUCCESS` nếu đổi lỗi. Script **chưa tính** thời gian đó ⇒ nên nới timeout. **Chưa sửa**, xem §27.6. |
| `country` trong `PRELOAD_DOC_IDS` | `q.setItem("country", r.data.country)` — chỉ để ext nhớ nước; script fallback `'vn'`. Không ảnh hưởng doc_id. |
| `isBusiness` trong `PRELOAD_DOC_IDS` | `ee.makeInboxViewUrl(pageId, isBusiness)` — `isBusiness` **chỉ** đổi host, **và chỉ ở uiVersion 1\|2\|5** (`business.` vs `www.`). Case 3/4/6/7 **bỏ qua tham số này**. `false` của script là hợp lệ. |
| `REPORT_EXTENSION_STATUS` / `ks()` | `ks` chỉ tồn tại để ext **tự** post danh sách host; script không gửi ⇒ không ảnh hưởng. |
| `Z()` gọi trong `PRELOAD_DOC_IDS`/`UPLOAD_INBOX_PHOTO`/`REPLY_INBOX_PHOTO`/`SEND_COMMENT` | `sendInbox` **không** gọi `Z()`; `GET_GLOBAL_ID_FOR_CONV`/`BATCH`/`MAKE_MESSENGER_LINK` **không** gọi. Nên `GET_GLOBAL_ID_FOR_CONV` là lệnh **rẻ nhất** — dùng nó thay `MAKE_MESSENGER_LINK` để dò gid là đúng hướng. |

---

## 28. `success` KHÔNG có `messageId` = FB từ chối ngầm (ca thứ 3, trước đây gộp sai)

### 28.1 Hợp đồng thật (đọc đủ 2 hàm, không chỉ 1)

```js
// class se (base)
isResponseSuccess(e, t) { switch (t) {
  case "facebook":  return e && e.payload &&
      (e.payload.actions && e.payload.actions[0].message_id || e.payload.error_payload);
  case "instagram": return e && e.payload && e.payload.item_token } }

// class ee (InboxNormal)
parseSuccessResponse({response:e, platform:t, globalUserId:a, igThreadId:r}) { switch (t) {
  case "facebook": return e.payload.error_payload ? {}
                     : { messageId: e.payload.actions[0].message_id,
                         globalUserId: a, timestamp: e.payload.actions[0].timestamp };
  case "instagram": return { globalUserId: r } } }
```

**Đây là chỗ tinh tế đã bị bỏ qua:**

| FB trả | `isResponseSuccess` | `parseSuccessResponse` | Ext post |
|---|---|---|---|
| `payload.actions[0].message_id` có | `message_id` (truthy) | `{messageId, timestamp, …}` | `REPLY_INBOX_PHOTO_SUCCESS` **có** `messageId` |
| `payload.error_payload` | **`error_payload`** (truthy) | **`{}`** | `REPLY_INBOX_PHOTO_SUCCESS` **KHÔNG** `messageId` |
| không có cả hai | falsy | (không chạy) | `REPLY_INBOX_PHOTO_FAILURE` |

⇒ `error_payload` làm `isResponseSuccess` trả **truthy** ⇒ nhánh `if (this.isResponseSuccess(H,c))`
⇒ `b({success:!0, ...parseSuccessResponse(...)})` = `{success:true}` **rỗng ruột**.

**Đo trên log:** `ACK rejected 3 552` là số ca script thấy **không có ACK**; trong đó nhiều ca
Extension báo `success` **không có `messageId`** — vì `error_payload` đến từ **cùng** đường
Socket/FB `#551`. Từ 3 547 ca ⚠, script trước đây gộp nhóm này vào "chưa xác nhận" ⇒
**không ghi sổ "FB đã từ chối"** ⇒ ca đó bị tính vào "cần gửi tay" oan.

### 28.2 ĐÃ SỬA

`sendViaExtension` nay trả thêm cờ `extSuccessNoId`:
```js
const _extNoId = !_extMsgId;                     // _extMsgId = res.data.messageId
return { ok:false, sent:'maybe', sendBy:'extension', extClaimedSuccess:true,
         extSuccessNoId: _extNoId,
         error: _extNoId
           ? 'Extension báo success nhưng KHÔNG có messageId ⇒ FB trả error_payload (từ chối ngầm) — không có tin nào được tạo'
           : 'Extension báo success — CHƯA xác nhận tin đã tới (đang đọc lại lịch sử, không gửi lại)' }
```
Nhánh bù (`sendViaBu`) tách riêng **trước** nhánh `extClaimedSuccess` cũ:
```js
} else if (r && r.sent === 'maybe' && r.extClaimedSuccess && r.extSuccessNoId) {
  noteFbRejected(conv.id, 'Ext báo success nhưng không có messageId = error_payload ⇒ FB từ chối');
  __botfakeTrackStatus__(conv.id, 'fail');
  logFailGrouped(name, '… success nhưng KHÔNG có messageId ⇒ FB trả error_payload, KHÔNG có tin — không gửi lại', '❌', conv.id);
```
- Vẫn **đọc lại lịch sử** cho cả hai ca: `error_payload` là suy luận từ hợp đồng extension, chưa phải
  bằng chứng đo trên hội thoại. Thấy tin ⇒ lật ✅, **không gửi lại**. Chỉ ĐỌC ⇒ vô hại.
- Không đổi số lệnh gửi.

### 28.3 Hệ quả cho số học 3 547

`3 552 ACK rejected` nay tách được **3 nhóm nguyên nhân** thay vì 1:
1. `1545041` → ext `cannotRetry` + `jc=false` ⇒ ext bỏ, **không** gửi lại (§26/§27).
2. `error_payload` → ext báo `success` nhưng **không** `messageId` ⇒ FB từ chối ngầm (§28).
3. `execute task timeout` → `Wc/ro` hết hạn (`ao = 35 000`, `Wc` đặt `ao − 5 000 = 30 000`)
   ⇒ `sendInbox` trả `{success:false, retryReason:"execute task timeout"}` **trước khi gửi**.

Cả 3 đều **không phải "khách chặn"** và đều **không có tin được tạo**. Nhóm 3 mới là nhóm
"chắc chắn chưa đi" — script đã xử lý đúng từ 1.93.10 (`retryReason` được đọc).

---

## 29. `LOAD_FACEBOOK_MESSAGES` — đọc lịch sử TRỰC TIẾP TỪ FB (đường còn thiếu)

### 29.1 Vì sao đây là mảnh ghép đúng của 3 547 ca ⚠

Mọi cổng "chứng minh vắng mặt" của script đều hỏi **Pancake**:
```js
GET {apiBase()}/v1/conversations/customer/{psid}?pages[{pageId}]=0      // snippet
```
Đường đó chỉ đúng khi **Pancake đã đồng bộ tin từ FB về**. Khi FB đã nhận mà Pancake chưa kéo
về thì snippet nói `absent` **SAI** ⇒ (nếu còn kênh) bù ⇒ khách nhận 2 tin; (nếu hết kênh) giữ ⚠
oan. Đó đúng là nhóm `ACK rejected 3 552 − FB-báo-không-nhận 5 = 3 547`.

### 29.2 Hợp đồng thật của `class He` / case `LOAD_FACEBOOK_MESSAGES`

```js
case"LOAD_FACEBOOK_MESSAGES": {                       // @400xxx
  r.data.platformExtraInfo?.linked_fb_page && (r.data.pageId = r.data.platformExtraInfo.linked_fb_page),
  r.data.platform != "instagram_official" && (r.data.customerName = void 0),
  await Z();
  const { taskId } = r.data;
  new He(r.data).init()
    .then(({ messages, globalId }) => e.port.postMessage({ type:"LOAD_FACEBOOK_MESSAGES_SUCCESS",
                                                            taskId, messages, globalId }))
    .catch(() => e.port.postMessage({ type:"LOAD_FACEBOOK_MESSAGES_FAILURE", taskId }));
  break }

class He { constructor({pageId, threadId, threadKey, isBusiness, before, platform,
                        customerName, conversationUpdatedTime, globalUserId}) { … }
  init(){ switch(this.platform){ case "facebook": case "": case null: return this.loadFacebookMessages();
                                 case "instagram_official": return this.loadIgMessages() } }
  async loadFacebookMessages(){
    O.isFeatureReady("loadMessages") || await He.preloadDocIds({pageId, isBusiness});
    const e = await le(this.pageId), t = new J({pageId, base:e.base});
    const a = await this.getGlobalId();                        // ← TỰ LẤY gid
    return { messages: (await t.graphqlbatch({ batchName:"MessengerGraphQLThreadFetcher",
               graphqlQueries: this.getGraphqlQueries(a, this.before) }))[0]
               .data.message_thread.messages.nodes,
             globalId: a } }
  async getGlobalId(){ if(this.globalId) return this.globalId;
    let e = to(this, ["pageId","threadId","threadKey","isBusiness","conversationUpdatedTime"]);
    return Object.assign(e,{postId:null,convId:null,convType:"INBOX"}), new Ee(e).init() }
  getGraphqlQueries(e,t){ const a = O.get(Da,Sa); if(!a) throw `Missing doc_id ${Da} or ${Sa}`;
    return [{doc_id:a, query_params:{id:e, load_messages:!0, message_limit:40, before:t}}] } }
```

**Cấu trúc node trả về** (đọc từ `He.findInternalMessage` — dùng chính phép so sánh của ext):
```js
{ timestamp_precise: "<ms>",                 // parseInt(m.timestamp_precise/1e3) == giây
  message_sender: { id },                    // id người gửi (page id khi page gửi)
  message: { text },                         // nội dung
  blob_attachments: [{ preview: { uri } }] }
```
Khác hẳn Pancake: **không** `inserted_at` ISO, **không** `from.id`, **không** `type`, **không** `attachments`.

### 29.3 ĐÃ THÊM

`fetchFbMessagesDirect(conv)` — gửi `LOAD_FACEBOOK_MESSAGES` với `platform:'facebook'`,
`convType:'INBOX'`, `timeout: 20000`, cache 8 s theo `pageId|threadId` (chống gửi trùng trong 1 cửa sổ).

`fbMessagesVerdict(msgs, pageId, want, photo, sentAtMs)` — phân xử theo **đúng trường của `He`**:
- `timestamp_precise` chia `1e3` rồi `parseInt` (đúng phép của ext), cửa sổ `[at+skew−5 s, at+skew+120 s]`;
- chỉ nhận tin **do page gửi** (`message_sender.id === pageId`);
- khớp chặt: `text.trim()` bằng, hoặc `normalizeMsgText` bằng; "chứa" chỉ khi chuỗi ≥ 20 ký tự;
- ca ảnh: `blob_attachments[].preview.uri` so tên tệp;
- thiếu trường ⇒ `'unknown'` — **không** suy ra `'absent'` từ "không khớp".

Nối vào `probeBuVerdict`: Pancake nói chưa thấy ⇒ hỏi thẳng FB **1 lần**; thấy tin ⇒ `'yes'`
⇒ **HỦY bù** (đây chính là ca chặn được tin trùng). Không thấy ⇒ giữ nguyên phán quyết của snippet.

**Lợi ích kép:** phản hồi còn có `globalId` (chính là kết quả `Ee.init()` — 4 nguồn `Jt/Zt/rt-st/ge`).
Script **đã trả giá cho lệnh này rồi** ⇒ lưu luôn vào sổ gid qua `window.__botfakeSaveGid__`,
khỏi dò lại bằng `GET_GLOBAL_ID_FOR_CONV` (đắt hơn) hay `MAKE_MESSENGER_LINK` (đắt nhất).
Đây là câu trả lời cho `HTTP không có gid 56` — không cần `ENABLE_FIND_THREAD_BY_USERNAME`
(chỉ khớp theo TÊN) khi đã có đường này.

### 29.4 Chẩn đoán mới (IN RA, không thu thập suông)

`· đọc thẳng FB: tin N · gid M · cứu K`
- `cứu K > 0` ⇒ Pancake nói "chưa thấy" nhưng FB **có** tin ⇒ không có đường này thì đã bù ⇒
  khách nhận **2 tin**. Đây là thước đo trực tiếp của §28/§25.2.
- `gid M > 0` ⇒ số gid lấy được **miễn phí** từ đường đọc này.

**Ràng buộc phải nhớ:** `He.getGraphqlQueries` cần `[Da, Sa]` — **KHÔNG** cùng bộ với
`[Jt,Zt,rt,st]` của `BATCH_GET_GLOBAL_ID`. Nên `PRELOAD_DOC_IDS` (§27) nạp `inbox` **không**
bảo đảm `loadMessages` sẵn sàng; ext tự gọi `He.preloadDocIds` khi chưa ready
(`O.isFeatureReady("loadMessages")` = `has(Da) || has(Sa)`). Nếu thiếu ⇒ reject `Missing doc_id`
⇒ trả `null` ⇒ **không ảnh hưởng phán quyết cũ**.

---

## 30. BẢNG PHỦ ĐÚNG THỰC TẾ — 9/9 lệnh đã đối soát (không phải 14/68)

### 30.1 Đính chính cách đếm trước đây

Bảng cũ ghi "14/68 case đã đối soát". **Sai cả tử số và mẫu số**, vì nó đếm cả tên xuất hiện
trong **chú thích**. Đếm đúng (`grep "type: *'X'"` = lệnh thật sự gửi):

| Số | Lệnh script GỬI | Trạng thái |
|---|---|---|
| 1 | `PRELOAD_DOC_IDS` | ✔ §27 — sửa timeout 4 000 → 25 000 (ext không `await`) |
| 2 | `BATCH_GET_GLOBAL_ID` | ✔ §27.3 — 2 điều kiện `Ct.init` (`Missing doc_id`, `"There is a running job"`), `timeRangeMin:0` đúng |
| 3 | `GET_GLOBAL_ID_FOR_CONV` | ✔ trả `globalId` **top-level**; rẻ nhất (không `await Z()`) |
| 4 | `REPLY_INBOX_PHOTO` | ✔ §26/§28 — `jc`/`getErrorHandler`, `success` không `messageId` = `error_payload` |
| 5 | `MAKE_MESSENGER_LINK` | ✔ §27.4 — `uiVersion:6` cứng ⇒ luôn đi `Ee.init()`; timeout 14 000 |
| 6 | `UPLOAD_INBOX_PHOTO` | ✔ `ae.startCheck(_,D)` với `r=!1` ⇒ lần đầu KHÔNG đổi profile |
| 7 | `SEND_COMMENT` | ✔ `ae.startCheck(_,_,!0,!0)` ⇒ đổi profile ngay; script đã để 35 000 ms |
| 8 | `ENABLE_FIND_THREAD_BY_USERNAME` | ✔ §25 — `self["findThreadByUsername_"+pageId]`, đọc bởi `bn()` |
| 9 | `LOAD_FACEBOOK_MESSAGES` | ✔ §29 — MỚI dùng; chuẩn hoá cách đọc + lấy gid miễn phí |

⇒ **9/9 = 100% lệnh script gửi đã đối soát với `0.5.62_0/assets/background.js`.**

**56 case còn lại: script KHÔNG gửi một lệnh nào trong số đó** (grep `type: 'X'` = 0). Đó không
phải "chưa đối soát" mà là **không dùng** — gồm LINE/Zalo/appointment/comment-edit/sticker/
product-pin/crawl. Riêng nhóm `LISTEN_WS`/`LISTEN_INBOX`/`STOP_LISTEN_*`/`PLZ_DONT_STOP_*` là
**extension tự chạy**, script không điều khiển; và theo §25.1 luồng đó **đang chết**
(`ctx.loggedIn` không bao giờ được gán).

### 30.2 Điều KHÔNG chứng minh được (phải nói rõ)

- **Không đọc được** `chrome.storage.local` của extension từ trang ⇒ không thể kiểm `doc_id`
  đã nạp hay chưa; chỉ biết qua phản hồi `BATCH_GET_GLOBAL_ID`.
- **Không biết `uiVersion` thật** của từng page (ext tự dò `za.get(pageId)`); script gửi cứng 6.
- **Không có `messageId` của FB** cho ca gửi bằng Socket ⇒ `/rescue_mode_inbox` (§25.2) chỉ áp
  dụng được cho ca đã đi qua Extension.
- **`LOAD_FACEBOOK_MESSAGES` cần `[Da,Sa]`** — bộ doc_id KHÁC `[Jt,Zt,rt,st]`; nếu ext chưa nạp
  thì lệnh reject `Missing doc_id`, script trả `null` và giữ phán quyết cũ (không sai thêm).

---

## 31. BỎ `uiVersion: 6` CỨNG — ext TỰ DÒ (sửa §27.4)

### 31.1 Bằng chứng

```js
class k_{ async handleFacebook(){ const e = this.uiVersion || await za.get(this.pageId);
  switch(e){ case 1: case 2: case 5: { const t = e===5 ? "web.facebook.com"
                                                 : this.isBusiness ? "business.facebook.com" : "facebook.com";
              return { link: … } }                              // ← CHỈ TRẢ LINK, không cần gid
            case 3: case 4: case 6: case 7: … getGlobalId().then(t => ({link, globalId})) } } }
```
`za` = `self.PageFacebookUIVersion` (class `Jc`):
```js
async get(e){ const a = await this.retrieveFromStorage(e); return a ? Promise.resolve(a)
                : new Xc({pageId:e}).init().then(async s => await this.set(e, s)) }
const mn = "fb_ui_version", Yc = 1;          // cache TTL: wl = 6048e5 = 7 ngày
makeUrl(e){ switch(e){ case 1: `https://www.facebook.com/${pageId}/inbox`
                       case 2: `https://business.facebook.com/…`
                       … case 7: `https://business.facebook.com/latest?asset_id=${pageId}` } }
```

### 31.2 Vì sao đó là lỗi

Script cũ gửi **cứng `uiVersion: 6`** cho **mọi page**.

| Page thật là | Gửi cứng 6 ⇒ ext chạy | Đúng ra |
|---|---|---|
| 1 / 2 / 5 | nhánh **6** ⇒ `Ee.init()` = ~4 graphql + 2 fetch HTML | **chỉ ghép chuỗi link** (0 request) |
| 3 / 4 / 6 / 7 | nhánh 6 ⇒ `Ee.init()` | `Ee.init()` — **đúng** |

⇒ Page là 1/2/5 bị ép vào nhánh **nặng nhất** dù không cần gid. Kết hợp với hàng đợi tuần tự
(§25.3) và `await Z()` (§26.4, cứ 11 lệnh ext đi `GET https://www.facebook.com` cho mọi host),
đây là một phần của `Ext p90 0ms → timeout 7000ms` và `MAKE_MESSENGER_LINK` hay hết hạn.

### 31.3 ĐÃ SỬA

Bỏ hẳn trường `uiVersion` khỏi payload `MAKE_MESSENGER_LINK`:

```js
adapter.send({ type: 'MAKE_MESSENGER_LINK', pageId, convId, threadId,
               /* KHÔNG uiVersion — ext tự dò `za.get(pageId)` */
               globalId: null, conversationUpdatedTime, customerName, platform: 'facebook' }, { timeout: 14000 })
```
- `uiVersion` = `undefined` ⇒ `this.uiVersion || await za.get(this.pageId)` ⇒ ext **tự dò** đúng version.
- `za.get()` có cache 7 ngày ⇒ chi phí dò chỉ 1 lần/page, không phải mỗi lệnh.
- `globalId: null` giữ nguyên ⇒ ext dò gid khi nhánh cần.
- Lệnh này **CHỈ ĐỌC** (tạo link / dò gid) ⇒ không thể sinh tin trùng.

**Test khoá:** `[ext] MAKE_MESSENGER_LINK KHÔNG gửi cứng uiVersion` — để không ai thêm lại.
`npm test`: **384 kịch bản** (373 → 383 với 10 test `fbMessagesVerdict` → 384 với test này).

---

## 32. `conversationUpdatedTime` là CON TRỎ LÙI, không phải mốc lọc — `Date.now()` làm MẤT nguồn gid ③

### 32.1 Chuỗi lan truyền (đọc đủ 3 tầng)

```js
// ① script gửi
payload.conversationUpdatedTime = rawUpd ? Date.parse(rawUpd + 'Z') : Date.now()   // ← chỗ sai

// ② extension: Ee.getGlobalIdFromInbox(), NGUỒN ③
if (O.get(rt,st) && (this.threadId || this.customerName)) {
  const u = await this.findThread({ customerName: this.customerName, threadId: this.threadId,
                                    graphQLInstance: a,
                                    timeCursor: this.conversationUpdatedTime + 6e4 }); }

// ③ extension: findThread({ threadId, customerName, graphQLInstance, timeCursor, count=0, category="main" })
const { threadId:t, customerName:a, graphQLInstance:r, timeCursor:s, originTimeCursor:i=s, count:o=0, … } = e;
const u = await r.graphqlbatch({ batchName:"MessengerGraphQLThreadlistFetcher",
  graphqlQueries:[{ doc_id: O.get(rt,st),
    query_params:{ limit: Cn /* =20 */, tags:f /* ["INBOX"] */, before: s, … } }] });
```

⇒ `conversationUpdatedTime + 6e4` trở thành **`before`** của danh sách thread. Đó là **con trỏ lùi**
(vị trí bắt đầu duyệt từ cũ về mới), **không** phải mốc để lọc.

| `conversationUpdatedTime` gửi đi | `before` | Danh sách thread | `findThread` |
|---|---|---|---|
| `updated_at` thật (ms) | `updated_at + 60 s` | các thread CŨ hơn mốc đó — **đúng** | tìm thấy |
| `Date.now()` khi thiếu mốc | **bây giờ** | chỉ thread MỚI hơn "bây giờ" ⇒ **rỗng** | `null` |
| lùi 1 ngày | `bây giờ − 24 h` | **rộng hơn** cần thiết — vẫn tìm thấy | tìm thấy |

### 32.2 Bằng chứng từ app THẬT (`_app-…v6.js`)

**7/7** chỗ app gửi `conversationUpdatedTime` đều `Date.parse(updated_at + "Z")`, **không** có
fallback về giờ hiện tại:

| @offset | Lệnh | Biểu thức |
|---|---|---|
| 866537 | `LOAD_FACEBOOK_MESSAGES` | `Date.parse("".concat(t.updated_at,"Z"))` |
| 889965 | `REACT_MESSAGE` | `Date.parse(inserted_at+"Z")`, `Date.parse(updated_at+"Z")` |
| 891666 | (block user helper) | `Date.parse("".concat(n.updated_at,"Z"))` |
| 892886 | `BLOCK_FACEBOOK_USER` | `Date.parse("".concat(r.updated_at,"Z"))` |
| 894440 | `MAKE_MESSENGER_LINK` | `Date.parse(updated_at+"Z")`, `uiVersion: n.facebookUiVersion \|\| 6` |
| 895529 | `GET_PROFILE_LINK` | `Date.parse("".concat(f.updated_at,"Z"))` |
| 961519 | (dò gid) | `Date.parse("".concat(t.updated_at,"Z"))` |

App có `updated_at` trong mọi bản ghi hội thoại ⇒ **không cần** fallback. Script thì có nhánh
thiếu mốc (dữ liệu lấy từ nhiều nguồn khác nhau) ⇒ phải có phương án, nhưng phương án
`Date.now()` là **phương án sai chiều**.

### 32.3 ĐÃ SỬA (4 chỗ)

| Chỗ | Trước | Nay |
|---|---|---|
| `updMs` (@4225) | `: Date.now()` | `isNaN ⇒ Date.now() − 864e5` + đếm `gidStats.updMissing` |
| `finderPayload.conversationUpdatedTime` | `isNaN(updMs) ? Date.now() : updMs` | `updMs` (đã xử lý tại nguồn) |
| `MAKE_MESSENGER_LINK.conversationUpdatedTime` | `isNaN(updMs) ? Date.now() : updMs` | `updMs` |
| `REPLY_INBOX_PHOTO.conversationUpdatedTime` | `isNaN(t) ? Date.now() : t` | `isNaN ⇒ Date.now() − 864e5` + đếm |
| `fetchFbMessagesDirect` (§29) | `… \|\| Date.now()` | parse + `isNaN ⇒ Date.now() − 864e5` |

Đồng thời sửa cách parse: `Date.parse(raw + 'Z')` **mù** sẽ sai khi chuỗi đã có `Z`/offset
⇒ nay kiểm `/[zZ+]|\+\d{2}:?\d{2}$/` trước khi thêm `Z` (đúng như `updMs` vẫn làm).

**Lùi 1 ngày là chiều AN TOÀN:** `before` lùi ⇒ danh sách thread **rộng hơn** ⇒ chỉ **lấy thêm**,
không bao giờ **cắt mất** thread cần tìm. Ngược lại tiến về tương lai ⇒ **mất** thread ⇒ mất gid.

**Chẩn đoán mới:** `· thiếu updated_at N ca (mốc phải lùi 1 ngày)` — nếu N lớn thì nguồn dữ liệu
đang thiếu `updated_at` và đây chính là nhóm dễ mất nguồn gid ③ nhất.

**Test khoá:** 3 kịch bản `(K)` — không còn `conversationUpdatedTime: isNaN(updMs) ? Date.now()`,
có `Date.now() - 864e5`, có `updMissing`. `npm test`: **387**.

---

## 33. `sync_missing_thread_id` — đường cứu khi hội thoại THIẾU `thread_id` (có bằng chứng HAR)

### 33.1 Vì sao thiếu `thread_id` là chí tử

`Ee.getGlobalIdFromInbox()` có 4 nguồn, và **3 nguồn đầu đều đòi `threadId`**:

| Nguồn | Điều kiện chạy | Thiếu `threadId` |
|---|---|---|
| ① `Jt` = `PagesManagerInboxAdminAssignerRootQuery` | `O.get(Jt) && this.threadId` | **không chạy** |
| ② `Zt` = `PagesManagerInboxQueryUtilCommItemHeaderMercuryQuery` | `O.get(Zt) && t.cquick_token && this.threadKey` | **không chạy** |
| ③ `findThread` (`rt`/`st`) | `O.get(rt,st) && (this.threadId \|\| this.customerName)` | chạy nhưng chỉ còn `customerName` ⇒ dễ `INCORRECT THREAD` |
| ④ `getUserInboxByName` (`ge`) | `customerName && bn(pageId)` | phải bật cờ khớp-theo-TÊN |

⇒ Hội thoại **không có `thread_id`** thì ① và ② chết hẳn, ③ suy yếu, ④ là giải pháp tạm
(chỉ khớp **tên**, rất dễ sai người). Đây đúng là nhóm `HTTP không có gid 56` /
`Ext trả không có gid` / 14 ca *"Không tìm được global_id để gửi"*.

### 33.2 App thật có sẵn đường sửa — và HAR chứng minh nó chạy thật

```js
// _app-…v6.js @985925
let eF = …(e /*pageId*/, t /*convId*/, n) => {
  let { auth:{ accessToken: o } } = a();
  let n = await (0,T.Koh)("https://pages.fm/api/v1/pages/" + e
                          + "/conversations/" + t + "/sync_missing_thread_id?access_token=" + o);
  let a = null;
  if (n.success && n.thread_id) {
    a = n.thread_id;
    r(setThreadId({ pageId:e, conversationId:t, threadId:a, threadKey:n.thread_key }));
    p.Z.set(t, null);            // ← XOÁ cache gid của hội thoại (threadKey vừa đổi)
  }
  return a };
window.__syncMissingThreadId__ = eF;
```

**BẰNG CHỨNG THẬT — HAR `guisot.har`, 2 lần, HTTP 200:**
```
GET https://pancake.vn/api/v1/pages/898735919982398/conversations/
          898735919982398_28877217668608600/sync_missing_thread_id?
200 → {"success":true,"thread_id":"1474059909116660","thread_key":"t_1597054761634327"}
```
Trả **đúng 2 thứ** mà ①②③ cần: `thread_id` + `thread_key`.

### 33.3 ĐÃ THÊM

`syncMissingThreadId(pageId, convId)`:
- `GET {apiBase()}/v1/pages/{pageId}/conversations/{convId}/sync_missing_thread_id?access_token=…`;
- `access_token` = `getToken()` (cùng giá trị `cookie_session` script dùng cho mọi API khác);
- **1 lần/hội thoại/phiên** (`syncThreadIdTried` Set) — endpoint gọi xong là hội thoại đã có
  `thread_id` nên gọi lại vô nghĩa;
- trả `{threadId, threadKey}` hoặc `null`; **không throw**.

Nhánh trong vòng dò gid — đặt **ngay sau** `const raceTasks = []` (trước khi các nhánh gid đóng):
```js
if (!threadId) {
  raceTasks.push((async () => {
    const synced = await syncMissingThreadId(pageId, full?.id || conv.id);
    if (!synced) return null;
    full.thread_id = synced.threadId; full.thread_key = synced.threadKey;
    conv.threadId  = synced.threadId; conv.threadKey  = synced.threadKey;
    const rg = await resolveGlobalId(full, synced.threadId, _ck, conv, false, ctx);
    return (rg && /^\d+$/.test(String(rg))) ? String(rg) : null;
  })());
}
```

**3 điều dễ làm sai — đã tránh:**

1. **KHÔNG trả `threadId`**: `firstNonNull` coi mọi giá trị khác rỗng là **gid** ⇒ sẽ gửi sai người.
2. **KHÔNG chỉ `return null`**: các nhánh gid phía trên đã đóng với `threadId = ''`
   (chúng kiểm `if (… && threadId)`) ⇒ trả null không kích hoạt lại được gì. Phải **gọi lại**
   `resolveGlobalId` với `threadId` mới.
3. **Không đệ quy vô hạn**: `resolveGlobalId` không tự gọi lại chính nó (đã kiểm grep: 3 chỗ gọi,
   đều từ ngoài); lần 2 điều kiện `if (!threadId)` không còn đúng ⇒ nhánh này không lặp.

Chữ ký thật: `resolveGlobalId(full, threadId, cacheKey, convFromPsid, forceFind, ctx)` → trả
**string** hoặc **null** (không phải object).

**Chẩn đoán mới:** `· sync thread_id N cứu M`
- `N` = số ca được trả `thread_id` thật (mở lại nguồn ①②③);
- `M` = trong đó **có ra gid**. `M` là số ca đường này **cứu được thật**.

**Chỉ ĐỌC** (GET) ⇒ không thể sinh tin trùng.

---

## 34. ĐỐI SOÁT API PANCAKE (không phải adapter ext) — 12 HAR

### 34.1 Bảng endpoint theo lưu lượng thật trong 12 HAR

| Số lần | Method | Endpoint | Script dùng? |
|---|---|---|---|
| 537 | GET | `/v1/pages/{id}/avatar/{id}` | không (chỉ hiển thị) |
| 164 | POST | `/v1/pages/{id}/contents/facebook` | không (tạo bài) |
| 100 | GET | `/v1/pages/{id}/conversations` | không — script lấy danh sách từ DOM |
| **87** | POST | **`/v1/pages/{id}/conversations`** | không |
| **33** | POST | **`/v1/pages/{id}/check_inbox`** | ✔ @6945 — đúng `POST`, không body, `{"success":true}` |
| **33** | POST | **`/v1/pages/{id}/contents/touch`** | ✔ @6948 |
| 13 | POST | `/v1/conversations` | không — **tải danh sách chat** (`type=ALL,INBOX` / `UNREAD`) |
| 12 | POST | `/v1/logs/pancake_exception_log` | không |
| **28** | GET | **`/v1/pages/{id}/conversations/{convId}/messages`** | ✔ @2907/@3159/@11917 |
| **7** | POST | **`/v1/pages/{id}/customers/{custId}/update_global_id`** | ✔ @5546/@6392 |

### 34.2 `GET …/conversations/{convId}/messages` — đã khớp đúng

Query thật trong HAR:
```
?customer_id=9a3fa755-9be1-4181-9746-7cf1da15331a
&user_view=true&is_new_api=true&separate_pos=true
```
Script gửi **đủ 4 tham số** ở cả 3 chỗ (`@2907`, `@3159`, `@11917`). `separate_pos=true` và
`is_new_api=true` là bắt buộc — thiếu `is_new_api` thì API trả định dạng cũ (không có
`inserted_at`/`from.id` mà `historyVerdict` cần).

### 34.3 `POST …/customers/{custId}/update_global_id` — đã khớp đúng

Body thật (7/7 mẫu giống nhau):
```json
{"global_id":"100023175302671","conversation_id":"689375157595846_29617688761165549",
 "source":"send_inbox","version":1}
```
Script gửi đúng 4 trường đó ở **2 chỗ** (`@5550`, `@6396`), kể cả `source:'send_inbox'` và
`version:1`. `source` KHÁC ⇒ Pancake không gắn gid vào đúng luồng.

### 34.4 `POST …/{pageId}/conversations` (87 lần) — KHÔNG dùng, và đúng là không cần

Đây là endpoint **gửi tin của app**, body là `multipart/form-data` với `action=reply_inbox`.
Script dùng `POST …/conversations/{convId}/messages` (đường khác, cùng đích) và đã đối soát
theo 54 request `reply_inbox` trong HAR (§ trước: 19/19 có `is_record_ctx_7_days:true` ⇒
`success:true`; 24/24 thiếu cờ ⇒ `e_code 10 / e_subcode 2018300`).

⇒ **Không đổi.** Hai đường khác nhau, script đã chọn đường có bằng chứng đầy đủ hơn
(54 request có đối chứng nhân quả với `is_record_ctx_7_days`).

### 34.5 `POST /v1/conversations` (13 lần) — KHÔNG phải gửi tin

Body: `type = "ALL,INBOX"` / `"UNREAD"`, kèm `pages[...]=0` cho **13 page**. Đây là **tải danh
sách hội thoại** cho sidebar, trả `{conversations:[…], next_cursor}`. Script lấy danh sách chat
từ DOM của chính Pancake (đúng dữ liệu đó, không cần gọi lại) ⇒ không dùng là **đúng**.

### 34.6 `GET /v1/conversations/customer/{psid}` — script gửi 1 page, app gửi 13

HAR (`batmesss.har`, 2 mẫu): app gửi **13** `pages[...]=0` trong cùng 1 request; script gửi **1**.
**Không sửa:** snippet chỉ được dùng để đối chiếu **`convId` + `pageId` cụ thể**, nên 1 page là
đủ và trả ít dữ liệu hơn (nhanh hơn). Gửi 13 page sẽ nhận cả hội thoại của page khác ⇒
`absenceVerdict` phải lọc nhiều hơn, không có lợi ích.

### 34.7 `contents/touch` gửi `content_ids: []` — ĐÃ SỬA

HAR (`batmesss.har`):
```
POST /v1/pages/{p}/contents/touch?   {"content_ids":["f22adca4-cbdf-4957-b6b0-aae141840bb2"]}
→ {"success":true}
```
Script cũ gửi **mảng rỗng** ⇒ request chạy nhưng không "touch" nội dung nào ⇒ vô nghĩa.

**ĐÃ SỬA:**
- `buildInboxSend` trả thêm `contentIds` = `normalizePhotoItems(photo).map(x => x.id).filter(Boolean)`
  — chính id Pancake cấp cho ảnh, **đã có sẵn** trong `photo.items` (không tạo gì mới).
- `rememberTouchIds(pageId, ids)` gom theo page, **chỉ khi HTTP 2xx** (4xx/5xx ⇒ ảnh không lên
  ⇒ touch cũng vô nghĩa). Trần 500 id/page để không phình bộ nhớ ở lô 10 000.
- `postSendSideEffects({perPage:true})` đọc `touchIdsByPage[pageId]`; **không có id thì KHÔNG gọi**
  (thay vì gửi request rỗng).

**Test khoá (3 kịch bản `(L)`):** không còn `content_ids: []` (kiểm trên `stripComments` — chính
chú thích có nhắc chuỗi đó nên phải bỏ comment trước), có `touchIdsByPage`, có
`rememberTouchIds(pageId, req.contentIds)`.

`npm test`: **390**.

---

## 35. GỠ MÃ CHẾT + chứng minh `INCORRECT THREAD` là do THIẾU `thread_id`

### 35.1 Sửa lỗi của chính mình ở §33

Khối "nếu thiếu `threadId` thì gọi `sync_missing_thread_id`" đã được đặt **bên trong**
`resolveGlobalId` — nơi `threadId` là **tham số đã chốt lúc gọi**. Nó **chưa bao giờ chạy**:
`resolveGlobalId` chỉ được gọi khi phía ngoài đã có `threadId` (chỗ gọi kiểm `if (!ctx.gidResolved && ctx.threadId)`).

⇒ Đó là **mã chết**. Đã gỡ và thay bằng `ensureThreadId(full, conv, pageId)` khai báo **trước**
`resolveGlobalId`, gọi ở **cả 3** chỗ:
- `@5499` đường Socket
- `@6230` đường Extension
- `@8257` đường `prepareDirectCtx` (Redux)

### 35.2 `INCORRECT THREAD` là hệ quả TRỰC TIẾP của thiếu `thread_id`

```js
// Ee.init()
const { success: r, globalId: s, threadInfoToRecheck: i } = await a, o = bn(this.pageId) === true;
if (this.convType === "INBOX" && !this.isThreadCorrect(i) && !o)
    return C.error(`FAIL TO GET GLOBAL ID --> INCORRECT THREAD ${this.threadId}, ${this.threadKey} VS ${i}`),
           t("INCORRECT THREAD");
r ? e(s) : (C.error("FAIL TO GET GLOBAL ID"), t());

// isThreadCorrect(e){ return Array.isArray(e) || (e = [e]),
//   e.length === 0 || e.every(t => !t) || !this.threadId ? false : e.includes(this.threadId) }
```

| `threadId` | `threadInfoToRecheck` từ nguồn ④ | `isThreadCorrect` | `Ee.init()` |
|---|---|---|---|
| `''` (thiếu) | `undefined` | `e.length===0` ⇒ **false** | **reject `INCORRECT THREAD`** |
| `''` (thiếu) | `['x','y']` | `!this.threadId` ⇒ **false** | **reject `INCORRECT THREAD`** |
| có | `['x','y']` chứa threadId | `true` | trả `globalId` ✅ |

⇒ Hội thoại **thiếu `thread_id`** thì extension **vĩnh viễn** không trả được gid — **kể cả khi
nguồn ④ vừa tìm ra đúng thread**. Đó là lý do nhóm `INCORRECT THREAD` (`gidStats.extIncorrectThread`)
và nhóm "không có gid" trùng nhau rất nhiều: cùng một nguyên nhân gốc.

**Trước đây script chỉ thử `window.__syncMissingThreadId__`** (hàm của app). Nếu trang không
expose hàm đó (bundle khác version) thì **im lặng bỏ qua** — dù endpoint vẫn dùng được.
Nay `ensureThreadId` thử hàm app **trước**, không có thì gọi `syncMissingThreadId()` của script.

### 35.3 Test khoá (3 kịch bản `(M)`)

- `ensureThreadId` khai báo **trước** `resolveGlobalId` — chống tái phạm mã chết;
- `ensureThreadId` có **fallback** `syncMissingThreadId(pageId, cid)`, không chỉ hàm app;
- **≥ 3** chỗ gọi `ensureThreadId(full, conv, pageId)` (đủ 3 đường: Socket / Ext / Redux).

`npm test`: **393**.

---

## 36. Hợp đồng `noThreadIdFound` của app — script đang GỬI dù thiếu `thread_id`

### 36.1 App BỎ HẲN lệnh gửi khi thiếu `thread_id`

```js
// _app-…v6.js — executeByExtOnce
async executeByExtOnce(e){ … const w = this.payload.conversation, k = w.thread_id;
  if (k || (k = await eF(w.page_id, w.id)),                                  // ← SYNC nếu thiếu
      !k && !("instagram_official" === x && this.payload?.isIGD))
    return { success:!1, errorMessage:"noThreadIdFound" };                   // ← BỎ HẲN
  if (!await u.Z.checkConnection({silent:!0})) return { success:!1, errorMessage:"extensionDisconnected" };
  …
  let [S,C] = await this.concurrentlyGetGLobalId(x, w, k);                   // k = threadId vừa sync
  if (!C && !S) return { success:!1, error:"no_global_id_found" }; }

// executeByExtInChunks — y hệt
let s = t.thread_id; if (s || (s = await eF(t.page_id, t.id)), !s && …) return { success:!1, errorMessage:"noThreadIdFound" };
```

**3 điều script đã/đang làm khác app:**

| | App | Script (trước) | Nay |
|---|---|---|---|
| Thiếu `thread_id` khi gửi | **bỏ**, trả `noThreadIdFound` | **vẫn gọi** Extension với `threadId: null` | ✔ bỏ, trả `noThreadIdFound` |
| Nguồn `thread_id` | `eF(page_id, convId)` của app | chỉ thử `window.__syncMissingThreadId__` | ✔ `ensureThreadId` (hàm app → endpoint script) |
| Có `thread_id` rồi | **vẫn** gọi `eF` (vô điều kiện) | không gọi | giữ không gọi (**cố ý**: 1 request thừa/ca ở lô 10 000; app chạy 1 ca/lần người dùng) |

### 36.2 Vì sao "vẫn gọi" là sai chứ không phải "vô hại"

Gọi Extension với `threadId: null` tốn **1 lệnh** trong hàng đợi **tuần tự** của extension (§25.3)
⇒ đẩy chậm mọi lệnh khác của lô. Và nếu extension vẫn dò ra thread thì `Ee.init()` **reject
`INCORRECT THREAD`** vì `isThreadCorrect` trả `false` khi `!this.threadId` (§35.2) ⇒
script nhận **một lỗi trông như "sai thread"** thay vì sự thật **"chưa có thread_id"**.

### 36.3 ĐÃ SỬA

```js
if (!threadId) {
  gidStats.noThreadIdFound++;
  return { ok: false, sent: false, error: 'noThreadIdFound', noThreadIdFound: true };
}
```
Và thêm `noThreadIdFound` vào `isDefinitiveNotSent` ⇒ thuộc nhóm **"dứt khoát chưa gửi"**:
`sent:false` ở đây là **bằng chứng dương** (script tự bỏ lệnh **trước khi** gửi, không lệnh nào
tới ext) ⇒ không cần cổng chờ 10 s, được đi kênh kế ngay.

**Test khoá (2 kịch bản `(N)`):** có `noThreadIdFound: true`; và `isDefinitiveNotSent` phủ nó.
`npm test`: **395**.

---

## 37. `LOAD_FACEBOOK_MESSAGES`: app gửi SAI TÊN TRƯỜNG — script sửa thành `globalUserId`

### 37.1 Hợp đồng thật của `class He` (ext 0.5.62, @117423)

```js
class He{constructor({pageId, threadId, threadKey, isBusiness, before, platform,
                      customerName, conversationUpdatedTime, globalUserId:l})
  { this.globalId = l; … } }                                  // ← ext đọc `globalUserId`

async loadFacebookMessages(){
  O.isFeatureReady("loadMessages") || await He.preloadDocIds({pageId, isBusiness});
  const a = await this.getGlobalId();                          // = this.globalId NẾU có
  return { messages: (await t.graphqlbatch({batchName:"MessengerGraphQLThreadFetcher",
             graphqlQueries: this.getGraphqlQueries(a, this.before)}))[0]
             .data.message_thread.messages.nodes,
           globalId: a }; }

async getGlobalId(){ if (this.globalId) return this.globalId;   // ← DÙNG THẲNG nếu có
  let e = to(this, ["pageId","threadId","threadKey","isBusiness","conversationUpdatedTime"]);
  return Object.assign(e, {postId:null, convId:null, convType:"INBOX"}), new Ee(e).init(); }

getGraphqlQueries(e,t){ const a = O.get(Da,Sa);                  // ← doc_id KHÁC [Jt,Zt,rt,st]
  if (!a) throw `Missing doc_id ${Da} or ${Sa}`;
  return [{doc_id:a, query_params:{id:e, load_messages:!0, message_limit:40, before:t}}]; }
```

### 37.2 App thật gửi `globalId` — ext KHÔNG đọc, nên luôn dò lại

```js
// _app-…v6.js @866417
async function j({conversation:t, before:n, platform:a, customerName:r, platformExtraInfo:o}){
  if (!await l.Z.checkConnection({silent:!0})) return {success:!1, error:"extensionDisconnected"};
  const {data:i, success:s} = await l.Z.send({
    type:"LOAD_FACEBOOK_MESSAGES", pageId:t.page_id, threadId:t.thread_id,
    globalId: d.Z.get(t.id),                    // ← SAI TÊN: `He` chỉ đọc `globalUserId`
    before:n, platform:a, customerName:r,
    conversationUpdatedTime: Date.parse(`${t.updated_at}Z`), platformExtraInfo:o });
  return s ? {success:!0, data:i.messages} : {success:!1, error:"extensionFailure"}; }
```

⇒ `this.globalId === undefined` ⇒ `He.getGlobalId()` rơi xuống `new Ee({…convType:"INBOX"}).init()`
tức **đi trọn 4 nguồn dò gid** (Jt/Zt/findThread/getUserInboxByName). Với hội thoại thiếu
`thread_id` thì đó chính là ca `INCORRECT THREAD` (§35.2) ⇒ **app cũng hỏng ở đây**, không chỉ script.

### 37.3 ĐÃ SỬA (script nhanh hơn app ở đúng ca này)

```js
const gidForHe = (function(){ const g = peekFastGlobalId(conv, fullC, '');
  return (g && /^\d+$/.test(String(g))) ? String(g) : ''; })();
ad.send({ type:'LOAD_FACEBOOK_MESSAGES', pageId, threadId, threadKey, isBusiness:true,
          platform:'facebook', customerName,
          ...(gidForHe ? { globalUserId: gidForHe } : {}) }, { timeout: 20000 })
```
- Có gid trong sổ ⇒ gửi **đúng tên** `globalUserId` ⇒ `He.getGlobalId()` trả ngay ⇒ ext **bỏ hẳn**
  `Ee.init()` (tiết kiệm 1 lần dò 4 nguồn + 1 request `sync_missing_thread_id`).
- Chưa có ⇒ **không** gửi trường đó ⇒ ext tự dò y như app (không sai, không tệ hơn).
- `before` **không** truyền ⇒ `undefined` ⇒ 40 tin MỚI NHẤT (đúng thứ cổng chống lặp cần).
- Trường thừa (`threadKey/isBusiness/convType/postId/convId`): `He` không khai báo, ext case chỉ
  sửa `pageId` (IGD) + `customerName` ⇒ bị bỏ qua, vô hại.
- `_SUCCESS` trả `{messages, globalId}` ⇒ `res.data.globalId` vẫn là gid thật đã đọc từ §34.

Đếm mới: `gidStats.fbDirectGidSkippedResolve`.
**Test khoá (3 kịch bản `(O)`):** gửi `globalUserId`; **không** gửi `globalId:`; gid lấy từ sổ trước.

> Lưu ý phạm vi: nhánh này (`fetchFbMessagesDirect`) chỉ chạy trong cổng chứng minh vắng mặt
> (`probeBuVerdict`) — **0 lần** trong 31 log đã đo, nên đây là sửa ĐÚNG ĐẮN chứ không phải
> nguyên nhân của lỗi đang thấy. Ghi rõ để không ai kỳ vọng nó cải thiện số liệu lô ngay.

---

## 38. `GET_BUSINESS_WS_CONTEXT` + `LISTEN_WS`: KHÔNG thiếu lệnh — script đi ĐÚNG đường của app

### 38.1 `LISTEN_WS` là WS của **COMMENT**, không phải inbox

```js
// ext 0.5.62 @390432
Ba = new sr({ stopMessageType:"I_WANT_STOP_LISTEN",
              createInstance:n => new $a(n.accessToken, n.page_id),
              startInstance:n => n.init().then(() => n.loadPosts()) });
// class $a{ constructor(e,t){ … const a="CommentFb"; this.cachePostsKey=`${a}_${t}_posts`; …
//           async prepareCache(){ … } stop(){ … } }
```
`case"LISTEN_WS": Ba.start(…)` ⇒ mở **WS bình luận** (`CommentFb`, `loadPosts`).
Inbox là **`LISTEN_INBOX`** → `va = new sr({createInstance:n => new Oc(...), startInstance:n => n.start()})`.
⇒ Script **không dùng cả hai** và **không cần**: script không tự mở WebSocket nào
(`grep "new WebSocket\|wss://"` = 0) mà dùng `window.__MqttHelper__` của chính app.

### 38.2 `initSocket` của app TỰ đi qua `GET_BUSINESS_WS_CONTEXT` — script hưởng lây

```js
// _app-…v6.js @815899
async initSocket(e){ if (u.SOCKETS[f] && u.SOCKETS[f].instance.$10.isRunning()) return ok;
  let m = await (0,p.vk)(i.C1, {funcName:"getBusinessWSContext", from:"initSocket"}, e);
  if (m?.success && m.data?.response?.wsContext) { let t = m.data.response.wsContext;
    … new Socket({appId:parseInt(t.context.appId), assetIds:new Map([["PAGE",e]]),
                  deviceId:t.context.deviceId, endpoint:"wss://edge-chat.facebook.com/chat?region=pnb",
                  pageId:e, …}) } }
// ev = async(e,t,n) => { … c.Z.send({type:"GET_BUSINESS_WS_CONTEXT",
//        pageId:e, deviceId:t, forceReloadIfExpire:n}) … }        ← @900614
```
Ext trả: `GET_BUSINESS_WS_CONTEXT_SUCCESS{response:{success:!0, wsContext}}`
(`tc.getContext(pageId, deviceId||"")`), lỗi ⇒ `_FAILURE{response:{success:!1}}`.

**Script gọi `h.initSocket(pid)`** (warmUpSockets @9791, `ensureAliveSocket`) ⇒ app tự gửi
`GET_BUSINESS_WS_CONTEXT` ⇒ **script dùng gián tiếp đúng lệnh đó**. Gọi thẳng từ script sẽ là
lệnh **thứ 10** không cần thiết và **trùng** với lệnh app vừa gửi trong cùng một lần warm-up.
⇒ **KHÔNG thêm.** Test khoá để không ai "bổ sung cho đủ".

### 38.3 `checkConnection()` là hàm SYNC — đã kiểm, không sửa

```js
// _app-…v6.js module 715835
checkConnection(){ let {auth:{extension:t}} = __pancakeReduxStore__.getState(); …
  if (!t) { … return !1 }                                   // ← chưa có state extension
  let a = !0; for (var r in t) if (!t[r]) { a = !1; break }
  return !!a || (window.postMessage({type:"CHECK_EXTENSION", from:"WEBPAGE"}, "*"), …) }
```
App `await` ở phần lớn chỗ nhưng hàm **không `async`** ⇒ `await` vô hại; `!checkConnection(...)`
của script là **đúng**. Nhánh `!t` **không** gửi `CHECK_EXTENSION` (chỉ khi có state mà falsy mới gửi).

Bằng chứng đo: **0/31 log** có dòng "Extension Pancake chưa kết nối" ⇒ nhánh này không chạy thực tế.
Ghi nhận, **không sửa** (thêm `CHECK_EXTENSION` là thêm lệnh, không có ca nào cần).

---

## 39. Socket cũng phải BỎ khi thiếu `thread_id` + `syncThreadIdTried` không được cache vĩnh viễn

### 39.1 Thứ tự hợp đồng của app — áp cho CẢ 3 đường gửi

```js
// executeBySocketFB  @975143
async executeBySocketFB(){ … let w = x.thread_id;
  if (w || (w = await eF(x.page_id, x.id)), !w) return {success:!1, errorMessage:"noThreadIdFound"};
  … let e = await this.concurrentlyGetGLobalId("facebook", x, w), N = e?.[1];
  if (!N) return {success:!1, errorMessage:"getGlobalIdFailed"}; … }
// executeByExtOnce   @964502  — y hệt, chỉ khác sau đó là upload + sendInbox
// executeByExtInChunks @962696 — y hệt
```
**① `thread_id` (sync nếu thiếu) → ② `globalId` → ③ gửi.** Thiếu ① thì **dừng**, không dò gid.

Trước lượt này script đã đúng ở **đường Ext** (§36) nhưng **đường Socket thì không**:
`resolveGlobalId` vẫn "chạy được" với `threadId: ''` (rơi xuống nguồn ③/④ dò theo tên), nên script
đi tiếp rồi bắn publish ⇒ FB trả `1545006`/`#551` (**11 lần** trong 12 HAR) hoặc treo tới hạn ACK —
tốn đúng 1 lượt chờ cho ca **chắc chắn** không gửi được.

**ĐÃ SỬA** (`sendViaSocket`, ngay sau `ensureThreadId`, TRƯỚC `resolveGlobalId`):
```js
if (!threadId) {
  gidStats.noThreadIdFound++;
  recycleUnusedFbId(pageId, ctx);
  return { ok: false, sent: false, error: 'noThreadIdFound', noThreadIdFound: true };
}
```

### 39.2 `syncThreadIdTried`: `Set` vĩnh viễn ⇒ mất `thread_id` cả phiên

App **không** nhớ "đã thử": `eF(page_id, convId)` được gọi lại **mỗi lần gửi** khi hội thoại vẫn
thiếu `thread_id`. HAR `guisot.har` chỉ có **1** lần cho conv `…_28877217668608600` (13:54:30.596,
ngay TRƯỚC `POST /conversations/…` lúc 30.677 — tức app sync **trong lúc gửi**) — vì app dùng kết
quả cho cả lần gửi đó, **không phải** vì nó nhớ.

Script cũ: `const syncThreadIdTried = new Set()` + `has → return null`, **không TTL** ⇒ chỉ cần
**một** lần lỗi mạng/timeout/429 là hội thoại đó **mất `thread_id` tới khi tải lại trang**, và mọi
lần gửi sau rơi vào `noThreadIdFound`. Đây là kiểu hỏng "im lặng + vĩnh viễn" tệ nhất.

**ĐÃ SỬA:** `Map` + `SYNC_TID_RETRY_MS = 45000` (chặn gọi trùng trong một đợt, cho thử lại sau),
dọn mục cũ khi > 4000 khoá.

**Test khoá (4 kịch bản `(Q)`+`(R)`):** Socket bỏ sớm `noThreadIdFound`; `Map` không phải `Set`;
có nhánh TTL; hằng số 45 000. `npm test`: **405**.

---

## 40. `batch nạp 0/0` — nguyên nhân THẬT: `PRELOAD_DOC_IDS` nạp SAI BỘ doc_id

### 40.1 Hai bộ doc_id khác nhau (đây là gốc của mọi `Missing doc_id`)

```js
// ext 0.5.62 — bảng hằng
rt = "MessengerThreadlistWebGraphQLQuery"          // ← BẮT BUỘC cho BATCH_GET_GLOBAL_ID
st = "MessengerThreadlistQuery"
ea = "BizInboxSearchResultFacebookListQuery"       // ← bộ TÌM KIẾM
ge = "BizInboxCustomerRelaySearchSourceQuery"
Oe = "BizInboxSearchResultListContainerQuery"
Jt = "PagesManagerInboxAdminAssignerRootQuery"     // ← bộ nguồn gid trong inbox
Zt = "PagesManagerInboxQueryUtilCommItemHeaderMercuryQuery"
Da = "MessengerThreadsWebGraphQLQuery"             // ← bộ LOAD_FACEBOOK_MESSAGES
Sa = "MessengerThreadsQuery"
```

| Nơi đòi doc_id | Bộ cần | Ai nạp |
|---|---|---|
| `Ct.init()` — `BATCH_GET_GLOBAL_ID` | **`rt`, `st`** (`if(!O.get(rt,st)) reject "Missing doc_id"`) | `ee.preloadDocIds` (**feature `inbox`**) |
| `Ue.preloadDocIds` — người xử lý của case `PRELOAD_DOC_IDS` | **`ea`, `ge`, `Oe`** | chính case đó |
| `He.preloadDocIds` — `LOAD_FACEBOOK_MESSAGES` | `Da`, `Sa` | `He.loadFacebookMessages` |
| `Ee.getGlobalIdFromInbox` — nguồn gid ①② | `Jt`, `Zt` | **`Ee.init()` tự nạp** |

```js
// case "PRELOAD_DOC_IDS" (ext @400618)
O.preloadDocIds({pageId:_, isBusiness:g}), q.setItem("country", r.data.country); break
//   → Ll.preloadDocIds → các feature CHƯA ready → getFeatureHandlerClass("businessInboxComment") = Ue
//   → Ue.preloadDocIds → loadDocIdsFromView({docNames:[ea,ge,Oe]})     ← KHÔNG có rt/st
// ee.preloadDocIds (feature "inbox", @166xxx)
const l = [Jt, Zt, rt, st]; await O.loadDocIdsFromView({html:s, docNames:l, …})   ← CÓ rt/st
// Ee.getGlobalIdFromInbox  (ext @74503)
if ((e || !O.isFeatureReady("inbox")) && await ee.preloadDocIds({pageId, isBusiness}), O.get(Jt) && this.threadId) { … }
```

⇒ `PRELOAD_DOC_IDS` **không bao giờ** nạp `rt/st`. Vì vậy `BATCH_GET_GLOBAL_ID` của script
reject `Missing doc_id MessengerThreadlistWebGraphQLQuery or MessengerThreadlistQuery` ở
**100 %** lần chạy — đúng như đo: **16** dòng `batch rỗng — THIẾU doc_id`, **0** lần `batch nạp N/M`
với N > 0, chỉ **1** dòng `đã gửi PRELOAD_DOC_IDS`.

### 40.2 Vì sao app không bao giờ gặp lỗi này

`grep -c "PRELOAD_DOC_IDS" _app-…v6.js` = **0** — app **không hề gửi lệnh đó**. `doc_id` đến
như **tác dụng phụ** của `Ee.init()` mà app gọi trong `concurrentlyGetGlobalId` /
`getGlobalIdFromWeb` ⇒ khi app gọi `BATCH_GET_GLOBAL_ID` (`@897543`) thì `rt/st` đã có sẵn.
Script gửi batch **trước** khi có bất kỳ `Ee.init()` nào ⇒ luôn trượt. Đây là hệ quả của việc
script chủ động gọi một lệnh mà app không gọi, **với một người xử lý khác**.

### 40.3 VÌ SAO CHỜ 25 000 ms LÀ VÔ ÍCH (đã sửa)

1. `case"PRELOAD_DOC_IDS"` **không** gửi `_SUCCESS`/`_FAILURE` (chỉ `break`) ⇒ `adapter.send`
   **không bao giờ** giải promise ⇒ luôn hết hạn. Chờ 25 s hay 25 phút: `res` vẫn
   `{success:false, data:null}`. Không có thông tin nào để chờ.
2. Lệnh **không bị chặn**: listener ext chỉ `await` tuần tự với `o = Mm.has(type)`, và `Mm`
   = **`SEND_COMMENT` + `REPLY_INBOX_PHOTO`**. `PRELOAD_DOC_IDS` chạy ngay.
3. `O.preloadDocIds` tự thoát ngay khi feature đã ready ⇒ lần 2 trở đi **gần như 0 ms** dù ta chờ 25 s.

**ĐÃ SỬA:** chờ thích ứng `DOCID_PRELOAD_FIRST_WAIT_MS = 3000` (page chưa nạp) /
`DOCID_PRELOAD_REPEAT_WAIT_MS = 800` (đã nạp trong phiên), trần `DOCID_PRELOAD_MAX_WAIT_MS = 4000`.
Ghi `docIdStats.savedMs` (thời gian tiết kiệm thật) + `preloadFirst`/`preloadRepeat`, và log in
**số ms đã chờ thật** thay vì con số 25 000 viết cứng.

> Điều này KHÔNG làm batch thành công (nguyên nhân là 40.1), nhưng bỏ được ~22 s chờ vô ích
> mỗi lần warm-up. Việc nạp đúng bộ `rt/st` phải do **`Ee.init()`** làm — xem §41.

**Test khoá:** hằng chờ ≤ 4 000 ms; không còn `timeout: 25000` cho `PRELOAD_DOC_IDS`.
