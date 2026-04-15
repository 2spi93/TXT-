export const EXECUTION_DECISION_POLICY_VERSION = "2026-04-phase-1.5" as const;

export type ExecutionDecisionCode =
  | "runtime-kill-switch-active"
  | "runtime-external-kill-switch-active"
  | "runtime-watchdog-halt"
  | "runtime-recovery-lockdown"
  | "runtime-live-readiness-degraded"
  | "runtime-mt5-bridge-degraded"
  | "engine-v4-off"
  | "fallback-mode"
  | "routing-score-zero"
  | "routing-blocked"
  | "execution-v7-blocked"
  | "execution-v7-outcome-positive"
  | "execution-v7-outcome-neutral"
  | "execution-v7-outcome-negative";

export type ExecutionDecisionSeverity = "info" | "warn" | "critical";

export type ExecutionDecisionSource =
  | "system-runtime-guard"
  | "execution-policy-engine"
  | "routing-guard"
  | "execution-feedback";

export type ExecutionDecisionAudit = {
  code: ExecutionDecisionCode;
  severity: ExecutionDecisionSeverity;
  source: ExecutionDecisionSource;
  priority: number;
  policyVersion: typeof EXECUTION_DECISION_POLICY_VERSION;
  summary: string;
};

const EXECUTION_DECISION_DEFINITIONS: Record<ExecutionDecisionCode, Omit<ExecutionDecisionAudit, "code" | "policyVersion" | "summary">> = {
  "runtime-kill-switch-active": { severity: "critical", source: "system-runtime-guard", priority: 100 },
  "runtime-external-kill-switch-active": { severity: "critical", source: "system-runtime-guard", priority: 95 },
  "runtime-watchdog-halt": { severity: "critical", source: "system-runtime-guard", priority: 92 },
  "runtime-recovery-lockdown": { severity: "critical", source: "system-runtime-guard", priority: 90 },
  "runtime-live-readiness-degraded": { severity: "critical", source: "system-runtime-guard", priority: 88 },
  "runtime-mt5-bridge-degraded": { severity: "critical", source: "system-runtime-guard", priority: 86 },
  "engine-v4-off": { severity: "critical", source: "execution-policy-engine", priority: 84 },
  "fallback-mode": { severity: "critical", source: "routing-guard", priority: 80 },
  "routing-score-zero": { severity: "warn", source: "routing-guard", priority: 74 },
  "routing-blocked": { severity: "warn", source: "routing-guard", priority: 70 },
  "execution-v7-blocked": { severity: "warn", source: "execution-policy-engine", priority: 64 },
  "execution-v7-outcome-positive": { severity: "info", source: "execution-feedback", priority: 30 },
  "execution-v7-outcome-neutral": { severity: "info", source: "execution-feedback", priority: 26 },
  "execution-v7-outcome-negative": { severity: "warn", source: "execution-feedback", priority: 34 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeExecutionDecisionOutcomeCode(classification: unknown): ExecutionDecisionCode {
  const normalized = String(classification || "").trim().toLowerCase();
  if (/(good|positive|profit|win|clean|ok|success)/.test(normalized)) {
    return "execution-v7-outcome-positive";
  }
  if (/(bad|negative|loss|fail|blocked|reject|degraded|warn)/.test(normalized)) {
    return "execution-v7-outcome-negative";
  }
  return "execution-v7-outcome-neutral";
}

export function normalizeExecutionLockDecisionCode(value: unknown): ExecutionDecisionCode | null {
  switch (String(value || "").trim().toLowerCase()) {
    case "kill-switch-active":
      return "runtime-kill-switch-active";
    case "external-kill-switch-active":
      return "runtime-external-kill-switch-active";
    case "watchdog-halt":
      return "runtime-watchdog-halt";
    case "recovery-lockdown":
      return "runtime-recovery-lockdown";
    case "live-readiness-degraded":
      return "runtime-live-readiness-degraded";
    case "mt5-bridge-degraded":
      return "runtime-mt5-bridge-degraded";
    case "engine-v4-off":
      return "engine-v4-off";
    case "fallback-mode":
      return "fallback-mode";
    case "routing-score-zero":
      return "routing-score-zero";
    case "routing-blocked":
      return "routing-blocked";
    default:
      return null;
  }
}

export function resolveExecutionDecisionCodeFromJournalAction(
  action: string,
  options?: { executionLockCode?: unknown },
): ExecutionDecisionCode | null {
  const normalizedAction = action.trim().toLowerCase();
  if (normalizedAction === "execution-v7-blocked") {
    return "execution-v7-blocked";
  }
  if (normalizedAction.startsWith("execution-v7-outcome-")) {
    return normalizeExecutionDecisionOutcomeCode(normalizedAction.slice("execution-v7-outcome-".length));
  }
  if (normalizedAction === "execution-disabled-policy") {
    return "engine-v4-off";
  }
  if (normalizedAction === "execution-disabled-fallback") {
    return "fallback-mode";
  }
  if (normalizedAction === "execution-disabled-routing") {
    return normalizeExecutionLockDecisionCode(options?.executionLockCode);
  }
  return null;
}

export function buildExecutionDecisionAudit(input: {
  code: ExecutionDecisionCode;
  summary?: string;
}): ExecutionDecisionAudit {
  const definition = EXECUTION_DECISION_DEFINITIONS[input.code];
  return {
    code: input.code,
    severity: definition.severity,
    source: definition.source,
    priority: definition.priority,
    policyVersion: EXECUTION_DECISION_POLICY_VERSION,
    summary: String(input.summary || "").trim(),
  };
}

export function buildExecutionDecisionAuditFromLockState(lockState: {
  active?: unknown;
  code?: unknown;
  summaryLabel?: unknown;
} | null | undefined): ExecutionDecisionAudit | null {
  if (!lockState || !lockState.active) {
    return null;
  }
  const code = normalizeExecutionLockDecisionCode(lockState.code);
  if (!code) {
    return null;
  }
  return buildExecutionDecisionAudit({
    code,
    summary: String(lockState.summaryLabel || "").trim(),
  });
}

export function validateExecutionDecisionAudit(value: unknown): ExecutionDecisionAudit | null {
  if (!isRecord(value)) {
    return null;
  }
  const code = String(value.code || "").trim() as ExecutionDecisionCode;
  if (!Object.prototype.hasOwnProperty.call(EXECUTION_DECISION_DEFINITIONS, code)) {
    return null;
  }
  const summary = String(value.summary || "").trim();
  const priority = Number(value.priority);
  const policyVersion = String(value.policyVersion || "").trim();
  const severity = String(value.severity || "").trim() as ExecutionDecisionSeverity;
  const source = String(value.source || "").trim() as ExecutionDecisionSource;
  if (!summary || !Number.isFinite(priority) || !policyVersion || !severity || !source) {
    return null;
  }
  const definition = EXECUTION_DECISION_DEFINITIONS[code];
  if (definition.priority !== priority || definition.severity !== severity || definition.source !== source) {
    return null;
  }
  return {
    code,
    severity,
    source,
    priority,
    policyVersion: policyVersion as typeof EXECUTION_DECISION_POLICY_VERSION,
    summary,
  };
}