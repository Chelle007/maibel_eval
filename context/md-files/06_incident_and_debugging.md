> Derived from `v2_technical_command_centre(20.03).md`. The split docs in `context/` are the current operating source of truth. The consolidated file is kept as a reference snapshot.

# 06_incident_and_debugging

## Purpose
Define how incidents and high-priority debugging should be handled during launch-stage and early live stabilization.

Use this file for incident triage, failure-domain reasoning, containment, and smallest-safe-fix planning.

## Severity Framework

### P0
- safety failure
- production outage
- broken onboarding
- corrupted state
- widespread messaging failure
- severe trust risk

### P1
- major regression in a core flow
- scheduler or trigger failure
- strong emotional mismatch in important flows
- memory or state inconsistency with user impact
- serious reliability or latency issue

### P2
- degraded but usable experience
- partial feature failure
- prompt-quality issue
- tooling or visibility gap

### P3
- cleanup
- polish
- refactor
- non-urgent improvement

## Environment Severity Modifier
Severity must be adjusted based on environment:
- `main`: highest priority because user-facing
- `staging`: important for validation, but not automatically a launch blocker
- `auto-eval`: evaluation signal only, unless it reveals a likely production issue

The same failure may be:
- P0/P1 in production
- P1/P2 in staging
- lower priority in auto-eval until confirmed

Detailed environment rules live in `10_deployment_and_validation_*.md`.

## Required Reasoning Discipline
Always separate:
- facts
- hypotheses
- risks
- unknowns

Never:
- treat symptoms as root cause
- jump into broad rewrites
- stack several risky changes into one incident fix
- assume prompts, deployment, state, and provider behavior all changed at once without evidence

## Incident Response Order
1. confirm the observed behavior
2. determine scope and user impact
3. contain blast radius if needed
4. identify likely failure domain
5. run the fastest validating checks
6. recommend the smallest safe action
7. define validation and rollback

Owner rule:
- system-truth issues default to Mabel
- experience-truth issues default to Michelle
- if both are present, Mabel owns the implementation path and Michelle supports behavior validation

## Common Failure Domains
Start by deciding whether the issue is primarily about:
- runtime truth
- experience truth

Current active incident families should be reasoned about through this working layer:
- runtime / environment truth: deploy path, environment separation, schema/runtime mismatch, and code-source uncertainty
- returning-user access / state integrity: identity reuse, row correctness, and state consistency
- re-entry continuity quality: what should persist, what should reset, and whether return feels coherent
- trust-quality grounding / attribution: false claims, lore drift, and groundedness failures
- latency: response delay as an active runtime reliability problem, not polish

Likely underlying domains still include:
- routing or orchestration
- prompt or context assembly
- persistent state
- scheduler timing
- provider behavior
- deployment or config mismatch
- cache or stale state

## Standard Response Format
- What we know
- What we do not know
- Top hypotheses
- Immediate containment
- Next checks
- Recommended action
- Validation
- Rollback

## Debugging Philosophy
Containment first.
Diagnosis second.
Remediation third.
Hardening later.

Working distinction:
- parent bug family: the reusable failure class or governing problem pattern
- evidence / example: a concrete conversation, user report, or repro that demonstrates the pattern
- task: investigation, validation, or implementation work created to move the family forward

Do not let active incident review collapse into a bug dump.
Facts stay separate from hypotheses, and runtime-truth questions stay separate from experience-truth questions unless evidence shows they are linked.

## Evaluation-Lane Rule
Use `auto-eval` only when evaluation isolation is genuinely needed.

During incident analysis:
- do not assume `auto-eval` behavior reflects production
- confirm whether the issue exists in `staging` or `main`
- treat `auto-eval` as a supporting signal, not the source of truth
- use eval evidence to help assess experience truth, not to settle runtime-truth questions by itself

Default mental model:
feature branch -> staging -> validation -> main

## Environment Identification Rule
When investigating any release, deployment, or behavior issue, first confirm which environment the observed behavior came from:
- `main`
- `staging`
- optional `auto-eval`

Then confirm:
- whether the issue is about runtime truth or experience truth
- which exact code source was exercised
- whether the observed behavior is fact, hypothesis, or inferred risk

Do not diagnose application logic until the environment and code source are clear.
