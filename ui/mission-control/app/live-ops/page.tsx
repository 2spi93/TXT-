"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import HelpHint from "../../components/HelpHint";
import TxtMiniGuide from "../../components/ui/TxtMiniGuide";
import { ControlRoomMonitoringPanel } from "../terminal/TerminalSecondaryPanels";

type JsonMap = Record<string, unknown>;

function formatClock(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value || "-";
  }
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }).format(new Date(parsed));
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : {};
}

export default function LiveOpsPage() {
  const [liveOpsPayload, setLiveOpsPayload] = useState<JsonMap | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emergencyStopBusy, setEmergencyStopBusy] = useState(false);
  const [emergencyStopFeedback, setEmergencyStopFeedback] = useState<string | null>(null);

  async function loadData(): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch("/api/system/live-ops", { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(String(payload && typeof payload === "object" ? (payload as JsonMap).detail || "Live Ops indisponible" : "Live Ops indisponible"));
      }
      const payload = await response.json();
      setLiveOpsPayload(payload && typeof payload === "object" ? payload as JsonMap : null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }

  async function triggerEmergencyStop(): Promise<void> {
    setEmergencyStopBusy(true);
    setEmergencyStopFeedback(null);
    try {
      const response = await fetch("/api/system/emergency-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "live-ops-page" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(String(payload && typeof payload === "object" ? (payload as JsonMap).detail || "Emergency stop refuse" : "Emergency stop refuse"));
      }
      setEmergencyStopFeedback(String(payload && typeof payload === "object" ? (payload as JsonMap).detail || "Emergency stop envoye" : "Emergency stop envoye"));
      await loadData();
    } catch (err) {
      setEmergencyStopFeedback(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setEmergencyStopBusy(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      if (!mounted) {
        return;
      }
      await loadData();
    };
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 15_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const snapshot = asRecord(liveOpsPayload);
  const watchdog = asRecord(snapshot.watchdog_state);
  const governance = asRecord(snapshot.governance);
  const recovery = asRecord(snapshot.recovery);
  const memoryGap = asRecord(snapshot.memory_gap);
  const alerts = Array.isArray(snapshot.alerts) ? snapshot.alerts : [];

  return (
    <main className="shell txt-page-shell">
      <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1.25fr 1fr" }}>
        <div className="panel txt-page-hero">
          <div className="eyebrow">Live Ops Control Room <HelpHint text="Vue operationnelle pour watchdog, gouvernance, recovery et arbitrage live." examples={["Si watchdog passe WARNING ou HALT, traite le risque avant toute execution.", "Si memory gate devient BLOCKED ou si recovery est actif, reste en mode defensif."]} /></div>
          <h1 className="title" style={{ fontSize: 34 }}>H24 Control Room</h1>
          <p className="subtle">Route dediee au pilotage live des gardes systeme, de la recovery et de la warfare logic. Le menu global pointe maintenant vers une vraie page, plus vers une route manquante.</p>
          <TxtMiniGuide
            title="Guide Live Ops"
            what="Etat du watchdog, gouvernance live, memory gate et arbitrage executable."
            why="Savoir en quelques secondes si le systeme peut continuer a executer sans degrader le capital."
            example="Si le system mode reste SAFE mais que recovery est active et le watchdog tombe sous 80%, reduis le risque et investigue."
            terms={["watchdog", "recovery", "memory gate"]}
          />
          <p>
            <Link href="/">Dashboard</Link>
            {" | "}
            <Link href="/terminal">Terminal</Link>
            {" | "}
            <Link href="/live-readiness">Readiness</Link>
            {" | "}
            <Link href="/incidents">Incidents</Link>
          </p>
          {error ? <p className="warn">{error}</p> : null}
        </div>
        <div className="panel">
          <div className="eyebrow">Etat Global</div>
          <div className="row"><span>Watchdog</span><span className={String(watchdog.status || "UNKNOWN") === "OK" ? "good" : "warn"}>{String(watchdog.status || "UNKNOWN")}</span></div>
          <div className="row"><span>Health score</span><span>{toNumber(watchdog.health_score, 0).toFixed(0)}%</span></div>
          <div className="row"><span>System mode</span><span className={String(governance.mode || "SAFE") === "LIVE" ? "good" : String(governance.mode || "SAFE") === "LOCKED" ? "warn" : "subtle"}>{String(governance.mode || "SAFE")}</span></div>
          <div className="row"><span>Recovery</span><span>{String(recovery.mode || "NOMINAL")}</span></div>
          <div className="row"><span>Memory gate</span><span className={String(memoryGap.memory_decision || "OK") === "OK" ? "good" : "warn"}>{String(memoryGap.memory_decision || "OK")}</span></div>
          <div className="row"><span>Alertes live</span><span>{String(alerts.length)}</span></div>
          <div className="row"><span>Refresh</span><span>{loading ? "bootstrap" : busy ? "sync" : "15s"}</span></div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <div className="panel">
          <ControlRoomMonitoringPanel
            badge={null}
            layoutEditMode={false}
            onDetach={() => {}}
            liveOpsPayload={liveOpsPayload}
            emergencyStopBusy={emergencyStopBusy}
            emergencyStopFeedback={emergencyStopFeedback}
            onEmergencyStop={() => { void triggerEmergencyStop(); }}
            formatClock={formatClock}
          />
        </div>
      </section>
    </main>
  );
}