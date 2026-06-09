# Causal Spine Root Objects

Mission Control has exactly four root objects:

1. Allocation Decision
2. Approval Decision
3. Execution Fact
4. Opportunity Cost

Everything else is derived from these append-only journals. New engines must consume these objects and must not create a parallel source of truth.

## Contract

- Allocation decisions are written to `mission-control-allocation-decisions.jsonl`.
- Approval decisions are written to `mission-control-approval-decisions.jsonl`.
- Execution facts are written to `mission-control-execution-facts.jsonl`.
- Opportunity costs are written to `mission-control-opportunity-costs.jsonl`.
- In blue/green runtime, these journals must live in shared mounted storage, not slot-local `/tmp`.
- Readers must tolerate append-only revisions and apply latest-wins semantics by root object ID.
- Aggregates, dashboards, and scorers are downstream views, never new truth.

## No Parallel Truth

- Do not add engine-local journals that redefine allocation, approval, execution, or opportunity state.
- Do not bypass the root journals with control-plane payload caches, UI-only stores, or ad hoc aggregation snapshots.
- If a derived surface disagrees with the journals, the journals win and the derived surface must be repaired.

## Runtime Invariants

- Runtime writes journals.
- Runtime reads the same journals back.
- Runtime exposes aggregates derived from those journals.
- Rebuilds and blue/green flips must preserve journal continuity.
- Scoring may append revisions to an existing root object ID, but must not create unbounded write loops.

## Lifecycle IDs To Add Explicitly

The current spine still needs first-class lifecycle identifiers across the four root objects:

- `trade_lifecycle_id`
- `candidate_id`
- `decision_id`
- `approval_id`
- `execution_id`
- `outcome_id`

Until those IDs exist end-to-end, engines should treat `decision_id` as the only partially available cross-object join key rather than inventing new local correlation keys.