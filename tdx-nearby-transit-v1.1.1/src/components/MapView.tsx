"use client";

import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";
import type { TransitStation } from "@/lib/types";

const busIcon = L.divIcon({
  className: "transit-marker",
  html: '<span class="transit-marker__dot transit-marker__dot--bus">公</span>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const metroIcon = L.divIcon({
  className: "transit-marker",
  html: '<span class="transit-marker__dot transit-marker__dot--metro">捷</span>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

function Recenter({ latitude, longitude }: { latitude: number; longitude: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([latitude, longitude], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [latitude, longitude, map]);
  return null;
}

interface MapViewProps {
  center: { latitude: number; longitude: number } | null;
  stations: TransitStation[];
  selectedId: string | null;
  onSelect: (station: TransitStation) => void;
}

export default function MapView({ center, stations, selectedId, onSelect }: MapViewProps) {
  const fallback = { latitude: 23.6978, longitude: 120.9605 };
  const current = center ?? fallback;

  return (
    <MapContainer
      center={[current.latitude, current.longitude]}
      zoom={center ? 15 : 7}
      className="map"
      scrollWheelZoom
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {center ? <Recenter latitude={center.latitude} longitude={center.longitude} /> : null}
      {center ? (
        <CircleMarker
          center={[center.latitude, center.longitude]}
          radius={9}
          pathOptions={{ fillOpacity: 1, weight: 3 }}
        >
          <Popup>目前搜尋中心</Popup>
        </CircleMarker>
      ) : null}
      {stations.map((station) => (
        <Marker
          key={station.id}
          position={[station.latitude, station.longitude]}
          icon={station.mode === "bus" ? busIcon : metroIcon}
          opacity={selectedId && selectedId !== station.id ? 0.68 : 1}
          eventHandlers={{ click: () => onSelect(station) }}
        >
          <Popup>
            <strong>{station.name}</strong>
            <br />
            {station.mode === "bus" ? "公車站" : "捷運站"}・{station.distanceMeters} 公尺
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
