> Derived from `v2_technical_command_centre(20.03).md`. The consolidated file remains canonical for now.

# 10_deployment_and_validation_topology

## Purpose
Define the valid deployment, validation, and promotion flow during launch stabilization.

This file exists to remove ambiguity around:
- which branch deploys where
- which environment is used for what
- where evaluation happens
- what must pass before production promotion
- when an eval-isolation lane is allowed
- what must never become a production path

## Default Branch Model
Default model:
- `main` = production only
- `staging` = integration and manual testing lane

Use this by default unless evaluation code cannot safely live outside production runtime and deploy paths.

## Optional Eval-Isolation Lane: `auto-eval`
`auto-eval` is allowed only when evaluation isolation is genuinely needed.

Use `auto-eval` only if:
- eval harness code includes logic that should not ship to production
- eval code introduces instrumentation, dependencies, hooks, or execution paths not trusted in production
- eval code cannot be safely isolated through file structure, workflow design, packaging, or runtime exclusion

If used:
- refresh it from `staging` before meaningful eval use
- never treat it as a source of truth
- never merge it into `main`
- do not let it contain production logic changes absent from `staging`
- use it only to isolate evaluation execution

## Decision Rule

### Use 2 branches only: `main` + `staging`
Use this if:
- eval code is isolated to dedicated scripts or folders
- eval code does not affect production runtime behavior
- eval code is not imported by production code paths
- eval code can be safely excluded from deploy packaging or workflow execution

### Use 3 lanes: `main` + `staging` + `auto-eval`
Use this only if:
- eval code cannot safely coexist in the shared repo without production risk
- there is real concern that eval-only code could leak into runtime or deploys
- the team can keep `auto-eval` refreshed from `staging`

## Canonical Release Lanes

### `main`
Production only.
- deploys production only
- must stay stable and boring
- receives code only after staging validation is complete
- must never be used for experimentation

### `staging`
Integration and manual testing lane.
- all new implementation work must pass through here before production
- this is the only pre-production integration truth
- used for integrated validation, staging bot testing, and pre-production smoke tests

### `auto-eval` if used
Evaluation-only lane.
- exists only when eval isolation is required
- must be refreshed from `staging`
- must never become a release source
- must not be used to author production logic

## Canonical Promotion Flow

### Default flow
feature branch
-> PR into `staging`
-> evaluation on staging code or staging deployment, where relevant
-> manual testing via staging bot
-> if acceptable, PR `staging` into `main`
-> production deploy
-> production smoke test

### Exception flow when `auto-eval` is required
feature branch
-> PR into `staging`
-> refresh `auto-eval` from `staging`
-> run isolated evaluation
-> manual testing via staging bot
-> if acceptable, PR `staging` into `main`
-> production deploy
-> production smoke test

Important:
- `staging` remains the only pre-production integration truth
- `auto-eval` is never a promotion source

## Environment Rules
When diagnosing behavior or deployment issues:
- always identify the environment first: `main`, `staging`, or `auto-eval`
- do not assume staging or eval behavior reflects production
- do not treat `auto-eval` results as user-facing truth
- confirm whether the issue exists in `staging` before considering production impact
- do not treat a green deploy as proof that staging is trustworthy for promotion decisions

### Production
- deploys only from `main`
- uses production secrets only
- uses production bot only
- production scheduler jobs run only from production configuration
- production must not depend on eval-only infrastructure

### Staging
- deploys only from `staging`
- uses staging secrets only
- uses staging bot only
- staging scheduler jobs run only from staging configuration
- manual testing must target staging, not production

### Auto-eval if used
- evaluates the staging version through an isolated lane or environment
- must not become an alternate production deploy path
- must not become an independent release source
- must not bypass `staging` as source of truth

## Validation Gates
A change is eligible for production only if all relevant conditions are true:

### 1. Staging Is Trustworthy Enough To Validate
Before `staging` can be treated as a trustworthy promotion gate, confirm:
- deploy path is validated
- staging / production isolation is confirmed
- schema and runtime parity are confirmed
- intended code source is verified
- critical staging validation has passed

### 2. Integration Complete
- intended code is present in `staging`
- no unresolved merge or environment drift is known

### 3. Evaluation Passes When Required
- evaluation runs against the intended staging version
- failures are reviewed
- deterministic failures are resolved before promotion
- risky nondeterministic behavior is explicitly reviewed

### 4. Manual Staging Testing Passes
- staging bot behavior is acceptable
- critical user journeys were checked where relevant
- no blocking trust or safety regression is observed

### 5. Release Decision Is Explicit
- ship / no-ship decision is made deliberately
- promotion to `main` is intentional, not automatic

## Non-Negotiables
- `main` is production only
- `staging` is the only pre-production integration truth
- `auto-eval` is optional, not default
- if used, `auto-eval` is evaluation-only and disposable
- `auto-eval` is never merged into `main`
- production logic must not be developed directly on `auto-eval`
- no alternate branch may become a shadow source of truth
- production rollout happens only after required validation passes

## Prohibited States
The following are not allowed:
- direct experimentation on `main`
- shipping code never integrated into `staging`
- treating `auto-eval` as a normal long-lived development branch
- merging `auto-eval` into `main`
- allowing eval-only changes to drift away from `staging`
- unclear ownership of whether failing behavior came from `staging`, `auto-eval`, or `main`

## Operating Principle
Prefer the simpler mental model:
feature branch -> staging -> validate -> main

Use `auto-eval` only when evaluation isolation is genuinely needed.

`auto-eval` is a support lane, not another kingdom.

Green deploy does not equal trusted validation environment.
`staging` remains the only pre-production integration truth, but only once trustworthiness conditions are met.
