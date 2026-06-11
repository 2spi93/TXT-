/**
 * Chart Data Subscriber
 * ⚠️ RULE: Chart ONLY reads from DataBus
 *          Chart NEVER modifies data
 *          Chart NEVER recalculates data
 *          Chart NEVER merges data
 *
 * Pattern (TradingView streaming):
 * onBar(bar) {
 *   series.update(bar)
 * }
 *
 * THAT'S IT. No logic.
 */

import type { DataBusBar, DataBusEvent } from "../data_bus/DataBus.ts";
import DataBus from "../data_bus/DataBus.ts";
import type { Timeframe } from "../timeframe_engine/TimeframeEngine.ts";

export interface ChartSubscription {
  symbol: string;
  timeframes: Timeframe[];
}

/**
 * Chart adapter for DataBus
 * Translates bus events → chart series updates
 */
export class ChartSubscriber {
  private dataBus: DataBus;
  private subscriptionIds: Map<string, string> = new Map(); // tf → subscription ID
  private currentBar: Map<string, DataBusBar> = new Map(); // tf → bar
  private barEventListeners: Set<(bar: DataBusBar, tf: Timeframe) => void> = new Set();

  constructor(dataBus: DataBus, subscription: ChartSubscription) {
    this.dataBus = dataBus;

    // Subscribe to each timeframe
    subscription.timeframes.forEach((tf) => {
      const subId = dataBus.subscribe({
        name: `Chart[${subscription.symbol}:${tf}]`,
        role: "chart",
        callback: (event: DataBusEvent) => this._onBusEvent(event, tf),
        filter: {
          symbol: subscription.symbol,
          timeframe: tf,
          types: ["bar"],
        },
      });
      this.subscriptionIds.set(tf, subId);
    });

    console.log(
      `[Chart] Subscribed to ${subscription.symbol} [${subscription.timeframes.join(", ")}]`
    );
  }

  /**
   * Get current bar for timeframe (snapshot)
   * ⚠️ Returns immutable copy
   */
  getBar(timeframe: Timeframe): DataBusBar | null {
    const bar = this.currentBar.get(timeframe);
    return bar ? { ...bar } : null;
  }

  /**
   * Listen for bar updates
   * Chart rendering engine calls this
   */
  onBar(listener: (bar: DataBusBar, timeframe: Timeframe) => void): () => void {
    this.barEventListeners.add(listener);
    return () => this.barEventListeners.delete(listener);
  }

  /**
   * Unsubscribe from all timeframes
   */
  destroy(): void {
    this.subscriptionIds.forEach((id) => {
      this.dataBus.unsubscribe(id);
    });
    this.subscriptionIds.clear();
    this.barEventListeners.clear();
  }

  // ─────────────────────────────────────────────────────────────

  /**
   * Internal: Bus event handler
   * ⚠️ STRICT RULE: NO LOGIC HERE
   * Just forward events to chart rendering
   */
  private _onBusEvent(event: DataBusEvent, timeframe: Timeframe): void {
    if (!event.bar) return;

    // Store current bar
    this.currentBar.set(timeframe, event.bar);

    // Notify chart rendering (and ONLY that)
    this.barEventListeners.forEach((listener) => {
      try {
        listener(event.bar!, timeframe);
      } catch (e) {
        console.error(`[Chart] Bar listener error:`, e);
      }
    });

    // That's ALL.
    // No merge logic.
    // No recalculation.
    // No interpolation.
    // No correction.
    // Pure pass-through.
  }
}

export default ChartSubscriber;
