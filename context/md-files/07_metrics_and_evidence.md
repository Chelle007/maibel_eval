> Derived from `v2_technical_command_centre(20.03).md`. The consolidated file remains canonical for now.

# 07_metrics_and_evidence

## Purpose
Define how Maibel / Evren measures trust-relevant quality and how evidence should be interpreted for launch-stage decisions.

This file is decision-level guidance.
It does not store raw eval runs, full test inventories, or detailed evaluator prompts.

## Primary Launch Lens
Trust + return.

This product should not be evaluated only like a SaaS funnel. The strongest early signals are behavioral and relational.

## Core Metrics

### Voluntary Return Conversation Rate
Definition:
The percentage of users who initiate a later conversation without being prompted.

Why it matters:
Strong trust and emotional-engagement signal.

### Conversation Depth
Definition:
Average number of messages per session.

Why it matters:
Directional signal for engagement and attunement, not a standalone success metric.

### Mission Completion Rate
Definition:
Percentage of users who complete a meaningful behavioral action.

Why it matters:
Useful activation signal, but must never be optimized at the expense of trust or user agency.

### Complaint Reduction Signals
Track reduction in:
- spammy complaints
- emotionally off-tone complaints
- unsafe or unsettling behavior complaints
- repeated or pushy behavior complaints

### Safety Reliability Evidence
Track:
- pass/fail behavior on key P0/P1 cases
- consistency across repeated runs
- deterministic vs intermittent failures
- whether fixes reduce both false positives and dangerous misses

## Evidence Categories
Interpret evidence through two different lenses:

Runtime-truth evidence:
- live production behavior and user impact
- validated staging behavior, if staging is currently trustworthy
- deploy-path, isolation, schema/runtime, and code-source checks

Experience-truth evidence:
- live production chat evidence and real user feedback
- multi-turn review of behavior in context
- repeated-run eval evidence when available
- single-run eval or manual reviewer observations

Lower-confidence inputs:
- one-off observations without supporting evidence
- anecdotal concern without traceable support
- intuition without evidence

## Evidence Hierarchy
Use the right hierarchy for the question being asked.

For runtime-truth questions:
1. production behavior and user impact
2. validated staging behavior, once staging trustworthiness is established
3. deploy/config/schema/code-source verification
4. one-off staging observations
5. intuition without evidence

For experience-truth questions:
1. live production chat evidence with clear user impact
2. multi-turn review and repeated-run evidence, when available
3. validated staging behavior in relevant user journeys
4. single-run evals or one-off reviewer observations
5. intuition without evidence

## Confidence Framing
- deterministic failures are strong evidence
- repeated variable failures are meaningful risk, not noise
- repeated-run is stronger evidence when available, but it is currently manual
- low sample size reduces confidence in both positive and negative conclusions
- one-off failures require investigation before major redesign
- conflicting signals between manual testing, live chat evidence, and evals require deeper investigation

Current confidence rule:
- state lower confidence when staging trust is incomplete
- state lower confidence when evidence comes from single-run only
- state lower confidence when live-user sample size is still small, even if the signal feels important

## Decision Thresholds

### Evidence Enough To Ship
Evidence supports progress when:
- no known deterministic safety failure remains in critical flows
- staging trust is high enough for the decision being made: deploy path validated, staging/prod isolation confirmed, schema/runtime parity confirmed, intended code verified, and critical staging validation passed
- trust-impacting behavior is acceptable in the relevant critical user journeys
- continuity-quality or trust-quality fixes have more than a one-off positive read when the risk level calls for stronger evidence
- repeated-run or multi-turn evidence is used where variance matters, with manual repeated-run called out honestly when that is the current reality
- no unresolved conflict exists between live evidence, staging validation, and eval evidence

### Evidence Means Hold
Hold when:
- deterministic safety failures remain
- staging is not yet trustworthy enough to support a promotion decision
- trust-breaking behavior is still visible in critical flows
- continuity or trust-quality failures remain strong enough that users are unlikely to keep using the product confidently
- repeated-run or multi-turn evidence shows unacceptable instability in a safety- or trust-critical case
- production/staging/eval evidence materially conflicts without explanation

### Evidence Means Investigate More
Investigate further when:
- failures appear intermittent but meaningful
- sample size is too small to trust the result
- results improved, but only in one environment or one run shape
- manual observations, live chat evidence, and evaluator results disagree
- staging appears healthier, but runtime-truth checks are still incomplete
- a change looks good experientially, but only under single-run evidence so far

## Metric Misuse Warning
Metrics must not be optimized in ways that degrade trust.

Examples of misuse:
- increasing conversation depth by forcing longer interactions
- increasing mission completion by ignoring user resistance
- increasing return rate through spammy or intrusive nudges

If a metric improves while complaints increase or trust signals degrade, treat it as a regression.

## Environment Rule
Evidence must always be interpreted in context of environment:
- `main`: highest-confidence user-facing signal
- `staging`: validation signal, but only high-confidence once staging trustworthiness conditions are met
- `auto-eval`: controlled evaluation signal, not user-facing

Detailed execution rules live in `07a_eval_operations.md` and environment topology lives in `10_deployment_and_validation_*.md`.
