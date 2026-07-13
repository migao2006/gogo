import { NextRequest, NextResponse } from "next/server";
import { bearingDegrees, bearingLabel } from "@/lib/geography";
import { normalizeBusArrivals } from "@/lib/normalize";
import { tdxFetch } from "@/lib/tdx";
import type {
  BusArrival,
  BusDeparture,
  BusDirectionGroup,
  BusRouteArrival,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

function escapeOData(value: string): string {
  return value.replaceAll("'", "''");
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function localizedName(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return text(value);
  return text(record.Zh_tw) ?? text(record.ZhTw) ?? text(record.Name) ?? text(record.En);
}

function unwrap(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["StopOfRoutes", "Data", "Items"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

interface RouteDirectionProfile {
  routeUid?: string;
  subRouteUid?: string;
  direction: number;
  destination: string;
  heading?: string;
  bearing?: number;
}

function routeProfileKey(routeUid: string | undefined, subRouteUid: string | undefined, direction: number): string {
  return `${subRouteUid ?? routeUid ?? "unknown"}:${direction}`;
}

function buildRouteProfiles(
  payload: unknown,
  requestedStopUids: Set<string>,
  stationId?: string
): Map<string, RouteDirectionProfile> {
  const profiles = new Map<string, RouteDirectionProfile>();

  for (const item of unwrap(payload)) {
    const record = asRecord(item);
    if (!record) continue;
    const routeUid = text(record.RouteUID);
    const subRouteUid = text(record.SubRouteUID);
    const direction = numberValue(record.Direction) ?? 0;
    const stops = asArray(record.Stops).map(asRecord).filter((value): value is UnknownRecord => value !== null);
    if (!stops.length) continue;

    const index = stops.findIndex((stop) => {
      const stopUid = text(stop.StopUID);
      const stopStationId = text(stop.StationID);
      return Boolean(
        (stopUid && requestedStopUids.has(stopUid)) ||
        (stationId && stopStationId === stationId)
      );
    });

    const destination = localizedName(stops.at(-1)?.StopName) ?? "終點站未提供";
    let heading: string | undefined;
    let bearing: number | undefined;

    if (index >= 0 && index < stops.length - 1) {
      const currentPosition = asRecord(stops[index].StopPosition);
      const nextPosition = asRecord(stops[index + 1].StopPosition);
      const currentLat = numberValue(currentPosition?.PositionLat);
      const currentLon = numberValue(currentPosition?.PositionLon);
      const nextLat = numberValue(nextPosition?.PositionLat);
      const nextLon = numberValue(nextPosition?.PositionLon);
      if (
        currentLat !== undefined &&
        currentLon !== undefined &&
        nextLat !== undefined &&
        nextLon !== undefined
      ) {
        bearing = bearingDegrees(currentLat, currentLon, nextLat, nextLon);
        heading = bearingLabel(bearing);
      }
    }

    profiles.set(routeProfileKey(routeUid, subRouteUid, direction), {
      routeUid,
      subRouteUid,
      direction,
      destination,
      heading,
      bearing,
    });

    if (routeUid) {
      profiles.set(routeProfileKey(routeUid, undefined, direction), {
        routeUid,
        subRouteUid,
        direction,
        destination,
        heading,
        bearing,
      });
    }
  }

  return profiles;
}

function enrichArrivals(
  arrivals: BusArrival[],
  profiles: Map<string, RouteDirectionProfile>
): BusArrival[] {
  return arrivals.map((arrival) => {
    const profile =
      profiles.get(routeProfileKey(arrival.routeUid, arrival.subRouteUid, arrival.direction)) ??
      profiles.get(routeProfileKey(arrival.routeUid, undefined, arrival.direction));
    return {
      ...arrival,
      destination:
        profile?.destination && profile.destination !== "終點站未提供"
          ? profile.destination
          : arrival.destination,
      heading: profile?.heading ?? (arrival.direction === 0 ? "去程" : "返程"),
      bearing: profile?.bearing,
    };
  });
}

function departureFromArrival(arrival: BusArrival): BusDeparture {
  return {
    estimateSeconds: arrival.estimateSeconds,
    stopStatus: arrival.stopStatus,
    plateNumber: arrival.plateNumber,
    isLastBus: arrival.isLastBus,
    nextBusTime: arrival.nextBusTime,
    dataTime: arrival.dataTime,
  };
}

function buildDirectionGroups(arrivals: BusArrival[]): BusDirectionGroup[] {
  const groupMap = new Map<string, Map<string, BusRouteArrival>>();
  const destinationMap = new Map<string, Set<string>>();

  for (const arrival of arrivals) {
    const groupKey = arrival.heading ?? `方向 ${arrival.direction + 1}`;
    if (!groupMap.has(groupKey)) groupMap.set(groupKey, new Map());
    if (!destinationMap.has(groupKey)) destinationMap.set(groupKey, new Set());
    if (arrival.destination && arrival.destination !== "行駛方向未提供") {
      destinationMap.get(groupKey)!.add(arrival.destination);
    }

    const routeKey = `${arrival.routeUid ?? arrival.routeName}:${arrival.direction}:${arrival.destination}`;
    const routes = groupMap.get(groupKey)!;
    const existing = routes.get(routeKey);
    const departure = departureFromArrival(arrival);

    if (existing) {
      const duplicate = existing.departures.some((item) =>
        item.estimateSeconds === departure.estimateSeconds &&
        item.nextBusTime === departure.nextBusTime &&
        item.plateNumber === departure.plateNumber
      );
      if (!duplicate) existing.departures.push(departure);
    } else {
      routes.set(routeKey, {
        key: routeKey,
        routeUid: arrival.routeUid,
        routeName: arrival.routeName,
        destination: arrival.destination,
        direction: arrival.direction,
        departures: [departure],
      });
    }
  }

  return [...groupMap.entries()].map(([key, routes]) => {
    const routeList = [...routes.values()].map((route) => ({
      ...route,
      departures: route.departures
        .sort((a, b) => (a.estimateSeconds ?? Infinity) - (b.estimateSeconds ?? Infinity))
        .slice(0, 2),
    })).sort((a, b) => {
      const aEta = a.departures[0]?.estimateSeconds ?? Infinity;
      const bEta = b.departures[0]?.estimateSeconds ?? Infinity;
      return aEta - bEta || a.routeName.localeCompare(b.routeName, "zh-Hant");
    });
    const destinations = [...(destinationMap.get(key) ?? new Set<string>())].slice(0, 3);
    return {
      key,
      label: key,
      destinationSummary: destinations.length ? `往 ${destinations.join("、")}` : "目的地方向未提供",
      routes: routeList,
    };
  }).sort((a, b) => {
    const aEta = a.routes[0]?.departures[0]?.estimateSeconds ?? Infinity;
    const bEta = b.routes[0]?.departures[0]?.estimateSeconds ?? Infinity;
    return aEta - bEta;
  });
}

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city")?.trim();
  const stationId = request.nextUrl.searchParams.get("stationId")?.trim();
  const stopUids = (request.nextUrl.searchParams.get("stopUids") ?? request.nextUrl.searchParams.get("stopUid") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 40);

  if (!city || !/^[A-Za-z]+$/.test(city) || (!stationId && !stopUids.length)) {
    return NextResponse.json({ error: "缺少有效的 city、stationId 或 stopUids" }, { status: 400 });
  }

  const etaFilter = stationId
    ? `StationID eq '${escapeOData(stationId)}'`
    : stopUids.map((uid) => `StopUID eq '${escapeOData(uid)}'`).join(" or ");

  try {
    const payload = await tdxFetch<unknown>(`/v2/Bus/EstimatedTimeOfArrival/City/${city}`, {
      "$filter": etaFilter,
      "$orderby": "EstimateTime",
      "$format": "JSON",
    }, 15);
    const rawArrivals = normalizeBusArrivals(payload).slice(0, 80);
    const routeUids = [...new Set(rawArrivals.map((arrival) => arrival.routeUid).filter((value): value is string => Boolean(value)))].slice(0, 30);

    let enrichedArrivals = rawArrivals;
    const warnings: string[] = [];
    if (routeUids.length) {
      try {
        const routeFilter = routeUids.map((uid) => `RouteUID eq '${escapeOData(uid)}'`).join(" or ");
        const stopOfRoutePayload = await tdxFetch<unknown>(
          `/v2/Bus/StopOfRoute/City/${city}`,
          {
            "$filter": routeFilter,
            "$top": 100,
            "$format": "JSON",
          },
          300
        );
        const profiles = buildRouteProfiles(stopOfRoutePayload, new Set(stopUids), stationId);
        enrichedArrivals = enrichArrivals(rawArrivals, profiles);
      } catch (error) {
        console.warn("Bus direction enrichment failed", error);
        warnings.push("部分路線無法取得東西南北方向，已改以去程／返程顯示");
        enrichedArrivals = enrichArrivals(rawArrivals, new Map());
      }
    }

    const directionGroups = buildDirectionGroups(enrichedArrivals);
    return NextResponse.json({
      arrivals: enrichedArrivals,
      directionGroups,
      warnings,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "公車到站資料查詢失敗";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
