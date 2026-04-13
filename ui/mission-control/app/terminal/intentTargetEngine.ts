import type { FlowLiquidityZone } from "../../lib/flowIntelligence";

import type { IntentSignal } from "./intentEngine";

type SuggestedBracket = {
  side: "buy" | "sell";
  entry: number;
  sl: number;
  tp: number;
  rr: number;
  label: string;
};

export type IntentTargetSignal = {
  allowTargeting: boolean;
  alignedSide: "buy" | "sell" | "neutral";
  targetKind: "none" | "liquidity-pool" | "future-price-map";
  targetPrice: number | null;
  stopAnchorPrice: number | null;
  targetZonePrice: number | null;
  horizonBars: number;
  confidence: number;
  expectedMoveBps: number;
  summaryLabel: string;
  detailLabel: string;
};

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function chooseZone(zones: FlowLiquidityZone[], side: "buy" | "sell", currentPrice: number): FlowLiquidityZone | null {
  const directionalZones = zones
    .filter((zone) => side === "buy" ? zone.price > currentPrice : zone.price < currentPrice)
    .sort((left, right) => {
      const leftScore = left.strength * 0.7 + left.persistence * 0.3 - left.distanceBps / 120;
      const rightScore = right.strength * 0.7 + right.persistence * 0.3 - right.distanceBps / 120;
      return rightScore - leftScore;
    });
  return directionalZones[0] || null;
}

function chooseStopZone(zones: FlowLiquidityZone[], side: "buy" | "sell", currentPrice: number): FlowLiquidityZone | null {
  const directionalZones = zones
    .filter((zone) => side === "buy" ? zone.price < currentPrice : zone.price > currentPrice)
    .sort((left, right) => Math.abs(left.price - currentPrice) - Math.abs(right.price - currentPrice));
  return directionalZones[0] || null;
}

export function buildIntentTargetSignal(input: {
  intent: IntentSignal;
  currentPrice: number;
  priceStep: number;
  atrAbs: number;
  liquidityZones: FlowLiquidityZone[];
  suggestedBracket?: SuggestedBracket | null;
}): IntentTargetSignal {
  const currentPrice = Math.max(0, input.currentPrice);
  const priceStep = Math.max(input.priceStep, currentPrice * 0.00002, 0.0000001);
  const atrAbs = Math.max(priceStep * 8, input.atrAbs);
  const alignedSide = input.suggestedBracket?.side || (input.intent.tradeBias === "neutral" ? "neutral" : input.intent.tradeBias);

  if (
    input.intent.intent === "NONE"
    || input.intent.intent === "FAKE_ACTIVITY"
    || alignedSide === "neutral"
    || input.intent.shouldBlockTrading
  ) {
    return {
      allowTargeting: false,
      alignedSide,
      targetKind: "none",
      targetPrice: null,
      stopAnchorPrice: null,
      targetZonePrice: null,
      horizonBars: 0,
      confidence: clamp01(input.intent.confidence * 0.5),
      expectedMoveBps: 0,
      summaryLabel: "TARGET HOLD",
      detailLabel: "No exploitable target should be projected from the current intent state.",
    };
  }

  const targetZone = chooseZone(input.liquidityZones, alignedSide, currentPrice);
  const stopZone = chooseStopZone(input.liquidityZones, alignedSide, currentPrice);
  const baseMove = input.intent.intent === "LIQUIDITY_HUNT"
    ? atrAbs * 1.85
    : input.intent.intent === "ACCUMULATION" || input.intent.intent === "DISTRIBUTION"
      ? atrAbs * 1.55
      : atrAbs * 1.25;
  const mappedFallbackTarget = alignedSide === "buy"
    ? currentPrice + baseMove
    : currentPrice - baseMove;
  const targetPrice = targetZone?.price ?? mappedFallbackTarget;
  const stopAnchorPrice = stopZone?.price ?? (input.suggestedBracket?.sl ?? (alignedSide === "buy" ? currentPrice - atrAbs * 0.9 : currentPrice + atrAbs * 0.9));
  const targetKind = targetZone ? "liquidity-pool" : "future-price-map";
  const expectedMoveBps = currentPrice > 0 ? Math.abs(targetPrice - currentPrice) / currentPrice * 10_000 : 0;
  const horizonBars = input.intent.intent === "LIQUIDITY_HUNT"
    ? 4
    : input.intent.intent === "ACCUMULATION" || input.intent.intent === "DISTRIBUTION"
      ? 8
      : 6;

  return {
    allowTargeting: true,
    alignedSide,
    targetKind,
    targetPrice,
    stopAnchorPrice,
    targetZonePrice: targetZone?.price ?? null,
    horizonBars,
    confidence: clamp01(input.intent.confidence * 0.72 + input.intent.persistence * 0.28),
    expectedMoveBps,
    summaryLabel: targetKind === "liquidity-pool"
      ? `TARGET LIQ ${targetPrice.toFixed(2)} · ${horizonBars}b`
      : `TARGET MAP ${targetPrice.toFixed(2)} · ${horizonBars}b`,
    detailLabel: targetKind === "liquidity-pool"
      ? `Intent maps to a resting liquidity objective near ${targetPrice.toFixed(2)} with a ${horizonBars}-bar horizon.`
      : `Intent maps to a projected price objective near ${targetPrice.toFixed(2)} with a ${horizonBars}-bar horizon.`,
  };
}

export function applyIntentTargetToBracket(input: {
  bracket: SuggestedBracket | null | undefined;
  target: IntentTargetSignal;
  priceDigits: number;
  priceStep: number;
}): SuggestedBracket | null {
  if (!input.bracket || !input.target.allowTargeting || input.target.targetPrice === null) {
    return input.bracket || null;
  }
  const bracket = input.bracket;
  const targetPrice = input.target.targetPrice;
  if ((bracket.side === "buy" && targetPrice <= bracket.entry) || (bracket.side === "sell" && targetPrice >= bracket.entry)) {
    return bracket;
  }
  const risk = bracket.side === "buy"
    ? Math.max(input.priceStep, bracket.entry - bracket.sl)
    : Math.max(input.priceStep, bracket.sl - bracket.entry);
  const reward = bracket.side === "buy"
    ? Math.max(input.priceStep, targetPrice - bracket.entry)
    : Math.max(input.priceStep, bracket.entry - targetPrice);
  return {
    ...bracket,
    tp: Number(targetPrice.toFixed(input.priceDigits)),
    rr: reward / Math.max(input.priceStep, risk),
    label: `${bracket.label} · ${input.target.targetKind === "liquidity-pool" ? "LIQ" : "MAP"} TARGET`,
  };
}