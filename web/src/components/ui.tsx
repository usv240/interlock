import type { ReactNode } from "react";
import type { Provenance } from "@/lib/content";
import InfoButton, { type InfoButtonProps } from "./InfoButton";

export function Section({
  id,
  children,
  className = "",
  tone = "page",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  /**
   * Alternating grounds give a long page rhythm. Without it, fourteen sections
   * of identical background read as one undifferentiated scroll and the reader
   * loses track of where an argument started.
   */
  tone?: "page" | "raised";
}) {
  return (
    <section
      id={id}
      className={`border-t border-hairline px-5 py-16 sm:px-8 sm:py-20 lg:py-24 ${
        tone === "raised" ? "bg-page-2" : ""
      } ${className}`}
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
      <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
        <span
          className="h-px w-6 bg-accent/50"
          aria-hidden="true"
        />
        {eyebrow}
      </p>
      {/* Not a flex row: as a flex item the heading text wraps as one block and
          pushes the info button onto a line of its own, which reads as a stray
          orphan under the title. Inline-block keeps it beside the last word. */}
      <h2 className="mt-3.5 text-[1.625rem] font-semibold text-balance text-ink sm:text-[2.125rem]">
        {title}
        {info && (
          <span className="ml-2 inline-block translate-y-[-0.15em] align-middle">
            <InfoButton {...info} />
          </span>
        )}
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
  interactive = false,
  accent = false,
}: {
  children: ReactNode;
  className?: string;
  /** Lifts on hover. Only for cards that actually do something when clicked. */
  interactive?: boolean;
  /** A lit hairline along the top edge, for the one card that carries the point. */
  accent?: boolean;
}) {
  return (
    <div
      className={`card p-5 sm:p-6 ${interactive ? "card-interactive" : ""} ${
        accent ? "card-accent" : ""
      } ${className}`}
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
