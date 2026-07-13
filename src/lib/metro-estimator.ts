import type { MetroArrival } from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

interface RouteStation {
  id: string;
  name: string;
  sequence: number;
}

interface RoutePattern {
  routeId?: string;
  lineId?: string;
  direction?: number;
  stations: RouteStation[];
}

interface SegmentTime {
  from: string;
  to: string;
  runTime: number;
  stopTime: number;
}

interface LiveTrain {
  trainNumber?: string;
  lineId?: string;
  stationId?: string;
  stationName?: string;
  destinationId?: string;
  destinationName?: string;
  direction?: number;
  moveStatus?: number;
  dataTime?: string;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function localizedName(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return text(value);
  return text(record.Zh_tw) ?? text(record.ZhTw) ?? text(record.Name) ?? text(record.En);
}

function unwrap(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function stationId(operatorId: string, value?: string): string | undefined {
  if (!value) return undefined;
  const prefix = `${operatorId}-`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

export function normalizeRoutePatterns(payload: unknown, operatorId: string): RoutePattern[] {
  const rows = unwrap(payload, ["StationOfRoutes", "StationOfLines", "Data", "Items"]);
  const patterns: RoutePattern[] = [];

  for (const item of rows) {
    const record = asRecord(item);
    if (!record) continue;
    const stations = asArray(record.Stations)
      .map((entry, index) => {
        const stop = asRecord(entry);
        if (!stop) return null;
        const id = stationId(
          operatorId,
          text(stop.StationID) ?? text(stop.StationUID)
        );
        if (!id) return null;
        return {
          id,
          name: localizedName(stop.StationName) ?? id,
          sequence: numberValue(stop.Sequence) ?? numberValue(stop.StopSequence) ?? index + 1,
        } satisfies RouteStation;
      })
      .filter((value): value is RouteStation => value !== null)
      .sort((a, b) => a.sequence - b.sequence);

    if (stations.length < 2) continue;
    patterns.push({
      routeId: text(record.RouteID) ?? text(record.RouteUID),
      lineId: text(record.LineID) ?? text(record.LineNO) ?? text(record.LineNo),
      direction: numberValue(record.Direction),
      stations,
    });
  }

  return patterns;
}

export function normalizeSegmentTimes(payload: unknown, operatorId: string): SegmentTime[] {
  const rows = unwrap(payload, ["S2STravelTimes", "Data", "Items"]);
  const segments: SegmentTime[] = [];

  for (const item of rows) {
    const record = asRecord(item);
    if (!record) continue;
    const travelTimes = asArray(record.TravelTimes ?? record.Segments);
    for (const entry of travelTimes) {
      const segment = asRecord(entry);
      if (!segment) continue;
      const from = stationId(
        operatorId,
        text(segment.FromStationID) ?? text(segment.FromStationUID)
      );
      const to = stationId(
        operatorId,
        text(segment.ToStationID) ?? text(segment.ToStationUID)
      );
      if (!from || !to) continue;
      segments.push({
        from,
        to,
        runTime: Math.max(20, numberValue(segment.RunTime) ?? numberValue(segment.RunTimes) ?? 90),
        stopTime: Math.max(0, numberValue(segment.StopTime) ?? numberValue(segment.StopTimes) ?? 20),
      });
    }
  }

  return segments;
}

export function normalizeLiveTrains(payload: unknown, operatorId: string): LiveTrain[] {
  const rows = unwrap(payload, [
    "LivePositions",
    "TrainLivePositions",
    "TrainLiveBoards",
    "Data",
    "Items",
  ]);
  const trains: LiveTrain[] = [];

  for (const item of rows) {
    const record = asRecord(item);
    if (!record) continue;
    const trainPosition = asRecord(record.TrainPosition);
    const station = stationId(
      operatorId,
      text(record.StationID) ??
        text(record.CurrentStationID) ??
        text(record.NearestStationID) ??
        text(trainPosition?.StationID) ??
        text(trainPosition?.StationUID)
    );
    if (!station) continue;

    trains.push({
      trainNumber: text(record.TrainNo) ?? text(record.TrainNumber),
      lineId: text(record.LineID) ?? text(record.LineNO) ?? text(record.LineNo),
      stationId: station,
      stationName:
        localizedName(record.StationName) ??
        localizedName(record.CurrentStationName) ??
        localizedName(trainPosition?.StationName),
      destinationId: stationId(
        operatorId,
        text(record.DestinationStationID) ?? text(record.EndingStationID)
      ),
      destinationName:
        localizedName(record.DestinationStationName) ??
        localizedName(record.EndingStationName) ??
        localizedName(record.TripHeadSign),
      direction: numberValue(record.Direction),
      moveStatus: numberValue(record.MoveStatus) ?? numberValue(record.TrainStatus),
      dataTime: text(record.UpdateTime) ?? text(record.SrcUpdateTime),
    });
  }

  return trains;
}

function choosePattern(
  train: LiveTrain,
  targetStationId: string,
  patterns: RoutePattern[]
): RoutePattern | undefined {
  let best: { pattern: RoutePattern; score: number } | undefined;

  for (const pattern of patterns) {
    const currentIndex = pattern.stations.findIndex((station) => station.id === train.stationId);
    const targetIndex = pattern.stations.findIndex((station) => station.id === targetStationId);
    if (currentIndex < 0 || targetIndex <= currentIndex) continue;

    let score = 0;
    if (train.lineId && pattern.lineId === train.lineId) score += 5;
    if (train.direction !== undefined && pattern.direction === train.direction) score += 4;
    const last = pattern.stations.at(-1)?.id;
    if (train.destinationId && last === train.destinationId) score += 8;
    if (train.destinationName && pattern.stations.at(-1)?.name === train.destinationName) score += 3;
    score -= Math.max(0, targetIndex - currentIndex) * 0.01;

    if (!best || score > best.score) best = { pattern, score };
  }

  return best?.pattern;
}

function buildSegmentMap(segments: SegmentTime[]): Map<string, SegmentTime> {
  const map = new Map<string, SegmentTime>();
  for (const segment of segments) {
    map.set(`${segment.from}>${segment.to}`, segment);
    if (!map.has(`${segment.to}>${segment.from}`)) {
      map.set(`${segment.to}>${segment.from}`, {
        from: segment.to,
        to: segment.from,
        runTime: segment.runTime,
        stopTime: segment.stopTime,
      });
    }
  }
  return map;
}

export function estimateMetroArrivals(options: {
  operatorId: string;
  targetStationId: string;
  routePayload: unknown;
  segmentPayload: unknown;
  livePositionPayload: unknown;
  calculatedAt?: string;
}): MetroArrival[] {
  const target = stationId(options.operatorId, options.targetStationId);
  if (!target) return [];

  const patterns = normalizeRoutePatterns(options.routePayload, options.operatorId);
  const segments = normalizeSegmentTimes(options.segmentPayload, options.operatorId);
  const trains = normalizeLiveTrains(options.livePositionPayload, options.operatorId);
  const segmentMap = buildSegmentMap(segments);
  const calculatedAt = options.calculatedAt ?? new Date().toISOString();
  const results: MetroArrival[] = [];

  for (const train of trains) {
    const pattern = choosePattern(train, target, patterns);
    if (!pattern || !train.stationId) continue;
    const currentIndex = pattern.stations.findIndex((station) => station.id === train.stationId);
    const targetIndex = pattern.stations.findIndex((station) => station.id === target);
    if (currentIndex < 0 || targetIndex <= currentIndex) continue;

    let etaSeconds = 0;
    let usedFallback = false;

    for (let index = currentIndex; index < targetIndex; index += 1) {
      const from = pattern.stations[index];
      const to = pattern.stations[index + 1];
      const segment = segmentMap.get(`${from.id}>${to.id}`);
      const runTime = segment?.runTime ?? 95;
      const dwellTime = segment?.stopTime ?? 20;
      if (!segment) usedFallback = true;

      if (index === currentIndex && train.moveStatus === 1) {
        etaSeconds += Math.round(runTime * 0.5);
      } else {
        if (index === currentIndex && train.moveStatus !== 1) {
          etaSeconds += Math.min(30, Math.max(8, dwellTime));
        }
        etaSeconds += runTime;
      }

      if (index + 1 < targetIndex) {
        etaSeconds += Math.min(45, Math.max(8, dwellTime));
      }
    }

    if (etaSeconds <= 0 || etaSeconds > 7_200) continue;
    const destinationStation = pattern.stations.at(-1);

    results.push({
      lineId: train.lineId ?? pattern.lineId,
      destination:
        train.destinationName ?? destinationStation?.name ?? train.destinationId ?? "終點站未提供",
      direction: train.direction ?? pattern.direction,
      estimateSeconds: etaSeconds,
      trainNumber: train.trainNumber,
      dataTime: train.dataTime,
      source: "estimated",
      confidence: usedFallback ? "low" : "medium",
      calculatedAt,
      currentStationName: train.stationName ?? pattern.stations[currentIndex]?.name,
    });
  }

  return results
    .filter((arrival, index, array) => {
      const key = `${arrival.trainNumber ?? ""}:${arrival.lineId ?? ""}:${arrival.destination}:${arrival.estimateSeconds}`;
      return array.findIndex((item) =>
        `${item.trainNumber ?? ""}:${item.lineId ?? ""}:${item.destination}:${item.estimateSeconds}` === key
      ) === index;
    })
    .sort((a, b) => (a.estimateSeconds ?? Infinity) - (b.estimateSeconds ?? Infinity))
    .slice(0, 30);
}
