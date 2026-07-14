export interface TransitStation {
  id: string;
  uid: string;
  name: string;
  englishName?: string;
  mode: "bus";
  latitude: number;
  longitude: number;
  distanceMeters: number;
  city?: string;
  cityCode?: string;
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
  nextStopName?: string;
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
  nextStopName?: string;
  departures: BusDeparture[];
}

export interface BusDirectionGroup {
  key: string;
  label: string;
  destinationSummary: string;
  nextStopSummary?: string;
  routes: BusRouteArrival[];
}

export interface BusArrivalResult {
  arrivals: BusArrival[];
  directionGroups: BusDirectionGroup[];
  warnings: string[];
  updatedAt: string;
  stale?: boolean;
  cachedAt?: string;
}

export interface BusStationPreview {
  stationId: string;
  direction?: BusDirectionGroup;
  alternativeDirectionCount: number;
  updatedAt: string;
  stale?: boolean;
  warning?: string;
}

export interface BusRouteSearchResult {
  key: string;
  city: string;
  routeUid?: string;
  routeName: string;
  departure: string;
  destination: string;
  operatorName?: string;
}

export interface BusRouteStop {
  stopUid?: string;
  stopId?: string;
  name: string;
  sequence: number;
  latitude?: number;
  longitude?: number;
}

export interface BusRouteDirection {
  key: string;
  routeUid?: string;
  subRouteUid?: string;
  routeName: string;
  direction: number;
  departure: string;
  destination: string;
  stops: BusRouteStop[];
}


export interface BusLiveVehicle {
  key: string;
  plateNumber: string;
  routeUid?: string;
  subRouteUid?: string;
  direction: number;
  stopUid?: string;
  stopName?: string;
  stopSequence?: number;
  latitude?: number;
  longitude?: number;
  speed?: number;
  dutyStatus?: number;
  busStatus?: number;
  a2EventType?: number;
  gpsTime?: string;
  updatedAt?: string;
}

export interface BusRouteAlert {
  key: string;
  title: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  status?: number;
}

export interface BusRouteLiveResult {
  vehicles: BusLiveVehicle[];
  alerts: BusRouteAlert[];
  updatedAt: string;
  warning?: string;
  unavailable?: boolean;
  stale?: boolean;
}

export interface BusReminder {
  key: string;
  station: Pick<TransitStation, "id" | "name" | "city" | "uid" | "stopUids" | "stationId">;
  routeUid?: string;
  routeName: string;
  direction: number;
  destination: string;
  thresholdSeconds: number;
  fired: boolean;
  createdAt: number;
}
