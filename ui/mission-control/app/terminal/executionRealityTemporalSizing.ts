import type { ExecutionRealityMemorySnapshot } from "./executionRealityMemory";
import type { ExecutionRealitySummary } from "./executionRealityScore";

export type ExecutionRealityTemporalSizingState = "OPEN" | "CAUTION" | "TIGHT" | "LOCKED";

export type ExecutionRealityTemporalSizingSummary = {
  schema_version?: "execution-reality-temporal-sizing/v1";
  state: ExecutionRealityTemporalSizingState;
  multiplier: number;
  cap_pct: number;
  summary_label: string;
  reasons: string[];
};

type BuildExecutionRealityTemporalSizingInput = {
  executionReality?: ExecutionRealitySummary | null;
  executionRealityMemory: Pick<ExecutionRealityMemorySnapshot, "memory_state" | "size_cap_pct">;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildExecutionRealityTemporalSizingSummary(input: BuildExecutionRealityTemporalSizingInput): ExecutionRealityTemporalSizingSummary {
  const currentCapPct = clamp(input.executionReality?.size_cap_pct ?? 100, 0, 100);
  const memoryCapPct = clamp(input.executionRealityMemory.size_cap_pct, 0, 100);
  const rawCapPct = Math.min(currentCapPct, memoryCapPct);
  const state: ExecutionRealityTemporalSizingState = rawCapPct <= 0 || input.executionRealityMemory.memory_state === "LOCKDOWN"
    ? "LOCKED"
    : input.executionRealityMemory.memory_state === "PERSISTENT" || input.executionReality?.state === "DEGRADED"
      ? "TIGHT"
      : input.executionRealityMemory.memory_state === "RECOVERING" || input.executionReality?.state === "CAUTION"
        ? "CAUTION"
        : "OPEN";
  const multiplier = clamp(rawCapPct / 100, 0, 1);
  const reasons = dedupe([
    `execution_reality_temporal_sizing:${state.toLowerCase()}`,
    `execution_reality_temporal_cap:${rawCapPct}%`,
    input.executionReality && input.executionReality.state !== "ALIGNED" ? `execution_reality_current:${input.executionReality.state.toLowerCase()}` : "",
    input.executionRealityMemory.memory_state !== "CLEAR" ? `execution_reality_memory:${input.executionRealityMemory.memory_state.toLowerCase()}` : "",
  ]);

  return {
    schema_version: "execution-reality-temporal-sizing/v1",
    state,
    multiplier,
    cap_pct: rawCapPct,
    summary_label: `EXEC SIZE ${state} x${multiplier.toFixed(2)} · cap ${rawCapPct}%`,
    reasons,
  };
}