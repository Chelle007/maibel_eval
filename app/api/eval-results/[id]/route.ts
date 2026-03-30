import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mergeBehaviorReviewMap } from "@/lib/behavior-review";
import type { VersionEntry } from "@/lib/db.types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (typeof body.reason === "string") updates.reason = body.reason;
  if (typeof body.success === "boolean") updates.success = body.success;
  if (typeof body.score === "number") updates.score = body.score;

  const supabase = await createClient();

  if (body.behavior_review !== undefined) {
    const { data: row, error: fetchError } = await supabase
      .from("eval_results")
      .select("evren_responses, behavior_review")
      .eq("eval_result_id", id)
      .single();
    if (fetchError || !row) {
      return NextResponse.json(
        { error: fetchError?.message ?? "Not found" },
        { status: fetchError?.code === "PGRST116" ? 404 : 500 }
      );
    }
    const versions = Array.isArray((row as { evren_responses: unknown }).evren_responses)
      ? ((row as { evren_responses: VersionEntry[] }).evren_responses as VersionEntry[])
      : [];
    const allowedVersionIds = new Set(versions.map((v) => v.version_id));
    const merged = mergeBehaviorReviewMap(
      (row as { behavior_review: unknown }).behavior_review,
      body.behavior_review,
      allowedVersionIds
    );
    if (merged === null) {
      return NextResponse.json({ error: "Invalid behavior_review payload" }, { status: 400 });
    }
    updates.behavior_review = merged;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "Provide reason, success, score, and/or behavior_review to update" },
      { status: 400 }
    );
  }
  updates.manually_edited = true;
  const { data, error } = await supabase
    .from("eval_results")
    .update(updates as unknown as never)
    .eq("eval_result_id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
