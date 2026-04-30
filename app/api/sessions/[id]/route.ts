import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db.types";
import { validateRunMetadata } from "@/lib/db.types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as {
    title?: string;
    test_session_id?: string;
    repeated_runs_mode?: string;
    run_metadata?: unknown;
  };
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
  if (body.repeated_runs_mode === "auto" || body.repeated_runs_mode === "manual") {
    payload.repeated_runs_mode = body.repeated_runs_mode;
  }
  if (body.run_metadata !== undefined) {
    (payload as Record<string, unknown>).run_metadata = validateRunMetadata(body.run_metadata);
  }
  if (Object.keys(payload).length === 0) {
    return NextResponse.json(
      { error: "Provide title, test_session_id, repeated_runs_mode, and/or run_metadata" },
      { status: 400 }
    );
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

  const { data: defaultSettings } = await supabase
    .from("default_settings")
    .select("evaluator_model, summarizer_model")
    .limit(1)
    .maybeSingle();
  const models = defaultSettings
    ? {
        evaluator_model: (defaultSettings as { evaluator_model?: string | null }).evaluator_model ?? null,
        summarizer_model: (defaultSettings as { summarizer_model?: string | null }).summarizer_model ?? null,
      }
    : { evaluator_model: null, summarizer_model: null };

  const sessionId = (session as { session_id: string }).session_id;
  const { data: results, error: resultsError } = await supabase
    .from("eval_results")
    .select("*, test_cases(id, test_case_id, input_message, expected_state, expected_behavior, title, type, turns)")
    .eq("session_id", sessionId)
    .order("eval_result_id");
  if (resultsError) return NextResponse.json({ error: resultsError.message }, { status: 500 });

  const rows = results ?? [];
  const resultsWithTestCaseId = rows.map((r: { test_cases?: Record<string, unknown> & { test_case_id?: string }; test_case_uuid?: string }) => {
    const tc = r.test_cases != null ? { ...r.test_cases } : undefined;
    const tid = tc?.test_case_id;
    return { ...r, test_case_id: tid, test_cases: tc };
  });

  return NextResponse.json({ session, models, results: resultsWithTestCaseId });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("test_sessions")
    .delete()
    .eq("test_session_id", id)
    .select("session_id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
