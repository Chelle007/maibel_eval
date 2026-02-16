"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
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
};

function formatSessionDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** If the stored summary is raw JSON from the summarizer, extract the summary field and normalize newlines for display. */
function summaryForDisplay(raw: string | null | undefined): string {
  if (raw == null) return "";
  const str = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (!str.trim()) return "";
  let trimmed = str.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { summary?: string; title?: string };
      const content = typeof parsed.summary === "string" ? parsed.summary : undefined;
      if (content) trimmed = content.replace(/\\n/g, "\n");
    } catch {
      // Fallback: match "summary":"...", including long strings ([\s\S] allows newlines in the regex source)
      const m = trimmed.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) trimmed = m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n");
    }
  } else {
    trimmed = trimmed.replace(/\\n/g, "\n");
  }
  // Remove "# Evren Model Validation Report" and the Date/Model Version/Reviewer line so output starts at ## 1.
  trimmed = trimmed.replace(/^#\s*Evren Model Validation Report\s*\n?/i, "");
  trimmed = trimmed.replace(/\n\nDate: [^\n]*\nModel Version: [^\n]*\nReviewer: [^\n]*/gi, "\n\n");
  trimmed = trimmed.replace(/\nDate: [^\n]*\nModel Version: [^\n]*\nReviewer: [^\n]*/gi, "\n");
  trimmed = trimmed.replace(/\nDate: [^\n]+Model Version: [^\n]+Reviewer: [^\n]+/gi, ""); // single-line metadata
  return trimmed.trim();
}

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
  test_cases?: { input_message: string; expected_state: string; expected_behavior: string; title?: string | null } | null;
  evren_responses?: { evren_response: string; detected_states: string | null } | { evren_response: string; detected_states: string | null }[] | null;
};

function matchResultSearch(r: EvalResult, q: string): boolean {
  if (!q.trim()) return true;
  const lower = q.trim().toLowerCase();
  const id = (r.test_case_id ?? "").toLowerCase();
  const title = (r.test_cases?.title ?? "").toLowerCase();
  return id.includes(lower) || title.includes(lower);
}

export default function SessionDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [session, setSession] = useState<Session | null>(null);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingReasonId, setEditingReasonId] = useState<string | null>(null);
  const [editReason, setEditReason] = useState("");
  const [editScore, setEditScore] = useState<number>(0);
  const [editSuccess, setEditSuccess] = useState<boolean>(true);
  const [savingReason, setSavingReason] = useState(false);
  const [summary, setSummary] = useState("");
  const [editingSummary, setEditingSummary] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [passFailFilter, setPassFailFilter] = useState<"" | "pass" | "fail">("");
  const [sortBy, setSortBy] = useState<"id" | "score">("id");
  const router = useRouter();

  const filteredResults = useMemo(() => {
    const filtered = results.filter((r) => {
      if (!matchResultSearch(r, searchQuery)) return false;
      if (passFailFilter === "pass" && !r.success) return false;
      if (passFailFilter === "fail" && r.success) return false;
      return true;
    });
    const sorted = [...filtered];
    if (sortBy === "id") {
      sorted.sort((a, b) => (a.test_case_id ?? "").localeCompare(b.test_case_id ?? "", undefined, { numeric: true }));
    } else {
      sorted.sort((a, b) => b.score - a.score);
    }
    return sorted;
  }, [results, searchQuery, passFailFilter, sortBy]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/sessions/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSession(data.session);
        setResults(data.results ?? []);
        setSummary(summaryForDisplay(data.session?.summary ?? ""));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  function saveResultEdits(r: EvalResult) {
    if (editingReasonId !== r.eval_result_id) return;
    const scoreToSave = Number.isFinite(editScore) ? editScore : r.score;
    setSavingReason(true);
    fetch(`/api/eval-results/${r.eval_result_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: editReason, score: scoreToSave, success: editSuccess }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setResults((prev) =>
          prev.map((x) =>
            x.eval_result_id === r.eval_result_id
              ? { ...x, reason: editReason, score: scoreToSave, success: editSuccess, manually_edited: true }
              : x
          )
        );
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
          className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          {deleting ? "Deleting…" : "Delete session"}
        </button>
      </div>
      <PageHeader
        title={`${session.test_session_id} · ${session.title?.trim() || "Untitled session"}`}
        headingClassName="mt-2"
      />

      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight text-stone-900">Session details</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {session.created_at && (
            <div className="flex items-center gap-2 text-sm text-stone-700">
              <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span><strong className="font-medium text-stone-800">Date:</strong> {formatSessionDate(session.created_at)}</span>
            </div>
          )}
          {session.users && (
            <div className="flex items-center gap-2 text-sm text-stone-700" title={session.users.email}>
              <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span><strong className="font-medium text-stone-800">User:</strong> {session.users.full_name?.trim() || session.users.email}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-stone-700">
            <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span><strong className="font-medium text-stone-800">Total cost:</strong> ${(session.total_cost_usd ?? 0).toFixed(6)} USD</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-stone-700">
            <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              Passed test cases: {results.filter((r) => r.success).length} / {results.length}
              {" | "}
              Score: {results.length ? (results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(2) : "—"}
            </span>
          </div>
        </dl>
      </div>

      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-stone-900">Session summary</h2>
          {!editingSummary && (
            <button
              type="button"
              onClick={() => {
                setSummary(summaryForDisplay(session?.summary ?? ""));
                setEditingSummary(true);
              }}
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
                onClick={() => { setEditingSummary(false); setSummary(summaryForDisplay(session?.summary ?? "")); }}
                className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="mt-3 min-h-[4rem] text-sm text-stone-700 prose prose-stone prose-sm max-w-none
            [&_h1]:text-base [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:text-stone-900 [&_h1]:mt-0 [&_h1]:mb-1 [&_h1]:pb-2 [&_h1]:border-b [&_h1]:border-stone-200
            [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-stone-900 [&_h2]:mt-5 [&_h2]:mb-1.5 [&_h2]:first:mt-0
            [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-stone-800 [&_h3]:mt-3 [&_h3]:mb-1
            [&_p]:mt-1 [&_p]:text-sm [&_p]:leading-relaxed
            [&_ul]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-0.5 [&_ul]:text-sm
            [&_ol]:mt-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-0.5 [&_ol]:text-sm
            [&_strong]:font-semibold [&_strong]:text-stone-800 [&_strong]:text-sm
            [&_hr]:my-4 [&_hr]:border-stone-200">
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

      <div className="mt-8">
        <div className="flex flex-wrap items-center gap-3 mb-3">
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
              placeholder="Search by test case ID or title…"
              className="block w-full rounded-lg border border-stone-200 bg-stone-50/50 py-2 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
            />
          </div>
          <select
            value={passFailFilter}
            onChange={(e) => setPassFailFilter((e.target.value || "") as "" | "pass" | "fail")}
            className="rounded-lg border border-stone-200 bg-stone-50/50 px-3 py-2 text-sm text-stone-700 focus:border-stone-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
          >
            <option value="">All</option>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy((e.target.value || "id") as "id" | "score")}
            className="rounded-lg border border-stone-200 bg-stone-50/50 px-3 py-2 text-sm text-stone-700 focus:border-stone-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
            title="Sort results"
          >
            <option value="id">Sort by ID</option>
            <option value="score">Sort by score</option>
          </select>
        </div>
        <h2 className="text-lg font-medium text-stone-900">Results ({filteredResults.length})</h2>
      </div>
      <ul className="mt-3 space-y-3">
        {filteredResults.length === 0 ? (
          <li className="rounded-xl border border-stone-200 bg-white py-8 text-center text-sm text-stone-500">
            No results match your search or filter.
          </li>
        ) : (
        filteredResults.map((r) => {
          const isExpanded = expandedResultId === r.eval_result_id;
          return (
          <li key={r.eval_result_id} className="rounded-xl border border-stone-200 bg-white shadow-sm">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setExpandedResultId((prev) => (prev === r.eval_result_id ? null : r.eval_result_id))}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedResultId((prev) => (prev === r.eval_result_id ? null : r.eval_result_id)); } }}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 cursor-pointer hover:bg-stone-50/50 transition"
              aria-expanded={isExpanded}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className={`shrink-0 text-stone-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} aria-hidden>
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </span>
                <span className="font-mono text-base font-semibold text-stone-900">
                  {r.test_case_id}
                  {r.test_cases?.title?.trim() && (
                    <span className="ml-2 font-sans font-normal text-stone-600">· {r.test_cases.title.trim()}</span>
                  )}
                </span>
                <span className="text-stone-300" aria-hidden>|</span>
                {editingReasonId === r.eval_result_id ? (
                  <>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={editScore}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditScore(Number(e.target.value))}
                      className="w-16 rounded-lg border border-stone-200 px-2 py-1.5 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                    />
                    <select
                      value={editSuccess ? "pass" : "fail"}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditSuccess(e.target.value === "pass")}
                      className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                    >
                      <option value="pass">Pass</option>
                      <option value="fail">Fail</option>
                    </select>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium text-stone-700">Score: {r.score}</span>
                    <span className={`rounded-md px-2.5 py-0.5 text-xs font-medium ${r.success ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                      {r.success ? "Pass" : "Fail"}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                {editingReasonId === r.eval_result_id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => saveResultEdits(r)}
                      disabled={savingReason}
                      className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingReasonId(null); setEditReason(""); }}
                      className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedResultId(r.eval_result_id);
                      setEditingReasonId(r.eval_result_id);
                      setEditReason(r.reason ?? "");
                      setEditScore(r.score);
                      setEditSuccess(r.success);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 hover:border-stone-300"
                    title="Click to edit this analysis"
                  >
                    <span aria-hidden className="text-stone-500">✎</span>
                    Edit
                  </button>
                )}
              </div>
            </div>
            {isExpanded && (
            <div className="border-t border-stone-100 p-5 space-y-4">
              {r.test_cases && (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Input</p>
                    <p className="mt-1 text-sm text-stone-700 leading-relaxed">
                      {typeof r.test_cases.input_message === "string" ? r.test_cases.input_message : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Expected state</p>
                    <p className="mt-1 text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
                      {typeof r.test_cases.expected_state === "string" && r.test_cases.expected_state.trim() ? r.test_cases.expected_state : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Expected behaviour</p>
                    <p className="mt-1 text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
                      {typeof r.test_cases.expected_behavior === "string" && r.test_cases.expected_behavior.trim() ? r.test_cases.expected_behavior : "—"}
                    </p>
                  </div>
                </div>
              )}
              <div className="border-t border-stone-200 pt-4" />
              {r.evren_responses && (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Output</p>
                    <p className="mt-1 text-sm text-stone-700 leading-relaxed">
                      {((): string => {
                        const out = Array.isArray(r.evren_responses) ? r.evren_responses[0]?.evren_response : (r.evren_responses as { evren_response?: string }).evren_response;
                        return out != null && out !== "" ? `"${out}"` : "—";
                      })()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Detected flags</p>
                    <p className="mt-1 text-sm text-stone-700 leading-relaxed whitespace-pre-wrap font-mono">
                      {((): string => {
                        const flags = Array.isArray(r.evren_responses) ? r.evren_responses[0]?.detected_states : (r.evren_responses as { detected_states?: string | null }).detected_states;
                        if (flags == null || flags === "") return "—";
                        try {
                          const parsed = JSON.parse(flags) as unknown;
                          return JSON.stringify(parsed, null, 2);
                        } catch {
                          return flags;
                        }
                      })()}
                    </p>
                  </div>
                </div>
              )}
              <div className="border-t border-stone-200 pt-4" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Analysis</p>
                {editingReasonId === r.eval_result_id ? (
                  <div className="mt-2">
                    <textarea
                      rows={4}
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                      className="block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 leading-relaxed focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                    />
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-stone-600 leading-relaxed">{r.reason || "—"}</p>
                )}
              </div>
            </div>
            )}
          </li>
          );
        })
        )}
      </ul>
    </div>
  );
}
