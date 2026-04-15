#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { DEFAULT_FILE, analyzeRuntimeLog } = require("./runtime_log_core");

const DEFAULT_OUTPUT = "artifacts/runtime-log-operator-note.md";

function parseArgs(argv) {
  const options = {
    file: DEFAULT_FILE,
    out: DEFAULT_OUTPUT,
    samples: 3,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--file" && argv[index + 1]) {
      options.file = argv[index + 1];
      index += 1;
      continue;
    }
    if ((token === "--out" || token === "--output") && argv[index + 1]) {
      options.out = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--samples" && argv[index + 1]) {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        options.samples = Math.round(value);
      }
      index += 1;
    }
  }

  return options;
}

function firstEntry(entries, fallbackKey) {
  const [key, count] = Array.isArray(entries) && entries.length > 0 ? entries[0] : [fallbackKey, 0];
  return { key, count };
}

function share(count, total) {
  return total > 0 ? ((count / total) * 100).toFixed(2) : "0.00";
}

function markdownTable(headers, rows) {
  const head = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`);
  return [head, separator, ...body].join("\n");
}

function buildExecutiveRead(summary) {
  const noTradeRows = summary.totals.noTradeRows;
  const dominantBucket = firstEntry(summary.byBucket, "unknown");
  const dominantCode = firstEntry(summary.topCodes.map((row) => [row.code, row.count]), "unknown");
  const insights = [];

  if (dominantBucket.key === "market") {
    insights.push(`Le NO_TRADE est d'abord un probleme de rarete d'opportunite marche/routing: ${dominantBucket.count}/${noTradeRows} cas (${share(dominantBucket.count, noTradeRows)}%).`);
  } else if (dominantBucket.key === "runtime") {
    insights.push(`Le runtime est la premiere source de refus: ${dominantBucket.count}/${noTradeRows} cas (${share(dominantBucket.count, noTradeRows)}%). Priorite a readiness, recovery et fallback.`);
  } else if (dominantBucket.key === "policy") {
    insights.push(`La gouvernance policy domine les refus: ${dominantBucket.count}/${noTradeRows} cas (${share(dominantBucket.count, noTradeRows)}%). Verifier les garde-fous avant toute extraction EMS.`);
  }

  insights.push(`Le code dominant est ${dominantCode.key}: ${dominantCode.count}/${noTradeRows} cas (${share(dominantCode.count, noTradeRows)}%).`);

  if (summary.semanticMismatchCandidates.count > 0) {
    insights.push(`Dette de journal detectee: ${summary.semanticMismatchCandidates.count} mismatch(s) semantiques (${summary.semanticMismatchCandidates.sharePct}% des NO_TRADE).`);
  }
  if (summary.falsePositiveCandidates.count > 0) {
    insights.push(`Zone a revoir cote faux positifs potentiels: ${summary.falsePositiveCandidates.count} cas (${summary.falsePositiveCandidates.sharePct}% des NO_TRADE) en contexte stable.`);
  }
  if (summary.totals.effectiveCanonicalCoveragePct < 100) {
    insights.push(`La couverture canonique effective reste incomplete a ${summary.totals.effectiveCanonicalCoveragePct}%. Le backfill reste necessaire pour la lecture historique.`);
  } else {
    insights.push(`La lecture analytique est complete a ${summary.totals.effectiveCanonicalCoveragePct}% apres normalisation.`);
  }

  return insights;
}

function buildWatchItems(summary) {
  const items = [];
  if (summary.semanticMismatchCandidates.samples.length > 0) {
    const sample = summary.semanticMismatchCandidates.samples[0];
    items.push(`Corriger la journalisation ${sample.code}: detail contradictoire detecte sur ${sample.action}.`);
  }
  if (summary.falsePositiveCandidates.samples.length > 0) {
    const sample = summary.falsePositiveCandidates.samples[0];
    items.push(`Rejouer ${sample.code} en contexte stable pour confirmer si le blocage est encore justifie.`);
  }
  const dominantCode = summary.topCodes[0];
  if (dominantCode) {
    if (dominantCode.code === "routing-score-zero") {
      items.push("Levier principal: enrichir le score routing et mieux distinguer absence d'edge vs blocage technique.");
    }
    if (dominantCode.code === "engine-v4-off") {
      items.push("Levier principal: garder la policy explicite V4 OFF => NO_TRADE visible dans le dashboard et le runbook operateur.");
    }
  }
  if (items.length === 0) {
    items.push("Aucun signal critique supplementaire dans cette fenetre.");
  }
  return items;
}

function renderMarkdown(summary) {
  const generatedAt = new Date().toISOString();
  const noTradeRows = summary.totals.noTradeRows;
  const dominantBucket = firstEntry(summary.byBucket, "unknown");
  const dominantAttention = firstEntry(summary.marketContext.attentionState, "unknown");
  const dominantRegime = firstEntry(summary.marketContext.volatilityRegime, "unknown");
  const dominantTripleValidation = firstEntry(summary.marketContext.tripleValidationState, "unknown");

  const kpiTable = markdownTable(
    ["KPI", "Valeur", "Lecture"],
    [
      ["Execution rows", String(summary.totals.executionRows), "Population analysee"],
      ["NO_TRADE rows", `${summary.totals.noTradeRows} (${summary.totals.noTradePctWithinExecution}%)`, "Pression de refus dans l'execution"],
      ["Canonical coverage", `${summary.totals.canonicalRows} natif / ${summary.totals.effectiveCanonicalCoveragePct}% effectif`, "Niveau de confiance de lecture"],
      ["Dominant bucket", `${dominantBucket.key} (${share(dominantBucket.count, noTradeRows)}%)`, "Premier axe d'investigation"],
      ["Semantic mismatch", `${summary.semanticMismatchCandidates.count} (${summary.semanticMismatchCandidates.sharePct}%)`, "Dette de journalisation"],
      ["False positive candidats", `${summary.falsePositiveCandidates.count} (${summary.falsePositiveCandidates.sharePct}%)`, "Blocages a rejouer"],
      ["Attention state dominant", `${dominantAttention.key} (${share(dominantAttention.count, noTradeRows)}%)`, "Etat runtime/confiance de fond"],
      ["Volatility regime dominant", `${dominantRegime.key} (${share(dominantRegime.count, noTradeRows)}%)`, "Regime de marche le plus frequent"],
    ],
  );

  const topCodeTable = markdownTable(
    ["Code", "Bucket", "Count", "Share"],
    summary.topCodes.slice(0, 6).map((row) => [row.code, row.bucket, String(row.count), `${row.sharePct}%`]),
  );

  const bucketTable = markdownTable(
    ["Bucket", "Count", "Share"],
    summary.byBucket.map(([bucket, count]) => [bucket, String(count), `${share(count, noTradeRows)}%`]),
  );

  const contextTable = markdownTable(
    ["Vue", "Top state", "Share"],
    [
      ["Attention", dominantAttention.key, `${share(dominantAttention.count, noTradeRows)}%`],
      ["Volatility", dominantRegime.key, `${share(dominantRegime.count, noTradeRows)}%`],
      ["Triple validation", dominantTripleValidation.key, `${share(dominantTripleValidation.count, noTradeRows)}%`],
    ],
  );

  const executiveRead = buildExecutiveRead(summary).map((item) => `- ${item}`).join("\n");
  const watchItems = buildWatchItems(summary).map((item) => `- ${item}`).join("\n");
  const mismatchItems = summary.semanticMismatchCandidates.samples.map((sample) => `- ${sample.code} | ${sample.action} | ${sample.detail || "no detail"}`).join("\n") || "- Aucun sample sur cette run.";
  const falsePositiveItems = summary.falsePositiveCandidates.samples.map((sample) => `- ${sample.code} | attention=${sample.attentionState} | busSeq=${sample.busSeq} | depthAgeMs=${sample.depthAgeMs == null ? "na" : sample.depthAgeMs}`).join("\n") || "- Aucun sample sur cette run.";

  return [
    "# Runtime Decision Operator Note",
    "",
    `- Generated at: ${generatedAt}`,
    `- Source journal: ${summary.file}`,
    "- Scope: execution refusal intelligence pre-EMS",
    "",
    "## KPI snapshot",
    "",
    kpiTable,
    "",
    "## Lecture operateur",
    "",
    executiveRead,
    "",
    "## Top canonical codes",
    "",
    topCodeTable,
    "",
    "## Bucket split",
    "",
    bucketTable,
    "",
    "## Market context",
    "",
    contextTable,
    "",
    "## Hygiene watch",
    "",
    `- Semantic mismatch candidates: ${summary.semanticMismatchCandidates.count}`,
    mismatchItems,
    `- False positive candidates: ${summary.falsePositiveCandidates.count}`,
    falsePositiveItems,
    "",
    "## Immediate actions",
    "",
    watchItems,
    "",
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await analyzeRuntimeLog({ file: options.file, samples: options.samples });
  const markdown = renderMarkdown(summary);
  const absoluteOutput = path.resolve(options.out);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, markdown, "utf8");
  console.log(`Operator note written to ${absoluteOutput}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});