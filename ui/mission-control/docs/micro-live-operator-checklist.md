# Micro-Live Operator Checklist

## Session Daily Checklist

Use this checklist before, during, and after every governed micro-live session.

### 1. Entry

- MT5 bridge healthy
- no active kill switch
- opportunity gate = GO
- active micro-live stage visible with a positive order cap

If one item fails, do not open the session.

### 2. Preview

- run the MT5 micro-live preview for the intended symbol and size
- hardening not blocked
- no-trade off
- drawdown velocity not blocked
- oracle stability not blocked

If preview is blocked, do not force the trade.

### 3. Session

- stay on BTCUSD or BTCUSDT only
- stay inside the 1 EUR, 2 EUR, or 5 EUR band
- review every 10 executions or every 30 minutes
- stop immediately if a cut-switch activates

The goal is proof density, not session profit.

### 4. Close

- record created decisions
- record complete decisions
- record allocation closure rate
- record root cause closure rate
- record native evidence coverage

If created rises but complete stays flat, treat the session as proof debt.

## Stop Rules

Stop new entries immediately when one of these happens:

- MT5 unhealthy
- connector path degraded
- kill switch active
- opportunity gate blocked
- hardening blocked
- runtime truth blocked
- downstream proof chain missing after execution

## Promotion Rule

Do not leave the micro-live band until all of these are true on a stable window:

- decision_journey_completion_rate_pct > 25
- native_evidence_coverage_pct > 40
- root_cause_closure_rate_pct > 80
- 100 created decisions
- 50 complete decisions