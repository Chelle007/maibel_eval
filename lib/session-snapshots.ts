import type { SupabaseClient } from "@supabase/supabase-js";

type SnapshotEvalResult = {
  eval_result_id: string;
  test_case_id: string | null;
  test_case_title: string | null;
  comparison: unknown | null;
  behavior_review: unknown;
  reason: string | null;
  success: boolean;
  score: number;
  manually_edited?: boolean;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  cost_usd?: number | null;
  /** Full version runs at checkpoint time (required to replay the page from history). */
  evren_responses?: unknown;
  /** Joined test_cases row shape for UI replay. */
  test_cases?: unknown;
};

type SnapshotPayload = {
  session?: {
    test_session_id?: string;
    title?: string | null;
    mode?: "single" | "comparison";
    summary?: string | null;
    session_review_summary?: unknown;
  };
  eval_results?: SnapshotEvalResult[];
};

async function buildSnapshotPayload(
  supabase: SupabaseClient,
  sessionId: string
): Promise<SnapshotPayload> {
  const [{ data: session }, { data: evalRows }] = await Promise.all([
    supabase
      .from("test_sessions")
      .select("test_session_id, title, mode, summary, session_review_summary")
      .eq("session_id", sessionId)
      .maybeSingle(),
    supabase
      .from("eval_results")
      .select(
        [
          "eval_result_id",
          "evren_responses",
          "comparison",
          "behavior_review",
          "reason",
          "success",
          "score",
          "manually_edited",
          "prompt_tokens",
          "completion_tokens",
          "total_tokens",
          "cost_usd",
          "test_cases(id, test_case_id, input_message, expected_state, expected_behavior, title, type, turns, forbidden, notes, img_url)",
        ].join(", ")
      )
      .eq("session_id", sessionId)
      .order("eval_result_id"),
  ]);

  const sessionData = session as {
    test_session_id?: string;
    title?: string | null;
    mode?: "single" | "comparison";
    summary?: string | null;
    session_review_summary?: unknown;
  } | null;

  type RawEvalRow = {
    eval_result_id: string;
    evren_responses: unknown;
    comparison: unknown;
    behavior_review: unknown;
    reason: string | null;
    success: boolean;
    score: number;
    manually_edited?: boolean;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
    cost_usd?: number | null;
    test_cases: Record<string, unknown> | Record<string, unknown>[] | null;
  };

  const evalResults: SnapshotEvalResult[] = ((evalRows ?? []) as unknown as RawEvalRow[]).map((r) => {
    const tcRaw = Array.isArray(r.test_cases) ? r.test_cases[0] : r.test_cases;
    const tc = tcRaw && typeof tcRaw === "object" ? (tcRaw as Record<string, unknown>) : null;
    return {
      eval_result_id: r.eval_result_id,
      test_case_id: (tc?.test_case_id as string | undefined) ?? null,
      test_case_title: (tc?.title as string | null | undefined) ?? null,
      comparison: r.comparison ?? null,
      behavior_review: r.behavior_review ?? {},
      reason: r.reason ?? null,
      success: Boolean(r.success),
      score: Number(r.score ?? 0),
      manually_edited: Boolean(r.manually_edited),
      prompt_tokens: r.prompt_tokens ?? null,
      completion_tokens: r.completion_tokens ?? null,
      total_tokens: r.total_tokens ?? null,
      cost_usd: r.cost_usd ?? null,
      evren_responses: r.evren_responses,
      test_cases: tc,
    };
  });

  return {
    session: sessionData
      ? {
          test_session_id: sessionData.test_session_id,
          title: sessionData.title ?? null,
          mode: sessionData.mode,
          summary: sessionData.summary ?? null,
          session_review_summary: sessionData.session_review_summary,
        }
      : undefined,
    eval_results: evalResults,
  };
}

/**
 * Create a new snapshot of the current session state (comparison results,
 * dimension reviews, session summary). Called before add_version / delete_version.
 * Updates test_sessions.latest_snapshot_id to point to this new snapshot.
 */
export async function createSessionResultSnapshot({
  supabase,
  sessionId,
  kind,
  message,
}: {
  supabase: SupabaseClient;
  sessionId: string;
  kind: string;
  message?: string | null;
}): Promise<string | null> {
  try {
    const payload = await buildSnapshotPayload(supabase, sessionId);

    const { data: inserted, error: insertError } = await supabase
      .from("session_result_snapshots")
      .insert({
        session_id: sessionId,
        kind,
        message: message ?? null,
        payload: payload as never,
      })
      .select("snapshot_id")
      .single();

    if (insertError || !inserted) {
      console.error("[session-snapshots] insert failed:", insertError?.message);
      return null;
    }

    const snapshotId = (inserted as { snapshot_id: string }).snapshot_id;

    await supabase
      .from("test_sessions")
      .update({ latest_snapshot_id: snapshotId } as never)
      .eq("session_id", sessionId);

    return snapshotId;
  } catch (err) {
    console.error("[session-snapshots] createSessionResultSnapshot error:", err);
    return null;
  }
}

/**
 * Refresh the payload of the current latest snapshot in-place.
 * Called after edits / resummarize — keeps the snapshot up-to-date without
 * creating new history entries.
 * If no latest snapshot exists yet, creates one with kind="current".
 */
export async function refreshLatestSessionResultSnapshot({
  supabase,
  sessionId,
}: {
  supabase: SupabaseClient;
  sessionId: string;
}): Promise<void> {
  try {
    const { data: sessionRow } = await supabase
      .from("test_sessions")
      .select("latest_snapshot_id")
      .eq("session_id", sessionId)
      .maybeSingle();

    const latestId = (sessionRow as { latest_snapshot_id?: string | null } | null)
      ?.latest_snapshot_id ?? null;

    if (!latestId) {
      await createSessionResultSnapshot({
        supabase,
        sessionId,
        kind: "current",
        message: "Auto-created on first edit",
      });
      return;
    }

    const payload = await buildSnapshotPayload(supabase, sessionId);

    await supabase
      .from("session_result_snapshots")
      .update({ payload: payload as never })
      .eq("snapshot_id", latestId);
  } catch (err) {
    console.error("[session-snapshots] refreshLatestSessionResultSnapshot error:", err);
  }
}
