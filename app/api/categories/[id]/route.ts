import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db.types";

/** PATCH /api/categories/[id] — rename category. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const payload = { name } as Database["public"]["Tables"]["categories"]["Update"];
  const { data, error } = await supabase
    .from("categories")
    .update(payload as unknown as never)
    .eq("category_id", id)
    .is("deleted_at", null)
    .select("category_id, name")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** DELETE /api/categories/[id] — soft delete (set deleted_at). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const payload = { deleted_at: new Date().toISOString() } as Database["public"]["Tables"]["categories"]["Update"];
  const { error } = await supabase
    .from("categories")
    .update(payload as unknown as never)
    .eq("category_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
