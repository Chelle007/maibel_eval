> Derived from `v2_technical_command_centre(20.03).md`. The split docs in `context/` are the current operating source of truth. The consolidated file is kept as a reference snapshot.

# 08_codex_collaboration_rules

## Purpose
Codex supports implementation and investigation. Human owners remain responsible for technical decisions, scope control, validation, and release judgment.

Use Codex to accelerate execution without weakening technical rigor.

## Core Rule
Plan before patching.

## Use Codex For
- locating likely code paths
- explaining current behavior
- identifying likely fix points
- proposing small diffs
- reviewing scope and regression risk
- supporting investigation of runtime behavior

## Before Any Code Change
Define:
- the exact problem
- expected behavior
- likely subsystem or file path
- smallest safe fix shape
- validation steps
- rollback path
- environment affected: `main`, `staging`, or optional `auto-eval`

## Required Coding Discipline
- investigate first
- keep scope narrow
- prefer the smallest safe fix
- review diffs before accepting changes
- avoid unrelated file changes
- avoid "while we're here" rewrites during launch stabilization

## Good Codex Request Shape
- identify the handler, service, workflow, or subsystem involved
- explain current behavior
- identify the likely cause or uncertainty
- ask for a minimal fix or focused investigation
- list affected files if known
- define validation before deployment

## Bad Codex Request Shape
- rewrite a subsystem
- refactor multiple layers while fixing one bug
- combine safety, memory, and prompt changes in one pass
- optimize infrastructure before measuring the actual bottleneck
- request implementation before clarifying intended behavior

## Review Discipline
Before accepting AI-generated work, confirm:
- no unrelated files changed
- no hidden behavior changes were introduced
- blast radius is understood
- rollback is possible
- validation is specific and focused

## Ownership Clarification
Implementation decisions must be grounded in:
- Mabel's system-level judgment
- Michelle's behavior-level validation

Codex must not assume a separate implementation owner exists.

## Behavior Validation Rule
Do not assume a change is correct because the code looks correct.

A change is only successful if:
- behavior matches intended outcome
- validation confirms the fix
- no new regressions are introduced

Code correctness without behavioral validation is not sufficient.

## Sensitive Operational Changes
Deployment, CI/CD, scheduler, secret-mapping, webhook-lifecycle, and evaluation-lane changes are operationally sensitive.

For this type of work:
- define whether the change affects `main`, `staging`, or optional `auto-eval`
- do not treat `auto-eval` as a normal source-of-truth development branch
- keep production routing explicit
- keep staging routing explicit
- ensure evaluation isolation does not create branch drift or alternate production logic
- require validation and rollback before promotion
