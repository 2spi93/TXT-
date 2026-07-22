import type { ExecutionRealitySummary } from "./executionRealityScore";
import type { StabilitySnapshot } from "./stabilityEngine";

export type ExecutionRealityMemoryState = "CLEAR" | "EPISODIC" | "PERSISTENT" | "RECOVERING" | "LOCKDOWN";

export type ExecutionRealityMemorySnapshot = {
  schema_version?: "execution-reality-memory/v1";
  memory_state: ExecutionRealityMemoryState;
  regime: string;
  current_state: ExecutionRealitySummary["state"];
  dominant_drag: ExecutionRealitySummary["dominant_drag"];
  dominant_reason: string;
  persistence_score_pct: number;
  recurrence_count: number;
  persistent_cycles: number;
  size_cap_pct: number;
  allow_new_risk: boolean;
  blocks_execution: boolean;
  summary_label: string;
  reasons: string[];
  metrics: {
    current_score_pct: number;
    current_size_cap_pct: number;
    current_slippage_bps: number;
    current_fill_rate_pct: number;
    stability_mode: StabilitySnapshot["mode"];
    stability_monitor_pct: number;
    drift_watchdog: StabilitySnapshot["driftWatchdog"];
  };
};

export type ExecutionRealityMemoryEvent = {
  journal_action: "execution-reality-memory-episode" | "execution-reality-memory-persistent" | "execution-reality-memory-stabilized";
  detail_label: string;
  payload: {
    execution_reality_memory: {
      episode_type: "EPISODIC" | "PERSISTENT" | "STABILIZED";
      oracle_fingerprint: string;
      venue: string;
      route_mode: string;
      regime: string;
      memory_state: ExecutionRealityMemoryState;
      previous_memory_state: ExecutionRealityMemoryState | null;
      execution_reality_state: ExecutionRealitySummary["state"];
      previous_execution_reality_state: ExecutionRealitySummary["state"] | null;
      dominant_drag: ExecutionRealitySummary["dominant_drag"];
      dominant_reason: string;
      persistence_score_pct: number;
      recurrence_count: number;
      persistent_cycles: number;
      size_cap_pct: number;
      allow_new_risk: boolean;
      should_trade: boolean;
      execution_allowed: boolean;
      precursor_context: {
        memory_state: ExecutionRealityMemoryState;
        execution_reality_state: ExecutionRealitySummary["state"];
        persistence_score_pct: number;
        recurrence_count: number;
      } | null;
      recovery_outcome: {
        state: ExecutionRealityMemoryState;
        admissibility: "ADMISSIBLE" | "WATCH" | "BLOCKED";
      } | null;
      evidence: {
        execution_reality_reasons: string[];
        stability_reasons: string[];
        final_reasons: string[];
      };
    };
  };
};

type BuildExecutionRealityMemorySnapshotInput = {
  previous: ExecutionRealityMemorySnapshot | null;
  current: ExecutionRealitySummary;
  stabilitySnapshot: StabilitySnapshot;
  volatilityRegime: string;
};

type BuildExecutionRealityMemoryEventInput = {
  previous: ExecutionRealityMemorySnapshot | null;
  current: ExecutionRealityMemorySnapshot;
  executionReality: ExecutionRealitySummary;
  stabilitySnapshot: StabilitySnapshot;
  truthContext: {
    oracle_fingerprint: string;
    preferred_venue: string | null;
    route_mode: string;
    reasons: string[];
    should_trade: boolean;
    execution_allowed: boolean;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeRegime(value: string): string {
  return String(value || "unknown").trim().toUpperCase() || "UNKNOWN";
}

function toAdmissibility(input: { shouldTrade: boolean; executionAllowed: boolean }): "ADMISSIBLE" | "WATCH" | "BLOCKED" {
  if (!input.executionAllowed) {
    return "BLOCKED";
  }
  return input.shouldTrade ? "ADMISSIBLE" : "WATCH";
}

export function buildExecutionRealityMemorySnapshot(input: BuildExecutionRealityMemorySnapshotInput): ExecutionRealityMemorySnapshot {
  const { previous, current, stabilitySnapshot } = input;
  const reasons: string[] = [];
  const currentRisky = current.state !== "ALIGNED";
  const previousPersistent = previous?.memory_state === "PERSISTENT" || previous?.memory_state === "LOCKDOWN";
  const repeatedDrag = currentRisky
    && Boolean(previous)
    && previous?.dominant_drag !== "NONE"
    && previous?.dominant_drag === current.dominant_drag;
  const recurrenceCount = currentRisky
    ? (previous && previous.current_state !== "ALIGNED" ? previous.recurrence_count + 1 : 1)
    : 0;
  const persistentCycles = currentRisky
    ? (previous && (previousPersistent || previous.memory_state === "EPISODIC") ? previous.persistent_cycles + 1 : 1)
    : 0;
  const persistenceScore = clamp(
    (current.state === "HALT" ? 0.38 : current.state === "DEGRADED" ? 0.24 : current.state === "CAUTION" ? 0.12 : 0)
      + clamp(recurrenceCount / 3, 0, 0.28)
      + (repeatedDrag ? 0.16 : 0)
      + (previousPersistent ? 0.18 : previous?.memory_state === "EPISODIC" ? 0.08 : 0)
      + (stabilitySnapshot.mode === "halted" ? 0.22 : stabilitySnapshot.mode === "shadow" ? 0.12 : stabilitySnapshot.mode === "guarded" ? 0.06 : 0)
      + (stabilitySnapshot.driftWatchdog === "CRITICAL" ? 0.24 : stabilitySnapshot.driftWatchdog === "DRIFT" ? 0.16 : stabilitySnapshot.driftWatchdog === "WATCH" ? 0.08 : 0),
    0,
    1,
  );

  const memoryState: ExecutionRealityMemoryState = current.blocks_execution || (current.state === "HALT" && (previousPersistent || stabilitySnapshot.shouldBlockExecution))
    ? "LOCKDOWN"
    : currentRisky && (persistentCycles >= 2 || persistenceScore >= 0.56)
      ? "PERSISTENT"
      : currentRisky
        ? "EPISODIC"
        : previousPersistent || (previous?.persistence_score_pct || 0) >= 48
          ? "RECOVERING"
          : "CLEAR";

  if (currentRisky) {
    reasons.push(`execution_reality_memory:${memoryState.toLowerCase()}`);
  }
  if (repeatedDrag && current.dominant_drag !== "NONE") {
    reasons.push(`execution_reality_memory_repeat:${current.dominant_drag.toLowerCase()}`);
  }
  if (persistentCycles >= 2) {
    reasons.push(`execution_reality_memory_cycles:${persistentCycles}`);
  }
  if (!currentRisky && memoryState === "RECOVERING") {
    reasons.push("execution_reality_memory_recovering");
  }
  current.reasons.slice(0, 3).forEach((reason) => reasons.push(reason));

  const sizeCapPct = memoryState === "LOCKDOWN"
    ? 0
    : memoryState === "PERSISTENT"
      ? Math.min(current.size_cap_pct, 25)
      : memoryState === "RECOVERING"
        ? Math.min(current.size_cap_pct, 40)
        : current.size_cap_pct;

  return {
    schema_version: "execution-reality-memory/v1",
    memory_state: memoryState,
    regime: normalizeRegime(input.volatilityRegime),
    current_state: current.state,
    dominant_drag: current.dominant_drag,
    dominant_reason: current.reasons[0] || stabilitySnapshot.reasons[0] || "none",
    persistence_score_pct: Math.round(persistenceScore * 100),
    recurrence_count: recurrenceCount,
    persistent_cycles: persistentCycles,
    size_cap_pct: sizeCapPct,
    allow_new_risk: memoryState === "CLEAR" || memoryState === "EPISODIC",
    blocks_execution: memoryState === "LOCKDOWN",
    summary_label: `EXEC MEM ${memoryState} ${Math.round(persistenceScore * 100)}% · ${normalizeRegime(input.volatilityRegime)}`,
    reasons: dedupe(reasons),
    metrics: {
      current_score_pct: current.score_pct,
      current_size_cap_pct: current.size_cap_pct,
      current_slippage_bps: current.metrics.slippage_bps,
      current_fill_rate_pct: current.metrics.fill_rate_pct,
      stability_mode: stabilitySnapshot.mode,
      stability_monitor_pct: Math.round(stabilitySnapshot.monitorScore * 100),
      drift_watchdog: stabilitySnapshot.driftWatchdog,
    },
  };
}

export function buildExecutionRealityMemoryEvent(input: BuildExecutionRealityMemoryEventInput): ExecutionRealityMemoryEvent | null {
  const { previous, current, executionReality, stabilitySnapshot, truthContext } = input;
  if (!previous && current.memory_state === "CLEAR") {
    return null;
  }
  if (previous) {
    const changed = previous.memory_state !== current.memory_state
      || previous.current_state !== current.current_state
      || previous.dominant_drag !== current.dominant_drag
      || Math.abs(previous.persistence_score_pct - current.persistence_score_pct) >= 8
      || previous.recurrence_count !== current.recurrence_count
      || previous.persistent_cycles !== current.persistent_cycles;
    if (!changed) {
      return null;
    }
  }

  const stabilized = previous !== null
    && (previous.memory_state === "PERSISTENT" || previous.memory_state === "LOCKDOWN")
    && (current.memory_state === "RECOVERING" || current.memory_state === "CLEAR");
  const journalAction: ExecutionRealityMemoryEvent["journal_action"] = stabilized
    ? "execution-reality-memory-stabilized"
    : current.memory_state === "PERSISTENT" || current.memory_state === "LOCKDOWN"
      ? "execution-reality-memory-persistent"
      : "execution-reality-memory-episode";
  const episodeType: ExecutionRealityMemoryEvent["payload"]["execution_reality_memory"]["episode_type"] = stabilized
    ? "STABILIZED"
    : current.memory_state === "PERSISTENT" || current.memory_state === "LOCKDOWN"
      ? "PERSISTENT"
      : "EPISODIC";
  const detailLabel = stabilized
    ? `Execution reality stabilized ${current.regime} · persistence ${current.persistence_score_pct}% · cap ${current.size_cap_pct}%`
    : `Execution memory ${current.memory_state} ${current.regime} · ${current.dominant_drag} · ${current.dominant_reason}`;

  return {
    journal_action: journalAction,
    detail_label: detailLabel,
    payload: {
      execution_reality_memory: {
        episode_type: episodeType,
        oracle_fingerprint: truthContext.oracle_fingerprint,
        venue: truthContext.preferred_venue || "MULTI",
        route_mode: truthContext.route_mode,
        regime: current.regime,
        memory_state: current.memory_state,
        previous_memory_state: previous?.memory_state || null,
        execution_reality_state: current.current_state,
        previous_execution_reality_state: previous?.current_state || null,
        dominant_drag: current.dominant_drag,
        dominant_reason: current.dominant_reason,
        persistence_score_pct: current.persistence_score_pct,
        recurrence_count: current.recurrence_count,
        persistent_cycles: current.persistent_cycles,
        size_cap_pct: current.size_cap_pct,
        allow_new_risk: current.allow_new_risk,
        should_trade: truthContext.should_trade,
        execution_allowed: truthContext.execution_allowed,
        precursor_context: previous
          ? {
              memory_state: previous.memory_state,
              execution_reality_state: previous.current_state,
              persistence_score_pct: previous.persistence_score_pct,
              recurrence_count: previous.recurrence_count,
            }
          : null,
        recovery_outcome: stabilized
          ? {
              state: current.memory_state,
              admissibility: toAdmissibility({ shouldTrade: truthContext.should_trade, executionAllowed: truthContext.execution_allowed }),
            }
          : null,
        evidence: {
          execution_reality_reasons: executionReality.reasons,
          stability_reasons: stabilitySnapshot.reasons,
          final_reasons: truthContext.reasons,
        },
      },
    },
  };
}