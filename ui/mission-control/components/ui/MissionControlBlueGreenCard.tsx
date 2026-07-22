import Link from "next/link";

import type { MissionControlBlueGreenStatus } from "../../lib/blueGreenUiStatus";
import { UI_TERMS } from "../../lib/uiLexicon";
import OperatorCommandButton from "./OperatorCommandButton";

function toneClass(statusLabel: "LIVE" | "STANDBY" | "DOWN"): string {
  if (statusLabel === "LIVE") {
    return "good";
  }
  if (statusLabel === "STANDBY") {
    return "subtle";
  }
  return "warn";
}

export default function MissionControlBlueGreenCard({
  status,
  compact = false,
  showRollback = false,
}: {
  status: MissionControlBlueGreenStatus;
  compact?: boolean;
  showRollback?: boolean;
}) {
  const liveSlot = status.slots.find((slot) => slot.active) || status.slots[0];
  const standbySlot = status.slots.find((slot) => !slot.active) || status.slots[1] || status.slots[0];
  const rollbackCommand = "/opt/txt/scripts/mission_control_blue_green.sh rollback";

  return (
    <div className="panel txt-blue-green-card">
      <div className="eyebrow">Blue / Green</div>
      <div className={`metric ${liveSlot.statusLabel === "DOWN" ? "warn" : "good"}`}>{status.activeSlot.toUpperCase()}</div>
      <p className="subtle txt-blue-green-card-copy">Switch instantane du trafic UI avec standby verifie avant flip. Aucun rebuild du proxy pendant la bascule.</p>
      <div className="row"><span>Active slot</span><span>{status.activeSlot}</span></div>
      <div className="row"><span>Live health</span><span className={toneClass(liveSlot.statusLabel)}>{liveSlot.statusLabel}</span></div>
      <div className="row"><span>Standby health</span><span className={toneClass(standbySlot.statusLabel)}>{standbySlot.statusLabel}</span></div>
      <div className="row"><span>Standby target</span><span>{status.inactiveSlot}</span></div>
      {!compact ? (
        <>
          <div className="row"><span>Live build</span><span>{liveSlot.buildId || "n/a"}</span></div>
          <div className="row"><span>Standby build</span><span>{standbySlot.buildId || "n/a"}</span></div>
          <div className="row"><span>Gateway include</span><span>{status.slotFileSummary}</span></div>
        </>
      ) : null}
      <div className="txt-blue-green-card-note">{standbySlot.summary}</div>
      <p className="txt-blue-green-card-links">
        <Link href="/live-readiness/ui-blue-green">Vue detaillee</Link>
        {" | "}
        <Link href="/live-readiness/drift-alert-log">{UI_TERMS.driftLog}</Link>
      </p>
      {showRollback ? (
        <div className="operator-command-shell">
          <div className="operator-command-head">
            <strong>Rollback operateur</strong>
            <span className="subtle">Bouton documentaire uniquement, aucune auto-action.</span>
          </div>
          <div className="operator-command-code">{rollbackCommand}</div>
          <div className="operator-command-copy">Utiliser seulement si le standby est sain et que la promotion courante doit etre annulee.</div>
          <OperatorCommandButton command={rollbackCommand} label="Copier la commande rollback" />
        </div>
      ) : null}
    </div>
  );
}
