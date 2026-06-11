/**
 * Bar Builder Types
 * Constructs OHLCV from raw trade ticks
 * Handles exchange inconsistencies, latency, and aggregation differences
 */

export interface Trade {
  id: string;
  exchange: string;
  symbol: string;
  price: number;
  size: number;
  timestamp: number;      // Trade execution time (event_time)
  arrivalTime: number;    // When we received it
  isBuyerMaker: boolean;
  seq: number;            // Exchange sequence
}

export interface Bar {
  symbol: string;
  exchange: string;
  timeframe: string;      // "1m", "5m", "15m", etc
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;    // Volume in quote currency
  buyVolume: number;
  sellVolume: number;
  tradeCount: number;
  timestamp: number;      // Bar start time
  closeTime: number;      // Bar close time
  isComplete: boolean;
  seq: number;            // Last trade seq
  arrivalTime: number;    // When bar was finalized
}

export interface BarBuilderConfig {
  symbol: string;
  exchange: string;
  baseTimeframe: "1m";    // Always 1m base
  resetOnGap?: boolean;   // Reset on >1s gap
  fillMissing?: boolean;  // Fill missing bars with previous close
}

export interface BarEvent {
  type: "bar_open" | "bar_update" | "bar_close";
  bar: Bar;
  isReplay: boolean;
}
