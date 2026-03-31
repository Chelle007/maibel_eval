import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db.types";
import {
  toSessionReviewSummaryJson,
  validateSessionReviewSummaryV0Payload,
} from "@/lib/session-review-summary";

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
  const payload: Database["public"]["Tables"]["test_sessions"]["Update"] = {
    session_review_summary: toSessionReviewSummaryJson(parsed),
    manually_edited: true,
  };

  const { data, error } = await supabase
    .from("test_sessions")
    .update(payload as unknown as never)
    .eq("test_session_id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}

