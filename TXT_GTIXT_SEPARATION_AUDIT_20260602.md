# TXT / GTIXT Separation Audit - 2026-06-02

## Executive Verdict

TXT data, application logic, Playwright scope, intelligence tables, signals, and runtime project networks are separated from GTIXT.

Runtime network isolation has been corrected: `gtixt-app` is no longer attached to `txt_default`; TXT containers cannot resolve `gtixt-app` or `gtixt-postgres`; GTIXT app containers cannot resolve TXT service names. `mission-control-tls` remains the only intentional multi-network ingress bridge.

Overall grade: A-.

Reasoning:

| Area | Grade | Verdict |
| --- | --- | --- |
| Database separation | A | Clean. TXT uses `mission_control`; GTIXT uses `gtixt`. No GTIXT schema/data hits in TXT proof tables. |
| Code separation | A | Clean for backend/app imports. TXT UI storage keys now use `txt.*` with legacy read migration for old `gtixt.*` keys. |
| Playwright separation | A- | TXT config is local by default; public smoke helpers target `app.txt.gtixt.com` / `api.txt.gtixt.com`, which are TXT hosts. |
| Intelligence/signals | A | TXT predictor/embeddings/signals are TXT-scoped; `strategy_embeddings` has 0 GTIXT hits. |
| Runtime network isolation | A- | `gtixt-app` removed from `txt_default`; guardrail passes. `mission-control-tls` is the documented multi-network exception. |
| Shared ingress ownership | A- | GTIXT TLS config moved to `/opt/shared-ingress`; shared TLS certificate volume remains intentional shared-ingress infrastructure. |

## Scope Audited

- `/opt/txt`
- `/opt/shared-ingress`
- `/opt/systemd`
- Docker runtime containers and networks
- TXT PostgreSQL database accessed through `control-plane`
- TXT Playwright configuration and browser smoke helpers
- TXT AI/intelligence/signal tables and service names

No secrets were printed or copied. Database URLs were inspected only in sanitized form: scheme, user, host, port, database.

## Confirmed Clean Areas

### 1. TXT Database Identity

Sanitized TXT DB target:

```text
scheme=postgresql
user=txt
host=postgres
port=5432
database=mission_control
```

Sanitized GTIXT DB target:

```text
scheme=postgresql
user=gtixt
host=gtixt-postgres
port=5432
database=gtixt
```

Conclusion: TXT and GTIXT do not point to the same database or DB user.

### 2. TXT Schema Does Not Contain GTIXT-Owned Names

TXT DB checks:

```text
gtixt_named_tables = []
gtixt_named_columns = []
```

GTIXT text hits in TXT proof tables:

```text
execution_fill_events = 0
decision_outcomes     = 0
reality_gap_samples   = 0
audit_events           = 0
strategy_embeddings   = 0
```

Conclusion: no observed GTIXT contamination in the TXT proof/evidence tables.

### 3. TXT Proof Data Matches Trading/TXT Domain

Key observed dimensions:

```text
execution_fill_events:
  live-broker / bingx / BTCUSDT = 6
  book venues include bybit-public, okx-public, coinbase-public, binance-public

decision_outcomes:
  mt5 / mt5-bridge / BTCUSD / finalized = 31
  mt5 / mt5-bridge / EURUSD / finalized = 1
  intent / bingx / BTCUSDT / pending = 8

reality_gap_samples:
  bingx / SOLUSDT / SCALP = 13
  BTCUSD samples on binance-paper, bybit-public, binance-public, coinbase-public, okx-public
```

Conclusion: observed data belongs to TXT trading/runtime evidence, not GTIXT project data.

### 4. Backend Code Separation

Searches found no backend imports like:

```text
from gtixt
import gtixt
GTIXT_*
gtixt_*
```

in `/opt/txt/apps/**`.

Conclusion: TXT backend code is not importing GTIXT modules.

### 5. Playwright Separation

TXT Playwright config uses local default:

```text
PLAYWRIGHT_BASE_URL || http://127.0.0.1:3328
testDir = ./tests/e2e
```

Several smoke/debug helpers target:

```text
https://app.txt.gtixt.com
https://api.txt.gtixt.com
```

These are TXT public hosts under a shared parent domain, not GTIXT application hosts.

Conclusion: Playwright is TXT-scoped, with public TXT domains used for live smokes.

## Findings

### F1 - High - Runtime Network Isolation Was Not Strict - Fixed

Evidence:

```text
gtixt-app networks = gtixt-net
mission-control-tls networks = gtixt-net, hermes-net, txt_default
```

DNS reachability observed:

```text
from control-plane:
  gtixt-app -> unresolved
  gtixt-postgres -> unresolved

from gtixt-app:
  txt-postgres -> unresolved
  control-plane -> unresolved
  gtixt-postgres -> resolved
```

Impact:

- The original finding did not prove data mixing, but it weakened runtime isolation.
- The runtime attachment has been removed and the GTIXT app is now reachable from public ingress through `gtixt-net`, not through `txt_default`.
- A Docker guardrail now fails if GTIXT-named/project/service containers are attached to `txt_default`, except explicitly allowlisted ingress infrastructure.

Validation:

```text
project_network_isolation=ok network=txt_default checked=19
mission-control-tls Up healthy networks=gtixt-net,hermes-net,txt_default
```

### F2 - Medium - Shared Ingress Ownership Was Ambiguous - Fixed

Evidence:

- `/opt/shared-ingress/docker-compose.yml` now mounts `/opt/shared-ingress/gtixt-tls.conf`.
- `/opt/shared-ingress/docker-compose.yml` mounts `/opt/txt/secrets/tls` for TXT, GTIXT, MWC, and Hermes certificates.
- `/opt/shared-ingress/gtixt-tls.conf` proxies `gtixt.com`, `admin.gtixt.com`, and `data.gtixt.com` to `gtixt-app:3000` through `gtixt-net`.

Impact:

- This is intentional shared ingress, not application/data contamination.
- GTIXT operational config no longer lives under `/opt/txt`.
- The shared TLS certificate volume remains a shared-ingress operational convention and should be treated as infrastructure ownership, not TXT app ownership.

Validation:

```text
nginx -t = successful
Host app.txt.gtixt.com /healthz = ok
Host bridge.txt.gtixt.com /healthz = ok
Host gtixt.com /healthz = ok
```

### F3 - Medium/Low - TXT UI Used GTIXT-Prefixed Local Storage Keys - Fixed

Evidence examples:

```text
gtixt.ui.mode.v1
gtixt.chart.motion.preset.v1
gtixt.terminal.v8.predictor.v1
gtixt.fund-manager.notes.v2
```

Current TXT keys:

```text
txt.ui.mode.v1
txt.chart.motion.preset.v1
txt.terminal.v8.predictor.v1
txt.fund-manager.notes.v2
```

Impact:

- Browser localStorage is origin-scoped, so this never mixed DB or backend data.
- The namespace debt has been removed while preserving legacy read migration to avoid apparent user preference loss.

Validation:

```text
Touched TypeScript files: no editor diagnostics reported.
```

### F4 - Low/Medium - Public Host Trust Was Too Broad in One Redirect Helper - Fixed

Evidence:

```text
app.txt.gtixt.com
txt.gtixt.com
api.txt.gtixt.com
staging.txt.gtixt.com
api.staging.txt.gtixt.com
bridge.txt.gtixt.com
```

Impact:

- TXT host trust is now explicit and limited to TXT-owned public hosts.
- Bare `gtixt.com`, `admin.gtixt.com`, and `data.gtixt.com` remain GTIXT-owned ingress hosts, not TXT app hosts.

Validation:

```text
No remaining broad `normalized.endsWith(".gtixt.com")` host trust in TXT redirect helper.
```

### F5 - Low - Benign Domain References Are Numerous

Examples:

```text
api.txt.gtixt.com
app.txt.gtixt.com
bridge.txt.gtixt.com
mwc.gtixt.com
```

Impact:

- These are mostly public DNS/TLS/docs/smoke references.
- They are not by themselves contamination.

Recommendation:

- Treat `*.txt.gtixt.com` as TXT public domain references.
- Treat bare `gtixt.com`, `admin.gtixt.com`, and `data.gtixt.com` as GTIXT-owned and keep them out of TXT app/runtime code except shared ingress.

## Final Assessment

TXT is not currently mixing its database, proof data, backend logic, Playwright project, intelligence tables, or trading signals with GTIXT.

The serious issue is isolation hygiene:

```text
Data separation: PASS
Code separation: PASS
DB separation: PASS
Playwright separation: PASS
AI/signal separation: PASS
Network hermeticity: PASS with mission-control-tls as documented ingress bridge
Namespace clarity: PASS with txt.* keys and legacy read migration
Shared ingress ownership: PASS with GTIXT config under /opt/shared-ingress
```

Implemented remediation:

1. Removed `gtixt-app` from `txt_default` in GTIXT compose and runtime.
2. Added `/opt/txt/scripts/check_project_network_isolation.sh` and wired it into `/opt/stack_apply_live_guardrails.sh`.
3. Moved GTIXT ingress config to `/opt/shared-ingress/gtixt-tls.conf`.
4. Restored `/opt/txt/docker/bridge-tls.conf` after Docker had created an invalid directory mount source.
5. Migrated TXT UI localStorage keys from `gtixt.*` to `txt.*` with legacy fallback.
6. Restricted TXT redirect/public host helpers to explicit TXT hosts.

Residual caveat: `/opt/txt/secrets/tls` is still the shared certificate volume mounted by shared ingress for multiple public hosts. That is operational ingress ownership, not TXT application/data ownership, but it should eventually be moved to a neutral `/opt/shared-ingress` secrets root if the infrastructure layout is normalized further.