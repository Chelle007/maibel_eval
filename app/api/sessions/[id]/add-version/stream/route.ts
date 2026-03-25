import { createClient } from "@/lib/supabase/server";
import { callEvrenApi } from "@/lib/evren";
import { compareTriple, runRoundRobin } from "@/lib/comparator";
import { loadComparatorSystemPrompt, loadComparatorTripleSystemPrompt } from "@/lib/prompts";
import type { TestCase } from "@/lib/types";
import type { TestCasesRow, EvalResultsRow, VersionEntry, DefaultSettingsRow } from "@/lib/db.types";

const FALLBACK_EVREN_URL = process.env.NEXT_PUBLIC_EVREN_API_URL || "http://localhost:8000";

type EvalResultLite = Pick<EvalResultsRow, "eval_result_id" | "test_case_uuid" | "evren_responses" | "comparison">;

function sendEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  type: string,
  payload: object
) {
  try {
    const data = JSON.stringify({ type, ...payload });
    controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
  } catch {
    /* controller likely closed */
  }
}

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
    return new Response(JSON.stringify({ error: "Missing GEMINI_API_KEY (required for comparison)" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: session, error: sessionError } = await supabase
    .from("test_sessions")
    .select("session_id")
    .eq("test_session_id", id)
    .maybeSingle();
  if (sessionError || !session) {
    return new Response(JSON.stringify({ error: sessionError?.message ?? "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
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
    return new Response(JSON.stringify({ error: evalError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rows = (evalRows ?? []) as EvalResultLite[];
  if (rows.length === 0) {
    return new Response(JSON.stringify({ error: "No test case rows found in this session." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const testCaseIds = Array.from(new Set(rows.map((r) => r.test_case_uuid).filter(Boolean)));
  const { data: testCaseRows, error: tcError } = await supabase
    .from("test_cases")
    .select("*")
    .in("id", testCaseIds);
  if (tcError) {
    return new Response(JSON.stringify({ error: tcError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const testCaseById = new Map((testCaseRows ?? []).map((r) => [r.id, r as TestCasesRow]));

  const existingVersions = Array.isArray(rows[0]?.evren_responses) ? rows[0].evren_responses : [];
  if (existingVersions.length >= 3) {
    return new Response(JSON.stringify({ error: "Maximum of 3 versions allowed per session." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const versionName = body.version_name?.trim() || `Version ${existingVersions.length + 1}`;
  const newVersionId = crypto.randomUUID();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        sendEvent(controller, "progress", {
          stage: "start",
          total: rows.length,
          message: `Adding version for ${rows.length} test case${rows.length === 1 ? "" : "s"}…`,
        });

        for (let index = 0; index < rows.length; index++) {
          const row = rows[index];
          const tc = testCaseById.get(row.test_case_uuid);
          if (!tc) continue;

          sendEvent(controller, "progress", {
            stage: "evren",
            index,
            total: rows.length,
            test_case_id: tc.test_case_id,
            message: "Rerunning Evren…",
          });

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
            const msg = evrenErr instanceof Error ? evrenErr.message : String(evrenErr);
            sendEvent(controller, "progress", {
              stage: "error",
              index,
              total: rows.length,
              test_case_id: tc.test_case_id,
              message: `Evren API failed: ${msg.slice(0, 80)}${msg.length > 80 ? "…" : ""}`,
            });
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

          sendEvent(controller, "progress", {
            stage: "done",
            index: index + 1,
            total: rows.length,
            test_case_id: tc.test_case_id,
            message: `Completed ${index + 1} of ${rows.length}`,
          });
        }

        // --- Comparison phase ---
        if (runComparison && apiKey) {
          const { data: freshRows } = await supabase
            .from("eval_results")
            .select("eval_result_id, test_case_uuid, evren_responses, comparison")
            .eq("session_id", sessionId)
            .order("eval_result_id");
          const compRows = (freshRows ?? []) as EvalResultLite[];
          const compTotal = compRows.length;

          sendEvent(controller, "progress", {
            stage: "comparing",
            total: compTotal,
            message: `Running comparisons for ${compTotal} test case${compTotal === 1 ? "" : "s"}…`,
          });

          const comparatorPrompt = loadComparatorSystemPrompt();
          const comparatorTriplePrompt = loadComparatorTripleSystemPrompt();

          for (let ci = 0; ci < compRows.length; ci++) {
            const compRow = compRows[ci];
            const tc = testCaseById.get(compRow.test_case_uuid);
            if (!tc) continue;

            const versions = Array.isArray(compRow.evren_responses) ? (compRow.evren_responses as VersionEntry[]) : [];

            if (versions.length < 2) {
              sendEvent(controller, "progress", {
                stage: "comparing_skip",
                index: ci,
                total: compTotal,
                test_case_id: tc.test_case_id,
                message: "Only 1 version, skipping comparison.",
              });
              continue;
            }

            sendEvent(controller, "progress", {
              stage: "comparing",
              index: ci,
              total: compTotal,
              test_case_id: tc.test_case_id,
              message: "Comparing versions…",
            });

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
              const compResult =
                versions.length === 3
                  ? await compareTriple(
                      testCase,
                      versions,
                      [versions[0].version_id, versions[1].version_id, versions[2].version_id],
                      apiKey,
                      comparatorModel,
                      comparatorTriplePrompt
                    )
                  : await runRoundRobin(
                      testCase,
                      versions,
                      apiKey,
                      comparatorModel,
                      comparatorPrompt
                    );

              await supabase
                .from("eval_results")
                .update({ comparison: compResult } as never)
                .eq("eval_result_id", compRow.eval_result_id);

              sendEvent(controller, "progress", {
                stage: "compared",
                index: ci + 1,
                total: compTotal,
                test_case_id: tc.test_case_id,
                message: `Compared ${ci + 1} of ${compTotal}`,
              });
            } catch (compErr) {
              const msg = compErr instanceof Error ? compErr.message : String(compErr);
              console.error("[add-version/stream] Comparison error for", tc.test_case_id, msg);
              sendEvent(controller, "progress", {
                stage: "compare_error",
                index: ci,
                total: compTotal,
                test_case_id: tc.test_case_id,
                message: `Comparison failed: ${msg.slice(0, 80)}`,
              });
            }
          }
        }

        const { data: updatedResults, error: resultsError } = await supabase
          .from("eval_results")
          .select("*, test_cases(id, test_case_id, input_message, expected_state, expected_behavior, title, type, turns)")
          .eq("session_id", sessionId)
          .order("eval_result_id");
        if (resultsError) {
          sendEvent(controller, "error", { error: resultsError.message });
          return;
        }

        const resultsWithTestCaseId = (updatedResults ?? []).map((r: { test_cases?: Record<string, unknown> & { test_case_id?: string } }) => {
          const tc = r.test_cases != null ? { ...r.test_cases } : undefined;
          return { ...r, test_case_id: tc?.test_case_id, test_cases: tc };
        });

        sendEvent(controller, "complete", { results: resultsWithTestCaseId });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Add version failed";
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
