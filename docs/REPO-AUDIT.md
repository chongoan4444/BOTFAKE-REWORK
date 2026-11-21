# Kiểm tra toàn repo — 10 lượt (v1.92.5)

Ngày: 2026-11-11 · HEAD lúc kiểm: 3a355b1 (1.92.4) · 61 file được git theo dõi

## Lượt 1 — Kiểm kê file

61 file. Theo đuôi: 12 `js`, 12 `har`, 10 `png`, 4 `txt`, 4 `json`, 3 `md`, 2 `mjs`, 2 `html`,
1 `yml`, 1 `xml`, 1 `crx` + vài file không đuôi ở gốc.

Tổng dung lượng trong git: **68,7 MB**, trong đó **HAR chiếm 59,4 MB** (12 file).
File lớn nhất: `batmesss.har` 18 MB, `loadnhanh.har` 8,6 MB.

## Lượt 2 — Cú pháp & đồng bộ phiên bản

`node --check` trên **14 file JS/MJS: tất cả OK.** 4 file JSON: tất cả parse được.

| nguồn | version |
|---|---|
| `version.json` | 1.92.4 (build W200.46) |
| `package.json` | 1.92.4 |
| `manifest.json` | 1.92.4 |
| `release/botfake-ext/manifest.json` | 1.92.4 |
| `update.xml` | 1.92.4 |
| banner userscript | 1.92.4 |

⇒ **đồng bộ hoàn toàn** (trước khi bump 1.92.5 ở lượt 10).

## Lượt 3 — `release/` so với nguồn

`diff` 5 file: `extension/background.js`, `bridge.js`, `overlay.js`, `popup.js`,
`scripts/pancake-send-lite.user.js` — **tất cả giống hệt** bản trong `release/botfake-ext/`.
Không có hiện tượng nguồn sửa mà bản phát hành đứng yên.

## Lượt 4 — Test & build

- `npm test` → **12/12 kịch bản phân xử lịch sử đúng**
- `npm run check` → manifest/userscript/update.xml đồng bộ & hợp lệ
- build chạy lại cho ra **đúng bản cũ** (git status trống) ⇒ build tất định

### ⚠ PHÁT HIỆN 1 — `botfake.crx` chứa userscript **1.91.43**

`botfake.crx` (126 KB) được git theo dõi. Giải nén: bên trong là
`pancake-send-lite.user.js` **@version 1.91.43** — chậm **30 phiên bản** so với nguồn.
`update.xml` trỏ Chrome tới `.crx` đó, nên máy nào cài extension qua `update_url` sẽ **chạy code
cũ**. `npm run check` đã cảnh báo việc này (`! botfake.crx chứa bản userscript CŨ`).

Không sửa được tại đây: cần `installer/extension-signing-key.pem` (không có trong repo, đúng
theo `.gitignore`). Muốn phát hành: chạy `node tools/build.mjs --crx` trên máy có khoá.
Ai chạy userscript qua Tampermonkey thì không bị ảnh hưởng (log của bạn ghi 1.92.3).

## Lượt 5 — Cấu trúc userscript

10 356 dòng. **0** khai báo trùng tên ở phạm vi cấp 1, **0** `TODO/FIXME/HACK/XXX`,
**0** `eval(`, **0** `new Function`. Không có hàm nào định nghĩa mà không được tham chiếu.

13 chỗ `innerHTML`; 4 chỗ gán có nội suy (`sumEl`, `shadow`, `elSum`, `list`) — đều dựng từ dữ
liệu nội bộ đã qua xử lý, không có chuỗi thô từ server. Chấp nhận được.

## Lượt 6 — Chờ cứng

30 lời gọi `sleep(`; **3** chỗ `sleep(12000)` — tất cả nằm trong `Promise.race` làm **trần**
cho khởi tạo Socket (`initSocket`, reconnect, warm-up), tự thoát ngay khi promise thật xong.
Không nằm trên đường gửi. Các `sleep(2000)/sleep(4000)` còn lại là retry tải danh sách và
truy vấn câu nhanh.

⇒ Không có chờ cứng nào chặn đường gửi tin.

## Lượt 7 — localStorage

| khoá | ghi | đọc |
|---|---|---|
| `ssb_quick` | 1 | 1 |
| `ssb_wave_size_w200_v1` | 1 | 1 |
| `ssb_wave_gap_w200_v1` | 1 | 1 |
| `ssb_rec_send` | 1 | 1 |
| `botfake_sock_page_floor` | 1 | 1 |
| **`ssb_force_ext`** | **1** | **0** ← mồ côi |

`.gitignore` có chặn `*.pem`, `node_modules/`, `dist/` — đúng.

### PHÁT HIỆN 2 — khoá mồ côi `ssb_force_ext` → đã sửa

`setForceExtMode` ghi khoá này nhưng **không chỗ nào đọc** (ô bật/tắt đã bị xoá, `forceExtMode`
gán cứng `false`). Người dùng chạy `__botfakeForceExt__(true)` sẽ thấy "đã lưu" trong khi F5
là mất. v1.92.5: bỏ ghi localStorage, log nói rõ "chỉ áp dụng cho PHIÊN này".

## Lượt 8 — Hằng số code vs docs

| hằng số | code | docs |
|---|---|---|
| `BUS_PARALLEL_SOCKET` | 256 | §27 ✓ |
| `SOCKET_LANE_MIN/MAX` | 64 / 384 | §27 ✓ |
| `BUS_PARALLEL_EXT` / MIN / MAX | 64 / 48 / 96 | §23 ✓ |
| `EXT_SEND_BREAKER_THRESHOLD` | 150 | §27 ✓ (§23 ghi 30 là mốc lịch sử) |
| `EXT_SEND_BREAKER_MAX_MS` | 15 000 | §23 ✓ |
| `SOCK_VERIFY_PARALLEL` | 32 | §29 ✓ |
| `SOCKET_MIN_PACE_MS` | 4 | (§27 ghi nhận: không phải nút cổ chốt) |
| Ext timeout | 2 500 ms | §24 ✓ |
| `ackWaitMs` | clamp 1 200–3 000 | §28 ✓ |

Không có hằng số nào lệch giữa code và docs.

## Lượt 9 — Vệ sinh repo

- **Không** tìm thấy private key, `access_token=`, hay `EAAG…` trong file được theo dõi.
- Ở gốc có nhiều file không thuộc mã nguồn: `BOTFAKE FULL`, `BOTFAKE.TXT`, `MESSAGE POST`,
  `html.txt/html2/html3`, `html comment list`, `post`, `taodon`, `lại là POST`, `download`.
  Không ảnh hưởng chạy, nhưng làm repo nặng và khó đọc. **Đề xuất** chuyển vào
  `docs/samples/` (chưa làm vì có thể bạn đang dùng).
- **59,4 MB HAR trong git** — dùng để đối chiếu, nhưng nếu muốn nhẹ repo thì nên chuyển sang
  release asset. **Chưa làm**: đây là nguồn bằng chứng chính của toàn bộ công việc này.

## Lượt 10 — Đối chiếu với BUNDLE THẬT của app

Trong repo có `_app-9331d46f21a84eb1.v6.js` (2,0 MB) — **code gốc của Pancake**. Đây là bằng
chứng mạnh nhất trong cả 10 lượt.

### PHÁT HIỆN 3 — cờ `is_record_ctx_7_days` phải là CÓ ĐIỀU KIỆN

```js
j = { action: "reply_inbox", ...(N?.body || {}) };
(0, ev.dr)() && (j.is_record_ctx_7_days = !0);      // ← chỉ khi dr() đúng
```

Code mình (từ v1.91.80) gửi cờ **vô điều kiện**. Bằng chứng này khớp với HAR: 24 ca thiếu cờ là
chat ngoài cửa sổ, 19 ca có cờ là chat trong 24h (`dr()` đúng sẵn). v1.92.5 trả về đúng như app.

### PHÁT HIỆN 4 — payload Socket của mình khớp 100 % code app

```js
// ẢNH:  {attachment_fbids, mark_thread_read:0, otid, send_type:3, source:0,   sync_group:205, text:null, thread_id}
// CHỮ:  {thread_id, otid, source:0, send_type:1, sync_group:205, mark_thread_read:1, text}
// kèm task label "46", queue_name = thread_id, task_id tăng dần
// và task label "21": {thread_id, last_read_watermark_ts:Date.now(), sync_group:205}
```

### PHÁT HIỆN 5 — KHÔNG có cơ chế tag nào để gửi ngoài 24h

Tìm `HUMAN_AGENT` trong toàn bundle app: **0 lần**. ⇒ Không tồn tại tham số/tag nào mở cửa sổ
24h qua HTTP. Kết luận trước đây (Ext/Socket mới gửi được chat >24h) là **đúng bản chất**, không
phải lỗi cấu hình của mình.

## Việc đã sửa trong lượt này (v1.92.5 / W200.47)

1. Cờ `is_record_ctx_7_days` chỉ gửi khi `dr()` đúng — khớp app (PHÁT HIỆN 3).
2. Bỏ khoá mồ côi `ssb_force_ext`; `__botfakeForceExt__` chỉ đổi trong phiên (PHÁT HIỆN 2).

## Việc cần bạn quyết (chưa làm)

| # | việc | vì sao chưa làm |
|---|---|---|
| 1 | `botfake.crx` cũ 1.91.43 | cần khoá ký, không có trong repo |
| 2 | dọn file rác ở gốc vào `docs/samples/` | có thể bạn đang dùng |
| 3 | chuyển 59 MB HAR ra release asset | là nguồn bằng chứng chính |
