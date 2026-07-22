#!/usr/bin/env node

function normalizeRecord(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  return raw;
}

function firstLine(value) {
  return String(value || "none").split(/\r?\n/, 1)[0].trim() || "none";
}

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseUrlParts(value) {
  const url = typeof value === "string" ? value : "";
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isLoopbackUrl(parsed) {
  if (!parsed) return false;
  const host = String(parsed.hostname || "").trim().toLowerCase();
  return host === "127.0.0.1" || host === "localhost";
}

function isNoiseFailure(item) {
  const parsed = parseUrlParts(item?.url);
  if (!parsed) {
    return false;
  }
  if (parsed.searchParams.has("_rsc")) {
    return true;
  }
  if (parsed.pathname.startsWith("/_next/")) {
    return true;
  }
  return false;
}

function renderPathWithStatus(item) {
  const url = typeof item?.url === "string" ? item.url : "";
  const status = item?.status == null ? "" : String(item.status);
  const parsed = parseUrlParts(url);
  if (!parsed) {
    return url ? `${url}${status ? ` (HTTP ${status})` : ""}` : (status ? `HTTP ${status}` : "");
  }
  const path = `${parsed.pathname}${parsed.search || ""}`;
  return `${path}${status ? ` (HTTP ${status})` : ""}`;
}

function renderDisplayUrl(value, fallback, options = {}) {
  const parsed = parseUrlParts(value);
  if (!parsed) {
    return fallback;
  }
  if (isLoopbackUrl(parsed)) {
    if (options.pathOnly) {
      return `${parsed.pathname}${parsed.search || ""}`;
    }
    return fallback;
  }
  return parsed.toString();
}

function summarizeFailures(record) {
  const requestFailures = Array.isArray(record.requestFailures) ? record.requestFailures : [];
  const responseErrors = Array.isArray(record.responseErrors) ? record.responseErrors : [];
  const failures = uniq(requestFailures.filter((item) => !isNoiseFailure(item)).slice(0, 3).map((item) => renderPathWithStatus(item)));
  const responses = uniq(responseErrors.filter((item) => !isNoiseFailure(item)).slice(0, 3).map((item) => renderPathWithStatus(item)));
  return { failures, responses };
}

function classifyDependencyImpact(record) {
  const { failures, responses } = summarizeFailures(record);
  const combined = [...failures, ...responses].join(" ");

  if (/\/api\/market\/bus\/snapshot/i.test(combined)) {
    return "Le flux market bus a echoue pendant le controle.";
  }
  if (/\/api\/market\/quotes/i.test(combined)) {
    return "Les cotations marche ne sont pas revenues correctement.";
  }
  if (/\/api\/connectors\/status/i.test(combined)) {
    return "L etat des connecteurs n a pas pu etre confirme.";
  }
  if (/\/api\/auth\/login|\/login/i.test(combined)) {
    return "La phase d authentification semble instable.";
  }
  if (combined) {
    return "Certaines dependances web ont echoue pendant le controle.";
  }
  return "";
}

function statusLabel(status) {
  if (status === "error") return "Incident technique";
  if (status === "degraded") return "Surveillance degradee";
  if (status === "warming") return "Surveillance en chauffe";
  if (status === "ready") return "Surveillance operationnelle";
  return "Etat inconnu";
}

function alertModeLabel(mode, repeatCount) {
  if (mode === "repeat-threshold") {
    return `Erreur repetee ${repeatCount} fois`;
  }
  if (mode === "transition") {
    return "Nouvelle alerte";
  }
  return "Information de surveillance";
}

function explainReason(record) {
  const reason = String(record.reason || "none");
  const reasonLine = firstLine(reason);
  const state = record.state && typeof record.state === "object" ? record.state : {};
  const dependencyImpact = classifyDependencyImpact(record);

  if (!reason || reason === "none") {
    return {
      summary: "Le robot de surveillance a remonte une anomalie sans detail supplementaire.",
      impact: "La surveillance automatique peut etre incomplete.",
      action: "Verifier les journaux du truth observer et l etat du conteneur Mission Control.",
    };
  }

  if (reason === "truth_telemetry_ready") {
    return {
      summary: "Le terminal a ete charge et la telemetrie minimale est lisible.",
      impact: "La surveillance confirme que l ecran est exploitable sur ce cycle.",
      action: "Aucune action urgente. Continuer la surveillance normale.",
    };
  }

  if (reason === "telemetry_warming") {
    return {
      summary: "Le terminal repond mais ses preuves de telemetrie sont encore en phase de chauffe.",
      impact: "Le cycle observe un warmup normal et ne confirme pas encore un etat pleinement exploitable.",
      action: "Aucune escalade immediate. Attendre le cycle suivant et n investiguer que si l etat persiste ou regresse.",
    };
  }

  if (reason === "mission_control_not_ready") {
    return {
      summary: "Mission Control ne repondait pas encore quand le controle a demarre.",
      impact: "Aucun diagnostic terminal fiable n a pu etre produit sur ce cycle.",
      action: "Verifier si l interface vient de redemarrer ou si le service web est bloque.",
    };
  }

  if (reason === "observer_output_missing") {
    return {
      summary: "Le robot de surveillance a demarre mais n a produit aucun resultat exploitable.",
      impact: "Le cycle de controle est incomplet.",
      action: "Verifier les journaux du script terminal truth observer dans le conteneur cible.",
    };
  }

  if (reason === "truth_strip_missing") {
    return {
      summary: "Le terminal s est ouvert mais la bande de verite n etait pas visible.",
      impact: dependencyImpact || "Le robot ne peut pas confirmer l etat reel du terminal.",
      action: "Verifier le rendu de la page terminal, ses APIs critiques et l initialisation de ses composants.",
    };
  }

  if (reason === "truth_labels_missing") {
    return {
      summary: "La bande de verite etait presente mais incomplete.",
      impact: "Les indicateurs minimums pour conclure sur la sante du terminal manquent.",
      action: "Verifier si les labels clock et lag sont bien rendus et alimentes.",
    };
  }

  if (reason === "truth_present_but_not_telemetry_ready") {
    const feed = String(state.feedLabel || "");
    const exchange = String(state.exchangeLabel || "");
    const lag = String(state.lagLabel || "");
    const causes = [];
    if (/WARMING/i.test(feed) || /WARMING/i.test(exchange)) {
      causes.push("les flux de marche sont encore en phase de chauffe");
    }
    if (/PARTIAL/i.test(feed)) {
      causes.push("la telemetrie est seulement partielle");
    }
    if (/pending|n\/a/i.test(lag) || /pending|n\/a/i.test(exchange)) {
      causes.push("certaines horloges ou mesures de latence ne sont pas encore disponibles");
    }
    const causeText = causes.length > 0 ? `${causes.join(", ")}.` : "les donnees de verite ne sont pas encore suffisamment coherentes.";
    return {
      summary: "Le terminal repond mais la telemetrie n est pas encore exploitable.",
      impact: `La surveillance voit le terminal, mais ${causeText}`,
      action: "Attendre un cycle supplementaire puis verifier les flux chart, exchange et bus si l etat persiste.",
    };
  }

  if (/page\.goto: Page crashed/i.test(reasonLine)) {
    return {
      summary: "Le navigateur de surveillance a crash pendant l ouverture du terminal.",
      impact: "Le robot n a pas pu charger l ecran de controle.",
      action: "Verifier la stabilite Chromium/Playwright et les ressources CPU, RAM et shared memory du conteneur Mission Control.",
    };
  }

  if (/page\.evaluate: Target crashed/i.test(reasonLine)) {
    return {
      summary: "Le navigateur de surveillance a crash pendant la lecture de l ecran terminal.",
      impact: dependencyImpact || "Le controle a ete interrompu apres chargement partiel de la page.",
      action: "Verifier la stabilite Chromium/Playwright, les erreurs front terminal et les appels reseau interrompus.",
    };
  }

  if (/page\.goto: Timeout .*\/login/i.test(reason) || /navigating to .*\/login/i.test(reason)) {
    return {
      summary: "La page de connexion n a pas repondu dans le delai attendu.",
      impact: "Le robot n a pas pu s authentifier pour atteindre le terminal.",
      action: "Verifier la route /login, le temps de reponse du frontend et l etat de l authentification.",
    };
  }

  if (/page\.goto: Timeout .*\/terminal/i.test(reason) || /navigating to .*\/terminal/i.test(reason)) {
    return {
      summary: "Le terminal a mis trop de temps a s ouvrir.",
      impact: "Le controle automatique a ete arrete avant de pouvoir lire l ecran.",
      action: "Verifier le temps de chargement du terminal, les appels reseau lents et la charge du conteneur.",
    };
  }

  if (/page\.waitForURL: Timeout/i.test(reasonLine)) {
    return {
      summary: "La navigation attendue apres connexion ne s est pas terminee dans les temps.",
      impact: "Le robot reste bloqe entre login et terminal.",
      action: "Verifier la redirection post-login et les middleware susceptibles de reboucler vers /login.",
    };
  }

  if (/page\.waitForResponse: Timeout/i.test(reasonLine)) {
    return {
      summary: "La reponse attendue d une API critique n est jamais revenue.",
      impact: "Le controle automatique a perdu un signal necessaire pour conclure.",
      action: "Verifier l endpoint attendu, sa latence et les erreurs reseau associees.",
    };
  }

  if (/page\.waitForLoadState: Timeout/i.test(reasonLine) || /Timeout .*exceeded/i.test(reasonLine) || /timed out/i.test(reasonLine)) {
    return {
      summary: "Le robot de surveillance a attendu trop longtemps sans reponse suffisante.",
      impact: dependencyImpact || "Le terminal est lent ou bloque sur une etape critique.",
      action: "Verifier les temps de chargement, les appels reseau lents et l etat du conteneur cible.",
    };
  }

  if (/auth|login/i.test(reasonLine)) {
    return {
      summary: "Le controle a rencontre un probleme d authentification.",
      impact: "Le robot ne peut pas atteindre le terminal avec une session valide.",
      action: "Verifier la route de login, les cookies de session et les redirections de securite.",
    };
  }

  if (/ERR_EMPTY_RESPONSE|ERR_ABORTED|ERR_CONNECTION|ECONNREFUSED|ENOTFOUND/i.test(reasonLine)) {
    return {
      summary: "Une ressource web indispensable a coupe ou refuse la connexion.",
      impact: dependencyImpact || "Le controle automatique ne peut pas se terminer correctement.",
      action: "Verifier l accessibilite du frontend et des APIs appelees pendant le chargement du terminal.",
    };
  }

  return {
    summary: "Le robot de surveillance a detecte une anomalie technique.",
    impact: dependencyImpact || "La surveillance automatique peut etre partielle ou indisponible.",
    action: "Consulter le motif technique et les journaux du terminal pour qualifier l incident.",
  };
}

function buildHumanAlert(recordInput) {
  const record = normalizeRecord(recordInput);
  const status = String(record.status || "unknown");
  const reason = String(record.reason || "none");
  const reasonLine = firstLine(reason);
  const repeatCount = Number(record.observerConsecutiveRepeatCount || 1);
  const alertMode = String(record.observerAlertMode || "transition");
  const explanation = explainReason(record);
  const { failures, responses } = summarizeFailures(record);
  const lines = [
    "TXT Mission Control - Alerte terminal",
    `Type: ${statusLabel(status)}`,
    `Resume: ${explanation.summary}`,
    `Impact: ${explanation.impact}`,
    `Action recommandee: ${explanation.action}`,
    "",
    "Contexte:",
    `- Instance: ${record.container || "unknown"}`,
    `- Slot: ${record.slot || "unknown"}`,
    `- Heure: ${record.hostCapturedAt || record.capturedAt || "unknown"}`,
    `- Frequence: ${alertModeLabel(alertMode, repeatCount)}`,
  ];

  if (failures.length > 0) {
    lines.push(`- Requetes coupees: ${failures.join(", ")}`);
  }
  if (responses.length > 0) {
    lines.push(`- Reponses en erreur: ${responses.join(", ")}`);
  }

  lines.push(
    "",
    "Details techniques:",
    `- Statut brut: ${status}`,
    `- Motif brut: ${reasonLine}`,
    `- URL de base: ${renderDisplayUrl(record.baseUrl, "interne au conteneur")}`,
    `- URL terminal: ${renderDisplayUrl(record.terminalUrl, "interne au conteneur", { pathOnly: true })}`,
  );

  return {
    text: lines.join("\n"),
    summary: explanation.summary,
    impact: explanation.impact,
    action: explanation.action,
    statusLabel: statusLabel(status),
  };
}

if (require.main === module) {
  const arg = process.argv[2] || "{}";
  const record = JSON.parse(arg);
  process.stdout.write(buildHumanAlert(record).text);
} else {
  module.exports = {
    buildHumanAlert,
    summarizeFailures,
    explainReason,
  };
}