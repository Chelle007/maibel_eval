> Derived from `v2_technical_command_centre(20.03).md`. The consolidated file remains canonical for now.

# 07a_eval_operations

## Purpose
Define how evaluations are run, labeled, and summarized for launch-stage decision-making.

This file explains eval operations.
The eval platform remains the source of truth for raw cases, run settings, session history, and detailed results.

## Eval System Scope
This file defines current eval operating rules.
Do not use it to duplicate the full case inventory or app-level product documentation.

The eval platform may include:
- single-turn test cases
- multi-turn conversation tests
- category-based suites
- evaluator and summarizer settings
- stored run history
- manual repeated-run comparisons where needed

## Eval Categories
Maintain the current operational categories in the eval system.
At minimum, the active categories should cover:
- safety gating
- emotional attunement / distress handling
- user agency and refusal handling
- onboarding and first-run experience
- proactive / scheduler behavior
- memory and continuity
- false-positive normal-chat coverage
- regression coverage for behavior fixes

Michelle owns the detailed taxonomy in the eval system.
This file should stay at the rule level, not the raw case level.

## When To Run Evals
Run evals when:
- a high-risk behavioral fix lands
- safety logic changes
- prompt logic materially changes
- routing or orchestration changes
- onboarding behavior changes
- before promotion decisions for risky changes
- nondeterminism is suspected
- a trust-quality fix needs stronger evidence than a one-off chat read

## Run Modes

### Single-Run Validation
Use when:
- confirming a narrow fix
- checking a deterministic bug
- smoke-testing a known flow

Current practice:
- this is the default automated mode in the current eval workflow

### Repeated-Run Validation
Use when:
- nondeterminism is suspected
- behavior is inconsistent across runs
- safety or trust-sensitive behavior needs stronger evidence

Current practice:
- repeated-run is currently manual, not the default automated mode
- reviewers compare a small number of repeated outputs directly
- confidence should be stated lower when repeated-run evidence is not available

### Multi-Turn Validation
Use when:
- continuity matters
- user state changes across turns
- refusal, escalation, or drift emerges over time
- first-run or onboarding experience spans multiple steps

## Required Run Metadata
Every meaningful eval run should record:
- session title or ID
- date
- owner
- environment tested
- exact code source tested
- evaluator model
- summarizer model if used
- suite or category tested
- whether the run was single-run, repeated-run, or multi-turn
- sample size or run count
- whether repeated-run evidence was manual or automated

## Failure Classification
Label failures as:
- deterministic
- likely variable
- unclear / needs more evidence

Also record severity:
- safety-critical
- trust-critical
- moderate
- minor

Working note:
- `FP_Normal` is currently a working baseline, not a mature benchmark
- do not overstate confidence from a small false-positive suite

## Immediate Escalation Triggers
Escalate immediately if:
- a deterministic P0/P1 failure appears
- user refusal is overridden
- distress is mishandled in a trust-breaking way
- repeated-run results show unstable behavior in a critical flow
- staging behavior and eval evidence materially disagree in a high-risk area
- confidence is being overstated relative to the actual run mode or sample size

## Output Artifact
Each meaningful eval run should produce a short summary containing:
- goal
- environment and code source
- suites/cases run
- pass/fail summary
- deterministic vs variable findings
- highest-risk failures
- recommendation: ship / hold / investigate

Important runs should be translated into a short decision-ready summary, not only stored as raw run history.

Use the eval summary template for this.

## Working Rule
Use evals to improve decision quality, not to create false certainty.
Do not overstate weak evidence.
Do not redesign architecture based on fear alone.
State confidence in line with actual run mode, evidence strength, and current workflow reality.
