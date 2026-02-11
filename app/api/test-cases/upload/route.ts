import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseCsvToRows, sheetRowToTestCase } from "@/lib/sheet";

export async function POST(request: Request) {
  const csv = await request.text();
  const rows = parseCsvToRows(csv);
  const inserts: Array<{
    test_case_id: string;
    title: string | null;
    input_message: string;
    img_url: string | null;
    context: string | null;
    expected_flags: string;
    expected_behavior: string;
    forbidden: string | null;
  }> = [];
  for (const row of rows) {
    const tc = sheetRowToTestCase(row);
    if (!tc.test_case_id?.trim() || !tc.input_message?.trim()) continue;
    inserts.push({
      test_case_id: tc.test_case_id.trim(),
      title: tc.title ?? null,
      input_message: tc.input_message,
      img_url: tc.img_url ?? null,
      context: tc.context ?? null,
      expected_flags: tc.expected_flags ?? "",
      expected_behavior: tc.expected_behavior ?? "",
      forbidden: tc.forbidden ?? null,
    });
  }
  if (inserts.length === 0) {
    return NextResponse.json({ error: "No valid rows (need test_case_id and input_message)" }, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("test_cases")
    .insert(inserts)
    .select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ inserted: data?.length ?? 0, rows: data });
}
