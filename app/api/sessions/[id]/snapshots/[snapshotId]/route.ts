import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function resolveSessionId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  testSessionId: string
): Promise<{ sessionId: string } | { error: string; status: number }> {
  const { data: session, error: sessionError } = await supabase
    .from("test_sessions")
    .select("session_id")
    .eq("test_session_id", testSessionId)
    .maybeSingle();
  if (sessionError || !session) {
    return { error: sessionError?.message ?? "Session not found", status: 404 };
  }
  return { sessionId: (session as { session_id: string }).session_id };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; snapshotId: string }> }
) {
  const { id, snapshotId } = await params;
  const supabase = await createClient();

  const resolved = await resolveSessionId(supabase, id);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const sessionId = resolved.sessionId;

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; snapshotId: string }> }
) {
  const { id, snapshotId } = await params;
  const supabase = await createClient();

  const resolved = await resolveSessionId(supabase, id);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const sessionId = resolved.sessionId;

  let body: { message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.message !== "string") {
    return NextResponse.json({ error: "Body must include string message" }, { status: 400 });
  }

  const trimmed = body.message.trim();
  const message = trimmed.length > 0 ? trimmed : null;

  const { data: updated, error } = await supabase
    .from("session_result_snapshots")
    .update({ message } as never)
    .eq("snapshot_id", snapshotId)
    .eq("session_id", sessionId)
    .select("snapshot_id, kind, message, created_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  return NextResponse.json({
    snapshot: updated as {
      snapshot_id: string;
      kind: string;
      message: string | null;
      created_at: string;
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; snapshotId: string }> }
) {
  const { id, snapshotId } = await params;
  const supabase = await createClient();

  const resolved = await resolveSessionId(supabase, id);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const sessionId = resolved.sessionId;

  const { data: sessionRow } = await supabase
    .from("test_sessions")
    .select("latest_snapshot_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  const latestId = (sessionRow as { latest_snapshot_id?: string | null } | null)?.latest_snapshot_id ?? null;
  const wasLatest = latestId === snapshotId;

  const { data: deletedRows, error: deleteError } = await supabase
    .from("session_result_snapshots")
    .delete()
    .eq("snapshot_id", snapshotId)
    .eq("session_id", sessionId)
    .select("snapshot_id");

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }
  if (!deletedRows?.length) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  if (wasLatest) {
    const { data: nextSnap } = await supabase
      .from("session_result_snapshots")
      .select("snapshot_id")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    await supabase
      .from("test_sessions")
      .update({
        latest_snapshot_id: ((nextSnap as { snapshot_id?: string } | null)?.snapshot_id ?? null) as never,
      } as never)
      .eq("session_id", sessionId);
  }

  return NextResponse.json({ ok: true });
}
