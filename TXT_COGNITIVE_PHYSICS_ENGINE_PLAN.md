# TXT Cognitive Physics Engine Plan

## Purpose

TXT should not add universal constants as symbolic decoration. It should add the
constants and primitives that improve measurement, classification, governance,
and prediction.

The goal is to measure what TXT learns:

- how fast evidence decays
- how much information a signal adds
- how unstable a market state is
- how novel or compressible an observation is
- how mature a causal cell has become across independent events

## Current Anchor

The first concrete primitive is already active:

- `event_count` before `sample_count`
- `mature_cells = count(cell.event_count >= 3)`
- `edge_evidence_state`: `NO_REPLICATED_CELLS`, `EXPLORATORY`, `EMERGING`, `EVIDENCED`, `STRUCTURAL`

Current state on the controlled campaigns:

- `cell_count = 3`
- `replicated_cells = 0`
- `mature_cells = 0`
- `edge_evidence_state = EXPLORATORY`

This is causal maturity, not performance ranking.

State ladder:

| State | Condition | Meaning |
| --- | --- | --- |
| `NO_REPLICATED_CELLS` | No complete cells | No complete causal observation yet |
| `EXPLORATORY` | `replicated_cells = 0` and complete cells exist | Joins are valid, proof is not |
| `EMERGING` | `replicated_cells >= 1`, `mature_cells = 0` | At least one cell repeated twice |
| `EVIDENCED` | `mature_cells >= 1` | At least one cell reached `event_count >= 3` |
| `STRUCTURAL` | Multiple mature cells form a coherent regime/direction group | Evidence is no longer isolated to one cell |

## Level 1: Direct Operational Value

### e and ln(2)

Use for decay and half-life instead of arbitrary aging rules.

Examples:

- observation decay
- trust decay
- evidence decay
- route confidence decay
- runtime truth freshness decay

Canonical forms:

```text
weight(t) = exp(-lambda * age)
half_life = ln(2) / lambda
```

### Shannon Entropy

Use to measure information and uncertainty.

Candidate TXT scores:

- `signal_entropy`
- `decision_entropy`
- `route_entropy`
- `cell_outcome_entropy`

Question answered:

```text
Does this observation reduce uncertainty, or only add volume?
```

### Boltzmann Entropy Principle

Do not import the physical constant blindly. Use the entropy principle: count
how many microstates explain the same macrostate.

Candidate TXT scores:

- `market_entropy`
- `execution_entropy`
- `governance_entropy`

Question answered:

```text
Is the current state tightly constrained, or compatible with many hidden causes?
```

### Lyapunov Stability

Use simplified divergence measures to detect fragile states.

Candidate TXT scores:

- `market_stability_index`
- `route_stability_index`
- `cell_dispersion_stability`

Question answered:

```text
Do nearby observations stay nearby, or diverge quickly?
```

## Level 2: High-Value Research Primitives

### Feigenbaum Delta and Alpha

Use as regime-transition inspiration, not as fixed trading constants.

Candidate TXT use:

- bifurcation warning
- pre-chaos regime detection
- multi-timeframe self-similarity checks

### Zeta / Power-Law Detection

Use to detect heavy tails and concentration.

Candidate TXT scores:

- `tail_risk_exponent`
- `venue_concentration_power_law`
- `event_concentration_power_law`

Question answered:

```text
Is TXT learning broadly, or from a few dominant events?
```

### Kolmogorov Compressibility

Use practical approximations, not exact Kolmogorov complexity.

Candidate TXT scores:

- `pattern_compressibility`
- `novelty_score`
- `replay_compression_ratio`

Question answered:

```text
Is this new data compressible by what TXT already knows?
```

## Level 3: Governance Primitives

### Unknown Zone Score

Inspired by Chaitin/Godel limits: some regions are not merely low-confidence;
they are structurally underdetermined.

Candidate TXT states:

- `UNKNOWN_ZONE`
- `INSUFFICIENT_REPLICATION`
- `NON_IDENTIFIABLE_CAUSE`

### Godel Limit Score

Use as a governance reminder, not as mathematics theater.

Candidate rule:

```text
TXT must not certify its own completeness from internal evidence only.
```

Operational version:

- expose uncertainty explicitly
- require independent event replication
- require external or delayed validation for mature action states

## Proposed Engine Contract

Future module: `scripts/txt_cognitive_physics_engine.py`.

Inputs:

- reaction/regime/outcome maturity table
- edge map joined rows
- market entropy windows
- route decision distributions
- replay/certification metadata

Outputs:

- `entropy_score`
- `chaos_score`
- `stability_score`
- `novelty_score`
- `compressibility_score`
- `truth_confidence_score`
- `unknown_zone_score`
- `edge_evidence_state`

Runtime Truth should expose these as observation/governance evidence, not as
execution authorization by themselves.

## Implementation Order

1. Keep `edge_evidence_state` in Runtime Truth.
2. Add entropy on cell outcomes and route choices.
3. Add decay-weighted evidence using half-life primitives.
4. Add dispersion/stability metrics for replicated cells.
5. Add novelty/compressibility once enough replay history exists.

## Rule

No constant should enter TXT unless it answers one of these questions:

1. Does this improve measurement quality?
2. Does this reduce false confidence?
3. Does this improve regime or cell classification?
4. Does this improve governance of unknown states?
5. Does this improve prediction only after replication?