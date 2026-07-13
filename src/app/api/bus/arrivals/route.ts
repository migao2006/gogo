import { NextRequest, NextResponse } from "next/server";
import { normalizeBusArrivals } from "@/lib/normalize";
import { tdxFetch } from "@/lib/tdx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeOData(value: string): string {
  return value.replaceAll("'", "''");
}

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city")?.trim();
  const stopUid = request.nextUrl.searchParams.get("stopUid")?.trim();
  if (!city || !/^[A-Za-z]+$/.test(city) || !stopUid || stopUid.length > 80) {
    return NextResponse.json({ error: "缺少有效的 city 或 stopUid" }, { status: 400 });
  }

  try {
    const payload = await tdxFetch<unknown>(`/v2/Bus/EstimatedTimeOfArrival/City/${city}`, {
      "$filter": `StopUID eq '${escapeOData(stopUid)}'`,
      "$orderby": "EstimateTime",
      "$format": "JSON",
    }, 15);
    const arrivals = normalizeBusArrivals(payload).slice(0, 30);
    return NextResponse.json({ arrivals, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "公車到站資料查詢失敗";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
