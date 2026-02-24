import { createClient } from "@/lib/supabase/server";
import type { TestCase } from "@/lib/types";
import type { TestCasesRow } from "@/lib/db.types";

/**
 * GET enabled test cases for a run.
 * Used when Evren is called from the client (e.g. local Evren + hosted app).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  const userId = authUser?.id ?? process.env.DEFAULT_USER_ID;
  if (!userId)
    return new Response(
      JSON.stringify({ error: "Not logged in and no DEFAULT_USER_ID" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );

  const { data: rows, error } = await supabase
    .from("test_cases")
    .select("*")
    .eq("is_enabled", true)
    .order("test_case_id", { ascending: true });
  if (error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });

  const testCases: TestCase[] = (rows ?? []).map((row: TestCasesRow) => ({
    test_case_id: row.test_case_id,
    type: row.type ?? "single_turn",
    input_message: row.input_message,
    img_url: row.img_url ?? undefined,
    context: row.context ?? undefined,
    turns: row.turns ?? undefined,
    expected_state: row.expected_state ?? "",
    expected_behavior: row.expected_behavior ?? "",
    forbidden: row.forbidden ?? undefined,
  }));
  return new Response(JSON.stringify({ test_cases: testCases }), {
    headers: { "Content-Type": "application/json" },
  });
}
