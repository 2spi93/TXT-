import Link from "next/link";

import MissionControlBlueGreenCard from "../../../components/ui/MissionControlBlueGreenCard";
import OperatorPanelGuide from "../../../components/ui/OperatorPanelGuide";
import { readMissionControlBlueGreenStatus } from "../../../lib/blueGreenUiStatus";

function toneClass(statusLabel: "LIVE" | "STANDBY" | "DOWN"): string {
  if (statusLabel === "LIVE") {
    return "good";
  }
  if (statusLabel === "STANDBY") {
    return "subtle";
  }
  return "warn";
}

export default async function UiBlueGreenPage() {
  const blueGreen = await readMissionControlBlueGreenStatus();

  return (
    <main className="shell txt-page-shell" data-testid="ui-blue-green-page">
      <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1.35fr 1fr" }}>
        <div className="panel txt-page-hero">
          <div className="eyebrow">UI Blue / Green</div>
          <h1 className="title" style={{ fontSize: 34 }}>Etat operateur des slots Mission Control UI</h1>
          <p className="subtle txt-page-hero-copy">Cette page montre quel slot UI sert le trafic, quel slot est en standby, et si les deux environnements repondent reellement sur le reseau compose.</p>
          <OperatorPanelGuide
            title="Guide Blue Green"
            what="Le slot actif, le standby, les build IDs et la joignabilite des deux UIs."
            why="Verifier la capacite de promotion et rollback sans couper le terminal live."
            example="Si le slot standby repond avec un build ID recent, tu peux le promouvoir; s'il est DOWN, tu ne flips pas."
          />
          <div className="txt-page-guide-note">
            <strong>Regle operateur</strong>
            Promotion seulement si le slot inactif repond et porte bien le build attendu. Rollback = flip symetrique, jamais rebuild du proxy.
          </div>
          <p>
            <Link href="/dashboard">Dashboard</Link>
            {" | "}
            <Link href="/live-readiness">Live Readiness</Link>
            {" | "}
            <Link href="/live-readiness/drift-alert-log">Drift Alert Log</Link>
            {" | "}
            <Link href="/terminal">Trading Terminal</Link>
          </p>
        </div>
        <MissionControlBlueGreenCard status={blueGreen} showRollback />
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        {blueGreen.slots.map((slot) => (
          <div key={slot.slot} className="panel">
            <div className="eyebrow">Slot {slot.slot.toUpperCase()}</div>
            <div className={`metric ${toneClass(slot.statusLabel)}`}>{slot.statusLabel}</div>
            <div className="row"><span>Role</span><span className={slot.active ? "good" : "subtle"}>{slot.active ? "LIVE" : "STANDBY"}</span></div>
            <div className="row"><span>Service</span><span>{slot.service}</span></div>
            <div className="row"><span>Port</span><span>{slot.port}</span></div>
            <div className="row"><span>HTTP</span><span>{slot.httpStatus ?? "n/a"}</span></div>
            <div className="row"><span>Build ID</span><span>{slot.buildId || "n/a"}</span></div>
            <div className="row"><span>Dist dir</span><span>{slot.distDir}</span></div>
            <div className="row"><span>URL</span><span>{slot.url}</span></div>
            <p className="subtle" style={{ marginTop: 10 }}>{slot.summary}</p>
          </div>
        ))}
      </section>
    </main>
  );
}