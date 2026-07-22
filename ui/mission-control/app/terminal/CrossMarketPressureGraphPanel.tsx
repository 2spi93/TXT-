import type { CrossMarketBasketMember, CrossMarketTruthSummary } from "./crossMarketTruth";

type Props = {
  summary: CrossMarketTruthSummary | null;
};

type PressureRow = {
  code: string;
  label: string;
  role: string;
  signedPressurePct: number;
  changeLabel: string;
  tone: "good" | "warn" | "subtle";
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildPressureRow(member: CrossMarketBasketMember): PressureRow {
  const changePct = typeof member.change_pct === "number" ? member.change_pct : 0;
  const directionSign = member.direction === "UP" ? 1 : member.direction === "DOWN" ? -1 : 0;
  const roleSign = member.role === "hedge" ? -1 : 1;
  const freshnessWeight = clamp(member.freshness_pct / 100, 0.25, 1);
  const magnitude = member.available && directionSign !== 0
    ? clamp(Math.abs(changePct) * 24 * freshnessWeight, 0, 100)
    : 0;
  const signedPressurePct = Math.round(magnitude * directionSign * roleSign);
  const tone: PressureRow["tone"] = signedPressurePct > 0
    ? "good"
    : signedPressurePct < 0
      ? "warn"
      : "subtle";

  return {
    code: member.code,
    label: member.label,
    role: member.role,
    signedPressurePct,
    changeLabel: typeof member.change_pct === "number"
      ? `${member.change_pct >= 0 ? "+" : ""}${member.change_pct.toFixed(2)}%`
      : "n/a",
    tone,
  };
}

export default function CrossMarketPressureGraphPanel({ summary }: Props) {
  if (!summary) {
    return null;
  }

  const rows = summary.basket
    .map(buildPressureRow)
    .sort((left, right) => Math.abs(right.signedPressurePct) - Math.abs(left.signedPressurePct))
    .slice(0, 6);

  if (rows.length === 0) {
    return null;
  }

  const positiveCount = rows.filter((row) => row.signedPressurePct > 0).length;
  const negativeCount = rows.filter((row) => row.signedPressurePct < 0).length;

  return (
    <div
      style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(120, 147, 188, 0.2)", background: "rgba(9, 14, 24, 0.72)" }}
      data-testid="terminal-cross-market-pressure-graph-panel"
    >
      <div className="chart-stat-label" style={{ marginBottom: 6 }}>Cross-market pressure graph</div>
      <div className="exec-explainability-pills" style={{ marginBottom: 8 }}>
        <span className="chart-action-pill">{`support ${positiveCount}`}</span>
        <span className="chart-action-pill">{`stress ${negativeCount}`}</span>
        <span className="chart-action-pill">{`pairs ${summary.metrics.pair_count}`}</span>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((row) => {
          const magnitude = Math.abs(row.signedPressurePct);
          const leftWidth = row.signedPressurePct < 0 ? `${magnitude}%` : "0%";
          const rightWidth = row.signedPressurePct > 0 ? `${magnitude}%` : "0%";
          return (
            <div key={row.code} data-testid={`terminal-cross-market-pressure-row-${row.code.toLowerCase()}`}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 3 }}>
                <span>{`${row.code} · ${row.role}`}</span>
                <span className={`chart-action-pill chart-action-pill-status ${row.tone}`}>{row.changeLabel}</span>
              </div>
              <div style={{ position: "relative", height: 10, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
                <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "rgba(255,255,255,0.16)" }} />
                <div style={{ position: "absolute", top: 0, bottom: 0, right: "50%", width: leftWidth, background: "linear-gradient(90deg, rgba(255,99,99,0.18), rgba(255,138,101,0.72))" }} />
                <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: rightWidth, background: "linear-gradient(90deg, rgba(72,187,120,0.72), rgba(88,234,170,0.18))" }} />
              </div>
              <div className="subtle mini" style={{ marginTop: 3 }}>
                {`${row.label} pressure ${row.signedPressurePct >= 0 ? "+" : ""}${row.signedPressurePct}%`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}