"use client";

import { useEffect, useMemo, useState } from "react";

type OpsCopilotPromptDetail = {
  message?: string;
  autoSend?: boolean;
};

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type ChatResponse = {
  status?: string;
  reply?: string;
  actions?: string[];
  suggested_actions?: Array<Record<string, unknown>>;
  confirmation?: {
    token?: string;
    summary?: string;
    expires_at?: string;
  };
};

type CopilotMode = "commandant" | "assistant";

const PAGE_SHORTCUTS = [
  { href: "/terminal", label: "Terminal" },
  { href: "/live-ops", label: "Live Ops" },
  { href: "/ai", label: "AI Desk" },
  { href: "/live-capital", label: "Live Capital" },
  { href: "/connectors", label: "Connectors" },
  { href: "/connections", label: "Connections" },
] as const;

const PROMPT_SHORTCUTS = [
  "Resume-moi le desk du jour: verite PnL, no-trade, risque, V6 et priorites.",
  "Rappelle-moi le plan journalier a respecter avec hard stops et calibration gate.",
  "Explique-moi la différence entre fonds paper, live, exchange et wallet.",
  "Vérifie ce qu'il est possible de contrôler sur la plateforme et les fonds disponibles.",
  "Propose si la stratégie doit être promue vers un usage live et pourquoi.",
  "Résume-moi les pages utiles pour piloter le capital et les connecteurs.",
] as const;

const COMMANDANT_SHORTCUTS = [
  "Que faire maintenant sur le desk ?",
  "Dois-je trader maintenant ou attendre ?",
  "Si je passe outre, quel risque exact j'assume ?",
] as const;

export default function OpsChatbot() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [copilotMode, setCopilotMode] = useState<CopilotMode>("assistant");
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Je reponds en francais simple. Pose ta question comme tu la penses: je dois te dire quoi regarder, pourquoi c'est bloque, et quoi faire ensuite sans jargon inutile.",
    },
  ]);
  const [pendingAction, setPendingAction] = useState("run_runbook");
  const [actionRegime, setActionRegime] = useState("trend");
  const [actionTitle, setActionTitle] = useState("Derive strategie detectee");
  const [safeMode, setSafeMode] = useState(true);
  const [confirmToken, setConfirmToken] = useState("");
  const [confirmSummary, setConfirmSummary] = useState("");

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  useEffect(() => {
    function onPrompt(event: Event): void {
      const detail = (event as CustomEvent<OpsCopilotPromptDetail>).detail;
      const message = String(detail?.message || "").trim();
      if (!message) {
        return;
      }
      setOpen(true);
      setExpanded(true);
      if (detail?.autoSend) {
        void sendMessage(message);
        return;
      }
      setInput(message);
    }

    window.addEventListener("ops-copilot:prompt", onPrompt as EventListener);
    return () => window.removeEventListener("ops-copilot:prompt", onPrompt as EventListener);
  }, [loading]);

  async function sendMessage(forcedMessage?: string): Promise<void> {
    const message = String(forcedMessage ?? input).trim();
    if (!message) {
      return;
    }
    setMessages((prev) => [...prev, { role: "user", text: message }]);
    setInput("");
    setLoading(true);

    const requestMessage = copilotMode === "commandant"
      ? `Mode commandant. Reponds en francais naturel, court, sans jargon inutile, avec: DECISION, RISQUE, RAISON, ACTION. Explique les termes techniques si tu les utilises. ${message}`
      : `Reponds en francais naturel et comprehensible pour un operateur. Donne une reponse courte, concrete, avec les chiffres utiles et l'action suivante. Question: ${message}`;

    try {
      const response = await fetch("/api/chat/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: requestMessage }),
      });
      const payload = (await response.json()) as ChatResponse;
      const text = String(payload.reply || "Aucune reponse");
      const actions = (payload.actions || []).map((a) => `#${a}`).join(" ");
      const suggestions = (payload.suggested_actions || [])
        .map((s) => String(s.label || s.type || "action"))
        .join(" | ");
      setMessages((prev) => [...prev, { role: "assistant", text: `${text}${actions ? `\n${actions}` : ""}` }]);
      if ((payload.actions || []).includes("open_incident_board")) {
        setMessages((prev) => [...prev, { role: "assistant", text: "Ouvre /incidents pour traiter les tickets." }]);
      }
      if ((payload.actions || []).includes("open_live_capital")) {
        setMessages((prev) => [...prev, { role: "assistant", text: "Ouvre /live-capital pour distinguer paper/live/exchange/wallet, vérifier les comptes source et poser les caps d'allocation." }]);
      }
      if ((payload.actions || []).includes("open_live_ops")) {
        setMessages((prev) => [...prev, { role: "assistant", text: "Ouvre /live-ops pour lire le truth line, le plan journalier et la calibration gate du desk." }]);
      }
      if ((payload.actions || []).includes("open_terminal_truth")) {
        setMessages((prev) => [...prev, { role: "assistant", text: "Ouvre /terminal et regarde le panneau Execution PnL Truth pour comparer regime, venue, execution mode et flags haute confiance." }]);
      }
      if ((payload.actions || []).includes("open_live_readiness")) {
        setMessages((prev) => [...prev, { role: "assistant", text: "Ouvre /live-readiness pour voir les strategies suspendues, le drift et les garde-fous readiness." }]);
      }
      if ((payload.actions || []).includes("open_connectors_hub")) {
        setMessages((prev) => [...prev, { role: "assistant", text: "Ouvre /connectors ou /connections pour contrôler la plateforme, les credentials, les statuts d'intégration et les venues branchés." }]);
      }
      if ((payload.actions || []).includes("open_ai_desk")) {
        setMessages((prev) => [...prev, { role: "assistant", text: "Ouvre /ai pour relire la gouvernance de route, les sources de capital et les vérifications plateforme en langage naturel." }]);
      }
      if ((payload.actions || []).includes("review_strategy_promotion")) {
        setMessages((prev) => [...prev, { role: "assistant", text: "Va sur /live-capital pour confronter la proposition de promotion de stratégie au compte source, au cap USD et au niveau courant." }]);
      }
      if (suggestions) {
        setMessages((prev) => [...prev, { role: "assistant", text: `Actions guidees: ${suggestions}` }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Erreur reseau. Reessaie dans quelques secondes." }]);
    } finally {
      setLoading(false);
    }
  }

  async function runGuidedAction(): Promise<void> {
    if (loading) {
      return;
    }
    setLoading(true);
    let action: Record<string, unknown> = { type: pendingAction };
    if (pendingAction === "apply_threshold") {
      action = {
        type: "apply_threshold",
        regime: actionRegime,
        min_samples: 25,
        min_win_rate: 0.52,
        max_drawdown_usd: 1000,
        max_avg_loss_usd: 140,
      };
    }
    if (pendingAction === "open_incident_ticket") {
      action = {
        type: "open_incident_ticket",
        title: actionTitle,
        severity: "high",
        payload: { origin: "ops-chatbot" },
      };
    }
    if (pendingAction === "run_runbook") {
      action = { type: "run_runbook", name: "stabilize_trading" };
    }

    try {
      const response = await fetch("/api/chat/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, safe_mode: safeMode }),
      });
      const payload = (await response.json()) as ChatResponse;
      const status = String(payload.status || "");
      if (status === "confirmation_required") {
        const token = String(payload.confirmation?.token || "");
        setConfirmToken(token);
        setConfirmSummary(String(payload.confirmation?.summary || "Confirmer action"));
        setMessages((prev) => [...prev, { role: "assistant", text: `${String(payload.reply || "Confirmation requise")}\n${String(payload.confirmation?.expires_at || "")}` }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", text: String(payload.reply || "Action executee") }]);
        setConfirmToken("");
        setConfirmSummary("");
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Echec action guidee." }]);
    } finally {
      setLoading(false);
    }
  }

  async function confirmGuidedAction(): Promise<void> {
    if (!confirmToken || loading) {
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/chat/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_token: confirmToken, confirm_ack: true }),
      });
      const payload = (await response.json()) as ChatResponse;
      setMessages((prev) => [...prev, { role: "assistant", text: String(payload.reply || "Action confirmee") }]);
      setConfirmToken("");
      setConfirmSummary("");
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Confirmation echouee." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ops-chatbot-wrap">
      <button type="button" className="ops-chatbot-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "Masquer Copilot" : "Ops Copilot"}
      </button>
      {open ? (
        <div className={`ops-chatbot-panel ${expanded ? "is-expanded" : "is-compact"}`}>
          <div className="ops-chatbot-head">
            <span>Agent Ops</span>
            <div className="ops-chatbot-head-actions">
              <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Reduire" : "Agrandir"}</button>
              <button type="button" onClick={() => setOpen(false)}>Fermer</button>
            </div>
          </div>
            <div className="ops-chatbot-guided" style={{ paddingTop: 0 }}>
              <div className="ops-chatbot-mode-row">
                <label className="subtle mini" htmlFor="ops-copilot-mode">Mode</label>
                <select id="ops-copilot-mode" value={copilotMode} onChange={(event) => setCopilotMode(event.target.value as CopilotMode)}>
                  <option value="assistant">Français simple</option>
                  <option value="commandant">Decision directe</option>
                </select>
              </div>
              <div className="subtle mini">
                {copilotMode === "commandant"
                  ? "Je tranche: attendre, reduire, couper ou executer petit."
                  : "Tu peux poser une question normale, je traduis le desk en langage clair."}
              </div>
              {expanded ? (
                <details className="ops-chatbot-details">
                  <summary>Raccourcis et questions types</summary>
                  <div className="ops-chatbot-shortcuts">
                    {PAGE_SHORTCUTS.map((shortcut) => (
                      <a key={shortcut.href} href={shortcut.href} className="subtle mini">{shortcut.label}</a>
                    ))}
                  </div>
                  {copilotMode === "commandant" ? (
                    <div className="ops-chatbot-shortcuts vertical">
                    {COMMANDANT_SHORTCUTS.map((shortcut) => (
                      <button key={shortcut} type="button" disabled={loading} onClick={() => void sendMessage(shortcut)}>
                        {shortcut}
                      </button>
                    ))}
                    </div>
                  ) : null}
                  <div className="ops-chatbot-shortcuts vertical">
                    {PROMPT_SHORTCUTS.map((shortcut) => (
                      <button key={shortcut} type="button" disabled={loading} onClick={() => void sendMessage(shortcut)}>
                        {shortcut}
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          <div className="ops-chatbot-messages">
            {messages.map((m, idx) => (
              <div key={`${m.role}-${idx}`} className={m.role === "assistant" ? "chat-bubble assistant" : "chat-bubble user"}>
                {m.text}
              </div>
            ))}
          </div>
          <div className="ops-chatbot-input-row">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pose une question operationnelle..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSend) {
                  void sendMessage();
                }
              }}
            />
            <button type="button" disabled={!canSend} onClick={() => void sendMessage()}>
              {loading ? "..." : "Envoyer"}
            </button>
          </div>
          {expanded ? <div className="ops-chatbot-guided">
            <label className="subtle mini" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={safeMode} onChange={(e) => setSafeMode(e.target.checked)} />
              Confirmation en 2 etapes pour action sensible
            </label>
            <select value={pendingAction} onChange={(e) => setPendingAction(e.target.value)}>
              <option value="run_runbook">Lancer runbook</option>
              <option value="apply_threshold">Appliquer seuil regime</option>
              <option value="open_incident_ticket">Ouvrir ticket incident</option>
            </select>
            {pendingAction === "apply_threshold" ? (
              <input value={actionRegime} onChange={(e) => setActionRegime(e.target.value)} placeholder="regime" />
            ) : null}
            {pendingAction === "open_incident_ticket" ? (
              <input value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} placeholder="titre incident" />
            ) : null}
            <button type="button" disabled={loading} onClick={() => void runGuidedAction()}>
              {loading ? "..." : "Executer action"}
            </button>
            {confirmToken ? (
              <>
                <div className="subtle mini">{confirmSummary}</div>
                <button type="button" disabled={loading} onClick={() => void confirmGuidedAction()}>
                  {loading ? "..." : "Confirmer action sensible"}
                </button>
              </>
            ) : null}
            <a href="/incidents" className="subtle mini">Ouvrir Incidents</a>
          </div> : null}
        </div>
      ) : null}
    </div>
  );
}
