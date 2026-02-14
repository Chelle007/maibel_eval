import { createClient } from "@/lib/supabase/server";
import { callEvrenApi } from "@/lib/evren";
import { evaluateOne } from "@/lib/evaluator";
import { buildRichReport, runSummarizer } from "@/lib/summarizer";
import { loadEvaluatorSystemPrompt, loadSummarizerSystemPrompt } from "@/lib/prompts";
import type { TestCase, EvrenOutput, EvaluationResult } from "@/lib/types";

export const maxDuration = 300;

function sendEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  type: string,
  payload: object
) {
  const data = JSON.stringify({ type, ...payload });
  controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)
    return new Response(JSON.stringify({ error: "Missing GEMINI_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  const userId = authUser?.id ?? process.env.DEFAULT_USER_ID;
  if (!userId)
    return new Response(
      JSON.stringify({ error: "Not logged in and no DEFAULT_USER_ID" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );

  const { data: userRow } = await supabase.from("users").select("user_id").eq("user_id", userId).maybeSingle();
  if (!userRow)
    return new Response(
      JSON.stringify({
        error:
          'User not found in database. test_sessions requires a valid user_id. If signed in, visit /api/auth/sync to create your user row; otherwise set DEFAULT_USER_ID to a UUID that exists in the users table.',
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );

  let body: {
    evren_model_api_url: string;
    model_name?: string;
    summarizer_model?: string;
    system_prompt?: string;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const evrenModelApiUrl = body.evren_model_api_url?.trim();
  if (!evrenModelApiUrl)
    return new Response(
      JSON.stringify({ error: "evren_model_api_url required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );

  const { data: testCasesRows, error: fetchError } = await supabase
    .from("test_cases")
    .select("*")
    .eq("is_enabled", true)
    .order("test_case_id", { ascending: true });
  if (fetchError)
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  if (!testCasesRows?.length)
    return new Response(JSON.stringify({ error: "No enabled test cases in database" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

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
  if (sessionError || !sessionRow)
    return new Response(
      JSON.stringify({
        error: sessionError?.message ?? "Failed to create session",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  const testSessionId = sessionRow.test_session_id;
  const total = testCasesRows.length;
  const modelName = body.model_name ?? "gemini-2.5-flash";
  const summarizerModel = body.summarizer_model ?? modelName;

  const { data: defaultSettings } = await supabase
    .from("default_settings")
    .select("evaluator_prompt, summarizer_prompt")
    .limit(1)
    .maybeSingle();
  const systemPrompt =
    (defaultSettings?.evaluator_prompt?.trim() || null) ?? body.system_prompt ?? loadEvaluatorSystemPrompt();
  const summarizerPrompt =
    (defaultSettings?.summarizer_prompt?.trim() || null) ?? loadSummarizerSystemPrompt();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let totalCostUsd = 0;
      const richReportInputs: { testCase: TestCase; evrenOutput: EvrenOutput; result: EvaluationResult }[] = [];
      try {
        sendEvent(controller, "progress", {
          stage: "start",
          total,
          test_session_id: testSessionId,
          message: `Starting run (${total} test case${total === 1 ? "" : "s"})…`,
        });

        for (let index = 0; index < testCasesRows.length; index++) {
          const row = testCasesRows[index];
          const testCase: TestCase = {
            test_case_id: row.test_case_id,
            input_message: row.input_message,
            img_url: row.img_url ?? undefined,
            context: row.context ?? undefined,
            expected_state: row.expected_state ?? "",
            expected_behavior: row.expected_behavior ?? "",
            forbidden: row.forbidden ?? undefined,
          };

          sendEvent(controller, "progress", {
            stage: "evren",
            index,
            total,
            test_case_id: testCase.test_case_id,
            message: "Waiting for Evren response…",
          });

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
            sendEvent(controller, "progress", {
              stage: "error",
              index,
              total,
              test_case_id: testCase.test_case_id,
              message: "Failed to save Evren response",
            });
            continue;
          }

          sendEvent(controller, "progress", {
            stage: "evaluating",
            index,
            total,
            test_case_id: testCase.test_case_id,
            message: "Evaluating…",
          });

          const result = await evaluateOne(
            testCase,
            evrenOutput,
            apiKey,
            modelName,
            systemPrompt
          );
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

          sendEvent(controller, "progress", {
            stage: "done",
            index: index + 1,
            total,
            test_case_id: testCase.test_case_id,
            message: `Completed ${index + 1} of ${total}`,
          });
        }

        let summary: string | null = null;
        let title: string | null = null;
        if (richReportInputs.length > 0) {
          sendEvent(controller, "progress", {
            stage: "summarizing",
            total,
            message: "Generating validation report…",
          });
          const richReports = richReportInputs.map(({ testCase, evrenOutput, result }) =>
            buildRichReport(testCase, evrenOutput, result)
          );
          const summarizerResult = await runSummarizer(
            apiKey,
            richReports,
            summarizerModel,
            summarizerPrompt
          );
          totalCostUsd += summarizerResult.cost_usd;
          summary = summarizerResult.summary;
          title = summarizerResult.title || null;
        }

        await supabase
          .from("test_sessions")
          .update({ total_cost_usd: totalCostUsd, title, summary })
          .eq("test_session_id", testSessionId);

        sendEvent(controller, "complete", {
          test_session_id: testSessionId,
          total_cost_usd: totalCostUsd,
          title: title ?? undefined,
          summary: summary ?? undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Run failed";
        console.error("[evaluate/run/stream] Error:", message, err);
        try {
          sendEvent(controller, "error", { error: message });
        } catch {
          /* stream already closed */
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
