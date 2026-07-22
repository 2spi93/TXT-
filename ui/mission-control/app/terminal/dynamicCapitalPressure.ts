import type { CapitalScalingDecision } from "../../lib/capitalScalingEngine";
import type { CapitalScarMemorySummary } from "./capitalScarMemory";

export type DynamicCapitalPressureState = "RELIEF" | "BALANCED" | "ELEVATED" | "CONSTRAINED" | "LOCKDOWN";
export type DynamicCapitalPressureConstraint = "NONE" | "EDGE" | "DRAWDOWN" | "PORTFOLIO_HEAT" | "PERFORMANCE" | "SESSION" | "SYMBOL_CAP" | "KILL_SWITCH" | "JOURNAL" | "CAPITAL_SCAR";

export type DynamicCapitalPressureSummary = {
  schema_version?: "dynamic-capital-pressure/v1";
  state: DynamicCapitalPressureState;
  score_pct: number;
  allow_new_risk: boolean;
  blocks_execution: boolean;
  summary_label: string;
  reasons: string[];
  dominant_constraint: DynamicCapitalPressureConstraint;
  metrics: {
    capital_multiplier_pct: number;
    recommended_risk_usd: number;
    drawdown_pct: number;
    exposure_pct: number;
    open_trade_count: number;
    session_window_pass: boolean;
    symbol_loss_pass: boolean;
    symbol_loss_usd: number;
    kill_switch_active: boolean;
    journal_scaling_blocked: boolean;
  };
};

type BuildDynamicCapitalPressureSummaryInput = {
  capitalScalingDecision: CapitalScalingDecision;
  dailyDrawdownPct: number;
  exposureRatio: number;
  openTradeCount: number;
  autoSessionGuard: {
    pass: boolean;
    label: string;
  };
  autoSymbolLoss: {
    pass: boolean;
    cumulativeLossUsd: number;
    overCap: boolean;
    localDisabled: boolean;
  };
  autoRiskEngine: {
    killSwitchActive: boolean;
    drawdownKillTriggered: boolean;
  };
  journalWindowScalingLiveBlocked: boolean;
  capitalScar?: CapitalScarMemorySummary | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function inferDominantConstraint(input: BuildDynamicCapitalPressureSummaryInput): DynamicCapitalPressureConstraint {
  if (input.autoRiskEngine.killSwitchActive) {
    return "KILL_SWITCH";
  }
  if (!input.autoSessionGuard.pass) {
    return "SESSION";
  }
  if (!input.autoSymbolLoss.pass) {
    return "SYMBOL_CAP";
  }
  if (input.journalWindowScalingLiveBlocked) {
    return "JOURNAL";
  }
  if (input.capitalScar && input.capitalScar.state !== "CLEAN") {
    return "CAPITAL_SCAR";
  }
  if (input.capitalScalingDecision.reasons.some((reason) => reason.includes("drawdown"))) {
    return "DRAWDOWN";
  }
  if (input.capitalScalingDecision.reasons.some((reason) => reason.includes("portfolio_heat") || reason.includes("open_trade_limit"))) {
    return "PORTFOLIO_HEAT";
  }
  if (input.capitalScalingDecision.reasons.some((reason) => reason.includes("performance"))) {
    return "PERFORMANCE";
  }
  if (input.capitalScalingDecision.reasons.some((reason) => reason.includes("edge") || reason.includes("capital_engine_hard_block"))) {
    return "EDGE";
  }
  return "NONE";
}

export function buildDynamicCapitalPressureSummary(input: BuildDynamicCapitalPressureSummaryInput): DynamicCapitalPressureSummary {
  const capitalScalingDecision = input.capitalScalingDecision;
  const reasons = [...capitalScalingDecision.reasons];

  if (!input.autoSessionGuard.pass) {
    reasons.push(`session_guard_closed:${input.autoSessionGuard.label}`);
  }
  if (input.autoSymbolLoss.overCap) {
    reasons.push("symbol_loss_cap_reached");
  }
  if (input.autoSymbolLoss.localDisabled) {
    reasons.push("symbol_loss_locally_disabled");
  }
  if (input.journalWindowScalingLiveBlocked) {
    reasons.push("journal_scaling_locked");
  }
  if (input.autoRiskEngine.killSwitchActive) {
    reasons.push(input.autoRiskEngine.drawdownKillTriggered ? "drawdown_kill_switch" : "operator_kill_switch");
  }
  if (input.capitalScar && input.capitalScar.state !== "CLEAN") {
    reasons.push(`capital_scar:${input.capitalScar.state.toLowerCase()}`);
    input.capitalScar.reasons.forEach((reason) => reasons.push(reason));
  }

  const multiplierPressure = clamp(1 - capitalScalingDecision.multiplier / 1.4, 0, 1);
  const drawdownPressure = clamp(input.dailyDrawdownPct / 5, 0, 1);
  const exposurePressure = clamp(input.exposureRatio / 0.1, 0, 1);
  const openTradePressure = clamp(input.openTradeCount / 3, 0, 1);
  const score = clamp(
    multiplierPressure * 0.34
      + drawdownPressure * 0.2
      + exposurePressure * 0.16
      + openTradePressure * 0.08
      + (!input.autoSessionGuard.pass ? 0.12 : 0)
      + (!input.autoSymbolLoss.pass ? 0.16 : 0)
      + (input.journalWindowScalingLiveBlocked ? 0.12 : 0)
      + (input.autoRiskEngine.killSwitchActive ? 0.25 : 0)
      + clamp((input.capitalScar?.pressure_bias_pct || 0) / 100, 0, 0.4) * 0.22,
    0,
    1,
  );

  const state: DynamicCapitalPressureState = input.autoRiskEngine.killSwitchActive || !capitalScalingDecision.allow
    ? "LOCKDOWN"
    : !input.autoSessionGuard.pass || !input.autoSymbolLoss.pass || input.journalWindowScalingLiveBlocked || input.capitalScar?.state === "TRAUMA"
      ? "CONSTRAINED"
      : capitalScalingDecision.status === "DEFENSIVE" || score >= 0.58 || input.capitalScar?.state === "SCARRED"
        ? "ELEVATED"
        : capitalScalingDecision.status === "AGGRESSIVE" && score <= 0.28
          ? "RELIEF"
          : "BALANCED";

  return {
    schema_version: "dynamic-capital-pressure/v1",
    state,
    score_pct: Math.round(score * 100),
    allow_new_risk: state === "RELIEF" || state === "BALANCED",
    blocks_execution: state === "LOCKDOWN",
    summary_label: `CAP PRESSURE ${state} ${Math.round(score * 100)}% · x${capitalScalingDecision.multiplier.toFixed(2)}`,
    reasons: dedupe(reasons),
    dominant_constraint: inferDominantConstraint(input),
    metrics: {
      capital_multiplier_pct: Math.round(capitalScalingDecision.multiplier * 100),
      recommended_risk_usd: Number(capitalScalingDecision.recommendedRiskUsd.toFixed(2)),
      drawdown_pct: Number(input.dailyDrawdownPct.toFixed(3)),
      exposure_pct: Number((input.exposureRatio * 100).toFixed(3)),
      open_trade_count: input.openTradeCount,
      session_window_pass: input.autoSessionGuard.pass,
      symbol_loss_pass: input.autoSymbolLoss.pass,
      symbol_loss_usd: Number(input.autoSymbolLoss.cumulativeLossUsd.toFixed(2)),
      kill_switch_active: input.autoRiskEngine.killSwitchActive,
      journal_scaling_blocked: input.journalWindowScalingLiveBlocked,
    },
  };
}