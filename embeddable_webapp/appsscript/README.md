# Apps Script 設定指南

## 1. 建立 Google Sheet

1. 前往 [Google Sheets](https://sheets.google.com)
2. 建立新試算表
3. 命名為「EmbeddableWebapp Users」
4. 複製試算表 ID（URL 中的長字串）
   - 例如：`https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit`

## 2. 設定 Apps Script 專案屬性

1. 開啟您的 Apps Script 專案
2. 點選左側的「專案設定」（齒輪圖示）
3. 在「指令碼屬性」區段，新增以下屬性：

| 屬性名稱 | 說明 | 範例值 |
|---------|------|--------|
| `SHARED_SECRET` | 與 Django 共享的秘密金鑰 | `your-long-random-secret-string` |
| `EXPIRATION_MINUTES` | Token 有效期限（分鐘） | `1` |
| `SHEET_ID` | Google Sheet 的 ID | `YOUR_SHEET_ID` |

## 3. 部署 Apps Script

1. 將 `Code.gs` 和 `Index.html` 的內容複製到您的 Apps Script 專案
2. 點選「部署」→「新增部署」
3. 選擇「網頁應用程式」
4. 設定：
   - 執行身分：選擇「我」
   - 存取權：「所有人」
5. 部署後複製「網頁應用程式 URL」

## 4. 設定 Django 環境變數

在 `.env` 檔案中設定：

```
APPSCRIPT_SHARED_SECRET=your-long-random-secret-string
APPSCRIPT_WEBAPP_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
```

## 5. Google Sheets 結構

系統會自動建立名為 `Users` 的工作表，包含以下欄位：

| 欄位 | 說明 |
|-----|------|
| Username | 使用者名稱 |
| Email | 電子郵件 |
| Created At | 建立時間 |
| Status | 狀態（active/inactive） |

## 6. 測試流程

1. 在 Django 註冊新使用者
2. 檢查 Google Sheets 是否新增該使用者
3. 登入後產生 iframe token
4. 確認 iframe 正常載入並顯示使用者資訊

## 注意事項

- 確保 Google Sheet 的存取權限設定為「擁有連結的使用者可以檢視」
- 定期更新 `SHARED_SECRET` 以提高安全性
- 可以手動在 Google Sheets 中將使用者狀態改為 `inactive` 來停用使用者
