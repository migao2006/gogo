# Bus Now 2.2｜TDX 公車即時資訊

以 Next.js、TDX、Leaflet 與 OpenStreetMap 製作的手機優先公車 Web App。

## 2.2 更新

- 首頁改為緊湊介面，移除大型宣傳標題，讓站牌資訊更快出現。
- 預設搜尋範圍改為 300 公尺。
- 瀏覽器已授權定位時，開啟 App 會自動取得目前位置。
- 公車路線頁新增車輛即時位置，並把車輛放到對應站序。
- 從站牌詳情開啟路線時，顯示車輛距離目前站牌還有幾站。
- 加入路線營運提醒資料的降級顯示。
- 加入「3 分鐘前提醒」，最多同時設定 5 組；App 開啟時會持續檢查。
- 路線與車輛位置每 15 秒更新，到站資訊每 20 秒更新。

## 既有功能

- 目前位置與地址搜尋
- 路線編號搜尋
- 附近站牌整併與方向分類
- 首頁最快 3 班車預覽
- 收藏站牌
- 完整路線站序
- 地圖展開／收起
- 離線快取、逾時與 TDX 限流降級
- PWA manifest

## Vercel 環境變數

```env
TDX_CLIENT_ID=你的_Client_ID
TDX_CLIENT_SECRET=你的_Client_Secret
GEOCODER_USER_AGENT=Bus-Now/2.2
```

請勿把真正的金鑰提交到 GitHub。

## 本機執行

```bash
npm ci
npm run dev
```

## 建置檢查

```bash
npm run lint
npm run build
```

## 資料限制

不同縣市與業者提供的車輛位置、行駛方向及營運提醒完整度可能不同。系統會在資料缺少時保留站序與到站資訊，不讓單一 API 失敗造成整個頁面無法使用。
