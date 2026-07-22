# TXT Alpha Engine V2 Activation Roadmap

Purpose: turn TXT from a trade generator into a capital allocator with memory, attribution, survival controls, and alpha-decay detection.

TXT should not become one giant AI that emits `BUY` or `SELL`. The durable architecture is a set of independent engines with explicit contracts:

```text
Market
-> Detection
-> Attribution
-> Allocation
-> Execution
-> Measurement
-> Reallocation
```

## Final Objective

Maximize net alpha:

```text
benchmark outperformance
- fees
- slippage
- drawdown cost
- capital lockup
```

TXT does not prove alpha by producing a fill, a dashboard, a simulated backtest, or a good-looking signal. It proves alpha when real-money outcomes beat a relevant benchmark after execution costs and drawdown control.

## Parallel Objectives

TXT optimizes these objectives together, not sequentially:

```text
1. Net alpha
2. Survival
3. Capital preservation
4. Attribution clarity
5. Opportunity-cost awareness
6. Strategy degradation detection
7. Market memory recall
8. Human-behavior error modeling
```

The core question is not only:

```text
What is the best trade?
```

It is:

```text
What is the best use of the next euro of risk capital?
```

Sometimes the answer is no trade.

## Capital Survival Score

Capital survival is a first-class KPI. A strategy that makes less but survives longer can be superior to a spectacular fragile strategy.

Minimum score components:

```text
probability_of_ruin
expected_drawdown_pct
drawdown_velocity
expected_recovery_time_days
capital_at_risk_usd
liquidity_exit_score
kill_switch_dependency
```

Initial normalized score:

```text
capital_survival_score =
  100
  - probability_of_ruin_pct * 0.35
  - expected_drawdown_pct * 1.25
  - drawdown_velocity_pct_per_day * 2.0
  - expected_recovery_time_days * 0.25
  - execution_stress_pct * 0.20
```

Hard rule:

```text
No capital scale-up if survival score is below threshold, even when recent PnL is positive.
```

## Engine Boundaries

Each engine must be independently testable, observable, and replaceable.

### 1. Alpha Attribution Engine

Answers:

```text
Why did TXT win or lose?
```

Contract:

```json
{
  "trade_id": "...",
  "decision_id": "...",
  "strategy_id": "momentum",
  "regime_id": "trend",
  "pnl_usd": 42.5,
  "fees_usd": 0.4,
  "slippage_cost_usd": 1.1,
  "execution_cost_usd": 0.7,
  "attribution": {
    "signal": 31.0,
    "regime": 6.5,
    "execution": 3.0,
    "allocation": 2.0,
    "residual": 0.0
  }
}
```

First implementation rule:

```text
Use deterministic telemetry before adding inferred AI explanations.
```

### 2. Capital Allocation Engine

Answers:

```text
Which strategy deserves capital, and how much?
```

Do not use equal-weight allocation as the default. Use score-based capital movement:

```text
allocation_score =
  alpha_score
  * stability_score
  * liquidity_score
  * regime_score
  * capital_survival_score
  * alpha_decay_guard

capital_weight = allocation_score / total_positive_scores
```

The engine may reduce capital before full Alpha Engine V2 activation. It may not recommend material scale-up until attribution and a minimal alpha-decay guard are present.

### 3. Opportunity Cost Engine

Answers:

```text
What did TXT leave on the table, and what loss did TXT avoid?
```

Contract:

```json
{
  "opportunity_id": "...",
  "signal": "BUY BTCUSD",
  "decision": "REJECT",
  "reason": "confidence_low",
  "blocked_by": ["kill_switch", "regime_conflict"],
  "evaluation_horizon": "24h",
  "ex_post_result_r": 3.4,
  "classification": "missed_alpha"
}
```

This engine must score rejected trades and avoided losses with the same seriousness as filled trades.

### 4. Market Memory Engine

Answers:

```text
When has TXT seen this market context before?
```

Market Memory is not sentiment, news, or a trade ledger. It is operational recall across regime, volatility, liquidity, trend strength, macro state, execution quality, and false-context patterns.

Contract:

```json
{
  "memory_query_id": "...",
  "symbol": "BTCUSD",
  "venue": "mt5",
  "regime": "high_volatility_trend",
  "context": {
    "volatility": "high",
    "liquidity": "thin",
    "trend_strength": 0.82,
    "macro_state": "dollar_strong",
    "execution_quality": 0.74
  },
  "similar_cases": 14,
  "historical_profit_factor": 1.62,
  "historical_max_drawdown_pct": 4.8,
  "memory_confidence_pct": 71,
  "warnings": ["thin_liquidity_recurrence"]
}
```

Hard rule:

```text
Present truth outranks memory. Memory informs admissibility; it never overrides live market truth.
```

### 5. Strategy Competition Engine

Answers:

```text
Which strategy family is earning the right to compete for capital?
```

Families start as independent plugins:

```text
momentum
mean_reversion
breakout
stat_arb
market_making
liquidity
```

Interface:

```text
score()
confidence()
risk()
expected_return()
capacity()
regime_fitness()
```

The engine ranks strategies. It does not execute orders directly.

### 6. Opportunity Engine

Answers:

```text
What is the best opportunity in the available universe now?
```

Universe:

```text
Crypto
Forex
Indices
Commodities
Equities
```

The engine ranks opportunities across instruments and venues. It should produce one best candidate for approval, not scatter execution requests.

### 7. Regime Switching Engine V2

Answers:

```text
Which strategies fit the current market regime?
```

Target regimes:

```text
TREND
RANGE
BREAKOUT
CRISIS
RISK_ON
RISK_OFF
LIQUIDITY_STRESS
```

Output:

```json
{
  "regime": "TREND",
  "confidence": 0.83,
  "strategy_fitness": {
    "momentum": 0.92,
    "mean_reversion": 0.31,
    "market_making": 0.12
  },
  "allocation_multipliers": {
    "momentum": 1.15,
    "mean_reversion": 0.4,
    "market_making": 0.1
  }
}
```

### 8. Alpha Decay Engine

Answers:

```text
Which strategy is ceasing to work?
```

Minimum table:

```text
strategy_alpha_decay
- strategy_id
- regime_id
- pf_7d
- pf_30d
- pf_90d
- sharpe_7d
- sharpe_30d
- expectancy_7d
- expectancy_30d
- drawdown_7d
- drawdown_30d
- decay_score
- decay_state
- capital_reduction_pct
- updated_at
```

Initial decay rule:

```text
decay_score = pf_7d - pf_30d

if pf_7d < 1.0 and pf_30d > 1.0:
  decay_state = "acute_decay"
elif decay_score < -0.25:
  decay_state = "degrading"
else:
  decay_state = "stable"
```

Hard rule:

```text
Capital shrinks before a decaying strategy becomes persistently negative.
```

## Activation Order

Before these engines become operational, TXT still needs recent real-money proof:

```text
1 real FILL
10 real trades
50 real trades
100 real trades
20 active days
profit factor > 1
expectancy > 0
drawdown controlled
```

After that sequence, build in this order:

```text
1. Alpha Attribution Engine
2. Capital Allocation Engine
3. Opportunity Cost Engine
4. Market Memory Engine
5. Strategy Competition Engine
6. Opportunity Engine
7. Regime Switching Engine V2
8. Alpha Decay Engine
```

Important constraint:

```text
Do not add new signal families until TXT can answer:
- Why did I win?
- Why did I lose?
- Why is this strategy degrading?
```

## Existing TXT Assets To Reuse

Do not rebuild these from scratch:

```text
shared/models.py PerformanceAttributionRow
shared/db.py performance_attribution tables and reality_gap_samples
apps/execution_router opportunity scoring and execution context
apps/ai_orchestrator strategy arena and regime agents
ui/mission-control/docs/market-memory-schema.md
ui/mission-control/lib/portfolioAllocator.ts
ui/mission-control/app/terminal/institutionalEngine.ts
scripts/alpha_engine_report.py
scripts/alpha_reactivation_board.py
TXT_ALPHA_ENGINE_V2_SELECTION_ARCHITECTURE.md
TXT_MONEY_REALITY_AND_ALPHA_ENGINE_PIVOT.md
```

## First Implementation Slice After REAL_100

The first coded slice should be small and auditable:

```text
1. Add AlphaAttributionRecord shared model.
2. Persist deterministic attribution per real trade.
3. Produce strategy/regime scorecards from real fills only.
4. Add Capital Survival Score to the allocation report.
5. Add minimal alpha-decay guard that can only reduce or pause capital.
6. Add Market Memory query API that returns similar historical contexts without making execution decisions.
```

No hidden autonomy:

```text
Every capital increase remains operator-visible until attribution, survival, memory, and decay gates pass consistently.
```

## Success Definition

TXT Alpha Engine V2 is credible when it can answer every day:

```text
Why did TXT make money?
Why did TXT lose money?
Which strategy deserves less capital?
Which regime made the edge appear or disappear?
Which missed trades mattered?
Which current market context resembles past profitable or dangerous contexts?
```

At that point, beating the market becomes the consequence of better selection, allocation, and degradation control, not a slogan attached to a signal.