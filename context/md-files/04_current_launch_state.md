> Derived from `v2_technical_command_centre(20.03).md`. The consolidated file remains canonical for now.

# 04_current_launch_state

## Freshness Note
This file reflects the current launch state and may become outdated quickly.

Use it as situational context, not long-term source of truth.

## Status Snapshot
- Status as of: 2026-03-24
- Current phase: post-launch stabilization
- Top objective: restore validation trust while improving whether the live product feels good enough to keep using
- Current sprint goal: runtime truth, continuity quality, and trust-preserving behavioral improvement
- Immediate blocker: staging is not yet a trustworthy promotion gate

## Current Active Focus
- runtime reliability and staging / production truth
- returning-user state integrity
- conversational continuity and follow-through quality
- trust-quality behavior, including groundedness and attribution
- validation that distinguishes system truth from experience truth
- smallest-safe-fix planning before implementation

## Important Recent Status Signals
- Safety is still non-negotiable, but it is no longer the only dominant blocker.
- The main operational blocker is now whether staging can be trusted as a promotion gate.
- Live product risk has shifted from only "can it run?" toward "does it feel good enough to keep using?"
- Runtime reliability and latency now matter directly to user trust, not just technical neatness.
- Returning-user continuity and conversational quality issues are now active product-risk lanes, not isolated oddities.
- Lane ownership is now clearer: system truth, experience truth, and launch-risk judgment are distinct responsibilities.

## Open Decisions
- what exact conditions make staging trustworthy enough to support promotion decisions
- what counts as enough validation for continuity and trust-quality fixes before promotion
- which product-risk lane should be tackled first once staging trust is restored enough to validate confidently
- how much live-user evidence is sufficient before broadening or reshaping behavior fixes

## Environment Notes
- `main`: live user environment
- `staging`: active testing environment
- `auto-eval`: evaluation-only lane, if used

Always identify which environment an issue belongs to before prioritizing or debugging.

Detailed environment rules live in `10_deployment_and_validation_*.md`.

## Current Known Issues
- staging is not yet trustworthy enough to act as a clean promotion gate
- runtime and schema truth still need to be validated before staging results can carry full decision weight
- returning-user state integrity and re-entry quality remain active trust risks
- latency and conversation-quality failures are active user-facing concerns, not watchlist polish

## Dependency Chain
1. confirm runtime truth first: environment, deploy path, schema state, and validated code source
2. separate system-truth issues from experience-truth issues before choosing an owner or fix shape
3. define the intended behavior or rule before implementation
4. choose the smallest safe validation path before a broad fix
5. update promotion and launch decisions from evidence, not intuition alone

## Related References
Team roles and ownership are defined in `11_team_working_agreement.md`.

This file reflects current state, not permanent role definitions.

## Working Rule
Do not confuse a live risk lane with a license for broad rewrites.

Staging trustworthiness is the current promotion blocker.
After that, prioritize whether the product feels reliable, continuous, and trustworthy enough for users to keep using.
