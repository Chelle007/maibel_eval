import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db.types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as { title?: string; test_session_id?: string };
  const supabase = await createClient();

  const newSessionId = typeof body.test_session_id === "string" ? body.test_session_id.trim() : undefined;
  const newTitle = typeof body.title === "string" ? body.title.trim() : body.title === null ? "" : undefined;

  if (newSessionId !== undefined) {
    if (!newSessionId) {
      return NextResponse.json({ error: "test_session_id cannot be empty" }, { status: 400 });
    }
    if (newSessionId !== id) {
      const { data: existing } = await supabase
        .from("test_sessions")
        .select("test_session_id")
        .eq("test_session_id", newSessionId)
        .maybeSingle();
      if (existing) {
        return NextResponse.json(
          { error: "A session with this ID already exists." },
          { status: 409 }
        );
      }
    }
  }

  const payload: Database["public"]["Tables"]["test_sessions"]["Update"] = {};
  if (newTitle !== undefined) payload.title = newTitle || null;
  if (newSessionId !== undefined) payload.test_session_id = newSessionId;
  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "Provide title and/or test_session_id" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("test_sessions")
    .update(payload as unknown as never)
    .eq("test_session_id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    session: data,
    redirect_id: newSessionId && newSessionId !== id ? newSessionId : undefined,
  });
}

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
  const sessionId = (session as { session_id: string }).session_id;
  const { data: results, error: resultsError } = await supabase
    .from("eval_results")
    .select("*, test_cases(id, test_case_id, input_message, expected_state, expected_behavior, title, context, type, turns)")
    .eq("session_id", sessionId)
    .order("eval_result_id");
  if (resultsError) return NextResponse.json({ error: resultsError.message }, { status: 500 });

  const rows = results ?? [];
  const testCaseIds = [...new Set(rows.map((r: { test_cases?: { test_case_id?: string } }) => r.test_cases?.test_case_id).filter(Boolean))] as string[];
  let contextByTestCaseId: Record<string, string | null> = {};
  if (testCaseIds.length > 0) {
    const { data: contextRows } = await supabase
      .from("test_cases")
      .select("test_case_id, context")
      .in("test_case_id", testCaseIds);
    if (contextRows) {
      contextByTestCaseId = Object.fromEntries(
        (contextRows as { test_case_id: string; context: string | null }[]).map((row) => [row.test_case_id, row.context ?? null])
      );
    }
  }

  const resultsWithContext = rows.map((r: { test_cases?: Record<string, unknown> & { test_case_id?: string }; test_case_uuid?: string }) => {
    const tc = r.test_cases != null ? { ...r.test_cases } : undefined;
    const tid = tc?.test_case_id;
    if (tid != null && tc != null && tid in contextByTestCaseId) {
      tc.context = contextByTestCaseId[tid];
    }
    return { ...r, test_case_id: tid, test_cases: tc };
  });

  return NextResponse.json({ session, results: resultsWithContext });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase.from("test_sessions").delete().eq("test_session_id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === "PGRST116" ? 404 : 500 });
  }
  return new Response(null, { status: 204 });
}
