import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export type EdgeEvidenceState = "NO_REPLICATED_CELLS" | "EXPLORATORY" | "EMERGING" | "EVIDENCED" | "STRUCTURAL" | "UNAVAILABLE";

export type RuntimeEdgeEvidenceCell = {
  cell: string;
  maturityStatus: string;
  eventCount: number;
  sampleCount: number;
  meanPnlBps: number | null;
  medianPnlBps: number | null;
  stdevPnlBps: number | null;
  positiveRate: number | null;
  lastObservation: string | null;
  dominantVenue: string | null;
};

export type RuntimeEdgeEvidenceState = {
  available: boolean;
  state: EdgeEvidenceState;
  summary: string;
  filePath: string;
  fileUpdatedAt: string | null;
  matureThresholdEvents: number;
  cellCount: number;
  replicatedCells: number;
  matureCells: number;
  outcomesWithBoth: number;
  maxCellEventCount: number;
  topCells: RuntimeEdgeEvidenceCell[];
};

function edgeMaturityPath(): string {
  return process.env.MC_EDGE_MATURITY_FILE
    || path.resolve(process.cwd(), "../../logs/reaction_regime_cell_maturity.json");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toNullableNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toStringOrNull(value: unknown): string | null {
  const text = String(value || "").trim();
  return text ? text : null;
}

function unavailable(filePath: string, summary: string): RuntimeEdgeEvidenceState {
  return {
    available: false,
    state: "UNAVAILABLE",
    summary,
    filePath,
    fileUpdatedAt: null,
    matureThresholdEvents: 3,
    cellCount: 0,
    replicatedCells: 0,
    matureCells: 0,
    outcomesWithBoth: 0,
    maxCellEventCount: 0,
    topCells: [],
  };
}

export async function getRuntimeEdgeEvidenceState(): Promise<RuntimeEdgeEvidenceState> {
  const filePath = edgeMaturityPath();
  try {
    const [metadata, raw] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
    const payload = asRecord(JSON.parse(raw));
    const evidence = asRecord(payload.edge_evidence);
    const diagnostics = asRecord(payload.diagnostics);
    const params = asRecord(payload.params);
    const state = String(evidence.state || diagnostics.edge_evidence_state || "UNAVAILABLE") as EdgeEvidenceState;
    const cells = asArray(payload.cells).slice(0, 8).map((cellRaw) => {
      const cell = asRecord(cellRaw);
      return {
        cell: String(cell.cell || "UNKNOWN"),
        maturityStatus: String(cell.maturity_status || "OBSERVATION"),
        eventCount: toNumber(cell.event_count, 0),
        sampleCount: toNumber(cell.sample_count, 0),
        meanPnlBps: toNullableNumber(cell.mean_pnl_bps),
        medianPnlBps: toNullableNumber(cell.median_pnl_bps),
        stdevPnlBps: toNullableNumber(cell.stdev_pnl_bps),
        positiveRate: toNullableNumber(cell.positive_rate),
        lastObservation: toStringOrNull(cell.last_observation),
        dominantVenue: toStringOrNull(cell.dominant_venue),
      } satisfies RuntimeEdgeEvidenceCell;
    });
    return {
      available: true,
      state,
      summary: String(evidence.summary || "Edge evidence maturity snapshot available."),
      filePath,
      fileUpdatedAt: new Date(metadata.mtimeMs).toISOString(),
      matureThresholdEvents: toNumber(evidence.mature_threshold_events || params.mature_threshold_events, 3),
      cellCount: toNumber(diagnostics.cell_count, cells.length),
      replicatedCells: toNumber(evidence.replicated_cells || diagnostics.replicated_cells, 0),
      matureCells: toNumber(evidence.mature_cells || diagnostics.mature_cells, 0),
      outcomesWithBoth: toNumber(diagnostics.outcomes_with_both, 0),
      maxCellEventCount: toNumber(evidence.max_cell_event_count, 0),
      topCells: cells,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return unavailable(filePath, code === "ENOENT" ? "Edge evidence maturity snapshot is not available yet." : "Edge evidence maturity snapshot could not be read.");
  }
}