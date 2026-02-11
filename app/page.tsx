"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const FALLBACK_EVREN_URL = "http://localhost:8000";
const FALLBACK_MODEL = "gemini-2.5-flash";

type Progress = {
  stage: string;
  index?: number;
  total?: number;
  test_case_id?: string;
  message?: string;
};

export default function Home() {
  const router = useRouter();
  const [evrenUrl, setEvrenUrl] = useState(FALLBACK_EVREN_URL);
  const [modelName, setModelName] = useState(FALLBACK_MODEL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/default-settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) return;
        if (data.evren_api_url != null && data.evren_api_url !== "") {
          setEvrenUrl(data.evren_api_url);
        }
        if (data.evaluator_model != null && data.evaluator_model !== "") {
          setModelName(data.evaluator_model);
        }
      })
      .finally(() => setSettingsLoaded(true));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setProgress(null);
    setLoading(true);
    try {
      const res = await fetch("/api/evaluate/run/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evren_model_api_url: evrenUrl.trim(),
          model_name: modelName || undefined,
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
              test_session_id?: string;
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
            } else if (data.type === "complete" && data.test_session_id) {
              setProgress(null);
              setLoading(false);
              router.push(`/sessions/${data.test_session_id}`);
              return;
            } else if (data.type === "error" && data.error) {
              setError(data.error);
              setProgress(null);
            }
          } catch {
            /* ignore parse errors */
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setProgress(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-stone-900">Run evaluation</h1>
      <p className="mt-1 text-stone-600">
        Runs all test cases from the database: Evren → Gemini evaluator. Results are saved to a new session.
      </p>
      <form onSubmit={handleSubmit} className="mt-8 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-stone-700">Evren API URL *</label>
          <input
            type="url"
            required
            value={evrenUrl}
            onChange={(e) => setEvrenUrl(e.target.value)}
            placeholder="http://localhost:8000"
            className="mt-1.5 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
          />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-stone-700">Gemini model</label>
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="gemini-2.5-flash"
            className="mt-1.5 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
          />
        </div>
        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}
        {loading && progress && (
          <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
            <div className="font-medium text-stone-800">
              {progress.stage === "evren" && "Waiting for Evren…"}
              {progress.stage === "evaluating" && "Evaluating…"}
              {progress.stage === "start" && "Starting…"}
              {progress.stage === "done" && "Completed"}
              {!["evren", "evaluating", "start", "done"].includes(progress.stage) && progress.stage}
            </div>
            <div className="mt-1 text-stone-600">
              {progress.total != null && progress.index != null && (
                <span>Test case {progress.stage === "done" ? progress.index : (progress.index + 1)} of {progress.total}</span>
              )}
              {progress.test_case_id && (
                <span className={progress.total != null ? " ml-1" : ""}>— {progress.test_case_id}</span>
              )}
            </div>
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="mt-6 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-stone-800 disabled:opacity-50"
        >
          {loading ? "Running…" : "Run evaluation"}
        </button>
      </form>
    </div>
  );
}
