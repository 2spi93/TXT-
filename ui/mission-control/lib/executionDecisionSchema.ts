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

export type ExecutionDecisionDeterminism = {
  runtime_epoch?: string;
  governance_epoch?: string;
  stream_offset?: string;
  decision_hash?: string;
  truth_hash?: string;
  policy_hash?: string;
};

export type ExecutionDecisionAudit = {
  code: ExecutionDecisionCode;
  severity: ExecutionDecisionSeverity;
  source: ExecutionDecisionSource;
  priority: number;
  policyVersion: typeof EXECUTION_DECISION_POLICY_VERSION;
  summary: string;
  oracleFingerprint?: string;
  determinism?: ExecutionDecisionDeterminism;
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

export function normalizeExecutionDecisionDeterminism(value: unknown): ExecutionDecisionDeterminism | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const runtime_epoch = String(value.runtime_epoch || "").trim();
  const governance_epoch = String(value.governance_epoch || "").trim();
  const stream_offset = String(value.stream_offset || "").trim();
  const decision_hash = String(value.decision_hash || "").trim();
  const truth_hash = String(value.truth_hash || "").trim();
  const policy_hash = String(value.policy_hash || "").trim();
  if (!runtime_epoch && !governance_epoch && !stream_offset && !decision_hash && !truth_hash && !policy_hash) {
    return undefined;
  }
  return {
    ...(runtime_epoch ? { runtime_epoch } : {}),
    ...(governance_epoch ? { governance_epoch } : {}),
    ...(stream_offset ? { stream_offset } : {}),
    ...(decision_hash ? { decision_hash } : {}),
    ...(truth_hash ? { truth_hash } : {}),
    ...(policy_hash ? { policy_hash } : {}),
  };
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
  oracleFingerprint?: string;
  determinism?: ExecutionDecisionDeterminism;
}): ExecutionDecisionAudit {
  const definition = EXECUTION_DECISION_DEFINITIONS[input.code];
  const oracleFingerprint = String(input.oracleFingerprint || "").trim();
  const determinism = normalizeExecutionDecisionDeterminism(input.determinism);
  return {
    code: input.code,
    severity: definition.severity,
    source: definition.source,
    priority: definition.priority,
    policyVersion: EXECUTION_DECISION_POLICY_VERSION,
    summary: String(input.summary || "").trim(),
    ...(oracleFingerprint ? { oracleFingerprint } : {}),
    ...(determinism ? { determinism } : {}),
  };
}

export function buildExecutionDecisionAuditFromLockState(lockState: {
  active?: unknown;
  code?: unknown;
  summaryLabel?: unknown;
  oracleFingerprint?: unknown;
  determinism?: unknown;
} | null | undefined, options?: {
  determinism?: ExecutionDecisionDeterminism;
}): ExecutionDecisionAudit | null {
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
    oracleFingerprint: String(lockState.oracleFingerprint || "").trim() || undefined,
    determinism: options?.determinism ?? normalizeExecutionDecisionDeterminism(lockState.determinism),
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
  const oracleFingerprint = value.oracleFingerprint === undefined ? undefined : String(value.oracleFingerprint || "").trim();
  const determinism = value.determinism === undefined ? undefined : normalizeExecutionDecisionDeterminism(value.determinism);
  if (!summary || !Number.isFinite(priority) || !policyVersion || !severity || !source) {
    return null;
  }
  if (value.oracleFingerprint !== undefined && !oracleFingerprint) {
    return null;
  }
  if (value.determinism !== undefined && !determinism) {
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
    ...(oracleFingerprint ? { oracleFingerprint } : {}),
    ...(determinism ? { determinism } : {}),
  };
}