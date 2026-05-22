import type { FinalDecisionTruth } from "./finalDecisionTruth";
import type { MarketRegimeArchiveSummary } from "./marketRegimeArchive";

type JsonMap = Record<string, unknown>;

export type GovernanceReplayState = "OPEN" | "DEFENSIVE" | "BLOCKED";

export type GovernanceReplayAnswer = {
  headline: string;
  detail: string;
  layer: string | null;
  action: string;
  reasons: string[];
  created_at_iso: string | null;
};

export type GovernanceReplayTimelineStep = {
  id: string;
  label: string;
  detail: string;
  action: string;
  layer: string | null;
  created_at_iso: string;
  tone: "good" | "subtle" | "warn";
};

export type GovernanceReplayDetailedTimelineStep = {
  id: string;
  journal_action: string;
  phase: "market" | "truth" | "capital" | "memory" | "governance" | "other";
  label: string;
  detail: string;
  action: string;
  layer: string | null;
  regime: string | null;
  route_mode: string | null;
  reasons: string[];
  contract_versions: string[];
  created_at_iso: string;
  tone: "good" | "subtle" | "warn";
};

export type GovernanceReplaySummary = {
  schema_version: "governance-replay/v1";
  generated_at_iso: string;
  state: GovernanceReplayState;
  active_layer: string | null;
  allow_answer: GovernanceReplayAnswer;
  block_answer: GovernanceReplayAnswer;
  failure_answer: GovernanceReplayAnswer;
  timeline: GovernanceReplayTimelineStep[];
  reasons: string[];
};

type TruthContext = {
  action: string;
  blockingLayer: string | null;
  reasons: string[];
  summaryLabel: string;
  detailLabel: string;
  shouldTrade: boolean;
  executionAllowed: boolean;
  falseContextNoTrade: boolean;
  createdAtIso: string | null;
};

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function asString(value: unknown, fallback = ""): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function toTruthContext(value: Record<string, unknown>, createdAtIso: string | null): TruthContext {
  const falseContext = asRecord(value.false_context);
  return {
    action: asString(value.action, "WAIT").toUpperCase(),
    blockingLayer: asString(value.blocking_layer, "").trim() || null,
    reasons: Array.isArray(value.reasons)
      ? value.reasons.map((item) => asString(item)).filter(Boolean)
      : [],
    summaryLabel: asString(value.summary_label),
    detailLabel: asString(value.detail_label),
    shouldTrade: value.should_trade === true,
    executionAllowed: value.execution_allowed === true,
    falseContextNoTrade: falseContext.no_trade === true,
    createdAtIso,
  };
}

function truthContextFromEntry(entry: Record<string, unknown>): TruthContext | null {
  const meta = asRecord(entry.meta);
  const truth = asRecord(meta.final_decision_truth);
  if (Object.keys(truth).length === 0) {
    return null;
  }
  return toTruthContext(truth, asString(entry.createdAtIso) || null);
}

function truthContextFromCurrentTruth(truth: FinalDecisionTruth | null | undefined): TruthContext | null {
  if (!truth) {
    return null;
  }
  const falseContext = asRecord(truth.false_context);
  return {
    action: truth.action,
    blockingLayer: truth.blocking_layer,
    reasons: truth.reasons,
    summaryLabel: truth.summary_label,
    detailLabel: truth.detail_label,
    shouldTrade: truth.should_trade,
    executionAllowed: truth.execution_allowed,
    falseContextNoTrade: falseContext.no_trade === true,
    createdAtIso: truth.generated_at_iso,
  };
}

function humanizeAction(value: string): string {
  const normalized = asString(value).replace(/[_-]+/g, " ");
  return normalized ? normalized.replace(/\b\w/g, (match) => match.toUpperCase()) : "Unknown";
}

function entryPhase(action: string): GovernanceReplayDetailedTimelineStep["phase"] {
  const normalized = action.toLowerCase();
  if (normalized.startsWith("market-") || normalized.startsWith("tradability-")) {
    return normalized === "tradability-snapshot" ? "truth" : "market";
  }
  if (normalized.startsWith("capital-")) {
    return "capital";
  }
  if (normalized.startsWith("execution-reality-memory") || normalized.startsWith("self-healing-recovery")) {
    return "memory";
  }
  if (normalized.startsWith("oracle-") || normalized.includes("governance") || normalized.includes("review")) {
    return "governance";
  }
  return "other";
}

function entryRegime(entry: Record<string, unknown>): string | null {
  const meta = asRecord(entry.meta);
  const marketSnapshot = asRecord(meta.market_memory_snapshot);
  const marketTransition = asRecord(meta.market_transition);
  const executionDegradation = asRecord(meta.execution_degradation);
  const microstructureAnomaly = asRecord(meta.microstructure_anomaly);
  const memory = asRecord(meta.execution_reality_memory);
  const truth = asRecord(meta.final_decision_truth);
  return asString(
    marketSnapshot.volatility_regime
      || marketTransition.to_regime
      || marketTransition.from_regime
      || executionDegradation.regime
      || microstructureAnomaly.regime
      || memory.regime
      || asRecord(truth.execution_reality_memory).regime,
  ).toUpperCase() || null;
}

function entryRouteMode(entry: Record<string, unknown>): string | null {
  const meta = asRecord(entry.meta);
  const truth = asRecord(meta.final_decision_truth);
  return asString(
    asRecord(meta.market_memory_snapshot).route_mode
      || asRecord(meta.execution_degradation).route_mode
      || asRecord(meta.microstructure_anomaly).route_mode
      || asRecord(meta.capital_scaling).route_mode
      || truth.route_mode,
  ) || null;
}

function entryReasons(entry: Record<string, unknown>, truth: TruthContext | null): string[] {
  const meta = asRecord(entry.meta);
  const memory = asRecord(meta.execution_reality_memory);
  const capitalScaling = asRecord(meta.capital_scaling);
  const falseContextReasons = Array.isArray(asRecord(meta.market_memory_snapshot).false_context_reasons)
    ? (asRecord(meta.market_memory_snapshot).false_context_reasons as unknown[]).map((item) => asString(item)).filter(Boolean)
    : [];
  const capitalReasons = Array.isArray(capitalScaling.reasons)
    ? (capitalScaling.reasons as unknown[]).map((item) => asString(item)).filter(Boolean)
    : [];
  const memoryEvidence = asRecord(memory.evidence);
  const memoryReasons = [
    ...(Array.isArray(memory.reasons) ? (memory.reasons as unknown[]).map((item) => asString(item)).filter(Boolean) : []),
    ...(Array.isArray(memoryEvidence.final_reasons) ? (memoryEvidence.final_reasons as unknown[]).map((item) => asString(item)).filter(Boolean) : []),
  ];
  return Array.from(new Set([
    ...(truth?.reasons || []),
    ...falseContextReasons,
    ...capitalReasons,
    ...memoryReasons,
  ].filter(Boolean))).slice(0, 6);
}

function entryContractVersions(entry: Record<string, unknown>): string[] {
  const meta = asRecord(entry.meta);
  const capitalScaling = asRecord(meta.capital_scaling);
  const temporalSizing = asRecord(capitalScaling.execution_reality_temporal_sizing);
  const truth = asRecord(meta.final_decision_truth);
  const versions = [
    asString(truth.schema_version),
    asString(asRecord(truth.execution_reality).schema_version),
    asString(asRecord(truth.execution_reality_governance).schema_version),
    asString(asRecord(truth.execution_reality_memory).schema_version),
    asString(asRecord(truth.capital_scar).schema_version),
    asString(asRecord(truth.capital_pressure).schema_version),
    asString(asRecord(truth.self_preservation).schema_version),
    asString(capitalScaling.schema_version),
    asString(temporalSizing.schema_version),
  ].filter(Boolean);
  return Array.from(new Set(versions));
}

export function buildGovernanceReplayDetailedTimeline(input: {
  journalEntries: Array<Record<string, unknown>>;
  limit?: number;
}): GovernanceReplayDetailedTimelineStep[] {
  const limit = Math.max(1, Math.min(80, Math.round(input.limit || 24)));
  return [...input.journalEntries]
    .sort((left, right) => Date.parse(asString(right.createdAtIso)) - Date.parse(asString(left.createdAtIso)))
    .filter((entry) => {
      const action = asString(entry.action).toLowerCase();
      return truthContextFromEntry(entry) !== null
        || action === "market-memory-snapshot"
        || action === "market-transition"
        || action === "market-execution-degradation"
        || action === "market-microstructure-anomaly"
        || action === "capital-scaling-updated"
        || action.startsWith("oracle-")
        || action.includes("review")
        || action.includes("governance")
        || action.startsWith("execution-reality-memory");
    })
    .slice(0, limit)
    .map((entry) => {
      const action = asString(entry.action, "event");
      const truth = truthContextFromEntry(entry);
      const layer = truth?.blockingLayer || asString(asRecord(asRecord(entry.meta).market_memory_snapshot).blocking_layer) || null;
      const tone = truth?.action === "BLOCK" || layer
        ? "warn"
        : truth?.action === "EXECUTE"
          ? "good"
          : action.includes("degradation") || action.includes("memory")
            ? "warn"
            : "subtle";
      return {
        id: asString(entry.id, `${action}-${asString(entry.createdAtIso)}`),
        journal_action: action,
        phase: entryPhase(action),
        label: humanizeAction(action),
        detail: asString(entry.detail),
        action: truth?.action || action.toUpperCase(),
        layer,
        regime: entryRegime(entry),
        route_mode: entryRouteMode(entry),
        reasons: entryReasons(entry, truth),
        contract_versions: entryContractVersions(entry),
        created_at_iso: asString(entry.createdAtIso),
        tone,
      } satisfies GovernanceReplayDetailedTimelineStep;
    });
}

function buildAnswer(input: {
  fallbackHeadline: string;
  truth: TruthContext | null;
  fallbackLayer?: string | null;
  fallbackReasons?: string[];
}): GovernanceReplayAnswer {
  if (!input.truth) {
    return {
      headline: input.fallbackHeadline,
      detail: "Aucun contexte gouvernance persiste dans le journal.",
      layer: input.fallbackLayer || null,
      action: "UNKNOWN",
      reasons: input.fallbackReasons || [],
      created_at_iso: null,
    };
  }
  return {
    headline: `${humanizeAction(input.truth.action)}${input.truth.blockingLayer ? ` via ${input.truth.blockingLayer}` : ""}`,
    detail: [input.truth.summaryLabel, input.truth.detailLabel].filter(Boolean).join(" · "),
    layer: input.truth.blockingLayer || input.fallbackLayer || null,
    action: input.truth.action,
    reasons: input.truth.reasons.slice(0, 4),
    created_at_iso: input.truth.createdAtIso,
  };
}

export function buildGovernanceReplaySummary(input: {
  journalEntries: Array<Record<string, unknown>>;
  currentTruth?: FinalDecisionTruth | null;
  archive?: MarketRegimeArchiveSummary | null;
  nowMs?: number;
}): GovernanceReplaySummary {
  const generatedAtIso = new Date(input.nowMs || Date.now()).toISOString();
  const sortedEntries = [...input.journalEntries].sort(
    (left, right) => Date.parse(asString(right.createdAtIso)) - Date.parse(asString(left.createdAtIso)),
  );
  const journalTruths = sortedEntries
    .map((entry) => ({ entry, truth: truthContextFromEntry(entry) }))
    .filter((row): row is { entry: Record<string, unknown>; truth: TruthContext } => row.truth !== null);
  const currentTruthContext = truthContextFromCurrentTruth(input.currentTruth || null);
  const allowTruth = journalTruths.find((row) => row.truth.action === "EXECUTE" && row.truth.executionAllowed && row.truth.shouldTrade)?.truth || null;
  const currentBlocks = Boolean(
    currentTruthContext
    && (
      currentTruthContext.action !== "EXECUTE"
      || !currentTruthContext.executionAllowed
      || !currentTruthContext.shouldTrade
      || currentTruthContext.falseContextNoTrade
    ),
  );
  const blockTruth = currentBlocks
    ? currentTruthContext
    : journalTruths.find((row) => row.truth.action !== "EXECUTE" || !row.truth.executionAllowed || !row.truth.shouldTrade || row.truth.falseContextNoTrade)?.truth || null;
  const activeLayer = blockTruth?.blockingLayer || input.archive?.dominant_blocking_layer || null;
  const state: GovernanceReplayState = currentTruthContext?.action === "EXECUTE" && currentTruthContext.executionAllowed && currentTruthContext.shouldTrade
    ? "OPEN"
    : activeLayer
      ? "BLOCKED"
      : "DEFENSIVE";
  const allowAnswer = buildAnswer({
    fallbackHeadline: input.archive?.active_regime ? `No prior EXECUTE under ${input.archive.active_regime}` : "No prior EXECUTE decision",
    truth: allowTruth,
    fallbackReasons: input.archive?.reasons.slice(0, 2),
  });
  const blockAnswer = buildAnswer({
    fallbackHeadline: activeLayer ? `Block via ${activeLayer}` : "No blocking layer recorded",
    truth: blockTruth,
    fallbackLayer: activeLayer,
    fallbackReasons: input.archive?.reasons.slice(0, 3),
  });
  const failureAnswer = buildAnswer({
    fallbackHeadline: activeLayer ? `Failure layer ${activeLayer}` : "Failure layer unresolved",
    truth: blockTruth,
    fallbackLayer: activeLayer,
    fallbackReasons: activeLayer ? [`failure_layer:${activeLayer}`] : input.archive?.reasons.slice(0, 1),
  });

  const timeline = sortedEntries
    .filter((entry) => {
      const action = asString(entry.action).toLowerCase();
      return truthContextFromEntry(entry) !== null
        || action === "market-memory-snapshot"
        || action === "market-transition"
        || action === "market-execution-degradation"
        || action === "market-microstructure-anomaly";
    })
    .slice(0, 6)
    .map((entry) => {
      const action = asString(entry.action, "event");
      const truth = truthContextFromEntry(entry);
      const layer = truth?.blockingLayer || null;
      const tone = truth?.action === "BLOCK" || layer
        ? "warn"
        : truth?.action === "EXECUTE"
          ? "good"
          : "subtle";
      return {
        id: asString(entry.id, `${action}-${asString(entry.createdAtIso)}`),
        label: humanizeAction(action),
        detail: asString(entry.detail),
        action: truth?.action || action.toUpperCase(),
        layer,
        created_at_iso: asString(entry.createdAtIso),
        tone,
      } satisfies GovernanceReplayTimelineStep;
    });

  return {
    schema_version: "governance-replay/v1",
    generated_at_iso: generatedAtIso,
    state,
    active_layer: activeLayer,
    allow_answer: allowAnswer,
    block_answer: blockAnswer,
    failure_answer: failureAnswer,
    timeline,
    reasons: [
      allowAnswer.reasons[0] || allowAnswer.headline,
      blockAnswer.reasons[0] || blockAnswer.headline,
      activeLayer ? `failure_layer:${activeLayer}` : failureAnswer.headline,
    ].filter(Boolean),
  };
}