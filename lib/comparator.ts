import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  loadComparatorSystemPrompt,
  buildComparatorUserMessage,
  loadComparatorTripleSystemPrompt,
  buildComparatorTripleUserMessage,
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

type TripleComparisonData = ComparisonData & {
  overall_reason?: string;
  overall_hard_failures?: Record<string, string[]>;
  overall_raw_winner?: "A" | "B" | "C" | "tie";
  overall_winner_id?: string | null;
  tiers?: string[][];
};

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

/** Run one 3-way comparison between three versions by ID. */
export async function compareTriple(
  testCase: TestCase,
  versions: VersionEntry[],
  versionIds: [string, string, string],
  apiKey: string,
  modelName: string = DEFAULT_MODEL,
  systemPrompt?: string
): Promise<TripleComparisonData> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const systemInstruction = systemPrompt ?? loadComparatorTripleSystemPrompt();
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
  });

  const { message, labelToVersionId } = buildComparatorTripleUserMessage(
    testCase,
    versions,
    versionIds
  );

  const result = await model.generateContent(message);
  const response = result.response;
  const text = response.text();

  const jsonStr = extractJson(text);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return {
      champion_id: versionIds[0],
      ranking: [...versionIds],
      comparisons: [],
      overall_reason: "Comparator returned invalid JSON — defaulting to original order.",
    };
  }

  const rawRanking = parsed.ranking;
  const normalizedLabels = Array.isArray(rawRanking)
    ? rawRanking.map((x) => String(x ?? "").trim().toUpperCase())
    : [];

  const allowed = new Set(["A", "B", "C"]);
  const unique = new Set(normalizedLabels);
  const rankingLabelsOk =
    normalizedLabels.length === 3 &&
    normalizedLabels.every((l) => allowed.has(l)) &&
    unique.size === 3;

  const mapLabelToId = (label: string): string | null => {
    if (label === "A") return labelToVersionId.A;
    if (label === "B") return labelToVersionId.B;
    if (label === "C") return labelToVersionId.C;
    return null;
  };

  const rawTiers = parsed.tiers;
  const normalizedTiers: string[][] = Array.isArray(rawTiers)
    ? (rawTiers as unknown[]).map((tier) =>
        Array.isArray(tier) ? (tier as unknown[]).map((x) => String(x ?? "").trim().toUpperCase()) : []
      )
    : [];

  const tiersLabelsOk = (() => {
    if (!Array.isArray(rawTiers) || normalizedTiers.length === 0) return false;
    if (normalizedTiers.some((t) => t.length === 0)) return false;
    const flat = normalizedTiers.flat();
    if (flat.length !== 3) return false;
    if (!flat.every((l) => allowed.has(l))) return false;
    return new Set(flat).size === 3;
  })();

  const tiers: string[][] | undefined = tiersLabelsOk
    ? normalizedTiers.map((tier) => tier.map((l) => mapLabelToId(l)!).filter(Boolean) as string[])
    : undefined;

  const ranking = tiers
    ? tiers.flat()
    : rankingLabelsOk
      ? (normalizedLabels.map((l) => mapLabelToId(l)!).filter(Boolean) as string[])
      : [...versionIds];

  const reason = String(parsed.reason ?? "");

  const overall_winner_id =
    tiers && tiers[0] && tiers[0].length === 1 ? tiers[0][0] : null;
  const normalizedRawWinner: "A" | "B" | "C" | "tie" =
    overall_winner_id == null ? "tie" : "A"; // retained for backward compatibility; UI should use overall_winner_id / tiers

  const hardFailures = parsed.hard_failures as
    | { A?: string[]; B?: string[]; C?: string[] }
    | undefined;
  const hfA = Array.isArray(hardFailures?.A) ? hardFailures!.A.map(String) : [];
  const hfB = Array.isArray(hardFailures?.B) ? hardFailures!.B.map(String) : [];
  const hfC = Array.isArray(hardFailures?.C) ? hardFailures!.C.map(String) : [];
  const overall_hard_failures: Record<string, string[]> = {
    [labelToVersionId.A]: hfA,
    [labelToVersionId.B]: hfB,
    [labelToVersionId.C]: hfC,
  };

  return {
    champion_id: ranking[0],
    ranking,
    comparisons: [],
    overall_reason: reason,
    overall_hard_failures,
    overall_raw_winner: normalizedRawWinner,
    overall_winner_id,
    ...(tiers && { tiers }),
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
 * Round-robin comparison of all version pairs.
 *
 * - 2 versions: one comparison (v1 vs v2).
 * - 3 versions: three comparisons (v1 vs v2, v2 vs v3, v1 vs v3).
 *
 * Ranking is derived by scoring each version: win = 3, tie = 1, loss = 0.
 */
export async function runRoundRobin(
  testCase: TestCase,
  versions: VersionEntry[],
  apiKey: string,
  modelName?: string,
  systemPrompt?: string
): Promise<ComparisonData> {
  const ids = versions.map((v) => v.version_id);

  if (ids.length <= 1) {
    return {
      champion_id: ids[0],
      ranking: ids,
      comparisons: [],
    };
  }

  // Pair order matters for display. For 3 versions we want:
  // (v1 vs v2), (v2 vs v3), (v1 vs v3).
  let pairs: [string, string][];
  if (ids.length === 2) {
    pairs = [[ids[0], ids[1]]];
  } else if (ids.length === 3) {
    pairs = [
      [ids[0], ids[1]],
      [ids[1], ids[2]],
      [ids[0], ids[2]],
    ];
  } else {
    // Should not happen in normal flow (we cap at 3), but keep a sane default.
    pairs = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        pairs.push([ids[i], ids[j]]);
      }
    }
  }

  const comparisons: PairwiseResult[] = [];
  for (const [aId, bId] of pairs) {
    const result = await comparePair(
      testCase,
      versions,
      aId,
      bId,
      apiKey,
      modelName,
      systemPrompt
    );
    comparisons.push(result);
  }

  const scores = new Map<string, number>();
  for (const id of ids) scores.set(id, 0);

  for (const c of comparisons) {
    if (c.winner_id === null) {
      scores.set(c.a_id, (scores.get(c.a_id) ?? 0) + 1);
      scores.set(c.b_id, (scores.get(c.b_id) ?? 0) + 1);
    } else {
      scores.set(c.winner_id, (scores.get(c.winner_id) ?? 0) + 3);
    }
  }

  const ranking = [...ids].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));

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
