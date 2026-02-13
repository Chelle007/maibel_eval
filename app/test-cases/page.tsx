"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Category = { category_id: string; name: string };

type TestCase = {
  test_case_id: string;
  title: string | null;
  category_id: string | null;
  input_message: string;
  img_url: string | null;
  context: string | null;
  expected_states: string;
  expected_behavior: string;
  forbidden: string | null;
  is_enabled?: boolean;
};

const inputClass =
  "mt-1.5 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400";
const labelClass = "block text-sm font-medium text-stone-700";

function matchSearch(tc: TestCase, q: string): boolean {
  if (!q.trim()) return true;
  const lower = q.trim().toLowerCase();
  const fields = [
    tc.test_case_id,
    tc.title ?? "",
    tc.input_message,
    tc.expected_states,
    tc.expected_behavior,
    tc.forbidden ?? "",
  ].map((s) => s.toLowerCase());
  return fields.some((s) => s.includes(lower));
}

export default function TestCasesPage() {
  const [list, setList] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TestCase | null>(null);
  const [uploading, setUploading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState({
    test_case_id: "",
    title: "",
    category_id: "",
    input_message: "",
    img_url: "",
    context: "",
    expected_states: "",
    expected_behavior: "",
    forbidden: "",
    is_enabled: true,
  });

  const filteredList = useMemo(() => {
    return list.filter((tc) => {
      if (!matchSearch(tc, searchQuery)) return false;
      if (categoryFilter && tc.category_id !== categoryFilter) return false;
      return true;
    });
  }, [list, searchQuery, categoryFilter]);

  const filteredIds = useMemo(() => new Set(filteredList.map((tc) => tc.test_case_id)), [filteredList]);
  const allFilteredSelected = filteredList.length > 0 && filteredList.every((tc) => selectedIds.has(tc.test_case_id));
  const someFilteredSelected = filteredList.some((tc) => selectedIds.has(tc.test_case_id));

  useEffect(() => {
    const el = selectAllRef.current;
    if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
  }, [someFilteredSelected, allFilteredSelected]);

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...filteredIds]));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function load() {
    setLoading(true);
    fetch("/api/test-cases")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setList(Array.isArray(data) ? data : []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]));
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const url = editing ? `/api/test-cases/${editing.test_case_id}` : "/api/test-cases";
    const method = editing ? "PATCH" : "POST";
    const body = editing
      ? { ...form, title: form.title || null, category_id: form.category_id || null, img_url: form.img_url || null, context: form.context || null, forbidden: form.forbidden || null, is_enabled: form.is_enabled }
      : { ...form, test_case_id: form.test_case_id.trim(), title: form.title || null, category_id: form.category_id || null, img_url: form.img_url || null, context: form.context || null, forbidden: form.forbidden || null, is_enabled: form.is_enabled };
    fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setShowForm(false);
        setEditing(null);
        setForm({ test_case_id: "", title: "", category_id: "", input_message: "", img_url: "", context: "", expected_states: "", expected_behavior: "", forbidden: "", is_enabled: true });
        load();
      })
      .catch((e) => setError(e.message));
  }

  function handleToggleEnabled(tc: TestCase) {
    setError(null);
    const next = !(tc.is_enabled !== false);
    fetch(`/api/test-cases/${tc.test_case_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_enabled: next }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setList((prev) =>
          prev.map((t) => (t.test_case_id === tc.test_case_id ? { ...t, is_enabled: next } : t))
        );
      })
      .catch((e) => setError(e.message));
  }

  function handleDelete(tc: TestCase) {
    if (!confirm("Delete this test case?")) return;
    setError(null);
    fetch(`/api/test-cases/${tc.test_case_id}`, { method: "DELETE" })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        load();
      })
      .catch((e) => setError(e.message));
  }

  function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected test case(s)?`)) return;
    setError(null);
    Promise.all(
      Array.from(selectedIds).map((id) =>
        fetch(`/api/test-cases/${id}`, { method: "DELETE" }).then((r) => r.json())
      )
    )
      .then((results) => {
        const err = results.find((r) => r?.error);
        if (err) throw new Error(err.error);
        setSelectedIds(new Set());
        load();
      })
      .catch((e) => setError(e.message));
  }

  function handleBulkSetEnabled(enabled: boolean) {
    if (selectedIds.size === 0) return;
    setError(null);
    Promise.all(
      Array.from(selectedIds).map((id) =>
        fetch(`/api/test-cases/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_enabled: enabled }),
        }).then((r) => r.json())
      )
    )
      .then((results) => {
        const err = results.find((r) => r?.error);
        if (err) throw new Error(err.error);
        setList((prev) =>
          prev.map((t) => (selectedIds.has(t.test_case_id) ? { ...t, is_enabled: enabled } : t))
        );
        setSelectedIds(new Set());
      })
      .catch((e) => setError(e.message));
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    file
      .arrayBuffer()
      .then((buffer) =>
        fetch("/api/test-cases/upload", {
          method: "POST",
          headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
          body: buffer,
        })
      )
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        load();
        e.target.value = "";
      })
      .catch((err) => setError(err.message))
      .finally(() => setUploading(false));
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">Test cases</h1>
          <p className="mt-0.5 text-sm text-stone-500">Add, edit, delete, or bulk upload via Excel (.xlsx).</p>
        </div>
        <div className="flex gap-3">
          <label className="cursor-pointer rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 hover:shadow">
            {uploading ? "Uploading…" : "Upload XLSX"}
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setForm({ test_case_id: "", title: "", category_id: "", input_message: "", img_url: "", context: "", expected_states: "", expected_behavior: "", forbidden: "", is_enabled: true });
              setShowForm(true);
            }}
            className="rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800"
          >
            Add test case
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {!loading && list.length > 0 && (
        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by ID, title, message, expected…"
                className="block w-full rounded-lg border border-stone-200 bg-stone-50/50 py-2 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-stone-200 bg-stone-50/50 px-3 py-2 text-sm text-stone-700 focus:border-stone-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.category_id} value={c.category_id}>
                  {c.name}
                </option>
              ))}
            </select>
            {!allFilteredSelected && (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/50 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-400"
                />
                Select all {filteredList.length > 0 ? `(${filteredList.length})` : ""}
              </label>
            )}
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
              >
                Clear selection ({selectedIds.size})
              </button>
            )}
          </div>
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-3">
              <button
                type="button"
                onClick={handleBulkDelete}
                className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Delete selected ({selectedIds.size})
              </button>
              <button
                type="button"
                onClick={() => handleBulkSetEnabled(false)}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
              >
                Disable selected ({selectedIds.size})
              </button>
              <button
                type="button"
                onClick={() => handleBulkSetEnabled(true)}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
              >
                Enable selected ({selectedIds.size})
              </button>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="mt-6 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-stone-900">{editing ? "Edit" : "New"} test case</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className={labelClass}>Test case ID</label>
              <input
                type="text"
                value={form.test_case_id}
                onChange={(e) => setForm((f) => ({ ...f, test_case_id: e.target.value }))}
                className={inputClass}
                placeholder="e.g. P0_001"
                required={!editing}
                disabled={!!editing}
              />
              {editing && <p className="mt-1 text-xs text-stone-400">ID cannot be changed when editing.</p>}
            </div>
            <div>
              <label className={labelClass}>Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className={inputClass}
                placeholder="Short description of the test case"
              />
            </div>
            <div>
              <label className={labelClass}>Category</label>
              <select
                value={form.category_id}
                onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
                className={inputClass}
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="form-is-enabled"
                checked={form.is_enabled}
                onChange={(e) => setForm((f) => ({ ...f, is_enabled: e.target.checked }))}
                className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-400"
              />
              <label htmlFor="form-is-enabled" className="text-sm font-medium text-stone-700">
                Include in evaluation (only enabled test cases are run when you start evaluate)
              </label>
            </div>

            <hr className="border-stone-200" />

            <div>
              <label className={labelClass}>Input message *</label>
              <textarea rows={3} required value={form.input_message} onChange={(e) => setForm((f) => ({ ...f, input_message: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Img URL</label>
              <input type="url" value={form.img_url} onChange={(e) => setForm((f) => ({ ...f, img_url: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Context</label>
              <textarea rows={2} value={form.context} onChange={(e) => setForm((f) => ({ ...f, context: e.target.value }))} className={inputClass} />
            </div>

            <hr className="border-stone-200" />

            <div>
              <label className={labelClass}>Expected states *</label>
              <textarea rows={3} required value={form.expected_states} onChange={(e) => setForm((f) => ({ ...f, expected_states: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Expected behavior *</label>
              <textarea rows={2} required value={form.expected_behavior} onChange={(e) => setForm((f) => ({ ...f, expected_behavior: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Forbidden</label>
              <textarea rows={3} value={form.forbidden} onChange={(e) => setForm((f) => ({ ...f, forbidden: e.target.value }))} className={inputClass} />
            </div>
          </div>
          <div className="mt-5 flex gap-3">
            <button type="submit" className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800">
              {editing ? "Save" : "Create"}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="mt-8 text-stone-500">Loading…</p>
      ) : list.length === 0 ? (
        <div className="mt-8 rounded-xl border border-stone-200 bg-white p-8 text-center text-stone-500">
          No test cases yet. Add one above or upload an Excel (.xlsx) file.
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {filteredList.length === 0 ? (
            <li className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500">
              No test cases match your search or category filter.
            </li>
          ) : (
            filteredList.map((tc) => (
            <li key={tc.test_case_id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <label className="flex shrink-0 cursor-pointer items-start pt-0.5">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(tc.test_case_id)}
                    onChange={() => toggleSelect(tc.test_case_id)}
                    className="mt-1 h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-400"
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-stone-400 flex flex-wrap items-center gap-2">
                    {tc.category_id ? (
                      <span className="inline-flex items-center rounded bg-stone-200 px-1.5 py-0.5 text-xs font-medium text-stone-700 shrink-0">
                        {categories.find((c) => c.category_id === tc.category_id)?.name ?? "Category"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-500 shrink-0">No category</span>
                    )}
                    <span>{tc.test_case_id}{tc.title ? ` · ${tc.title}` : ""}</span>
                  </p>
                  <p className="mt-1 text-sm font-medium text-stone-800">{tc.input_message.slice(0, 120)}{tc.input_message.length > 120 ? "…" : ""}</p>
                  <p className="mt-1 text-xs text-stone-500">Expected: {tc.expected_states} | {tc.expected_behavior}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={tc.is_enabled !== false}
                    onClick={() => handleToggleEnabled(tc)}
                    title={tc.is_enabled !== false ? "Enabled for evaluation (click to disable)" : "Disabled for evaluation (click to enable)"}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                      tc.is_enabled !== false ? "bg-emerald-500" : "bg-stone-300"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                        tc.is_enabled !== false ? "translate-x-5" : "translate-x-0.5"
                      }`}
                      aria-hidden
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                        setForm({
                        test_case_id: tc.test_case_id,
                        title: tc.title ?? "",
                        category_id: tc.category_id ?? "",
                        input_message: tc.input_message,
                        img_url: tc.img_url ?? "",
                        context: tc.context ?? "",
                        expected_states: tc.expected_states,
                        expected_behavior: tc.expected_behavior,
                        forbidden: tc.forbidden ?? "",
                        is_enabled: tc.is_enabled !== false,
                      });
                      setEditing(tc);
                      setShowForm(true);
                    }}
                    title="Edit"
                    aria-label="Edit test case"
                    className="rounded-lg border border-stone-200 p-2 text-stone-600 hover:bg-stone-50"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(tc)}
                    title="Delete"
                    aria-label="Delete test case"
                    className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
