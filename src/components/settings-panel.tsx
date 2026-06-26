"use client";

import { useEffect, useState } from "react";

export function SettingsPanel() {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const existing = window.sessionStorage.getItem("openai_user_key") || "";
    setApiKey(existing);
  }, []);

  function handleSave() {
    if (apiKey.trim()) {
      window.sessionStorage.setItem("openai_user_key", apiKey.trim());
    } else {
      window.sessionStorage.removeItem("openai_user_key");
    }

    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  const usingUserKey = Boolean(apiKey.trim());

  return (
    <section className="rounded-[2rem] border border-white/60 bg-white/75 p-6 shadow-[0_24px_80px_rgba(19,73,63,0.12)] backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-700">
            Runtime Key
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">
            Bring your own OpenAI key
          </h2>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            usingUserKey
              ? "bg-teal-100 text-teal-800"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {usingUserKey ? "Using user key" : "Using .env fallback"}
        </span>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-600">
        Your personal key is stored only in this browser session. If left blank,
        the app falls back to the server key and applies stricter search and file
        upload limits.
      </p>

      <label className="mt-5 block text-sm font-medium text-slate-800">
        OpenAI API Key
      </label>
      <input
        type="password"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder="sk-..."
        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-teal-500"
      />

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleSave}
          className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800"
        >
          Save Session Key
        </button>
        <span className="text-xs text-slate-500">
          {saved ? "Saved to session storage." : "Never written to the database."}
        </span>
      </div>
    </section>
  );
}
