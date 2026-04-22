import { loadContextPack } from "@/lib/context-pack";
import type { Database } from "@/lib/db.types";
import { fingerprintEvalResultsComparisons } from "@/lib/session-review-summary-basis";
import {
  draftSessionReviewSummary,
  extractSessionVersionEntriesFromEvalRows,
} from "@/lib/session-review-summary-drafter";
import { toSessionReviewSummaryJson, type SessionReviewSummaryV0 } from "@/lib/session-review-summary";
import type { TokenUsage } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type SummaryRow = {
  eval_result_id?: string | number;
  success: boolean;
  score: number;
  reason: string | null;
  comparison: unknown;
  behavior_review: unknown;
  test_cases: { test_case_id?: string; title?: string | null } | null;
};

export function mapEvalSummaryRowsToEvalRows(
  evalSummaryRows: Array<SummaryRow & { evren_responses?: unknown }>
) {
  return evalSummaryRows.map((row) => {
    const tc = row.test_cases;
    return {
      test_case_id: typeof tc?.test_case_id === "string" ? tc.test_case_id : "unknown",
      title: tc?.title ?? null,
      success: Boolean(row.success),
      score: Number(row.score) || 0,
      reason: typeof row.reason === "string" ? row.reason : null,
      comparison: row.comparison ?? null,
      behavior_review: row.behavior_review ?? null,
    };
  });
}

function looksLikeUuidText(s: string): boolean {
  // UUIDv4-ish: 8-4-4-4-12 hex
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s);
}

function computeCasesVersionsTestedFromVersionEntries(args: {
  versionEntries?: Array<{ version_id: string; version_name: string }>;
  evalRowCount: number;
}): string | null {
  const vers = (args.versionEntries ?? [])
    .map((v) => String(v.version_name ?? "").trim())
    .filter(Boolean);
  const versionsText = vers.length ? vers.join(", ") : null;
  if (args.evalRowCount > 0 && versionsText) return `${args.evalRowCount} cases; versions: ${versionsText}`;
  if (versionsText) return `versions: ${versionsText}`;
  return null;
}

/**
 * Load eval_results + draft session review summary (no DB write). Used by evaluate/run and add-version refresh.
 */
export async function draftSessionReviewSummaryForSessionData(
  supabase: SupabaseClient<Database>,
  args: {
    sessionId: string;
    sessionMode: "single" | "comparison";
    sessionTitle: string | null;
    sessionSummary: string | null;
    apiKey: string;
    modelName?: string;
    logPrefix?: string;
  }
): Promise<{
  summary: SessionReviewSummaryV0;
  token_usage?: TokenUsage;
  comparisonBasisFingerprint: string;
} | null> {
  const errLog = (msg: string) =>
    console.error(`${args.logPrefix ?? "[session-review-summary]"} ${msg}`);

  const { data: evalSummaryRows, error: evalSummaryErr } = await supabase
    .from("eval_results")
    .select("*, test_cases(test_case_id, title)")
    .eq("session_id", args.sessionId);

  if (evalSummaryErr) {
    errLog(`query failed: ${evalSummaryErr.message}`);
    return null;
  }
  if (!evalSummaryRows?.length) {
    return null;
  }

  const rows = evalSummaryRows as Array<SummaryRow & { evren_responses?: unknown }>;
  const comparisonBasisFingerprint = fingerprintEvalResultsComparisons(rows);
  const evalRows = mapEvalSummaryRowsToEvalRows(rows);
  const versionEntries =
    args.sessionMode === "comparison"
      ? extractSessionVersionEntriesFromEvalRows(rows)
      : undefined;

  const summaryCtxPack = loadContextPack({
    purpose: "evaluator",
    query: `${args.sessionTitle ?? ""}\n${args.sessionSummary ?? ""}\n`.trim() || "session review summary",
  });

  try {
    const drafted = await draftSessionReviewSummary({
      sessionMode: args.sessionMode,
      sessionTitle: args.sessionTitle,
      sessionSummary: args.sessionSummary,
      evalRows,
      versionEntries,
      apiKey: args.apiKey,
      modelName: args.modelName,
      contextPack: { text: summaryCtxPack.text, bundleId: summaryCtxPack.bundleId },
    });
    if (drafted?.summary) {
      const suggested = computeCasesVersionsTestedFromVersionEntries({
        versionEntries,
        evalRowCount: evalRows.length,
      });
      const current = drafted.summary.cases_versions_tested;
      if (suggested && (current == null || looksLikeUuidText(current))) {
        drafted.summary.cases_versions_tested = suggested;
      }
    }
    if (!drafted?.summary) return null;
    return { ...drafted, comparisonBasisFingerprint };
  } catch (e) {
    errLog(`draft failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * After add-version (or any eval update): re-draft and persist session_review_summary + bump total_cost_usd.
 */
export async function persistSessionReviewSummaryForSession(
  supabase: SupabaseClient<Database>,
  args: {
    sessionId: string;
    sessionMode: "single" | "comparison";
    sessionTitle: string | null;
    sessionSummary: string | null;
    apiKey: string;
    modelName?: string;
    /** If omitted, reads current total_cost_usd from DB before adding draft cost */
    totalCostUsdBeforeDraft?: number;
    logPrefix?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  const log = (msg: string) => console.log(`${args.logPrefix ?? "[session-review-summary]"} ${msg}`);
  const warn = (msg: string) => console.warn(`${args.logPrefix ?? "[session-review-summary]"} ${msg}`);
  const errLog = (msg: string) => console.error(`${args.logPrefix ?? "[session-review-summary]"} ${msg}`);

  const draftSummary = await draftSessionReviewSummaryForSessionData(supabase, {
    sessionId: args.sessionId,
    sessionMode: args.sessionMode,
    sessionTitle: args.sessionTitle,
    sessionSummary: args.sessionSummary,
    apiKey: args.apiKey,
    modelName: args.modelName,
    logPrefix: args.logPrefix,
  });

  if (!draftSummary?.summary) {
    warn("drafter returned null/empty");
    return { ok: false, error: "draft_empty" };
  }

  let totalBefore = args.totalCostUsdBeforeDraft;
  if (totalBefore === undefined) {
    const { data: sess } = await supabase
      .from("test_sessions")
      .select("total_cost_usd")
      .eq("session_id", args.sessionId)
      .maybeSingle();
    totalBefore = (sess as { total_cost_usd?: number | null } | null)?.total_cost_usd ?? 0;
  }

  const addCost = draftSummary.token_usage?.cost_usd ?? 0;
  const { error: updateErr } = await supabase
    .from("test_sessions")
    .update({
      session_review_summary: toSessionReviewSummaryJson(draftSummary.summary),
      session_review_summary_basis_fingerprint: draftSummary.comparisonBasisFingerprint,
      total_cost_usd: (totalBefore ?? 0) + addCost,
    } as never)
    .eq("session_id", args.sessionId);

  if (updateErr) {
    errLog(`update failed: ${updateErr.message}`);
    return { ok: false, error: updateErr.message };
  }
  log("session review summary persisted");
  return { ok: true };
}
