# TXT v1 Operational Closure and v2 Proof Renewal

Current reading from `logs/spread_audit/remediation_snapshot_latest.json` on 2026-06-05.

This document was first generated from the 2026-06-02 proof state, where TXT looked operationally validated. The 2026-06-05 observation window is stricter: the latest spread-decision audit has no rows, so decision reality and operational MC/DC are not currently provable.

## Current Reading

TXT has moved from Evidence Acquisition to Evidence Maintenance.

The question is no longer: what must be added to TXT?

The question is now: when did TXT last prove each claim, and what can invalidate that proof?

| Layer | State | Meaning |
| --- | --- | --- |
| TXT v1 operational | PENDING | Broker and execution gap remain proven, but MC/DC and decision reality are pending in the latest observation window. |
| TXT v1 historical strict | PENDING | Strict thresholds are not met: coverage, proof coverage, unknown count, and elimination coverage all fail. |
| TXT v1 proof freshness | STALE | Proof exists, but it has not been renewed recently enough. |
| TXT v2 lifecycle engine | IN PROGRESS | Proof decay and renewal velocity are now being measured in the governance snapshot generator. |

## Latest Proof State

Operational proof loop:

```text
mcdc=pending | decision_reality=pending | broker=ok | gap=ok
```

Strict proof:

```text
strict_v1_proven=false
operational_v1_proven=false
```

Proof renewal:

```text
state=STALE
fresh_proven=false
proof_renewal_due=true
proof_expired=false
```

Current ages:

| Signal | Age | Renewal State | Fresh Target | Renewal Lag |
| --- | ---: | --- | ---: | ---: |
| ACK | 46.31d | STALE | <7d | 39.31d |
| Fill | 46.31d | STALE | <7d | 39.31d |
| Outcome | 66.04d | STALE | <14d | 52.04d |
| Gap sample | 18.47d | AGING | <7d | 11.47d |

Next renewal priority:

```text
outcome
```

Next expiration pressure:

```text
ack / fill
```

The next generated snapshot will expose this as:

```text
renewal_velocity.max_lag_days
renewal_velocity.next_signal_to_renew
renewal_velocity.next_signal_to_expire
proof_decay_detected
proof_invalidated
```

With the current evidence ages, the expected lifecycle reading is:

```text
max_lag=52.04d
renew_next=outcome
expire_next=ack
decay=yes
invalidated=no
```

Offline observation command:

```bash
python3 scripts/proof_lifecycle_snapshot.py --text
```

This command reads the current `remediation_snapshot_latest.json` and does not run Docker, update `latest`, write shared exports, update state, or send alerts.

Offline v1 closure audit:

```bash
python3 scripts/proof_lifecycle_snapshot.py --audit
```

Expected current reading:

```text
V1 Closure: fresh=no strict=no operational=no renew_next=outcome expire_next=ack coverage_gap=80.00pts proof_gap=60.00pts unknown_gap=5 elimination_gap=50.00pts
```

Automatable gates:

```bash
python3 scripts/proof_lifecycle_snapshot.py --text --check not-invalidated
python3 scripts/proof_lifecycle_snapshot.py --audit --check fresh
python3 scripts/proof_lifecycle_snapshot.py --audit --check operational --check strict
```

Current gate behavior:

```text
not-invalidated => pass
fresh => fail
operational => fail
strict => fail
```

Offline recommendations:

```bash
python3 scripts/proof_lifecycle_snapshot.py --recommend
```

Expected current recommendations:

```text
RENEW: prioritize outcome proof renewal.
WATCH: ack is closest to expiration.
OBSERVE: wait for decision rows before claiming operational v1 closure.
MAP: close strict v1 gaps coverage=80.0 proof=60.0 unknown=5 elimination=50.0.
```

## Observation Drift Since 2026-06-02

The 2026-06-02 snapshot had decision rows and produced the earlier operational-close reading:

```text
rows=11
decision_quote_coverage=100%
unknown_conditions=4
```

The current latest snapshot is weaker:

```text
rows=0
decision_quote_coverage=n/a
unknown_conditions=7
```

This should be treated as observation drift rather than a code expansion request. It means TXT needs renewed live evidence before the operational v1 claim can be closed again.

## Sprint 1: Proof Renewal

Goal:

```text
fresh_proven=true
```

Targets:

```text
days_since_last_ack < 7
days_since_last_fill < 7
days_since_last_outcome < 14
days_since_last_gap_sample < 7
```

Success condition:

```text
Proof Renewal: state=FRESH fresh=yes due=no expired=no
```

This sprint should renew evidence, not add new dashboard layers.

## Sprint 2: Unknown Condition Eradication

Current unknown conditions in the latest empty observation window:

```text
condition_unclassified
confidence_gate_disabled
fallback_router_selected
legacy_path_selected
quote_merge_or_gate_mismatch
quote_merged
timeout_before_quote_merge
```

Known debt from the 2026-06-02 populated window:

```text
confidence_gate_disabled
legacy_path_selected
quote_merge_or_gate_mismatch
timeout_before_quote_merge
```

Targets:

```text
unknown_conditions <= 2
unknown_conditions = 0
```

Workflow:

```text
Observed -> Classified -> Explained -> Eliminated
```

The current `unknown_conditions=7` is partly a symptom of `rows=0`. The real sprint remains classification of the four known unclassified paths once decision rows return.

## Sprint 3: Proof Decay / Invalidation Engine

Goal: detect when TXT stops being true before a human operator discovers it.

The engine should answer:

```text
Which proof is aging?
Which proof is close to expiring?
Which proof was not renewed?
Which proof diverges?
Which proof regressed?
How long does proof renewal take?
```

Core fields now present or planned:

```text
proof_exists
proof_age
proof_decay_detected
proof_renewal_due
proof_expired
proof_invalidated
renewal_velocity
```

Composite maturity view:

```text
operational_proven
strict_proven
fresh_proven
```

## Final Verdict

TXT v1 operational is not closed in the latest current-state evidence.

TXT v1 still has proven broker and execution-gap evidence, but the latest observation window does not prove decision reality or MC/DC.

TXT v1 proof freshness is stale and must be renewed.

TXT v2 should focus on proof renewal, decay, invalidation, and renewal velocity rather than adding more execution or dashboard layers.
