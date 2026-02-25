import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const body = await _request.json() as Record<string, unknown>;
  const allowed = [
    "test_case_id", "title", "category_id", "type", "input_message", "turns", "img_url", "context",
    "expected_state", "expected_behavior", "forbidden", "notes", "is_enabled",
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }
  if ("test_case_id" in updates) {
    const newId = typeof updates.test_case_id === "string" ? updates.test_case_id.trim() : "";
    if (!newId) {
      return NextResponse.json({ error: "Test case ID cannot be empty" }, { status: 400 });
    }
    if (newId !== id) {
      const { data: existing } = await supabase
        .from("test_cases")
        .select("test_case_id")
        .eq("test_case_id", newId)
        .maybeSingle();
      if (existing) {
        return NextResponse.json(
          { error: "A test case with this ID already exists." },
          { status: 409 }
        );
      }
    }
    updates.test_case_id = newId;
  }
  if ("type" in updates && updates.type !== "multi_turn") {
    updates.type = "single_turn";
    updates.turns = null;
  }
  if ("turns" in updates && updates.turns != null) {
    if (!Array.isArray(updates.turns) || updates.turns.length === 0) {
      updates.turns = null;
    } else {
      const normalized: string[] = [];
      for (const item of updates.turns as unknown[]) {
        const s = item != null ? String(item).trim() : "";
        if (s) normalized.push(s);
      }
      updates.turns = normalized.length > 0 ? normalized : null;
      if (updates.type === "multi_turn" && normalized.length > 0) {
        updates.input_message = normalized[0];
      }
    }
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("test_cases")
    .update(updates as unknown as never)
    .eq("test_case_id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from("test_cases")
    .delete()
    .eq("test_case_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
