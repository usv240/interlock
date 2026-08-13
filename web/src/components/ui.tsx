import type { ReactNode } from "react";
import type { Provenance } from "@/lib/content";
import InfoButton, { type InfoButtonProps } from "./InfoButton";

export function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`border-t border-hairline px-5 py-16 sm:px-8 sm:py-20 lg:py-24 ${className}`}
    >
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

export function SectionHead({
  eyebrow,
  title,
  lede,
  info,
}: {
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  info?: InfoButtonProps;
}) {
  return (
    <header className="max-w-3xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
        {eyebrow}
      </p>
      <h2 className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        {title}
        {info && <InfoButton {...info} />}
      </h2>
      {lede && (
        <p className="mt-4 text-base leading-relaxed text-ink-2 sm:text-[17px]">
          {lede}
        </p>
      )}
    </header>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-hairline bg-surface p-5 sm:p-6 ${className}`}
    >
      {children}
    </div>
  );
}

const PROVENANCE_COPY: Record<
  Provenance,
  { label: string; title: string; className: string }
> = {
  published: {
    label: "Published",
    title: "Measured by cited prior work, not by us",
    className: "border-hairline-strong text-muted",
  },
  measured: {
    label: "Measured",
    title: "Produced by our own benchmark harness on real runs",
    className: "border-good/40 text-good",
  },
  target: {
    label: "Target",
    title: "What we are aiming for — not yet measured",
    className: "border-warning/50 text-serious",
  },
};

/**
 * Renders next to every figure so a target can never be misread as a result.
 * Carries an icon-free but always-labelled treatment — the word does the work,
 * never the colour alone.
 */
export function ProvenanceBadge({ kind }: { kind: Provenance }) {
  const p = PROVENANCE_COPY[kind];
  return (
    <span
      title={p.title}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${p.className}`}
    >
      {p.label}
    </span>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-hairline bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-2">
      {children}
    </span>
  );
}
