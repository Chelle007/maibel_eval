import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeBehaviorReviewMap } from "@/lib/behavior-review";
import { draftBehaviorReviewForVersionEntries } from "@/lib/behavior-review-drafter";
import { compareOverall } from "@/lib/comparator";
import type { Database, EvalResultsRow, TestCasesRow, VersionEntry } from "@/lib/db.types";
import { testCaseFromRow } from "@/lib/test-case-from-row";
import { loadContextPack } from "@/lib/context-pack";
import { loadComparatorOverallSystemPrompt } from "@/lib/prompts";
import type { TestCase } from "@/lib/types";

type EvalResultLite = Pick<
  EvalResultsRow,
  "eval_result_id" | "test_case_uuid" | "evren_responses" | "comparison" | "reason"
>;

export type RerunComparisonsFailure = {
  eval_result_id: string;
  test_case_id?: string;
  message: string;
};

export type RerunComparisonsSummary = {
  compared: number;
  skipped: number;
  failures: RerunComparisonsFailure[];
};

function uniqStrings(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const s = typeof id === "string" ? id.trim() : "";
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * For each eval row with 2–3 Evren versions: call the comparison model (`compareOverall` — tiers,
 * overall reason, hard failures), write `comparison`, then re-draft per-version dimension reviews
 * (`behavior_review`) with the same model settings and overwrite stored dimension data.
 *
 * Used after add-version and by “Rerun comparison” on the session page.
 */
export async function rerunComparisonsForSession(args: {
  supabase: SupabaseClient<Database>;
  sessionId: string;
  apiKey: string;
  comparatorModel: string;
}): Promise<RerunComparisonsSummary> {
  const { supabase, sessionId, apiKey, comparatorModel } = args;
  const comparatorPrompt = loadComparatorOverallSystemPrompt();

  const { data: evalRows, error } = await supabase
    .from("eval_results")
    .select("eval_result_id, test_case_uuid, evren_responses, comparison, reason")
    .eq("session_id", sessionId)
    .order("eval_result_id");
  if (error) throw new Error(error.message);

  const rows = (evalRows ?? []) as EvalResultLite[];
  if (rows.length === 0) return { compared: 0, skipped: 0, failures: [] };

  const testCaseIds = Array.from(new Set(rows.map((r) => r.test_case_uuid).filter(Boolean)));
  const { data: testCaseRows } = await supabase.from("test_cases").select("*").in("id", testCaseIds);
  const typed = (testCaseRows ?? []) as TestCasesRow[];
  const testCaseById = new Map(typed.map((r) => [r.id, r]));

  let compared = 0;
  let skipped = 0;
  const failures: RerunComparisonsFailure[] = [];

  for (const compRow of rows) {
    const tc = testCaseById.get(compRow.test_case_uuid);
    if (!tc) {
      skipped++;
      continue;
    }

    const versions = Array.isArray(compRow.evren_responses) ? (compRow.evren_responses as VersionEntry[]) : [];
    if (versions.length < 2) {
      skipped++;
      continue;
    }
    const versionIds = uniqStrings(versions.map((v) => String(v.version_id ?? "").trim())).slice(0, 3);
    if (versionIds.length < 2) {
      skipped++;
      continue;
    }

    const testCase: TestCase = testCaseFromRow(tc);

    try {
      const contextPack = loadContextPack({
        purpose: "comparator",
        query: `${testCase.test_case_id}\n${testCase.expected_state}\n${testCase.expected_behavior}\n${testCase.forbidden ?? ""}\n${testCase.notes ?? ""}`,
      });
      const compResult = await compareOverall(
        testCase,
        versions,
        versionIds.length === 2
          ? ([versionIds[0], versionIds[1]] as [string, string])
          : ([versionIds[0], versionIds[1], versionIds[2]] as [string, string, string]),
        apiKey,
        comparatorModel,
        comparatorPrompt,
        { text: contextPack.text, bundleId: contextPack.bundleId }
      );
      await supabase
        .from("eval_results")
        .update({ comparison: compResult } as never)
        .eq("eval_result_id", compRow.eval_result_id);

      const reasonText =
        (typeof compRow.reason === "string" && compRow.reason.trim() ? compRow.reason : null) ??
        compResult.overall_reason ??
        null;
      const allowed = new Set(versionIds);
      try {
        const draftResult = await draftBehaviorReviewForVersionEntries({
          testCase,
          versions,
          evaluatorReason: reasonText,
          apiKey,
          modelName: comparatorModel,
        });
        const merged = mergeBehaviorReviewMap({}, draftResult.reviews, allowed);
        await supabase
          .from("eval_results")
          .update({ behavior_review: merged ?? {} } as never)
          .eq("eval_result_id", compRow.eval_result_id);
      } catch (brErr) {
        console.error("[rerun-session-comparisons] dimension review draft error for", tc.test_case_id, brErr);
      }
      compared++;
    } catch (compErr) {
      console.error("[rerun-session-comparisons] comparison error for", tc.test_case_id, compErr);
      failures.push({
        eval_result_id: compRow.eval_result_id,
        test_case_id: tc.test_case_id,
        message: compErr instanceof Error ? compErr.message : String(compErr),
      });
    }
  }

  return { compared, skipped, failures };
}
