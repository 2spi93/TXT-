import Link from "next/link";

import OperatorPanelGuide from "../../../components/ui/OperatorPanelGuide";
import TradabilityScienceDesk from "../../../components/ui/TradabilityScienceDesk";
import { getEdgeObservationSummary, type EdgeDeltaRow, type EdgeMapRow } from "../../../lib/edgeObservation";

export const dynamic = "force-dynamic";

function toneClass(value: number): string {
  if (value > 0) {
    return "good";
  }
  if (value < 0) {
    return "warn";
  }
  return "subtle";
}

function confidenceClass(value: string): string {
  if (value === "HIGH") {
    return "good";
  }
  if (value === "MEDIUM") {
    return "subtle";
  }
  return "warn";
}

function stalenessClass(value: string): string {
  if (value === "FRESH") {
    return "good";
  }
  if (value === "AGING") {
    return "subtle";
  }
  return "warn";
}

function formatPct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatSigned(value: number, digits = 2): string {
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

function heatmapCellStyle(meanPnlBps: number, confidencePct: number): React.CSSProperties {
  const alpha = Math.max(0.14, Math.min(0.7, confidencePct / 100));
  if (meanPnlBps > 0) {
    return {
      background: `rgba(22, 163, 74, ${alpha})`,
      color: "#f8fafc",
    };
  }
  if (meanPnlBps < 0) {
    return {
      background: `rgba(220, 38, 38, ${alpha})`,
      color: "#f8fafc",
    };
  }
  return {
    background: `rgba(100, 116, 139, ${Math.max(0.12, alpha * 0.8)})`,
    color: "#e2e8f0",
  };
}

function renderHeatmap(rows: EdgeMapRow[]) {
  if (rows.length === 0) {
    return <p className="subtle">Le heatmap apparaitra des que les premiers labels classifies recouvrants arriveront.</p>;
  }

  const reactionOrder = ["FAST", "MEDIUM", "SLOW"];
  const regimeOrder = ["TREND", "RANGE", "CHAOTIC", "HIGH_VOL", "LOW_LIQUIDITY"];
  const table = new Map(rows.map((row) => [`${row.reactionClass}:${row.regime}`, row]));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px repeat(5, minmax(96px, 1fr))", gap: 8, alignItems: "stretch" }}>
      <div />
      {regimeOrder.map((regime) => (
        <div key={regime} className="subtle" style={{ fontSize: 12, textAlign: "center", fontWeight: 700 }}>{regime}</div>
      ))}
      {reactionOrder.map((reaction) => (
        <>
          <div key={`${reaction}-label`} className="subtle" style={{ display: "flex", alignItems: "center", fontSize: 12, fontWeight: 700 }}>{reaction}</div>
          {regimeOrder.map((regime) => {
            const cell = table.get(`${reaction}:${regime}`);
            return (
              <div
                key={`${reaction}-${regime}`}
                style={{
                  minHeight: 72,
                  borderRadius: 14,
                  padding: 10,
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  ...(cell ? heatmapCellStyle(cell.meanPnlBps, cell.confidenceScorePct) : { background: "rgba(15, 23, 42, 0.38)", color: "#94a3b8" }),
                }}
              >
                {cell ? (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>{formatSigned(cell.meanPnlBps, 1)} bps</div>
                    <div style={{ fontSize: 11, opacity: 0.92 }}>n={cell.count} · wr {formatPct(cell.winrate, 0)}</div>
                    <div style={{ fontSize: 10, opacity: 0.85 }}>{cell.confidenceLevel} · {cell.confidenceScorePct}%</div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, opacity: 0.85 }}>no overlap yet</div>
                )}
              </div>
            );
          })}
        </>
      ))}
    </div>
  );
}

function renderDeltaTable(rows: EdgeDeltaRow[]) {
  if (rows.length === 0) {
    return <p className="subtle">Aucun edge classe sur les 24 dernieres heures. La vue restera vide tant que des labels frais ne recouvrent pas reaction et regime.</p>;
  }
  return (
    <div className="txt-scroll-shell" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th align="left">Edge</th>
            <th align="right">24h</th>
            <th align="right">Prev 24h</th>
            <th align="right">Delta count</th>
            <th align="right">Mean pnl</th>
            <th align="right">Delta pnl</th>
            <th align="right">Winrate</th>
            <th align="right">Delta wr</th>
            <th align="right">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.edgeKey}>
              <td style={{ padding: "8px 0" }}>
                <strong>{row.reactionClass}</strong>
                {" + "}
                <strong>{row.regime}</strong>
              </td>
              <td align="right">{row.count}</td>
              <td align="right">{row.countPrev24h}</td>
              <td align="right" className={toneClass(row.deltaCount)}>{formatSigned(row.deltaCount, 0)}</td>
              <td align="right" className={toneClass(row.meanPnlBps)}>{formatSigned(row.meanPnlBps, 2)} bps</td>
              <td align="right" className={toneClass(row.deltaMeanPnlBps)}>{formatSigned(row.deltaMeanPnlBps, 2)} bps</td>
              <td align="right">{formatPct(row.winrate)}</td>
              <td align="right" className={toneClass(row.deltaWinratePct)}>{formatSigned(row.deltaWinratePct, 1)} pts</td>
              <td align="right" className={confidenceClass(row.confidenceLevel)}>{row.confidenceLevel} · {row.confidenceScorePct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderAllTimeTable(rows: EdgeMapRow[]) {
  if (rows.length === 0) {
    return <p className="subtle">Aucune cellule edge classee sur l’historique actuel.</p>;
  }
  return (
    <div className="txt-scroll-shell" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th align="left">Edge</th>
            <th align="right">Count</th>
            <th align="right">Mean pnl</th>
            <th align="right">Median pnl</th>
            <th align="right">Winrate</th>
            <th align="right">Regime conf</th>
            <th align="right">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.edgeKey}>
              <td style={{ padding: "8px 0" }}>{row.edgeKey}</td>
              <td align="right">{row.count}</td>
              <td align="right" className={toneClass(row.meanPnlBps)}>{formatSigned(row.meanPnlBps, 2)} bps</td>
              <td align="right">{formatSigned(row.medianPnlBps, 2)} bps</td>
              <td align="right">{formatPct(row.winrate)}</td>
              <td align="right">{row.avgRegimeConfidence == null ? "-" : `${(row.avgRegimeConfidence * 100).toFixed(0)}%`}</td>
              <td align="right" className={confidenceClass(row.confidenceLevel)}>{row.confidenceLevel} · {row.confidenceScorePct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function EdgeMapPage() {
  const summary = await getEdgeObservationSummary(24);
  const topEdge = summary.recentDeltas[0] || summary.allTimeMap[0] || null;

  return (
    <main className="shell txt-page-shell" data-testid="edge-map-page">
      <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div className="panel txt-page-hero">
          <div className="eyebrow">Edge Map Observation</div>
          <h1 className="title" style={{ fontSize: 34 }}>Carte read-only de l’edge reaction × regime</h1>
          <p className="subtle txt-page-hero-copy">Cette vue ne pilote rien. Elle lit seulement les labels joins et montre ou le marche semble donner quelque chose, avec le niveau de confiance de l’observation.</p>
          <OperatorPanelGuide
            title="Guide Edge Map"
            what="Une carte simple des cellules reaction_class × regime, avec leurs deltas 24h et leur niveau de confiance observationnel."
            why="Voir si le contexte devient exploitable sans confondre lenteur du marche et edge reel."
            example="Si SLOW + RANGE reste proche de zero avec confiance basse, on observe encore. Si SLOW + TREND monte avec plus de labels, on documente avant toute decision policy."
          />
          <div className="txt-page-guide-note">
            <strong>Regle d’usage</strong>
            Lecture uniquement. Aucun bouton d’activation, aucun controle de trading, aucune ecriture de policy.
          </div>
          <p>
            <Link href="/dashboard">Dashboard</Link>
            {" | "}
            <Link href="/live-readiness">Live Readiness</Link>
            {" | "}
            <Link href="/live-readiness/market-state-map">Market State Map</Link>
            {" | "}
            <Link href="/live-readiness/drift-alert-log">Drift Alert Log</Link>
            {" | "}
            <Link href="/terminal">Trading Terminal</Link>
          </p>
        </div>

        <div className="panel">
          <div className="eyebrow">Live Read</div>
          <div className={`metric ${confidenceClass(summary.liveConfidence.level)}`}>{summary.liveConfidence.level}</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(15, 23, 42, 0.38)" }}>
            <span className={stalenessClass(summary.staleness.level)} style={{ fontSize: 12, fontWeight: 700 }}>{summary.staleness.level}</span>
            <span className="subtle" style={{ fontSize: 12 }}>{summary.staleness.ageHours == null ? "no classified label yet" : `${summary.staleness.ageHours}h since last classified label`}</span>
          </div>
          <div className="row"><span>Confidence</span><span>{summary.liveConfidence.scorePct}%</span></div>
          <div className="row"><span>Rows</span><span>{summary.totals.totalRows}</span></div>
          <div className="row"><span>Classified</span><span>{summary.totals.classifiedRows} ({summary.totals.classifiedPct}%)</span></div>
          <div className="row"><span>Recent 24h</span><span>{summary.totals.recentClassifiedRows} / {summary.totals.recentRows}</span></div>
          <div className="row"><span>Latest label</span><span>{summary.latestIntentAt || "-"}</span></div>
          <div className="row"><span>Latest classified</span><span>{summary.latestClassifiedIntentAt || "-"}</span></div>
          <div className="row"><span>File updated</span><span>{summary.fileUpdatedAt || "-"}</span></div>
          <div className="row"><span>Top edge</span><span>{topEdge ? `${topEdge.edgeKey} · ${formatSigned(topEdge.meanPnlBps, 2)}bps` : "none"}</span></div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginBottom: 16 }}>
        <div className="panel">
          <div className="eyebrow">Coverage</div>
          <div className="row"><span>All-time classified</span><span>{summary.totals.classifiedRows}</span></div>
          <div className="row"><span>All-time unknown</span><span>{summary.totals.unclassifiedRows}</span></div>
          <div className="row"><span>Recent classified %</span><span>{summary.totals.recentClassifiedPct}%</span></div>
          <p className="subtle" style={{ marginTop: 10 }}>{summary.liveConfidence.summary}</p>
        </div>
        <div className="panel">
          <div className="eyebrow">24h Delta</div>
          <div className="row"><span>Recent labels</span><span>{summary.totals.recentRows}</span></div>
          <div className="row"><span>Prev 24h labels</span><span>{summary.totals.previousRows}</span></div>
          <div className="row"><span>Recent edge cells</span><span>{summary.recentDeltas.length}</span></div>
          <div className="row"><span>Window</span><span>{summary.windowHours}h vs previous {summary.windowHours}h</span></div>
        </div>
        <div className="panel">
          <div className="eyebrow">Top Classified Cell</div>
          {topEdge ? (
            <>
              <div className={`metric ${confidenceClass(topEdge.confidenceLevel)}`}>{topEdge.edgeKey}</div>
              <div className="row"><span>Mean pnl</span><span className={toneClass(topEdge.meanPnlBps)}>{formatSigned(topEdge.meanPnlBps, 2)} bps</span></div>
              <div className="row"><span>Winrate</span><span>{formatPct(topEdge.winrate)}</span></div>
              <div className="row"><span>Confidence</span><span>{topEdge.confidenceLevel} · {topEdge.confidenceScorePct}%</span></div>
            </>
          ) : (
            <p className="subtle">Aucune cellule classee disponible pour l’instant.</p>
          )}
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <TradabilityScienceDesk title="Tradability Science Desk" testId="edge-map-tradability-science-panel" />
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <div className="panel">
          <div className="eyebrow">Mini Heatmap</div>
          <p className="subtle" style={{ marginBottom: 12 }}>Vert = mean pnl positif, rouge = mean pnl negatif, intensite = confiance observationnelle.</p>
          {renderHeatmap(summary.allTimeMap)}
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <div className="panel">
          <div className="eyebrow">Recent 24h Deltas</div>
          {renderDeltaTable(summary.recentDeltas)}
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 16 }}>
        <div className="panel">
          <div className="eyebrow">All-time Classified Map</div>
          {renderAllTimeTable(summary.allTimeMap)}
        </div>
      </section>
    </main>
  );
}