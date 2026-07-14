import { NextRequest, NextResponse } from "next/server";
import { getBusArrivalData } from "@/lib/bus-arrivals";
import { TdxHttpError } from "@/lib/tdx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city")?.trim();
  const stationId = request.nextUrl.searchParams.get("stationId")?.trim();
  const stopUids = (
    request.nextUrl.searchParams.get("stopUids") ??
    request.nextUrl.searchParams.get("stopUid") ??
    ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 40);

  if (!city || !/^[A-Za-z]+$/.test(city) || !stopUids.length) {
    return NextResponse.json({ error: "缺少有效的 city 或 stopUids" }, { status: 400 });
  }

  try {
    const result = await getBusArrivalData(city, stopUids, stationId);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=45, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error(error);

    if (error instanceof TdxHttpError && error.status === 429) {
      return NextResponse.json(
        { error: "TDX 請求過於頻繁，請稍候幾秒再重新整理" },
        { status: 429 }
      );
    }

    const message = error instanceof Error ? error.message : "公車到站資料查詢失敗";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
