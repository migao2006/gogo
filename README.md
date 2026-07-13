# Bus Now｜TDX 附近公車即時到站

Bus Now 是一個以 Next.js、TDX、Leaflet 與 OpenStreetMap 製作的行動版公車 Web App。專案已移除所有捷運功能，集中優化公車站牌整併、行駛方向與即時到站體驗。

## 2.0.0 全面更新

- 完全移除捷運頁面、API 與計算模組。
- 全新行動版 UI：漸層首頁、摘要卡片、地圖面板、站牌卡片與即時到站底部面板。
- 同一實體公車站依 `StationID` 整併，只顯示一張站牌卡片。
- 沒有 `StationID` 時，以標準化站名與 35 公尺內座標整併。
- 點擊站牌後，依下一站方位分成向東、向西、向南、向北等方向。
- 若業者未提供完整站序，仍會依去程／返程分組並顯示實際終點。
- 同一路線只顯示一次，保留下一班與下下一班。
- 到站時間顯示到秒，手機端每秒倒數，每 20 秒向 TDX 重新校正。
- 支援 GPS、地址搜尋、搜尋半徑、收藏站牌與地圖標記。
- API 金鑰只在伺服器端使用，不會暴露在瀏覽器。

## Vercel 環境變數

在 Vercel 專案的 **Settings → Environment Variables** 新增：

```text
TDX_CLIENT_ID
TDX_CLIENT_SECRET
```

選填：

```text
GEOCODER_USER_AGENT
TDX_MIN_REQUEST_INTERVAL_MS
```

設定完成後需要重新部署。

## 本機執行

```bash
npm install
cp .env.example .env.local
npm run dev
```

開啟 `http://localhost:3000`。

## 部署檢查

部署完成後開啟：

```text
https://你的網址.vercel.app/api/health
```

正常情況：

```json
{"ok":true,"configured":true,"tdxAuth":"ok"}
```

## 專案結構

```text
src/app/api/geocode        地址搜尋
src/app/api/nearby         附近公車站
src/app/api/bus/arrivals   公車即時到站與方向分組
src/app/api/health         TDX 金鑰健康檢查
src/components             行動版 UI 與地圖
src/lib                    TDX、座標與資料整理
```

## 資料限制

公車即時資料由各縣市業者提供給 TDX。部分路線可能沒有車牌、到站秒數或完整站序，此時畫面會顯示可取得的資訊並自動降級，不會偽造資料。
