"use client";

import Link from "next/link";

export default function ArchiveEvaluateOne() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/" className="text-sm text-stone-500 hover:text-stone-700">← Back</Link>
      <h1 className="mt-2 text-2xl font-semibold text-stone-900">Archive: Evaluate one</h1>
      <p className="mt-1 text-stone-600">
        Legacy flow: run Evren on a single test case and evaluate with Gemini (no DB). Use <strong>Test cases</strong> and <strong>Evaluate</strong> instead.
      </p>
    </div>
  );
}
