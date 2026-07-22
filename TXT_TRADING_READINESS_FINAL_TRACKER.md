# TXT Trading Readiness Final Tracker

Last updated: 2026-05-23 13:48 UTC

Purpose: finish the remaining runtime and operator-readiness work before any live micro-execution. This tracker is intentionally stricter than UI health: a page can load and the system can still be NO-GO for trading.

## Non-Negotiable Live Gate

TXT is GO for live only when all of these are true:

- [ ] Market bus is fresh or explicitly degraded with clear reason; no fake freshness.
- [x] Mission Control `/live-readiness` no longer reports bus offline when upstream market data is reachable.
- [x] `/connectors` shows the real MT5 bridge state, visible MT5 accounts, pending approvals, and broker-session execution truth.
- [x] Control-plane/API health is stable across repeated probes, not just one lucky `200`.
- [x] EURUSD stays blocked automatically while the forex market is closed.
- [x] BTCUSD/FTMO route is eligible only through the configured MT5 symbol map and broker-session contract.
- [ ] Operator UI keeps dangerous/debug actions out of the default workflow.
- [x] Non-destructive smoke passes without placing a live order.

Blocking live-trade items:
- The active MT5 account now has `broker_session.execution_url`, but `mt5-executor.internal` does not resolve inside the Docker network. TXT must stay NO-GO for real live execution until the real MT5 executor host/container is reachable and authenticated.
- Market bus health now reports `degraded` truthfully when BTCUSDT trades/OHLCV age out. Depth is fresh, but trades and OHLCV were stale in the final probe, so execution must remain disabled.

## Execution Plan

### 1. Market Bus Freshness

- [x] Probe `market-data`, `broker-adapter`, `execution-router`, and `control-plane` directly from Docker network.
- [x] Compare direct upstream payloads with `/api/market/bus/snapshot` and `/live-readiness` UI interpretation.
- [x] Fix route/auth/timeout/schema mismatches so Mission Control reports the real bus state.
- [x] Keep execution disabled if bars/depth/trades are actually stale or missing.

### 2. Connectors And MT5 Truth

- [x] Probe direct `mt5-bridge /v1/accounts` and Mission Control `/api/mt5/accounts` under the same auth context.
- [x] Fix account visibility/filtering or API forwarding if Mission Control hides real accounts.
- [x] Show bridge health, account count, live/paper mode, approvals, and broker execution URL truth in `/connectors`.
- [x] Keep live execution fail-closed if no broker-session execution URL is configured.

### 3. Control-Plane/API Stability

- [x] Measure repeated `/health` and key read endpoints with latency and timeout capture.
- [x] Remove slow downstream dependencies from lightweight health paths if any are blocking.
- [x] Tune Mission Control proxy timeouts/retries only after confirming upstream behavior.
- [x] Re-test through the active green UI container.

### 4. UX P0 Cleanup

- [ ] Finish the remaining P0 items in `TXT_UX_UI_READINESS_TODO.md` that affect operator clarity.
- [ ] Keep admin/debug/rebuild controls behind Advanced/Diagnostics.
- [ ] Make critical readiness values scannable with labels, units, ranges, and colored state pills.
- [ ] Verify no tooltip clipping or horizontal overflow on the high-risk pages.

### 5. Green Build And Deploy

- [ ] Run type/build validation without writing into the served `.next-runtime-green` directory.
- [ ] Build into a staged runtime directory, verify `BUILD_ID`, swap atomically, then restart green.
- [ ] Confirm `mission-control-ui-green` is healthy and public health returns `200`.

No frontend files were changed in the final runtime-fix pass after this tracker was created, so no green rebuild was required for the OHLCV/control-plane and broker-session runtime fixes. Run the staged green build before claiming the earlier UX changes are deployed.

### 6. Non-Destructive Operator Smoke

- [x] Open authenticated public pages and verify Terminal, Connectors, AI, and Live Readiness agree.
- [x] Run read-only/approval-gated smoke only.
- [x] Confirm no live order was submitted.
- [x] Confirm EURUSD closed-market behavior remains blocked.
- [x] Confirm BTCUSD route is only considered when bus and route data are acceptable.

Smoke notes:
- Authenticated `/api/market/bus/snapshot` returned `200` with `meta.health.status=degraded` when trades/OHLCV aged out; OHLCV effective freshness is adjusted by timeframe while raw `bar_age_ms` remains visible.
- Authenticated `/api/live-readiness/overview` returned `200`, backend `status=degraded`, `market_bus.status=degraded`, `network_state=healthy`. The Next route source now preserves `payload.degraded`, but the active UI must be rebuilt via the staged blue/green path before the boolean changes in production.
- Authenticated `/api/connectors/status` returned `200` with real MT5 accounts and linked account state, but still around 10-12s and should be optimized further.
- Direct MT5 EURUSD smoke returned `409 market_closed` with `weekend_market_closed` and `next_open_at=2026-05-25T01:05:00+00:00`.
- A synthetic MT5 order-event created during an earlier stale-container smoke was deleted; recent MT5 order events were empty afterward.

## Current Verdict

NO-GO for real live execution until the real MT5 executor behind `broker_session.execution_url` is reachable and BTCUSDT trades/OHLCV freshness is stable. Runtime readiness is materially better, but UI uptime and account visibility alone are not enough.