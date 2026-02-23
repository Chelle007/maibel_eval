import type { TestCase, EvrenOutput } from "./types";

/** Path for the Evren eval endpoint (POST only). Server returns 405 if called with GET. */
const EVREN_EVAL_PATH = "/evren-eval";

/** Build the Evren API endpoint URL. Also replaces localhost with 127.0.0.1
 *  to avoid IPv6 resolution issues in Node.js server-side fetch.
 *  If the base URL has no path (e.g. http://localhost:8000), appends EVREN_EVAL_PATH
 *  so the request goes to POST /evren-eval, not to the root (which would 405). */
function evrenEndpoint(input: string): string {
  let url = input.trim().replace(/\/+$/, "");
  // Node.js may resolve "localhost" to ::1 (IPv6) which often fails
  url = url.replace(/\/\/localhost([:\/])/g, "//127.0.0.1$1");
  url = url.replace(/\/\/localhost$/, "//127.0.0.1");
  const parsed = new URL(url);
  const path = parsed.pathname;
  if (!path || path === "/") {
    parsed.pathname = EVREN_EVAL_PATH;
    return parsed.toString();
  }
  return url;
}

/**
 * Call Evren model API with POST and JSON body.
 * Single-turn: one call, returns array of one EvrenOutput.
 * Multi-turn: one call per input, returns array of EvrenOutput (one per turn).
 * Each item has evren_response and detected_states (from API's detected_flags).
 */
export async function callEvrenApi(
  evrenModelApiUrl: string,
  testCase: TestCase
): Promise<EvrenOutput[]> {
  const isMultiTurn = testCase.type === "multi_turn" && Array.isArray(testCase.turns) && testCase.turns.length > 0;

  if (isMultiTurn) {
    const inputs = testCase.turns!;
    const messages: { role: "user" | "assistant"; content: string }[] = [];
    const outputs: EvrenOutput[] = [];
    const url = evrenEndpoint(evrenModelApiUrl);

    for (const input of inputs) {
      const content = String(input ?? "").trim();
      if (!content) continue;
      messages.push({ role: "user", content });

      const body: Record<string, unknown> = { messages: [...messages] };
      if (testCase.context) {
        const ctx = testCase.context.trim();
        if (ctx.startsWith("{")) {
          try {
            body.context = JSON.parse(ctx);
          } catch {
            body.context = { description: ctx };
          }
        } else {
          body.context = { description: ctx };
        }
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Evren API error: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      const out: EvrenOutput = {
        evren_response: String(data.evren_response ?? ""),
        detected_states: String(data.detected_flags ?? ""),
      };
      outputs.push(out);
      messages.push({ role: "assistant", content: out.evren_response });
    }
    return outputs;
  }

  const body: Record<string, unknown> = {
    input_message: testCase.input_message,
  };
  if (testCase.img_url) body.img_url = testCase.img_url;
  if (testCase.context) {
    const ctx = testCase.context.trim();
    if (ctx.startsWith("{")) {
      try {
        body.context = JSON.parse(ctx);
      } catch {
        body.context = { description: ctx };
      }
    } else {
      body.context = { description: ctx };
    }
  }

  const url = evrenEndpoint(evrenModelApiUrl);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Evren API error: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return [
    {
      evren_response: String(data.evren_response ?? ""),
      detected_states: String(data.detected_flags ?? ""),
    },
  ];
}
