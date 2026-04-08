import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunMetadata } from "@/lib/db.types";

/**
 * Infer local vs staging vs production from Evren URL and host environment.
 */
export function inferEnvironment(evrenModelApiUrl: string): string {
  const u = evrenModelApiUrl.toLowerCase();
  if (u.includes("localhost") || u.includes("127.0.0.1")) return "local";
  if (process.env.VERCEL_ENV === "production") return "production";
  return "staging";
}

/**
 * Best-effort deploy / repo pointer from common CI and Vercel env vars.
 * Returns null when running locally with no CI (expected for dev machines).
 */
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

export async function buildAutofillRunMetadata(
  supabase: SupabaseClient,
  evrenModelApiUrl: string,
  testCasesRows: { category_id: string | null }[]
): Promise<RunMetadata> {
  const environment = inferEnvironment(evrenModelApiUrl);
  const code_source = inferCodeSourceFromEnv();
  const test_category = await inferTestCategoryFromCases(supabase, testCasesRows);
  return {
    environment,
    ...(code_source ? { code_source } : {}),
    ...(test_category ? { test_category } : {}),
  };
}
