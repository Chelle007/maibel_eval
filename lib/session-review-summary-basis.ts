/** One eval row’s comparison payload for basis fingerprinting. */
export type ComparisonBasisRow = { eval_result_id: string; comparison: unknown };

function normalizeEvalResultId(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

/** Stable ordering and shape for hashing (matches server + client). */
export function rowsToComparisonBasisRows(
  rows: Array<{ eval_result_id?: unknown; comparison?: unknown }>
): ComparisonBasisRow[] {
  const out: ComparisonBasisRow[] = [];
  for (const r of rows) {
    const eval_result_id = normalizeEvalResultId(r.eval_result_id);
    if (!eval_result_id) continue;
    out.push({ eval_result_id, comparison: r.comparison ?? null });
  }
  out.sort((a, b) => a.eval_result_id.localeCompare(b.eval_result_id, undefined, { numeric: true }));
  return out;
}

export function serializeComparisonBasis(rows: ComparisonBasisRow[]): string {
  return JSON.stringify(rows.map((r) => [r.eval_result_id, r.comparison]));
}

/** FNV-1a 32-bit — pure JS, identical in Node and browser. */
export function hashComparisonBasis(serialized: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < serialized.length; i++) {
    h ^= serialized.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintEvalResultsComparisons(
  rows: Array<{ eval_result_id?: unknown; comparison?: unknown }>
): string {
  const basis = rowsToComparisonBasisRows(rows);
  return hashComparisonBasis(serializeComparisonBasis(basis));
}
