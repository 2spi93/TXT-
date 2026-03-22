"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import HelpHint from "../../components/HelpHint";
import TxtMiniGuide from "../../components/ui/TxtMiniGuide";

type JsonMap = Record<string, unknown>;

export default function LiveReadinessPage() {
  const [overview, setOverview] = useState<JsonMap | null>(null);
  const [thresholds, setThresholds] = useState<JsonMap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [regime, setRegime] = useState("trend");
  const [minSamples, setMinSamples] = useState(25);
  const [minWinRate, setMinWinRate] = useState(0.52);
  const [maxDrawdown, setMaxDrawdown] = useState(1000);
  const [maxAvgLoss, setMaxAvgLoss] = useState(140);

  async function loadData(): Promise<void> {
    const [readinessRes, thresholdRes] = await Promise.all([
      fetch("/api/live-readiness/overview", { cache: "no-store" }),
      fetch("/api/strategies/drift-thresholds", { cache: "no-store" }),
    ]);
    if (!readinessRes.ok || !thresholdRes.ok) {
      throw new Error("Impossible de charger la vue Live Readiness");
    }
    setOverview(await readinessRes.json());
    const thresholdsPayload = await thresholdRes.json();
    setThresholds((thresholdsPayload.items as JsonMap[] | undefined) || []);
  }

  useEffect(() => {
    loadData().catch((err) => setError(err instanceof Error ? err.message : "Erreur inconnue"));
  }, []);

  async function saveThreshold(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/strategies/drift-thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regime,
          min_samples: minSamples,
          min_win_rate: minWinRate,
          max_drawdown_usd: maxDrawdown,
          max_avg_loss_usd: maxAvgLoss,
        }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(String(payload?.detail || "Sauvegarde seuils echouee"));
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  const memoryKpi = (overview?.memory_kpi as JsonMap | undefined) || {};
  const memorySummary = (memoryKpi.summary as JsonMap | undefined) || {};
  const drift = (overview?.drift as JsonMap | undefined) || {};
  const driftItems = (drift.items as JsonMap[] | undefined) || [];
  const suspended = (drift.suspended_strategies as JsonMap[] | undefined) || [];
  const autoResume = (drift.auto_resume as JsonMap | undefined) || {};
  const ab = (overview?.memory_ab as JsonMap | undefined) || {};
  const abArms = (ab.arms as JsonMap[] | undefined) || [];
  const withVsWithout = (ab.with_vs_without_memory as JsonMap | undefined) || {};

  return (
    <main className="shell txt-page-shell">
      <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div className="panel txt-page-hero">
          <div className="eyebrow">Live Readiness Center <HelpHint text="Vue operationnelle: KPI memoire, derive strategie, auto-suspension et A/B live." examples={["Avant toute activation live, regarde d'abord Strategies suspendues, Drift detecte et A/B memory.", "Si un bloc est rouge ou instable, traite le probleme avant d'augmenter l'exposition."]} /></div>
          <h1 className="title" style={{ fontSize: 34 }}>Readiness, Drift, Memory A/B</h1>
          <p className="subtle">Calibration V3 en boucle fermee: mesure, derive, suspension auto, comparaison memory ON/OFF.</p>
          <TxtMiniGuide
            title="Guide Readiness"
            what="Indicateurs de derive, calibration et suspension automatique des strategies."
            why="Savoir si le systeme est vraiment pret avant d'augmenter le risque en live."
            example="Si plusieurs strategies sont suspendues et le drift grimpe, reduis l'exposition et investigate."
            terms={["brier", "metaRisk", "allocation"]}
          />
          <p>
            <Link href="/">Dashboard</Link>
            {" | "}
            <Link href="/terminal">Trading Terminal</Link>
            {" | "}
            <Link href="/ai">IA</Link>
            {" | "}
            <Link href="/connectors">Connecteurs</Link>
            {" | "}
            <Link href="/incidents">Incidents</Link>
          </p>
          {error ? <p className="warn">{error}</p> : null}
        </div>
        <div className="panel">
          <div className="eyebrow">Etat Global <HelpHint text="Signaux critiques pour autoriser/retarder le passage live." examples={["Si Strategies suspendues > 0, n'ouvre pas plus de risque tant que ce n'est pas compris.", "Si Retrieval avg impact est faible ou negatif, la memoire apporte peu de valeur actuellement."]} /></div>
          <div className="row"><span>Strategies suspendues</span><span className={suspended.length > 0 ? "warn" : "good"}>{String(suspended.length)}</span></div>
          <div className="row"><span>Drift detecte (lignes)</span><span>{String(driftItems.filter((x) => Boolean(x.drift_detected)).length)}</span></div>
          <div className="row"><span>Retrieval avg final sim</span><span>{String(memorySummary.avg_final_similarity || "-")}</span></div>
          <div className="row"><span>Retrieval avg impact</span><span>{String(memorySummary.avg_memory_impact || "-")}</span></div>
          <div className="row"><span>Auto-resume</span><span>{String(autoResume.enabled ?? false)}</span></div>
          <div className="row"><span>Cooldown (h)</span><span>{String(autoResume.cooldown_hours ?? "-")}</span></div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 16 }}>
        <div className="panel">
          <div className="eyebrow">KPI Memoire <HelpHint text="Qualite retrieval: similarite moyenne, impact sur score et winrate top cases." examples={["Si avg_final_similarity monte, la memoire retrouve des cas plus proches.", "Si avg_win_rate_top baisse, les souvenirs ramenes ne sont peut-etre plus utiles au regime courant."]} /></div>
          <div className="row"><span>Samples</span><span>{String(memorySummary.samples || 0)}</span></div>
          <div className="row"><span>Avg vector similarity</span><span>{String(memorySummary.avg_vector_similarity || "-")}</span></div>
          <div className="row"><span>Avg final similarity</span><span>{String(memorySummary.avg_final_similarity || "-")}</span></div>
          <div className="row"><span>Avg winrate top</span><span>{String(memorySummary.avg_win_rate_top || "-")}</span></div>
        </div>

        <div className="panel">
          <div className="eyebrow">A/B Live Memory <HelpHint text="Comparaison winrate et outcome entre bras memory_on et memory_off." examples={["Si memory_on gagne mieux que memory_off, continue l'experimentation avec plus de volume.", "Si p-value est grande, considere le resultat comme indicatif mais pas encore prouve."]} /></div>
          <div className="row"><span>Winrate delta (on-off)</span><span>{String(withVsWithout.winrate_delta ?? "-")}</span></div>
          <div className="row"><span>p-value (2-sided)</span><span>{String(withVsWithout.p_value_two_sided ?? "-")}</span></div>
          <div className="row"><span>Significant @95%</span><span>{String(withVsWithout.significant_95 ?? false)}</span></div>
          {abArms.length === 0 ? <p className="subtle">Pas assez d'echantillons A/B.</p> : null}
          {abArms.map((arm) => (
            <div className="row" key={String(arm.arm)}>
              <span>{String(arm.arm)}</span>
              <span>winrate={String(arm.win_rate || "-")} | avg={String(arm.avg_outcome || "-")}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 16 }}>
        <div className="panel">
          <div className="eyebrow">Seuils Derive par Regime <HelpHint text="Seuils de blocage auto: min samples, min winrate, drawdown max, perte moyenne max." examples={["Exemple: pour trend, impose au moins 25 trades et 52% de winrate avant de faire confiance au regime.", "Si une strategie casse max_drawdown_usd, elle doit etre suspendue plus vite."]} /></div>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <input value={regime} onChange={(e) => setRegime(e.target.value)} placeholder="regime" />
            <input type="number" value={minSamples} onChange={(e) => setMinSamples(Number(e.target.value || 0))} placeholder="min_samples" />
            <input type="number" step="0.01" value={minWinRate} onChange={(e) => setMinWinRate(Number(e.target.value || 0))} placeholder="min_win_rate" />
            <input type="number" step="1" value={maxDrawdown} onChange={(e) => setMaxDrawdown(Number(e.target.value || 0))} placeholder="max_drawdown_usd" />
            <input type="number" step="1" value={maxAvgLoss} onChange={(e) => setMaxAvgLoss(Number(e.target.value || 0))} placeholder="max_avg_loss_usd" />
            <button type="button" disabled={busy} onClick={() => void saveThreshold()}>{busy ? "Sauvegarde..." : "Sauvegarder seuil"}</button>
          </div>
          <div style={{ marginTop: 12 }}>
            {thresholds.map((row) => (
              <div className="row" key={String(row.regime)}>
                <span>{String(row.regime)}</span>
                <span>samples&gt;={String(row.min_samples)} | win&gt;={String(row.min_win_rate)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="eyebrow">Auto-Suspension <HelpHint text="Strategies bloquees automatiquement si derive detectee selon les seuils du regime." examples={["Quand une strategie apparait ici, le systeme l'a deja stoppee pour te proteger.", "Clique Resume seulement si la cause de derive est comprise et traitee."]} /></div>
          {suspended.length === 0 ? <p className="subtle">Aucune strategie suspendue.</p> : null}
          {suspended.map((row) => (
            <div className="row" key={String(row.strategy_id)}>
              <span>{String(row.strategy_id)} | {String(row.market)}</span>
              <form method="post" action={`/api/strategies/${String(row.strategy_id)}/resume`}>
                <button type="submit">Resume</button>
              </form>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="panel">
          <div className="eyebrow">Drift Details <HelpHint text="Detail regime/strategie avec raisons de derive pour investigation et recalibration." examples={["Lis la colonne reason pour savoir si le souci vient du winrate, du drawdown ou du sample count.", "Utilise ce detail pour ajuster les seuils plutot que relancer a l'aveugle."]} /></div>
          {driftItems.length === 0 ? <p className="subtle">Aucune ligne de drift pour le moment.</p> : null}
          {driftItems.slice(0, 80).map((row, idx) => (
            <div className="row" key={`${String(row.strategy_id)}-${String(row.regime)}-${idx}`}>
              <span>{String(row.strategy_id)} | {String(row.regime)} | sample={String(row.sample_count)}</span>
              <span className={Boolean(row.drift_detected) ? "warn" : "good"}>
                drift={String(row.drift_detected)} | win={String(row.win_rate || "-")} | dd={String(row.drawdown_usd || "-")} | {String(row.reason || "")}
              </span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
