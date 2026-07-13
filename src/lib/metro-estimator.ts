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

interface LiveBoardAnchor {
  lineId?: string;
  stationId: string;
  stationName?: string;
  destinationId?: string;
  destinationName?: string;
  direction?: number;
  estimateSeconds: number;
  trainNumber?: string;
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

export function normalizeMetroStationId(operatorId: string, value?: string): string | undefined {
  if (!value) return undefined;
  const prefix = `${operatorId}-`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

export function liveBoardRows(payload: unknown): UnknownRecord[] {
  return unwrap(payload, ["LiveBoards", "StationLiveBoards", "Data", "Items"])
    .map(asRecord)
    .filter((value): value is UnknownRecord => value !== null);
}

export function liveBoardStationId(record: UnknownRecord, operatorId: string): string | undefined {
  return normalizeMetroStationId(
    operatorId,
    text(record.StationID) ?? text(record.StationUID)
  );
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
        const id = normalizeMetroStationId(
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
      const from = normalizeMetroStationId(
        operatorId,
        text(segment.FromStationID) ?? text(segment.FromStationUID)
      );
      const to = normalizeMetroStationId(
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

function normalizeLiveBoardAnchors(payload: unknown, operatorId: string): LiveBoardAnchor[] {
  const anchors: LiveBoardAnchor[] = [];

  for (const record of liveBoardRows(payload)) {
    const stationId = liveBoardStationId(record, operatorId);
    if (!stationId) continue;
    const estimateMinutes = numberValue(record.EstimateTime);
    const estimateSeconds = estimateMinutes !== undefined
      ? Math.max(0, estimateMinutes * 60)
      : Math.max(
          0,
          numberValue(record.CountDown) ??
            numberValue(record.EstimatedTime) ??
            0
        );

    anchors.push({
      lineId: text(record.LineID) ?? text(record.LineNO) ?? text(record.LineNo),
      stationId,
      stationName: localizedName(record.StationName),
      destinationId: normalizeMetroStationId(
        operatorId,
        text(record.DestinationStationID) ?? text(record.EndingStationID)
      ),
      destinationName:
        localizedName(record.DestinationStationName) ??
        localizedName(record.EndingStationName) ??
        localizedName(record.TripHeadSign) ??
        text(record.TripHeadSign),
      direction: numberValue(record.Direction),
      estimateSeconds,
      trainNumber: text(record.TrainNo) ?? text(record.TrainNumber),
      dataTime: text(record.UpdateTime) ?? text(record.SrcUpdateTime),
    });
  }

  return anchors;
}

function choosePattern(
  anchor: LiveBoardAnchor,
  targetStationId: string,
  patterns: RoutePattern[]
): RoutePattern | undefined {
  let best: { pattern: RoutePattern; score: number } | undefined;

  for (const pattern of patterns) {
    const currentIndex = pattern.stations.findIndex((station) => station.id === anchor.stationId);
    const targetIndex = pattern.stations.findIndex((station) => station.id === targetStationId);
    if (currentIndex < 0 || targetIndex <= currentIndex) continue;

    let score = 0;
    if (anchor.lineId && pattern.lineId === anchor.lineId) score += 6;
    if (anchor.direction !== undefined && pattern.direction === anchor.direction) score += 4;
    const last = pattern.stations.at(-1);
    if (anchor.destinationId && last?.id === anchor.destinationId) score += 10;
    if (anchor.destinationName && last?.name === anchor.destinationName) score += 4;
    score -= (targetIndex - currentIndex) * 0.01;

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

/**
 * 使用「全線 LiveBoard 的每個已知列車位置」作為錨點，再把站間 RunTime / StopTime
 * 累加到目標站。這不依賴 LivePosition，因為 TRTC 並未開放該端點。
 */
export function estimateMetroArrivalsFromLiveBoard(options: {
  operatorId: string;
  targetStationId: string;
  routePayload: unknown;
  segmentPayload: unknown;
  liveBoardPayload: unknown;
  calculatedAt?: string;
}): MetroArrival[] {
  const target = normalizeMetroStationId(options.operatorId, options.targetStationId);
  if (!target) return [];

  const patterns = normalizeRoutePatterns(options.routePayload, options.operatorId);
  const segments = normalizeSegmentTimes(options.segmentPayload, options.operatorId);
  const anchors = normalizeLiveBoardAnchors(options.liveBoardPayload, options.operatorId);
  const segmentMap = buildSegmentMap(segments);
  const calculatedAt = options.calculatedAt ?? new Date().toISOString();
  const results: MetroArrival[] = [];

  for (const anchor of anchors) {
    if (anchor.stationId === target) continue;
    const pattern = choosePattern(anchor, target, patterns);
    if (!pattern) continue;
    const currentIndex = pattern.stations.findIndex((station) => station.id === anchor.stationId);
    const targetIndex = pattern.stations.findIndex((station) => station.id === target);
    if (currentIndex < 0 || targetIndex <= currentIndex) continue;

    let etaSeconds = anchor.estimateSeconds;
    let usedFallback = false;

    for (let index = currentIndex; index < targetIndex; index += 1) {
      const from = pattern.stations[index];
      const to = pattern.stations[index + 1];
      const segment = segmentMap.get(`${from.id}>${to.id}`);
      const runTime = segment?.runTime ?? 95;
      const dwellTime = segment?.stopTime ?? 20;
      if (!segment) usedFallback = true;

      etaSeconds += runTime;
      if (index + 1 < targetIndex) {
        etaSeconds += Math.min(45, Math.max(8, dwellTime));
      }
    }

    if (etaSeconds <= 0 || etaSeconds > 7_200) continue;
    const destinationStation = pattern.stations.at(-1);

    results.push({
      lineId: anchor.lineId ?? pattern.lineId,
      destination:
        anchor.destinationName ??
        destinationStation?.name ??
        anchor.destinationId ??
        "終點站未提供",
      destinationStationId: anchor.destinationId ?? destinationStation?.id,
      direction: anchor.direction ?? pattern.direction,
      estimateSeconds: Math.round(etaSeconds),
      trainNumber: anchor.trainNumber,
      dataTime: anchor.dataTime,
      source: "estimated",
      confidence: usedFallback ? "low" : "medium",
      calculatedAt,
      currentStationName: anchor.stationName ?? pattern.stations[currentIndex]?.name,
    });
  }

  const sorted = results.sort(
    (a, b) => (a.estimateSeconds ?? Infinity) - (b.estimateSeconds ?? Infinity)
  );
  const deduped: MetroArrival[] = [];

  for (const arrival of sorted) {
    const duplicate = deduped.some((item) => {
      if (
        item.lineId !== arrival.lineId ||
        item.direction !== arrival.direction ||
        item.destination !== arrival.destination ||
        item.estimateSeconds === null ||
        arrival.estimateSeconds === null
      ) {
        return false;
      }
      return Math.abs(item.estimateSeconds - arrival.estimateSeconds) <= 45;
    });
    if (!duplicate) deduped.push(arrival);
  }

  return deduped.slice(0, 30);
}
