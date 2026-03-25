import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callEvrenApi } from "@/lib/evren";
import { evaluateOne } from "@/lib/evaluator";
import { buildRichReport, runSummarizer } from "@/lib/summarizer";
import { loadEvaluatorSystemPrompt, loadSummarizerSystemPrompt } from "@/lib/prompts";
import type { TestCase, EvrenOutput, EvaluationResult } from "@/lib/types";
import type { Database, TestCasesRow, VersionEntry } from "@/lib/db.types";

export const maxDuration = 300;

export async function POST(request: Request) {
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

  let body: {
    evren_model_api_url: string;
    use_evaluator?: boolean;
    use_summarizer?: boolean;
    model_name?: string;
    summarizer_model?: string;
    system_prompt?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const evrenModelApiUrl = body.evren_model_api_url;
  if (!evrenModelApiUrl?.trim()) return NextResponse.json({ error: "evren_model_api_url required" }, { status: 400 });
  const useEvaluator = body.use_evaluator ?? false;
  const useSummarizer = body.use_summarizer ?? false;
  const apiKey = process.env.GEMINI_API_KEY;
  if ((useEvaluator || useSummarizer) && !apiKey) {
    return NextResponse.json({ error: "Missing GEMINI_API_KEY" }, { status: 500 });
  }

  const { data: testCasesRows, error: fetchError } = await supabase
    .from("test_cases")
    .select("*")
    .eq("is_enabled", true)
    .order("test_case_id", { ascending: true });
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!testCasesRows?.length) return NextResponse.json({ error: "No enabled test cases in database" }, { status: 400 });

  const sessionInsert = {
    user_id: userId,
    total_cost_usd: 0,
    summary: null,
    manually_edited: false,
  } as Database["public"]["Tables"]["test_sessions"]["Insert"];
  const { data: sessionRow, error: sessionError } = await supabase
    .from("test_sessions")
    .insert(sessionInsert as any)
    .select("session_id, test_session_id")
    .single();
  if (sessionError || !sessionRow) {
    return NextResponse.json({ error: sessionError?.message ?? "Failed to create session" }, { status: 500 });
  }
  const session = sessionRow as { session_id: string; test_session_id: string };
  const sessionId = session.session_id;
  const testSessionId = session.test_session_id;
  const evalStartMs = Date.now();

  const modelName = body.model_name ?? "gemini-3-flash-preview";
  const summarizerModel = body.summarizer_model ?? modelName;
  const systemPrompt = body.system_prompt ?? loadEvaluatorSystemPrompt();
  let totalCostUsd = 0;
  const richReportInputs: { testCase: TestCase; evrenOutput: EvrenOutput; result: EvaluationResult }[] = [];

  const rows = (testCasesRows ?? []) as TestCasesRow[];
  for (const row of rows) {
    const testCase: TestCase = {
      test_case_id: row.test_case_id,
      type: row.type ?? "single_turn",
      input_message: row.input_message,
      img_url: row.img_url ?? undefined,
      turns: row.turns ?? undefined,
      expected_state: row.expected_state ?? "",
      expected_behavior: row.expected_behavior ?? "",
      forbidden: row.forbidden ?? undefined,
    };
    let evrenOutputs: Awaited<ReturnType<typeof callEvrenApi>>;
    try {
      evrenOutputs = await callEvrenApi(evrenModelApiUrl, testCase);
    } catch (evrenErr) {
      console.error("[evaluate/run] Evren error for", row.test_case_id, evrenErr instanceof Error ? evrenErr.message : evrenErr);
      continue;
    }
    const versionEntry: VersionEntry = {
      version_id: crypto.randomUUID(),
      version_name: "Version 1",
      turns: evrenOutputs.map((o) => ({
        response: Array.isArray(o.evren_response) ? o.evren_response.map(String) : [String(o.evren_response ?? "")],
        detected_flags: String(o.detected_states ?? ""),
      })),
    };
    const evrenResponsesColumn = [versionEntry];
    const lastOutput = evrenOutputs[evrenOutputs.length - 1] ?? { evren_response: "", detected_states: "" };
    if (useEvaluator) {
      const evalInput =
        testCase.type === "multi_turn" && evrenOutputs.length > 1 ? evrenOutputs : lastOutput;
      const result = await evaluateOne(testCase, evalInput, apiKey as string, modelName, systemPrompt);
      const costUsd = result.token_usage?.cost_usd ?? 0;
      totalCostUsd += costUsd;

      richReportInputs.push({ testCase, evrenOutput: lastOutput, result });

      const evalPayload = {
        session_id: sessionId,
        test_case_uuid: row.id,
        evren_responses: evrenResponsesColumn,
        success: result.success,
        score: result.score,
        reason: result.reason ?? null,
        prompt_tokens: result.token_usage?.prompt_tokens ?? null,
        completion_tokens: result.token_usage?.completion_tokens ?? null,
        total_tokens: result.token_usage?.total_tokens ?? null,
        cost_usd: costUsd || null,
        manually_edited: false,
      } as Database["public"]["Tables"]["eval_results"]["Insert"];
      await supabase.from("eval_results").insert(evalPayload as any);
    } else {
      const evalPayload = {
        session_id: sessionId,
        test_case_uuid: row.id,
        evren_responses: evrenResponsesColumn,
        // Placeholder row so conversation still appears in session details.
        success: false,
        score: 0,
        reason: null,
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        cost_usd: null,
        manually_edited: false,
      } as Database["public"]["Tables"]["eval_results"]["Insert"];
      await supabase.from("eval_results").insert(evalPayload as any);
    }
  }

  let summary: string | null = null;
  let title: string | null = null;
  if (useSummarizer && richReportInputs.length > 0) {
    const richReports = richReportInputs.map(({ testCase, evrenOutput, result }) =>
      buildRichReport(testCase, evrenOutput, result)
    );
    const summarizerResult = await runSummarizer(
      apiKey as string,
      richReports,
      summarizerModel,
      loadSummarizerSystemPrompt()
    );
    totalCostUsd += summarizerResult.cost_usd;
    summary = summarizerResult.summary;
    title = summarizerResult.title || null;
  }

  const totalEvalTimeSeconds = (Date.now() - evalStartMs) / 1000;
  const sessionUpdate = { total_cost_usd: totalCostUsd, total_eval_time_seconds: totalEvalTimeSeconds, title, summary } as Database["public"]["Tables"]["test_sessions"]["Update"];
  await supabase
    .from("test_sessions")
    .update(sessionUpdate as unknown as never)
    .eq("session_id", sessionId);

  return NextResponse.json({
    test_session_id: testSessionId,
    total_cost_usd: totalCostUsd,
    title: title ?? undefined,
    summary: summary ?? undefined,
  });
}
