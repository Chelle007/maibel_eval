/**
 * Migration script: Convert evren_responses from turn-first format to version-first format.
 *
 * Old format (turn-first):
 *   [{ response: [[v0_bubbles], [v1_bubbles]], detected_flags: "[f0, f1]" }, ...]
 *
 * New format (version-first):
 *   [{ version_id, version_name, turns: [{ response, detected_flags }] }, ...]
 *
 * Also converts comparison data from numeric indices to version_id strings.
 *
 * Usage:
 *   npx tsx scripts/migrate-evren-responses.ts
 *
 * Dry run (no writes):
 *   DRY_RUN=1 npx tsx scripts/migrate-evren-responses.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local so the script works the same as Next.js
for (const envFile of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(resolve(process.cwd(), envFile), "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* file not found — skip */
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DRY_RUN = process.env.DRY_RUN === "1";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC variants).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface OldEvrenItem {
  response: string | string[] | string[][];
  detected_flags: string;
}

interface VersionTurn {
  response: string[];
  detected_flags: string;
}

interface VersionEntry {
  version_id: string;
  version_name: string;
  turns: VersionTurn[];
}

function isAlreadyMigrated(data: unknown[]): boolean {
  if (data.length === 0) return true;
  const first = data[0] as Record<string, unknown>;
  return typeof first.version_id === "string";
}

function toResponseVersions(value: OldEvrenItem["response"]): string[][] {
  if (typeof value === "string") return [[value]];
  if (!Array.isArray(value)) return [];
  if (value.every((v) => typeof v === "string")) {
    return [(value as string[]).map(String)];
  }
  return (value as unknown[]).map((version) => {
    if (Array.isArray(version)) return version.map((b) => String(b ?? ""));
    return [String(version ?? "")];
  });
}

function toDetectedFlagsList(value: string | undefined): string[] {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((v: unknown) => String(v ?? ""));
  } catch {
    /* legacy */
  }
  return [trimmed];
}

function migrateRow(oldItems: OldEvrenItem[]): VersionEntry[] {
  if (oldItems.length === 0) return [];

  const firstVersions = toResponseVersions(oldItems[0].response);
  const versionCount = firstVersions.length;

  const entries: VersionEntry[] = [];
  for (let v = 0; v < versionCount; v++) {
    const turns: VersionTurn[] = [];
    for (const item of oldItems) {
      const responseVersions = toResponseVersions(item.response);
      const flagVersions = toDetectedFlagsList(item.detected_flags);
      turns.push({
        response: responseVersions[v] ?? [],
        detected_flags: flagVersions[v] ?? (v === 0 ? String(item.detected_flags ?? "") : ""),
      });
    }
    entries.push({
      version_id: crypto.randomUUID(),
      version_name: `Version ${v + 1}`,
      turns,
    });
  }
  return entries;
}

interface OldComparison {
  champion_index: number;
  ranking: number[];
  comparisons: {
    a_index: number;
    b_index: number;
    raw_winner: string;
    winner_index: number | null;
    hard_failures: { A: string[]; B: string[] };
    reason: string;
    token_usage?: unknown;
  }[];
}

function migrateComparison(
  old: OldComparison | null,
  versionIdByIndex: Map<number, string>
): unknown | null {
  if (!old) return null;

  const mapId = (idx: number): string => versionIdByIndex.get(idx) ?? `unknown-${idx}`;

  return {
    champion_id: mapId(old.champion_index),
    ranking: old.ranking.map(mapId),
    comparisons: old.comparisons.map((c) => ({
      a_id: mapId(c.a_index),
      b_id: mapId(c.b_index),
      raw_winner: c.raw_winner,
      winner_id: c.winner_index === null ? null : mapId(c.winner_index),
      hard_failures: c.hard_failures,
      reason: c.reason,
      ...(c.token_usage ? { token_usage: c.token_usage } : {}),
    })),
  };
}

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== MIGRATING ===");

  const { data: rows, error } = await supabase
    .from("eval_results")
    .select("eval_result_id, evren_responses, comparison")
    .order("eval_result_id");

  if (error) {
    console.error("Failed to fetch eval_results:", error.message);
    process.exit(1);
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    const evalId = row.eval_result_id as string;
    const oldResponses = row.evren_responses as unknown[];

    if (!Array.isArray(oldResponses) || oldResponses.length === 0) {
      skipped++;
      continue;
    }

    if (isAlreadyMigrated(oldResponses)) {
      skipped++;
      continue;
    }

    try {
      const newVersions = migrateRow(oldResponses as OldEvrenItem[]);

      const versionIdByIndex = new Map<number, string>();
      newVersions.forEach((v, i) => versionIdByIndex.set(i, v.version_id));

      const newComparison = migrateComparison(
        row.comparison as OldComparison | null,
        versionIdByIndex
      );

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from("eval_results")
          .update({
            evren_responses: newVersions,
            comparison: newComparison,
          })
          .eq("eval_result_id", evalId);

        if (updateError) {
          console.error(`  FAILED ${evalId}: ${updateError.message}`);
          failed++;
          continue;
        }
      }

      migrated++;
      console.log(`  ${DRY_RUN ? "[dry]" : "OK"} ${evalId} → ${newVersions.length} version(s)`);
    } catch (err) {
      console.error(`  FAILED ${evalId}:`, err);
      failed++;
    }
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}, Failed: ${failed}`);
}

main();
