/**
 * MarketDataEngine V5 — Pipeline Unifié (Hedge Fund Grade)
 *
 * Architecture :
 *   EXCHANGE (WS trades + depth + OHLCV)
 *         ↓
 *   CandleEngineV5  (reconstruction tick-level depuis trades)
 *   MarketDataEngineV3 (série OHLCV canonique)
 *         ↓
 *   MERGE  (V3 prioritaire + V5 comble les gaps)
 *         ↓
 *   MarketDataEngineV4 (microstructure : CVD, imbalance, latency, events)
 *         ↓
 *   Latency Compensation → série finale corrigée
 *
 * Points clés vs TV / Quantower :
 *   ✅ Candles construites depuis trades (tick-level)
 *   ✅ Zéro trou (gaps comblés depuis buffer trades)
 *   ✅ Latency offset adjustement (ts exchange → ts réseau compensé)
 *   ✅ Multi-feed VWAP via V4
 *   ✅ Pre-build avant premier render (stable=true avant emit)
 *   ✅ Double buffer via CandleV5 (swapBuffers → zéro jitter)
 */

import { MarketDataEngineV3 } from "./marketDataEngineV3";
import {
  MarketDataEngineV4,
  type MicrostructureSnapshot,
  type DepthRow,
  type VenueTick,
  type TradeInput,
} from "./marketDataEngineV4";
import { CandleEngineV5, type TradeForCandle, type GapRange } from "./candleEngineV5";
import type { NormalizedOhlcvBar } from "./ohlcvIntegrity";

// ── Types ──────────────────────────────────────────────────────────────────────

export type { GapRange };

export type BootstrapInput = {
  ohlcvBars: NormalizedOhlcvBar[];
  trades?: TradeInput[];
  latencyMs?: number;
};

export type V5SeriesSnapshot = {
  bars: NormalizedOhlcvBar[];
  isStable: boolean;
  gapsDetected: GapRange[];
  tradeCandleCount: number;
  source: "ohlcv" | "trades" | "merged";
};

export type V5FlowScore = {
  score: number;        // [0, 1] — force du signal directionnel
  direction: "buy" | "sell" | "neutral";
  components: {
    depthImbalance: number;
    cvdDelta: number;
    aggressiveness: number;
  };
};

// ── Engine ─────────────────────────────────────────────────────────────────────

export class MarketDataEngineV5 {
  private v3: MarketDataEngineV3;
  private v4: MarketDataEngineV4;
  private candleEngine: CandleEngineV5;

  private timeframe: string;
  private instrument: string;
  private venue: string;

  private latencyOffsetMs = 0;
  private stable = false;
  private lastGaps: GapRange[] = [];
  private backfillCallback: ((startMs: number, endMs: number) => void) | null = null;

  constructor(timeframe: string, instrument: string, venue: string) {
    this.timeframe = timeframe;
    this.instrument = instrument;
    this.venue = venue;
    this.v3 = new MarketDataEngineV3(timeframe, instrument, venue);
    this.v4 = new MarketDataEngineV4();
    this.candleEngine = new CandleEngineV5(timeframe);
  }

  // ── Bootstrap (PREBUILD AVANT RENDER) ────────────────────────────────────────

  /**
   * Bootstrap complet : ingère la série OHLCV REST + le batch trades REST,
   * reconstruit les candles depuis trades, détecte les gaps.
   *
   * ⚠️ Doit être appelé AVANT le premier emit() du bus.
   *    stable = true seulement après cette méthode.
   */
  bootstrap(input: BootstrapInput): void {
    this.stable = false;

    // 1. V3 : série OHLCV canonique (REST bootstrap)
    if (input.ohlcvBars.length > 0) {
      this.v3.ingestSnapshot(input.ohlcvBars);
    }

    // 2. CandleV5 : reconstruction depuis batch trades
    if (input.trades && input.trades.length > 0) {
      const tradesToIngest: TradeForCandle[] = input.trades.map((t) => ({
        price: t.price,
        size: t.size,
        side: String(t.side ?? ""),
        tsMs: (t as TradeInput & { tsMs?: number }).tsMs ?? Date.now(),
      }));
      this.candleEngine.ingestTrades(tradesToIngest);

      // Nourrir V4 microstructure
      for (const t of input.trades) {
        this.v4.ingestTrade(t);
      }
    }

    // 3. Latency offset initial
    if (input.latencyMs !== undefined) {
      this.latencyOffsetMs = input.latencyMs;
    }

    // 4. Détection immédiate des gaps
    this.lastGaps = this.candleEngine.detectGaps(this.v3.getSeries());

    // 5. Déclencher backfill si gaps détectés
    if (this.lastGaps.length > 0 && this.backfillCallback) {
      for (const gap of this.lastGaps) {
        this.backfillCallback(gap.startMs, gap.endMs);
      }
    }

    this.stable = true;
  }

  // ── Ingestion temps réel ──────────────────────────────────────────────────────

  ingestWsBar(bar: NormalizedOhlcvBar): void {
    this.v3.ingestWsBar(bar);
  }

  ingestTrade(trade: TradeInput & { tsMs?: number; exchangeTs?: number }): void {
    const ts = trade.exchangeTs ?? trade.tsMs ?? Date.now();

    // Candle reconstruction depuis trade
    this.candleEngine.ingestTrade({
      price: trade.price,
      size: trade.size,
      side: String(trade.side ?? ""),
      tsMs: ts,
      exchangeTs: trade.exchangeTs,
    });

    // Microstructure V4
    this.v4.ingestTrade(trade);
  }

  ingestTrades(trades: Array<TradeInput & { tsMs?: number; exchangeTs?: number }>): void {
    for (const t of trades) this.ingestTrade(t);
  }

  /**
   * Injection tick prix live.
   * Retourne true si la bougie courante a changé (→ bus doit émettre).
   */
  ingestTick(price: number, tsMs: number, venue?: string): boolean {
    const v4tick: VenueTick = { venue: venue ?? this.venue ?? "primary", price, tsMs };
    this.v4.ingestTick(v4tick);
    return this.v3.ingestTick(price, tsMs);
  }

  ingestDepth(delta: { bids?: DepthRow[]; asks?: DepthRow[] }): void {
    this.v4.ingestDepth(delta);
  }

  ingestDepthSnapshot(bids: DepthRow[], asks: DepthRow[]): void {
    this.v4.ingestDepthSnapshot(bids, asks);
  }

  // ── Série finale (merge - priorité OHLCV - gaps comblés par trades) ──────────

  getSeries(): NormalizedOhlcvBar[] {
    const v3Series = this.v3.getSeries();

    // Détection et enregistrement des gaps
    this.lastGaps = this.candleEngine.detectGaps(v3Series);

    // Déclencher backfill pour les nouveaux gaps
    if (this.lastGaps.length > 0 && this.backfillCallback) {
      for (const gap of this.lastGaps) {
        this.backfillCallback(gap.startMs, gap.endMs);
      }
    }

    const tradeSeries = this.candleEngine.getSeries();

    // Pas de trades → série V3 pure
    if (tradeSeries.length === 0) return v3Series;

    // Merge : trades comblent les trous de V3
    const merged = this.candleEngine.mergeWithOhlcv(v3Series);

    // Latency compensation
    if (this.latencyOffsetMs > 50) {
      return this.candleEngine.applyLatencyCompensation(merged, this.latencyOffsetMs);
    }

    return merged;
  }

  getSeriesSnapshot(): V5SeriesSnapshot {
    const v3Series = this.v3.getSeries();
    const tradeSeries = this.candleEngine.getSeries();
    const gaps = this.candleEngine.detectGaps(v3Series);

    const merged = this.candleEngine.mergeWithOhlcv(v3Series);
    const bars = this.latencyOffsetMs > 50
      ? this.candleEngine.applyLatencyCompensation(merged, this.latencyOffsetMs)
      : merged;

    const source: V5SeriesSnapshot["source"] =
      tradeSeries.length > 0 && gaps.length > 0 ? "merged"
      : tradeSeries.length > 0 ? "trades"
      : "ohlcv";

    return { bars, isStable: this.stable, gapsDetected: gaps, tradeCandleCount: tradeSeries.length, source };
  }

  getCurrentBar(): NormalizedOhlcvBar | null {
    return this.v3.getCurrentBar() ?? this.candleEngine.getLatestCandle();
  }

  // ── Double Buffer (pour render zéro jitter) ───────────────────────────────────

  /**
   * Prépare le back-buffer avec la série courante.
   * Appeler avant requestAnimationFrame.
   */
  prepareFrame(): void {
    this.candleEngine.prepareBackBuffer();
  }

  /**
   * Swaps front ↔ back buffer.
   * Appeler DANS requestAnimationFrame pour un render atomique.
   */
  swapFrame(): NormalizedOhlcvBar[] {
    return this.candleEngine.swapBuffers();
  }

  // ── Microstructure V4 ─────────────────────────────────────────────────────────

  getMicrostructure(): MicrostructureSnapshot {
    return this.v4.getSnapshot();
  }

  /**
   * Flow Score unifié — combine depth imbalance, CVD delta, et aggressivité.
   * Utilisé par la couche signal pour qualifier la direction du marché.
   */
  getFlowScore(): V5FlowScore {
    const micro = this.v4.getSnapshot();

    const depthImbalance = micro.depthImbalance;           // [-1, +1]
    const cvdDelta = Math.tanh(micro.cvdDelta * 0.001);    // normalise via tanh
    const aggressiveness = micro.tradeAggressiveness * 2 - 1; // [0,1] → [-1,+1]

    const score =
      depthImbalance * 0.4 +
      cvdDelta       * 0.3 +
      aggressiveness * 0.3;

    const absScore = Math.abs(score);
    const direction: V5FlowScore["direction"] =
      absScore < 0.08 ? "neutral"
      : score > 0 ? "buy"
      : "sell";

    return {
      score: Math.min(1, absScore),
      direction,
      components: { depthImbalance, cvdDelta, aggressiveness },
    };
  }

  // ── Latency ───────────────────────────────────────────────────────────────────

  updateLatencyOffset(latencyMs: number): void {
    this.latencyOffsetMs = latencyMs;
  }

  getLatencyOffset(): number {
    return this.latencyOffsetMs;
  }

  /**
   * Met à jour le latency offset automatiquement depuis les mesures V4.
   */
  syncLatencyFromV4(): void {
    const micro = this.v4.getSnapshot();
    if (micro.avgLatencyMs > 0) {
      this.latencyOffsetMs = Math.round(micro.avgLatencyMs);
    }
  }

  // ── Gaps / Backfill ───────────────────────────────────────────────────────────

  getGaps(): GapRange[] {
    return this.lastGaps;
  }

  /**
   * Enregistre un callback appelé quand des gaps sont détectés.
   * Le bus utilise ce callback pour déclencher un fetch backfill.
   */
  onGapDetected(cb: (startMs: number, endMs: number) => void): void {
    this.backfillCallback = cb;
  }

  isStable(): boolean {
    return this.stable;
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────────

  getStats(): {
    v3: ReturnType<MarketDataEngineV3["getStats"]>;
    tradeCandleCount: number;
    gapCount: number;
    latencyOffsetMs: number;
    stable: boolean;
    flowScore: V5FlowScore;
  } {
    return {
      v3: this.v3.getStats(),
      tradeCandleCount: this.candleEngine.getCandleCount(),
      gapCount: this.lastGaps.length,
      latencyOffsetMs: this.latencyOffsetMs,
      stable: this.stable,
      flowScore: this.getFlowScore(),
    };
  }

  // ── Reset ──────────────────────────────────────────────────────────────────────

  reset(): void {
    this.v3 = new MarketDataEngineV3(this.timeframe, this.instrument, this.venue);
    this.v4.reset();
    this.candleEngine.reset();
    this.stable = false;
    this.lastGaps = [];
    this.latencyOffsetMs = 0;
  }
}
