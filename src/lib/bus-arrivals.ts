import { bearingDegrees, bearingLabel } from "@/lib/geography";
import { normalizeBusArrivals } from "@/lib/normalize";
import { tdxFetch } from "@/lib/tdx";
import { buildStaticArrivalProfiles, getStaticArrivalProfileRows } from "@/lib/bus-static";
import type {
  BusArrival,
  BusArrivalResult,
  BusDeparture,
  BusDirectionGroup,
  BusRouteArrival,
  BusStationPreview,
  TransitStation,
} from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

interface RouteDirectionProfile {
  destination: string;
  heading?: string;
  bearing?: number;
  nextStopName?: string;
}

interface ArrivalCacheEntry {
  value: BusArrivalResult;
  freshUntil: number;
  staleUntil: number;
}

interface PreviewCacheEntry {
  value: BusStationPreview[];
  freshUntil: number;
  staleUntil: number;
}

const arrivalCache = new Map<string, ArrivalCacheEntry>();
const arrivalInFlight = new Map<string, Promise<BusArrivalResult>>();
const previewCache = new Map<string, PreviewCacheEntry>();
const previewInFlight = new Map<string, Promise<BusStationPreview[]>>();

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

function routeProfileKey(
  routeUid: string | undefined,
  subRouteUid: string | undefined,
  direction: number
): string {
  return `${subRouteUid ?? routeUid ?? "unknown"}:${direction}`;
}

export function buildRouteProfiles(
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
    const stops = asArray(record.Stops)
      .map(asRecord)
      .filter((value): value is UnknownRecord => value !== null);

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
    const nextStopName = index >= 0 ? localizedName(stops[index + 1]?.StopName) : undefined;
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

    const profile = { destination, heading, bearing, nextStopName };
    profiles.set(routeProfileKey(routeUid, subRouteUid, direction), profile);
    if (routeUid) profiles.set(routeProfileKey(routeUid, undefined, direction), profile);
  }

  return profiles;
}

export function enrichArrivals(
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
      heading: profile?.heading,
      bearing: profile?.bearing,
      nextStopName: profile?.nextStopName,
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

export function buildDirectionGroups(arrivals: BusArrival[]): BusDirectionGroup[] {
  const grouped = new Map<
    string,
    {
      heading?: string;
      direction: number;
      destinations: Set<string>;
      nextStops: Set<string>;
      routes: Map<string, BusRouteArrival>;
    }
  >();

  for (const arrival of arrivals) {
    const groupKey = arrival.heading
      ? `heading:${arrival.heading}`
      : `direction:${arrival.direction}`;

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        heading: arrival.heading,
        direction: arrival.direction,
        destinations: new Set<string>(),
        nextStops: new Set<string>(),
        routes: new Map<string, BusRouteArrival>(),
      });
    }

    const group = grouped.get(groupKey)!;
    if (arrival.destination && arrival.destination !== "行駛方向未提供") {
      group.destinations.add(arrival.destination);
    }
    if (arrival.nextStopName) group.nextStops.add(arrival.nextStopName);

    const routeKey = `${arrival.routeUid ?? arrival.routeName}:${arrival.direction}:${arrival.destination}`;
    const existing = group.routes.get(routeKey);
    const departure = departureFromArrival(arrival);

    if (existing) {
      const duplicate = existing.departures.some(
        (item) =>
          item.estimateSeconds === departure.estimateSeconds &&
          item.nextBusTime === departure.nextBusTime &&
          item.plateNumber === departure.plateNumber
      );
      if (!duplicate) existing.departures.push(departure);
    } else {
      group.routes.set(routeKey, {
        key: routeKey,
        routeUid: arrival.routeUid,
        routeName: arrival.routeName,
        destination: arrival.destination,
        direction: arrival.direction,
        nextStopName: arrival.nextStopName,
        departures: [departure],
      });
    }
  }

  return [...grouped.entries()]
    .map(([key, group], index) => {
      const destinations = [...group.destinations].slice(0, 4);
      const nextStops = [...group.nextStops].slice(0, 2);
      const routes = [...group.routes.values()]
        .map((route) => ({
          ...route,
          departures: route.departures
            .sort(
              (a, b) =>
                (a.estimateSeconds ?? Number.POSITIVE_INFINITY) -
                (b.estimateSeconds ?? Number.POSITIVE_INFINITY)
            )
            .slice(0, 2),
        }))
        .sort((a, b) => {
          const aEta = a.departures[0]?.estimateSeconds ?? Number.POSITIVE_INFINITY;
          const bEta = b.departures[0]?.estimateSeconds ?? Number.POSITIVE_INFINITY;
          return aEta - bEta || a.routeName.localeCompare(b.routeName, "zh-Hant");
        });

      return {
        key,
        label: group.heading ?? (group.direction === 0 ? "去程" : index === 0 ? "返程" : `方向 ${index + 1}`),
        destinationSummary: destinations.length
          ? `往 ${destinations.join("、")}`
          : "目的地方向未提供",
        nextStopSummary: nextStops.length ? `下一站：${nextStops.join("／")}` : undefined,
        routes,
      };
    })
    .sort((a, b) => {
      const aEta = a.routes[0]?.departures[0]?.estimateSeconds ?? Number.POSITIVE_INFINITY;
      const bEta = b.routes[0]?.departures[0]?.estimateSeconds ?? Number.POSITIVE_INFINITY;
      return aEta - bEta;
    });
}

function cacheKey(city: string, stopUids: string[]): string {
  return `${city}:${[...stopUids].sort().join(",")}`;
}

async function fetchArrivalData(
  city: string,
  stopUids: string[],
  stationId?: string
): Promise<BusArrivalResult> {
  void stationId;
  const etaFilter = stopUids
    .map((uid) => `StopUID eq '${escapeOData(uid)}'`)
    .join(" or ");

  const payload = await tdxFetch<unknown>(
    `/v2/Bus/EstimatedTimeOfArrival/City/${city}`,
    {
      "$filter": etaFilter,
      "$orderby": "EstimateTime",
      "$format": "JSON",
    },
    45
  );

  const rawArrivals = normalizeBusArrivals(payload).slice(0, 120);
  const warnings: string[] = [];
  const routeUids = [...new Set(rawArrivals.map((arrival) => arrival.routeUid).filter((value): value is string => Boolean(value)))];
  const staticRows = await getStaticArrivalProfileRows(city, routeUids, stopUids, stationId ? [stationId] : []);
  const profiles = staticRows
    ? buildStaticArrivalProfiles(staticRows, new Set(stopUids), stationId)
    : new Map();
  const arrivals = enrichArrivals(rawArrivals, profiles);

  return {
    arrivals,
    directionGroups: buildDirectionGroups(arrivals),
    warnings,
    updatedAt: new Date().toISOString(),
  };
}

export async function getBusArrivalData(
  city: string,
  stopUids: string[],
  stationId?: string
): Promise<BusArrivalResult> {
  const cleanStopUids = [...new Set(stopUids.filter(Boolean))].slice(0, 30);
  const key = cacheKey(city, cleanStopUids);
  const now = Date.now();
  const cached = arrivalCache.get(key);

  if (cached && cached.freshUntil > now) return cached.value;

  const existing = arrivalInFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const value = await fetchArrivalData(city, cleanStopUids, stationId);
      const savedAt = Date.now();
      arrivalCache.set(key, {
        value,
        freshUntil: savedAt + 45_000,
        staleUntil: savedAt + 30 * 60_000,
      });
      return value;
    } catch (error) {
      if (cached && cached.staleUntil > Date.now()) {
        return {
          ...cached.value,
          stale: true,
          cachedAt: cached.value.updatedAt,
          warnings: [
            ...cached.value.warnings,
            "即時資料暫時無法更新，目前顯示上次成功資料",
          ],
        };
      }
      throw error;
    } finally {
      arrivalInFlight.delete(key);
    }
  })();

  arrivalInFlight.set(key, request);
  return request;
}

export async function getBusStationPreviews(
  stations: TransitStation[]
): Promise<BusStationPreview[]> {
  const targets = stations
    .filter((station) => station.city && (station.stopUids?.length || station.uid))
    .slice(0, 6);
  const key = targets
    .map((station) => `${station.city}:${station.id}`)
    .sort()
    .join("|");
  const now = Date.now();
  const cached = previewCache.get(key);

  if (cached && cached.freshUntil > now) return cached.value;

  const existing = previewInFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    const byCity = new Map<string, TransitStation[]>();
    for (const station of targets) {
      const cityStations = byCity.get(station.city!) ?? [];
      cityStations.push(station);
      byCity.set(station.city!, cityStations);
    }

    const previewMap = new Map<string, BusStationPreview>();

    try {
      await Promise.all(
        [...byCity.entries()].map(async ([city, cityStations]) => {
          const allStopUids = [
            ...new Set(
              cityStations.flatMap((station) =>
                station.stopUids?.length ? station.stopUids.slice(0, 10) : [station.uid]
              )
            ),
          ].slice(0, 40);
          const etaFilter = allStopUids
            .map((uid) => `StopUID eq '${escapeOData(uid)}'`)
            .join(" or ");
          const etaPayload = await tdxFetch<unknown>(
            `/v2/Bus/EstimatedTimeOfArrival/City/${city}`,
            {
              "$filter": etaFilter,
              "$orderby": "EstimateTime",
              "$format": "JSON",
            },
            90
          );
          const allArrivals = normalizeBusArrivals(etaPayload).slice(0, 240);
          const routeUids = [...new Set(allArrivals.map((arrival) => arrival.routeUid).filter((value): value is string => Boolean(value)))];
          const allStationStopUids = [...new Set(cityStations.flatMap((station) => station.stopUids?.length ? station.stopUids : [station.uid]))];
          const allStationIds = [...new Set(cityStations.map((station) => station.stationId).filter((value): value is string => Boolean(value)))];
          const staticRows = await getStaticArrivalProfileRows(city, routeUids, allStationStopUids, allStationIds);

          for (const station of cityStations) {
            const stationStopUids = new Set(
              station.stopUids?.length ? station.stopUids.slice(0, 10) : [station.uid]
            );
            const stationArrivals = allArrivals.filter(
              (arrival) => arrival.stopUid && stationStopUids.has(arrival.stopUid)
            );
            const profiles = staticRows
              ? buildStaticArrivalProfiles(staticRows, stationStopUids, station.stationId)
              : new Map();
            const directionGroups = buildDirectionGroups(
              enrichArrivals(stationArrivals, profiles)
            );
            previewMap.set(station.id, {
              stationId: station.id,
              direction: directionGroups[0]
                ? { ...directionGroups[0], routes: directionGroups[0].routes.slice(0, 3) }
                : undefined,
              alternativeDirectionCount: Math.max(0, directionGroups.length - 1),
              updatedAt: new Date().toISOString(),
            });
          }
        })
      );

      const value = targets.map(
        (station) =>
          previewMap.get(station.id) ?? {
            stationId: station.id,
            alternativeDirectionCount: 0,
            updatedAt: new Date().toISOString(),
            warning: "目前沒有即時預覽資料",
          }
      );
      const savedAt = Date.now();
      previewCache.set(key, {
        value,
        freshUntil: savedAt + 90_000,
        staleUntil: savedAt + 20 * 60_000,
      });
      return value;
    } catch (error) {
      console.warn("Preview batch failed", error);
      if (cached && cached.staleUntil > Date.now()) {
        return cached.value.map((preview) => ({ ...preview, stale: true }));
      }
      return targets.map((station) => ({
        stationId: station.id,
        alternativeDirectionCount: 0,
        updatedAt: new Date().toISOString(),
        warning: "即時預覽暫時無法取得",
      }));
    } finally {
      previewInFlight.delete(key);
    }
  })();

  previewInFlight.set(key, request);
  return request;
}
