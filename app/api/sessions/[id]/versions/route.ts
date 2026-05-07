import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { compareOverall } from "@/lib/comparator";
import { loadComparatorOverallSystemPrompt } from "@/lib/prompts";
import { loadContextPack } from "@/lib/context-pack";
import type { TestCase, ComparisonData } from "@/lib/types";
import { mergeBehaviorReviewMap, pruneBehaviorReviewForVersions, type BehaviorReviewByVersion } from "@/lib/behavior-review";
import { draftBehaviorReviewForVersionEntries } from "@/lib/behavior-review-drafter";
import type { EvalResultsRow, VersionEntry, TestCasesRow, DefaultSettingsRow } from "@/lib/db.types";
import { testCaseFromRow } from "@/lib/test-case-from-row";
import { createSessionResultSnapshot } from "@/lib/session-snapshots";
import { getAnthropicEvalApiKey } from "@/lib/eval-llm-env";
import { DEFAULT_EVAL_LLM_MODEL, normalizeAnthropicModelName } from "@/lib/eval-llm-defaults";

type EvalResultLite = Pick<
  EvalResultsRow,
  "eval_result_id" | "test_case_uuid" | "evren_responses" | "comparison" | "behavior_review" | "reason"
>;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { version_id?: string };
  const versionId = body.version_id;
  if (!versionId || typeof versionId !== "string") {
    return NextResponse.json({ error: "version_id must be a non-empty string" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("test_sessions")
    .select("session_id")
    .eq("test_session_id", id)
    .maybeSingle();
  if (sessionError || !session) {
    return NextResponse.json({ error: sessionError?.message ?? "Session not found" }, { status: 404 });
  }
  const sessionId = (session as { session_id: string }).session_id;

  // Snapshot current session result state before mutating versions (Git-like "commit").
  await createSessionResultSnapshot({
    supabase,
    sessionId,
    kind: "before_delete_version",
    message: `Before delete version: ${versionId}`,
  });

  const apiKey = getAnthropicEvalApiKey();

  const { data: settingsRow } = await supabase
    .from("default_settings")
    .select("evaluator_model")
    .limit(1)
    .maybeSingle();
  const comparatorModel =
    normalizeAnthropicModelName(
      (settingsRow as Pick<DefaultSettingsRow, "evaluator_model"> | null)?.evaluator_model?.trim()
    ) || DEFAULT_EVAL_LLM_MODEL;

  const { data: evalRows, error: evalError } = await supabase
    .from("eval_results")
    .select("eval_result_id, test_case_uuid, evren_responses, comparison, behavior_review, reason")
    .eq("session_id", sessionId)
    .order("eval_result_id");
  if (evalError) return NextResponse.json({ error: evalError.message }, { status: 500 });

  const rows = (evalRows ?? []) as EvalResultLite[];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No test case rows found in this session." }, { status: 400 });
  }

  const testCaseIds = Array.from(new Set(rows.map((r) => r.test_case_uuid).filter(Boolean)));
  const { data: testCaseRows } = await supabase.from("test_cases").select("*").in("id", testCaseIds);
  const typedTestCaseRows = (testCaseRows ?? []) as TestCasesRow[];
  const testCaseById = new Map(typedTestCaseRows.map((r) => [r.id, r]));
  const comparatorPrompt = apiKey ? loadComparatorOverallSystemPrompt() : undefined;

  for (const row of rows) {
    const existing = Array.isArray(row.evren_responses) ? (row.evren_responses as VersionEntry[]) : [];
    const updated = existing.filter((v) => v.version_id !== versionId);
    const keptIds = new Set(updated.map((v) => v.version_id));
    const prunedReview = pruneBehaviorReviewForVersions(row.behavior_review, keptIds);

    let adjustedComparison: ComparisonData | null = null;
    const updatedIds = updated.map((v) => v.version_id).slice(0, 3);
    let testCaseForDraft: TestCase | null = null;
    if (updatedIds.length >= 2 && apiKey && comparatorPrompt) {
      const tc = testCaseById.get(row.test_case_uuid);
      if (tc) {
        testCaseForDraft = testCaseFromRow(tc);
        try {
          const contextPack = loadContextPack({
            purpose: "comparator",
            query: `${testCaseForDraft.test_case_id}\n${testCaseForDraft.expected_state}\n${testCaseForDraft.expected_behavior}\n${testCaseForDraft.forbidden ?? ""}\n${testCaseForDraft.notes ?? ""}`,
          });
          adjustedComparison = await compareOverall(
            testCaseForDraft,
            updated,
            updatedIds.length === 2
              ? ([updatedIds[0], updatedIds[1]] as [string, string])
              : ([updatedIds[0], updatedIds[1], updatedIds[2]] as [string, string, string]),
            apiKey,
            comparatorModel,
            comparatorPrompt,
            { text: contextPack.text, bundleId: contextPack.bundleId }
          );
        } catch (err) {
          console.error("[versions/delete] compareOverall failed for", tc.test_case_id, err);
        }
      }
    }

    let behaviorReviewOut: BehaviorReviewByVersion = prunedReview;
    if (adjustedComparison && testCaseForDraft && apiKey) {
      const reasonText =
        (typeof row.reason === "string" && row.reason.trim() ? row.reason : null) ??
        adjustedComparison.overall_reason ??
        null;
      try {
        const draftResult = await draftBehaviorReviewForVersionEntries({
          testCase: testCaseForDraft,
          versions: updated,
          evaluatorReason: reasonText,
          apiKey,
          modelName: comparatorModel,
        });
        if (Object.keys(draftResult.reviews).length > 0) {
          const allowed = new Set(updated.map((v) => v.version_id));
          const merged = mergeBehaviorReviewMap({}, draftResult.reviews, allowed);
          if (merged) behaviorReviewOut = merged;
        }
      } catch (brErr) {
        console.error("[versions/delete] behavior review draft failed for", row.eval_result_id, brErr);
      }
    }

    await supabase
      .from("eval_results")
      .update({
        evren_responses: updated,
        comparison: adjustedComparison,
        behavior_review: behaviorReviewOut,
      } as never)
      .eq("eval_result_id", row.eval_result_id);
  }

  const { data: updatedResults, error: resultsError } = await supabase
    .from("eval_results")
    .select("*, test_cases(id, test_case_id, input_message, expected_state, expected_behavior, title, type, turns)")
    .eq("session_id", sessionId)
    .order("eval_result_id");
  if (resultsError) return NextResponse.json({ error: resultsError.message }, { status: 500 });

  const resultsWithTestCaseId = (updatedResults ?? []).map((r: { test_cases?: Record<string, unknown> & { test_case_id?: string } }) => {
    const tc = r.test_cases != null ? { ...r.test_cases } : undefined;
    return { ...r, test_case_id: tc?.test_case_id, test_cases: tc };
  });

  return NextResponse.json({ results: resultsWithTestCaseId });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    renames?: { version_id: string; version_name: string }[];
  };
  const renames = body.renames;
  if (!Array.isArray(renames) || renames.length === 0) {
    return NextResponse.json({ error: "renames must be a non-empty array of { version_id, version_name }" }, { status: 400 });
  }

  const renameMap = new Map(renames.map((r) => [r.version_id, r.version_name.trim()]));

  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("test_sessions")
    .select("session_id")
    .eq("test_session_id", id)
    .maybeSingle();
  if (sessionError || !session) {
    return NextResponse.json({ error: sessionError?.message ?? "Session not found" }, { status: 404 });
  }
  const sessionId = (session as { session_id: string }).session_id;

  const { data: evalRows, error: evalError } = await supabase
    .from("eval_results")
    .select("eval_result_id, evren_responses")
    .eq("session_id", sessionId)
    .order("eval_result_id");
  if (evalError) return NextResponse.json({ error: evalError.message }, { status: 500 });

  const rows = (evalRows ?? []) as Pick<EvalResultsRow, "eval_result_id" | "evren_responses">[];

  for (const row of rows) {
    const versions = Array.isArray(row.evren_responses) ? (row.evren_responses as VersionEntry[]) : [];
    let changed = false;
    const updated = versions.map((v) => {
      const newName = renameMap.get(v.version_id);
      if (newName !== undefined && newName !== v.version_name) {
        changed = true;
        return { ...v, version_name: newName };
      }
      return v;
    });
    if (changed) {
      await supabase
        .from("eval_results")
        .update({ evren_responses: updated } as never)
        .eq("eval_result_id", row.eval_result_id);
    }
  }

  const { data: updatedResults, error: resultsError } = await supabase
    .from("eval_results")
    .select("*, test_cases(id, test_case_id, input_message, expected_state, expected_behavior, title, type, turns)")
    .eq("session_id", sessionId)
    .order("eval_result_id");
  if (resultsError) return NextResponse.json({ error: resultsError.message }, { status: 500 });

  const resultsWithTestCaseId = (updatedResults ?? []).map((r: { test_cases?: Record<string, unknown> & { test_case_id?: string } }) => {
    const tc = r.test_cases != null ? { ...r.test_cases } : undefined;
    return { ...r, test_case_id: tc?.test_case_id, test_cases: tc };
  });

  return NextResponse.json({ results: resultsWithTestCaseId });
}
