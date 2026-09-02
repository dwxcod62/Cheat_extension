# KudaVas v2 — Cào câu hỏi từ mọi HTML + Dashboard React

Một Chrome Extension + trang React (Vite) hiển thị danh sách câu hỏi được cào từ
trang HTML bất kỳ, **kèm audio/video** nếu câu hỏi có iframe media.

## Cấu trúc

```
Cheat_extension/
├── manifest.json                ← extension manifest (MV3)
├── background.js                ← service worker: bridge popup ↔ content
├── popup.html / popup.js        ← (legacy popup, giữ lại để dự phòng)
├── scripts/
│   ├── content.js               ← parser chạy trong trang web
│   ├── config.js                ← API base URL
│   ├── question_extractor.js    ← (unused, legacy ESM)
│   └── ...                      ← các script cũ khác
├── dashboard/                   ← React + Vite source
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js           ← build ra ../dist/dashboard
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── styles.css
│       └── components/
│           ├── QuestionCard.jsx
│           ├── AudioPlayer.jsx
│           └── EmptyState.jsx
└── dist/dashboard/              ← build output (manifest trỏ vào đây)
```

## Build & cài đặt

```bash
# 1. Cài dependencies cho dashboard
cd dashboard
npm install

# 2. Build production → sinh ra dist/dashboard/index.html
npm run build

# (tuỳ chọn) chạy dev server để test giao diện
npm run dev    # http://localhost:5173
```

Sau khi build:

1. Mở `chrome://extensions/`, bật **Developer mode**.
2. Bấm **Load unpacked**, chọn thư mục `Cheat_extension/` (thư mục chứa
   `manifest.json`).
3. Mở một trang HTML có câu hỏi (ví dụ `test_3.html`), bấm icon extension → popup
   dashboard sẽ mở. Bấm **▶ Cào câu hỏi** để chạy.

## Các dạng câu hỏi được hỗ trợ

| Type                  | Mô tả                                          |
| --------------------- | ---------------------------------------------- |
| `multiple_choice`     | Trắc nghiệm 1 đáp án                          |
| `true_false`          | Đúng / Sai                                     |
| `checkbox`            | Nhiều đáp án đúng                              |
| `matching`            | Ghép cặp                                       |
| `multiple_dropdowns`  | Điền vào nhiều chỗ trống                       |
| `short_answer_question` / `essay_question` / `fill_in_multiple_blanks_question` / `numerical_question` | Tự luận / điền từ / số |
| `non-question`        | Chỉ chứa iframe audio/video                    |

Ngoài ra content.js có **fallback parser** (`parseGenericQuiz`) cho các trang
HTML không theo class scheme của Canvas — quét theo `.question`, `[data-question]`,
hay `<fieldset>` để vẫn bắt được câu hỏi.

## Audio / Video

- Parser tự tìm iframe bên trong `.display_question` và lưu URL vào trường `url`.
- Dashboard render:
  - `.mp3 / .m4a / .ogg / .wav / .aac / .webm / .opus` → `<audio controls>`
  - `.mp4 / .webm / .ogv / .mov` → `<video controls>`
  - URL khác (iframe chứa player) → render `<iframe>` để phát trực tiếp.
- Mọi URL media đều được đánh dấu thẻ **🔊 có media** ở góc trên câu hỏi.

## Luồng hoạt động

```
[Dashboard popup]                          [Background SW]                  [Content script]
       │                                          │                                  │
       │  start-solve(tabId)                      │                                  │
       ├─────────────────────────────────────────►│                                  │
       │                                          │  ping                            │
       │                                          ├─────────────────────────────────►│
       │                                          │  true                            │
       │                                          │◄─────────────────────────────────┤
       │                                          │  extract                         │
       │                                          ├─────────────────────────────────►│
       │                                          │  questions[]                     │
       │                                          │◄─────────────────────────────────┤
       │  questions-updated (broadcast)           │                                  │
       │◄─────────────────────────────────────────┤                                  │
       │  render list + audio                     │                                  │
```

## Tuỳ chỉnh

- **Thêm API server**: sửa `scripts/config.js` (mặc định trỏ tới ngrok URL cũ).
- **Đổi selector câu hỏi**: sửa các hàm `parseXxx()` trong `scripts/content.js`,
  hoặc bổ sung vào mảng `PARSERS`.
- **Đổi giao diện dashboard**: sửa `dashboard/src/App.jsx` rồi `npm run build`.
