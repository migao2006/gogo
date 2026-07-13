# Bus Now 2.1 部署檢查表

## GitHub 根目錄

必須直接看到：

```text
src/
public/
package.json
package-lock.json
tsconfig.json
next.config.ts
```

不要變成：

```text
gogo/tdx-bus-now-v2.1.0/src/
```

## Vercel 環境變數

| Key | Value |
|---|---|
| `TDX_CLIENT_ID` | TDX Client ID |
| `TDX_CLIENT_SECRET` | TDX Client Secret |

Production、Preview 建議都勾選。

## 部署後測試順序

1. `/api/health` 顯示 `ok: true`
2. 首頁允許定位
3. 附近站牌顯示即時預覽
4. 點擊站牌查看方向與到站秒數
5. 切換「找路線」並搜尋路線編號
6. 收藏站牌後重新整理，確認收藏仍保留

## 常見錯誤

### npm install exited with 1

確認 `package-lock.json` 內所有套件網址皆為 `https://registry.npmjs.org/`，不要包含內部套件伺服器網址。

### 找不到 app directory

代表 `src/app` 不在 Repository 根目錄正確位置。

### TDX 429

請稍候數秒再試，或提高 `TDX_MIN_REQUEST_INTERVAL_MS`。本專案已加入快取、批次預覽與自動降級。
