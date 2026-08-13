"use client";

import { useRef, useState } from "react";
import { API_URL } from "@/lib/content";
import InfoButton from "./InfoButton";

/**
 * The mechanism, streamed as it happens.
 *
 * The earlier version returned a finished trace after five seconds, which
 * showed the result and hid the working. This reads a newline-delimited JSON
 * stream from Lambda and renders each event as it arrives — including the SQL
 * that ran, the real embedding vector, the prompt the adjudicator was given,
 * and a token counter that ticks up as tokens are genuinely spent.
 *
 * That distinction carries the whole claim. "Semantic conflict detection over a
 * distributed vector index" is either a real recursive CTE joined to a real ANN
 * search, or it is a phrase. Showing the query lets a reader decide which.
 */

type Ev = {
  t: string;
  seq: number;
  at?: number;
  id?: string;
  label?: string;
  detail?: string;
  done?: boolean;
  verdict?: string;
  dims?: number;
  preview?: number[];
  ms?: number;
  sql?: string;
  prompt?: string;
  model?: string;
  agent?: string;
  detectedBy?: string;
  distance?: number | null;
  tokensIn?: number;
  tokensOut?: number;
  usd?: number;
  wh?: number;
  affectedSteps?: number[];
  rationale?: string;
  then?: unknown;
  now?: unknown;
  thenVersion?: number;
  nowVersion?: number;
  source?: string;
  key?: string;
  durationMs?: number;
  summary?: { stepsRepaired: number; stepsPreserved: number; preservedPct: number };
  cost?: { usd: number; tokensIn: number; tokensOut: number; wh: number; embedTokens: number; completionTokens: number };
  error?: string;
  hint?: string;
};

const VERDICT_TONE: Record<string, string> = {
  irrelevant: "text-good border-good/40",
  invalidating: "text-serious border-serious/40",
  fatal: "text-critical border-critical/40",
};

function Mono({ children, label }: { children: React.ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-hairline bg-surface-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left"
      >
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
          {label}
        </span>
        <span className="text-[11px] text-muted">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <pre className="max-h-72 overflow-auto border-t border-hairline px-3 py-2.5 text-[11px] leading-relaxed">
          <code className="font-mono text-ink-2">{children}</code>
        </pre>
      )}
    </div>
  );
}

export default function LiveDemo() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [throttled, setThrottled] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const cost = [...events].reverse().find((e) => e.t === "cost" || e.t === "done");
  const liveUsd = cost?.usd ?? cost?.cost?.usd ?? 0;
  const liveTokens =
    (cost?.tokensIn ?? cost?.cost?.tokensIn ?? 0) +
    (cost?.tokensOut ?? cost?.cost?.tokensOut ?? 0);
  const done = events.find((e) => e.t === "done");

  /**
   * Retry on 429 with backoff.
   *
   * This AWS account is capped at 10 concurrent Lambda executions — below the
   * 1000 default, and shared with other projects — so a burst of simultaneous
   * visitors gets throttled by the platform rather than by our own quota. A
   * throttle is transient and retrying is the correct response, so the reader
   * should never have to know it happened.
   *
   * Our own rate limit is a 429 too, but it arrives with a JSON body; a
   * platform throttle does not. That difference is how we tell them apart —
   * retrying against a real quota breach would be rude.
   */
  async function fetchWithRetry(url: string, init: RequestInit, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      const res = await fetch(url, init);
      if (res.status !== 429) return res;

      const clone = res.clone();
      const body = await clone.text().catch(() => "");
      const isOurQuota = body.trim().startsWith("{");
      if (isOurQuota || i === attempts - 1) return res;

      setThrottled(true);
      await new Promise((r) => setTimeout(r, 900 * (i + 1) + Math.random() * 400));
    }
    throw new Error("unreachable");
  }

  async function run() {
    setRunning(true);
    setEvents([]);
    setError(null);
    setElapsed(0);
    setThrottled(false);

    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Date.now() - t0), 100);

    try {
      const res = await fetchWithRetry(`${API_URL}v1/demo/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      if (res.status === 429) {
        const body = await res.text().catch(() => "");
        const parsed = body.trim().startsWith("{") ? JSON.parse(body) : null;
        setError({
          message: parsed?.error ?? "Too many people are running this at once.",
          hint:
            parsed?.hint ??
            "This account is capped at 10 concurrent Lambda executions. Give it a few seconds and try again — or clone the repo and run it without limits.",
        });
        return;
      }

      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });

        // NDJSON: complete lines only; keep the partial tail for the next chunk.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev: Ev = JSON.parse(line);
            if (ev.t === "error") {
              setError({ message: ev.error ?? "Unknown error", hint: ev.hint });
            } else {
              setEvents((prev) => [...prev, ev]);
            }
          } catch {
            /* partial line across chunk boundary; ignored by design */
          }
        }
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
      }
    } catch (e) {
      setError({
        message: e instanceof Error ? e.message : "Network error",
        hint: "The endpoint may be cold-starting. Try once more.",
      });
    } finally {
      clearInterval(tick);
      setRunning(false);
    }
  }

  const stages = events.filter((e) => e.t === "stage");

  return (
    <div className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
            Run a live conflict
            <InfoButton
              title="What you are watching"
              what="The full mechanism executing against the production CockroachDB cluster, streamed event by event as it happens."
              how="A Lambda function URL streams newline-delimited JSON. Each event carries what actually ran: the SQL, the real 1024-dimension embedding, the snapshot timestamp, the cosine distance, the prompt the adjudicator received, and its token usage."
              note="Nothing is pre-recorded. Expand any SQL or PROMPT panel to see the exact text that executed."
              align="right"
            />
          </h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
            Two agents, one queue. The Scheduler spends 12,500 tokens planning an
            overnight rebalance; Triage commits into the same queue while it is
            still thinking.
          </p>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-accent px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
        >
          {running ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              {throttled ? "queued…" : `${(elapsed / 1000).toFixed(1)}s`}
            </>
          ) : events.length ? (
            "Run again"
          ) : (
            "Run it"
          )}
        </button>
      </div>

      {/* Live counters — visibly moving while the run is in flight. */}
      {(running || events.length > 0) && (
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-hairline pt-5 sm:grid-cols-4">
          {[
            { label: "Elapsed", value: `${((done?.durationMs ?? elapsed) / 1000).toFixed(1)}s` },
            { label: "Tokens", value: liveTokens.toLocaleString() },
            { label: "Cost", value: `$${liveUsd.toFixed(6)}` },
            {
              label: "Reasoning preserved",
              value: done?.summary ? `${done.summary.preservedPct}%` : "—",
            },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-[10px] uppercase tracking-wider text-muted">{s.label}</p>
              <p className="tabular mt-1 text-lg font-semibold text-ink">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-lg border border-serious/40 bg-surface-2 p-4">
          <p className="text-[13px] font-medium text-ink">{error.message}</p>
          {error.hint && <p className="mt-1 text-[12px] text-ink-2">{error.hint}</p>}
        </div>
      )}

      {events.length === 0 && !running && !error && (
        <p className="mt-5 border-t border-hairline pt-5 text-[12px] text-muted">
          Nothing here is pre-recorded. Each run creates real rows, generates a
          real embedding, and calls a real model.
        </p>
      )}

      {events.length > 0 && (
        <div
          ref={scroller}
          className="mt-5 max-h-[36rem] overflow-y-auto border-t border-hairline pt-5"
        >
          <ol className="flex flex-col gap-0">
            {stages.map((s, i) => {
              const after = events.filter(
                (e) =>
                  e.seq > s.seq &&
                  e.seq < (stages[i + 1]?.seq ?? Infinity) &&
                  e.t !== "stage" &&
                  e.t !== "cost",
              );
              const last = i === stages.length - 1;

              return (
                <li key={s.seq} className="relative flex gap-4 pb-5 last:pb-0">
                  {!last && (
                    <span className="absolute left-[5px] top-4 h-full w-px bg-hairline" aria-hidden="true" />
                  )}
                  <span
                    className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-4 ${
                      s.done ? "bg-accent ring-accent/20" : "bg-muted ring-hairline"
                    }`}
                    aria-hidden="true"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                        {s.id}
                      </span>
                      <span className="tabular font-mono text-[10px] text-muted">
                        +{s.at}ms
                      </span>
                    </div>

                    <p
                      className={`mt-0.5 text-sm font-medium ${
                        s.verdict
                          ? VERDICT_TONE[s.verdict]?.split(" ")[0] ?? "text-ink"
                          : "text-ink"
                      }`}
                    >
                      {s.label}
                    </p>
                    {s.detail && (
                      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{s.detail}</p>
                    )}

                    {after.map((e) => {
                      if (e.t === "sql")
                        return <Mono key={e.seq} label="SQL that ran">{e.sql}</Mono>;

                      if (e.t === "prompt")
                        return (
                          <Mono key={e.seq} label={`prompt → ${e.model}`}>{e.prompt}</Mono>
                        );

                      if (e.t === "vector")
                        return (
                          <div key={e.seq} className="mt-2 rounded-lg border border-hairline bg-surface-2 px-3 py-2">
                            <p className="font-mono text-[11px] text-muted">
                              {e.dims}-dim vector · first 8 values
                            </p>
                            <p className="tabular mt-1 break-all font-mono text-[11px] text-accent">
                              [{e.preview?.join(", ")} …]
                            </p>
                          </div>
                        );

                      if (e.t === "threat")
                        return (
                          <div key={e.seq} className="mt-2 flex flex-wrap gap-2">
                            <span className="rounded-full border border-hairline bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-2">
                              {e.agent}
                            </span>
                            <span className="rounded-full border border-accent/40 px-2.5 py-1 font-mono text-[11px] text-accent">
                              {e.detectedBy}
                            </span>
                            {e.distance != null && (
                              <span className="rounded-full border border-hairline bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-2">
                                cosine {e.distance}
                              </span>
                            )}
                          </div>
                        );

                      if (e.t === "diff")
                        return (
                          <div key={e.seq} className="mt-2 rounded-lg border border-hairline bg-surface-2 px-3 py-2 font-mono text-[11px]">
                            <p className="text-muted">{e.key} · via {e.source}</p>
                            <p className="mt-1 text-ink-2">
                              <span className="text-muted">then v{e.thenVersion}</span>{" "}
                              {JSON.stringify(e.then)}
                            </p>
                            <p className="text-ink">
                              <span className="text-muted">now&nbsp; v{e.nowVersion}</span>{" "}
                              {JSON.stringify(e.now)}
                            </p>
                          </div>
                        );

                      if (e.t === "verdict")
                        return (
                          <div key={e.seq} className="mt-2 flex flex-wrap gap-2">
                            <span className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${VERDICT_TONE[e.verdict ?? ""] ?? "border-hairline text-ink-2"}`}>
                              {e.verdict}
                            </span>
                            <span className="rounded-full border border-hairline bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-2">
                              steps {e.affectedSteps?.join(", ") || "none"} repaired
                            </span>
                            <span className="rounded-full border border-hairline bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-2">
                              {e.tokensIn}→{e.tokensOut} tok · {e.ms}ms
                            </span>
                          </div>
                        );

                      return null;
                    })}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {done && (
        <p className="mt-5 border-t border-hairline pt-5 text-[12px] leading-relaxed text-muted">
          Under optimistic concurrency every one of those steps would have been
          discarded and re-run. Embedding tokens {done.cost?.embedTokens} ·
          completion tokens {done.cost?.completionTokens} ·{" "}
          {done.cost?.wh.toFixed(4)} Wh.
        </p>
      )}
    </div>
  );
}
