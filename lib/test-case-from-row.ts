import type { TestCasesRow } from "@/lib/db.types";
import type { TestCase } from "@/lib/types";

/** Map a Supabase `test_cases` row to the `TestCase` shape used by Evren eval + comparator. */
export function testCaseFromRow(row: TestCasesRow): TestCase {
  const rawTurns = row.turns;
  const turnsArray = Array.isArray(rawTurns)
    ? rawTurns.map((t) => String(t ?? "").trim()).filter(Boolean)
    : [];

  const type = row.type ?? "single_turn";
  const turns =
    type === "multi_turn" && turnsArray.length > 0 ? turnsArray : undefined;

  let eval_context: Record<string, unknown> | undefined;
  if (row.eval_context != null && typeof row.eval_context === "object" && !Array.isArray(row.eval_context)) {
    eval_context = row.eval_context as Record<string, unknown>;
  }

  return {
    test_case_id: row.test_case_id,
    title: row.title ?? undefined,
    type,
    input_message: row.input_message ?? "",
    img_url: row.img_url ?? undefined,
    turns,
    expected_state: row.expected_state ?? "",
    expected_behavior: row.expected_behavior ?? "",
    forbidden: row.forbidden ?? undefined,
    notes: row.notes ?? undefined,
    is_enabled: row.is_enabled,
    eval_context,
  };
}
