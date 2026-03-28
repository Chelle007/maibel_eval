import { createClient } from "@/lib/supabase/server";
import { callEvrenApi } from "@/lib/evren";
import { compareOverall } from "@/lib/comparator";
import { loadComparatorOverallSystemPrompt } from "@/lib/prompts";
import type { TestCase } from "@/lib/types";
import type { DefaultSettingsRow, EvalResultsRow, RunEntry, TestCasesRow, VersionEntry } from "@/lib/db.types";

const FALLBACK_EVREN_URL = process.env.NEXT_PUBLIC_EVREN_API_URL || "http://localhost:8000";

type EvalResultLite = Pick<EvalResultsRow, "eval_result_id" | "test_case_uuid" | "evren_responses" | "comparison">;

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

  let body: { version_name?: string; run_count?: number; run_comparison?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }
  const runComparison = body.run_comparison ?? false;
  const runCount = Number.isFinite(body.run_count) ? Math.max(1, Math.floor(body.run_count as number)) : 1;

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
  const testCaseById = new Map((testCaseRows ?? []).map((r) => [(r as TestCasesRow).id, r as TestCasesRow]));

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

        const maxConcurrentTestCases = getMaxConcurrentTestCases(runCount);
        let completedCount = 0;

        await runWithConcurrency(rows, maxConcurrentTestCases, async (row, index) => {
          const tc = testCaseById.get(row.test_case_uuid);
          const tcId = tc?.test_case_id ?? "(unknown)";

          if (!tc) {
            completedCount++;
            sendEvent(controller, "progress", {
              stage: "done",
              index: completedCount,
              total: rows.length,
              test_case_id: tcId,
              message: `Completed ${completedCount} of ${rows.length}`,
            });
            return;
          }

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

          const runPromises = Array.from({ length: runCount }, async () => callEvrenApi(evrenModelApiUrl, testCase));
          const runResults = await Promise.allSettled(runPromises);
          const runs: RunEntry[] = [];

          for (let runIndex = 0; runIndex < runResults.length; runIndex++) {
            const settled = runResults[runIndex];
            if (settled.status !== "fulfilled") {
              const msg =
                settled.reason instanceof Error ? settled.reason.message : String(settled.reason ?? "Evren error");
              sendEvent(controller, "progress", {
                stage: "error",
                index,
                total: rows.length,
                test_case_id: tc.test_case_id,
                message: `Evren API failed on run ${runIndex + 1}: ${msg.slice(0, 80)}${msg.length > 80 ? "…" : ""}`,
              });
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
          if (runs.length === 0) {
            completedCount++;
            sendEvent(controller, "progress", {
              stage: "done",
              index: completedCount,
              total: rows.length,
              test_case_id: tc.test_case_id,
              message: `Completed ${completedCount} of ${rows.length}`,
            });
            return;
          }

          const existing = Array.isArray(row.evren_responses) ? (row.evren_responses as VersionEntry[]) : [];
          const newVersion: VersionEntry = {
            version_id: newVersionId,
            version_name: versionName,
            run_count_requested: runCount,
            evidence_source: runCount > 1 ? "automated" : "none",
            comparison_basis_run_index: 1,
            runs,
          };
          const mergedResponses = [...existing, newVersion];

          await supabase
            .from("eval_results")
            .update({ evren_responses: mergedResponses } as never)
            .eq("eval_result_id", row.eval_result_id);

          completedCount++;
          sendEvent(controller, "progress", {
            stage: "done",
            index: completedCount,
            total: rows.length,
            test_case_id: tc.test_case_id,
            message: `Completed ${completedCount} of ${rows.length}`,
          });
        });

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

          const comparatorPrompt = loadComparatorOverallSystemPrompt();

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

            const versionIds = versions.map((v) => v.version_id).slice(0, 3);
            if (versionIds.length < 2) continue;

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
              const compResult = await compareOverall(
                testCase,
                versions,
                versionIds.length === 2
                  ? ([versionIds[0], versionIds[1]] as [string, string])
                  : ([versionIds[0], versionIds[1], versionIds[2]] as [string, string, string]),
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
