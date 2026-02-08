import type { TestCase, EvrenOutput } from "./types";

/**
 * Call Evren model API with test case input; returns response and detected flags.
 * Expects POST body: { input_message, context?, img_url? }
 * Expects response: { evren_response: string, detected_flags: string } or similar.
 */
export async function callEvrenApi(
  evrenModelApiUrl: string,
  testCase: TestCase
): Promise<EvrenOutput> {
  const body = {
    input_message: testCase.input_message,
    ...(testCase.context && { context: testCase.context }),
    ...(testCase.img_url && { img_url: testCase.img_url }),
  };

  const res = await fetch(evrenModelApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Evren API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  return {
    evren_response: String(data.evren_response ?? data.response ?? ""),
    detected_flags: String(data.detected_flags ?? data.flags ?? ""),
  };
}
