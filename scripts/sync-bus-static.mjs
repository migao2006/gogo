const baseUrl = process.env.APP_BASE_URL;
const secret = process.env.STATIC_SYNC_SECRET;
const city = process.argv[2] || process.env.TDX_CITY || "ChanghuaCounty";

if (!baseUrl || !secret) {
  console.error("請設定 APP_BASE_URL 與 STATIC_SYNC_SECRET");
  process.exit(1);
}

const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/admin/sync/bus-static`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ city }),
});
const body = await response.text();
console.log(body);
if (!response.ok) process.exit(1);
