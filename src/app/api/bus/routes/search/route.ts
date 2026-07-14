import { NextRequest, NextResponse } from "next/server";
import { searchBusRoutes } from "@/lib/bus-routes";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city")?.trim();
  const query = request.nextUrl.searchParams.get("q")?.trim();

  if (!city || !/^[A-Za-z]+$/.test(city) || !query || query.length > 40) {
    return NextResponse.json({ error: "缺少有效的縣市或路線關鍵字" }, { status: 400 });
  }

  try {
    const routes = await searchBusRoutes(city, query);
    return NextResponse.json({ routes });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "公車路線搜尋暫時無法使用" }, { status: 502 });
  }
}
