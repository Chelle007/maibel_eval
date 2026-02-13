"use client";

import { useEffect, useState } from "react";

type Category = { category_id: string; name: string };

type TestCase = {
  test_case_id: string;
  title: string | null;
  category_id: string | null;
  input_message: string;
  img_url: string | null;
  context: string | null;
  expected_flags: string;
  expected_behavior: string;
  forbidden: string | null;
};

const inputClass =
  "mt-1.5 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400";
const labelClass = "block text-sm font-medium text-stone-700";

export default function TestCasesPage() {
  const [list, setList] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TestCase | null>(null);
  const [uploading, setUploading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({
    test_case_id: "",
    title: "",
    category_id: "",
    input_message: "",
    img_url: "",
    context: "",
    expected_flags: "",
    expected_behavior: "",
    forbidden: "",
  });

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
      ? { ...form, title: form.title || null, category_id: form.category_id || null, img_url: form.img_url || null, context: form.context || null, forbidden: form.forbidden || null }
      : { ...form, test_case_id: form.test_case_id.trim(), title: form.title || null, category_id: form.category_id || null, img_url: form.img_url || null, context: form.context || null, forbidden: form.forbidden || null };
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
        setForm({ test_case_id: "", title: "", category_id: "", input_message: "", img_url: "", context: "", expected_flags: "", expected_behavior: "", forbidden: "" });
        load();
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

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    file
      .text()
      .then((csv) =>
        fetch("/api/test-cases/upload", {
          method: "POST",
          headers: { "Content-Type": "text/csv" },
          body: csv,
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
          <p className="mt-0.5 text-sm text-stone-500">Add, edit, delete, or bulk upload via CSV.</p>
        </div>
        <div className="flex gap-3">
          <label className="cursor-pointer rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 hover:shadow">
            {uploading ? "Uploading…" : "Upload CSV"}
            <input type="file" accept=".csv" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setForm({ test_case_id: "", title: "", category_id: "", input_message: "", img_url: "", context: "", expected_flags: "", expected_behavior: "", forbidden: "" });
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
              <label className={labelClass}>Expected flags *</label>
              <textarea rows={3} required value={form.expected_flags} onChange={(e) => setForm((f) => ({ ...f, expected_flags: e.target.value }))} className={inputClass} />
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
          No test cases yet. Add one above or upload a CSV.
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {list.map((tc) => (
            <li key={tc.test_case_id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-stone-400">{tc.test_case_id}{tc.title ? ` · ${tc.title}` : ""}{tc.category_id ? ` · ${categories.find((c) => c.category_id === tc.category_id)?.name ?? "Category"}` : ""}</p>
                  <p className="mt-1 text-sm font-medium text-stone-800">{tc.input_message.slice(0, 120)}{tc.input_message.length > 120 ? "…" : ""}</p>
                  <p className="mt-1 text-xs text-stone-500">Expected: {tc.expected_flags} · {tc.expected_behavior}</p>
                </div>
                <div className="flex shrink-0 gap-2">
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
                        expected_flags: tc.expected_flags,
                        expected_behavior: tc.expected_behavior,
                        forbidden: tc.forbidden ?? "",
                      });
                      setEditing(tc);
                      setShowForm(true);
                    }}
                    className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(tc)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
