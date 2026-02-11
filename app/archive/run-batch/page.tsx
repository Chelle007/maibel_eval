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

export default function ArchiveRunBatch() {
  const [evrenUrl, setEvrenUrl] = useState("");
  const [sheetLink, setSheetLink] = useState("");
  const [modelName, setModelName] = useState("gemini-2.5-flash");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<EvaluationResult[] | null>(null);
  const [progress, setProgress] = useState<{ stage: string; index?: number; total?: number; test_case_id?: string; message?: string } | null>(null);
  const [completedSoFar, setCompletedSoFar] = useState<EvaluationResult[]>([]);

  const apiBase = typeof window !== "undefined" ? window.location.origin : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResults(null);
    setProgress(null);
    setCompletedSoFar([]);
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/run/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evren_model_api_url: evrenUrl,
          google_sheet_link: sheetLink,
          model_name: modelName || undefined,
          ...(systemPrompt.trim() && { system_prompt: systemPrompt.trim() }),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? `Request failed (${res.status})`);
        setLoading(false);
        return;
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        setError("No response body");
        setLoading(false);
        return;
      }
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const chunk of lines) {
          const match = chunk.match(/^data:\s*(.+)/m);
          if (!match) continue;
          try {
            const data = JSON.parse(match[1].trim()) as {
              type: string;
              stage?: string;
              message?: string;
              index?: number;
              total?: number;
              test_case_id?: string;
              result?: EvaluationResult;
              results?: EvaluationResult[];
              error?: string;
            };
            if (data.type === "progress" && data.stage != null) {
              setProgress({
                stage: data.stage,
                index: data.index,
                total: data.total,
                test_case_id: data.test_case_id,
                message: data.message,
              });
              if (data.stage === "done" && data.result) setCompletedSoFar((prev) => [...prev, data.result!]);
            } else if (data.type === "complete" && data.results) {
              setResults(data.results);
              setProgress(null);
              setCompletedSoFar([]);
            } else if (data.type === "error" && data.error) {
              setError(data.error);
              setProgress(null);
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setProgress(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/" className="text-sm text-stone-500 hover:text-stone-700">← Back</Link>
      <h1 className="mt-2 text-2xl font-semibold text-stone-900">Archive: Run from Google Sheet</h1>
      <p className="mt-1 text-stone-600">Legacy flow: run evaluations from a Google Sheet (no DB).</p>
      <form onSubmit={handleSubmit} className="mt-8 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-stone-700">Evren API URL *</label>
          <input type="url" required value={evrenUrl} onChange={(e) => setEvrenUrl(e.target.value)} placeholder="http://localhost:8000" className="mt-1.5 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400" />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-stone-700">Google Sheet link *</label>
          <input type="url" required value={sheetLink} onChange={(e) => setSheetLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className="mt-1.5 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400" />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-stone-700">Gemini model</label>
          <input type="text" value={modelName} onChange={(e) => setModelName(e.target.value)} className="mt-1.5 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400" />
        </div>
        <button type="submit" disabled={loading} className="mt-6 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50">
          {loading ? "Running…" : "Run evaluation"}
        </button>
      </form>
      {loading && progress && (
        <div className="mt-5 rounded-lg border border-stone-200 bg-stone-100 px-4 py-3 text-sm text-stone-700">
          {progress.message}
          {progress.test_case_id && ` — ${progress.test_case_id}`}
        </div>
      )}
      {error && <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {results && (
        <section className="mt-8">
          <h2 className="text-lg font-medium text-stone-900">Results ({results.length})</h2>
          <ul className="mt-3 space-y-3">
            {results.map((r) => (
              <li key={r.test_case_id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex justify-between">
                  <span className="font-mono text-sm font-medium text-stone-700">{r.test_case_id}</span>
                  <span className={r.success ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>{r.success ? "Pass" : "Fail"}</span>
                </div>
                <p className="mt-1 text-xs text-stone-500">Score: {r.score}</p>
                {r.reason && <p className="mt-1 text-sm text-stone-600">{r.reason}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
