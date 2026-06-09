export type TruthReliabilitySnapshot = {
  score_pct: number;
  raw_score_pct: number;
  status: "unusable" | "partial" | "exploitable" | "certified";
  cap_pct: number | null;
  cap_reasons: string[];
  components: {
    decision_continuity_pct: number;
    evidence_quality_pct: number;
    spine_match_rate_pct: number;
    snapshot_freshness_pct: number;
    runtime_truth_snapshot_age_ms: number | null;
    canonical_spine_snapshot_age_ms: number | null;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[], fallback = 0): number {
  if (values.length === 0) {
    return fallback;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function freshnessScoreFromAge(ageMs: number | null, ttlMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs === null) {
    return 0;
  }
  const ratio = ageMs / Math.max(1, ttlMs);
  if (ratio <= 1) {
    return 100;
  }
  if (ratio <= 2) {
    return 85;
  }
  if (ratio <= 4) {
    return 60;
  }
  if (ratio <= 8) {
    return 30;
  }
  return 10;
}

export function truthReliabilityStatus(scorePct: number): TruthReliabilitySnapshot["status"] {
  if (scorePct >= 95) {
    return "certified";
  }
  if (scorePct >= 80) {
    return "exploitable";
  }
  if (scorePct >= 50) {
    return "partial";
  }
  return "unusable";
}

export function buildTruthReliabilitySnapshot(input: {
  decisionContinuityPct: number;
  evidenceQualityPct: number;
  spineMatchRatePct: number;
  runtimeTruthSnapshotAgeMs: number | null;
  canonicalSpineSnapshotAgeMs: number | null;
  runtimeTruthTtlMs: number;
  canonicalSpineTtlMs: number;
}): TruthReliabilitySnapshot {
  const decisionContinuityPct = clamp(input.decisionContinuityPct, 0, 100);
  const evidenceQualityPct = clamp(input.evidenceQualityPct, 0, 100);
  const spineMatchRatePct = clamp(input.spineMatchRatePct, 0, 100);
  const snapshotFreshnessPct = round1(average([
    freshnessScoreFromAge(input.runtimeTruthSnapshotAgeMs, input.runtimeTruthTtlMs),
    freshnessScoreFromAge(input.canonicalSpineSnapshotAgeMs, input.canonicalSpineTtlMs),
  ], 0));

  const rawScorePct = round1(
    decisionContinuityPct * 0.4
    + evidenceQualityPct * 0.3
    + spineMatchRatePct * 0.2
    + snapshotFreshnessPct * 0.1,
  );

  const capReasons: string[] = [];
  let capPct: number | null = null;

  if (decisionContinuityPct < 20) {
    capPct = capPct === null ? 40 : Math.min(capPct, 40);
    capReasons.push("decision_continuity_below_20_pct");
  }
  if (evidenceQualityPct < 30) {
    capPct = capPct === null ? 50 : Math.min(capPct, 50);
    capReasons.push("evidence_quality_below_30_pct");
  }
  if (spineMatchRatePct < 70) {
    capPct = capPct === null ? 60 : Math.min(capPct, 60);
    capReasons.push("spine_match_below_70_pct");
  }

  const scorePct = round1(capPct === null ? rawScorePct : Math.min(rawScorePct, capPct));

  return {
    score_pct: scorePct,
    raw_score_pct: rawScorePct,
    status: truthReliabilityStatus(scorePct),
    cap_pct: capPct,
    cap_reasons: capReasons,
    components: {
      decision_continuity_pct: round1(decisionContinuityPct),
      evidence_quality_pct: round1(evidenceQualityPct),
      spine_match_rate_pct: round1(spineMatchRatePct),
      snapshot_freshness_pct: snapshotFreshnessPct,
      runtime_truth_snapshot_age_ms: input.runtimeTruthSnapshotAgeMs,
      canonical_spine_snapshot_age_ms: input.canonicalSpineSnapshotAgeMs,
    },
  };
}