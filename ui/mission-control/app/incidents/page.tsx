"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import HelpHint from "../../components/HelpHint";
import TxtMiniGuide from "../../components/ui/TxtMiniGuide";

type JsonMap = Record<string, unknown>;

export default function IncidentsPage() {
  const [items, setItems] = useState<JsonMap[]>([]);
  const [slaMinutes, setSlaMinutes] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState("Resolved after review");

  async function loadIncidents(status: string = statusFilter): Promise<void> {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
    const response = await fetch(`/api/incidents${suffix}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Impossible de charger les incidents");
    }
    const payload = await response.json();
    setSlaMinutes(Number(payload.sla_minutes || 0));
    setItems((payload.items as JsonMap[] | undefined) || []);
  }

  useEffect(() => {
    loadIncidents().catch((err) => setError(err instanceof Error ? err.message : "Erreur inconnue"));
    const timer = window.setInterval(() => {
      void loadIncidents();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const slaBreachedCount = items.filter((x) => Boolean(x.sla_breached)).length;

  async function assignTicket(ticketKey: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(ticketKey)}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(String(payload?.detail || "Assignation impossible"));
      }
      await loadIncidents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function closeTicket(ticketKey: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(ticketKey)}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution_note: resolutionNote }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(String(payload?.detail || "Cloture impossible"));
      }
      await loadIncidents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell txt-page-shell">
      <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div className="panel txt-page-hero">
          <div className="eyebrow">Incident Desk <HelpHint text="Console d'incidents: suivi, assignation, cloture, traçabilite operationnelle." examples={["Exemple simple: filtre open, assigne un ticket a toi, corrige, puis close avec une note claire.", "Si un incident touche execution ou broker, ouvre aussi Trading Terminal pour voir l'etat global."]} /></div>
          <h1 className="title" style={{ fontSize: 34 }}>Incidents Operations</h1>
          <p className="subtle">Pilote les incidents ouverts par le chatbot et les operateurs.</p>
          <TxtMiniGuide
            title="Guide Incidents"
            what="Backlog des incidents operationnels avec assignation et cloture tracees."
            why="Reagir vite sans perdre la traçabilite des decisions prises en exploitation."
            example="Prends ownership, investigue la cause, puis close avec une note claire et actionnable."
          />
          <p>
            <Link href="/">Dashboard</Link>
            {" | "}
            <Link href="/terminal">Trading Terminal</Link>
            {" | "}
            <Link href="/live-readiness">Live Readiness</Link>
            {" | "}
            <Link href="/ai">IA</Link>
          </p>
          {error ? <p className="warn">{error}</p> : null}
        </div>
        <div className="panel">
          <div className="eyebrow">Filtres <HelpHint text="Filtre rapide par statut incident." examples={["Choisis open pour traiter d'abord le backlog critique du moment.", "Resolution note sera reutilisee a la cloture, donc ecris directement une phrase utile."]} /></div>
          {slaBreachedCount > 0 ? (
            <p className="warn">Alerte: {slaBreachedCount} incident(s) non assignes au-dela de {slaMinutes} min.</p>
          ) : null}
          <div className="form-grid">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">all</option>
              <option value="open">open</option>
              <option value="assigned">assigned</option>
              <option value="closed">closed</option>
            </select>
            <button type="button" disabled={busy} onClick={() => void loadIncidents(statusFilter)}>
              {busy ? "Chargement..." : "Appliquer filtre"}
            </button>
            <input value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} placeholder="Resolution note" />
          </div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="panel">
          <div className="eyebrow">Liste incidents <HelpHint text="Assigner un ticket a soi puis le cloturer avec note de resolution." examples={["Assign to me quand tu prends la main sur le sujet.", "Close seulement quand la cause est comprise et que la note de resolution permet a un autre operateur de suivre."]} /></div>
          {items.length === 0 ? <p className="subtle">Aucun incident.</p> : null}
          {items.map((item) => {
            const key = String(item.ticket_key || "");
            const status = String(item.status || "");
            const age = Number(item.age_minutes || 0);
            const sla = Boolean(item.sla_breached);
            return (
              <div className="row" key={key}>
                <span>
                  {key} | {String(item.severity || "-")} | {String(item.title || "-")} | assignee={String(item.assignee || "-")} | age={age}m | SLA={String(sla)}
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button type="button" disabled={busy || status === "closed"} onClick={() => void assignTicket(key)}>Assign to me</button>
                  <button type="button" disabled={busy || status === "closed"} onClick={() => void closeTicket(key)}>Close</button>
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
