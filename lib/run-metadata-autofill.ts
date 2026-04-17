import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunMetadata } from "@/lib/db.types";

export type AutofillSessionMode = "single" | "comparison";

/**
 * Infer environment from Evren URL, git ref, and host (TASK-022 labels).
 * `auto-eval` when the deployed/ref branch is `auto-eval` (non-local Evren only).
 */
export function inferEnvironment(evrenModelApiUrl: string): string {
  const u = evrenModelApiUrl.toLowerCase();
  if (u.includes("localhost") || u.includes("127.0.0.1")) return "local";
  const ref = (
    process.env.VERCEL_GIT_COMMIT_REF?.trim() ||
    process.env.GITHUB_REF_NAME?.trim() ||
    process.env.CI_COMMIT_REF_NAME?.trim() ||
    process.env.COMMIT_REF?.trim() ||
    ""
  ).toLowerCase();
  if (ref === "auto-eval") return "auto-eval";
  if (process.env.VERCEL_ENV === "production") return "main";
  return "staging";
}

/** Best-effort public URL for this eval app deployment (Vercel). */
export function inferDeployUrlFromEnv(): string | null {
  const raw = process.env.VERCEL_URL?.trim();
  if (!raw) return null;
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

/**
 * Human-readable run mode for metadata.
 * Always includes both dimensions:
 * - repeat: single-run vs repeated-run
 * - turns: single-turn vs multi-turn
 */
export function inferRunMode(
  sessionMode: AutofillSessionMode,
  runCount: number,
  hasMultiTurnCase: boolean
): string {
  const repeat = runCount > 1 ? "repeated-run" : "single-run";
  const turns = hasMultiTurnCase ? "multi-turn" : "single-turn";
  // Session mode (single vs comparison) is already captured elsewhere (session.mode + model fields),
  // so keep run_mode focused on repeat/turn dimensions.
  return `${repeat}, ${turns}`;
}

/**
 * Best-effort deploy / repo pointer from common CI and Vercel env vars.
 * Returns null when running locally with no CI (expected for dev machines).
 */
const CODE_SOURCE_APPEND_SEP = " • ";

function splitCodeSourceSegments(value: string): string[] {
  return value.split(/\s*•\s*/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Append a new Evren `code_source` line when adding a version, keeping prior values.
 * Uses " • " between entries and skips duplicate segments (same string as an existing chunk).
 * Truncates to 1000 chars to match `validateRunMetadata`.
 */
export function appendDistinctCodeSourceSegment(
  existing: string | null | undefined,
  segment: string | null | undefined
): string | null {
  const add = typeof segment === "string" ? segment.trim() : "";
  const prevFull = typeof existing === "string" ? existing.trim() : "";
  if (!add) return prevFull ? prevFull.slice(0, 1000) : null;
  if (!prevFull) return add.slice(0, 1000);
  const parts = splitCodeSourceSegments(prevFull);
  if (parts.some((p) => p === add)) return prevFull.slice(0, 1000);
  const merged = `${prevFull}${CODE_SOURCE_APPEND_SEP}${add}`;
  return merged.slice(0, 1000);
}

export function inferCodeSourceFromEnv(): string | null {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.CI_COMMIT_SHA?.trim() ||
    process.env.COMMIT_SHA?.trim() ||
    "";
  const ref =
    process.env.VERCEL_GIT_COMMIT_REF?.trim() ||
    process.env.GITHUB_REF_NAME?.trim() ||
    process.env.CI_COMMIT_REF_NAME?.trim() ||
    process.env.COMMIT_REF?.trim() ||
    "";
  const shortSha = sha.slice(0, 7);
  if (ref && shortSha) return `${ref} @ ${shortSha}`;
  if (shortSha) return shortSha;
  if (ref) return ref;
  return null;
}

/**
 * Comma-separated unique category names for enabled cases in this run (sorted).
 */
export async function inferTestCategoryFromCases(
  supabase: SupabaseClient,
  testCasesRows: { category_id: string | null }[]
): Promise<string | null> {
  const ids = [...new Set(testCasesRows.map((r) => r.category_id).filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return null;
  const { data, error } = await supabase
    .from("categories")
    .select("name")
    .in("category_id", ids)
    .is("deleted_at", null);
  if (error || !data?.length) return null;
  const names = [...new Set(data.map((r) => r.name).filter(Boolean))].sort();
  return names.length ? names.join(", ") : null;
}

export interface BuildAutofillRunMetadataOpts {
  sessionMode: AutofillSessionMode;
  runCount: number;
  evaluatorModel: string;
  summarizerModel: string;
}

export async function buildAutofillRunMetadata(
  supabase: SupabaseClient,
  evrenModelApiUrl: string,
  testCasesRows: { category_id: string | null; type?: string | null }[],
  opts: BuildAutofillRunMetadataOpts
): Promise<RunMetadata> {
  const environment = inferEnvironment(evrenModelApiUrl);
  const code_source = inferCodeSourceFromEnv();
  const deploy_url = inferDeployUrlFromEnv();
  const test_category = await inferTestCategoryFromCases(supabase, testCasesRows);
  const hasMultiTurnCase = testCasesRows.some((r) => (r.type ?? "single_turn") === "multi_turn");
  const run_mode = inferRunMode(opts.sessionMode, opts.runCount, hasMultiTurnCase);
  const sample_size = String(opts.runCount);
  const repeated_runs_evidence = opts.runCount > 1 ? "automated" : "none";

  const base: RunMetadata = {
    environment,
    run_mode,
    sample_size,
    ...(code_source ? { code_source } : {}),
    ...(deploy_url ? { deploy_url } : {}),
    ...(test_category ? { test_category } : {}),
    ...(repeated_runs_evidence ? { repeated_runs_evidence } : {}),
  };

  if (opts.sessionMode === "comparison") {
    return {
      ...base,
      // In comparison sessions, this model powers dimension review / comparisons.
      evaluator_model: opts.evaluatorModel,
      // Session summary model is optional; default to the same model unless overridden upstream.
      summarizer_model: opts.summarizerModel,
    };
  }

  return {
    ...base,
    evaluator_model: opts.evaluatorModel,
    summarizer_model: opts.summarizerModel,
  };
}
