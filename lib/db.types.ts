/**
 * Supabase DB types for Maibel Eval.
 *
 * Table names: Supabase/PostgREST usually exposes tables in lowercase.
 * If you created tables with double quotes ("USERS"), use .from('USERS') in code.
 * Column "manually edited" in SQL is here as manually_edited; if your DB has a space, use a view or alias.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface UsersRow {
  user_id: string;
  email: string;
  full_name: string | null;
  is_owner: boolean;
}

export interface TestSessionsRow {
  session_id: string;
  test_session_id: string;
  user_id: string;
  title: string | null;
  total_cost_usd: number | null;
  total_eval_time_seconds: number | null;
  summary: string | null;
  manually_edited: boolean;
}

/** One turn of Evren output within a version. */
export interface VersionTurn {
  response: string[];
  detected_flags: string;
}

/** One version stored in eval_results.evren_responses. */
export interface VersionEntry {
  version_id: string;
  version_name: string;
  turns: VersionTurn[];
}

export interface EvalResultsRow {
  eval_result_id: string;
  session_id: string;
  test_case_uuid: string;
  /** Array of version objects, each containing its own turns. */
  evren_responses: VersionEntry[];
  success: boolean;
  score: number;
  reason: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  manually_edited: boolean;
  /** Pairwise comparison data (champion-challenge results). */
  comparison: Json | null;
}

export interface CategoriesRow {
  category_id: string;
  name: string;
  deleted_at: string | null;
}

export interface TestCasesRow {
  id: string;
  test_case_id: string;
  title: string | null;
  category_id: string | null;
  type: "single_turn" | "multi_turn";
  input_message: string;
  img_url: string | null;
  /** Multi-turn: array of user inputs only, e.g. ["input 1", "input 2"]. */
  turns: string[] | null;
  expected_state: string;
  expected_behavior: string;
  forbidden: string | null;
  notes: string | null;
  is_enabled: boolean;
}

export interface DefaultSettingsRow {
  default_setting_id: string;
  evren_api_url: string | null;
  evaluator_model: string | null;
  evaluator_prompt: string | null;
  summarizer_model: string | null;
  summarizer_prompt: string | null;
}

/** Use this type when your DB has quoted table names (e.g. "USERS"). */
export interface Database {
  public: {
    Tables: {
      users: { Row: UsersRow; Insert: Omit<UsersRow, "user_id"> & { user_id?: string }; Update: Partial<UsersRow> };
      test_sessions: { Row: TestSessionsRow; Insert: Omit<TestSessionsRow, "session_id" | "test_session_id"> & { session_id?: string; test_session_id?: string }; Update: Partial<TestSessionsRow> };
      eval_results: { Row: EvalResultsRow; Insert: Omit<EvalResultsRow, "eval_result_id"> & { eval_result_id?: string }; Update: Partial<EvalResultsRow> };
      test_cases: { Row: TestCasesRow; Insert: Omit<TestCasesRow, "id" | "test_case_id"> & { id?: string; test_case_id?: string }; Update: Partial<TestCasesRow> };
      default_settings: { Row: DefaultSettingsRow; Insert: Omit<DefaultSettingsRow, "default_setting_id"> & { default_setting_id?: string }; Update: Partial<DefaultSettingsRow> };
      categories: { Row: CategoriesRow; Insert: Omit<CategoriesRow, "category_id"> & { category_id?: string }; Update: Partial<CategoriesRow> };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
