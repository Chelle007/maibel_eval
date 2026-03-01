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

/** Normalize turns to array of user input strings only. */
function normalizeTurns(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: string[] = [];
  for (const item of raw) {
    const s = item != null ? String(item).trim() : "";
    if (s) out.push(s);
  }
  return out.length > 0 ? out : null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json();
  const {
    test_case_id,
    title,
    category_id,
    type: typeRaw,
    input_message,
    turns: turnsRaw,
    img_url,
    expected_state,
    expected_behavior,
    forbidden,
    notes,
    is_enabled,
  } = body as Record<string, unknown>;
  if (!test_case_id || typeof test_case_id !== "string" || !test_case_id.trim()) {
    return NextResponse.json({ error: "test_case_id required" }, { status: 400 });
  }
  const type = typeRaw === "multi_turn" ? "multi_turn" : "single_turn";
  const turns = normalizeTurns(turnsRaw);

  if (type === "multi_turn") {
    if (!turns || turns.length === 0) {
      return NextResponse.json({ error: "multi_turn requires at least one input" }, { status: 400 });
    }
  } else {
    if (!input_message || typeof input_message !== "string") {
      return NextResponse.json({ error: "input_message required for single_turn" }, { status: 400 });
    }
  }

  const inputMessage = type === "multi_turn" ? turns![0]! : (input_message as string);

  const row = {
    test_case_id: (test_case_id as string).trim(),
    title: title ?? null,
    category_id: category_id && typeof category_id === "string" ? category_id : null,
    type,
    input_message: inputMessage,
    img_url: img_url ?? null,
    turns: type === "multi_turn" ? turns : null,
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
