import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db.types";

/** GET /api/categories — list active categories (deleted_at is null). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const includeDeleted = searchParams.get("deleted") === "true";
  const supabase = await createClient();
  let q = supabase
    .from("categories")
    .select("category_id, name, deleted_at")
    .order("name", { ascending: true });
  if (!includeDeleted) {
    q = q.is("deleted_at", null);
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/** POST /api/categories — create a category. */
export async function POST(request: Request) {
  const supabase = await createClient();
  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const row = { name } as Database["public"]["Tables"]["categories"]["Insert"];
  const { data, error } = await supabase
    .from("categories")
    .insert(row as any)
    .select("category_id, name")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
