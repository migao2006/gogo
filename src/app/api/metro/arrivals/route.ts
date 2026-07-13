import { NextRequest, NextResponse } from "next/server";
import {
  estimateMetroArrivalsFromLiveBoard,
  liveBoardRows,
  liveBoardStationId,
  normalizeMetroStationId,
} from "@/lib/metro-estimator";
import { normalizeMetroArrivals } from "@/lib/normalize";
import { TdxHttpError, tdxFetch } from "@/lib/tdx";
import type { MetroArrival } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const merged: MetroArrival[] = [...official];

  for (const arrival of estimated) {
    const exactTrain = arrival.trainNumber
      ? merged.some((item) => item.trainNumber === arrival.trainNumber)
      : false;
    if (exactTrain) continue;

    const hasNearOfficial = official.some((item) => {
      if (
        item.lineId !== arrival.lineId ||
        item.direction !== arrival.direction ||
        item.destination !== arrival.destination ||
        item.estimateSeconds === null ||
        arrival.estimateSeconds === null
      ) {
        return false;
      }
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
  const rawStationIds = (
    request.nextUrl.searchParams.get("stationIds") ??
    request.nextUrl.searchParams.get("stationId") ??
    request.nextUrl.searchParams.get("stationUid") ??
    ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 6);

  if (
    !operatorId ||
    !/^[A-Z0-9]+$/.test(operatorId) ||
    !rawStationIds.length ||
    rawStationIds.some((value) => value.length > 100)
  ) {
    return NextResponse.json(
      { error: "缺少有效的 operatorId 或 stationIds" },
      { status: 400 }
    );
  }

  const stationIds = [...new Set(
    rawStationIds
      .map((value) => normalizeMetroStationId(operatorId, value))
      .filter((value): value is string => Boolean(value))
  )];
  if (!stationIds.length) {
    return NextResponse.json({ error: "無效的捷運 StationID" }, { status: 400 });
  }

  const calculatedAt = new Date().toISOString();
  const warnings: string[] = [];

  try {
    // 一次取得全線 LiveBoard：目標站資料直接當官方值，其餘站資料作為推估錨點。
    // 不再呼叫 TRTC 不支援的 LivePosition API。
    const [liveBoardPayload, routePayload, segmentPayload] = await Promise.all([
      tdxFetch<unknown>(
        `/v2/Rail/Metro/LiveBoard/${operatorId}`,
        { "$format": "JSON" },
        8
      ),
      fetchRoutePatterns(operatorId),
      tdxFetch<unknown>(
        `/v2/Rail/Metro/S2STravelTime/${operatorId}`,
        { "$format": "JSON" },
        21_600
      ),
    ]);

    const targetSet = new Set(stationIds);
    const officialRows = liveBoardRows(liveBoardPayload).filter((row) => {
      const id = liveBoardStationId(row, operatorId);
      return Boolean(id && targetSet.has(id));
    });
    const official = normalizeMetroArrivals(officialRows).map((arrival) => ({
      ...arrival,
      source: "official" as const,
      confidence: "high" as const,
      calculatedAt,
    }));

    const estimated = stationIds.flatMap((stationId) =>
      estimateMetroArrivalsFromLiveBoard({
        operatorId,
        targetStationId: stationId,
        routePayload,
        segmentPayload,
        liveBoardPayload,
        calculatedAt,
      })
    );

    const arrivals = mergeArrivals(official, estimated);
    const hasOfficial = arrivals.some((arrival) => arrival.source === "official");
    const hasEstimated = arrivals.some((arrival) => arrival.source === "estimated");

    return NextResponse.json({
      arrivals,
      sourceSummary:
        hasOfficial && hasEstimated
          ? "TDX 官方即時＋全線站序推估"
          : hasOfficial
            ? "TDX 官方即時"
            : hasEstimated
              ? "全線站序推估"
              : "暫無資料",
      message: arrivals.length
        ? undefined
        : "目前全線即時看板沒有足夠資料可推算此站到站時間。",
      warnings,
      updatedAt: calculatedAt,
    });
  } catch (error) {
    console.error("Metro arrivals failed", error);
    if (error instanceof TdxHttpError && error.status === 429) {
      return NextResponse.json({
        arrivals: [],
        sourceSummary: "暫無資料",
        message: "TDX 請求過於頻繁，請稍候 10 秒再重新整理。",
        warnings: [],
        updatedAt: calculatedAt,
      });
    }

    return NextResponse.json({
      arrivals: [],
      sourceSummary: "暫無資料",
      message: "捷運即時資料暫時無法取得，請稍後重新整理。",
      warnings: [],
      updatedAt: calculatedAt,
    });
  }
}
