"use client";

import dynamic from "next/dynamic";
import {
  AlertTriangle,
  BusFront,
  Clock3,
  LocateFixed,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  Star,
  TrainFront,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  BusArrival,
  BusDirectionGroup,
  MetroArrival,
  TransitStation,
  TransportMode,
} from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="map-loading">地圖載入中…</div>,
});

type Center = { latitude: number; longitude: number; label?: string };
type FilterMode = "all" | TransportMode;

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
}

const RADIUS_OPTIONS = [300, 500, 1000, 2000];

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function distanceLabel(meters: number): string {
  if (meters < 1_000) return `${meters} 公尺`;
  return `${(meters / 1_000).toFixed(1)} 公里`;
}

function etaLabel(seconds: number | null, status = 0, nextBusTime?: string): string {
  if (seconds !== null) {
    if (seconds <= 30) return "進站中";
    if (seconds < 90) return "約 1 分鐘";
    return `約 ${Math.ceil(seconds / 60)} 分鐘`;
  }
  if (nextBusTime) {
    const date = new Date(nextBusTime);
    if (!Number.isNaN(date.getTime())) {
      return `預計 ${date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`;
    }
  }
  const statusText: Record<number, string> = {
    1: "尚未發車",
    2: "交管不停靠",
    3: "末班車已過",
    4: "今日未營運",
  };
  return statusText[status] ?? "暫無預估";
}

function metroEtaLabel(arrival: MetroArrival, now: number): string {
  const statusText: Record<number, string> = {
    0: "正常",
    1: "尚未發車",
    2: "交管不停靠",
    3: "末班車已過",
    4: "今日未營運",
  };

  if (arrival.estimateSeconds !== null) {
    const calculatedAt = arrival.calculatedAt ? Date.parse(arrival.calculatedAt) : now;
    const elapsed = Number.isFinite(calculatedAt)
      ? Math.max(0, Math.floor((now - calculatedAt) / 1_000))
      : 0;
    const remaining = Math.max(0, arrival.estimateSeconds - elapsed);
    if (remaining <= 15) return "即將進站";
    if (remaining < 60) return `${remaining} 秒`;
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
  }
  if (arrival.arrivalTime) return arrival.arrivalTime;
  if (arrival.trainStatus !== undefined) return statusText[arrival.trainStatus] ?? "狀態未知";
  return "暫無預估";
}

function metroSourceLabel(arrival: MetroArrival): string {
  if (arrival.source === "official") return "TDX 官方即時";
  if (arrival.source === "estimated") {
    return arrival.confidence === "low" ? "系統推估・較低信心" : "系統推估";
  }
  if (arrival.source === "schedule") return "時刻表推估";
  return "TDX 即時資訊";
}

export default function TransitApp() {
  const [center, setCenter] = useState<Center | null>(null);
  const [stations, setStations] = useState<TransitStation[]>([]);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [radius, setRadius] = useState(500);
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<TransitStation | null>(null);
  const [arrivalsLoading, setArrivalsLoading] = useState(false);
  const [busArrivals, setBusArrivals] = useState<BusArrival[]>([]);
  const [busDirectionGroups, setBusDirectionGroups] = useState<BusDirectionGroup[]>([]);
  const [metroArrivals, setMetroArrivals] = useState<MetroArrival[]>([]);
  const [arrivalMessage, setArrivalMessage] = useState<string | null>(null);
  const [arrivalWarnings, setArrivalWarnings] = useState<string[]>([]);
  const [metroSourceSummary, setMetroSourceSummary] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [query, setQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("tdx-transit-favorites") ?? "[]");
        if (Array.isArray(saved)) setFavorites(saved.filter((item) => typeof item === "string"));
      } catch {
        // Ignore malformed local storage.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (selected?.mode !== "metro") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [selected?.mode]);

  const fetchNearby = useCallback(async (nextCenter: Center, nextRadius = radius) => {
    setLoading(true);
    setError(null);
    setWarnings([]);
    try {
      const params = new URLSearchParams({
        lat: String(nextCenter.latitude),
        lon: String(nextCenter.longitude),
        radius: String(nextRadius),
      });
      const response = await fetch(`/api/nearby?${params}`, { cache: "no-store" });
      const data = (await response.json()) as NearbyResponse;
      if (!response.ok) throw new Error(data.error ?? "附近交通資料查詢失敗");
      setStations(data.stations);
      setWarnings(data.warnings ?? []);
      setUpdatedAt(data.updatedAt);
      setCenter((current) => ({
        ...nextCenter,
        label: current?.label ?? data.locationLabel ?? nextCenter.label,
      }));
      setSelected(null);
      setBusArrivals([]);
      setBusDirectionGroups([]);
      setMetroArrivals([]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "查詢失敗");
    } finally {
      setLoading(false);
    }
  }, [radius]);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError("此瀏覽器不支援定位功能");
      return;
    }
    setLocationLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextCenter = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: "目前位置",
        };
        setCenter(nextCenter);
        setLocationLoading(false);
        void fetchNearby(nextCenter);
      },
      (geoError) => {
        const messages: Record<number, string> = {
          1: "定位權限被拒絕，請允許瀏覽器使用位置，或改用地址搜尋。",
          2: "目前無法取得定位資訊。",
          3: "定位逾時，請再試一次。",
        };
        setError(messages[geoError.code] ?? "定位失敗");
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
    );
  };

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearchLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`);
      const data = (await response.json()) as { results?: GeocodeResult[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "地址搜尋失敗");
      setSearchResults(data.results ?? []);
      if (!data.results?.length) setError("找不到這個地址或地標，請輸入更完整的名稱");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "地址搜尋失敗");
    } finally {
      setSearchLoading(false);
    }
  };

  const chooseSearchResult = (result: GeocodeResult) => {
    const nextCenter = { latitude: result.latitude, longitude: result.longitude, label: result.name };
    setCenter(nextCenter);
    setQuery(result.name.split(",")[0] ?? result.name);
    setSearchResults([]);
    void fetchNearby(nextCenter);
  };

  const loadArrivals = useCallback(async (station: TransitStation, silent = false) => {
    setSelected(station);
    if (!silent) {
      setArrivalsLoading(true);
      setArrivalMessage(null);
      setArrivalWarnings([]);
      setMetroSourceSummary(null);
      setBusArrivals([]);
      setBusDirectionGroups([]);
      setMetroArrivals([]);
    }

    try {
      if (station.mode === "bus") {
        const params = new URLSearchParams({ city: station.city ?? "" });
        if (station.stationId) params.set("stationId", station.stationId);
        params.set("stopUids", (station.stopUids?.length ? station.stopUids : [station.uid]).join(","));
        const response = await fetchWithTimeout(`/api/bus/arrivals?${params}`, { cache: "no-store" });
        const data = (await response.json()) as {
          arrivals?: BusArrival[];
          directionGroups?: BusDirectionGroup[];
          warnings?: string[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "公車到站資料查詢失敗");
        setBusArrivals(data.arrivals ?? []);
        setBusDirectionGroups(data.directionGroups ?? []);
        setArrivalWarnings(data.warnings ?? []);
        if (!data.arrivals?.length) setArrivalMessage("此站目前沒有可顯示的公車到站資料");
      } else {
        const params = new URLSearchParams({
          operatorId: station.operatorId ?? "",
          stationId: station.stationId ?? station.uid,
        });
        const response = await fetchWithTimeout(`/api/metro/arrivals?${params}`, { cache: "no-store" });
        const data = (await response.json()) as {
          arrivals?: MetroArrival[];
          sourceSummary?: string;
          warnings?: string[];
          message?: string;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "捷運到站資料查詢失敗");
        setMetroArrivals(data.arrivals ?? []);
        setMetroSourceSummary(data.sourceSummary ?? null);
        setArrivalWarnings(data.warnings ?? []);
        setClock(Date.now());
        if (!data.arrivals?.length) setArrivalMessage(data.message ?? "此站目前沒有可顯示的捷運到站資料");
        else setArrivalMessage(null);
      }
    } catch (requestError) {
      if (!silent) {
        const message = requestError instanceof DOMException && requestError.name === "AbortError"
          ? "即時資料查詢逾時，請按重新整理再試一次。"
          : requestError instanceof Error
            ? requestError.message
            : "即時資訊查詢失敗";
        setArrivalMessage(message);
      }
    } finally {
      if (!silent) setArrivalsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selected || selected.mode !== "metro") return;
    const timer = window.setInterval(() => {
      void loadArrivals(selected, true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadArrivals, selected]);

  const changeRadius = (nextRadius: number) => {
    setRadius(nextRadius);
    if (center) void fetchNearby(center, nextRadius);
  };

  const toggleFavorite = (station: TransitStation) => {
    const next = favorites.includes(station.id)
      ? favorites.filter((id) => id !== station.id)
      : [...favorites, station.id];
    setFavorites(next);
    localStorage.setItem("tdx-transit-favorites", JSON.stringify(next));
  };

  const visibleStations = useMemo(() => {
    const filtered = filter === "all" ? stations : stations.filter((station) => station.mode === filter);
    return [...filtered].sort((a, b) => {
      const favoriteDifference = Number(favorites.includes(b.id)) - Number(favorites.includes(a.id));
      return favoriteDifference || a.distanceMeters - b.distanceMeters;
    });
  }, [favorites, filter, stations]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">TDX 即時大眾運輸</p>
          <h1>附近交通</h1>
        </div>
        <button
          className="icon-button"
          aria-label="重新整理"
          disabled={!center || loading}
          onClick={() => center && void fetchNearby(center)}
        >
          <RefreshCw size={20} className={loading ? "spin" : ""} />
        </button>
      </header>

      <section className="search-section">
        <form className="search-box" onSubmit={submitSearch}>
          <Search size={20} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="輸入地址、地標或車站名稱"
            aria-label="搜尋地址或地標"
          />
          {query ? (
            <button type="button" aria-label="清除搜尋" onClick={() => { setQuery(""); setSearchResults([]); }}>
              <X size={18} />
            </button>
          ) : null}
          <button type="submit" className="search-submit" disabled={searchLoading || query.trim().length < 2}>
            {searchLoading ? "搜尋中" : "搜尋"}
          </button>
        </form>

        {searchResults.length > 0 ? (
          <div className="search-results">
            {searchResults.map((result) => (
              <button key={result.id} onClick={() => chooseSearchResult(result)}>
                <MapPin size={18} />
                <span>{result.name}</span>
              </button>
            ))}
          </div>
        ) : null}

        <button className="locate-button" onClick={useCurrentLocation} disabled={locationLoading}>
          <LocateFixed size={20} />
          {locationLoading ? "正在取得位置…" : "使用我的目前位置"}
        </button>
      </section>

      <section className="control-row" aria-label="交通類型與搜尋範圍">
        <div className="segmented">
          {([
            ["all", "全部"],
            ["bus", "公車"],
            ["metro", "捷運"],
          ] as const).map(([value, label]) => (
            <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <select value={radius} onChange={(event) => changeRadius(Number(event.target.value))} aria-label="搜尋範圍">
          {RADIUS_OPTIONS.map((value) => (
            <option key={value} value={value}>{value >= 1000 ? `${value / 1000} 公里` : `${value} 公尺`}</option>
          ))}
        </select>
      </section>

      {error ? <div className="notice notice--error"><AlertTriangle size={18} />{error}</div> : null}
      {warnings.map((warning) => <div key={warning} className="notice"><AlertTriangle size={18} />{warning}</div>)}

      <section className="map-card" aria-label="附近交通地圖">
        <MapView center={center} stations={visibleStations} selectedId={selected?.id ?? null} onSelect={loadArrivals} />
        {!center ? (
          <div className="map-empty">
            <Navigation size={32} />
            <strong>先選擇搜尋位置</strong>
            <span>使用目前位置，或輸入地址與地標</span>
          </div>
        ) : null}
      </section>

      <section className="station-section">
        <div className="section-heading">
          <div>
            <h2>附近站點</h2>
            <p>{center?.label ?? "尚未選擇位置"}</p>
          </div>
          <span>{visibleStations.length} 站</span>
        </div>

        {updatedAt ? (
          <p className="updated-at"><Clock3 size={14} />更新於 {new Date(updatedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
        ) : null}

        {loading ? (
          <div className="skeleton-list" aria-label="資料載入中">
            {[1, 2, 3].map((item) => <div key={item} className="skeleton-card" />)}
          </div>
        ) : visibleStations.length ? (
          <div className="station-list">
            {visibleStations.map((station) => (
              <article key={station.id} className={`station-card ${selected?.id === station.id ? "selected" : ""}`}>
                <button className="station-main" onClick={() => void loadArrivals(station)}>
                  <span className={`station-icon station-icon--${station.mode}`}>
                    {station.mode === "bus" ? <BusFront size={22} /> : <TrainFront size={22} />}
                  </span>
                  <span className="station-copy">
                    <strong>{station.name}</strong>
                    <small>
                      {station.mode === "bus"
                        ? station.directionHints?.length
                          ? `公車站・${station.directionHints.join("／")}`
                          : station.mergedStopCount && station.mergedStopCount > 1
                            ? `公車站・已整併 ${station.mergedStopCount} 個站牌資料`
                            : "公車站・點開查看各方向"
                        : `${station.operatorId ?? "捷運"} 車站`}
                      {station.address ? `・${station.address}` : ""}
                    </small>
                  </span>
                  <span className="distance">{distanceLabel(station.distanceMeters)}</span>
                </button>
                <button
                  className={`favorite-button ${favorites.includes(station.id) ? "active" : ""}`}
                  aria-label={favorites.includes(station.id) ? "移除收藏" : "加入收藏"}
                  onClick={() => toggleFavorite(station)}
                >
                  <Star size={18} fill={favorites.includes(station.id) ? "currentColor" : "none"} />
                </button>
              </article>
            ))}
          </div>
        ) : center ? (
          <div className="empty-state">搜尋範圍內找不到符合條件的站點，請放大搜尋範圍。</div>
        ) : null}
      </section>

      {selected ? (
        <div className="arrival-backdrop" onClick={() => setSelected(null)}>
          <section className="arrival-sheet" role="dialog" aria-modal="true" aria-label={`${selected.name} 即時資訊`} onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="arrival-header">
              <div>
                <span>{selected.mode === "bus" ? "公車即時到站" : "捷運即時到站"}</span>
                <h2>{selected.name}</h2>
                <p>距離搜尋中心 {distanceLabel(selected.distanceMeters)}</p>
              </div>
              <button className="icon-button" aria-label="關閉" onClick={() => setSelected(null)}><X size={20} /></button>
            </div>

            {arrivalsLoading ? <div className="arrival-loading"><RefreshCw size={20} className="spin" />取得即時資料中…</div> : null}
            {!arrivalsLoading && arrivalMessage ? <div className="notice"><AlertTriangle size={18} />{arrivalMessage}</div> : null}
            {!arrivalsLoading && arrivalWarnings.map((warning) => (
              <div key={warning} className="notice"><AlertTriangle size={18} />{warning}</div>
            ))}

            {!arrivalsLoading && selected.mode === "bus" ? (
              <div className="direction-list">
                {busDirectionGroups.map((group) => (
                  <section className="direction-group" key={group.key}>
                    <header className="direction-header">
                      <div>
                        <strong><Navigation size={17} />{group.label}</strong>
                        <span>{group.destinationSummary}</span>
                      </div>
                      <b>{group.routes.length} 條路線</b>
                    </header>
                    <div className="arrival-list arrival-list--compact">
                      {group.routes.map((route) => (
                        <div key={route.key} className="arrival-row bus-route-row">
                          <strong className="route-badge">{route.routeName}</strong>
                          <div>
                            <span>往 {route.destination}</span>
                            <small>{route.departures[0]?.plateNumber ? `車牌 ${route.departures[0].plateNumber}` : "TDX 即時資訊"}</small>
                          </div>
                          <div className="route-times">
                            {route.departures.map((departure, index) => (
                              <b key={`${departure.estimateSeconds}-${departure.nextBusTime}-${index}`}>
                                {index === 1 ? "下班 " : ""}{etaLabel(departure.estimateSeconds, departure.stopStatus, departure.nextBusTime)}
                              </b>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
                {!busDirectionGroups.length && busArrivals.length ? (
                  <div className="arrival-list">
                    {busArrivals.map((arrival, index) => (
                      <div key={`${arrival.routeUid ?? arrival.routeName}-${arrival.direction}-${index}`} className="arrival-row">
                        <strong className="route-badge">{arrival.routeName}</strong>
                        <div><span>往 {arrival.destination}</span><small>{arrival.heading ?? "行駛方向未提供"}</small></div>
                        <b>{etaLabel(arrival.estimateSeconds, arrival.stopStatus, arrival.nextBusTime)}</b>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {!arrivalsLoading && selected.mode === "metro" ? (
              <>
                {metroSourceSummary ? <div className="source-summary">資料來源：{metroSourceSummary}・每 15 秒校正</div> : null}
                <div className="arrival-list">
                  {metroArrivals.map((arrival, index) => (
                    <div key={`${arrival.trainNumber ?? arrival.destination}-${index}`} className="arrival-row metro-arrival-row">
                      <strong className="route-badge route-badge--metro">{arrival.lineId ?? "捷運"}</strong>
                      <div>
                        <span>往 {arrival.destination}</span>
                        <small>
                          {arrival.currentStationName ? `目前 ${arrival.currentStationName}・` : ""}
                          {metroSourceLabel(arrival)}
                        </small>
                      </div>
                      <b>{metroEtaLabel(arrival, clock)}</b>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            <p className="sheet-note">
              {selected.mode === "metro"
                ? "官方即時看板有資料時優先採用；其餘班次依列車位置、完整站序與站間行駛時間推估，可能有數十秒誤差。"
                : "同一實體站牌已整併，路線依下一站方位分組；若 TDX 缺少站序則以去程／返程顯示。"}
            </p>
          </section>
        </div>
      ) : null}
    </main>
  );
}
