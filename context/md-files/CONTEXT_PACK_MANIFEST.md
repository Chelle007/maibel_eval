---
title: "Maibel Eval — Context Pack Manifest"
version: v1
purpose: "Allowlist + budget for organization context injected into evaluator/comparator prompts."
---

## Core allowlist

Always injected by default (keep small and high-signal).

- `01_product_operating_brief.md`
- `02_behavioral_cascade.md`

## Extended allowlist

Injected only when explicitly enabled for a run/session (may be large).

- `AGENTS.md`
- `03_critical_user_journeys.md`
- `04_current_launch_state.md`
- `06_incident_and_debugging.md`
- `07_metrics_and_evidence.md`
- `07a_eval_operations.md`
- `08_codex_collaboration_rules.md`
- `09_merge_and_release_policy.md`
- `10_deployment_and_validation_topology.md`
- `11_team_working_agreement.md`
- `12_prompt_templates_for_team.md`
- `index.md`

## Approx token budget (guideline)

- **Max target (core)**: ~5–10k input tokens (ballpark).
- **Max target (core + extended)**: ~30k input tokens (ballpark).

## Bundle id rule

Whenever any allowlisted file changes, update the manifest (or bump version) and treat the pack as a new bundle.

- **bundle id definition**: short sha of the concatenated injected body (or a git commit that includes the manifest + allowlisted files).
- **recommended**: `sha256(utf8(concatenated_body))`, first 12 hex chars.

