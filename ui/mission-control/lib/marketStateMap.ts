import type { EdgeObservationSummary } from "./edgeObservation";
import type { MarketMemorySummary } from "./marketMemory";
import type { TradabilityAnalyticsSummary, TradabilityDensityState } from "./tradabilityAnalytics";

export type MarketStateMapCellState = "ADMISSIBLE" | "WATCH" | "THIN" | "DEGRADED" | "INADMISSIBLE";

export type MarketStateMapCell = {
  key: {
    symbol: string;
    venue: string;
    timeframe: string;
    regime: string;
    densityBand: "THIN" | "BALANCED" | "RICH";
    executionBand: "WEAK" | "STABLE" | "STRONG";
    freshnessBand: "STALE" | "AGING" | "FRESH";
  };
  sampleCount: number;
  truthQualityPct: number;
  admissibilityPct: number;
  opportunityPct: number;
  informationDensityPct: number;
  entropyPct: number;
  coherencePct: number;
  freshnessPct: number;
  executionQualityPct: number;
  falseContextRiskPct: number;
  transitionPressurePct: number;
  memoryConfidencePct: number;
  state: MarketStateMapCellState;
  reasons: string[];
  updatedAtIso: string;
};

export type MarketStateMapSnapshot = {
  generatedAtIso: string;
  scope: {
    symbol: string;
    timeframe: string;
    venue: string;
    windowHours: number;
  };
  cells: MarketStateMapCell[];
  transitions: Array<{
    regime: string;
    transitionType: string;
    detectedAtIso: string;
    truthQualityDeltaPct: number;
    fromAdmissibilityState: string;
    toAdmissibilityState: string;
  }>;
  inadmissibleZones: Array<{
    zoneKey: string;
    regime: string;
    reason: string;
    severity: "warn" | "critical";
  }>;
  anomalyFamilyBreakdown: Array<{
    anomalyFamily: string;
    operatorFamily: string;
    venue: string;
    timeframe: string;
    count: number;
    criticalCount: number;
    latestAtIso: string;
    exampleTypes: string[];
    dominantRegimes: string[];
  }>;
  falseContextTaxonomy: Array<{
    contextFamily: "FALSE_INTENT" | "FALSE_LIQUIDITY" | "FALSE_SYNC" | "FALSE_EXECUTION_CONTEXT";
    count: number;
    noTradeSharePct: number;
    dominantBlockingLayers: string[];
    latestAtIso: string;
    auditReasons: string[];
  }>;
  venueTimeframeRegimeMap: Array<{
    venue: string;
    timeframe: string;
    regime: string;
    state: MarketStateMapCellState;
    sampleCount: number;
    truthQualityPct: number;
    executionQualityPct: number;
    falseContextRiskPct: number;
    memoryConfidencePct: number;
    latestAtIso: string;
    dominantFailureModes: string[];
  }>;
  marketTemperature: MarketMemorySummary["marketTemperature"];
  structuralContexts: Array<{
    contextKey: string;
    regime: string;
    venue: string;
    timeframe: string;
    marketTemperatureState: MarketMemorySummary["marketTemperature"]["state"];
    marketTemperaturePct: number;
    lastAdmissibilityState: string;
    memoryConfidencePct: number;
    transitionPressurePct: number;
    admissibilityShiftCount: number;
    transitionTypes: string[];
    lastOracleFingerprint: string | null;
    latestAtIso: string;
  }>;
  summary: {
    admissibleCells: number;
    watchCells: number;
    degradedCells: number;
    inadmissibleCells: number;
    dominantFailureModes: string[];
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function densityBandFromRow(state: TradabilityDensityState | string, scorePct: number): "THIN" | "BALANCED" | "RICH" {
  if (String(state).toUpperCase() === "DEGRADED" || scorePct < 45) {
    return "THIN";
  }
  if (String(state).toUpperCase() === "THIN" || scorePct < 65) {
    return "BALANCED";
  }
  return "RICH";
}

function executionBandFromPct(value: number): "WEAK" | "STABLE" | "STRONG" {
  return value >= 72 ? "STRONG" : value >= 52 ? "STABLE" : "WEAK";
}

function freshnessBandFromPct(value: number): "STALE" | "AGING" | "FRESH" {
  return value >= 72 ? "FRESH" : value >= 48 ? "AGING" : "STALE";
}

function structuralTemperatureStateFromPct(value: number): MarketMemorySummary["marketTemperature"]["state"] {
  if (value >= 78) {
    return "OVERHEATED";
  }
  if (value >= 56) {
    return "HOT";
  }
  if (value >= 32) {
    return "WARM";
  }
  return "COLD";
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function marketTruthStateToPct(value: string): number {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "RELIABLE") {
    return 84;
  }
  if (normalized === "WATCH") {
    return 62;
  }
  if (normalized === "DEGRADED") {
    return 34;
  }
  if (normalized === "UNTRUSTWORTHY") {
    return 18;
  }
  return 50;
}

function stalenessToFreshnessPct(level: EdgeObservationSummary["staleness"]["level"]): number {
  if (level === "FRESH") {
    return 88;
  }
  if (level === "AGING") {
    return 58;
  }
  if (level === "STALE") {
    return 28;
  }
  return 18;
}

function stateFromScores(input: { truthQualityPct: number; admissibilityPct: number; densityState?: string; executionQualityPct: number }): MarketStateMapCellState {
  if (input.truthQualityPct < 38 || input.admissibilityPct < 35 || input.executionQualityPct < 32) {
    return "INADMISSIBLE";
  }
  if (String(input.densityState || "").toUpperCase() === "DEGRADED" || input.truthQualityPct < 54 || input.admissibilityPct < 52) {
    return "DEGRADED";
  }
  if (String(input.densityState || "").toUpperCase() === "THIN") {
    return "THIN";
  }
  if (input.truthQualityPct < 72 || input.admissibilityPct < 72) {
    return "WATCH";
  }
  return "ADMISSIBLE";
}

function matchesScope(scopeValue: string, actualValue: string, neutralValues: string[]): boolean {
  const scope = String(scopeValue || "").trim().toUpperCase();
  const actual = String(actualValue || "").trim().toUpperCase();
  if (!scope || neutralValues.includes(scope)) {
    return true;
  }
  return scope === actual;
}

function contextFamilyFromAnomalyFamily(anomalyFamily: string): "FALSE_INTENT" | "FALSE_LIQUIDITY" | "FALSE_SYNC" {
  const normalized = String(anomalyFamily || "").trim().toUpperCase();
  if (normalized === "LIQUIDITY_TRAP") {
    return "FALSE_LIQUIDITY";
  }
  if (normalized === "VENUE_DESYNC") {
    return "FALSE_SYNC";
  }
  return "FALSE_INTENT";
}

export function buildMarketStateMapSnapshot(input: {
  symbol: string;
  timeframe: string;
  venue?: string;
  windowHours: number;
  tradability: TradabilityAnalyticsSummary;
  edgeObservation: EdgeObservationSummary;
  marketMemory: MarketMemorySummary;
}): MarketStateMapSnapshot {
  const venue = String(input.venue || "MULTI").trim().toUpperCase() || "MULTI";
  const timeframe = String(input.timeframe || "ALL").trim() || "ALL";
  const scopedAnomalies = input.marketMemory.microstructureAnomalies.filter((anomaly) => {
    return matchesScope(venue, anomaly.venue, ["MULTI", "ALL"]) && matchesScope(timeframe, anomaly.timeframe, ["ALL"]);
  });
  const scopedExecutionDegradations = input.marketMemory.executionDegradations.filter((degradation) => {
    return matchesScope(venue, degradation.venue, ["MULTI", "ALL"]) && matchesScope(timeframe, degradation.timeframe, ["ALL"]);
  });
  const rows24hByRegime = new Map(input.tradability.windows.last_24h.rows.map((row) => [row.regime, row]));
  const memoryRowsByRegime = new Map(input.marketMemory.regimeRows.map((row) => [row.regime, row]));
  const regimes = new Set<string>([
    ...rows24hByRegime.keys(),
    ...memoryRowsByRegime.keys(),
    ...input.edgeObservation.recentDeltas.map((row) => row.regime),
  ]);

  const cells: MarketStateMapCell[] = [...regimes]
    .map((regime) => {
      const tradabilityRow = rows24hByRegime.get(regime) || null;
      const memoryRow = memoryRowsByRegime.get(regime) || null;
      const anomalyRows = scopedAnomalies.filter((anomaly) => anomaly.regime === regime);
      const anomalyBurdenPct = Math.round(clamp(anomalyRows.reduce((sum, anomaly) => {
        if (anomaly.severity === "critical") {
          return sum + 28;
        }
        if (anomaly.severity === "warn") {
          return sum + 16;
        }
        return sum + 8;
      }, 0), 0, 100));
      const edgeRows = input.edgeObservation.recentDeltas.filter((row) => row.regime === regime);
      const topEdge = edgeRows[0] || null;
      const truthQualityPct = memoryRow?.avgTruthQualityPct ?? Math.round(tradabilityRow?.avgScorePct || 0);
      const admissibilityPct = memoryRow
        ? Math.round(clamp((100 - memoryRow.inadmissibleSharePct) * 0.62 + (tradabilityRow?.sufficientSharePct || 0) * 0.38, 0, 100))
        : Math.round(clamp(tradabilityRow?.sufficientSharePct || 0, 0, 100));
      const opportunityPct = topEdge
        ? Math.round(clamp(topEdge.confidenceScorePct * 0.7 + (topEdge.meanPnlBps > 0 ? 30 : 10), 0, 100))
        : 0;
      const informationDensityPct = memoryRow?.avgInformationDensityPct ?? Math.round(tradabilityRow?.avgScorePct || 0);
      const entropyPct = Math.round(tradabilityRow?.avgEntropyPct || 0);
      const coherencePct = memoryRow?.avgCoherencePct ?? truthQualityPct;
      const freshnessPct = memoryRow?.avgFreshnessPct ?? stalenessToFreshnessPct(input.edgeObservation.staleness.level);
      const executionQualityPct = memoryRow?.avgExecutionQualityPct ?? 50;
      const falseContextRiskPct = Math.round(clamp(
        (memoryRow?.inadmissibleSharePct || 0) * 0.55
          + (memoryRow?.degradationSharePct || 0) * 0.25
          + anomalyBurdenPct * 0.35
          + (topEdge && topEdge.meanPnlBps < 0 ? 20 : 0),
        0,
        100,
      ));
      const transitionCount = input.marketMemory.transitions.filter((transition) => transition.toRegime === regime || transition.fromRegime === regime).length;
      const transitionPressurePct = Math.round(clamp(
        transitionCount * 14
          + Math.abs(input.tradability.calibration.thinDeltaPct) * 0.4
          + Math.abs(input.tradability.calibration.degradedDeltaPct) * 0.6,
        0,
        100,
      ));
      const memoryConfidencePct = memoryRow?.memoryConfidencePct ?? 0;
      const state = stateFromScores({
        truthQualityPct,
        admissibilityPct,
        densityState: tradabilityRow?.lastState,
        executionQualityPct,
      });
      const reasons = [
        tradabilityRow ? `${regime}: ${tradabilityRow.reviewLabel}` : `${regime}: memory-only context`,
        memoryRow ? `truth ${memoryRow.avgTruthQualityPct}% · exec ${memoryRow.avgExecutionQualityPct}%` : `freshness ${freshnessPct}%`,
        anomalyRows.length > 0 ? `anomalies ${anomalyRows.slice(0, 2).map((anomaly) => anomaly.anomalyType.toLowerCase()).join(", ")}` : `freshness ${freshnessPct}%`,
        topEdge ? `edge ${topEdge.edgeKey} ${topEdge.confidenceLevel} ${topEdge.confidenceScorePct}%` : "edge observation thin",
      ];

      return {
        key: {
          symbol: input.symbol,
          venue,
          timeframe,
          regime,
          densityBand: densityBandFromRow(tradabilityRow?.lastState || "UNKNOWN", informationDensityPct),
          executionBand: executionBandFromPct(executionQualityPct),
          freshnessBand: freshnessBandFromPct(freshnessPct),
        },
        sampleCount: Math.max(tradabilityRow?.sampleCount || 0, memoryRow?.sampleCount || 0, topEdge?.count || 0),
        truthQualityPct,
        admissibilityPct,
        opportunityPct,
        informationDensityPct,
        entropyPct,
        coherencePct,
        freshnessPct,
        executionQualityPct,
        falseContextRiskPct,
        transitionPressurePct,
        memoryConfidencePct,
        state,
        reasons,
        updatedAtIso: memoryRow?.lastSeenIso || tradabilityRow?.lastSeenIso || input.edgeObservation.latestClassifiedIntentAt || new Date().toISOString(),
      } satisfies MarketStateMapCell;
    })
    .sort((left, right) => right.truthQualityPct - left.truthQualityPct || right.sampleCount - left.sampleCount || left.key.regime.localeCompare(right.key.regime));

  const inadmissibleZones: MarketStateMapSnapshot["inadmissibleZones"] = cells
    .filter((cell) => cell.state === "DEGRADED" || cell.state === "INADMISSIBLE")
    .map((cell) => ({
      zoneKey: `${cell.key.venue}:${cell.key.timeframe}:${cell.key.regime}`,
      regime: cell.key.regime,
      reason: cell.reasons[0] || "inadmissible context",
      severity: cell.state === "INADMISSIBLE" ? "critical" : "warn",
    }));

  const dominantFailureModes = [...new Map(inadmissibleZones.map((zone) => [zone.reason, zone.reason])).values()].slice(0, 5);
  const anomalyFamilyBreakdown: MarketStateMapSnapshot["anomalyFamilyBreakdown"] = [...new Map(scopedAnomalies.map((anomaly) => {
    const key = `${anomaly.anomalyFamily}:${anomaly.venue}:${anomaly.timeframe}`;
    return [key, key];
  })).values()]
    .map((key) => {
      const group = scopedAnomalies.filter((anomaly) => `${anomaly.anomalyFamily}:${anomaly.venue}:${anomaly.timeframe}` === key);
      const first = group[0];
      return {
        anomalyFamily: first?.anomalyFamily || "UNKNOWN",
        operatorFamily: first?.operatorFamily || "unknown",
        venue: first?.venue || venue,
        timeframe: first?.timeframe || timeframe,
        count: group.length,
        criticalCount: group.filter((anomaly) => anomaly.severity === "critical").length,
        latestAtIso: group[0]?.createdAtIso || new Date().toISOString(),
        exampleTypes: [...new Map(group.map((anomaly) => [anomaly.anomalyType, anomaly.anomalyType])).values()].slice(0, 3),
        dominantRegimes: [...new Map(group.map((anomaly) => [anomaly.regime, anomaly.regime])).values()].slice(0, 3),
      };
    })
    .sort((left, right) => right.count - left.count || right.criticalCount - left.criticalCount || left.anomalyFamily.localeCompare(right.anomalyFamily));
  const falseContextFamilies: MarketStateMapSnapshot["falseContextTaxonomy"][number]["contextFamily"][] = [
    "FALSE_INTENT",
    "FALSE_LIQUIDITY",
    "FALSE_SYNC",
    "FALSE_EXECUTION_CONTEXT",
  ];
  const falseContextTaxonomy: MarketStateMapSnapshot["falseContextTaxonomy"] = falseContextFamilies
    .map((contextFamily) => {
      const snapshotRows = input.marketMemory.falseContextFamilies.filter((row) => {
        if (row.family !== contextFamily) {
          return false;
        }
        if (row.symbol !== input.symbol) {
          return false;
        }
        if (venue !== "ALL" && row.venue !== venue) {
          return false;
        }
        if (timeframe !== "ALL" && row.timeframe !== timeframe) {
          return false;
        }
        return true;
      });
      const anomalyRows = contextFamily === "FALSE_EXECUTION_CONTEXT"
        ? []
        : scopedAnomalies.filter((anomaly) => contextFamilyFromAnomalyFamily(anomaly.anomalyFamily) === contextFamily);
      const degradationRows = contextFamily === "FALSE_EXECUTION_CONTEXT" ? scopedExecutionDegradations : [];
      const auditRows = [...anomalyRows, ...degradationRows];
      const snapshotCount = snapshotRows.reduce((sum, row) => sum + row.count, 0);
      const noTradeCount = snapshotRows.length > 0
        ? snapshotRows.reduce((sum, row) => sum + row.noTradeCount, 0)
        : auditRows.filter((row) => {
        if ("severity" in row) {
          return row.blockingLayer !== "none" || row.marketTruthState === "DEGRADED" || row.marketTruthState === "UNTRUSTWORTHY";
        }
        return row.blockingLayer !== "none" || row.edgeState === "BLOCKED" || row.marketTruthState === "DEGRADED";
      }).length;
      const rowCount = snapshotCount || auditRows.length;
      const dominantBlockingLayers = snapshotRows.length > 0
        ? [...new Map(snapshotRows.flatMap((row) => row.triggerLayers).map((layer) => [layer, layer])).values()].filter(Boolean).slice(0, 3)
        : [...new Map(auditRows.map((row) => [row.blockingLayer, row.blockingLayer])).values()].filter(Boolean).slice(0, 3);
      const auditReasons = snapshotRows.length > 0
        ? [...new Map(snapshotRows.flatMap((row) => row.reasons).map((reason) => [reason, reason])).values()].slice(0, 4)
        : contextFamily === "FALSE_EXECUTION_CONTEXT"
          ? [...new Map(degradationRows.map((row) => [row.degradationType, row.degradationType])).values()].slice(0, 4)
          : [...new Map(anomalyRows.map((row) => [row.anomalyType, row.anomalyType])).values()].slice(0, 4);
      return {
        contextFamily,
        count: rowCount,
        noTradeSharePct: rowCount > 0 ? Math.round((noTradeCount / rowCount) * 100) : 0,
        dominantBlockingLayers,
        latestAtIso: snapshotRows[0]?.latestAtIso || auditRows[0]?.createdAtIso || "",
        auditReasons,
      };
    })
    .filter((row) => row.count > 0)
    .sort((left, right) => right.count - left.count || right.noTradeSharePct - left.noTradeSharePct || left.contextFamily.localeCompare(right.contextFamily));
  const scopedSnapshots = input.marketMemory.snapshots.filter((snapshot) => {
    return snapshot.symbol === input.symbol
      && matchesScope(venue, snapshot.venue, ["MULTI", "ALL"])
      && matchesScope(timeframe, snapshot.timeframe, ["ALL"]);
  });
  const venueTimeframeRegimeKeys = new Set<string>([
    ...scopedSnapshots.map((snapshot) => `${snapshot.venue}:${snapshot.timeframe}:${snapshot.regime}`),
    ...scopedAnomalies.map((anomaly) => `${anomaly.venue}:${anomaly.timeframe}:${anomaly.regime}`),
    ...scopedExecutionDegradations.map((degradation) => `${degradation.venue}:${degradation.timeframe}:${degradation.regime}`),
  ]);
  const venueTimeframeRegimeMap: MarketStateMapSnapshot["venueTimeframeRegimeMap"] = [...venueTimeframeRegimeKeys]
    .map((key) => {
      const [rowVenue = venue, rowTimeframe = timeframe, rowRegime = "UNKNOWN"] = key.split(":");
      const snapshotRows = scopedSnapshots.filter((snapshot) => `${snapshot.venue}:${snapshot.timeframe}:${snapshot.regime}` === key);
      const anomalyRows = scopedAnomalies.filter((anomaly) => `${anomaly.venue}:${anomaly.timeframe}:${anomaly.regime}` === key);
      const degradationRows = scopedExecutionDegradations.filter((degradation) => `${degradation.venue}:${degradation.timeframe}:${degradation.regime}` === key);
      const sampleCount = snapshotRows.length + anomalyRows.length + degradationRows.length;
      const truthQualityPct = snapshotRows.length > 0
        ? Math.round(average(snapshotRows.map((snapshot) => snapshot.truthQualityPct)))
        : Math.round(average([
          ...anomalyRows.map((row) => marketTruthStateToPct(row.marketTruthState)),
          ...degradationRows.map((row) => marketTruthStateToPct(row.marketTruthState)),
        ]));
      const executionQualityPct = snapshotRows.length > 0
        ? Math.round(average(snapshotRows.map((snapshot) => snapshot.executionQualityPct)))
        : Math.round(average(degradationRows.map((row) => row.executionQualityPct))) || 50;
      const falseContextSignals = snapshotRows.filter((snapshot) => Boolean(snapshot.falseContextFamily)).length
        + anomalyRows.length
        + degradationRows.length;
      const falseContextRiskPct = Math.round(clamp(
        (falseContextSignals / Math.max(sampleCount, 1)) * 65
          + anomalyRows.filter((row) => row.severity === "critical").length * 12
          + degradationRows.length * 9,
        0,
        100,
      ));
      const memoryConfidencePct = Math.round(clamp(
        (snapshotRows.length / Math.max(sampleCount, 1)) * 45
          + truthQualityPct * 0.35
          + (100 - falseContextRiskPct) * 0.2,
        0,
        100,
      ));
      const dominantFailureModes = [
        ...snapshotRows.flatMap((snapshot) => snapshot.falseContextReasons),
        ...anomalyRows.map((row) => row.anomalyType),
        ...degradationRows.map((row) => row.degradationType),
      ];
      const state = stateFromScores({
        truthQualityPct,
        admissibilityPct: Math.max(0, 100 - falseContextRiskPct),
        densityState: snapshotRows[0]?.informationDensityState || (falseContextRiskPct >= 65 ? "DEGRADED" : "SUFFICIENT"),
        executionQualityPct,
      });
      const latestAtIso = [
        ...snapshotRows.map((row) => row.createdAtIso),
        ...anomalyRows.map((row) => row.createdAtIso),
        ...degradationRows.map((row) => row.createdAtIso),
      ].sort((left, right) => Date.parse(right) - Date.parse(left))[0] || "";
      return {
        venue: rowVenue,
        timeframe: rowTimeframe,
        regime: rowRegime,
        state,
        sampleCount,
        truthQualityPct,
        executionQualityPct,
        falseContextRiskPct,
        memoryConfidencePct,
        latestAtIso,
        dominantFailureModes: [...new Map(dominantFailureModes.map((reason) => [reason, reason])).values()].slice(0, 4),
      };
    })
    .filter((row) => row.sampleCount > 0)
    .sort((left, right) => right.falseContextRiskPct - left.falseContextRiskPct || right.sampleCount - left.sampleCount || left.venue.localeCompare(right.venue) || left.timeframe.localeCompare(right.timeframe) || left.regime.localeCompare(right.regime));

  const capsuleByContextKey = new Map(
    input.marketMemory.hierarchicalCompression.capsules.map((capsule) => [capsule.contextKey, capsule]),
  );
  const structuralContextKeys = new Set<string>([
    ...input.marketMemory.hierarchicalCompression.capsules
      .filter((capsule) => matchesScope(venue, capsule.currentVenue, ["MULTI", "ALL"]) && matchesScope(timeframe, capsule.currentTimeframe, ["ALL"]))
      .map((capsule) => capsule.contextKey),
    ...venueTimeframeRegimeMap.map((row) => `${row.venue}:${row.timeframe}:${row.regime}`),
  ]);
  const structuralContexts: MarketStateMapSnapshot["structuralContexts"] = [...structuralContextKeys]
    .map((contextKey) => {
      const [rowVenue = venue, rowTimeframe = timeframe, rowRegime = "UNKNOWN"] = contextKey.split(":");
      const capsule = capsuleByContextKey.get(contextKey) || null;
      const mapRow = venueTimeframeRegimeMap.find((row) => `${row.venue}:${row.timeframe}:${row.regime}` === contextKey) || null;
      const regimeTransitions = input.marketMemory.transitions.filter((transition) => transition.toRegime === rowRegime || transition.fromRegime === rowRegime);
      const admissibilityShiftCount = capsule?.admissibilityShiftCount ?? regimeTransitions.filter((transition) => transition.transitionType === "ADMISSIBILITY_SHIFT").length;
      const transitionPressurePct = capsule?.transitionPressurePct ?? Math.round(clamp(regimeTransitions.length * 14 + admissibilityShiftCount * 12, 0, 100));
      const transitionTypes = capsule?.transitionTypes || [...new Map(regimeTransitions.map((transition) => [transition.transitionType, transition.transitionType])).values()].slice(0, 4);
      const latestSnapshot = scopedSnapshots.find((snapshot) => `${snapshot.venue}:${snapshot.timeframe}:${snapshot.regime}` === contextKey) || null;
      const marketTemperaturePct = capsule?.marketTemperaturePct ?? Math.round(clamp(
        (mapRow?.falseContextRiskPct || 0) * 0.45
          + Math.max(0, 100 - (mapRow?.executionQualityPct || 50)) * 0.35
          + transitionPressurePct * 0.2,
        0,
        100,
      ));
      const lastAdmissibilityState = capsule?.lastAdmissibilityState
        || (mapRow?.state === "INADMISSIBLE"
          ? "INADMISSIBLE"
          : mapRow?.state === "DEGRADED"
            ? "DEGRADED"
            : mapRow?.state === "WATCH" || mapRow?.state === "THIN"
              ? "WATCH"
              : "ADMISSIBLE");
      if (!capsule && !mapRow) {
        return null;
      }
      return {
        contextKey,
        regime: rowRegime,
        venue: rowVenue,
        timeframe: rowTimeframe,
        marketTemperatureState: capsule?.marketTemperatureState || structuralTemperatureStateFromPct(marketTemperaturePct),
        marketTemperaturePct,
        lastAdmissibilityState,
        memoryConfidencePct: capsule?.memoryConfidencePct ?? mapRow?.memoryConfidencePct ?? 0,
        transitionPressurePct,
        admissibilityShiftCount,
        transitionTypes,
        lastOracleFingerprint: capsule?.lastOracleFingerprint ?? latestSnapshot?.oracleFingerprint ?? null,
        latestAtIso: mapRow?.latestAtIso || latestSnapshot?.createdAtIso || capsule?.generatedAtIso || "",
      };
    })
    .filter((row): row is MarketStateMapSnapshot["structuralContexts"][number] => Boolean(row))
    .sort((left, right) => right.marketTemperaturePct - left.marketTemperaturePct || right.memoryConfidencePct - left.memoryConfidencePct || left.contextKey.localeCompare(right.contextKey))
    .slice(0, 6);

  return {
    generatedAtIso: new Date().toISOString(),
    scope: {
      symbol: input.symbol,
      timeframe,
      venue,
      windowHours: input.windowHours,
    },
    cells,
    transitions: input.marketMemory.transitions.slice(0, 12).map((transition) => ({
      regime: transition.toRegime,
      transitionType: transition.transitionType,
      detectedAtIso: transition.createdAtIso,
      truthQualityDeltaPct: transition.truthQualityDeltaPct,
      fromAdmissibilityState: transition.fromAdmissibilityState,
      toAdmissibilityState: transition.toAdmissibilityState,
    })),
    inadmissibleZones,
    anomalyFamilyBreakdown,
    falseContextTaxonomy,
    venueTimeframeRegimeMap,
    marketTemperature: input.marketMemory.marketTemperature,
    structuralContexts,
    summary: {
      admissibleCells: cells.filter((cell) => cell.state === "ADMISSIBLE").length,
      watchCells: cells.filter((cell) => cell.state === "WATCH" || cell.state === "THIN").length,
      degradedCells: cells.filter((cell) => cell.state === "DEGRADED").length,
      inadmissibleCells: cells.filter((cell) => cell.state === "INADMISSIBLE").length,
      dominantFailureModes,
    },
  };
}