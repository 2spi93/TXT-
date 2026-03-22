"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import HelpHint from "../../components/HelpHint";
import TxtMiniGuide from "../../components/ui/TxtMiniGuide";

type JsonMap = Record<string, unknown>;

export default function AiPage() {
  const [task, setTask] = useState("strategy_creation");
  const [prompt, setPrompt] = useState("Design a low-turnover volatility-aware crypto strategy.");
  const [criticality, setCriticality] = useState("high");
  const [costLimit, setCostLimit] = useState(0.05);
  const [preferLocal, setPreferLocal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JsonMap | null>(null);
  const [health, setHealth] = useState<JsonMap | null>(null);
  const [history, setHistory] = useState<JsonMap[]>([]);
  const [localHealth, setLocalHealth] = useState<JsonMap | null>(null);
  const [warming, setWarming] = useState<string | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [memoryAb, setMemoryAb] = useState<JsonMap | null>(null);

  async function loadHealth(): Promise<void> {
    const response = await fetch("/api/ai/health", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Impossible de charger l'etat IA");
    }
    setHealth(await response.json());
  }

  async function loadHistory(): Promise<void> {
    const response = await fetch("/api/ai/history?limit=20", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Impossible de charger l'historique IA");
    }
    const payload = (await response.json()) as JsonMap[];
    setHistory(payload);
  }

  async function loadLocalHealth(): Promise<void> {
    const response = await fetch("/api/ai/local-models/health", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Impossible de charger la sante des modeles locaux");
    }
    setLocalHealth(await response.json());
  }

  async function loadMemoryAb(): Promise<void> {
    const response = await fetch("/api/experiments/memory-ab?window_hours=168", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Impossible de charger le comparatif memory A/B");
    }
    setMemoryAb(await response.json());
  }

  useEffect(() => {
    Promise.all([loadHealth(), loadHistory(), loadLocalHealth(), loadMemoryAb()]).catch((err) => setError(err.message));
  }, []);

  const providerRows = useMemo(() => {
    const providers = (health?.providers as JsonMap | undefined)?.providers as JsonMap[] | undefined;
    return providers || [];
  }, [health]);

  async function onExecute(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task,
          prompt,
          criticality,
          cost_limit_usd: costLimit,
          prefer_local: preferLocal,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail || "Execution IA echouee");
      }
      setResult(payload);
      await Promise.all([loadHealth(), loadHistory(), loadLocalHealth(), loadMemoryAb()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  async function warmup(modelKey?: string): Promise<void> {
    setWarming(modelKey || "all");
    setError(null);
    try {
      const response = await fetch("/api/ai/local-models/warmup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modelKey ? { model_key: modelKey } : {}),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail || "Warmup echoue");
      }
      await Promise.all([loadLocalHealth(), loadHistory()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setWarming(null);
    }
  }

  async function clearOldHistory(): Promise<void> {
    setClearingHistory(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/history/clear-old", {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail || "Clear old history echoue");
      }
      await Promise.all([loadHistory(), loadLocalHealth()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setClearingHistory(false);
    }
  }

  const recommended = (health?.capacity as JsonMap | undefined)?.recommended_open_source as JsonMap | undefined;
  const cap = (health?.health as JsonMap | undefined)?.capacity as JsonMap | undefined;
  const localRows = (localHealth?.models as JsonMap[] | undefined) || [];
  const abArms = (memoryAb?.arms as JsonMap[] | undefined) || [];
  const withVsWithout = (memoryAb?.with_vs_without_memory as JsonMap | undefined) || {};

  return (
    <main className="shell txt-page-shell">
      <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div className="panel txt-page-hero">
          <div className="eyebrow">Mission Control AI <HelpHint text="Orchestration multi-modeles avec routage, fallback et budget control." examples={["Exemple simple: ecris une demande de strategie, clique Run AI Task, puis lis la route choisie.", "Si tu veux economiser, coche Prefer local open-source avant de lancer la tache."]} /></div>
          <h1 className="title" style={{ fontSize: 34 }}>Orchestration Multi-Modeles</h1>
          <p className="subtle">Routage intelligent, controle des couts, fallback, retries et circuit-breaker.</p>
          <TxtMiniGuide
            title="Guide IA"
            what="Ce module orchestre les modeles et choisit la route d'execution IA la plus adaptee."
            why="Comprendre rapidement si la decision IA est fiable, economique et reproductible."
            example="Si fallback est active souvent, reduis la criticite ou prefere local pour stabiliser les couts."
            terms={["latency", "brier"]}
          />
          <p>
            <Link href="/">Retour dashboard principal</Link>
            {" | "}
            <Link href="/terminal">Trading Terminal</Link>
            {" | "}
            <Link href="/connectors">Connecteurs trading</Link>
            {" | "}
            <Link href="/live-readiness">Live Readiness</Link>
            {" | "}
            <Link href="/incidents">Incidents</Link>
          </p>

          <form onSubmit={onExecute} className="form-grid" style={{ marginTop: 14 }}>
            <input value={task} onChange={(e) => setTask(e.target.value)} placeholder="task" required />
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} required />
            <div className="row">
              <label>Criticality</label>
              <select value={criticality} onChange={(e) => setCriticality(e.target.value)}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
            <div className="row">
              <label>Cost limit USD</label>
              <input type="number" step="0.001" value={costLimit} onChange={(e) => setCostLimit(Number(e.target.value || 0))} />
            </div>
            <div className="row">
              <label>Prefer local open-source</label>
              <input type="checkbox" checked={preferLocal} onChange={(e) => setPreferLocal(e.target.checked)} />
            </div>
            <button type="submit" disabled={loading}>{loading ? "Execution..." : "Run AI Task"}</button>
          </form>
          {error ? <p className="warn" style={{ marginTop: 10 }}>{error}</p> : null}
        </div>

        <div className="panel">
          <div className="eyebrow">VPS Capacity <HelpHint text="Capacite machine pour piloter selection de modeles locaux/distants." examples={["Si la memoire VPS est faible, privilegie le modele fast plutot que reasoning.", "Si GPU=false, attends-toi a des warmups plus lents sur les modeles locaux."]} /></div>
          <div className="row"><span>CPU</span><span>{String(cap?.cpus || "-")}</span></div>
          <div className="row"><span>Memory</span><span>{String(cap?.memory_gb || "-")} GiB</span></div>
          <div className="row"><span>GPU</span><span>{String(cap?.has_gpu || false)}</span></div>
          <div className="eyebrow" style={{ marginTop: 14 }}>Recommended Open-Source</div>
          <div className="row"><span>Fast</span><span>{String(recommended?.fast || "-")}</span></div>
          <div className="row"><span>Reasoning</span><span>{String(recommended?.reasoning || "-")}</span></div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Last Execution <HelpHint text="Derniere execution IA, route choisie, latence et sortie." examples={["Regarde ici apres chaque run pour savoir quel provider a ete utilise et combien de temps ca a pris.", "Si fallback_used=true, ton provider principal a probablement ete juge trop cher ou indisponible."]} /></div>
          {!result ? <p className="subtle">Aucune execution pour le moment.</p> : null}
          {result ? (
            <>
              <div className="row"><span>Route decision</span><span>{String((result.route as JsonMap)?.reason || "-")}</span></div>
              <div className="row"><span>Primary model</span><span>{String((result.route as JsonMap)?.primary_model || "-")}</span></div>
              <div className="row"><span>Fallback model</span><span>{String((result.route as JsonMap)?.fallback_model || "-")}</span></div>
              <div className="row"><span>Estimated cost</span><span>{String((result.route as JsonMap)?.estimated_cost_usd || "-")}</span></div>
              <div className="row"><span>Provider used</span><span>{String(result.provider_used || "-")}</span></div>
              <div className="row"><span>Model used</span><span>{String(result.model_used || "-")}</span></div>
              <div className="row"><span>Fallback used</span><span>{String(result.fallback_used || false)}</span></div>
              <div className="row"><span>Retries used</span><span>{String(result.retries_used || 0)}</span></div>
              <div className="row"><span>Latency</span><span>{String(result.latency_ms || 0)} ms</span></div>
              <div className="panel" style={{ marginTop: 10, borderRadius: 12 }}>
                <div className="eyebrow">Output</div>
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{String(result.output || "")}</pre>
              </div>
            </>
          ) : null}
        </div>

        <div className="panel">
          <div className="eyebrow">Providers State <HelpHint text="Disponibilite instantanee des providers et modeles routes." examples={["Si open-source-fast est disponible, tu peux lancer des tests moins chers plus souvent.", "Si un provider passe en false, attends-toi a davantage de fallback sur les prochains runs."]} /></div>
          {providerRows.length === 0 ? <p className="subtle">Aucun provider detecte.</p> : null}
          {providerRows.map((item, idx) => (
            <div className="row" key={`${String(item.route)}-${idx}`}>
              <span>{String(item.route)} ({String(item.provider)})</span>
              <span>{String(item.available)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr" }}>
        <div className="panel">
          <div className="eyebrow">Health Local Models <HelpHint text="Etat, warmup et performance des modeles locaux Ollama." examples={["Warmup All au debut de session pour eviter le premier appel tres lent.", "Si avg_latency_ms explose, repasse sur un provider distant ou reduis la taille du modele."]} /></div>
          <div className="row">
            <span>Endpoint</span>
            <span>{String(localHealth?.endpoint || "-")}</span>
          </div>
          <div className="row">
            <span>Reachable</span>
            <span>{String(localHealth?.reachable || false)}</span>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12, marginBottom: 12 }}>
            <button type="button" onClick={() => warmup()} disabled={warming !== null}>
              {warming === "all" ? "Warmup..." : "Warmup All"}
            </button>
          </div>
          {localRows.length === 0 ? <p className="subtle">Aucun modele local detecte.</p> : null}
          {localRows.map((row) => (
            <div className="row" key={String(row.route)}>
              <span>
                {String(row.route)} | {String(row.model)}
              </span>
              <span>
                avg={String(row.avg_latency_ms || "-")} ms | calls={String(row.calls || 0)}
              </span>
              <button type="button" onClick={() => warmup(String(row.route))} disabled={warming !== null}>
                {warming === String(row.route) ? "Warmup..." : "Warmup"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr" }}>
        <div className="panel">
          <div className="eyebrow">Execution History (Postgres) <HelpHint text="Historique persistant des runs IA pour analyse de fiabilite." examples={["Utilise l'historique pour comparer plusieurs prompts sur une meme tache.", "Clear Old History sert a garder une base propre si la retention devient trop bruyante."]} /></div>
          <div style={{ display: "flex", gap: 10, marginTop: 12, marginBottom: 12 }}>
            <button type="button" onClick={() => clearOldHistory()} disabled={clearingHistory}>
              {clearingHistory ? "Clearing..." : "Clear Old History"}
            </button>
          </div>
          {history.length === 0 ? <p className="subtle">Aucune execution historisee.</p> : null}
          {history.map((row) => (
            <div className="row" key={String(row.id)}>
              <span>
                {String(row.created_at)} | {String(row.task)} | {String(row.provider_used)} / {String(row.model_used)}
              </span>
              <span>
                {String(row.status)} | fallback={String(row.fallback_used)} | {String(row.latency_ms)} ms
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr" }}>
        <div className="panel">
          <div className="eyebrow">With vs Without Memory <HelpHint text="Comparatif statistique entre bras memory_on et memory_off avec test de significativite." examples={["Si winrate delta est positif et p-value petite, la memoire aide vraiment.", "Si significant_95=false, ne conclus pas trop vite: il faut encore plus d'echantillons."]} /></div>
          <div className="row"><span>Winrate delta (on - off)</span><span>{String(withVsWithout.winrate_delta ?? "-")}</span></div>
          <div className="row"><span>p-value (two-sided)</span><span>{String(withVsWithout.p_value_two_sided ?? "-")}</span></div>
          <div className="row"><span>Significant @95%</span><span>{String(withVsWithout.significant_95 ?? false)}</span></div>
          {abArms.length === 0 ? <p className="subtle">Pas assez de donnees A/B pour le moment.</p> : null}
          {abArms.map((row) => (
            <div className="row" key={String(row.arm)}>
              <span>{String(row.arm)}</span>
              <span>
                n={String(row.samples || 0)} | win={String(row.win_rate || "-")} | avg={String(row.avg_outcome || "-")}
              </span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
