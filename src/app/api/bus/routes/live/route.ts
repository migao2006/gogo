import { NextRequest, NextResponse } from "next/server";
import { getBusRouteLiveVehicles } from "@/lib/bus-routes";
import { TdxHttpError } from "@/lib/tdx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
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
    const vehicles = await getBusRouteLiveVehicles(city, routeUid);

    return NextResponse.json(
      {
        vehicles,
        alerts: [],
        updatedAt: new Date().toISOString(),
        unavailable: vehicles.length === 0,
        warning: vehicles.length
          ? undefined
          : "此路線目前沒有業者提供的即時車輛定位。",
      },
      { headers: CACHE_HEADERS }
    );
  } catch (error) {
    console.error(error);
    const rateLimited = error instanceof TdxHttpError && error.status === 429;
    return NextResponse.json(
      {
        vehicles: [],
        alerts: [],
        updatedAt: new Date().toISOString(),
        unavailable: true,
        warning: rateLimited
          ? "TDX 正在限制查詢頻率，暫時不更新車輛定位。"
          : "車輛即時位置目前未提供。",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }
}
