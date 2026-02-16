import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db.types";

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("test_cases")
    .select("*")
    .order("test_case_id", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json();
  const {
    test_case_id,
    title,
    category_id,
    input_message,
    img_url,
    context,
    expected_state,
    expected_behavior,
    forbidden,
    notes,
    is_enabled,
  } = body as Record<string, unknown>;
  if (!test_case_id || typeof test_case_id !== "string" || !test_case_id.trim()) {
    return NextResponse.json({ error: "test_case_id required" }, { status: 400 });
  }
  if (!input_message || typeof input_message !== "string") {
    return NextResponse.json({ error: "input_message required" }, { status: 400 });
  }
  const row = {
    test_case_id: (test_case_id as string).trim(),
    title: title ?? null,
    category_id: category_id && typeof category_id === "string" ? category_id : null,
    input_message,
    img_url: img_url ?? null,
    context: context ?? null,
    expected_state: expected_state ?? "",
    expected_behavior: expected_behavior ?? "",
    forbidden: forbidden ?? null,
    notes: notes ?? null,
    is_enabled: typeof is_enabled === "boolean" ? is_enabled : true,
  } as Database["public"]["Tables"]["test_cases"]["Insert"];
  const { data, error } = await supabase
    .from("test_cases")
    .insert(row as any)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
