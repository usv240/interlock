import { API_URL } from "@/lib/content";
import InfoButton from "./InfoButton";
import GetKey from "./GetKey";

/**
 * INTERLOCK is a service, not only a demonstration.
 *
 * The same endpoints the page above calls are open to any agent fleet. Showing
 * the actual curl commands matters more than describing them: a reader can
 * verify the service exists by pasting one line, which is a stronger claim than
 * any amount of prose about an architecture.
 */

const ENDPOINTS = [
  {
    method: "POST",
    path: "/v1/keys",
    what: "Self-serve. Creates an isolated tenant and returns a key, shown once.",
    free: true,
  },
  {
    method: "GET",
    path: "/v1/health",
    what: "Topology, survival goal, time-travel reach, and quota remaining.",
    free: true,
  },
  {
    method: "POST",
    path: "/v1/intents",
    what: "Declare what an agent is about to do, and what it read, before it acts.",
    free: false,
  },
  {
    method: "POST",
    path: "/v1/commits",
    what: "Commit a change. Returns a ruling for every agent the commit threatened.",
    free: false,
  },
  {
    method: "GET",
    path: "/v1/adjudications",
    what: "The audit feed — recent rulings, read-only.",
    free: true,
  },
];

export default function UseIt() {
  return (
    <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <div className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            Endpoints
            <InfoButton
              title="Why this is public"
              what="An unauthenticated HTTP API exposing the same mechanism the demo above uses."
              how="Declare intents before acting, commit through /v1/commits, and receive a ruling for every agent your write threatened. Your agents keep their own logic; INTERLOCK only arbitrates the shared state."
              note="Rate limited by a ceiling held in CockroachDB rather than in Lambda memory — instances are ephemeral and concurrent, so per-instance counters undercount exactly when it matters."
            />
          </h3>

          <ul className="mt-4 flex flex-col gap-4">
            {ENDPOINTS.map((e) => (
              <li key={e.path}>
                <p className="font-mono text-[12px]">
                  <span className="text-accent">{e.method}</span>{" "}
                  <span className="text-ink">{e.path}</span>
                  {e.free && (
                    <span className="ml-2 rounded-full border border-hairline px-1.5 py-0.5 text-[10px] text-muted">
                      no quota
                    </span>
                  )}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{e.what}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="lg:col-span-3">
        <div className="h-full rounded-xl border border-hairline bg-surface p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-ink">Call it now</h3>
          <p className="mt-1 text-[13px] text-ink-2">
            Paste this into a terminal. It runs the same conflict the button above does.
          </p>

          <pre className="mt-4 overflow-x-auto rounded-lg border border-hairline bg-surface-2 p-4 text-[12px] leading-relaxed">
            <code className="font-mono text-ink-2">
              <span className="text-muted"># health, topology and quota</span>
              {"\n"}curl -s {API_URL}v1/health
              {"\n\n"}
              <span className="text-muted"># run a real adjudication</span>
              {"\n"}curl -s -X POST {API_URL}v1/demo \{"\n"}
              {"  "}-H &apos;content-type: application/json&apos; -d &apos;{"{}"}&apos;
              {"\n\n"}
              <span className="text-muted"># the audit feed</span>
              {"\n"}curl -s {API_URL}v1/adjudications
            </code>
          </pre>

          <div className="mt-5 border-t border-hairline pt-5">
            <h4 className="text-[13px] font-semibold text-ink">
              Run your own fleet against it
            </h4>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
              A key gives you an isolated tenant. No other caller&rsquo;s commits
              can adjudicate your intents &mdash; the tenant filter sits inside
              the detection query, not around it.
            </p>
            <GetKey />
          </div>

          <p className="mt-5 border-t border-hairline pt-5 text-[12px] leading-relaxed text-muted">
            Your agents keep their own reasoning and their own tools. INTERLOCK
            arbitrates only the shared state — declare an intent, commit through
            it, and act on the ruling.
          </p>
        </div>
      </div>
    </div>
  );
}
