/**
 * Complete Example: DataPipeline in Action
 * 
 * Demonstrates:
 * ✅ Exchange ticks → BarBuilder → 1m candles
 * ✅ 1m → TimeframeEngine → 5m, 15m, 1h (zero desync)
 * ✅ All timeframes → DataBus (single source of truth)
 * ✅ Chart subscriber (read-only)
 * ✅ AI Engine subscriber (same data)
 * ✅ Sequencing (event_time → seq → arrival_time)
 * ✅ Hot cache (RAM for speed)
 */

import DataPipeline from "../data_bus/DataPipeline.ts";
import ChartSubscriber from "../data_bus/ChartSubscriber.ts";
import AIEngineSubscriber from "../data_bus/AIEngineSubscriber.ts";

// ────────────────────────────────────────────────────────────────────────────
// SIMULATE EXCHANGE TRADES
// ────────────────────────────────────────────────────────────────────────────

function simulateExchangeTrades() {
  const pipeline = new DataPipeline("BTCUSDT", "binance");
  const dataBus = pipeline.getDataBus();

  // ✅ Register Chart subscriber (reads bars for rendering)
  const chart = new ChartSubscriber(dataBus, {
    symbol: "BTCUSDT",
    timeframes: ["1m", "5m", "15m"],
  });

  chart.onBar((bar, tf) => {
    console.log(
      `[Chart] ${tf}: open=${bar.open} high=${bar.high} low=${bar.low} close=${bar.close} vol=${bar.volume}`
    );
  });

  // ✅ Register AI Engine subscriber (analyzes same bars)
  const ai = new AIEngineSubscriber(dataBus, "BTCUSDT", ["5m", "15m"]);

  ai.onSignal((signal) => {
    console.log(
      `[AIEngine] SIGNAL: ${signal.signal.toUpperCase()} @ ${signal.timeframe} (confidence=${(signal.confidence * 100).toFixed(0)}%)`
    );
  });

  // ✅ Generate sample trades for 1 minute
  const now = Date.now();
  const basePrice = 50000;

  const trades = [
    { price: basePrice + 5, size: 1.5, isBuyerMaker: true, timeOffset: 0 },
    { price: basePrice + 10, size: 2.0, isBuyerMaker: false, timeOffset: 500 },
    { price: basePrice + 8, size: 1.2, isBuyerMaker: true, timeOffset: 1000 },
    { price: basePrice + 12, size: 3.0, isBuyerMaker: false, timeOffset: 2000 },
    { price: basePrice + 15, size: 1.8, isBuyerMaker: true, timeOffset: 5000 },
    { price: basePrice + 14, size: 2.5, isBuyerMaker: false, timeOffset: 10000 },
    { price: basePrice + 20, size: 4.0, isBuyerMaker: true, timeOffset: 20000 },
    { price: basePrice + 18, size: 1.5, isBuyerMaker: false, timeOffset: 30000 },
  ];

  console.log("\n=== STARTING TRADE SIMULATION ===\n");

  trades.forEach((trade, i) => {
    setTimeout(() => {
      pipeline.onExchangeTrade({
        id: `trade_${i}`,
        exchange: "binance",
        symbol: "BTCUSDT",
        price: trade.price,
        size: trade.size,
        timestamp: now + trade.timeOffset,
        arrivalTime: now + trade.timeOffset + 10, // 10ms network lat
        isBuyerMaker: trade.isBuyerMaker,
      });
    }, trade.timeOffset);
  });

  // Report after 60 seconds
  setTimeout(() => {
    console.log("\n=== FINAL STATISTICS ===\n");

    const stats = pipeline.getCacheStats();
    console.log(`Cache size: ${stats.size} bars`);
    console.log(`Symbols: ${Array.from(stats.symbols).join(", ")}`);
    console.log(`Timeframes: ${Array.from(stats.timeframes).join(", ")}`);

    console.log("\nCurrent bars:");
    console.log(`  1m:  ${JSON.stringify(chart.getBar("1m")?.close)}`);
    console.log(`  5m:  ${JSON.stringify(chart.getBar("5m")?.close)}`);
    console.log(`  15m: ${JSON.stringify(chart.getBar("15m")?.close)}`);

    console.log("\nSubscribers:");
    pipeline.listSubscribers().forEach((sub) => {
      console.log(`  ${sub.role.toUpperCase()}: ${sub.name}`);
    });

    console.log("\nAI Signal history:");
    ai.getSignalHistory().forEach((sig) => {
      console.log(
        `  ${sig.timeframe}: ${sig.signal} @ ${sig.confidence.toFixed(2)} confidence`
      );
    });

    // Cleanup
    chart.destroy();
    ai.destroy();
  }, 35000);
}

// ────────────────────────────────────────────────────────────────────────────
// ARCHITECTURE VALIDATION CHECKLIST
// ────────────────────────────────────────────────────────────────────────────

export const VALIDATION_CHECKLIST = {
  "1. BarBuilder ✅": [
    "Constructs 1m candles from trade ticks",
    "Handles exchange inconsistencies (buy/sell side tracking)",
    "Detects gaps, manages state cleanly",
    "Emits bar_open / bar_update / bar_close events",
  ],

  "2. TimeframeEngine ✅": [
    "Derives 5m from 5×1m bars (no separate fetch)",
    "Derives 15m from 15×1m bars (zero desync guaranteed)",
    "Derives 1h, 4h, 1d from base (perfect coherence)",
    "Subscribers get strict: first_open, max_high, min_low, last_close, sum_volumes",
  ],

  "3. Sequencer ✅": [
    "Enforces ORDER: event_time > seq > arrival_time",
    "Detects out-of-order events and warns",
    "Maintains event buffer for replay/audit",
    "Each bar tagged with source event metadata",
  ],

  "4. Hot Cache ✅": [
    "RAM layer stores recent bars (zero I/O)",
    "Organized by symbol:timeframe keys",
    "Returns immutable copies (safe for concurrent reads)",
    "Stats available: size, symbols, timeframes",
  ],

  "5. DataBus ✅": [
    "Single source of truth for all subscribers",
    "Publishes bars →  subscribers by role priority",
    "Filters by symbol, timeframe, event type",
    "Metrics recording (AI confidence, latency, etc)",
  ],

  "6. Chart Subscriber ✅": [
    "Reads ONLY from DataBus (no side channels)",
    "Pure pass-through: no recalc, no merge, no logic",
    "Calls onBar(bar) for chart rendering",
    "Read-only snapshot access via getBar()",
  ],

  "7. AI Engine Subscriber ✅": [
    "Reads SAME bars as Chart (zero desync)",
    "Generates signals from DataBus events",
    "Maintains own analysis history (separate from chart)",
    "Broadcasts signals to execution engine",
  ],

  "8. Execution Brain ✅": [
    "Reads signals from AI + bars from DataBus",
    "Uses same sequencing as chart",
    "No data reconstruction (everything is source truth)",
    "Place orders using verified bars",
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// RUN SIMULATION
// ────────────────────────────────────────────────────────────────────────────

const isMainModule = (() => {
  const g = globalThis as { process?: { argv?: string[] } };
  const argv1 = g.process?.argv?.[1];
  if (!argv1) return false;
  return new URL(import.meta.url).pathname === argv1;
})();

if (isMainModule) {
  simulateExchangeTrades();
}

export { simulateExchangeTrades };
