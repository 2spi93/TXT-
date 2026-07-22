import type { PnlAnalyticsSnapshot, PnlStats } from "../../lib/pnlEngine";

export type CapitalScarState = "CLEAN" | "WATCH" | "SCARRED" | "TRAUMA";
export type CapitalScarArchetype = "NONE" | "TREND" | "CHOP" | "CRASH" | "EXECUTION" | "LIQUIDITY";

export type CapitalScarMemorySummary = {
  schema_version?: "capital-scar-memory/v1";
  state: CapitalScarState;
  score_pct: number;
  allow_new_risk: boolean;
  pressure_bias_pct: number;
  summary_label: string;
  reasons: string[];
  dominant_scar: CapitalScarArchetype;
  metrics: {
    regime: string;
    regime_trade_count: number;
    regime_pnl_usd: number;
    regime_expectancy_usd: number;
    regime_drawdown_pct: number;
    global_drawdown_pct: number;
    execution_slippage_bps: number;
    execution_fill_rate_pct: number;
    liquidity_accuracy_pct: number;
  };
};

type BuildCapitalScarMemorySummaryInput = {
  pnlAnalyticsSnapshot: PnlAnalyticsSnapshot;
  currentRegime: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeRegime(value: string): "TREND" | "CHOP" | "CRASH" | "UNKNOWN" {
  const normalized = String(value || "").trim().toUpperCase();
  if (["TREND", "BULL", "BULLISH"].includes(normalized)) {
    return "TREND";
  }
  if (["CHOP", "RANGE", "SIDEWAYS", "MEAN_REVERSION"].includes(normalized)) {
    return "CHOP";
  }
  if (["CRASH", "RISK_OFF", "PANIC"].includes(normalized)) {
    return "CRASH";
  }
  return "UNKNOWN";
}

function regimeStats(snapshot: PnlAnalyticsSnapshot, regime: ReturnType<typeof normalizeRegime>): PnlStats {
  if (regime === "TREND") {
    return snapshot.regimePerformance.trend;
  }
  if (regime === "CHOP") {
    return snapshot.regimePerformance.chop;
  }
  if (regime === "CRASH") {
    return snapshot.regimePerformance.crash;
  }
  return snapshot.stats;
}

function inferDominantScar(input: {
  regime: ReturnType<typeof normalizeRegime>;
  executionPenalty: number;
  liquidityPenalty: number;
  regimePenalty: number;
}): CapitalScarArchetype {
  if (input.executionPenalty >= Math.max(input.liquidityPenalty, input.regimePenalty) && input.executionPenalty >= 0.3) {
    return "EXECUTION";
  }
  if (input.liquidityPenalty >= Math.max(input.executionPenalty, input.regimePenalty) && input.liquidityPenalty >= 0.28) {
    return "LIQUIDITY";
  }
  if (input.regime === "TREND" || input.regime === "CHOP" || input.regime === "CRASH") {
    return input.regime;
  }
  return "NONE";
}

export function buildCapitalScarMemorySummary(input: BuildCapitalScarMemorySummaryInput): CapitalScarMemorySummary {
  const regime = normalizeRegime(input.currentRegime);
  const stats = regimeStats(input.pnlAnalyticsSnapshot, regime);
  const execution = input.pnlAnalyticsSnapshot.execution;
  const liquidity = input.pnlAnalyticsSnapshot.liquidity;
  const reasons: string[] = [];

  const regimePenalty = stats.tradeCount >= 3
    ? clamp(
      (stats.expectancy < 0 ? clamp(Math.abs(stats.expectancy) / 80 + 0.18, 0, 0.42) : 0)
      + (stats.pnlUsd < 0 ? clamp(Math.abs(stats.pnlUsd) / 400 + 0.12, 0, 0.32) : 0)
      + clamp(stats.maxDrawdownPct / 9, 0, 0.36),
      0,
      1,
    )
    : 0;
  const executionPenalty = execution.samples >= 4
    ? clamp(
      clamp(execution.avgSlippageBps / 8, 0, 0.5)
      + clamp((0.8 - execution.avgFillRate) / 0.8, 0, 0.4),
      0,
      1,
    )
    : 0;
  const liquidityPenalty = liquidity.samples >= 4
    ? clamp((0.62 - liquidity.accuracy) / 0.62, 0, 1)
    : 0;
  const globalDrawdownPenalty = clamp(input.pnlAnalyticsSnapshot.stats.maxDrawdownPct / 10, 0, 0.36);
  const score = clamp(
    regimePenalty * 0.46
      + executionPenalty * 0.22
      + liquidityPenalty * 0.16
      + globalDrawdownPenalty * 0.16,
    0,
    1,
  );

  if (stats.tradeCount >= 3 && stats.expectancy < 0) {
    reasons.push(`capital_scar_negative_expectancy:${regime.toLowerCase()}`);
  }
  if (stats.tradeCount >= 3 && stats.pnlUsd < 0) {
    reasons.push(`capital_scar_negative_pnl:${regime.toLowerCase()}`);
  }
  if (stats.maxDrawdownPct >= 3) {
    reasons.push(`capital_scar_drawdown:${stats.maxDrawdownPct.toFixed(2)}pct`);
  }
  if (execution.samples >= 4 && execution.avgSlippageBps > 4) {
    reasons.push(`capital_scar_slippage:${execution.avgSlippageBps.toFixed(2)}bps`);
  }
  if (execution.samples >= 4 && execution.avgFillRate < 0.72) {
    reasons.push(`capital_scar_fill:${Math.round(execution.avgFillRate * 100)}pct`);
  }
  if (liquidity.samples >= 4 && liquidity.accuracy < 0.55) {
    reasons.push(`capital_scar_liquidity:${Math.round(liquidity.accuracy * 100)}pct`);
  }

  const trauma = stats.tradeCount >= 5
    && ((stats.expectancy < 0 && stats.maxDrawdownPct >= 4.5) || score >= 0.78);
  const scarred = trauma
    || (stats.tradeCount >= 3 && ((stats.expectancy < 0 && stats.pnlUsd < 0) || score >= 0.52));
  const state: CapitalScarState = trauma
    ? "TRAUMA"
    : scarred
      ? "SCARRED"
      : score >= 0.24 || reasons.length > 0
        ? "WATCH"
        : "CLEAN";
  const pressureBiasPct = state === "TRAUMA"
    ? 32
    : state === "SCARRED"
      ? 18
      : state === "WATCH"
        ? 8
        : 0;

  return {
    schema_version: "capital-scar-memory/v1",
    state,
    score_pct: Math.round(score * 100),
    allow_new_risk: state === "CLEAN" || state === "WATCH",
    pressure_bias_pct: pressureBiasPct,
    summary_label: `CAP SCAR ${state} ${Math.round(score * 100)}% · ${regime}`,
    reasons: dedupe(reasons),
    dominant_scar: inferDominantScar({ regime, executionPenalty, liquidityPenalty, regimePenalty }),
    metrics: {
      regime,
      regime_trade_count: stats.tradeCount,
      regime_pnl_usd: Number(stats.pnlUsd.toFixed(2)),
      regime_expectancy_usd: Number(stats.expectancy.toFixed(2)),
      regime_drawdown_pct: Number(stats.maxDrawdownPct.toFixed(2)),
      global_drawdown_pct: Number(input.pnlAnalyticsSnapshot.stats.maxDrawdownPct.toFixed(2)),
      execution_slippage_bps: Number(execution.avgSlippageBps.toFixed(2)),
      execution_fill_rate_pct: Math.round(execution.avgFillRate * 100),
      liquidity_accuracy_pct: Math.round(liquidity.accuracy * 100),
    },
  };
}