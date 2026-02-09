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
  /** Evren’s reply and flags (from evaluate-one API). */
  evren_response?: string;
  detected_flags?: string;
};

const inputClass =
  "mt-1.5 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-500 dark:focus:ring-stone-500";
const labelClass =
  "block text-sm font-medium text-stone-700 dark:text-stone-300";

export default function EvaluateOnePage() {
  const [evrenUrl, setEvrenUrl] = useState("http://localhost:8000");
  const [testCaseId, setTestCaseId] = useState("");
  const [inputMessage, setInputMessage] = useState("");
  const [imgUrl, setImgUrl] = useState("");
  const [context, setContext] = useState("");
  const [expectedFlags, setExpectedFlags] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");
  const [forbidden, setForbidden] = useState("");
  const [modelName, setModelName] = useState("gemini-1.5-pro");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EvaluationResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const res = await fetch("/api/evaluate-one", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          test_case: {
            test_case_id: testCaseId,
            input_message: inputMessage,
            ...(imgUrl.trim() && { img_url: imgUrl.trim() }),
            ...(context.trim() && { context: context.trim() }),
            expected_flags: expectedFlags,
            expected_behavior: expectedBehavior,
            ...(forbidden.trim() && { forbidden: forbidden.trim() }),
          },
          evren_model_api_url: evrenUrl.trim(),
          ...(modelName.trim() && { model_name: modelName.trim() }),
          ...(systemPrompt.trim() && { system_prompt: systemPrompt.trim() }),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      setResult(data);
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
          <Link
            href="/"
            className="text-sm text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300"
          >
            ← Back to run batch
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-800 dark:text-stone-200">
            Evaluate one
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Run Evren on the test case, then evaluate the response with Gemini.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-8">
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Evren API
            </h2>
            <div className="mt-4">
              <label htmlFor="evren_url" className={labelClass}>
                Evren model API URL <span className="text-red-500">*</span>
              </label>
              <input
                id="evren_url"
                type="url"
                required
                value={evrenUrl}
                onChange={(e) => setEvrenUrl(e.target.value)}
                placeholder="http://localhost:8000"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                We will POST to /evren with input_message (and optional context, img_url).
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Test case
            </h2>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="test_case_id" className={labelClass}>
                  Test case ID <span className="text-red-500">*</span>
                </label>
                <input
                  id="test_case_id"
                  type="text"
                  required
                  value={testCaseId}
                  onChange={(e) => setTestCaseId(e.target.value)}
                  placeholder="e.g. TC-001"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="input_message" className={labelClass}>
                  Input message <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="input_message"
                  rows={2}
                  required
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="User's text input"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="img_url" className={labelClass}>
                  Img URL (optional)
                </label>
                <input
                  id="img_url"
                  type="url"
                  value={imgUrl}
                  onChange={(e) => setImgUrl(e.target.value)}
                  placeholder="https://..."
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="context" className={labelClass}>
                  Context (optional)
                </label>
                <textarea
                  id="context"
                  rows={2}
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="Past interaction context"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="expected_flags" className={labelClass}>
                  Expected flags <span className="text-red-500">*</span>
                </label>
                <input
                  id="expected_flags"
                  type="text"
                  required
                  value={expectedFlags}
                  onChange={(e) => setExpectedFlags(e.target.value)}
                  placeholder="e.g. emotional_distress_flag = true"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="expected_behavior" className={labelClass}>
                  Expected behavior <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="expected_behavior"
                  rows={2}
                  required
                  value={expectedBehavior}
                  onChange={(e) => setExpectedBehavior(e.target.value)}
                  placeholder="e.g. Emotional mirroring, then one gentle check-in"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="forbidden" className={labelClass}>
                  Forbidden (optional)
                </label>
                <input
                  id="forbidden"
                  type="text"
                  value={forbidden}
                  onChange={(e) => setForbidden(e.target.value)}
                  placeholder="e.g. Advice, fixing, images"
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Options
            </h2>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="model_name" className={labelClass}>
                  Gemini model name
                </label>
                <input
                  id="model_name"
                  type="text"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="gemini-1.5-pro"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="system_prompt" className={labelClass}>
                  System prompt (optional)
                </label>
                <textarea
                  id="system_prompt"
                  rows={3}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Leave empty to use default evaluator prompt"
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-stone-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none dark:bg-stone-200 dark:text-stone-900 dark:hover:bg-stone-300"
            >
              {loading ? "Calling Evren, then evaluating…" : "Evaluate"}
            </button>
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

        {result && (
          <section className="mt-10">
            <h2 className="text-lg font-medium text-stone-800 dark:text-stone-200">
              Result
            </h2>
            <div className="mt-3 rounded-lg border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-medium text-stone-700 dark:text-stone-300">
                  {result.test_case_id}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    result.success
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                  }`}
                >
                  {result.success ? "Pass" : "Fail"}
                </span>
              </div>
              {(result.evren_response != null && result.evren_response !== "") && (
                <div className="mt-3 rounded-md bg-stone-100 dark:bg-stone-800/50 px-3 py-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Evren message
                  </p>
                  <p className="mt-1 text-sm text-stone-700 dark:text-stone-300 whitespace-pre-wrap">
                    {result.evren_response}
                  </p>
                  {result.detected_flags != null && result.detected_flags !== "" && (
                    <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
                      Detected flags: {result.detected_flags}
                    </p>
                  )}
                </div>
              )}
              <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                Score: {result.score} · Flags: {result.flags_detected || "—"}
              </p>
              {result.token_usage && (
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  Tokens: {result.token_usage.prompt_tokens} in / {result.token_usage.completion_tokens} out
                  ({result.token_usage.total_tokens} total) · ${result.token_usage.cost_usd.toFixed(6)} USD
                </p>
              )}
              {result.reason && (
                <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
                  {result.reason}
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
