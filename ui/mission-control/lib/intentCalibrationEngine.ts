type JsonMap = Record<string, unknown>;

export type CalibrationJournalEntry = {
  id?: string;
  createdAtIso?: string;
  symbol?: string;
  timeframe?: string;
  strategy?: string;
  action?: string;
  detail?: string;
  meta?: Record<string, unknown>;
};

export type JournalCapitalTier = "LOCKED" | "CAUTIOUS" | "BALANCED" | "PRESS" | "COMPOUND";

export type IntentCalibrationThresholds = {
  confidenceFloor: number;
  persistenceFloor: number;
  aggressivenessFloor: number;
  sampleCount: number;
  sampleConfidence: number;
  sourceLabel: string;
};

export type JournalScalingRecommendation = {
  tier: JournalCapitalTier;
  multiplier: number;
  confidence: number;
  sampleCount: number;
  reason: string;
};

export type IntentCalibrationIntentStats = {
  intent: string;
  detections: number;
  outcomeCount: number;
  alphaCount: number;
  riskCount: number;
  neutralCount: number;
  alphaShare: number;
  avgConfidence: number;
  avgPersistence: number;
  avgAggressiveness: number;
  avgCapitalMultiplier: number;
  avgExecutionScore: number;
  thresholds: IntentCalibrationThresholds;
  scaling: JournalScalingRecommendation;
};

export type IntentCalibrationWindowSummary = {
  label: string;
  days: number;
  totalEntries: number;
  intentEntryCount: number;
  trapEntryCount: number;
  outcomeEntryCount: number;
  capitalEntryCount: number;
  alphaOutcomeCount: number;
  riskOutcomeCount: number;
  avgCapitalMultiplier: number;
  avgExecutionScore: number;
  thresholds: IntentCalibrationThresholds;
  liveScaling: JournalScalingRecommendation;
  intents: IntentCalibrationIntentStats[];
};

export type IntentCalibrationSummary = {
  generatedAt: string;
  totalEntries: number;
  windows: Record<string, IntentCalibrationWindowSummary>;
};

type ParsedIntentSample = {
  intent: string;
  confidence: number;
  persistence: number;
  aggressiveness: number;
};

type ParsedOutcomeSample = ParsedIntentSample & {
  outcomeClass: "alpha" | "risk" | "neutral";
  capitalMultiplier: number;
  executionScore: number;
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

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function average(values: number[], fallback = 0): number {
  if (values.length === 0) {
    return fallback;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function extractAction(entry: CalibrationJournalEntry): string {
  return String(entry.action || "").trim().toLowerCase();
}

function extractCreatedAtMs(entry: CalibrationJournalEntry): number {
  const timestamp = Date.parse(String(entry.createdAtIso || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function extractMarketIntent(entry: CalibrationJournalEntry): ParsedIntentSample | null {
  const meta = asRecord(entry.meta);
  const tradeResult = asRecord(meta.trade_result);
  const tradeMetadata = asRecord(tradeResult.metadata);
  const directIntent = asRecord(meta.market_intent);
  const nestedIntent = asRecord(tradeResult.market_intent);
  const metadataIntent = asRecord(tradeMetadata.market_intent);
  const intentPayload = Object.keys(directIntent).length > 0
    ? directIntent
    : Object.keys(nestedIntent).length > 0
      ? nestedIntent
      : metadataIntent;
  const intent = String(intentPayload.intent || "NONE").trim().toUpperCase();
  if (!intent) {
    return null;
  }
  return {
    intent,
    confidence: clamp01(toNumber(intentPayload.confidence, 0)),
    persistence: clamp01(toNumber(intentPayload.persistence, 0)),
    aggressiveness: clamp01(toNumber(intentPayload.aggressiveness, 0)),
  };
}

function extractCapitalScaling(entry: CalibrationJournalEntry): JsonMap {
  const meta = asRecord(entry.meta);
  const tradeResult = asRecord(meta.trade_result);
  const tradeMetadata = asRecord(tradeResult.metadata);
  const tradeProfitRiskAi = asRecord(tradeResult.profit_risk_ai);
  const metadataProfitRiskAi = asRecord(tradeMetadata.profit_risk_ai);
  const directCapitalScaling = asRecord(meta.capital_scaling);
  const tradeCapitalScaling = asRecord(tradeProfitRiskAi.capital_scaling);
  const metadataCapitalScaling = asRecord(metadataProfitRiskAi.capital_scaling);
  if (Object.keys(directCapitalScaling).length > 0) {
    return directCapitalScaling;
  }
  if (Object.keys(tradeCapitalScaling).length > 0) {
    return tradeCapitalScaling;
  }
  return metadataCapitalScaling;
}

function extractFinalDecisionTruth(entry: CalibrationJournalEntry): JsonMap {
  const meta = asRecord(entry.meta);
  const tradeResult = asRecord(meta.trade_result);
  const tradeMetadata = asRecord(tradeResult.metadata);
  const orderIntent = asRecord(tradeResult.order_intent);
  const direct = asRecord(meta.final_decision_truth);
  const nested = asRecord(tradeResult.final_decision_truth);
  const metadataNested = asRecord(tradeMetadata.final_decision_truth);
  const orderNested = asRecord(orderIntent.final_decision_truth);
  if (Object.keys(direct).length > 0) {
    return direct;
  }
  if (Object.keys(nested).length > 0) {
    return nested;
  }
  if (Object.keys(metadataNested).length > 0) {
    return metadataNested;
  }
  return orderNested;
}

function extractExecutionScore(entry: CalibrationJournalEntry, outcomeClass: "alpha" | "risk" | "neutral"): number {
  const finalDecisionTruth = extractFinalDecisionTruth(entry);
  const edgeEligibility = asRecord(finalDecisionTruth.edge_eligibility);
  const canonicalScorePct = toNumber(edgeEligibility.score_pct, Number.NaN);
  if (Number.isFinite(canonicalScorePct)) {
    return clamp01(canonicalScorePct / 100);
  }
  const meta = asRecord(entry.meta);
  const executionFeedback = asRecord(meta.execution_feedback);
  const executionV7 = asRecord(meta.execution_v7_lite);
  const tradeResult = asRecord(meta.trade_result);
  const payloadGate = asRecord(tradeResult.execution_v7_smart_gate);
  const score = toNumber(
    executionFeedback.executionScore
      ?? executionFeedback.execution_score
      ?? executionV7.executionScore
      ?? executionV7.execution_score
      ?? payloadGate.executionScore
      ?? payloadGate.execution_score,
    Number.NaN,
  );
  if (Number.isFinite(score)) {
    return clamp01(score);
  }
  return outcomeClass === "alpha" ? 0.68 : outcomeClass === "risk" ? 0.34 : 0.5;
}

function parseOutcomeEntry(entry: CalibrationJournalEntry): ParsedOutcomeSample | null {
  const action = extractAction(entry);
  if (!action.startsWith("execution-v7-outcome-")) {
    return null;
  }
  const intent = extractMarketIntent(entry);
  if (!intent) {
    return null;
  }
  const classification = action.endsWith("-alpha")
    ? "alpha"
    : action.endsWith("-risk")
      ? "risk"
      : "neutral";
  const capitalScaling = extractCapitalScaling(entry);
  return {
    ...intent,
    outcomeClass: classification,
    capitalMultiplier: clamp(toNumber(capitalScaling.multiplier, 1), 0, 3),
    executionScore: extractExecutionScore(entry, classification),
  };
}

function isTrapAction(action: string): boolean {
  return action === "liquidity-trap-detected" || action === "predictive-trap-imminent";
}

function buildThresholds(samples: ParsedIntentSample[], outcomeSamples: ParsedOutcomeSample[], sourceLabel: string): IntentCalibrationThresholds {
  const successSamples = outcomeSamples.filter((sample) => sample.outcomeClass === "alpha");
  const riskSamples = outcomeSamples.filter((sample) => sample.outcomeClass === "risk");
  const avgConfidence = average(samples.map((sample) => sample.confidence), 0.58);
  const avgPersistence = average(samples.map((sample) => sample.persistence), 0.5);
  const avgAggressiveness = average(samples.map((sample) => sample.aggressiveness), 0.44);
  const avgSuccessConfidence = average(successSamples.map((sample) => sample.confidence), avgConfidence);
  const avgSuccessPersistence = average(successSamples.map((sample) => sample.persistence), avgPersistence);
  const avgSuccessAggressiveness = average(successSamples.map((sample) => sample.aggressiveness), avgAggressiveness);
  const avgRiskConfidence = average(riskSamples.map((sample) => sample.confidence), avgConfidence * 0.94);
  const avgRiskPersistence = average(riskSamples.map((sample) => sample.persistence), avgPersistence * 0.94);
  const avgRiskAggressiveness = average(riskSamples.map((sample) => sample.aggressiveness), avgAggressiveness * 0.92);
  const successRatio = successSamples.length / Math.max(1, successSamples.length + riskSamples.length);
  const penalty = clamp(0.58 - successRatio, 0, 0.28);
  const sampleCount = Math.max(samples.length, outcomeSamples.length);
  return {
    confidenceFloor: clamp(avgSuccessConfidence * 0.74 + avgRiskConfidence * 0.18 + penalty * 0.35, 0.48, 0.9),
    persistenceFloor: clamp(avgSuccessPersistence * 0.76 + avgRiskPersistence * 0.16 + penalty * 0.28, 0.34, 0.88),
    aggressivenessFloor: clamp(avgSuccessAggressiveness * 0.7 + avgRiskAggressiveness * 0.15 + penalty * 0.2, 0.18, 0.94),
    sampleCount,
    sampleConfidence: clamp(sampleCount / 10, 0, 1),
    sourceLabel,
  };
}

function deriveScalingRecommendation(input: {
  sampleCount: number;
  alphaCount: number;
  riskCount: number;
  avgExecutionScore: number;
  avgCapitalMultiplier: number;
  alphaShare: number;
  reasonLabel: string;
}): JournalScalingRecommendation {
  const confidence = clamp(input.sampleCount / 12, 0, 1);
  if (input.sampleCount === 0) {
    return {
      tier: "CAUTIOUS",
      multiplier: 0.82,
      confidence: 0,
      sampleCount: 0,
      reason: `${input.reasonLabel}: no journal outcomes yet`,
    };
  }
  if (input.sampleCount < 3) {
    return {
      tier: "CAUTIOUS",
      multiplier: 0.88,
      confidence,
      sampleCount: input.sampleCount,
      reason: `${input.reasonLabel}: warmup sample`,
    };
  }

  const compositeEdge = clamp01(
    input.alphaShare * 0.56
      + clamp01(input.avgExecutionScore) * 0.26
      + clamp(input.avgCapitalMultiplier / 1.2, 0, 1) * 0.18,
  );

  if (input.alphaShare < 0.42 || input.riskCount > input.alphaCount * 1.12) {
    return {
      tier: "LOCKED",
      multiplier: 0.45,
      confidence,
      sampleCount: input.sampleCount,
      reason: `${input.reasonLabel}: risk outcomes dominate`,
    };
  }
  if (compositeEdge < 0.58) {
    return {
      tier: "CAUTIOUS",
      multiplier: 0.78,
      confidence,
      sampleCount: input.sampleCount,
      reason: `${input.reasonLabel}: edge not yet stable`,
    };
  }
  if (compositeEdge < 0.72) {
    return {
      tier: "BALANCED",
      multiplier: 0.98,
      confidence,
      sampleCount: input.sampleCount,
      reason: `${input.reasonLabel}: balanced journal edge`,
    };
  }
  if (compositeEdge < 0.84) {
    return {
      tier: "PRESS",
      multiplier: 1.14,
      confidence,
      sampleCount: input.sampleCount,
      reason: `${input.reasonLabel}: press edge with control`,
    };
  }
  return {
    tier: "COMPOUND",
    multiplier: 1.28,
    confidence,
    sampleCount: input.sampleCount,
    reason: `${input.reasonLabel}: compound the validated edge`,
  };
}

export function buildIntentCalibrationSummary(entries: CalibrationJournalEntry[], options?: {
  windowDaysList?: number[];
}): IntentCalibrationSummary {
  const generatedAt = new Date().toISOString();
  const totalEntries = Array.isArray(entries) ? entries.length : 0;
  const windows = Object.fromEntries(
    (options?.windowDaysList || [7, 14]).map((days) => {
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const scopedEntries = (entries || []).filter((entry) => extractCreatedAtMs(entry) >= cutoffMs);
      const intentDetections = new Map<string, ParsedIntentSample[]>();
      const outcomeByIntent = new Map<string, ParsedOutcomeSample[]>();
      let trapEntryCount = 0;
      let outcomeEntryCount = 0;
      let capitalEntryCount = 0;
      let alphaOutcomeCount = 0;
      let riskOutcomeCount = 0;

      scopedEntries.forEach((entry) => {
        const action = extractAction(entry);
        if (isTrapAction(action)) {
          trapEntryCount += 1;
        }
        if (Object.keys(extractCapitalScaling(entry)).length > 0 || action === "capital-scaling-updated") {
          capitalEntryCount += 1;
        }
        if (action === "market-intent-detected") {
          const intent = extractMarketIntent(entry);
          if (intent) {
            const bucket = intentDetections.get(intent.intent) || [];
            bucket.push(intent);
            intentDetections.set(intent.intent, bucket);
          }
        }
        const outcome = parseOutcomeEntry(entry);
        if (outcome) {
          outcomeEntryCount += 1;
          if (outcome.outcomeClass === "alpha") {
            alphaOutcomeCount += 1;
          }
          if (outcome.outcomeClass === "risk") {
            riskOutcomeCount += 1;
          }
          const bucket = outcomeByIntent.get(outcome.intent) || [];
          bucket.push(outcome);
          outcomeByIntent.set(outcome.intent, bucket);
        }
      });

      const intents = [...new Set([...intentDetections.keys(), ...outcomeByIntent.keys()])]
        .filter((intent) => intent && intent !== "NONE")
        .map((intent) => {
          const detectionSamples = intentDetections.get(intent) || [];
          const outcomeSamples = outcomeByIntent.get(intent) || [];
          const alphaCount = outcomeSamples.filter((sample) => sample.outcomeClass === "alpha").length;
          const riskCount = outcomeSamples.filter((sample) => sample.outcomeClass === "risk").length;
          const neutralCount = outcomeSamples.filter((sample) => sample.outcomeClass === "neutral").length;
          const alphaShare = alphaCount / Math.max(1, outcomeSamples.length);
          const avgCapitalMultiplier = average(outcomeSamples.map((sample) => sample.capitalMultiplier), 1);
          const avgExecutionScore = average(outcomeSamples.map((sample) => sample.executionScore), alphaShare >= 0.5 ? 0.62 : 0.46);
          const thresholds = buildThresholds(
            outcomeSamples.length > 0 ? outcomeSamples : detectionSamples,
            outcomeSamples,
            `${days}d ${intent}`,
          );
          return {
            intent,
            detections: detectionSamples.length,
            outcomeCount: outcomeSamples.length,
            alphaCount,
            riskCount,
            neutralCount,
            alphaShare,
            avgConfidence: average((outcomeSamples.length > 0 ? outcomeSamples : detectionSamples).map((sample) => sample.confidence), 0),
            avgPersistence: average((outcomeSamples.length > 0 ? outcomeSamples : detectionSamples).map((sample) => sample.persistence), 0),
            avgAggressiveness: average((outcomeSamples.length > 0 ? outcomeSamples : detectionSamples).map((sample) => sample.aggressiveness), 0),
            avgCapitalMultiplier,
            avgExecutionScore,
            thresholds,
            scaling: deriveScalingRecommendation({
              sampleCount: outcomeSamples.length,
              alphaCount,
              riskCount,
              avgExecutionScore,
              avgCapitalMultiplier,
              alphaShare,
              reasonLabel: `${days}d ${intent}`,
            }),
          } satisfies IntentCalibrationIntentStats;
        })
        .sort((left, right) => right.outcomeCount - left.outcomeCount || right.alphaShare - left.alphaShare);

      const allOutcomeSamples = [...outcomeByIntent.values()].flat();
      const avgCapitalMultiplier = average(allOutcomeSamples.map((sample) => sample.capitalMultiplier), 1);
      const avgExecutionScore = average(allOutcomeSamples.map((sample) => sample.executionScore), 0.5);
      const alphaShare = alphaOutcomeCount / Math.max(1, outcomeEntryCount);
      const thresholds = buildThresholds(
        allOutcomeSamples.length > 0
          ? allOutcomeSamples
          : [...intentDetections.values()].flat(),
        allOutcomeSamples,
        `${days}d global`,
      );
      const liveScaling = deriveScalingRecommendation({
        sampleCount: outcomeEntryCount,
        alphaCount: alphaOutcomeCount,
        riskCount: riskOutcomeCount,
        avgExecutionScore,
        avgCapitalMultiplier,
        alphaShare,
        reasonLabel: `${days}d journal`,
      });

      return [
        `${days}d`,
        {
          label: `${days}d`,
          days,
          totalEntries: scopedEntries.length,
          intentEntryCount: scopedEntries.filter((entry) => extractAction(entry) === "market-intent-detected").length,
          trapEntryCount,
          outcomeEntryCount,
          capitalEntryCount,
          alphaOutcomeCount,
          riskOutcomeCount,
          avgCapitalMultiplier,
          avgExecutionScore,
          thresholds,
          liveScaling,
          intents,
        } satisfies IntentCalibrationWindowSummary,
      ];
    }),
  );

  return {
    generatedAt,
    totalEntries,
    windows,
  };
}

export function resolveIntentCalibrationThresholds(
  window: IntentCalibrationWindowSummary | null | undefined,
  intent: string,
): IntentCalibrationThresholds {
  if (!window) {
    return {
      confidenceFloor: 0.58,
      persistenceFloor: 0.5,
      aggressivenessFloor: 0.42,
      sampleCount: 0,
      sampleConfidence: 0,
      sourceLabel: "default",
    };
  }
  const normalizedIntent = String(intent || "NONE").trim().toUpperCase();
  const match = window.intents.find((candidate) => candidate.intent === normalizedIntent);
  return match?.thresholds || window.thresholds;
}

export function resolveJournalScalingRecommendation(
  window: IntentCalibrationWindowSummary | null | undefined,
  intent?: string,
): JournalScalingRecommendation {
  if (!window) {
    return {
      tier: "CAUTIOUS",
      multiplier: 0.82,
      confidence: 0,
      sampleCount: 0,
      reason: "no journal window",
    };
  }
  const normalizedIntent = String(intent || "GLOBAL").trim().toUpperCase();
  if (normalizedIntent && normalizedIntent !== "GLOBAL") {
    const match = window.intents.find((candidate) => candidate.intent === normalizedIntent);
    if (match && match.scaling.sampleCount > 0) {
      return match.scaling;
    }
  }
  return window.liveScaling;
}