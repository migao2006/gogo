import { NextRequest, NextResponse } from "next/server";
import {
  getBusRouteAlerts,
  getBusRouteLiveVehicles,
} from "@/lib/bus-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city")?.trim();
  const routeUid = request.nextUrl.searchParams.get("routeUid")?.trim();

  if (!city || !/^[A-Za-z]+$/.test(city) || !routeUid || routeUid.length > 100) {
    return NextResponse.json(
      { error: "缺少有效的縣市或 RouteUID" },
      { status: 400 }
    );
  }

  try {
    const [vehicles, alerts] = await Promise.all([
      getBusRouteLiveVehicles(city, routeUid),
      getBusRouteAlerts(city, routeUid),
    ]);

    return NextResponse.json({
      vehicles,
      alerts,
      updatedAt: new Date().toISOString(),
      warning: vehicles.length
        ? undefined
        : "目前沒有可顯示的車輛即時位置。",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        vehicles: [],
        alerts: [],
        updatedAt: new Date().toISOString(),
        warning: "車輛即時位置暫時無法取得。",
      },
      { status: 200 }
    );
  }
}
