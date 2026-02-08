"use client";

import Link from "next/link";
import { useState } from "react";

type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
};

type EvaluationResult = {
  test_case_id: string;
  success: boolean;
  score: number;
  flags_detected: string;
  reason: string;
  token_usage?: TokenUsage;
};

export default function Home() {
  const [evrenUrl, setEvrenUrl] = useState("");
  const [sheetLink, setSheetLink] = useState("");
  const [modelName, setModelName] = useState("gemini-3-pro-preview");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<EvaluationResult[] | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResults(null);
    setLoading(true);

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evren_model_api_url: evrenUrl,
          google_sheet_link: sheetLink,
          model_name: modelName || undefined,
          ...(systemPrompt.trim() && { system_prompt: systemPrompt.trim() }),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <header className="mb-10">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-800 dark:text-stone-200">
            Maibel Eval
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Run evaluations from a Google Sheet via Evren API + Gemini.
          </p>
          <Link
            href="/evaluate-one"
            className="mt-3 inline-block text-sm text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300"
          >
            Or evaluate a single test case →
          </Link>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="evren_url"
              className="block text-sm font-medium text-stone-700 dark:text-stone-300"
            >
              Evren model API URL <span className="text-red-500">*</span>
            </label>
            <input
              id="evren_url"
              type="url"
              required
              value={evrenUrl}
              onChange={(e) => setEvrenUrl(e.target.value)}
              placeholder="https://your-evren-api.com/chat"
              className="mt-1.5 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-500 dark:focus:ring-stone-500"
            />
          </div>

          <div>
            <label
              htmlFor="sheet_link"
              className="block text-sm font-medium text-stone-700 dark:text-stone-300"
            >
              Google Sheet link <span className="text-red-500">*</span>
            </label>
            <input
              id="sheet_link"
              type="url"
              required
              value={sheetLink}
              onChange={(e) => setSheetLink(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="mt-1.5 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-500 dark:focus:ring-stone-500"
            />
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              Sheet must be published to web (File → Share → Publish to web) for CSV export.
            </p>
          </div>

          <div>
            <label
              htmlFor="model_name"
              className="block text-sm font-medium text-stone-700 dark:text-stone-300"
            >
              Gemini model name
            </label>
            <input
              id="model_name"
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="gemini-3-pro-preview"
              className="mt-1.5 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-500 dark:focus:ring-stone-500"
            />
          </div>

          <div>
            <label
              htmlFor="system_prompt"
              className="block text-sm font-medium text-stone-700 dark:text-stone-300"
            >
              System prompt (optional)
            </label>
            <textarea
              id="system_prompt"
              rows={4}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Leave empty to use the default evaluator prompt from content/prompts."
              className="mt-1.5 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-500 dark:focus:ring-stone-500"
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-stone-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none dark:bg-stone-200 dark:text-stone-900 dark:hover:bg-stone-300"
            >
              {loading ? "Running…" : "Run evaluation"}
            </button>
            {loading && (
              <span className="text-sm text-stone-500 dark:text-stone-400">
                Fetching sheet → calling Evren → evaluating each row…
              </span>
            )}
          </div>
        </form>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
          >
            {error}
          </div>
        )}

        {results && (
          <section className="mt-10">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-medium text-stone-800 dark:text-stone-200">
                Results ({results.length})
              </h2>
              {(() => {
                const total = results.reduce((sum, r) => sum + (r.token_usage?.cost_usd ?? 0), 0);
                if (total > 0) {
                  return (
                    <p className="text-sm text-stone-500 dark:text-stone-400">
                      Total tokens cost: ${total.toFixed(6)} USD
                    </p>
                  );
                }
                return null;
              })()}
            </div>
            <ul className="mt-3 space-y-4">
              {results.map((r) => (
                <li
                  key={r.test_case_id}
                  className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-medium text-stone-700 dark:text-stone-300">
                      {r.test_case_id}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        r.success
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                      }`}
                    >
                      {r.success ? "Pass" : "Fail"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    Score: {r.score} · Flags: {r.flags_detected || "—"}
                  </p>
                  {r.token_usage && (
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      Tokens: {r.token_usage.prompt_tokens} in / {r.token_usage.completion_tokens} out
                      ({r.token_usage.total_tokens} total) · ${r.token_usage.cost_usd.toFixed(6)} USD
                    </p>
                  )}
                  {r.reason && (
                    <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
                      {r.reason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
