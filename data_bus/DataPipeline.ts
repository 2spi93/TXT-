/**
 * Integration Pipeline Example
 * Shows complete data flow: Exchange WS → BarBuilder → TimeframeEngine → DataBus → Subscribers
 *
 * FINAL ARCHITECTURE (TXT Grade):
 *
 *  Exchange WS Stream
 *        ↓ (raw ticks)
 *  Ingest Buffer (anti-burst)
 *        ↓
 *  BarBuilder [1m base]
 *        ↓
 *  Sequencer (strict ordering)
 *        ↓
 *  TimeframeEngine [derives 5m, 15m, 1h, ...]
 *        ↓
 *  Hot Cache (RAM)
 *        ↓
 *  DataBus (source of truth)
 *     ╱  │  ╲
 *  Chart AI Execution
 */

import type { Trade } from "../data_bar_builder/types.ts";
import BarBuilder from "../data_bar_builder/BarBuilder.ts";
import TimeframeEngine from "../timeframe_engine/TimeframeEngine.ts";
import DataBus from "../data_bus/DataBus.ts";
import type { SequencedEvent } from "../data_bus/DataBus.ts";
import type { Timeframe } from "../timeframe_engine/TimeframeEngine.ts";

/**
 * Pipeline State Machine
 */
export class DataPipeline {
  private barBuilder: BarBuilder;
  private timeframeEngine: TimeframeEngine;
  private dataBus: DataBus;
  private eventSeq: number = 0;

  constructor(symbol: string, exchange: string) {
    this.barBuilder = new BarBuilder({
      symbol,
      exchange,
      baseTimeframe: "1m",
      resetOnGap: true,
      fillMissing: false,
    });

    this.timeframeEngine = new TimeframeEngine({
      symbol,
      baseTimeframe: "1m",
      derivedTimeframes: ["5m", "15m", "30m", "1h", "4h"],
    });

    this.dataBus = new DataBus();

    // Wire BarBuilder → TimeframeEngine
    this._wireBarBuilderToTimeframe();

    // Wire TimeframeEngine → DataBus
    this._wireTimeframeToDataBus();
  }

  /**
   * Entry point: Exchange sends raw trade tick
   */
  onExchangeTrade(trade: Omit<Trade, "seq">): void {
    const enrichedTrade: Trade = {
      ...trade,
      seq: ++this.eventSeq,
    };

    // Feed to BarBuilder (constructs 1m base candle)
    this.barBuilder.onTrade(enrichedTrade);
  }

  /**
   * Register subscriber (Chart, AI, Execution, etc)
   */
  subscribe(
    name: string,
    role: "chart" | "ai" | "execution" | "monitor",
    callback: (event: any) => void,
    filter?: {
      symbol?: string;
      timeframe?: Timeframe;
      types?: SequencedEvent["type"][];
    }
  ): string {
    return this.dataBus.subscribe({
      name,
      role,
      callback,
      filter,
    });
  }

  /**
   * Get current bar snapshot
   */
  getBar(timeframe: Timeframe) {
    return this.dataBus.getBar("BTCUSDT", timeframe);
  }

  getDataBus(): DataBus {
    return this.dataBus;
  }

  /**
   * List active subscribers
   */
  listSubscribers() {
    return this.dataBus.listSubscribers();
  }

  /**
   * Cache stats
   */
  getCacheStats() {
    return this.dataBus.getCacheStats();
  }

  // ─────────────────────────────────────────────────────────────

  private _wireBarBuilderToTimeframe(): void {
    this.barBuilder.subscribe((event) => {
      if (event.type === "bar_close") {
        // Feed completed 1m bar to TimeframeEngine
        this.timeframeEngine.onBase1mBar(event.bar);
      }
    });
  }

  private _wireTimeframeToDataBus(): void {
    this.timeframeEngine.subscribe("1m", (event) => {
      if (event.type === "close" && event.bar.isComplete) {
        // Publish to DataBus
        this.dataBus.publishBar(event.bar, {
          id: `bar_1m_${event.bar.timestamp}`,
          eventTime: event.bar.timestamp,
          arrivalTime: event.bar.arrivalTime,
          seq: event.bar.seq,
          priority: 0,
          type: "bar",
        });
      }
    });

    // Also subscribe to 5m bars
    this.timeframeEngine.subscribe("5m", (event) => {
      if (event.type === "close" && event.bar.isComplete) {
        this.dataBus.publishBar(event.bar, {
          id: `bar_5m_${event.bar.timestamp}`,
          eventTime: event.bar.timestamp,
          arrivalTime: event.bar.arrivalTime,
          seq: event.bar.seq,
          priority: 1,
          type: "bar",
        });
      }
    });

    // 15m bars
    this.timeframeEngine.subscribe("15m", (event) => {
      if (event.type === "close" && event.bar.isComplete) {
        this.dataBus.publishBar(event.bar, {
          id: `bar_15m_${event.bar.timestamp}`,
          eventTime: event.bar.timestamp,
          arrivalTime: event.bar.arrivalTime,
          seq: event.bar.seq,
          priority: 2,
          type: "bar",
        });
      }
    });
  }
}

export default DataPipeline;
