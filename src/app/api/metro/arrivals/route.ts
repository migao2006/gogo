import { NextRequest, NextResponse } from "next/server";
import { normalizeMetroArrivals } from "@/lib/normalize";
import { firstSuccessfulTdxFetch } from "@/lib/tdx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeOData(value: string): string {
  return value.replaceAll("'", "''");
}

export async function GET(request: NextRequest) {
  const operatorId = request.nextUrl.searchParams.get("operatorId")?.trim();
  const stationUid = request.nextUrl.searchParams.get("stationUid")?.trim();
  if (!operatorId || !/^[A-Z0-9]+$/.test(operatorId) || !stationUid || stationUid.length > 100) {
    return NextResponse.json({ error: "缺少有效的 operatorId 或 stationUid" }, { status: 400 });
  }

  const params = {
    "$filter": `StationUID eq '${escapeOData(stationUid)}'`,
    "$format": "JSON",
  };

  try {
    const payload = await firstSuccessfulTdxFetch<unknown>([
      { path: `/v2/Rail/Metro/LiveBoard/${operatorId}`, params },
      { path: `/v3/Rail/Metro/LiveBoard/${operatorId}`, params },
      { path: `/v3/Rail/Metro/StationLiveBoard/${operatorId}`, params },
    ], 10);

    const arrivals = normalizeMetroArrivals(payload).slice(0, 20);
    return NextResponse.json({ arrivals, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    return NextResponse.json({
      arrivals: [],
      unavailable: true,
      message: "此捷運系統目前未透過 TDX 提供可用的即時到站資料，或資料暫時中斷。",
      updatedAt: new Date().toISOString(),
    });
  }
}
