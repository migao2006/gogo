"use client";

import dynamic from "next/dynamic";
import {
  AlertTriangle,
  ArrowUpRight,
  BusFront,
  ChevronRight,
  Clock3,
  Compass,
  Heart,
  LocateFixed,
  MapPin,
  MapPinned,
  Navigation,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Timer,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  BusArrival,
  BusDeparture,
  BusDirectionGroup,
  TransitStation,
} from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="map-loading">地圖載入中…</div>,
});

type Center = { latitude: number; longitude: number; label?: string };

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

interface BusArrivalsResponse {
  arrivals?: BusArrival[];
  directionGroups?: BusDirectionGroup[];
  warnings?: string[];
  updatedAt?: string;
  error?: string;
}

const RADIUS_OPTIONS = [300, 500, 1000, 2000];

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 20_000
): Promise<Response> {
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

function formattedTime(value?: string | null): string {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  });
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
  now: number
): string {
  const remaining = remainingSeconds(departure, fetchedAt, now);

  if (remaining !== null) {
    if (remaining <= 15) return "即將進站";
    if (remaining < 60) return `${remaining} 秒`;
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
  }

  if (departure.nextBusTime) {
    const date = new Date(departure.nextBusTime);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString("zh-TW", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }

  const statusText: Record<number, string> = {
    1: "尚未發車",
    2: "交管不停靠",
    3: "末班車已過",
    4: "今日未營運",
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

function stationDirectionText(station: TransitStation): string {
  if (station.directionHints?.length) return station.directionHints.join("・");
  if ((station.mergedStopCount ?? 0) > 1) return `${station.mergedStopCount} 個候車方向`;
  return "點開查看行駛方向";
}

export default function TransitApp() {
  const [center, setCenter] = useState<Center | null>(null);
  const [stations, setStations] = useState<TransitStation[]>([]);
  const [radius, setRadius] = useState(500);
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);

  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(true);

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
  const [clock, setClock] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("tdx-bus-favorites") ?? "[]");
        if (Array.isArray(saved)) {
          setFavorites(saved.filter((item) => typeof item === "string"));
        }
      } catch {
        // Ignore malformed local storage.
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selected]);

  const fetchNearby = useCallback(
    async (nextCenter: Center, nextRadius = radius) => {
      setLoading(true);
      setError(null);
      setWarnings([]);

      try {
        const params = new URLSearchParams({
          lat: String(nextCenter.latitude),
          lon: String(nextCenter.longitude),
          radius: String(nextRadius),
        });

        const response = await fetchWithTimeout(`/api/nearby?${params}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as NearbyResponse;

        if (!response.ok) throw new Error(data.error ?? "附近公車站查詢失敗");

        setStations(data.stations ?? []);
        setWarnings(data.warnings ?? []);
        setUpdatedAt(data.updatedAt);
        setCenter({
          ...nextCenter,
          label: nextCenter.label ?? data.locationLabel,
        });
        setSelected(null);
      } catch (requestError) {
        const message =
          requestError instanceof DOMException && requestError.name === "AbortError"
            ? "查詢時間過長，請稍後再試"
            : requestError instanceof Error
              ? requestError.message
              : "附近公車站查詢失敗";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [radius]
  );

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
      const response = await fetchWithTimeout(
        `/api/geocode?q=${encodeURIComponent(query.trim())}`
      );
      const data = (await response.json()) as {
        results?: GeocodeResult[];
        error?: string;
      };

      if (!response.ok) throw new Error(data.error ?? "地址搜尋失敗");
      setSearchResults(data.results ?? []);
      if (!data.results?.length) {
        setError("找不到這個地址或地標，請輸入更完整的名稱");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "地址搜尋失敗");
    } finally {
      setSearchLoading(false);
    }
  };

  const chooseSearchResult = (result: GeocodeResult) => {
    const nextCenter = {
      latitude: result.latitude,
      longitude: result.longitude,
      label: result.name,
    };
    setQuery(result.name.split(",")[0] ?? result.name);
    setSearchResults([]);
    void fetchNearby(nextCenter);
  };

  const loadArrivals = useCallback(
    async (station: TransitStation, silent = false) => {
      setSelected(station);

      if (silent) {
        setArrivalsRefreshing(true);
      } else {
        setArrivalsLoading(true);
        setArrivalMessage(null);
        setArrivalWarnings([]);
        setArrivals([]);
        setDirectionGroups([]);
        setActiveDirection(null);
      }

      try {
        const params = new URLSearchParams({
          city: station.city ?? "",
          stopUids: (station.stopUids?.length ? station.stopUids : [station.uid]).join(","),
        });
        if (station.stationId) params.set("stationId", station.stationId);

        const response = await fetchWithTimeout(`/api/bus/arrivals?${params}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as BusArrivalsResponse;

        if (!response.ok) throw new Error(data.error ?? "公車到站資料查詢失敗");

        const nextGroups = data.directionGroups ?? [];
        setArrivals(data.arrivals ?? []);
        setDirectionGroups(nextGroups);
        setArrivalWarnings(data.warnings ?? []);
        setArrivalUpdatedAt(data.updatedAt ?? new Date().toISOString());
        setArrivalFetchedAt(Date.now());
        setClock(Date.now());
        setArrivalMessage(
          nextGroups.length || data.arrivals?.length
            ? null
            : "此站目前沒有可顯示的公車到站資料"
        );
        setActiveDirection((current) =>
          current && nextGroups.some((group) => group.key === current)
            ? current
            : nextGroups[0]?.key ?? null
        );
      } catch (requestError) {
        const message =
          requestError instanceof DOMException && requestError.name === "AbortError"
            ? "即時資料查詢逾時，請稍後重新整理"
            : requestError instanceof Error
              ? requestError.message
              : "公車到站資料查詢失敗";
        setArrivalMessage(message);
      } finally {
        setArrivalsLoading(false);
        setArrivalsRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!selected) return;
    const timer = window.setInterval(() => {
      void loadArrivals(selected, true);
    }, 20_000);
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
    localStorage.setItem("tdx-bus-favorites", JSON.stringify(next));
  };

  const visibleStations = useMemo(() => {
    const filtered = favoritesOnly
      ? stations.filter((station) => favorites.includes(station.id))
      : stations;

    return [...filtered].sort((a, b) => {
      const favoriteDifference =
        Number(favorites.includes(b.id)) - Number(favorites.includes(a.id));
      return favoriteDifference || a.distanceMeters - b.distanceMeters;
    });
  }, [favorites, favoritesOnly, stations]);

  const selectedDirection = useMemo(
    () =>
      directionGroups.find((group) => group.key === activeDirection) ??
      directionGroups[0] ??
      null,
    [activeDirection, directionGroups]
  );

  return (
    <main className="bus-app">
      <header className="hero">
        <div className="hero__glow hero__glow--one" />
        <div className="hero__glow hero__glow--two" />

        <div className="brand-row">
          <div className="brand">
            <span className="brand__icon"><BusFront size={24} /></span>
            <div>
              <p>TDX 即時資訊</p>
              <strong>Bus Now</strong>
            </div>
          </div>

          <button
            className="hero-icon-button"
            aria-label="重新整理附近公車站"
            disabled={!center || loading}
            onClick={() => center && void fetchNearby(center)}
          >
            <RefreshCw size={20} className={loading ? "spin" : ""} />
          </button>
        </div>

        <div className="hero-copy">
          <span><Sparkles size={15} /> 即時、清楚、只看公車</span>
          <h1>附近公車，一眼掌握</h1>
          <p>定位或輸入地址，查看附近站牌、行駛方向與到站秒數。</p>
        </div>

        <section className="search-panel">
          <form className="search-box" onSubmit={submitSearch}>
            <Search size={20} aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="輸入地址、地標或公車站"
              aria-label="搜尋地址、地標或公車站"
            />
            {query ? (
              <button
                type="button"
                className="search-clear"
                aria-label="清除搜尋"
                onClick={() => {
                  setQuery("");
                  setSearchResults([]);
                }}
              >
                <X size={17} />
              </button>
            ) : null}
            <button
              type="submit"
              className="search-submit"
              disabled={searchLoading || query.trim().length < 2}
            >
              {searchLoading ? <RefreshCw size={18} className="spin" /> : <ArrowUpRight size={18} />}
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

          <div className="search-actions">
            <button
              className="location-button"
              onClick={useCurrentLocation}
              disabled={locationLoading}
            >
              <LocateFixed size={19} />
              {locationLoading ? "正在定位…" : "使用目前位置"}
            </button>

            <label className="radius-control">
              <SlidersHorizontal size={17} />
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
        {error ? (
          <div className="notice notice--error"><AlertTriangle size={18} />{error}</div>
        ) : null}
        {warnings.map((warning) => (
          <div key={warning} className="notice"><AlertTriangle size={18} />{warning}</div>
        ))}

        <section className="overview-grid" aria-label="附近公車摘要">
          <div className="overview-card">
            <span><MapPinned size={18} /></span>
            <div><strong>{stations.length}</strong><small>附近站牌</small></div>
          </div>
          <div className="overview-card">
            <span><Navigation size={18} /></span>
            <div><strong>{radius >= 1000 ? `${radius / 1000}km` : `${radius}m`}</strong><small>搜尋範圍</small></div>
          </div>
          <div className="overview-card">
            <span><Star size={18} /></span>
            <div><strong>{favorites.length}</strong><small>已收藏</small></div>
          </div>
        </section>

        <section className={`map-panel ${mapExpanded ? "" : "map-panel--collapsed"}`}>
          <div className="panel-heading">
            <div>
              <span className="panel-kicker"><MapPinned size={15} /> 附近地圖</span>
              <h2>{center?.label?.split(",")[0] ?? "尚未選擇位置"}</h2>
            </div>
            <button onClick={() => setMapExpanded((value) => !value)}>
              {mapExpanded ? "收起" : "展開"}
            </button>
          </div>

          {mapExpanded ? (
            <div className="map-frame">
              <MapView
                center={center}
                stations={visibleStations}
                selectedId={selected?.id ?? null}
                onSelect={(station) => void loadArrivals(station)}
              />
              {!center ? (
                <div className="map-empty">
                  <LocateFixed size={30} />
                  <strong>先選擇搜尋位置</strong>
                  <span>使用目前位置，或輸入地址與地標</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="station-section">
          <div className="station-heading">
            <div>
              <span className="panel-kicker"><BusFront size={15} /> 站牌清單</span>
              <h2>附近公車站</h2>
              {updatedAt ? (
                <p><Clock3 size={14} />更新於 {formattedTime(updatedAt)}</p>
              ) : null}
            </div>

            <div className="list-filter" role="group" aria-label="站牌篩選">
              <button
                className={!favoritesOnly ? "active" : ""}
                onClick={() => setFavoritesOnly(false)}
              >
                全部
              </button>
              <button
                className={favoritesOnly ? "active" : ""}
                onClick={() => setFavoritesOnly(true)}
              >
                <Heart size={14} />收藏
              </button>
            </div>
          </div>

          {loading ? (
            <div className="skeleton-list" aria-label="資料載入中">
              {[1, 2, 3, 4].map((item) => <div key={item} className="skeleton-card" />)}
            </div>
          ) : visibleStations.length ? (
            <div className="station-list">
              {visibleStations.map((station, index) => {
                const isFavorite = favorites.includes(station.id);
                return (
                  <article key={station.id} className="station-card">
                    <button
                      className="station-card__main"
                      onClick={() => void loadArrivals(station)}
                    >
                      <span className="station-index">{String(index + 1).padStart(2, "0")}</span>
                      <span className="station-icon"><BusFront size={22} /></span>
                      <span className="station-copy">
                        <strong>{station.name}</strong>
                        <small>{stationDirectionText(station)}</small>
                        <span className="station-meta">
                          <b>{distanceLabel(station.distanceMeters)}</b>
                          {station.address ? <i>{station.address}</i> : null}
                        </span>
                      </span>
                      <ChevronRight size={20} className="station-arrow" />
                    </button>

                    <button
                      className={`favorite-button ${isFavorite ? "active" : ""}`}
                      aria-label={isFavorite ? "移除收藏" : "加入收藏"}
                      onClick={() => toggleFavorite(station)}
                    >
                      <Star size={19} fill={isFavorite ? "currentColor" : "none"} />
                    </button>
                  </article>
                );
              })}
            </div>
          ) : center ? (
            <div className="empty-state">
              <BusFront size={34} />
              <strong>{favoritesOnly ? "還沒有收藏站牌" : "搜尋範圍內沒有公車站"}</strong>
              <span>{favoritesOnly ? "點擊站牌旁的星號即可收藏" : "請放大搜尋範圍，或更換搜尋位置"}</span>
            </div>
          ) : (
            <div className="empty-state empty-state--welcome">
              <LocateFixed size={34} />
              <strong>開始尋找附近公車</strong>
              <span>使用目前位置，或在上方輸入地址</span>
            </div>
          )}
        </section>
      </section>

      {selected ? (
        <div className="arrival-backdrop" onClick={() => setSelected(null)}>
          <section
            className="arrival-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`${selected.name} 公車即時資訊`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-handle" />

            <header className="arrival-header">
              <div className="arrival-title-row">
                <span className="arrival-stop-icon"><BusFront size={24} /></span>
                <div>
                  <span className="panel-kicker">公車即時到站</span>
                  <h2>{selected.name}</h2>
                  <p><MapPin size={14} />距離搜尋中心 {distanceLabel(selected.distanceMeters)}</p>
                </div>
              </div>

              <div className="arrival-actions">
                <button
                  className={favorites.includes(selected.id) ? "active" : ""}
                  aria-label="收藏站牌"
                  onClick={() => toggleFavorite(selected)}
                >
                  <Star size={19} fill={favorites.includes(selected.id) ? "currentColor" : "none"} />
                </button>
                <button
                  aria-label="重新整理到站資訊"
                  disabled={arrivalsRefreshing}
                  onClick={() => void loadArrivals(selected, true)}
                >
                  <RefreshCw size={19} className={arrivalsRefreshing ? "spin" : ""} />
                </button>
                <button aria-label="關閉" onClick={() => setSelected(null)}>
                  <X size={20} />
                </button>
              </div>
            </header>

            <div className="live-strip">
              <span><span className="live-dot" />即時更新</span>
              <small>{arrivalUpdatedAt ? `更新於 ${formattedTime(arrivalUpdatedAt)}` : "每 20 秒自動校正"}</small>
            </div>

            {arrivalsLoading ? (
              <div className="arrival-loading">
                <span className="loading-orbit"><BusFront size={24} /></span>
                <strong>正在取得即時到站資訊</strong>
                <small>同步路線、方向與下一班公車…</small>
              </div>
            ) : null}

            {!arrivalsLoading && arrivalMessage ? (
              <div className="notice"><AlertTriangle size={18} />{arrivalMessage}</div>
            ) : null}

            {!arrivalsLoading && arrivalWarnings.map((warning) => (
              <div key={warning} className="notice"><AlertTriangle size={18} />{warning}</div>
            ))}

            {!arrivalsLoading && directionGroups.length ? (
              <>
                <nav className="direction-tabs" aria-label="公車行駛方向">
                  {directionGroups.map((group) => (
                    <button
                      key={group.key}
                      className={selectedDirection?.key === group.key ? "active" : ""}
                      onClick={() => setActiveDirection(group.key)}
                    >
                      <Compass size={16} />
                      <span>{group.label}</span>
                      <b>{group.routes.length}</b>
                    </button>
                  ))}
                </nav>

                {selectedDirection ? (
                  <section className="direction-board">
                    <header>
                      <div>
                        <span><Navigation size={16} />{selectedDirection.label}</span>
                        <h3>{selectedDirection.destinationSummary}</h3>
                      </div>
                      <b>{selectedDirection.routes.length} 條路線</b>
                    </header>

                    <div className="route-list">
                      {selectedDirection.routes.map((route) => {
                        const first = route.departures[0];
                        const next = route.departures[1];
                        return (
                          <article className="route-card" key={route.key}>
                            <div className="route-number">{route.routeName}</div>
                            <div className="route-copy">
                              <span>往</span>
                              <strong>{route.destination}</strong>
                              <small>
                                {first?.plateNumber
                                  ? `車牌 ${first.plateNumber}`
                                  : first?.isLastBus
                                    ? "末班車"
                                    : "TDX 即時資訊"}
                              </small>
                            </div>
                            <div className={`route-eta route-eta--${first ? departureTone(first, arrivalFetchedAt, clock) : "muted"}`}>
                              <Timer size={15} />
                              <strong>{first ? departureLabel(first, arrivalFetchedAt, clock) : "暫無預估"}</strong>
                              {next ? (
                                <small>下班 {departureLabel(next, arrivalFetchedAt, clock)}</small>
                              ) : null}
                            </div>
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
                  const departure: BusDeparture = {
                    estimateSeconds: arrival.estimateSeconds,
                    stopStatus: arrival.stopStatus,
                    plateNumber: arrival.plateNumber,
                    isLastBus: arrival.isLastBus,
                    nextBusTime: arrival.nextBusTime,
                    dataTime: arrival.dataTime,
                  };
                  return (
                    <article className="route-card" key={`${arrival.routeName}-${arrival.direction}-${index}`}>
                      <div className="route-number">{arrival.routeName}</div>
                      <div className="route-copy">
                        <span>往</span><strong>{arrival.destination}</strong>
                        <small>{arrival.direction === 0 ? "去程" : "返程"}</small>
                      </div>
                      <div className={`route-eta route-eta--${departureTone(departure, arrivalFetchedAt, clock)}`}>
                        <Timer size={15} />
                        <strong>{departureLabel(departure, arrivalFetchedAt, clock)}</strong>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}

            <p className="sheet-note">
              到站資訊由各縣市公車業者提供給 TDX；秒數會在手機端持續倒數，並每 20 秒重新校正。
            </p>
          </section>
        </div>
      ) : null}
    </main>
  );
}
