# TXT Governable System Backlog

## Scope

This backlog turns the current TXT stack into a governable cross-market system without drowning it in unranked data or uncontrolled feature growth.

Guiding rules:

- Truth first before prediction.
- Add information by hierarchy, not by volume.
- Close control loops before opening new markets.
- Any new data source must improve admissibility, sizing, or no-trade quality.
- UI work must reduce operator confusion, not add more surfaces.
- Freeze stable v1 contracts once they feed governance loops; evolve by additive versioning, not silent drift.

## Execution Order

## Phase 0 - Stabilize The Operating Surface

Status: in progress

Tasks:

- Keep terminal truth observer healthy and auto-remediation bounded.
- Monitor auto-recovery logs and tune thresholds before widening recovery actions.
- Confirm green slot remains stable under repeated observer cycles.
- Add audit log review for restart versus rollback decisions.

Repo anchors:

- [scripts/run_terminal_truth_observer.sh](scripts/run_terminal_truth_observer.sh)
- [scripts/auto_recover_terminal_truth_incident.sh](scripts/auto_recover_terminal_truth_incident.sh)
- [deploy/systemd/txt-terminal-truth-observer.service](deploy/systemd/txt-terminal-truth-observer.service)
- [logs/terminal-truth-observer.jsonl](logs/terminal-truth-observer.jsonl)

Exit criteria:

- No recurring `mission_control_not_ready` or `truth_strip_missing` loop on the active slot.
- Auto-recovery never flaps more than once inside the cooldown window.
- Recovery decisions are auditable from logs alone.

## Phase 1 - Cross-Market Truth Base

Status: in progress

Goal: add only the minimum assets needed to infer macro regime and cross-asset stress.

Current state:

- Minimal cross-market basket wired into terminal truth as admissibility degradation, not direct execution blocking.
- Remaining work is UI exposure, broader regime explanation, and clearing unrelated Next.js blockers that currently prevent fully targeted end-to-end validation.

Tasks:

- Add the phase-1 structural basket: BTC, ETH, XAUUSD, DXY, US100, SP500, VIX, EURUSD.
- Normalize freshness, lag, and admissibility per asset and venue.
- Compute cross-asset state snapshots instead of raw per-asset noise.
- Add a correlation and divergence map showing leaders, laggards, and broken relationships.
- Feed cross-market state into terminal truth and no-trade eligibility, not directly into execution first.

Repo anchors:

- [apps/market_data_plane/main.py](apps/market_data_plane/main.py)
- [apps/execution_router/context_v1.py](apps/execution_router/context_v1.py)
- [apps/control_plane/main.py](apps/control_plane/main.py)
- [rust-execution-engine/src/core.rs](rust-execution-engine/src/core.rs)

Exit criteria:

- Terminal can explain the active cross-market regime in one concise state object.
- BTC admissibility can be reduced by cross-market incoherence even if local signal stays green.
- No-trade reasons can reference cross-market truth cleanly.

## Phase 1.5 - Oracle Stability Memory

Status: not started

Goal: learn when the oracle itself becomes unreliable across regimes instead of treating instability as a one-off incident.

Tasks:

- Persist oracle stability episodes with regime, dominant no-trade family, replay/live divergence, and recovery outcome.
- Build a structural oracle stability history instead of only point-in-time scores.
- Detect repeat instability patterns by market regime, venue, timeframe, and blocking family.
- Feed stability memory into no-trade quality, escalation, and later capital pressure.

Repo anchors:

- [ui/mission-control/app/terminal/finalDecisionTruth.ts](ui/mission-control/app/terminal/finalDecisionTruth.ts)
- [ui/mission-control/app/terminal/page.tsx](ui/mission-control/app/terminal/page.tsx)
- [scripts/run_terminal_truth_observer.sh](scripts/run_terminal_truth_observer.sh)
- [logs/terminal-truth-observer.jsonl](logs/terminal-truth-observer.jsonl)

Exit criteria:

- TXT can explain in which regimes oracle stability degrades repeatedly.
- Operators can distinguish transient noise from structural oracle instability.
- Stability memory becomes a first-class governance input instead of a dashboard-only score.

## Phase 2 - Dynamic Capital Pressure

Status: not started

Goal: reduce deployable capital automatically when system quality degrades.

Tasks:

- Define a capital pressure score from truth quality, execution degradation, false-context rate, and routing degradation.
- Apply pressure score to exploitable capital caps before live approval.
- Log capital pressure components per decision.
- Add operator-visible explanation for capital reduction.

Repo anchors:

- [apps/risk_gateway/main.py](apps/risk_gateway/main.py)
- [config/risk_policy.json](config/risk_policy.json)
- [tests/test_control_plane_live_capabilities.py](tests/test_control_plane_live_capabilities.py)

Exit criteria:

- A degraded regime shrinks capital automatically without changing signal code.
- Operators can see why notional fell.

## Phase 3 - Memory Importance Ranking

Status: not started

Goal: retain rare, structurally important contexts and discard noise.

Tasks:

- Rank memory events by rarity, realized impact, recurrence, and regime specificity.
- Preserve false-liquidity, divergence, routing toxicity, and replay/live gap contexts with stronger weight.
- Down-rank routine warmup noise and transient recoverable failures.
- Expose memory importance in audit output.

Repo anchors:

- [apps/predictor_v8/reality_gap.py](apps/predictor_v8/reality_gap.py)
- [database/migrations/008_multi_agent_schema.sql](database/migrations/008_multi_agent_schema.sql)
- [MEMORY_KAIROS_RUNTIME_GAP_LIST.md](MEMORY_KAIROS_RUNTIME_GAP_LIST.md)

Exit criteria:

- Memory growth is selective instead of linear.
- Important contexts influence later governance decisions.

## Phase 4 - Execution Reality Score

Status: not started

Goal: keep live execution grounded in realized fill quality, not replay optimism.

Tasks:

- Compute one execution reality score combining slippage, fill quality, latency, fees, and routing stability.
- Compare replay expectation versus live outcome continuously.
- Feed reality score into no-trade, capital pressure, and venue selection.
- Add recovery logic when live reality diverges too far from replay.

Repo anchors:

- [apps/predictor_v8/reality_gap.py](apps/predictor_v8/reality_gap.py)
- [apps/control_plane/main.py](apps/control_plane/main.py)
- [tests/test_execution_router_v6.py](tests/test_execution_router_v6.py)

Exit criteria:

- Live degradation reduces confidence and size automatically.
- Operators can see replay/live divergence without reading raw logs.

## Phase 4.5 - Self Preservation

Status: not started

Goal: let TXT slow down or freeze itself when its own reliability deteriorates.

Tasks:

- Define a self-preservation state from false-context rate, oracle stability, cross-market incoherence, execution reality degradation, and no-trade dominance.
- Add slow-mode, capped-mode, and freeze-mode responses with bounded recovery rules.
- Surface self-preservation triggers in operator truth and incident output.
- Keep self-preservation separate from raw signal generation so it remains a governance layer.

Repo anchors:

- [apps/control_plane/main.py](apps/control_plane/main.py)
- [ui/mission-control/app/terminal/finalDecisionTruth.ts](ui/mission-control/app/terminal/finalDecisionTruth.ts)
- [ui/mission-control/app/terminal/page.tsx](ui/mission-control/app/terminal/page.tsx)
- [scripts/auto_recover_terminal_truth_incident.sh](scripts/auto_recover_terminal_truth_incident.sh)

Exit criteria:

- TXT can reduce pace or freeze itself before repeated quality failures propagate to live risk.
- Operators can see when the system is protecting itself rather than simply failing.
- Recovery out of freeze follows auditable bounded conditions.

## Phase 5 - Operator Governance Memory

Status: not started

Goal: make human overrides part of the learning loop.

Tasks:

- Persist operator approve, reject, ack-review, and override decisions with context fingerprint.
- Track whether the operator was later right or wrong.
- Surface repeated operator disagreement against the model.
- Use disagreement patterns to tighten require-human policies.

Repo anchors:

- [ui/mission-control/app/terminal/page.tsx](ui/mission-control/app/terminal/page.tsx)
- [apps/control_plane/main.py](apps/control_plane/main.py)
- [ui/mission-control/app/api/auth/status/route.ts](ui/mission-control/app/api/auth/status/route.ts)

Exit criteria:

- Every human intervention has a stored outcome.
- Governance can become stricter when operator disagreement clusters.

## Phase 6 - Structured Macro And Geopolitics

Status: not started

Goal: add only regime-shifting external context, never raw media noise.

Tasks:

- Ingest structured macro events first: CPI, NFP, FOMC, rates, PMI, unemployment, inflation.
- Convert macro releases into regime-transition objects, not headline text.
- Add a curated geopolitical event schema for only high-impact structural events.
- Measure market impact from price/volatility reaction, not media volume.

Repo anchors:

- [apps/ai_orchestrator/main.py](apps/ai_orchestrator/main.py)
- [OPS_COPILOT_PHASE_9_ARCHITECTURE.md](OPS_COPILOT_PHASE_9_ARCHITECTURE.md)

Exit criteria:

- Macro context degrades or upgrades admissibility cleanly.
- No raw social sentiment or unranked headline feed enters live governance.

## Phase 7 - Mission Control UX Simplification

Status: not started

Goal: make pages understandable to non-specialists while preserving desk-grade depth.

Tasks:

- Audit every Mission Control page for empty panels, duplicated metrics, unreadable jargon, and non-responsive layouts.
- Collapse low-value panels and move advanced diagnostics behind progressive disclosure.
- Add plain-language labels next to technical state names.
- Standardize page structure: summary, decision, risk, diagnostics, history.
- Fix mobile and narrow desktop breakpoints for overloaded panels.

Repo anchors:

- [ui/mission-control/app](ui/mission-control/app)
- [ui/mission-control/BENCHMARK_TXT_IDENTITY_2026-03-21.md](ui/mission-control/BENCHMARK_TXT_IDENTITY_2026-03-21.md)
- [ui/mission-control/PHASE_4_EXECUTION_PLAN.md](ui/mission-control/PHASE_4_EXECUTION_PLAN.md)

First cleanup targets by code weight:

1. [ui/mission-control/app/terminal/page.tsx](ui/mission-control/app/terminal/page.tsx)
2. [ui/mission-control/app/live-capital/page.tsx](ui/mission-control/app/live-capital/page.tsx)
3. [ui/mission-control/app/fund-manager/page.tsx](ui/mission-control/app/fund-manager/page.tsx)
4. [ui/mission-control/app/connectors/page.tsx](ui/mission-control/app/connectors/page.tsx)

Exit criteria:

- An operator can explain page state without decoding internal jargon.
- No page relies on oversized dense panels to communicate primary risk.
- Core pages remain usable on narrow screens.

## Immediate Next Sprint

Priority order:

1. Observe auto-recovery in production and tune thresholds from real incidents.
2. Finish exposing phase-1 cross-market truth in operator UI and clear unrelated Next.js blockers that hide targeted validation.
3. Build Oracle Stability Memory before widening live asset coverage.
4. Add dynamic capital pressure before adding more signal complexity.
5. Add execution reality score so replay optimism cannot leak into sizing.
6. Add self-preservation modes so TXT can slow or freeze itself under structural degradation.
7. Start UX simplification on terminal, incidents, live-readiness, and connectors pages.

## Contract Locks To Freeze Next

- FinalDecisionTruth v1 stable after current phase-1 UI exposure and targeted validation cleanup.
- MarketMemory schema v1 stable before importance ranking expands retention logic.
- FalseContext taxonomy v1 stable before capital pressure and self-preservation consume it.
- Tradability surface contract v1 stable before additional execution or macro layers reuse it.

## Explicit Non-Goals For Now

- Do not ingest hundreds of assets.
- Do not connect raw social media or unfiltered headline feeds.
- Do not add new predictive models before truth, capital pressure, and reality scoring are closed.
- Do not enlarge UI surface area before reducing operator confusion.