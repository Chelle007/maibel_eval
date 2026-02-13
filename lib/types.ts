/** Input test case (from sheet) for one evaluation. */
export interface TestCase {
  test_case_id: string;
  title?: string;
  input_message: string;
  img_url?: string;
  context?: string;
  expected_flags: string;
  expected_behavior: string;
  forbidden?: string;
}

/** Evren model output for one test case. */
export interface EvrenOutput {
  evren_response: string;
  detected_states: string;
}

/** Payload sent to the evaluator: one test case + Evren's output. */
export interface EvaluateInput {
  test_case: TestCase;
  evren_output: EvrenOutput;
}

/** Token usage and cost for one evaluation call. */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

/** Evaluation result from Gemini (must match evaluator prompt JSON). */
export interface EvaluationResult {
  test_case_id: string;
  success: boolean;
  score: number;
  flags_detected: string;
  reason: string;
  /** Set when token usage is tracked (e.g. from Gemini usageMetadata). */
  token_usage?: TokenUsage;
}
