import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db.types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json() as { summary?: string };
  if (typeof body.summary !== "string") {
    return NextResponse.json({ error: "summary string required" }, { status: 400 });
  }
  const supabase = await createClient();
  const payload = { summary: body.summary, manually_edited: true } as Database["public"]["Tables"]["test_sessions"]["Update"];
  const { data, error } = await supabase
    .from("test_sessions")
    .update(payload as any)
    .eq("test_session_id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
