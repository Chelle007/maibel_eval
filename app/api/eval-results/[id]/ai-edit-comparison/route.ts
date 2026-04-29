import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { compareOverall } from "@/lib/comparator";
import { loadComparatorOverallSystemPrompt } from "@/lib/prompts";
import { loadContextPack } from "@/lib/context-pack";
import type { ComparisonData, TestCase } from "@/lib/types";
import type { AnyVersionEntry, DefaultSettingsRow, VersionEntry } from "@/lib/db.types";
import { normalizeVersionEntry } from "@/lib/db.types";
import { refreshLatestSessionResultSnapshot } from "@/lib/session-snapshots";

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

function testCaseFromJoin(row: Record<string, unknown> | null | undefined): TestCase | null {
  if (!row || typeof row !== "object") return null;
  const test_case_id = String(row.test_case_id ?? "").trim();
  if (!test_case_id) return null;
  return {
    test_case_id,
    type: row.type === "multi_turn" ? "multi_turn" : "single_turn",
    input_message: String(row.input_message ?? ""),
    turns: Array.isArray(row.turns) ? row.turns.map((x) => String(x)) : undefined,
    expected_state: String(row.expected_state ?? ""),
    expected_behavior: String(row.expected_behavior ?? ""),
    forbidden: row.forbidden != null && String(row.forbidden).trim() ? String(row.forbidden) : undefined,
    notes: row.notes != null && String(row.notes).trim() ? String(row.notes) : undefined,
    img_url: row.img_url != null && String(row.img_url).trim() ? String(row.img_url) : undefined,
  };
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

  const { data: evalRowRaw, error: evalRowError } = await supabase
    .from("eval_results")
    .select(
      "session_id, evren_responses, comparison, test_cases(test_case_id, input_message, expected_state, expected_behavior, title, type, turns, forbidden, notes, img_url)"
    )
    .eq("eval_result_id", id)
    .maybeSingle();
  if (evalRowError) {
    return NextResponse.json({ error: evalRowError.message }, { status: 500 });
  }
  if (!evalRowRaw) {
    return NextResponse.json({ error: "eval_result not found" }, { status: 404 });
  }

  const evalRow = evalRowRaw as {
    session_id?: string;
    evren_responses: unknown;
    comparison: unknown;
    test_cases: Record<string, unknown> | Record<string, unknown>[] | null;
  };
  const sessionId = typeof evalRow.session_id === "string" ? evalRow.session_id : null;

  const tcJoined = evalRow.test_cases;
  const tcRow = Array.isArray(tcJoined) ? tcJoined[0] : tcJoined;
  const testCaseFromDb = testCaseFromJoin(tcRow as Record<string, unknown> | null | undefined);
  const evrenVersions = (Array.isArray(evalRow.evren_responses) ? evalRow.evren_responses : []) as AnyVersionEntry[];
  const versionsNorm: VersionEntry[] = evrenVersions.map((v) => normalizeVersionEntry(v));
  const previousFromDb = evalRow.comparison as ComparisonData | null | undefined;
  const previousComparison: ComparisonData | null =
    previousFromDb && typeof previousFromDb === "object" && Array.isArray(previousFromDb.tiers)
      ? previousFromDb
      : ((body.current_comparison ?? null) as ComparisonData | null);

  if (!testCaseFromDb) {
    return NextResponse.json({ error: "Missing test case data for this eval result." }, { status: 400 });
  }
  const idSet = new Set(versionsNorm.map((v) => v.version_id));
  for (const vid of allowedIds) {
    if (!idSet.has(vid)) {
      return NextResponse.json(
        { error: "Stored evren_responses are missing a version referenced in version_entries." },
        { status: 400 }
      );
    }
  }

  const { data: settingsRow } = await supabase
    .from("default_settings")
    .select("evaluator_model")
    .limit(1)
    .maybeSingle();
  const comparatorModel =
    (settingsRow as Pick<DefaultSettingsRow, "evaluator_model"> | null)?.evaluator_model?.trim() ||
    "gemini-3-flash-preview";

  const versionIds =
    allowedIds.length === 2
      ? ([allowedIds[0], allowedIds[1]] as [string, string])
      : ([allowedIds[0], allowedIds[1], allowedIds[2]] as [string, string, string]);

  const comparatorPrompt = loadComparatorOverallSystemPrompt();
  let contextPack: { text: string; bundleId: string };
  try {
    const pack = loadContextPack({
      purpose: "comparator",
      query: `${testCaseFromDb.test_case_id}\n${testCaseFromDb.expected_state}\n${testCaseFromDb.expected_behavior}\n${testCaseFromDb.forbidden ?? ""}\n${testCaseFromDb.notes ?? ""}`,
    });
    contextPack = { text: pack.text, bundleId: pack.bundleId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ai-edit-comparison] context pack load failed:", msg);
    return NextResponse.json({ error: `Context pack load failed: ${msg}` }, { status: 500 });
  }

  let edited: ComparisonData;
  try {
    edited = await compareOverall(
      testCaseFromDb,
      versionsNorm,
      versionIds,
      apiKey,
      comparatorModel,
      comparatorPrompt,
      contextPack,
      {
        previous_comparison: previousComparison,
        user_guidance: body.feedback.trim(),
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Comparison rerun failed";
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

  if (sessionId) {
    await refreshLatestSessionResultSnapshot({ supabase, sessionId });
  }

  return NextResponse.json({ comparison: validated.value });
}

