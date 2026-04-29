import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; snapshotId: string }> }
) {
  const { id, snapshotId } = await params;
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

  const { data: snapshot, error } = await supabase
    .from("session_result_snapshots")
    .select("snapshot_id, kind, message, payload, created_at")
    .eq("snapshot_id", snapshotId)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  return NextResponse.json({ snapshot });
}
