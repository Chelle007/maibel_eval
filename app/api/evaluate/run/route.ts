import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callEvrenApi } from "@/lib/evren";
import { evaluateOne } from "@/lib/evaluator";
import { buildRichReport, runSummarizer } from "@/lib/summarizer";
import { loadEvaluatorSystemPrompt, loadSummarizerSystemPrompt } from "@/lib/prompts";
import type { TestCase, EvrenOutput, EvaluationResult } from "@/lib/types";
import type { Database, RunEntry, TestCasesRow, VersionEntry } from "@/lib/db.types";

export const maxDuration = 300;

const DEFAULT_MAX_INFLIGHT_EVREN_CALLS = 10;

function getMaxInflightEvrenCalls(): number {
  const raw = process.env.MAX_INFLIGHT_EVREN_CALLS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_INFLIGHT_EVREN_CALLS;
}

function getMaxConcurrentTestCases(runCount: number): number {
  const safeRunCount = Number.isFinite(runCount) && runCount > 0 ? runCount : 1;
  return Math.max(1, Math.floor(getMaxInflightEvrenCalls() / safeRunCount));
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  const safeLimit = Math.max(1, Math.floor(limit || 1));
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });

  await Promise.all(runners);
}

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
    mode?: "single" | "comparison";
    run_count?: number;
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
  const sessionMode = body.mode === "comparison" ? "comparison" : "single";
  const runCount = Number.isFinite(body.run_count) ? Math.max(1, Math.floor(body.run_count as number)) : 1;
  const useEvaluator = sessionMode === "single";
  const useSummarizer = sessionMode === "single";
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
    mode: sessionMode,
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
  const versionId = crypto.randomUUID();
  const maxConcurrentTestCases = getMaxConcurrentTestCases(runCount);
  await runWithConcurrency(rows, maxConcurrentTestCases, async (row) => {
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
    const runPromises = Array.from({ length: runCount }, async () => callEvrenApi(evrenModelApiUrl, testCase));
    const runResults = await Promise.allSettled(runPromises);
    const runs: RunEntry[] = [];

    for (let runIndex = 0; runIndex < runResults.length; runIndex++) {
      const settled = runResults[runIndex];
      if (settled.status !== "fulfilled") {
        const msg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason ?? "Evren error");
        console.error("[evaluate/run] Evren error for", row.test_case_id, msg);
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

    const run1Turns = runs[0]?.turns ?? [];
    const run1Outputs = run1Turns.map((t) => ({
      evren_response: t.response,
      detected_states: t.detected_flags,
    }));
    const versionEntry: VersionEntry = {
      version_id: versionId,
      version_name: "Version 1",
      run_count_requested: runCount,
      evidence_source: runCount > 1 ? "automated" : "none",
      comparison_basis_run_index: 1,
      runs,
    };
    const evrenResponsesColumn = [versionEntry];
    const lastOutput = run1Outputs[run1Outputs.length - 1] ?? { evren_response: "", detected_states: "" };
    if (useEvaluator) {
      const evalInput =
        testCase.type === "multi_turn" && run1Outputs.length > 1 ? run1Outputs : lastOutput;
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
  });

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
