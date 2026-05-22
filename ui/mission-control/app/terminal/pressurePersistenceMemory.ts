import {
  type PressureDecisionDirection,
  type PressurePriorityTier,
  type PressureSourceType,
  assertPressureSourceTierInvariant,
} from "./pressurePriorityTiers";

export type PressurePersistenceProfile = "EPISODIC" | "RECENT" | "STRUCTURAL" | "EXISTENTIAL";

export type PressurePersistenceMemorySignal = {
  key: string;
  direction: PressureDecisionDirection;
  tier: PressurePriorityTier;
  source_type: PressureSourceType;
  raw_pct: number;
  profile: PressurePersistenceProfile;
  first_seen_ms?: number;
  last_seen_ms?: number;
  observation_count?: number;
};

export type PressurePersistenceMemorySource = {
  key: string;
  direction: PressureDecisionDirection;
  tier: PressurePriorityTier;
  source_type: PressureSourceType;
  profile: PressurePersistenceProfile;
  half_life_hours: number;
  persistence_pct: number;
  persistence_proof: boolean;
  recency_weight_pct: number;
  observation_count: number;
  observed_duration_ms: number;
};

export type PressurePersistenceMemorySummary = {
  schema_version: "pressure-persistence-memory/v1";
  generated_at_iso: string;
  sources: PressurePersistenceMemorySource[];
  reasons: string[];
};

const PROFILE_HALF_LIFE_HOURS: Record<PressurePersistenceProfile, number> = {
  EPISODIC: 0.75,
  RECENT: 4,
  STRUCTURAL: 24,
  EXISTENTIAL: 72,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildPressurePersistenceMemorySummary(input: {
  signals: PressurePersistenceMemorySignal[];
  nowMs?: number;
}): PressurePersistenceMemorySummary {
  const nowMs = input.nowMs || Date.now();
  const sources = input.signals.map((signal) => {
    assertPressureSourceTierInvariant(signal.source_type, signal.tier);
    const halfLifeHours = PROFILE_HALF_LIFE_HOURS[signal.profile];
    const halfLifeMs = halfLifeHours * 60 * 60 * 1000;
    const firstSeenMs = signal.first_seen_ms ?? nowMs;
    const lastSeenMs = signal.last_seen_ms ?? nowMs;
    const observedDurationMs = Math.max(0, nowMs - Math.min(firstSeenMs, nowMs));
    const timeSinceLastSeenMs = Math.max(0, nowMs - Math.min(lastSeenMs, nowMs));
    const recencyWeight = Math.exp(-timeSinceLastSeenMs / Math.max(halfLifeMs, 1));
    const observationCount = Math.max(1, signal.observation_count ?? 1);
    const observationBoost = clamp((observationCount - 1) * 8, 0, 24);
    const durationBoost = clamp(observedDurationMs / Math.max(halfLifeMs, 1) * 32, 0, 36);
    const basePersistence = clamp(
      recencyWeight * 42
        + durationBoost
        + observationBoost
        + clamp(signal.raw_pct, 0, 100) * 0.18,
      0,
      100,
    );
    const persistenceProof = basePersistence >= 58
      && (observedDurationMs >= halfLifeMs * 0.6 || observationCount >= 3 || signal.profile === "EXISTENTIAL");

    return {
      key: signal.key,
      direction: signal.direction,
      tier: signal.tier,
      source_type: signal.source_type,
      profile: signal.profile,
      half_life_hours: halfLifeHours,
      persistence_pct: Math.round(basePersistence),
      persistence_proof: persistenceProof,
      recency_weight_pct: Math.round(recencyWeight * 100),
      observation_count: observationCount,
      observed_duration_ms: Math.round(observedDurationMs),
    };
  });

  return {
    schema_version: "pressure-persistence-memory/v1",
    generated_at_iso: new Date(nowMs).toISOString(),
    sources,
    reasons: dedupe([
      ...sources.map((source) => source.persistence_proof ? `pressure_persistence_proof:${source.key}` : ""),
      ...sources.map((source) => source.persistence_pct >= 60 ? `pressure_persistence_weight:${source.key}:${source.persistence_pct}pct` : ""),
    ]),
  };
}