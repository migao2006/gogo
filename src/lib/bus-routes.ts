import { tdxFetch } from "@/lib/tdx";
import type {
  BusRouteDirection,
  BusRouteSearchResult,
  BusRouteStop,
} from "@/lib/types";

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

function localizedName(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return text(value);
  return text(record.Zh_tw) ?? text(record.ZhTw) ?? text(record.Name) ?? text(record.En);
}

function unwrap(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["Routes", "StopOfRoutes", "Data", "Items"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function normalizeQuery(value: string): string {
  return value.replaceAll("臺", "台").replace(/\s+/g, "").toLowerCase();
}

export async function searchBusRoutes(
  city: string,
  query: string
): Promise<BusRouteSearchResult[]> {
  const payload = await tdxFetch<unknown>(
    `/v2/Bus/Route/City/${city}`,
    {
      "$top": 10_000,
      "$format": "JSON",
    },
    3_600
  );

  const needle = normalizeQuery(query);
  const unique = new Map<string, BusRouteSearchResult>();

  for (const item of unwrap(payload)) {
    const record = asRecord(item);
    if (!record) continue;

    const routeName = localizedName(record.RouteName) ?? text(record.RouteID);
    if (!routeName) continue;

    const departure =
      localizedName(record.DepartureStopNameZh) ??
      localizedName(record.DepartureStopName) ??
      text(record.DepartureStopNameZh) ??
      "起點未提供";
    const destination =
      localizedName(record.DestinationStopNameZh) ??
      localizedName(record.DestinationStopName) ??
      text(record.DestinationStopNameZh) ??
      "終點未提供";
    const routeUid = text(record.RouteUID);
    const operatorName = localizedName(record.OperatorName);

    const haystack = normalizeQuery(
      `${routeName} ${departure} ${destination} ${operatorName ?? ""}`
    );
    if (!haystack.includes(needle)) continue;

    const key = routeUid ?? `${routeName}:${departure}:${destination}`;
    if (!unique.has(key)) {
      unique.set(key, {
        key,
        city,
        routeUid,
        routeName,
        departure,
        destination,
        operatorName,
      });
    }
  }

  return [...unique.values()]
    .sort((a, b) => {
      const aExact = normalizeQuery(a.routeName) === needle ? 0 : 1;
      const bExact = normalizeQuery(b.routeName) === needle ? 0 : 1;
      return aExact - bExact || a.routeName.localeCompare(b.routeName, "zh-Hant");
    })
    .slice(0, 30);
}

export async function getBusRouteDirections(
  city: string,
  routeUid: string
): Promise<BusRouteDirection[]> {
  const escaped = routeUid.replaceAll("'", "''");
  const payload = await tdxFetch<unknown>(
    `/v2/Bus/StopOfRoute/City/${city}`,
    {
      "$filter": `RouteUID eq '${escaped}'`,
      "$top": 100,
      "$format": "JSON",
    },
    300
  );

  const directions: BusRouteDirection[] = [];

  for (const item of unwrap(payload)) {
    const record = asRecord(item);
    if (!record) continue;

    const routeName = localizedName(record.RouteName) ?? text(record.RouteID) ?? "未知路線";
    const direction = numberValue(record.Direction) ?? 0;
    const stops: BusRouteStop[] = asArray(record.Stops)
      .map(asRecord)
      .filter((value): value is UnknownRecord => value !== null)
      .map((stop, index) => {
        const position = asRecord(stop.StopPosition);
        return {
          stopUid: text(stop.StopUID),
          stopId: text(stop.StopID),
          name: localizedName(stop.StopName) ?? "未知站牌",
          sequence: numberValue(stop.StopSequence) ?? index + 1,
          latitude: numberValue(position?.PositionLat),
          longitude: numberValue(position?.PositionLon),
        };
      })
      .sort((a, b) => a.sequence - b.sequence);

    if (!stops.length) continue;
    const routeUidValue = text(record.RouteUID);
    const subRouteUid = text(record.SubRouteUID);

    directions.push({
      key: `${subRouteUid ?? routeUidValue ?? routeName}:${direction}`,
      routeUid: routeUidValue,
      subRouteUid,
      routeName,
      direction,
      departure: stops[0]?.name ?? "起點未提供",
      destination: stops.at(-1)?.name ?? "終點未提供",
      stops,
    });
  }

  return directions.sort((a, b) => a.direction - b.direction);
}
