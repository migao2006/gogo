import { NextRequest, NextResponse } from "next/server";
import { normalizeMetroArrivals } from "@/lib/normalize";
import { TdxHttpError, tdxFetch } from "@/lib/tdx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeOData(value: string): string {
  return value.replaceAll("'", "''");
}

function normalizeStationId(operatorId: string, value: string): string {
  const prefix = `${operatorId}-`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

export async function GET(request: NextRequest) {
  const operatorId = request.nextUrl.searchParams.get("operatorId")?.trim();
  const rawStationId =
    request.nextUrl.searchParams.get("stationId")?.trim() ??
    request.nextUrl.searchParams.get("stationUid")?.trim();

  if (
    !operatorId ||
    !/^[A-Z0-9]+$/.test(operatorId) ||
    !rawStationId ||
    rawStationId.length > 100
  ) {
    return NextResponse.json(
      { error: "缺少有效的 operatorId 或 stationId" },
      { status: 400 }
    );
  }

  const stationId = normalizeStationId(operatorId, rawStationId);
  const params = {
    "$filter": `StationID eq '${escapeOData(stationId)}'`,
    "$format": "JSON",
  };

  try {
    const payload = await tdxFetch<unknown>(
      `/v2/Rail/Metro/LiveBoard/${operatorId}`,
      params,
      10
    );

    const arrivals = normalizeMetroArrivals(payload).slice(0, 20);
    return NextResponse.json({
      arrivals,
      message: arrivals.length
        ? undefined
        : "此站目前沒有可顯示的捷運即時到站資料。",
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);

    if (error instanceof TdxHttpError && error.status === 429) {
      return NextResponse.json({
        arrivals: [],
        unavailable: true,
        message: "TDX 請求過於頻繁，請稍候 5～10 秒再重新整理。",
        updatedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      arrivals: [],
      unavailable: true,
      message: "捷運即時到站資料暫時無法取得，請稍後再試。",
      updatedAt: new Date().toISOString(),
    });
  }
}
