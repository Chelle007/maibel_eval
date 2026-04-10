> Derived from `v2_technical_command_centre(20.03).md`. The split docs in `context/` are the current operating source of truth. The consolidated file is kept as a reference snapshot.

# 09_merge_and_release_policy

## Purpose
Define how changes are evaluated, merged, and promoted during launch stabilization so that production safety, onboarding reliability, and user trust are not accidentally compromised.

Match the merge and release process to the blast radius of the change.

## Risk Classification

### Tier 1: Low Risk
Changes unlikely to affect core production behavior.

Examples:
- copy changes
- logging adjustments
- documentation updates
- minor non-core messaging tweaks
- cosmetic fixes

Required handling:
- normal review discipline
- changed files match stated scope
- no unrelated changes included
- optional spot-check after deploy

### Tier 2: Medium Risk
Operational logic changes that could disrupt entry flows, session continuity, or important product behavior.

Examples:
- onboarding flow
- access gating
- token validation
- report submission flow
- scheduler timing
- callback handling
- post-onboarding first response
- session state handling

Required handling:
- scope reviewed carefully
- changes remain narrow
- validation steps defined before merge
- smoke test required before user exposure

### Tier 3: High Risk
Core behavioral or safety logic changes that could break trust or product stability.

Examples:
- safety gating
- P0/P1 escalation logic
- orchestrator routing
- memory persistence
- state-machine transitions
- emotional response prompts
- core orchestration and safety modules

Required handling:
- full diff inspection
- scope must match claimed fix
- validation required before rollout
- rollback path confirmed before release

## Environment Risk Modifier
Risk must be interpreted in context of environment:
- `main`: highest risk, user-facing
- `staging`: pre-production validation
- `auto-eval`: evaluation-only, not user-facing

The same change may be higher risk in production than in staging or eval.

Detailed lane definitions live in `10_deployment_and_validation_topology.md`.

## Review Discipline
Before merge, confirm:
- changed files match the described fix
- no unrelated modules are included
- blast radius is understood
- validation is defined
- rollback is possible

## Launch-Stage Merge Rules

### 1. No Unrelated Changes
Launch fixes must be surgical.
Do not merge hotfix branches that also include deploy edits, database migrations, unrelated UX changes, or opportunistic refactors.

### 2. Merge Does Not Equal Release
Merged code must still pass release validation.
Deployment alone is not considered success.

### 3. Avoid Stacking Risky Merges
Validate one risky change before introducing another, unless multiple changes are required to resolve the same blocking issue.

### 4. Protect Onboarding Reliability
Onboarding breakage is launch-blocking.
Avoid merges that increase entry-flow risk unless the change is directly fixing onboarding.

### 5. Prefer Containment Over Perfection
During launch stabilization, ship the smallest safe fix and defer non-blocking improvements.

### 6. Keep Deployment and Evaluation Lanes Separate
- `main` is production only
- `staging` is the pre-production integration lane
- `auto-eval` is evaluation-only and never a source of truth
- evaluation isolation must not create branch drift or alternate production logic

### 7. Contributor Engineering Flow
Default flow for contributor work:
fix
-> `git status`
-> `git diff`
-> commit
-> push
-> open or update PR
-> validate in `staging`
-> only then consider promotion to `main`

Required verbal checks:

Before every PR:
- base = ?
- compare = ?

Before every push:
- `git branch --show-current`
- `git log --oneline -1`
- then `git push -u origin HEAD`

## Release Flow For Tier 3 Changes

Default flow:
feature branch
-> PR to `staging`
-> evaluation on staging code or staging deployment
-> manual testing on staging bot
-> PR `staging` to `main`
-> production deploy
-> production smoke test

Exception, if eval isolation is required:
feature branch
-> PR to `staging`
-> refresh `auto-eval` from `staging`
-> run isolated evaluation
-> manual testing on staging bot
-> PR `staging` to `main`
-> production deploy
-> production smoke test

If validation fails before production promotion, rollback or hold.

## Founder Merge Gate Checklist
Before merging, confirm:
- scope matches the described fix
- risk tier is identified
- issue is real or reproducible
- change is necessary for launch
- safety and trust are not compromised
- rollback is possible

## Quick Reference

| Situation | Tier | Required action |
| --- | --- | --- |
| Copy or logging change | Tier 1 | Normal review |
| Onboarding or scheduler logic | Tier 2 | Merge only with validation |
| Safety or orchestrator logic | Tier 3 | Validate before rollout |
| Multiple risky merges | Tier 3 | Pause and verify |
| Onboarding reliability affected | Tier 3 | Treat as launch blocker |

## Operational Intent
This policy exists to prevent priority inversion in production decisions.

Code velocity must not override:
- safety behavior
- onboarding reliability
- emotional trust
- production stability
