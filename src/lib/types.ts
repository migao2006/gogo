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
}

export interface BusArrival {
  routeUid?: string;
  routeName: string;
  destination: string;
  direction: number;
  estimateSeconds: number | null;
  stopStatus: number;
  plateNumber?: string;
  isLastBus?: boolean;
  nextBusTime?: string;
  dataTime?: string;
}

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
}
