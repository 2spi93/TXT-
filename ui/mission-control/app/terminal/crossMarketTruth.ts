type JsonMap = Record<string, unknown>;

export type CrossMarketDirection = "UP" | "DOWN" | "FLAT" | "UNKNOWN";
export type CrossMarketRegime = "RISK_ON" | "RISK_OFF" | "MIXED" | "UNKNOWN";
export type CrossMarketTruthState = "CONFIRMED" | "WATCH" | "INCOHERENT" | "UNAVAILABLE";
export type CrossMarketBasketRole = "risk" | "hedge" | "neutral";

export type CrossMarketBasketSpec = {
  code: string;
  label: string;
  instrument: string;
  venue: string;
  timeframe: string;
  role: CrossMarketBasketRole;
};

export type CrossMarketBasketMember = CrossMarketBasketSpec & {
  available: boolean;
  direction: CrossMarketDirection;
  change_pct: number | null;
  freshness_pct: number;
  reason_tags: string[];
};

export type CrossMarketTruthSummary = {
  state: CrossMarketTruthState;
  score_pct: number;
  reasons: string[];
  summary_label: string;
  dominant_regime: CrossMarketRegime;
  metrics: {
    coverage_pct: number;
    freshness_pct: number;
    coherence_pct: number;
    pair_count: number;
  };
  basket: CrossMarketBasketMember[];
};

export const CROSS_MARKET_MINIMAL_BASKET: CrossMarketBasketSpec[] = [
  { code: "BTC", label: "Bitcoin", instrument: "BTCUSDT", venue: "binance-public", timeframe: "5m", role: "risk" },
  { code: "ETH", label: "Ethereum", instrument: "ETHUSDT", venue: "binance-public", timeframe: "5m", role: "risk" },
  { code: "GOLD", label: "Gold", instrument: "XAUUSD", venue: "mt5", timeframe: "5m", role: "neutral" },
  { code: "DXY", label: "Dollar Index", instrument: "DXY", venue: "mt5", timeframe: "5m", role: "hedge" },
  { code: "US100", label: "US100", instrument: "US100", venue: "mt5", timeframe: "5m", role: "risk" },
  { code: "SP500", label: "SP500", instrument: "SP500", venue: "mt5", timeframe: "5m", role: "risk" },
  { code: "VIX", label: "VIX", instrument: "VIX", venue: "mt5", timeframe: "5m", role: "hedge" },
  { code: "EURUSD", label: "EUR/USD", instrument: "EURUSD", venue: "mt5", timeframe: "5m", role: "risk" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return String(value || "").trim();
}

function asNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readClose(row: unknown): number | null {
  if (Array.isArray(row)) {
    const numeric = asNumber(row[4], Number.NaN);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const entry = asRecord(row);
  const numeric = asNumber(entry.c ?? entry.close ?? entry.last ?? entry.price, Number.NaN);
  return Number.isFinite(numeric) ? numeric : null;
}

function readFreshnessMs(snapshot: JsonMap): number | null {
  const meta = asRecord(snapshot.meta);
  const health = asRecord(meta.health);
  const components = asRecord(health.components);
  const ohlcv = asRecord(components.ohlcv);
  const trades = asRecord(components.trades);
  const depth = asRecord(components.depth);
  for (const candidate of [ohlcv.freshness_ms, trades.freshness_ms, depth.freshness_ms]) {
    const numeric = asNumber(candidate, Number.NaN);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }
  }
  return null;
}

function freshnessPctFromMs(value: number | null): number {
  if (value === null) {
    return 0;
  }
  if (value <= 90_000) {
    return 100;
  }
  if (value <= 300_000) {
    return 82;
  }
  if (value <= 900_000) {
    return 58;
  }
  if (value <= 1_800_000) {
    return 34;
  }
  return 12;
}

function directionFromChangePct(changePct: number | null): CrossMarketDirection {
  if (changePct === null || !Number.isFinite(changePct)) {
    return "UNKNOWN";
  }
  if (changePct >= 0.15) {
    return "UP";
  }
  if (changePct <= -0.15) {
    return "DOWN";
  }
  return "FLAT";
}

function basketMemberFromSnapshot(spec: CrossMarketBasketSpec, snapshot: unknown): CrossMarketBasketMember {
  const payload = asRecord(snapshot);
  const rows = asArray(payload.ohlcv_rows);
  const closeSeries = rows
    .map((row) => readClose(row))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const firstClose = closeSeries.length > 1 ? closeSeries[0] : null;
  const lastClose = closeSeries.length > 1 ? closeSeries[closeSeries.length - 1] : null;
  const changePct = firstClose && lastClose && firstClose > 0
    ? Number((((lastClose - firstClose) / firstClose) * 100).toFixed(3))
    : null;
  const freshnessPct = freshnessPctFromMs(readFreshnessMs(payload));
  const health = asRecord(asRecord(payload.meta).health);
  const status = asString(health.status).toLowerCase();
  const available = closeSeries.length >= 2;
  const reasonTags: string[] = [];

  if (!available) {
    reasonTags.push("snapshot_missing");
  }
  if (freshnessPct < 55) {
    reasonTags.push("freshness_degraded");
  }
  if (status && status !== "ok") {
    reasonTags.push(`health_${status}`);
  }

  return {
    ...spec,
    available,
    direction: available ? directionFromChangePct(changePct) : "UNKNOWN",
    change_pct: changePct,
    freshness_pct: freshnessPct,
    reason_tags: reasonTags,
  };
}

function isCoherentSame(left: CrossMarketBasketMember | undefined, right: CrossMarketBasketMember | undefined): boolean | null {
  if (!left || !right || !left.available || !right.available) {
    return null;
  }
  if (left.direction === "UNKNOWN" || right.direction === "UNKNOWN" || left.direction === "FLAT" || right.direction === "FLAT") {
    return null;
  }
  return left.direction === right.direction;
}

function isCoherentInverse(left: CrossMarketBasketMember | undefined, right: CrossMarketBasketMember | undefined): boolean | null {
  if (!left || !right || !left.available || !right.available) {
    return null;
  }
  if (left.direction === "UNKNOWN" || right.direction === "UNKNOWN" || left.direction === "FLAT" || right.direction === "FLAT") {
    return null;
  }
  return left.direction !== right.direction;
}

function dominantRegimeFromBasket(basket: CrossMarketBasketMember[]): CrossMarketRegime {
  const signals = basket.filter((member) => member.available && member.direction !== "UNKNOWN" && member.direction !== "FLAT");
  if (signals.length < 4) {
    return "UNKNOWN";
  }
  let riskOnVotes = 0;
  let riskOffVotes = 0;
  for (const member of signals) {
    if (member.role === "risk") {
      if (member.direction === "UP") {
        riskOnVotes += 1;
      } else if (member.direction === "DOWN") {
        riskOffVotes += 1;
      }
    } else if (member.role === "hedge") {
      if (member.direction === "DOWN") {
        riskOnVotes += 1;
      } else if (member.direction === "UP") {
        riskOffVotes += 1;
      }
    }
  }
  const totalVotes = riskOnVotes + riskOffVotes;
  if (totalVotes < 4) {
    return "UNKNOWN";
  }
  if (riskOnVotes / totalVotes >= 0.66) {
    return "RISK_ON";
  }
  if (riskOffVotes / totalVotes >= 0.66) {
    return "RISK_OFF";
  }
  return "MIXED";
}

export function buildCrossMarketTruthSummary(inputs: Array<{ spec: CrossMarketBasketSpec; snapshot: unknown }>): CrossMarketTruthSummary {
  const basket = inputs.map(({ spec, snapshot }) => basketMemberFromSnapshot(spec, snapshot));
  const basketByCode = new Map(basket.map((member) => [member.code, member]));
  const availableCount = basket.filter((member) => member.available).length;
  const coveragePct = Math.round((availableCount / Math.max(1, basket.length)) * 100);
  const freshnessPct = Math.round(
    basket.reduce((sum, member) => sum + member.freshness_pct, 0) / Math.max(1, basket.length),
  );
  const pairChecks: boolean[] = [];

  for (const [leftCode, rightCode] of [["BTC", "ETH"], ["US100", "SP500"]] as const) {
    const result = isCoherentSame(basketByCode.get(leftCode), basketByCode.get(rightCode));
    if (result !== null) {
      pairChecks.push(result);
    }
  }
  for (const [leftCode, rightCode] of [
    ["DXY", "EURUSD"],
    ["DXY", "BTC"],
    ["DXY", "ETH"],
    ["DXY", "US100"],
    ["DXY", "SP500"],
    ["VIX", "BTC"],
    ["VIX", "ETH"],
    ["VIX", "US100"],
    ["VIX", "SP500"],
  ] as const) {
    const result = isCoherentInverse(basketByCode.get(leftCode), basketByCode.get(rightCode));
    if (result !== null) {
      pairChecks.push(result);
    }
  }

  const coherencePct = pairChecks.length > 0
    ? Math.round((pairChecks.filter(Boolean).length / pairChecks.length) * 100)
    : availableCount >= 4
      ? 60
      : 50;
  const scorePct = Math.round(clamp(coherencePct * 0.55 + freshnessPct * 0.25 + coveragePct * 0.2, 0, 100));
  const dominantRegime = dominantRegimeFromBasket(basket);

  let state: CrossMarketTruthState = "UNAVAILABLE";
  if (availableCount >= 4 && pairChecks.length >= 2) {
    state = coherencePct >= 72 && freshnessPct >= 58
      ? "CONFIRMED"
      : coherencePct >= 50 && freshnessPct >= 42
        ? "WATCH"
        : "INCOHERENT";
  }

  const reasons: string[] = [];
  if (coveragePct < 55) {
    reasons.push("cross_market_coverage_thin");
  }
  if (pairChecks.length < 2) {
    reasons.push("cross_market_pairs_thin");
  }
  if (freshnessPct < 55) {
    reasons.push("cross_market_stale");
  }
  if (state === "INCOHERENT") {
    reasons.push("cross_market_incoherent");
  }
  if (dominantRegime === "UNKNOWN" && state !== "UNAVAILABLE") {
    reasons.push("cross_market_regime_unclear");
  }

  return {
    state,
    score_pct: scorePct,
    reasons,
    summary_label: `${state} · ${dominantRegime} · ${scorePct}%`,
    dominant_regime: dominantRegime,
    metrics: {
      coverage_pct: coveragePct,
      freshness_pct: freshnessPct,
      coherence_pct: coherencePct,
      pair_count: pairChecks.length,
    },
    basket,
  };
}

export function coerceCrossMarketTruthSummary(value: unknown): CrossMarketTruthSummary | null {
  const record = asRecord(value);
  const state = asString(record.state).toUpperCase();
  if (!state) {
    return null;
  }
  const metrics = asRecord(record.metrics);
  const basket = asArray(record.basket)
    .map((item) => asRecord(item))
    .filter((item) => Object.keys(item).length > 0)
    .map((item) => ({
      code: asString(item.code),
      label: asString(item.label),
      instrument: asString(item.instrument),
      venue: asString(item.venue),
      timeframe: asString(item.timeframe) || "5m",
      role: (asString(item.role) || "neutral") as CrossMarketBasketRole,
      available: Boolean(item.available),
      direction: (asString(item.direction) || "UNKNOWN") as CrossMarketDirection,
      change_pct: Number.isFinite(asNumber(item.change_pct, Number.NaN)) ? asNumber(item.change_pct, 0) : null,
      freshness_pct: asNumber(item.freshness_pct, 0),
      reason_tags: asArray(item.reason_tags).map((entry) => asString(entry)).filter(Boolean),
    }));
  return {
    state: state as CrossMarketTruthState,
    score_pct: asNumber(record.score_pct, 0),
    reasons: asArray(record.reasons).map((entry) => asString(entry)).filter(Boolean),
    summary_label: asString(record.summary_label),
    dominant_regime: (asString(record.dominant_regime) || "UNKNOWN") as CrossMarketRegime,
    metrics: {
      coverage_pct: asNumber(metrics.coverage_pct, 0),
      freshness_pct: asNumber(metrics.freshness_pct, 0),
      coherence_pct: asNumber(metrics.coherence_pct, 0),
      pair_count: asNumber(metrics.pair_count, 0),
    },
    basket,
  };
}