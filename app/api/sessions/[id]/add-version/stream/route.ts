import { createClient } from "@/lib/supabase/server";
import { callEvrenApi } from "@/lib/evren";
import type { TestCase } from "@/lib/types";
import type { TestCasesRow, EvalResultsRow, EvrenResponseItem } from "@/lib/db.types";

const FALLBACK_EVREN_URL = process.env.NEXT_PUBLIC_EVREN_API_URL || "http://localhost:8000";

type EvalResultLite = Pick<EvalResultsRow, "eval_result_id" | "test_case_uuid" | "evren_responses">;

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

function toResponseVersions(value: EvrenResponseItem["response"] | undefined): string[][] {
  if (typeof value === "string") return [[value]];
  if (!Array.isArray(value)) return [];
  if (value.every((v) => typeof v === "string")) {
    return [value.map((v) => String(v ?? ""))];
  }
  return value.map((version) => {
    if (Array.isArray(version)) return version.map((bubble) => String(bubble ?? ""));
    return [String(version ?? "")];
  });
}

function toStoredResponse(versions: string[][]): EvrenResponseItem["response"] {
  if (versions.length <= 1) return versions[0] ?? [];
  return versions as unknown as EvrenResponseItem["response"];
}

function toDetectedFlagsList(value: EvrenResponseItem["detected_flags"] | undefined): string[] {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.map((v) => String(v ?? ""));
  } catch {
    /* legacy single-version string */
  }
  return [trimmed];
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

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
    .select("evren_api_url")
    .limit(1)
    .maybeSingle();
  const evrenModelApiUrl =
    (settingsRow as { evren_api_url?: string | null } | null)?.evren_api_url?.trim() || FALLBACK_EVREN_URL;

  const { data: evalRows, error: evalError } = await supabase
    .from("eval_results")
    .select("eval_result_id, test_case_uuid, evren_responses")
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

          const existing = Array.isArray(row.evren_responses) ? row.evren_responses : [];
          const mergedLength = Math.max(existing.length, newOutputs.length);
          const mergedResponses: EvrenResponseItem[] = [];
          for (let i = 0; i < mergedLength; i++) {
            const existingItem = existing[i];
            const previousVersions = toResponseVersions(existingItem?.response);
            const previousFlagVersions = toDetectedFlagsList(existingItem?.detected_flags);
            const newOut = newOutputs[i];
            if (newOut) {
              const nextVersion = Array.isArray(newOut.evren_response)
                ? newOut.evren_response.map((v) => String(v ?? ""))
                : [String(newOut.evren_response ?? "")];
              const nextDetectedFlags = String(newOut.detected_states ?? "");
              const mergedVersions = [...previousVersions, nextVersion];
              mergedResponses.push({
                response: toStoredResponse(mergedVersions),
                detected_flags: JSON.stringify([...previousFlagVersions, nextDetectedFlags]),
              });
            } else {
              mergedResponses.push({
                response: toStoredResponse(previousVersions),
                detected_flags: previousFlagVersions.length
                  ? JSON.stringify(previousFlagVersions)
                  : String(existingItem?.detected_flags ?? ""),
              });
            }
          }

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

