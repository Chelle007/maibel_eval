import { readFileSync } from "fs";
import path from "path";
import crypto from "crypto";

export type ContextPack = {
  text: string;
  bundleId: string;
};

const MD_DIR = path.join(process.cwd(), "context", "md-files");
const MANIFEST_PATH = path.join(MD_DIR, "CONTEXT_PACK_MANIFEST.md");

const APPROX_CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_CONTEXT_TOKENS = {
  evaluator: 2400,
  comparator: 2400,
} as const;

function sha12(body: string): string {
  return crypto.createHash("sha256").update(body, "utf8").digest("hex").slice(0, 12);
}

function isTruthyLine(s: string): boolean {
  return s.trim().length > 0;
}

function parseAllowlistSection(manifest: string, header: string): string[] {
  const lines = manifest.split("\n");
  const idx = lines.findIndex((l) => l.trim().toLowerCase() === header.trim().toLowerCase());
  if (idx < 0) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (t.startsWith("## ")) break;
    const m = t.match(/^-+\s+`([^`]+)`\s*$/) ?? t.match(/^-+\s+(.+)\s*$/);
    if (!m) continue;
    const filename = m[1].trim();
    if (filename && !filename.includes("..") && !filename.includes("/") && filename.endsWith(".md")) {
      out.push(filename);
    }
  }
  return out;
}

function readMarkdownFile(filename: string): string {
  return readFileSync(path.join(MD_DIR, filename), "utf8").trim();
}

type Chunk = { filename: string; heading: string; text: string };

function splitIntoChunks(filename: string, body: string): Chunk[] {
  const lines = body.split("\n");
  const chunks: Chunk[] = [];
  let currentHeading = "Preamble";
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) chunks.push({ filename, heading: currentHeading, text });
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(/^(#{2,3})\s+(.*)\s*$/);
    if (m) {
      flush();
      currentHeading = m[2].trim() || currentHeading;
      buf.push(line);
      continue;
    }
    buf.push(line);
  }
  flush();
  if (chunks.length === 0) chunks.push({ filename, heading: "Full", text: body.trim() });
  return chunks;
}

function keywordsFromQuery(query: string): string[] {
  const raw = String(query ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "your", "you", "are", "was", "were"]);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of raw) {
    if (w.length < 4) continue;
    if (stop.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 40) break;
  }
  return out;
}

function scoreChunk(chunk: Chunk, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const hay = chunk.text.toLowerCase();
  let score = 0;
  for (const k of keywords) {
    if (hay.includes(k)) score += 1;
  }
  const len = Math.max(1, chunk.text.length);
  return score + Math.min(1, score) * (2000 / len);
}

function formatChunk(chunk: Chunk): string {
  const header = `--- ${chunk.filename} :: ${chunk.heading} ---`;
  return `${header}\n${chunk.text.trim()}`;
}

function buildRetrievedText(args: {
  title: string;
  chunks: Chunk[];
  keywords: string[];
  maxChars: number;
}): string {
  const { title, chunks, keywords, maxChars } = args;
  const ranked = chunks
    .map((c) => ({ c, s: scoreChunk(c, keywords) }))
    .sort((a, b) => b.s - a.s);

  const out: string[] = [];
  out.push(`=== ${title} ===`);

  let used = out.join("\n").length;
  for (const { c } of ranked) {
    const formatted = formatChunk(c);
    const addLen = (out.length ? 2 : 0) + formatted.length;
    if (used + addLen > maxChars) continue;
    out.push("");
    out.push(formatted);
    used += addLen;
    if (out.length > 8 && used > maxChars * 0.9) break;
  }

  return out.join("\n").trim();
}

/**
 * Load organization context pack from the core allowlist in CONTEXT_PACK_MANIFEST.md.
 * bundleId is a stable fingerprint of the core allowlisted source files (not the retrieved subset).
 */
export function loadContextPack(args?: {
  purpose?: "evaluator" | "comparator";
  query?: string;
  maxContextTokens?: number;
}): ContextPack {
  const purpose = args?.purpose ?? "evaluator";
  const query = String(args?.query ?? "").trim();
  const maxTokens = Number.isFinite(args?.maxContextTokens)
    ? Math.max(50, Math.floor(args!.maxContextTokens as number))
    : DEFAULT_MAX_CONTEXT_TOKENS[purpose];
  const maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;

  const manifestRaw = readFileSync(MANIFEST_PATH, "utf8");
  const coreFiles = parseAllowlistSection(manifestRaw, "## Core allowlist");

  if (coreFiles.length === 0) {
    throw new Error("CONTEXT_PACK_MANIFEST.md missing '## Core allowlist' entries");
  }

  const sourceParts: string[] = [];
  for (const f of coreFiles) sourceParts.push(`--- ${f} ---\n${readMarkdownFile(f)}`);
  const sourceBundleId = sha12(sourceParts.join("\n\n").trim());

  const keywords = keywordsFromQuery(query);
  const coreChunks: Chunk[] = coreFiles.flatMap((f) => splitIntoChunks(f, readMarkdownFile(f)));

  const provenanceLines = [
    `Source: context/md-files/CONTEXT_PACK_MANIFEST.md`,
    `Core files: ${coreFiles.join(", ")}`,
    `bundle: ${sourceBundleId}`,
    ``,
  ];
  const provenanceHeader = provenanceLines.join("\n");
  const provenanceLen = provenanceHeader.length;

  const retrievedCore = buildRetrievedText({
    title: "ORGANIZATION CONTEXT (core)",
    chunks: coreChunks,
    keywords,
    maxChars: maxChars - provenanceLen,
  });

  const injected = `${provenanceHeader}${retrievedCore}`.trim();

  if (!isTruthyLine(injected)) {
    throw new Error("Context pack resolved to empty text");
  }

  return {
    text: injected,
    bundleId: sourceBundleId,
  };
}
