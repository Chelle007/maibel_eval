import { callEvrenApi } from "@/lib/evren";
import { evaluateOne } from "@/lib/evaluator";
import { loadEvaluatorSystemPrompt } from "@/lib/prompts";
import { fetchSheetRows, sheetRowToTestCase } from "@/lib/sheet";
import type { EvaluationResult, TestCase } from "@/lib/types";

function sendEvent(controller: ReadableStreamDefaultController<Uint8Array>, type: string, payload: object) {
  const data = JSON.stringify({ type, ...payload });
  controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Missing GEMINI_API_KEY environment variable" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: {
    system_prompt?: string;
    evren_model_api_url?: string;
    google_sheet_link?: string;
    model_name?: string;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const evrenModelApiUrl = body.evren_model_api_url;
  const googleSheetLink = body.google_sheet_link;
  if (!evrenModelApiUrl || !googleSheetLink) {
    return new Response(
      JSON.stringify({ error: "Request body must include 'evren_model_api_url' and 'google_sheet_link'." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        sendEvent(controller, "progress", { stage: "sheet", message: "Fetching sheet…" });
        const rows = await fetchSheetRows(googleSheetLink);
        const total = rows.filter((row) => {
          const tc = sheetRowToTestCase(row);
          return tc.input_message?.trim();
        }).length;
        sendEvent(controller, "progress", { stage: "sheet", message: `Found ${total} test case(s).`, total });

        const modelName = body.model_name ?? "gemini-2.5-flash";
        const systemPrompt = body.system_prompt ?? loadEvaluatorSystemPrompt();
        const results: EvaluationResult[] = [];
        let index = 0;

        for (const row of rows) {
          const testCase = sheetRowToTestCase(row);
          if (!testCase.input_message?.trim()) continue;

          const test_case_id = testCase.test_case_id || `#${index + 1}`;
          sendEvent(controller, "progress", {
            stage: "evren",
            index,
            total,
            test_case_id,
            message: `Waiting for Evren response…`,
          });

          const evrenOutput = await callEvrenApi(evrenModelApiUrl, testCase);

          sendEvent(controller, "progress", {
            stage: "evaluating",
            index,
            total,
            test_case_id,
            message: `Evaluating…`,
          });

          const result = await evaluateOne(
            testCase,
            evrenOutput,
            apiKey,
            modelName,
            systemPrompt
          );
          results.push(result);
          sendEvent(controller, "progress", {
            stage: "done",
            index,
            total,
            test_case_id,
            result,
          });
          index += 1;
        }

        sendEvent(controller, "complete", { results });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Run failed";
        console.error("[stream] Error during run:", message, err);
        try {
          sendEvent(controller, "error", { error: message });
        } catch {
          // stream already closed
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
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
