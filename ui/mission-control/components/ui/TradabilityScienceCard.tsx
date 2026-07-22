import HelpHint from "../HelpHint";
import type { TradabilityAnalyticsSummary } from "../../lib/tradabilityAnalytics";

type Props = {
  summary: TradabilityAnalyticsSummary | null;
  title?: string;
  testId?: string;
  mode?: "full" | "compact";
  containerClassName?: string;
};

function driftToneClass(value: "good" | "subtle" | "warn"): string {
  if (value === "good") {
    return "good";
  }
  if (value === "warn") {
    return "bad";
  }
  return "warn";
}

export default function TradabilityScienceCard({
  summary,
  title = "Tradability Science Desk",
  testId,
  mode = "full",
  containerClassName = "panel",
}: Props) {
  const calibration = summary?.calibration || null;
  const rows24h = summary?.windows.last_24h.rows || [];
  const rows7d = summary?.windows.last_7d.rows || [];
  const comparisonRows = (summary?.comparison.rows || []).slice(0, mode === "compact" ? 2 : 4);

  return (
    <div className={containerClassName} data-testid={testId}>
      <div className="eyebrow">
        {title}
        <HelpHint
          text="Expose la meme aggregation 24h/7j que le terminal, mais en lecture hors terminal pour suivre la derive regime et la calibration appliquee."
          examples={[
            "Si 24h se degrade contre 7j, resserre d'abord la sensibilite avant de changer le poids dans le score.",
            "Si la derive reste stable avec beaucoup d'echantillons, le poids informationnel peut monter sans retoucher les seuils.",
          ]}
        />
      </div>
      {calibration ? (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, marginBottom: 10 }}>
            <span className={`chart-flow-pill tone-${driftToneClass(calibration.driftTone)}`}>DRIFT {calibration.driftTone.toUpperCase()}</span>
            <span className="chart-flow-pill tone-neutral">REGIME {calibration.currentRegime}</span>
            <span className="chart-flow-pill tone-neutral">SENSITIVITY {calibration.sensitivity.mode}</span>
            <span className="chart-flow-pill tone-neutral">IMPACT {calibration.impact.mode}</span>
          </div>
          <div className="row"><span>Samples 24h / 7j</span><span>{calibration.sampleCount24h} / {calibration.sampleCount7d}</span></div>
          <div className="row"><span>Thresholds THIN/DEG</span><span>S {Math.round(calibration.sensitivity.thresholds.thinScoreFloor * 100)}/{Math.round(calibration.sensitivity.thresholds.degradedScoreFloor * 100)}% · H {Math.round(calibration.sensitivity.thresholds.thinEntropyCeiling * 100)}/{Math.round(calibration.sensitivity.thresholds.degradedEntropyCeiling * 100)}%</span></div>
          <div className="row"><span>Edge impact weight</span><span>{calibration.impact.edgeEligibilityWeightPct}% info_density · {100 - calibration.impact.edgeEligibilityWeightPct}% base</span></div>
          <div className="row"><span>Thin delta</span><span>{calibration.thinSharePct24h.toFixed(0)}% vs {calibration.thinSharePct7d.toFixed(0)}% ({calibration.thinDeltaPct >= 0 ? "+" : ""}{calibration.thinDeltaPct.toFixed(0)} pts)</span></div>
          <div className="row"><span>Degraded delta</span><span>{calibration.degradedSharePct24h.toFixed(0)}% vs {calibration.degradedSharePct7d.toFixed(0)}% ({calibration.degradedDeltaPct >= 0 ? "+" : ""}{calibration.degradedDeltaPct.toFixed(0)} pts)</span></div>
          <div className="subtle" style={{ marginTop: 8 }}>{calibration.sensitivity.summaryLabel}</div>
          <div className="subtle">{calibration.impact.summaryLabel}</div>
          {mode === "full" ? (
            <>
              <div className="txt-scroll-shell compact" style={{ marginTop: 12 }}>
                {comparisonRows.length === 0 ? <p className="subtle">Aucune derive regime disponible.</p> : comparisonRows.map((row) => (
                  <div className="row" key={`tradability-drift-${row.regime}`}>
                    <span>{row.regime}</span>
                    <span>{row.window24h ? `24h T${row.window24h.thinSharePct.toFixed(0)} D${row.window24h.degradedSharePct.toFixed(0)}` : "24h n/a"} · {row.window7d ? `7j T${row.window7d.thinSharePct.toFixed(0)} D${row.window7d.degradedSharePct.toFixed(0)}` : "7j n/a"} · {row.driftLabel}</span>
                  </div>
                ))}
              </div>
              <div className="txt-scroll-shell compact" style={{ marginTop: 10 }}>
                <div className="row"><span>Desk 24h</span><span>{rows24h.length > 0 ? rows24h.map((row) => `${row.regime}:${row.sampleCount}`).join(" · ") : "n/a"}</span></div>
                <div className="row"><span>Desk 7j</span><span>{rows7d.length > 0 ? rows7d.map((row) => `${row.regime}:${row.sampleCount}`).join(" · ") : "n/a"}</span></div>
              </div>
            </>
          ) : null}
        </>
      ) : (
        <p className="subtle">Tradability analytics indisponible.</p>
      )}
    </div>
  );
}