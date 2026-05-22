# Mission Control Blue/Green Runbook Short

This is the shortest safe path to publish Mission Control UI and validate the post-flip runtime in this stack.

## 1. Pre-check

From `/opt/txt`:

```bash
scripts/mission_control_blue_green.sh status
```

Confirm:

- one slot is `active`
- the inactive slot is not in a broken state
- `mission-control-gateway` is running

## 2. Deploy The Inactive Slot

```bash
scripts/mission_control_blue_green.sh deploy
```

What this does:

- builds the inactive UI dist (`.next-runtime-blue` or `.next-runtime-green`)
- starts the matching container
- waits for healthy status
- refuses the active slot by default, so the published UI is not rebuilt in place

If you need a specific slot:

```bash
scripts/mission_control_blue_green.sh deploy blue
scripts/mission_control_blue_green.sh deploy green
```

If you intentionally need an emergency in-place rebuild of the active slot, opt in explicitly:

```bash
ALLOW_ACTIVE_SLOT_DEPLOY=1 scripts/mission_control_blue_green.sh deploy blue
```

Use that override only when the standby path cannot be used.

## 3. Flip Traffic

```bash
scripts/mission_control_blue_green.sh promote
```

Or flip an already healthy slot explicitly:

```bash
scripts/mission_control_blue_green.sh flip blue
scripts/mission_control_blue_green.sh flip green
```

This updates [data/mission-control/ui-active-slot.conf](/opt/txt/data/mission-control/ui-active-slot.conf) and reloads `mission-control-gateway`.

## 4. Post-Flip Validation

Re-check slot health:

```bash
scripts/mission_control_blue_green.sh status
```

Run the authenticated live dashboard smoke against the published gateway from the active UI container:

```bash
docker exec mission-control-ui-green sh -lc 'cd /workspace/ui/mission-control && PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium MC_SMOKE_BASE_URL=http://mission-control-gateway:3000 MC_SMOKE_OUTPUT_DIR=/workspace/artifacts node scripts/mission_control_dashboard_live_smoke.js'
```

If blue is active, replace `mission-control-ui-green` with `mission-control-ui-blue`.

Expected smoke proof:

- `ok: true`
- `deploymentDeskVisible: true`
- `adaptiveRuleVisible: true`
- screenshot written to `artifacts/mission-control-dashboard-live-smoke.png`
- JSON proof written to `artifacts/mission-control-dashboard-live-smoke.json`

## 5. Fast Rollback

If the flipped slot is unhealthy or the live smoke fails:

```bash
scripts/mission_control_blue_green.sh rollback
scripts/mission_control_blue_green.sh status
```

Rollback is immediate gateway re-pointing to the other slot.

## 6. Controlled Deployment Engine Caveat

Validated on `2026-04-20`:

- live Mission Control dashboard smoke passed on the published runtime
- real controlled deployment test canaries could be created
- in the current runtime, `kill_switch_active=true` blocks normal live `ACCEPT` validation and forces monitored test canaries toward rollback logic

Operator consequence:

- if you want to observe real `PROMOTE` or `SCALE_DOWN`, first clear the runtime kill-switch condition
- otherwise treat repeated `ROLLBACK` outcomes as runtime governance behavior, not as a blue/green publication failure