# Execution Smart 7-Day Calibration Plan

## Objective

Freeze the V7 Smart execution logic for 7 days and measure whether the smart gate improves execution quality without degrading PnL discipline.

Primary goal:
- understand the behavior of the engine in micro-live conditions

Secondary goal:
- identify the minimum calibration changes needed before any capital scaling or global sizing integration

## Operator Sequence

This is the current operator order to follow.

1. Journal d'attention contextuelle (LIVE SMALL)
2. Tableau 7j/14j
3. computeAttention V2 contextualisee
4. Calibration 7-14 jours
5. Definition des strategies microstructure
6. Strategy clustering
7. Capital flow adaptatif
8. Portfolio allocator multi-strategies
9. Vrai LLM dans Ops Copilot

Interpretation for daily work:
- phases 1 to 4 are the active execution order now
- phases 5 to 9 are explicitly downstream and must not start before phases 1 to 4 are stable and measured

Reference split:
- phases 1 to 4 = live calibration / operator loop
- phase 5 = microstructure strategy design layer
- phase 6 = strategy organization layer
- phase 7 = adaptive capital routing layer
- phase 8 = portfolio allocator layer
- phase 9 = Ops Copilot LLM layer

Operational rule:
- if the daily review is still producing new findings on phases 1 to 4, do not promote work on phases 5 to 9
- if phases 1 to 4 are stable over the validation window, then phase 5 becomes the next active track

Simple meaning of each active phase:
- phase 1 = note what the market layers are really saying at decision time
- phase 2 = compare the last 7 days and 14 days to see what is working or failing
- phase 3 = make the attention logic react to the real market context instead of fixed weights
- phase 4 = confirm with evidence that the behavior is stable before moving forward

## Ops Copilot LLM Gate

The real LLM for Ops Copilot is not the next step.

It is phase 9.

Do not add a true conversational LLM to Ops Copilot before phases 1 to 8 are validated enough to explain the system clearly.

What must be true first:
- the system must be measurable
- the operator must be able to say which layer is producing or destroying PnL
- the operator must be able to explain why a trade was allowed, reduced, delayed, or blocked
- the core no-trade rules must already be explicit and stable

Minimum validation before phase 9:
- 100 to 300 real decisions reviewed
- a full 7 to 14 day validation window
- stable behavior across the active attention and execution layers
- no major confusion in the journal about why the system acted

Rule for decision logic:
- prefer explicit rules such as: if desync + weak execution quality then NO TRADE
- do not let an LLM decide trade entry, trade exit, or risk override on its own
- the LLM may help explain, summarize, guide, and operate later, but it must not replace the calibrated decision rules

Future role of the LLM in Ops Copilot after phase 9 opens:
- persona: stable style, tone, role, and behavior
- context engine: short memory, long memory, history, and user state
- domain adapter: trading knowledge, TXT terminal knowledge, V6, RL, JEPA, and business rules
- tool layer: APIs, actions, requests, calculations, and execution helpers
- safety layer: guardrails, limits, consistency, and stability

## Freeze Rules

Do not change during the 7-day window:
- execution smart gate logic
- smart gate allow/block thresholds
- execution size multiplier mapping
- delay mapping
- venue score formula
- fill/slippage continuation guards

Allowed changes during the window:
- logging
- dashboards
- labels and visualizations
- bug fixes only if they are clearly correctness issues and not behavioral tuning

## Core Metrics

Track these every day and by venue:
- execution score
- venue score
- context score
- realized slippage bps
- realized latency ms
- fill ratio
- blocked trades count
- reduced trades count
- delayed trades count
- PnL by execution posture: clean, reduced, delayed, blocked
- positive PnL ratio

Track these by symbol when possible:
- average execution score
- average slippage
- average latency
- average fill ratio
- total blocked count
- total reduced count
- total delayed count

## Daily Routine

Daily routine scope for now:
- the daily routine applies to phases 1 to 4 only
- do not treat phases 5 to 8 as daily active build targets yet
- phases 5 to 8 should be reviewed as later architecture work, not as daily operator work

Rule for daily notes:
- write short sentences
- use plain words
- describe what happened, why it matters, and what to do next
- avoid internal code names when a simpler expression exists
- if a metric is weak, say clearly whether it means wait, reduce, block, or continue

Ultra-simple operator rule:
- before D5: no tuning
- D5-D6: paper tuning only
- after D7: micro-adjustment allowed
- after D14: strong validation or freeze again

What to do in the phase "Observe and understand":
- watch without changing the logic
- write down what the system saw at decision time
- compare what the system expected with what the market really did
- identify where the trade was helped, hurt, reduced, delayed, or blocked
- look for repeated patterns before thinking about any adjustment

Operator checklist for "Observe and understand":
- check whether the live panel reflects the real market state
- note the market context before each important decision
- note the main reason when a trade is blocked
- compare clean trades versus reduced trades versus delayed trades
- identify the weakest venue or the weakest context of the day
- say in one sentence what changed versus yesterday
- end the note with one operator action only: continue, wait, reduce, block, or prepare a paper adjustment

## Observation-Only Runtime Integrity Runbook

Use this during the baseline window only.

Observe:
- la stabilite
- la coherence
- la completude
- la prudence du systeme face au manque de data
- la qualite des refus

Ignore:
- la performance
- les scores seduisants
- les opportunites
- le PnL
- l'envie de conclure trop tot

Hard rule:
- observer la stabilite temporelle du score
- verifier sa correlation avec les gaps, la fraicheur et la completude reelles
- ne rien brancher qui influence le verdict operateur au-dela de la mesure deja en place

If a capture gap happens:
- mark it explicitly in the journal: gap de capture, reprise apres reload/login
- do not pretend the observation stayed continuous through the gap
- keep the valid block before the gap
- keep the valid block after the gap
- treat them as two separate observation segments
- restart the continuity clock from the moment the capture resumes

Interpretation rule for gaps:
- a gap does not erase the good observations already recorded
- a gap does break any claim of uninterrupted baseline continuity
- if the goal is continuity, restart from zero for continuity only
- if the goal is pattern review, quality review, or refusal review, keep the good segments and compare them separately
- after a long gap such as 1 or 2 days, do not merge before and after into one continuous block

### Diagnostic reel sur la continuite de capture

Cas observe:
- 09:31 = stop complet des captures
- reprise UI = OK
- capture locale = KO
- reload puis login = capture repartie

Cause racine retenue:
- background tab throttling du runtime navigateur
- quand la page passe en arriere-plan, les timers ralentissent, les animations s'arretent, et les callbacks sont retardes
- apres quelques minutes, les timers peuvent etre fortement degrages jusqu'a casser la boucle de capture locale

Regle critique:
- UI visible != observation active
- UI alive != capture alive
- la capture est la source de verite
- l'UI seule peut donner une illusion de reprise alors que l'observation reste arretee

Conclusion operateur:
- le systeme peut paraitre vivant tout en ayant cesse d'observer
- un terminal web n'est pas un daemon temps reel
- si la capture repart apres reload/login, il faut marquer un nouveau segment d'observation

Fix structurel a prevoir:
- ajouter un capture watchdog local
- si now - lastCaptureTs > 90s, traiter la capture comme stalled
- afficher une alerte UI du type: LOCAL CAPTURE STALLED
- propager le gap dans l'analytics avec integrityState = BROKEN et une raison local_capture_gap
- considerer capture continuity comme un signal critique de premier rang
- ajouter sur le dashboard: Observation Continuity = OK ou BROKEN
- ajouter au KPI store: captureContinuityPct et captureGapEvents
- ajouter un test E2E qui simule tab hidden puis verifie la detection du stall

Lecture operateur:
- session OK + clientId OK + capture repartie != continuite preservee
- dans ce cas: new segment start

### Incident journalise - 2026-04-18 17:57 CEST

Incident constate:
- coupure electrique locale cote poste operateur a 17:57
- trou de capture verifie entre 17:57:20 et 18:00:26 heure locale
- reprise des captures a 18:00:26 sur le meme clientId
- auth terminal revenue en mode authenticated

Lecture correcte:
- incident local poste / navigateur / alimentation
- continuite d'observation cassee
- nouveau segment d'observation a partir de 18:00:26
- ne pas fusionner ce bloc avec le segment precedent comme si la capture avait ete continue

Etat du stack au moment de la verification:
- les captures locales ont bien repris
- les conteneurs coeur Mission Control sont vus UP et healthy
- pas de signe de redemarrage global du backend a 17:57 sur cet hote

Si un autre incident survient ce soir:
- noter l'heure de fin du segment courant comme la derniere capture valide avant le nouveau trou
- ouvrir ensuite un nouveau segment a l'heure exacte de reprise des captures

### Day 1-2

Goal:
- make sure the tools and journal are recording the truth

Actions:
- check that the live panel updates when the market moves
- confirm the preview matches what really happened in the market
- confirm blocked, reduced, and delayed trades appear when expected
- make sure venue quality is not identical everywhere if the market conditions are different

Review thresholds:
- none

### Day 3-4

Goal:
- identify the main reasons trades are being hurt or blocked

Actions:
- list the main block reasons from most common to least common
- list the weakest venues by execution quality, delay, and bad fills
- compare the result of clean trades, reduced trades, delayed trades, and blocked trades
- check whether reducing size helps during stress or just hides a bigger problem

Review thresholds:
- none

### Day 5-6

Goal:
- identify only the safest possible adjustments

Actions:
- test on paper what would happen with slightly tighter or looser rules
- compare the current mix of allowed, reduced, delayed, and blocked trades with the hypothetical mix
- decide whether delay is protecting capital or simply making execution worse

Review thresholds:
- draft only, no deployment

### Day 7

Goal:
- decide whether a change is really justified by evidence

Actions:
- summarize what worked and what failed over the 7-day window
- keep only the top 3 changes with clear evidence
- reject any change that does not show a real measurable benefit

## Allowed Calibration Knobs After Day 7

Only these may move first:
- smart gate threshold
- size multiplier mapping
- delay threshold
- venue score weight
- confidence floor

Do not change at the same time:
- execution architecture
- routing logic
- adaptive learning core
- anti-overfit logic

## Decision Rules

Keep the current system frozen if:
- execution score is stable
- slippage is stable or improving
- blocked trades are explainable
- reduced trades preserve better fill/slippage than clean trades under stress

Reduce aggressiveness after calibration if:
- blocked trades are low but slippage keeps worsening
- reduced trades still lose quality
- one venue drags down the aggregate score persistently

Do not scale capital if:
- execution score drifts materially
- venue score is unstable
- delay logic causes more harm than protection
- PnL is only supported by a tiny number of lucky clean trades

## Review Template

Daily review lines, written in plain language:
- day:
- how many real cases were reviewed:
- overall execution quality:
- which venue looked strongest:
- which venue looked weakest:
- fill quality:
- delay quality:
- price paid versus expected price:
- blocked / reduced / delayed trades:
- result of clean trades:
- result of reduced trades:
- result of delayed trades:
- result of blocked trades:
- main reasons for blocking:
- what changed versus yesterday:
- operator decision for tomorrow: continue / wait / reduce / block / recalibrate

Preferred daily note example:
- day: D3
- how many real cases were reviewed: 18
- overall execution quality: acceptable but weaker than yesterday
- which venue looked strongest: Binance
- which venue looked weakest: BingX
- fill quality: correct on calm periods, weak on fast moves
- delay quality: useful in 2 cases, harmful in 3 cases
- price paid versus expected price: too expensive on breakouts
- blocked / reduced / delayed trades: 4 / 5 / 3
- result of clean trades: mixed
- result of reduced trades: safer than clean trades under stress
- result of delayed trades: often too late
- result of blocked trades: mostly good blocks
- main reasons for blocking: weak sync, unstable flow, bad fills expected
- what changed versus yesterday: more problems during fast moves
- operator decision for tomorrow: continue observation, do not loosen rules yet

## Operational Warning

At this stage, the system is not bottlenecked by missing features.

It is bottlenecked by calibration quality.

The right sequence is:
- freeze
- measure
- compare
- calibrate
- re-measure
- only then consider plugging smart execution score into the global sizing policy