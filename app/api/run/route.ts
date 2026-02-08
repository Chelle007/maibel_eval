import { NextResponse } from "next/server";
import { startEvaluate } from "@/lib/start_evaluate";

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY environment variable" },
        { status: 500 }
      );
    }

    const body = (await request.json()) as {
      system_prompt?: string;
      evren_model_api_url?: string;
      google_sheet_link?: string;
      model_name?: string;
    };

    const evrenModelApiUrl = body.evren_model_api_url;
    const googleSheetLink = body.google_sheet_link;

    if (!evrenModelApiUrl || !googleSheetLink) {
      return NextResponse.json(
        {
          error:
            "Request body must include 'evren_model_api_url' and 'google_sheet_link'.",
        },
        { status: 400 }
      );
    }

    const results = await startEvaluate({
      systemPrompt: body.system_prompt,
      evrenModelApiUrl,
      googleSheetLink,
      apiKey,
      modelName: body.model_name,
    });

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Run evaluate error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Run failed",
      },
      { status: 500 }
    );
  }
}
