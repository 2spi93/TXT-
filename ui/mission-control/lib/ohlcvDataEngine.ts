/**
 * OHLCV Data Engine V2 — Niveau Hedge Fund
 *
 * Pipeline canonique :
 *   RAW → alignToTimeSlot → normalizeBar → buildTimeSeries (gap fill) → sequencer
 *   + applyTickToLastBar : injection de tick live sans polling
 *
 * Objectif : timestamps alignés, séries continues, bougie live fluide.
 */

import type { NormalizedOhlcvBar } from "./ohlcvIntegrity";

// ── Timeframe → ms ────────────────────────────────────────────────────────────

const TF_MS: Record<string, number> = {
  "1s":   1_000,
  "1m":  60_000,
  "3m":  60_000 * 3,
  "5m":  60_000 * 5,
  "15m": 60_000 * 15,
  "30m": 60_000 * 30,
  "1h":  60_000 * 60,
  "2h":  60_000 * 120,
  "4h":  60_000 * 240,
  "6h":  60_000 * 360,
  "8h":  60_000 * 480,
  "12h": 60_000 * 720,
  "1d":  60_000 * 1440,
  "3d":  60_000 * 4320,
  "1w":  60_000 * 10080,
  // aliases fréquents
  "60m": 60_000 * 60,
  "240m": 60_000 * 240,
  "D":   60_000 * 1440,
  "W":   60_000 * 10080,
};

export function timeframeToMs(timeframe: string): number {
  const raw = String(timeframe || "").trim().toLowerCase();
  if (TF_MS[raw]) return TF_MS[raw];
  // pattern numérique : "45m", "2h", etc.
  const match = raw.match(/^(\d+)([smhdw])$/);
  if (!match) return 60_000;
  const amount = Math.max(1, Number(match[1]));
  const unit = match[2];
  const unitMs =
    unit === "s" ? 1_000 :
    unit === "m" ? 60_000 :
    unit === "h" ? 3_600_000 :
    unit === "d" ? 86_400_000 :
    604_800_000;
  return amount * unitMs;
}

// ── Slot alignment ────────────────────────────────────────────────────────────

/**
 * Aligne un timestamp (ms) sur la borne inférieure du slot TF.
 * Ex: t=14:03:37, tf=5m → 14:00:00
 */
export function alignToTimeSlot(tsMs: number, slotMs: number): number {
  return Math.floor(tsMs / slotMs) * slotMs;
}

/**
 * Aligne un timestamp ISO sur la borne inférieure du slot TF.
 */
export function alignIsoToSlot(iso: string, tf: string): string {
  const tsMs = Date.parse(iso);
  if (!Number.isFinite(tsMs)) return iso;
  const slotMs = timeframeToMs(tf);
  if (slotMs <= 0) return iso;
  return new Date(alignToTimeSlot(tsMs, slotMs)).toISOString();
}

// ── Time Series Engine ────────────────────────────────────────────────────────

const MAX_GAP_FILL = 200;

/**
 * Reconstruit une série temporelle continue :
 * - Aligne tous les timestamps sur les slots TF
 * - Trie par temps
 * - Déduplique (garde la dernière entrée par slot)
 * - Remplit les trous (gap fill)
 * - Ré-attribue les seq monotones
 */
export function buildTimeSeries(
  bars: NormalizedOhlcvBar[],
  tf: string,
): NormalizedOhlcvBar[] {
  if (bars.length === 0) return [];

  const slotMs = timeframeToMs(tf);

  // Étape 1 : aligner + dédupliquer par slot
  const slotMap = new Map<number, NormalizedOhlcvBar>();
  for (const bar of bars) {
    const tsMs = Date.parse(bar.t);
    if (!Number.isFinite(tsMs)) continue;
    const slot = alignToTimeSlot(tsMs, slotMs);
    const existing = slotMap.get(slot);
    // Si plusieurs barres tombent dans le même slot : garde la dernière reçue
    if (!existing || Date.parse(bar.t) >= Date.parse(existing.t)) {
      slotMap.set(slot, { ...bar, t: new Date(slot).toISOString() });
    }
  }

  // Étape 2 : trier par slot
  const sorted = [...slotMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, bar]) => bar);

  if (sorted.length === 0) return [];

  // Étape 3 : gap fill entre les slots existants
  const filled: NormalizedOhlcvBar[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = filled[filled.length - 1];
    const next = sorted[i];
    const prevSlot = Date.parse(prev.t);
    const nextSlot = Date.parse(next.t);
    const gapBars = Math.round((nextSlot - prevSlot) / slotMs) - 1;

    if (gapBars > 0 && gapBars <= MAX_GAP_FILL) {
      for (let gap = 1; gap <= gapBars; gap++) {
        const slot = prevSlot + gap * slotMs;
        const safeClose = prev.c > 0 ? prev.c : prev.o;
        filled.push({
          t: new Date(slot).toISOString(),
          o: safeClose,
          h: safeClose,
          l: safeClose,
          c: safeClose,
          v: 0,
          tf: tf || prev.tf,
          seq: 0,
          venue: prev.venue,
          instrument: prev.instrument,
          source: "data-engine-gap-fill",
        });
      }
    }
    filled.push(next);
  }

  // Étape 4 : séquence monotone
  return filled.map((bar, index) => ({ ...bar, seq: index + 1 }));
}

// ── Tick Live Injection ───────────────────────────────────────────────────────

/**
 * Applique un tick prix à la dernière bougie (ou crée une nouvelle bougie).
 *
 * RÈGLES :
 * - Si le tick appartient au slot de la dernière bougie → update c/h/l
 * - Si le tick est dans un slot plus récent → nouveau bar synthétique
 * - Si le prix est identique à c courant → retourne le même tableau (stable ref)
 */
export function applyTickToLastBar(
  bars: NormalizedOhlcvBar[],
  price: number,
  tsIso: string,
  tf: string,
): NormalizedOhlcvBar[] {
  if (bars.length === 0 || !Number.isFinite(price) || price <= 0) return bars;

  const slotMs = timeframeToMs(tf);
  const lastBar = bars[bars.length - 1];
  const lastSlotMs = Date.parse(lastBar.t);
  const tickMs = Date.parse(tsIso);

  if (!Number.isFinite(lastSlotMs)) return bars;

  // Tick dans un slot plus récent → nouvelle bougie synthétique
  if (Number.isFinite(tickMs) && tickMs >= lastSlotMs + slotMs) {
    const newSlot = alignToTimeSlot(tickMs, slotMs);
    const safeClose = lastBar.c > 0 ? lastBar.c : price;
    const syntheticBar: NormalizedOhlcvBar = {
      t: new Date(newSlot).toISOString(),
      o: safeClose,
      h: Math.max(safeClose, price),
      l: Math.min(safeClose, price),
      c: price,
      v: 0,
      tf: tf || lastBar.tf,
      seq: lastBar.seq + 1,
      venue: lastBar.venue,
      instrument: lastBar.instrument,
      source: "tick-synthetic",
    };
    return [...bars, syntheticBar];
  }

  // Pas de changement de prix → retourne la même référence (stable pour useMemo)
  if (price === lastBar.c) return bars;

  // Mise à jour du close/high/low de la dernière bougie
  const updatedLast: NormalizedOhlcvBar = {
    ...lastBar,
    h: Math.max(lastBar.h, price),
    l: Math.min(lastBar.l, price),
    c: price,
    source: "tick-updated",
  };
  return [...bars.slice(0, -1), updatedLast];
}

// ── Normalizer bar seul ───────────────────────────────────────────────────────

/**
 * Normalise une barre brute : bounds OHLCV, timestamp aligné sur le slot TF.
 */
export function normalizeBarToSlot(
  bar: NormalizedOhlcvBar,
  tf: string,
): NormalizedOhlcvBar {
  const slotMs = timeframeToMs(tf);
  const tsMs = Date.parse(bar.t);
  const alignedTs = Number.isFinite(tsMs) && slotMs > 0
    ? new Date(alignToTimeSlot(tsMs, slotMs)).toISOString()
    : bar.t;

  const o = bar.o > 0 ? bar.o : bar.c;
  const c = bar.c > 0 ? bar.c : o;
  const h = Math.max(o, c, bar.h > 0 ? bar.h : 0);
  const l = Math.min(o, c, bar.l > 0 ? bar.l : Infinity);
  const safeL = Number.isFinite(l) ? l : Math.min(o, c);

  return { ...bar, t: alignedTs, o, h, l: safeL, c, v: Math.max(0, bar.v) };
}
