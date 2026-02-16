import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database, DefaultSettingsRow } from "@/lib/db.types";

const FIELDS = "evren_api_url, evaluator_model, evaluator_prompt, summarizer_model, summarizer_prompt";

/**
 * GET /api/default-settings
 * Returns the first default_settings row for the home form and settings page.
 */
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("default_settings")
    .select(FIELDS)
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = data as Pick<DefaultSettingsRow, "evren_api_url" | "evaluator_model" | "evaluator_prompt" | "summarizer_model" | "summarizer_prompt"> | null;
  return NextResponse.json({
    evren_api_url: row?.evren_api_url ?? null,
    evaluator_model: row?.evaluator_model ?? null,
    evaluator_prompt: row?.evaluator_prompt ?? null,
    summarizer_model: row?.summarizer_model ?? null,
    summarizer_prompt: row?.summarizer_prompt ?? null,
  });
}

/**
 * PATCH /api/default-settings
 * Upserts the single default_settings row (update if exists, else insert).
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  let body: {
    evren_api_url?: string | null;
    evaluator_model?: string | null;
    evaluator_prompt?: string | null;
    summarizer_model?: string | null;
    summarizer_prompt?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("default_settings")
    .select("default_setting_id")
    .limit(1)
    .maybeSingle();

  const existingRow = existing as Pick<DefaultSettingsRow, "default_setting_id"> | null;
  const payload = {
    ...(body.evren_api_url !== undefined && { evren_api_url: body.evren_api_url || null }),
    ...(body.evaluator_model !== undefined && { evaluator_model: body.evaluator_model || null }),
    ...(body.evaluator_prompt !== undefined && { evaluator_prompt: body.evaluator_prompt || null }),
    ...(body.summarizer_model !== undefined && { summarizer_model: body.summarizer_model || null }),
    ...(body.summarizer_prompt !== undefined && { summarizer_prompt: body.summarizer_prompt || null }),
  } as Database["public"]["Tables"]["default_settings"]["Update"];

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  if (existingRow?.default_setting_id) {
    const { data, error } = await supabase
      .from("default_settings")
      .update(payload as any)
      .eq("default_setting_id", existingRow.default_setting_id)
      .select(FIELDS)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  const insertRow = {
    evren_api_url: payload.evren_api_url ?? null,
    evaluator_model: payload.evaluator_model ?? null,
    evaluator_prompt: payload.evaluator_prompt ?? null,
    summarizer_model: payload.summarizer_model ?? null,
    summarizer_prompt: payload.summarizer_prompt ?? null,
  } as Database["public"]["Tables"]["default_settings"]["Insert"];
  const { data, error } = await supabase
    .from("default_settings")
    .insert(insertRow as any)
    .select(FIELDS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
