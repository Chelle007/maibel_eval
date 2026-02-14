"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/app/components/PageHeader";

type Session = {
  test_session_id: string;
  user_id: string;
  title: string | null;
  total_cost_usd: number | null;
  summary: string | null;
  manually_edited: boolean;
  created_at?: string | null;
  users?: { full_name: string | null; email: string } | null;
  passed_count?: number;
  total_count?: number;
};

/** Format ISO date for display (e.g. "Feb 13, 2025"). */
function formatSessionDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Get YYYY-MM-DD in local time for date filter comparison. */
function sessionDateYMD(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

function matchSearch(s: Session, q: string): boolean {
  if (!q.trim()) return true;
  const lower = q.trim().toLowerCase();
  const title = s.title?.trim() ?? "";
  const id = s.test_session_id.toLowerCase();
  const summary = summaryPreview(s.summary, 500).toLowerCase();
  return [title, id, summary].some((text) => text.includes(lower));
}

export default function SessionsPage() {
  const [list, setList] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const filteredList = useMemo(() => {
    return list.filter((s) => {
      if (!matchSearch(s, searchQuery)) return false;
      const ymd = sessionDateYMD(s.created_at);
      if (!ymd) return true;
      if (dateFrom && ymd < dateFrom) return false;
      if (dateTo && ymd > dateTo) return false;
      return true;
    });
  }, [list, searchQuery, dateFrom, dateTo]);
  const filteredIds = useMemo(() => new Set(filteredList.map((s) => s.test_session_id)), [filteredList]);
  const allFilteredSelected = filteredList.length > 0 && filteredList.every((s) => selectedIds.has(s.test_session_id));
  const someFilteredSelected = filteredList.some((s) => selectedIds.has(s.test_session_id));

  useEffect(() => {
    const el = selectAllRef.current;
    if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
  }, [someFilteredSelected, allFilteredSelected]);

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...filteredIds]));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
    if (!confirm(`Delete session ${s.test_session_id}? This cannot be undone.`)) return;
    setDeletingId(s.test_session_id);
    fetch(`/api/sessions/${s.test_session_id}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) return res.json().then((d) => { throw new Error((d as { error?: string }).error ?? "Delete failed"); });
      })
      .then(() => setList((prev) => prev.filter((x) => x.test_session_id !== s.test_session_id)))
      .catch((e) => setError(e.message))
      .finally(() => setDeletingId(null));
  }

  function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected session(s)? This cannot be undone.`)) return;
    setError(null);
    setDeletingSelected(true);
    const idsToDelete = new Set(selectedIds);
    Promise.all(
      Array.from(idsToDelete).map((id) =>
        fetch(`/api/sessions/${id}`, { method: "DELETE" }).then((res) => {
          if (!res.ok) return res.json().then((d: { error?: string }) => { throw new Error(d?.error ?? "Delete failed"); });
        })
      )
    )
      .then(() => {
        setSelectedIds(new Set());
        setList((prev) => prev.filter((s) => !idsToDelete.has(s.test_session_id)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setDeletingSelected(false));
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader title="Evaluation sessions" description="View and edit past run results." />
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
        <>
          <div className="mt-6 flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[180px]">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </span>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by title, session ID, or summary…"
                  className="block w-full rounded-lg border border-stone-200 bg-stone-50/50 py-2 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="rounded-lg border border-stone-200 bg-stone-50/50 px-3 py-2 text-sm text-stone-900 focus:border-stone-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
                  title="From date"
                />
                <span className="text-stone-400">–</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="rounded-lg border border-stone-200 bg-stone-50/50 px-3 py-2 text-sm text-stone-900 focus:border-stone-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
                  title="To date"
                />
              </div>
              {!allFilteredSelected && selectedIds.size === 0 && (
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/50 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-400"
                  />
                  Select all {filteredList.length > 0 ? `(${filteredList.length})` : ""}
                </label>
              )}
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
                >
                  Clear selection ({selectedIds.size})
                </button>
              )}
            </div>
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-3">
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={deletingSelected}
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {deletingSelected ? "Deleting…" : `Delete selected (${selectedIds.size})`}
                </button>
              </div>
            )}
          </div>
          {filteredList.length === 0 ? (
            <p className="mt-6 text-stone-500">No sessions match your search or date filter.</p>
          ) : (
            <ul className="mt-6 space-y-3">
              {filteredList.map((s) => (
                <li key={s.test_session_id} className="relative flex items-stretch gap-3 rounded-xl border border-stone-200 bg-white shadow-sm">
                  <label className="flex shrink-0 cursor-pointer items-start pt-4 pl-4" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.test_session_id)}
                      onChange={() => toggleSelect(s.test_session_id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-400"
                    />
                  </label>
                  <Link
                    href={`/sessions/${s.test_session_id}`}
                    className="min-w-0 flex-1 py-4 pr-14 transition hover:bg-stone-50/50"
                  >
                    <h3 className="font-semibold text-stone-900">
                      {s.test_session_id} · {s.title?.trim() || "Untitled session"}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-600">
                      {s.created_at && (
                        <span className="inline-flex items-center gap-1">
                          <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          {formatSessionDate(s.created_at)}
                        </span>
                      )}
                      {s.created_at && s.users && (
                        <span className="text-stone-400" aria-hidden>|</span>
                      )}
                      {s.users && (
                        <span className="inline-flex items-center gap-1" title={s.users.email}>
                          <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          {s.users.full_name?.trim() || s.users.email}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-stone-600">
                      Passed test cases: {s.passed_count ?? 0} / {s.total_count ?? 0}
                    </p>
                  </Link>
                  <button
                    type="button"
                    onClick={(e) => deleteSession(e, s)}
                    disabled={deletingId === s.test_session_id}
                    title={deletingId === s.test_session_id ? "Deleting…" : "Delete session"}
                    aria-label="Delete session"
                    className="absolute right-3 top-4 rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
