import { readApprovalDecisionJournalEntries, type ApprovalDecisionJournalEntry } from "./approvalDecisionJournal";
import { readOpportunityCostJournalEntries, type OpportunityCostJournalEntry } from "./opportunityCostJournal";

type JsonMap = Record<string, unknown>;

type ProjectionSourceDiagnostics = {
  rows_scanned: number;
  rows_returned: number;
};

export type HardeningAnalyticsCauseKey =
  | "oracle_stability_blocked"
  | "predictor_hold"
  | "brain_action_mismatch"
  | "world_fill_probability_low"
  | "insufficient_renderable_bars"
  | "missing_volume"
  | "missing_depth_imbalance"
  | "risk_limit"
  | "spread_guard"
  | "other_hardening";

export type HardeningAnalyticsCauseRow = {
  cause_key: HardeningAnalyticsCauseKey;
  label: string;
  count: number;
  share_pct: number;
  decision_count: number;
  unique_symbols: string[];
  opportunity_cost_bps: number;
  missed_alpha_bps: number;
};

export type HardeningAnalyticsSnapshot = {
  generated_at_iso: string;
  window_days: number;
  approval_stage_2_total: number;
  hardening_refused_total: number;
  unique_decision_total: number;
  source_diagnostics: ProjectionSourceDiagnostics;
  rows: HardeningAnalyticsCauseRow[];
  top_refusal_causes: HardeningAnalyticsCauseRow[];
  top_cost_causes: HardeningAnalyticsCauseRow[];
  top_missed_alpha_causes: HardeningAnalyticsCauseRow[];
};

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asPercent(numerator: number, denominator: number): number {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

function normalizeText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function includesToken(haystack: string[], ...needles: string[]): boolean {
  return needles.some((needle) => haystack.some((token) => token.includes(needle)));
}

function extractHardeningTokens(entry: ApprovalDecisionJournalEntry): string[] {
  const hardening = asRecord(entry.hardening);
  const riskContext = asRecord(entry.risk_context);
  const oracleStability = asRecord(hardening.oracle_stability);
  const predictor = asRecord(hardening.predictor);
  const world = asRecord(hardening.world);
  const risk = asRecord(hardening.risk);
  const spread = asRecord(hardening.spread);

  const tokens = new Set<string>();
  const pushToken = (value: unknown): void => {
    const normalized = normalizeText(value);
    if (normalized) {
      tokens.add(normalized);
    }
  };

  pushToken(entry.rejection_code);
  pushToken(entry.rejection_reason);
  pushToken(entry.predictor_summary);
  pushToken(entry.approval_status);

  for (const value of asArray(hardening.reasons)) {
    pushToken(value);
  }
  for (const value of asArray(hardening.blockers)) {
    pushToken(value);
  }
  for (const value of asArray(hardening.codes)) {
    pushToken(value);
  }
  for (const value of asArray(oracleStability.reasons)) {
    pushToken(value);
  }
  for (const value of asArray(predictor.reasons)) {
    pushToken(value);
  }
  for (const value of asArray(world.reasons)) {
    pushToken(value);
  }
  for (const value of asArray(risk.reasons)) {
    pushToken(value);
  }
  for (const value of asArray(spread.reasons)) {
    pushToken(value);
  }

  pushToken(hardening.code);
  pushToken(hardening.status);
  pushToken(hardening.reason);
  pushToken(oracleStability.code);
  pushToken(oracleStability.status);
  pushToken(oracleStability.reason);
  pushToken(predictor.code);
  pushToken(predictor.status);
  pushToken(predictor.reason);
  pushToken(world.code);
  pushToken(world.status);
  pushToken(world.reason);
  pushToken(risk.code);
  pushToken(risk.status);
  pushToken(risk.reason);
  pushToken(spread.code);
  pushToken(spread.status);
  pushToken(spread.reason);
  pushToken(riskContext.reason);
  pushToken(riskContext.block_reason);
  pushToken(riskContext.network_regime);

  const renderableRows = toNumberOrNull(hardening.renderable_rows);
  const fillProbability = toNumberOrNull(hardening.fill_probability ?? world.fill_probability);
  const volume30s = toNumberOrNull(hardening.volume_30s ?? riskContext.volume_30s);
  const depthImbalance = toNumberOrNull(hardening.depth_imbalance ?? riskContext.depth_imbalance);

  if (renderableRows !== null && renderableRows < 48) {
    tokens.add("insufficient_renderable_bars");
  }
  if (fillProbability !== null && fillProbability < 0.5) {
    tokens.add("world_fill_probability_low");
  }
  if (volume30s !== null && volume30s <= 0) {
    tokens.add("missing_volume");
  }
  if (depthImbalance === null && includesToken([...tokens], "depth_imbalance", "missing_depth_imbalance")) {
    tokens.add("missing_depth_imbalance");
  }

  return [...tokens];
}

function normalizeHardeningCause(entry: ApprovalDecisionJournalEntry): HardeningAnalyticsCauseKey {
  const tokens = extractHardeningTokens(entry);

  if (includesToken(tokens, "oracle_stability_blocked", "blocked_by_go_live_hardening", "oracle_stability")) {
    return "oracle_stability_blocked";
  }
  if (includesToken(tokens, "predictor_hold", "blocked_by_predictor", "predictor")) {
    return "predictor_hold";
  }
  if (includesToken(tokens, "brain_action_mismatch", "action_mismatch")) {
    return "brain_action_mismatch";
  }
  if (includesToken(tokens, "world_fill_probability_low", "fill_probability_low")) {
    return "world_fill_probability_low";
  }
  if (includesToken(tokens, "insufficient_renderable_bars", "no_renderable_rows")) {
    return "insufficient_renderable_bars";
  }
  if (includesToken(tokens, "missing_volume_30s", "missing_volume")) {
    return "missing_volume";
  }
  if (includesToken(tokens, "missing_depth_imbalance")) {
    return "missing_depth_imbalance";
  }
  if (includesToken(tokens, "risk_limit", "risk_guard", "max_risk", "risk_rejected")) {
    return "risk_limit";
  }
  if (includesToken(tokens, "spread_guard", "spread_limit", "spread_blocked")) {
    return "spread_guard";
  }
  return "other_hardening";
}

function causeLabel(causeKey: HardeningAnalyticsCauseKey): string {
  if (causeKey === "oracle_stability_blocked") return "Oracle stability blocked";
  if (causeKey === "predictor_hold") return "Predictor hold";
  if (causeKey === "brain_action_mismatch") return "Brain action mismatch";
  if (causeKey === "world_fill_probability_low") return "World fill probability low";
  if (causeKey === "insufficient_renderable_bars") return "Insufficient renderable bars";
  if (causeKey === "missing_volume") return "Missing volume";
  if (causeKey === "missing_depth_imbalance") return "Missing depth imbalance";
  if (causeKey === "risk_limit") return "Risk limit";
  if (causeKey === "spread_guard") return "Spread guard";
  return "Other hardening";
}

function isHardeningRefusal(entry: ApprovalDecisionJournalEntry): boolean {
  if (entry.approval_stage !== "approval_2") {
    return false;
  }
  const approvalStatus = normalizeText(entry.approval_status);
  const rejectionCode = normalizeText(entry.rejection_code);
  const rejectionReason = normalizeText(entry.rejection_reason);
  if (approvalStatus === "approved" || approvalStatus === "executed" || approvalStatus === "filled") {
    return false;
  }
  if (rejectionCode || rejectionReason) {
    return true;
  }
  return Object.keys(asRecord(entry.hardening)).length > 0 && approvalStatus !== "pending_second_approval";
}

function opportunityKey(entry: OpportunityCostJournalEntry): string {
  return String(entry.decision_id || entry.trade_lifecycle_id || entry.approval_id || entry.entry_id || "").trim();
}

function approvalOpportunityKeys(entry: ApprovalDecisionJournalEntry): string[] {
  return [entry.decision_id, entry.trade_lifecycle_id, entry.approval_id]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

export async function buildHardeningAnalyticsSnapshot(options?: {
  sinceDays?: number;
}): Promise<HardeningAnalyticsSnapshot> {
  const sinceDays = Math.max(1, Math.min(365, Math.round(Number(options?.sinceDays || 30))));
  const [approvals, opportunities] = await Promise.all([
    readApprovalDecisionJournalEntries({ limit: 2000, sinceDays, stage: "approval_2" }),
    readOpportunityCostJournalEntries({ limit: 2000, sinceDays }),
  ]);

  const hardeningRefusals = approvals.filter((entry) => isHardeningRefusal(entry));
  const opportunitiesByKey = new Map<string, OpportunityCostJournalEntry[]>();
  for (const opportunity of opportunities) {
    const key = opportunityKey(opportunity);
    if (!key) {
      continue;
    }
    const existing = opportunitiesByKey.get(key) || [];
    existing.push(opportunity);
    opportunitiesByKey.set(key, existing);
  }

  const rowsByCause = new Map<HardeningAnalyticsCauseKey, {
    cause_key: HardeningAnalyticsCauseKey;
    label: string;
    count: number;
    decisionIds: Set<string>;
    symbols: Set<string>;
    opportunity_cost_bps: number;
    missed_alpha_bps: number;
  }>();

  for (const entry of hardeningRefusals) {
    const causeKey = normalizeHardeningCause(entry);
    const current = rowsByCause.get(causeKey) || {
      cause_key: causeKey,
      label: causeLabel(causeKey),
      count: 0,
      decisionIds: new Set<string>(),
      symbols: new Set<string>(),
      opportunity_cost_bps: 0,
      missed_alpha_bps: 0,
    };

    current.count += 1;
    if (entry.decision_id) {
      current.decisionIds.add(entry.decision_id);
    }
    if (entry.symbol) {
      current.symbols.add(entry.symbol);
    }

    const linkedOpportunities = new Map<string, OpportunityCostJournalEntry>();
    for (const key of approvalOpportunityKeys(entry)) {
      for (const opportunity of opportunitiesByKey.get(key) || []) {
        linkedOpportunities.set(opportunity.entry_id, opportunity);
      }
    }
    for (const opportunity of linkedOpportunities.values()) {
      current.opportunity_cost_bps += toNumberOrNull(opportunity.ex_post_opportunity_cost_bps) || 0;
      current.missed_alpha_bps += toNumberOrNull(opportunity.opportunity_attribution.missed_alpha_bps) || 0;
    }

    rowsByCause.set(causeKey, current);
  }

  const allRows: HardeningAnalyticsCauseRow[] = [...rowsByCause.values()]
    .map((entry) => ({
      cause_key: entry.cause_key,
      label: entry.label,
      count: entry.count,
      share_pct: asPercent(entry.count, hardeningRefusals.length),
      decision_count: entry.decisionIds.size,
      unique_symbols: [...entry.symbols].sort(),
      opportunity_cost_bps: Number(entry.opportunity_cost_bps.toFixed(1)),
      missed_alpha_bps: Number(entry.missed_alpha_bps.toFixed(1)),
    }))
    .sort((left, right) => {
      if (right.opportunity_cost_bps !== left.opportunity_cost_bps) {
        return right.opportunity_cost_bps - left.opportunity_cost_bps;
      }
      if (right.missed_alpha_bps !== left.missed_alpha_bps) {
        return right.missed_alpha_bps - left.missed_alpha_bps;
      }
      return right.count - left.count;
    });

  const topRefusalCauses = [...allRows]
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      if (right.share_pct !== left.share_pct) {
        return right.share_pct - left.share_pct;
      }
      return right.opportunity_cost_bps - left.opportunity_cost_bps;
    })
    .slice(0, 10);

  const topCostCauses = [...allRows]
    .sort((left, right) => {
      if (right.opportunity_cost_bps !== left.opportunity_cost_bps) {
        return right.opportunity_cost_bps - left.opportunity_cost_bps;
      }
      if (right.missed_alpha_bps !== left.missed_alpha_bps) {
        return right.missed_alpha_bps - left.missed_alpha_bps;
      }
      return right.count - left.count;
    })
    .slice(0, 10);

  const topMissedAlphaCauses = [...allRows]
    .sort((left, right) => {
      if (right.missed_alpha_bps !== left.missed_alpha_bps) {
        return right.missed_alpha_bps - left.missed_alpha_bps;
      }
      if (right.opportunity_cost_bps !== left.opportunity_cost_bps) {
        return right.opportunity_cost_bps - left.opportunity_cost_bps;
      }
      return right.count - left.count;
    })
    .slice(0, 10);

  const uniqueDecisionIds = new Set(hardeningRefusals.map((entry) => String(entry.decision_id || "").trim()).filter(Boolean));

  return {
    generated_at_iso: new Date().toISOString(),
    window_days: sinceDays,
    approval_stage_2_total: approvals.length,
    hardening_refused_total: hardeningRefusals.length,
    unique_decision_total: uniqueDecisionIds.size,
    source_diagnostics: {
      rows_scanned: approvals.length + opportunities.length,
      rows_returned: allRows.length,
    },
    rows: topRefusalCauses,
    top_refusal_causes: topRefusalCauses,
    top_cost_causes: topCostCauses,
    top_missed_alpha_causes: topMissedAlphaCauses,
  };
}