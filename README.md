# MAIBEL Eval

A Next.js app for running and evaluating test cases against the **Evren** model. It sends test cases to your Evren API, then uses **Anthropic Claude** (Haiku 4.5, `claude-haiku-4-5-20251001`, by default) as the evaluator, comparator, and for session summaries. Results are stored in Supabase and organized into sessions with summaries, optional review drafts, and version history.

## Tech stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**
- **Supabase** — auth, database (PostgreSQL)
- **Anthropic API (Claude Haiku 4.5)** — evaluation, pairwise comparison between runs, summarization, and helper text workflows
- **Tailwind CSS 4** — styling
- **TipTap / react-markdown** — rich and markdown summaries
- **xlsx** — bulk test-case import via spreadsheet upload

## Features

- **Test cases** — Single-turn and multi-turn cases with expected state/behavior, categories, notes, optional context/images, and Excel upload
- **Run evaluation** — Configure Evren base URL and model (env default + UI); run enabled cases; stream progress; optional **context pack** injection from `context/md-files` (see `CONTEXT_PACK_MANIFEST.md`)
- **Sessions** — Past runs, AI or manual session summaries (TipTap), per-case scores, **session versions** and **result snapshots**, pairwise **comparator** between versions (with optional metrics in the UI)
- **Review helpers** — Session review summary drafting/refresh, behavior-review drafts, AI-assisted comparison edits, wording refinement (server routes under `app/api/`)
- **Settings** — Default Evren URL/model and related preferences
- **Auth** — Email/password login; owner can add users and manage access

**Deletes (Supabase):** Removing a **test case** deletes its row and cascades to **eval_results** for that case. Removing a **session** deletes the session and cascades to **eval_results** and **session_result_snapshots**. Snapshot delete and session history actions use real `DELETE` on `session_result_snapshots`. **Categories** are removed permanently (no soft-delete).

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | From [Anthropic Console](https://console.anthropic.com/) — evaluator, comparator, summarizer, and related LLM routes. `CLAUDE_API_KEY` is accepted as an alias. |
| `EVREN_API_KEY` | If Evren requires API-key auth: same value as the service’s `AUTH_KEY`; sent as `x-api-key`. |
| `EVREN_AUTHORIZATION` | (Optional) Full `Authorization` header value for backends that use Bearer/OIDC (e.g. some Cloud Run setups). |
| `NEXT_PUBLIC_EVREN_API_URL` | Default Evren base URL (e.g. `http://localhost:8000`). Can be overridden in the UI. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (Settings → API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only; auth sync, add-user, protected writes) |
| `DEFAULT_USER_ID` | (Optional) Fallback user UUID when running evaluations without a logged-in user |

### 3. Database

Use a Supabase project and apply the schema in **this directory**: start with `schema.sql`, then apply `schema-migration-*.sql`, `schema-behavior-review.sql`, `schema-rls-authenticated.sql`, and other `schema-*.sql` files as needed for your environment. Tables include `users`, `categories`, `test_cases`, `test_sessions`, `eval_results`, `session_result_snapshots`, and related review/summary columns.

### 4. Run the app

```bash
npm run dev
```

This runs `next dev --webpack` (see `package.json`). Open [http://localhost:3000](http://localhost:3000). Run evaluations from the home or evaluate flow, manage test cases, and browse sessions.

## Evren API

The app calls your Evren service at a configurable base URL, using the path **`/evren-eval`** when the base URL has no path. Auth: `EVREN_API_KEY` → `x-api-key`; optional `EVREN_AUTHORIZATION`. Full request/response format and multi-turn behavior are in **[docs/evren-api-spec.md](docs/evren-api-spec.md)**.

## Environments (staging vs production)

By default, point this eval app at **staging** for Evren integration and testing. Staging is not guaranteed to match production; treat this repo as **eval-only** and validate production changes separately.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server (`next dev --webpack`) |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run lint` | ESLint |

## Project structure (high level)

- `app/` — Routes and UI: home, evaluate, test cases, sessions, settings, login
- `app/api/` — Auth, test cases (incl. upload), categories, sessions (versions, snapshots, summaries, resummarize, comparisons), evaluate/run and streaming, default-settings, refine-wording, legacy `gemini` route (calls the configured Anthropic eval model), etc.
- `lib/` — DB types, Supabase clients, Evren client, evaluator/comparator/summarizer, context pack, prompts, token-cost, behavior/session review helpers
- `content/prompts/` — System prompts for evaluator, summarizer, base
- `context/md-files/` — Organization context markdown and `CONTEXT_PACK_MANIFEST.md` for evaluator/comparator injection
- `docs/` — e.g. Evren API spec
- `schema.sql`, `schema-migration-*.sql`, `schema-*.sql` — Database schema and migrations
