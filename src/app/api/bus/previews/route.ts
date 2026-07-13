import { NextRequest, NextResponse } from "next/server";
import { getBusStationPreviews } from "@/lib/bus-arrivals";
import type { TransitStation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isStation(value: unknown): value is TransitStation {
  if (!value || typeof value !== "object") return false;
  const station = value as Partial<TransitStation>;
  return Boolean(
    typeof station.id === "string" &&
    typeof station.uid === "string" &&
    typeof station.name === "string" &&
    typeof station.latitude === "number" &&
    typeof station.longitude === "number"
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { stations?: unknown[] };
    const stations = (body.stations ?? []).filter(isStation).slice(0, 8);
    if (!stations.length) {
      return NextResponse.json({ previews: [] });
    }

    const previews = await getBusStationPreviews(stations);
    return NextResponse.json({ previews, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "站牌即時預覽暫時無法取得" }, { status: 502 });
  }
}
