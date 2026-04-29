import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db.types";
import { fingerprintEvalResultsComparisons } from "@/lib/session-review-summary-basis";
import {
  toSessionReviewSummaryJson,
  validateSessionReviewSummaryV0Payload,
} from "@/lib/session-review-summary";
import { refreshLatestSessionResultSnapshot } from "@/lib/session-snapshots";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { session_review_summary?: unknown };

  const parsed = validateSessionReviewSummaryV0Payload(body.session_review_summary);
  if (parsed === null) {
    return NextResponse.json(
      { error: "session_review_summary must be an object with the v0 shape" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data: sessRow, error: sessErr } = await supabase
    .from("test_sessions")
    .select("session_id")
    .eq("test_session_id", id)
    .maybeSingle();
  if (sessErr || !sessRow) {
    return NextResponse.json({ error: sessErr?.message ?? "Session not found" }, { status: 404 });
  }
  const sessionId = (sessRow as { session_id: string }).session_id;

  const { data: evalRows, error: evalErr } = await supabase
    .from("eval_results")
    .select("eval_result_id, comparison")
    .eq("session_id", sessionId)
    .order("eval_result_id");
  if (evalErr) {
    return NextResponse.json({ error: evalErr.message }, { status: 500 });
  }
  const comparisonBasisFingerprint = fingerprintEvalResultsComparisons(evalRows ?? []);

  const payload: Database["public"]["Tables"]["test_sessions"]["Update"] = {
    session_review_summary: toSessionReviewSummaryJson(parsed),
    manually_edited: true,
    session_review_summary_basis_fingerprint: comparisonBasisFingerprint,
  };

  const { data, error } = await supabase
    .from("test_sessions")
    .update(payload as unknown as never)
    .eq("test_session_id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await refreshLatestSessionResultSnapshot({ supabase, sessionId });

  return NextResponse.json({ session: data });
}

