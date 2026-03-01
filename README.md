# MAIBEL Eval

A Next.js app for running and evaluating test cases against the **Evren** model. It sends test cases to your Evren API, then uses Google Gemini as an evaluator. Results are stored in Supabase and organized into sessions with summaries.

## Tech stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**
- **Supabase** — auth, database (PostgreSQL)
- **Google Generative AI (Gemini)** — evaluation and summarization
- **Tailwind CSS** — styling

## Features

- **Test cases** — Manage single-turn and multi-turn cases with expected state/behavior, categories, and optional context/images
- **Run evaluation** — Configure Evren API URL and model; run all enabled test cases; stream progress and save results to a new session
- **Sessions** — View past runs, session summaries (with optional AI summarization and manual edits), and per-case scores
- **Settings** — Persist default Evren URL and model preferences
- **Auth** — Email/password login; owner can add users and manage access

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | From [Google AI Studio](https://aistudio.google.com/apikey) — used for evaluator and summarizer |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (Settings → API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only; for auth sync and add-user) |
| `DEFAULT_USER_ID` | (Optional) Fallback user UUID when running evaluations without a logged-in user |

### 3. Database

Use a Supabase project and apply the schema under the repo root (e.g. `schema.sql` and any `schema-migration-*.sql` as needed). See `schema.sql` for tables: `users`, `categories`, `test_cases`, `test_sessions`, `eval_results`, etc.

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You can run evaluations from the home page (Evren API URL, e.g. `http://localhost:8000`), manage test cases, and view sessions.

## Evren API

The app calls your Evren service at a configurable base URL, using the path **`/evren-evals`** (appended if the base URL has no path). Full request/response format and multi-turn behavior are in **[docs/evren-api-spec.md](docs/evren-api-spec.md)**.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

## Project structure (high level)

- `app/` — Routes and UI: home (run eval), test cases, sessions, settings, login
- `app/api/` — API routes: auth, test cases, sessions, evaluate/run (and stream), default-settings, Gemini proxy, etc.
- `lib/` — DB types, Supabase client/server/admin, evaluator, summarizer, Evren client, prompts, token-cost
- `content/prompts/` — System prompts for evaluator, summarizer, base
- `schema.sql`, `schema-migration-*.sql` — Database schema and migrations
