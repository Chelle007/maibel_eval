import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: sessions, error } = await supabase
    .from("test_sessions")
    .select("test_session_id, user_id, title, total_cost_usd, summary, manually_edited, created_at, users(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const list = sessions ?? [];

  const ids = list.map((s: { test_session_id: string }) => s.test_session_id);
  if (ids.length === 0) return NextResponse.json(list);

  const { data: results } = await supabase
    .from("eval_results")
    .select("test_session_id, success")
    .in("test_session_id", ids);

  const counts: Record<string, { passed: number; total: number }> = {};
  for (const r of results ?? []) {
    const id = r.test_session_id;
    if (!counts[id]) counts[id] = { passed: 0, total: 0 };
    counts[id].total += 1;
    if (r.success) counts[id].passed += 1;
  }

  const withCounts = list.map((s: { test_session_id: string }) => ({
    ...s,
    passed_count: counts[s.test_session_id]?.passed ?? 0,
    total_count: counts[s.test_session_id]?.total ?? 0,
  }));

  return NextResponse.json(withCounts);
}
