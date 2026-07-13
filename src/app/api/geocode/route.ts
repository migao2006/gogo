import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

function userAgent(): string {
  return process.env.GEOCODER_USER_AGENT ?? "TDX-Nearby-Transit/1.0";
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 2) {
    return NextResponse.json({ error: "請輸入至少 2 個字的地址或地標" }, { status: 400 });
  }

  try {
    const url = new URL("/search", NOMINATIM_BASE);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("countrycodes", "tw");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "5");
    url.searchParams.set("accept-language", "zh-TW");

    const response = await fetch(url, {
      headers: { "user-agent": userAgent(), accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!response.ok) throw new Error(`地理編碼服務回傳 HTTP ${response.status}`);

    const data = (await response.json()) as Array<Record<string, unknown>>;
    const results = data
      .map((item) => ({
        id: String(item.place_id ?? item.osm_id ?? Math.random()),
        name: String(item.display_name ?? "未知地點"),
        latitude: Number(item.lat),
        longitude: Number(item.lon),
      }))
      .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));

    return NextResponse.json({ results });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "地址搜尋暫時無法使用，請改用目前位置" }, { status: 502 });
  }
}
