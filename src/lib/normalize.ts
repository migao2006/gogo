import { haversineDistanceMeters } from "@/lib/geography";
import type { BusArrival, TransitStation } from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
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

function localizedName(value: unknown): { zh?: string; en?: string } {
  const record = asRecord(value);
  if (!record) return { zh: text(value) };
  return {
    zh:
      text(record.Zh_tw) ??
      text(record.ZhTw) ??
      text(record.zh_tw) ??
      text(record.Name),
    en: text(record.En) ?? text(record.en),
  };
}

function position(record: UnknownRecord): { lat?: number; lon?: number } {
  const pos = asRecord(record.StopPosition) ?? asRecord(record.Position) ?? record;
  return {
    lat:
      numberValue(pos.PositionLat) ??
      numberValue(pos.Latitude) ??
      numberValue(pos.lat),
    lon:
      numberValue(pos.PositionLon) ??
      numberValue(pos.Longitude) ??
      numberValue(pos.lon),
  };
}

function unwrapItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["Data", "data", "Items"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function normalizedBusName(value: string): string {
  return value
    .replaceAll("台", "臺")
    .replaceAll("(", "（")
    .replaceAll(")", "）")
    .replace(/\s+/g, "")
    .replace(/（?(向|往)[東西南北]{1,2}）?$/u, "")
    .trim();
}

function busDisplayName(value: string): string {
  return value
    .replaceAll("台", "臺")
    .replaceAll("(", "（")
    .replaceAll(")", "）")
    .replace(/\s+/g, " ")
    .replace(/\s*（?(向|往)[東西南北]{1,2}）?$/u, "")
    .trim();
}

function directionHint(...values: Array<string | undefined>): string | undefined {
  const source = values.filter(Boolean).join(" ");
  const match = source.match(/(?:向|往)(東北|東南|西北|西南|東|西|南|北)/u);
  return match ? `向${match[1]}` : undefined;
}

interface MutableBusGroup {
  normalizedName: string;
  station: TransitStation;
  stopUids: Set<string>;
  directionHints: Set<string>;
}

export function normalizeBusStops(
  payload: unknown,
  originLat: number,
  originLon: number,
  city: string,
  radius: number
): TransitStation[] {
  const groups: MutableBusGroup[] = [];
  const stationGroups = new Map<string, MutableBusGroup>();

  for (const item of unwrapItems(payload)) {
    const record = asRecord(item);
    if (!record) continue;
    const pos = position(record);
    if (pos.lat === undefined || pos.lon === undefined) continue;

    const distance = haversineDistanceMeters(originLat, originLon, pos.lat, pos.lon);
    if (distance > radius * 1.2) continue;

    const name = localizedName(record.StopName);
    const uid = text(record.StopUID) ?? text(record.StopID);
    if (!uid || !name.zh) continue;

    const stationId = text(record.StationID);
    const address = text(record.StopAddress);
    const normalizedName = normalizedBusName(name.zh);
    const hint = directionHint(name.zh, address);

    let group = stationId ? stationGroups.get(stationId) : undefined;

    if (!group) {
      group = groups.find((candidate) => {
        if (candidate.normalizedName !== normalizedName) return false;
        return haversineDistanceMeters(
          candidate.station.latitude,
          candidate.station.longitude,
          pos.lat!,
          pos.lon!
        ) <= 35;
      });
    }

    if (!group) {
      const groupKey = stationId ?? `near:${normalizedName}:${uid}`;
      group = {
        normalizedName,
        stopUids: new Set<string>(),
        directionHints: new Set<string>(),
        station: {
          id: `bus:${city}:${groupKey}`,
          uid,
          name: busDisplayName(name.zh),
          englishName: name.en,
          mode: "bus",
          latitude: pos.lat,
          longitude: pos.lon,
          distanceMeters: Math.round(distance),
          city,
          cityCode: text(record.CityCode),
          address,
          stationId,
          stopUids: [],
          directionHints: [],
          mergedStopCount: 1,
        },
      };
      groups.push(group);
      if (stationId) stationGroups.set(stationId, group);
    }

    group.stopUids.add(uid);
    if (hint) group.directionHints.add(hint);

    if (distance < group.station.distanceMeters) {
      group.station.uid = uid;
      group.station.latitude = pos.lat;
      group.station.longitude = pos.lon;
      group.station.distanceMeters = Math.round(distance);
      group.station.address = address ?? group.station.address;
      group.station.englishName = name.en ?? group.station.englishName;
    }

    if (!group.station.stationId && stationId) {
      group.station.stationId = stationId;
      stationGroups.set(stationId, group);
    }
  }

  return groups
    .map((group) => ({
      ...group.station,
      stopUids: [...group.stopUids].sort(),
      directionHints: [...group.directionHints],
      mergedStopCount: group.stopUids.size,
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export function normalizeBusArrivals(payload: unknown): BusArrival[] {
  const arrivals: BusArrival[] = [];

  for (const item of unwrapItems(payload)) {
    const record = asRecord(item);
    if (!record) continue;

    const routeName = localizedName(record.RouteName).zh ?? text(record.RouteID) ?? "未知路線";
    const destination =
      localizedName(record.DestinationStopName).zh ??
      text(record.DestinationStopNameZh) ??
      text(record.DestinationStopName) ??
      localizedName(record.TripHeadSign).zh ??
      text(record.TripHeadSign) ??
      text(record.DestinationStopID) ??
      "行駛方向未提供";

    arrivals.push({
      routeUid: text(record.RouteUID),
      subRouteUid: text(record.SubRouteUID),
      routeName,
      destination,
      direction: numberValue(record.Direction) ?? 0,
      estimateSeconds: numberValue(record.EstimateTime) ?? null,
      stopStatus: numberValue(record.StopStatus) ?? 0,
      stopUid: text(record.StopUID),
      stationId: text(record.StationID),
      stopSequence: numberValue(record.StopSequence),
      plateNumber: text(record.PlateNumb),
      isLastBus: record.IsLastBus === true,
      nextBusTime: text(record.NextBusTime),
      dataTime: text(record.SrcUpdateTime) ?? text(record.UpdateTime),
    });
  }

  return arrivals.sort((a, b) => {
    if (a.estimateSeconds === null && b.estimateSeconds === null) {
      return a.routeName.localeCompare(b.routeName, "zh-Hant");
    }
    if (a.estimateSeconds === null) return 1;
    if (b.estimateSeconds === null) return -1;
    return a.estimateSeconds - b.estimateSeconds;
  });
}
