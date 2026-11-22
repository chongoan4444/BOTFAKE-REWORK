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
