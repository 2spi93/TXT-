# OPS Copilot - TXT Auto Trading Readiness Brief

Objective: take TXT from "published and observable" to "safe to run governed automatic trading", with FTMO/MT5 as the priority live path because the VPS is already paid for.

## What Is Already Confirmed

- Mission Control UI blue/green publish path works.
- Gateway routing works.
- Authenticated dashboard works.
- Deployment/governor panels are visible on the real published runtime.
- The previous browser smoke false negative was caused by App Router streaming plus sandboxed Docker truth noise, not by a broken runtime.

## Critical Blockers Before Real Auto Trading

1. Enable the MT5 provider in live policy.
   Evidence:
   - [config/live_execution_policy.json](/opt/txt/config/live_execution_policy.json)
   - [apps/control_plane/main.py](/opt/txt/apps/control_plane/main.py)
   Current blocker: the control-plane provider policy for `mt5` is still `enabled: False`, so FTMO/MT5 live routing remains policy-blocked even though UI and governance surfaces exist.

2. Stop booting the MT5 bridge in paper mode for the real FTMO path.
   Evidence:
   - [docker-compose.yml](/opt/txt/docker-compose.yml)
   - [apps/mt5_bridge/main.py](/opt/txt/apps/mt5_bridge/main.py)
   Current blocker: `MT5_BRIDGE_MODE: paper` is still the compose default.

3. Open all three live gates for the intended FTMO route only when governance is ready.
   Evidence:
   - [config/live_execution_policy.json](/opt/txt/config/live_execution_policy.json)
   - [ui/mission-control/app/connections/page.tsx](/opt/txt/ui/mission-control/app/connections/page.tsx)
   - [BINGX_LIVE_SMOKE_RUNBOOK.md](/opt/txt/BINGX_LIVE_SMOKE_RUNBOOK.md)
   Required gates:
   - runtime env gate: `TXT_ENABLE_LIVE_ROUTING=1`
   - policy gate: provider enabled in live policy
   - route gate: integration route has `live_enabled=true`

4. Switch backend posture from `guarded_auto` to `managed_live` only after the FTMO route and credentials are verified.
   Evidence:
   - [docker-compose.yml](/opt/txt/docker-compose.yml)
   - [ui/mission-control/app/live-ops/page.tsx](/opt/txt/ui/mission-control/app/live-ops/page.tsx)
   Current blocker: the stack defaults to `SYSTEM_MODE=guarded_auto`, and the live policy only allows real execution in `managed_live`.

5. Verify the MT5/FTMO broker session source is real and not just UI-level registration.
   Evidence:
   - [ui/mission-control/app/connections/page.tsx](/opt/txt/ui/mission-control/app/connections/page.tsx)
   - [apps/mt5_bridge/main.py](/opt/txt/apps/mt5_bridge/main.py)
   - [scripts/go_live_watchdog.py](/opt/txt/scripts/go_live_watchdog.py)
   Requirement: the account must have a valid broker session source, healthy `/v1/mt5/health`, and current broker-state ingestion before any live route is trusted.

6. Keep the external watchdog active for go-live hardening.
   Evidence:
   - [scripts/go_live_watchdog.py](/opt/txt/scripts/go_live_watchdog.py)
   Requirement: the watchdog must be running with a valid control-plane secret and must be able to activate kill-switch on MT5 bridge failures, reality-gap streaks, or severe latency/slippage anomalies.

## Important Before Scaling Beyond First Micro-Live

1. Validate FTMO micro-live governance against real broker telemetry.
   Evidence:
   - [apps/control_plane/main.py](/opt/txt/apps/control_plane/main.py)
   - [ui/mission-control/app/connectors/page.tsx](/opt/txt/ui/mission-control/app/connectors/page.tsx)
   Goal: confirm stage bucket, drawdown velocity, oracle stability, and no-trade dominance behave correctly on real FTMO fills.

2. Certify the route from signal source to execution venue with replay evidence.
   Evidence:
   - [scripts/go_live_watchdog.py](/opt/txt/scripts/go_live_watchdog.py)
   - [ui/mission-control/app/terminal/TerminalSecondaryPanels.tsx](/opt/txt/ui/mission-control/app/terminal/TerminalSecondaryPanels.tsx)
   Goal: prove no silent drift between recommendation, approval, route, and realized execution.

3. Close operator UX debt on heavy pages before broader live use.
   Evidence:
   - [TXT_GOVERNABLE_SYSTEM_BACKLOG.md](/opt/txt/TXT_GOVERNABLE_SYSTEM_BACKLOG.md)
   Priority targets:
   - [ui/mission-control/app/terminal/page.tsx](/opt/txt/ui/mission-control/app/terminal/page.tsx)
   - [ui/mission-control/app/live-capital/page.tsx](/opt/txt/ui/mission-control/app/live-capital/page.tsx)
   - [ui/mission-control/app/fund-manager/page.tsx](/opt/txt/ui/mission-control/app/fund-manager/page.tsx)
   - [ui/mission-control/app/connectors/page.tsx](/opt/txt/ui/mission-control/app/connectors/page.tsx)

## Recommended Execution Order

1. Prove the real FTMO account wiring.
   - confirm MT5 account exists in Connections
   - confirm broker session source is configured and fresh
   - confirm `/v1/mt5/health` is healthy

2. Open live policy for MT5 deliberately.
   - set MT5 provider `enabled=true`
   - keep route-level gating strict
   - keep hardening overrides intact

3. Move MT5 bridge from paper default to the intended live mode only for the validated account path.

4. Enable route and runtime env gates.
   - set `TXT_ENABLE_LIVE_ROUTING=1`
   - create or verify the FTMO integration route with `live_enabled=true` and `preferred_venue=mt5`

5. Switch system mode to `managed_live` only after steps 1-4 pass.

6. Run a micro-live operator certification.
   - one account
   - one or two allowed symbols
   - FTMO micro-live stage only
   - watchdog active
   - post-trade replay reviewed

7. Only then widen page cleanup, responsiveness, and explainability work.

## Current FTMO Route Truth

- The active Kairos default route now resolves to provider `mt5`, account `MT5_ACCOUNT_ID_REQUIRED`, `live_enabled=true`, `preferred_venue=mt5`.
- The active Kairos default route runtime truth now also carries `symbol_map.BTCUSDT = BTCUSD`, aligned with the broker-facing MT5 symbol naming.
- Route persistence is runtime-backed in `system_config` under `connector_signal_routes_v1`, so it will not come back automatically from Git alone after a DB restore.
- The operator payload to rebuild that route is versioned in [config/kairos_mt5_live_route.json](/opt/txt/config/kairos_mt5_live_route.json).

Rebuild command after restore:

```bash
curl -k -sS \
   -H "Authorization: Bearer $TOKEN" \
   -H 'content-type: application/json' \
   -X POST https://api.txt.gtixt.com/v1/integrations/routes \
   --data @/opt/txt/config/kairos_mt5_live_route.json \
   | python3 -m json.tool
```

Expected route truth:

- `source = kairos`
- `route_key = default`
- `provider = mt5`
- `account_id = MT5_ACCOUNT_ID_REQUIRED`
- `live_enabled = true`
- `preferred_venue = mt5`
- `symbol_map.BTCUSDT = BTCUSD`

## Current Smoke Truth

- Routing is now correct: Kairos resolves to MT5 / `MT5_ACCOUNT_ID_REQUIRED` / venue `mt5`.
- A 5 USD MT5 smoke for `EURUSD` currently passes the live gate.
- A 5 USD MT5 smoke for `BTCUSD` now passes the live gate.
- Kairos `BTCUSDT` can now map cleanly to broker symbol `BTCUSD` through the route-level `symbol_map`.

## Current Broker Execution Truth

- The remaining blocker is no longer route selection or MT5 symbol eligibility.
- [apps/control_plane/main.py](/opt/txt/apps/control_plane/main.py) still requires double approval for live MT5 orders on [apps/control_plane/main.py](/opt/txt/apps/control_plane/main.py#L19484) and [apps/control_plane/main.py](/opt/txt/apps/control_plane/main.py#L20595).
- [apps/mt5_bridge/main.py](/opt/txt/apps/mt5_bridge/main.py#L810) now fails closed for live MT5 when `metadata.broker_session.execution_url` is missing, instead of simulating an `accepted` broker ticket.
- [apps/mt5_bridge/main.py](/opt/txt/apps/mt5_bridge/main.py#L810) now forwards live MT5 orders to the external broker session defined in `broker_session.execution_url`, persists the returned broker ticket/status, and ingests broker-state/session data when the executor returns them.
- [apps/mt5_bridge/main.py](/opt/txt/apps/mt5_bridge/main.py#L619) now enforces a session-bound FTMO market window for non-crypto MT5 symbols: `EURUSD` and similar instruments are blocked on the weekend / outside the FTMO week, while `BTCUSD` remains 24/7 tradable.

## Operator Wiring

- Versioned broker-session payload: [config/mt5_ftmo_broker_session_live.json](/opt/txt/config/mt5_ftmo_broker_session_live.json)
- Mission Control Connections now exposes both `snapshot_url` and `execution_url` for MT5 broker_session persistence in [ui/mission-control/app/connections/page.tsx](/opt/txt/ui/mission-control/app/connections/page.tsx).
- Minimum live requirement: configure a real `broker_session.execution_url` for account `MT5_ACCOUNT_ID_REQUIRED`; otherwise the bridge returns `mt5_live_execution_unconfigured`.

Patch command after restore or on a fresh runtime:

```bash
curl -k -sS \
   -H "Authorization: Bearer $TOKEN" \
   -H 'content-type: application/json' \
   -X PATCH https://api.txt.gtixt.com/v1/mt5/accounts/MT5_ACCOUNT_ID_REQUIRED/broker-session \
   --data @/opt/txt/config/mt5_ftmo_broker_session_live.json \
   | python3 -m json.tool
```

## Operator Smoke

- Prepared smoke script: [scripts/mt5_live_operator_smoke.sh](/opt/txt/scripts/mt5_live_operator_smoke.sh)
- Default behavior: `SYMBOL=AUTO` picks `EURUSD` only during the FTMO week window and falls back to `BTCUSD` when FX is closed.
- Live path behavior: first operator call returns `pending_second_approval`; the second operator runs the same script with `--approve <approval_id>` to trigger the real MT5 execution path.

## Important Operating Truth

- In the VS Code sandboxed terminal, Docker-backed publish checks can lie and report `missing` for healthy containers.
- For publication truth, trust direct Docker plus HTTP/authenticated probes before rollback.
- For runtime truth, distinguish rendering timing from system health; a browser waiting on App Router streaming is not the same thing as a dead desk.
