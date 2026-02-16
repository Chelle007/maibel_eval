import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type SessionListItem = { test_session_id: string; [key: string]: unknown };
type EvalResultRow = { test_session_id: string; success: boolean; score: number };

export async function GET() {
  const supabase = await createClient();
  const { data: sessions, error } = await supabase
    .from("test_sessions")
    .select("test_session_id, user_id, title, total_cost_usd, summary, manually_edited, created_at, users(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const list = (sessions ?? []) as SessionListItem[];

  const ids = list.map((s) => s.test_session_id);
  if (ids.length === 0) return NextResponse.json(list);

  const { data: results } = await supabase
    .from("eval_results")
    .select("test_session_id, success, score")
    .in("test_session_id", ids);

  const resultRows = (results ?? []) as EvalResultRow[];
  const counts: Record<string, { passed: number; total: number; scoreSum: number }> = {};
  for (const r of resultRows) {
    const id = r.test_session_id;
    if (!counts[id]) counts[id] = { passed: 0, total: 0, scoreSum: 0 };
    counts[id].total += 1;
    if (r.success) counts[id].passed += 1;
    counts[id].scoreSum += typeof r.score === "number" ? r.score : 0;
  }

  const withCounts = list.map((s) => {
    const c = counts[s.test_session_id];
    const total = c?.total ?? 0;
    const avgScore = total > 0 && c ? c.scoreSum / total : null;
    return {
      ...s,
      passed_count: c?.passed ?? 0,
      total_count: total,
      avg_score: avgScore,
    };
  });

  return NextResponse.json(withCounts);
}
