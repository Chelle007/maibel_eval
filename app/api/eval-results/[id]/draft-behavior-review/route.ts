import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { draftBehaviorReviewForVersionEntries } from "@/lib/behavior-review-drafter";
import { mergeBehaviorReviewMap, type BehaviorReviewByVersion } from "@/lib/behavior-review";
import { normalizeVersionEntry } from "@/lib/db.types";
import type { AnyVersionEntry, DefaultSettingsRow, EvalResultsRow, VersionEntry } from "@/lib/db.types";
import { getAnthropicEvalApiKey } from "@/lib/eval-llm-env";
import { DEFAULT_EVAL_LLM_MODEL } from "@/lib/eval-llm-defaults";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const apiKey = getAnthropicEvalApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ANTHROPIC_API_KEY or CLAUDE_API_KEY" },
      { status: 500 }
    );
  }

  const supabase = await createClient();

  const { data: row, error: fetchError } = await supabase
    .from("eval_results")
    .select("eval_result_id, session_id, evren_responses, reason, behavior_review")
    .eq("eval_result_id", id)
    .single();
  if (fetchError || !row) {
    return NextResponse.json(
      { error: fetchError?.message ?? "Not found" },
      { status: fetchError?.code === "PGRST116" ? 404 : 500 }
    );
  }

  const evalRow = row as Pick<
    EvalResultsRow,
    "eval_result_id" | "session_id" | "evren_responses" | "reason" | "behavior_review"
  >;

  const { data: testCaseJoin } = await supabase
    .from("eval_results")
    .select("test_case_uuid, test_cases!inner(test_case_id, type, input_message, img_url, turns, expected_state, expected_behavior, forbidden, notes)")
    .eq("eval_result_id", id)
    .single();

  const tcRaw = (testCaseJoin as any)?.test_cases;
  const testCase = tcRaw
    ? {
        test_case_id: tcRaw.test_case_id ?? "",
        type: tcRaw.type ?? "single_turn",
        input_message: tcRaw.input_message ?? "",
        img_url: tcRaw.img_url ?? undefined,
        turns: tcRaw.turns ?? undefined,
        expected_state: tcRaw.expected_state ?? "",
        expected_behavior: tcRaw.expected_behavior ?? "",
        forbidden: tcRaw.forbidden ?? undefined,
        notes: tcRaw.notes ?? undefined,
      }
    : null;

  if (!testCase) {
    return NextResponse.json({ error: "Could not resolve test case for this eval result" }, { status: 400 });
  }

  const versions = Array.isArray(evalRow.evren_responses)
    ? (evalRow.evren_responses as AnyVersionEntry[]).map(normalizeVersionEntry)
    : [];
  if (versions.length === 0) {
    return NextResponse.json({ error: "No versions in eval result" }, { status: 400 });
  }

  const { data: settingsRow } = await supabase
    .from("default_settings")
    .select("evaluator_model")
    .limit(1)
    .maybeSingle();
  const modelName =
    (settingsRow as Pick<DefaultSettingsRow, "evaluator_model"> | null)?.evaluator_model?.trim() ||
    DEFAULT_EVAL_LLM_MODEL;

  try {
    const { reviews, token_usage } = await draftBehaviorReviewForVersionEntries({
      testCase,
      versions,
      evaluatorReason: evalRow.reason as string | null,
      apiKey,
      modelName,
    });

    if (Object.keys(reviews).length === 0) {
      return NextResponse.json({ error: "AI returned empty or unparseable review" }, { status: 502 });
    }

    const allowedVersionIds = new Set(versions.map((v: VersionEntry) => v.version_id));
    const merged = mergeBehaviorReviewMap(evalRow.behavior_review, reviews, allowedVersionIds);
    if (!merged) {
      return NextResponse.json({ error: "Failed to merge AI review" }, { status: 500 });
    }

    const { error: updateError } = await supabase
      .from("eval_results")
      .update({ behavior_review: merged } as never)
      .eq("eval_result_id", id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ behavior_review: merged, token_usage });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI draft failed";
    console.error("[draft-behavior-review]", msg, err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
