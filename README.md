# Bus Now 2.3｜Supabase 靜態資料第一階段

Bus Now 是以 Next.js、TDX、Supabase、Leaflet 與 OpenStreetMap 製作的手機優先公車 Web App。

## 2.3 第一階段重點

公車資料現在分成兩層：

- **Supabase 長期保存**：路線、實體站牌、完整站序、方向、下一站。
- **TDX 即時取得**：預估到站與車輛目前位置。

系統會優先讀 Supabase；若尚未設定 Supabase，或該縣市尚未同步，會自動回退到原本的 TDX 查詢，因此不會因資料庫未完成而讓 App 無法使用。

## 已加入的資料表

- `bus_routes`：公車路線、起終點、營運業者與搜尋文字。
- `bus_stations`：整併後的實體站牌、座標與所有 StopUID。
- `bus_route_stops`：路線站序、方向、下一站與東西南北方位。
- `bus_static_sync_state`：每個縣市的同步狀態與資料筆數。

SQL 位於：

```text
supabase/migrations/202607140001_bus_static_schema.sql
```

## Vercel 環境變數

```env
TDX_CLIENT_ID=你的_TDX_Client_ID
TDX_CLIENT_SECRET=你的_TDX_Client_Secret
SUPABASE_URL=https://你的專案.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的_service_role_key
STATIC_SYNC_SECRET=一組長隨機字串
GEOCODER_USER_AGENT=TDX-Bus-Now/2.3.0
TDX_MIN_REQUEST_INTERVAL_MS=2200
TDX_REQUEST_TIMEOUT_MS=8000
TDX_RATE_LIMIT_COOLDOWN_MS=45000
```

`SUPABASE_SERVICE_ROLE_KEY` 與 `STATIC_SYNC_SECRET` 絕對不能加上 `NEXT_PUBLIC_`，也不能提交到 GitHub。

## 同步一個縣市

部署完成後，向以下端點送出 POST：

```text
/api/admin/sync/bus-static
```

Header：

```text
Authorization: Bearer 你的_STATIC_SYNC_SECRET
Content-Type: application/json
```

Body 範例：

```json
{"city":"ChanghuaCounty"}
```

也可以在本機執行：

```bash
APP_BASE_URL=https://你的網址.vercel.app \
STATIC_SYNC_SECRET=你的密鑰 \
npm run sync:bus-static -- ChanghuaCounty
```

第一次建議先同步目前常用的彰化縣：

```text
ChanghuaCounty
```

其他常用代碼：`Taipei`、`NewTaipei`、`Taichung`、`Taoyuan`、`Tainan`、`Kaohsiung`。

## 查詢流程

```text
附近站牌／路線搜尋／完整站序
        ↓
Supabase 有資料 → 直接回傳
        ↓ 無資料
TDX 備援查詢
```

即時到站仍由 TDX 提供，但方向、終點及下一站會從 Supabase 補齊，因此不需要每次額外呼叫 `StopOfRoute`。

## 本機執行與檢查

```bash
npm ci
npm run lint
npm run build
npm run dev
```

## 安全與資料量

- 靜態同步使用 `upsert`，同一筆路線與站序會被覆蓋，不會每天新增一份。
- 每次同步完成後會移除該縣市已不存在的舊資料。
- 即時到站及車輛位置不寫入 PostgreSQL，因此資料不會無限累積。
- 所有靜態資料表已啟用 RLS，瀏覽器不能直接讀取，僅 Next.js 伺服器使用 service role 存取。
