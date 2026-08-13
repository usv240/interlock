"use client";

import { useState } from "react";
import { API_URL } from "@/lib/content";
import InfoButton from "./InfoButton";

/**
 * Runs a real conflict against the real cluster, in the browser.
 *
 * Nothing here is scripted playback. The button calls a Lambda function URL
 * which declares an intent, commits a competing change, runs detection and
 * adjudication, and returns the rows it produced. The trace below is that
 * response — including how long it took and what it cost.
 */

type TraceStep = {
  step: string;
  label: string;
  detail?: string;
  detectedBy?: string;
  distance?: number | null;
  stepsRepaired?: number;
  stepsPreserved?: number;
  stepsTotal?: number;
};

type DemoResult = {
  ok: boolean;
  durationMs: number;
  trace: TraceStep[];
  summary: { stepsRepaired: number; stepsPreserved: number; preservedPct: number; note: string };
  cost: { usd: number; tokensIn: number; tokensOut: number; energyWh: number; gCO2e: number };
  quota?: { callsLeft: number };
  error?: string;
  hint?: string;
};

const STEP_STYLE: Record<string, { dot: string; ring: string }> = {
  setup: { dot: "bg-muted", ring: "ring-hairline" },
  declare: { dot: "bg-accent", ring: "ring-accent/30" },
  commit: { dot: "bg-serious", ring: "ring-serious/30" },
  adjudicate: { dot: "bg-good", ring: "ring-good/30" },
};

export default function LiveDemo() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);

  async function run() {
    setState("running");
    setResult(null);
    setError(null);
    setElapsed(0);

    const started = Date.now();
    const tick = setInterval(() => setElapsed(Date.now() - started), 100);

    try {
      const res = await fetch(`${API_URL}v1/demo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data: DemoResult = await res.json();

      if (!res.ok || !data.ok) {
        setError({ message: data.error ?? `Request failed (${res.status})`, hint: data.hint });
        setState("error");
      } else {
        setResult(data);
        setState("done");
      }
    } catch (e) {
      setError({
        message: e instanceof Error ? e.message : "Network error",
        hint: "The endpoint may be cold-starting. Try once more.",
      });
      setState("error");
    } finally {
      clearInterval(tick);
    }
  }

  return (
    <div className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
            Run a live conflict
            <InfoButton
              title="What this button does"
              what="Executes the full mechanism against the production CockroachDB cluster and returns what actually happened."
              how="A Lambda function declares an intent with a real embedding, commits a competing write in a serializable transaction, runs the three detection paths, sends the surviving candidates to a model on Bedrock, and records the ruling. The trace below is the resulting rows, not a recording."
              note="Rate limited so a public endpoint cannot run up an unbounded inference bill. Each run costs about $0.003."
              align="right"
            />
          </h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
            Two agents, one queue. The Scheduler spends 12,500 tokens planning an
            overnight rebalance; the Triage agent commits into the same queue
            while it is thinking.
          </p>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={state === "running"}
          className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-accent px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {state === "running" ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              running… {(elapsed / 1000).toFixed(1)}s
            </>
          ) : state === "done" ? (
            "Run again"
          ) : (
            "Run it"
          )}
        </button>
      </div>

      {state === "idle" && (
        <p className="mt-5 border-t border-hairline pt-5 text-[12px] text-muted">
          Nothing here is pre-recorded. Each run creates real rows in the cluster
          and calls a real model.
        </p>
      )}

      {state === "error" && error && (
        <div className="mt-5 rounded-lg border border-serious/40 bg-surface-2 p-4">
          <p className="text-[13px] font-medium text-ink">{error.message}</p>
          {error.hint && <p className="mt-1 text-[12px] text-ink-2">{error.hint}</p>}
        </div>
      )}

      {result && (
        <div className="mt-6 border-t border-hairline pt-6">
          <ol className="flex flex-col gap-0">
            {result.trace.map((t, i) => {
              const style = STEP_STYLE[t.step] ?? STEP_STYLE.setup;
              const last = i === result.trace.length - 1;
              return (
                <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
                  {!last && (
                    <span
                      className="absolute left-[5px] top-4 h-full w-px bg-hairline"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-4 ${style.dot} ${style.ring}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      {t.step}
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-ink">{t.label}</p>
                    {t.detail && (
                      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                        {t.detail}
                      </p>
                    )}
                    {t.detectedBy && (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <span className="inline-flex items-center rounded-full border border-hairline bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-2">
                          {t.detectedBy}
                        </span>
                        {t.distance != null && (
                          <span className="inline-flex items-center rounded-full border border-hairline bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-2">
                            distance {t.distance}
                          </span>
                        )}
                        <span className="inline-flex items-center rounded-full border border-good/40 px-2.5 py-1 font-mono text-[11px] text-good">
                          {t.stepsPreserved}/{t.stepsTotal} steps preserved
                        </span>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-hairline pt-5 sm:grid-cols-4">
            {[
              { label: "Reasoning preserved", value: `${result.summary.preservedPct}%` },
              { label: "Wall clock", value: `${(result.durationMs / 1000).toFixed(1)}s` },
              { label: "Cost", value: `$${result.cost.usd.toFixed(4)}` },
              { label: "Energy", value: `${result.cost.energyWh.toFixed(3)} Wh` },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-[11px] uppercase tracking-wider text-muted">
                  {s.label}
                </p>
                <p className="tabular mt-1 text-xl font-semibold text-ink">
                  {s.value}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-muted">
            {result.summary.note}
            {result.quota && ` · ${result.quota.callsLeft} runs left in today's public quota.`}
          </p>
        </div>
      )}
    </div>
  );
}
