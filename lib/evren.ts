import type { TestCase, EvrenOutput } from "./types";

/** Path for the Evren evals endpoint (POST /evren-evals). */
const EVREN_EVALS_PATH = "/evren-evals";

/** Build the Evren API endpoint URL. Replaces localhost with 127.0.0.1 to avoid IPv6 issues.
 *  If the base URL has no path, appends EVREN_EVALS_PATH. */
function evrenEndpoint(input: string): string {
  let url = input.trim().replace(/\/+$/, "");
  url = url.replace(/\/\/localhost([:\/])/g, "//127.0.0.1$1");
  url = url.replace(/\/\/localhost$/, "//127.0.0.1");
  const parsed = new URL(url);
  const path = parsed.pathname;
  if (!path || path === "/") {
    parsed.pathname = EVREN_EVALS_PATH;
    return parsed.toString();
  }
  return url;
}

/**
 * Call Evren evals API (POST /evren-evals).
 * Request: { messages: string[], context?: string|object } — ordered list of user messages.
 * Response: { evren_responses: [{ response, detected_flags }, ...] } — one per message.
 * Single-turn = messages of length 1; multi-turn = multiple messages. One API call for both.
 */
export async function callEvrenApi(
  evrenModelApiUrl: string,
  testCase: TestCase
): Promise<EvrenOutput[]> {
  const messages: string[] =
    testCase.type === "multi_turn" && Array.isArray(testCase.turns) && testCase.turns.length > 0
      ? testCase.turns.map((s) => String(s ?? "").trim()).filter(Boolean)
      : [testCase.input_message?.trim() ?? ""].filter(Boolean);

  if (messages.length === 0) {
    return [{ evren_response: "", detected_states: "" }];
  }

  const body: Record<string, unknown> = { messages };
  if (testCase.context) {
    const ctx = testCase.context.trim();
    if (ctx.startsWith("{")) {
      try {
        body.context = JSON.parse(ctx);
      } catch {
        body.context = { description: ctx };
      }
    } else {
      body.context = ctx;
    }
  }

  const url = evrenEndpoint(evrenModelApiUrl);
  const evrenApiKey = process.env.EVREN_API_KEY;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (evrenApiKey) {
    headers["x-api-key"] = evrenApiKey;
  }
  console.log("[Evren API] request", { url, messages, messageCount: messages.length });
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (fetchErr) {
    const cause = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    const details =
      fetchErr instanceof Error && "cause" in fetchErr && fetchErr.cause instanceof Error
        ? ` (${fetchErr.cause.message})`
        : "";
    throw new Error(`Evren request to ${url} failed: ${cause}${details}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Evren API error: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const evrenResponses = data.evren_responses as Array<{ response?: string; detected_flags?: string }> | undefined;

  console.log("[Evren API] response", {
    evren_responsesCount: Array.isArray(evrenResponses) ? evrenResponses.length : 0,
    evren_responses: Array.isArray(evrenResponses)
      ? evrenResponses.map((r, i) => ({ turn: i + 1, response: r?.response ?? "", detected_flags: r?.detected_flags ?? "" }))
      : "(not an array)",
  });

  if (!Array.isArray(evrenResponses)) {
    return [{ evren_response: "", detected_states: "" }];
  }

  return evrenResponses.map((item) => ({
    evren_response: String(item?.response ?? ""),
    detected_states: String(item?.detected_flags ?? ""),
  }));
}
