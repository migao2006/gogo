
## 1.2.0 站內看板介面

- 捷運詳情改為站內看板式版面：路線徽章、秒數倒數、目的地與資料來源。
- 轉乘站會整併為同一個實體車站，並同時顯示多條路線與多個 StationID。
- 即時到站與車站資訊分頁呈現。
- 加入末班車資訊摺疊區；TDX 未提供時會明確標示。
- 捷運到站 API 支援同一實體轉乘站一次查詢多個 StationID。


## 1.1.1 緊急修正

- 修正公車 ETA API 誤用 `StationID` 導致 HTTP 400；改為只用實體 `StopUID` 查詢。
- 臺北捷運 TRTC 不支援 `LivePosition`，改成取得全線 `LiveBoard`，配合完整站序與站間行駛時間推算目標站秒數。
- 即時查詢加入 15 秒逾時保護，避免畫面長時間停在「取得即時資料中」。
- Node.js 部署版本固定為 22.x。



## 1.1.0 修改內容

- 公車站牌依 `StationID` 優先整併；沒有 `StationID` 時，以標準化站名＋35 公尺內座標整併。
- 同一實體公車站只顯示一張卡片，地圖標記同步去重。
- 公車到站資訊依下一站方位分成向東、向西、向南、向北等群組，並顯示實際終點。
- 同一路線只顯示一列，保留下一班與下下一班時間。
- 捷運優先採用 TDX LiveBoard；沒有資料時，以 LivePosition、完整站序及 S2STravelTime 自行推估秒數。
- 捷運倒數每秒更新、每 15 秒向伺服器重新校正，並標示「官方即時」或「系統推估」。

## 1.0.1 修正

- 捷運即時到站改用 TDX LiveBoard 正確欄位 `StationID`。
- 移除不存在的 v3 捷運備援端點，避免多餘請求。
- TDX 請求預設間隔 1 秒，遇到 HTTP 429 會自動退避重試。
- 捷運 `EstimateTime` 依 TDX 規格以分鐘轉換為畫面倒數。

# 附近交通｜TDX 公車與捷運即時資訊

以 Next.js、TDX、Leaflet 與 OpenStreetMap 製作的行動版 Web App。使用者可以允許 GPS 定位，或輸入臺灣地址／地標，查看附近公車站、捷運站與即時到站資訊。

## 已完成

- 手機 GPS 定位
- 地址與地標搜尋
- 附近公車站查詢
- 附近捷運站查詢
- 公車預估到站時間
- 捷運即時到站資料（依各業者 TDX 資料供應狀況）
- 地圖與距離排序
- 公車／捷運篩選
- 300 公尺、500 公尺、1 公里、2 公里搜尋範圍
- 本機收藏站點
- 深色模式
- TDX Access Token 快取
- API 金鑰只在伺服器端使用
- PWA manifest，可加入手機主畫面

## 重要安全提醒

不要把真正的 `TDX_CLIENT_ID` 或 `TDX_CLIENT_SECRET` 寫入程式、`.env.example` 或提交到 GitHub。這個專案的 `.gitignore` 已排除 `.env` 與 `.env.local`。

如果金鑰曾經貼到公開場所或對話中，建議到 TDX 會員中心刪除該組金鑰並重新建立。

## 本機執行

需要 Node.js 20 以上版本。

```bash
npm install
cp .env.example .env.local
```

打開 `.env.local`，填入：

```env
TDX_CLIENT_ID=你的_Client_ID
TDX_CLIENT_SECRET=你的_Client_Secret
GEOCODER_USER_AGENT=TDX-Nearby-Transit/1.0
```

接著執行：

```bash
npm run dev
```

瀏覽 `http://localhost:3000`。

## 上傳 GitHub

1. 在 GitHub 建立空白 Repository。
2. 解壓縮本專案。
3. 將所有檔案上傳到 Repository 根目錄。
4. 確認沒有上傳 `.env.local`。

也可以用 Git：

```bash
git init
git add .
git commit -m "Initial TDX transit app"
git branch -M main
git remote add origin 你的_GitHub_Repository_URL
git push -u origin main
```

## 部署 Vercel

1. 登入 Vercel。
2. 選擇 **Add New → Project**。
3. 匯入剛才的 GitHub Repository。
4. Framework Preset 選擇 **Next.js**。
5. 在 **Environment Variables** 新增：
   - `TDX_CLIENT_ID`
   - `TDX_CLIENT_SECRET`
   - `GEOCODER_USER_AGENT`（選填）
6. 按下 **Deploy**。

部署後可開啟：

```text
https://你的網域/api/health
```

若設定正確會看到：

```json
{"ok":true,"configured":true,"tdxAuth":"ok"}
```

## 資料與限制

- TDX 認證採 OIDC Client Credentials，Access Token 會在伺服器端快取。
- 公車站與到站資訊來自 TDX 公車 API。
- 捷運站與即時到站資訊來自 TDX 軌道 API；不同捷運業者提供的即時資料完整度不同。
- 地址搜尋使用 OpenStreetMap Nominatim，適合個人與低流量專案。大量商用流量應改用正式地理編碼服務。
- 瀏覽器定位功能通常要求 HTTPS；Vercel 部署網址已提供 HTTPS。
- TDX API 方案有頻率與點數限制，請依會員方案控制使用量。

## 專案結構

```text
src/app/api/geocode          地址搜尋
src/app/api/nearby           附近公車與捷運站
src/app/api/bus/arrivals     公車即時到站
src/app/api/metro/arrivals   捷運即時到站
src/app/api/health           TDX 金鑰健康檢查
src/components               前端介面與地圖
src/lib                      TDX、座標與資料正規化
```

## 後續可擴充

- 公車路線站序與車輛位置
- 捷運營運異常公告
- 起訖點轉乘規劃
- 到站推播提醒
- 無障礙電梯與低地板公車資訊
- Redis 跨 Serverless Instance 快取
