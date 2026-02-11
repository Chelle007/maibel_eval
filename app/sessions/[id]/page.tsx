"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

type Session = {
  test_session_id: string;
  user_id: string;
  total_cost_usd: number | null;
  summary: string | null;
  manually_edited: boolean;
};

type EvalResult = {
  eval_result_id: string;
  test_session_id: string;
  test_case_id: string;
  evren_response_id: string;
  success: boolean;
  score: number;
  reason: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  manually_edited: boolean;
  test_cases?: { input_message: string; expected_flags: string; expected_behavior: string } | null;
  evren_responses?: { evren_response: string; detected_flags: string } | { evren_response: string; detected_flags: string }[] | null;
};

export default function SessionDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [session, setSession] = useState<Session | null>(null);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingReasonId, setEditingReasonId] = useState<string | null>(null);
  const [editReason, setEditReason] = useState("");
  const [savingReason, setSavingReason] = useState(false);
  const [summary, setSummary] = useState("");
  const [editingSummary, setEditingSummary] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!id) return;
    fetch(`/api/sessions/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSession(data.session);
        setResults(data.results ?? []);
        setSummary(data.session?.summary ?? "");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  function saveReason(r: EvalResult) {
    if (editingReasonId !== r.eval_result_id) return;
    setSavingReason(true);
    fetch(`/api/eval-results/${r.eval_result_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: editReason }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setResults((prev) => prev.map((x) => (x.eval_result_id === r.eval_result_id ? { ...x, reason: editReason, manually_edited: true } : x)));
        setEditingReasonId(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSavingReason(false));
  }

  function deleteSession() {
    if (!confirm("Delete this session? This cannot be undone.")) return;
    setDeleting(true);
    fetch(`/api/sessions/${id}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) return res.json().then((d) => { throw new Error(d.error ?? "Delete failed"); });
      })
      .then(() => router.push("/sessions"))
      .catch((e) => setError(e.message))
      .finally(() => setDeleting(false));
  }

  function saveSummary() {
    setSavingSummary(true);
    fetch(`/api/sessions/${id}/summary`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSession((s) => (s ? { ...s, summary, manually_edited: true } : null));
        setEditingSummary(false);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSavingSummary(false));
  }

  if (loading) return <div className="mx-auto max-w-4xl px-4 py-8 text-stone-500">Loading…</div>;
  if (error || !session) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-red-600">{error ?? "Not found"}</p>
        <Link href="/sessions" className="mt-2 inline-block text-sm text-stone-500 hover:underline">← Sessions</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/sessions" className="text-sm text-stone-500 hover:text-stone-700">← Sessions</Link>
        <button
          type="button"
          onClick={deleteSession}
          disabled={deleting}
          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete session"}
        </button>
      </div>
      <h1 className="mt-2 text-2xl font-semibold text-stone-900">Session {session.test_session_id.slice(0, 8)}…</h1>
      <p className="mt-1 text-stone-600">Total cost: ${(session.total_cost_usd ?? 0).toFixed(6)} USD</p>

      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <label className="block text-sm font-medium text-stone-700">Session summary</label>
          {!editingSummary && (
            <button
              type="button"
              onClick={() => setEditingSummary(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-stone-50 px-2.5 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-100 hover:border-stone-400"
              title="Edit summary"
            >
              <span aria-hidden className="text-stone-500">✎</span>
              Edit
            </button>
          )}
        </div>
        {editingSummary ? (
          <>
            <textarea
              rows={12}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
              placeholder="Optional summary or analysis of this run."
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={saveSummary}
                disabled={savingSummary}
                className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
              >
                {savingSummary ? "Saving…" : "Save summary"}
              </button>
              <button
                type="button"
                onClick={() => { setEditingSummary(false); setSummary(session?.summary ?? ""); }}
                className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="mt-1.5 min-h-[4rem] text-stone-700 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:mt-1 [&_p]:text-sm [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold">
            {summary.trim() ? (
              <ReactMarkdown>{summary}</ReactMarkdown>
            ) : (
              <p className="text-stone-400 italic">No summary for this session.</p>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <h2 className="mt-8 text-lg font-medium text-stone-900">Results ({results.length})</h2>
      <ul className="mt-3 space-y-4">
        {results.map((r) => (
          <li key={r.eval_result_id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-medium text-stone-700">{r.test_case_id}</span>
              <span className={`rounded-md px-2.5 py-0.5 text-xs font-medium ${r.success ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                {r.success ? "Pass" : "Fail"}
              </span>
            </div>
            {r.test_cases && (
              <p className="mt-1 text-xs text-stone-500">
                Input: {typeof r.test_cases.input_message === "string" ? r.test_cases.input_message.slice(0, 80) + "…" : "—"}
              </p>
            )}
            {r.evren_responses && (
              <div className="mt-2 rounded-lg bg-stone-100 p-2.5 text-sm text-stone-700">
                {Array.isArray(r.evren_responses) ? r.evren_responses[0]?.evren_response : (r.evren_responses as { evren_response?: string }).evren_response}
              </div>
            )}
            <p className="mt-1 text-xs text-stone-500">Score: {r.score} · Cost: ${(r.cost_usd ?? 0).toFixed(6)}</p>
            {editingReasonId === r.eval_result_id ? (
              <div className="mt-3">
                <textarea
                  rows={3}
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  className="block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => saveReason(r)}
                    disabled={savingReason}
                    className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-800"
                  >
                    Save
                  </button>
                  <button type="button" onClick={() => { setEditingReasonId(null); setEditReason(""); }} className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-sm text-stone-600">{r.reason || "—"}</p>
                <button
                  type="button"
                  onClick={() => {
                    setEditingReasonId(r.eval_result_id);
                    setEditReason(r.reason ?? "");
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-stone-50 px-2.5 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-100 hover:border-stone-400"
                  title="Click to edit this analysis"
                >
                  <span aria-hidden className="text-stone-500">✎</span>
                  Edit Analysis
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
