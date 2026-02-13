import * as XLSX from "xlsx";
import type { TestCase } from "./types";

/** Extract Google Sheet ID from share/edit link. */
export function getSheetIdFromLink(link: string): string {
  const match = link.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error(`Invalid Google Sheet link: ${link}`);
  return match[1];
}

/** Extract worksheet gid from link if present (e.g. #gid=123456). */
function getGidFromLink(link: string): string | undefined {
  const match = link.match(/[#&]gid=(\d+)/);
  return match ? match[1] : undefined;
}

/** Raw row from sheet (header keys from first row). */
export type SheetRow = Record<string, string>;

/**
 * Fetch sheet as CSV and return rows as objects.
 * Sheet must be "Published to web" (File > Share > Publish to web) or publicly viewable.
 */
export async function fetchSheetRows(
  googleSheetLink: string,
  options: { limit?: number; gid?: string } = {}
): Promise<SheetRow[]> {
  const sheetId = getSheetIdFromLink(googleSheetLink);
  const gid = options.gid ?? getGidFromLink(googleSheetLink) ?? "0";
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  console.log("[sheet] Fetching CSV from:", url);
  const res = await fetch(url, { cache: "no-store", redirect: "follow" });
  console.log("[sheet] Response:", res.status, res.statusText, "redirected:", res.redirected, "url:", res.url);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint =
      res.status === 404
        ? " Make sure the sheet is published to web: File → Share → Publish to web (and pick the correct tab)."
        : "";
    console.error("[sheet] Fetch failed:", res.status, res.statusText, body.slice(0, 500));
    throw new Error(`Failed to fetch sheet: ${res.status} ${res.statusText}.${hint} URL: ${url}`);
  }

  const csv = await res.text();
  console.log("[sheet] CSV length:", csv.length, "chars, first 200:", csv.slice(0, 200));
  const rows = parseCsvToRows(csv);
  const limit = options.limit ?? rows.length;
  return rows.slice(0, limit);
}

/**
 * Parse XLSX file buffer into array of row objects (first row = headers).
 * Uses first sheet only. Exported for XLSX upload.
 */
export function parseXlsxToRows(buffer: ArrayBuffer): SheetRow[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
  return rows.map((row) => {
    const out: SheetRow = {};
    for (const [k, v] of Object.entries(row)) {
      out[String(k).trim()] = v != null ? String(v).trim() : "";
    }
    return out;
  });
}

/** Parse CSV string into array of row objects (first line = headers). Exported for CSV upload. */
export function parseCsvToRows(csv: string): SheetRow[] {
  const raw = csv.replace(/^\uFEFF/, ""); // strip BOM if present
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^\uFEFF/, "").trim());
  const rows: SheetRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: SheetRow = {};
    headers.forEach((h, j) => {
      row[h] = values[j] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

/** Parse a single CSV line (handles quoted fields with commas). */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes) {
      current += c;
    } else if (c === ",") {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Map sheet column names to TestCase.
 * Override keys if your sheet uses different headers (e.g. "Input message" -> input_message).
 */
export const DEFAULT_SHEET_COLUMNS = {
  test_case_id: "test_case_id",
  title: "title",
  category: "category",
  input_message: "input_message",
  img_url: "img_url",
  context: "context",
  expected_state: "expected_state",
  expected_behavior: "expected_behavior",
  forbidden: "forbidden",
  notes: "notes",
  is_enabled: "is_enabled",
} as const;

/** Normalize header for matching: lowercase, collapse spaces to single underscore. */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Optional aliases: normalized sheet header -> our key (for flexible matching). */
const HEADER_ALIASES: Partial<Record<string, keyof typeof DEFAULT_SHEET_COLUMNS>> = {
  user_message: "input_message",
  message: "input_message",
  user_input: "input_message",
  input: "input_message",
  test_case_id: "test_case_id",
  id: "test_case_id",
  case_id: "test_case_id",
  name: "title",
  category_id: "category",
};

/** Get cell value from row by exact key or by normalized header match. */
function getCell(row: SheetRow, desiredKey: string): string {
  const key = desiredKey as keyof typeof DEFAULT_SHEET_COLUMNS;
  const exact = row[desiredKey] ?? row[DEFAULT_SHEET_COLUMNS[key]];
  if (exact !== undefined && exact !== "") return String(exact).trim();
  const normalized = normalizeHeader(desiredKey);
  for (const [header, value] of Object.entries(row)) {
    const n = normalizeHeader(header);
    const match = n === normalized || HEADER_ALIASES[n] === key;
    if (match && value != null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

export function sheetRowToTestCase(
  row: SheetRow,
  _columnMap?: Record<string, string>
): TestCase {
  const get = (key: keyof typeof DEFAULT_SHEET_COLUMNS) => getCell(row, key);

  const isEnabledRaw = get("is_enabled");
  const is_enabled = isEnabledRaw === "" || isEnabledRaw === undefined
    ? true
    : /^(1|true|yes|on)$/i.test(String(isEnabledRaw).trim());

  return {
    test_case_id: get("test_case_id"),
    title: get("title") || undefined,
    input_message: get("input_message"),
    img_url: get("img_url") || undefined,
    context: get("context") || undefined,
    expected_state: get("expected_state"),
    expected_behavior: get("expected_behavior"),
    forbidden: get("forbidden") || undefined,
    notes: get("notes") || undefined,
    is_enabled,
    category: get("category") || undefined,
  };
}
