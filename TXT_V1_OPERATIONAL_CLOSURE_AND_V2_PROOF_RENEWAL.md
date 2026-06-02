# TXT v1 Operational Closure and v2 Proof Renewal

Generated from `logs/spread_audit/remediation_snapshot_latest.json` on 2026-06-02.

## Current Reading

TXT has moved from Evidence Acquisition to Evidence Maintenance.

The question is no longer: what must be added to TXT?

The question is now: what can still invalidate TXT?

| Layer | State | Meaning |
| --- | --- | --- |
| TXT v1 operational | VALIDATED | Broker, execution gap, decision reality, and operational MC/DC are proven. |
| TXT v1 historical strict | PENDING | Historical MC/DC thresholds are not met. |
| TXT v1 proof freshness | STALE | Proof exists, but it has not been renewed recently enough. |
| TXT v2 invalidation engine | TO BUILD | TXT must detect when its proof stops being current or valid. |

## Latest Proof State

Operational proof loop:

```text
mcdc=ok | decision_reality=ok | broker=ok | gap=ok
```

Strict proof:

```text
strict_v1_proven=false
operational_v1_proven=true
```

Proof renewal:

```text
state=STALE
fresh_proven=false
proof_renewal_due=true
proof_expired=false
```

Current ages:

| Signal | Age | Renewal State | Fresh Target |
| --- | ---: | --- | ---: |
| ACK | 43.71d | STALE | <7d |
| Fill | 43.71d | STALE | <7d |
| Outcome | 63.44d | STALE | <14d |
| Gap sample | 15.87d | AGING | <7d |

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

Current unknown conditions:

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

These conditions do not block operational TXT v1 anymore. They are epistemic debt.

## Sprint 3: Proof Decay / Invalidation Engine

Goal: detect when TXT stops being true before a human operator discovers it.

The engine should answer:

```text
Which proof is aging?
Which proof is close to expiring?
Which proof was not renewed?
Which proof diverges?
Which proof regressed?
```

Core fields:

```text
proof_exists
proof_age
proof_decay
proof_renewal_due
proof_renewed
proof_expired
```

Composite maturity view:

```text
operational_proven
strict_proven
fresh_proven
```

## Final Verdict

TXT v1 operational is validated.

TXT v1 strict historical remains pending.

TXT v1 proof freshness is stale and must be renewed.

TXT v2 should focus on proof renewal, decay, and invalidation rather than adding more execution or dashboard layers.