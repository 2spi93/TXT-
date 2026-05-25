"use client";

import type { ReactNode } from "react";

export type RuntimeGuardrailDetailRow = {
  label: string;
  value: ReactNode;
};

type RuntimeGuardrailSummaryCardProps = {
  title: string;
  subject?: string;
  state: string;
  identityStatus?: string;
  identityDetail?: string;
  readAuthorized?: boolean;
  executionAuthorized?: boolean;
  allowedPaths?: string[];
  blockedPaths?: string[];
  blockReasons?: string[];
  detailRows?: RuntimeGuardrailDetailRow[];
  compact?: boolean;
};

export function runtimeToneClass(value: string): "good" | "warn" | "metric" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ok") {
    return "good";
  }
  if (normalized === "review") {
    return "metric";
  }
  return "warn";
}

export function formatRuntimeStateLabel(value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ok") {
    return "autorise";
  }
  if (normalized === "review") {
    return "a revoir";
  }
  if (normalized === "blocked") {
    return "bloque";
  }
  return normalized || "inconnu";
}

export function formatRuntimeIdentityLabel(value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "verified") {
    return "verifiee";
  }
  if (normalized === "ambiguous") {
    return "ambiguë";
  }
  if (normalized === "provider_mismatch") {
    return "provider mismatch";
  }
  if (normalized === "missing") {
    return "manquante";
  }
  return normalized || "inconnue";
}

export function formatRuntimePathsLabel(values: string[] | null | undefined): string {
  const rows = Array.isArray(values) ? values.filter(Boolean) : [];
  if (rows.length === 0) {
    return "aucun";
  }
  return rows.map((item) => String(item).replace(/_/g, " ")).join(" · ");
}

export default function RuntimeGuardrailSummaryCard({
  title,
  subject = "",
  state,
  identityStatus = "unknown",
  identityDetail = "",
  readAuthorized = false,
  executionAuthorized = false,
  allowedPaths = [],
  blockedPaths = [],
  blockReasons = [],
  detailRows = [],
  compact = false,
}: RuntimeGuardrailSummaryCardProps) {
  const visibleDetailRows = detailRows.filter((row) => row.value !== null && row.value !== undefined && row.value !== "");

  return (
    <div className="panel" style={{ borderRadius: 12 }}>
      <div className="eyebrow">{title}</div>
      {(subject || state) ? (
        <div className="row">
          <span>{subject || "Runtime"}</span>
          <span className={runtimeToneClass(state)}>{formatRuntimeStateLabel(state)}</span>
        </div>
      ) : null}
      <div className="row">
        <span>Identité</span>
        <span>
          {formatRuntimeIdentityLabel(identityStatus)}
          {identityDetail ? ` · ${identityDetail}` : ""}
        </span>
      </div>
      <div className="row">
        <span>Autorisations</span>
        <span>
          read={String(Boolean(readAuthorized))} | execute={String(Boolean(executionAuthorized))}
        </span>
      </div>
      {!compact ? (
        <>
          <div className="row"><span>Chemins autorisés</span><span>{formatRuntimePathsLabel(allowedPaths)}</span></div>
          <div className="row"><span>Chemins bloqués</span><span>{formatRuntimePathsLabel(blockedPaths)}</span></div>
          <div className="row"><span>Motifs</span><span>{blockReasons.length > 0 ? blockReasons.join(" · ") : "aucun"}</span></div>
        </>
      ) : null}
      {visibleDetailRows.map((row) => (
        <div className="row" key={`${title}-${row.label}`}>
          <span>{row.label}</span>
          <span>{row.value}</span>
        </div>
      ))}
    </div>
  );
}