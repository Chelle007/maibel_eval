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
    .select("*, test_cases(input_message, expected_state, expected_behavior, title), evren_responses(evren_response, detected_states)")
    .eq("test_session_id", id)
    .order("eval_result_id");
  if (resultsError) return NextResponse.json({ error: resultsError.message }, { status: 500 });
  return NextResponse.json({ session, results: results ?? [] });
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
