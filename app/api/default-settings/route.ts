import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/default-settings
 * Returns the first default_settings row (evren_api_url, evaluator_model) for the home form.
 */
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("default_settings")
    .select("evren_api_url, evaluator_model")
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    evren_api_url: data?.evren_api_url ?? null,
    evaluator_model: data?.evaluator_model ?? null,
  });
}
