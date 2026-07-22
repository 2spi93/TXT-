"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { ExecutionSmartTrackerPanel } from "./TerminalSecondaryPanels";

type SharedPanelProps = {
  badge: ReactNode;
  layoutEditMode: boolean;
  onDetach: () => void;
  formatClock: (value: string) => string;
};

type ExecutionSmartTrackerMonitoringSnapshot = {
  telemetry: Array<Record<string, unknown>>;
  outcomes: Array<Record<string, unknown>>;
  preview: Record<string, unknown> | null;
  symbol: string;
};

type TerminalExecutionMonitoringProviderProps = {
  children: ReactNode;
  executionSmartTrackerMonitoringSnapshot: ExecutionSmartTrackerMonitoringSnapshot;
};

type TerminalExecutionMonitoringContextValue = {
  executionSmartTrackerMonitoringSnapshot: ExecutionSmartTrackerMonitoringSnapshot;
};

const TerminalExecutionMonitoringContext = createContext<TerminalExecutionMonitoringContextValue | null>(null);

function useTerminalExecutionMonitoringContext(): TerminalExecutionMonitoringContextValue {
  const context = useContext(TerminalExecutionMonitoringContext);
  if (!context) {
    throw new Error("Terminal execution monitoring boundary must be used inside its provider.");
  }
  return context;
}

export function TerminalExecutionMonitoringProvider({ children, executionSmartTrackerMonitoringSnapshot }: TerminalExecutionMonitoringProviderProps) {
  const contextValue = useMemo<TerminalExecutionMonitoringContextValue>(() => ({
    executionSmartTrackerMonitoringSnapshot,
  }), [executionSmartTrackerMonitoringSnapshot]);

  return (
    <TerminalExecutionMonitoringContext.Provider value={contextValue}>
      {children}
    </TerminalExecutionMonitoringContext.Provider>
  );
}

export function TerminalExecutionSmartMonitoringBoundary({ badge, layoutEditMode, onDetach, formatClock }: SharedPanelProps) {
  const { executionSmartTrackerMonitoringSnapshot } = useTerminalExecutionMonitoringContext();

  return (
    <ExecutionSmartTrackerPanel
      badge={badge}
      layoutEditMode={layoutEditMode}
      onDetach={onDetach}
      telemetry={executionSmartTrackerMonitoringSnapshot.telemetry}
      outcomes={executionSmartTrackerMonitoringSnapshot.outcomes}
      preview={executionSmartTrackerMonitoringSnapshot.preview}
      symbol={executionSmartTrackerMonitoringSnapshot.symbol}
      formatClock={formatClock}
    />
  );
}