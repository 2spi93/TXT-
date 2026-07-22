import type { PressureNormalizationSource } from "./pressureNormalization";
import {
  comparePressurePriority,
  formatPressureTierLabel,
  getPressureTierRank,
  type PressureDecisionDirection,
  type PressurePriorityTier,
} from "./pressurePriorityTiers";

export type PressureConflictArbitrationSource = PressureNormalizationSource & {
  effective_pct: number;
  capped_pct: number | null;
  suppressed: boolean;
  suppressed_by: string | null;
  suppression_reason: string | null;
};

export type PressureConflictArbitrationResult = {
  schema_version: "pressure-conflict-arbitration/v1";
  winning_tier: PressurePriorityTier | "none";
  dominant_direction: PressureDecisionDirection | "BALANCED";
  structural_veto: boolean;
  recovery_unlock_allowed: boolean;
  suppressed_sources: string[];
  unresolved_conflicts: string[];
  arbitration_trace: string[];
  sources: PressureConflictArbitrationSource[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function sortByDominance(left: PressureNormalizationSource, right: PressureNormalizationSource): number {
  return comparePressurePriority(left.tier, right.tier)
    || right.normalized_pct - left.normalized_pct
    || right.persistence_pct - left.persistence_pct
    || right.confidence_pct - left.confidence_pct
    || left.key.localeCompare(right.key);
}

function applyCap(
  source: PressureConflictArbitrationSource,
  nextPct: number,
  by: PressureNormalizationSource,
  reason: string,
): PressureConflictArbitrationSource {
  const cappedPct = Math.round(clamp(nextPct, 0, source.effective_pct));
  if (cappedPct >= source.effective_pct) {
    return source;
  }
  return {
    ...source,
    effective_pct: cappedPct,
    capped_pct: cappedPct,
    suppressed: cappedPct <= 0,
    suppressed_by: by.key,
    suppression_reason: reason,
  };
}

export function buildPressureConflictArbitration(input: {
  sources: PressureNormalizationSource[];
}): PressureConflictArbitrationResult {
  const ordered = input.sources
    .filter((source) => source.normalized_pct > 0)
    .sort(sortByDominance);
  const dominant = ordered[0] || null;
  const winningTier = dominant?.tier || "none";
  const dominantDirection: PressureDecisionDirection | "BALANCED" = dominant?.direction || "BALANCED";
  const arbitrationTrace: string[] = dominant
    ? [`winning_tier:${winningTier}:${formatPressureTierLabel(dominant.tier)}`, `dominant_source:${dominant.key}`, `dominant_direction:${dominantDirection.toLowerCase()}`]
    : ["winning_tier:none"];
  const selfPreservation = ordered.find((source) => source.source_type === "self_preservation" && source.direction === "PROTECTION") || null;
  const structuralProtection = ordered.find((source) => source.tier === "T2" && source.direction === "PROTECTION") || null;
  const existentialProtection = ordered.find((source) => source.tier === "T0" && source.direction === "PROTECTION") || null;

  let recoveryUnlockAllowed = !selfPreservation;
  const resolved = ordered.map<PressureConflictArbitrationSource>((source) => ({
    ...source,
    effective_pct: source.normalized_pct,
    capped_pct: null,
    suppressed: false,
    suppressed_by: null,
    suppression_reason: null,
  }));

  for (let index = 0; index < resolved.length; index += 1) {
    let current = resolved[index];
    const higherPriorityProtections = ordered.filter((candidate) => {
      if (candidate.key === current.key || candidate.direction !== "PROTECTION") {
        return false;
      }
      return getPressureTierRank(candidate.tier) < getPressureTierRank(current.tier) && candidate.normalized_pct >= 34;
    });

    if (current.direction === "OPPORTUNITY") {
      for (const protective of higherPriorityProtections) {
        const tierGap = getPressureTierRank(current.tier) - getPressureTierRank(protective.tier);
        if (tierGap >= 5 && protective.normalized_pct >= 52) {
          current = applyCap(current, 0, protective, `dominance:${protective.tier}_crushes_${current.tier}`);
          arbitrationTrace.push(`suppressed:${current.key}:by:${protective.key}:dominance_crush`);
          break;
        }
        if (tierGap >= 2) {
          const capPct = Math.max(0, current.effective_pct - protective.normalized_pct * 0.42 - tierGap * 6);
          current = applyCap(current, capPct, protective, `dominance:${protective.tier}_caps_${current.tier}`);
          arbitrationTrace.push(`capped:${current.key}:by:${protective.key}:dominance_cap`);
        }
      }
    }

    if (current.direction === "OPPORTUNITY" && current.source_type === "recovery" && selfPreservation) {
      const recoveryHasProof = current.persistence_proof && current.persistence_pct >= selfPreservation.persistence_pct + 8;
      recoveryUnlockAllowed = recoveryHasProof;
      if (!recoveryHasProof) {
        current = applyCap(current, 0, selfPreservation, "recovery_without_persistence_proof");
        arbitrationTrace.push(`suppressed:${current.key}:by:${selfPreservation.key}:recovery_lockout`);
      } else {
        arbitrationTrace.push(`allowed:${current.key}:recovery_persistence_proof`);
      }
    }

    if (current.direction === "OPPORTUNITY" && current.tier === "T4" && structuralProtection) {
      const capPct = Math.min(current.effective_pct, Math.max(0, 38 - structuralProtection.normalized_pct * 0.2));
      current = applyCap(current, capPct, structuralProtection, "structural_cap_t2_over_t4");
      arbitrationTrace.push(`capped:${current.key}:by:${structuralProtection.key}:structural_cap`);
    }

    if (current.direction === "OPPORTUNITY" && existentialProtection && current.tier === "T5") {
      current = applyCap(current, 0, existentialProtection, "existential_crush_t0_over_t5");
      arbitrationTrace.push(`suppressed:${current.key}:by:${existentialProtection.key}:existential_crush`);
    }

    resolved[index] = current;
  }

  const protectionScore = resolved
    .filter((source) => source.direction === "PROTECTION")
    .reduce((sum, source) => sum + source.effective_pct, 0);
  const opportunityScore = resolved
    .filter((source) => source.direction === "OPPORTUNITY")
    .reduce((sum, source) => sum + source.effective_pct, 0);
  const unresolvedConflicts = resolved
    .filter((source) => source.effective_pct >= 28)
    .flatMap((source) => {
      const peer = resolved.find((candidate) => {
        if (candidate.key === source.key || candidate.effective_pct < 28) {
          return false;
        }
        return candidate.direction !== source.direction && candidate.tier === source.tier && Math.abs(candidate.effective_pct - source.effective_pct) <= 8;
      });
      return peer ? [`${source.tier}:${source.key}<->${peer.key}`] : [];
    });

  return {
    schema_version: "pressure-conflict-arbitration/v1",
    winning_tier: winningTier,
    dominant_direction: Math.abs(protectionScore - opportunityScore) <= 6 ? "BALANCED" : protectionScore > opportunityScore ? "PROTECTION" : "OPPORTUNITY",
    structural_veto: Boolean(existentialProtection || (selfPreservation && selfPreservation.normalized_pct >= 52)),
    recovery_unlock_allowed: recoveryUnlockAllowed,
    suppressed_sources: resolved.filter((source) => source.suppressed).map((source) => source.key),
    unresolved_conflicts: dedupe(unresolvedConflicts),
    arbitration_trace: dedupe(arbitrationTrace),
    sources: resolved,
  };
}