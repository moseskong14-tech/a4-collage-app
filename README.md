# A4-Collage-App

## 新手使用說明

### 這個 A4-Collage-App 是什麼

A4-Collage-App 是一個可以直接在瀏覽器打開使用的 A4 圖片拼貼與排版工具。你可以加入多張圖片，選擇欄數、調整間距、套用邊框或背景色，最後把排好的 A4 版面下載成 PNG 圖片。

這個專案主要是純前端網頁，不需要後端伺服器，也不需要先安裝套件才能使用。

### Mac 上如何開啟

最簡單的方式：

1. 打開 Finder。
2. 進入這個資料夾：`/Users/moses/A4-Collage-App`
3. 雙擊 `index.html`。
4. 用 Safari 或 Chrome 開啟網頁。

如果畫面有出現「A4 專業排版工具」，代表已經成功打開。

### 如何用本機 server 測試

如果想用比較接近正式網頁的方式測試，可以在 Mac 的 Terminal 執行：

```bash
cd /Users/moses/A4-Collage-App
python3 -m http.server 8000
```

然後在瀏覽器打開：

```text
http://localhost:8000
```

測試完後，可以回到 Terminal 按 `Control + C` 停止本機 server。

### 哪些檔案最重要，不要亂改

以下檔案最重要，修改前最好先備份：

- `app.js`：主要功能邏輯，例如加入圖片、排版、拖曳、下載、自動儲存。
- `index.html`：網頁畫面結構，很多按鈕和欄位都靠這裡的 `id` 連接到程式。
- `styles.css`：畫面樣式，包含手機版、看板、按鈕、預覽區。
- `assets/frame-assets.js`：邊框圖片資料，檔案很大，不適合手動亂改。

如果你是新手，建議先不要改以上檔案；真的要改時，一次只改一小段，改完馬上測試。

### 版本更新規則

每一次任何使用者可見功能、Bug 修正、UI 修正或 icon 更新，必須：

1. 遞增 `APP_BUILD`：`const APP_BUILD = 'vX.Y.Z · YYYYMMDD-簡短名稱';`
2. 若 `app.js` 有改動，更新 `index.html` 的 `./app.js?v=YYYYMMDD-簡短名稱`。
3. 若 `styles.css` 有改動，更新 `index.html` 的 `./styles.css?v=YYYYMMDD-簡短名稱`。
4. 若 manifest 或 icon 有改動，更新 `manifest.webmanifest?v=YYYYMMDD-簡短名稱`、`apple-touch-icon.png?v=YYYYMMDD-簡短名稱`、`favicon-32.png?v=YYYYMMDD-簡短名稱`。
5. `APP_BUILD` 的版本文字、JS cache query、CSS cache query 必須使用同一個 release label；manifest/icon cache query 只在 manifest 或 icon 有改動時同步更新，例如 `v0.10.2 · 20260625-undo-ui`。
6. 每次完成後，最終回覆第一行必須是：`版本：vX.Y.Z · YYYYMMDD-簡短名稱`。
7. 不可只說「已完成」；必須說明修改了哪些檔案、哪些 cache query 已更新、是否需要刪除並重新加入 iPhone 主畫面捷徑。

### 如何確認沒有改壞

每次修改後，可以照下面流程檢查：

1. 打開 `index.html`，確認畫面可以正常出現。
2. 按「加入圖片」，選一張圖片。
3. 確認圖片出現在拖曳佈局看板和右側預覽。
4. 按「直接下載」。
5. 確認可以下載出 PNG 圖片。

如果以上步驟都成功，通常代表基本功能沒有被改壞。

### 新功能測試清單

完成新功能後，可以照下面流程快速檢查：

1. 在「A4 藝術邊框」選擇「手帳膠帶框」、「生日彩紙框」、「簡約圓點框」，確認預覽都有出現不同邊框。
2. 加入一張圖片，使用「圖片加字」，套用後確認輸出的圖片文字有描邊或陰影，深色與淺色照片上都能讀。
3. 按「直接下載」，確認狀態文字顯示「PNG 已開始下載」，並且可以取得 PNG 檔案。
4. 加入圖片後確認會出現「已加入 X 張圖片」提示。
5. 按「重設全部」並確認後，檢查畫面回到初始狀態，並顯示「已重設全部」。
