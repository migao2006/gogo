import { bearingDegrees, bearingLabel, haversineDistanceMeters } from "@/lib/geography";
import { getSupabaseAdmin, isSupabaseStaticConfigured } from "@/lib/supabase-admin";
import { getTdxToken } from "@/lib/tdx";
import type {
  BusRouteDirection,
  BusRouteSearchResult,
  TransitStation,
} from "@/lib/types";

const TDX_API_BASE = "https://tdx.transportdata.tw/api/basic";
const STATIC_FETCH_TIMEOUT_MS = 60_000;
const BATCH_SIZE = 500;

type UnknownRecord = Record<string, unknown>;

export interface StaticRouteStopRow {
  city: string;
  route_uid: string;
  subroute_uid: string;
  direction: number;
  stop_sequence: number;
  route_name: string;
  departure?: string | null;
  destination?: string | null;
  stop_uid?: string | null;
  stop_id?: string | null;
  station_id?: string | null;
  stop_name: string;
  latitude?: number | null;
  longitude?: number | null;
  next_stop_uid?: string | null;
  next_stop_name?: string | null;
  heading?: string | null;
  bearing?: number | null;
}

export interface StaticArrivalProfile {
  destination: string;
  heading?: string;
  bearing?: number;
  nextStopName?: string;
}

export interface StaticSyncResult {
  city: string;
  routes: number;
  stations: number;
  routeStops: number;
  batchId: string;
  completedAt: string;
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

function unwrap(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function normalizeSearchText(value: string): string {
  return value.replaceAll("臺", "台").replace(/\s+/g, " ").trim().toLowerCase();
}

function directionHintsFromName(value: string): string[] {
  const hints = new Set<string>();
  const patterns = ["向東", "向西", "向南", "向北", "東向", "西向", "南向", "北向"];
  for (const pattern of patterns) {
    if (value.includes(pattern)) hints.add(pattern.replace("東向", "向東").replace("西向", "向西").replace("南向", "向南").replace("北向", "向北"));
  }
  return [...hints];
}

function staticRouteKey(routeUid: string | undefined, subRouteUid: string | undefined, direction: number): string {
  return `${subRouteUid || routeUid || "unknown"}:${direction}`;
}

async function cityIsReady(city: string): Promise<boolean> {
  if (!isSupabaseStaticConfigured()) return false;
  const { data, error } = await getSupabaseAdmin()
    .from("bus_static_sync_state")
    .select("status,last_success_at")
    .eq("city", city)
    .maybeSingle();
  if (error) {
    console.warn("Supabase sync state lookup failed", error.message);
    return false;
  }
  return data?.status === "success" && Boolean(data.last_success_at);
}

export async function findNearbyStaticStations(
  city: string,
  lat: number,
  lon: number,
  radius: number
): Promise<TransitStation[] | null> {
  if (!(await cityIsReady(city))) return null;

  const { data, error } = await getSupabaseAdmin().rpc("find_nearby_bus_stations", {
    p_city: city,
    p_lat: lat,
    p_lon: lon,
    p_radius_m: radius,
    p_limit: 80,
  });
  if (error) {
    console.warn("Supabase nearby station lookup failed", error.message);
    return null;
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: `bus:${city}:${String(row.station_key)}`,
    uid: Array.isArray(row.stop_uids) && row.stop_uids.length ? String(row.stop_uids[0]) : String(row.station_key),
    name: String(row.name),
    englishName: text(row.english_name),
    mode: "bus" as const,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    distanceMeters: Math.round(Number(row.distance_m)),
    city,
    cityCode: text(row.city_code),
    address: text(row.address),
    stationId: text(row.station_id),
    stopUids: Array.isArray(row.stop_uids) ? row.stop_uids.map(String) : [],
    directionHints: Array.isArray(row.direction_hints) ? row.direction_hints.map(String) : [],
    mergedStopCount: Array.isArray(row.stop_uids) ? row.stop_uids.length : 1,
  }));
}

export async function searchStaticBusRoutes(
  city: string,
  query: string
): Promise<BusRouteSearchResult[] | null> {
  if (!(await cityIsReady(city))) return null;
  const needle = normalizeSearchText(query);
  const safeNeedle = needle.replaceAll("%", "\\%").replaceAll("_", "\\_");
  const { data, error } = await getSupabaseAdmin()
    .from("bus_routes")
    .select("city,route_uid,route_name,departure,destination,operator_name")
    .eq("city", city)
    .ilike("search_text", `%${safeNeedle}%`)
    .limit(40);
  if (error) {
    console.warn("Supabase route search failed", error.message);
    return null;
  }

  return (data ?? [])
    .map((row) => ({
      key: String(row.route_uid),
      city: String(row.city),
      routeUid: String(row.route_uid),
      routeName: String(row.route_name),
      departure: row.departure ? String(row.departure) : "起點未提供",
      destination: row.destination ? String(row.destination) : "終點未提供",
      operatorName: row.operator_name ? String(row.operator_name) : undefined,
    }))
    .sort((a, b) => {
      const aExact = normalizeSearchText(a.routeName) === needle ? 0 : 1;
      const bExact = normalizeSearchText(b.routeName) === needle ? 0 : 1;
      return aExact - bExact || a.routeName.localeCompare(b.routeName, "zh-Hant");
    })
    .slice(0, 30);
}

export async function getStaticRouteStopRows(
  city: string,
  routeUids: string[]
): Promise<StaticRouteStopRow[] | null> {
  if (!routeUids.length || !(await cityIsReady(city))) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("bus_route_stops")
    .select("city,route_uid,subroute_uid,direction,stop_sequence,route_name,departure,destination,stop_uid,stop_id,station_id,stop_name,latitude,longitude,next_stop_uid,next_stop_name,heading,bearing")
    .eq("city", city)
    .in("route_uid", [...new Set(routeUids)].slice(0, 40))
    .order("route_uid")
    .order("direction")
    .order("stop_sequence");
  if (error) {
    console.warn("Supabase route stop lookup failed", error.message);
    return null;
  }
  return (data ?? []) as StaticRouteStopRow[];
}

export async function getStaticArrivalProfileRows(
  city: string,
  routeUids: string[],
  stopUids: string[],
  stationIds: string[] = []
): Promise<StaticRouteStopRow[] | null> {
  if (!routeUids.length || !(await cityIsReady(city))) return null;
  const client = getSupabaseAdmin();
  const columns = "city,route_uid,subroute_uid,direction,stop_sequence,route_name,departure,destination,stop_uid,stop_id,station_id,stop_name,latitude,longitude,next_stop_uid,next_stop_name,heading,bearing";
  const routeValues = [...new Set(routeUids)].slice(0, 40);
  const rows = new Map<string, StaticRouteStopRow>();

  if (stopUids.length) {
    const { data, error } = await client
      .from("bus_route_stops")
      .select(columns)
      .eq("city", city)
      .in("route_uid", routeValues)
      .in("stop_uid", [...new Set(stopUids)].slice(0, 60))
      .limit(2000);
    if (error) {
      console.warn("Supabase arrival profile lookup failed", error.message);
      return null;
    }
    for (const row of (data ?? []) as StaticRouteStopRow[]) {
      rows.set(`${row.route_uid}:${row.subroute_uid}:${row.direction}:${row.stop_sequence}`, row);
    }
  }

  if (stationIds.length) {
    const { data, error } = await client
      .from("bus_route_stops")
      .select(columns)
      .eq("city", city)
      .in("route_uid", routeValues)
      .in("station_id", [...new Set(stationIds)].slice(0, 20))
      .limit(2000);
    if (error) {
      console.warn("Supabase station profile lookup failed", error.message);
      return rows.size ? [...rows.values()] : null;
    }
    for (const row of (data ?? []) as StaticRouteStopRow[]) {
      rows.set(`${row.route_uid}:${row.subroute_uid}:${row.direction}:${row.stop_sequence}`, row);
    }
  }

  return [...rows.values()];
}

export function buildStaticArrivalProfiles(
  rows: StaticRouteStopRow[],
  requestedStopUids: Set<string>,
  stationId?: string
): Map<string, StaticArrivalProfile> {
  const profiles = new Map<string, StaticArrivalProfile>();
  for (const row of rows) {
    const matches =
      (row.stop_uid && requestedStopUids.has(row.stop_uid)) ||
      (stationId && row.station_id === stationId);
    if (!matches) continue;
    const profile: StaticArrivalProfile = {
      destination: row.destination || "終點站未提供",
      heading: row.heading || undefined,
      bearing: row.bearing ?? undefined,
      nextStopName: row.next_stop_name || undefined,
    };
    profiles.set(staticRouteKey(row.route_uid, row.subroute_uid, row.direction), profile);
    profiles.set(staticRouteKey(row.route_uid, undefined, row.direction), profile);
  }
  return profiles;
}

export async function getStaticBusRouteDirections(
  city: string,
  routeUid: string
): Promise<BusRouteDirection[] | null> {
  const rows = await getStaticRouteStopRows(city, [routeUid]);
  if (!rows) return null;

  const grouped = new Map<string, BusRouteDirection>();
  for (const row of rows) {
    const key = `${row.subroute_uid || row.route_uid}:${row.direction}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        routeUid: row.route_uid,
        subRouteUid: row.subroute_uid || undefined,
        routeName: row.route_name,
        direction: row.direction,
        departure: row.departure || "起點未提供",
        destination: row.destination || "終點未提供",
        stops: [],
      });
    }
    grouped.get(key)!.stops.push({
      stopUid: row.stop_uid || undefined,
      stopId: row.stop_id || undefined,
      name: row.stop_name,
      sequence: row.stop_sequence,
      latitude: row.latitude ?? undefined,
      longitude: row.longitude ?? undefined,
    });
  }

  return [...grouped.values()]
    .map((direction) => ({
      ...direction,
      stops: direction.stops.sort((a, b) => a.sequence - b.sequence),
    }))
    .sort((a, b) => a.direction - b.direction);
}

async function fetchStaticTdx(path: string): Promise<unknown> {
  const token = await getTdxToken();
  const url = new URL(`${TDX_API_BASE}${path}`);
  url.searchParams.set("$top", "10000");
  url.searchParams.set("$format", "JSON");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATIC_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`TDX 靜態資料同步失敗（HTTP ${response.status}）：${detail.slice(0, 160)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function upsertChunks(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
  const client = getSupabaseAdmin();
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const chunk = rows.slice(index, index + BATCH_SIZE);
    const { error } = await client.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table} 寫入失敗：${error.message}`);
  }
}

function parseRoutes(payload: unknown, city: string, batchId: string): Record<string, unknown>[] {
  return unwrap(payload, ["Routes", "Data", "Items"]).flatMap((value) => {
    const row = asRecord(value);
    if (!row) return [];
    const routeUid = text(row.RouteUID);
    const routeName = localizedName(row.RouteName) ?? text(row.RouteID);
    if (!routeUid || !routeName) return [];
    const departure = localizedName(row.DepartureStopName) ?? text(row.DepartureStopNameZh);
    const destination = localizedName(row.DestinationStopName) ?? text(row.DestinationStopNameZh);
    const firstOperator = asRecord(asArray(row.Operators)[0]);
    const operatorName = localizedName(row.OperatorName) ?? localizedName(firstOperator?.OperatorName);
    return [{
      city,
      route_uid: routeUid,
      route_id: text(row.RouteID),
      route_name: routeName,
      departure,
      destination,
      operator_name: operatorName,
      route_type: numberValue(row.BusRouteType),
      search_text: normalizeSearchText(`${routeName} ${departure ?? ""} ${destination ?? ""} ${operatorName ?? ""}`),
      source_updated_at: text(row.UpdateTime) ?? text(row.SrcUpdateTime),
      synced_at: new Date().toISOString(),
      sync_batch_id: batchId,
    }];
  });
}

function parseStations(payload: unknown, city: string, batchId: string): Record<string, unknown>[] {
  const groups = new Map<string, Record<string, unknown>>();
  for (const value of unwrap(payload, ["Stops", "Data", "Items"])) {
    const row = asRecord(value);
    if (!row) continue;
    const position = asRecord(row.StopPosition);
    const lat = numberValue(position?.PositionLat);
    const lon = numberValue(position?.PositionLon);
    const stopUid = text(row.StopUID);
    const stationId = text(row.StationID);
    const name = localizedName(row.StopName);
    if (!stopUid || !name || lat === undefined || lon === undefined) continue;
    const stationKey = stationId || stopUid;
    const existing = groups.get(stationKey);
    if (existing) {
      const existingStopUids = (existing.stop_uids as string[]) ?? [];
      const previousCount = Math.max(1, existingStopUids.length);
      existing.latitude = (Number(existing.latitude) * previousCount + lat) / (previousCount + 1);
      existing.longitude = (Number(existing.longitude) * previousCount + lon) / (previousCount + 1);
      const stopUids = new Set<string>(existingStopUids);
      stopUids.add(stopUid);
      existing.stop_uids = [...stopUids];
      const hints = new Set<string>((existing.direction_hints as string[]) ?? []);
      directionHintsFromName(name).forEach((hint) => hints.add(hint));
      existing.direction_hints = [...hints];
      continue;
    }
    groups.set(stationKey, {
      city,
      station_key: stationKey,
      station_id: stationId,
      name,
      english_name: localizedName(row.StopName)?.match(/[A-Za-z]/) ? localizedName(row.StopName) : undefined,
      latitude: lat,
      longitude: lon,
      address: text(row.StopAddress),
      city_code: text(row.LocationCityCode) ?? text(row.CityCode),
      stop_uids: [stopUid],
      direction_hints: directionHintsFromName(name),
      source_updated_at: text(row.UpdateTime) ?? text(row.SrcUpdateTime),
      synced_at: new Date().toISOString(),
      sync_batch_id: batchId,
    });
  }
  return [...groups.values()];
}

function parseRouteStops(payload: unknown, city: string, batchId: string): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  for (const value of unwrap(payload, ["StopOfRoutes", "Data", "Items"])) {
    const row = asRecord(value);
    if (!row) continue;
    const routeUid = text(row.RouteUID);
    const routeName = localizedName(row.RouteName) ?? text(row.RouteID);
    if (!routeUid || !routeName) continue;
    const subRouteUid = text(row.SubRouteUID) ?? "";
    const direction = numberValue(row.Direction) ?? 0;
    const stops = asArray(row.Stops).map(asRecord).filter((item): item is UnknownRecord => item !== null);
    if (!stops.length) continue;
    const departure = localizedName(stops[0]?.StopName);
    const destination = localizedName(stops.at(-1)?.StopName);

    stops.forEach((stop, index) => {
      const next = stops[index + 1];
      const position = asRecord(stop.StopPosition);
      const nextPosition = next ? asRecord(next.StopPosition) : null;
      const lat = numberValue(position?.PositionLat);
      const lon = numberValue(position?.PositionLon);
      const nextLat = numberValue(nextPosition?.PositionLat);
      const nextLon = numberValue(nextPosition?.PositionLon);
      const bearing = lat !== undefined && lon !== undefined && nextLat !== undefined && nextLon !== undefined
        ? bearingDegrees(lat, lon, nextLat, nextLon)
        : undefined;
      output.push({
        city,
        route_uid: routeUid,
        subroute_uid: subRouteUid,
        direction,
        stop_sequence: numberValue(stop.StopSequence) ?? index + 1,
        route_name: routeName,
        departure,
        destination,
        stop_uid: text(stop.StopUID),
        stop_id: text(stop.StopID),
        station_id: text(stop.StationID),
        stop_name: localizedName(stop.StopName) ?? "未知站牌",
        latitude: lat,
        longitude: lon,
        next_stop_uid: next ? text(next.StopUID) : undefined,
        next_stop_name: next ? localizedName(next.StopName) : undefined,
        heading: bearing === undefined ? undefined : bearingLabel(bearing),
        bearing,
        source_updated_at: text(row.UpdateTime) ?? text(row.SrcUpdateTime),
        synced_at: new Date().toISOString(),
        sync_batch_id: batchId,
      });
    });
  }
  return output;
}

export async function syncBusCityStatic(city: string): Promise<StaticSyncResult> {
  if (!/^[A-Za-z]+$/.test(city)) throw new Error("縣市代碼格式錯誤");
  if (!isSupabaseStaticConfigured()) throw new Error("Supabase 尚未設定");

  const client = getSupabaseAdmin();
  const batchId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await client.from("bus_static_sync_state").upsert({
    city,
    status: "running",
    last_started_at: startedAt,
    last_error: null,
    updated_at: startedAt,
  }, { onConflict: "city" });

  try {
    const routePayload = await fetchStaticTdx(`/v2/Bus/Route/City/${city}`);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const stationPayload = await fetchStaticTdx(`/v2/Bus/Stop/City/${city}`);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const routeStopPayload = await fetchStaticTdx(`/v2/Bus/StopOfRoute/City/${city}`);

    const routes = parseRoutes(routePayload, city, batchId);
    const stations = parseStations(stationPayload, city, batchId);
    const routeStops = parseRouteStops(routeStopPayload, city, batchId);

    await upsertChunks("bus_routes", routes, "city,route_uid");
    await upsertChunks("bus_stations", stations, "city,station_key");
    await upsertChunks("bus_route_stops", routeStops, "city,route_uid,subroute_uid,direction,stop_sequence");

    const cleanupTasks = [
      client.from("bus_routes").delete().eq("city", city).neq("sync_batch_id", batchId),
      client.from("bus_stations").delete().eq("city", city).neq("sync_batch_id", batchId),
      client.from("bus_route_stops").delete().eq("city", city).neq("sync_batch_id", batchId),
    ];
    const cleanupResults = await Promise.all(cleanupTasks);
    for (const result of cleanupResults) {
      if (result.error) throw new Error(`舊資料清理失敗：${result.error.message}`);
    }

    const completedAt = new Date().toISOString();
    const { error: stateError } = await client.from("bus_static_sync_state").upsert({
      city,
      status: "success",
      routes_count: routes.length,
      stations_count: stations.length,
      route_stops_count: routeStops.length,
      last_started_at: startedAt,
      last_success_at: completedAt,
      last_error: null,
      updated_at: completedAt,
    }, { onConflict: "city" });
    if (stateError) throw new Error(`同步狀態寫入失敗：${stateError.message}`);

    return { city, routes: routes.length, stations: stations.length, routeStops: routeStops.length, batchId, completedAt };
  } catch (error) {
    const failedAt = new Date().toISOString();
    await client.from("bus_static_sync_state").upsert({
      city,
      status: "failed",
      last_started_at: startedAt,
      last_error: error instanceof Error ? error.message.slice(0, 1000) : "未知錯誤",
      updated_at: failedAt,
    }, { onConflict: "city" });
    throw error;
  }
}

export async function getStaticSyncStates(): Promise<Record<string, unknown>[]> {
  if (!isSupabaseStaticConfigured()) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("bus_static_sync_state")
    .select("city,status,routes_count,stations_count,route_stops_count,last_started_at,last_success_at,last_error,updated_at")
    .order("city");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function staticDistanceMeters(lat: number, lon: number, station: { latitude: number; longitude: number }): number {
  return haversineDistanceMeters(lat, lon, station.latitude, station.longitude);
}
