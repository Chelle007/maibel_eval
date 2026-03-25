import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callEvrenApi } from "@/lib/evren";
import { runChampionChallenge } from "@/lib/comparator";
import { loadComparatorSystemPrompt } from "@/lib/prompts";
import type { TestCase, ComparisonData } from "@/lib/types";
import type { TestCasesRow, EvalResultsRow, VersionEntry, DefaultSettingsRow } from "@/lib/db.types";

const FALLBACK_EVREN_URL = process.env.NEXT_PUBLIC_EVREN_API_URL || "http://localhost:8000";

type EvalResultLite = Pick<EvalResultsRow, "eval_result_id" | "test_case_uuid" | "evren_responses" | "comparison">;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { version_name?: string; run_comparison?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }
  const runComparison = body.run_comparison ?? false;

  const supabase = await createClient();

  const apiKey = process.env.GEMINI_API_KEY;
  if (runComparison && !apiKey) {
    return NextResponse.json({ error: "Missing GEMINI_API_KEY (required for comparison)" }, { status: 500 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("test_sessions")
    .select("session_id")
    .eq("test_session_id", id)
    .maybeSingle();
  if (sessionError || !session) {
    return NextResponse.json({ error: sessionError?.message ?? "Session not found" }, { status: 404 });
  }

  const sessionId = (session as { session_id: string }).session_id;

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
    .select("eval_result_id, test_case_uuid, evren_responses, comparison")
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
  const testCaseById = new Map((testCaseRows ?? []).map((r) => [r.id, r as TestCasesRow]));

  const existingVersions = Array.isArray(rows[0]?.evren_responses) ? rows[0].evren_responses : [];
  const versionName = body.version_name?.trim() || `Version ${existingVersions.length + 1}`;
  const newVersionId = crypto.randomUUID();

  for (const row of rows) {
    const tc = testCaseById.get(row.test_case_uuid);
    if (!tc) continue;

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

    let newOutputs;
    try {
      newOutputs = await callEvrenApi(evrenModelApiUrl, testCase);
    } catch (evrenErr) {
      console.error("[sessions/add-version] Evren error for", tc.test_case_id, evrenErr);
      continue;
    }

    const existing = Array.isArray(row.evren_responses) ? (row.evren_responses as VersionEntry[]) : [];
    const newVersion: VersionEntry = {
      version_id: newVersionId,
      version_name: versionName,
      turns: newOutputs.map((o) => ({
        response: Array.isArray(o.evren_response) ? o.evren_response.map(String) : [String(o.evren_response ?? "")],
        detected_flags: String(o.detected_states ?? ""),
      })),
    };
    const mergedResponses = [...existing, newVersion];

    await supabase
      .from("eval_results")
      .update({ evren_responses: mergedResponses } as never)
      .eq("eval_result_id", row.eval_result_id);
  }

  if (runComparison && apiKey) {
    const { data: freshRows } = await supabase
      .from("eval_results")
      .select("eval_result_id, test_case_uuid, evren_responses, comparison")
      .eq("session_id", sessionId)
      .order("eval_result_id");
    const compRows = (freshRows ?? []) as EvalResultLite[];
    const comparatorPrompt = loadComparatorSystemPrompt();

    for (const compRow of compRows) {
      const tc = testCaseById.get(compRow.test_case_uuid);
      if (!tc) continue;

      const versions = Array.isArray(compRow.evren_responses) ? (compRow.evren_responses as VersionEntry[]) : [];
      if (versions.length < 2) continue;

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

      const existingComparison = compRow.comparison as ComparisonData | null;

      try {
        const compResult = await runChampionChallenge(
          testCase,
          versions,
          newVersionId,
          existingComparison,
          apiKey,
          comparatorModel,
          comparatorPrompt
        );
        await supabase
          .from("eval_results")
          .update({ comparison: compResult } as never)
          .eq("eval_result_id", compRow.eval_result_id);
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

  return NextResponse.json({ results: resultsWithTestCaseId });
}
