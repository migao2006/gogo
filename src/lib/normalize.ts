import { haversineDistanceMeters } from "@/lib/geography";
import type { BusArrival, MetroArrival, TransitStation } from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

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
  const pos =
    asRecord(record.StopPosition) ??
    asRecord(record.StationPosition) ??
    asRecord(record.Position) ??
    record;
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
  for (const key of [
    "Stations",
    "StationLiveBoards",
    "LiveBoards",
    "Data",
    "data",
    "Items",
  ]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

export function normalizeBusStops(
  payload: unknown,
  originLat: number,
  originLon: number,
  city: string,
  radius: number
): TransitStation[] {
  const unique = new Map<string, TransitStation>();

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
    const key = `${uid}:${pos.lat.toFixed(6)}:${pos.lon.toFixed(6)}`;

    unique.set(key, {
      id: `bus:${uid}`,
      uid,
      name: name.zh,
      englishName: name.en,
      mode: "bus",
      latitude: pos.lat,
      longitude: pos.lon,
      distanceMeters: Math.round(distance),
      city,
      cityCode: text(record.CityCode),
      address: text(record.StopAddress),
      stationId: text(record.StationID),
    });
  }

  return [...unique.values()].sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export function normalizeMetroStations(
  payload: unknown,
  originLat: number,
  originLon: number,
  operatorId: string | undefined,
  radius: number
): TransitStation[] {
  const unique = new Map<string, TransitStation>();

  for (const item of unwrapItems(payload)) {
    const record = asRecord(item);
    if (!record) continue;
    const pos = position(record);
    if (pos.lat === undefined || pos.lon === undefined) continue;
    const distance = haversineDistanceMeters(originLat, originLon, pos.lat, pos.lon);
    if (distance > radius * 1.2) continue;

    const name = localizedName(record.StationName);
    const stationId = text(record.StationID) ?? text(record.StationUID);
    const operator = text(record.OperatorID) ?? operatorId;
    if (!stationId || !name.zh) continue;
    const key = `${operator ?? "metro"}:${stationId}`;

    unique.set(key, {
      id: `metro:${operator ?? "unknown"}:${stationId}`,
      uid: text(record.StationUID) ?? stationId,
      stationId,
      name: name.zh,
      englishName: name.en,
      mode: "metro",
      latitude: pos.lat,
      longitude: pos.lon,
      distanceMeters: Math.round(distance),
      operatorId: operator,
      lineId: text(record.LineID) ?? text(record.LineNO) ?? text(record.LineNo),
      address: text(record.StationAddress),
    });
  }

  return [...unique.values()].sort((a, b) => a.distanceMeters - b.distanceMeters);
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
      routeName,
      destination,
      direction: numberValue(record.Direction) ?? 0,
      estimateSeconds: numberValue(record.EstimateTime) ?? null,
      stopStatus: numberValue(record.StopStatus) ?? 0,
      plateNumber: text(record.PlateNumb),
      isLastBus: record.IsLastBus === true,
      nextBusTime: text(record.NextBusTime),
      dataTime: text(record.SrcUpdateTime) ?? text(record.UpdateTime),
    });
  }

  return arrivals.sort((a, b) => {
    if (a.estimateSeconds === null && b.estimateSeconds === null) return a.routeName.localeCompare(b.routeName, "zh-Hant");
    if (a.estimateSeconds === null) return 1;
    if (b.estimateSeconds === null) return -1;
    return a.estimateSeconds - b.estimateSeconds;
  });
}

export function normalizeMetroArrivals(payload: unknown): MetroArrival[] {
  const arrivals: MetroArrival[] = [];
  for (const item of unwrapItems(payload)) {
    const record = asRecord(item);
    if (!record) continue;

    const nested = asArray(record.LiveBoards);
    if (nested.length) {
      arrivals.push(...normalizeMetroArrivals(nested));
      continue;
    }

    const destination =
      localizedName(record.DestinationStationName).zh ??
      localizedName(record.DestinationName).zh ??
      localizedName(record.TripHeadSign).zh ??
      text(record.DestinationStationID) ??
      text(record.Destination) ??
      "目的地未提供";

    arrivals.push({
      lineId: text(record.LineID) ?? text(record.LineNO) ?? text(record.LineNo),
      routeName:
        localizedName(record.LineName).zh ??
        localizedName(record.RouteName).zh,
      destination,
      direction: numberValue(record.Direction),
      estimateSeconds:
        numberValue(record.EstimateTime) !== undefined
          ? numberValue(record.EstimateTime)! * 60
          : numberValue(record.CountDown) ??
            numberValue(record.EstimatedTime) ??
            numberValue(record.ArrivalTime) ??
            null,
      platform: text(record.Platform),
      trainNumber: text(record.TrainNumber),
      arrivalTime: text(record.ArrivalTime),
      trainStatus: numberValue(record.TrainStatus),
      dataTime: text(record.UpdateTime) ?? text(record.SrcUpdateTime),
    });
  }

  return arrivals.sort((a, b) => {
    if (a.estimateSeconds === null && b.estimateSeconds === null) return 0;
    if (a.estimateSeconds === null) return 1;
    if (b.estimateSeconds === null) return -1;
    return a.estimateSeconds - b.estimateSeconds;
  });
}
