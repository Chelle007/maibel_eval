import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EvalResultsRow, EvrenResponseItem } from "@/lib/db.types";

type EvalResultLite = Pick<EvalResultsRow, "eval_result_id" | "evren_responses">;

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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { version_index?: number };
  const versionIndex = Number(body.version_index);
  if (!Number.isInteger(versionIndex) || versionIndex < 0) {
    return NextResponse.json({ error: "version_index must be a non-negative integer" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("test_sessions")
    .select("session_id")
    .eq("test_session_id", id)
    .maybeSingle();
  if (sessionError || !session) {
    return NextResponse.json({ error: sessionError?.message ?? "Session not found" }, { status: 404 });
  }
  const sessionId = (session as { session_id: string }).session_id;

  const { data: evalRows, error: evalError } = await supabase
    .from("eval_results")
    .select("eval_result_id, evren_responses")
    .eq("session_id", sessionId)
    .order("eval_result_id");
  if (evalError) return NextResponse.json({ error: evalError.message }, { status: 500 });

  const rows = (evalRows ?? []) as EvalResultLite[];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No test case rows found in this session." }, { status: 400 });
  }

  for (const row of rows) {
    const existing = Array.isArray(row.evren_responses) ? row.evren_responses : [];
    const updated: EvrenResponseItem[] = existing.map((item) => {
      const responseVersions = toResponseVersions(item?.response);
      const flagVersions = toDetectedFlagsList(item?.detected_flags);

      const nextResponseVersions =
        responseVersions.length > versionIndex
          ? responseVersions.filter((_, idx) => idx !== versionIndex)
          : responseVersions;
      const nextFlagVersions =
        flagVersions.length > versionIndex
          ? flagVersions.filter((_, idx) => idx !== versionIndex)
          : flagVersions;

      return {
        response: toStoredResponse(nextResponseVersions),
        detected_flags: nextFlagVersions.length ? JSON.stringify(nextFlagVersions) : "",
      };
    });

    await supabase
      .from("eval_results")
      .update({ evren_responses: updated } as never)
      .eq("eval_result_id", row.eval_result_id);
  }

  const { data: updatedResults, error: resultsError } = await supabase
    .from("eval_results")
    .select("*, test_cases(id, test_case_id, input_message, expected_state, expected_behavior, title, type, turns)")
    .eq("session_id", sessionId)
    .order("eval_result_id");
  if (resultsError) return NextResponse.json({ error: resultsError.message }, { status: 500 });

  const resultsWithTestCaseId = (updatedResults ?? []).map((r: { test_cases?: Record<string, unknown> & { test_case_id?: string } }) => {
    const tc = r.test_cases != null ? { ...r.test_cases } : undefined;
    return { ...r, test_case_id: tc?.test_case_id, test_cases: tc };
  });

  return NextResponse.json({ results: resultsWithTestCaseId });
}

