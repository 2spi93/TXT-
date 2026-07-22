import { readOpportunityCostJournalEntries, type OpportunityCostAttribution, type OpportunityCostJournalEntry } from "./opportunityCostJournal";

type OpportunityCostGroupField = "gate_reason" | "market_regime" | "strategy_id" | "symbol" | "timeframe";

export type OpportunityCostAttributionAggregateRow = {
  gate_reason: string | null;
  market_regime: string | null;
  strategy_id: string | null;
  symbol: string | null;
  timeframe: string | null;
  entry_count: number;
  computed_entry_count: number;
  pending_entry_count: number;
  expected_alpha_bps_avg: number | null;
  realized_move_bps_avg: number | null;
  missed_alpha_bps_avg: number | null;
  saved_loss_bps_avg: number | null;
  net_opportunity_alpha_bps_avg: number | null;
  counterfactual_confidence_avg: number | null;
  matching_quality_avg: number | null;
  followup_delay_minutes_avg: number | null;
  attribution_status: "pending" | "computed";
};

type OpportunityCostAttributionAggregateAccumulator = Omit<OpportunityCostAttributionAggregateRow, "expected_alpha_bps_avg" | "realized_move_bps_avg" | "missed_alpha_bps_avg" | "saved_loss_bps_avg" | "net_opportunity_alpha_bps_avg" | "counterfactual_confidence_avg" | "matching_quality_avg" | "followup_delay_minutes_avg"> & {
  expected_alpha_bps_sum: number;
  expected_alpha_bps_count: number;
  realized_move_bps_sum: number;
  realized_move_bps_count: number;
  missed_alpha_bps_sum: number;
  missed_alpha_bps_count: number;
  saved_loss_bps_sum: number;
  saved_loss_bps_count: number;
  counterfactual_confidence_sum: number;
  counterfactual_confidence_count: number;
  matching_quality_sum: number;
  matching_quality_count: number;
  followup_delay_minutes_sum: number;
  followup_delay_minutes_count: number;
};

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(3));
}

function averageOrNull(sum: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  return roundMetric(sum / count);
}

function normalizeGroupField(value: string): OpportunityCostGroupField | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "gate_reason" || normalized === "gate" || normalized === "reason") {
    return "gate_reason";
  }
  if (normalized === "market_regime" || normalized === "regime") {
    return "market_regime";
  }
  if (normalized === "strategy" || normalized === "strategy_id") {
    return "strategy_id";
  }
  if (normalized === "symbol" || normalized === "instrument") {
    return "symbol";
  }
  if (normalized === "timeframe") {
    return "timeframe";
  }
  return null;
}

export function parseOpportunityCostGroupBy(raw: string | null): OpportunityCostGroupField[] {
  const parsed = String(raw || "")
    .split(",")
    .map((value) => normalizeGroupField(value))
    .filter((value): value is OpportunityCostGroupField => value !== null);
  return parsed.length > 0 ? parsed : ["gate_reason", "market_regime", "strategy_id", "symbol", "timeframe"];
}

function groupValue(entry: OpportunityCostJournalEntry, field: OpportunityCostGroupField): string | null {
  if (field === "gate_reason") {
    return entry.opportunity_attribution.gate_reason || entry.gate_name || entry.refusal_reason || null;
  }
  if (field === "market_regime") {
    return entry.regime || null;
  }
  if (field === "strategy_id") {
    return entry.strategy_id || null;
  }
  if (field === "symbol") {
    return entry.instrument || null;
  }
  return entry.timeframe || null;
}

function addAverageValue(
  bucket: OpportunityCostAttributionAggregateAccumulator,
  field: keyof Pick<OpportunityCostAttribution, "expected_alpha_bps" | "realized_move_bps" | "missed_alpha_bps" | "saved_loss_bps" | "counterfactual_confidence" | "matching_quality" | "followup_delay_minutes">,
  value: number | null,
): void {
  if (value === null) {
    return;
  }
  if (field === "expected_alpha_bps") {
    bucket.expected_alpha_bps_sum += value;
    bucket.expected_alpha_bps_count += 1;
    return;
  }
  if (field === "realized_move_bps") {
    bucket.realized_move_bps_sum += value;
    bucket.realized_move_bps_count += 1;
    return;
  }
  if (field === "missed_alpha_bps") {
    bucket.missed_alpha_bps_sum += value;
    bucket.missed_alpha_bps_count += 1;
    return;
  }
  if (field === "saved_loss_bps") {
    bucket.saved_loss_bps_sum += value;
    bucket.saved_loss_bps_count += 1;
    return;
  }
  if (field === "counterfactual_confidence") {
    bucket.counterfactual_confidence_sum += value;
    bucket.counterfactual_confidence_count += 1;
    return;
  }
  if (field === "matching_quality") {
    bucket.matching_quality_sum += value;
    bucket.matching_quality_count += 1;
    return;
  }
  bucket.followup_delay_minutes_sum += value;
  bucket.followup_delay_minutes_count += 1;
}

export async function buildOpportunityCostAttributionRows(options: {
  scopeType?: string;
  scopeId?: string;
  groupBy?: OpportunityCostGroupField[];
  sinceDays?: number;
  limit?: number;
}): Promise<OpportunityCostAttributionAggregateRow[]> {
  const scopeType = String(options.scopeType || "").trim().toLowerCase();
  const scopeId = String(options.scopeId || "").trim();
  const groupBy = options.groupBy && options.groupBy.length > 0 ? options.groupBy : ["gate_reason", "market_regime", "strategy_id", "symbol", "timeframe"];
  const sinceDays = Math.max(0, Math.min(365, Number(options.sinceDays || 30)));
  const limit = Math.max(1, Math.min(5000, Number(options.limit || 2000)));
  const portfolioId = scopeType === "portfolio" ? scopeId : "";
  const strategyId = scopeType === "strategy" ? scopeId : "";
  const symbol = scopeType === "symbol" ? scopeId : "";

  const entries = await readOpportunityCostJournalEntries({
    portfolioId,
    strategyId,
    symbol,
    limit,
    sinceDays,
  });

  const buckets = new Map<string, OpportunityCostAttributionAggregateAccumulator>();
  for (const entry of entries) {
    const identity = {
      gate_reason: groupBy.includes("gate_reason") ? groupValue(entry, "gate_reason") : null,
      market_regime: groupBy.includes("market_regime") ? groupValue(entry, "market_regime") : null,
      strategy_id: groupBy.includes("strategy_id") ? groupValue(entry, "strategy_id") : null,
      symbol: groupBy.includes("symbol") ? groupValue(entry, "symbol") : null,
      timeframe: groupBy.includes("timeframe") ? groupValue(entry, "timeframe") : null,
    };
    const key = JSON.stringify(identity);
    const bucket = buckets.get(key) || {
      ...identity,
      entry_count: 0,
      computed_entry_count: 0,
      pending_entry_count: 0,
      expected_alpha_bps_sum: 0,
      expected_alpha_bps_count: 0,
      realized_move_bps_sum: 0,
      realized_move_bps_count: 0,
      missed_alpha_bps_sum: 0,
      missed_alpha_bps_count: 0,
      saved_loss_bps_sum: 0,
      saved_loss_bps_count: 0,
      counterfactual_confidence_sum: 0,
      counterfactual_confidence_count: 0,
      matching_quality_sum: 0,
      matching_quality_count: 0,
      followup_delay_minutes_sum: 0,
      followup_delay_minutes_count: 0,
      attribution_status: "pending",
    } satisfies OpportunityCostAttributionAggregateAccumulator;

    bucket.entry_count += 1;
    if (entry.opportunity_attribution.status === "computed") {
      bucket.computed_entry_count += 1;
      bucket.attribution_status = "computed";
    } else {
      bucket.pending_entry_count += 1;
    }
    addAverageValue(bucket, "expected_alpha_bps", toNumberOrNull(entry.opportunity_attribution.expected_alpha_bps));
    addAverageValue(bucket, "realized_move_bps", toNumberOrNull(entry.opportunity_attribution.realized_move_bps));
    addAverageValue(bucket, "missed_alpha_bps", toNumberOrNull(entry.opportunity_attribution.missed_alpha_bps));
    addAverageValue(bucket, "saved_loss_bps", toNumberOrNull(entry.opportunity_attribution.saved_loss_bps));
    addAverageValue(bucket, "counterfactual_confidence", toNumberOrNull(entry.opportunity_attribution.counterfactual_confidence));
    addAverageValue(bucket, "matching_quality", toNumberOrNull(entry.opportunity_attribution.matching_quality));
    addAverageValue(bucket, "followup_delay_minutes", toNumberOrNull(entry.opportunity_attribution.followup_delay_minutes));
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map((bucket): OpportunityCostAttributionAggregateRow => {
      const missedAlphaBpsAvg = averageOrNull(bucket.missed_alpha_bps_sum, bucket.missed_alpha_bps_count);
      const savedLossBpsAvg = averageOrNull(bucket.saved_loss_bps_sum, bucket.saved_loss_bps_count);
      return {
        gate_reason: bucket.gate_reason,
        market_regime: bucket.market_regime,
        strategy_id: bucket.strategy_id,
        symbol: bucket.symbol,
        timeframe: bucket.timeframe,
        entry_count: bucket.entry_count,
        computed_entry_count: bucket.computed_entry_count,
        pending_entry_count: bucket.pending_entry_count,
        expected_alpha_bps_avg: averageOrNull(bucket.expected_alpha_bps_sum, bucket.expected_alpha_bps_count),
        realized_move_bps_avg: averageOrNull(bucket.realized_move_bps_sum, bucket.realized_move_bps_count),
        missed_alpha_bps_avg: missedAlphaBpsAvg,
        saved_loss_bps_avg: savedLossBpsAvg,
        net_opportunity_alpha_bps_avg: missedAlphaBpsAvg !== null || savedLossBpsAvg !== null
          ? roundMetric((missedAlphaBpsAvg || 0) - (savedLossBpsAvg || 0))
          : null,
        counterfactual_confidence_avg: averageOrNull(bucket.counterfactual_confidence_sum, bucket.counterfactual_confidence_count),
        matching_quality_avg: averageOrNull(bucket.matching_quality_sum, bucket.matching_quality_count),
        followup_delay_minutes_avg: averageOrNull(bucket.followup_delay_minutes_sum, bucket.followup_delay_minutes_count),
        attribution_status: bucket.pending_entry_count > 0 && bucket.computed_entry_count === 0 ? "pending" : "computed",
      };
    })
    .sort((left, right) => {
      const rightMagnitude = Math.abs(right.net_opportunity_alpha_bps_avg || 0);
      const leftMagnitude = Math.abs(left.net_opportunity_alpha_bps_avg || 0);
      return rightMagnitude - leftMagnitude || right.entry_count - left.entry_count;
    });
}