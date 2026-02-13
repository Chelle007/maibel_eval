"use client";

import { useEffect, useState } from "react";

const inputClass =
  "mt-1.5 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400";
const labelClass = "block text-sm font-medium text-stone-700";
const cardClass = "rounded-xl border border-stone-200 bg-white p-6 shadow-sm";

type DefaultSettings = {
  evren_api_url: string | null;
  evaluator_model: string | null;
  evaluator_prompt: string | null;
  summarizer_model: string | null;
  summarizer_prompt: string | null;
};

type Category = { category_id: string; name: string; deleted_at?: string | null };

export default function SettingsPage() {
  const [settings, setSettings] = useState<DefaultSettings>({
    evren_api_url: null,
    evaluator_model: null,
    evaluator_prompt: null,
    summarizer_model: null,
    summarizer_prompt: null,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [categoryMessage, setCategoryMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/default-settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) return;
        setSettings({
          evren_api_url: data.evren_api_url ?? "",
          evaluator_model: data.evaluator_model ?? "",
          evaluator_prompt: data.evaluator_prompt ?? "",
          summarizer_model: data.summarizer_model ?? "",
          summarizer_prompt: data.summarizer_prompt ?? "",
        });
      })
      .finally(() => setSettingsLoaded(true));
  }, []);

  function loadCategories() {
    setCategoriesLoading(true);
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setCategories(Array.isArray(data) ? data : []);
      })
      .catch((e) => setCategoryMessage({ type: "err", text: e.message }))
      .finally(() => setCategoriesLoading(false));
  }

  useEffect(() => {
    loadCategories();
  }, []);

  function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSettingsMessage(null);
    setSettingsSaving(true);
    fetch("/api/default-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        evren_api_url: settings.evren_api_url || null,
        evaluator_model: settings.evaluator_model || null,
        evaluator_prompt: settings.evaluator_prompt || null,
        summarizer_model: settings.summarizer_model || null,
        summarizer_prompt: settings.summarizer_prompt || null,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSettingsMessage({ type: "ok", text: "Saved." });
      })
      .catch((e) => setSettingsMessage({ type: "err", text: e.message }))
      .finally(() => setSettingsSaving(false));
  }

  function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    setCategoryMessage(null);
    setAddingCategory(true);
    fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setNewCategoryName("");
        loadCategories();
        setCategoryMessage({ type: "ok", text: "Category added." });
      })
      .catch((e) => setCategoryMessage({ type: "err", text: e.message }))
      .finally(() => setAddingCategory(false));
  }

  function startEdit(c: Category) {
    setEditingId(c.category_id);
    setEditingName(c.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName("");
  }

  function saveRename(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    const name = editingName.trim();
    if (!name) return;
    setCategoryMessage(null);
    fetch(`/api/categories/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEditingId(null);
        setEditingName("");
        loadCategories();
        setCategoryMessage({ type: "ok", text: "Category renamed." });
      })
      .catch((e) => setCategoryMessage({ type: "err", text: e.message }));
  }

  function handleSoftDelete(categoryId: string) {
    if (!confirm("Remove this category? Test cases using it will keep the link but it will no longer appear in lists.")) return;
    setCategoryMessage(null);
    fetch(`/api/categories/${categoryId}`, { method: "DELETE" })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        loadCategories();
        setCategoryMessage({ type: "ok", text: "Category removed." });
      })
      .catch((e) => setCategoryMessage({ type: "err", text: e.message }));
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-stone-900">Settings</h1>

      {/* Default settings */}
      <section className="mt-8">
        <h2 className="text-lg font-medium text-stone-800">Default run settings</h2>
        <p className="mt-0.5 text-sm text-stone-500">Used when running evaluations from the home page.</p>
        {!settingsLoaded ? (
          <p className="mt-4 text-stone-500">Loading…</p>
        ) : (
          <form onSubmit={handleSaveSettings} className={`mt-4 ${cardClass}`}>
            <div>
              <label className={labelClass}>Default Evren API URL</label>
              <input
                type="url"
                value={settings.evren_api_url ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, evren_api_url: e.target.value }))}
                placeholder="http://localhost:8000"
                className={inputClass}
              />
            </div>
            <div className="mt-4">
              <label className={labelClass}>Default evaluator model</label>
              <input
                type="text"
                value={settings.evaluator_model ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, evaluator_model: e.target.value }))}
                placeholder="gemini-2.5-flash"
                className={inputClass}
              />
            </div>
            <div className="mt-4">
              <label className={labelClass}>Default summarizer model</label>
              <input
                type="text"
                value={settings.summarizer_model ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, summarizer_model: e.target.value }))}
                placeholder="gemini-2.5-flash"
                className={inputClass}
              />
            </div>
            <div className="mt-4">
              <label className={labelClass}>Evaluator system prompt</label>
              <textarea
                value={settings.evaluator_prompt ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, evaluator_prompt: e.target.value }))}
                placeholder="Leave empty to use the built-in prompt from content/prompts."
                rows={6}
                className={inputClass}
              />
            </div>
            <div className="mt-4">
              <label className={labelClass}>Summarizer system prompt</label>
              <textarea
                value={settings.summarizer_prompt ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, summarizer_prompt: e.target.value }))}
                placeholder="Leave empty to use the built-in prompt from content/prompts."
                rows={6}
                className={inputClass}
              />
            </div>
            {settingsMessage && (
              <div
                className={`mt-4 rounded-lg border p-3 text-sm ${
                  settingsMessage.type === "ok"
                    ? "border-green-200 bg-green-50 text-green-800"
                    : "border-red-200 bg-red-50 text-red-800"
                }`}
              >
                {settingsMessage.text}
              </div>
            )}
            <button
              type="submit"
              disabled={settingsSaving}
              className="mt-6 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-stone-800 disabled:opacity-50"
            >
              {settingsSaving ? "Saving…" : "Save default settings"}
            </button>
          </form>
        )}
      </section>

      {/* Categories */}
      <section className="mt-10">
        <h2 className="text-lg font-medium text-stone-800">Categories</h2>
        <p className="mt-0.5 text-sm text-stone-500">Add, rename, or remove categories. Remove is soft delete (hidden from lists).</p>
        <div className={`mt-4 ${cardClass}`}>
          <form onSubmit={handleAddCategory} className="flex gap-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="New category name"
              className="flex-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
            />
            <button
              type="submit"
              disabled={addingCategory || !newCategoryName.trim()}
              className="rounded-lg bg-stone-700 px-4 py-2 text-sm font-medium text-white hover:bg-stone-600 disabled:opacity-50"
            >
              {addingCategory ? "Adding…" : "Add"}
            </button>
          </form>

          {categoryMessage && (
            <div
              className={`mt-4 rounded-lg border p-3 text-sm ${
                categoryMessage.type === "ok"
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {categoryMessage.text}
            </div>
          )}

          <ul className="mt-4 space-y-2">
            {categoriesLoading ? (
              <li className="text-stone-500">Loading…</li>
            ) : categories.length === 0 ? (
              <li className="text-stone-500">No categories yet.</li>
            ) : (
              categories
                .filter((c) => !c.deleted_at)
                .map((c) => (
                  <li
                    key={c.category_id}
                    className="flex items-center gap-2 rounded-lg border border-stone-100 bg-stone-50/50 px-3 py-2"
                  >
                    {editingId === c.category_id ? (
                      <form onSubmit={saveRename} className="flex flex-1 gap-2">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="flex-1 rounded border border-stone-200 bg-white px-2 py-1.5 text-sm focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                          autoFocus
                        />
                        <button type="submit" className="rounded bg-stone-700 px-3 py-1.5 text-sm text-white hover:bg-stone-600">
                          Save
                        </button>
                        <button type="button" onClick={cancelEdit} className="rounded bg-stone-200 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-300">
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <span className="flex-1 font-medium text-stone-800">{c.name}</span>
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          className="rounded px-2 py-1 text-sm text-stone-600 hover:bg-stone-200 hover:text-stone-900"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSoftDelete(c.category_id)}
                          className="rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </li>
                ))
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
