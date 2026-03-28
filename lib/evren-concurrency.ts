const DEFAULT_MAX_INFLIGHT_EVREN_CALLS = 10;

export function getMaxInflightEvrenCalls(): number {
  const raw = process.env.MAX_INFLIGHT_EVREN_CALLS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_INFLIGHT_EVREN_CALLS;
}

export function getMaxConcurrentTestCases(runCount: number): number {
  const safeRunCount = Number.isFinite(runCount) && runCount > 0 ? runCount : 1;
  return Math.max(1, Math.floor(getMaxInflightEvrenCalls() / safeRunCount));
}

export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  const safeLimit = Math.max(1, Math.floor(limit || 1));
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });

  await Promise.all(runners);
}
