import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { DefaultSettingsRow } from "@/lib/db.types";
import { getAnthropicEvalApiKey } from "@/lib/eval-llm-env";
import { DEFAULT_EVAL_LLM_MODEL, normalizeAnthropicModelName } from "@/lib/eval-llm-defaults";
import { persistSessionReviewSummaryForSession } from "@/lib/session-review-summary-refresh";
import { createSessionResultSnapshot } from "@/lib/session-snapshots";
import { rerunComparisonsForSession } from "@/lib/rerun-session-comparisons";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: testSessionId } = await params;
  const apiKey = getAnthropicEvalApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ANTHROPIC_API_KEY or CLAUDE_API_KEY (required for comparison)" },
      { status: 500 }
    );
  }

  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("test_sessions")
    .select("session_id, mode, title, summary")
    .eq("test_session_id", testSessionId)
    .maybeSingle();
  if (sessionError || !session) {
    return NextResponse.json({ error: sessionError?.message ?? "Session not found" }, { status: 404 });
  }

  const row = session as {
    session_id: string;
    mode?: string;
    title?: string | null;
    summary?: string | null;
  };
  if (row.mode !== "comparison") {
    return NextResponse.json(
      { error: "Rerun comparison is only available for comparison sessions." },
      { status: 400 }
    );
  }

  const sessionId = row.session_id;

  await createSessionResultSnapshot({
    supabase,
    sessionId,
    kind: "before_rerun_comparison",
    message: "Before rerun all comparisons",
  });

  const { data: settingsRow } = await supabase
    .from("default_settings")
    .select("evaluator_model")
    .limit(1)
    .maybeSingle();
  const comparatorModelRaw =
    (settingsRow as Pick<DefaultSettingsRow, "evaluator_model"> | null)?.evaluator_model?.trim() ||
    DEFAULT_EVAL_LLM_MODEL;
  const comparatorModel = normalizeAnthropicModelName(comparatorModelRaw) ?? DEFAULT_EVAL_LLM_MODEL;

  let summary: Awaited<ReturnType<typeof rerunComparisonsForSession>>;
  try {
    summary = await rerunComparisonsForSession({
      supabase,
      sessionId,
      apiKey,
      comparatorModel,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[rerun-comparison]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  await persistSessionReviewSummaryForSession(supabase, {
    sessionId,
    sessionMode: "comparison",
    sessionTitle: row.title ?? null,
    sessionSummary: row.summary ?? null,
    apiKey,
    modelName: comparatorModel,
    logPrefix: "[rerun-comparison]",
  });

  return NextResponse.json(summary);
}
