import type { TestCase } from "./types";

/** Extract Google Sheet ID from share/edit link. */
export function getSheetIdFromLink(link: string): string {
  const match = link.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error(`Invalid Google Sheet link: ${link}`);
  return match[1];
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
  const gid = options.gid ?? "0";
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch sheet: ${res.status} ${res.statusText}`);

  const csv = await res.text();
  const rows = parseCsvToRows(csv);
  const limit = options.limit ?? rows.length;
  return rows.slice(0, limit);
}

/** Parse CSV string into array of row objects (first line = headers). */
function parseCsvToRows(csv: string): SheetRow[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
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
  input_message: "input_message",
  img_url: "img_url",
  context: "context",
  expected_flags: "expected_flags",
  expected_behavior: "expected_behavior",
  forbidden: "forbidden",
} as const;

export function sheetRowToTestCase(
  row: SheetRow,
  columnMap: Record<string, string> = DEFAULT_SHEET_COLUMNS
): TestCase {
  const get = (key: keyof typeof DEFAULT_SHEET_COLUMNS) =>
    row[columnMap[key]] ?? row[key] ?? "";

  return {
    test_case_id: get("test_case_id"),
    input_message: get("input_message"),
    img_url: get("img_url") || undefined,
    context: get("context") || undefined,
    expected_flags: get("expected_flags"),
    expected_behavior: get("expected_behavior"),
    forbidden: get("forbidden") || undefined,
  };
}
