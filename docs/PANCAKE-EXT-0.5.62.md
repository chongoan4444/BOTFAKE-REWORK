# Nguồn extension Pancake v2 — `0.5.62_0` (đối soát 2026-11-22)

> **Vị trí:** thư mục `0.5.62_0/` nằm trên nhánh **`main`** (commit `9edbe06`, 2026-11-21),
> **KHÔNG** có trên nhánh làm việc `arena/…` (rẽ ra từ `3df45fe`, 2026-11-11).
> Đọc bằng: `git show origin/main:0.5.62_0/assets/background.js-EHsGnyIc.js`
>
> Toàn bộ kết luận dưới đây **trích trực tiếp từ file đó**, có số byte để tra lại.
> Không suy đoán, không dựa vào chú thích cũ.

## 1. Kiến trúc — 3 lớp, không phải 1

```
trang Pancake (MAIN world)
  ├─ window.postMessage({type:…})        ← script của chúng ta nói ở đây
  │      ↑ lọc theo danh sách type (whitelist)
contentscript.js-9v5GTH37.js                       (ISOLATED world)
  └─ chrome.runtime.connect({name:"pancake_tab"})
        │  tự chờ message PANCAKE_SW_READY rồi mới bơm hàng đợi
        ↓ port
background.js-EHsGnyIc.js                            (service worker)
  └─ chrome.runtime.onConnect → switch(msg.type)     @391190
        ├─ REPLY_INBOX_PHOTO  → le(pageId).sendInbox()  @395000
        ├─ BATCH_GET_GLOBAL_ID → class Ct              @403172
        ├─ GET_GLOBAL_ID_FOR_CONV → class Ee           @412480
        └─ LOAD_FACEBOOK_MESSAGES → class He           @400699
offscreen-Dgz7CJHb.js  → sandbox.html (eval chuỗi hàm) — extension dùng để chạy JS
                          trong ngữ cảnh Facebook; keepAlive 20 s/lần
```

**Hệ quả cho script:** mọi lệnh đều đi qua **một** port dùng chung, có **hàng đợi** riêng
trong contentscript (`A` mảng, prune task > 29 s). Nếu port chết, contentscript gọi `T()`
để nối lại và **bơm lại** hàng đợi.

## 2. `getErrorHandler` — bảng quyết định của extension (@126879)

```js
getErrorHandler(e,t,a){                       // e=pageId, t=parsed FB body, a=retry lần
  const r=[1357004,1545012,1545006,3252001,1390008];
  return (t?.error)===1545012 && a===1 ? "retryUsingSocket"        // ← CHỈ khi retry=1
    : t ? ( t?.payload?.error_payload===true
            && ["instagram_official","instagram"].includes(this.platform)
            && !t.error ? "retryUsingSocket"                       // ← IG, KHÔNG áp FB
          : r.includes(t.error)
              ? (this.checkCanReuploadPhotos(t) || t.error===1545006)
                  ? (await this.isUploadBlocked(e) ? "reuploadPhotosByApi" : "reuploadPhotos")
                  : (t.error===3252001 || t.error===1390008) ? "retryUsingSocket" : "restartInbox"
              : "cannotRetry"
          : "restartInbox" }
```

| FB trả | hành động extension | có sinh tin không |
|---|---|---|
| `error:1545012` + retry=1 | `retryUsingSocket` → trả `canRetryUsingSocket:true` | **KHÔNG** |
| `error:1545012` + retry=0 | qua nhánh `r.includes` | tuỳ `checkCanReuploadPhotos` |
| `checkCanReuploadPhotos` đúng (`1545012` + "Tạm thời không thực hiện được"/"Temporary Failure" + đúng `errorDescription`) | `reuploadPhotos` | **KHÔNG** (chưa gửi) |
| bị chặn upload (`uploadBlocked`, TTL **`wl=6048e5` = 7 ngày**) | `reuploadPhotosByApi` | **KHÔNG** |
| `3252001` / `1390008` | `retryUsingSocket` | **KHÔNG** |
| `1357004` / `1545006` | `restartInbox` | **KHÔNG** |
| còn lại (**gồm `1545041`**) | **`cannotRetry`** | **KHÔNG** |
| không parse được | `restartInbox` | **KHÔNG** |

### `1545041` — FB CHẮC CHẮN chưa tạo tin

`cannotRetry` gọi:
```js
C.warning("FAIL TO SEND MESSAGE TO FACEBOOK --> CANNOT RETRY")
// rồi postMessage REPLY_INBOX_PHOTO_FAILURE với
{ errorDescription: H.errorDescription, fbErrorCode: H.error }
```
⇒ Script nhận `success:false` + `fbErrorCode:1545041`. **Không có tin nào được tạo.**
Đây là *chứng minh*, không phải suy đoán — khớp cách script đang xử lý (`recipientUnavailable`).

Đối chiếu: `jc = n => ![1545041].includes(n?.error)` — extension coi `1545041` là **không retry**.

## 3. Lỗi trong `r[]` ⇒ extension TỰ thử lại bên trong

`restartInbox` **gửi lại** `sendInbox({...e, retry:1, retryReason:"restartInbox"})`.
Nghĩa là với lỗi thuộc `r[]`, extension tự thử lại **bên trong** — script chỉ thấy kết quả cuối.
Điều này giải thích vì sao `fetch` phía script có thể mất nhiều giây mà không thấy lệnh nào.

## 4. `messageId` — bằng chứng DƯƠNG, phân biệt 2 ca `success:true`

```js
isResponseSuccess(e,t){case"facebook":return e&&e.payload&&
  (e.payload.actions&&e.payload.actions[0].message_id||e.payload.error_payload);…}

parseSuccessResponse({response:e,platform:t,…}){case"facebook":
  return e.payload.error_payload ? {}                       // ← RỖNG
    : {messageId:e.payload.actions[0].message_id,           // ← CÓ ID
       globalUserId:a, timestamp:e.payload.actions[0].timestamp};…}

sendInboxSuccess(e,t,a,r){return s=>{s&&s.success&&e.port.postMessage({
  type:"REPLY_INBOX_PHOTO_SUCCESS", taskId, pageId, convId,
  messageId:s.messageId, globalUserId, timestamp,
  retryReason, messageCreatedRange, unreliableTimestamp})}}
```

| FB trả | postMessage | nghĩa |
|---|---|---|
| `payload.actions[0].message_id` | **CÓ** `messageId` | **tin đã tạo trên FB** |
| `payload.error_payload` | **KHÔNG** `messageId` | FB từ chối ngầm |
| không cả hai | `REPLY_INBOX_PHOTO_FAILURE` | lỗi |

⇒ `messageId` **là** id tin thật của Facebook. Script hiện **chưa dùng** nó làm bằng chứng.

Trường phụ (chưa dùng, ghi để tra): `messageCreatedRange:[M,z]` = `[Date.now() trước fetch,
Date.now() sau fetch]` — **đo được thời gian FB xử lý**; `unreliableTimestamp` = `!timestamp`
khi extension tự điền `new Date().getTime()`.

## 5. `threadKey` KHÔNG được dùng khi gửi FB

`buildSendParams` (@x135xxx) chỉ đọc: `pageId`, `globalUserId`, `files`, `text`, `platform`,
`igThreadId`, `photoBlob`, `attachmentType`, `replyMessage`. **Không đọc `threadKey`.**
⇒ Truyền `threadKey` cho `REPLY_INBOX_PHOTO` là vô hại nhưng cũng **vô dụng**.

Form gửi FB (`case"facebook"`):
```js
f["specific_to_list[0]"]="fbid:"+globalUserId
f["specific_to_list[1]"]="fbid:"+pageId
f.other_user_fbid=globalUserId; f.message_id=offline_threading_id
f.client="mercury"; f.action_type="ma-type:user-generated-message"
f.source="source:page_unified_inbox"; f.timestamp=<ms>
f.request_user_id=pageId; f.has_attachment=files.length>0
f["image_ids[i]"]=…  // ảnh
```
Endpoint: **`https://business.facebook.com/messaging/send/`** (`getSendAPIUrl`).
Khi thiếu `globalUserId`: `sendInbox` **tự dò trước** (`getGlobalUserId`) rồi gọi lại.

## 6. Timeout — `Wc` / `ro` / `ao`

```js
ao = 35e3                                    // 35 000 ms
Wc(fn, e = ao-5e3)  → fn(taskId)             // 30 000 ms
ro(taskId) → số ms còn lại
          → null      nếu hết hạn  ⇒ sendInbox trả {success:false, retryReason:"execute task timeout"}
          → "NO_TIMEOUT" nếu không có task
```
⇒ Có **hai** đường timeout: (a) `Wc` 30 s ở lớp SW, (b) `ro===null` → trả sớm "execute task timeout"
**trước khi gửi**. Cả hai đều nghĩa là **chưa gửi**.

## 7. Batch global id — `class Ct` (@70778)

```js
if (!O.get(rt,st)) reject(`Missing doc_id ${rt} or ${st}`)   // cần PRELOAD_DOC_IDS trước
if (lr[pageId])   reject("There is a running job")           // mỗi page 1 job
loop { graphqlbatch("MessengerGraphQLThreadlistFetcher", {limit, before, tags:["INBOX"]}) }
lý do dừng: "There's no thread left" | "Reach max thread count" | "Reach min time range"
```
`extractGlobalId`: nếu **mọi** participant đều là Page ⇒ `globalId = thread_key.other_user_id`;
ngược lại ⇒ `globalId = thread_key.other_user_id`, key = `page_comm_item.id||comm_source_id`.

⚠ script gọi `BATCH_GET_GLOBAL_ID` **không kèm `timeRangeMin`/`maxThreadCount`** ⇒ chạy tới
"There's no thread left" hoặc trần mặc định `ul` — **có thể lâu**. Log 14:13 cho thấy nó vẫn
chạy sau khi lượt gửi đã xong.

**"There is a running job" là lỗi thật, hay gặp** khi script gọi batch 2 lần cho cùng page.

## 8. Dò global id — `class Ee` (@73256)

Thứ tự thử:
1. `PagesManagerInboxAdminAssignerRootQuery` (`Jt`) với `threadId` → `commItem.target_id`
2. `PagesManagerInboxQueryUtilCommItemHeaderMercuryQuery` (`Zt`) với `threadKey` + `cquick_token`
3. `findThread` theo `threadId`/`customerName` (`MessengerGraphQLThreadlistFetcher`)
4. `getUserInboxByName` — **dò theo tên khách**

Sau khi có kết quả:
```js
if (convType==="INBOX" && !isThreadCorrect(i) && !findThreadByUsername) 
    → t("INCORRECT THREAD")          // thất bại, KHÔNG trả gid
isThreadCorrect(i){ i=[].concat(i); return !(i.length===0 || i.every(x=>!x) || !this.threadId)
                                              && i.includes(this.threadId) }
```
⇒ **`threadId` sai ⇒ `INCORRECT THREAD`** kể cả khi Facebook đã trả `target_id`.
Đây chính là dòng `FAIL TO GET GLOBAL ID --> INCORRECT THREAD <a>, <b> VS <c>`.

Ngoại lệ: `ENABLE_FIND_THREAD_BY_USERNAME` (`self['findThreadByUsername_'+pageId]`) bật thì
**bỏ qua** kiểm tra này.

## 9. Đường đọc lịch sử — `class He` (`LOAD_FACEBOOK_MESSAGES`)

```js
if (r.data.platformExtraInfo?.linked_fb_page) r.data.pageId = that   // ⚠ page khác!
if (r.data.platform!=="instagram_official") r.data.customerName = undefined
new He(r.data).init() → {messages, globalId}
```
⇒ Dùng `linked_fb_page` sẽ đọc hộp thư của **page được liên kết**, không phải page đang chat.
Script của ta **không** gửi `platformExtraInfo` ⇒ an toàn.

## 10. `PRELOAD_DOC_IDS` — bắt buộc trước mọi lệnh graph

```js
case"PRELOAD_DOC_IDS": O.preloadDocIds({pageId, isBusiness}); q.setItem("country",…)
```
Không gọi trước ⇒ `Ct.init` reject `Missing doc_id`; `Ee.getGlobalIdFromInbox` tự gọi
`ee.preloadDocIds` khi `!O.isFeatureReady("inbox")` (có tự chữa, chậm ~1 lần).

## 11. `REPLY_INBOX_PHOTO` nhánh `km` (không phải attachment chuẩn)

```js
["VIDEO","PHOTO","STICKER","SEND_TEXT_ONLY","REPLY_MESSAGE","FILE","AUDIO"].includes(attachmentType)
  ? le(pageId).sendInbox(...)          // ← đường chuẩn, có messageId
  : km(pageId).send(port, taskId, convId, text, attachmentType, files)   // ← đường khác
```
⇒ `attachmentType` **phải** nằm trong danh sách trên thì mới đi đường có `messageId`.

## 12. Điều CHƯA xác minh được bằng file này

| câu hỏi | vì sao |
|---|---|
| Request POST thật tới `business.facebook.com/messaging/send/` trông thế nào, trả gì | file này là **mã**, không có dữ liệu mạng. Cần `network-log.har` trên `main` |
| `error_payload` xuất hiện khi nào | chỉ thấy ở nhánh parse; điều kiện FB trả nó nằm ở phía Facebook |
| Tại sao `messageId` đôi khi thiếu dù gửi thành công | chưa có log đối chiếu từng ca |
