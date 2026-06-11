/**
 * Data Bus
 * Central hub for all data subscribers
 * Single source of truth for Chart, AI Engine, Execution Brain
 * 
 * Architecture:
 *        ┌──────────────────┐
 *        │   Data Bus       │
 *        │  (Source Truth)  │
 *        └────────┬─────────┘
 *           ┌─────┼─────┐
 *           │     │     │
 *        Chart   AI   Execution
 *                    Brain
 * 
 * RULE: Everything reads from Data Bus
 *       Nothing reads elsewhere
 */

import type { Bar } from "../data_bar_builder/types.ts";
import type { Timeframe, DerivedBarEvent } from "../timeframe_engine/TimeframeEngine.ts";

export interface SequencedEvent {
  id: string;
  eventTime: number;       // Trade execution time (reality)
  arrivalTime: number;     // When we received it (network)
  seq: number;             // Exchange sequence
  priority: number;        // ORDER = lower = earlier (eventTime, seq, arrivalTime)
  type: "bar" | "trade" | "quote" | "metric";
}

export interface BusSubscription<T> {
  id: string;
  name: string;
  role: "chart" | "ai" | "execution" | "monitor";
  filter?: {
    symbol?: string;
    timeframe?: Timeframe;
    types?: SequencedEvent["type"][];
  };
  callback: (event: T) => void;
}

export interface DataBusBar extends Bar {
  sourceEvent: SequencedEvent;
}

export interface DataBusEvent {
  bar?: DataBusBar;
  tfEvent?: DerivedBarEvent;
  raw?: any;
}

/**
 * Strict ordering: event_time > seq > arrival_time
 */
function compareEvents(a: SequencedEvent, b: SequencedEvent): number {
  if (a.eventTime !== b.eventTime) return a.eventTime - b.eventTime;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.arrivalTime - b.arrivalTime;
}

export class DataBus {
  private subscriptions: Map<string, BusSubscription<any>> = new Map();
  private eventBuffer: SequencedEvent[] = [];
  private hotCache: Map<string, DataBusBar> = new Map(); // RAM
  private metrics: Map<string, any> = new Map();
  private eventSequence: number = 0;

  /**
   * Register subscriber (chart, AI, execution, etc)
   */
  subscribe<T>(subscription: Omit<BusSubscription<T>, "id">): string {
    const id = `${subscription.role}_${++this.eventSequence}_${Date.now()}`;
    const full: BusSubscription<T> = { ...subscription, id };

    this.subscriptions.set(id, full);
    console.log(`[DataBus] ${subscription.name} (${subscription.role}) registered`);

    return id;
  }

  /**
   * Unsubscribe
   */
  unsubscribe(id: string): void {
    this.subscriptions.delete(id);
  }

  /**
   * Publish bar to bus
   * Dispatches to ALL subscriptions that match filter
   */
  publishBar(bar: Bar, sourceEvent: SequencedEvent): void {
    // Validate event ordering
    const lastSeq = this.eventBuffer[this.eventBuffer.length - 1]?.seq || -1;
    const lastTime = this.eventBuffer[this.eventBuffer.length - 1]?.eventTime || -1;

    if (sourceEvent.eventTime < lastTime || (sourceEvent.eventTime === lastTime && sourceEvent.seq <= lastSeq)) {
      console.warn(
        `[DataBus] Out-of-order event: seq=${sourceEvent.seq} time=${sourceEvent.eventTime} (expected seq>${lastSeq} or time>${lastTime})`
      );
    }

    // Store event
    this.eventBuffer.push(sourceEvent);

    // Update hot cache
    const cacheKey = `${bar.symbol}:${bar.timeframe}`;
    const busBa: DataBusBar = { ...bar, sourceEvent };
    this.hotCache.set(cacheKey, busBa);

    // Dispatch to subscribers
    const event: DataBusEvent = { bar: busBa };
    this._dispatch(event, (sub) => {
      // Filter by symbol
      if (sub.filter?.symbol && sub.filter.symbol !== bar.symbol) return false;
      // Filter by timeframe
      if (sub.filter?.timeframe && sub.filter.timeframe !== bar.timeframe) return false;
      // Filter by type
      if (sub.filter?.types && !sub.filter.types.includes("bar")) return false;
      return true;
    });
  }

  /**
   * Get bar from hot cache
   * IMMUTABLE (safe for concurrent access)
   */
  getBar(symbol: string, timeframe: Timeframe): DataBusBar | null {
    const key = `${symbol}:${timeframe}`;
    const bar = this.hotCache.get(key);
    return bar ? { ...bar } : null;
  }

  /**
   * Get recent bars from hot cache
   * Limit to most recent N
   */
  getBars(symbol: string, timeframe: Timeframe, limit: number = 100): DataBusBar[] {
    const prefix = `${symbol}:${timeframe}`;
    const result: DataBusBar[] = [];

    // Walk cache (ordered by insertion)
    for (const [key, bar] of this.hotCache) {
      if (key.startsWith(prefix)) {
        result.push({ ...bar });
        if (result.length >= limit) break;
      }
    }

    return result.reverse(); // Most recent first
  }

  /**
   * Record metric (AI confidence, execution signal, latency, etc)
   */
  recordMetric(key: string, value: any): void {
    this.metrics.set(key, { value, timestamp: Date.now() });
  }

  /**
   * Get metric snapshot
   */
  getMetric(key: string): any {
    return this.metrics.get(key);
  }

  /**
   * List all subscribers (for debugging)
   */
  listSubscribers(): Array<{ id: string; name: string; role: string }> {
    return Array.from(this.subscriptions.values()).map((sub) => ({
      id: sub.id,
      name: sub.name,
      role: sub.role,
    }));
  }

  /**
   * Get event buffer (for replay/audit)
   */
  getEventBuffer(limit: number = 1000): SequencedEvent[] {
    return this.eventBuffer.slice(-limit);
  }

  /**
   * Hot cache stats
   */
  getCacheStats(): { size: number; symbols: Set<string>; timeframes: Set<string> } {
    const symbols = new Set<string>();
    const timeframes = new Set<string>();

    for (const key of this.hotCache.keys()) {
      const [sym, tf] = key.split(":");
      symbols.add(sym);
      timeframes.add(tf);
    }

    return { size: this.hotCache.size, symbols, timeframes };
  }

  // ─────────────────────────────────────────────────────────────

  private _dispatch(
    event: DataBusEvent,
    shouldSend: (sub: BusSubscription<any>) => boolean
  ): void {
    const roles: Record<string, number> = { chart: 0, ai: 1, execution: 2, monitor: 3 };

    // Sort by role priority (chart first, then AI, then execution)
    const subs = Array.from(this.subscriptions.values())
      .filter(shouldSend)
      .sort((a, b) => (roles[a.role] || 999) - (roles[b.role] || 999));

    for (const sub of subs) {
      try {
        sub.callback(event);
      } catch (e) {
        console.error(`[DataBus] Subscriber ${sub.name} error:`, e);
      }
    }
  }
}

export default DataBus;
