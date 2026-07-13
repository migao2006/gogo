import { NextRequest, NextResponse } from "next/server";
import { clampRadius, normalizeTdxCity, operatorsForCity } from "@/lib/geography";
import { normalizeBusStops, normalizeMetroStations } from "@/lib/normalize";
import { firstSuccessfulTdxFetch, tdxFetch } from "@/lib/tdx";
import type { TransitStation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReverseResult {
  display_name?: string;
  address?: Record<string, string | undefined>;
}

async function reverseGeocode(lat: number, lon: number): Promise<{ city: string | null; label?: string }> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("zoom", "10");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "zh-TW");

  const response = await fetch(url, {
    headers: {
      "user-agent": process.env.GEOCODER_USER_AGENT ?? "TDX-Nearby-Transit/1.0",
      accept: "application/json",
    },
    next: { revalidate: 600 },
  });
  if (!response.ok) return { city: null };

  const data = (await response.json()) as ReverseResult;
  const address = data.address ?? {};
  const localName =
    address.city ??
    address.county ??
    address.state ??
    address.municipality ??
    address.town;
  return { city: normalizeTdxCity(localName), label: data.display_name };
}

async function fetchBusStops(city: string, lat: number, lon: number, radius: number) {
  const payload = await tdxFetch<unknown>(`/v2/Bus/Stop/City/${city}`, {
    "$spatialFilter": `nearby(${lat},${lon},${radius})`,
    "$format": "JSON",
  }, 60);
  return normalizeBusStops(payload, lat, lon, city, radius);
}

async function fetchMetroForOperator(
  operatorId: string,
  lat: number,
  lon: number,
  radius: number
): Promise<TransitStation[]> {
  const spatialParams = {
    "$spatialFilter": `nearby(${lat},${lon},${radius})`,
    "$format": "JSON",
  };
  const allStationParams = {
    "$format": "JSON",
  };
  const payload = await firstSuccessfulTdxFetch<unknown>([
    { path: `/v2/Rail/Metro/Station/${operatorId}`, params: spatialParams },
    { path: `/v2/Rail/Metro/Station/${operatorId}`, params: allStationParams },
    { path: `/v3/Rail/Metro/Station/${operatorId}`, params: spatialParams },
    { path: `/v3/Rail/Metro/Station/${operatorId}`, params: allStationParams },
  ], 3600);
  return normalizeMetroStations(payload, lat, lon, operatorId, radius);
}

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lon = Number(request.nextUrl.searchParams.get("lon"));
  const radius = clampRadius(Number(request.nextUrl.searchParams.get("radius") ?? 500));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 20 || lat > 27 || lon < 118 || lon > 123) {
    return NextResponse.json({ error: "座標不在臺灣合理範圍內" }, { status: 400 });
  }

  try {
    const location = await reverseGeocode(lat, lon);
    const city = location.city;
    const warnings: string[] = [];

    const busPromise = city
      ? fetchBusStops(city, lat, lon, radius).catch((error) => {
          console.error("Bus nearby failed", error);
          warnings.push("公車站資料暫時無法取得");
          return [] as TransitStation[];
        })
      : Promise.resolve([] as TransitStation[]);

    if (!city) warnings.push("無法判斷所在縣市，因此未查詢公車站");

    const metroOperators = operatorsForCity(city);
    const metroPromise = Promise.all(
      metroOperators.map((operator) =>
        fetchMetroForOperator(operator, lat, lon, radius).catch((error) => {
          console.error(`Metro ${operator} failed`, error);
          return [] as TransitStation[];
        })
      )
    ).then((groups) => groups.flat());

    const [busStations, metroStations] = await Promise.all([busPromise, metroPromise]);
    const stations = [...busStations, ...metroStations]
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 80);

    return NextResponse.json({
      city,
      locationLabel: location.label,
      radius,
      updatedAt: new Date().toISOString(),
      stations,
      warnings,
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "附近交通資料查詢失敗";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
