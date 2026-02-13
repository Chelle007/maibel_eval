import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callEvrenApi } from "@/lib/evren";
import { evaluateOne } from "@/lib/evaluator";
import { buildRichReport, runSummarizer } from "@/lib/summarizer";
import { loadEvaluatorSystemPrompt, loadSummarizerSystemPrompt } from "@/lib/prompts";
import type { TestCase, EvrenOutput, EvaluationResult } from "@/lib/types";

export const maxDuration = 300;

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing GEMINI_API_KEY" }, { status: 500 });

  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  const userId = authUser?.id ?? process.env.DEFAULT_USER_ID;
  if (!userId) return NextResponse.json({ error: "Not logged in and no DEFAULT_USER_ID" }, { status: 401 });

  const { data: userRow } = await supabase.from("users").select("user_id").eq("user_id", userId).maybeSingle();
  if (!userRow) {
    return NextResponse.json(
      {
        error:
          'User not found in database. test_sessions requires a valid user_id. If signed in, visit /api/auth/sync to create your user row; otherwise set DEFAULT_USER_ID to a UUID that exists in the users table.',
      },
      { status: 400 }
    );
  }

  let body: { evren_model_api_url: string; model_name?: string; system_prompt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const evrenModelApiUrl = body.evren_model_api_url;
  if (!evrenModelApiUrl?.trim()) return NextResponse.json({ error: "evren_model_api_url required" }, { status: 400 });

  const { data: testCasesRows, error: fetchError } = await supabase
    .from("test_cases")
    .select("*")
    .eq("is_enabled", true)
    .order("test_case_id", { ascending: true });
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!testCasesRows?.length) return NextResponse.json({ error: "No enabled test cases in database" }, { status: 400 });

  const { data: sessionRow, error: sessionError } = await supabase
    .from("test_sessions")
    .insert({
      user_id: userId,
      total_cost_usd: 0,
      summary: null,
      manually_edited: false,
    })
    .select("test_session_id")
    .single();
  if (sessionError || !sessionRow) {
    return NextResponse.json({ error: sessionError?.message ?? "Failed to create session" }, { status: 500 });
  }
  const testSessionId = sessionRow.test_session_id;

  const modelName = body.model_name ?? "gemini-2.5-flash";
  const systemPrompt = body.system_prompt ?? loadEvaluatorSystemPrompt();
  let totalCostUsd = 0;
  const richReportInputs: { testCase: TestCase; evrenOutput: EvrenOutput; result: EvaluationResult }[] = [];

  for (const row of testCasesRows) {
    const testCase: TestCase = {
      test_case_id: row.test_case_id,
      input_message: row.input_message,
      img_url: row.img_url ?? undefined,
      context: row.context ?? undefined,
      expected_state: row.expected_state ?? "",
      expected_behavior: row.expected_behavior ?? "",
      forbidden: row.forbidden ?? undefined,
    };
    const evrenOutput = await callEvrenApi(evrenModelApiUrl, testCase);

    const { data: evrenInsert, error: evrenErr } = await supabase
      .from("evren_responses")
      .insert({
        test_case_id: row.test_case_id,
        evren_response: evrenOutput.evren_response,
        detected_states: evrenOutput.detected_states,
      })
      .select("evren_response_id")
      .single();
    if (evrenErr || !evrenInsert) {
      console.error("evren_responses insert error:", evrenErr);
      continue;
    }

    const result = await evaluateOne(testCase, evrenOutput, apiKey, modelName, systemPrompt);
    const costUsd = result.token_usage?.cost_usd ?? 0;
    totalCostUsd += costUsd;

    richReportInputs.push({ testCase, evrenOutput, result });

    await supabase.from("eval_results").insert({
      test_session_id: testSessionId,
      test_case_id: row.test_case_id,
      evren_response_id: evrenInsert.evren_response_id,
      success: result.success,
      score: result.score,
      reason: result.reason ?? null,
      prompt_tokens: result.token_usage?.prompt_tokens ?? null,
      completion_tokens: result.token_usage?.completion_tokens ?? null,
      total_tokens: result.token_usage?.total_tokens ?? null,
      cost_usd: costUsd || null,
      manually_edited: false,
    });
  }

  let summary: string | null = null;
  if (richReportInputs.length > 0) {
    const richReports = richReportInputs.map(({ testCase, evrenOutput, result }) =>
      buildRichReport(testCase, evrenOutput, result)
    );
    const summarizerResult = await runSummarizer(
      apiKey,
      richReports,
      modelName,
      loadSummarizerSystemPrompt()
    );
    totalCostUsd += summarizerResult.cost_usd;
    summary = summarizerResult.summary;
  }

  await supabase
    .from("test_sessions")
    .update({ total_cost_usd: totalCostUsd, summary })
    .eq("test_session_id", testSessionId);

  return NextResponse.json({
    test_session_id: testSessionId,
    total_cost_usd: totalCostUsd,
    summary: summary ?? undefined,
  });
}
