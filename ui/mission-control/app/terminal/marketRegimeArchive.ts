import { buildMarketMemorySummary } from "../../lib/marketMemory";

type JsonMap = Record<string, unknown>;

export type MarketRegimeArchiveState = "CALM" | "WATCH" | "FRAGILE" | "BROKEN";

export type MarketRegimeArchiveTransition = {
  id: string;
  created_at_iso: string;
  transition_type: string;
  from_regime: string;
  to_regime: string;
  from_admissibility_state: string;
  to_admissibility_state: string;
};

export type MarketRegimeArchiveRow = {
  regime: string;
  sample_count: number;
  execute_count: number;
  reduce_count: number;
  wait_count: number;
  block_count: number;
  dominant_blocking_layer: string | null;
  last_market_truth_state: string;
  last_admissibility_state: string;
  last_seen_iso: string;
  memory_confidence_pct: number;
  inadmissible_share_pct: number;
  degradation_share_pct: number;
  stress_score_pct: number;
  reasons: string[];
};

export type MarketRegimeArchivePersistentCompression = {
  state: "THIN" | "LEARNING" | "COMPACT" | "SATURATED";
  compression_ratio_pct: number;
  relapse_probability_pct: number;
  retention_half_life_hours: number;
  persistent_transition_count: number;
  hot_capsule_count: number;
  dominant_transition: {
    from_regime: string;
    to_regime: string;
    transition_type: string;
    count: number;
  } | null;
};

export type MarketRegimeArchiveSummary = {
  schema_version: "market-regime-archive/v1";
  generated_at_iso: string;
  archive_state: MarketRegimeArchiveState;
  active_regime: string | null;
  dominant_regime: string | null;
  hottest_regime: string | null;
  dominant_blocking_layer: string | null;
  market_temperature_state: string;
  market_temperature_pct: number;
  persistent_compression: MarketRegimeArchivePersistentCompression;
  latest_transition: MarketRegimeArchiveTransition | null;
  rows: MarketRegimeArchiveRow[];
  reasons: string[];
};

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function asString(value: unknown, fallback = ""): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toUpperLabel(value: unknown, fallback = "UNKNOWN"): string {
  const normalized = asString(value, fallback).toUpperCase();
  return normalized || fallback;
}

function parseIsoMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ageHours(value: string, nowMs: number): number | null {
  const parsed = parseIsoMs(value);
  if (!parsed) {
    return null;
  }
  return Math.max(0, (nowMs - parsed) / (60 * 60 * 1000));
}

function average(values: number[]): number {
  if (values.length <= 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length <= 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function compressionStateFromPct(value: number): MarketRegimeArchivePersistentCompression["state"] {
  if (value >= 78) {
    return "SATURATED";
  }
  if (value >= 58) {
    return "COMPACT";
  }
  if (value >= 32) {
    return "LEARNING";
  }
  return "THIN";
}

function sortByCreatedAtIso(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [...rows].sort((left, right) => parseIsoMs(asString(right.createdAtIso)) - parseIsoMs(asString(left.createdAtIso)));
}

function pickDominantLabel(counts: Map<string, number>): string | null {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || null;
}

function accumulateLabel(counts: Map<string, number>, value: string): void {
  if (!value) {
    return;
  }
  counts.set(value, (counts.get(value) || 0) + 1);
}

function entryMeta(entry: Record<string, unknown>): JsonMap {
  return asRecord(entry.meta);
}

function entryRegime(entry: Record<string, unknown>): string {
  const meta = entryMeta(entry);
  const snapshot = asRecord(meta.market_memory_snapshot);
  const transition = asRecord(meta.market_transition);
  const degradation = asRecord(meta.execution_degradation);
  const anomaly = asRecord(meta.microstructure_anomaly);
  return toUpperLabel(
    snapshot.volatility_regime
      || transition.to_regime
      || transition.from_regime
      || degradation.regime
      || anomaly.regime,
    "",
  );
}

function entryTruth(entry: Record<string, unknown>): {
  action: string;
  blockingLayer: string;
  reasons: string[];
} {
  const truth = asRecord(entryMeta(entry).final_decision_truth);
  return {
    action: toUpperLabel(truth.action, "WAIT"),
    blockingLayer: asString(truth.blocking_layer, "none").toLowerCase() || "none",
    reasons: Array.isArray(truth.reasons)
      ? truth.reasons.map((item) => asString(item)).filter(Boolean)
      : [],
  };
}

function archiveStateFromInputs(input: {
  marketTemperatureState: string;
  hottestStressPct: number;
  dominantBlockingLayer: string | null;
}): MarketRegimeArchiveState {
  const marketTemperatureState = input.marketTemperatureState.toUpperCase();
  if (marketTemperatureState === "OVERHEATED" || input.hottestStressPct >= 78) {
    return "BROKEN";
  }
  if (marketTemperatureState === "HOT" || input.hottestStressPct >= 58 || input.dominantBlockingLayer === "execution_reality") {
    return "FRAGILE";
  }
  if (marketTemperatureState === "WARM" || input.hottestStressPct >= 34) {
    return "WATCH";
  }
  return "CALM";
}

export function buildMarketRegimeArchiveSummary(
  entries: Array<Record<string, unknown>>,
  options?: { currentRegime?: string | null; nowMs?: number },
): MarketRegimeArchiveSummary {
  const nowMs = options?.nowMs || Date.now();
  const generatedAtIso = new Date(nowMs).toISOString();
  const marketMemory = buildMarketMemorySummary(entries, options?.nowMs ? { nowMs: options.nowMs } : undefined);
  const sortedEntries = sortByCreatedAtIso(entries);
  const rowsByRegime = new Map<string, {
    sampleCount: number;
    executeCount: number;
    reduceCount: number;
    waitCount: number;
    blockCount: number;
    lastMarketTruthState: string;
    lastAdmissibilityState: string;
    lastSeenIso: string;
    blockingLayers: Map<string, number>;
    reasons: Map<string, number>;
  }>();
  const globalBlockingLayers = new Map<string, number>();

  for (const entry of sortedEntries) {
    const regime = entryRegime(entry);
    if (!regime) {
      continue;
    }
    const meta = entryMeta(entry);
    const snapshot = asRecord(meta.market_memory_snapshot);
    const transition = asRecord(meta.market_transition);
    const degradation = asRecord(meta.execution_degradation);
    const createdAtIso = asString(entry.createdAtIso);
    const row = rowsByRegime.get(regime) || {
      sampleCount: 0,
      executeCount: 0,
      reduceCount: 0,
      waitCount: 0,
      blockCount: 0,
      lastMarketTruthState: toUpperLabel(snapshot.market_truth_state || degradation.market_truth_state || transition.to_market_truth_state, "UNKNOWN"),
      lastAdmissibilityState: toUpperLabel(snapshot.admissibility_state || transition.to_admissibility_state, "UNKNOWN"),
      lastSeenIso: createdAtIso,
      blockingLayers: new Map<string, number>(),
      reasons: new Map<string, number>(),
    };

    row.sampleCount += 1;
    if (createdAtIso && parseIsoMs(createdAtIso) >= parseIsoMs(row.lastSeenIso)) {
      row.lastSeenIso = createdAtIso;
      row.lastMarketTruthState = toUpperLabel(snapshot.market_truth_state || degradation.market_truth_state || transition.to_market_truth_state, row.lastMarketTruthState);
      row.lastAdmissibilityState = toUpperLabel(snapshot.admissibility_state || transition.to_admissibility_state, row.lastAdmissibilityState);
    }

    const truth = entryTruth(entry);
    if (truth.action === "EXECUTE") row.executeCount += 1;
    if (truth.action === "REDUCE") row.reduceCount += 1;
    if (truth.action === "WAIT") row.waitCount += 1;
    if (truth.action === "BLOCK") row.blockCount += 1;
    if (truth.blockingLayer && truth.blockingLayer !== "none") {
      accumulateLabel(row.blockingLayers, truth.blockingLayer);
      accumulateLabel(globalBlockingLayers, truth.blockingLayer);
    }
    for (const reason of truth.reasons) {
      accumulateLabel(row.reasons, reason);
    }

    if (!rowsByRegime.has(regime)) {
      rowsByRegime.set(regime, row);
    }
  }

  const marketMemoryByRegime = new Map(
    marketMemory.regimeRows.map((row) => [row.regime.toUpperCase(), row]),
  );

  const rows: MarketRegimeArchiveRow[] = [...rowsByRegime.entries()]
    .map(([regime, row]) => {
      const memoryRow = marketMemoryByRegime.get(regime);
      const blockSharePct = row.sampleCount > 0 ? Math.round((row.blockCount / row.sampleCount) * 100) : 0;
      const waitReduceSharePct = row.sampleCount > 0 ? Math.round(((row.waitCount + row.reduceCount) / row.sampleCount) * 100) : 0;
      const memoryConfidencePct = Math.round(asNumber(memoryRow?.memoryConfidencePct, 0));
      const inadmissibleSharePct = Math.round(asNumber(memoryRow?.inadmissibleSharePct, 0));
      const degradationSharePct = Math.round(asNumber(memoryRow?.degradationSharePct, 0));
      const stressScorePct = Math.round(clamp(
        marketMemory.marketTemperature.scorePct * 0.18
        + (100 - memoryConfidencePct) * 0.26
        + inadmissibleSharePct * 0.22
        + degradationSharePct * 0.17
        + blockSharePct * 0.11
        + waitReduceSharePct * 0.06,
        0,
        100,
      ));
      return {
        regime,
        sample_count: row.sampleCount,
        execute_count: row.executeCount,
        reduce_count: row.reduceCount,
        wait_count: row.waitCount,
        block_count: row.blockCount,
        dominant_blocking_layer: pickDominantLabel(row.blockingLayers),
        last_market_truth_state: row.lastMarketTruthState,
        last_admissibility_state: row.lastAdmissibilityState,
        last_seen_iso: row.lastSeenIso,
        memory_confidence_pct: memoryConfidencePct,
        inadmissible_share_pct: inadmissibleSharePct,
        degradation_share_pct: degradationSharePct,
        stress_score_pct: stressScorePct,
        reasons: [...row.reasons.entries()]
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .slice(0, 4)
          .map(([reason]) => reason),
      };
    })
    .sort((left, right) => right.stress_score_pct - left.stress_score_pct || right.sample_count - left.sample_count || left.regime.localeCompare(right.regime));

  const activeRegime = options?.currentRegime
    ? toUpperLabel(options.currentRegime, "UNKNOWN")
    : marketMemory.latestSnapshot?.regime || rows[0]?.regime || null;
  const dominantRegime = [...rows]
    .sort((left, right) => right.sample_count - left.sample_count || right.stress_score_pct - left.stress_score_pct || left.regime.localeCompare(right.regime))[0]?.regime || null;
  const hottestRegime = rows[0]?.regime || null;
  const dominantBlockingLayer = pickDominantLabel(globalBlockingLayers);
  const latestTransitionRow = marketMemory.transitions[0] || null;
  const latestTransition = latestTransitionRow
    ? {
        id: latestTransitionRow.id,
        created_at_iso: latestTransitionRow.createdAtIso,
        transition_type: latestTransitionRow.transitionType,
        from_regime: latestTransitionRow.fromRegime,
        to_regime: latestTransitionRow.toRegime,
        from_admissibility_state: latestTransitionRow.fromAdmissibilityState,
        to_admissibility_state: latestTransitionRow.toAdmissibilityState,
      }
    : null;
  const transitionCounts = new Map<string, { from_regime: string; to_regime: string; transition_type: string; count: number }>();
  for (const transition of marketMemory.transitions) {
    const key = [transition.fromRegime, transition.toRegime, transition.transitionType].join(":");
    const existing = transitionCounts.get(key) || {
      from_regime: transition.fromRegime,
      to_regime: transition.toRegime,
      transition_type: transition.transitionType,
      count: 0,
    };
    existing.count += 1;
    transitionCounts.set(key, existing);
  }
  const dominantTransition = [...transitionCounts.values()]
    .sort((left, right) => right.count - left.count || left.from_regime.localeCompare(right.from_regime) || left.to_regime.localeCompare(right.to_regime))[0] || null;
  const persistentTransitionCount = [...transitionCounts.values()].filter((transition) => transition.count >= 2).length;
  const capsules = marketMemory.hierarchicalCompression.capsules;
  const hotCapsuleCount = capsules.filter((capsule) => capsule.layer === "hot").length;
  const averageCapsuleRecurrence = average(capsules.map((capsule) => capsule.recurrenceScorePct));
  const averageCapsuleConfidence = average(capsules.map((capsule) => capsule.memoryConfidencePct));
  const hottestCapsule = capsules[0] || null;
  const activeRegimeKey = (activeRegime || hottestRegime || "").toUpperCase();
  const retentionHalfLifeHours = Math.round(median(
    marketMemory.snapshots
      .filter((snapshot) => snapshot.regime.toUpperCase() === activeRegimeKey)
      .map((snapshot) => ageHours(snapshot.createdAtIso, nowMs))
      .filter((value): value is number => value !== null),
  ));
  const compressionRatioPct = Math.round(clamp(
    marketMemory.hierarchicalCompression.hot.memoryConfidencePct * 0.24
      + marketMemory.hierarchicalCompression.warm.memoryConfidencePct * 0.14
      + marketMemory.hierarchicalCompression.cold.memoryConfidencePct * 0.08
      + averageCapsuleRecurrence * 0.28
      + averageCapsuleConfidence * 0.16
      + persistentTransitionCount * 10,
    0,
    100,
  ));
  const relapseProbabilityPct = Math.round(clamp(
    (rows[0]?.stress_score_pct || 0) * 0.36
      + (hottestCapsule?.riskOfFalseContextPct || 0) * 0.24
      + (hottestCapsule?.transitionPressurePct || 0) * 0.2
      + persistentTransitionCount * 8
      + (dominantTransition?.count || 0) * 6,
    0,
    100,
  ));
  const persistentCompression = {
    state: compressionStateFromPct(compressionRatioPct),
    compression_ratio_pct: compressionRatioPct,
    relapse_probability_pct: relapseProbabilityPct,
    retention_half_life_hours: retentionHalfLifeHours,
    persistent_transition_count: persistentTransitionCount,
    hot_capsule_count: hotCapsuleCount,
    dominant_transition: dominantTransition,
  } satisfies MarketRegimeArchivePersistentCompression;
  const archiveState = archiveStateFromInputs({
    marketTemperatureState: marketMemory.marketTemperature.state,
    hottestStressPct: rows[0]?.stress_score_pct || 0,
    dominantBlockingLayer,
  });

  return {
    schema_version: "market-regime-archive/v1",
    generated_at_iso: generatedAtIso,
    archive_state: archiveState,
    active_regime: activeRegime,
    dominant_regime: dominantRegime,
    hottest_regime: hottestRegime,
    dominant_blocking_layer: dominantBlockingLayer,
    market_temperature_state: marketMemory.marketTemperature.state,
    market_temperature_pct: marketMemory.marketTemperature.scorePct,
    persistent_compression: persistentCompression,
    latest_transition: latestTransition,
    rows,
    reasons: [
      hottestRegime ? `archive:${archiveState.toLowerCase()} regime ${hottestRegime.toLowerCase()} at ${rows[0]?.stress_score_pct || 0}% stress` : "archive:empty regime set",
      `temperature ${marketMemory.marketTemperature.state.toLowerCase()} ${marketMemory.marketTemperature.scorePct}%`,
      dominantBlockingLayer ? `blocking_layer:${dominantBlockingLayer}` : "blocking_layer:none",
      `compression ${persistentCompression.state.toLowerCase()} ${persistentCompression.compression_ratio_pct}%`,
      latestTransition ? `transition ${latestTransition.from_regime.toLowerCase()} -> ${latestTransition.to_regime.toLowerCase()}` : "transition:none",
    ].filter(Boolean),
  };
}