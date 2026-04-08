# Context, Notion, and eval plan (2026-04-05)

Merged from `cursor-output/2026-04-05_meeting_insights_vs_notion_question.md`, `cursor-output/2026-04-05_meeting_insights_vs_notion_answer.md`, and the follow-up planning thread. Each section pairs **Question** and **Answer** in one file.

---

## Part 1 — Meeting insights vs Notion cards

### Question

**Context:** Analysis comparing `context/*.md`, the Notion **Task List** and **Bug Tracker**, and the Mar 31 team sync transcript.

**Ask:**

Look at the md files in `context/` AND the Notion task list database and bug database:

- What meeting insights have not been reflected in the cards yet?
- What should be updated?
- What new subtasks are needed?
- What parts are currently too human-dependent?

### Answer

**Sources:** `context/*.md`, Mar 31 transcript in `context/Team Sync Transcription 2026_03_31 14_03 GMT+08_00 – Notes by Gemini.md`, and live Notion Task List / Bug Tracker (e.g. [BUG-031](https://www.notion.so/32e4dbd113bf805ba5c4c21d24deaad4), [TASK-030](https://www.notion.so/32e4dbd113bf804d997aea28582aded7)).

#### Meeting insights not clearly reflected on cards yet

| Theme | In `context/` | In Notion today |
|--------|----------------|-----------------|
| **AI first pass** on behavior review (prefill pass/fail/N/A + rationale, not only human toggles) | Transcript; `07a_eval_operations.md` still assumes lots of human review | [TASK-020](https://www.notion.so/32e4dbd113bf80b1966cf8977d6802b0) / [BUG-031C](https://www.notion.so/32e4dbd113bf80beb678ee66d8ccec0d) describe **human** structured review, not AI prefill |
| **AI confidence** in the UI (focus on low-confidence rows) | Transcript | No matching task found in search |
| **Inject repo context** (`context/*.md`: cascade, operating brief, eval rules) into the **eval LM** so outputs are not generic | Transcript + `02_behavioral_cascade.md`, `07a_eval_operations.md` | [TASK-024](https://www.notion.so/32e4dbd113bf80cd9ab6e804b6af586f) finalizes the **human** rubric; nothing owns “sync MD → model context” for the eval app |
| **Notes prompt change**: “why this rating” / main behavioral signal / failure pattern (not vague “short context”) | Transcript | No dedicated card |
| **AI-assisted session summary** (meeting: move off heavy manual composition) | Transcript; `07a` wants decision-ready summaries | [TASK-021](https://www.notion.so/32e4dbd113bf803682e3f9836f66b24d) still lists **full evaluator-generated narrative** as **out of scope** — opposite of the meeting direction |
| **Mail/API key** so evaluation results correctly update rank/reason | Transcript checklist | No Notion hit for this |
| **Eval site ↔ Notion** (MCP): link tasks/bugs, optionally **spawn cases from bug cards** | Transcript | [TASK-013](https://www.notion.so/3294dbd113bf809c936ac9cea965eaf4) is a **user feedback** board, not eval↔Notion automation |
| **3-up version comparison** + **cleaner per-version** layout (flags + comparison notes together) | Transcript | [TASK-018](https://www.notion.so/32e4dbd113bf8016b871f7e2d5df1ec4) is **two** sessions/versions; no follow-on for 3-way + consolidated per-version UX |
| **Team model**: Mabel recenters **launch-critical / runtime / infra**; Michelle leans on **AI + rules**, less manual ops | Transcript | Repo `11_team_working_agreement.md` still reads as the **pre-shift** split; not updated for this explicit redistribution |
| **Variance / stability view** | Transcript: agreed **not** a priority right now | [BUG-031B](https://www.notion.so/32e4dbd113bf8012a98fd2fa3cbb52a0) / [TASK-019](https://www.notion.so/32e4dbd113bf8084af52e5c999c57477) still imply variance work — worth a **comment** that depth is deprioritized |

#### What should be updated (existing cards)

1. **[TASK-030](https://www.notion.so/32e4dbd113bf804d997aea28582aded7)** — “Blocked by TASK-018…023” may be **stale** relative to Notion status (e.g. TASK-018/019 **Closed**). Refresh blockers; extend review scope to **AI-assist + context injection + confidence UX** if those are now in scope for the next slice.
2. **[TASK-021](https://www.notion.so/32e4dbd113bf803682e3f9836f66b24d)** — Reconcile **out of scope** with the meeting: either narrow “narrative” vs “structured AI draft the human accepts,” or split into two tasks.
3. **[BUG-031](https://www.notion.so/32e4dbd113bf805ba5c4c21d24deaad4)** — “Done when” is still **human-centric**. Add a line or child bug for **automation layer** (prefill, confidence, doc-grounding).
4. **[TASK-022](https://www.notion.so/32e4dbd113bf80b6842edc038bfb88cc)** — Body may duplicate **session summary** (TASK-021) while title is **run metadata**; align with `07a_eval_operations.md` metadata (environment, code source, run mode, sample size, etc.).
5. **`04_current_launch_state.md`** — Dated **2026-03-24**; does not carry Mar 31 **eval automation** or **ownership shift**. Refresh or add a dated note so `context/` and Notion stay aligned.

#### New subtasks worth adding (suggested)

- **Eval LM context pack** — Which `context/*.md` files are injected; refresh cadence; max tokens; fallback when missing.
- **AI prefill: dimensions + per-dimension confidence** — Supports transcript + [BUG-031C](https://www.notion.so/32e4dbd113bf80beb678ee66d8ccec0d).
- **UI: confidence surfacing** — Badges/colors/filter “review low confidence only.”
- **Prompt workstream** — Notes: rationale + primary behavioral signal + tie to cascade when relevant (`02_behavioral_cascade.md`).
- **AI draft session summary** — Structured fields first, human edit; aligns with `07a_eval_operations.md` without claiming full autonomy.
- **Inbound mail/API** — Fix key + document env for rank/reason (transcript).
- **Spike: Notion MCP × eval** — Read bugs into eval; optional phase 2: propose test cases from bug text.
- **Comparison UX v2** — Three versions; per-version block with flags + notes (extends TASK-018).

Link under **[BUG-031](https://www.notion.so/32e4dbd113bf805ba5c4c21d24deaad4)** or a parent like **Eval automation / AI-assist**.

#### What is still too human-dependent

| Area | Why |
|------|-----|
| **Final ship / hold** | `11_team_working_agreement.md`: Mabel owns release judgment; AI can only narrow review surface. |
| **Rubric and taxonomy** | Product intent docs are source of truth; the LM only reflects injected content. |
| **Staging vs prod truth** | `04_current_launch_state.md`: promotion gate trust is still an open decision. |
| **Repeated-run rigor** | `07a_eval_operations.md`: repeated-run is not the default automated mode; evidence strength stays human-stated. |
| **Implementation** | [TASK-031](https://www.notion.so/32e4dbd113bf80dfa127fe9a3d464bae) still needs clear Michelle → team handoffs for fixes. |
| **Notion / board hygiene** | Until MCP + conventions land, what lands on cards stays manual. |

**Caveat:** Notion search may miss oddly named pages; a full filtered Task List export under “AI Behavior Eval Ops” would be a tighter inventory.

---

## Part 2 — Updated eval plan (from `context/` + Notion)

### Question

Based on `context/` and Notion:

- Propose an updated plan.
- Review the plan first.
- Break it into the smallest safe steps.
- Decide what should stay human vs become AI-assisted.

### Answer

**Grounding:** `04_current_launch_state.md`, `07a_eval_operations.md`, `02_behavioral_cascade.md`, `11_team_working_agreement.md`, and Notion spine [BUG-031](https://www.notion.so/32e4dbd113bf805ba5c4c21d24deaad4), [TASK-020](https://www.notion.so/32e4dbd113bf80b1966cf8977d6802b0)–[TASK-023](https://www.notion.so/32e4dbd113bf80ee94d3fcbd544afc99), [TASK-030](https://www.notion.so/32e4dbd113bf804d997aea28582aded7).

#### Proposed updated plan (north star)

**Goal:** Make the eval flow **decision-useful with less manual labor**, without inventing false certainty: every run still records **environment, code source, and evidence mode** per `07a_eval_operations.md`, and **ship/hold/investigate** stays a human call per `11_team_working_agreement.md`.

**Three tracks (sequenced):**

1. **Truth & hygiene** — Notion cards match reality; metadata vs summary is unambiguous; staging/production discipline stays explicit on every artifact (`04_current_launch_state.md` dependency chain).
2. **Grounding** — A small, versioned **context pack** (`context/*.md` subset) is the default “product law” the eval LM sees unless humans extend it.
3. **Assisted review** — AI **drafts** (dimensions, notes, summary, confidence hints); humans **confirm, override, and own** classification and release-facing judgment.

**Explicitly later / smaller than it sounds:** deep variance analytics (transcript: deprioritize), auto-creating Notion rows from eval (optional), any coupling of eval automation to **production** runtime paths.

#### Review of this plan (first pass)

**Strengths**

- Respects `04_current_launch_state.md`: eval outputs **state** environment and code source so evidence is not over-weighted.
- Matches `07a_eval_operations.md`: AI reduces typing, not **failure classification**, **run mode honesty**, or **escalation triggers**.
- Fits Notion: finish/clarify **BUG-031** children before expanding into “eval autonomy.”

**Risks**

| Risk | Mitigation |
|------|------------|
| AI prefill feels authoritative | Show **draft** state, model id, and **which context snapshot** was used; require explicit human accept per field or per session. |
| Context drift / wrong doc version | Treat context pack as a **named bundle** (hash or git ref in metadata). |
| Scope creep (Notion writeback) | Phase 1 Notion = **read-only spike**; no eval → Notion mutations until agreed blast radius. |
| TASK-021 vs TASK-022 duplication | Fix **card copy** and implementation boundaries before adding AI summary. |

**Dependency:** **BUG-028 / BUG-029 / BUG-030** still flow through [TASK-023](https://www.notion.so/32e4dbd113bf80ee94d3fcbd544afc99) and [TASK-031](https://www.notion.so/32e4dbd113bf80dfa127fe9a3d464bae)—AI assist does not change implementation ownership.

#### Smallest safe steps (ordered)

**A. Align execution surface (no product behavior change)**

1. Update Notion [TASK-030](https://www.notion.so/32e4dbd113bf804d997aea28582aded7): blockers vs actual statuses; add “post–Mar 31 scope: AI-assist slice” as a checklist.
2. Fix [TASK-022](https://www.notion.so/32e4dbd113bf80b6842edc038bfb88cc) body to match **Required Run Metadata** in `07a_eval_operations.md`.
3. Amend [TASK-021](https://www.notion.so/32e4dbd113bf803682e3f9836f66b24d): **long free-form narrative** stays out; **structured AI draft + human edit** is in.
4. Comment on [BUG-031B](https://www.notion.so/32e4dbd113bf8012a98fd2fa3cbb52a0): deep variance dashboard **deprioritized**; basic repeated-run grouping ([TASK-019](https://www.notion.so/32e4dbd113bf8084af52e5c999c57477)) enough for now.
5. Add dated addendum to `04_current_launch_state.md` (or refresh snapshot): eval automation in flight; **staging-as-gate** still unresolved—artifacts must label environment.

**B. Unblock data path (only if still broken)**

6. If inbound mail/API blocks rank/reason: fix keys + document env; one Notion task for traceability.

**C. Context pack (spec before code)**

7. Mabel + Michelle: agree **minimal file set** (e.g. `02_behavioral_cascade.md`, `01_product_operating_brief.md`, rubric from [TASK-024](https://www.notion.so/32e4dbd113bf80cd9ab6e804b6af586f), `07a` excerpt)—**human decision**.
8. Michelle: **Context pack manifest** (paths, purpose, max tokens, staleness rules vs consolidated v2).
9. Implement **read-only** bundle load in eval pipeline; log **bundle id** in run metadata.

**D. Prompts (small, testable)**

10. Notes prompt: **why this rating**, **primary behavioral signal**, **failure pattern**, optional **cascade layer** (P0–P3) per `02_behavioral_cascade.md`.
11. Golden before/after examples (3–5) for prompt regression checks.

**E. AI-assisted review (incremental)**

12. **Draft** pass/fail/N/A per dimension + **per-dimension confidence**; UI shows drafts; human **accept all / edit** ([BUG-031C](https://www.notion.so/32e4dbd113bf80beb678ee66d8ccec0d) intent).
13. **Structured** session summary draft (themes, det/var/unclear, trust severity, ship/hold/investigate, open questions)—human confirms.

**F. UX polish (after drafts work)**

14. Confidence **filter** (low-confidence first); optional color.
15. Comparison **v2** (3-way + per-version flags+notes) **only** if [TASK-023](https://www.notion.so/32e4dbd113bf80ee94d3fcbd544afc99) shows current UX blocks trio validation.

**G. Notion MCP (spike)**

16. Read-only: bug URL/id → title + acceptance text in eval UI or clipboard workflow.
17. Optional later: suggest test-case stubs—human promotes to real cases.

**H. Close the loop**

18. [TASK-023](https://www.notion.so/32e4dbd113bf80ee94d3fcbd544afc99) on **BUG-028 / 029 / 030** with new assists; gaps → [TASK-031](https://www.notion.so/32e4dbd113bf80dfa127fe9a3d464bae).
19. [TASK-030](https://www.notion.so/32e4dbd113bf804d997aea28582aded7) review: **approve / revise / incomplete** + linked follow-ups.

#### Human vs AI-assisted

| Item | Human | AI-assisted | Notes |
|------|--------|-------------|--------|
| **Which docs define “good behavior”** | Owns | — | Rubric/taxonomy stays human-approved; LM reflects injected pack only. |
| **Context pack contents & changes** | Approve | Can propose diffs | Mabel signs. |
| **Dimension ratings (pass/fail/N/A)** | Confirms/overrides | Draft + confidence | No auto-commit without human action at launch stage. |
| **Notes (“why this rating”)** | Edits/final | First draft | Prompt encodes behavioral signal + cascade hint. |
| **Session summary (ship/hold/investigate)** | Final | Draft structured fields | Decision-ready per `07a` without replacing judgment. |
| **Run metadata (env, commit, run mode, n)** | Enters if missing | Can prefill from CI/git where safe | Human corrects when wrong. |
| **Failure class (det / variable / unclear)** | Owns | Can suggest | Treat as hypothesis per `07a`. |
| **Promotion / ship decision** | Mabel | — | `11_team_working_agreement.md`. |
| **Implementation fixes** | Mabel (runtime lane; confirm on card) | — | [TASK-031](https://www.notion.so/32e4dbd113bf80dfa127fe9a3d464bae) handoff format; team structure per 2026-04-01 chat. |
| **Notion card creation / priority** | Humans | Read-only assist first | No silent board mutation until agreed. |
| **Variance / stability analytics** | Prioritize depth | Can summarize small samples | Deep automation not the near-term bet. |

---

## Part 3 — Michelle: next steps (team chat + Mar 31 transcript)

### Question

Based on `context/chat-history/2026-03-31_to_2026-04-05_team-chat.md` and `context/transcript/Team Sync Transcription 2026_03_31 14_03 GMT+08_00 – Notes by Gemini.md`, what’s my next step as Michelle?

### Answer

**Primary focus (Mabel’s latest in chat):** Finish and stabilize the **eval site** so it is usable for real validation—especially for **BUG-028 / BUG-029 / BUG-030**—and **do not** take on weekly board cleanup this week (Mabel owns sync/cleanup while system state shifts).

**Right after eval is “usable”:** Transcript-aligned quick wins: **mail/API** if rank/reason is blocked; **context MD → LM**; **notes prompt** (why this rating + behavioral signal); then **AI first pass + confidence**. **Deprioritize** heavy variance dashboards (you and Mabel agreed consistency is enough for now).

**Notion MCP:** Keep **read-only / investigation** first; small steps toward eval↔Notion. Do not replace Mabel’s board work this week.

**Explicitly later:** **BUG-037** (acute distress policy) is **after** eval + 028–030 trio unless reprioritized. No deploy/merge ownership from you; **staging** is the eval anchor.

**Habits:** Flag blockers early; use context markdown in agent threads; scope around heavy Saturdays.

---

## Part 4 — Detailed Priority 1: eval site “trio-ready” (+ this Q&A)

### Question

Okay, let’s start with number 1 first—make a more detailed version of it. Don’t forget to include this and the previous question and answer into `cursor-output`.

### Answer

Below is an expanded execution guide for **Priority 1** only: get the eval flow to a state where you can honestly execute something like **[TASK-023](https://www.notion.so/32e4dbd113bf80ee94d3fcbd544afc99)** against **BUG-028 / BUG-029 / BUG-030**, without scope creep into AI polish or Notion automation yet.

---

### 1.1 What “done” means for this phase

You are **not** required to finish every future idea from the Mar 31 transcript. For Priority 1, “done” means:

- You can take **representative cases** for each of the three bug families (per Mabel’s packet / Notion cards) and, in one sitting:
  - **Locate** the case and the relevant runs/sessions.
  - **Compare** versions or runs as needed (before/after or multi-version—whatever the tool already supports).
  - **Record** structured behavior dimensions (pass / fail / N/A) where the product expects them.
  - **Record** a short session-level judgment (themes, deterministic vs variable vs unclear, trust severity, ship / hold / investigate, open questions)—even if parts are still manual.
  - **Capture run metadata** that `07a_eval_operations.md` requires for a meaningful run (environment, code source, run mode, sample size, owner, date, suite/category, evaluator model if applicable).

- You can write a **short validation note** (TASK-023–style): *usable / partially usable / not yet usable* for the trio, with **specific gaps** listed (field missing, UX blocked, data not loading, etc.).

That note becomes the input for **[TASK-030](https://www.notion.so/32e4dbd113bf804d997aea28582aded7)** and any **[TASK-031](https://www.notion.so/32e4dbd113bf80dfa127fe9a3d464bae)** handoffs—not a vague “still working on it.”

---

### 1.2 Preconditions (before you judge the tool)

1. **Environment:** Confirm which backend/branch you are hitting (**staging** as integration truth for eval, per team chat and `07a`). Do not assume parity with `main` without checking.
2. **Code source:** Record commit/branch (or image/build id) on the run—you need this for any credible “this version is better” statement.
3. **Packet:** Ensure **BUG-028 / 029 / 030** definitions and example threads/cases are **one click away** (Notion + any exported snippets). If the packet is thin, note what’s missing and ask Mabel for one concrete example per family before burning time.
4. **Notion task truth:** Glance at **TASK-018–022** statuses in Notion so you are not chasing features already closed or blocked for reasons you can unblock.

---

### 1.3 Feature checklist (map to BUG-031 / tasks—verify, don’t assume)

Walk the app as a reviewer and tick **working / broken / N/A for v0**:

| Capability | Notion anchor | What to verify |
|------------|----------------|----------------|
| Before/after or multi-session comparison | [TASK-018](https://www.notion.so/32e4dbd113bf8016b871f7e2d5df1ec4) (closed in Notion—confirm in app) | Same case, two (or three) sessions/versions; outputs visible; better/worse/tie + note if present. |
| Repeated runs grouped | [TASK-019](https://www.notion.so/32e4dbd113bf8084af52e5c999c57477) | Same case run N times; easy to scan; run count obvious. |
| Six dimensions pass/fail/N/A | [TASK-020](https://www.notion.so/32e4dbd113bf80b1966cf8977d6802b0) / [BUG-031C](https://www.notion.so/32e4dbd113bf80beb678ee66d8ccec0d) | All six capturable at case/run level; no accidental duplication of session summary fields. |
| Session summary block | [TASK-021](https://www.notion.so/32e4dbd113bf803682e3f9836f66b24d) | Themes, det/var/unclear, trust severity, recommendation, open questions. |
| Run metadata | [TASK-022](https://www.notion.so/32e4dbd113bf80b6842edc038bfb88cc) | Matches `07a` list; not confused with TASK-021 body copy in Notion—**implementation** should still expose the right fields. |

If any row is **broken**, your Priority 1 work is **fix or stub** until the trio review is possible—not starting BUG-037 or board cleanup.

---

### 1.4 Validation script (do this once per bug family minimum)

For **each** of BUG-028, BUG-029, BUG-030:

1. **Pick one case** Mabel (or the packet) marks as canonical for that family.
2. **Run** (or load) the minimum sessions needed: at least one “before” and one “after” if the bug is about a fix; otherwise two comparable runs if comparison is the point.
3. **Complete** dimension review + session summary fields + metadata.
4. **Write 5 bullets:** what worked, what failed, whether failure is **tool** vs **missing case data** vs **ambiguous rule**.
5. **Stop**—do not expand to other bug families until all three have this pass.

Aggregate into one **TASK-023-style** paragraph: trio usability verdict + blockers.

---

### 1.5 Evidence to hand Mabel (for TASK-030 readiness)

- **Screenshots or short Loom** optional; minimum is **structured text**: environment, branch/commit, case ids, what you clicked, where it broke.
- **Explicit list:** “To call TASK-030 review ready, I still need: …” (max 5 items).

---

### 1.6 If blocked

| Blocker | Action |
|---------|--------|
| No clear case for a bug family | Notion comment or DM: one example thread + expected “good” behavior boundary. |
| Staging vs eval mismatch | Document; don’t silently test the wrong lane. |
| Mail/API rank-reason broken | Transcript item—treat as **Priority 1.5** if it prevents saving review outcomes; otherwise log and continue other rows. |
| Time (e.g. Saturday load) | Shrink to **one** family end-to-end + written gap list rather than three half-done. |

---

### 1.7 Out of scope for Priority 1 (do not start until 1.1 is green)

- AI prefill, confidence UI, Notion writeback, automated session summary, comparison UX v2, weekly database cleanup, **BUG-037** policy design.

Those stay in **Part 2** phases **C–G** and **Part 1** gap list until trio validation is real.

---

*Supersedes: `cursor-output/2026-04-05_meeting_insights_vs_notion_question.md` and `cursor-output/2026-04-05_meeting_insights_vs_notion_answer.md` (removed after merge).*

*Part 3–4 added: Michelle next-steps Q&A + detailed Priority 1 “trio-ready” guide + archive of this thread into `cursor-output`.*
