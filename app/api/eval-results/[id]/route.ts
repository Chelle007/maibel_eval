import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Provide reason, success, or score to update" }, { status: 400 });
  }
  updates.manually_edited = true;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("eval_results")
    .update(updates)
    .eq("eval_result_id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
