# TXT UX/UI Readiness TODO

Last updated: 2026-05-23

Purpose: make Mission Control as clear and intelligent as the trading engine. This list tracks the remaining operator-facing cleanup before TXT can be considered product-ready.

## P0 - Blocks Operator Clarity

### Global help and forms
- [x] Make help tooltips render above every page/panel without being clipped.
- [ ] Replace technical placeholder-only inputs with visible labels, units, and valid ranges across all pages.
- [ ] Add a standard result explanation block after actions that return metrics: what it means, what to do next, and when not to act.
- [ ] Standardize HelpHint/OperatorPanelGuide usage into one visible guide pattern plus one tooltip pattern.

### /terminal
- [x] Reduce default Terminal layout to an operator preset: chart, decision/risk, execution lane, blotter.
- [x] Move advanced telemetry, replay, perception, CPU/ISO/perf controls behind an Advanced/Diagnostics toggle.
- [ ] Remove duplicated or obsolete controls after confirming they are not used by live operation.
- [x] Rename internal panel labels to operator terms: Order Status, Risk Exposure, Venue Health, Broker Proof, Live Approvals.
- [ ] Fix horizontal overflow and nested scroll behavior so the page does not require fighting scrollbars.

### /connectors
- [x] Add a visible FTMO Live Workflow block with public route links.
- [x] Rename the unexplained legacy MT5 filter label to an operator-facing controlled request label.
- [x] Add source references and interpretation for market regime detection and geopolitical stress-test blocks.
- [ ] Split operator workflow from admin controls: keep FTMO live request/approval visible, move rebuild/debug/voice/admin actions into Advanced.
- [ ] Replace raw fields like `supportsCancelReplace`, `canTrade`, `rest_latency_ms` with readable labels and units.
- [ ] Group MT5 Bridge details into Health, Risk, Approvals, and Broker Execution.

### /ai
- [x] Clarify where market regime inputs come from and how to use the output.
- [x] Clarify geopolitical/strategy stress-test meaning and next action.
- [x] Explain each task type in the task selector with example prompts.
- [ ] Add a simple summary card for local model state and memory A/B value.
- [ ] Replace raw AI route details with operator route health: available, fallback, cost guard, latency.

### /live-readiness
- [x] Add labels, ranges, and units to drift threshold inputs.
- [x] Explain freshness thresholds: fresh/stale/degraded and the seconds behind them.
- [x] Map raw regime labels such as `price_discovery` to readable operator descriptions.
- [ ] Turn compact readiness strings into scannable colored pills.

### /fund-manager
- [ ] Reduce the default workflow from five tabs to three: Portfolio, Decisions, Risk.
- [ ] Add unsaved-change and saved-confirmation states for notes and mandates.
- [ ] Replace static-looking editable text with clear placeholders.
- [ ] Add legends and unit suffixes for allocation, risk contribution, exposure, and sparkline cards.

## P1 - Product Consistency

### /live-capital
- [ ] Add a metric legend for equity, cash, exposure, gross exposure, drift, and allocation cap.
- [ ] Ensure every table column shows units: USD, %, bps, ms, lots.
- [ ] Separate account connection, verification, allocation, and readiness into a single guided flow.

### /connections
- [ ] Make broker session fields explain snapshot_url vs execution_url clearly.
- [ ] Add status checks that show whether a live MT5 account is connected, readable, and executable.
- [ ] Add a guided FTMO setup checklist linked from /connectors.

### /incidents
- [ ] Add an operator action guide: triage, assign, mitigate, close.
- [ ] Surface related live route, account, and connector state without requiring cross-page hunting.

### /live-ops
- [ ] Align terminology with Terminal and Live Readiness: one vocabulary for kill switch, live mode, approvals, and degraded execution.
- [ ] Add next-action summaries when live ops reports a degraded state.

### Global navigation
- [ ] Rename cryptic route labels where needed: Reality Gap -> Execution Gap, Kairos -> Market Regime, Advanced -> Diagnostics.
- [ ] Add concise route descriptions in hover/tooltips without blocking navigation.

## P2 - Cleanup And Polish

- [ ] Audit every page for old path/config names that no longer match current runtime truth.
- [ ] Remove disabled roadmap buttons from primary operator screens, or move them to a Roadmap section.
- [ ] Add mobile and narrow-screen layout checks for every high-risk page.
- [ ] Add visual smoke tests for tooltip visibility, no horizontal body overflow, and labeled form controls.
- [ ] Create a Terminal panel registry so obsolete panels can be disabled without code surgery.

## Current UX Rule Going Forward

Every block must answer four questions without opening source code:

1. What does this block do?
2. Where do the input values come from?
3. What does the result mean?
4. What should the operator do next?
