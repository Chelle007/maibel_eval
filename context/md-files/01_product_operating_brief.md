> Derived from `v2_technical_command_centre(20.03).md`. The consolidated file remains canonical for now.

# 01_product_operating_brief

## Maibel / Evren Product Operating Brief

## What this is
Maibel / Evren is an AI companion product designed for women's wellness. It is not a generic chatbot and not primarily a productivity coach. It is a stateful, emotionally aware companion system where trust and narrative continuity come first.

## Product vision
Build a safe, empathetic Telegram AI companion that users can return to voluntarily because it feels attuned, emotionally consistent, and trustworthy over time.

## Core product elements
- conversational companionship
- emotional support
- coaching prompts
- behavioral missions
- safety escalation
- memory and continuity
- proactive and scheduled interactions

## Product philosophy
- Companion-first. Coach-second.
- Connection comes before intervention.
- Safety and user agency override normal product behavior.
- Missions are suggestions, not commands.
- Silence should be respected.
- Trust matters more than feature breadth.

## Operating model
Evren is now an evergreen product:
- users can join anytime
- each user progresses independently
- progression is driven by signup timing, state, scheduled triggers, and completed interactions
- this replaces the earlier cohort-style model

## Current launch posture
The launch target is March 16, 2026 for beta.

The immediate goal is not maximal feature completeness. The goal is safe, stable, trustworthy behavior for real users, including vulnerable users.

## Deployment and validation model

Deployment, branching, and evaluation flow are defined in:

-> `10_deployment_and_validation_topology.md`

This file defines the product and behavioral intent.
Deployment logic must not be redefined here.

## Current sprint goal
Behavioral correctness and emotional consistency.

## What the sprint is trying to prove
1. Fixing safety issues should restore user trust.
2. Emotional-priority fixes should make Evren feel more attuned.
3. Output constraints should reduce "spammy" complaints.
4. The emotional hook should remain intact: daily check-ins, memory, and personality continuity.

## Non-negotiables
- no unsafe behavior in high-risk moments
- no pushing past user refusal
- no over-explaining the product during onboarding
- no noisy or spammy conversational behavior
- no broad rewrites during launch stabilization

## Decision standard
A good decision reduces risk to user trust, reduces regression risk, and improves launch readiness without creating avoidable complexity.

## Companion files and source-of-truth references

Use this file for:
- product intent
- behavioral expectations
- launch posture
- decision principles

Use companion files for detailed operating instructions:

- `09_merge_and_release_policy.md`
  release gates, blast radius thinking, merge discipline, rollback expectations

- `10_maibel_wave4_sql_runbook.md` - legacy / not yet split
  SQL read-only investigation guidance and query discipline

- `10_deployment_and_validation_topology.md`
  deployment lanes, promotion flow, staging vs production rules, optional eval isolation model

- `11_team_working_agreement.md`
  role ownership, handoff format, signoff expectations, escalation rules

- `12_prompt_templates_for_team.md`
  reusable request templates for implementation, incident review, eval interpretation, release decisions

- `14_release_checklists.md` - legacy / not yet split
  pre-merge, staging validation, production rollout, and rollback checklists

Rule:
If a detailed procedure exists in a companion file, do not duplicate it here unless it is needed as a governing principle.
