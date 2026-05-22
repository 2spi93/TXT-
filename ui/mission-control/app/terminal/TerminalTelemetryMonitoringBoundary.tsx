"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { VenueTelemetryMonitoringPanel } from "./TerminalSecondaryPanels";

type SharedPanelProps = {
  badge: ReactNode;
  layoutEditMode: boolean;
  onDetach: () => void;
  formatClock: (value: string) => string;
};

type TerminalTelemetryMonitoringProviderProps = {
  children: ReactNode;
  marketVenueTelemetryPayload: Record<string, unknown> | null;
  routeVenueTelemetryPayload: Record<string, unknown> | null;
};

type TerminalTelemetryMonitoringContextValue = {
  marketVenueTelemetryPayload: Record<string, unknown> | null;
  routeVenueTelemetryPayload: Record<string, unknown> | null;
};

const TerminalTelemetryMonitoringContext = createContext<TerminalTelemetryMonitoringContextValue | null>(null);

function useTerminalTelemetryMonitoringContext(): TerminalTelemetryMonitoringContextValue {
  const context = useContext(TerminalTelemetryMonitoringContext);
  if (!context) {
    throw new Error("Terminal telemetry monitoring boundary must be used inside its provider.");
  }
  return context;
}

export function TerminalTelemetryMonitoringProvider({
  children,
  marketVenueTelemetryPayload,
  routeVenueTelemetryPayload,
}: TerminalTelemetryMonitoringProviderProps) {
  const contextValue = useMemo<TerminalTelemetryMonitoringContextValue>(() => ({
    marketVenueTelemetryPayload,
    routeVenueTelemetryPayload,
  }), [marketVenueTelemetryPayload, routeVenueTelemetryPayload]);

  return (
    <TerminalTelemetryMonitoringContext.Provider value={contextValue}>
      {children}
    </TerminalTelemetryMonitoringContext.Provider>
  );
}

export function TerminalVenueTelemetryMonitoringBoundary({ badge, layoutEditMode, onDetach, formatClock }: SharedPanelProps) {
  const { marketVenueTelemetryPayload, routeVenueTelemetryPayload } = useTerminalTelemetryMonitoringContext();

  return (
    <VenueTelemetryMonitoringPanel
      badge={badge}
      layoutEditMode={layoutEditMode}
      onDetach={onDetach}
      marketPayload={marketVenueTelemetryPayload}
      routePayload={routeVenueTelemetryPayload}
      formatClock={formatClock}
    />
  );
}