import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  loadComparatorOverallSystemPrompt,
  buildComparatorOverallUserMessage,
  resolveComparatorVersionToken,
} from "./prompts";
import { computeTokenCost } from "./token-cost";
import type { TestCase, ComparisonData } from "./types";
import type { VersionEntry } from "./db.types";

function extractJson(text: string): string {
  const trimmed = text.trim();
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  return trimmed;
}

const DEFAULT_MODEL = "gemini-3-flash-preview";

type OverallComparatorJsonV2 = {
  tiers?: unknown;
  reason?: string;
  hard_failures?: Record<string, unknown>;
};

function uniq<T>(xs: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const x of xs) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

/** When re-ranking with extra reviewer text, strip meta phrases the model often echoes. */
function scrubGuidanceEchoesFromReason(reason: string): string {
  let s = reason;
  s = s.replace(/\bfollowing\s+user\s+guidance\b[,;:]?\s*/gi, "");
  s = s.replace(/\bper\s+user\s+guidance\b[,;:]?\s*/gi, "");
  s = s.replace(/\bas\s+per\s+user\s+guidance\b[,;:]?\s*/gi, "");
  s = s.replace(/\buser\s+guidance\b/gi, "");
  s = s.replace(/\s*,\s*,/g, ",").replace(/\s{2,}/g, " ").replace(/^\s*,\s*|\s*,\s*$/g, "").trim();
  return s;
}

/**
 * Run one unified overall comparison across 2 or 3 versions by ID.
 * Stores tiers (by version_id) + overall_reason + overall_hard_failures (by version_id).
 *
 * Optional `guidedReplay`: after org context, appends previous comparison JSON + user guidance
 * (same model path as add-version, for session “AI edit comparison”).
 */
export type CompareOverallGuidedReplay = {
  previous_comparison: ComparisonData | null;
  user_guidance: string;
};

export async function compareOverall(
  testCase: TestCase,
  versions: VersionEntry[],
  versionIds: [string, string] | [string, string, string],
  apiKey: string,
  modelName: string = DEFAULT_MODEL,
  systemPrompt?: string,
  contextPack?: { text: string; bundleId: string },
  guidedReplay?: CompareOverallGuidedReplay | null
): Promise<ComparisonData> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const systemInstruction = systemPrompt ?? loadComparatorOverallSystemPrompt();
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
  });

  const { message } = buildComparatorOverallUserMessage(testCase, versions, versionIds);
  let finalMessage =
    contextPack?.text?.trim()
      ? `${message}\n\n=== ORGANIZATION CONTEXT (bundle: ${contextPack.bundleId}) ===\n${contextPack.text.trim()}\n`
      : message;

  const guidance = String(guidedReplay?.user_guidance ?? "").trim();
  if (guidance) {
    const prev = guidedReplay?.previous_comparison ?? null;
    const prevBlock =
      prev != null
        ? `\n\n=== PREVIOUS COMPARISON (context — user requested a fresh ranking after this stored result; tiers use version_id) ===\n${JSON.stringify(prev, null, 2)}\n`
        : "";
    finalMessage += `${prevBlock}\n\n=== ADDITIONAL RANKING INPUT (use for close calls only; still ground tiers in VERSION transcript blocks + test case + organization context; do not ignore hard-failure criteria. Do not name this section or call out "guidance" in the reason field — write as a normal evaluation.) ===\n${guidance}\n`;
  }

  const result = await model.generateContent(finalMessage);
  const response = result.response;
  const text = response.text();

  const usage = response.usageMetadata;
  const token_usage = usage
    ? computeTokenCost(
        usage.promptTokenCount ?? 0,
        usage.candidatesTokenCount ?? 0,
        modelName
      )
    : undefined;

  const allowedList = [...versionIds] as string[];

  const jsonStr = extractJson(text);
  let parsed: OverallComparatorJsonV2 | null = null;
  try {
    parsed = JSON.parse(jsonStr) as OverallComparatorJsonV2;
  } catch {
    const ids = [...versionIds];
    return {
      tiers: [ids],
      overall_reason: "Comparator returned invalid JSON — defaulting to tie.",
      overall_hard_failures: Object.fromEntries(ids.map((id) => [id, []])),
      ...(token_usage && { token_usage }),
    };
  }

  const parsedTiers = Array.isArray(parsed?.tiers) ? parsed.tiers : null;
  const normalizedTiers: string[][] | null = parsedTiers
    ? parsedTiers
        .map((tier) =>
          Array.isArray(tier)
            ? uniq(
                tier
                  .map((cell) => resolveComparatorVersionToken(cell, versions, allowedList))
                  .filter((id): id is string => Boolean(id))
              )
            : []
        )
        .filter((tier) => tier.length > 0)
    : null;

  const flat = normalizedTiers ? normalizedTiers.flat() : [];
  const uniqueFlat = uniq(flat);
  const allowedSet = new Set(allowedList);
  const tiersOk =
    normalizedTiers != null &&
    uniqueFlat.length === allowedList.length &&
    uniqueFlat.every((id) => allowedSet.has(id)) &&
    new Set(uniqueFlat).size === allowedList.length;

  const tiersById: string[][] = tiersOk
    ? normalizedTiers!.map((tier) => uniq(tier))
    : [[...allowedList]];

  const hfRaw = parsed?.hard_failures ?? {};
  const overall_hard_failures: Record<string, string[]> = {};
  for (const id of allowedList) {
    overall_hard_failures[id] = [];
  }
  for (const key of Object.keys(hfRaw)) {
    const resolvedId = resolveComparatorVersionToken(key, versions, allowedList);
    if (!resolvedId) continue;
    const list = hfRaw[key];
    const arr = Array.isArray(list) ? list.map(String) : [];
    overall_hard_failures[resolvedId] = [...overall_hard_failures[resolvedId], ...arr];
  }

  let overall_reason = String(parsed?.reason ?? "").trim();
  if (String(guidedReplay?.user_guidance ?? "").trim()) {
    const scrubbed = scrubGuidanceEchoesFromReason(overall_reason);
    if (scrubbed) overall_reason = scrubbed;
  }

  return {
    tiers: tiersById.filter((t) => t.length > 0),
    overall_reason,
    overall_hard_failures,
    ...(token_usage && { token_usage }),
  };
}
