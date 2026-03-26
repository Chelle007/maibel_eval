import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { compareOverall } from "@/lib/comparator";
import { loadComparatorOverallSystemPrompt } from "@/lib/prompts";
import type { TestCase, ComparisonData } from "@/lib/types";
import type { EvalResultsRow, VersionEntry, TestCasesRow, DefaultSettingsRow } from "@/lib/db.types";

type EvalResultLite = Pick<EvalResultsRow, "eval_result_id" | "test_case_uuid" | "evren_responses" | "comparison">;

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

  const apiKey = process.env.GEMINI_API_KEY;

  const { data: settingsRow } = await supabase
    .from("default_settings")
    .select("evaluator_model")
    .limit(1)
    .maybeSingle();
  const comparatorModel =
    (settingsRow as Pick<DefaultSettingsRow, "evaluator_model"> | null)?.evaluator_model?.trim() ||
    "gemini-3-flash-preview";

  const { data: evalRows, error: evalError } = await supabase
    .from("eval_results")
    .select("eval_result_id, test_case_uuid, evren_responses, comparison")
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

    let adjustedComparison: ComparisonData | null = null;
    const updatedIds = updated.map((v) => v.version_id).slice(0, 3);
    if (updatedIds.length >= 2 && apiKey && comparatorPrompt) {
      const tc = testCaseById.get(row.test_case_uuid);
      if (tc) {
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
          adjustedComparison = await compareOverall(
            testCase,
            updated,
            updatedIds.length === 2
              ? ([updatedIds[0], updatedIds[1]] as [string, string])
              : ([updatedIds[0], updatedIds[1], updatedIds[2]] as [string, string, string]),
            apiKey,
            comparatorModel,
            comparatorPrompt
          );
        } catch (err) {
          console.error("[versions/delete] compareOverall failed for", tc.test_case_id, err);
        }
      }
    }

    await supabase
      .from("eval_results")
      .update({ evren_responses: updated, comparison: adjustedComparison } as never)
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
