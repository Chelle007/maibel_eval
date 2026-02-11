"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Session = {
  test_session_id: string;
  user_id: string;
  total_cost_usd: number | null;
  summary: string | null;
  manually_edited: boolean;
};

/** Strip markdown to plain text for list preview (remove #, **, ---, etc.). */
function summaryPreview(summary: string | null, maxLength: number = 140): string {
  if (!summary?.trim()) return "";
  const plain = summary
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*\s/g, "")
    .replace(/\s\*\s/g, " ")
    .replace(/---+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLength) return plain;
  return plain.slice(0, maxLength).trim() + "…";
}

export default function SessionsPage() {
  const [list, setList] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function loadSessions() {
    setLoading(true);
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setList(Array.isArray(data) ? data : []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadSessions();
  }, []);

  function deleteSession(e: React.MouseEvent, s: Session) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete session ${s.test_session_id.slice(0, 8)}…? This cannot be undone.`)) return;
    setDeletingId(s.test_session_id);
    fetch(`/api/sessions/${s.test_session_id}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) return res.json().then((d) => { throw new Error((d as { error?: string }).error ?? "Delete failed"); });
      })
      .then(() => setList((prev) => prev.filter((x) => x.test_session_id !== s.test_session_id)))
      .catch((e) => setError(e.message))
      .finally(() => setDeletingId(null));
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-stone-900">Evaluation sessions</h1>
      <p className="mt-1 text-stone-600">View and edit past run results.</p>
      {error && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}
      {loading ? (
        <p className="mt-8 text-stone-500">Loading…</p>
      ) : list.length === 0 ? (
        <div className="mt-8 rounded-xl border border-stone-200 bg-white p-8 text-center text-stone-500">
          No sessions yet. Run an evaluation first.
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {list.map((s) => (
            <li key={s.test_session_id} className="relative">
              <Link
                href={`/sessions/${s.test_session_id}`}
                className="block rounded-xl border border-stone-200 bg-white p-4 pr-28 shadow-sm transition hover:border-stone-300 hover:shadow"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium text-stone-700">
                    {s.test_session_id.slice(0, 8)}…
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-stone-500">
                      ${(s.total_cost_usd ?? 0).toFixed(6)} USD
                    </span>
                    {s.manually_edited && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        Edited
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-sm text-stone-600 line-clamp-2">
                  {summaryPreview(s.summary) || (
                    <span className="italic text-stone-400">No summary</span>
                  )}
                </p>
              </Link>
              <button
                type="button"
                onClick={(e) => deleteSession(e, s)}
                disabled={deletingId === s.test_session_id}
                className="absolute right-3 top-4 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-500 hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-50"
                title="Delete session"
              >
                {deletingId === s.test_session_id ? "Deleting…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
