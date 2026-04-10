> Derived from `v2_technical_command_centre(20.03).md`. The split docs in `context/` are the current operating source of truth. The consolidated file is kept as a reference snapshot.

# 12_prompt_templates_for_team

## Purpose
Provide reusable prompt templates so planning, investigation, evaluation, and implementation requests stay narrow, consistent, and decision-useful.

These templates are meant to reduce:
- vague asks
- over-scoped implementation
- missing validation
- muddy handoffs
- false confidence

## Environment Rule
Every prompt must specify the environment context:
- `main` (production)
- `staging` (pre-production)
- `auto-eval` if used

Do not assume behavior is production unless explicitly stated.

## 1. Investigate Before Patching
Use when:
- root cause is unclear
- behavior may have multiple causes
- patching too early could widen blast radius

Template:
Ask:
- what environment is affected: `main`, `staging`, or `auto-eval`
- what the exact observed behavior is
- what the intended behavior is
- what is fact vs hypothesis vs unknown
- the top likely layers or subsystems involved
- the fastest validating checks
- the smallest safe next step before patching

## 2. Smallest Safe Fix
Use when:
- likely subsystem is known
- you want a narrow implementation proposal

Template:
Ask for:
- the smallest safe fix shape
- likely files or modules involved
- expected blast radius
- validation steps
- rollback path
- any reason not to patch yet

## 3. Diff Review for Blast Radius
Use when:
- a diff already exists
- you want a risk review before merge

Template:
Ask for:
- a scope check against the stated problem
- unrelated file changes, if any
- likely blast radius
- regression risk
- missing validation
- rollback readiness
- merge recommendation: safe / risky / hold

## 4. Deployment / CI Change Prompt
Use when:
- touching workflows
- changing deploy routing
- changing bot/webhook behavior
- changing scheduler config

Template:
Ask:
- which environment is affected
- what routing or workflow behavior changes
- whether production paths are touched
- what can break if this is wrong
- how to validate after deploy
- how to roll back cleanly

## 5. Eval Isolation Decision Prompt
Use when:
- deciding whether evaluation requires `auto-eval`
- choosing between 2-branch and 3-lane model

Template:
Ask:
- whether eval code touches production runtime or deploy paths
- whether file structure or packaging can isolate eval safely
- whether `staging` can remain the integration truth
- whether `auto-eval` is genuinely needed
- recommendation: stay with 2 branches or use 3 lanes, with reason

## 6. Eval Interpretation Prompt
Use when:
- eval results exist
- repeated runs show mixed outcomes
- ship guidance is needed

Template:
Ask for:
- environment and exact code source evaluated
- run mode used: single-run, repeated-run, or multi-turn
- sample size and confidence level
- what passed
- what failed
- deterministic vs variable findings
- highest trust or safety risk
- recommendation: ship / hold / investigate
- what must be resolved before promotion

## 7. Incident Triage Prompt
Use when:
- something is broken live
- user trust could be affected
- containment is needed first

Template:
Ask for:
- affected environment
- immediate user impact
- containment first step
- what is fact vs hypothesis
- whether this is system-truth or experience-truth
- top hypotheses
- next checks
- smallest safe action
- validation and rollback

## 8. Implementation Handoff Prompt
Use when:
- handing implementation work to Codex or another engineer

Template:
- Problem
- Intended behavior
- What we know
- Top hypothesis
- Smallest safe fix
- Files changed or likely files
- Risks
- Validation steps
- Rollback
- Environment affected

## 9. Evaluation Handoff Prompt
Use when:
- handing a behavior or repeated-run review request to Michelle or another evaluator

Template:
- Goal of the eval
- Cases tested
- Whether eval ran on staging directly or via isolated eval lane
- What passed
- What failed
- Deterministic vs variable findings
- Trust risk
- Recommendation
- What still needs confirmation
- Environment affected
- Exact code source evaluated
- If behavior-focused: rule or boundary being validated

## 10. Manual Testing Plan Prompt
Use when:
- you want a focused staging test plan

Template:
Ask for:
- the exact user journey or risk area to test
- setup state and environment
- step-by-step test actions
- expected behavior at each step
- pass / fail criteria
- what to capture if behavior diverges

## 11. Release Go / No-Go Prompt
Use when:
- deciding whether to promote from staging to main

Template:
Ask for:
- change summary
- environments affected
- validation completed
- whether `auto-eval` was used
- known risks
- rollback readiness
- recommendation: ship / hold
- exact environment and version validated

## 12. Full Engineering Flow Prompt
Use when:
- you want the full contributor workflow spelled out before changes or release work
- you want commit / push / PR / validation / rollout steps checked explicitly

Template:
Ask:
- Walk me through the full engineering flow including commit, push, PR, validation, and rollout.
- confirm the intended branch flow before changing anything
- confirm `base = ?` and `compare = ?` before opening or updating a PR
- confirm `git branch --show-current` and `git log --oneline -1` before push
- then use `git push -u origin HEAD`
- confirm staging validation before considering `main`
- do not proceed if any step is unclear or unverified

## 13. Behavior Failure Analysis Prompt
Use when:
- a specific conversation or response failed
- you want root cause across system layers

Template:
Ask:
- what the user said
- what the system did
- what the intended behavior was
- whether the failure is mainly system-truth or experience-truth
- likely layer: prompt, orchestration, memory/state, routing, or runtime
- what rule or boundary was violated
- similar failure pattern, if any
- smallest safe fix direction
- validation set needed after the fix

## Usage Notes
- prefer the narrowest template that matches the task
- state the environment clearly
- state the intended behavior before asking for code changes
- ask for rollback before merge on risky work
- ask for evidence summary before making ship decisions
- ensure validation is performed on the same code and environment that will be promoted

If a prompt is getting long, the scope is probably wrong.
