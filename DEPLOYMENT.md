# GitHub＋Vercel 部署

1. 解壓縮 ZIP。
2. 將資料夾內的檔案放到 GitHub Repository 根目錄。
3. 根目錄應直接看到 `src`、`public`、`package.json`、`package-lock.json`。
4. Vercel 匯入該 Repository，Framework 選 Next.js。
5. 在 Environment Variables 新增 `TDX_CLIENT_ID` 與 `TDX_CLIENT_SECRET`。
6. 部署後開啟 `/api/health` 檢查認證。

更新版本時，直接覆蓋同名檔案並 Commit；不要先刪除整個 Repository。Vercel 會從 `main` 自動部署。
