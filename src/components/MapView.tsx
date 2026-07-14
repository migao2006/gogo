"use client";

import L from "leaflet";
import { useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { TransitStation } from "@/lib/types";

const busIcon = L.divIcon({
  className: "bus-map-marker",
  html: '<span class="bus-map-marker__pin"><span>公</span></span>',
  iconSize: [38, 44],
  iconAnchor: [19, 42],
  popupAnchor: [0, -38],
});

const selectedBusIcon = L.divIcon({
  className: "bus-map-marker bus-map-marker--selected",
  html: '<span class="bus-map-marker__pin"><span>公</span></span>',
  iconSize: [44, 50],
  iconAnchor: [22, 48],
  popupAnchor: [0, -44],
});

function Recenter({ latitude, longitude }: { latitude: number; longitude: number }) {
  const map = useMap();

  useEffect(() => {
    map.flyTo([latitude, longitude], Math.max(map.getZoom(), 15), {
      duration: 0.55,
    });
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
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {center ? <Recenter latitude={center.latitude} longitude={center.longitude} /> : null}

      {center ? (
        <CircleMarker
          center={[center.latitude, center.longitude]}
          radius={8}
          pathOptions={{
            color: "#ffffff",
            fillColor: "#2563eb",
            fillOpacity: 1,
            weight: 3,
          }}
        >
          <Popup>目前搜尋位置</Popup>
        </CircleMarker>
      ) : null}

      {stations.map((station) => (
        <Marker
          key={station.id}
          position={[station.latitude, station.longitude]}
          icon={selectedId === station.id ? selectedBusIcon : busIcon}
          opacity={selectedId && selectedId !== station.id ? 0.6 : 1}
          eventHandlers={{ click: () => onSelect(station) }}
        >
          <Popup>
            <strong>{station.name}</strong>
            <br />
            距離 {station.distanceMeters} 公尺
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
