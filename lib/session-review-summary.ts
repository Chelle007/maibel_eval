import type { Json } from "@/lib/db.types";

export const SESSION_REVIEW_FAILURE_TAXONOMY = [
  { key: "flagging_mismatch", label: "Flagging mismatch (missed/false trigger)" },
  { key: "distress_gating", label: "Distress gating failure (didn’t intervene / over-intervened)" },
  { key: "forbidden_content", label: "Forbidden content / boundary violation" },
  { key: "over_fixing", label: "Over-fixing / advice-giving instead of witnessing" },
  { key: "robotic_or_scripted", label: "Robotic / scripted tone" },
  { key: "missed_emotion", label: "Missed emotion / low attunement" },
  { key: "continuity_break", label: "Continuity break / incoherence" },
  { key: "repetition_loops", label: "Repetition / stuck loops" },
  { key: "unsafe_implication", label: "Unsafe implication / trust breach" },
] as const;

export type SessionReviewFailureThemeKey =
  (typeof SESSION_REVIEW_FAILURE_TAXONOMY)[number]["key"];

export type SessionOverallFinding = "deterministic" | "likely_variable" | "unclear";
export type SessionTrustSeverity = "high" | "medium" | "low";
export type SessionRecommendation = "ship" | "hold" | "investigate";

export type SessionReviewSummaryV0 = {
  goal: string | null;
  cases_versions_tested: string | null;
  pass_fail_summary: string | null;
  overall_finding: SessionOverallFinding | null;
  top_failure_themes: SessionReviewFailureThemeKey[];
  trust_severity: SessionTrustSeverity | null;
  recommendation: SessionRecommendation | null;
  needs_confirmation: string | null;
};

export function emptySessionReviewSummaryV0(): SessionReviewSummaryV0 {
  return {
    goal: null,
    cases_versions_tested: null,
    pass_fail_summary: null,
    overall_finding: null,
    top_failure_themes: [],
    trust_severity: null,
    recommendation: null,
    needs_confirmation: null,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function normalizeText(val: unknown): string | null | "invalid" {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val !== "string") return "invalid";
  const v = val.trim();
  if (!v) return null;
  if (v.length > 6000) return "invalid";
  return v;
}

function normalizeEnum<T extends string>(val: unknown, allowed: readonly T[]): T | null | "invalid" {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val !== "string") return "invalid";
  const raw = val.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const allowedArr = allowed as readonly string[];
  if (allowedArr.includes(lower)) return lower as T;
  const slug = lower.replace(/[\s/-]+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (allowedArr.includes(slug)) return slug as T;
  return "invalid";
}

export function parseSessionReviewSummaryV0(raw: unknown): SessionReviewSummaryV0 {
  if (!isPlainObject(raw)) return emptySessionReviewSummaryV0();
  const out = emptySessionReviewSummaryV0();

  const goal = normalizeText(raw.goal);
  if (goal !== "invalid") out.goal = goal;

  const casesVersions = normalizeText(raw.cases_versions_tested);
  if (casesVersions !== "invalid") out.cases_versions_tested = casesVersions;

  const passFail = normalizeText(raw.pass_fail_summary);
  if (passFail !== "invalid") out.pass_fail_summary = passFail;

  const overall = normalizeEnum(raw.overall_finding, ["deterministic", "likely_variable", "unclear"] as const);
  if (overall !== "invalid") out.overall_finding = overall;

  const severity = normalizeEnum(raw.trust_severity, ["high", "medium", "low"] as const);
  if (severity !== "invalid") out.trust_severity = severity;

  const rec = normalizeEnum(raw.recommendation, ["ship", "hold", "investigate"] as const);
  if (rec !== "invalid") out.recommendation = rec;

  const needs = normalizeText(raw.needs_confirmation);
  if (needs !== "invalid") out.needs_confirmation = needs;

  const allowedThemes = new Set<string>(SESSION_REVIEW_FAILURE_TAXONOMY.map((t) => t.key));
  const themesRaw = raw.top_failure_themes;
  if (Array.isArray(themesRaw)) {
    const themes: SessionReviewFailureThemeKey[] = [];
    for (const entry of themesRaw) {
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim();
      const lowerUnderscore = trimmed
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      const k =
        allowedThemes.has(trimmed) ? trimmed : allowedThemes.has(lowerUnderscore) ? lowerUnderscore : null;
      if (!k) continue;
      themes.push(k as SessionReviewFailureThemeKey);
      if (themes.length >= 8) break;
    }
    out.top_failure_themes = Array.from(new Set(themes));
  }

  return out;
}

export function validateSessionReviewSummaryV0Payload(raw: unknown): SessionReviewSummaryV0 | null {
  if (!isPlainObject(raw)) return null;
  const parsed = parseSessionReviewSummaryV0(raw);
  // Reject if unknown keys appear with non-empty values? Keep permissive for v0.
  return parsed;
}

export function toSessionReviewSummaryJson(v: SessionReviewSummaryV0): Json {
  return v as unknown as Json;
}

/**
 * When the model omits enum fields, fill so the UI always has overall_finding, trust_severity,
 * and recommendation. Comparison-mode DB rows often use success placeholders, so we use neutral
 * defaults there; single-mode uses per-case success when available.
 */
export function fillMissingSessionReviewEnumsFromEvalRows(
  summary: SessionReviewSummaryV0,
  evalRows: { success: boolean }[],
  sessionMode: "single" | "comparison"
): SessionReviewSummaryV0 {
  if (evalRows.length === 0) return summary;
  const out: SessionReviewSummaryV0 = { ...summary };

  if (sessionMode === "comparison") {
    if (out.overall_finding == null) out.overall_finding = "unclear";
    if (out.trust_severity == null) out.trust_severity = "medium";
    if (out.recommendation == null) out.recommendation = "hold";
    return out;
  }

  const passed = evalRows.filter((r) => r.success).length;
  const total = evalRows.length;
  if (out.overall_finding == null) {
    if (passed === total) out.overall_finding = "deterministic";
    else if (passed === 0) out.overall_finding = "likely_variable";
    else out.overall_finding = "unclear";
  }
  if (out.trust_severity == null) {
    out.trust_severity = passed < total ? "medium" : "low";
  }
  if (out.recommendation == null) {
    if (passed === total) out.recommendation = "ship";
    else if (passed === 0) out.recommendation = "investigate";
    else out.recommendation = "hold";
  }
  return out;
}

