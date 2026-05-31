# TXT Reaction/Regime Event Comparison - 2026-05-31

## Scope

This note freezes the first three controlled reaction-gated event campaigns and
separates sample count from independent event count.

Production join windows are unchanged:

- Reaction lookback: 300s
- Regime lookback: 300s
- Outcome field: `pnl_bps_5m`
- Complete join means `Reaction + Regime + Outcome` all present.

## Campaign Summary

| Campaign | Dominant event | Dominant venue | Labels | Complete joins | Complete cell | Join rate |
| --- | --- | --- | ---: | ---: | --- | ---: |
| `rg10-20260530-095450` | MEDIUM | binance-public | 10 | 5 | MEDIUM + RANGE | 50.0% |
| `rg50-20260530-194634` | SLOW | bybit-public | 48 | 38 | SLOW + RANGE | 79.2% |
| `rg50-20260530-220227` | FAST | bybit-public | 50 | 41 | FAST + RANGE | 82.0% |

The important repeated motif is not an edge yet. It is that all three complete
event cells occurred under `RANGE`.

## Analysis 1: FAST + RANGE vs SLOW + RANGE

Both samples are on bybit-public, in RANGE regime, with opposite reaction speed
classes.

| Cell | Event count | Sample count | Outcome labels | Mean 5m pnl bps | Median 5m pnl bps | 5m pnl stdev | Positive pnl rate |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| SLOW + RANGE | 1 | 38 | 38 neutral | -0.7752 | -1.6481 | 3.5528 | 36.84% |
| FAST + RANGE | 1 | 41 | 41 neutral | 0.1050 | 0.3790 | 0.8961 | 58.54% |

Preliminary read:

- FAST + RANGE was much tighter: 5m variance `0.8031` vs `12.6222`.
- SLOW + RANGE had wider dispersion and a negative 5m center.
- Both remain outcome-label neutral because all absolute 5m pnl values stayed
  inside the configured neutral band.
- This is a contrast between two independent bybit events, not 79 independent
  experiments.

## Analysis 2: Venue Under RANGE

The current venue comparison is useful, but confounded by reaction class and
event identity.

| Venue | Event count | Complete joins | Reaction classes | Mean 5m pnl bps | Median 5m pnl bps | Positive pnl rate |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| binance-public | 1 | 5 | MEDIUM: 5 | 1.7022 | 1.7022 | 100.00% |
| bybit-public | 2 | 79 | SLOW: 38, FAST: 41 | -0.3184 | -0.1354 | 48.10% |

Preliminary read:

- Binance does not yet have a fair comparator: only 5 complete joins from one
  MEDIUM + RANGE event.
- Bybit is the useful near-term laboratory because it already has two distinct
  events in the same regime with opposite reaction speeds.
- A venue claim should wait for the same cell across venues, for example
  FAST + RANGE on both bybit and binance, or SLOW + RANGE on both.

## Analysis 3: Event Concentration

| Cell | Sample count | Independent event count | Campaign/event |
| --- | ---: | ---: | --- |
| MEDIUM + RANGE | 5 | 1 | `rg10-20260530-095450` / binance-public |
| SLOW + RANGE | 38 | 1 | `rg50-20260530-194634` / bybit-public |
| FAST + RANGE | 41 | 1 | `rg50-20260530-220227` / bybit-public |

Cell replication summary:

Runtime evidence state: `EXPLORATORY`.

Diagnostics:

- `cell_count = 3`
- `replicated_cells = 0`
- `mature_cells = 0`
- `outcomes_with_both = 84`

| Cell | Status | cell_replicates | Sample count | Mean 5m pnl bps | Median 5m pnl bps | Stdev 5m pnl bps | Positive pnl rate | Last observation | Venue |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| FAST + RANGE | OBSERVATION | 1 | 41 | 0.1050 | 0.3790 | 0.8961 | 58.54% | 2026-05-30T22:03:29.856257Z | bybit-public |
| SLOW + RANGE | OBSERVATION | 1 | 38 | -0.7752 | -1.6481 | 3.5528 | 36.84% | 2026-05-30T19:47:46.342847Z | bybit-public |
| MEDIUM + RANGE | OBSERVATION | 1 | 5 | 1.7022 | 1.7022 | 0.0000 | 100.00% | 2026-05-30T09:54:59.841506Z | binance-public |

Permanent generator:

```bash
python3 scripts/reaction_regime_cell_maturity.py \
  --decision-prefix rg10-20260530-095450 \
  --decision-prefix rg50-20260530-194634 \
  --decision-prefix rg50-20260530-220227 \
  --markdown-output logs/reaction_regime_cell_maturity_controlled_20260531.md \
  --json-output logs/reaction_regime_cell_maturity_controlled_20260531.json
```

Conclusion:

- The pipeline is now reproducible: the two 50-order campaigns produced stable
  complete-join rates of `79.2%` and `82.0%`.
- The motif is `RANGE`, observed across three independent reaction events.
- No reaction/regime cell is robust yet, because every complete cell has
  `event_count = 1`.
- `cell_replicates` is now the primary maturity KPI for a cell. Sort by this
  before sample count.
- Runtime Truth can expose this as `edge_evidence_state = EXPLORATORY`: joins
  are validated, but no cell has replicated across independent events yet.

Evidence state ladder:

| State | Condition |
| --- | --- |
| `EXPLORATORY` | Complete cells exist, but `replicated_cells = 0` |
| `EMERGING` | `replicated_cells >= 1`, but `mature_cells = 0` |
| `EVIDENCED` | `mature_cells >= 1` |
| `STRUCTURAL` | Multiple mature cells form a coherent regime/direction group |

## Next Collection Rule

Do not optimize for more fills yet. Optimize for independent event replication.

Priority targets:

1. Another `FAST + RANGE` event, preferably bybit-public first.
2. Another `SLOW + RANGE` event, preferably bybit-public first.
3. A comparable `FAST + RANGE` or `SLOW + RANGE` event on binance-public.

Only after a cell reaches at least three independent events should TXT start
treating its sample distribution as a candidate edge distribution.