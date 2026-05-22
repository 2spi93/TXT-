export type PressureDecisionDirection = "PROTECTION" | "OPPORTUNITY";

export type PressurePriorityTier = "T0" | "T1" | "T2" | "T3" | "T4" | "T5";

export type PressureSourceType =
  | "hard_block"
  | "self_preservation"
  | "structural_guard"
  | "temporal"
  | "execution_tca"
  | "venue_decay"
  | "capital_aging"
  | "contagion"
  | "confidence_decay"
  | "execution_memory"
  | "capital_scar"
  | "recovery"
  | "execution_quality"
  | "attention"
  | "cross_market"
  | "intent"
  | "tca_path";

const PRESSURE_SOURCE_TIER: Record<PressureSourceType, PressurePriorityTier> = {
  hard_block: "T0",
  self_preservation: "T1",
  structural_guard: "T2",
  temporal: "T2",
  execution_tca: "T3",
  venue_decay: "T3",
  capital_aging: "T3",
  contagion: "T3",
  confidence_decay: "T3",
  execution_memory: "T3",
  capital_scar: "T4",
  recovery: "T4",
  execution_quality: "T4",
  attention: "T5",
  cross_market: "T5",
  intent: "T5",
  tca_path: "T5",
};

const PRESSURE_TIER_RANK: Record<PressurePriorityTier, number> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
  T4: 4,
  T5: 5,
};

export function getPressureTierRank(tier: PressurePriorityTier): number {
  return PRESSURE_TIER_RANK[tier];
}

export function getExpectedPressureTier(sourceType: PressureSourceType): PressurePriorityTier {
  return PRESSURE_SOURCE_TIER[sourceType];
}

export function comparePressurePriority(left: PressurePriorityTier, right: PressurePriorityTier): number {
  return getPressureTierRank(left) - getPressureTierRank(right);
}

export function formatPressureTierLabel(tier: PressurePriorityTier): string {
  switch (tier) {
    case "T0":
      return "existential";
    case "T1":
      return "self-preservation";
    case "T2":
      return "structural";
    case "T3":
      return "execution";
    case "T4":
      return "recovery";
    case "T5":
      return "opportunity";
    default:
      return "unknown";
  }
}

export function assertPressureSourceTierInvariant(sourceType: PressureSourceType, tier: PressurePriorityTier): void {
  const expectedTier = getExpectedPressureTier(sourceType);
  if (expectedTier !== tier) {
    throw new Error(`pressure source tier invariant violated for ${sourceType}: expected ${expectedTier}, received ${tier}`);
  }
}

export function isHigherPriorityTier(left: PressurePriorityTier, right: PressurePriorityTier): boolean {
  return getPressureTierRank(left) < getPressureTierRank(right);
}