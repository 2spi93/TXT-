"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { GovernanceMonitoringPanel, IncidentsMonitoringPanel } from "./TerminalSecondaryPanels";

type GovernanceSort = "severity" | "label" | "value";
type IncidentSort = "severity" | "status" | "sla";
type GovernanceRow = { label: string; value: string; severity: number };
type IncidentRecord = Record<string, unknown>;
type IncidentItemRow = {
  item: IncidentRecord;
  status: string;
  severityLabel: string;
  severityRank: number;
  slaLabel: string;
};
type SharedPanelProps = {
  badge: ReactNode;
  layoutEditMode: boolean;
  onDetach: () => void;
};
type TerminalGovernancePanelsProviderProps = {
  children: ReactNode;
  governanceRows: GovernanceRow[];
  incidents: IncidentRecord[];
};
type TerminalGovernancePanelsContextValue = {
  incidents: IncidentRecord[];
  governanceSort: GovernanceSort;
  setGovernanceSort: (value: GovernanceSort) => void;
  incidentSort: IncidentSort;
  setIncidentSort: (value: IncidentSort) => void;
  governanceOnlyAlerts: boolean;
  setGovernanceOnlyAlerts: (value: boolean) => void;
  governanceFilterText: string;
  setGovernanceFilterText: (value: string) => void;
  governanceFiltered: GovernanceRow[];
  incidentRows: IncidentItemRow[];
};

const TerminalGovernancePanelsContext = createContext<TerminalGovernancePanelsContextValue | null>(null);

function incidentSeverityLabel(item: IncidentRecord): string {
  return String(item.severity || item.level || item.priority || "info").toLowerCase();
}

function incidentSeverityRank(item: IncidentRecord): number {
  const severity = incidentSeverityLabel(item);
  if (["critical", "sev1", "p1", "high"].includes(severity)) {
    return 4;
  }
  if (["major", "sev2", "p2", "medium"].includes(severity)) {
    return 3;
  }
  if (["minor", "sev3", "p3", "low", "warning", "warn"].includes(severity)) {
    return 2;
  }
  return 1;
}

function incidentStatusRank(item: IncidentRecord): number {
  const status = String(item.status || "open").toLowerCase();
  if (["open", "new", "triggered"].includes(status)) {
    return 5;
  }
  if (["investigating", "triage", "mitigating"].includes(status)) {
    return 4;
  }
  if (["monitoring", "watching"].includes(status)) {
    return 3;
  }
  if (["resolved", "mitigated"].includes(status)) {
    return 2;
  }
  if (["closed", "done"].includes(status)) {
    return 1;
  }
  return 3;
}

function incidentSlaLabel(item: IncidentRecord): string {
  return Boolean(item.sla_breached) ? "breach" : "within";
}

function useTerminalGovernancePanelsContext(): TerminalGovernancePanelsContextValue {
  const context = useContext(TerminalGovernancePanelsContext);
  if (!context) {
    throw new Error("Terminal governance panels boundary must be used inside its provider.");
  }
  return context;
}

export function TerminalGovernancePanelsProvider({ children, governanceRows, incidents }: TerminalGovernancePanelsProviderProps) {
  const [governanceSort, setGovernanceSort] = useState<GovernanceSort>("severity");
  const [incidentSort, setIncidentSort] = useState<IncidentSort>("severity");
  const [governanceOnlyAlerts, setGovernanceOnlyAlerts] = useState(false);
  const [governanceFilterText, setGovernanceFilterText] = useState("");
  const governanceQuery = governanceFilterText.trim().toLowerCase();

  const governanceFiltered = useMemo(() => governanceRows
    .filter((row) => !governanceOnlyAlerts || row.severity >= 2)
    .filter((row) => !governanceQuery || row.label.toLowerCase().includes(governanceQuery) || row.value.toLowerCase().includes(governanceQuery))
    .sort((left, right) => {
      if (governanceSort === "label") {
        return left.label.localeCompare(right.label);
      }
      if (governanceSort === "value") {
        return right.value.localeCompare(left.value, undefined, { numeric: true });
      }
      return right.severity - left.severity;
    }), [governanceOnlyAlerts, governanceQuery, governanceRows, governanceSort]);

  const incidentRows = useMemo(() => incidents
    .map((item) => ({
      item,
      status: String(item.status || "open"),
      severityLabel: incidentSeverityLabel(item),
      severityRank: incidentSeverityRank(item),
      slaLabel: incidentSlaLabel(item),
    }))
    .filter((row) => !governanceOnlyAlerts || row.severityRank >= 3 || row.slaLabel === "breach")
    .filter((row) => {
      if (!governanceQuery) {
        return true;
      }

      const ticket = String(row.item.ticket_key || "").toLowerCase();
      const title = String(row.item.title || "").toLowerCase();
      const status = row.status.toLowerCase();
      return ticket.includes(governanceQuery)
        || title.includes(governanceQuery)
        || status.includes(governanceQuery)
        || row.severityLabel.includes(governanceQuery)
        || row.slaLabel.includes(governanceQuery);
    })
    .sort((left, right) => {
      if (incidentSort === "status") {
        return incidentStatusRank(right.item) - incidentStatusRank(left.item);
      }
      if (incidentSort === "sla") {
        return Number(Boolean(right.item.sla_breached)) - Number(Boolean(left.item.sla_breached));
      }
      return right.severityRank - left.severityRank;
    }), [governanceOnlyAlerts, governanceQuery, incidentSort, incidents]);

  const contextValue = useMemo<TerminalGovernancePanelsContextValue>(() => ({
    incidents,
    governanceSort,
    setGovernanceSort,
    incidentSort,
    setIncidentSort,
    governanceOnlyAlerts,
    setGovernanceOnlyAlerts,
    governanceFilterText,
    setGovernanceFilterText,
    governanceFiltered,
    incidentRows,
  }), [governanceFilterText, governanceFiltered, governanceOnlyAlerts, governanceSort, incidentRows, incidentSort, incidents]);

  return (
    <TerminalGovernancePanelsContext.Provider value={contextValue}>
      {children}
    </TerminalGovernancePanelsContext.Provider>
  );
}

export function TerminalGovernanceMonitoringBoundary({ badge, layoutEditMode, onDetach }: SharedPanelProps) {
  const {
    governanceSort,
    setGovernanceSort,
    incidentSort,
    setIncidentSort,
    governanceOnlyAlerts,
    setGovernanceOnlyAlerts,
    governanceFilterText,
    setGovernanceFilterText,
    governanceFiltered,
  } = useTerminalGovernancePanelsContext();

  return (
    <GovernanceMonitoringPanel
      badge={badge}
      layoutEditMode={layoutEditMode}
      onDetach={onDetach}
      governanceSort={governanceSort}
      onGovernanceSortChange={setGovernanceSort}
      incidentSort={incidentSort}
      onIncidentSortChange={setIncidentSort}
      governanceOnlyAlerts={governanceOnlyAlerts}
      onGovernanceOnlyAlertsChange={setGovernanceOnlyAlerts}
      governanceFilterText={governanceFilterText}
      onGovernanceFilterTextChange={setGovernanceFilterText}
      governanceFiltered={governanceFiltered}
    />
  );
}

export function TerminalIncidentsMonitoringBoundary({ badge, layoutEditMode, onDetach }: SharedPanelProps) {
  const { incidents, incidentRows } = useTerminalGovernancePanelsContext();

  return (
    <IncidentsMonitoringPanel
      badge={badge}
      layoutEditMode={layoutEditMode}
      onDetach={onDetach}
      incidents={incidents}
      incidentRows={incidentRows}
    />
  );
}