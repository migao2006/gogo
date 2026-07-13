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
