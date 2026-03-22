"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import HelpHint from "../../components/HelpHint";
import TxtMiniGuide from "../../components/ui/TxtMiniGuide";

type JsonMap = Record<string, unknown>;

export default function ConnectorsPage() {
  const [status, setStatus] = useState<JsonMap | null>(null);
  const [mt5Health, setMt5Health] = useState<JsonMap | null>(null);
  const [mt5Accounts, setMt5Accounts] = useState<JsonMap[]>([]);
  const [pendingLive, setPendingLive] = useState<JsonMap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JsonMap | null>(null);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [lastAlertSignature, setLastAlertSignature] = useState("");

  const [accountId, setAccountId] = useState("mt5-demo-01");
  const [broker, setBroker] = useState("metaquotes");
  const [server, setServer] = useState("MetaQuotes-Demo");
  const [login, setLogin] = useState("10001234");
  const [mode, setMode] = useState("paper");

  const [orderSymbol, setOrderSymbol] = useState("EURUSD");
  const [orderSide, setOrderSide] = useState("buy");
  const [orderLots, setOrderLots] = useState(0.1);
  const [orderNotional, setOrderNotional] = useState(12000);
  const [orderSpread, setOrderSpread] = useState(12);
  const [orderWhy, setOrderWhy] = useState("Regime aligned entry");

  const [trendScore, setTrendScore] = useState(0.4);
  const [realizedVolatility, setRealizedVolatility] = useState(0.05);
  const [sentimentScore, setSentimentScore] = useState(0.2);
  const [regimeResult, setRegimeResult] = useState<JsonMap | null>(null);

  const [scenario, setScenario] = useState("Fed emergency hike");
  const [backtestResult, setBacktestResult] = useState<JsonMap | null>(null);

  async function loadAll(): Promise<void> {
    const [statusRes, healthRes, accountsRes, pendingRes] = await Promise.all([
      fetch("/api/connectors/status", { cache: "no-store" }),
      fetch("/api/mt5/health", { cache: "no-store" }),
      fetch("/api/mt5/accounts", { cache: "no-store" }),
      fetch("/api/mt5/orders/live-pending", { cache: "no-store" }),
    ]);

    if (!statusRes.ok || !healthRes.ok || !accountsRes.ok || !pendingRes.ok) {
      throw new Error("Impossible de charger les connecteurs");
    }

    setStatus(await statusRes.json());
    setMt5Health(await healthRes.json());
    setMt5Accounts(await accountsRes.json());
    setPendingLive(await pendingRes.json());
  }

  useEffect(() => {
    loadAll().catch((err) => setError(err instanceof Error ? err.message : "Erreur inconnue"));

    let ws: WebSocket | null = null;
    let cancelled = false;

    (async () => {
      try {
        const tokenRes = await fetch("/api/auth/ws-token", { cache: "no-store" });
        if (!tokenRes.ok) {
          return;
        }
        const tokenPayload = await tokenRes.json();
        const cpUrl = String(tokenPayload.controlPlaneUrl || "http://127.0.0.1:8000");
        const token = String(tokenPayload.token || "");
        if (!token) {
          return;
        }

        const wsUrl = cpUrl.replace("http://", "ws://").replace("https://", "wss://") + `/v1/connectors/ws?token=${encodeURIComponent(token)}`;
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          if (cancelled) {
            return;
          }
          try {
            const payload = JSON.parse(String(event.data || "{}"));
            setStatus(payload);
          } catch {
            // ignore malformed frames
          }
        };
      } catch {
        // keep HTTP fallback only
      }
    })();

    return () => {
      cancelled = true;
      if (ws) {
        ws.close();
      }
    };
  }, []);

  useEffect(() => {
    const alerts = (status?.alerts as JsonMap[] | undefined) || [];
    if (alerts.length === 0) {
      return;
    }
    const signature = JSON.stringify(alerts.map((a) => `${String(a.type)}:${String(a.message)}`));
    if (!signature || signature === lastAlertSignature) {
      return;
    }
    setLastAlertSignature(signature);

    // Short non-intrusive alert beep for new websocket alerts.
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(audioCtx.destination);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.2);
    } catch {
      // Ignore environments where WebAudio is unavailable.
    }
  }, [status, lastAlertSignature]);

  useEffect(() => {
    const speech = typeof window !== "undefined" ? (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }) : null;
    const SpeechRecognition = speech?.SpeechRecognition || speech?.webkitSpeechRecognition;
    setVoiceAvailable(Boolean(SpeechRecognition));
  }, []);

  async function connectMt5(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/mt5/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, broker, server, login, mode, metadata: { source: "mission-control-ui" } }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.detail || "Connexion MT5 echouee"));
      }
      setResult(payload);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function sendFilteredOrder(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/mt5/orders/filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          symbol: orderSymbol,
          side: orderSide,
          lots: orderLots,
          estimated_notional_usd: orderNotional,
          max_spread_bps: orderSpread,
          rationale: orderWhy,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.detail || "Ordre filtre rejete"));
      }
      setResult(payload);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function approveLiveOrder(approvalId: string): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/mt5/orders/live-approve/${approvalId}`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.detail || "Validation live echouee"));
      }
      setResult(payload);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function detectRegime(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/regimes/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trend_score: trendScore, realized_volatility: realizedVolatility, sentiment_score: sentimentScore }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.detail || "Detection de regime echouee"));
      }
      setRegimeResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function runBacktest(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/backtests/geopolitical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_name: "mt5-regime-allocator",
          asset_class: "forex-indices",
          scenario,
          horizon_days: 20,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.detail || "Backtest geopol echoue"));
      }
      setBacktestResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  function startVoiceCommand(): void {
    const speech = typeof window !== "undefined" ? (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }) : null;
    const SpeechRecognition = speech?.SpeechRecognition || speech?.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Commande vocale non supportee sur ce navigateur");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = false;
    setVoiceListening(true);

    recognition.onresult = (event: any) => {
      const transcript = String(event?.results?.[0]?.[0]?.transcript || "").toLowerCase();
      setVoiceTranscript(transcript);

      if (transcript.includes("connect") && transcript.includes("mt5")) {
        void connectMt5();
      } else if (transcript.includes("regime")) {
        void detectRegime();
      } else if (transcript.includes("backtest")) {
        void runBacktest();
      } else {
        setError("Commande vocale non reconnue. Exemples: connect mt5, detecte regime, lance backtest.");
      }
    };

    recognition.onerror = () => {
      setVoiceListening(false);
    };
    recognition.onend = () => {
      setVoiceListening(false);
    };
    recognition.start();
  }

  const connectors = (status?.connectors as JsonMap[] | undefined) || [];
  const alerts = (status?.alerts as JsonMap[] | undefined) || [];
  const recentApprovals = (status?.recent_live_approvals as JsonMap[] | undefined) || [];
  const pendingCount = Number(status?.pending_live_approvals || 0);

  return (
    <main className="shell txt-page-shell">
      <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div className="panel txt-page-hero">
          <div className="eyebrow">Horizon Quantique <HelpHint text="Supervision des connecteurs execution/recherche avec flux temps reel." examples={["Exemple simple: connecte un compte MT5, envoie un ordre filtre, puis surveille les alertes en dessous.", "Si tu veux agir vite, ouvre aussi le Trading Terminal pour une vue plus centralisee."]} /></div>
          <h1 className="title" style={{ fontSize: 34 }}>Connecteurs Trading Augmentes</h1>
          <p className="subtle">
            MWC pilote les regimes, filtre les ordres et orchestre crypto, MT5 et prediction markets.
          </p>
          <TxtMiniGuide
            title="Guide Connecteurs"
            what="Etat temps reel des ponts broker, execution et flux de marche."
            why="Eviter d'envoyer des ordres quand l'infrastructure est degradee."
            example="Si MT5 status n'est pas healthy et qu'une alerte critique apparait, stoppe les executions live."
            terms={["spread", "slippage", "latency"]}
          />
          <p>
            <Link href="/">Retour dashboard</Link> | <Link href="/ai">Ecran IA</Link>
            {" | "}
            <Link href="/terminal">Trading Terminal</Link>
            {" | "}
            <Link href="/live-readiness">Live Readiness</Link>
            {" | "}
            <Link href="/incidents">Incidents</Link>
          </p>
          {error ? <p className="warn">{error}</p> : null}
        </div>

        <div className="panel">
          <div className="eyebrow">MT5 Bridge <HelpHint text="Sante bridge MT5 et compteur des validations live en attente." examples={["Si Pending live approvals monte, un second validateur doit venir ici ou sur le terminal.", "Si status n'est pas healthy, n'envoie pas de nouvel ordre live."]} /></div>
          <div className="row"><span>Status</span><span>{String(mt5Health?.status || "-")}</span></div>
          <div className="row"><span>Mode</span><span>{String(mt5Health?.mode || "-")}</span></div>
          <div className="row"><span>Accounts</span><span>{String(mt5Health?.accounts || 0)}</span></div>
          <div className="row"><span>Pending live approvals</span><span>{String(pendingCount)}</span></div>
          <div style={{ marginTop: 10 }}>
            <button type="button" onClick={() => startVoiceCommand()} disabled={!voiceAvailable || voiceListening}>
              {voiceListening ? "Ecoute en cours..." : "Commande vocale"}
            </button>
          </div>
          {voiceTranscript ? <p className="subtle" style={{ marginTop: 8 }}>Derniere commande: {voiceTranscript}</p> : null}
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Connecteurs Live <HelpHint text="Disponibilite instantanee des integrations critiques." examples={["Chaque ligne doit etre healthy=true avant une vraie session de trading.", "Si un connecteur devient false, considere l'environnement comme degrade jusqu'a verification."]} /></div>
          {connectors.map((item) => (
            <div className="row" key={String(item.name)}>
              <span>{String(item.name)} ({String(item.transport)})</span>
              <span className={item.healthy ? "good" : "warn"}>{String(item.healthy)}</span>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="eyebrow">Comptes MT5 <HelpHint text="Inventaire des comptes raccordes et leur mode paper/live." examples={["Cherche ici ton compte demo pour verifier qu'il est bien en paper avant un test.", "Ne bascule pas en live sans voir clairement le mode et le status attendus."]} /></div>
          {mt5Accounts.length === 0 ? <p className="subtle">Aucun compte connecte.</p> : null}
          {mt5Accounts.map((item) => (
            <div className="row" key={String(item.account_id)}>
              <span>{String(item.account_id)} | {String(item.server)}</span>
              <span>{String(item.mode)} / {String(item.status)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Alertes Temps Reel <HelpHint text="Alertes websocket: kill-switch, validations live, incidents." examples={["Si une alerte kill-switch apparait, stoppe les actions execution et va d'abord sur Incidents.", "Si une alerte live approval arrive, ouvre le bloc de double validation juste en dessous."]} /></div>
          {alerts.length === 0 ? <p className="subtle">Aucune alerte active.</p> : null}
          {alerts.map((item, idx) => (
            <div className="row" key={`${String(item.type)}-${idx}`}>
              <span>{String(item.type)}</span>
              <span className={String(item.level) === "critical" ? "warn" : "subtle"}>{String(item.message)}</span>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="eyebrow">Historique Validations Live <HelpHint text="Traite la preuve de double approbation des ordres live." examples={["Apres un ordre live, verifie ici qui a fait la seconde approbation.", "Si une validation manque, ne considere pas l'execution comme completement gouvernee."]} /></div>
          {recentApprovals.length === 0 ? <p className="subtle">Aucune validation live recente.</p> : null}
          {recentApprovals.map((item) => (
            <div className="row" key={String(item.approval_id)}>
              <span>{String(item.approval_id)} | {String(item.account_id)}</span>
              <span>{String(item.status)} | {String(item.second_approved_by || "-")}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Connexion MT5 <HelpHint text="Formulaire de raccordement compte MT5 au bridge." examples={["Exemple: entre mt5-demo-01, serveur demo, login demo, puis clique Connecter le compte.", "Utilise paper pour tester le pipeline sans risque reel."]} /></div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="account_id" />
            <input value={broker} onChange={(e) => setBroker(e.target.value)} placeholder="broker" />
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="server" />
            <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="login" />
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="paper">paper</option>
              <option value="live">live</option>
            </select>
            <button type="button" onClick={() => connectMt5()} disabled={busy}>Connecter le compte</button>
          </div>
        </div>

        <div className="panel">
          <div className="eyebrow">Ordre MT5 Filtre par MWC <HelpHint text="Ordre soumis au risk gate et verifications spread/slippage." examples={["Exemple: EURUSD, buy, 0.10 lot, rationale concise, puis Soumettre ordre filtre.", "Si le spread est trop large, augmente l'exigence de prudence ou attends une meilleure liquidite."]} /></div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <input value={orderSymbol} onChange={(e) => setOrderSymbol(e.target.value)} placeholder="symbol" />
            <select value={orderSide} onChange={(e) => setOrderSide(e.target.value)}>
              <option value="buy">buy</option>
              <option value="sell">sell</option>
            </select>
            <input type="number" step="0.01" value={orderLots} onChange={(e) => setOrderLots(Number(e.target.value || 0))} placeholder="lots" />
            <input type="number" step="1" value={orderNotional} onChange={(e) => setOrderNotional(Number(e.target.value || 0))} placeholder="estimated_notional_usd" />
            <input type="number" step="1" value={orderSpread} onChange={(e) => setOrderSpread(Number(e.target.value || 0))} placeholder="max_spread_bps" />
            <input value={orderWhy} onChange={(e) => setOrderWhy(e.target.value)} placeholder="rationale" />
            <button type="button" onClick={() => sendFilteredOrder()} disabled={busy}>Soumettre ordre filtre</button>
          </div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr" }}>
        <div className="panel">
          <div className="eyebrow">Double Validation Live MT5 <HelpHint text="Second validateur requis pour execution compte live." examples={["Quand une demande arrive ici, un autre operateur doit cliquer Valider en second.", "Si rien n'apparait ici, l'ordre est soit en paper, soit pas encore eligibile au live."]} /></div>
          {pendingLive.length === 0 ? <p className="subtle">Aucune demande live en attente.</p> : null}
          {pendingLive.map((item) => (
            <div className="row" key={String(item.approval_id)}>
              <span>
                {String(item.approval_id)} | {String(item.account_id)} | premier validateur: {String(item.first_approved_by)}
              </span>
              <button type="button" disabled={busy} onClick={() => approveLiveOrder(String(item.approval_id))}>
                Valider en second
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Detection Regime Marche <HelpHint text="Inference regime pour adapter strategie et exposition." examples={["Entre trend_score, vol et sentiment pour savoir si le marche ressemble a trend, chop ou stress.", "Si le regime change, adapte ensuite les seuils de drift dans Live Readiness."]} /></div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <input type="number" step="0.01" value={trendScore} onChange={(e) => setTrendScore(Number(e.target.value || 0))} placeholder="trend_score" />
            <input type="number" step="0.001" value={realizedVolatility} onChange={(e) => setRealizedVolatility(Number(e.target.value || 0))} placeholder="realized_volatility" />
            <input type="number" step="0.01" value={sentimentScore} onChange={(e) => setSentimentScore(Number(e.target.value || 0))} placeholder="sentiment_score" />
            <button type="button" onClick={() => detectRegime()} disabled={busy}>Detecter regime</button>
          </div>
          {regimeResult ? (
            <div className="panel" style={{ marginTop: 12, borderRadius: 12 }}>
              <div className="row"><span>Regime</span><span>{String(regimeResult.regime || "-")}</span></div>
              <div className="row"><span>Confidence</span><span>{String(regimeResult.confidence || "-")}</span></div>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <div className="eyebrow">Backtest IA Geopolitique <HelpHint text="Stress-test scenario pour mesurer resilience strategie." examples={["Exemple: Fed emergency hike puis Lance backtest pour mesurer la resilience.", "Si expected_max_drawdown est trop fort, ne promote pas la strategie sans retravail."]} /></div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <input value={scenario} onChange={(e) => setScenario(e.target.value)} placeholder="scenario" />
            <button type="button" onClick={() => runBacktest()} disabled={busy}>Lancer backtest</button>
          </div>
          {backtestResult ? (
            <div className="panel" style={{ marginTop: 12, borderRadius: 12 }}>
              <div className="row"><span>Resilience</span><span>{String(backtestResult.resilience_score || "-")}</span></div>
              <div className="row"><span>Expected max DD</span><span>{String(backtestResult.expected_max_drawdown || "-")}</span></div>
            </div>
          ) : null}
        </div>
      </section>

      {result ? (
        <section className="grid" style={{ marginTop: 16, gridTemplateColumns: "1fr" }}>
          <div className="panel">
            <div className="eyebrow">Dernier resultat <HelpHint text="Sortie detaillee de la derniere action API executee." examples={["Lis ce JSON juste apres une action pour comprendre la reponse brute du systeme.", "Si quelque chose echoue, copie surtout detail, status ou approval_id pour le diagnostic."]} /></div>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(result, null, 2)}</pre>
          </div>
        </section>
      ) : null}
    </main>
  );
}
