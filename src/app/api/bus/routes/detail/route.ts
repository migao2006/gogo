import { NextRequest, NextResponse } from "next/server";
import { getBusRouteDirections } from "@/lib/bus-routes";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city")?.trim();
  const routeUid = request.nextUrl.searchParams.get("routeUid")?.trim();

  if (!city || !/^[A-Za-z]+$/.test(city) || !routeUid || routeUid.length > 100) {
    return NextResponse.json({ error: "缺少有效的縣市或 RouteUID" }, { status: 400 });
  }

  try {
    const directions = await getBusRouteDirections(city, routeUid);
    return NextResponse.json({ directions, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "公車路線站序暫時無法取得" }, { status: 502 });
  }
}
