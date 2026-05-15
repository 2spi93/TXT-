import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export type EdgeConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

export type EdgeObservationRow = {
  intentId: string;
  venue: string;
  instrument: string;
  tsIntent: string;
  side: string;
  pnlBps: number;
  outcome: string;
  reactionClass: string | null;
  regime: string | null;
  regimeConfidence: number | null;
};

export type EdgeMapRow = {
  edgeKey: string;
  reactionClass: string;
  regime: string;
  count: number;
  winrate: number;
  meanPnlBps: number;
  medianPnlBps: number;
  stdevPnlBps: number;
  avgRegimeConfidence: number | null;
  confidenceScorePct: number;
  confidenceLevel: EdgeConfidenceLevel;
};

export type EdgeDeltaRow = EdgeMapRow & {
  countPrev24h: number;
  deltaCount: number;
  winratePrev24h: number;
  deltaWinratePct: number;
  meanPnlPrev24h: number;
  deltaMeanPnlBps: number;
};

export type EdgeObservationSummary = {
  available: boolean;
  filePath: string;
  fileUpdatedAt: string | null;
  latestIntentAt: string | null;
  latestClassifiedIntentAt: string | null;
  staleness: {
    ageHours: number | null;
    level: "FRESH" | "AGING" | "STALE" | "NO_CLASSIFIED_LABEL";
    summary: string;
  };
  windowHours: number;
  totals: {
    totalRows: number;
    classifiedRows: number;
    unclassifiedRows: number;
    recentRows: number;
    recentClassifiedRows: number;
    previousRows: number;
    previousClassifiedRows: number;
    classifiedPct: number;
    recentClassifiedPct: number;
  };
  labelProgress: {
    targetMin: number;
    targetMax: number;
    classifiedCount: number;
    recentClassifiedCount: number;
    toTargetMin: number;
    toTargetMax: number;
    progressToMinPct: number;
    progressToMaxPct: number;
    stage: "BOOTSTRAP" | "BUILDING" | "READY_MIN" | "READY_MAX";
    summary: string;
  };
  liveConfidence: {
    scorePct: number;
    level: EdgeConfidenceLevel;
    summary: string;
  };
  recentDeltas: EdgeDeltaRow[];
  allTimeMap: EdgeMapRow[];
};

type EdgeObservationCache = {
  filePath: string;
  mtimeMs: number;
  size: number;
  rows: EdgeObservationRow[];
};

let edgeObservationCache: EdgeObservationCache | null = null;

const EDGE_LABEL_TARGET_MIN = 50;
const EDGE_LABEL_TARGET_MAX = 100;

function edgeObservationPath(): string {
  return process.env.MC_EDGE_MAP_FILE
    || path.resolve(process.cwd(), "../../logs/edge_map_engine.jsonl");
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentileMedian(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function stdev(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function toIsoOrNull(value: unknown): string | null {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeRow(raw: unknown): EdgeObservationRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const payload = raw as Record<string, unknown>;
  const tsIntent = toIsoOrNull(payload.ts_intent);
  if (!tsIntent) {
    return null;
  }
  return {
    intentId: String(payload.intent_id || "").trim(),
    venue: String(payload.venue || "").trim(),
    instrument: String(payload.instrument || "").trim(),
    tsIntent,
    side: String(payload.side || "").trim(),
    pnlBps: Number(payload.pnl_bps || 0),
    outcome: String(payload.outcome || "unknown").trim(),
    reactionClass: typeof payload.reaction_class === "string" && payload.reaction_class.trim().length > 0
      ? payload.reaction_class.trim().toUpperCase()
      : null,
    regime: typeof payload.regime === "string" && payload.regime.trim().length > 0
      ? payload.regime.trim().toUpperCase()
      : null,
    regimeConfidence: Number.isFinite(Number(payload.regime_confidence)) ? Number(payload.regime_confidence) : null,
  };
}

export async function readEdgeObservationRows(): Promise<EdgeObservationRow[]> {
  const target = edgeObservationPath();
  try {
    const metadata = await stat(target);
    if (
      edgeObservationCache
      && edgeObservationCache.filePath === target
      && edgeObservationCache.mtimeMs === metadata.mtimeMs
      && edgeObservationCache.size === metadata.size
    ) {
      return edgeObservationCache.rows;
    }

    const raw = await readFile(target, "utf8");
    const rows = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return normalizeRow(JSON.parse(line) as unknown);
        } catch {
          return null;
        }
      })
      .filter((row): row is EdgeObservationRow => row !== null);

    edgeObservationCache = {
      filePath: target,
      mtimeMs: metadata.mtimeMs,
      size: metadata.size,
      rows,
    };
    return rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      edgeObservationCache = null;
      return [];
    }
    throw error;
  }
}

function isClassified(row: EdgeObservationRow): boolean {
  return Boolean(row.reactionClass) && Boolean(row.regime);
}

function confidenceFromStats(count: number, avgRegimeConfidence: number | null, pnlStdev: number, classified: boolean): { scorePct: number; level: EdgeConfidenceLevel } {
  const sampleScore = clamp(count / 12, 0, 1);
  const regimeScore = clamp(avgRegimeConfidence ?? 0, 0, 1);
  const stabilityScore = clamp(1 - (pnlStdev / 80), 0, 1);
  const classifiedScore = classified ? 1 : 0;
  const scorePct = Math.round((sampleScore * 0.5 + regimeScore * 0.25 + stabilityScore * 0.15 + classifiedScore * 0.1) * 100);
  const level: EdgeConfidenceLevel = scorePct >= 75 ? "HIGH" : scorePct >= 50 ? "MEDIUM" : "LOW";
  return { scorePct, level };
}

function aggregateRows(rows: EdgeObservationRow[]): EdgeMapRow[] {
  const buckets = new Map<string, EdgeObservationRow[]>();
  for (const row of rows) {
    if (!isClassified(row)) {
      continue;
    }
    const reactionClass = row.reactionClass || "UNKNOWN";
    const regime = row.regime || "UNKNOWN";
    const edgeKey = `${reactionClass} + ${regime}`;
    const current = buckets.get(edgeKey) || [];
    current.push(row);
    buckets.set(edgeKey, current);
  }

  return [...buckets.entries()]
    .map(([edgeKey, bucketRows]) => {
      const pnl = bucketRows.map((row) => row.pnlBps).filter((value) => Number.isFinite(value));
      const wins = pnl.filter((value) => value > 0).length;
      const mean = pnl.length > 0 ? pnl.reduce((sum, value) => sum + value, 0) / pnl.length : 0;
      const median = percentileMedian(pnl);
      const sigma = stdev(pnl);
      const regimeConfidenceValues = bucketRows
        .map((row) => row.regimeConfidence)
        .filter((value): value is number => value !== null && Number.isFinite(value));
      const avgRegimeConfidence = regimeConfidenceValues.length > 0
        ? regimeConfidenceValues.reduce((sum, value) => sum + value, 0) / regimeConfidenceValues.length
        : null;
      const [reactionClass, regime] = edgeKey.split(" + ");
      const confidence = confidenceFromStats(bucketRows.length, avgRegimeConfidence, sigma, true);
      return {
        edgeKey,
        reactionClass,
        regime,
        count: bucketRows.length,
        winrate: round(bucketRows.length > 0 ? wins / bucketRows.length : 0, 4),
        meanPnlBps: round(mean, 4),
        medianPnlBps: round(median, 4),
        stdevPnlBps: round(sigma, 4),
        avgRegimeConfidence: avgRegimeConfidence == null ? null : round(avgRegimeConfidence, 4),
        confidenceScorePct: confidence.scorePct,
        confidenceLevel: confidence.level,
      } satisfies EdgeMapRow;
    })
    .sort((left, right) => right.confidenceScorePct - left.confidenceScorePct || right.meanPnlBps - left.meanPnlBps || right.count - left.count);
}

export async function getEdgeObservationSummary(windowHours = 24): Promise<EdgeObservationSummary> {
  const rows = await readEdgeObservationRows();
  const targetPath = edgeObservationPath();
  let fileUpdatedAt: string | null = null;
  try {
    const metadata = await stat(targetPath);
    fileUpdatedAt = new Date(metadata.mtimeMs).toISOString();
  } catch {
    fileUpdatedAt = null;
  }

  const nowMs = Date.now();
  const windowMs = windowHours * 60 * 60 * 1000;
  const currentCutoff = nowMs - windowMs;
  const previousCutoff = nowMs - (windowMs * 2);
  const latestIntentAt = rows.reduce<string | null>((latest, row) => {
    if (!latest) {
      return row.tsIntent;
    }
    return Date.parse(row.tsIntent) > Date.parse(latest) ? row.tsIntent : latest;
  }, null);

  const recentRows = rows.filter((row) => Date.parse(row.tsIntent) >= currentCutoff);
  const previousRows = rows.filter((row) => {
    const ts = Date.parse(row.tsIntent);
    return ts >= previousCutoff && ts < currentCutoff;
  });
  const classifiedRows = rows.filter(isClassified);
  const latestClassifiedIntentAt = classifiedRows.reduce<string | null>((latest, row) => {
    if (!latest) {
      return row.tsIntent;
    }
    return Date.parse(row.tsIntent) > Date.parse(latest) ? row.tsIntent : latest;
  }, null);
  const recentClassifiedRows = recentRows.filter(isClassified);
  const previousClassifiedRows = previousRows.filter(isClassified);

  const recentMap = aggregateRows(recentClassifiedRows);
  const previousMap = new Map(aggregateRows(previousClassifiedRows).map((row) => [row.edgeKey, row]));
  const recentDeltas: EdgeDeltaRow[] = recentMap.map((row) => {
    const previous = previousMap.get(row.edgeKey);
    return {
      ...row,
      countPrev24h: previous?.count || 0,
      deltaCount: row.count - (previous?.count || 0),
      winratePrev24h: previous?.winrate || 0,
      deltaWinratePct: round((row.winrate - (previous?.winrate || 0)) * 100, 2),
      meanPnlPrev24h: previous?.meanPnlBps || 0,
      deltaMeanPnlBps: round(row.meanPnlBps - (previous?.meanPnlBps || 0), 4),
    } satisfies EdgeDeltaRow;
  }).sort((left, right) => right.confidenceScorePct - left.confidenceScorePct || right.meanPnlBps - left.meanPnlBps);

  const recentCoveragePct = recentRows.length > 0 ? (recentClassifiedRows.length / recentRows.length) * 100 : 0;
  const classifiedCount = classifiedRows.length;
  const toTargetMin = Math.max(0, EDGE_LABEL_TARGET_MIN - classifiedCount);
  const toTargetMax = Math.max(0, EDGE_LABEL_TARGET_MAX - classifiedCount);
  const progressToMinPct = round(clamp(classifiedCount / EDGE_LABEL_TARGET_MIN, 0, 1) * 100, 2);
  const progressToMaxPct = round(clamp(classifiedCount / EDGE_LABEL_TARGET_MAX, 0, 1) * 100, 2);
  const labelStage = classifiedCount >= EDGE_LABEL_TARGET_MAX
    ? "READY_MAX"
    : classifiedCount >= EDGE_LABEL_TARGET_MIN
      ? "READY_MIN"
      : classifiedCount >= 10
        ? "BUILDING"
        : "BOOTSTRAP";
  const labelProgressSummary = labelStage === "READY_MAX"
    ? `${classifiedCount} labels classes. La fenetre 50-100 est couverte pour l'edge map.`
    : labelStage === "READY_MIN"
      ? `${classifiedCount} labels classes. Seuil minimum atteint, continuer jusqu'a ${EDGE_LABEL_TARGET_MAX} pour densifier.`
      : `${classifiedCount} labels classes. Encore ${toTargetMin} pour atteindre ${EDGE_LABEL_TARGET_MIN} et ${toTargetMax} pour ${EDGE_LABEL_TARGET_MAX}.`;
  const confidenceBase = confidenceFromStats(
    recentClassifiedRows.length,
    recentClassifiedRows.length > 0
      ? recentClassifiedRows.reduce((sum, row) => sum + (row.regimeConfidence || 0), 0) / recentClassifiedRows.length
      : 0,
    stdev(recentClassifiedRows.map((row) => row.pnlBps)),
    recentClassifiedRows.length > 0,
  );
  const liveSummary = recentClassifiedRows.length === 0
    ? "Aucune observation edge classee sur les 24 dernieres heures. La carte reste en attente de labels frais alignes."
    : `${recentClassifiedRows.length} labels classes sur ${recentRows.length} lignes recentes, couverture ${round(recentCoveragePct, 1)}%.`;
  const stalenessAgeHours = latestClassifiedIntentAt
    ? round((nowMs - Date.parse(latestClassifiedIntentAt)) / (60 * 60 * 1000), 2)
    : null;
  const stalenessLevel = latestClassifiedIntentAt == null
    ? "NO_CLASSIFIED_LABEL"
    : stalenessAgeHours != null && stalenessAgeHours <= 12
      ? "FRESH"
      : stalenessAgeHours != null && stalenessAgeHours <= 48
        ? "AGING"
        : "STALE";
  const stalenessSummary = latestClassifiedIntentAt == null
    ? "Aucun label classe ne recouvre encore reaction et regime."
    : `${stalenessAgeHours}h depuis le dernier label classe.`;

  return {
    available: rows.length > 0,
    filePath: targetPath,
    fileUpdatedAt,
    latestIntentAt,
    latestClassifiedIntentAt,
    staleness: {
      ageHours: stalenessAgeHours,
      level: stalenessLevel,
      summary: stalenessSummary,
    },
    windowHours,
    totals: {
      totalRows: rows.length,
      classifiedRows: classifiedRows.length,
      unclassifiedRows: rows.length - classifiedRows.length,
      recentRows: recentRows.length,
      recentClassifiedRows: recentClassifiedRows.length,
      previousRows: previousRows.length,
      previousClassifiedRows: previousClassifiedRows.length,
      classifiedPct: round(rows.length > 0 ? (classifiedRows.length / rows.length) * 100 : 0, 2),
      recentClassifiedPct: round(recentCoveragePct, 2),
    },
    labelProgress: {
      targetMin: EDGE_LABEL_TARGET_MIN,
      targetMax: EDGE_LABEL_TARGET_MAX,
      classifiedCount,
      recentClassifiedCount: recentClassifiedRows.length,
      toTargetMin,
      toTargetMax,
      progressToMinPct,
      progressToMaxPct,
      stage: labelStage,
      summary: labelProgressSummary,
    },
    liveConfidence: {
      scorePct: confidenceBase.scorePct,
      level: confidenceBase.level,
      summary: liveSummary,
    },
    recentDeltas,
    allTimeMap: aggregateRows(classifiedRows),
  };
}