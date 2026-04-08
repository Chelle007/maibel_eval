> Derived from `v2_technical_command_centre(20.03).md`. The consolidated file remains canonical for now.

# 11_team_working_agreement

## Purpose
Define how Mabel, Chloe, and Michelle work together during launch stabilization so ownership, handoffs, and release decisions are clear.

This document exists to reduce duplicate effort, ambiguous ownership, unclear signoff, over-scoped changes, and launch-day confusion.

## Team Roles

### Mabel
Role:
- final technical direction
- launch decision-maker
- product and trust owner
- release approval owner
- lane and prioritization owner
- manual canary / proactive judgment owner for now

Responsible for:
- deciding priorities
- defining intended behavior
- final go / no-go calls
- approving risky release decisions
- deciding whether eval isolation requires a dedicated `auto-eval` lane
- escalating user trust concerns to top priority
- final behavior direction
- sequencing work across lanes while the system is still being stabilized

### Chloe
Role:
- implementation owner for backend, orchestration, deployment, and scheduler work
- primary operator for code changes and infrastructure fixes
- owner of system truth and implementation safety

Responsible for:
- investigating implementation issues
- proposing the smallest safe fixes
- shipping narrow diffs
- documenting risks
- validating behavior after technical changes
- defining rollback shape before release
- clarifying whether eval code can safely stay outside production runtime paths
- identifying the safest implementation surface once the failure class is clear
- defining blast radius and regression risk before risky changes
- confirming what must be validated before merge or promotion

### Michelle
Role:
- experience-truth owner for AI behavior quality
- owner of behavior investigation, clustering, and rule definition

Responsible for:
- investigating behavior failures and bug families
- defining the rule the system should follow
- separating true behavior issues from likely system or state issues
- producing validation-ready recommendations before implementation
- designing and running evals
- identifying deterministic vs variable failures
- highlighting trust-impacting behavior
- assessing evidence strength from an evaluation perspective
- stating whether the eval harness requires isolation or can safely live in shared repo structure

## Decision Ownership

### Mabel decides
- release priority
- what is in scope for launch
- whether a change ships
- whether a risk is acceptable
- whether `auto-eval` is needed as an exception lane
- when user trust concerns override speed
- final behavior direction when multiple fix paths are possible
- when manual canary or proactive judgment remains human-owned

### Chloe decides
- implementation shape at the code level, within approved scope
- smallest safe fix proposal
- likely subsystem affected
- practical rollback shape
- whether deploy/runtime paths safely exclude eval-only code
- where the change should live once the behavior rule is clear
- how to contain blast radius before merge
- what technical validation is required before rollout

### Michelle decides
- whether evaluation evidence is strong, weak, or insufficient
- whether a failure is deterministic, likely variable, or not yet proven
- whether more repeated testing is needed before release
- whether the eval setup requires isolation beyond normal staging workflows
- how a behavior problem should be clustered
- what rule or boundary the AI should follow in that failure class
- whether a proposed behavior fix is specific enough to hand off for implementation

## Escalation Rules

Escalate to Mabel immediately if:
- safety gating is unreliable
- user trust may be harmed
- onboarding is broken
- staging and production behavior are unclear
- deployment routing is ambiguous
- scheduler behavior may affect real users
- data integrity or state continuity may be compromised
- the team is split on whether eval isolation needs a separate lane
- lane ownership is unclear or multiple lanes are being mixed into one patch
- a behavior tradeoff affects launch risk or proactive outreach judgment

Escalate to Chloe immediately if:
- implementation behavior does not match intended system behavior
- deployment or scheduler config appears wrong
- there is uncertainty about where the logic lives
- rollback is unclear
- eval code may be entering production runtime or deploy paths
- a behavior issue appears to have a concrete implementation surface
- the smallest safe implementation point is unclear
- latency, schema, deploy-path, or state-integrity issues are affecting live trust

Escalate to Michelle immediately if:
- behavior seems inconsistent across runs
- model tone or safety handling looks unstable
- manual testing and eval results conflict
- a bug may actually be an evaluation design issue
- the eval harness may not be testing the same code state as staging
- a "feels off" issue needs clustering before code changes
- the team cannot tell whether a failure is system-truth or experience-truth
- a proposed behavior change lacks a clear rule, boundary, or validation set

## Required Handoff Format

### Implementation Handoff
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

### Evaluation Handoff
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

### Release Handoff
- Change summary
- Environments affected
- Validation completed
- Whether `auto-eval` was used
- Known risks
- Rollback ready: yes / no
- Recommendation: ship / hold
- Exact environment and version validated

## Operating Norms
- smallest safe fix wins
- do not guess past evidence
- no hidden branch logic
- evaluation is not implementation
- production is never the experiment
- report reality, not confidence theater

## Default Workflow

### Feature Work
1. identify the lane first: system truth, experience truth, or release-risk judgment
2. define intended behavior or the rule being investigated
3. separate fact, hypothesis, and likely layer before patching
4. if behavior-focused, produce a validation-ready handoff before implementation begins
5. identify the smallest subsystem likely involved
6. implement in a feature branch
7. PR into `staging`
8. run evaluation if relevant
9. use `auto-eval` only if isolation is required
10. run manual staging testing
11. summarize evidence
12. promote to `main` only if acceptable
13. confirm validation matches the code that will be promoted

### Incidents
1. contain first
2. identify affected environment
3. identify whether the issue is system-truth or experience-truth first
4. separate fact from hypothesis
5. propose the smallest safe change
6. define validation
7. define rollback
8. only then patch

## Communication Expectations
- be concise
- be specific
- avoid vague reassurance
- do not call something fixed without validation
- do not treat "probably" as "done"
- state whether you are describing a fact
- state whether you are describing a hypothesis
- state whether you are describing a risk
- state whether you are describing an unknown

## Signoff Rules
A risky change is not ready for release until:
- implementation owner says what changed
- evaluation owner says what evidence exists
- rollback path is known
- Mabel makes an explicit ship decision

No ghost launches.
