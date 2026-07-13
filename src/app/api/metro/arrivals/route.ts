import { NextRequest, NextResponse } from "next/server";
import { estimateMetroArrivals } from "@/lib/metro-estimator";
import { normalizeMetroArrivals } from "@/lib/normalize";
import { TdxHttpError, tdxFetch } from "@/lib/tdx";
import type { MetroArrival } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeOData(value: string): string {
  return value.replaceAll("'", "''");
}

function normalizeStationId(operatorId: string, value: string): string {
  const prefix = `${operatorId}-`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

async function fetchRoutePatterns(operatorId: string): Promise<unknown> {
  try {
    const routes = await tdxFetch<unknown>(
      `/v2/Rail/Metro/StationOfRoute/${operatorId}`,
      { "$format": "JSON" },
      21_600
    );
    if (Array.isArray(routes) && routes.length) return routes;
  } catch (error) {
    console.warn(`StationOfRoute ${operatorId} unavailable`, error);
  }

  return tdxFetch<unknown>(
    `/v2/Rail/Metro/StationOfLine/${operatorId}`,
    { "$format": "JSON" },
    21_600
  );
}

function mergeArrivals(official: MetroArrival[], estimated: MetroArrival[]): MetroArrival[] {
  const merged: MetroArrival[] = [];
  const officialKeys = new Set<string>();

  for (const arrival of official) {
    const key = `${arrival.lineId ?? ""}:${arrival.direction ?? ""}:${arrival.destination}`;
    officialKeys.add(key);
    merged.push(arrival);
  }

  for (const arrival of estimated) {
    const exactTrain = arrival.trainNumber
      ? merged.some((item) => item.trainNumber === arrival.trainNumber)
      : false;
    if (exactTrain) continue;

    const key = `${arrival.lineId ?? ""}:${arrival.direction ?? ""}:${arrival.destination}`;
    const hasNearOfficial = officialKeys.has(key) && official.some((item) => {
      if (item.estimateSeconds === null || arrival.estimateSeconds === null) return false;
      return Math.abs(item.estimateSeconds - arrival.estimateSeconds) <= 90;
    });
    if (!hasNearOfficial) merged.push(arrival);
  }

  return merged
    .sort((a, b) => (a.estimateSeconds ?? Infinity) - (b.estimateSeconds ?? Infinity))
    .slice(0, 30);
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
  const calculatedAt = new Date().toISOString();
  let official: MetroArrival[] = [];
  let estimated: MetroArrival[] = [];
  const warnings: string[] = [];

  try {
    const liveBoardPayload = await tdxFetch<unknown>(
      `/v2/Rail/Metro/LiveBoard/${operatorId}`,
      {
        "$filter": `StationID eq '${escapeOData(stationId)}'`,
        "$format": "JSON",
      },
      8
    );
    official = normalizeMetroArrivals(liveBoardPayload).map((arrival) => ({
      ...arrival,
      source: "official",
      confidence: "high",
      calculatedAt,
    }));
  } catch (error) {
    if (!(error instanceof TdxHttpError && error.status === 404)) {
      console.warn("Metro LiveBoard unavailable", error);
      warnings.push("官方即時看板暫時無法取得，已改用列車位置推估");
    }
  }

  try {
    const [routePayload, segmentPayload, livePositionPayload] = await Promise.all([
      fetchRoutePatterns(operatorId),
      tdxFetch<unknown>(
        `/v2/Rail/Metro/S2STravelTime/${operatorId}`,
        { "$format": "JSON" },
        21_600
      ),
      tdxFetch<unknown>(
        `/v2/Rail/Metro/LivePosition/${operatorId}`,
        { "$format": "JSON" },
        8
      ),
    ]);

    estimated = estimateMetroArrivals({
      operatorId,
      targetStationId: stationId,
      routePayload,
      segmentPayload,
      livePositionPayload,
      calculatedAt,
    });
  } catch (error) {
    console.warn("Metro ETA estimation unavailable", error);
    warnings.push("列車位置或站間時間暫時無法取得");
  }

  const arrivals = mergeArrivals(official, estimated);
  const hasOfficial = arrivals.some((arrival) => arrival.source === "official");
  const hasEstimated = arrivals.some((arrival) => arrival.source === "estimated");

  return NextResponse.json({
    arrivals,
    sourceSummary: hasOfficial && hasEstimated
      ? "TDX 官方即時＋系統推估"
      : hasOfficial
        ? "TDX 官方即時"
        : hasEstimated
          ? "系統推估"
          : "暫無資料",
    message: arrivals.length
      ? undefined
      : "目前沒有可計算的捷運到站資料，可能是業者未提供列車位置。",
    warnings,
    updatedAt: calculatedAt,
  });
}
