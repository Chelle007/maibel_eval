import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("test_sessions")
    .select("*, users(full_name, email)")
    .eq("test_session_id", id)
    .single();
  if (sessionError || !session) {
    return NextResponse.json({ error: sessionError?.message ?? "Not found" }, { status: 404 });
  }
  const { data: results, error: resultsError } = await supabase
    .from("eval_results")
    .select("*, test_cases(input_message, expected_state, expected_behavior, title, context), evren_responses(evren_response, detected_states)")
    .eq("test_session_id", id)
    .order("eval_result_id");
  if (resultsError) return NextResponse.json({ error: resultsError.message }, { status: 500 });

  const rows = results ?? [];
  const testCaseIds = [...new Set(rows.map((r: { test_case_id?: string }) => r.test_case_id).filter(Boolean))] as string[];
  let contextByTestCaseId: Record<string, string | null> = {};
  if (testCaseIds.length > 0) {
    const { data: contextRows } = await supabase
      .from("test_cases")
      .select("test_case_id, context")
      .in("test_case_id", testCaseIds);
    if (contextRows) {
      contextByTestCaseId = Object.fromEntries(
        contextRows.map((row: { test_case_id: string; context: string | null }) => [row.test_case_id, row.context ?? null])
      );
    }
  }

  const resultsWithContext = rows.map((r: { test_case_id?: string; test_cases?: Record<string, unknown> }) => {
    const tid = r.test_case_id;
    const tc = r.test_cases != null ? { ...r.test_cases } : undefined;
    if (tid != null && tc != null && tid in contextByTestCaseId) {
      tc.context = contextByTestCaseId[tid];
    }
    return { ...r, test_cases: tc };
  });

  return NextResponse.json({ session, results: resultsWithContext });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from("test_sessions")
    .delete()
    .eq("test_session_id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === "PGRST116" ? 404 : 500 });
  }
  return new Response(null, { status: 204 });
}
