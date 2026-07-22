export type RuntimeErrorSeverity = "IGNORED" | "EXPECTED_FAILURE" | "DEGRADED" | "CRITICAL";

export type RuntimeErrorOutcome = "PASS_CLEAN" | "PASS_WITH_EXPECTED_ERRORS" | "PASS_WITH_DEGRADATION" | "FAIL_CRITICAL";

export type RuntimeErrorChannel = "console" | "page";

export type RuntimeErrorClassificationOptions = {
  ignoredConsoleErrors?: RegExp[];
  expectedConsoleErrors?: RegExp[];
  degradedConsoleErrors?: RegExp[];
  ignoredPageErrors?: RegExp[];
  expectedPageErrors?: RegExp[];
  degradedPageErrors?: RegExp[];
  legacyAllowedConsoleErrors?: RegExp[];
};

export type ClassifiedRuntimeError = {
  channel: RuntimeErrorChannel;
  message: string;
  severity: RuntimeErrorSeverity;
};

export type RuntimeErrorVerdict = {
  status: "PASS" | "FAIL" | "DEGRADED";
  outcome: RuntimeErrorOutcome;
  ignored: ClassifiedRuntimeError[];
  expected: ClassifiedRuntimeError[];
  degraded: ClassifiedRuntimeError[];
  critical: ClassifiedRuntimeError[];
};

export type StructuredRuntimeErrorBreakdown = {
  scenario: string;
  errors: {
    ignored: string[];
    expected: string[];
    degraded: string[];
    critical: string[];
  };
  verdict: RuntimeErrorOutcome;
};

const DEFAULT_IGNORED_CONSOLE_ERRORS = [
] as const;

const DEFAULT_DEGRADED_CONSOLE_ERRORS = [
  /WebSocket connection to .*\/ws\//i,
  /ERR_CONNECTION_REFUSED.*\/ws\//i,
  /Failed to load resource: net::ERR_CONNECTION_REFUSED.*\/ws\//i,
  /WebSocket is closed before the connection is established/i,
  /\bNO_DATA(?:_[A-Z_]+)?\b/i,
  /\bUNKNOWN\b/i,
] as const;

function resolveOutcome(input: {
  expectedCount: number;
  degradedCount: number;
  criticalCount: number;
}): RuntimeErrorOutcome {
  if (input.criticalCount > 0) {
    return "FAIL_CRITICAL";
  }
  if (input.degradedCount > 0) {
    return "PASS_WITH_DEGRADATION";
  }
  if (input.expectedCount > 0) {
    return "PASS_WITH_EXPECTED_ERRORS";
  }
  return "PASS_CLEAN";
}

function resolvePatterns(input?: RegExp[], fallback: readonly RegExp[] = []): RegExp[] {
  return [...fallback, ...(input || [])];
}

function classifyMessage(message: string, channel: RuntimeErrorChannel, options: RuntimeErrorClassificationOptions): RuntimeErrorSeverity {
  const ignoredPatterns = channel === "console"
    ? resolvePatterns(options.ignoredConsoleErrors, DEFAULT_IGNORED_CONSOLE_ERRORS)
    : resolvePatterns(options.ignoredPageErrors);
  if (ignoredPatterns.some((pattern) => pattern.test(message))) {
    return "IGNORED";
  }

  const expectedPatterns = channel === "console"
    ? [...(options.expectedConsoleErrors || []), ...(options.legacyAllowedConsoleErrors || [])]
    : resolvePatterns(options.expectedPageErrors);
  if (expectedPatterns.some((pattern) => pattern.test(message))) {
    return "EXPECTED_FAILURE";
  }

  const degradedPatterns = channel === "console"
    ? resolvePatterns(options.degradedConsoleErrors, DEFAULT_DEGRADED_CONSOLE_ERRORS)
    : resolvePatterns(options.degradedPageErrors);
  if (degradedPatterns.some((pattern) => pattern.test(message))) {
    return "DEGRADED";
  }

  return "CRITICAL";
}

export function classifyRuntimeErrors(input: {
  consoleErrors: string[];
  pageErrors: string[];
  options?: RuntimeErrorClassificationOptions;
}): RuntimeErrorVerdict {
  const options = input.options || {};
  const classified: ClassifiedRuntimeError[] = [
    ...input.consoleErrors.map((message) => ({
      channel: "console" as const,
      message,
      severity: classifyMessage(message, "console", options),
    })),
    ...input.pageErrors.map((message) => ({
      channel: "page" as const,
      message,
      severity: classifyMessage(message, "page", options),
    })),
  ];

  const ignored = classified.filter((item) => item.severity === "IGNORED");
  const expected = classified.filter((item) => item.severity === "EXPECTED_FAILURE");
  const degraded = classified.filter((item) => item.severity === "DEGRADED");
  const critical = classified.filter((item) => item.severity === "CRITICAL");
  const outcome = resolveOutcome({
    expectedCount: expected.length,
    degradedCount: degraded.length,
    criticalCount: critical.length,
  });

  return {
    status: critical.length > 0 ? "FAIL" : degraded.length > 0 ? "DEGRADED" : "PASS",
    outcome,
    ignored,
    expected,
    degraded,
    critical,
  };
}

export function buildStructuredRuntimeErrorBreakdown(scenario: string, verdict: RuntimeErrorVerdict): StructuredRuntimeErrorBreakdown {
  return {
    scenario,
    errors: {
      ignored: verdict.ignored.map((item) => `${item.channel}: ${item.message}`),
      expected: verdict.expected.map((item) => `${item.channel}: ${item.message}`),
      degraded: verdict.degraded.map((item) => `${item.channel}: ${item.message}`),
      critical: verdict.critical.map((item) => `${item.channel}: ${item.message}`),
    },
    verdict: verdict.outcome,
  };
}

export function formatRuntimeErrorVerdict(verdict: RuntimeErrorVerdict): string {
  return `status=${verdict.status} outcome=${verdict.outcome} ignored=${verdict.ignored.length} expected=${verdict.expected.length} degraded=${verdict.degraded.length} critical=${verdict.critical.length}`;
}