import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  loadComparatorOverallSystemPrompt,
  buildComparatorOverallUserMessage,
  loadComparatorOverallEditSystemPrompt,
  buildComparatorOverallEditUserMessage,
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

type OverallComparatorLabels = "A" | "B" | "C";

type OverallComparatorJson = {
  tiers: OverallComparatorLabels[][];
  reason?: string;
  hard_failures?: Partial<Record<OverallComparatorLabels, string[]>>;
};

type OverallComparatorEditJson = {
  tiers: string[][];
  reason?: string;
  hard_failures?: Record<string, string[]>;
};

function normalizeLabel(x: unknown): OverallComparatorLabels | null {
  const s = String(x ?? "").trim().toUpperCase();
  if (s === "A" || s === "B" || s === "C") return s;
  return null;
}

function normalizeId(x: unknown): string | null {
  const s = String(x ?? "").trim();
  return s ? s : null;
}

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

function normalizeComparisonFromEditJson(
  parsed: OverallComparatorEditJson | null,
  versionIds: string[],
  fallback: ComparisonData | null
): ComparisonData {
  const ids = versionIds.map(String).filter(Boolean);
  const allowed = new Set(ids);

  const rawTiers = Array.isArray(parsed?.tiers) ? parsed!.tiers : null;
  const normalizedTiers: string[][] | null = rawTiers
    ? rawTiers
        .map((tier) =>
          Array.isArray(tier)
            ? (tier.map(normalizeId).filter(Boolean) as string[]).filter((id) => allowed.has(id))
            : []
        )
        .filter((tier) => tier.length > 0)
    : null;

  const flat = normalizedTiers ? normalizedTiers.flat() : [];
  const uniqueFlat = uniq(flat);
  const tiersOk = normalizedTiers != null && uniqueFlat.length === ids.length && new Set(uniqueFlat).size === ids.length;

  const tiers = tiersOk ? normalizedTiers!.map((t) => uniq(t)) : (fallback?.tiers?.length ? fallback.tiers : [ids]);

  const reasonRaw = String(parsed?.reason ?? "").trim();
  const overall_reason =
    reasonRaw || (fallback?.overall_reason?.trim() ? fallback.overall_reason : "Edited comparison.");

  const hfRaw = parsed?.hard_failures ?? {};
  const overall_hard_failures: Record<string, string[]> = {};
  for (const id of ids) {
    const list = hfRaw?.[id];
    overall_hard_failures[id] = Array.isArray(list) ? list.map(String) : [];
  }

  return { tiers, overall_reason, overall_hard_failures };
}

/**
 * Run one unified overall comparison across 2 or 3 versions by ID.
 * Stores tiers (by version_id) + overall_reason + overall_hard_failures (by version_id).
 */
export async function compareOverall(
  testCase: TestCase,
  versions: VersionEntry[],
  versionIds: [string, string] | [string, string, string],
  apiKey: string,
  modelName: string = DEFAULT_MODEL,
  systemPrompt?: string,
  contextPack?: { text: string; bundleId: string }
): Promise<ComparisonData> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const systemInstruction = systemPrompt ?? loadComparatorOverallSystemPrompt();
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
  });

  const { message, labels, labelToVersionId } = buildComparatorOverallUserMessage(
    testCase,
    versions,
    versionIds
  );
  const finalMessage =
    contextPack?.text?.trim()
      ? `${message}\n\n=== ORGANIZATION CONTEXT (bundle: ${contextPack.bundleId}) ===\n${contextPack.text.trim()}\n`
      : message;
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

  const jsonStr = extractJson(text);
  let parsed: OverallComparatorJson | null = null;
  try {
    parsed = JSON.parse(jsonStr) as OverallComparatorJson;
  } catch {
    const ids = [...versionIds];
    return {
      tiers: [ids],
      overall_reason: "Comparator returned invalid JSON — defaulting to tie.",
      overall_hard_failures: Object.fromEntries(ids.map((id) => [id, []])),
      ...(token_usage && { token_usage }),
    };
  }

  const allowedLabels = new Set(labels);

  const parsedTiers = Array.isArray(parsed?.tiers) ? parsed!.tiers : null;
  const normalizedLabelTiers: OverallComparatorLabels[][] | null = parsedTiers
    ? parsedTiers
        .map((tier) => (Array.isArray(tier) ? tier.map(normalizeLabel).filter(Boolean) as OverallComparatorLabels[] : []))
        .filter((tier) => tier.length > 0)
    : null;

  const labelsFlat = normalizedLabelTiers ? normalizedLabelTiers.flat() : [];
  const labelsFlatFiltered = labelsFlat.filter((l) => allowedLabels.has(l));
  const uniqueLabels = new Set(labelsFlatFiltered);
  const tiersOk = normalizedLabelTiers != null && labelsFlatFiltered.length === labels.length && uniqueLabels.size === labels.length;

  const labelToId = (l: OverallComparatorLabels): string | null => {
    const id = labelToVersionId[l];
    return typeof id === "string" ? id : null;
  };

  const tiersById: string[][] = tiersOk
    ? normalizedLabelTiers!.map((tier) => uniq(tier).map((l) => labelToId(l)!).filter(Boolean) as string[])
    : [[...versionIds]];

  const hardFailures = parsed?.hard_failures ?? {};
  const overall_hard_failures: Record<string, string[]> = {};
  for (const label of labels) {
    const id = labelToVersionId[label];
    if (!id) continue;
    const list = hardFailures[label];
    overall_hard_failures[id] = Array.isArray(list) ? list.map(String) : [];
  }

  // Ensure every provided version_id has an entry, even if prompt omitted failures.
  for (const id of versionIds) {
    if (!Array.isArray(overall_hard_failures[id])) overall_hard_failures[id] = [];
  }

  const overall_reason = String(parsed?.reason ?? "").trim();

  return {
    tiers: tiersById.filter((t) => t.length > 0),
    overall_reason,
    overall_hard_failures,
    ...(token_usage && { token_usage }),
  };
}

export async function editOverallComparison(args: {
  feedback: string;
  version_entries: { version_id: string; version_name: string }[];
  current_comparison: ComparisonData | null;
  apiKey: string;
  modelName?: string;
  systemPrompt?: string;
  test_case_id?: string | null;
  expected_state?: string | null;
  expected_behavior?: string | null;
}): Promise<ComparisonData & { token_usage?: ReturnType<typeof computeTokenCost> }> {
  const versionIds = (args.version_entries ?? []).map((v) => v.version_id).filter(Boolean).slice(0, 3);
  if (versionIds.length < 2) {
    return {
      tiers: [versionIds],
      overall_reason: "Not enough versions to compare.",
      overall_hard_failures: Object.fromEntries(versionIds.map((id) => [id, []])),
    };
  }

  const genAI = new GoogleGenerativeAI(args.apiKey);
  const systemInstruction = args.systemPrompt ?? loadComparatorOverallEditSystemPrompt();
  const model = genAI.getGenerativeModel({
    model: args.modelName ?? DEFAULT_MODEL,
    systemInstruction,
  });

  const message = buildComparatorOverallEditUserMessage({
    feedback: args.feedback,
    version_entries: args.version_entries.slice(0, 3),
    current_comparison: args.current_comparison,
    test_case_id: args.test_case_id ?? null,
    expected_state: args.expected_state ?? null,
    expected_behavior: args.expected_behavior ?? null,
  });

  const result = await model.generateContent(message);
  const response = result.response;
  const text = response.text();

  const usage = response.usageMetadata;
  const token_usage = usage
    ? computeTokenCost(
        usage.promptTokenCount ?? 0,
        usage.candidatesTokenCount ?? 0,
        args.modelName ?? DEFAULT_MODEL
      )
    : undefined;

  const jsonStr = extractJson(text);
  let parsed: OverallComparatorEditJson | null = null;
  try {
    parsed = JSON.parse(jsonStr) as OverallComparatorEditJson;
  } catch {
    const fallback = args.current_comparison;
    return {
      ...(fallback ?? {
        tiers: [versionIds],
        overall_reason: "AI edit returned invalid JSON — leaving comparison unchanged.",
        overall_hard_failures: Object.fromEntries(versionIds.map((id) => [id, []])),
      }),
      ...(token_usage && { token_usage }),
    };
  }

  const normalized = normalizeComparisonFromEditJson(parsed, versionIds, args.current_comparison);
  return { ...normalized, ...(token_usage && { token_usage }) };
}
