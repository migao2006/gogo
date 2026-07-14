# GitHub＋Vercel＋Supabase 部署

## 1. Supabase

1. 建立或選擇一個專用 Supabase Project。
2. 在 SQL Editor 執行：
   `supabase/migrations/202607140001_bus_static_schema.sql`
3. 到 Project Settings → API 取得：
   - Project URL
   - Service role key

## 2. Vercel 環境變數

新增：

```text
TDX_CLIENT_ID
TDX_CLIENT_SECRET
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
STATIC_SYNC_SECRET
```

所有變數都套用至 Production、Preview、Development。設定後重新部署。

## 3. 首次同步

部署完成後，使用 README 中的同步指令先同步：

```text
ChanghuaCounty
```

打開 `/api/health`，可看到 Supabase 是否設定，以及每個縣市的同步狀態。

## 4. GitHub 更新

解壓 ZIP 後，把資料夾內的檔案覆蓋到 Repository 根目錄。根目錄應直接看到 `src`、`public`、`supabase`、`scripts`、`package.json`。
