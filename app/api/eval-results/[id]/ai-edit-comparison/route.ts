import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { editOverallComparison } from "@/lib/comparator";
import type { ComparisonData } from "@/lib/types";
import type { DefaultSettingsRow } from "@/lib/db.types";

type Body = {
  feedback?: string;
  current_comparison?: ComparisonData | null;
  version_entries?: { version_id: string; version_name: string }[];
  test_case_id?: string | null;
  expected_state?: string | null;
  expected_behavior?: string | null;
};

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function validateComparisonStrict(
  comparison: ComparisonData,
  allowedIds: string[]
): { ok: true; value: ComparisonData } | { ok: false; error: string } {
  const ids = allowedIds.map(String).filter(Boolean);
  if (ids.length < 2) return { ok: false, error: "Need at least 2 versions to compare." };
  const allowed = new Set(ids);

  const tiers = Array.isArray(comparison?.tiers) ? comparison.tiers : null;
  if (!tiers || tiers.length === 0) return { ok: false, error: "Missing tiers." };

  const normalizedTiers = tiers
    .map((t) => (Array.isArray(t) ? t.map((x) => String(x)).map((s) => s.trim()).filter(Boolean) : []))
    .filter((t) => t.length > 0);
  if (normalizedTiers.length === 0) return { ok: false, error: "Empty tiers." };

  const flat = normalizedTiers.flat();
  for (const id of flat) {
    if (!allowed.has(id)) return { ok: false, error: `tiers contains unknown version_id: ${id}` };
  }
  const seen = new Set<string>();
  for (const id of flat) {
    if (seen.has(id)) return { ok: false, error: `tiers contains duplicate version_id: ${id}` };
    seen.add(id);
  }
  if (seen.size !== ids.length) {
    return { ok: false, error: `tiers must include every version exactly once (expected ${ids.length}, got ${seen.size}).` };
  }

  const overall_reason = String(comparison?.overall_reason ?? "").trim();
  if (!overall_reason) return { ok: false, error: "Missing overall_reason." };

  const hf = comparison?.overall_hard_failures ?? {};
  const outHf: Record<string, string[]> = {};
  for (const id of ids) {
    const list = (hf as Record<string, unknown>)[id];
    outHf[id] = Array.isArray(list) ? list.map(String) : [];
  }

  return {
    ok: true,
    value: {
      tiers: normalizedTiers,
      overall_reason,
      overall_hard_failures: outHf,
    },
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Body;

  if (!isNonEmptyString(body.feedback)) {
    return NextResponse.json({ error: "feedback must be a non-empty string" }, { status: 400 });
  }

  const versionEntries = Array.isArray(body.version_entries) ? body.version_entries : [];
  const allowedIds = versionEntries.map((v) => v.version_id).filter(Boolean).slice(0, 3);
  if (allowedIds.length < 2) {
    return NextResponse.json({ error: "At least 2 versions are required." }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing GEMINI_API_KEY (required for AI edit)" }, { status: 500 });
  }

  const supabase = await createClient();
  const { data: settingsRow } = await supabase
    .from("default_settings")
    .select("evaluator_model")
    .limit(1)
    .maybeSingle();
  const comparatorModel =
    (settingsRow as Pick<DefaultSettingsRow, "evaluator_model"> | null)?.evaluator_model?.trim() ||
    "gemini-3-flash-preview";

  let edited: ComparisonData;
  try {
    const result = await editOverallComparison({
      feedback: body.feedback,
      version_entries: versionEntries.slice(0, 3),
      current_comparison: (body.current_comparison ?? null) as ComparisonData | null,
      apiKey,
      modelName: comparatorModel,
      test_case_id: body.test_case_id ?? null,
      expected_state: body.expected_state ?? null,
      expected_behavior: body.expected_behavior ?? null,
    });
    edited = {
      tiers: result.tiers,
      overall_reason: result.overall_reason,
      overall_hard_failures: result.overall_hard_failures,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI edit failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const validated = validateComparisonStrict(edited, allowedIds);
  if (!validated.ok) {
    return NextResponse.json({ error: `AI output invalid: ${validated.error}` }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("eval_results")
    .update({ comparison: validated.value, manually_edited: true } as never)
    .eq("eval_result_id", id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ comparison: validated.value });
}

