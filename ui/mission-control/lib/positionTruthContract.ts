type JsonMap = Record<string, unknown>;

export type PositionTruthSchemaVersion = "position-truth/v1";

export const POSITION_TRUTH_SCHEMA_VERSION: PositionTruthSchemaVersion = "position-truth/v1";

export type PositionTruthSnapshot = {
  schema_version: PositionTruthSchemaVersion;
  status: string;
  as_of: string;
  account: JsonMap;
  mt5_account: JsonMap;
  connector_account: JsonMap;
  balances: JsonMap[];
  positions: JsonMap[];
  open_orders: JsonMap[];
  portfolio_links: JsonMap[];
  latest_portfolio_snapshots: JsonMap[];
  normalized_state: JsonMap;
  cash_vs_equivalent: JsonMap;
  capital_truth: JsonMap | null;
  broker_state_snapshot: JsonMap;
  pocket_views: JsonMap[];
  capital_ledger: JsonMap[];
};

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : {};
}

function asRecordArray(value: unknown): JsonMap[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as JsonMap[]
    : [];
}

export function assertPositionTruthSnapshot(snapshot: PositionTruthSnapshot): PositionTruthSnapshot {
  if (snapshot.schema_version !== POSITION_TRUTH_SCHEMA_VERSION) {
    throw new Error(`PositionTruth schema mismatch: ${String(snapshot.schema_version || "missing")}`);
  }
  if (!String(snapshot.status || "").trim()) {
    throw new Error("PositionTruth status missing");
  }
  if (!Number.isFinite(Date.parse(String(snapshot.as_of || "")))) {
    throw new Error("PositionTruth as_of invalid");
  }
  if (!Array.isArray(snapshot.balances) || !Array.isArray(snapshot.positions)) {
    throw new Error("PositionTruth balances or positions invalid");
  }
  return snapshot;
}

export function projectPositionTruthSnapshot(raw: unknown): PositionTruthSnapshot {
  const payload = asRecord(raw);
  const normalizedState = asRecord(payload.normalized_state);
  const cashVsEquivalent = asRecord(payload.cash_vs_equivalent);
  const capitalTruth = payload.capital_truth && typeof payload.capital_truth === "object" && !Array.isArray(payload.capital_truth)
    ? payload.capital_truth as JsonMap
    : null;
  const snapshot: PositionTruthSnapshot = {
    schema_version: POSITION_TRUTH_SCHEMA_VERSION,
    status: String(payload.status || normalizedState.status || "unknown").trim() || "unknown",
    as_of: String(payload.as_of || normalizedState.as_of || "").trim(),
    account: asRecord(payload.account),
    mt5_account: asRecord(payload.mt5_account),
    connector_account: asRecord(payload.connector_account),
    balances: asRecordArray(payload.balances),
    positions: asRecordArray(payload.positions),
    open_orders: asRecordArray(payload.open_orders),
    portfolio_links: asRecordArray(payload.portfolio_links),
    latest_portfolio_snapshots: asRecordArray(payload.latest_portfolio_snapshots),
    normalized_state: normalizedState,
    cash_vs_equivalent: cashVsEquivalent,
    capital_truth: capitalTruth,
    broker_state_snapshot: asRecord(payload.broker_state_snapshot),
    pocket_views: asRecordArray(payload.pocket_views),
    capital_ledger: asRecordArray(payload.capital_ledger),
  };
  return assertPositionTruthSnapshot(snapshot);
}