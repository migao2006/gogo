import { NextRequest, NextResponse } from "next/server";
import { getBusRouteDirections } from "@/lib/bus-routes";
import { TdxHttpError } from "@/lib/tdx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
};

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city")?.trim();
  const routeUid = request.nextUrl.searchParams.get("routeUid")?.trim();

  if (!city || !/^[A-Za-z]+$/.test(city) || !routeUid || routeUid.length > 100) {
    return NextResponse.json(
      { error: "缺少有效的縣市或 RouteUID" },
      { status: 400, headers: CACHE_HEADERS }
    );
  }

  try {
    const directions = await getBusRouteDirections(city, routeUid);
    return NextResponse.json(
      {
        directions,
        updatedAt: new Date().toISOString(),
        warning: directions.length ? undefined : "此路線目前沒有可顯示的站序資料。",
      },
      { headers: CACHE_HEADERS }
    );
  } catch (error) {
    console.error(error);
    const rateLimited = error instanceof TdxHttpError && error.status === 429;
    return NextResponse.json(
      {
        directions: [],
        updatedAt: new Date().toISOString(),
        unavailable: true,
        warning: rateLimited
          ? "TDX 正在限制查詢頻率，站序稍後會自動恢復。"
          : "公車路線站序暫時無法取得。",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }
}
