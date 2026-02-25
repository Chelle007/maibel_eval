import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db.types";
import { buildRichReport, runSummarizer } from "@/lib/summarizer";
import { loadSummarizerSystemPrompt } from "@/lib/prompts";
import type { TestCase, EvrenOutput, EvaluationResult } from "@/lib/types";

type EvalResultRow = {
  eval_result_id: string;
  session_id: string;
  test_case_uuid: string;
  evren_responses: { response: string; detected_flags: string }[];
  success: boolean;
  score: number;
  reason: string | null;
  test_cases: {
    id: string;
    test_case_id: string;
    input_message: string;
    expected_state: string;
    expected_behavior: string;
    forbidden?: string | null;
    title?: string | null;
    context?: string | null;
    type?: "single_turn" | "multi_turn" | null;
    turns?: string[] | null;
    img_url?: string | null;
  } | null;
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: testSessionId } = await params;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing GEMINI_API_KEY" }, { status: 500 });
  }

  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("test_sessions")
    .select("session_id")
    .eq("test_session_id", testSessionId)
    .single();
  if (sessionError || !session) {
    return NextResponse.json({ error: sessionError?.message ?? "Session not found" }, { status: 404 });
  }
  const sessionId = (session as { session_id: string }).session_id;

  const { data: rows, error: resultsError } = await supabase
    .from("eval_results")
    .select(
      "eval_result_id, session_id, test_case_uuid, evren_responses, success, score, reason, test_cases(id, test_case_id, input_message, expected_state, expected_behavior, forbidden, title, context, type, turns, img_url)"
    )
    .eq("session_id", sessionId)
    .order("eval_result_id");
  if (resultsError) return NextResponse.json({ error: resultsError.message }, { status: 500 });
  const resultRows = (rows ?? []) as EvalResultRow[];
  if (resultRows.length === 0) {
    return NextResponse.json({ error: "No eval results for this session" }, { status: 400 });
  }

  const richReports = resultRows.map((r) => {
    const tc = r.test_cases;
    if (!tc) {
      throw new Error(`Missing test_cases for eval_result ${r.eval_result_id}`);
    }
    const evrenList = Array.isArray(r.evren_responses) ? r.evren_responses : [];
    const last = evrenList[evrenList.length - 1] ?? { response: "", detected_flags: "" };
    const testCase: TestCase = {
      test_case_id: tc.test_case_id,
      type: tc.type ?? "single_turn",
      input_message: tc.input_message,
      expected_state: tc.expected_state,
      expected_behavior: tc.expected_behavior,
      forbidden: tc.forbidden ?? undefined,
      title: tc.title ?? undefined,
      context: tc.context ?? undefined,
      turns: tc.turns ?? undefined,
      img_url: tc.img_url ?? undefined,
    };
    const evrenOutput: EvrenOutput = {
      evren_response: last.response ?? "",
      detected_states: last.detected_flags ?? "",
    };
    const evalResult: EvaluationResult = {
      test_case_id: tc.test_case_id,
      success: r.success,
      score: r.score,
      flags_detected: "",
      reason: r.reason ?? "",
    };
    return buildRichReport(testCase, evrenOutput, evalResult);
  });

  const modelName = "gemini-2.5-flash";
  const summarizerResult = await runSummarizer(
    apiKey,
    richReports,
    modelName,
    loadSummarizerSystemPrompt()
  );

  const payload = {
    title: summarizerResult.title || null,
    summary: summarizerResult.summary,
    manually_edited: false,
    total_cost_usd: undefined as number | undefined,
  };
  const { data: sessionRow } = await supabase
    .from("test_sessions")
    .select("total_cost_usd")
    .eq("session_id", sessionId)
    .single();
  const currentTotal = (sessionRow as { total_cost_usd?: number | null } | null)?.total_cost_usd;
  if (typeof currentTotal === "number") {
    payload.total_cost_usd = currentTotal + summarizerResult.cost_usd;
  }

  const updatePayload = {
    title: payload.title,
    summary: payload.summary,
    manually_edited: payload.manually_edited,
    ...(payload.total_cost_usd !== undefined && { total_cost_usd: payload.total_cost_usd }),
  } as Database["public"]["Tables"]["test_sessions"]["Update"];
  const { error: updateError } = await supabase
    .from("test_sessions")
    .update(updatePayload as unknown as never)
    .eq("session_id", sessionId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({
    title: summarizerResult.title,
    summary: summarizerResult.summary,
    cost_usd: summarizerResult.cost_usd,
  });
}
