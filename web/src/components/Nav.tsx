"use client";

import { useState } from "react";
import ThemeToggle from "./ThemeToggle";
import { REPO_URL } from "@/lib/content";

const LINKS = [
  { href: "#problem", label: "Problem" },
  { href: "#mechanism", label: "How it works" },
  { href: "#why-cockroachdb", label: "Why CockroachDB" },
  { href: "#benchmark", label: "Benchmark" },
  { href: "#architecture", label: "Architecture" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-page/85 backdrop-blur-md">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8"
      >
        <a href="#top" className="flex items-center gap-2.5">
          <Mark />
          <span className="font-mono text-sm font-semibold tracking-tight text-ink">
            INTERLOCK
          </span>
        </a>

        <ul className="hidden items-center gap-7 lg:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="text-[13px] text-ink-2 transition-colors hover:text-ink"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden h-9 items-center rounded-md border border-hairline px-3 text-[13px] text-ink-2 transition-colors hover:border-hairline-strong hover:text-ink sm:inline-flex"
          >
            GitHub
          </a>
          <ThemeToggle />
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-hairline text-ink-2 lg:hidden"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {open ? (
                <path d="M18 6 6 18M6 6l12 12" />
              ) : (
                <path d="M3 6h18M3 12h18M3 18h18" />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div id="mobile-nav" className="border-t border-hairline lg:hidden">
          <ul className="mx-auto w-full max-w-6xl px-5 py-2 sm:px-8">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block border-b border-hairline py-3 text-sm text-ink-2 last:border-0"
                >
                  {l.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="block py-3 text-sm text-ink-2"
              >
                GitHub ↗
              </a>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}

/** Two offset bars that cannot pass through each other — a mechanical interlock. */
function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1.5" y="4" width="10" height="4" rx="2" fill="var(--accent)" />
      <rect
        x="8.5"
        y="12"
        width="10"
        height="4"
        rx="2"
        fill="var(--muted)"
      />
    </svg>
  );
}
