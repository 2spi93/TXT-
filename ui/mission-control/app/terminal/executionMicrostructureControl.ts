import type { DesyncWindowSignal, TripleValidationGate } from "./desyncEngine";
import {
  expectedTradeSideFromTrapDirection,
  type LiquidityTrapSignal,
} from "./liquidityTrapEngine";
import type { IntentSignal } from "./intentEngine";
import type { PredictiveTrapSignal } from "./predictiveTrapEngine";

export type ExecutionMicrostructureClass = "alpha" | "risk" | "neutral";

export type ExecutionMicrostructureControl = {
  block: boolean;
  blockReasons: string[];
  adjustmentReasons: string[];
  delayMs: number;
  sizeMultiplier: number;
  executionScoreCap: number;
  profile: "blocked" | "watch" | "normal" | "aggressive_reversal";
  classification: ExecutionMicrostructureClass;
  summaryLabel: string;
  detailLabel: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildExecutionMicrostructureControl(input: {
  requestedSide: "buy" | "sell";
  tripleValidationGate: TripleValidationGate;
  desyncWindow?: DesyncWindowSignal | null;
  liquidityTrap: LiquidityTrapSignal;
  predictiveTrap: PredictiveTrapSignal;
  intent: IntentSignal;
  attentionState: string;
  temporalAligned: boolean;
}): ExecutionMicrostructureControl {
  const blockReasons: string[] = [];
  const adjustmentReasons: string[] = [];
  let delayMs = 0;
  let sizeMultiplier = 1;
  let executionScoreCap = 1;
  let profile: ExecutionMicrostructureControl["profile"] = "normal";
  let classification: ExecutionMicrostructureClass = input.desyncWindow?.classification || "neutral";

  if (input.attentionState !== "stable") {
    blockReasons.push("attention_not_stable");
  }
  if (!input.temporalAligned) {
    blockReasons.push("temporal_not_aligned");
  }
  if (input.tripleValidationGate.state === "NO_TRADE") {
    blockReasons.push(`triple_${input.tripleValidationGate.reason.toLowerCase()}`);
  }
  if (input.intent.shouldBlockTrading) {
    classification = "risk";
    blockReasons.push(`intent_${input.intent.intent.toLowerCase()}`);
  }

  const trapTradeSide = expectedTradeSideFromTrapDirection(input.liquidityTrap.trapDirection);
  const trapSupportsRequestedSide = trapTradeSide === "neutral" || trapTradeSide === input.requestedSide;

  if (input.desyncWindow?.classification === "risk" && input.desyncWindow.persistenceScore >= 0.55) {
    classification = "risk";
    blockReasons.push("desync_window_risk");
  }

  if (input.intent.intent !== "NONE") {
    const intentSideMatches = input.intent.tradeBias === "neutral" || input.intent.tradeBias === input.requestedSide;
    if (!intentSideMatches && input.intent.isInstitutional && input.intent.persistence >= 0.7) {
      classification = "risk";
      blockReasons.push(`intent_wrong_side_${input.intent.intent.toLowerCase()}`);
    } else if (intentSideMatches && input.tripleValidationGate.state === "VALID") {
      if (input.intent.state === "alpha") {
        classification = "alpha";
        const institutionalBoost = input.intent.isInstitutional && input.intent.persistence >= 0.7 ? 1.5 : 1.14;
        sizeMultiplier *= institutionalBoost;
        executionScoreCap = Math.min(1, Math.max(executionScoreCap, 0.94));
        adjustmentReasons.push(`intent_${input.intent.intent.toLowerCase()}`);
        if (input.intent.intent === "LIQUIDITY_HUNT") {
          delayMs = Math.max(0, delayMs - 40);
          profile = "aggressive_reversal";
        }
      }
    }
  }

  if (input.predictiveTrap.imminent) {
    classification = "risk";
    adjustmentReasons.push(`predictive_${input.predictiveTrap.phase}`);
    delayMs = Math.max(delayMs, 90);
    sizeMultiplier *= 0.5;
    executionScoreCap = Math.min(executionScoreCap, 0.68);
    profile = "watch";
  }

  if (input.liquidityTrap.detected) {
    classification = input.liquidityTrap.type === "ABSORPTION_TRAP" || input.liquidityTrap.type === "STOP_HUNT"
      ? "alpha"
      : "risk";
    if (!trapSupportsRequestedSide) {
      blockReasons.push(`trap_wrong_side_${input.liquidityTrap.type.toLowerCase()}`);
    } else if (input.tripleValidationGate.state === "VALID") {
      if (input.liquidityTrap.type === "ABSORPTION_TRAP" || input.liquidityTrap.type === "STOP_HUNT") {
        sizeMultiplier *= input.predictiveTrap.phase === "pre_trigger" ? 1.3 : 1.12;
        delayMs = Math.max(0, delayMs - 30);
        executionScoreCap = Math.min(1, Math.max(executionScoreCap, 0.92));
        adjustmentReasons.push(`${input.liquidityTrap.type.toLowerCase()}_reversal_alpha`);
        profile = "aggressive_reversal";
      } else {
        sizeMultiplier *= 1.05;
        adjustmentReasons.push(`${input.liquidityTrap.type.toLowerCase()}_confirmed`);
      }
    } else {
      delayMs = Math.max(delayMs, 60);
      sizeMultiplier *= 0.6;
      executionScoreCap = Math.min(executionScoreCap, 0.62);
      adjustmentReasons.push(`${input.liquidityTrap.type.toLowerCase()}_await_validation`);
      profile = "watch";
    }
  }

  if (input.desyncWindow?.classification === "alpha" && input.desyncWindow.dominantBias !== "neutral") {
    const biasSide = input.desyncWindow.dominantBias === "long" ? "buy" : "sell";
    if (biasSide === input.requestedSide && input.tripleValidationGate.state === "VALID") {
      classification = "alpha";
      sizeMultiplier *= 1.06;
      adjustmentReasons.push("desync_window_alpha");
    }
  }

  const block = blockReasons.length > 0;
  if (block) {
    sizeMultiplier = 0;
    delayMs = Math.max(delayMs, 75);
    executionScoreCap = Math.min(executionScoreCap, 0.45);
    profile = "blocked";
  } else {
    sizeMultiplier = clamp(sizeMultiplier, 0.25, 1.6);
  }

  const summaryLabel = block
    ? `MICRO BLOCK ${classification.toUpperCase()}`
    : profile === "aggressive_reversal"
      ? `MICRO AGGR ${classification.toUpperCase()}`
      : profile === "watch"
        ? `MICRO WAIT ${classification.toUpperCase()}`
        : `MICRO OK ${classification.toUpperCase()}`;
  const detailLabel = block
    ? `Microstructure control blocked execution: ${blockReasons.join(", ")}.`
    : adjustmentReasons.length > 0
      ? `Microstructure control adjusted execution: ${adjustmentReasons.join(", ")}.`
      : "Microstructure control leaves execution unchanged.";

  return {
    block,
    blockReasons,
    adjustmentReasons,
    delayMs: Math.round(delayMs),
    sizeMultiplier,
    executionScoreCap,
    profile,
    classification,
    summaryLabel,
    detailLabel,
  };
}