# Bus Now 2.2.1｜TDX 公車即時資訊

以 Next.js、TDX、Leaflet 與 OpenStreetMap 製作的手機優先公車 Web App。

## 2.2.1 穩定性修正

- 修正 iPhone Safari 底部工具列遮住站牌與到站面板。
- 修正小螢幕站牌卡片、方向列與班次標籤溢出。
- 點擊站牌時會先顯示首頁預覽或本機快取，再於背景更新完整資料。
- 地址搜尋結果會直接帶入縣市代碼，省略一次反向地理編碼，縮短等待時間。
- 到站自動校正改為每 60 秒，首頁預覽改為每 120 秒。
- 車輛位置改為每 45 秒更新。
- 到站提醒優先使用快取，避免重複呼叫相同站牌。
- 伺服器加入同一查詢去重、45 秒即時快取及 30 分鐘失敗降級。
- TDX 單次請求加入 8 秒逾時，429 僅短暫重試一次，不再長時間卡住。
- 移除目前不支援 RouteUID 篩選的公車 Alert 呼叫，避免無效 HTTP 400。

## 主要功能

- 已授權時自動取得目前位置
- 地址、地標及路線編號搜尋
- 預設 300 公尺附近站牌
- 同一實體站牌整併與方向分類
- 首頁最快 3 班車預覽
- 收藏站牌
- 完整路線站序與車輛位置
- 3 分鐘到站提醒
- 地圖展開／收起
- 離線快取、逾時及 TDX 限流降級
- PWA manifest

## Vercel 環境變數

```env
TDX_CLIENT_ID=你的_Client_ID
TDX_CLIENT_SECRET=你的_Client_Secret
GEOCODER_USER_AGENT=TDX-Bus-Now/2.2.1
TDX_MIN_REQUEST_INTERVAL_MS=1200
TDX_REQUEST_TIMEOUT_MS=8000
```

只有前兩項必填。請勿把真正的金鑰提交到 GitHub。

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

不同縣市與業者提供的車輛位置及行駛方向完整度可能不同。系統會優先顯示上次成功資料，避免單一 API 暫時失敗造成整個畫面無法使用。
