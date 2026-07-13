# GitHub＋Vercel 部署

1. 解壓縮 ZIP。
2. 將解壓後資料夾內的所有檔案上傳到 GitHub Repository 根目錄。
3. Repository 根目錄應直接看見 `src`、`public`、`package.json`、`package-lock.json`。
4. 不要上傳 `.env.local`，也不要把 TDX 金鑰寫入 GitHub。
5. Vercel 連接 GitHub Repository 後，設定 `TDX_CLIENT_ID` 與 `TDX_CLIENT_SECRET`。
6. 推送到 `main` 後，Vercel 會自動部署。

若部署沒有自動觸發，可在 Vercel 的 Deployments 頁面選擇最新 Commit 並按 Redeploy。不要勾選使用舊 Build Cache。
