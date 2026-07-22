import { readExecutionFactJournalEntries, type ExecutionFactAttribution, type ExecutionFactJournalEntry } from "./executionFactJournal";

type AttributionGroupField = "strategy_id" | "symbol" | "venue";

export type DerivedExecutionAttribution = ExecutionFactAttribution & {
  attribution_status: "pending" | "computed";
};

type AggregatedAttributionRow = {
  strategy_id: string | null;
  symbol: string | null;
  venue: string | null;
  realized_pnl_usd: number;
  pnl_contribution_pct: number;
  trade_count: number;
  fees_usd: number;
  regime_contribution_usd: number;
  allocation_contribution_usd: number;
  signal_contribution_usd: number;
  execution_contribution_usd: number;
  timing_contribution_usd: number | null;
  spread_contribution_usd: number | null;
  slippage_contribution_usd: number | null;
  allocation_alpha_bps_avg: number | null;
  signal_alpha_bps_avg: number | null;
  timing_alpha_bps_avg: number | null;
  execution_alpha_bps_avg: number | null;
  spread_cost_bps_avg: number | null;
  slippage_cost_bps_avg: number | null;
  winner_component: string | null;
  loser_component: string | null;
  computed_trade_count: number;
  pending_trade_count: number;
  attribution_status: "pending" | "computed";
};

type ComponentBucketKey =
  | "allocation"
  | "signal"
  | "timing"
  | "execution"
  | "spread_cost"
  | "slippage_cost";

type AggregatedAttributionAccumulator = Omit<AggregatedAttributionRow, "allocation_alpha_bps_avg" | "signal_alpha_bps_avg" | "timing_alpha_bps_avg" | "execution_alpha_bps_avg" | "spread_cost_bps_avg" | "slippage_cost_bps_avg" | "winner_component" | "loser_component"> & {
  allocation_alpha_bps_sum: number;
  signal_alpha_bps_sum: number;
  timing_alpha_bps_sum: number;
  execution_alpha_bps_sum: number;
  spread_cost_bps_sum: number;
  slippage_cost_bps_sum: number;
  allocation_alpha_bps_count: number;
  signal_alpha_bps_count: number;
  timing_alpha_bps_count: number;
  execution_alpha_bps_count: number;
  spread_cost_bps_count: number;
  slippage_cost_bps_count: number;
};

function roundUsd(value: number): number {
  return Number(value.toFixed(3));
}

function roundBps(value: number): number {
  return Number(value.toFixed(3));
}

function averageOrNull(sum: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  return roundBps(sum / count);
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundRatio(value: number): number {
  return Number(value.toFixed(4));
}

function selectAttributionBasisNotionalUsd(entry: ExecutionFactJournalEntry): number | null {
  const filledNotional = Math.abs(toNumberOrNull(entry.filled_notional_usd) || 0);
  const targetNotional = Math.abs(toNumberOrNull(entry.target_notional_usd) || 0);
  const basis = filledNotional > 0 ? filledNotional : targetNotional;
  return basis > 0 ? basis : null;
}

function toBps(valueUsd: number | null, basisNotionalUsd: number | null): number | null {
  if (valueUsd === null || basisNotionalUsd === null || Math.abs(basisNotionalUsd) < 1e-9) {
    return null;
  }
  return roundBps((valueUsd / basisNotionalUsd) * 10_000);
}

function bpsToUsd(valueBps: number | null, basisNotionalUsd: number | null): number | null {
  if (valueBps === null || basisNotionalUsd === null || Math.abs(basisNotionalUsd) < 1e-9) {
    return null;
  }
  return roundUsd((valueBps / 10_000) * basisNotionalUsd);
}

function computeAlphaConfidence(entry: ExecutionFactJournalEntry, pnlUsd: number | null): number | null {
  if (pnlUsd === null) {
    return null;
  }
  const targetNotional = Math.abs(toNumberOrNull(entry.target_notional_usd) || 0);
  const filledNotional = Math.abs(toNumberOrNull(entry.filled_notional_usd) || 0);
  const fillRatio = targetNotional > 0 ? clamp(filledNotional / targetNotional, 0, 1) : 0.7;
  const regimeAtDecision = String(entry.regime_at_decision || "").trim().toUpperCase();
  const regimeAtFill = String(entry.regime_at_fill || "").trim().toUpperCase();
  const regimeKnown = regimeAtDecision.length > 0 && regimeAtDecision !== "UNKNOWN";
  const regimeStable = regimeKnown && regimeAtFill.length > 0 && regimeAtFill !== "UNKNOWN" && regimeAtDecision === regimeAtFill;
  const regimeScore = regimeStable ? 1 : regimeKnown ? 0.75 : 0.45;
  const outcomeScore = entry.decision_outcome === "unknown" || entry.decision_outcome === null ? 0.65 : 0.9;
  const notionalScore = targetNotional > 0 || filledNotional > 0 ? 0.9 : 0.5;
  return roundRatio(clamp((fillRatio * 0.35) + (regimeScore * 0.25) + (outcomeScore * 0.2) + (notionalScore * 0.2), 0.05, 0.99));
}

function enrichDerivedAttribution(entry: ExecutionFactJournalEntry, attribution: ExecutionFactAttribution): DerivedExecutionAttribution {
  const basisNotionalUsd = selectAttributionBasisNotionalUsd(entry);
  const pnlUsd = toNumberOrNull(attribution.pnl_usd);
  const allocationContributionUsd = toNumberOrNull(attribution.allocation_contribution_usd) ?? toNumberOrNull(attribution.regime_contribution_usd);
  const executionContributionUsd = toNumberOrNull(attribution.execution_contribution_usd);
  const fillTargetNotional = Math.abs(toNumberOrNull(entry.target_notional_usd) || 0);
  const fillActualNotional = Math.abs(toNumberOrNull(entry.filled_notional_usd) || 0);
  const fillRatio = fillTargetNotional > 0 ? clamp(fillActualNotional / fillTargetNotional, 0, 1) : 1;
  const spreadCostBps = toNumberOrNull(attribution.spread_cost_bps)
    ?? (executionContributionUsd !== null ? roundBps(-clamp(0.8 + (1 - fillRatio) * 5, 0.8, 8)) : null);
  const slippageCostBps = toNumberOrNull(attribution.slippage_cost_bps)
    ?? (executionContributionUsd !== null ? roundBps(-clamp((1 - fillRatio) * 12, 0, 18)) : null);
  const executionAlphaBps = toNumberOrNull(attribution.execution_alpha_bps) ?? toBps(executionContributionUsd, basisNotionalUsd);
  const timingAlphaBps = toNumberOrNull(attribution.timing_alpha_bps)
    ?? (executionAlphaBps !== null && spreadCostBps !== null && slippageCostBps !== null
      ? roundBps(executionAlphaBps - spreadCostBps - slippageCostBps)
      : toBps(toNumberOrNull(attribution.timing_contribution_usd), basisNotionalUsd));
  const spreadContributionUsd = toNumberOrNull(attribution.spread_contribution_usd) ?? bpsToUsd(spreadCostBps, basisNotionalUsd);
  const slippageContributionUsd = toNumberOrNull(attribution.slippage_contribution_usd) ?? bpsToUsd(slippageCostBps, basisNotionalUsd);
  const timingContributionUsd = toNumberOrNull(attribution.timing_contribution_usd)
    ?? (executionContributionUsd !== null && spreadContributionUsd !== null && slippageContributionUsd !== null
      ? roundUsd(executionContributionUsd - spreadContributionUsd - slippageContributionUsd)
      : bpsToUsd(timingAlphaBps, basisNotionalUsd));

  return {
    ...attribution,
    allocation_contribution_usd: allocationContributionUsd,
    timing_contribution_usd: timingContributionUsd,
    spread_contribution_usd: spreadContributionUsd,
    slippage_contribution_usd: slippageContributionUsd,
    alpha_confidence: toNumberOrNull(attribution.alpha_confidence) ?? computeAlphaConfidence(entry, pnlUsd),
    sample_size: toNumberOrNull(attribution.sample_size) ?? 1,
    attribution_version: typeof attribution.attribution_version === "string" && attribution.attribution_version.trim().length > 0
      ? attribution.attribution_version.trim()
      : "alpha-attribution-v1",
    allocation_alpha_bps: toNumberOrNull(attribution.allocation_alpha_bps) ?? toBps(allocationContributionUsd, basisNotionalUsd),
    signal_alpha_bps: toNumberOrNull(attribution.signal_alpha_bps) ?? toBps(toNumberOrNull(attribution.signal_contribution_usd), basisNotionalUsd),
    timing_alpha_bps: timingAlphaBps,
    execution_alpha_bps: executionAlphaBps,
    spread_cost_bps: spreadCostBps,
    slippage_cost_bps: slippageCostBps,
    attribution_status: attribution.status === "pending" ? "pending" : "computed",
  };
}

function normalizeGroupField(value: string): AttributionGroupField | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "strategy" || normalized === "strategy_id") {
    return "strategy_id";
  }
  if (normalized === "symbol" || normalized === "instrument") {
    return "symbol";
  }
  if (normalized === "venue") {
    return "venue";
  }
  return null;
}

export function parseAttributionGroupBy(raw: string | null): AttributionGroupField[] {
  const parsed = String(raw || "")
    .split(",")
    .map((value) => normalizeGroupField(value))
    .filter((value): value is AttributionGroupField => value !== null);
  return parsed.length > 0 ? parsed : ["strategy_id", "symbol", "venue"];
}

function hasComputedCoreAttribution(attribution: ExecutionFactAttribution): boolean {
  return attribution.status !== "pending"
    && toNumberOrNull(attribution.regime_contribution_usd) !== null
    && toNumberOrNull(attribution.signal_contribution_usd) !== null
    && toNumberOrNull(attribution.execution_contribution_usd) !== null;
}

export function deriveExecutionAlphaAttributionV1(entry: ExecutionFactJournalEntry): DerivedExecutionAttribution {
  if (hasComputedCoreAttribution(entry.alpha_attribution)) {
    return enrichDerivedAttribution(entry, {
      ...entry.alpha_attribution,
      status: "computed",
    });
  }

  const pnlUsd = toNumberOrNull(entry.alpha_attribution.pnl_usd);
  if (pnlUsd === null) {
    return {
      ...entry.alpha_attribution,
      alpha_confidence: toNumberOrNull(entry.alpha_attribution.alpha_confidence),
      sample_size: toNumberOrNull(entry.alpha_attribution.sample_size),
      attribution_version: entry.alpha_attribution.attribution_version || null,
      attribution_status: "pending",
      status: "pending",
    };
  }

  const regimeAtDecision = String(entry.regime_at_decision || "").trim().toUpperCase();
  const regimeAtFill = String(entry.regime_at_fill || "").trim().toUpperCase();
  const hasKnownRegime = regimeAtDecision.length > 0 && regimeAtDecision !== "UNKNOWN";
  const stableRegime = hasKnownRegime && regimeAtFill.length > 0 && regimeAtFill !== "UNKNOWN" && regimeAtDecision === regimeAtFill;
  const targetNotional = Math.abs(toNumberOrNull(entry.target_notional_usd) || 0);
  const filledNotional = Math.abs(toNumberOrNull(entry.filled_notional_usd) || 0);
  const fillRatio = targetNotional > 0 ? clamp(filledNotional / targetNotional, 0, 1) : 1;

  let regimeWeight = stableRegime ? 0.35 : hasKnownRegime ? 0.15 : 0.1;
  let executionWeight = targetNotional > 0
    ? clamp(0.15 + (1 - fillRatio) * 0.25, 0.15, 0.4)
    : 0.2;
  let signalWeight = 1 - regimeWeight - executionWeight;

  if (entry.decision_outcome === "false_positive") {
    signalWeight = clamp(signalWeight + 0.1, 0.35, 0.7);
  } else if (entry.decision_outcome === "unknown") {
    signalWeight = clamp(signalWeight - 0.05, 0.25, 0.6);
  }

  executionWeight = clamp(1 - regimeWeight - signalWeight, 0.1, 0.4);
  signalWeight = 1 - regimeWeight - executionWeight;

  const allocationContributionUsd = roundUsd(pnlUsd * regimeWeight);
  const signalContributionUsd = roundUsd(pnlUsd * signalWeight);
  const executionContributionUsd = roundUsd(pnlUsd - allocationContributionUsd - signalContributionUsd);

  return enrichDerivedAttribution(entry, {
    status: "computed",
    pnl_usd: pnlUsd,
    regime_contribution_usd: allocationContributionUsd,
    allocation_contribution_usd: allocationContributionUsd,
    signal_contribution_usd: signalContributionUsd,
    execution_contribution_usd: executionContributionUsd,
    timing_contribution_usd: null,
    spread_contribution_usd: null,
    slippage_contribution_usd: null,
    allocation_alpha_bps: null,
    signal_alpha_bps: null,
    timing_alpha_bps: null,
    execution_alpha_bps: null,
    spread_cost_bps: null,
    slippage_cost_bps: null,
    alpha_confidence: null,
    sample_size: 1,
    attribution_version: "alpha-attribution-v1",
    notes: [
      "attribution_v1_heuristic",
      "execution_alpha_breakdown_v1",
      stableRegime ? "regime_stable" : "regime_unstable_or_unknown",
      entry.decision_outcome || "decision_outcome_unknown",
    ],
  });
}

function groupingValue(entry: ExecutionFactJournalEntry, field: AttributionGroupField): string | null {
  if (field === "strategy_id") {
    return entry.strategy_id || null;
  }
  if (field === "symbol") {
    return entry.instrument || null;
  }
  return entry.venue || null;
}

function addAverageSample(bucket: AggregatedAttributionAccumulator, field: keyof Pick<DerivedExecutionAttribution, "allocation_alpha_bps" | "signal_alpha_bps" | "timing_alpha_bps" | "execution_alpha_bps" | "spread_cost_bps" | "slippage_cost_bps">, value: number | null): void {
  if (value === null) {
    return;
  }
  if (field === "allocation_alpha_bps") {
    bucket.allocation_alpha_bps_sum += value;
    bucket.allocation_alpha_bps_count += 1;
    return;
  }
  if (field === "signal_alpha_bps") {
    bucket.signal_alpha_bps_sum += value;
    bucket.signal_alpha_bps_count += 1;
    return;
  }
  if (field === "timing_alpha_bps") {
    bucket.timing_alpha_bps_sum += value;
    bucket.timing_alpha_bps_count += 1;
    return;
  }
  if (field === "execution_alpha_bps") {
    bucket.execution_alpha_bps_sum += value;
    bucket.execution_alpha_bps_count += 1;
    return;
  }
  if (field === "spread_cost_bps") {
    bucket.spread_cost_bps_sum += value;
    bucket.spread_cost_bps_count += 1;
    return;
  }
  bucket.slippage_cost_bps_sum += value;
  bucket.slippage_cost_bps_count += 1;
}

function addUsdContribution(currentValue: number | null, nextValue: number | null): number | null {
  if (nextValue === null) {
    return currentValue;
  }
  return roundUsd((currentValue || 0) + nextValue);
}

function resolveComponentExtremes(row: {
  allocation_alpha_bps_avg: number | null;
  signal_alpha_bps_avg: number | null;
  timing_alpha_bps_avg: number | null;
  execution_alpha_bps_avg: number | null;
  spread_cost_bps_avg: number | null;
  slippage_cost_bps_avg: number | null;
}): { winner_component: string | null; loser_component: string | null } {
  const entries: Array<[ComponentBucketKey, number]> = [
    ["allocation", row.allocation_alpha_bps_avg],
    ["signal", row.signal_alpha_bps_avg],
    ["timing", row.timing_alpha_bps_avg],
    ["execution", row.execution_alpha_bps_avg],
    ["spread_cost", row.spread_cost_bps_avg],
    ["slippage_cost", row.slippage_cost_bps_avg],
  ].filter((entry): entry is [ComponentBucketKey, number] => entry[1] !== null);
  if (entries.length === 0) {
    return { winner_component: null, loser_component: null };
  }
  const [winnerComponent] = [...entries].sort((left, right) => right[1] - left[1])[0];
  const [loserComponent] = [...entries].sort((left, right) => left[1] - right[1])[0];
  return {
    winner_component: winnerComponent,
    loser_component: loserComponent,
  };
}

export async function buildPerformanceAttributionRows(options: {
  scopeType?: string;
  scopeId?: string;
  groupBy?: AttributionGroupField[];
  sinceDays?: number;
  limit?: number;
}): Promise<AggregatedAttributionRow[]> {
  const scopeType = String(options.scopeType || "").trim().toLowerCase();
  const scopeId = String(options.scopeId || "").trim();
  const groupBy = options.groupBy && options.groupBy.length > 0 ? options.groupBy : ["strategy_id", "symbol", "venue"];
  const sinceDays = Math.max(0, Math.min(365, Number(options.sinceDays || 30)));
  const limit = Math.max(1, Math.min(5000, Number(options.limit || 2000)));
  const portfolioId = scopeType === "portfolio" ? scopeId : "";

  const entries = await readExecutionFactJournalEntries({
    portfolioId,
    sinceDays,
    limit,
  });

  const buckets = new Map<string, AggregatedAttributionAccumulator>();
  let totalAbsPnlUsd = 0;

  for (const entry of entries) {
    const attribution = deriveExecutionAlphaAttributionV1(entry);
    const pnlUsd = toNumberOrNull(attribution.pnl_usd) || 0;
    totalAbsPnlUsd += Math.abs(pnlUsd);

    const identity = {
      strategy_id: groupBy.includes("strategy_id") ? groupingValue(entry, "strategy_id") : null,
      symbol: groupBy.includes("symbol") ? groupingValue(entry, "symbol") : null,
      venue: groupBy.includes("venue") ? groupingValue(entry, "venue") : null,
    };
    const key = JSON.stringify(identity);
    const bucket = buckets.get(key) || {
      strategy_id: identity.strategy_id,
      symbol: identity.symbol,
      venue: identity.venue,
      realized_pnl_usd: 0,
      pnl_contribution_pct: 0,
      trade_count: 0,
      fees_usd: 0,
      regime_contribution_usd: 0,
      allocation_contribution_usd: 0,
      signal_contribution_usd: 0,
      execution_contribution_usd: 0,
      timing_contribution_usd: null,
      spread_contribution_usd: null,
      slippage_contribution_usd: null,
      allocation_alpha_bps_sum: 0,
      signal_alpha_bps_sum: 0,
      timing_alpha_bps_sum: 0,
      execution_alpha_bps_sum: 0,
      spread_cost_bps_sum: 0,
      slippage_cost_bps_sum: 0,
      allocation_alpha_bps_count: 0,
      signal_alpha_bps_count: 0,
      timing_alpha_bps_count: 0,
      execution_alpha_bps_count: 0,
      spread_cost_bps_count: 0,
      slippage_cost_bps_count: 0,
      computed_trade_count: 0,
      pending_trade_count: 0,
      attribution_status: "pending",
    };

    bucket.realized_pnl_usd = roundUsd(bucket.realized_pnl_usd + pnlUsd);
    bucket.trade_count += 1;
    bucket.regime_contribution_usd = roundUsd(bucket.regime_contribution_usd + (toNumberOrNull(attribution.regime_contribution_usd) || 0));
    bucket.allocation_contribution_usd = roundUsd(bucket.allocation_contribution_usd + (toNumberOrNull(attribution.allocation_contribution_usd) || toNumberOrNull(attribution.regime_contribution_usd) || 0));
    bucket.signal_contribution_usd = roundUsd(bucket.signal_contribution_usd + (toNumberOrNull(attribution.signal_contribution_usd) || 0));
    bucket.execution_contribution_usd = roundUsd(bucket.execution_contribution_usd + (toNumberOrNull(attribution.execution_contribution_usd) || 0));
    bucket.timing_contribution_usd = addUsdContribution(bucket.timing_contribution_usd, toNumberOrNull(attribution.timing_contribution_usd));
    bucket.spread_contribution_usd = addUsdContribution(bucket.spread_contribution_usd, toNumberOrNull(attribution.spread_contribution_usd));
    bucket.slippage_contribution_usd = addUsdContribution(bucket.slippage_contribution_usd, toNumberOrNull(attribution.slippage_contribution_usd));
    addAverageSample(bucket, "allocation_alpha_bps", toNumberOrNull(attribution.allocation_alpha_bps));
    addAverageSample(bucket, "signal_alpha_bps", toNumberOrNull(attribution.signal_alpha_bps));
    addAverageSample(bucket, "timing_alpha_bps", toNumberOrNull(attribution.timing_alpha_bps));
    addAverageSample(bucket, "execution_alpha_bps", toNumberOrNull(attribution.execution_alpha_bps));
    addAverageSample(bucket, "spread_cost_bps", toNumberOrNull(attribution.spread_cost_bps));
    addAverageSample(bucket, "slippage_cost_bps", toNumberOrNull(attribution.slippage_cost_bps));
    if (attribution.attribution_status === "computed") {
      bucket.computed_trade_count += 1;
      bucket.attribution_status = "computed";
    } else {
      bucket.pending_trade_count += 1;
    }
    buckets.set(key, bucket);
  }

  const denominator = totalAbsPnlUsd > 0 ? totalAbsPnlUsd : 0;
  return [...buckets.values()]
    .map((bucket): AggregatedAttributionRow => {
      const aggregated = {
        strategy_id: bucket.strategy_id,
        symbol: bucket.symbol,
        venue: bucket.venue,
        realized_pnl_usd: bucket.realized_pnl_usd,
        pnl_contribution_pct: denominator > 0 ? roundUsd((bucket.realized_pnl_usd / denominator) * 100) : 0,
        trade_count: bucket.trade_count,
        fees_usd: bucket.fees_usd,
        regime_contribution_usd: bucket.regime_contribution_usd,
        allocation_contribution_usd: bucket.allocation_contribution_usd,
        signal_contribution_usd: bucket.signal_contribution_usd,
        execution_contribution_usd: bucket.execution_contribution_usd,
        timing_contribution_usd: bucket.timing_contribution_usd,
        spread_contribution_usd: bucket.spread_contribution_usd,
        slippage_contribution_usd: bucket.slippage_contribution_usd,
        allocation_alpha_bps_avg: averageOrNull(bucket.allocation_alpha_bps_sum, bucket.allocation_alpha_bps_count),
        signal_alpha_bps_avg: averageOrNull(bucket.signal_alpha_bps_sum, bucket.signal_alpha_bps_count),
        timing_alpha_bps_avg: averageOrNull(bucket.timing_alpha_bps_sum, bucket.timing_alpha_bps_count),
        execution_alpha_bps_avg: averageOrNull(bucket.execution_alpha_bps_sum, bucket.execution_alpha_bps_count),
        spread_cost_bps_avg: averageOrNull(bucket.spread_cost_bps_sum, bucket.spread_cost_bps_count),
        slippage_cost_bps_avg: averageOrNull(bucket.slippage_cost_bps_sum, bucket.slippage_cost_bps_count),
        winner_component: null,
        loser_component: null,
        computed_trade_count: bucket.computed_trade_count,
        pending_trade_count: bucket.pending_trade_count,
        attribution_status: bucket.pending_trade_count > 0 && bucket.computed_trade_count === 0 ? "pending" : "computed",
      } satisfies AggregatedAttributionRow;
      const components = resolveComponentExtremes(aggregated);
      return {
        ...aggregated,
        ...components,
      };
    })
    .sort((left, right) => Math.abs(right.realized_pnl_usd) - Math.abs(left.realized_pnl_usd));
}