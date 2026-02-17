import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

const REFINE_SYSTEM = `You are a light-touch editor. The user will provide the current session summary text.

Your task: Make only minimal changes. Only fix:
- Sentences that look newly added, rough, or out of place
- Obvious grammar or wording that sounds odd in context
- Inconsistent terms or formatting in small spots
- Styling consistency: In each part of the document (each list, each section, each block of similar content), infer the dominant formatting pattern (e.g. how list items are phrased, use of bold for labels, heading style, punctuation). Rewrite any item that uses a different style so it matches that dominant pattern. Apply this to bullets, headings, bold vs plain text, colons and parentheses, and any other recurring formatting—not just one type. Keep content and meaning; only unify the format.

Preserve the original structure. Output only the refined text.`;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { summary?: string };
    const summary = body.summary ?? "";

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY environment variable" },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: REFINE_SYSTEM,
    });

    const userMessage = summary || "(empty)";
    const result = await model.generateContent(userMessage);
    const response = result.response;
    const refined = response.text().trim();

    return NextResponse.json({ refined });
  } catch (err) {
    console.error("Refine wording API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Refine request failed" },
      { status: 500 }
    );
  }
}
