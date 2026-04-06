import { createClient } from "@/lib/supabase/server";
import { getMaxConcurrentTestCases, runWithConcurrency } from "@/lib/evren-concurrency";
import { callEvrenApi } from "@/lib/evren";
import { compareOverall } from "@/lib/comparator";
import { loadComparatorOverallSystemPrompt } from "@/lib/prompts";
import { loadContextPack } from "@/lib/context-pack";
import type { TestCase } from "@/lib/types";
import type { DefaultSettingsRow, EvalResultsRow, RunEntry, TestCasesRow, VersionEntry } from "@/lib/db.types";

const FALLBACK_EVREN_URL = process.env.NEXT_PUBLIC_EVREN_API_URL || "http://localhost:8000";
const DEFAULT_MAX_INFLIGHT_COMPARISONS = 3;

function getMaxConcurrentComparisons(): number {
  const raw = process.env.MAX_INFLIGHT_COMPARISONS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_INFLIGHT_COMPARISONS;
}

function createLimiter(maxInFlight: number) {
  const limit = Number.isFinite(maxInFlight) && maxInFlight > 0 ? Math.floor(maxInFlight) : 1;
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= limit) return;
    const run = queue.shift();
    if (!run) return;
    active++;
    run();
  };

  return async <T>(fn: () => Promise<T>): Promise<T> =>
    await new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}

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

  let body: {
    version_name?: string;
    run_count?: number;
    run_comparison?: boolean;
    include_extended_context?: boolean;
  } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }
  const runComparison = body.run_comparison ?? false;
  const runCount = Number.isFinite(body.run_count) ? Math.max(1, Math.floor(body.run_count as number)) : 1;
  const includeExtendedContext = body.include_extended_context === true;

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
    .select("session_id, context_bundle_id, context_extended_enabled")
    .eq("test_session_id", id)
    .maybeSingle();
  if (sessionError || !session) {
    return new Response(JSON.stringify({ error: sessionError?.message ?? "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessionId = (session as { session_id: string }).session_id;
  const sessionCtx = session as { context_bundle_id?: string | null; context_extended_enabled?: boolean | null };
  const useExtended = includeExtendedContext || sessionCtx.context_extended_enabled === true;

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

        // If enabled, start comparisons as soon as each test case finishes adding its new version,
        // bounded by a separate concurrency limit. This overlaps "add version" and "compare" work.
        const comparatorPrompt = runComparison ? loadComparatorOverallSystemPrompt() : "";
        const maxConcurrentComparisons = runComparison ? getMaxConcurrentComparisons() : 1;
        const limitComparison = createLimiter(maxConcurrentComparisons);
        const comparisonPromises: Promise<void>[] = [];
        let comparedCount = 0;

        await runWithConcurrency(rows, maxConcurrentTestCases, async (row) => {
          const tc = testCaseById.get(row.test_case_uuid);
          if (!tc) return;

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
              console.error("[add-version/stream] Evren error for", tc.test_case_id, msg);
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

          if (runs.length > 0) {
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

            if (runComparison && apiKey) {
              comparisonPromises.push(
                limitComparison(async () => {
                  const versions = mergedResponses;
                  if (versions.length < 2) return;

                  const versionIds = versions.map((v) => v.version_id).slice(0, 3);
                  if (versionIds.length < 2) return;

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
                    const contextPack = loadContextPack({
                      includeExtended: useExtended,
                      purpose: "comparator",
                      query: `${testCase.test_case_id}\n${testCase.expected_state}\n${testCase.expected_behavior}\n${testCase.forbidden ?? ""}\n${testCase.notes ?? ""}`,
                    });
                    const compResult = await compareOverall(
                      testCase,
                      versions,
                      versionIds.length === 2
                        ? ([versionIds[0], versionIds[1]] as [string, string])
                        : ([versionIds[0], versionIds[1], versionIds[2]] as [string, string, string]),
                      apiKey,
                      comparatorModel,
                      comparatorPrompt,
                      { text: contextPack.text, bundleId: contextPack.bundleId }
                    );

                    await supabase
                      .from("eval_results")
                      .update({ comparison: compResult } as never)
                      .eq("eval_result_id", row.eval_result_id);

                    comparedCount++;
                    sendEvent(controller, "progress", {
                      stage: "compared",
                      index: comparedCount,
                      total: rows.length,
                      test_case_id: tc.test_case_id,
                      message: `Compared ${comparedCount} of ${rows.length}`,
                    });
                  } catch (compErr) {
                    comparedCount++;
                    const msg = compErr instanceof Error ? compErr.message : String(compErr);
                    console.error("[add-version/stream] Comparison error for", tc.test_case_id, msg);
                    sendEvent(controller, "progress", {
                      stage: "compare_error",
                      index: comparedCount,
                      total: rows.length,
                      test_case_id: tc.test_case_id,
                      message: `Comparison failed: ${msg.slice(0, 80)}`,
                    });
                  }
                })
              );
            }
          }

          completedCount++;
          sendEvent(controller, "progress", {
            stage: "done",
            index: completedCount,
            total: rows.length,
            test_case_id: tc.test_case_id,
            message: `Completed ${completedCount} of ${rows.length}`,
          });
        });

        if (runComparison && apiKey) {
          sendEvent(controller, "progress", {
            stage: "comparing",
            total: rows.length,
            message: `Running comparisons for ${rows.length} test case${rows.length === 1 ? "" : "s"}…`,
          });
          await Promise.allSettled(comparisonPromises);
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
