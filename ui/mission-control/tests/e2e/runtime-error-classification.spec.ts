import { expect, test } from "@playwright/test";

import {
  buildStructuredRuntimeErrorBreakdown,
  classifyRuntimeErrors,
} from "./support/runtimeErrorClassification";

test("classifies websocket connection refusals as degraded runtime errors", () => {
  const verdict = classifyRuntimeErrors({
    consoleErrors: ["WebSocket connection to ws://127.0.0.1:8000/ws/market failed: ERR_CONNECTION_REFUSED"],
    pageErrors: [],
  });

  expect(verdict.ignored).toEqual([]);
  expect(verdict.degraded).toHaveLength(1);
  expect(verdict.critical).toEqual([]);
  expect(verdict.outcome).toBe("PASS_WITH_DEGRADATION");
});

test("uses expected-only verdict when runtime noise is explicitly expected", () => {
  const verdict = classifyRuntimeErrors({
    consoleErrors: ["Known temporary provider warning"],
    pageErrors: [],
    options: {
      expectedConsoleErrors: [/Known temporary provider warning/i],
    },
  });

  expect(verdict.expected).toHaveLength(1);
  expect(verdict.degraded).toEqual([]);
  expect(verdict.critical).toEqual([]);
  expect(verdict.outcome).toBe("PASS_WITH_EXPECTED_ERRORS");
});

test("builds a structured breakdown payload for observability consumers", () => {
  const verdict = classifyRuntimeErrors({
    consoleErrors: ["WebSocket connection to ws://127.0.0.1:8000/ws/market failed: ERR_CONNECTION_REFUSED"],
    pageErrors: ["Unhandled runtime explosion"],
  });

  const breakdown = buildStructuredRuntimeErrorBreakdown("market venues telemetry 500", verdict);

  expect(breakdown).toEqual({
    scenario: "market venues telemetry 500",
    errors: {
      ignored: [],
      expected: [],
      degraded: ["console: WebSocket connection to ws://127.0.0.1:8000/ws/market failed: ERR_CONNECTION_REFUSED"],
      critical: ["page: Unhandled runtime explosion"],
    },
    verdict: "FAIL_CRITICAL",
  });
});