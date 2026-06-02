"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import HelpHint from "../../../components/HelpHint";
import OperatorPanelGuide from "../../../components/ui/OperatorPanelGuide";
import type { MarketStateMapSnapshot } from "../../../lib/marketStateMap";

function formatLabel(value: unknown): string {
  const label = String(value || "").trim();
  return label ? label.replace(/_/g, " ") : "n/a";
}

function toneClass(value: string): string {
  if (value === "ADMISSIBLE") {
    return "good";
  }
  if (value === "WATCH" || value === "THIN") {
    return "subtle";
  }
  return "warn";
}

function severityClass(value: string): string {
  return value === "critical" ? "warn" : "subtle";
}

export default function MarketStateMapPage() {
  const [symbol, setSymbol] = useState("DESK");
  const [venue, setVenue] = useState("MULTI");
  const [timeframe, setTimeframe] = useState("ALL");
  const [windowHours, setWindowHours] = useState("24");
  const [snapshot, setSnapshot] = useState<MarketStateMapSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      symbol,
      venue,
      timeframe,
      strategy: "live-ops",
      sinceDays: "14",
      limit: "1200",
      windowHours,
    });
    return params.toString();
  }, [symbol, timeframe, venue, windowHours]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/market-state-map?${queryString}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Impossible de charger la Market State Map");
        }
        return response.json() as Promise<MarketStateMapSnapshot>;
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setSnapshot(payload);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Erreur inconnue");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  const cells = snapshot?.cells || [];
  const transitions = snapshot?.transitions || [];
  const zones = snapshot?.inadmissibleZones || [];
  const anomalyFamilies = snapshot?.anomalyFamilyBreakdown || [];
  const falseContexts = snapshot?.falseContextTaxonomy || [];
  const venueTimeframeRegimeMap = snapshot?.venueTimeframeRegimeMap || [];

  return (
    <main className="shell txt-page-shell" data-testid="market-state-map-page">
      <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1.35fr 1fr" }}>
        <div className="panel txt-page-hero">
          <div className="eyebrow">Readiness State Map</div>
          <h1 className="title" style={{ fontSize: 34 }}>Carte dédiée des contextes admissibles et faux contextes exploitables</h1>
          <p className="subtle txt-page-hero-copy">Cette page lit la route canonique de state map et laisse l’opérateur filtrer symbole, venue, timeframe et fenêtre sans recalculer une autre vérité.</p>
          <OperatorPanelGuide
            title="Guide Readiness State Map"
            what="Une vue dédiée des cellules de marché, des transitions et des zones inadmissibles construites depuis l’oracle, la mémoire marché et l’observation edge."
            why="Séparer clairement la lecture des régimes exploitables de la logique terminale et éviter qu’un faux contexte paraisse encore tradable."
            example="Si CHOP devient inadmissible sur une venue alors que TREND reste watch sur une autre, on documente la dégradation locale au lieu de généraliser le marché entier."
          />
          <div className="txt-page-guide-note">
            <strong>Règle d’usage</strong>
            La page n’invente aucun moteur. Les filtres ne font que rescopper la lecture de la route Market State Map existante.
          </div>
          <p>
            <Link href="/dashboard">Dashboard</Link>
            {" | "}
            <Link href="/live-readiness">Readiness</Link>
            {" | "}
            <Link href="/live-readiness/edge-map">Edge Map</Link>
            {" | "}
            <Link href="/terminal">Trading Terminal</Link>
          </p>
          {error ? <p className="warn">{error}</p> : null}
        </div>

        <div className="panel">
          <div className="eyebrow">Scope Filters <HelpHint text="Requête directe vers la route state map. Le changement de filtre recharge la même source canonique avec un autre scope." examples={["Passe la fenêtre à 72h pour voir si une zone inadmissible est structurelle ou juste récente.", "Réduis au timeframe 1m pour isoler une dégradation microstructure locale à une venue."]} /></div>
          <label className="subtle" style={{ display: "block", marginTop: 10 }}>Symbol</label>
          <input data-testid="market-state-map-filter-symbol" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className="input" />
          <label className="subtle" style={{ display: "block", marginTop: 10 }}>Venue</label>
          <input data-testid="market-state-map-filter-venue" value={venue} onChange={(event) => setVenue(event.target.value.toUpperCase())} className="input" />
          <label className="subtle" style={{ display: "block", marginTop: 10 }}>Timeframe</label>
          <select data-testid="market-state-map-filter-timeframe" value={timeframe} onChange={(event) => setTimeframe(event.target.value)} className="input">
            <option value="ALL">ALL</option>
            <option value="live">live</option>
            <option value="1m">1m</option>
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="1h">1h</option>
          </select>
          <label className="subtle" style={{ display: "block", marginTop: 10 }}>Window hours</label>
          <select data-testid="market-state-map-filter-window" value={windowHours} onChange={(event) => setWindowHours(event.target.value)} className="input">
            <option value="24">24h</option>
            <option value="48">48h</option>
            <option value="72">72h</option>
            <option value="168">168h</option>
          </select>
          <div className="row" style={{ marginTop: 12 }}><span>Loading</span><span>{loading ? "yes" : "no"}</span></div>
          <div className="row"><span>Scope</span><span>{snapshot ? `${snapshot.scope.symbol} · ${snapshot.scope.venue} · ${snapshot.scope.timeframe}` : "pending"}</span></div>
          <div className="row"><span>Window</span><span>{snapshot ? `${snapshot.scope.windowHours}h` : `${windowHours}h`}</span></div>
          <div className="row"><span>Generated</span><span>{snapshot?.generatedAtIso || "-"}</span></div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr", marginBottom: 16 }}>
        <div className="panel"><div className="eyebrow">Admissible</div><div className="metric good">{snapshot?.summary.admissibleCells || 0}</div></div>
        <div className="panel"><div className="eyebrow">Watch</div><div className="metric subtle">{snapshot?.summary.watchCells || 0}</div></div>
        <div className="panel"><div className="eyebrow">Degraded</div><div className="metric warn">{snapshot?.summary.degradedCells || 0}</div></div>
        <div className="panel"><div className="eyebrow">Inadmissible</div><div className="metric warn">{snapshot?.summary.inadmissibleCells || 0}</div></div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1.1fr 0.9fr", marginBottom: 16 }}>
        <div className="panel" data-testid="market-state-map-cells-panel">
          <div className="eyebrow">Cells</div>
          <div className="txt-scroll-shell" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th align="left">Regime</th>
                  <th align="left">State</th>
                  <th align="right">Truth</th>
                  <th align="right">Admissibility</th>
                  <th align="right">False ctx</th>
                  <th align="left">Reasons</th>
                </tr>
              </thead>
              <tbody>
                {cells.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="subtle" style={{ paddingTop: 10 }}>Aucune cellule disponible sur ce scope.</td>
                  </tr>
                ) : cells.map((cell) => (
                  <tr key={`${cell.key.venue}:${cell.key.timeframe}:${cell.key.regime}`}>
                    <td style={{ padding: "8px 0" }}>{cell.key.regime}</td>
                    <td className={toneClass(cell.state)}>{cell.state}</td>
                    <td align="right">{cell.truthQualityPct}%</td>
                    <td align="right">{cell.admissibilityPct}%</td>
                    <td align="right">{cell.falseContextRiskPct}%</td>
                    <td>{cell.reasons.map((reason) => formatLabel(reason)).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel" data-testid="market-state-map-zones-panel">
          <div className="eyebrow">Zones & Transitions</div>
          <div className="row"><span>Failure modes</span><span>{snapshot?.summary.dominantFailureModes.map((reason) => formatLabel(reason)).join(" · ") || "none"}</span></div>
          <div className="txt-scroll-shell compact" style={{ marginTop: 10 }}>
            {zones.length === 0 ? <p className="subtle">Aucune zone inadmissible listée.</p> : zones.map((zone) => (
              <div className="row" key={zone.zoneKey}>
                <span className={severityClass(zone.severity)}>{zone.regime} · {zone.severity.toUpperCase()}</span>
                <span>{formatLabel(zone.reason)}</span>
              </div>
            ))}
          </div>
          <div className="txt-scroll-shell compact" style={{ marginTop: 10 }}>
            {transitions.length === 0 ? <p className="subtle">Pas de transition récente.</p> : transitions.map((transition, index) => (
              <div className="row" key={`${transition.regime}:${transition.detectedAtIso}:${index}`}>
                <span>{transition.regime} · {formatLabel(transition.transitionType)}</span>
                <span>{transition.truthQualityDeltaPct}%</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 16 }}>
        <div className="panel" data-testid="market-state-map-context-grid-panel">
          <div className="eyebrow">Venue / Timeframe / Regime Map</div>
          <div className="txt-scroll-shell" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th align="left">Venue</th>
                  <th align="left">Timeframe</th>
                  <th align="left">Regime</th>
                  <th align="left">State</th>
                  <th align="right">Truth</th>
                  <th align="right">Exec</th>
                  <th align="right">False ctx</th>
                  <th align="left">Failure modes</th>
                </tr>
              </thead>
              <tbody>
                {venueTimeframeRegimeMap.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="subtle" style={{ paddingTop: 10 }}>Aucune cartographie venue/timeframe/régime sur ce scope.</td>
                  </tr>
                ) : venueTimeframeRegimeMap.map((row) => (
                  <tr key={`${row.venue}:${row.timeframe}:${row.regime}`}>
                    <td style={{ padding: "8px 0" }}>{row.venue}</td>
                    <td>{row.timeframe}</td>
                    <td>{formatLabel(row.regime)}</td>
                    <td className={toneClass(row.state)}>{row.state}</td>
                    <td align="right">{row.truthQualityPct}%</td>
                    <td align="right">{row.executionQualityPct}%</td>
                    <td align="right">{row.falseContextRiskPct}%</td>
                    <td>{row.dominantFailureModes.map((value) => formatLabel(value)).join(" · ") || "none"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel" data-testid="market-state-map-anomaly-family-panel">
          <div className="eyebrow">Anomaly Families by Venue / Timeframe</div>
          <div className="txt-scroll-shell" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th align="left">Family</th>
                  <th align="left">Venue</th>
                  <th align="left">Timeframe</th>
                  <th align="right">Count</th>
                  <th align="right">Critical</th>
                  <th align="left">Regimes</th>
                </tr>
              </thead>
              <tbody>
                {anomalyFamilies.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="subtle" style={{ paddingTop: 10 }}>Aucune famille d’anomalies sur ce scope.</td>
                  </tr>
                ) : anomalyFamilies.map((row) => (
                  <tr key={`${row.anomalyFamily}:${row.venue}:${row.timeframe}`}>
                    <td style={{ padding: "8px 0" }}>{formatLabel(row.anomalyFamily)} · {row.operatorFamily}</td>
                    <td>{row.venue}</td>
                    <td>{row.timeframe}</td>
                    <td align="right">{row.count}</td>
                    <td align="right">{row.criticalCount}</td>
                    <td>{row.dominantRegimes.map((value) => formatLabel(value)).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel" data-testid="market-state-map-false-context-panel">
          <div className="eyebrow">False Context Taxonomy</div>
          <div className="txt-scroll-shell compact">
            {falseContexts.length === 0 ? <p className="subtle">Aucune famille de faux contexte auditée sur ce scope.</p> : falseContexts.map((row) => (
              <div className="row" key={row.contextFamily}>
                <span>{formatLabel(row.contextFamily)}</span>
                <span>{row.count} · no-trade {row.noTradeSharePct}% · {(row.dominantBlockingLayers || []).map((value) => formatLabel(value)).join(" / ") || "none"}</span>
              </div>
            ))}
          </div>
          <div className="txt-scroll-shell compact" style={{ marginTop: 10 }}>
            {falseContexts.map((row) => (
              <div className="row" key={`${row.contextFamily}-reasons`}>
                <span>{formatLabel(row.contextFamily)} reasons</span>
                <span>{row.auditReasons.map((value) => formatLabel(value)).join(" · ") || "none"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}