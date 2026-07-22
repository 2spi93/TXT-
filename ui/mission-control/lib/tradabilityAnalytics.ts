type JsonMap = Record<string, unknown>;

export type TradabilityDensityState = "SUFFICIENT" | "THIN" | "DEGRADED";

export type TradabilityJournalSample = {
  id: string;
  createdAtIso: string;
  regime: string;
  marketSession: string;
  densityState: TradabilityDensityState;
  scorePct: number;
  entropyPct: number;
  edgeState: string;
  action: string;
  blockingLayer: string;
};

export type TradabilityRegimeSummaryRow = {
  regime: string;
  sampleCount: number;
  thinSharePct: number;
  degradedSharePct: number;
  sufficientSharePct: number;
  avgScorePct: number;
  avgEntropyPct: number;
  lastState: TradabilityDensityState;
  lastAction: string;
  lastSeenIso: string;
  reviewLabel: string;
  reviewTone: "good" | "subtle" | "warn";
};

export type TradabilityRegimeWindowComparisonRow = {
  regime: string;
  window24h: TradabilityRegimeSummaryRow | null;
  window7d: TradabilityRegimeSummaryRow | null;
  driftLabel: string;
  driftTone: "good" | "subtle" | "warn";
};

export type TradabilityCalibrationThresholds = {
  thinScoreFloor: number;
  degradedScoreFloor: number;
  thinEntropyCeiling: number;
  degradedEntropyCeiling: number;
};

export type TradabilityImpactCalibration = {
  mode: "BASELINE" | "BOOST" | "REDUCE";
  edgeEligibilityWeight: number;
  edgeEligibilityWeightPct: number;
  summaryLabel: string;
};

export type TradabilitySensitivityCalibration = {
  mode: "BASELINE" | "TIGHTEN" | "RELAX";
  thresholds: TradabilityCalibrationThresholds;
  summaryLabel: string;
};

export type TradabilityCalibrationProfile = {
  currentRegime: string;
  driftTone: "good" | "subtle" | "warn";
  sampleCount24h: number;
  sampleCount7d: number;
  thinSharePct24h: number;
  thinSharePct7d: number;
  degradedSharePct24h: number;
  degradedSharePct7d: number;
  thinDeltaPct: number;
  degradedDeltaPct: number;
  thresholds: TradabilityCalibrationThresholds;
  summaryLabel: string;
  sensitivity: TradabilitySensitivityCalibration;
  impact: TradabilityImpactCalibration;
};

export type TradabilityAnalyticsSummary = {
  generatedAtIso: string;
  sampleCount: number;
  windows: {
    last_24h: {
      sampleHours: 24;
      totalSamples: number;
      rows: TradabilityRegimeSummaryRow[];
    };
    last_7d: {
      sampleHours: 168;
      totalSamples: number;
      rows: TradabilityRegimeSummaryRow[];
    };
  };
  comparison: {
    rows: TradabilityRegimeWindowComparisonRow[];
  };
  calibration: TradabilityCalibrationProfile;
};

const BASE_CALIBRATION_THRESHOLDS: TradabilityCalibrationThresholds = {
  thinScoreFloor: 0.5,
  degradedScoreFloor: 0.28,
  thinEntropyCeiling: 0.58,
  degradedEntropyCeiling: 0.72,
};

const BASE_IMPACT_WEIGHT = 0.18;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeTradabilityDensityState(value: unknown): TradabilityDensityState | null {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "SUFFICIENT" || normalized === "THIN" || normalized === "DEGRADED") {
    return normalized;
  }
  return null;
}

export function parseTradabilityJournalSamples(entries: Array<Record<string, unknown>>): TradabilityJournalSample[] {
  return entries
    .map((entry) => {
      const action = String(entry.action || "").trim().toLowerCase();
      if (action !== "tradability-snapshot") {
        return null;
      }
      const meta = asRecord(entry.meta);
      const snapshot = asRecord(meta.tradability_snapshot);
      const finalDecisionTruth = asRecord(meta.final_decision_truth);
      const informationDensity = asRecord(finalDecisionTruth.information_density);
      const densityState = normalizeTradabilityDensityState(snapshot.information_density_state || informationDensity.state);
      if (!densityState) {
        return null;
      }
      return {
        id: String(entry.id || `${entry.createdAtIso || ""}-${action}`),
        createdAtIso: String(entry.createdAtIso || ""),
        regime: String(snapshot.volatility_regime || snapshot.regime || "UNKNOWN").trim().toUpperCase() || "UNKNOWN",
        marketSession: String(snapshot.market_session || "UNKNOWN").trim().toUpperCase() || "UNKNOWN",
        densityState,
        scorePct: asNumber(snapshot.score_pct, asNumber(informationDensity.score_pct, 0)),
        entropyPct: asNumber(snapshot.entropy_pct, asNumber(informationDensity.entropy_pct, 0)),
        edgeState: String(snapshot.edge_state || asRecord(finalDecisionTruth.edge_eligibility).state || "UNKNOWN").trim().toUpperCase() || "UNKNOWN",
        action: String(snapshot.action || finalDecisionTruth.action || "HOLD").trim().toUpperCase() || "HOLD",
        blockingLayer: String(snapshot.blocking_layer || finalDecisionTruth.blocking_layer || "none").trim().toLowerCase() || "none",
      };
    })
    .filter((value): value is TradabilityJournalSample => Boolean(value))
    .sort((left, right) => Date.parse(right.createdAtIso) - Date.parse(left.createdAtIso));
}

export function filterTradabilitySamplesWithinHours(samples: TradabilityJournalSample[], hours: number): TradabilityJournalSample[] {
  const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
  return samples.filter((sample) => {
    const createdAtMs = Date.parse(sample.createdAtIso);
    return Number.isFinite(createdAtMs) && createdAtMs >= cutoffMs;
  });
}

export function buildTradabilityRegimeSummaryRows(samples: TradabilityJournalSample[]): TradabilityRegimeSummaryRow[] {
  const grouped = new Map<string, {
    sampleCount: number;
    thinCount: number;
    degradedCount: number;
    sufficientCount: number;
    scoreSum: number;
    entropySum: number;
    lastState: TradabilityDensityState;
    lastAction: string;
    lastSeenIso: string;
  }>();

  for (const sample of samples) {
    const regime = sample.regime || "UNKNOWN";
    const bucket = grouped.get(regime) || {
      sampleCount: 0,
      thinCount: 0,
      degradedCount: 0,
      sufficientCount: 0,
      scoreSum: 0,
      entropySum: 0,
      lastState: sample.densityState,
      lastAction: sample.action,
      lastSeenIso: sample.createdAtIso,
    };
    bucket.sampleCount += 1;
    bucket.scoreSum += sample.scorePct;
    bucket.entropySum += sample.entropyPct;
    if (sample.densityState === "DEGRADED") {
      bucket.degradedCount += 1;
    } else if (sample.densityState === "THIN") {
      bucket.thinCount += 1;
    } else {
      bucket.sufficientCount += 1;
    }
    if (Date.parse(sample.createdAtIso) >= Date.parse(bucket.lastSeenIso)) {
      bucket.lastSeenIso = sample.createdAtIso;
      bucket.lastState = sample.densityState;
      bucket.lastAction = sample.action;
    }
    grouped.set(regime, bucket);
  }

  return [...grouped.entries()]
    .map(([regime, bucket]) => {
      const thinSharePct = bucket.sampleCount > 0 ? (bucket.thinCount / bucket.sampleCount) * 100 : 0;
      const degradedSharePct = bucket.sampleCount > 0 ? (bucket.degradedCount / bucket.sampleCount) * 100 : 0;
      const sufficientSharePct = bucket.sampleCount > 0 ? (bucket.sufficientCount / bucket.sampleCount) * 100 : 0;
      const avgScorePct = bucket.sampleCount > 0 ? bucket.scoreSum / bucket.sampleCount : 0;
      const avgEntropyPct = bucket.sampleCount > 0 ? bucket.entropySum / bucket.sampleCount : 0;
      const reviewTone: TradabilityRegimeSummaryRow["reviewTone"] = bucket.sampleCount < 4
        ? "subtle"
        : degradedSharePct >= 35 || thinSharePct >= 60
          ? "warn"
          : degradedSharePct <= 10 && thinSharePct <= 25
            ? "good"
            : "subtle";
      const reviewLabel = bucket.sampleCount < 4
        ? "sample faible"
        : degradedSharePct >= 35
          ? avgScorePct >= 50
            ? "seuil possiblement strict"
            : "regime adverse"
          : thinSharePct >= 60
            ? "poids a plafonner"
            : degradedSharePct <= 10 && thinSharePct <= 25
              ? "candidate pour poids ++"
              : "observer";
      return {
        regime,
        sampleCount: bucket.sampleCount,
        thinSharePct,
        degradedSharePct,
        sufficientSharePct,
        avgScorePct,
        avgEntropyPct,
        lastState: bucket.lastState,
        lastAction: bucket.lastAction,
        lastSeenIso: bucket.lastSeenIso,
        reviewLabel,
        reviewTone,
      };
    })
    .sort((left, right) => right.sampleCount - left.sampleCount || right.degradedSharePct - left.degradedSharePct || left.regime.localeCompare(right.regime));
}

export function buildTradabilityWindowComparisonRows(input: {
  rows24h: TradabilityRegimeSummaryRow[];
  rows7d: TradabilityRegimeSummaryRow[];
}): TradabilityRegimeWindowComparisonRow[] {
  const rows24hByRegime = new Map(input.rows24h.map((row) => [row.regime, row]));
  const rows7dByRegime = new Map(input.rows7d.map((row) => [row.regime, row]));
  const regimes = [...new Set([...rows24hByRegime.keys(), ...rows7dByRegime.keys()])];

  return regimes
    .map<TradabilityRegimeWindowComparisonRow>((regime) => {
      const window24h = rows24hByRegime.get(regime) || null;
      const window7d = rows7dByRegime.get(regime) || null;
      if (!window24h || !window7d) {
        return {
          regime,
          window24h,
          window7d,
          driftLabel: !window24h ? "24h insuffisant" : "7j insuffisant",
          driftTone: "subtle",
        };
      }
      const thinDelta = window24h.thinSharePct - window7d.thinSharePct;
      const degradedDelta = window24h.degradedSharePct - window7d.degradedSharePct;
      const driftTone: TradabilityRegimeWindowComparisonRow["driftTone"] = degradedDelta >= 15 || thinDelta >= 20
        ? "warn"
        : degradedDelta <= -15 || thinDelta <= -20
          ? "good"
          : "subtle";
      const driftLabel = driftTone === "warn"
        ? `derive +${Math.max(thinDelta, degradedDelta).toFixed(0)} pts`
        : driftTone === "good"
          ? `derive ${Math.min(thinDelta, degradedDelta).toFixed(0)} pts`
          : "derive stable";
      return {
        regime,
        window24h,
        window7d,
        driftLabel,
        driftTone,
      };
    })
    .sort((left, right) => {
      const leftCount = (left.window24h?.sampleCount || 0) + (left.window7d?.sampleCount || 0);
      const rightCount = (right.window24h?.sampleCount || 0) + (right.window7d?.sampleCount || 0);
      return rightCount - leftCount || left.regime.localeCompare(right.regime);
    });
}

export function buildTradabilityCalibrationProfile(input: {
  rows24h: TradabilityRegimeSummaryRow[];
  rows7d: TradabilityRegimeSummaryRow[];
  currentRegime?: string;
}): TradabilityCalibrationProfile {
  const currentRegime = String(input.currentRegime || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const row24h = input.rows24h.find((row) => row.regime === currentRegime) || input.rows24h[0] || null;
  const row7d = input.rows7d.find((row) => row.regime === currentRegime) || input.rows7d[0] || null;

  if (!row24h || !row7d || row24h.sampleCount < 4 || row7d.sampleCount < 4) {
    return {
      currentRegime,
      driftTone: "subtle",
      sampleCount24h: row24h?.sampleCount || 0,
      sampleCount7d: row7d?.sampleCount || 0,
      thinSharePct24h: row24h?.thinSharePct || 0,
      thinSharePct7d: row7d?.thinSharePct || 0,
      degradedSharePct24h: row24h?.degradedSharePct || 0,
      degradedSharePct7d: row7d?.degradedSharePct || 0,
      thinDeltaPct: 0,
      degradedDeltaPct: 0,
      thresholds: { ...BASE_CALIBRATION_THRESHOLDS },
      summaryLabel: `${currentRegime}: calibration de base, echantillon insuffisant pour recalibrer.`,
      sensitivity: {
        mode: "BASELINE",
        thresholds: { ...BASE_CALIBRATION_THRESHOLDS },
        summaryLabel: `${currentRegime}: calibration de sensibilite nominale, echantillon insuffisant.`,
      },
      impact: {
        mode: "BASELINE",
        edgeEligibilityWeight: BASE_IMPACT_WEIGHT,
        edgeEligibilityWeightPct: Math.round(BASE_IMPACT_WEIGHT * 100),
        summaryLabel: `${currentRegime}: poids information_density conserve au nominal, echantillon insuffisant.`,
      },
    };
  }

  const thinDeltaPct = row24h.thinSharePct - row7d.thinSharePct;
  const degradedDeltaPct = row24h.degradedSharePct - row7d.degradedSharePct;
  const strictnessSignal = clamp(
    (
      Math.max(0, degradedDeltaPct) * 0.75
      + Math.max(0, thinDeltaPct) * 0.35
      - Math.max(0, -degradedDeltaPct) * 0.55
      - Math.max(0, -thinDeltaPct) * 0.25
    ) / 100,
    -0.1,
    0.12,
  );
  const sensitivityMode: TradabilitySensitivityCalibration["mode"] = strictnessSignal >= 0.02
    ? "TIGHTEN"
    : strictnessSignal <= -0.02
      ? "RELAX"
      : "BASELINE";
  const driftTone: TradabilityCalibrationProfile["driftTone"] = sensitivityMode === "TIGHTEN"
    ? "warn"
    : sensitivityMode === "RELAX"
      ? "good"
      : "subtle";
  const thresholds: TradabilityCalibrationThresholds = {
    thinScoreFloor: clamp(BASE_CALIBRATION_THRESHOLDS.thinScoreFloor + strictnessSignal * 0.22, 0.44, 0.58),
    degradedScoreFloor: clamp(BASE_CALIBRATION_THRESHOLDS.degradedScoreFloor + strictnessSignal * 0.18, 0.22, 0.36),
    thinEntropyCeiling: clamp(BASE_CALIBRATION_THRESHOLDS.thinEntropyCeiling - strictnessSignal * 0.22, 0.48, 0.66),
    degradedEntropyCeiling: clamp(BASE_CALIBRATION_THRESHOLDS.degradedEntropyCeiling - strictnessSignal * 0.18, 0.6, 0.8),
  };
  const sensitivitySummaryLabel = sensitivityMode === "TIGHTEN"
    ? `${currentRegime}: derive recente adverse, seuils THIN/DEGRADED resserres.`
    : sensitivityMode === "RELAX"
      ? `${currentRegime}: derive recente en amelioration, seuils legerement relaches.`
      : `${currentRegime}: derive stable, seuils THIN/DEGRADED inchanges.`;
  const impactStabilitySignal = clamp(
    (Math.min(row24h.sampleCount, 24) / 24) * 0.55
      + (Math.min(row7d.sampleCount, 48) / 48) * 0.25
      + (1 - clamp((Math.abs(thinDeltaPct) + Math.abs(degradedDeltaPct)) / 120, 0, 1)) * 0.2,
    0,
    1,
  );
  const impactMode: TradabilityImpactCalibration["mode"] = impactStabilitySignal >= 0.72
    ? "BOOST"
    : impactStabilitySignal <= 0.45
      ? "REDUCE"
      : "BASELINE";
  const edgeEligibilityWeight = impactMode === "BOOST"
    ? clamp(BASE_IMPACT_WEIGHT + 0.04, 0.12, 0.26)
    : impactMode === "REDUCE"
      ? clamp(BASE_IMPACT_WEIGHT - 0.04, 0.12, 0.26)
      : BASE_IMPACT_WEIGHT;
  const impactSummaryLabel = impactMode === "BOOST"
    ? `${currentRegime}: impact information_density renforce dans edge eligibility.`
    : impactMode === "REDUCE"
      ? `${currentRegime}: impact information_density reduit tant que la derive reste instable.`
      : `${currentRegime}: impact information_density conserve au poids nominal.`;
  const summaryLabel = `${sensitivitySummaryLabel} ${impactSummaryLabel}`;

  return {
    currentRegime,
    driftTone,
    sampleCount24h: row24h.sampleCount,
    sampleCount7d: row7d.sampleCount,
    thinSharePct24h: row24h.thinSharePct,
    thinSharePct7d: row7d.thinSharePct,
    degradedSharePct24h: row24h.degradedSharePct,
    degradedSharePct7d: row7d.degradedSharePct,
    thinDeltaPct,
    degradedDeltaPct,
    thresholds,
    summaryLabel,
    sensitivity: {
      mode: sensitivityMode,
      thresholds,
      summaryLabel: sensitivitySummaryLabel,
    },
    impact: {
      mode: impactMode,
      edgeEligibilityWeight,
      edgeEligibilityWeightPct: Math.round(edgeEligibilityWeight * 100),
      summaryLabel: impactSummaryLabel,
    },
  };
}

export function buildTradabilityAnalyticsSummary(
  entries: Array<Record<string, unknown>>,
  options?: { currentRegime?: string },
): TradabilityAnalyticsSummary {
  const samples = parseTradabilityJournalSamples(entries);
  const rows24h = buildTradabilityRegimeSummaryRows(filterTradabilitySamplesWithinHours(samples, 24));
  const rows7d = buildTradabilityRegimeSummaryRows(filterTradabilitySamplesWithinHours(samples, 24 * 7));

  return {
    generatedAtIso: new Date().toISOString(),
    sampleCount: samples.length,
    windows: {
      last_24h: {
        sampleHours: 24,
        totalSamples: rows24h.reduce((sum, row) => sum + row.sampleCount, 0),
        rows: rows24h,
      },
      last_7d: {
        sampleHours: 168,
        totalSamples: rows7d.reduce((sum, row) => sum + row.sampleCount, 0),
        rows: rows7d,
      },
    },
    comparison: {
      rows: buildTradabilityWindowComparisonRows({ rows24h, rows7d }),
    },
    calibration: buildTradabilityCalibrationProfile({ rows24h, rows7d, currentRegime: options?.currentRegime }),
  };
}
