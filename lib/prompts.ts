import { readFileSync } from "fs";
import path from "path";
import type { TestCase, EvrenOutput } from "./types";
import type { VersionEntry } from "./db.types";

const PROMPTS_DIR = path.join(process.cwd(), "content", "prompts");

function readPrompt(filename: string): string {
  return readFileSync(path.join(PROMPTS_DIR, filename), "utf-8").trim();
}

/** Load base system prompt (Evren persona + flag logic). */
export function loadBaseSystemPrompt(): string {
  return readPrompt("base_system_prompt.txt");
}

/** Load evaluator system prompt and inject base prompt. */
export function loadEvaluatorSystemPrompt(): string {
  const content = readPrompt("evaluator_system_prompt.txt");
  const base = loadBaseSystemPrompt();
  return content.replace(/\{base_system_prompt\}/g, base);
}

/** Load summarizer system prompt and inject base prompt. */
export function loadSummarizerSystemPrompt(): string {
  const content = readPrompt("summarizer_system_prompt.txt");
  const base = loadBaseSystemPrompt();
  return content.replace(/\{base_system_prompt\}/g, base);
}

/** Load comparator system prompt and inject base prompt. */
export function loadComparatorSystemPrompt(): string {
  const content = readPrompt("comparator_system_prompt.txt");
  const base = loadBaseSystemPrompt();
  return content.replace(/\{base_system_prompt\}/g, base);
}

/** Version data for one side of a pairwise comparison. */
export interface VersionSnapshot {
  /** Per-turn responses (array of bubble arrays). */
  responses: string[][];
  /** Per-turn detected flags. */
  flags: string[];
}

/** Extract a single version's data by version_id. */
function extractVersionSnapshot(
  versions: VersionEntry[],
  versionId: string
): VersionSnapshot {
  const entry = versions.find((v) => v.version_id === versionId);
  if (!entry) return { responses: [], flags: [] };
  return {
    responses: entry.turns.map((t) => t.response),
    flags: entry.turns.map((t) => t.detected_flags),
  };
}

/** Build the user message for the comparator. Randomizes A/B to reduce position bias. */
export function buildComparatorUserMessage(
  testCase: TestCase,
  versions: VersionEntry[],
  aId: string,
  bId: string
): { message: string; aIsFirst: boolean } {
  const aIsFirst = Math.random() < 0.5;
  const firstId = aIsFirst ? aId : bId;
  const secondId = aIsFirst ? bId : aId;

  const firstSnapshot = extractVersionSnapshot(versions, firstId);
  const secondSnapshot = extractVersionSnapshot(versions, secondId);

  const userMessages: string[] =
    testCase.type === "multi_turn" && Array.isArray(testCase.turns) && testCase.turns.length > 0
      ? testCase.turns.map((s) => String(s ?? "").trim())
      : [testCase.input_message?.trim() ?? ""];

  const sections: string[] = [];

  sections.push("=== TEST CASE ===");
  sections.push(`test_case_id: ${testCase.test_case_id}`);
  if (testCase.img_url) sections.push(`Img url: ${testCase.img_url}`);
  sections.push(`Expected states: ${testCase.expected_state}`);
  sections.push(`Expected behavior: ${testCase.expected_behavior}`);
  if (testCase.forbidden) sections.push(`Forbidden: ${testCase.forbidden}`);
  if (testCase.notes) sections.push(`Notes: ${testCase.notes}`);

  const turnCount = Math.max(userMessages.length, firstSnapshot.responses.length);

  sections.push("");
  sections.push("=== RESPONSE A ===");
  for (let i = 0; i < turnCount; i++) {
    sections.push(`--- Turn ${i + 1} ---`);
    sections.push(`User: ${userMessages[i] ?? "(no user message)"}`);
    const bubbles = firstSnapshot.responses[i] ?? [];
    sections.push(`Evren response: ${bubbles.join("\n") || "(empty)"}`);
    sections.push(`Detected flags: ${firstSnapshot.flags[i] ?? ""}`);
    sections.push("");
  }

  sections.push("=== RESPONSE B ===");
  for (let i = 0; i < turnCount; i++) {
    sections.push(`--- Turn ${i + 1} ---`);
    sections.push(`User: ${userMessages[i] ?? "(no user message)"}`);
    const bubbles = secondSnapshot.responses[i] ?? [];
    sections.push(`Evren response: ${bubbles.join("\n") || "(empty)"}`);
    sections.push(`Detected flags: ${secondSnapshot.flags[i] ?? ""}`);
    sections.push("");
  }

  return { message: sections.join("\n"), aIsFirst };
}

/** Build the user message (INPUT DATA) for the evaluator. Always one format: test case metadata + CONVERSATION (turns of user input + Evren response + detected flags). */
export function buildEvaluatorUserMessage(
  testCase: TestCase,
  evrenOutputOrOutputs: EvrenOutput | EvrenOutput[]
): string {
  const tc = testCase;
  const outputs = Array.isArray(evrenOutputOrOutputs) ? evrenOutputOrOutputs : [evrenOutputOrOutputs];
  const userMessages: string[] =
    tc.type === "multi_turn" && Array.isArray(tc.turns) && tc.turns.length > 0
      ? tc.turns.map((s) => String(s ?? "").trim())
      : [tc.input_message?.trim() ?? ""];
  const sections: string[] = [];

  sections.push("=== TEST CASE ===");
  sections.push(`test_case_id: ${tc.test_case_id}`);
  if (tc.img_url) sections.push(`Img url: ${tc.img_url}`);
  sections.push(`Expected states: ${tc.expected_state}`);
  sections.push(`Expected behavior: ${tc.expected_behavior}`);
  if (tc.forbidden) sections.push(`Forbidden: ${tc.forbidden}`);
  if (tc.notes) sections.push(`Notes: ${tc.notes}`);

  sections.push("");
  sections.push("=== CONVERSATION ===");
  sections.push("(Evaluate every turn and the whole exchange.)");
  for (let i = 0; i < outputs.length; i++) {
    const n = i + 1;
    const userMsg = userMessages[i] ?? "(no user message)";
    const out = outputs[i] ?? { evren_response: "", detected_states: "" };
    const responseText = Array.isArray(out.evren_response) ? out.evren_response.join("\n") : out.evren_response;
    sections.push(`--- Turn ${n} ---`);
    sections.push(`User: ${userMsg}`);
    sections.push(`Evren response: ${responseText}`);
    sections.push(`Detected flags: ${out.detected_states}`);
    sections.push("");
  }

  return sections.join("\n");
}
