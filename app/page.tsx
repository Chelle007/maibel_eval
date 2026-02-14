"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/app/components/PageHeader";

const FALLBACK_EVREN_URL = "http://localhost:8000";
const FALLBACK_EVALUATOR_MODEL = "gemini-2.5-flash";
const FALLBACK_SUMMARIZER_MODEL = "gemini-2.5-flash";

function playCompletionSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const playTone = (freq: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    playTone(523.25, 0, 0.15);
    playTone(659.25, 0.2, 0.2);
  } catch {
    /* ignore if AudioContext not supported or blocked */
  }
}

function showCompletionNotification() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  try {
    if (Notification.permission === "granted") {
      new Notification("Evaluation complete", {
        body: "All test cases finished. Session ready to view.",
        icon: "/favicon.ico",
      });
    }
  } catch {
    /* ignore notification errors */
  }
}

function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

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
  const [evaluatorModel, setEvaluatorModel] = useState(FALLBACK_EVALUATOR_MODEL);
  const [summarizerModel, setSummarizerModel] = useState(FALLBACK_SUMMARIZER_MODEL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/default-settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) return;
        setEvrenUrl(data.evren_api_url ?? FALLBACK_EVREN_URL);
        setEvaluatorModel(data.evaluator_model ?? FALLBACK_EVALUATOR_MODEL);
        setSummarizerModel(data.summarizer_model ?? FALLBACK_SUMMARIZER_MODEL);
      })
      .finally(() => setSettingsLoaded(true));
  }, []);

  function handleCancel() {
    abortControllerRef.current?.abort();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setProgress(null);
    requestNotificationPermission();
    setLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const res = await fetch("/api/evaluate/run/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evren_model_api_url: evrenUrl.trim(),
          model_name: evaluatorModel || undefined,
          summarizer_model: summarizerModel || undefined,
        }),
        signal: controller.signal,
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
              playCompletionSound();
              showCompletionNotification();
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
      if (e instanceof Error && e.name === "AbortError") {
        setProgress(null);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong");
        setProgress(null);
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Run evaluation"
        description="Runs all test cases from the database: Evren → Gemini evaluator. Results are saved to a new session."
      />
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
          <label className="block text-sm font-medium text-stone-700">Evaluator model</label>
          <input
            type="text"
            value={evaluatorModel}
            onChange={(e) => setEvaluatorModel(e.target.value)}
            placeholder="gemini-2.5-flash"
            className="mt-1.5 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
          />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-stone-700">Summarizer model</label>
          <input
            type="text"
            value={summarizerModel}
            onChange={(e) => setSummarizerModel(e.target.value)}
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
        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-stone-800 disabled:opacity-50"
          >
            {loading ? "Running…" : "Run evaluation"}
          </button>
          {loading && (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
