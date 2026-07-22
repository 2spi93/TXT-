import type { DesyncSignal, DesyncWindowSignal } from "./desyncEngine";

export type LiquidityTrapType = "NONE" | "STOP_HUNT" | "FAKE_BREAKOUT" | "ABSORPTION_TRAP" | "SPOOF_TRAP";
export type LiquidityTrapDirection = "long_trap" | "short_trap" | "neutral";
export type LiquidityTrapMove = "reversal" | "continuation_fake" | "none";

export type LiquidityTrapSignal = {
  detected: boolean;
  type: LiquidityTrapType;
  strength: number;
  confidence: number;
  trapDirection: LiquidityTrapDirection;
  expectedMove: LiquidityTrapMove;
  validWindowCandles: number;
  summaryLabel: string;
  detailLabel: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function directionFromBreak(breakDirection: "up" | "down" | "none"): LiquidityTrapDirection {
  if (breakDirection === "up") {
    return "long_trap";
  }
  if (breakDirection === "down") {
    return "short_trap";
  }
  return "neutral";
}

export function expectedTradeSideFromTrapDirection(direction: LiquidityTrapDirection): "buy" | "sell" | "neutral" {
  if (direction === "long_trap") {
    return "sell";
  }
  if (direction === "short_trap") {
    return "buy";
  }
  return "neutral";
}

function summary(type: LiquidityTrapType, confidence: number): string {
  if (type === "NONE") {
    return "TRAP CLEAR";
  }
  return `TRAP ${type.replace(/_/g, " ")} ${Math.round(clamp01(confidence) * 100)}%`;
}

export function detectLiquidityTrap(input: {
  priceBreak: boolean;
  breakDirection: "up" | "down" | "none";
  flowDelta: number;
  depthDelta: number;
  priceDeltaBps: number;
  reversalSpeedBps: number;
  volumeHigh: boolean;
  absorption: boolean;
  deltaOpposite: boolean;
  spoofingRisk: number;
  desync: DesyncSignal;
  desyncWindow?: DesyncWindowSignal | null;
  attentionState: string;
  temporalAligned: boolean;
}): LiquidityTrapSignal {
  if (input.attentionState !== "stable") {
    return {
      detected: false,
      type: "NONE",
      strength: 0,
      confidence: 0,
      trapDirection: "neutral",
      expectedMove: "none",
      validWindowCandles: 0,
      summaryLabel: "TRAP HOLD",
      detailLabel: "Trap detection is ignored until attention returns to a stable state.",
    };
  }

  const flowWeak = Math.abs(input.flowDelta) < 0.16 || Math.sign(input.flowDelta) !== Math.sign(input.priceDeltaBps || 0);
  const fastReversal = Math.abs(input.reversalSpeedBps) >= 5;
  const spoof = input.spoofingRisk >= 0.68 || input.desync.type === "LIQUIDITY_TRAP";
  const trapDirection = directionFromBreak(input.breakDirection);
  const windowRisk = input.desyncWindow?.classification === "risk" ? input.desyncWindow.weightedConfidence : 0;

  if (input.priceBreak && flowWeak && fastReversal) {
    const confidence = clamp01(0.62 + Math.abs(input.reversalSpeedBps) / 20 + windowRisk * 0.12);
    return {
      detected: true,
      type: "FAKE_BREAKOUT",
      strength: clamp01(0.58 + Math.abs(input.priceDeltaBps) / 18),
      confidence,
      trapDirection,
      expectedMove: "reversal",
      validWindowCandles: 3,
      summaryLabel: summary("FAKE_BREAKOUT", confidence),
      detailLabel: "Breakout occurred with weak flow and fast reversal pressure. Liquidity is likely baiting the break before snapping back.",
    };
  }

  if ((input.absorption || input.desync.type === "ABSORPTION") && input.deltaOpposite && input.volumeHigh) {
    const confidence = clamp01(0.7 + Math.abs(input.flowDelta - input.depthDelta) * 0.1 + (input.temporalAligned ? 0.05 : 0));
    return {
      detected: true,
      type: "ABSORPTION_TRAP",
      strength: clamp01(0.72 + Math.abs(input.priceDeltaBps) / 40),
      confidence,
      trapDirection: input.priceDeltaBps >= 0 ? "long_trap" : "short_trap",
      expectedMove: "reversal",
      validWindowCandles: 4,
      summaryLabel: summary("ABSORPTION_TRAP", confidence),
      detailLabel: "Volume is elevated but price is not advancing. Absorption is trapping continuation traders before reversal.",
    };
  }

  if (spoof) {
    const confidence = clamp01(0.66 + input.spoofingRisk * 0.18 + windowRisk * 0.08);
    return {
      detected: true,
      type: "SPOOF_TRAP",
      strength: clamp01(0.68 + input.spoofingRisk * 0.18),
      confidence,
      trapDirection,
      expectedMove: "reversal",
      validWindowCandles: 2,
      summaryLabel: summary("SPOOF_TRAP", confidence),
      detailLabel: "Visible liquidity looks unstable and likely to be pulled. Spoofing pressure is high enough to invalidate naive continuation entries.",
    };
  }

  if (input.priceBreak && input.volumeHigh && !input.temporalAligned) {
    const confidence = clamp01(0.58 + Math.abs(input.priceDeltaBps) / 24);
    return {
      detected: true,
      type: "STOP_HUNT",
      strength: clamp01(0.55 + Math.abs(input.priceDeltaBps) / 20),
      confidence,
      trapDirection,
      expectedMove: "continuation_fake",
      validWindowCandles: 2,
      summaryLabel: summary("STOP_HUNT", confidence),
      detailLabel: "Price is sweeping obvious liquidity while temporal alignment is weak. This has stop-hunt characteristics rather than a clean breakout.",
    };
  }

  return {
    detected: false,
    type: "NONE",
    strength: 0,
    confidence: 0,
    trapDirection: "neutral",
    expectedMove: "none",
    validWindowCandles: 0,
    summaryLabel: "TRAP CLEAR",
    detailLabel: "No liquidity trap signature is strong enough to influence execution.",
  };
}