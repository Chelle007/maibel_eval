import type { TestCase, EvrenOutput } from "./types";

/** Build the Evren API endpoint URL. Also replaces localhost with 127.0.0.1
 *  to avoid IPv6 resolution issues in Node.js server-side fetch. */
function evrenEndpoint(input: string): string {
  let url = input.trim().replace(/\/+$/, "");
  // Node.js may resolve "localhost" to ::1 (IPv6) which often fails
  url = url.replace(/\/\/localhost([:\/])/g, "//127.0.0.1$1");
  url = url.replace(/\/\/localhost$/, "//127.0.0.1");
  if (!url.endsWith("/evren") && !url.endsWith("/evren/")) {
    url = `${url}/evren`;
  }
  return url;
}

/**
 * Call Evren model API: POST /evren with input_message, optional img_url and context.
 * Returns evren_response and detected_states (from API's detected_flags).
 *
 * Example: if Evren is running at http://localhost:8000 (uvicorn main:app --reload --host 0.0.0.0 --port 8000),
 * pass evrenModelApiUrl = "http://localhost:8000" and we request POST http://localhost:8000/evren.
 */
export async function callEvrenApi(
  evrenModelApiUrl: string,
  testCase: TestCase
): Promise<EvrenOutput> {
  const body: Record<string, unknown> = {
    input_message: testCase.input_message,
  };
  if (testCase.img_url) body.img_url = testCase.img_url;
  if (testCase.context) {
    // Evren API expects context as an object, not a string.
    // If the sheet has JSON, parse it; otherwise wrap it.
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
  return {
    evren_response: String(data.evren_response ?? ""),
    detected_states: String(data.detected_flags ?? ""),
  };
}
