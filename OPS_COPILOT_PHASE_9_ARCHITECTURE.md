# Ops Copilot Phase 9 Architecture

## Purpose

This document defines the future architecture of a real Ops Copilot for TXT.

It is a later-phase operator assistant.

It is not allowed to replace the current measured execution logic.

It becomes active only after:
- journal d'attention live is stable
- 7j/14j review is stable
- computeAttention V2 is stable
- 7-14 day calibration is validated
- downstream strategy and capital layers are understood well enough to explain

## Non-Negotiable Rule

The LLM is an operator copilot.

It is not the trade decision engine.

The rule engine, risk engine, no-trade guards, and calibration gates stay above the LLM.

Allowed role:
- explain
- summarize
- compare
- retrieve context
- propose operator actions
- call approved tools with confirmations

Forbidden role:
- decide trade entry alone
- decide risk override alone
- bypass no-trade rules
- mutate capital routing without explicit operator confirmation

## Target Capabilities

The future Ops Copilot should:
- understand the current page, current desk state, and recent operator context
- generate new responses instead of only selecting prewritten ones
- adapt its language to the user role and style
- reason across multiple TXT layers before answering
- follow complex instructions reliably
- help operate TXT with structured tool use
- support voice input and voice output later
- use page telemetry first, and only use selective visual capture later when justified

## Layered Architecture

### 1. Persona Layer

Purpose:
- keep one stable behavior across pages and sessions

Contract:
- role: ops copilot for TXT
- style: direct, calm, precise, operator-first
- tone: clear, low-jargon, high-accountability
- posture: explain the reason, then the risk, then the next action
- consistency rule: same situation should produce the same structure of answer

Response formats:
- command mode: DECISION / RISK / REASON / NEXT STEP
- analysis mode: STATE / WHAT CHANGED / WHY IT MATTERS / WHAT TO CHECK
- incident mode: ISSUE / IMPACT / SAFE ACTION / ESCALATION

### 2. Context Engine

Purpose:
- give the model memory and live state without making it guess

Sub-layers:
- short memory:
  - current page
  - current symbol, venue, timeframe, strategy
  - current readiness state
  - current risk posture
  - latest operator actions
- long memory:
  - journal d'attention
  - 7j/14j review tables
  - calibration history
  - incident history
  - user preferences and user style profile
- live state:
  - active route decision
  - execution truth
  - drift state
  - no-trade state
  - suspended strategies
- retrieval layer:
  - fetch only the smallest relevant context bundle
  - include evidence rows, not raw dumps

Context bundle shape:
- user
- page
- live market state
- live execution state
- recent journal findings
- current guardrails
- available tools

### 3. Domain Adapter

Purpose:
- turn a generic LLM into a TXT operator assistant

Knowledge packs:
- trading operations
- terminal TXT workflows
- V6 and execution state interpretation
- RL and JEPA research vocabulary where needed
- business rules and operator discipline
- account model: paper / live / exchange / wallet
- escalation rules and incident language

Domain rules:
- use plain language by default
- keep internal model names secondary to operator meaning
- always explain which layer is speaking
- separate observation from recommendation
- separate recommendation from allowed action

### 4. Tool Use Layer

Purpose:
- let the assistant act on TXT safely instead of only talking

Tool classes:
- read tools:
  - live readiness
  - execution truth
  - drift
  - incidents
  - capital state
  - connectors state
  - recent journal and calibration summaries
- operator tools:
  - open page
  - open incident draft
  - launch runbook
  - apply approved threshold change draft
  - generate operator review note draft
- restricted tools:
  - anything that changes risk or capital
  - anything that changes live routing
  - anything that executes a sensitive action

Tool protocol:
- model explains intended action first
- system checks guardrails
- sensitive actions require second confirmation
- resulting state is shown back to the operator

### 5. Safety Layer

Purpose:
- keep the copilot useful under stress without giving it unsafe authority

Rules:
- hard guards always override the LLM
- no-trade rules always override the LLM
- live execution remains explicit and confirmed
- every sensitive action is logged with reason and operator identity
- hallucinated data must be treated as failure

Safety checks before response:
- is the data fresh enough
- is the answer supported by current state
- is the action allowed in this mode
- is a confirmation required
- is the model speaking outside its authority

## Runtime Design

### Model Routing

Recommended later setup for TXT:
- primary local dialog model: qwen2.5:14b
- local reasoning fallback: deepseek-r1:14b
- specialist code model: deepseek-coder-v2:16b for engineering tasks, not as the main ops voice
- remote fallback: current OpenAI route only for cases where local quality is insufficient and policy allows it

Why:
- qwen2.5:14b is the best current local candidate on this machine for natural operator dialogue
- deepseek-r1:14b is better kept as a reasoning and escalation model than as the main conversational layer
- deepseek-coder-v2:16b is useful for implementation help, not as the operator-facing default

### Orchestration Flow

1. receive user message, voice input, or page-triggered assist request
2. build a minimal context bundle
3. run safety and authority checks
4. choose model and prompt template by mode
5. optionally retrieve supporting evidence
6. generate answer draft
7. validate answer structure and allowed scope
8. if needed, execute approved tools with confirmation
9. store compact session memory and operator-visible audit trail

## Voice Plan

Voice is a separate interface layer.

Phase 9 voice target:
- speech to text for operator input
- text to speech for short spoken responses
- push to talk or explicit enable only

Voice safety rules:
- no always-on hidden microphone
- no silent execution from voice
- spoken actions still require visible confirmation for sensitive changes

## Page Awareness Plan

The copilot should not start with raw visual surveillance.

Correct sequence:
- first use structured page telemetry
- then use page-local state snapshots
- then only later add selective screenshot analysis for specific panels if justified

Preferred first-page signals:
- current route card
- execution truth card
- live readiness summary
- drift summary
- current account and venue
- current operator override state

## Memory Design

Short memory:
- current turn
- last few turns
- current page state

Long memory:
- operator preferences
- common explanations that worked
- recurring incidents
- calibration findings
- known safe operator workflows

Memory write rules:
- keep only compact, useful facts
- do not store secrets in plain text
- never let memory override live truth

## TXT Integration Points

Expected integration surfaces later:
- terminal
- live ops
- live readiness
- live capital
- connectors
- incidents
- calibration and journal dashboards

The same copilot core should be reused across pages.

Only the context bundle and tool visibility should change by page.

## Rollout Gate

Phase 9 opens only when all statements below are true:
- the operator can say which layer is making or losing money
- the journal explains live decisions clearly enough
- the 7j/14j table is being used consistently
- computeAttention V2 behavior is stable
- the 7-14 day calibration window is complete
- explicit no-trade and reduce-size rules are already trusted

If those conditions are not true, keep improving measurement and rules instead of adding the LLM.