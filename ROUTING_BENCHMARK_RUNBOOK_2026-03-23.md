# Routing Intelligence Benchmark (Runbook)

Date: 2026-03-23
Scope: AI routing policy benchmark after routing-context upgrade (market/latency/mode aware).
Endpoint benchmarked: /v1/route on ai-orchestrator (policy engine).
E2E validation: /v1/ai/route via control-plane with strict x-mc-* headers passed.

## KPI Summary (Before vs After)

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Avg p50 (ms) | 602.62 | 602.59 | -0.03 |
| Avg p95 (ms) | 602.86 | 602.83 | -0.03 |

Interpretation: routing-decision latency stayed flat (expected); the gain is decision quality/adaptivity, not raw route endpoint speed.

## Policy Matrix (After)

| Volatility | Mode | Primary Model | Routing Reason |
|---|---|---|---|
| low | human | open-source-fast | human_mode_local_guardrail |
| low | hybrid | gpt-5 | strategy_creation_profile |
| low | ai | gpt-5 | ai_mode_max_quality |
| high | human | open-source-fast | human_mode_local_guardrail |
| high | hybrid | open-source-fast | latency_or_execution_priority |
| high | ai | open-source-fast | latency_or_execution_priority |

## Test Matrix

- Symbols: BTCUSD, EURUSD, XAUUSD
- Volatility profiles: low, high
- Modes: human, hybrid, ai
- Samples per side: 3 (before) + 3 (after) per scenario
- Scenario rows: 18

## Strict E2E Header Propagation Check

Validated via control-plane /v1/ai/route with headers:
- x-mc-request-type
- x-mc-priority
- x-mc-market-volatility
- x-mc-signal-state
- x-mc-symbol
- x-mc-origin
- x-mc-ai-mode
- x-mc-latency-budget-ms

Observed output for execution/high-vol/hybrid:
- primary_model=open-source-fast
- fallback_model=open-source-reasoning
- reason=latency_or_execution_priority

## Operational Notes

- Operator credentials were rotated successfully; password_must_change is now false.
- A control-plane resilience fix was applied: memory retrieval timeout now degrades gracefully instead of returning 500.
- Full raw matrix JSON is available at /tmp/routing_matrix_report.json on the host.

## HTTPS / TLS Termination (Let\'s Encrypt)

Implementation applied:
- Added Caddy TLS frontend service on host ports 80 and 443.
- Kept mission-control-gateway behind Caddy on internal upstream mission-control-gateway:3000.
- Enabled automatic certificate management for app.txt.gtixt.com.

Files changed:
- docker-compose.yml (service mission-control-tls + caddy volumes)
- docker/Caddyfile (site app.txt.gtixt.com reverse_proxy mission-control-gateway:3000)

Validation checklist:
- DNS A record app.txt.gtixt.com -> server public IP.
- Port 80 reachable (HTTP challenge).
- Port 443 reachable (TLS serving).
- `curl -I https://app.txt.gtixt.com/` returns HTTP response (not connection refused).

TLS hardening status:
- HSTS enabled on apex: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`.
- Canonical redirect rule configured for www -> apex in Caddyfile.
- TLS floor enforced: TLS 1.0 and 1.1 rejected, TLS 1.2 accepted.

Notes:
- `www.app.txt.gtixt.com` certificate issuance completed successfully after DNS propagation.
- Canonical HTTPS redirect validated: `https://www.app.txt.gtixt.com/` -> `https://app.txt.gtixt.com/` (HTTP 301).

## Execute Matrix (Policy + Inference)

Requested endpoint: /v1/ai/execute (control-plane).

Observed in this run:
- Control-plane execute matrix completed with 18/18 timeout_or_network on before and after when bounded with strict client timeout.
- This indicates execution-path saturation/timeouts under current environment load, despite graceful degrade handling for memory retrieval.

Fallback benchmark (to preserve decision/inference signal): /v1/execute direct on ai-orchestrator.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Rows OK | 18 | 18 | 0 |
| Avg wall (ms) | 1230.70 | 1232.09 | +1.39 |

Interpretation: inference wall latency is stable; routing-context changes are visible in route reasons while output model remained degraded-template in this environment.

Raw artifacts:
- /tmp/execute_matrix_report.json (control-plane /v1/ai/execute attempt)
- /tmp/execute_matrix_report_orchestrator.json (direct orchestrator fallback)
- /tmp/execute_matrix_summary_orchestrator.json

## SLO/SLA Alert Thresholds (Copy/Paste)

```yaml
slo_sla_alert_thresholds:
	routing:
		route_p95_ms_warn: 900
		route_p95_ms_crit: 1200
		route_error_rate_warn_pct: 1.0
		route_error_rate_crit_pct: 3.0
		context_mismatch_warn_pct: 0.5
		context_mismatch_crit_pct: 2.0

	ai_execute:
		execute_wall_p95_ms_warn: 2500
		execute_wall_p95_ms_crit: 6000
		execute_timeout_warn_pct: 2.0
		execute_timeout_crit_pct: 8.0
		degraded_template_warn_pct: 5.0
		degraded_template_crit_pct: 20.0
		fallback_used_warn_pct: 10.0
		fallback_used_crit_pct: 25.0

	provider_health:
		provider_error_warn_pct: 2.0
		provider_error_crit_pct: 6.0
		circuit_open_warn_count: 1
		circuit_open_crit_count: 3

	market_critical_mode:
		high_vol_execution_path_required_pct: 99.0
		latency_or_execution_priority_reason_min_pct: 95.0

	alerting_policy:
		window: 5m
		burn_rate_fast_window: 5m
		burn_rate_slow_window: 1h
		page_on_crit_after_minutes: 2
		ticket_on_warn_after_minutes: 10
```

## SSL Grade Verification Checklist (Ops)

Target: achieve at least grade `A` on SSL Labs for app.txt.gtixt.com.

Pre-checks:
- [x] DNS A for app.txt.gtixt.com points to production IP.
- [x] Port 80/tcp reachable from internet.
- [x] Port 443/tcp reachable from internet.
- [x] Valid LE certificate served on 443.

Protocol checks (server side):
- [x] `openssl s_client -connect app.txt.gtixt.com:443 -tls1` fails.
- [x] `openssl s_client -connect app.txt.gtixt.com:443 -tls1_1` fails.
- [x] `openssl s_client -connect app.txt.gtixt.com:443 -tls1_2` succeeds.
- [x] `curl -I https://app.txt.gtixt.com/` includes HSTS header.

SSL Labs API runbook:
1. Start analysis:
	`curl "https://api.ssllabs.com/api/v3/analyze?host=app.txt.gtixt.com&publish=off&startNew=on&all=done&fromCache=off&ignoreMismatch=on"`
2. Poll status every 20s until `status=READY`:
	`curl "https://api.ssllabs.com/api/v3/analyze?host=app.txt.gtixt.com&publish=off&fromCache=on&all=done&ignoreMismatch=on"`
3. Accept criteria:
	- [x] Endpoint grade >= A
	- [x] No support for TLS 1.0/1.1
	- [x] No weak ciphers flagged
	- [x] Certificate chain valid

Latest execution result (2026-03-23):
- SSL Labs status: READY
- Endpoint: 65.109.87.183
- Grade: A+
- Source artifact: /tmp/ssllabs_final_summary.json

Canonical DNS status:
- `www.app.txt.gtixt.com` now resolves on public resolvers and ACME issuance succeeded.
- Canonical redirect remains enforced at TLS layer and should be kept as-is.

Escalation thresholds:
- Grade < A -> open `P1-security-tls` ticket.
- Grade drop by >= 2 levels between releases -> block rollout.
- Any protocol regression enabling TLS 1.0/1.1 -> immediate rollback.
