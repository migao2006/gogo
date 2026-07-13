# Bus Now 2.1｜TDX 附近公車即時資訊

使用 Next.js、TypeScript、TDX、Leaflet 與 OpenStreetMap 製作的行動版公車 Web App。

## 2.1 重點更新

- 首頁直接預覽最近站牌最快 3 班公車
- 同一實體站牌整併，不再重複顯示
- 依向東、向西、向南、向北或去返程分類
- 顯示目的地方向與下一站名稱
- 收藏站牌首頁，可保留常用站牌
- 支援直接搜尋公車路線編號
- 路線搜尋結果可查看去程、返程與完整站序
- 地圖預設收起，站牌資訊優先
- 到站秒數每秒倒數，每 20 秒重新校正
- 首頁預覽採批次查詢，降低 API 請求量
- 即時 API 失敗時，優先顯示 10 分鐘內的上次成功資料
- 離線提示、請求逾時與 TDX 429 降級處理
- 支援 PWA，可加入 iPhone 主畫面

## 專案結構

```text
src/app/api/nearby                 附近公車站
src/app/api/geocode                地址與地標搜尋
src/app/api/bus/arrivals           單一站牌完整即時到站
src/app/api/bus/previews           首頁站牌批次即時預覽
src/app/api/bus/routes/search      路線編號搜尋
src/app/api/bus/routes/detail      路線去返程與完整站序
src/app/api/health                 TDX 金鑰健康檢查
src/components/TransitApp.tsx      主要行動版介面
src/components/MapView.tsx         Leaflet 地圖
src/lib/bus-arrivals.ts            到站、方向、快取與預覽邏輯
src/lib/bus-routes.ts              路線搜尋與站序整理
```

## 本機執行

需要 Node.js 20 以上版本。

```bash
npm ci
cp .env.example .env.local
npm run dev
```

在 `.env.local` 填入：

```env
TDX_CLIENT_ID=你的_Client_ID
TDX_CLIENT_SECRET=你的_Client_Secret
GEOCODER_USER_AGENT=TDX-Bus-Now/2.1
TDX_MIN_REQUEST_INTERVAL_MS=1000
```

## GitHub＋Vercel 部署

1. 將本資料夾內所有檔案放到 GitHub Repository 根目錄。
2. 確認根目錄可直接看到 `src`、`public`、`package.json`、`package-lock.json`。
3. 在 Vercel 匯入該 Repository。
4. 在 Project Settings → Environment Variables 新增：
   - `TDX_CLIENT_ID`
   - `TDX_CLIENT_SECRET`
5. 重新部署或 Push 新 Commit。

部署完成後測試：

```text
https://你的網域/api/health
```

正常應回傳：

```json
{"ok":true,"configured":true,"tdxAuth":"ok"}
```

## 安全提醒

請勿把真正的 TDX Client ID、Client Secret、`.env` 或 `.env.local` 提交到 GitHub。若金鑰曾公開出現在聊天、截圖或 Repository，請到 TDX 後台重新產生。

## 已驗證

```text
npm run lint
npm run build
```
