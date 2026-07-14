"use client";

import dynamic from "next/dynamic";
import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  BellRing,
  Bus,
  ArrowUpRight,
  BusFront,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Compass,
  Heart,
  LocateFixed,
  MapPin,
  MapPinned,
  Navigation,
  Radio,
  RefreshCw,
  Route,
  Search,
  SlidersHorizontal,
  Star,
  Timer,
  WifiOff,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BusArrival,
  BusArrivalResult,
  BusDeparture,
  BusDirectionGroup,
  BusLiveVehicle,
  BusReminder,
  BusRouteAlert,
  BusRouteArrival,
  BusRouteDirection,
  BusRouteLiveResult,
  BusRouteSearchResult,
  BusStationPreview,
  TransitStation,
} from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="map-loading">地圖載入中…</div>,
});

type Center = { latitude: number; longitude: number; label?: string; city?: string };
type SearchMode = "place" | "route";

interface NearbyResponse {
  city: string | null;
  locationLabel?: string;
  radius: number;
  updatedAt: string;
  stations: TransitStation[];
  warnings: string[];
  error?: string;
}

interface GeocodeResult {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  city?: string;
}

interface PreviewResponse {
  previews?: BusStationPreview[];
  updatedAt?: string;
  error?: string;
}

const RADIUS_OPTIONS = [300, 500, 1000, 2000];
const FAVORITES_KEY = "tdx-bus-favorites";
const FAVORITE_STATIONS_KEY = "tdx-bus-favorite-stations-v21";
const ARRIVAL_CACHE_KEY = "tdx-bus-arrival-cache-v21";
const PREVIEW_CACHE_KEY = "tdx-bus-preview-cache-v21";
const LOCATION_GRANTED_KEY = "tdx-bus-location-granted";
const REMINDERS_KEY = "tdx-bus-reminders-v22";

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function safeJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function distanceLabel(meters: number): string {
  if (meters < 1_000) return `${meters} 公尺`;
  return `${(meters / 1_000).toFixed(1)} 公里`;
}

function formattedTime(value?: string | null): string {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

function remainingSeconds(
  departure: BusDeparture,
  fetchedAt: number | null,
  now: number
): number | null {
  if (departure.estimateSeconds === null) return null;
  if (!fetchedAt || !now) return departure.estimateSeconds;
  const elapsed = Math.max(0, Math.floor((now - fetchedAt) / 1_000));
  return Math.max(0, departure.estimateSeconds - elapsed);
}

function departureLabel(
  departure: BusDeparture,
  fetchedAt: number | null,
  now: number,
  compact = false
): string {
  const remaining = remainingSeconds(departure, fetchedAt, now);
  if (remaining !== null) {
    if (remaining <= 15) return "進站中";
    if (remaining < 60) return `${remaining}秒`;
    if (compact) return `${Math.ceil(remaining / 60)}分`;
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
  }

  if (departure.nextBusTime) {
    const date = new Date(departure.nextBusTime);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    }
  }

  const statusText: Record<number, string> = {
    1: "尚未發車",
    2: "不停靠",
    3: "末班已過",
    4: "未營運",
  };
  return statusText[departure.stopStatus] ?? "暫無預估";
}

function departureTone(
  departure: BusDeparture,
  fetchedAt: number | null,
  now: number
): string {
  const remaining = remainingSeconds(departure, fetchedAt, now);
  if (remaining === null) return "muted";
  if (remaining <= 60) return "urgent";
  if (remaining <= 300) return "soon";
  return "normal";
}

function sourceLabel(departure?: BusDeparture): string {
  if (!departure) return "暫無資料";
  if (departure.estimateSeconds !== null) return "即時定位";
  if (departure.nextBusTime) return "時刻資料";
  return "營運狀態";
}

function stationDirectionText(station: TransitStation): string {
  if (station.directionHints?.length) return station.directionHints.join("・");
  if ((station.mergedStopCount ?? 0) > 1) return `${station.mergedStopCount} 個候車方向`;
  return "點開查看方向";
}

function uniqueStations(items: TransitStation[]): TransitStation[] {
  const map = new Map<string, TransitStation>();
  for (const item of items) map.set(item.id, item);
  return [...map.values()];
}

function routeReminderKey(
  stationId: string,
  routeUid: string | undefined,
  routeName: string,
  direction: number
): string {
  return `${stationId}:${routeUid ?? routeName}:${direction}`;
}

function PreviewBlock({
  preview,
  loading,
  clock,
}: {
  preview?: BusStationPreview;
  loading: boolean;
  clock: number;
}) {
  if (loading && !preview) {
    return (
      <div className="station-preview station-preview--loading">
        <span />
        <span />
      </div>
    );
  }

  if (!preview?.direction) {
    return (
      <div className="station-preview station-preview--empty">
        <Clock3 size={14} />
        <span>{preview?.warning ?? "點開查看即時到站"}</span>
      </div>
    );
  }

  const fetchedAt = new Date(preview.updatedAt).getTime();
  return (
    <div className="station-preview">
      <div className="station-preview__heading">
        <span><Compass size={14} />{preview.direction.label}</span>
        {preview.alternativeDirectionCount ? (
          <small>另有 {preview.alternativeDirectionCount} 個方向</small>
        ) : null}
      </div>
      <strong>{preview.direction.destinationSummary}</strong>
      {preview.direction.nextStopSummary ? <small>{preview.direction.nextStopSummary}</small> : null}
      <div className="preview-routes">
        {preview.direction.routes.slice(0, 3).map((route) => {
          const first = route.departures[0];
          return (
            <span key={route.key} className={first ? `tone-${departureTone(first, fetchedAt, clock)}` : "tone-muted"}>
              <b>{route.routeName}</b>
              {first ? departureLabel(first, fetchedAt, clock, true) : "--"}
            </span>
          );
        })}
      </div>
      {preview.stale ? <em>目前顯示上次成功資料</em> : null}
    </div>
  );
}

export default function TransitApp() {
  const [center, setCenter] = useState<Center | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [stations, setStations] = useState<TransitStation[]>([]);
  const [radius, setRadius] = useState(300);
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  const [searchMode, setSearchMode] = useState<SearchMode>("place");
  const [query, setQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [routeResults, setRouteResults] = useState<BusRouteSearchResult[]>([]);

  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoriteStations, setFavoriteStations] = useState<TransitStation[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(12);

  const [previews, setPreviews] = useState<Record<string, BusStationPreview>>({});
  const [previewsLoading, setPreviewsLoading] = useState(false);

  const [selected, setSelected] = useState<TransitStation | null>(null);
  const [arrivals, setArrivals] = useState<BusArrival[]>([]);
  const [directionGroups, setDirectionGroups] = useState<BusDirectionGroup[]>([]);
  const [activeDirection, setActiveDirection] = useState<string | null>(null);
  const [arrivalsLoading, setArrivalsLoading] = useState(false);
  const [arrivalsRefreshing, setArrivalsRefreshing] = useState(false);
  const [arrivalMessage, setArrivalMessage] = useState<string | null>(null);
  const [arrivalWarnings, setArrivalWarnings] = useState<string[]>([]);
  const [arrivalUpdatedAt, setArrivalUpdatedAt] = useState<string | null>(null);
  const [arrivalFetchedAt, setArrivalFetchedAt] = useState<number | null>(null);

  const [selectedRoute, setSelectedRoute] = useState<BusRouteSearchResult | null>(null);
  const [routeDirections, setRouteDirections] = useState<BusRouteDirection[]>([]);
  const [activeRouteDirection, setActiveRouteDirection] = useState<string | null>(null);
  const [routeDetailLoading, setRouteDetailLoading] = useState(false);
  const [routeDetailError, setRouteDetailError] = useState<string | null>(null);
  const [routeVehicles, setRouteVehicles] = useState<BusLiveVehicle[]>([]);
  const [routeAlerts, setRouteAlerts] = useState<BusRouteAlert[]>([]);
  const [routeLiveWarning, setRouteLiveWarning] = useState<string | null>(null);
  const [routeLiveUpdatedAt, setRouteLiveUpdatedAt] = useState<string | null>(null);
  const [routeLiveLoading, setRouteLiveLoading] = useState(false);
  const [routeTargetStation, setRouteTargetStation] = useState<TransitStation | null>(null);

  const [reminders, setReminders] = useState<BusReminder[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const autoLocationAttempted = useRef(false);
  const remindersHydrated = useRef(false);
  const stationsRef = useRef<TransitStation[]>([]);
  const arrivalRequestRef = useRef<string | null>(null);
  const lastArrivalRequestRef = useRef<Record<string, number>>({});
  const previewRequestRef = useRef(false);
  const lastPreviewRequestRef = useRef(0);
  const routeLiveRequestRef = useRef(false);
  const lastRouteLiveRequestRef = useRef<Record<string, number>>({});

  const [clock, setClock] = useState(0);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const hydrate = window.setTimeout(() => {
      const savedIds = safeJson<string[]>(FAVORITES_KEY, []);
      const savedStations = safeJson<TransitStation[]>(FAVORITE_STATIONS_KEY, []);
      const savedPreviews = safeJson<Record<string, BusStationPreview>>(PREVIEW_CACHE_KEY, {});
      const savedReminders = safeJson<BusReminder[]>(REMINDERS_KEY, []);
      setFavorites(savedIds);
      setFavoriteStations(savedStations);
      setPreviews(savedPreviews);
      remindersHydrated.current = true;
      setReminders(savedReminders);
      setOnline(navigator.onLine);
    }, 0);

    return () => {
      window.clearTimeout(hydrate);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    stationsRef.current = stations;
  }, [stations]);

  useEffect(() => {
    if (!selected && !selectedRoute) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selected, selectedRoute]);

  const fetchNearby = useCallback(
    async (nextCenter: Center, nextRadius = radius) => {
      setLoading(true);
      setError(null);
      setWarnings([]);
      setVisibleLimit(12);

      try {
        const params = new URLSearchParams({
          lat: String(nextCenter.latitude),
          lon: String(nextCenter.longitude),
          radius: String(nextRadius),
        });
        if (nextCenter.city) params.set("city", nextCenter.city);
        const response = await fetchWithTimeout(
          `/api/nearby?${params}`,
          { cache: "no-store" },
          10_000
        );
        const data = (await response.json()) as NearbyResponse;
        if (!response.ok) throw new Error(data.error ?? "附近公車站查詢失敗");

        setStations(data.stations ?? []);
        setCity(data.city);
        setWarnings(data.warnings ?? []);
        setUpdatedAt(data.updatedAt);
        setCenter({
          ...nextCenter,
          city: data.city ?? nextCenter.city,
          label: nextCenter.label ?? data.locationLabel,
        });

        const updatedFavorites = favoriteStations.map(
          (favorite) => data.stations.find((station) => station.id === favorite.id) ?? favorite
        );
        setFavoriteStations(updatedFavorites);
        localStorage.setItem(FAVORITE_STATIONS_KEY, JSON.stringify(updatedFavorites));
      } catch (requestError) {
        const message =
          requestError instanceof DOMException && requestError.name === "AbortError"
            ? "查詢時間過長，請稍後再試"
            : requestError instanceof Error
              ? requestError.message
              : "附近公車站查詢失敗";
        if (stationsRef.current.length) {
          setError(null);
          setWarnings(["位置更新較慢，暫時保留目前站牌，稍後可再重新整理。"]);
        } else {
          setError(message);
        }
      } finally {
        setLoading(false);
      }
    },
    [favoriteStations, radius]
  );

  const requestCurrentLocation = useCallback((automatic = false) => {
    if (!navigator.geolocation) {
      if (!automatic) setError("此瀏覽器不支援定位功能");
      return;
    }

    setLocationLoading(true);
    if (!automatic) setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextCenter = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: "目前位置",
        };
        localStorage.setItem(LOCATION_GRANTED_KEY, "1");
        setLocationLoading(false);
        void fetchNearby(nextCenter, 300);
      },
      (geoError) => {
        const messages: Record<number, string> = {
          1: "定位權限被拒絕，請允許瀏覽器使用位置，或改用地址搜尋。",
          2: "目前無法取得定位資訊。",
          3: "定位逾時，請再試一次。",
        };
        if (!automatic) setError(messages[geoError.code] ?? "定位失敗");
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
    );
  }, [fetchNearby]);

  useEffect(() => {
    if (autoLocationAttempted.current || center) return;
    autoLocationAttempted.current = true;

    const tryAutomaticLocation = async () => {
      let granted = localStorage.getItem(LOCATION_GRANTED_KEY) === "1";

      if (navigator.permissions?.query) {
        try {
          const permission = await navigator.permissions.query({
            name: "geolocation" as PermissionName,
          });
          granted = permission.state === "granted" || granted;
        } catch {
          // Safari may not expose geolocation through the Permissions API.
        }
      }

      if (granted) requestCurrentLocation(true);
    };

    void tryAutomaticLocation();
  }, [center, requestCurrentLocation]);

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 1) return;
    setSearchLoading(true);
    setError(null);

    try {
      if (searchMode === "route") {
        if (!city) throw new Error("請先使用定位或搜尋地點，系統才能判斷要搜尋哪個縣市的路線");
        const params = new URLSearchParams({ city, q: trimmed });
        const response = await fetchWithTimeout(`/api/bus/routes/search?${params}`);
        const data = (await response.json()) as { routes?: BusRouteSearchResult[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "公車路線搜尋失敗");
        setRouteResults(data.routes ?? []);
        setSearchResults([]);
        if (!data.routes?.length) setError("找不到符合的公車路線");
      } else {
        if (trimmed.length < 2) throw new Error("請輸入至少 2 個字的地址或地標");
        const response = await fetchWithTimeout(`/api/geocode?q=${encodeURIComponent(trimmed)}`);
        const data = (await response.json()) as { results?: GeocodeResult[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "地址搜尋失敗");
        setSearchResults(data.results ?? []);
        setRouteResults([]);
        if (!data.results?.length) setError("找不到這個地址或地標，請輸入更完整的名稱");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "搜尋失敗");
    } finally {
      setSearchLoading(false);
    }
  };

  const chooseSearchResult = (result: GeocodeResult) => {
    const nextCenter = {
      latitude: result.latitude,
      longitude: result.longitude,
      label: result.name,
      city: result.city,
    };
    setQuery(result.name.split(",")[0] ?? result.name);
    setSearchResults([]);
    void fetchNearby(nextCenter);
  };

  const loadRouteLive = useCallback(
    async (route: BusRouteSearchResult, silent = false) => {
      if (!route.routeUid) return;
      const key = `${route.city}:${route.routeUid}`;
      const lastRequested = lastRouteLiveRequestRef.current[key] ?? 0;

      if (routeLiveRequestRef.current) return;
      if (silent && Date.now() - lastRequested < 35_000) return;
      if (silent && document.visibilityState !== "visible") return;

      routeLiveRequestRef.current = true;
      lastRouteLiveRequestRef.current[key] = Date.now();
      if (!silent) setRouteLiveLoading(true);

      try {
        const params = new URLSearchParams({
          city: route.city,
          routeUid: route.routeUid,
        });
        const response = await fetchWithTimeout(
          `/api/bus/routes/live?${params}`,
          { cache: "no-store" },
          9_000
        );
        const data = (await response.json()) as BusRouteLiveResult & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "車輛位置查詢失敗");
        setRouteVehicles(data.vehicles ?? []);
        setRouteAlerts([]);
        setRouteLiveWarning(data.warning ?? null);
        setRouteLiveUpdatedAt(data.updatedAt);
      } catch (requestError) {
        if (!silent) {
          setRouteLiveWarning(
            requestError instanceof Error
              ? requestError.message
              : "車輛位置暫時無法取得"
          );
        }
      } finally {
        routeLiveRequestRef.current = false;
        setRouteLiveLoading(false);
      }
    },
    []
  );

  const loadRouteDetail = async (
    route: BusRouteSearchResult,
    targetStation: TransitStation | null = null
  ) => {
    setSelectedRoute(route);
    setRouteTargetStation(targetStation);
    setRouteDetailLoading(true);
    setRouteDetailError(null);
    setRouteDirections([]);
    setActiveRouteDirection(null);
    setRouteVehicles([]);
    setRouteAlerts([]);
    setRouteLiveWarning(null);
    setRouteResults([]);

    try {
      if (!route.routeUid) throw new Error("此路線缺少可查詢的識別碼");
      const params = new URLSearchParams({ city: route.city, routeUid: route.routeUid });
      const [detailResponse] = await Promise.all([
        fetchWithTimeout(`/api/bus/routes/detail?${params}`),
        loadRouteLive(route),
      ]);
      const data = (await detailResponse.json()) as {
        directions?: BusRouteDirection[];
        error?: string;
      };
      if (!detailResponse.ok) throw new Error(data.error ?? "路線站序查詢失敗");
      const directions = data.directions ?? [];
      setRouteDirections(directions);

      const targetStopUids = new Set(
        targetStation?.stopUids?.length
          ? targetStation.stopUids
          : targetStation
            ? [targetStation.uid]
            : []
      );
      const matchedDirection = directions.find((direction) =>
        direction.stops.some((stop) => stop.stopUid && targetStopUids.has(stop.stopUid))
      );
      setActiveRouteDirection(matchedDirection?.key ?? directions[0]?.key ?? null);

      if (!directions.length) setRouteDetailError("此路線目前沒有可顯示的站序資料");
    } catch (requestError) {
      setRouteDetailError(
        requestError instanceof Error ? requestError.message : "路線站序查詢失敗"
      );
    } finally {
      setRouteDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedRoute?.routeUid) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadRouteLive(selectedRoute, true);
      }
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [loadRouteLive, selectedRoute]);

  const loadArrivals = useCallback(
    async (station: TransitStation, silent = false) => {
      const requestKey = station.id;
      const now = Date.now();
      const lastRequested = lastArrivalRequestRef.current[requestKey] ?? 0;

      if (arrivalRequestRef.current === requestKey) return;
      if (silent && now - lastRequested < 45_000) return;
      if (silent && document.visibilityState !== "visible") return;

      setSelected(station);
      let hasFallback = silent;

      if (!silent) {
        setArrivalMessage(null);
        setArrivalWarnings([]);
        setActiveDirection(null);

        const cache = safeJson<
          Record<string, { data: BusArrivalResult; savedAt: number }>
        >(ARRIVAL_CACHE_KEY, {});
        const cached = cache[station.id];

        if (cached && now - cached.savedAt < 30 * 60_000) {
          setArrivals(cached.data.arrivals ?? []);
          setDirectionGroups(cached.data.directionGroups ?? []);
          setArrivalUpdatedAt(cached.data.updatedAt);
          setArrivalFetchedAt(cached.savedAt);
          setActiveDirection(cached.data.directionGroups?.[0]?.key ?? null);
          hasFallback = true;

          if (now - cached.savedAt > 90_000) {
            setArrivalWarnings(["先顯示上次成功資料，正在更新即時到站。"]);
          }
        } else {
          const preview = previews[station.id];
          if (preview?.direction) {
            setArrivals([]);
            setDirectionGroups([preview.direction]);
            setArrivalUpdatedAt(preview.updatedAt);
            setArrivalFetchedAt(new Date(preview.updatedAt).getTime());
            setActiveDirection(preview.direction.key);
            setArrivalWarnings(["先顯示首頁預覽，正在更新完整路線資料。"]);
            hasFallback = true;
          } else {
            setArrivals([]);
            setDirectionGroups([]);
            setArrivalUpdatedAt(null);
            setArrivalFetchedAt(null);
          }
        }

        setArrivalsLoading(!hasFallback);
      } else {
        setArrivalsRefreshing(true);
      }

      arrivalRequestRef.current = requestKey;
      lastArrivalRequestRef.current[requestKey] = now;

      try {
        const params = new URLSearchParams({
          city: station.city ?? "",
          stopUids: (
            station.stopUids?.length ? station.stopUids : [station.uid]
          ).join(","),
        });
        if (station.stationId) params.set("stationId", station.stationId);

        const response = await fetchWithTimeout(
          `/api/bus/arrivals?${params}`,
          { cache: "no-store" },
          10_000
        );
        const data = (await response.json()) as BusArrivalResult & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "公車到站資料查詢失敗");

        setArrivals(data.arrivals ?? []);
        setDirectionGroups(data.directionGroups ?? []);
        setArrivalWarnings(data.warnings ?? []);
        setArrivalUpdatedAt(data.updatedAt ?? new Date().toISOString());
        setArrivalFetchedAt(Date.now());
        setArrivalMessage(
          data.directionGroups?.length || data.arrivals?.length
            ? null
            : "此站目前沒有可顯示的公車到站資料"
        );
        setActiveDirection((current) =>
          current && data.directionGroups?.some((group) => group.key === current)
            ? current
            : data.directionGroups?.[0]?.key ?? null
        );

        const cache = safeJson<
          Record<string, { data: BusArrivalResult; savedAt: number }>
        >(ARRIVAL_CACHE_KEY, {});
        cache[station.id] = { data, savedAt: Date.now() };
        localStorage.setItem(ARRIVAL_CACHE_KEY, JSON.stringify(cache));
      } catch (requestError) {
        const message =
          requestError instanceof DOMException && requestError.name === "AbortError"
            ? "即時資料回應較慢，已保留目前畫面，可稍後手動更新。"
            : requestError instanceof Error
              ? requestError.message
              : "公車到站資料查詢失敗";

        if (hasFallback || silent) {
          setArrivalWarnings((current) => [
            ...new Set([...current, message]),
          ]);
        } else {
          setArrivalMessage(message);
        }
      } finally {
        if (arrivalRequestRef.current === requestKey) {
          arrivalRequestRef.current = null;
        }
        setArrivalsLoading(false);
        setArrivalsRefreshing(false);
      }
    },
    [previews]
  );

  useEffect(() => {
    if (!selected) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadArrivals(selected, true);
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadArrivals, selected]);

  const previewTargets = useMemo(
    () => uniqueStations([...favoriteStations, ...stations.slice(0, 5)]).slice(0, 6),
    [favoriteStations, stations]
  );

  const refreshPreviews = useCallback(async () => {
    if (!previewTargets.length) return;
    if (previewRequestRef.current) return;
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastPreviewRequestRef.current < 75_000) return;

    previewRequestRef.current = true;
    lastPreviewRequestRef.current = Date.now();
    setPreviewsLoading(true);

    try {
      const response = await fetchWithTimeout(
        "/api/bus/previews",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stations: previewTargets }),
          cache: "no-store",
        },
        10_000
      );
      const data = (await response.json()) as PreviewResponse;
      if (!response.ok) throw new Error(data.error ?? "即時預覽取得失敗");
      setPreviews((current) => {
        const next = { ...current };
        for (const preview of data.previews ?? []) {
          next[preview.stationId] = preview;
        }
        localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(next));
        return next;
      });
    } catch (previewError) {
      console.warn("Preview refresh skipped", previewError);
    } finally {
      previewRequestRef.current = false;
      setPreviewsLoading(false);
    }
  }, [previewTargets]);

  useEffect(() => {
    if (!previewTargets.length) return;
    const initial = window.setTimeout(() => void refreshPreviews(), 350);
    const timer = window.setInterval(() => void refreshPreviews(), 120_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [previewTargets.length, refreshPreviews]);

  const changeRadius = (nextRadius: number) => {
    setRadius(nextRadius);
    if (center) void fetchNearby(center, nextRadius);
  };

  const toggleFavorite = (station: TransitStation) => {
    const isFavorite = favorites.includes(station.id);
    const nextIds = isFavorite
      ? favorites.filter((id) => id !== station.id)
      : [...favorites, station.id];
    const nextStations = isFavorite
      ? favoriteStations.filter((item) => item.id !== station.id)
      : uniqueStations([...favoriteStations, station]);

    setFavorites(nextIds);
    setFavoriteStations(nextStations);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(nextIds));
    localStorage.setItem(FAVORITE_STATIONS_KEY, JSON.stringify(nextStations));
  };


  const toggleRouteReminder = async (
    station: TransitStation,
    route: BusRouteArrival
  ) => {
    const key = routeReminderKey(
      station.id,
      route.routeUid,
      route.routeName,
      route.direction
    );
    const existing = reminders.find((reminder) => reminder.key === key);

    if (existing) {
      setReminders((current) => current.filter((reminder) => reminder.key !== key));
      setToast(`已取消 ${route.routeName} 的到站提醒`);
      return;
    }

    if (reminders.length >= 5) {
      setToast("最多可同時設定 5 個到站提醒");
      return;
    }

    if ("Notification" in window && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // Some embedded browsers do not allow notification permission requests.
      }
    }

    const reminder: BusReminder = {
      key,
      station: {
        id: station.id,
        name: station.name,
        city: station.city,
        uid: station.uid,
        stopUids: station.stopUids,
        stationId: station.stationId,
      },
      routeUid: route.routeUid,
      routeName: route.routeName,
      direction: route.direction,
      destination: route.destination,
      thresholdSeconds: 180,
      fired: false,
      createdAt: Date.now(),
    };

    setReminders((current) => [...current, reminder]);
    setToast(`已設定 ${route.routeName}：3 分鐘前提醒`);
  };

  useEffect(() => {
    if (!remindersHydrated.current) return;
    localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders));
  }, [reminders]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!reminders.length || !online) return;

    let cancelled = false;

    const checkReminders = async () => {
      if (document.visibilityState !== "visible") return;

      const byStation = new Map<string, BusReminder[]>();
      for (const reminder of reminders) {
        const items = byStation.get(reminder.station.id) ?? [];
        items.push(reminder);
        byStation.set(reminder.station.id, items);
      }

      const updates = new Map<string, boolean>();
      const arrivalCache = safeJson<
        Record<string, { data: BusArrivalResult; savedAt: number }>
      >(ARRIVAL_CACHE_KEY, {});

      for (const stationReminders of [...byStation.values()].slice(0, 5)) {
        const station = stationReminders[0]?.station;
        if (!station?.city) continue;

        try {
          const cached = arrivalCache[station.id];
          let data: BusArrivalResult | null =
            cached && Date.now() - cached.savedAt < 75_000
              ? cached.data
              : null;

          if (!data) {
            const params = new URLSearchParams({
              city: station.city,
              stopUids: (
                station.stopUids?.length ? station.stopUids : [station.uid]
              ).join(","),
            });
            if (station.stationId) params.set("stationId", station.stationId);

            const response = await fetchWithTimeout(
              `/api/bus/arrivals?${params}`,
              { cache: "no-store" },
              9_000
            );
            if (!response.ok) continue;
            data = (await response.json()) as BusArrivalResult;
            arrivalCache[station.id] = { data, savedAt: Date.now() };
          }

          for (const reminder of stationReminders) {
            const matching = (data.arrivals ?? [])
              .filter(
                (arrival) =>
                  (reminder.routeUid
                    ? arrival.routeUid === reminder.routeUid
                    : arrival.routeName === reminder.routeName) &&
                  arrival.direction === reminder.direction &&
                  arrival.estimateSeconds !== null
              )
              .sort(
                (a, b) =>
                  (a.estimateSeconds ?? Number.MAX_SAFE_INTEGER) -
                  (b.estimateSeconds ?? Number.MAX_SAFE_INTEGER)
              )[0];

            if (!matching?.estimateSeconds) continue;

            if (
              matching.estimateSeconds <= reminder.thresholdSeconds &&
              matching.estimateSeconds > 0 &&
              !reminder.fired
            ) {
              const message = `${reminder.routeName} 往 ${reminder.destination}，約 ${Math.max(
                1,
                Math.ceil(matching.estimateSeconds / 60)
              )} 分鐘抵達 ${reminder.station.name}`;

              if ("Notification" in window && Notification.permission === "granted") {
                new Notification("公車即將到站", {
                  body: message,
                  icon: "/icon.svg",
                });
              }
              navigator.vibrate?.([180, 100, 180]);
              if (!cancelled) setToast(message);
              updates.set(reminder.key, true);
            } else if (
              reminder.fired &&
              matching.estimateSeconds > reminder.thresholdSeconds + 120
            ) {
              updates.set(reminder.key, false);
            }
          }
        } catch {
          // Reminder checks use cached data first and never interrupt the main UI.
        }
      }

      localStorage.setItem(ARRIVAL_CACHE_KEY, JSON.stringify(arrivalCache));

      if (!cancelled && updates.size) {
        setReminders((current) =>
          current.map((reminder) =>
            updates.has(reminder.key)
              ? { ...reminder, fired: updates.get(reminder.key) ?? reminder.fired }
              : reminder
          )
        );
      }
    };

    const initial = window.setTimeout(() => void checkReminders(), 25_000);
    const timer = window.setInterval(() => void checkReminders(), 90_000);

    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [online, reminders]);

  const visibleStations = useMemo(() => {
    const filtered = favoritesOnly
      ? stations.filter((station) => favorites.includes(station.id))
      : stations;
    return [...filtered]
      .sort((a, b) => {
        const favoriteDifference = Number(favorites.includes(b.id)) - Number(favorites.includes(a.id));
        return favoriteDifference || a.distanceMeters - b.distanceMeters;
      })
      .slice(0, visibleLimit);
  }, [favorites, favoritesOnly, stations, visibleLimit]);

  const selectedDirection = useMemo(
    () => directionGroups.find((group) => group.key === activeDirection) ?? directionGroups[0] ?? null,
    [activeDirection, directionGroups]
  );

  const selectedRouteDirection = useMemo(
    () => routeDirections.find((direction) => direction.key === activeRouteDirection) ?? routeDirections[0] ?? null,
    [activeRouteDirection, routeDirections]
  );

  const selectedRouteVehicles = useMemo(() => {
    if (!selectedRouteDirection) return [];
    return routeVehicles
      .filter((vehicle) => vehicle.direction === selectedRouteDirection.direction)
      .sort(
        (a, b) =>
          (a.stopSequence ?? Number.MAX_SAFE_INTEGER) -
          (b.stopSequence ?? Number.MAX_SAFE_INTEGER)
      );
  }, [routeVehicles, selectedRouteDirection]);

  const routeTargetSequence = useMemo(() => {
    if (!selectedRouteDirection || !routeTargetStation) return null;
    const targetUids = new Set(
      routeTargetStation.stopUids?.length
        ? routeTargetStation.stopUids
        : [routeTargetStation.uid]
    );
    return (
      selectedRouteDirection.stops.find(
        (stop) => stop.stopUid && targetUids.has(stop.stopUid)
      )?.sequence ?? null
    );
  }, [routeTargetStation, selectedRouteDirection]);

  return (
    <main className="bus-app">
      <header className="compact-hero">
        <div className="compact-topbar">
          <div className="compact-brand">
            <span><BusFront size={21} /></span>
            <div>
              <strong>Bus Now 2.2.1</strong>
              <small>{center?.label?.split(",")[0] ?? "附近公車即時資訊"}</small>
            </div>
          </div>
          <div className="compact-topbar__actions">
            <span className="reminder-count" title="到站提醒">
              <BellRing size={17} />
              {reminders.length}
            </span>
            <button
              className="compact-icon-button"
              aria-label="重新整理"
              disabled={!center || loading}
              onClick={() => center && void fetchNearby(center, 300)}
            >
              <RefreshCw size={19} className={loading ? "spin" : ""} />
            </button>
          </div>
        </div>

        <section className="compact-search-panel">
          <div className="search-mode search-mode--compact" role="tablist" aria-label="搜尋方式">
            <button
              className={searchMode === "place" ? "active" : ""}
              onClick={() => {
                setSearchMode("place");
                setQuery("");
                setRouteResults([]);
              }}
            >
              <MapPin size={15} />找地點
            </button>
            <button
              className={searchMode === "route" ? "active" : ""}
              onClick={() => {
                setSearchMode("route");
                setQuery("");
                setSearchResults([]);
              }}
            >
              <Route size={15} />找路線
            </button>
          </div>

          <form className="search-box search-box--compact" onSubmit={submitSearch}>
            <Search size={19} aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                searchMode === "place"
                  ? "輸入地址、地標或公車站"
                  : city
                    ? "輸入路線，例如 307、藍15"
                    : "先定位，再搜尋公車路線"
              }
              aria-label={searchMode === "place" ? "搜尋地點" : "搜尋公車路線"}
            />
            {query ? (
              <button
                type="button"
                className="search-clear"
                aria-label="清除搜尋"
                onClick={() => {
                  setQuery("");
                  setSearchResults([]);
                  setRouteResults([]);
                }}
              >
                <X size={17} />
              </button>
            ) : null}
            <button
              type="submit"
              className="search-submit"
              disabled={searchLoading || !query.trim() || (searchMode === "route" && !city)}
            >
              {searchLoading ? (
                <RefreshCw size={18} className="spin" />
              ) : (
                <ArrowUpRight size={18} />
              )}
            </button>
          </form>

          {searchResults.length > 0 ? (
            <div className="search-results">
              {searchResults.map((result) => (
                <button key={result.id} onClick={() => chooseSearchResult(result)}>
                  <MapPin size={18} />
                  <span>{result.name}</span>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
          ) : null}

          {routeResults.length > 0 ? (
            <div className="search-results route-search-results">
              {routeResults.map((route) => (
                <button key={route.key} onClick={() => void loadRouteDetail(route)}>
                  <span className="route-search-number">{route.routeName}</span>
                  <span>
                    <strong>
                      {route.departure} → {route.destination}
                    </strong>
                    <small>{route.operatorName ?? "公車路線"}</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
          ) : null}

          <div className="compact-search-actions">
            <button
              className="location-button"
              onClick={() => requestCurrentLocation(false)}
              disabled={locationLoading}
            >
              <LocateFixed size={18} />
              {locationLoading ? "定位中…" : center ? "更新位置" : "使用目前位置"}
            </button>
            <label className="radius-control">
              <SlidersHorizontal size={16} />
              <select
                value={radius}
                onChange={(event) => changeRadius(Number(event.target.value))}
                aria-label="搜尋範圍"
              >
                {RADIUS_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value >= 1000 ? `${value / 1000} 公里` : `${value} 公尺`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </header>

      <section className="content-shell">
        {!online ? <div className="notice"><WifiOff size={18} />目前離線，將優先顯示上次成功資料。</div> : null}
        {error ? <div className="notice notice--error"><AlertTriangle size={18} />{error}</div> : null}
        {warnings.map((warning) => <div key={warning} className="notice"><AlertTriangle size={18} />{warning}</div>)}

        <section className="quick-status-row" aria-label="附近公車摘要">
          <span><MapPinned size={15} /><b>{stations.length}</b> 站</span>
          <span><Navigation size={15} /><b>{radius >= 1000 ? `${radius / 1000}km` : `${radius}m`}</b></span>
          <span><Star size={15} /><b>{favoriteStations.length}</b> 收藏</span>
          <span><Bell size={15} /><b>{reminders.length}</b> 提醒</span>
        </section>

        {favoriteStations.length ? (
          <section className="favorite-section">
            <div className="section-title-row">
              <div><span className="panel-kicker"><Star size={15} /> 我的常用</span><h2>收藏站牌</h2></div>
              <button onClick={() => setFavoritesOnly(true)}>只看收藏</button>
            </div>
            <div className="favorite-scroll">
              {favoriteStations.slice(0, 6).map((station) => (
                <article className="favorite-card" key={station.id}>
                  <button className="favorite-card__main" onClick={() => void loadArrivals(station)}>
                    <span className="favorite-card__icon"><BusFront size={20} /></span>
                    <div><strong>{station.name}</strong><small>{station.city ? `${station.city}・` : ""}{distanceLabel(station.distanceMeters)}</small></div>
                    <ChevronRight size={18} />
                  </button>
                  <PreviewBlock preview={previews[station.id]} loading={previewsLoading} clock={clock} />
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="station-section">
          <div className="station-heading">
            <div>
              <span className="panel-kicker"><BusFront size={15} /> 即時預覽</span>
              <h2>附近公車站</h2>
              {updatedAt ? <p><Clock3 size={14} />更新於 {formattedTime(updatedAt)}</p> : null}
            </div>
            <div className="list-filter" role="group" aria-label="站牌篩選">
              <button className={!favoritesOnly ? "active" : ""} onClick={() => setFavoritesOnly(false)}>全部</button>
              <button className={favoritesOnly ? "active" : ""} onClick={() => setFavoritesOnly(true)}><Heart size={14} />收藏</button>
            </div>
          </div>

          {loading ? (
            <div className="skeleton-list" aria-label="資料載入中">{[1, 2, 3, 4].map((item) => <div key={item} className="skeleton-card" />)}</div>
          ) : visibleStations.length ? (
            <div className="station-list">
              {visibleStations.map((station, index) => {
                const isFavorite = favorites.includes(station.id);
                return (
                  <article key={station.id} className="station-card">
                    <div className="station-card__top">
                      <button className="station-card__main" onClick={() => void loadArrivals(station)}>
                        <span className="station-index">{String(index + 1).padStart(2, "0")}</span>
                        <span className="station-icon"><BusFront size={22} /></span>
                        <span className="station-copy">
                          <strong>{station.name}</strong>
                          <small>{stationDirectionText(station)}</small>
                          <span className="station-meta"><b>{distanceLabel(station.distanceMeters)}</b>{station.address ? <i>{station.address}</i> : null}</span>
                        </span>
                        <ChevronRight size={20} className="station-arrow" />
                      </button>
                      <button className={`favorite-button ${isFavorite ? "active" : ""}`} aria-label={isFavorite ? "移除收藏" : "加入收藏"} onClick={() => toggleFavorite(station)}>
                        <Star size={19} fill={isFavorite ? "currentColor" : "none"} />
                      </button>
                    </div>
                    <button className="station-preview-button" onClick={() => void loadArrivals(station)}>
                      <PreviewBlock preview={previews[station.id]} loading={previewsLoading && !previews[station.id]} clock={clock} />
                    </button>
                  </article>
                );
              })}
              {!favoritesOnly && stations.length > visibleLimit ? (
                <button className="show-more-button" onClick={() => setVisibleLimit((value) => value + 12)}>
                  顯示更多站牌 <ChevronDown size={17} />
                </button>
              ) : null}
            </div>
          ) : center ? (
            <div className="empty-state"><BusFront size={34} /><strong>{favoritesOnly ? "附近沒有收藏站牌" : "搜尋範圍內沒有公車站"}</strong><span>{favoritesOnly ? "切換到全部，或收藏附近站牌" : "請放大搜尋範圍，或更換搜尋位置"}</span></div>
          ) : (
            <div className="empty-state empty-state--welcome"><LocateFixed size={34} /><strong>開始尋找附近公車</strong><span>使用目前位置，或在上方輸入地址</span></div>
          )}
        </section>

        <section className={`map-panel ${mapExpanded ? "" : "map-panel--collapsed"}`}>
          <div className="panel-heading">
            <div><span className="panel-kicker"><MapPinned size={15} /> 附近地圖</span><h2>{center?.label?.split(",")[0] ?? "尚未選擇位置"}</h2></div>
            <button onClick={() => setMapExpanded((value) => !value)}>{mapExpanded ? "收起" : "展開地圖"}</button>
          </div>
          {mapExpanded ? (
            <div className="map-frame">
              <MapView center={center} stations={visibleStations} selectedId={selected?.id ?? null} onSelect={(station) => void loadArrivals(station)} />
              {!center ? <div className="map-empty"><LocateFixed size={30} /><strong>先選擇搜尋位置</strong><span>使用目前位置，或輸入地址與地標</span></div> : null}
            </div>
          ) : null}
        </section>
      </section>

      {toast ? (
        <div className="toast-message" role="status">
          <BellRing size={17} />
          {toast}
        </div>
      ) : null}

      {selected ? (
        <div className="arrival-backdrop" onClick={() => setSelected(null)}>
          <section className="arrival-sheet" role="dialog" aria-modal="true" aria-label={`${selected.name} 公車即時資訊`} onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <header className="arrival-header">
              <div className="arrival-title-row">
                <span className="arrival-stop-icon"><BusFront size={24} /></span>
                <div><span className="panel-kicker">公車即時到站</span><h2>{selected.name}</h2><p><MapPin size={14} />距離搜尋中心 {distanceLabel(selected.distanceMeters)}</p></div>
              </div>
              <div className="arrival-actions">
                <button className={favorites.includes(selected.id) ? "active" : ""} aria-label="收藏站牌" onClick={() => toggleFavorite(selected)}><Star size={19} fill={favorites.includes(selected.id) ? "currentColor" : "none"} /></button>
                <button aria-label="重新整理到站資訊" disabled={arrivalsRefreshing} onClick={() => void loadArrivals(selected, true)}><RefreshCw size={19} className={arrivalsRefreshing ? "spin" : ""} /></button>
                <button aria-label="關閉" onClick={() => setSelected(null)}><X size={20} /></button>
              </div>
            </header>

            <div className="live-strip"><span><span className="live-dot" />即時更新</span><small>{arrivalUpdatedAt ? `更新於 ${formattedTime(arrivalUpdatedAt)}` : "每 20 秒自動校正"}</small></div>

            {arrivalsLoading ? <div className="arrival-loading"><span className="loading-orbit"><BusFront size={24} /></span><strong>正在取得即時到站資訊</strong><small>同步方向、下一站與下一班公車…</small></div> : null}
            {!arrivalsLoading && arrivalMessage ? <div className="notice"><AlertTriangle size={18} />{arrivalMessage}</div> : null}
            {!arrivalsLoading && arrivalWarnings.map((warning) => <div key={warning} className="notice"><AlertTriangle size={18} />{warning}</div>)}

            {!arrivalsLoading && directionGroups.length ? (
              <>
                <nav className="direction-tabs" aria-label="公車行駛方向">
                  {directionGroups.map((group) => (
                    <button key={group.key} className={selectedDirection?.key === group.key ? "active" : ""} onClick={() => setActiveDirection(group.key)}>
                      <Compass size={16} /><span>{group.label}</span><b>{group.routes.length}</b>
                    </button>
                  ))}
                </nav>
                {selectedDirection ? (
                  <section className="direction-board">
                    <header>
                      <div><span><Navigation size={16} />{selectedDirection.label}</span><h3>{selectedDirection.destinationSummary}</h3>{selectedDirection.nextStopSummary ? <p>{selectedDirection.nextStopSummary}</p> : null}</div>
                      <b>{selectedDirection.routes.length} 條路線</b>
                    </header>
                    <div className="route-list">
                      {selectedDirection.routes.map((route) => {
                        const first = route.departures[0];
                        const next = route.departures[1];
                        const reminderKey = routeReminderKey(
                          selected.id,
                          route.routeUid,
                          route.routeName,
                          route.direction
                        );
                        const reminderActive = reminders.some(
                          (reminder) => reminder.key === reminderKey
                        );
                        return (
                          <article className="route-card" key={route.key}>
                            <div className="route-number">{route.routeName}</div>
                            <div className="route-copy">
                              <span>往</span>
                              <strong>{route.destination}</strong>
                              <small>
                                {route.nextStopName
                                  ? `下一站 ${route.nextStopName}`
                                  : sourceLabel(first)}
                              </small>
                              {route.routeUid && selected.city ? (
                                <button
                                  className="inline-route-link"
                                  onClick={() => {
                                    const routeResult: BusRouteSearchResult = {
                                      key: route.routeUid ?? route.key,
                                      city: selected.city ?? "",
                                      routeUid: route.routeUid,
                                      routeName: route.routeName,
                                      departure: selected.name,
                                      destination: route.destination,
                                    };
                                    setSelected(null);
                                    void loadRouteDetail(routeResult, selected);
                                  }}
                                >
                                  查看完整路線 <ChevronRight size={14} />
                                </button>
                              ) : null}
                            </div>
                            <div
                              className={`route-eta route-eta--${
                                first
                                  ? departureTone(first, arrivalFetchedAt, clock)
                                  : "muted"
                              }`}
                            >
                              <Timer size={15} />
                              <strong>
                                {first
                                  ? departureLabel(first, arrivalFetchedAt, clock)
                                  : "暫無預估"}
                              </strong>
                              {next ? (
                                <small>
                                  下班 {departureLabel(next, arrivalFetchedAt, clock)}
                                </small>
                              ) : (
                                <small>{sourceLabel(first)}</small>
                              )}
                            </div>
                            <button
                              className={`reminder-button ${
                                reminderActive ? "active" : ""
                              }`}
                              onClick={() => void toggleRouteReminder(selected, route)}
                              aria-label={
                                reminderActive ? "取消到站提醒" : "設定三分鐘到站提醒"
                              }
                            >
                              {reminderActive ? (
                                <BellRing size={16} />
                              ) : (
                                <Bell size={16} />
                              )}
                              {reminderActive ? "已提醒" : "3分提醒"}
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </>
            ) : null}

            {!arrivalsLoading && !directionGroups.length && arrivals.length ? (
              <div className="route-list route-list--fallback">
                {arrivals.map((arrival, index) => {
                  const departure: BusDeparture = { estimateSeconds: arrival.estimateSeconds, stopStatus: arrival.stopStatus, plateNumber: arrival.plateNumber, isLastBus: arrival.isLastBus, nextBusTime: arrival.nextBusTime, dataTime: arrival.dataTime };
                  return <article className="route-card" key={`${arrival.routeName}-${arrival.direction}-${index}`}><div className="route-number">{arrival.routeName}</div><div className="route-copy"><span>往</span><strong>{arrival.destination}</strong><small>{arrival.direction === 0 ? "去程" : "返程"}</small></div><div className={`route-eta route-eta--${departureTone(departure, arrivalFetchedAt, clock)}`}><Timer size={15} /><strong>{departureLabel(departure, arrivalFetchedAt, clock)}</strong></div></article>;
                })}
              </div>
            ) : null}

            <p className="sheet-note">到站資料由各縣市業者提供給 TDX。即時秒數在手機端倒數，每 20 秒重新校正；更新失敗時會保留上次成功資料。</p>
          </section>
        </div>
      ) : null}

      {selectedRoute ? (
        <div
          className="arrival-backdrop"
          onClick={() => {
            setSelectedRoute(null);
            setRouteTargetStation(null);
          }}
        >
          <section
            className="arrival-sheet route-detail-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedRoute.routeName} 路線資訊`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-handle" />
            <header className="arrival-header">
              <div className="arrival-title-row">
                <span className="arrival-stop-icon"><Route size={24} /></span>
                <div>
                  <span className="panel-kicker">公車路線與車輛位置</span>
                  <h2>{selectedRoute.routeName}</h2>
                  <p>
                    <ArrowLeftRight size={14} />
                    {selectedRoute.departure}－{selectedRoute.destination}
                  </p>
                </div>
              </div>
              <div className="arrival-actions">
                <button
                  aria-label="更新車輛位置"
                  disabled={routeLiveLoading}
                  onClick={() => void loadRouteLive(selectedRoute)}
                >
                  <RefreshCw size={19} className={routeLiveLoading ? "spin" : ""} />
                </button>
                <button
                  aria-label="關閉"
                  onClick={() => {
                    setSelectedRoute(null);
                    setRouteTargetStation(null);
                  }}
                >
                  <X size={20} />
                </button>
              </div>
            </header>

            <div className="route-live-strip">
              <span><Radio size={15} />{selectedRouteVehicles.length} 輛車在線</span>
              <small>
                {routeLiveUpdatedAt
                  ? `位置更新 ${formattedTime(routeLiveUpdatedAt)}`
                  : "每 15 秒更新"}
              </small>
            </div>

            {routeDetailLoading ? (
              <div className="arrival-loading">
                <span className="loading-orbit"><Route size={24} /></span>
                <strong>正在取得路線與車輛位置</strong>
                <small>整理去程、返程、站序及即時公車…</small>
              </div>
            ) : null}
            {routeDetailError ? (
              <div className="notice"><AlertTriangle size={18} />{routeDetailError}</div>
            ) : null}
            {!routeDetailLoading && routeLiveWarning ? (
              <div className="notice"><Radio size={18} />{routeLiveWarning}</div>
            ) : null}

            {!routeDetailLoading && routeAlerts.length ? (
              <section className="route-alerts">
                <header><CircleAlert size={18} /><strong>路線營運提醒</strong></header>
                {routeAlerts.slice(0, 3).map((alert) => (
                  <article key={alert.key}>
                    <strong>{alert.title}</strong>
                    {alert.description ? <p>{alert.description}</p> : null}
                    {alert.startTime || alert.endTime ? (
                      <small>
                        {alert.startTime ? formattedTime(alert.startTime) : ""}
                        {alert.startTime && alert.endTime ? "－" : ""}
                        {alert.endTime ? formattedTime(alert.endTime) : ""}
                      </small>
                    ) : null}
                  </article>
                ))}
              </section>
            ) : null}

            {!routeDetailLoading && routeDirections.length ? (
              <>
                <nav className="direction-tabs route-direction-tabs">
                  {routeDirections.map((direction) => (
                    <button
                      key={direction.key}
                      className={
                        selectedRouteDirection?.key === direction.key ? "active" : ""
                      }
                      onClick={() => setActiveRouteDirection(direction.key)}
                    >
                      <Navigation size={16} />
                      <span>往 {direction.destination}</span>
                      <b>{direction.stops.length}</b>
                    </button>
                  ))}
                </nav>

                {selectedRouteDirection ? (
                  <section className="route-stop-board">
                    <header>
                      <span>{selectedRouteDirection.departure}</span>
                      <ArrowLeftRight size={17} />
                      <strong>{selectedRouteDirection.destination}</strong>
                    </header>

                    {routeTargetStation && routeTargetSequence !== null ? (
                      <div className="target-stop-summary">
                        <MapPin size={17} />
                        <div>
                          <strong>目前查詢站牌：{routeTargetStation.name}</strong>
                          <small>
                            {selectedRouteVehicles.length
                              ? selectedRouteVehicles
                                  .map((vehicle) => {
                                    if (vehicle.stopSequence === undefined) {
                                      return `${vehicle.plateNumber} 位置更新中`;
                                    }
                                    const away =
                                      routeTargetSequence - vehicle.stopSequence;
                                    if (away < 0) {
                                      return `${vehicle.plateNumber} 已通過本站`;
                                    }
                                    if (away === 0) {
                                      return `${vehicle.plateNumber} 已到本站附近`;
                                    }
                                    return `${vehicle.plateNumber} 距離 ${away} 站`;
                                  })
                                  .join("・")
                              : "目前沒有可顯示的車輛位置"}
                          </small>
                        </div>
                      </div>
                    ) : null}

                    <ol>
                      {selectedRouteDirection.stops.map((stop, index) => {
                        const vehiclesHere = selectedRouteVehicles.filter(
                          (vehicle) => vehicle.stopSequence === stop.sequence
                        );
                        const isTarget =
                          routeTargetSequence !== null &&
                          routeTargetSequence === stop.sequence;

                        return (
                          <li
                            key={`${stop.stopUid ?? stop.stopId ?? stop.name}-${index}`}
                            className={`${vehiclesHere.length ? "has-bus" : ""} ${
                              isTarget ? "is-target" : ""
                            }`}
                          >
                            <span>{index + 1}</span>
                            <div>
                              <strong>{stop.name}</strong>
                              {isTarget ? (
                                <small>目前查詢站牌</small>
                              ) : index === 0 ? (
                                <small>起點</small>
                              ) : index === selectedRouteDirection.stops.length - 1 ? (
                                <small>終點</small>
                              ) : null}
                              {vehiclesHere.length ? (
                                <div className="vehicles-at-stop">
                                  {vehiclesHere.map((vehicle) => (
                                    <em key={vehicle.key}>
                                      <Bus size={14} />
                                      {vehicle.plateNumber}
                                    </em>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ) : null}
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
