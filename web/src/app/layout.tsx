import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "INTERLOCK — memory that lets parallel agents think without corrupting each other",
  description:
    "An LLM agent reads shared memory, thinks for 40 seconds, then acts. The world changed while it was thinking. INTERLOCK is agent memory built on CockroachDB that detects semantic conflicts, repairs only the dependent steps, and commits serializably.",
  keywords: [
    "agent memory",
    "multi-agent",
    "concurrency control",
    "CockroachDB",
    "serializable",
    "AS OF SYSTEM TIME",
    "vector index",
    "AWS Bedrock",
  ],
  openGraph: {
    title: "INTERLOCK",
    description:
      "Running AI agents in parallel today is slower than running them one at a time, and costs 83% more. INTERLOCK fixes that.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

/**
 * Runs before first paint so the correct theme is applied with no flash.
 * Precedence: explicit user choice (localStorage) > OS preference.
 */
const noFlashTheme = `
(function () {
  try {
    var stored = localStorage.getItem('interlock-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body className="min-h-full flex flex-col bg-page text-ink">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:ring-1 focus:ring-hairline-strong"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
