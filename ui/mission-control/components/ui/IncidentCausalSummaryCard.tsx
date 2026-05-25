"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type JsonMap = Record<string, unknown>;

function asMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function asList(value: unknown): JsonMap[] {
  return Array.isArray(value) ? value.filter((item): item is JsonMap => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

type Props = {
  panelTestId?: string;
  title?: string;
};

export default function IncidentCausalSummaryCard({
  panelTestId = "dashboard-incident-causal-summary-panel",
  title = "Freeze causal visible",
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticketKey, setTicketKey] = useState<string | null>(null);
  const [operatorReplay, setOperatorReplay] = useState<JsonMap>({});

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const incidentsResponse = await fetch("/api/incidents", { cache: "no-store" });
        const incidentsPayload = await incidentsResponse.json().catch(() => ({}));
        if (!incidentsResponse.ok) {
          throw new Error("Impossible de charger la causalite incidents");
        }
        const items = asList(asMap(incidentsPayload).items);
        const linkedItem = items.find((item) => Boolean(asMap(item.freeze_link).linked));
        const nextTicketKey = String((linkedItem || {}).ticket_key || "").trim();
        if (!nextTicketKey) {
          if (!cancelled) {
            setTicketKey(null);
            setOperatorReplay({});
          }
          return;
        }
        const replayResponse = await fetch(`/api/incidents/${encodeURIComponent(nextTicketKey)}/replay`, { cache: "no-store" });
        const replayPayload = await replayResponse.json().catch(() => ({}));
        if (!replayResponse.ok) {
          throw new Error("Impossible de charger le replay causal");
        }
        if (!cancelled) {
          setTicketKey(nextTicketKey);
          setOperatorReplay(asMap(asMap(replayPayload).operator_replay));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Erreur inconnue");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const freeze = asMap(operatorReplay.freeze);
  const position = asMap(operatorReplay.position);
  const execution = asMap(operatorReplay.execution);
  const lineage = asMap(execution.lineage_integrity);
  const missingLayers = asStringList(operatorReplay.missing_layers);
  const relatedSymbols = asStringList(position.related_symbols);
  const decisionIds = asStringList(execution.decision_ids);
  const lineageBlockers = asStringList(lineage.blockers);
  const incidentHref = ticketKey ? `/incidents?focus=${encodeURIComponent(ticketKey)}` : "/incidents";

  return (
    <div className="panel runtime-decision-dashboard-panel" data-testid={panelTestId}>
      <div className="eyebrow">{title}</div>
      {loading ? <p className="subtle">Chargement du freeze causal...</p> : null}
      {!loading && error ? <p className="warn">{error}</p> : null}
      {!loading && !error && !ticketKey ? <p className="subtle">Aucun incident relie a un freeze canonique.</p> : null}
      {!loading && !error && ticketKey ? (
        <>
          <div className="row"><span>Incident</span><span>{ticketKey}</span></div>
          <div className="row"><span>Freeze</span><span>{Boolean(freeze.linked) ? `${String(freeze.reason || "freeze_linked")} | event ${String(freeze.freeze_event_id || "-")}` : "non lie"}</span></div>
          <div className="row"><span>Scope</span><span>{String(freeze.provider || position.provider || "global")} | {String(freeze.account_id || position.account_id || "n/a")}</span></div>
          <div className="row"><span>Position</span><span>{`symbols ${relatedSymbols.join(", ") || "n/a"} | divergence ${String(position.critical_symbol_count || 0)} | orphan hedge ${String(position.orphan_hedge_candidate_count || 0)}`}</span></div>
          <div className="row"><span>Execution</span><span>{`decisions ${String(execution.decision_count || 0)} | latest ${String(execution.latest_status || "n/a")}`}</span></div>
          <div className="row"><span>Lineage</span><span>{`${String(lineage.state || "missing")} | partitions ${String(lineage.verified_chain_partition_count || 0)}/${String(lineage.chain_partition_count || 0)} | ${lineageBlockers.join(", ") || "append-only ok"}`}</span></div>
          <div className="row"><span>Decision ids</span><span>{decisionIds.join(", ") || "n/a"}</span></div>
          <div className="row"><span>Missing layers</span><span>{missingLayers.join(", ") || "none"}</span></div>
          <p className="subtle mini" style={{ marginTop: 10 }}>
            <Link href={incidentHref}>Ouvrir le ticket exact</Link>
          </p>
        </>
      ) : null}
    </div>
  );
}