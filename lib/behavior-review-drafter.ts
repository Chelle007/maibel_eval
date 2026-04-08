import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  loadBehaviorReviewDrafterSystemPrompt,
  buildBehaviorReviewDrafterUserMessage,
} from "./prompts";
import { computeTokenCost } from "./token-cost";
import {
  BEHAVIOR_REVIEW_DIMENSIONS,
  parseVersionBehaviorReview,
  type BehaviorReviewByVersion,
  type VersionBehaviorReview,
} from "./behavior-review";
import { loadContextPack } from "./context-pack";
import type { VersionEntry } from "./db.types";
import type { TestCase, TokenUsage } from "./types";

function extractJson(text: string): string {
  const trimmed = text.trim();
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  return trimmed;
}

const DEFAULT_MODEL = "gemini-3-flash-preview";

export interface DraftBehaviorReviewResult {
  reviews: BehaviorReviewByVersion;
  token_usage?: TokenUsage;
}

/**
 * Use an LLM to draft behavior review ratings for each version of a test case.
 * Returns a BehaviorReviewByVersion map with ai_drafted = true on every review.
 */
export async function draftBehaviorReview(args: {
  testCase: TestCase;
  versions: { version_id: string; version_name: string; turns: { response: string[]; detected_flags: string }[] }[];
  evaluatorReason?: string | null;
  apiKey: string;
  modelName?: string;
  contextPack?: { text: string; bundleId: string };
}): Promise<DraftBehaviorReviewResult> {
  const { testCase, versions, evaluatorReason, apiKey, modelName = DEFAULT_MODEL, contextPack } = args;
  if (versions.length === 0) return { reviews: {} };

  const genAI = new GoogleGenerativeAI(apiKey);
  const systemInstruction = loadBehaviorReviewDrafterSystemPrompt();
  const model = genAI.getGenerativeModel({ model: modelName, systemInstruction });

  let userMessage = buildBehaviorReviewDrafterUserMessage({ testCase, versions, evaluatorReason });
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
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    console.error("[behavior-review-drafter] JSON parse failed, raw:", jsonStr.slice(0, 500));
    return { reviews: {}, token_usage };
  }

  const rawReviews = (parsed.reviews ?? parsed) as Record<string, unknown>;
  const reviews: BehaviorReviewByVersion = {};
  const allowedIds = new Set(versions.map((v) => v.version_id));

  for (const [vid, rawReview] of Object.entries(rawReviews)) {
    if (!allowedIds.has(vid)) continue;
    const review = parseVersionBehaviorReview(rawReview);
    if (!review) continue;
    review.ai_drafted = true;
    if (!review.confidence && isPlainObject(rawReview)) {
      const rawConf = (rawReview as Record<string, unknown>).confidence;
      if (isPlainObject(rawConf)) {
        const conf: VersionBehaviorReview["confidence"] = {};
        for (const d of BEHAVIOR_REVIEW_DIMENSIONS) {
          const val = (rawConf as Record<string, unknown>)[d.key];
          if (typeof val === "string") {
            const v = val.trim().toLowerCase();
            if (v === "high" || v === "medium" || v === "low") conf[d.key] = v;
          }
        }
        review.confidence = conf;
      }
    }
    reviews[vid] = review;
  }

  return { reviews, token_usage };
}

/** Map stored version entries to the compact shape expected by `draftBehaviorReview`. */
export function versionEntriesToDraftInputs(versions: VersionEntry[]) {
  return versions.slice(0, 3).map((v) => {
    const run1 = v.runs.find((r) => r.run_index === 1) ?? v.runs[0];
    return {
      version_id: v.version_id,
      version_name: v.version_name,
      turns: (run1?.turns ?? []).map((t) => ({ response: t.response, detected_flags: t.detected_flags })),
    };
  });
}

/**
 * Load org context (same as eval runs) and draft behavior review for all versions in one call.
 * Used after comparison (add-version, version delete) alongside `compareOverall`.
 */
export async function draftBehaviorReviewForVersionEntries(args: {
  testCase: TestCase;
  versions: VersionEntry[];
  evaluatorReason?: string | null;
  apiKey: string;
  modelName?: string;
}): Promise<DraftBehaviorReviewResult> {
  const versionInputs = versionEntriesToDraftInputs(args.versions);
  let contextPack: { text: string; bundleId: string } | undefined;
  try {
    const cp = loadContextPack({
      purpose: "evaluator",
      query: `${args.testCase.test_case_id}\n${args.testCase.expected_state}\n${args.testCase.expected_behavior}\n${args.testCase.forbidden ?? ""}\n${args.testCase.notes ?? ""}`,
    });
    contextPack = { text: cp.text, bundleId: cp.bundleId };
  } catch {
    /* optional */
  }
  return draftBehaviorReview({
    testCase: args.testCase,
    versions: versionInputs,
    evaluatorReason: args.evaluatorReason,
    apiKey: args.apiKey,
    modelName: args.modelName,
    contextPack,
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
