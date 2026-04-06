# Eval site modification plan — Cursor session playbook

**Date:** 2026-04-05 · **Repo:** `maibel_eval`  
**Purpose:** Paste into a **new Cursor chat** to implement the Mabel-aligned eval roadmap **one phase at a time**. Each section has a **single agent prompt**—run them in order; do not skip ahead unless a phase is already done.

**Related context:** `cursor-output/2026-04-05_context_notion_gap_analysis_and_plan.md`, `context/chat-history/2026-03-31_to_2026-04-05_team-chat.md`, `context/md-files/`.

---

## How to use this in a new Cursor session

1. Open the **`maibel_eval`** project root in Cursor.
2. Paste **§ Bootstrap** below as the **first message** in a new chat.
3. When the agent finishes, start a **new chat** (or continue if you prefer one long thread) and paste **only one** phase prompt: **§ Phase 0**, then **§ Phase 1**, etc.
4. **Rule:** One phase per focused session is ideal—smaller diffs, easier review.
5. After **Phase 3** and **Phase 4**, run **§ Verification** as its own message.

---

## § Bootstrap — paste this first in a new Cursor chat

```text
You are working in the maibel_eval repo (Next.js eval app for Maibel/Evren).

Ground rules:
- Implement ONLY what the user’s current message asks (one phase at a time from cursor-output/2026-04-05_eval_site_modification_plan.md unless they specify otherwise).
- Prefer the smallest safe change: match existing patterns in lib/prompts.ts, lib/evaluator.ts, lib/comparator.ts, app/api/*, app/sessions/[id]/page.tsx.
- Do not touch production Maibel runtime (langgraph-agents lives elsewhere); this repo is eval-only.
- Human judgment stays final for ship/hold and dimension ratings; AI only drafts or assists unless the phase says otherwise.
- Read the relevant files before editing. After changes, say what to test manually (no need to run the dev server unless I ask).

Acknowledge these rules and wait for my next message with the phase prompt (e.g. Phase 0 or Phase 1).
```

---

## Goals (why we’re doing this)

1. **AI drafts, human confirms** for: six behavior dimensions, structured session review, comparison confidence where useful.  
2. **Ground LLMs** with agreed `context/md-files` (“context bundle”) so outputs are Maibel-specific.  
3. **Run provenance** (staging vs prod, code source) per eval ops discipline.  
4. **Clearer review UX** (per-version scan)—not automating Mabel’s release judgment.

**Non-goals:** prod runtime changes; silent Notion writes; big variance analytics.

---

## Current state (before you start)

| Area | Today | Target |
|------|--------|--------|
| Evaluator | AI score + `reason` | + org context; prompt asks for behavioral signal / failure pattern |
| Comparator | AI comparison + human edit | + org context; later + confidence |
| `behavior_review` | Manual | AI draft + confidence + accept/edit UI |
| `session_review_summary` | Manual | AI draft + human edit + save |
| Context | `content/prompts/*.txt` only | Inject allowlisted `context/md-files` + **bundle id** |
| Run metadata | Informal | Structured fields on session |

---

## § Phase 0 — Preconditions

**Exit criteria:** DB alignment documented or migrated; context pack manifest file exists in repo; staging-as-truth note exists.

**Prompt (copy everything inside the fence):**

```text
Phase 0 only — Preconditions for maibel_eval.

1) Compare Supabase/live schema to lib/db.types.ts: confirm eval_results has columns the app expects (especially `comparison` JSONB nullable, `behavior_review` JSONB). If repo schema.sql is missing `comparison`, add a small SQL migration file under the repo (e.g. schema-migration-eval-results-comparison.sql) with ALTER TABLE ... ADD COLUMN IF NOT EXISTS comparison JSONB — document that operators must run it on Supabase if missing.

2) Add context/md-files/CONTEXT_PACK_MANIFEST.md listing: which markdown files are in v1 of the pack, max approximate token budget, and rule: “update manifest when files change; bundle id = short sha of concatenated contents or git commit of manifest + files.”

3) Add one short paragraph to README.md (or context/md-files/README.md if README is too heavy): default eval integration target is staging; do not assume staging ≡ production.

Do not implement context injection yet (that is Phase 1). Show me the diff summary and any SQL the operator must run.
```

---

## § Phase 1 — Context pack injection

**Exit criteria:** `lib/context-pack.ts` loads allowlisted files (core + optional extended), returns `{ text, bundleId }`; evaluator and comparator user/system assembly includes that text; new sessions store `bundleId` somewhere durable plus whether extended was enabled.

### Phase 1 variants (choose one)

**Option 2 (recommended) — Core + Extended toggle**

- **What**: Maintain two allowlists: a small **core** pack injected by default, and an **extended** pack that is injected only when explicitly enabled for a run/session (UI toggle or API param).
- **Why**: Keeps default evaluator/comparator prompts small and cheap, while still allowing “deep context” runs when needed.
- **Complexity**: Low–medium (small API + UI plumbing, plus storing whether extended was enabled).

**Option 4 — Light RAG via heading chunks + keyword overlap**

- **What**: Split allowlisted markdown into chunks by headings (e.g. `##`), then select top‑k chunks per test case by keyword overlap with test case fields (title/type/expected_behavior/forbidden/notes/flags). Always include the small core brief.
- **Why**: Automatic relevance filtering without embeddings/vector DB; major token savings vs injecting everything.
- **Complexity**: Medium (chunking + retrieval logic + debugging).

**Prompt:**

```text
Phase 1 only — Context pack injection for maibel_eval (Option 2 + Option 4 hybrid).

1) Implement lib/context-pack.ts with TWO allowlists (core + extended) and *retrieved + capped injection*:
   - Read from context/md-files/CONTEXT_PACK_MANIFEST.md (preferably) or constants that mirror it.
   - Core is injected by default; extended injected only when enabled.
   - Split allowlisted markdown into chunks by headings and select top chunks per test case by keyword overlap (no embeddings).
   - Hard-cap injected context size (separate caps for evaluator vs comparator) so token cost stays bounded.
   - Compute bundleId as a stable fingerprint of the *allowlisted source bundle* (core + optional extended), not the per-test-case retrieved subset (so bundleId is consistent across test cases in the same run).

2) Add a toggle to enable extended context for a run/session:
   - Smallest approach: add a boolean request param on the run/add-version APIs (e.g. `include_extended_context`), default false.
   - UI: add a checkbox/toggle on the session run/add-version flow (default off).

3) Inject ONLY the core context by default; inject extended context only when toggle is enabled:
   - Evaluator: lib/evaluator.ts / lib/prompts.ts (wherever the user message to the model is built)—append a section
     `=== ORGANIZATION CONTEXT (bundle: <id>) ===`
   - Comparator overall path: lib/comparator.ts (same pattern)

4) Persist BOTH:
   - bundleId (which allowlisted bundle was used), and
   - whether extended context was enabled (boolean)
   on test_sessions when a new session is created from the evaluate run API (app/api/evaluate/run/route.ts and stream route).
   Add DB columns if needed: `context_bundle_id` TEXT nullable and `context_extended_enabled` BOOLEAN nullable (or default false),
   plus migration SQL file(s).

5) Ensure missing files or empty core pack fails loudly in dev or logs, but don’t crash production eval without clear error.

Match existing Google AI usage and env (GEMINI_API_KEY). Do not implement Phase 2+ in this change.
```

---

## § Phase 2 — Evaluator prompt refinement

**Exit criteria:** `content/prompts/evaluator_system_prompt.txt` requires rating rationale, primary behavioral signal / failure pattern, optional cascade layer hint; JSON output shape unchanged or extended in a backward-compatible way.

**Prompt:**

```text
Phase 2 only — Evaluator prompt refinement.

Edit content/prompts/evaluator_system_prompt.txt so the model must still output the same top-level JSON keys (test_case_id, success, score, flags_detected, reason) but the `reason` instructions explicitly require:
- Paragraph 1 or dedicated sentences: why this pass/fail/score (rating rationale).
- Primary behavioral signal OR failure pattern (named, short).
- Optional: which cascade layer is most relevant (safety / distress / agency / coaching continuity) when applicable—tie language to organization context already injected in Phase 1.

Keep strict JSON; no markdown in JSON values beyond escaped newlines. If you change structure, update lib/evaluator.ts parsing only if necessary.

Do not implement behavior_review drafting (Phase 3) in this change.
```

---

## § Phase 3 — AI draft behavior_review + confidence

**Exit criteria:** API drafts validated JSON; types allow confidence; UI: Draft / Accept / Clear; saves via existing eval-results PATCH merge.

**Prompt:**

```text
Phase 3 only — AI draft for behavior_review + confidence.

1) Extend lib/behavior-review.ts: support optional per-dimension confidence (high|medium|low) per version—either nested in stored JSON or parallel map; must merge safely with existing parseVersionBehaviorReview / mergeBehaviorReviewMap. Document stored shape.

2) Add POST /api/eval-results/[id]/draft-behavior-review: load eval result + test case + evren_responses versions; call Gemini with org context pack + rubric dimension hints from BEHAVIOR_REVIEW_DIMENSIONS; return JSON draft + confidence. Do not auto-persist until user accepts in UI (or add query persist=false default).

3) In app/sessions/[id]/page.tsx: button “Draft behavior review (AI)”, show confidence next to dimensions, “Accept draft” applies to local state then existing save behavior_review to server.

Use existing default_settings for model if present. Handle missing API key with clear error.

Do not implement session_review_summary draft (Phase 4) in this change.
```

---

## § Phase 4 — AI draft session_review_summary

**Exit criteria:** `POST /api/sessions/[id]/draft-review-summary` returns SessionReviewSummaryV0; UI button fills form; user saves with existing review-summary route.

**Prompt:**

```text
Phase 4 only — AI draft for session_review_summary.

1) Add POST /api/sessions/[id]/draft-review-summary: load session + all eval_results for session (success, score, reason, comparison, behavior_review, test_cases titles). Build a compact JSON payload for the model; include context pack text.

2) Model returns JSON matching SessionReviewSummaryV0 (lib/session-review-summary.ts). Validate with validateSessionReviewSummaryV0Payload before responding.

3) UI on session page: button “Draft session review (AI)” fills sessionReviewSummary state; user edits; existing Save to /api/sessions/[id]/review-summary unchanged.

Do not implement comparison confidence UI (Phase 5) in this change.
```

---

## § Phase 5 — Comparison confidence

**Exit criteria:** Comparator returns optional overall_confidence; types + UI badge; old rows without field still render.

**Prompt:**

```text
Phase 5 only — Comparison confidence.

1) Extend lib/types.ts ComparisonData (and comparator prompts in content/prompts) so the model can return optional overall_confidence: high|medium|low (or 0–1—pick one and document).

2) Update lib/comparator.ts to parse and validate; tolerate missing field for legacy rows.

3) Session UI: show badge near comparison block for confidence when present.

Do not redesign full layout (Phase 7) in this change.
```

---

## § Phase 6 — Run metadata

**Exit criteria:** Structured JSON on test_sessions + UI to edit/save; keys align with eval ops (environment, code_source, run_mode, sample_size, models, repeated_runs_evidence).

**Prompt:**

```text
Phase 6 only — Run metadata.

1) Add run_metadata JSONB (or TEXT JSON) column to test_sessions with migration SQL file; extend lib/db.types.ts.

2) Add PATCH or include in existing session PATCH API to update run_metadata with validated object (zod or manual checks): environment, code_source, run_mode, sample_size, evaluator_model, comparator_model, summarizer_model, repeated_runs_evidence.

3) Session page: collapsible “Run metadata” form, load/save.

Do not implement Phase 7 UX redesign in this change.
```

---

## § Phase 7 — Per-version review UX

**Exit criteria:** Comparison/behavior section grouped by version (card/column): flags, comparison snippet, dimensions.

**Prompt:**

```text
Phase 7 only — Per-version review UX.

Refactor app/sessions/[id]/page.tsx comparison + behavior review presentation so each version has one scannable unit (card or column): detected flags for selected run, comparison tier/snippet for that version, six dimensions + notes.

Preserve existing behavior and API calls; improve layout only. Use collapse/accordion if needed for mobile.

Do not add new API routes in this change unless strictly required for layout.
```

---

## § Phase 8 — Ops (optional)

**Prompt:**

```text
Phase 8 only — Optional ops hooks.

Add optional field on test_sessions: linked_bug_url TEXT nullable (migration + types + small UI input). No Notion API writes.

Or: export “copy session summary for Notion” button that formats markdown to clipboard—pick one minimal option.
```

---

## § Verification — paste after Phases 3 and 4 land

```text
Verification pass for maibel_eval (Phases 1–4).

1) Trace in code: new session stores context_bundle_id (or equivalent) when created.
2) List manual QA steps: create staging comparison session, run draft behavior review, save, reload; draft session review, save, reload.
3) Grep for TODO/FIXME you introduced and resolve or list.
4) Summarize any Supabase migrations the operator must run in order.

Do not start Phase 5+ unless I ask.
```

---

## Human vs AI (do not “automate away”)

| Decision | Owner |
|----------|--------|
| Final dimension ratings | Human after AI draft |
| Ship / hold / investigate | Human |
| Context pack file list / rubric law | Mabel + Michelle |
| Runtime / promotion | Mabel |
| Model output | Always labeled draft in UI where applicable |

---

## Notion task labels (optional)

- Phases 0–2: “Context pack + evaluator prompt v2”  
- Phase 3: “AI draft behavior_review + confidence”  
- Phase 4: “AI draft session_review_summary”  
- Phases 5–7: “Comparison confidence + metadata + UX”

---

## Glossary

- **Bundle / bundle id:** The concatenated org markdown context sent to the LLM, plus a short fingerprint (hash or label) so each run records *which* context version was used.

---

*Overwrite of prior plan: same technical intent, reformatted for sequential Cursor sessions with copy-paste prompts.*
