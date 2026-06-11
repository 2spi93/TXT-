/**
 * AI Engine Subscriber
 * Reads SAME DataBus as Chart
 * Ensures perfect sync between AI signals and chart data
 *
 * RULE: AI reads from DataBus ONLY
 *       No separate API calls
 *       No data reconstruction
 *       Same bars as chart sees
 */

import type { DataBusBar, DataBusEvent } from "../data_bus/DataBus.ts";
import DataBus from "../data_bus/DataBus.ts";
import type { Timeframe } from "../timeframe_engine/TimeframeEngine.ts";

export interface AISignal {
  id: string;
  timestamp: number;
  symbol: string;
  timeframe: Timeframe;
  signal: "buy" | "sell" | "hold";
  confidence: number; // 0-1
  reason: string;
  barsTillClose: number;
}

/**
 * AI Engine that consumes bars from DataBus
 * Example: Simple momentum detection
 */
export class AIEngineSubscriber {
  private dataBus: DataBus;
  private subscriptionIds: Map<string, string> = new Map();
  private barHistory: Map<string, DataBusBar[]> = new Map();
  private signalListeners: Set<(signal: AISignal) => void> = new Set();
  private signalHistory: AISignal[] = [];

  constructor(
    dataBus: DataBus,
    symbol: string,
    timeframes: Timeframe[] = ["5m", "15m"]
  ) {
    this.dataBus = dataBus;

    // Subscribe to each timeframe
    timeframes.forEach((tf) => {
      const subId = dataBus.subscribe({
        name: `AIEngine[${symbol}:${tf}]`,
        role: "ai",
        callback: (event: DataBusEvent) => this._onBusEvent(event, tf),
        filter: {
          symbol,
          timeframe: tf,
          types: ["bar"],
        },
      });
      this.subscriptionIds.set(tf, subId);
      this.barHistory.set(tf, []);
    });

    console.log(`[AIEngine] Subscribed to ${symbol} [${timeframes.join(", ")}]`);
  }

  /**
   * Listen for trading signals
   */
  onSignal(listener: (signal: AISignal) => void): () => void {
    this.signalListeners.add(listener);
    return () => this.signalListeners.delete(listener);
  }

  /**
   * Get recent signals
   */
  getSignalHistory(limit: number = 50): AISignal[] {
    return this.signalHistory.slice(-limit);
  }

  /**
   * Destroy subscription
   */
  destroy(): void {
    this.subscriptionIds.forEach((id) => {
      this.dataBus.unsubscribe(id);
    });
    this.subscriptionIds.clear();
    this.signalListeners.clear();
  }

  // ─────────────────────────────────────────────────────────────

  private _onBusEvent(event: DataBusEvent, timeframe: Timeframe): void {
    if (!event.bar) return;

    const bar = event.bar;
    const history = this.barHistory.get(timeframe);
    if (!history) return;

    // Store bar in history (keep last 50)
    history.push(bar);
    if (history.length > 50) history.shift();

    // Generate signal from bar
    const signal = this._analyzeBar(bar, timeframe, history);
    if (signal) {
      this.signalHistory.push(signal);
      if (this.signalHistory.length > 500) {
        this.signalHistory.shift();
      }

      // Broadcast signal
      this.signalListeners.forEach((listener) => {
        try {
          listener(signal);
        } catch (e) {
          console.error(`[AIEngine] Signal listener error:`, e);
        }
      });
    }
  }

  /**
   * Simple momentum analysis
   * Examines last 3 bars to detect trend
   */
  private _analyzeBar(
    bar: DataBusBar,
    timeframe: Timeframe,
    history: DataBusBar[]
  ): AISignal | null {
    if (history.length < 3) return null;

    // Get last 3 bars (excluding current)
    const prev3 = history.slice(-3);
    const closes = prev3.map((b) => b.close);

    // Simple momentum: is close rising?
    const momentum = closes[2] > closes[1] && closes[1] > closes[0];
    const reversal = closes[2] < closes[1] && closes[1] < closes[0];

    let signal: "buy" | "sell" | "hold" = "hold";
    let confidence = 0;

    if (momentum) {
      signal = "buy";
      confidence = 0.6;
    } else if (reversal) {
      signal = "sell";
      confidence = 0.55;
    }

    if (signal === "hold") return null;

    return {
      id: `sig_${Date.now()}_${Math.random()}`,
      timestamp: bar.timestamp,
      symbol: bar.symbol,
      timeframe,
      signal,
      confidence,
      reason: momentum ? "Uptrend detected" : "Downtrend detected",
      barsTillClose: Math.ceil((bar.closeTime - Date.now()) / 60000),
    };
  }
}

export default AIEngineSubscriber;
