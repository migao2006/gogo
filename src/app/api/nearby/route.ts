import { NextRequest, NextResponse } from "next/server";
import { clampRadius, normalizeTdxCity } from "@/lib/geography";
import { normalizeBusStops } from "@/lib/normalize";
import { tdxFetch } from "@/lib/tdx";
import type { TransitStation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReverseResult {
  display_name?: string;
  address?: Record<string, string | undefined>;
}

function validCityCode(value: string | null): string | null {
  return value && /^[A-Za-z]+$/.test(value) ? value : null;
}

async function reverseGeocode(
  lat: number,
  lon: number
): Promise<{ city: string | null; label?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_500);

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("zoom", "10");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "zh-TW");

    const response = await fetch(url, {
      headers: {
        "user-agent": process.env.GEOCODER_USER_AGENT ?? "TDX-Bus-Now/2.2.1",
        accept: "application/json",
      },
      next: { revalidate: 1_800 },
      signal: controller.signal,
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
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.warn("Reverse geocode failed", error);
    }
    return { city: null };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBusStops(city: string, lat: number, lon: number, radius: number) {
  const payload = await tdxFetch<unknown>(
    `/v2/Bus/Stop/City/${city}`,
    {
      "$spatialFilter": `nearby(${lat},${lon},${radius})`,
      "$format": "JSON",
    },
    120
  );
  return normalizeBusStops(payload, lat, lon, city, radius);
}

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lon = Number(request.nextUrl.searchParams.get("lon"));
  const radius = clampRadius(Number(request.nextUrl.searchParams.get("radius") ?? 300));
  const requestedCity = validCityCode(request.nextUrl.searchParams.get("city"));

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < 20 ||
    lat > 27 ||
    lon < 118 ||
    lon > 123
  ) {
    return NextResponse.json({ error: "座標不在臺灣合理範圍內" }, { status: 400 });
  }

  try {
    const location = requestedCity
      ? { city: requestedCity, label: undefined }
      : await reverseGeocode(lat, lon);
    const warnings: string[] = [];
    let stations: TransitStation[] = [];

    if (!location.city) {
      warnings.push("目前無法快速判斷縣市，請改用較完整的地址搜尋");
    } else {
      try {
        stations = await fetchBusStops(location.city, lat, lon, radius);
      } catch (error) {
        console.error("Bus nearby failed", error);
        warnings.push("公車站資料暫時無法更新，請稍後重新整理");
      }
    }

    return NextResponse.json({
      city: location.city,
      locationLabel: location.label,
      radius,
      updatedAt: new Date().toISOString(),
      stations: stations.slice(0, 60),
      warnings,
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "附近公車站查詢失敗";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
