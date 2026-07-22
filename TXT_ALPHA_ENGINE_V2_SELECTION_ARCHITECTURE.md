# TXT Alpha Engine V2 Selection Architecture

Purpose: make TXT a selector and allocator of strategies, not one more strategy.

Final objective:

```text
Beat the market with sustained real-money alpha.
```

TXT is not allowed to claim this from architecture, governance, public fills, paper trades, or one lucky micro-fill. It must show real-money performance, controlled drawdown, benchmark comparison, and an attribution trail that explains where profit actually came from.

This architecture is post-reactivation. It must not delay the next `TXT ALPHA REACTIVATION` board item:

```text
NEXT_ACTION: FILL - 1 FILL reel recent
```

## Strategic Rule

Do not add strategy sprawl before real trading resumes.

Do not add advanced sentiment, geopolitics, macro-news, LLM trading, RL trading, or self-evolution before TXT knows which existing source of alpha, if any, is producing real money.

The missing layer is meta-intelligence:

```text
Why did the trade win or lose?
When should this strategy lose capital or stop?
Which strategy deserves the next euro?
Which opportunity was missed?
Which opportunity is best now?
Which regime is TXT actually trading?
```

## Existing Assets To Reuse

TXT already has useful primitives:

```text
opportunity gate
market/regime logs
reaction/regime cell maturity
strategy_id and portfolio_id on outcomes
execution telemetry
execution fills
decision outcomes
reality gap samples
capital allocation guard
portfolio risk snapshots
performance attribution helpers
Alpha Engine 30D report
```

Do not replace these. Promote them into a coherent Alpha Engine V2 loop.

## Activation Gate

Alpha Engine V2 is not operational until the reactivation board passes:

```bash
python3 scripts/alpha_reactivation_board.py --hours 720 --check alpha-v2
```

That gate requires:

```text
REAL_100
20 active days with at least 1 timestamped real trade
Profit Factor > 1
```

Before that, V2 work is limited to documentation, tests, and bug fixes that protect the real-money loop.

First operational V2 engine:

```text
Alpha Attribution Engine
```

## Layer 1: Alpha Attribution Engine

Goal: explain why a trade won or lost.

Example output:

```text
Trade #4587
PnL: +43 USD

Momentum           +27%
Market Regime      +31%
Sentiment          +12%
Macro               +8%
Execution Timing   +15%
Chance              +7%
```

Minimum input:

```text
trade_id or decision_id
broker_ticket
strategy_id
portfolio_id
regime
horizon
pnl_usd
slippage_bps
latency_ms
fill_quality
reality_gap
outcome_labels
```

Minimum contributor families for V2 start:

```text
Momentum
Mean Reversion
Market Regime
Liquidity / Order Flow
Execution Timing
Volatility
Chance / Residual
```

Keep Macro, Sentiment, News, LLM/RL features out of the first attribution contract unless they are already present in the real trade payload. Adding them before attribution is stable makes diagnosis harder, not better.

First implementation should be conservative:

```text
1. Start with deterministic attribution from existing telemetry.
2. Attribute execution contribution from slippage, latency, fill quality, and route choice.
3. Attribute regime contribution from reaction/regime cell maturity.
4. Keep Chance/Residual explicit instead of pretending every dollar is explained.
```

## Layer 2: Capital Allocation Engine

Goal: decide size, not just direction.

TXT should become an allocator before it tries to become a more complicated trader.

Capital should increase only when recent real evidence supports it:

```text
positive expectancy
profit factor > 1
drawdown controlled
regime match
execution quality acceptable
strategy not degrading
```

Minimum contract:

```text
strategy_id
portfolio_id
regime
horizon
base_allocation_usd
suggested_allocation_usd
max_allocation_usd
confidence
drawdown_multiplier
regime_multiplier
execution_quality_multiplier
reason_codes
```

Hard rule:

```text
No positive real-money sample -> no capital scale-up.
No controlled drawdown -> no capital scale-up.
No alpha-decay guard -> no capital scale-up.
```

## Layer 3: Opportunity Cost Engine

Goal: explain why TXT did not take a trade.

Minimum output:

```text
opportunity_id
detected_signal
confidence
not_executed_reason
blocked_by
missed_pnl_estimate
approval_state
spread_state
regime_conflict
capital_constraint
```

This engine audits missed alpha and approval gaps. It should explain non-decisions with the same seriousness as filled trades.

## Layer 4: Strategy Competition Engine

Each strategy family competes for capital.

Families:

```text
Momentum
Mean Reversion
StatArb
Sentiment
Macro
Liquidity
News
Market Making
```

Daily scorecard:

```text
strategy_id
family
regime
horizon
real_trade_count
profit_factor
expectancy_usd
sharpe_like
max_drawdown_usd
hit_rate_pct
degradation_state
capital_weight
```

Decision:

```text
promote
hold
reduce
disable
observe_only
```

## Layer 5: Opportunity Engine Global

Goal:

```text
5000 raw opportunities
-> 100 candidates
-> 20 strong
-> 5 excellent
-> 1 executed
```

The Opportunity Engine is not another signal. It is a ranking funnel.

Minimum contract:

```text
opportunity_id
timestamp
symbol
venue
side
horizon
regime
strategy_family
expected_edge_usd
expected_edge_bps
expected_slippage_bps
fill_probability
capacity_usd
risk_usd
score
rejection_reasons
```

First useful gate:

```text
Only the top-ranked opportunity can request live approval.
```

## Layer 6: Regime Switching Engine V2

TXT should not mainly predict price. It should predict context.

Target regimes:

```text
TREND
RANGE
EXPANSION
CONTRACTION
PANIC
EUPHORIA
NEWS_SHOCK
LIQUIDITY_CRISIS
```

Regime output:

```text
current_regime
regime_confidence
transition_probability
expected_duration
allowed_strategy_families
blocked_strategy_families
allocation_multipliers
```

First allocation rule:

```text
If regime confidence is low, reduce size before changing strategy.
```

## Layer 7: Alpha Decay Engine

Goal: detect when a strategy stops working before it becomes a material loss.

This is the guardrail that makes capital allocation professional instead of merely reactive. The full engine can arrive after Regime Switching V2, but a minimal decay guard must exist before any material scale-up.

Minimum output:

```text
strategy_id
family
regime
horizon
rolling_profit_factor
rolling_expectancy_usd
rolling_drawdown_usd
decay_state
decay_slope
capital_reduction_recommendation
reason_codes
```

Decay example:

```text
Momentum PF: 1.45 -> 1.32 -> 1.21 -> 1.08 -> 0.97
```

Rule:

```text
Capital must shrink before decay turns into persistent negative expectancy.
```

## Layer 8: Multi-Timeframe Engine

TXT must handle contradictory horizons.

Canonical horizons:

```text
Microstructure: 1s -> 5m
Intraday:       5m -> 4h
Swing:          1d -> 30d
Macro:          1m -> 12m
```

Conflict example:

```text
Microstructure = SHORT
Intraday       = NEUTRAL
Swing          = LONG
Macro          = VERY_LONG
```

Minimum output:

```text
horizon_votes
dominant_horizon
conflict_score
trade_allowed
size_multiplier
explanation
```

Rule:

```text
High horizon conflict reduces size unless the opportunity score is exceptional.
```

## Activation Order

Do this only after the board passes `alpha-v2`, which means `REAL_100`, 20 active days, and `Profit Factor > 1` are all done.

```text
1. Alpha Attribution Engine
2. Capital Allocation Engine
3. Opportunity Cost Engine
4. Market Memory Engine
5. Strategy Competition Engine
6. Opportunity Engine
7. Regime Switching Engine V2
8. Alpha Decay Engine
9. Multi-Timeframe Engine
10. Self-Evolving Strategy Lab
11. Sentiment / Geopolitics Advanced
```

The operational activation contract lives in `TXT_ALPHA_ENGINE_V2_ACTIVATION_ROADMAP.md`.

Scale-up constraint:

```text
Capital Allocation may recommend reductions early, but it may not recommend material increases until alpha attribution and an alpha-decay guard are both present.
```

Immediately after `REAL_100`, before route/UI cleanup:

```text
1. Latency Audit
2. Refusal Audit
3. Attribution Audit
```

## Non-Goals

Do not start with:

```text
50 new strategies
200 indicators
10 unrelated AI models
opaque ensemble voting
capital scale-up without real PnL
benchmark outperformance claims without real-money comparison
```

## Success Definition

TXT Alpha Engine V2 starts becoming real when:

```text
Reactivation board has REAL_100 done
20 active trading days are covered
Alpha Engine 30D has >= 50 real trades
Profit Factor > 1
Expectancy > 0
Drawdown controlled
Strategy scorecards differ by regime
Capital allocation changes based on real results
Attribution explains PnL with explicit residual/chance
Decay detection reduces capital before strategy failure becomes persistent
```

Until then, the only honest verdict remains:

```text
Alpha not proven.
```
