"use client";

import Link from "next/link";
import { Pencil, RefreshCw, Save, X, Trash2, Check, Plus, Eye, EyeOff, Eraser } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { SummaryEditor } from "@/app/components/SummaryEditor";
import { computeTokenCostParts } from "@/lib/token-cost";
import {
  BEHAVIOR_REVIEW_DIMENSIONS,
  emptyVersionBehaviorReview,
  parseVersionBehaviorReview,
  type BehaviorReviewByVersion,
  type BehaviorReviewConfidence,
  type BehaviorReviewDimensionKey,
  type BehaviorReviewRating,
  type VersionBehaviorReview,
} from "@/lib/behavior-review";
import { normalizeVersionEntry } from "@/lib/db.types";
import type { AnyVersionEntry, VersionEntry } from "@/lib/db.types";
import {
  SESSION_REVIEW_FAILURE_TAXONOMY,
  emptySessionReviewSummaryV0,
  parseSessionReviewSummaryV0,
  type SessionReviewFailureThemeKey,
  type SessionReviewSummaryV0,
  type SessionOverallFinding,
  type SessionRecommendation,
  type SessionTrustSeverity,
} from "@/lib/session-review-summary";

type Session = {
  test_session_id: string;
  user_id: string;
  title: string | null;
  total_cost_usd: number | null;
  total_eval_time_seconds?: number | null;
  summary: string | null;
  session_review_summary?: unknown;
  mode?: "single" | "comparison";
  manually_edited: boolean;
  repeated_runs_mode?: "auto" | "manual";
  created_at?: string | null;
  users?: { full_name: string | null; email: string } | null;
};

type SessionModels = {
  evaluator_model: string | null;
  summarizer_model: string | null;
};

function formatSessionDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatEvalTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatUsd(value: number | null | undefined, decimals: number = 6): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `$${n.toFixed(decimals)} USD`;
}

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
    /* ignore */
  }
}

function notifyVersionAdded() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  try {
    if (Notification.permission === "granted") {
      new Notification("Add version complete", {
        body: "New Evren versions were added for this session.",
        icon: "/favicon.ico",
      });
    }
  } catch {
    /* ignore */
  }
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

type ComparisonData = {
  tiers: string[][];
  overall_reason: string;
  overall_hard_failures: Record<string, string[]>;
  token_usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd: number;
  };
} | null;

type EvalResult = {
  eval_result_id: string;
  test_session_id: string;
  test_case_id: string;
  success: boolean;
  score: number;
  reason: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  manually_edited: boolean;
  evren_responses?: AnyVersionEntry[] | null;
  test_cases?: { input_message: string; expected_state: string; expected_behavior: string; title?: string | null; type?: "single_turn" | "multi_turn"; turns?: string[] | null } | null;
  comparison?: ComparisonData;
  behavior_review?: BehaviorReviewByVersion | null;
};

type AddVersionProgress = {
  stage: string;
  index?: number;
  total?: number;
  test_case_id?: string;
  message?: string;
};

function matchResultSearch(r: EvalResult, q: string): boolean {
  if (!q.trim()) return true;
  const lower = q.trim().toLowerCase();
  const id = (r.test_case_id ?? "").toLowerCase();
  const title = (r.test_cases?.title ?? "").toLowerCase();
  const typeStr = r.test_cases?.type === "multi_turn" ? "multi turn multi-turn" : "single turn single-turn";
  const turnsStr = (r.test_cases?.turns ?? []).join(" ").toLowerCase();
  return id.includes(lower) || title.includes(lower) || typeStr.includes(lower) || turnsStr.includes(lower);
}

function isResultEvaluated(r: EvalResult): boolean {
  if (r.prompt_tokens != null || r.completion_tokens != null || r.total_tokens != null) return true;
  if (typeof r.reason === "string" && r.reason.trim() !== "") return true;
  return false;
}

function getComparisonTokenUsage(r: EvalResult): { prompt: number; completion: number; total: number; costUsd: number } | null {
  const usage = r.comparison?.token_usage;
  if (!usage) return null;
  const prompt = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null;
  const completion = typeof usage.completion_tokens === "number" ? usage.completion_tokens : null;
  const total = typeof usage.total_tokens === "number" ? usage.total_tokens : null;
  const costUsd = typeof usage.cost_usd === "number" ? usage.cost_usd : null;
  if (prompt == null || completion == null || costUsd == null) return null;
  return { prompt, completion, total: total ?? prompt + completion, costUsd };
}

function getVersionEntries(results: EvalResult[]): VersionEntry[] {
  /** Use the row with the most versions — not only `results[0]`, which may have skipped an add (e.g. Evren error) while other rows have the new version. */
  let best: VersionEntry[] = [];
  for (const r of results) {
    const v = r.evren_responses;
    const normalized = Array.isArray(v) ? v.map(normalizeVersionEntry) : [];
    if (normalized.length > best.length) best = normalized;
  }
  return best;
}

/** DB/session_review_summary merged with client-side fallbacks for cases / pass-fail lines. */
function mergeSessionReviewSummaryFromSession(
  session: Session | null,
  results: EvalResult[]
): SessionReviewSummaryV0 {
  const parsed = parseSessionReviewSummaryV0(session?.session_review_summary);
  const passCount = results.filter((r) => r && typeof r.success === "boolean" && r.success).length;
  const totalCount = results.filter((r) => r && typeof r.success === "boolean").length;
  const versionsText = (() => {
    const versions = getVersionEntries(results);
    if (versions.length === 0) return null;
    const names = versions.map((v) => v.version_name).filter(Boolean);
    if (names.length === 0) return null;
    return names.join(", ");
  })();
  const suggestedCasesVersions =
    totalCount > 0
      ? `${totalCount} cases; versions: ${versionsText ?? "—"}`
      : versionsText
        ? `versions: ${versionsText}`
        : null;
  const suggestedPassFail =
    totalCount > 0 ? `${passCount} / ${totalCount} passed` : null;

  const looksLikeUuid = (s: string) =>
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s);

  return {
    ...parsed,
    cases_versions_tested:
      parsed.cases_versions_tested == null ||
      (typeof parsed.cases_versions_tested === "string" && looksLikeUuid(parsed.cases_versions_tested))
        ? suggestedCasesVersions
        : parsed.cases_versions_tested,
    pass_fail_summary: parsed.pass_fail_summary ?? suggestedPassFail,
  };
}

function getTurnCount(versions: VersionEntry[]): number {
  let maxTurns = 0;
  for (const version of versions) {
    for (const run of version.runs) {
      maxTurns = Math.max(maxTurns, run.turns.length);
    }
  }
  return maxTurns;
}

function evalResultsHaveAnyMultiRun(results: EvalResult[]): boolean {
  for (const r of results) {
    const vers = Array.isArray(r.evren_responses) ? r.evren_responses.map(normalizeVersionEntry) : [];
    for (const v of vers) {
      if (v.runs.length > 1) return true;
    }
  }
  return false;
}

type RepeatedRunsDisplay = "None" | "Manual" | "Automated";

function getRepeatedRunsDisplay(
  repeatedRunsMode: "auto" | "manual" | undefined,
  results: EvalResult[]
): RepeatedRunsDisplay {
  if (repeatedRunsMode === "manual") return "Manual";
  if (evalResultsHaveAnyMultiRun(results)) return "Automated";
  return "None";
}

/** Shared style for secondary “Edit” actions (header, summary, result rows). */
const editTriggerClassName =
  "inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm font-medium text-stone-600 transition-colors hover:border-stone-400 hover:bg-stone-50 hover:text-stone-900";

function prettyDetectedFlags(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  try {
    const parsed = JSON.parse(raw) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function getBehaviorReviewDraft(
  r: EvalResult,
  versionId: string,
  draftByResult: Record<string, Record<string, VersionBehaviorReview>>
): VersionBehaviorReview {
  const chunk = draftByResult[r.eval_result_id];
  if (chunk?.[versionId]) return chunk[versionId];
  const br = r.behavior_review;
  if (br && typeof br === "object" && !Array.isArray(br)) {
    const parsed = parseVersionBehaviorReview((br as Record<string, unknown>)[versionId]);
    if (parsed) return parsed;
  }
  return emptyVersionBehaviorReview();
}

export default function SessionDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [session, setSession] = useState<Session | null>(null);
  const [models, setModels] = useState<SessionModels>({ evaluator_model: null, summarizer_model: null });
  const [results, setResults] = useState<EvalResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiEditingComparisonId, setAiEditingComparisonId] = useState<string | null>(null);
  const [aiComparisonFeedback, setAiComparisonFeedback] = useState("");
  const [applyingAiComparison, setApplyingAiComparison] = useState(false);
  const [editingReasonId, setEditingReasonId] = useState<string | null>(null);
  const [editReason, setEditReason] = useState("");
  const [editScore, setEditScore] = useState<number>(0);
  const [editSuccess, setEditSuccess] = useState<boolean>(true);
  const [savingReason, setSavingReason] = useState(false);
  const [behaviorReviewDraft, setBehaviorReviewDraft] = useState<
    Record<string, Record<string, VersionBehaviorReview>>
  >({});
  const [savingBehaviorReviewId, setSavingBehaviorReviewId] = useState<string | null>(null);
  const [savedBehaviorReviewId, setSavedBehaviorReviewId] = useState<string | null>(null);
  const behaviorReviewSavedTimeoutRef = useRef<number | null>(null);
  const [summary, setSummary] = useState("");
  const [editingSummary, setEditingSummary] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [sessionReviewSummary, setSessionReviewSummary] = useState<SessionReviewSummaryV0>(
    emptySessionReviewSummaryV0()
  );
  const [savingSessionReviewSummary, setSavingSessionReviewSummary] = useState(false);
  const [savedSessionReviewSummary, setSavedSessionReviewSummary] = useState(false);
  const sessionReviewSavedTimeoutRef = useRef<number | null>(null);
  const [refiningWording, setRefiningWording] = useState(false);
  const [resummarizing, setResummarizing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingVersion, setAddingVersion] = useState(false);
  const [addVersionProgress, setAddVersionProgress] = useState<AddVersionProgress | null>(null);
  const [addVersionCounts, setAddVersionCounts] = useState<{
    versionAddedDone: number;
    versionAddedTotal: number;
    comparisonDone: number;
    comparisonTotal: number;
    comparisonEnabled: boolean;
  }>({
    versionAddedDone: 0,
    versionAddedTotal: 0,
    comparisonDone: 0,
    comparisonTotal: 0,
    comparisonEnabled: false,
  });
  const [showAddVersionModal, setShowAddVersionModal] = useState(false);
  const [draftVersions, setDraftVersions] = useState<{ version_id: string; version_name: string }[]>([]);
  const [newVersionLabel, setNewVersionLabel] = useState("Version 2");
  const [runComparison, setRunComparison] = useState(true);
  const [addVersionRunCount, setAddVersionRunCount] = useState(1);
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null);
  const [savingNames, setSavingNames] = useState(false);
  const [editingHeader, setEditingHeader] = useState(false);
  const [editSessionId, setEditSessionId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [savingHeader, setSavingHeader] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [savingRepeatedRunsMode, setSavingRepeatedRunsMode] = useState(false);
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);
  const [expandedFlagsKeys, setExpandedFlagsKeys] = useState<Set<string>>(new Set());
  const [expandedRunsKeys, setExpandedRunsKeys] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [passFailFilter, setPassFailFilter] = useState<"" | "pass" | "fail">("");
  const [typeFilter, setTypeFilter] = useState<"" | "single_turn" | "multi_turn">("");
  const [sortBy, setSortBy] = useState<"id" | "score">("id");
  const [showComparatorMetrics, setShowComparatorMetrics] = useState(false);
  const router = useRouter();
  const versionEntries = useMemo(() => getVersionEntries(results), [results]);
  const versionCount = versionEntries.length;
  const comparisonStats = useMemo(() => {
    const statsMap = new Map<string, { version_id: string; version_name: string; wins: number; ties: number; losses: number }>();
    const idToName = new Map<string, string>();
    const nameToCanonicalId = new Map<string, string>();

    for (const r of results) {
      for (const v of (r.evren_responses ?? [])) {
        if (!idToName.has(v.version_id)) idToName.set(v.version_id, v.version_name);
        if (!nameToCanonicalId.has(v.version_name)) nameToCanonicalId.set(v.version_name, v.version_id);
      }
    }

    const canonicalId = (vid: string): string => {
      const name = idToName.get(vid) ?? vid;
      return nameToCanonicalId.get(name) ?? vid;
    };

    for (const r of results) {
      const versions = r.evren_responses ?? [];
      const tiers = r.comparison?.tiers;

      for (const v of versions) {
        const cid = canonicalId(v.version_id);
        if (!statsMap.has(cid)) {
          statsMap.set(cid, { version_id: cid, version_name: v.version_name, wins: 0, ties: 0, losses: 0 });
        }
      }

      if (!tiers || tiers.length === 0) continue;
      const topTier = Array.isArray(tiers[0]) ? tiers[0].map(String) : [];
      if (topTier.length === 0) continue;
      const isTie = topTier.length > 1;
      const topSet = new Set<string>(topTier);

      for (const v of versions) {
        const cid = canonicalId(v.version_id);
        const entry = statsMap.get(cid)!;
        if (isTie && topSet.has(v.version_id)) {
          entry.ties++;
        } else if (!isTie && topSet.has(v.version_id)) {
          entry.wins++;
        } else {
          entry.losses++;
        }
      }
    }

    return Array.from(statsMap.values())
      .map((s) => ({ ...s, score: s.wins * 3 + s.ties * 1 }))
      .sort((a, b) => b.score - a.score);
  }, [results]);

  const filteredResults = useMemo(() => {
    const filtered = results.filter((r) => {
      if (!matchResultSearch(r, searchQuery)) return false;
      const evaluated = isResultEvaluated(r);
      if (passFailFilter === "pass" && (!evaluated || !r.success)) return false;
      if (passFailFilter === "fail" && (!evaluated || r.success)) return false;
      if (typeFilter && r.test_cases?.type !== typeFilter) return false;
      return true;
    });
    const sorted = [...filtered];
    if (sortBy === "id") {
      sorted.sort((a, b) => (a.test_case_id ?? "").localeCompare(b.test_case_id ?? "", undefined, { numeric: true }));
    } else {
      sorted.sort((a, b) => {
        const aEvaluated = isResultEvaluated(a);
        const bEvaluated = isResultEvaluated(b);
        if (aEvaluated && !bEvaluated) return -1;
        if (!aEvaluated && bEvaluated) return 1;
        return b.score - a.score;
      });
    }
    return sorted;
  }, [results, searchQuery, passFailFilter, typeFilter, sortBy]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/sessions/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        const nextSession = data.session as Session | null;
        const nextModels = (data.models ?? null) as SessionModels | null;
        const nextResults = (Array.isArray(data.results) ? data.results : []) as EvalResult[];
        setSession(nextSession);
        if (nextModels && typeof nextModels === "object") setModels(nextModels);
        setResults(nextResults);
        setSummary(summaryForDisplay(nextSession?.summary ?? ""));

        setSessionReviewSummary(mergeSessionReviewSummaryFromSession(nextSession, nextResults));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function saveSessionReviewSummary() {
    if (!id) return;
    setSavedSessionReviewSummary(false);
    if (sessionReviewSavedTimeoutRef.current != null) {
      window.clearTimeout(sessionReviewSavedTimeoutRef.current);
      sessionReviewSavedTimeoutRef.current = null;
    }
    setSavingSessionReviewSummary(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${id}/review-summary`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_review_summary: sessionReviewSummary }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; session?: Session };
      if (!res.ok || data.error) throw new Error(data.error ?? `Request failed (${res.status})`);
      if (data.session) setSession(data.session);
      setSavedSessionReviewSummary(true);
      sessionReviewSavedTimeoutRef.current = window.setTimeout(() => {
        setSavedSessionReviewSummary(false);
      }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save session review summary");
    } finally {
      setSavingSessionReviewSummary(false);
    }
  }

  function getVersionLabel(versionId: string): string {
    const entry = versionEntries.find((v) => v.version_id === versionId);
    return entry?.version_name ?? "Unknown";
  }

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

  async function saveBehaviorReview(r: EvalResult) {
    const reviewVersions = (Array.isArray(r.evren_responses) ? r.evren_responses : [])
      .slice(0, 3)
      .map((v) => normalizeVersionEntry(v as AnyVersionEntry));
    if (reviewVersions.length === 0) return;
    const payload: BehaviorReviewByVersion = {};
    for (const ver of reviewVersions) {
      payload[ver.version_id] = getBehaviorReviewDraft(r, ver.version_id, behaviorReviewDraft);
    }
    setSavedBehaviorReviewId((prev) => (prev === r.eval_result_id ? null : prev));
    if (behaviorReviewSavedTimeoutRef.current != null) {
      window.clearTimeout(behaviorReviewSavedTimeoutRef.current);
      behaviorReviewSavedTimeoutRef.current = null;
    }
    setSavingBehaviorReviewId(r.eval_result_id);
    setError(null);
    try {
      const res = await fetch(`/api/eval-results/${r.eval_result_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ behavior_review: payload }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        behavior_review?: BehaviorReviewByVersion;
        manually_edited?: boolean;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResults((prev) =>
        prev.map((x) =>
          x.eval_result_id === r.eval_result_id
            ? {
                ...x,
                behavior_review: data.behavior_review ?? x.behavior_review,
                manually_edited: data.manually_edited ?? true,
              }
            : x
        )
      );
      setBehaviorReviewDraft((prev) => {
        const next = { ...prev };
        delete next[r.eval_result_id];
        return next;
      });
      setSavedBehaviorReviewId(r.eval_result_id);
      behaviorReviewSavedTimeoutRef.current = window.setTimeout(() => {
        setSavedBehaviorReviewId((cur) => (cur === r.eval_result_id ? null : cur));
      }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save behavior review");
    } finally {
      setSavingBehaviorReviewId(null);
    }
  }

  function clearBehaviorReview(r: EvalResult) {
    const reviewVersions = (Array.isArray(r.evren_responses) ? r.evren_responses : [])
      .slice(0, 3)
      .map((v) => normalizeVersionEntry(v as AnyVersionEntry));
    if (reviewVersions.length === 0) return;
    const cleared: Record<string, VersionBehaviorReview> = {};
    for (const ver of reviewVersions) {
      cleared[ver.version_id] = emptyVersionBehaviorReview();
    }
    setBehaviorReviewDraft((prev) => ({
      ...prev,
      [r.eval_result_id]: cleared,
    }));
  }

  async function applyAiComparisonEdits(r: EvalResult) {
    if (aiEditingComparisonId !== r.eval_result_id) return;
    const feedback = aiComparisonFeedback.trim();
    if (!feedback) {
      setError("Please enter feedback for the AI edit.");
      return;
    }

    const versions = (r.evren_responses ?? []).slice(0, 3).map((v) => ({
      version_id: v.version_id,
      version_name: v.version_name,
    }));

    setApplyingAiComparison(true);
    setError(null);
    try {
      const res = await fetch(`/api/eval-results/${r.eval_result_id}/ai-edit-comparison`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback,
          current_comparison: r.comparison ?? null,
          version_entries: versions,
          test_case_id: r.test_case_id ?? null,
          expected_state: r.test_cases?.expected_state ?? null,
          expected_behavior: r.test_cases?.expected_behavior ?? null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; comparison?: unknown };
      if (!res.ok || data.error) throw new Error(data.error ?? `Request failed (${res.status})`);
      if (!data.comparison) throw new Error("No comparison returned from AI edit.");

      setResults((prev) =>
        prev.map((x) =>
          x.eval_result_id === r.eval_result_id
            ? { ...x, comparison: data.comparison as EvalResult["comparison"], manually_edited: true }
            : x
        )
      );
      setAiEditingComparisonId(null);
      setAiComparisonFeedback("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply AI comparison edits");
    } finally {
      setApplyingAiComparison(false);
    }
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

  function addVersion() {
    const drafts = versionEntries.map((v) => ({ version_id: v.version_id, version_name: v.version_name }));
    setDraftVersions(drafts);
    const existingLower = new Set(drafts.map((d) => d.version_name.toLowerCase()));
    let nextNum = drafts.length + 1;
    while (existingLower.has(`version ${nextNum}`)) nextNum++;
    setNewVersionLabel(`Version ${nextNum}`);
    setAddVersionRunCount(1);
    setEditingVersionId(null);
    setShowAddVersionModal(true);
  }

  async function confirmAddVersion() {
    if (!session) return;
    const cleanedNewVersionLabel = newVersionLabel.trim() || `Version ${draftVersions.length + 1}`;

    // Save any pending renames before adding version
    const renames = draftVersions
      .filter((d) => {
        const original = versionEntries.find((v) => v.version_id === d.version_id);
        return original && original.version_name !== d.version_name;
      })
      .map((d) => ({ version_id: d.version_id, version_name: d.version_name }));
    if (renames.length > 0) {
      try {
        await fetch(`/api/sessions/${id}/versions`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ renames }),
        });
      } catch {
        /* proceed anyway */
      }
    }

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }

    setAddingVersion(true);
    setAddVersionProgress({ stage: "start", message: "Starting add version…" });
    setAddVersionCounts({
      versionAddedDone: 0,
      versionAddedTotal: 0,
      comparisonDone: 0,
      comparisonTotal: 0,
      comparisonEnabled: runComparison,
    });
    setError(null);

    try {
      const effectiveRunCount = Math.max(1, Math.floor(addVersionRunCount || 1));
      const res = await fetch(`/api/sessions/${id}/add-version/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_name: cleanedNewVersionLabel,
          run_count: effectiveRunCount,
          run_comparison: runComparison,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response body");

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
              error?: string;
              results?: EvalResult[];
            };

            if (data.type === "progress" && data.stage) {
              setAddVersionProgress({
                stage: data.stage,
                message: data.message,
                index: data.index,
                total: data.total,
                test_case_id: data.test_case_id,
              });

              setAddVersionCounts((prev) => {
                const stage = String(data.stage ?? "");
                const total = typeof data.total === "number" ? data.total : undefined;
                const index = typeof data.index === "number" ? data.index : undefined;

                if (stage === "start") {
                  return {
                    versionAddedDone: 0,
                    versionAddedTotal: total ?? prev.versionAddedTotal,
                    comparisonDone: 0,
                    comparisonTotal: total ?? prev.comparisonTotal,
                    comparisonEnabled: prev.comparisonEnabled,
                  };
                }

                if (stage === "done") {
                  return {
                    ...prev,
                    versionAddedDone: Math.max(prev.versionAddedDone, index ?? prev.versionAddedDone),
                    versionAddedTotal: total ?? prev.versionAddedTotal,
                  };
                }

                if (stage === "compared" || stage === "compare_error" || stage === "comparing_skip") {
                  return {
                    ...prev,
                    comparisonDone: Math.max(prev.comparisonDone, index ?? prev.comparisonDone),
                    comparisonTotal: total ?? prev.comparisonTotal,
                  };
                }

                if (stage === "comparing") {
                  return {
                    ...prev,
                    comparisonTotal: total ?? prev.comparisonTotal,
                  };
                }

                return prev;
              });
            } else if (data.type === "complete") {
              const nextResults = Array.isArray(data.results) ? data.results : [];
              setResults(nextResults);
              void fetch(`/api/sessions/${id}`)
                .then((r) => r.json())
                .then((payload) => {
                  if (payload.error) return;
                  const nextSession = payload.session as Session | null;
                  setSession(nextSession);
                  setSessionReviewSummary(mergeSessionReviewSummaryFromSession(nextSession, nextResults));
                })
                .catch(() => {
                  /* keep prior form state */
                });
              playCompletionSound();
              notifyVersionAdded();
              setAddVersionProgress(null);
              setShowAddVersionModal(false);
              return;
            } else if (data.type === "error" && data.error) {
              throw new Error(data.error);
            }
          } catch (err) {
            if (err instanceof Error) throw err;
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add version");
    } finally {
      setAddingVersion(false);
      setAddVersionProgress(null);
      setAddVersionCounts((prev) => ({
        ...prev,
        versionAddedDone: 0,
        versionAddedTotal: 0,
        comparisonDone: 0,
        comparisonTotal: 0,
      }));
    }
  }

  async function saveVersionNamesOnly() {
    const renames = draftVersions
      .filter((d) => {
        const original = versionEntries.find((v) => v.version_id === d.version_id);
        return original && original.version_name !== d.version_name;
      })
      .map((d) => ({ version_id: d.version_id, version_name: d.version_name.trim() || d.version_name }));

    if (renames.length === 0) {
      setShowAddVersionModal(false);
      return;
    }

    setSavingNames(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${id}/versions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renames }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; results?: EvalResult[] };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      if (Array.isArray(data.results)) setResults(data.results);
      setShowAddVersionModal(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save version names");
    } finally {
      setSavingNames(false);
    }
  }

  async function deleteVersionAt(versionId: string) {
    const version = draftVersions.find((d) => d.version_id === versionId);
    if (!version) return;
    if (draftVersions.length <= 1) {
      setError("At least one version must remain.");
      return;
    }
    if (!confirm(`Delete "${version.version_name}"?`)) return;

    setDeletingVersionId(versionId);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${id}/versions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version_id: versionId }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; results?: EvalResult[] };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      const nextResults = Array.isArray(data.results) ? data.results : [];
      setResults(nextResults);
      setDraftVersions((prev) => prev.filter((d) => d.version_id !== versionId));
      if (editingVersionId === versionId) setEditingVersionId(null);
      const nextEntries = getVersionEntries(nextResults);
      const existingLower = new Set(nextEntries.map((v) => v.version_name.toLowerCase()));
      let nextNum = nextEntries.length + 1;
      while (existingLower.has(`version ${nextNum}`)) nextNum++;
      setNewVersionLabel(`Version ${nextNum}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete version");
    } finally {
      setDeletingVersionId(null);
    }
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

  function saveRepeatedRunsMode(next: "auto" | "manual") {
    if (!session || session.mode !== "comparison") return;
    const current = session.repeated_runs_mode === "manual" ? "manual" : "auto";
    if (next === current) return;
    setSavingRepeatedRunsMode(true);
    setError(null);
    fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repeated_runs_mode: next }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSession((s) => (s ? { ...s, repeated_runs_mode: next } : null));
        if (next === "auto") setAddVersionRunCount(1);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSavingRepeatedRunsMode(false));
  }

  function saveHeader() {
    const sessionIdTrimmed = editSessionId.trim();
    if (!sessionIdTrimmed) {
      setHeaderError("Session ID cannot be empty");
      return;
    }
    setSavingHeader(true);
    setHeaderError(null);
    fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test_session_id: sessionIdTrimmed, title: editTitle.trim() || null }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSession((s) =>
          s
            ? { ...s, test_session_id: data.session?.test_session_id ?? sessionIdTrimmed, title: (data.session?.title ?? editTitle.trim()) || null }
            : null
        );
        setEditingHeader(false);
        if (data.redirect_id && data.redirect_id !== id) {
          router.push(`/sessions/${data.redirect_id}`);
        }
      })
      .catch((e) => setHeaderError(e.message))
      .finally(() => setSavingHeader(false));
  }

  function refineWording() {
    setRefiningWording(true);
    setError(null);
    fetch("/api/refine-wording", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        if (typeof data.refined === "string") setSummary(data.refined);
      })
      .catch((e) => setError(e.message))
      .finally(() => setRefiningWording(false));
  }

  function resummarize() {
    setResummarizing(true);
    setError(null);
    fetch(`/api/sessions/${id}/resummarize`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        const newSummary = typeof data.summary === "string" ? data.summary : "";
        setSummary(summaryForDisplay(newSummary));
        setSession((s) =>
          s
            ? {
                ...s,
                summary: newSummary,
                title: typeof data.title === "string" ? data.title : s.title,
                manually_edited: false,
              }
            : null
        );
        setEditingSummary(true);
      })
      .catch((e) => setError(e.message))
      .finally(() => setResummarizing(false));
  }

  const evaluatedResults = results.filter(isResultEvaluated);
  const hasEvaluationResults = evaluatedResults.length > 0;
  const evaluatorModelName = models.evaluator_model ?? "gemini-3-flash-preview";
  const evaluatorTokensSummary = useMemo(() => {
    let prompt = 0;
    let completion = 0;
    let total = 0;
    let any = false;
    for (const r of evaluatedResults) {
      if (typeof r.prompt_tokens === "number") {
        prompt += r.prompt_tokens;
        any = true;
      }
      if (typeof r.completion_tokens === "number") {
        completion += r.completion_tokens;
        any = true;
      }
      if (typeof r.total_tokens === "number") {
        total += r.total_tokens;
        any = true;
      }
    }
    return { any, prompt, completion, total };
  }, [evaluatedResults]);
  const evalCostSummary = useMemo(() => {
    if (!evaluatorTokensSummary.any) return null;
    return computeTokenCostParts(evaluatorTokensSummary.prompt, evaluatorTokensSummary.completion, evaluatorModelName);
  }, [evaluatorTokensSummary, evaluatorModelName]);

  const comparisonTokensSummary = useMemo(() => {
    let prompt = 0;
    let completion = 0;
    let total = 0;
    let any = false;
    let costUsd = 0;
    for (const r of results) {
      const u = getComparisonTokenUsage(r);
      if (!u) continue;
      any = true;
      prompt += u.prompt;
      completion += u.completion;
      total += u.total;
      costUsd += u.costUsd;
    }
    return { any, prompt, completion, total, costUsd };
  }, [results]);
  const comparisonCostSummary = useMemo(() => {
    if (!comparisonTokensSummary.any) return null;
    return computeTokenCostParts(comparisonTokensSummary.prompt, comparisonTokensSummary.completion, evaluatorModelName);
  }, [comparisonTokensSummary, evaluatorModelName]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("maibel_eval_show_comparator_metrics");
      if (raw === "1") setShowComparatorMetrics(true);
      if (raw === "0") setShowComparatorMetrics(false);
    } catch {
      /* ignore */
    }
  }, []);

  function toggleComparatorMetrics() {
    setShowComparatorMetrics((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("maibel_eval_show_comparator_metrics", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  if (loading) return <div className="mx-auto max-w-5xl px-4 py-8 text-stone-500">Loading…</div>;
  if (error || !session) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="text-red-600">{error ?? "Not found"}</p>
        <Link href="/sessions" className="mt-2 inline-block text-sm text-stone-500 hover:underline">← Sessions</Link>
      </div>
    );
  }
  const repeatedRunsDisplay = getRepeatedRunsDisplay(session.repeated_runs_mode, results);
  const anyMultiRunInSession = evalResultsHaveAnyMultiRun(results);
  const repeatedRunsSelectValue =
    repeatedRunsDisplay === "None" ? "none" : repeatedRunsDisplay === "Automated" ? "automated" : "manual";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/sessions" className="text-sm text-stone-500 hover:text-stone-700">← Sessions</Link>
        <div className="flex items-center gap-2">
          {session.mode !== "single" && (
            <>
              <button
                type="button"
                onClick={toggleComparatorMetrics}
                disabled={addingVersion || deleting}
                className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                title={showComparatorMetrics ? "Hide details" : "Show details"}
                aria-pressed={showComparatorMetrics}
              >
                {showComparatorMetrics ? (
                  <EyeOff className="h-4 w-4 text-stone-600" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4 text-stone-600" aria-hidden />
                )}
                <span className="text-stone-600">{showComparatorMetrics ? "Hide details" : "Show details"}</span>
                <span className="sr-only">{showComparatorMetrics ? "Hide details" : "Show details"}</span>
              </button>
              <button
                type="button"
                onClick={addVersion}
                disabled={addingVersion || deleting}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                title="Manage versions"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {addingVersion ? "Working…" : "Manage versions"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={deleteSession}
            disabled={deleting || addingVersion}
            className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {deleting ? "Deleting…" : "Delete session"}
          </button>
        </div>
      </div>

      <header className="mt-2">
        {!editingHeader ? (
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-stone-900">
              {session.test_session_id} · {session.title?.trim() || "Untitled session"}
            </h1>
            <button
              type="button"
              onClick={() => {
                setEditSessionId(session.test_session_id);
                setEditTitle(session.title?.trim() ?? "");
                setHeaderError(null);
                setEditingHeader(true);
              }}
              className={editTriggerClassName}
              title="Edit session ID and title"
            >
              <Pencil className="h-3.5 w-3.5 text-stone-500" strokeWidth={2} aria-hidden />
              Edit
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 gap-y-2">
              <label className="sr-only" htmlFor="edit-session-id">Session ID</label>
              <input
                id="edit-session-id"
                type="text"
                value={editSessionId}
                onChange={(e) => setEditSessionId(e.target.value)}
                placeholder="e.g. ES120"
                className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-lg font-semibold text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
              />
              <span className="text-stone-400 font-medium">·</span>
              <label className="sr-only" htmlFor="edit-session-title">Title</label>
              <input
                id="edit-session-title"
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Session title"
                className="min-w-[200px] flex-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-lg font-semibold text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
              />
            </div>
            {headerError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                {headerError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveHeader}
                disabled={savingHeader}
                className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
              >
                {savingHeader ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingHeader(false);
                  setEditSessionId(session.test_session_id);
                  setEditTitle(session.title?.trim() ?? "");
                  setHeaderError(null);
                }}
                className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </header>

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
            <span><strong className="font-medium text-stone-800">Total cost:</strong> {formatUsd(session.total_cost_usd, 6)}</span>
          </div>
          {evaluatorTokensSummary.any && (
            <div className="flex items-center gap-2 text-sm text-stone-700">
              <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <strong className="font-medium text-stone-800">Evaluator tokens:</strong>
                <span className="tabular-nums text-stone-800">in {evaluatorTokensSummary.prompt}</span>
                <span className="text-stone-300" aria-hidden>·</span>
                <span className="tabular-nums text-stone-800">out {evaluatorTokensSummary.completion}</span>
                <span className="text-stone-300" aria-hidden>·</span>
                <span className="tabular-nums text-stone-800">total {evaluatorTokensSummary.total || (evaluatorTokensSummary.prompt + evaluatorTokensSummary.completion)}</span>
              </span>
            </div>
          )}
          {evalCostSummary && (
            <div className="flex items-center gap-2 text-sm text-stone-700">
              <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <strong className="font-medium text-stone-800">Evaluator cost:</strong>
                <span className="tabular-nums text-stone-800">{formatUsd(evalCostSummary.total_cost_usd, 6)}</span>
                <span className="text-stone-300" aria-hidden>·</span>
                <span className="tabular-nums text-stone-600">in {formatUsd(evalCostSummary.input_cost_usd, 6)}</span>
                <span className="text-stone-300" aria-hidden>·</span>
                <span className="tabular-nums text-stone-600">out {formatUsd(evalCostSummary.output_cost_usd, 6)}</span>
                <span className="text-stone-300" aria-hidden>·</span>
                <span className="text-stone-500">model {evaluatorModelName}</span>
              </span>
            </div>
          )}
          {showComparatorMetrics && session.mode === "comparison" && comparisonTokensSummary.any && (
            <div className="flex items-center gap-2 text-sm text-stone-700">
              <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <strong className="font-medium text-stone-800">Comparator tokens:</strong>
                <span className="tabular-nums text-stone-800">in {comparisonTokensSummary.prompt}</span>
                <span className="text-stone-300" aria-hidden>·</span>
                <span className="tabular-nums text-stone-800">out {comparisonTokensSummary.completion}</span>
                <span className="text-stone-300" aria-hidden>·</span>
                <span className="tabular-nums text-stone-800">total {comparisonTokensSummary.total || (comparisonTokensSummary.prompt + comparisonTokensSummary.completion)}</span>
              </span>
            </div>
          )}
          {showComparatorMetrics && session.mode === "comparison" && comparisonCostSummary && (
            <div className="flex items-center gap-2 text-sm text-stone-700">
              <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <strong className="font-medium text-stone-800">Comparator cost:</strong>
                <span className="tabular-nums text-stone-800">{formatUsd(comparisonTokensSummary.costUsd, 6)}</span>
                <span className="text-stone-300" aria-hidden>·</span>
                <span className="tabular-nums text-stone-600">in {formatUsd(comparisonCostSummary.input_cost_usd, 6)}</span>
                <span className="text-stone-300" aria-hidden>·</span>
                <span className="tabular-nums text-stone-600">out {formatUsd(comparisonCostSummary.output_cost_usd, 6)}</span>
                <span className="text-stone-300" aria-hidden>·</span>
                <span className="text-stone-500">model {evaluatorModelName}</span>
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-stone-700">
            <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              <strong className="font-medium text-stone-800">Passed test cases:</strong>{" "}
              {hasEvaluationResults ? `${evaluatedResults.filter((r) => r.success).length} / ${evaluatedResults.length}` : "—"}
            </span>
          </div>
          {session.mode === "comparison" ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-stone-700 min-w-0">
              <svg className="h-4 w-4 shrink-0 self-center text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <strong className="font-medium text-stone-800">Repeated runs:</strong>
                <select
                  value={repeatedRunsSelectValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    saveRepeatedRunsMode(v === "manual" ? "manual" : "auto");
                  }}
                  disabled={savingRepeatedRunsMode}
                  className="max-w-[11rem] cursor-pointer rounded-sm border border-stone-300 bg-white py-0 pl-0 pr-6 text-sm font-normal text-stone-900 hover:bg-stone-50 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-stone-400 disabled:opacity-50"
                  aria-label="Repeated runs"
                  title="None: one run per version. Automated: any version has multiple runs. Manual: you choose run count when adding a version."
                >
                  <option value="none" disabled={anyMultiRunInSession}>
                    None
                  </option>
                  <option value="automated" disabled={!anyMultiRunInSession}>
                    Automated
                  </option>
                  <option value="manual">Manual</option>
                </select>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-stone-700">
              <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span>
                <strong className="font-medium text-stone-800">Score:</strong>{" "}
                {hasEvaluationResults ? (evaluatedResults.reduce((s, r) => s + r.score, 0) / evaluatedResults.length).toFixed(2) : "—"}
              </span>
            </div>
          )}
          {(session.total_eval_time_seconds != null && session.total_eval_time_seconds >= 0) && (
            <div className="flex items-center gap-2 text-sm text-stone-700">
              <svg className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span><strong className="font-medium text-stone-800">Time taken:</strong> {formatEvalTime(session.total_eval_time_seconds)}</span>
            </div>
          )}
        </dl>
      </div>

      {session.mode === "comparison" ? (
        showComparatorMetrics ? (
          <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold tracking-tight text-stone-900">Version comparison table</h2>

            {comparisonStats.length > 0 ? (
              <>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-200 text-left text-xs font-medium uppercase tracking-wide text-stone-400">
                        <th className="pb-2 pr-4">#</th>
                        <th className="pb-2 pr-4">Version</th>
                        <th className="pb-2 pr-4 text-right">Wins</th>
                        <th className="pb-2 pr-4 text-right">Ties</th>
                        <th className="pb-2 pr-4 text-right">Losses</th>
                        <th className="pb-2 text-right">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonStats.map((v, i) => {
                        const rank =
                          i === 0
                            ? 1
                            : (v.score === comparisonStats[i - 1].score
                                ? comparisonStats.findIndex((s) => s.score === v.score) + 1
                                : i + 1);
                        const isTop = rank === 1;
                        return (
                          <tr
                            key={v.version_id}
                            className={isTop ? "bg-emerald-50/60" : i % 2 === 1 ? "bg-stone-50/40" : ""}
                          >
                            <td className="py-2 pr-4 font-medium text-stone-500">{rank}</td>
                            <td className="py-2 pr-4 font-medium text-stone-900">
                              {isTop && (
                                <span className="mr-1.5" aria-label="Champion">
                                  ★
                                </span>
                              )}
                              {v.version_name}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums text-emerald-700">{v.wins}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-stone-500">{v.ties}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-red-600">{v.losses}</td>
                            <td className="py-2 text-right tabular-nums font-semibold text-stone-900">{v.score}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-stone-400">Scoring: Win = 3 pts, Tie = 1 pt, Loss = 0 pts</p>
              </>
            ) : (
              <p className="mt-3 text-sm text-stone-400 italic">
                No comparison data yet. Add a version to start comparing.
              </p>
            )}
          </div>
        ) : null
      ) : (
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
                className={editTriggerClassName}
                title="Edit summary"
              >
                <Pencil className="h-3.5 w-3.5 text-stone-500" strokeWidth={2} aria-hidden />
                Edit
              </button>
            )}
          </div>
          {editingSummary ? (
            <>
              <div className="mt-1.5">
                <SummaryEditor
                  value={summary}
                  onChange={setSummary}
                  placeholder="Optional summary or analysis of this run."
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={saveSummary}
                  disabled={savingSummary}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
                >
                  <Save className="h-4 w-4 shrink-0" aria-hidden />
                  {savingSummary ? "Saving…" : "Save summary"}
                </button>
                <button
                  type="button"
                  onClick={resummarize}
                  disabled={resummarizing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400 disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
                  {resummarizing ? "Resummarizing…" : "Resummarize"}
                </button>
                <button
                  type="button"
                  onClick={refineWording}
                  disabled={refiningWording}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 hover:border-violet-400 disabled:opacity-50"
                >
                  <Pencil className="h-4 w-4 shrink-0" aria-hidden />
                  {refiningWording ? "Refining…" : "Refine wording"}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingSummary(false); setSummary(summaryForDisplay(session?.summary ?? "")); }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
                >
                  <X className="h-4 w-4 shrink-0" aria-hidden />
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
              [&_code]:font-mono [&_code]:text-sm [&_code]:bg-stone-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-stone-800
              [&_hr]:my-4 [&_hr]:border-stone-200">
              {summary.trim() ? (
                <ReactMarkdown>{summary}</ReactMarkdown>
              ) : (
                <p className="text-stone-400 italic">No summary for this session.</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-stone-900">Session review summary</h2>
          <button
            type="button"
            onClick={() => { void saveSessionReviewSummary(); }}
            disabled={savingSessionReviewSummary}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
              savingSessionReviewSummary
                ? "bg-stone-700"
                : savedSessionReviewSummary
                  ? "bg-emerald-600"
                  : "bg-stone-900 hover:bg-stone-800"
            }`}
          >
            <Save className="h-4 w-4 shrink-0" aria-hidden />
            {savingSessionReviewSummary ? "Saving…" : savedSessionReviewSummary ? "Saved" : "Save"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-stone-400">Goal</label>
              <textarea
                rows={2}
                value={sessionReviewSummary.goal ?? ""}
                onChange={(e) => setSessionReviewSummary((p) => ({ ...p, goal: e.target.value.trim() ? e.target.value : null }))}
                placeholder="What was this session trying to validate?"
                className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 leading-relaxed focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
              />
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-stone-400">Cases / versions tested</label>
              <input
                type="text"
                value={sessionReviewSummary.cases_versions_tested ?? ""}
                onChange={(e) => setSessionReviewSummary((p) => ({ ...p, cases_versions_tested: e.target.value.trim() ? e.target.value : null }))}
                placeholder="e.g. 24 cases; versions: v1, v2"
                className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
              />
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-stone-400">Pass/fail summary</label>
              <input
                type="text"
                value={sessionReviewSummary.pass_fail_summary ?? ""}
                onChange={(e) => setSessionReviewSummary((p) => ({ ...p, pass_fail_summary: e.target.value.trim() ? e.target.value : null }))}
                placeholder="e.g. 18 / 24 passed"
                className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-stone-400">Overall finding</label>
                <select
                  value={sessionReviewSummary.overall_finding ?? ""}
                  onChange={(e) => {
                    const v = e.target.value as SessionOverallFinding | "";
                    setSessionReviewSummary((p) => ({ ...p, overall_finding: v === "deterministic" || v === "likely_variable" || v === "unclear" ? v : null }));
                  }}
                  className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                >
                  <option value="">—</option>
                  <option value="deterministic">Deterministic</option>
                  <option value="likely_variable">Likely variable</option>
                  <option value="unclear">Unclear</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-stone-400">Trust severity</label>
                <select
                  value={sessionReviewSummary.trust_severity ?? ""}
                  onChange={(e) => {
                    const v = e.target.value as SessionTrustSeverity | "";
                    setSessionReviewSummary((p) => ({ ...p, trust_severity: v === "high" || v === "medium" || v === "low" ? v : null }));
                  }}
                  className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                >
                  <option value="">—</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-stone-400">Recommendation</label>
                <select
                  value={sessionReviewSummary.recommendation ?? ""}
                  onChange={(e) => {
                    const v = e.target.value as SessionRecommendation | "";
                    setSessionReviewSummary((p) => ({ ...p, recommendation: v === "ship" || v === "hold" || v === "investigate" ? v : null }));
                  }}
                  className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                >
                  <option value="">—</option>
                  <option value="ship">Ship</option>
                  <option value="hold">Hold</option>
                  <option value="investigate">Investigate</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-stone-400">What still needs confirmation</label>
              <textarea
                rows={4}
                value={sessionReviewSummary.needs_confirmation ?? ""}
                onChange={(e) => setSessionReviewSummary((p) => ({ ...p, needs_confirmation: e.target.value.trim() ? e.target.value : null }))}
                placeholder="What would you rerun / double-check to be confident?"
                className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 leading-relaxed focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
              />
            </div>
          </div>

          <div className="space-y-3 lg:col-span-1">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-stone-400">Top failure themes</label>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SESSION_REVIEW_FAILURE_TAXONOMY.map((t) => {
                  const checked = sessionReviewSummary.top_failure_themes.includes(t.key);
                  return (
                    <label
                      key={t.key}
                      className="flex items-start gap-2 rounded-lg border border-stone-200 bg-stone-50/40 px-3 py-2 text-sm text-stone-800"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setSessionReviewSummary((p) => {
                            const cur = new Set<SessionReviewFailureThemeKey>(p.top_failure_themes);
                            if (next) cur.add(t.key);
                            else cur.delete(t.key);
                            return { ...p, top_failure_themes: Array.from(cur) };
                          });
                        }}
                        className="mt-0.5 h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-400"
                      />
                      <span className="leading-snug">{t.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {showAddVersionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="add-version-dialog-title">
          <div className="fixed inset-0 bg-stone-900/50" aria-hidden onClick={() => { if (!addingVersion) setShowAddVersionModal(false); }} />
          <div className="relative z-10 w-full max-w-lg rounded-xl border border-stone-200 bg-white p-6 shadow-xl">
            <h2 id="add-version-dialog-title" className="text-lg font-semibold text-stone-900">Manage versions</h2>
            <p className="mt-2 text-sm text-stone-600">
              Rename existing versions and set a name for the new version before rerunning Evren.
            </p>

            <div className="mt-4 space-y-3">
              {draftVersions.map((draft, idx) => (
                <div key={draft.version_id}>
                  <label className="block text-xs font-medium uppercase tracking-wide text-stone-400">
                    Existing version {idx + 1}
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="text"
                      value={draft.version_name}
                      disabled={editingVersionId !== draft.version_id}
                      onChange={(e) => {
                        const value = e.target.value;
                        setDraftVersions((prev) => prev.map((d) => d.version_id === draft.version_id ? { ...d, version_name: value } : d));
                      }}
                      className={`block w-full rounded-lg border px-3 py-2 text-sm focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400 ${
                        editingVersionId === draft.version_id
                          ? "border-stone-200 bg-white text-stone-900"
                          : "border-stone-200 bg-stone-50 text-stone-600"
                      }`}
                    />
                    <button
                      type="button"
                      disabled={addingVersion || deletingVersionId != null}
                      onClick={() => {
                        if (editingVersionId === draft.version_id) {
                          const trimmed = draft.version_name.trim();
                          setDraftVersions((prev) =>
                            prev.map((d) => d.version_id === draft.version_id ? { ...d, version_name: trimmed || `Version ${idx + 1}` } : d)
                          );
                          setEditingVersionId(null);
                        } else {
                          setEditingVersionId(draft.version_id);
                        }
                      }}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                      title={editingVersionId === draft.version_id ? "Save version name" : "Edit version name"}
                    >
                      {editingVersionId === draft.version_id ? (
                        <Check className="h-4 w-4" aria-hidden />
                      ) : (
                        <Pencil className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={addingVersion || deletingVersionId != null || draftVersions.length <= 1}
                      onClick={() => deleteVersionAt(draft.version_id)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50"
                      title="Delete version"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              ))}
              {versionCount < 3 && (
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-stone-400">New version name</label>
                  <input
                    type="text"
                    value={newVersionLabel}
                    onChange={(e) => setNewVersionLabel(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-stone-400">Runs for new version</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={addVersionRunCount}
                  onChange={(e) => setAddVersionRunCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                <div>
                  <p className="text-sm font-medium text-stone-700">Run comparison</p>
                  <p className="text-xs text-stone-500">Compare new version against current champion</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={runComparison}
                  onClick={() => setRunComparison((prev) => !prev)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                    runComparison ? "bg-emerald-500" : "bg-stone-300"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                      runComparison ? "translate-x-5" : "translate-x-0.5"
                    }`}
                    aria-hidden
                  />
                </button>
              </div>
            </div>

            {addingVersion && addVersionProgress && (
              <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                <div className="font-medium text-stone-800">
                  {(() => {
                    const stage = String(addVersionProgress.stage ?? "");
                    const isComparingStage =
                      stage === "comparing" ||
                      stage === "compared" ||
                      stage === "comparing_skip" ||
                      stage === "compare_error";
                    if (isComparingStage) return "Comparing versions";
                    return "Adding version";
                  })()}
                </div>
                <div className="mt-1 text-stone-600">
                  {addVersionCounts.versionAddedTotal > 0 && (
                    <span>
                      Version added {Math.min(addVersionCounts.versionAddedDone, addVersionCounts.versionAddedTotal)} of{" "}
                      {addVersionCounts.versionAddedTotal}
                    </span>
                  )}
                  {addVersionCounts.comparisonEnabled && addVersionCounts.comparisonTotal > 0 && (
                    <span className={addVersionCounts.versionAddedTotal > 0 ? " ml-2" : ""}>
                      / Comparison done {Math.min(addVersionCounts.comparisonDone, addVersionCounts.comparisonTotal)} of{" "}
                      {addVersionCounts.comparisonTotal}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowAddVersionModal(false)}
                disabled={addingVersion}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                <X className="h-4 w-4 shrink-0" aria-hidden />
                Cancel
              </button>
              <button
                type="button"
                onClick={saveVersionNamesOnly}
                disabled={addingVersion || savingNames}
                className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
              >
                <Save className="h-4 w-4 shrink-0" aria-hidden />
                {savingNames ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={confirmAddVersion}
                disabled={addingVersion || versionCount >= 3}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <Plus className="h-4 w-4 shrink-0" aria-hidden />
                {addingVersion ? "Adding…" : "Add version"}
              </button>
            </div>
          </div>
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
            value={typeFilter}
            onChange={(e) => setTypeFilter((e.target.value || "") as "" | "single_turn" | "multi_turn")}
            className="rounded-lg border border-stone-200 bg-stone-50/50 px-3 py-2 text-sm text-stone-700 focus:border-stone-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
            title="Filter by test case type"
          >
            <option value="">All types</option>
            <option value="single_turn">Single turn</option>
            <option value="multi_turn">Multi turn</option>
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
          const isEvaluated = isResultEvaluated(r);
          const usage = isEvaluated && typeof r.prompt_tokens === "number" && typeof r.completion_tokens === "number"
            ? computeTokenCostParts(r.prompt_tokens, r.completion_tokens, evaluatorModelName)
            : null;
          const compUsageRaw = getComparisonTokenUsage(r);
          const compUsage = compUsageRaw
            ? computeTokenCostParts(compUsageRaw.prompt, compUsageRaw.completion, evaluatorModelName)
            : null;
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
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${r.test_cases?.type === "multi_turn" ? "bg-violet-100 text-violet-800" : "bg-stone-100 text-stone-600"}`}>
                    {r.test_cases?.type === "multi_turn" ? "Multi" : "Single"}
                  </span>
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
                    {isEvaluated ? (
                      <>
                        <span className="text-sm font-medium text-stone-700">Score: {r.score}</span>
                        <span className={`rounded-md px-2.5 py-0.5 text-xs font-medium ${r.success ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                          {r.success ? "Pass" : "Fail"}
                        </span>
                      </>
                    ) : (() => {
                      const tiers = r.comparison?.tiers;
                      if (!tiers || tiers.length === 0 || !Array.isArray(tiers[0]) || tiers[0].length === 0) {
                        return (
                          <span className="rounded-md bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">
                            Not evaluated
                          </span>
                        );
                      }
                      
                      const overallHardFailuresById = r.comparison?.overall_hard_failures ?? null;

                      const hasHardFailures = (versionId: string): boolean => {
                        const overall = overallHardFailuresById?.[versionId];
                        if (Array.isArray(overall) && overall.length > 0) return true;
                        return false;
                      };

                      const topIds = new Set<string>((tiers[0] ?? []).map(String));
                      
                      // Sort the IDs so they appear in the same order as the versions (e.g., Version 1 & Version 2)
                      const versionEntries = r.evren_responses ?? [];
                      const topNames = Array.from(topIds)
                        .map(id => {
                          const idx = versionEntries.findIndex(v => v.version_id === id);
                          return { name: versionEntries[idx]?.version_name, idx };
                        })
                        .filter(item => item.name)
                        .sort((a, b) => a.idx - b.idx)
                        .map(item => item.name);

                      const anyFailedTop = Array.from(topIds).some((id) => hasHardFailures(id));

                      return topNames.length > 0 ? (
                        <span
                          className={`rounded-md px-2.5 py-0.5 text-xs font-medium ${
                            anyFailedTop ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {topNames.join(" & ")}
                        </span>
                      ) : (
                        <span className="rounded-md bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">
                          Not evaluated
                        </span>
                      );
                    })()}
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
                ) : isEvaluated ? (
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedResultId(r.eval_result_id);
                      setEditingReasonId(r.eval_result_id);
                      setEditReason(r.reason ?? "");
                      setEditScore(r.score);
                      setEditSuccess(r.success);
                    }}
                    className={editTriggerClassName}
                    title="Edit analysis"
                  >
                    <Pencil className="h-3.5 w-3.5 text-stone-500" strokeWidth={2} aria-hidden />
                    Edit
                  </button>
                ) : null}
              </div>
            </div>
            {isExpanded && (
            <div className="border-t border-stone-100 p-4 space-y-4">
              {(session.mode !== "comparison" || showComparatorMetrics) && isEvaluated && (
                <div className="rounded-lg border border-stone-200 bg-stone-50/40 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Tokens & cost</p>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-stone-700">
                    <span className="tabular-nums"><strong className="font-medium text-stone-800">In:</strong> {r.prompt_tokens ?? "—"}</span>
                    <span className="tabular-nums"><strong className="font-medium text-stone-800">Out:</strong> {r.completion_tokens ?? "—"}</span>
                    <span className="tabular-nums"><strong className="font-medium text-stone-800">Total:</strong> {r.total_tokens ?? (typeof r.prompt_tokens === "number" && typeof r.completion_tokens === "number" ? r.prompt_tokens + r.completion_tokens : "—")}</span>
                    <span className="text-stone-300" aria-hidden>|</span>
                    <span className="tabular-nums"><strong className="font-medium text-stone-800">Cost:</strong> {formatUsd(r.cost_usd, 6)}</span>
                    {usage && (
                      <>
                        <span className="tabular-nums text-stone-600">in {formatUsd(usage.input_cost_usd, 6)}</span>
                        <span className="tabular-nums text-stone-600">out {formatUsd(usage.output_cost_usd, 6)}</span>
                        <span className="text-stone-500">model {evaluatorModelName}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
              {(session.mode !== "comparison" || showComparatorMetrics) && !isEvaluated && compUsageRaw && (
                <div className="rounded-lg border border-stone-200 bg-stone-50/40 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Tokens & cost</p>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-stone-700">
                    <span className="tabular-nums"><strong className="font-medium text-stone-800">In:</strong> {compUsageRaw.prompt}</span>
                    <span className="tabular-nums"><strong className="font-medium text-stone-800">Out:</strong> {compUsageRaw.completion}</span>
                    <span className="tabular-nums"><strong className="font-medium text-stone-800">Total:</strong> {compUsageRaw.total}</span>
                    <span className="text-stone-300" aria-hidden>|</span>
                    <span className="tabular-nums"><strong className="font-medium text-stone-800">Cost:</strong> {formatUsd(compUsageRaw.costUsd, 6)}</span>
                    {compUsage && (
                      <>
                        <span className="tabular-nums text-stone-600">in {formatUsd(compUsage.input_cost_usd, 6)}</span>
                        <span className="tabular-nums text-stone-600">out {formatUsd(compUsage.output_cost_usd, 6)}</span>
                        <span className="text-stone-500">model {evaluatorModelName}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
              {r.test_cases && (
                <>
                  {/* Conversation: input / evren pairs */}
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Conversation</p>
                    <div className="mt-2 space-y-3">
                      {(() => {
                        const allVersions = Array.isArray(r.evren_responses)
                          ? (r.evren_responses as AnyVersionEntry[]).map(normalizeVersionEntry)
                          : [];
                        const versions = allVersions.slice(0, 3);
                        const turnCount = getTurnCount(versions);
                        const runsExpanded = expandedRunsKeys.has(r.eval_result_id);
                        const totalRunCount = Math.max(0, ...versions.map((v) => v.runs.length));
                        const versionMeta = versions.map((v) => `${v.version_name}: ${v.run_count_requested} run${v.run_count_requested === 1 ? "" : "s"} (${v.evidence_source})`).join(" · ");
                        if (turnCount === 0 && versions.length === 0) {
                          return (
                            <div className="space-y-2">
                              <div>
                                <p className="text-xs font-medium text-stone-500">input:</p>
                                <p className="mt-0.5 text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
                                  {r.test_cases?.type === "multi_turn" && r.test_cases?.turns?.[0] != null
                                    ? (r.test_cases.turns[0]?.trim() || "—")
                                    : (typeof r.test_cases?.input_message === "string" ? r.test_cases.input_message : "—")}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-medium text-stone-500">evren:</p>
                                <p className="mt-0.5 text-sm text-stone-700 leading-relaxed">—</p>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <>
                            {versionMeta && (
                              <p className="text-[11px] text-stone-500">{versionMeta}</p>
                            )}
                            {totalRunCount > 1 && (
                              <div className={versionMeta ? "mt-2" : ""}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedRunsKeys((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(r.eval_result_id)) next.delete(r.eval_result_id);
                                      else next.add(r.eval_result_id);
                                      return next;
                                    });
                                  }}
                                  className="inline-flex items-center gap-1 rounded border border-stone-200 bg-stone-50 px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100"
                                >
                                  <span className={`shrink-0 transition-transform ${runsExpanded ? "rotate-90" : ""}`} aria-hidden>▶</span>
                                  {runsExpanded ? "Collapse runs" : `Show all ${totalRunCount} runs`}
                                </button>
                              </div>
                            )}
                            {Array.from({ length: turnCount }, (_, i) => {
                          const flagsKey = `${r.eval_result_id}-${i}`;
                          const flagsExpanded = expandedFlagsKeys.has(flagsKey);
                          const hasFlags = versions.some((v) =>
                            v.runs.some((run) => run.turns[i]?.detected_flags?.trim())
                          );
                          const singleVersion = versions.length <= 1;
                          const singleRuns = versions[0]?.runs ?? [];
                          const singleRunsCollapsed = singleRuns.filter((run) => run.run_index === 1);
                          const displaySingleRuns = runsExpanded
                            ? singleRuns
                            : (singleRunsCollapsed.length > 0 ? singleRunsCollapsed : singleRuns.slice(0, 1));
                              return (
                            <div key={i} className="space-y-2">
                              <div>
                                <p className="text-xs font-medium text-stone-500">input:</p>
                                <p className="mt-0.5 text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
                                  {r.test_cases?.type === "multi_turn" && Array.isArray(r.test_cases?.turns) && r.test_cases.turns[i] != null
                                    ? (r.test_cases.turns[i]?.trim() || "—")
                                    : (typeof r.test_cases?.input_message === "string" ? r.test_cases.input_message : "—")}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-medium text-stone-500">evren:</p>
                                {singleVersion ? (
                                  <div className="mt-1 space-y-3">
                                    {displaySingleRuns.map((run) => {
                                      const turnData = run.turns[i];
                                      const bubbles = turnData?.response ?? [];
                                      return (
                                        <div key={run.run_id} className="rounded-lg border border-stone-200 bg-stone-50/80 px-3 py-2">
                                          <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                                            Run {run.run_index}
                                          </p>
                                          <div className="mt-1 space-y-2">
                                            {bubbles.length > 0 ? (
                                              bubbles.map((bubble, j) => (
                                                <blockquote
                                                  key={j}
                                                  className="border-l-2 border-stone-300 bg-white/80 pl-3 py-1.5 pr-2 text-sm text-stone-700 leading-relaxed whitespace-pre-wrap rounded-r"
                                                >
                                                  {bubble?.trim() || "—"}
                                                </blockquote>
                                              ))
                                            ) : (
                                              <blockquote className="border-l-2 border-stone-300 bg-white/80 pl-3 py-1.5 pr-2 text-sm text-stone-700 leading-relaxed whitespace-pre-wrap rounded-r">
                                                —
                                              </blockquote>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="mt-1 flex gap-2 overflow-x-auto flex-nowrap">
                                    {versions.map((ver) => {
                                      return (
                                        <div
                                          key={ver.version_id}
                                          className="flex-1 min-w-0 rounded-lg border border-stone-200 bg-stone-50/80 px-3 py-2"
                                        >
                                          <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                                            {ver.version_name}
                                          </p>
                                          <p className="mt-1 text-[11px] text-stone-500">
                                            Runs: {ver.run_count_requested} · Evidence: {ver.evidence_source}
                                          </p>
                                          <div className="mt-2 space-y-3">
                                            {(() => {
                                              const collapsedRuns = ver.runs.filter((run) => run.run_index === 1);
                                              const displayRuns = runsExpanded
                                                ? ver.runs
                                                : (collapsedRuns.length > 0 ? collapsedRuns : ver.runs.slice(0, 1));
                                              return displayRuns.map((run) => {
                                              const turnData = run.turns[i];
                                              const bubbles = turnData?.response ?? [];
                                              return (
                                                <div key={run.run_id}>
                                                  <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                                                    Run {run.run_index}
                                                  </p>
                                                  <div className="mt-1 space-y-2">
                                                    {bubbles.length > 0 ? (
                                                      bubbles.map((bubble, bubbleIdx) => (
                                                        <blockquote
                                                          key={bubbleIdx}
                                                          className="border-l-2 border-stone-300 bg-white/80 pl-3 py-1.5 pr-2 text-sm text-stone-700 leading-relaxed whitespace-pre-wrap rounded-r"
                                                        >
                                                          {bubble?.trim() || "—"}
                                                        </blockquote>
                                                      ))
                                                    ) : (
                                                      <blockquote className="border-l-2 border-stone-300 bg-white/80 pl-3 py-1.5 pr-2 text-sm text-stone-700 leading-relaxed whitespace-pre-wrap rounded-r">
                                                        —
                                                      </blockquote>
                                                    )}
                                                  </div>
                                                </div>
                                              );
                                              });
                                            })()}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                {hasFlags && (
                                  <div className="mt-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedFlagsKeys((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(flagsKey)) next.delete(flagsKey);
                                          else next.add(flagsKey);
                                          return next;
                                        });
                                      }}
                                      className="inline-flex items-center gap-1 rounded border border-stone-200 bg-stone-50 px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100"
                                    >
                                      <span className={`shrink-0 transition-transform ${flagsExpanded ? "rotate-90" : ""}`} aria-hidden>▶</span>
                                      Detected flags
                                    </button>
                                    {flagsExpanded && (
                                      <div className="mt-2">
                                        {singleVersion ? (
                                          <div className="space-y-2">
                                            {displaySingleRuns.map((run) => (
                                              <div key={run.run_id} className="rounded-lg border border-stone-200 bg-white px-3 py-2">
                                                <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                                                  Run {run.run_index}
                                                </p>
                                                <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-stone-700 font-mono">
                                                  {prettyDetectedFlags(run.turns[i]?.detected_flags ?? "")}
                                                </pre>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
                                            {versions.map((ver) => (
                                              <div
                                                key={ver.version_id}
                                                className="flex-1 min-w-[260px] rounded-lg border border-stone-200 bg-white px-3 py-2"
                                              >
                                                <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                                                  {ver.version_name}
                                                </p>
                                                <div className="mt-1 space-y-2">
                                                  {(() => {
                                                    const collapsedRuns = ver.runs.filter((run) => run.run_index === 1);
                                                    const displayRuns = runsExpanded
                                                      ? ver.runs
                                                      : (collapsedRuns.length > 0 ? collapsedRuns : ver.runs.slice(0, 1));
                                                    return displayRuns.map((run) => (
                                                      <div key={run.run_id}>
                                                        <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                                                          Run {run.run_index}
                                                        </p>
                                                        <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-stone-700 font-mono">
                                                          {prettyDetectedFlags(run.turns[i]?.detected_flags ?? "")}
                                                        </pre>
                                                      </div>
                                                    ));
                                                  })()}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                              );
                            })}
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {/* ---- */}
                  <hr className="border-stone-200" />

                  {/* 3. Expected behaviour */}
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Expected behaviour</p>
                    <p className="mt-1 text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
                      {typeof r.test_cases.expected_behavior === "string" && r.test_cases.expected_behavior.trim() ? r.test_cases.expected_behavior : "—"}
                    </p>
                  </div>
                  {/* 4. Expected flags */}
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Expected flags</p>
                    <p className="mt-1 text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
                      {typeof r.test_cases.expected_state === "string" && r.test_cases.expected_state.trim() ? r.test_cases.expected_state : "—"}
                    </p>
                  </div>

                  {(() => {
                    const reviewVersions = (Array.isArray(r.evren_responses) ? r.evren_responses : [])
                      .slice(0, 3)
                      .map((v) => normalizeVersionEntry(v as AnyVersionEntry));
                    if (reviewVersions.length === 0) return null;
                    return (
                      <>
                        <hr className="border-stone-200" />
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Behavior review</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  clearBehaviorReview(r);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
                              >
                                <Eraser className="h-3 w-3" />
                                Clear
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void saveBehaviorReview(r);
                                }}
                                disabled={
                                  savingBehaviorReviewId === r.eval_result_id ||
                                  savedBehaviorReviewId === r.eval_result_id
                                }
                                className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 ${
                                  savingBehaviorReviewId === r.eval_result_id
                                    ? "bg-stone-700"
                                    : savedBehaviorReviewId === r.eval_result_id
                                      ? "bg-emerald-600"
                                      : "bg-stone-900 hover:bg-stone-800"
                                }`}
                              >
                                {savingBehaviorReviewId === r.eval_result_id
                                  ? "Saving…"
                                  : savedBehaviorReviewId === r.eval_result_id
                                    ? "Saved"
                                    : "Save review"}
                              </button>
                            </div>
                          </div>
                          {/* Mobile: keep cards (tables get cramped). */}
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:hidden">
                            {reviewVersions.map((ver) => (
                              <div
                                key={ver.version_id}
                                className="min-w-0 rounded-lg border border-stone-200 bg-stone-50/80 px-3 py-3"
                              >
                                <p className="text-xs font-medium text-stone-700">{ver.version_name}</p>
                                <div className="mt-2 space-y-2">
                                  {BEHAVIOR_REVIEW_DIMENSIONS.map((dim) => {
                                    const draft = getBehaviorReviewDraft(r, ver.version_id, behaviorReviewDraft);
                                    const val = draft[dim.key];
                                    const selectVal = val === "pass" || val === "fail" || val === "na" ? val : "";
                                    const conf = draft.confidence?.[dim.key as BehaviorReviewDimensionKey] as BehaviorReviewConfidence | null | undefined;
                                    const confColor = conf === "high" ? "bg-emerald-400" : conf === "medium" ? "bg-amber-400" : conf === "low" ? "bg-red-400" : null;
                                    return (
                                      <div key={dim.key} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm text-stone-700">{dim.label}</span>
                                            <span className="relative inline-flex">
                                              <span
                                                role="img"
                                                aria-label={`${dim.label} help`}
                                                tabIndex={0}
                                                className="peer inline-flex h-4 w-4 items-center justify-center rounded-full border border-stone-300 bg-white text-[11px] font-semibold leading-none text-stone-600 cursor-help select-none focus:outline-none focus:ring-2 focus:ring-stone-300"
                                              >
                                                ?
                                              </span>
                                              <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-72 -translate-x-1/2 rounded-md border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 shadow-lg opacity-0 transition-opacity duration-75 peer-hover:opacity-100 peer-focus:opacity-100">
                                                {dim.hint}
                                              </span>
                                            </span>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <select
                                            value={selectVal}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                              const raw = e.target.value;
                                              const nextRating: BehaviorReviewRating | null =
                                                raw === "pass" || raw === "fail" || raw === "na" ? raw : null;
                                              setBehaviorReviewDraft((prev) => {
                                                const rid = r.eval_result_id;
                                                const cur = getBehaviorReviewDraft(r, ver.version_id, prev);
                                                const updated: VersionBehaviorReview = { ...cur, [dim.key]: nextRating };
                                                return {
                                                  ...prev,
                                                  [rid]: {
                                                    ...(prev[rid] ?? {}),
                                                    [ver.version_id]: updated,
                                                  },
                                                };
                                              });
                                            }}
                                            className="rounded-md border border-stone-200 bg-white px-2 py-1 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                                          >
                                            <option value="">—</option>
                                            <option value="pass">Pass</option>
                                            <option value="fail">Fail</option>
                                            <option value="na">N/A</option>
                                          </select>
                                          {confColor && (
                                            <span
                                              title={`AI confidence: ${conf}`}
                                              className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${confColor}`}
                                            />
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                <div className="mt-2">
                                  <label className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                                    Notes (optional)
                                  </label>
                                  <textarea
                                    rows={2}
                                    value={getBehaviorReviewDraft(r, ver.version_id, behaviorReviewDraft).notes ?? ""}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      const text = e.target.value;
                                      setBehaviorReviewDraft((prev) => {
                                        const rid = r.eval_result_id;
                                        const cur = getBehaviorReviewDraft(r, ver.version_id, prev);
                                        const updated: VersionBehaviorReview = { ...cur, notes: text || null };
                                        return {
                                          ...prev,
                                          [rid]: {
                                            ...(prev[rid] ?? {}),
                                            [ver.version_id]: updated,
                                          },
                                        };
                                      });
                                    }}
                                    placeholder="Short context for this version…"
                                    className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 leading-relaxed focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Desktop: matrix (rows=versions, columns=dimensions). */}
                          <div className="mt-3 hidden sm:block">
                            <div className="rounded-lg border border-stone-200 bg-white">
                              <table className="w-full table-fixed border-separate border-spacing-0">
                                <thead className="bg-stone-50/80">
                                  <tr>
                                    <th
                                      scope="col"
                                      className="sticky left-0 z-10 w-[140px] border-b border-stone-200 bg-stone-50/80 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-stone-500"
                                    >
                                      Version
                                    </th>
                                    {BEHAVIOR_REVIEW_DIMENSIONS.map((dim) => (
                                      <th
                                        key={dim.key}
                                        scope="col"
                                        className="border-b border-stone-200 px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-stone-500"
                                      >
                                        <span className="inline-flex items-center gap-2">
                                          <span className="leading-tight">{dim.label}</span>
                                          <span className="relative inline-flex">
                                            <span
                                              role="img"
                                              aria-label={`${dim.label} help`}
                                              tabIndex={0}
                                              className="peer inline-flex h-4 w-4 items-center justify-center rounded-full border border-stone-300 bg-white text-[11px] font-semibold leading-none text-stone-600 cursor-help select-none focus:outline-none focus:ring-2 focus:ring-stone-300"
                                            >
                                              ?
                                            </span>
                                            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-72 -translate-x-1/2 rounded-md border border-stone-200 bg-white px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-stone-700 shadow-lg opacity-0 transition-opacity duration-75 peer-hover:opacity-100 peer-focus:opacity-100">
                                              {dim.hint}
                                            </span>
                                          </span>
                                        </span>
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-200">
                                  {reviewVersions.map((ver) => (
                                    <tr key={ver.version_id} className="bg-white">
                                      <th
                                        scope="row"
                                        className="sticky left-0 z-10 border-b border-stone-200 bg-white px-3 py-2 text-left text-sm font-medium text-stone-700"
                                      >
                                        {ver.version_name}
                                      </th>
                                      {BEHAVIOR_REVIEW_DIMENSIONS.map((dim) => {
                                        const draft = getBehaviorReviewDraft(r, ver.version_id, behaviorReviewDraft);
                                        const val = draft[dim.key];
                                        const selectVal = val === "pass" || val === "fail" || val === "na" ? val : "";
                                        const conf = draft.confidence?.[dim.key as BehaviorReviewDimensionKey] as BehaviorReviewConfidence | null | undefined;
                                        const confColor = conf === "high" ? "bg-emerald-400" : conf === "medium" ? "bg-amber-400" : conf === "low" ? "bg-red-400" : null;
                                        return (
                                          <td key={dim.key} className="border-b border-stone-200 px-2 py-2 align-top">
                                            <div className="flex items-center gap-1">
                                              <select
                                                value={selectVal}
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={(e) => {
                                                  const raw = e.target.value;
                                                  const nextRating: BehaviorReviewRating | null =
                                                    raw === "pass" || raw === "fail" || raw === "na" ? raw : null;
                                                  setBehaviorReviewDraft((prev) => {
                                                    const rid = r.eval_result_id;
                                                    const cur = getBehaviorReviewDraft(r, ver.version_id, prev);
                                                    const updated: VersionBehaviorReview = { ...cur, [dim.key]: nextRating };
                                                    return {
                                                      ...prev,
                                                      [rid]: {
                                                        ...(prev[rid] ?? {}),
                                                        [ver.version_id]: updated,
                                                      },
                                                    };
                                                  });
                                                }}
                                                className="w-full min-w-0 rounded-md border border-stone-200 bg-white px-2 py-1 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                                              >
                                                <option value="">—</option>
                                                <option value="pass">Pass</option>
                                                <option value="fail">Fail</option>
                                                <option value="na">N/A</option>
                                              </select>
                                              {confColor && (
                                                <span
                                                  title={`AI confidence: ${conf}`}
                                                  className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${confColor}`}
                                                />
                                              )}
                                            </div>
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-3">
                              {reviewVersions.map((ver) => (
                                <div key={ver.version_id} className="rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
                                    {ver.version_name} notes (optional)
                                  </p>
                                  <textarea
                                    rows={2}
                                    value={getBehaviorReviewDraft(r, ver.version_id, behaviorReviewDraft).notes ?? ""}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      const text = e.target.value;
                                      setBehaviorReviewDraft((prev) => {
                                        const rid = r.eval_result_id;
                                        const cur = getBehaviorReviewDraft(r, ver.version_id, prev);
                                        const updated: VersionBehaviorReview = { ...cur, notes: text || null };
                                        return {
                                          ...prev,
                                          [rid]: {
                                            ...(prev[rid] ?? {}),
                                            [ver.version_id]: updated,
                                          },
                                        };
                                      });
                                    }}
                                    placeholder="Short context for this version…"
                                    className="mt-1 block w-full rounded-md border border-stone-200 bg-white px-2 py-1 text-sm text-stone-900 leading-relaxed focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })()}

                  {isEvaluated && (
                    <>
                      <hr className="border-stone-200" />
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
                          <div className="mt-1 space-y-3">
                            {(r.reason ?? "—")
                              .split(/\n\n+/)
                              .map((para, i) => (
                                <p key={i} className="text-sm text-stone-600 leading-relaxed">
                                  {para.trim() || (i === 0 ? "—" : null)}
                                </p>
                              ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {r.comparison && Array.isArray(r.comparison.tiers) && r.comparison.tiers.length > 0 && (() => {
                    const tiers = r.comparison!.tiers.map((t) => (Array.isArray(t) ? t.map(String) : [])).filter((t) => t.length > 0);
                    const ranking = tiers.flat().slice(0, 3);
                    if (ranking.length < 2) return null;

                    const overallReasonText = String(r.comparison!.overall_reason ?? "").trim();
                    const overallHardFailures = r.comparison!.overall_hard_failures ?? {};

                    const tierIndexById = new Map<string, number>();
                    for (let i = 0; i < tiers.length; i++) {
                      for (const vid of tiers[i] ?? []) tierIndexById.set(String(vid), i);
                    }

                    const topTier = tiers[0] ?? [];
                    const hasSingleWinner = topTier.length === 1;
                    const winnerId = hasSingleWinner ? topTier[0] : null;

                    const hasOverallFailure = (vid: string): boolean => {
                      const list = overallHardFailures?.[vid];
                      return Array.isArray(list) && list.length > 0;
                    };

                    return (
                      <>
                        <hr className="border-stone-200" />
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Version comparison</p>
                              <p className="text-[11px] text-stone-500">Comparison basis: Run 1</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {aiEditingComparisonId === r.eval_result_id ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => applyAiComparisonEdits(r)}
                                    disabled={applyingAiComparison}
                                    className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-800 disabled:opacity-50"
                                    title="Apply (Cmd/Ctrl+Enter)"
                                  >
                                    {applyingAiComparison ? "Applying…" : "Apply"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setAiEditingComparisonId(null); setAiComparisonFeedback(""); }}
                                    disabled={applyingAiComparison}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAiEditingComparisonId(r.eval_result_id);
                                    setAiComparisonFeedback("");
                                  }}
                                  className={editTriggerClassName}
                                  title="AI edit comparison"
                                >
                                  <Pencil className="h-3.5 w-3.5 text-stone-500" strokeWidth={2} aria-hidden />
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>

                          {aiEditingComparisonId === r.eval_result_id && (
                            <div className="mt-2 rounded-md border border-stone-200 bg-white px-3 py-2">
                              <textarea
                                rows={2}
                                value={aiComparisonFeedback}
                                onChange={(e) => setAiComparisonFeedback(e.target.value)}
                                onKeyDown={(e) => {
                                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                    e.preventDefault();
                                    void applyAiComparisonEdits(r);
                                  }
                                }}
                                placeholder='E.g. "2 > 3 = 1, and no hard failures. Update the reason accordingly."'
                                className="block w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 leading-relaxed focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                                disabled={applyingAiComparison}
                              />
                            </div>
                          )}

                          <div className="mt-2 flex items-center gap-2">
                            {ranking.map((vId: string) => {
                              const tierIdx = tierIndexById.get(vId) ?? 0;
                              const rank = tierIdx + 1;
                              const isChampion = rank === 1 && hasSingleWinner && winnerId === vId;
                              const isFailed = hasOverallFailure(vId);
                              return (
                                <span
                                  key={vId}
                                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium ${
                                    isFailed
                                      ? "bg-red-100 text-red-800 border border-red-200"
                                      : isChampion
                                        ? "bg-amber-100 text-amber-800 border border-amber-200"
                                        : "bg-stone-100 text-stone-600 border border-stone-200"
                                  }`}
                                >
                                  <span className="text-xs font-bold">#{rank}</span>
                                  {getVersionLabel(vId)}
                                  {isChampion && (
                                    <span className={`${isFailed ? "text-red-700" : "text-amber-600"} text-xs`}>★</span>
                                  )}
                                </span>
                              );
                            })}
                          </div>

                          {overallReasonText && (
                            <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50/80 px-3 py-2">
                              <div className="flex items-center gap-2 text-xs text-stone-500">
                                <span className="font-medium text-stone-700">Overall comparison</span>
                                <span className="text-stone-300">→</span>
                                {winnerId == null ? (
                                  <span className="font-semibold text-stone-600">Tie</span>
                                ) : (
                                  <span
                                    className={`font-semibold ${
                                      hasOverallFailure(winnerId) ? "text-red-700" : "text-emerald-700"
                                    }`}
                                  >
                                    {getVersionLabel(winnerId)} wins
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-sm text-stone-600 leading-relaxed">{overallReasonText}</p>
                            </div>
                          )}

                          {ranking.some((vid) => hasOverallFailure(vid)) && (
                            <div className="mt-2 rounded-lg border border-red-200 bg-red-50/70 px-3 py-2">
                              <p className="text-xs font-medium uppercase tracking-wide text-red-700">Hard failures</p>
                              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                {(() => {
                                  const ordered = (r.evren_responses ?? [])
                                    .slice(0, 3)
                                    .map((v) => v.version_id)
                                    .filter((vid: string) => ranking.includes(vid));
                                  const seen = new Set<string>();
                                  const ids = [...ordered, ...ranking].filter((vid) => {
                                    if (seen.has(vid)) return false;
                                    seen.add(vid);
                                    return true;
                                  });
                                  return ids;
                                })().map((vid: string) => {
                                  const failures = overallHardFailures[vid] ?? [];
                                  return (
                                    <div key={vid} className="rounded-lg border border-red-200 bg-white/70 px-3 py-2">
                                      <p className="text-[11px] font-medium uppercase tracking-wide text-red-700">
                                        {getVersionLabel(vid)}
                                      </p>
                                      {failures.length > 0 ? (
                                        <ul className="mt-1.5 space-y-1 text-xs text-red-700">
                                          {failures.map((f: string, fi: number) => (
                                            <li key={fi}>{f}</li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p className="mt-1.5 text-xs text-stone-500">—</p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </>
              )}
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
