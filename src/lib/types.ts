export type TransportMode = "bus" | "metro";

export interface LocalizedName {
  zh_tw?: string;
  en?: string;
}

export interface TransitStation {
  id: string;
  uid: string;
  name: string;
  englishName?: string;
  mode: TransportMode;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  city?: string;
  cityCode?: string;
  operatorId?: string;
  lineId?: string;
  address?: string;
  stationId?: string;
  stopUids?: string[];
  directionHints?: string[];
  mergedStopCount?: number;
}

export interface BusArrival {
  routeUid?: string;
  subRouteUid?: string;
  routeName: string;
  destination: string;
  direction: number;
  estimateSeconds: number | null;
  stopStatus: number;
  stopUid?: string;
  stationId?: string;
  stopSequence?: number;
  plateNumber?: string;
  isLastBus?: boolean;
  nextBusTime?: string;
  dataTime?: string;
  heading?: string;
  bearing?: number;
}

export interface BusDeparture {
  estimateSeconds: number | null;
  stopStatus: number;
  plateNumber?: string;
  isLastBus?: boolean;
  nextBusTime?: string;
  dataTime?: string;
}

export interface BusRouteArrival {
  key: string;
  routeUid?: string;
  routeName: string;
  destination: string;
  direction: number;
  departures: BusDeparture[];
}

export interface BusDirectionGroup {
  key: string;
  label: string;
  destinationSummary: string;
  routes: BusRouteArrival[];
}

export type MetroArrivalSource = "official" | "estimated" | "schedule";

export interface MetroArrival {
  lineId?: string;
  routeName?: string;
  destination: string;
  direction?: number;
  estimateSeconds: number | null;
  platform?: string;
  trainNumber?: string;
  arrivalTime?: string;
  trainStatus?: number;
  dataTime?: string;
  source?: MetroArrivalSource;
  confidence?: "high" | "medium" | "low";
  calculatedAt?: string;
  currentStationName?: string;
}
