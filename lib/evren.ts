import type { TestCase, EvrenOutput } from "./types";

/** Path for the Evren eval endpoint (POST /evren-eval). */
const EVREN_EVAL_PATH = "/evren-eval";

function evrenBaseUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, "");
  url = url.replace(/\/\/localhost([:\/])/g, "//127.0.0.1$1");
  url = url.replace(/\/\/localhost$/, "//127.0.0.1");
  const parsed = new URL(url);
  if (parsed.pathname === EVREN_EVAL_PATH) {
    parsed.pathname = "/";
  }
  return parsed.toString().replace(/\/+$/, "");
}

/** Build the Evren API endpoint URL. Replaces localhost with 127.0.0.1 to avoid IPv6 issues.
 *  If the base URL has no path, appends EVREN_EVAL_PATH. */
function evrenEndpoint(input: string): string {
  let url = input.trim().replace(/\/+$/, "");
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

function formatEvrenCodeSource(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw.trim().slice(0, 1000) || null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const branch = typeof obj.branch === "string" ? obj.branch.trim() : "";
  const commitShort =
    typeof obj.commit_short === "string"
      ? obj.commit_short.trim()
      : typeof obj.git_commit_short === "string"
        ? obj.git_commit_short.trim()
        : "";
  const commitSha =
    typeof obj.commit_sha === "string"
      ? obj.commit_sha.trim()
      : typeof obj.git_commit_sha === "string"
        ? obj.git_commit_sha.trim()
        : "";
  const image = typeof obj.image === "string" ? obj.image.trim() : typeof obj.image_tag === "string" ? obj.image_tag.trim() : "";
  const buildId = typeof obj.build_id === "string" ? obj.build_id.trim() : "";

  const shortSha = commitShort || (commitSha ? commitSha.slice(0, 7) : "");
  const head = branch && shortSha ? `${branch} @ ${shortSha}` : shortSha || branch;
  const extras = [image, buildId].filter(Boolean);
  const full = [head, ...extras].filter(Boolean).join(" · ");
  return full.trim().slice(0, 1000) || null;
}

/**
 * Fetch Evren's own code provenance from its API (best-effort).
 * Expected response: { code_source: string | { branch, commit_sha/short, image, build_id, ... } }
 * Never throws — returns null when unavailable.
 */
export async function fetchEvrenCodeSource(evrenModelApiUrl: string): Promise<string | null> {
  const base = evrenBaseUrl(evrenModelApiUrl);
  const headers: Record<string, string> = { Accept: "application/json" };
  const evrenApiKey = process.env.EVREN_API_KEY;
  if (evrenApiKey) headers["x-api-key"] = evrenApiKey;

  const overridePath = process.env.EVREN_META_PATH?.trim();
  const candidates = [
    overridePath ? `${base}${overridePath.startsWith("/") ? "" : "/"}${overridePath}` : null,
    `${base}/meta`,
    `${base}/metadata`,
    `${base}/provenance`,
    `${base}/info`,
  ].filter((x): x is string => Boolean(x));

  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "GET", headers });
      if (!res.ok) continue;
      const data = (await res.json().catch(() => null)) as any;
      const direct = formatEvrenCodeSource(data?.code_source ?? data?.codeSource ?? null);
      if (direct) return direct;
      // Some implementations may inline fields at top-level.
      const topLevel = formatEvrenCodeSource(data);
      if (topLevel) return topLevel;
    } catch {
      /* ignore and try next candidate */
    }
  }
  return null;
}

/**
 * Call Evren eval API (POST /evren-eval).
 * Request: { messages: string[] } — ordered list of user messages.
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
  const evrenResponses = data.evren_responses as Array<{ response?: string | string[]; detected_flags?: string }> | undefined;

  console.log("[Evren API] raw response:", JSON.stringify(data, null, 2));

  if (!Array.isArray(evrenResponses)) {
    return [{ evren_response: "", detected_states: "" }];
  }

  return evrenResponses.map((item) => ({
    evren_response: item?.response ?? "",
    detected_states: String(item?.detected_flags ?? ""),
  }));
}
