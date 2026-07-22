type JsonRecord = Record<string, unknown>;

const TERMINAL_RUNTIME_ALERT_LIMIT = 8;
const TERMINAL_RUNTIME_AUDIT_LIMIT = 8;
const TERMINAL_RUNTIME_RISK_TIMELINE_LIMIT = 8;
const TERMINAL_RUNTIME_EXPOSURE_LIMIT = 6;
const TERMINAL_RUNTIME_VENUE_RANKING_LIMIT = 6;
const TERMINAL_RUNTIME_REASON_LIMIT = 6;
const TERMINAL_RUNTIME_TRIGGER_LIMIT = 4;

function safeRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function safeRows(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function safeTextArray(value: unknown, maxCount: number): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, maxCount)
    : [];
}

export function summarizeRuntimeOperationsForTerminal(value: unknown): JsonRecord {
  const runtimeOps = safeRecord(value);
  const governance = safeRecord(runtimeOps.governance);
  const opportunityGate = safeRecord(governance.opportunity_gate);
  const risk = safeRecord(runtimeOps.risk_snapshot);
  const warfare = safeRecord(runtimeOps.warfare_core);
  const arbitrage = safeRecord(warfare.arbitrage);
  const killSwitch = safeRecord(safeRecord(runtimeOps.raw).kill_switch);
  const watchdog = safeRecord(runtimeOps.watchdog_state);

  return {
    determinism: safeRecord(runtimeOps.determinism),
    watchdog_state: {
      status: watchdog.status ?? null,
      health_score: watchdog.health_score ?? null,
      drift: watchdog.drift ?? null,
      triggers: safeTextArray(watchdog.triggers, TERMINAL_RUNTIME_TRIGGER_LIMIT),
    },
    governance: {
      mode: governance.mode ?? null,
      backend_mode: governance.backend_mode ?? null,
      opportunity_gate: {
        state: opportunityGate.state ?? null,
        eligible: opportunityGate.eligible ?? null,
        summary: opportunityGate.summary ?? null,
        reasons: safeTextArray(opportunityGate.reasons, TERMINAL_RUNTIME_REASON_LIMIT),
      },
    },
    recovery: {
      mode: safeRecord(runtimeOps.recovery).mode ?? null,
      active: safeRecord(runtimeOps.recovery).active ?? null,
      blocked_trades: safeRecord(runtimeOps.recovery).blocked_trades ?? null,
      status: safeRecord(runtimeOps.recovery).status ?? null,
    },
    memory_gap: {
      memory_decision: safeRecord(runtimeOps.memory_gap).memory_decision ?? null,
      reality_gap_score: safeRecord(runtimeOps.memory_gap).reality_gap_score ?? null,
      summary: safeRecord(runtimeOps.memory_gap).summary ?? null,
    },
    controlled_collection: {
      next_action: safeRecord(runtimeOps.controlled_collection).next_action ?? null,
      state: safeRecord(runtimeOps.controlled_collection).state ?? null,
      status: safeRecord(runtimeOps.controlled_collection).status ?? null,
    },
    raw: {
      kill_switch: {
        active: killSwitch.active ?? null,
        state: safeRecord(killSwitch.state),
      },
    },
    risk_snapshot: {
      dd_pct: risk.dd_pct ?? null,
      dd_usd: risk.dd_usd ?? null,
      avg_slippage_bps: risk.avg_slippage_bps ?? null,
      daily_used_usd: risk.daily_used_usd ?? null,
      exposure_by_symbol: safeRows(risk.exposure_by_symbol)
        .slice(0, TERMINAL_RUNTIME_EXPOSURE_LIMIT)
        .map((row) => ({
          symbol: row.symbol ?? null,
          notionalUsd: row.notionalUsd ?? row.notional_usd ?? null,
        })),
    },
    risk_timeline: safeRows(runtimeOps.risk_timeline)
      .slice(0, TERMINAL_RUNTIME_RISK_TIMELINE_LIMIT)
      .map((row) => ({
        at: row.at ?? null,
        exposure_symbol: row.exposure_symbol ?? row.symbol ?? null,
        dd_pct: row.dd_pct ?? null,
      })),
    audit_trail: safeRows(runtimeOps.audit_trail)
      .slice(0, TERMINAL_RUNTIME_AUDIT_LIMIT)
      .map((row) => ({
        at: row.at ?? null,
        route: row.route ?? null,
        decision: row.decision ?? null,
        result: row.result ?? null,
      })),
    alerts: safeRows(runtimeOps.alerts)
      .slice(0, TERMINAL_RUNTIME_ALERT_LIMIT)
      .map((row) => ({
        severity: row.severity ?? null,
        level: row.level ?? null,
        code: row.code ?? null,
        type: row.type ?? null,
        message: row.message ?? null,
        detail: row.detail ?? null,
      })),
    warfare_core: {
      arbitrage: {
        executable: arbitrage.executable ?? null,
        netEdgeBps: arbitrage.netEdgeBps ?? arbitrage.net_edge_bps ?? null,
        maxExecutableUsd: arbitrage.maxExecutableUsd ?? arbitrage.max_executable_usd ?? null,
        buyVenue: arbitrage.buyVenue ?? arbitrage.buy_venue ?? null,
        sellVenue: arbitrage.sellVenue ?? arbitrage.sell_venue ?? null,
        rankings: safeRows(arbitrage.rankings)
          .slice(0, TERMINAL_RUNTIME_VENUE_RANKING_LIMIT)
          .map((row) => ({
            venue: row.venue ?? null,
            totalCostBps: row.totalCostBps ?? row.total_cost_bps ?? null,
            latencyMs: row.latencyMs ?? row.latency_ms ?? null,
            availableDepthUsd: row.availableDepthUsd ?? row.available_depth_usd ?? null,
            executable: row.executable ?? null,
          })),
      },
      smart_money: {
        state: safeRecord(warfare.smart_money).state ?? null,
      },
      spoof: {
        state: safeRecord(warfare.spoof).state ?? null,
      },
      market_state: {
        state: safeRecord(warfare.market_state).state ?? null,
        confidence: safeRecord(warfare.market_state).confidence ?? null,
      },
      domination: {
        state: safeRecord(warfare.domination).state ?? null,
      },
    },
  };
}