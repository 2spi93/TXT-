/**
 * Bar Builder
 * Constructs OHLCV candles from raw trade ticks
 * Core function: tick → OHLCV translation
 * Handles:
 * - Exchange data inconsistencies
 * - Missing/delayed ticks
 * - Multi-source aggregation
 * - Gapped data
 */

import type { Trade, Bar, BarBuilderConfig, BarEvent } from "./types.ts";

export class BarBuilder {
  private config: BarBuilderConfig;
  private currentBar: Bar | null = null;
  private lastBarTime: number = 0;
  private subscribers: Set<(event: BarEvent) => void> = new Set();
  private barBuffer: Map<number, Bar> = new Map();
  private gapThreshold = 1000; // 1s gap triggers reset

  constructor(config: BarBuilderConfig) {
    this.config = config;
  }

  /**
   * Process incoming trade tick
   * Decides: continue bar | close bar + open new | handle gap
   */
  onTrade(trade: Trade): void {
    if (this.shouldResetOnGap(trade.timestamp)) {
      this._finalizePreviousBar();
    }

    // Determine bar start time for this trade (1m bars)
    const barStartTime = this._calculateBarStartTime(trade.timestamp);

    // Bar boundary crossed → close previous, open new
    if (
      this.currentBar &&
      this.currentBar.timestamp !== barStartTime
    ) {
      this._finalizePreviousBar();
      this._initializeNewBar(barStartTime, trade);
    }

    // Initialize first bar
    if (!this.currentBar) {
      this._initializeNewBar(barStartTime, trade);
    }

    // Update current bar with trade
    this._updateBarWithTrade(this.currentBar!, trade);

    // Broadcast bar_update
    if (this.currentBar) {
      this._emit("bar_update", this.currentBar, false);
    }
  }

  /**
   * Fill gaps in bar sequence (optional)
   * Useful for:
   * - Recovered data
   * - Multi-exchange reconciliation
   */
  fillGaps(bars: Bar[]): void {
    bars.forEach((bar) => {
      this.barBuffer.set(bar.timestamp, bar);
    });
  }

  /**
   * Get complete bar at timestamp
   * NEVER modifies → safe for chart/AI access
   */
  getBar(timestamp: number): Bar | null {
    return this.currentBar?.timestamp === timestamp
      ? { ...this.currentBar }
      : this.barBuffer.get(timestamp)
        ? { ...this.barBuffer.get(timestamp)! }
        : null;
  }

  /**
   * Subscribe to bar events
   */
  subscribe(listener: (event: BarEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  // ─────────────────────────────────────────────────────────────

  private _calculateBarStartTime(tradeTime: number): number {
    // 1m = 60000ms
    // barStart = tradeTime - (tradeTime % 60000)
    return Math.floor(tradeTime / 60000) * 60000;
  }

  private shouldResetOnGap(tradeTime: number): boolean {
    if (!this.config.resetOnGap || !this.lastBarTime) return false;
    return tradeTime - this.lastBarTime > this.gapThreshold;
  }

  private _initializeNewBar(barStartTime: number, trade: Trade): void {
    this.currentBar = {
      symbol: this.config.symbol,
      exchange: this.config.exchange,
      timeframe: "1m",
      open: trade.price,
      high: trade.price,
      low: trade.price,
      close: trade.price,
      volume: trade.size,
      quoteVolume: trade.price * trade.size,
      buyVolume: trade.isBuyerMaker ? 0 : trade.size,
      sellVolume: trade.isBuyerMaker ? trade.size : 0,
      tradeCount: 1,
      timestamp: barStartTime,
      closeTime: barStartTime + 60000 - 1, // 1m bar end
      isComplete: false,
      seq: trade.seq,
      arrivalTime: trade.arrivalTime,
    };

    this._emit("bar_open", this.currentBar, false);
  }

  private _updateBarWithTrade(bar: Bar, trade: Trade): void {
    // OHLC updates
    bar.high = Math.max(bar.high, trade.price);
    bar.low = Math.min(bar.low, trade.price);
    bar.close = trade.price; // Last trade = close

    // Volume
    bar.volume += trade.size;
    bar.quoteVolume += trade.price * trade.size;
    bar.buyVolume += trade.isBuyerMaker ? trade.size : 0;
    bar.sellVolume += trade.isBuyerMaker ? 0 : trade.size;

    bar.tradeCount += 1;
    bar.seq = trade.seq;
    bar.arrivalTime = trade.arrivalTime;

    this.lastBarTime = trade.timestamp;
  }

  private _finalizePreviousBar(): void {
    if (!this.currentBar) return;

    this.currentBar.isComplete = true;
    this.barBuffer.set(this.currentBar.timestamp, {
      ...this.currentBar,
    });

    this._emit("bar_close", this.currentBar, false);
    this.currentBar = null;
  }

  private _emit(type: BarEvent["type"], bar: Bar, isReplay: boolean): void {
    const event: BarEvent = { type, bar: { ...bar }, isReplay };
    this.subscribers.forEach((listener) => {
      try {
        listener(event);
      } catch (e) {
        console.error("BarBuilder subscriber error:", e);
      }
    });
  }
}

export default BarBuilder;
