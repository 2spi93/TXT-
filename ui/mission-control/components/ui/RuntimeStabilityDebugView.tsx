import type { ReactNode } from "react";

type RuntimeStabilityDebugCard = {
  label: string;
  value: string;
  detail: string;
};

type RuntimeStabilityDebugRow = {
  label: string;
  value: ReactNode;
};

type RuntimeStabilityDebugViewProps = {
  title?: string;
  cards: RuntimeStabilityDebugCard[];
  rows?: RuntimeStabilityDebugRow[];
  panelTestId?: string;
  compact?: boolean;
};

export default function RuntimeStabilityDebugView({
  title,
  cards,
  rows = [],
  panelTestId,
  compact = false,
}: RuntimeStabilityDebugViewProps) {
  return (
    <div
      className={`runtime-stability-debug-panel${compact ? " is-compact" : ""}`}
      data-testid={panelTestId}
    >
      {title ? <div className="runtime-stability-debug-title">{title}</div> : null}
      <div className="runtime-stability-debug-grid">
        {cards.map((card) => (
          <div key={card.label} className="runtime-stability-debug-card">
            <span className="subtle mini">{card.label}</span>
            <strong>{card.value}</strong>
            <span>{card.detail}</span>
          </div>
        ))}
      </div>
      {rows.length > 0 ? (
        <div className="runtime-stability-debug-rows">
          {rows.map((row) => (
            <div key={row.label} className="runtime-stability-debug-row">
              <strong>{row.label}</strong>
              <span>{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}