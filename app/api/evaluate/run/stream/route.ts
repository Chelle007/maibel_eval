import { createClient } from "@/lib/supabase/server";
import { callEvrenApi } from "@/lib/evren";
import { evaluateOne } from "@/lib/evaluator";
import { buildRichReport, runSummarizer } from "@/lib/summarizer";
import { loadEvaluatorSystemPrompt, loadSummarizerSystemPrompt } from "@/lib/prompts";
import type { TestCase, EvrenOutput, EvaluationResult } from "@/lib/types";
import type { Database, TestCasesRow, DefaultSettingsRow } from "@/lib/db.types";

export const maxDuration = 300;

function sendEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  type: string,
  payload: object
) {
  try {
    const data = JSON.stringify({ type, ...payload });
    controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
  } catch {
    /* Controller may already be closed (e.g. client disconnect). */
  }
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

  // On Vercel (and similar), localhost is this server—Evren must be a reachable URL.
  const isProduction = process.env.VERCEL === "1";
  if (isProduction) {
    try {
      const u = new URL(evrenModelApiUrl);
      const host = u.hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1")
        return new Response(
          JSON.stringify({
            error:
              "Evren API URL cannot be localhost on Vercel. Set Evren API URL in Settings to your deployed Evren service (or set NEXT_PUBLIC_EVREN_API_URL in Vercel).",
            code: "LOCALHOST_ON_VERCEL",
            status: 400,
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
    } catch {
      /* invalid URL already; let callEvrenApi surface it */
    }
  }

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
  if (sessionError || !sessionRow)
    return new Response(
      JSON.stringify({
        error: sessionError?.message ?? "Failed to create session",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  const session = sessionRow as { session_id: string; test_session_id: string };
  const sessionId = session.session_id;
  const testSessionId = session.test_session_id;
  const total = testCasesRows.length;
  const modelName = body.model_name ?? "gemini-2.5-flash";
  const summarizerModel = body.summarizer_model ?? modelName;

  const { data: defaultSettings } = await supabase
    .from("default_settings")
    .select("evaluator_prompt, summarizer_prompt")
    .limit(1)
    .maybeSingle();
  const settingsRow = defaultSettings as Pick<DefaultSettingsRow, "evaluator_prompt" | "summarizer_prompt"> | null;
  const systemPrompt =
    (settingsRow?.evaluator_prompt?.trim() || null) ?? body.system_prompt ?? loadEvaluatorSystemPrompt();
  const summarizerPrompt =
    (settingsRow?.summarizer_prompt?.trim() || null) ?? loadSummarizerSystemPrompt();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const evalStartMs = Date.now();
      let totalCostUsd = 0;
      const richReportInputs: { testCase: TestCase; evrenOutput: EvrenOutput; result: EvaluationResult }[] = [];
      try {
        sendEvent(controller, "progress", {
          stage: "start",
          total,
          test_session_id: testSessionId,
          message: `Starting run (${total} test case${total === 1 ? "" : "s"})…`,
        });

        const rows = (testCasesRows ?? []) as TestCasesRow[];
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index];
          const testCase: TestCase = {
            test_case_id: row.test_case_id,
            type: row.type ?? "single_turn",
            input_message: row.input_message,
            img_url: row.img_url ?? undefined,
            context: row.context ?? undefined,
            turns: row.turns ?? undefined,
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

          let evrenOutputs: Awaited<ReturnType<typeof callEvrenApi>>;
          try {
            evrenOutputs = await callEvrenApi(evrenModelApiUrl, testCase);
          } catch (evrenErr) {
            const msg = evrenErr instanceof Error ? evrenErr.message : String(evrenErr);
            console.error("[evaluate/run/stream] Evren error for", testCase.test_case_id, msg);
            sendEvent(controller, "progress", {
              stage: "error",
              index,
              total,
              test_case_id: testCase.test_case_id,
              message: `Evren API failed: ${msg.slice(0, 80)}${msg.length > 80 ? "…" : ""}`,
            });
            continue;
          }

          const evrenResponsesColumn = evrenOutputs.map((o) => ({
            response: o.evren_response,
            detected_flags: o.detected_states,
          }));
          const lastOutput = evrenOutputs[evrenOutputs.length - 1] ?? { evren_response: "", detected_states: "" };
          const evalInput =
            testCase.type === "multi_turn" && evrenOutputs.length > 1 ? evrenOutputs : lastOutput;

          sendEvent(controller, "progress", {
            stage: "evaluating",
            index,
            total,
            test_case_id: testCase.test_case_id,
            message: "Evaluating…",
          });

          const result = await evaluateOne(
            testCase,
            evalInput,
            apiKey,
            modelName,
            systemPrompt
          );
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

        const totalEvalTimeSeconds = (Date.now() - evalStartMs) / 1000;
        const sessionUpdate = { total_cost_usd: totalCostUsd, total_eval_time_seconds: totalEvalTimeSeconds, title, summary } as Database["public"]["Tables"]["test_sessions"]["Update"];
        await supabase
          .from("test_sessions")
          .update(sessionUpdate as unknown as never)
          .eq("session_id", sessionId);

        sendEvent(controller, "complete", {
          test_session_id: testSessionId,
          total_cost_usd: totalCostUsd,
          title: title ?? undefined,
          summary: summary ?? undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Run failed";
        console.error("[evaluate/run/stream] Error:", message, err);
        sendEvent(controller, "error", { error: message });
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
