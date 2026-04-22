import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { DefaultSettingsRow } from "@/lib/db.types";
import { persistSessionReviewSummaryForSession } from "@/lib/session-review-summary-refresh";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: testSessionId } = await params;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing GEMINI_API_KEY" }, { status: 500 });
  }

  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("test_sessions")
    .select("session_id, mode, title, summary")
    .eq("test_session_id", testSessionId)
    .single();
  if (sessionError || !session) {
    return NextResponse.json({ error: sessionError?.message ?? "Session not found" }, { status: 404 });
  }

  const row = session as {
    session_id: string;
    mode?: string;
    title?: string | null;
    summary?: string | null;
  };
  const sessionId = row.session_id;
  const sessionMode = row.mode === "comparison" ? "comparison" : "single";

  const { data: settingsRow } = await supabase
    .from("default_settings")
    .select("evaluator_model")
    .limit(1)
    .maybeSingle();
  const modelName =
    (settingsRow as Pick<DefaultSettingsRow, "evaluator_model"> | null)?.evaluator_model?.trim() ||
    "gemini-3-flash-preview";

  const persist = await persistSessionReviewSummaryForSession(supabase, {
    sessionId,
    sessionMode,
    sessionTitle: row.title ?? null,
    sessionSummary: row.summary ?? null,
    apiKey,
    modelName,
    logPrefix: "[resummarize-review-summary]",
  });

  if (!persist.ok) {
    return NextResponse.json(
      { error: persist.error === "draft_empty" ? "Nothing to draft (no eval rows or drafter failed)." : persist.error },
      { status: persist.error === "draft_empty" ? 400 : 502 }
    );
  }

  const { data: sessionOut, error: outErr } = await supabase
    .from("test_sessions")
    .select("*")
    .eq("test_session_id", testSessionId)
    .single();
  if (outErr || !sessionOut) {
    return NextResponse.json({ error: outErr?.message ?? "Failed to load session after update" }, { status: 500 });
  }

  return NextResponse.json({ session: sessionOut });
}
