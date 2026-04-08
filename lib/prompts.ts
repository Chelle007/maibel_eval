import { readFileSync } from "fs";
import path from "path";
import type { TestCase, EvrenOutput } from "./types";
import { normalizeVersionEntry } from "./db.types";
import type { AnyVersionEntry } from "./db.types";

const PROMPTS_DIR = path.join(process.cwd(), "content", "prompts");

function readPrompt(filename: string): string {
  return readFileSync(path.join(PROMPTS_DIR, filename), "utf-8").trim();
}

/** Load base system prompt (org-context precedence + fallback persona). */
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

/** Load 3-way comparator system prompt and inject base prompt. */
export function loadComparatorTripleSystemPrompt(): string {
  const content = readPrompt("comparator_triple_system_prompt.txt");
  const base = loadBaseSystemPrompt();
  return content.replace(/\{base_system_prompt\}/g, base);
}

/** Load unified overall comparator system prompt and inject base prompt. */
export function loadComparatorOverallSystemPrompt(): string {
  const content = readPrompt("comparator_overall_system_prompt.txt");
  const base = loadBaseSystemPrompt();
  return content.replace(/\{base_system_prompt\}/g, base);
}

/** Load unified overall comparator EDIT system prompt and inject base prompt. */
export function loadComparatorOverallEditSystemPrompt(): string {
  const content = readPrompt("comparator_overall_edit_system_prompt.txt");
  const base = loadBaseSystemPrompt();
  return content.replace(/\{base_system_prompt\}/g, base);
}

/** Load behavior review drafter system prompt and inject base prompt. */
export function loadBehaviorReviewDrafterSystemPrompt(): string {
  const content = readPrompt("behavior_review_drafter_system_prompt.txt");
  const base = loadBaseSystemPrompt();
  return content.replace(/\{base_system_prompt\}/g, base);
}

/** Load session review summary drafter system prompt and inject base prompt. */
export function loadSessionReviewSummaryDrafterSystemPrompt(): string {
  const content = readPrompt("session_review_summary_drafter_system_prompt.txt");
  const base = loadBaseSystemPrompt();
  return content.replace(/\{base_system_prompt\}/g, base);
}

export function buildComparatorOverallEditUserMessage(args: {
  feedback: string;
  version_entries: { version_id: string; version_name: string }[];
  current_comparison: unknown | null;
  test_case_id?: string | null;
  expected_state?: string | null;
  expected_behavior?: string | null;
}): string {
  const versions = Array.isArray(args.version_entries) ? args.version_entries : [];
  const feedback = String(args.feedback ?? "").trim();
  const sections: string[] = [];

  sections.push("=== CONTEXT ===");
  if (args.test_case_id) sections.push(`test_case_id: ${args.test_case_id}`);
  if (args.expected_state) sections.push(`Expected states: ${String(args.expected_state)}`);
  if (args.expected_behavior) sections.push(`Expected behavior: ${String(args.expected_behavior)}`);
  sections.push("");

  sections.push("=== AVAILABLE VERSIONS (authoritative mapping) ===");
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i];
    sections.push(`${i + 1}. ${v.version_name} | version_id: ${v.version_id}`);
  }
  sections.push("");

  sections.push("=== CURRENT COMPARISON (for reference) ===");
  try {
    sections.push(JSON.stringify(args.current_comparison ?? null, null, 2));
  } catch {
    sections.push(String(args.current_comparison ?? "null"));
  }
  sections.push("");

  sections.push("=== USER FEEDBACK (authoritative) ===");
  sections.push(feedback || "(empty)");

  return sections.join("\n");
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
  versions: AnyVersionEntry[],
  versionId: string
): VersionSnapshot {
  const entry = versions.find((v) => v.version_id === versionId);
  if (!entry) return { responses: [], flags: [] };
  const normalized = normalizeVersionEntry(entry);
  const run1 = normalized.runs.find((run) => run.run_index === 1) ?? normalized.runs[0];
  const turns = run1?.turns ?? [];
  return {
    responses: turns.map((t) => t.response),
    flags: turns.map((t) => t.detected_flags),
  };
}

/** Build the user message for the comparator. Randomizes A/B to reduce position bias. */
export function buildComparatorUserMessage(
  testCase: TestCase,
  versions: AnyVersionEntry[],
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

/**
 * Build the user message for the 3-way comparator.
 * Randomizes A/B/C to reduce position bias.
 */
export function buildComparatorTripleUserMessage(
  testCase: TestCase,
  versions: AnyVersionEntry[],
  versionIds: [string, string, string]
): { message: string; labelToVersionId: Record<"A" | "B" | "C", string> } {
  const shuffled = [...versionIds].sort(() => Math.random() - 0.5) as [string, string, string];
  const labelToVersionId: Record<"A" | "B" | "C", string> = {
    A: shuffled[0],
    B: shuffled[1],
    C: shuffled[2],
  };

  const snapshots: Record<"A" | "B" | "C", VersionSnapshot> = {
    A: extractVersionSnapshot(versions, labelToVersionId.A),
    B: extractVersionSnapshot(versions, labelToVersionId.B),
    C: extractVersionSnapshot(versions, labelToVersionId.C),
  };

  const userMessages: string[] =
    testCase.type === "multi_turn" && Array.isArray(testCase.turns) && testCase.turns.length > 0
      ? testCase.turns.map((s) => String(s ?? "").trim())
      : [testCase.input_message?.trim() ?? ""];

  const turnCount = Math.max(
    userMessages.length,
    snapshots.A.responses.length,
    snapshots.B.responses.length,
    snapshots.C.responses.length
  );

  const sections: string[] = [];
  sections.push("=== TEST CASE ===");
  sections.push(`test_case_id: ${testCase.test_case_id}`);
  if (testCase.img_url) sections.push(`Img url: ${testCase.img_url}`);
  sections.push(`Expected states: ${testCase.expected_state}`);
  sections.push(`Expected behavior: ${testCase.expected_behavior}`);
  if (testCase.forbidden) sections.push(`Forbidden: ${testCase.forbidden}`);
  if (testCase.notes) sections.push(`Notes: ${testCase.notes}`);
  sections.push("");

  const pushResponse = (label: "A" | "B" | "C") => {
    sections.push(`=== RESPONSE ${label} ===`);
    for (let i = 0; i < turnCount; i++) {
      sections.push(`--- Turn ${i + 1} ---`);
      sections.push(`User: ${userMessages[i] ?? "(no user message)"}`);
      const bubbles = snapshots[label].responses[i] ?? [];
      sections.push(`Evren response: ${bubbles.join("\n") || "(empty)"}`);
      sections.push(`Detected flags: ${snapshots[label].flags[i] ?? ""}`);
      sections.push("");
    }
  };

  pushResponse("A");
  pushResponse("B");
  pushResponse("C");

  return { message: sections.join("\n"), labelToVersionId };
}

/** Build the user message for the unified overall comparator. Supports 2 or 3 versions. Randomizes A/B(/C) to reduce position bias. */
export function buildComparatorOverallUserMessage(
  testCase: TestCase,
  versions: AnyVersionEntry[],
  versionIds: [string, string] | [string, string, string]
): {
  message: string;
  labels: ("A" | "B" | "C")[];
  labelToVersionId: Partial<Record<"A" | "B" | "C", string>>;
} {
  const ids = [...versionIds] as string[];
  const shuffled = [...ids].sort(() => Math.random() - 0.5);
  const labels: ("A" | "B" | "C")[] = shuffled.length === 2 ? ["A", "B"] : ["A", "B", "C"];

  const labelToVersionId: Partial<Record<"A" | "B" | "C", string>> = {};
  for (let i = 0; i < labels.length; i++) {
    labelToVersionId[labels[i]] = shuffled[i];
  }

  const snapshots: Partial<Record<"A" | "B" | "C", VersionSnapshot>> = {
    A: labelToVersionId.A ? extractVersionSnapshot(versions, labelToVersionId.A) : undefined,
    B: labelToVersionId.B ? extractVersionSnapshot(versions, labelToVersionId.B) : undefined,
    C: labelToVersionId.C ? extractVersionSnapshot(versions, labelToVersionId.C) : undefined,
  };

  const userMessages: string[] =
    testCase.type === "multi_turn" && Array.isArray(testCase.turns) && testCase.turns.length > 0
      ? testCase.turns.map((s) => String(s ?? "").trim())
      : [testCase.input_message?.trim() ?? ""];

  const turnCount = Math.max(
    userMessages.length,
    snapshots.A?.responses?.length ?? 0,
    snapshots.B?.responses?.length ?? 0,
    snapshots.C?.responses?.length ?? 0
  );

  const sections: string[] = [];
  sections.push("=== TEST CASE ===");
  sections.push(`test_case_id: ${testCase.test_case_id}`);
  if (testCase.img_url) sections.push(`Img url: ${testCase.img_url}`);
  sections.push(`Expected states: ${testCase.expected_state}`);
  sections.push(`Expected behavior: ${testCase.expected_behavior}`);
  if (testCase.forbidden) sections.push(`Forbidden: ${testCase.forbidden}`);
  if (testCase.notes) sections.push(`Notes: ${testCase.notes}`);
  sections.push("");

  const pushResponse = (label: "A" | "B" | "C") => {
    const snap = snapshots[label];
    if (!snap) return;
    sections.push(`=== RESPONSE ${label} ===`);
    for (let i = 0; i < turnCount; i++) {
      sections.push(`--- Turn ${i + 1} ---`);
      sections.push(`User: ${userMessages[i] ?? "(no user message)"}`);
      const bubbles = snap.responses[i] ?? [];
      sections.push(`Evren response: ${bubbles.join("\n") || "(empty)"}`);
      sections.push(`Detected flags: ${snap.flags[i] ?? ""}`);
      sections.push("");
    }
  };

  pushResponse("A");
  pushResponse("B");
  pushResponse("C");

  return { message: sections.join("\n"), labels, labelToVersionId };
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

/** Build the user message for the AI behavior review drafter. */
export function buildBehaviorReviewDrafterUserMessage(args: {
  testCase: TestCase;
  versions: { version_id: string; version_name: string; turns: { response: string[]; detected_flags: string }[] }[];
  evaluatorReason?: string | null;
}): string {
  const { testCase: tc, versions, evaluatorReason } = args;
  const sections: string[] = [];

  sections.push("=== TEST CASE ===");
  sections.push(`test_case_id: ${tc.test_case_id}`);
  if (tc.img_url) sections.push(`Img url: ${tc.img_url}`);
  sections.push(`Expected states: ${tc.expected_state}`);
  sections.push(`Expected behavior: ${tc.expected_behavior}`);
  if (tc.forbidden) sections.push(`Forbidden: ${tc.forbidden}`);
  if (tc.notes) sections.push(`Notes: ${tc.notes}`);

  const userMessages: string[] =
    tc.type === "multi_turn" && Array.isArray(tc.turns) && tc.turns.length > 0
      ? tc.turns.map((s) => String(s ?? "").trim())
      : [tc.input_message?.trim() ?? ""];

  for (const ver of versions) {
    sections.push("");
    sections.push(`=== VERSION: ${ver.version_name} (id: ${ver.version_id}) ===`);
    for (let i = 0; i < ver.turns.length; i++) {
      const turn = ver.turns[i];
      sections.push(`--- Turn ${i + 1} ---`);
      sections.push(`User: ${userMessages[i] ?? "(no user message)"}`);
      sections.push(`Evren response: ${turn.response.join("\n") || "(empty)"}`);
      sections.push(`Detected flags: ${turn.detected_flags}`);
    }
  }

  if (evaluatorReason?.trim()) {
    sections.push("");
    sections.push("=== EVALUATOR ANALYSIS ===");
    sections.push(evaluatorReason.trim());
  }

  return sections.join("\n");
}

function truncateForPrompt(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…(truncated)`;
}

/** Build the user message for the session-level review summary drafter. */
export function buildSessionReviewSummaryDrafterUserMessage(args: {
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
  /** Baseline = first; remaining = newer builds to judge vs baseline. */
  versionEntries?: Array<{ version_id: string; version_name: string }>;
}): string {
  const sections: string[] = [];
  sections.push("=== SESSION ===");
  sections.push(`mode: ${args.sessionMode}`);
  if (args.sessionTitle?.trim()) {
    sections.push(`validation_report_title: ${truncateForPrompt(args.sessionTitle, 500)}`);
  }
  if (args.sessionSummary?.trim()) {
    sections.push("");
    sections.push("=== VALIDATION REPORT (markdown, excerpt) ===");
    sections.push(truncateForPrompt(args.sessionSummary, 12000));
  }

  const vers = args.versionEntries?.filter((v) => v.version_id) ?? [];
  if (args.sessionMode === "comparison" && vers.length === 1) {
    const only = vers[0]!;
    sections.push("");
    sections.push("=== VERSION ROLES (comparison) ===");
    sections.push(
      `Only **one** version is captured so far: ${only.version_name} (version_id=${only.version_id}).`
    );
    sections.push(
      "Treat this as a single-version session and make a tentative ship/hold/investigate **as if this version is the candidate to ship**. Do not mention baseline/challenger or future versions; just summarize what was exercised, what failed (themes), and what still needs confirmation before shipping."
    );
  } else if (args.sessionMode === "comparison" && vers.length >= 2) {
    const baseline = vers[0]!;
    const challengers = vers.slice(1);
    sections.push("");
    sections.push("=== VERSION ROLES (comparison) ===");
    sections.push(
      "Order is chronological in this session: the FIRST version is the baseline (e.g. production / old). Later versions are newer builds under evaluation."
    );
    sections.push(
      `Baseline: ${baseline.version_name} (version_id=${baseline.version_id})`
    );
    sections.push(
      `Challenger(s): ${challengers.map((c) => `${c.version_name} (${c.version_id})`).join("; ")}`
    );
    sections.push(
      "When populating cases_versions_tested, use version **names** (e.g. \"Version 1, Version 2\") — do not include raw UUID version_id values."
    );
    if (challengers.length >= 2) {
      sections.push(
        "Summarization task: (1) Using each row's comparison.tiers (tier 1 = best) and behavior_review, decide which CHALLENGER is strongest per case when they differ; aggregate across cases to name the **best new candidate** among challengers (or state a tie). (2) Frame the whole session summary around: is that **best new candidate** clearly better than the **baseline** enough to ship, or should we hold/investigate? Do not collapse v2 and v3 into one undifferentiated 'new' verdict without picking a best challenger when the data supports it."
      );
    } else {
      sections.push(
        "Summarization task: Frame goal, overall_finding, recommendation, and needs_confirmation around whether the **challenger** beats the **baseline** enough to ship, or hold/investigate — using comparison.tiers, behavior_review, and reasons."
      );
    }
  }

  sections.push("");
  sections.push("=== EVAL RESULTS (one object per test case) ===");
  const payload = args.evalRows.map((r) => {
    let comparisonSnippet: string | null = null;
    try {
      const raw = JSON.stringify(r.comparison ?? null);
      comparisonSnippet = raw.length > 6000 ? `${raw.slice(0, 6000)}…` : raw;
    } catch {
      comparisonSnippet = String(r.comparison ?? "null");
    }
    let behaviorSnippet: string | null = null;
    try {
      const raw = JSON.stringify(r.behavior_review ?? null);
      behaviorSnippet = raw.length > 8000 ? `${raw.slice(0, 8000)}…` : raw;
    } catch {
      behaviorSnippet = String(r.behavior_review ?? "null");
    }
    return {
      test_case_id: r.test_case_id,
      title: r.title,
      success: r.success,
      score: r.score,
      reason: r.reason ? truncateForPrompt(r.reason, 2500) : null,
      comparison: comparisonSnippet,
      behavior_review: behaviorSnippet,
    };
  });
  sections.push(JSON.stringify(payload, null, 2));

  sections.push("");
  sections.push("=== OUTPUT REQUIREMENT ===");
  if (args.sessionMode === "comparison") {
    sections.push(
      "Respond with one JSON object only. You MUST set overall_finding, trust_severity, and recommendation to non-null strings. Base them on comparison JSON, behavior_review, and reasons in each row — do not rely on the success boolean alone (it may be a placeholder in comparison mode)."
    );
    if (vers.length >= 2) {
      sections.push(
        "In **goal** and **needs_confirmation**, explicitly name baseline vs best challenger (or challenger tie) when multiple challengers exist. **recommendation** is tentative ship/hold/investigate for adopting the best new build vs keeping baseline."
      );
    }
  } else {
    const passed = args.evalRows.filter((r) => r.success).length;
    const total = args.evalRows.length;
    sections.push(
      `Respond with one JSON object only. You MUST set overall_finding, trust_severity, and recommendation to non-null strings. Evaluator outcomes: ${passed} / ${total} cases marked success.`
    );
  }

  return sections.join("\n");
}
