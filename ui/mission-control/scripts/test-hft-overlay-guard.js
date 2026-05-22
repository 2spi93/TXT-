const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function assertIncludes(source, snippet, label) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing ${label}: ${snippet}`);
  }
}

const priceSignalLayer = read("lib/engine/gpu-chart/PriceSignalLayer.ts");
assertIncludes(priceSignalLayer, "export class PriceSignalLayer", "price signal GPU layer");
assertIncludes(priceSignalLayer, 'kind: "execution-expected" | "execution-actual" | "slippage" | "wall" | "vacuum" | "trap" | "flow-sweep" | "flow-absorption" | "flow-exhaustion" | "flow-spoof" | "flow-memory" | "arb-buy" | "arb-sell"', "price signal kinds");
assertIncludes(priceSignalLayer, "signals?: PriceSignalBand[]", "price signal input");

const multiChartManager = read("lib/engine/gpu-chart/MultiChartManager.ts");
assertIncludes(multiChartManager, "PriceSignalLayer", "multi-chart price signal layer wiring");
assertIncludes(multiChartManager, "priceSignalBands?: PriceSignalBand[]", "viewport price signal bands");
assertIncludes(multiChartManager, "this.priceSignalLayer.draw", "price signal draw call");

const gpuSurface = read("app/terminal/GpuChartV4Surface.tsx");
assertIncludes(gpuSurface, "normalizePriceSignalBands", "GPU surface price signal normalization");
assertIncludes(gpuSurface, "priceSignalBandsRef.current = gpuPriceSignalBands", "GPU surface price signal ref wiring");
assertIncludes(gpuSurface, "primaryPriceSignalBands: frameSnapshot.priceSignalBands", "GPU surface price signal viewport injection");

const chartPriceSignalBoundary = read("app/terminal/TerminalChartPriceSignalBoundary.tsx");
assertIncludes(chartPriceSignalBoundary, "function buildExecutionOverlaySnapshot", "execution overlay snapshot builder");
assertIncludes(chartPriceSignalBoundary, "function buildExecutionSlippageBands", "execution slippage band builder");
assertIncludes(chartPriceSignalBoundary, "function buildLiquidityPredictionLevels", "liquidity prediction builder");
assertIncludes(chartPriceSignalBoundary, "function buildFlowSignalBands", "flow signal band builder");
assertIncludes(chartPriceSignalBoundary, "function buildArbitrageSignalBands", "arbitrage signal band builder");
assertIncludes(chartPriceSignalBoundary, "function buildPriceSignalBands", "chart price signal aggregation");
assertIncludes(chartPriceSignalBoundary, "children: (payload: { priceSignalBands: PriceSignalBand[] }) => ReactNode", "chart price signal render boundary contract");

const terminalClient = read("app/terminal/TradingTerminalPageClient.tsx");
assertIncludes(terminalClient, "TerminalChartPriceSignalBoundary", "chart price signal boundary wiring");
assertIncludes(terminalClient, "flowIntelligenceSnapshot={flowIntelligenceSnapshot}", "flow snapshot passed into chart boundary");
assertIncludes(terminalClient, "multiVenueArbitrageSnapshot={multiVenueArbitrageSnapshot}", "arbitrage snapshot passed into chart boundary");
assertIncludes(terminalClient, "priceSignalBands={chartRuntimeOrderflowEnabled ? priceSignalBands : undefined}", "GPU/institutional chart price signal forwarding");
assertIncludes(terminalClient, "priceSignalBands={chartRuntimeOrderflowEnabled ? priceSignalBands : []}", "terminal V2 price signal forwarding");

const terminalV2 = read("app/terminal/TerminalChartV2.tsx");
assertIncludes(terminalV2, "priceSignalBands?: PriceSignalBand[]", "terminal V2 price signal prop");
assertIncludes(terminalV2, "priceSignalBands={priceSignalBands}", "terminal V2 price signal forwarding");

console.log("PASS hft overlay guard: execution overlay, slippage bands, and liquidity prediction levels are owned by the chart price-signal boundary and forwarded into the chart stack");