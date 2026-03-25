import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  loadComparatorSystemPrompt,
  buildComparatorUserMessage,
} from "./prompts";
import { computeTokenCost } from "./token-cost";
import type { TestCase, PairwiseResult, ComparisonData } from "./types";
import type { VersionEntry } from "./db.types";

function extractJson(text: string): string {
  const trimmed = text.trim();
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  return trimmed;
}

const DEFAULT_MODEL = "gemini-3-flash-preview";

/** Run one pairwise comparison between two versions by ID. */
export async function comparePair(
  testCase: TestCase,
  versions: VersionEntry[],
  aId: string,
  bId: string,
  apiKey: string,
  modelName: string = DEFAULT_MODEL,
  systemPrompt?: string
): Promise<PairwiseResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const systemInstruction = systemPrompt ?? loadComparatorSystemPrompt();
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
  });

  const { message, aIsFirst } = buildComparatorUserMessage(
    testCase,
    versions,
    aId,
    bId
  );
  const result = await model.generateContent(message);
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
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return {
      a_id: aId,
      b_id: bId,
      raw_winner: "tie",
      winner_id: null,
      hard_failures: { A: [], B: [] },
      reason: "Comparator returned invalid JSON — defaulting to tie.",
      ...(token_usage && { token_usage }),
    };
  }

  const rawWinner = String(parsed.winner ?? "tie").trim().toUpperCase();
  let normalizedRaw: "A" | "B" | "tie";
  if (rawWinner === "A") normalizedRaw = "A";
  else if (rawWinner === "B") normalizedRaw = "B";
  else normalizedRaw = "tie";

  let winner_id: string | null = null;
  if (normalizedRaw === "A") {
    winner_id = aIsFirst ? aId : bId;
  } else if (normalizedRaw === "B") {
    winner_id = aIsFirst ? bId : aId;
  }

  const hardFailures = parsed.hard_failures as
    | { A?: string[]; B?: string[] }
    | undefined;
  const hfA = Array.isArray(hardFailures?.A) ? hardFailures!.A.map(String) : [];
  const hfB = Array.isArray(hardFailures?.B) ? hardFailures!.B.map(String) : [];

  const mappedHf = {
    A: aIsFirst ? hfA : hfB,
    B: aIsFirst ? hfB : hfA,
  };

  return {
    a_id: aId,
    b_id: bId,
    raw_winner: normalizedRaw,
    winner_id,
    hard_failures: mappedHf,
    reason: String(parsed.reason ?? ""),
    ...(token_usage && { token_usage }),
  };
}

/**
 * Readjust comparison data after a version is deleted.
 * Simply filters out comparisons and ranking entries involving the deleted ID.
 */
export function readjustComparison(
  existing: ComparisonData | null,
  deletedId: string
): ComparisonData | null {
  if (!existing) return null;

  const filteredComparisons = existing.comparisons.filter(
    (c) => c.a_id !== deletedId && c.b_id !== deletedId
  );

  const filteredRanking = existing.ranking.filter((id) => id !== deletedId);

  if (filteredRanking.length <= 1) return null;

  return {
    champion_id: filteredRanking[0],
    ranking: filteredRanking,
    comparisons: filteredComparisons,
  };
}

/**
 * Find adjacent pairs in the ranking that have no direct comparison.
 * Returns array of [rankingPos, rankingPos+1] index pairs that need recomparing.
 */
export function findUnprovenGaps(data: ComparisonData): [number, number][] {
  const { ranking, comparisons } = data;
  const comparedPairs = new Set<string>();
  for (const c of comparisons) {
    const key = [c.a_id, c.b_id].sort().join("|");
    comparedPairs.add(key);
  }

  const gaps: [number, number][] = [];
  for (let i = 0; i < ranking.length - 1; i++) {
    const key = [ranking[i], ranking[i + 1]].sort().join("|");
    if (!comparedPairs.has(key)) {
      gaps.push([i, i + 1]);
    }
  }
  return gaps;
}

/**
 * Recompare adjacent pairs in the ranking that lost their direct evidence
 * after a version deletion. Only runs AI calls for gaps that need it.
 */
export async function recompareGaps(
  data: ComparisonData,
  testCase: TestCase,
  versions: VersionEntry[],
  apiKey: string,
  modelName?: string,
  systemPrompt?: string
): Promise<ComparisonData> {
  const gaps = findUnprovenGaps(data);
  if (gaps.length === 0) return data;

  const ranking = [...data.ranking];
  const comparisons = [...data.comparisons];

  for (const [posA, posB] of gaps) {
    const higherId = ranking[posA];
    const lowerId = ranking[posB];

    const result = await comparePair(
      testCase,
      versions,
      lowerId,
      higherId,
      apiKey,
      modelName,
      systemPrompt
    );
    comparisons.push(result);

    if (result.winner_id === lowerId) {
      ranking[posA] = lowerId;
      ranking[posB] = higherId;
    }
  }

  return {
    champion_id: ranking[0],
    ranking,
    comparisons,
  };
}

/**
 * Run the champion-challenge comparison for a newly added version.
 *
 * Algorithm:
 * 1. Compare new version vs current champion.
 * 2. If new wins -> new becomes champion.
 * 3. If tie -> new sits right after champion.
 * 4. If new loses -> compare new vs runner-up (if exists).
 *    - If new wins runner-up -> new is #2.
 *    - If tie with runner-up -> new sits right after runner-up.
 *    - If new loses -> new goes to end.
 */
export async function runChampionChallenge(
  testCase: TestCase,
  versions: VersionEntry[],
  newVersionId: string,
  existing: ComparisonData | null,
  apiKey: string,
  modelName?: string,
  systemPrompt?: string
): Promise<ComparisonData> {
  const previousComparisons = existing?.comparisons ?? [];

  if (versions.length <= 1) {
    return {
      champion_id: newVersionId,
      ranking: [newVersionId],
      comparisons: [],
    };
  }

  const previousRanking =
    existing?.ranking && existing.ranking.length > 0
      ? existing.ranking
      : versions.filter((v) => v.version_id !== newVersionId).map((v) => v.version_id);

  const championId = previousRanking[0];
  const comparisons: PairwiseResult[] = [...previousComparisons];

  const vsChamp = await comparePair(
    testCase,
    versions,
    newVersionId,
    championId,
    apiKey,
    modelName,
    systemPrompt
  );
  comparisons.push(vsChamp);

  if (vsChamp.winner_id === newVersionId) {
    return {
      champion_id: newVersionId,
      ranking: [newVersionId, ...previousRanking],
      comparisons,
    };
  }

  if (vsChamp.winner_id === null) {
    const rest = previousRanking.slice(1);
    return {
      champion_id: championId,
      ranking: [championId, newVersionId, ...rest],
      comparisons,
    };
  }

  if (previousRanking.length >= 2) {
    const runnerUpId = previousRanking[1];
    const vsRunnerUp = await comparePair(
      testCase,
      versions,
      newVersionId,
      runnerUpId,
      apiKey,
      modelName,
      systemPrompt
    );
    comparisons.push(vsRunnerUp);

    if (vsRunnerUp.winner_id === newVersionId) {
      const [champ, , ...rest] = previousRanking;
      return {
        champion_id: champ,
        ranking: [champ, newVersionId, runnerUpId, ...rest],
        comparisons,
      };
    }

    if (vsRunnerUp.winner_id === null) {
      const [champ, ru, ...rest] = previousRanking;
      return {
        champion_id: champ,
        ranking: [champ, ru, newVersionId, ...rest],
        comparisons,
      };
    }

    return {
      champion_id: championId,
      ranking: [...previousRanking, newVersionId],
      comparisons,
    };
  }

  return {
    champion_id: championId,
    ranking: [...previousRanking, newVersionId],
    comparisons,
  };
}
