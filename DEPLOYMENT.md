# GitHub＋Vercel 部署檢查表

## GitHub 上傳前

- [ ] 壓縮檔已解壓縮
- [ ] `package.json` 位於 Repository 根目錄
- [ ] 沒有 `.env.local`
- [ ] 沒有任何真正的 TDX 金鑰

## Vercel

在 Project Settings → Environment Variables 設定：

| 變數 | 必填 | 說明 |
|---|---:|---|
| `TDX_CLIENT_ID` | 是 | TDX Client ID |
| `TDX_CLIENT_SECRET` | 是 | TDX Client Secret |
| `GEOCODER_USER_AGENT` | 否 | 地址搜尋識別字串 |

三個環境都建議勾選：Production、Preview、Development。

## 部署後測試

1. 開啟 `/api/health`，確認 `ok: true`。
2. 用手機 Safari 或 Chrome 開啟首頁。
3. 按「使用我的目前位置」。
4. 允許定位。
5. 點擊附近公車站，確認到站資訊。
6. 搜尋一個地址，確認地圖能移動到該位置。

## 常見錯誤

### 尚未設定 TDX_CLIENT_ID

Vercel 沒有設定環境變數，或設定後沒有重新部署。

### TDX 認證失敗

Client ID／Secret 輸入錯誤、金鑰被刪除，或 TDX 服務暫時異常。

### 定位無法使用

瀏覽器未允許定位、系統定位關閉，或不是 HTTPS 網址。

### 地址搜尋失敗

Nominatim 暫時限流。可先使用 GPS；正式高流量版本建議改接 Google Maps、Mapbox 或其他地理編碼服務。
