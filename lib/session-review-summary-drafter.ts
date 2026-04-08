import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  loadSessionReviewSummaryDrafterSystemPrompt,
  buildSessionReviewSummaryDrafterUserMessage,
} from "./prompts";
import { normalizeVersionEntry, type AnyVersionEntry } from "./db.types";
import { computeTokenCost } from "./token-cost";
import {
  fillMissingSessionReviewEnumsFromEvalRows,
  parseSessionReviewSummaryV0,
  type SessionReviewSummaryV0,
} from "./session-review-summary";
import type { TokenUsage } from "./types";

/** Ordered list from eval_results.evren_responses (first = baseline / old, rest = newer builds). */
export type SessionCompareVersionRef = { version_id: string; version_name: string };

/**
 * Read version order from the first eval row that has evren_responses (same order across cases in a session).
 */
export function extractSessionVersionEntriesFromEvalRows(
  rows: Array<{ evren_responses?: unknown }>
): SessionCompareVersionRef[] | undefined {
  for (const row of rows) {
    const raw = row.evren_responses;
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const out: SessionCompareVersionRef[] = [];
    for (const entry of raw) {
      try {
        const v = normalizeVersionEntry(entry as AnyVersionEntry);
        const id = String(v.version_id ?? "").trim();
        const name = String(v.version_name ?? "").trim() || id;
        if (id) out.push({ version_id: id, version_name: name });
      } catch {
        /* skip malformed */
      }
    }
    if (out.length) return out;
  }
  return undefined;
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  return trimmed;
}

const DEFAULT_MODEL = "gemini-3-flash-preview";

export interface DraftSessionReviewSummaryArgs {
  sessionMode: "single" | "comparison";
  sessionTitle: string | null;
  sessionSummary: string | null;
  evalRows: Array<{
    test_case_id: string;
    title: string | null;
    success: boolean;
    score: number;
    reason: string | null;
    comparison: unknown;
    behavior_review: unknown;
  }>;
  /** Comparison sessions: baseline = first entry, rest = challengers (e.g. v1 vs v2/v3). */
  versionEntries?: SessionCompareVersionRef[];
  apiKey: string;
  modelName?: string;
  contextPack?: { text: string; bundleId: string };
}

/**
 * Draft session_review_summary from aggregate eval data (used after a full evaluate run).
 */
export async function draftSessionReviewSummary(
  args: DraftSessionReviewSummaryArgs
): Promise<{ summary: SessionReviewSummaryV0; token_usage?: TokenUsage } | null> {
  const { apiKey, modelName = DEFAULT_MODEL, contextPack } = args;
  if (!args.evalRows.length) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const systemInstruction = loadSessionReviewSummaryDrafterSystemPrompt();
  const model = genAI.getGenerativeModel({ model: modelName, systemInstruction });

  let userMessage = buildSessionReviewSummaryDrafterUserMessage({
    sessionMode: args.sessionMode,
    sessionTitle: args.sessionTitle,
    sessionSummary: args.sessionSummary,
    evalRows: args.evalRows,
    versionEntries: args.versionEntries,
  });
  if (contextPack?.text?.trim()) {
    userMessage += `\n\n=== ORGANIZATION CONTEXT (bundle: ${contextPack.bundleId}) ===\n${contextPack.text.trim()}\n`;
  }

  const result = await model.generateContent(userMessage);
  const response = result.response;
  const text = response.text();

  const usage = response.usageMetadata;
  const token_usage = usage
    ? computeTokenCost(usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0, modelName)
    : undefined;

  const jsonStr = extractJson(text);
  let parsedRoot: unknown;
  try {
    parsedRoot = JSON.parse(jsonStr) as unknown;
  } catch {
    console.error(
      "[session-review-summary-drafter] JSON parse failed, raw:",
      jsonStr.slice(0, 500)
    );
    return null;
  }

  let summary = parseSessionReviewSummaryV0(parsedRoot);
  summary = fillMissingSessionReviewEnumsFromEvalRows(summary, args.evalRows, args.sessionMode);
  return { summary, token_usage };
}
