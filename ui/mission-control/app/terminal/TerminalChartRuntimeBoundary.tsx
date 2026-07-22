"use client";

import { createContext, useContext, useEffect, useMemo, type MutableRefObject, type ReactNode } from "react";

import type { ExecutionEngineV7 } from "../../lib/executionEngineV7";

type JsonMap = Record<string, unknown>;

type TerminalChartRuntimeSnapshot = {
  telemetry: JsonMap[];
  outcomes: JsonMap[];
  symbol: string;
  timeframe: string;
};

type TerminalChartRuntimeProviderProps = {
  children: ReactNode;
  executionChartRuntimeSnapshot: TerminalChartRuntimeSnapshot;
};

type TerminalChartRuntimeContextValue = {
  executionChartRuntimeSnapshot: TerminalChartRuntimeSnapshot;
};

const TerminalChartRuntimeContext = createContext<TerminalChartRuntimeContextValue | null>(null);

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function useTerminalChartRuntimeContext(): TerminalChartRuntimeContextValue {
  const context = useContext(TerminalChartRuntimeContext);
  if (!context) {
    throw new Error("Terminal chart runtime boundary must be used inside its provider.");
  }
  return context;
}

export function TerminalChartRuntimeProvider({ children, executionChartRuntimeSnapshot }: TerminalChartRuntimeProviderProps) {
  const contextValue = useMemo<TerminalChartRuntimeContextValue>(() => ({
    executionChartRuntimeSnapshot,
  }), [executionChartRuntimeSnapshot]);

  return (
    <TerminalChartRuntimeContext.Provider value={contextValue}>
      {children}
    </TerminalChartRuntimeContext.Provider>
  );
}

export function TerminalChartExecutionFeedbackBoundary({ executionEngineV7Ref }: { executionEngineV7Ref: MutableRefObject<ExecutionEngineV7> }) {
  const { executionChartRuntimeSnapshot } = useTerminalChartRuntimeContext();

  useEffect(() => {
    executionChartRuntimeSnapshot.telemetry.slice(0, 8).forEach((item) => {
      executionEngineV7Ref.current.updateFeedback({
        venue: String(item.route_chosen || ""),
        latencyMs: toNumber(item.latency_e2e_ms, 0),
        realizedSlippageBps: toNumber(item.realized_slippage_bps, 0),
      });
    });
  }, [executionChartRuntimeSnapshot.telemetry, executionEngineV7Ref]);

  return null;
}