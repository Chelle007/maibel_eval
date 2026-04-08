import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMaxConcurrentTestCases, runWithConcurrency } from "@/lib/evren-concurrency";
import { callEvrenApi } from "@/lib/evren";
import { mergeBehaviorReviewMap } from "@/lib/behavior-review";
import { draftBehaviorReviewForVersionEntries } from "@/lib/behavior-review-drafter";
import { compareOverall } from "@/lib/comparator";
import { loadComparatorOverallSystemPrompt } from "@/lib/prompts";
import { loadContextPack } from "@/lib/context-pack";
import { persistSessionReviewSummaryForSession } from "@/lib/session-review-summary-refresh";
import type { TestCase } from "@/lib/types";
import type { DefaultSettingsRow, EvalResultsRow, RunEntry, TestCasesRow, VersionEntry } from "@/lib/db.types";

const FALLBACK_EVREN_URL = process.env.NEXT_PUBLIC_EVREN_API_URL || "http://localhost:8000";

type EvalResultLite = Pick<
  EvalResultsRow,
  "eval_result_id" | "test_case_uuid" | "evren_responses" | "comparison" | "reason"
>;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: {
    version_name?: string;
    run_count?: number;
    run_comparison?: boolean;
  } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }
  const runComparison = body.run_comparison ?? false;
  const runCount = Number.isFinite(body.run_count) ? Math.max(1, Math.floor(body.run_count as number)) : 1;

  const supabase = await createClient();

  const apiKey = process.env.GEMINI_API_KEY;
  if (runComparison && !apiKey) {
    return NextResponse.json({ error: "Missing GEMINI_API_KEY (required for comparison)" }, { status: 500 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("test_sessions")
    .select("session_id, mode, title, summary")
    .eq("test_session_id", id)
    .maybeSingle();
  if (sessionError || !session) {
    return NextResponse.json({ error: sessionError?.message ?? "Session not found" }, { status: 404 });
  }

  const sessionId = (session as { session_id: string }).session_id;
  const sessionMode =
    (session as { mode?: string }).mode === "comparison" ? "comparison" : "single";
  const sessionTitle = (session as { title?: string | null }).title ?? null;
  const sessionSummary = (session as { summary?: string | null }).summary ?? null;

  const { data: settingsRow } = await supabase
    .from("default_settings")
    .select("evren_api_url, evaluator_model")
    .limit(1)
    .maybeSingle();
  const settings = settingsRow as Pick<DefaultSettingsRow, "evren_api_url" | "evaluator_model"> | null;
  const evrenModelApiUrl = settings?.evren_api_url?.trim() || FALLBACK_EVREN_URL;
  const comparatorModel = settings?.evaluator_model?.trim() || "gemini-3-flash-preview";

  const { data: evalRows, error: evalError } = await supabase
    .from("eval_results")
    .select("eval_result_id, test_case_uuid, evren_responses, comparison, reason")
    .eq("session_id", sessionId)
    .order("eval_result_id");
    if (evalError) {
    return NextResponse.json({ error: evalError.message }, { status: 500 });
  }

  const rows = (evalRows ?? []) as EvalResultLite[];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No test case rows found in this session." }, { status: 400 });
  }

  const testCaseIds = Array.from(new Set(rows.map((r) => r.test_case_uuid).filter(Boolean)));
  const { data: testCaseRows, error: tcError } = await supabase
    .from("test_cases")
    .select("*")
    .in("id", testCaseIds);
  if (tcError) {
    return NextResponse.json({ error: tcError.message }, { status: 500 });
  }
  const typedTestCaseRows = (testCaseRows ?? []) as TestCasesRow[];
  const testCaseById = new Map(typedTestCaseRows.map((r) => [r.id, r]));

  const existingVersions = Array.isArray(rows[0]?.evren_responses) ? rows[0].evren_responses : [];
  const versionName = body.version_name?.trim() || `Version ${existingVersions.length + 1}`;
  const newVersionId = crypto.randomUUID();

  const maxConcurrentTestCases = getMaxConcurrentTestCases(runCount);

  await runWithConcurrency(rows, maxConcurrentTestCases, async (row) => {
    const tc = testCaseById.get(row.test_case_uuid);
    if (!tc) return;

    const testCase: TestCase = {
      test_case_id: tc.test_case_id,
      type: tc.type ?? "single_turn",
      input_message: tc.input_message,
      img_url: tc.img_url ?? undefined,
      turns: tc.turns ?? undefined,
      expected_state: tc.expected_state ?? "",
      expected_behavior: tc.expected_behavior ?? "",
      forbidden: tc.forbidden ?? undefined,
    };

    const runPromises = Array.from({ length: runCount }, async () => callEvrenApi(evrenModelApiUrl, testCase));
    const runResults = await Promise.allSettled(runPromises);
    const runs: RunEntry[] = [];

    for (let runIndex = 0; runIndex < runResults.length; runIndex++) {
      const settled = runResults[runIndex];
      if (settled.status !== "fulfilled") {
        console.error(
          "[sessions/add-version] Evren error for",
          tc.test_case_id,
          settled.reason instanceof Error ? settled.reason.message : settled.reason
        );
        continue;
      }
      const runOutputs = settled.value;
      runs.push({
        run_id: crypto.randomUUID(),
        run_index: runIndex + 1,
        turns: runOutputs.map((o) => ({
          response: Array.isArray(o.evren_response) ? o.evren_response.map(String) : [String(o.evren_response ?? "")],
          detected_flags: String(o.detected_states ?? ""),
        })),
      });
    }
    if (runs.length === 0) return;

    const existing = Array.isArray(row.evren_responses) ? (row.evren_responses as VersionEntry[]) : [];
    const newVersion: VersionEntry = {
      version_id: newVersionId,
      version_name: versionName,
      run_count_requested: runCount,
      evidence_source: runCount > 1 ? "automated" : "none",
      comparison_basis_run_index: 1,
      runs,
    };
    const mergedResponses = [...existing, newVersion];

    await supabase
      .from("eval_results")
      .update({ evren_responses: mergedResponses } as never)
      .eq("eval_result_id", row.eval_result_id);
  });

  if (runComparison && apiKey) {
    const { data: freshRows } = await supabase
      .from("eval_results")
      .select("eval_result_id, test_case_uuid, evren_responses, comparison, reason")
      .eq("session_id", sessionId)
      .order("eval_result_id");
    const compRows = (freshRows ?? []) as EvalResultLite[];
    const comparatorPrompt = loadComparatorOverallSystemPrompt();

    for (const compRow of compRows) {
      const tc = testCaseById.get(compRow.test_case_uuid);
      if (!tc) continue;

      const versions = Array.isArray(compRow.evren_responses) ? (compRow.evren_responses as VersionEntry[]) : [];
      if (versions.length < 2) continue;
      const versionIds = versions.map((v) => v.version_id).slice(0, 3);
      if (versionIds.length < 2) continue;

      const testCase: TestCase = {
        test_case_id: tc.test_case_id,
        type: tc.type ?? "single_turn",
        input_message: tc.input_message,
        img_url: tc.img_url ?? undefined,
        turns: tc.turns ?? undefined,
        expected_state: tc.expected_state ?? "",
        expected_behavior: tc.expected_behavior ?? "",
        forbidden: tc.forbidden ?? undefined,
        notes: tc.notes ?? undefined,
      };

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
        try {
          const draftResult = await draftBehaviorReviewForVersionEntries({
            testCase,
            versions,
            evaluatorReason: reasonText,
            apiKey,
            modelName: comparatorModel,
          });
          if (Object.keys(draftResult.reviews).length > 0) {
            const allowed = new Set(versionIds);
            const merged = mergeBehaviorReviewMap({}, draftResult.reviews, allowed);
            if (merged) {
              await supabase
                .from("eval_results")
                .update({ behavior_review: merged } as never)
                .eq("eval_result_id", compRow.eval_result_id);
            }
          }
        } catch (brErr) {
          console.error("[sessions/add-version] Behavior review draft error for", tc.test_case_id, brErr);
        }
      } catch (compErr) {
        console.error("[sessions/add-version] Comparison error for", tc.test_case_id, compErr);
      }
    }
  }

  const { data: updatedResults, error: resultsError } = await supabase
    .from("eval_results")
    .select("*, test_cases(id, test_case_id, input_message, expected_state, expected_behavior, title, type, turns)")
    .eq("session_id", sessionId)
    .order("eval_result_id");
  if (resultsError) {
    return NextResponse.json({ error: resultsError.message }, { status: 500 });
  }

  const resultsWithTestCaseId = (updatedResults ?? []).map((r: { test_cases?: Record<string, unknown> & { test_case_id?: string } }) => {
    const tc = r.test_cases != null ? { ...r.test_cases } : undefined;
    return { ...r, test_case_id: tc?.test_case_id, test_cases: tc };
  });

  if (apiKey && sessionMode === "comparison") {
    await persistSessionReviewSummaryForSession(supabase, {
      sessionId,
      sessionMode: "comparison",
      sessionTitle,
      sessionSummary,
      apiKey,
      modelName: comparatorModel,
      logPrefix: "[sessions/add-version]",
    });
  }

  return NextResponse.json({ results: resultsWithTestCaseId });
}
