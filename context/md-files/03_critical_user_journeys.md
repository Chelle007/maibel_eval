> Derived from the `05_critical_user_journeys` section in `v2_technical_command_centre(20.03).md`. The split docs in `context/` are the current operating source of truth. The consolidated file is kept as a reference snapshot.

# 03_critical_user_journeys

## Purpose
Define the user journeys that matter most for launch-stage validation and trust preservation.

## Environment Note
User journeys must be validated in the correct environment.
Do not assume a journey is broken in production based on staging or eval signals without confirmation.

Detailed environment rules live in `10_deployment_and_validation_*.md`.

## 1. Onboarding
Goal:
A new user meets Evren quickly, provides only essential setup data, and reaches a valid ready state without friction.

Must go right:
- name capture
- age capture
- country/timezone capture
- onboarding completion state
- clean transition to post-onboarding experience

Failure examples:
- too many steps
- off-brand "wellness coach" framing
- data collected but not used
- long or confusing setup
- user reaches completion but no downstream experience starts

## 2. First Post-Onboarding Experience
Goal:
The user's first follow-up experience feels intentional and alive.

Must go right:
- scheduled events seed correctly
- timing feels coherent
- the product does not go silent or duplicate messages
- Day 1 content carries the world-building, not onboarding

## 3. Normal Conversation Loop
Goal:
Evren feels emotionally present, coherent, and non-spammy.

Must go right:
- correct routing
- emotional alignment
- memory-aware replies
- reasonable pacing
- concise outputs when appropriate

## 4. Safety-Sensitive Interaction
Goal:
The system behaves safely and predictably during high-risk or heavy emotional moments.

Must go right:
- crisis signals are detected
- dangerous normal flows are suppressed
- grounding/referral behavior appears when required
- exits from elevated states happen cleanly, not prematurely

## 5. User Agency and Missions
Goal:
Evren never pushes through refusal.

Must go right:
- mission rejection is respected
- opt-outs stick
- coaching does not override distress
- user agency changes behavior immediately

## 6. Scheduled and Proactive Messaging
Goal:
Proactive messaging feels timely, appropriate, and restrained.

Must go right:
- timezone logic
- seeding logic
- no duplicate sends
- no wrong-time sends
- no proactive sends during blocked states

## 7. Memory and Continuity
Goal:
Evren feels like it remembers correctly enough to support trust.

Must go right:
- important state persists
- relevant memories are retrievable
- continuity does not contradict recent user reality
- memory supports relationship, not noise

## Failure Prioritization Rule
Failures in these journeys should be prioritized based on impact.

Highest priority:
- safety-sensitive interaction failures
- onboarding completion failures
- broken first post-onboarding experience

Medium priority:
- normal conversation loop issues
- user agency violations

Lower priority:
- minor timing issues in proactive messaging
- non-critical memory inconsistencies

If multiple journeys are affected, prioritize:
1. safety
2. onboarding
3. trust-critical interaction quality

Exception:
Any issue that materially affects user safety or trust should be escalated above its default category.
