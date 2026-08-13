"use client";

import { useState } from "react";
import { API_URL } from "@/lib/content";

/**
 * Self-serve key issuance, on the page.
 *
 * A service that requires a conversation before anyone can evaluate it does not
 * get evaluated. This issues a real key against the real API — the same call
 * the curl example makes.
 *
 * The key is shown once and never again, because only a SHA-256 of it is
 * stored. That is worth saying plainly at the moment of issuance rather than
 * burying in docs, since it is the one instruction a user cannot recover from
 * ignoring.
 */
export default function GetKey() {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [name, setName] = useState("");
  const [result, setResult] = useState<{
    key: string;
    tenant: { slug: string };
    limits: { dailyCalls: number; dailyUsd: number };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`${API_URL}v1/keys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name || "Anonymous", label: "web" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        setState("error");
        return;
      }
      setResult(data);
      setState("done");
    } catch {
      setError("Network error. The endpoint may be cold-starting.");
      setState("error");
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; the key is visible and selectable anyway */
    }
  }

  if (state === "done" && result) {
    return (
      <div className="mt-4 rounded-lg border border-accent/40 bg-surface-2 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
          Your key — shown once
        </p>

        <div className="mt-3 flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded border border-hairline bg-surface px-3 py-2 font-mono text-[12px] text-ink">
            {result.key}
          </code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 cursor-pointer rounded-md border border-hairline px-3 py-2 text-[12px] text-ink-2 transition-colors hover:border-hairline-strong hover:text-ink"
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>

        <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
          Tenant <span className="font-mono text-ink">{result.tenant.slug}</span> ·{" "}
          {result.limits.dailyCalls.toLocaleString()} calls and $
          {result.limits.dailyUsd}/day.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Only a SHA-256 of this key is stored, so it cannot be recovered or
          shown again. Your agents get their own isolated tenant — no other
          caller&rsquo;s commits can adjudicate your intents.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={issue} className="mt-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your team or project name"
          maxLength={80}
          className="h-10 min-w-0 flex-1 rounded-lg border border-hairline bg-surface-2 px-3 text-[13px] text-ink placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-hairline-strong px-4 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60"
        >
          {state === "loading" ? "issuing…" : "Get an API key"}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-serious">{error}</p>}
      <p className="mt-2 text-[12px] text-muted">
        Free, instant, no signup. Five keys per address per day.
      </p>
    </form>
  );
}
