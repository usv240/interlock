import Nav from "@/components/Nav";
import Benchmark from "@/components/Benchmark";
import Crossover from "@/components/Crossover";
import Verified from "@/components/Verified";
import ArchitectureDiagram from "@/components/ArchitectureDiagram";
import LiveDemo from "@/components/LiveDemo";
import UseIt from "@/components/UseIt";
import InfoButton from "@/components/InfoButton";
import { Card, Pill, Section, SectionHead } from "@/components/ui";
import { CITATIONS, REPO_URL, STEPS, WHY_CRDB } from "@/lib/content";

export default function Page() {
  return (
    <>
      <Nav />
      <main id="main" className="flex-1">
        <Hero />
        <Section id="try">
          <SectionHead
            eyebrow="Try it"
            title="Watch two agents collide"
            lede="This runs against the production cluster, right now. Not a recording — real embeddings, a real serializable commit, a real ruling, and the cost of producing it."
          />
          <div className="mt-10">
            <LiveDemo />
          </div>
        </Section>
        <Problem />
        <PriorArt />
        <Mechanism />
        <WhyCockroachDB />
        <Section id="benchmark">
          <SectionHead
            eyebrow="Benchmark"
            title="Where this pays, and where it doesn't"
            lede="Every figure carries its provenance. Published means somebody else measured it and we cite them. Measured means our harness produced it on a live cluster, and you can re-run it."
          />
          <Benchmark />
          <div className="mt-4">
            <Crossover />
          </div>
          <Verified />
        </Section>
        <Architecture />
        <Section id="use-it">
          <SectionHead
            eyebrow="Use it"
            title="It's a service, not just a demo"
            lede="The endpoints this page calls are open. Point your own agent fleet at them — declare intents before acting, commit through the API, act on the ruling."
          />
          <UseIt />
        </Section>
        <ChaosDrill />
      </main>
      <Footer />
    </>
  );
}

/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section id="top" className="px-5 pb-16 pt-16 sm:px-8 sm:pb-20 sm:pt-24">
      <div className="mx-auto w-full max-w-6xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1 text-[11px] text-ink-2">
          <span
            className="h-1.5 w-1.5 rounded-full bg-accent"
            aria-hidden="true"
          />
          CockroachDB × AWS — Build with Agentic Memory
        </div>

        <h1 className="mt-6 max-w-4xl text-3xl font-semibold leading-[1.15] tracking-tight text-ink sm:text-5xl lg:text-6xl">
          Agent memory that lets parallel agents think for 40 seconds without
          corrupting each other&rsquo;s work.
        </h1>

        <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-2 sm:text-lg">
          An LLM agent reads shared memory, thinks for forty seconds, then acts.
          The world changed while it was thinking. Today you get two bad options:
          lock everything, or throw the thinking away. INTERLOCK adds a third.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a
            href="#mechanism"
            className="inline-flex h-11 items-center rounded-lg bg-accent px-5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            How it works
          </a>
          <a
            href="#benchmark"
            className="inline-flex h-11 items-center rounded-lg border border-hairline-strong px-5 text-sm font-medium text-ink transition-colors hover:bg-surface"
          >
            See the benchmark
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center rounded-lg px-2 text-sm text-ink-2 transition-colors hover:text-ink"
          >
            Source ↗
          </a>
        </div>

        {/* The single stat that reframes the whole problem. */}
        <div className="mt-14 rounded-xl border border-hairline bg-surface p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              The finding that started this
            </p>
            <InfoButton
              title="Where this number comes from"
              what="A measured comparison of concurrency-control strategies across ten workloads where multiple LLM agents contend for the same shared state."
              how="Each strategy ran the same workloads. Optimistic concurrency — the approach almost everything uses today — finished at 0.93× the speed of running the agents one at a time, while consuming 1.83× the tokens."
              note={`${CITATIONS.coagent.title} — ${CITATIONS.coagent.id}`}
            />
          </div>
          <p className="mt-4 max-w-4xl text-xl font-medium leading-snug text-ink sm:text-2xl">
            Running AI agents in parallel today is{" "}
            <span className="text-accent">slower</span> than running them one at
            a time &mdash; and costs{" "}
            <span className="text-accent">83% more</span>.
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-2">
            You pay nearly double to go backwards. That is not a tuning problem;
            it is the reason parallel agents do not scale.
          </p>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function Problem() {
  const beats = [
    {
      t: "t = 0s",
      title: "Read",
      body: "The agent reads shared memory and forms a plan against that snapshot.",
      tone: "neutral" as const,
    },
    {
      t: "t = 0–40s",
      title: "Think",
      body: "Inference runs. Meanwhile another agent commits a write that touches the same state.",
      tone: "warn" as const,
    },
    {
      t: "t = 40s",
      title: "Act",
      body: "The agent acts on a world that no longer exists. Nothing raised an error.",
      tone: "bad" as const,
    },
  ];

  return (
    <Section id="problem">
      <SectionHead
        eyebrow="The problem"
        title="An agent's transaction is not a database transaction"
        lede={
          <>
            A database transaction is measured in milliseconds and its read-set
            is knowable up front. An agent&rsquo;s is measured in minutes of
            inference, and its read-set is broad and opaque. Classical
            concurrency control was not built for that shape.
          </>
        }
        info={{
          title: "Why the read-set matters",
          what: "The read-set is the collection of data a transaction depended on when it made its decision.",
          how: "Traditional concurrency control needs the read-set declared or inferable in advance so it can detect conflicts. With an LLM agent the read-set emerges from reasoning and is rarely knowable ahead of time — which is precisely why static write-partitioning fails here.",
          note: "INTERLOCK sidesteps this by having the agent state its dependencies in natural language, then embedding them.",
        }}
      />

      <ol className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
        {beats.map((b, i) => (
          <li key={b.title}>
            <Card className="h-full">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular font-mono text-[11px] text-muted">
                  {b.t}
                </span>
                {b.tone !== "neutral" && (
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                      b.tone === "bad" ? "text-critical" : "text-serious"
                    }`}
                  >
                    <span aria-hidden="true">
                      {b.tone === "bad" ? "✕" : "!"}
                    </span>
                    {b.tone === "bad" ? "Silent corruption" : "World changes"}
                  </span>
                )}
              </div>
              <h3 className="mt-3 text-lg font-semibold text-ink">
                {i + 1}. {b.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{b.body}</p>
            </Card>
          </li>
        ))}
      </ol>

      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-ink-2">
        Nothing in that sequence throws an exception. The agent did exactly what
        it decided to do, and what it decided to do was wrong. Monitoring built
        to catch crashes will report a zero error rate the whole way through.
      </p>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function PriorArt() {
  const options = [
    {
      name: "Two-phase locking",
      what: "Hold locks for the duration of the task.",
      why: "An agent holds its locks for the entire minutes-long task, blocking every other agent that touches overlapping state.",
      cost: "0.81 deadlocks per trial · 1.04× speedup",
    },
    {
      name: "Optimistic concurrency",
      what: "Detect the conflict at commit and abort.",
      why: "A single conflict discards the agent's entire reasoning — and re-running it costs more than the parallelism ever saved.",
      cost: "0.95 aborts per trial · 0.93× speedup at 1.83× cost",
    },
    {
      name: "Fork and merge",
      what: "Give every agent its own git worktree.",
      why: "This is what mainstream systems actually ship. It offers only weak isolation, and if two agents edit the same file the merge simply fails.",
      cost: "Cannot prevent anomalies",
    },
  ];

  return (
    <Section id="prior-art">
      <SectionHead
        eyebrow="What everyone does instead"
        title="The state of the art is a merge conflict"
        lede="Parallel agents are shipping at scale right now — sub-agent teams, background agents, swarms coordinating a hundred agents on one job. The industry's answer to shared-state conflict is a git worktree."
      />

      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
        {options.map((o) => (
          <Card key={o.name} className="flex h-full flex-col">
            <h3 className="text-base font-semibold text-ink">{o.name}</h3>
            <p className="mt-1.5 text-[13px] text-muted">{o.what}</p>
            <p className="mt-4 flex-1 text-sm leading-relaxed text-ink-2">
              {o.why}
            </p>
            <p className="mt-5 border-t border-hairline pt-4 text-[12px] text-muted">
              {o.cost}
            </p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function Mechanism() {
  return (
    <Section id="mechanism">
      <SectionHead
        eyebrow="The mechanism"
        title="Validation becomes reasoning; abort becomes repair"
        lede={
          <>
            The insight is that <em>most conflicts are semantically irrelevant</em>
            . An agent can read the conflicting write and judge whether it
            actually breaks its plan. A real conflict needs repair of only the
            dependent steps &mdash; not the whole task.
          </>
        }
        info={{
          title: "MVCC with a brain",
          what: "Optimistic concurrency control in which the validation step is a judgement rather than a version check.",
          how: "Classical OCC asks 'did any version I read change?' and aborts if so. INTERLOCK asks 'does what changed actually invalidate my plan?' — and when the answer is yes, it repairs precisely the steps that depended on the changed fact.",
          note: "The final commit is still a real serializable transaction, so correctness never rests on the model's judgement.",
        }}
      />

      <ol className="mt-10 flex flex-col gap-3">
        {STEPS.map((s) => (
          <li key={s.n}>
            <Card>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
                <div className="flex items-center gap-3 sm:w-52 sm:shrink-0">
                  <span className="tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline-strong font-mono text-[13px] text-accent">
                    {s.n}
                  </span>
                  <span className="flex items-center gap-2 text-base font-semibold text-ink">
                    {s.name}
                    <InfoButton {...s.info} />
                  </span>
                </div>

                <p className="flex-1 text-sm leading-relaxed text-ink-2">
                  {s.summary}
                </p>

                <div className="sm:w-56 sm:shrink-0 sm:text-right">
                  <Pill>{s.feature}</Pill>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function WhyCockroachDB() {
  return (
    <Section id="why-cockroachdb">
      <SectionHead
        eyebrow="Why this database"
        title="Not convenient — load-bearing"
        lede="Every one of these is doing work the system could not do without it. Swap the database and the mechanism stops functioning, rather than merely getting slower."
      />

      <div className="mt-10 overflow-hidden rounded-xl border border-hairline bg-surface">
        {WHY_CRDB.map((row, i) => (
          <div
            key={row.feature}
            className={`grid grid-cols-1 gap-3 p-5 sm:grid-cols-12 sm:gap-6 sm:p-6 ${
              i > 0 ? "border-t border-hairline" : ""
            }`}
          >
            <div className="sm:col-span-3">
              <p className="font-mono text-[13px] font-medium text-accent">
                {row.feature}
              </p>
            </div>
            <div className="sm:col-span-3">
              <p className="text-sm font-medium text-ink">{row.need}</p>
            </div>
            <div className="sm:col-span-6">
              <p className="text-sm leading-relaxed text-ink-2">{row.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function Architecture() {
  const crdb = [
    {
      tool: "Distributed Vector Indexing",
      use: "A C-SPANN index over intent embeddings finds which in-flight agents are semantically threatened by a commit — the ones that share meaning but no rows.",
    },
    {
      tool: "Managed MCP Server",
      use: "The human arbitration console. Read-only and audit-logged by default, which is exactly right for inspecting a live conflict without being able to make it worse.",
    },
    {
      tool: "ccloud CLI",
      use: "A continuity agent provisions regions, tunes the garbage-collection window that bounds time-travel reads, and snapshots before each adjudication.",
    },
    {
      tool: "Agent Skills Repo",
      use: "We consume the published skills for schema and index design, and contribute one back upstream for serializable agent intents.",
    },
  ];

  // Only services this project actually runs on. An earlier version of this
  // list also claimed EventBridge, SQS and ECS Fargate, which were designed for
  // and never wired. Listing four services we use beats seven we half-use —
  // and "meaningfully integrated, not just initialized" is a pass/fail rule.
  const aws = [
    {
      tool: "Amazon Bedrock",
      use: "Titan Text Embeddings V2 for the vector path, and Claude across three tiers with cost-aware routing. Adjudication runs on the cheap tier because the provenance graph has already narrowed the question.",
    },
    {
      tool: "AWS Lambda",
      use: "Two functions. The public API declares intents, commits and streams the demo. A separate SQS worker adjudicates off the queue with partial-batch failure reporting and its own concurrency.",
    },
    {
      tool: "Amazon EventBridge + SQS",
      use: "A CockroachDB changefeed on commit_log posts to the API, which publishes to EventBridge; a rule routes to SQS, and the worker adjudicates in parallel. Commits return as soon as they are durable instead of blocking on everyone they threatened. Three retries, then a dead-letter queue.",
    },
    {
      tool: "Amazon S3 + CloudFront",
      use: "Hosts this page as a static export with a private origin — CloudFront-only read via Origin Access Control, no public bucket policy.",
    },
    {
      tool: "Amazon CloudWatch",
      use: "Budget alarm at $20 with three thresholds, plus the logs that caught a cold-start failure and a cross-region IAM denial during build.",
    },
    {
      tool: "AWS IAM",
      use: "A runtime role scoped to five specific model ARNs rather than bedrock:*, with explicit denies on deleting evidence and altering model access.",
    },
  ];

  return (
    <Section id="architecture">
      <SectionHead
        eyebrow="Architecture"
        title="What each piece actually does"
        lede="The hackathon asks for at least two CockroachDB tools and one AWS service. We use all four CockroachDB tools — and only the AWS services we genuinely run on, because claiming more than you use is worse than claiming less."
      />

      <div className="mt-10">
        <ArchitectureDiagram />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-ink">
            CockroachDB &mdash; all four tools
          </h3>
          <ul className="mt-4 flex flex-col gap-4">
            {crdb.map((r) => (
              <li key={r.tool}>
                <p className="font-mono text-[12px] text-accent">{r.tool}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                  {r.use}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-ink">
            AWS &mdash; only what we run on
          </h3>
          <ul className="mt-4 flex flex-col gap-4">
            {aws.map((r) => (
              <li key={r.tool}>
                <p className="font-mono text-[12px] text-accent">{r.tool}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                  {r.use}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function ChaosDrill() {
  return (
    <Section id="chaos">
      <SectionHead
        eyebrow="Resilience"
        title="Kill a region mid-adjudication"
        lede="If the memory arbitrating conflicts is unavailable, every agent in the fleet is unsafe at the same moment. So the test is not whether it works — it is whether it keeps working while a region is being taken away from it."
        info={{
          title: "The chaos drill",
          what: "A deliberate failure injected while the system is mid-decision, to show the guarantee holds under loss rather than only under calm.",
          how: "We start a multi-region cluster, drive a contended workload until an adjudication is in flight, then remove a region. The adjudication completes from the surviving region, exactly once, still serializable — no decision is lost and none is applied twice.",
          note: "This is also where the production write-up comes from: we intend to break it, record what broke, and document the fix.",
        }}
      />

      <div className="mt-10 rounded-xl border border-hairline bg-surface p-6 sm:p-8">
        <p className="max-w-3xl text-base leading-relaxed text-ink-2">
          An agent whose memory goes offline does not degrade gracefully. It
          stops. That is the premise of this hackathon, and it is the one claim a
          demo can actually prove rather than assert.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Pill>SURVIVE REGION FAILURE</Pill>
          <Pill>exactly-once adjudication</Pill>
          <Pill>no lost decisions</Pill>
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function Footer() {
  return (
    <footer className="border-t border-hairline px-5 py-12 sm:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          <div className="max-w-sm">
            <p className="font-mono text-sm font-semibold text-ink">INTERLOCK</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              Agent memory as a concurrency substrate. Built on CockroachDB and
              AWS for the Build with Agentic Memory hackathon.
            </p>
            <p className="mt-4 text-[12px] text-muted">MIT licensed. Open source.</p>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              References
            </p>
            <ul className="mt-3 flex max-w-md flex-col gap-2.5">
              {Object.values(CITATIONS).map((c) => (
                <li key={c.id} className="text-[13px] leading-snug">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink-2 underline decoration-hairline-strong underline-offset-2 transition-colors hover:text-ink"
                  >
                    {c.id}
                  </a>
                  <span className="ml-2 text-[12px] text-muted">{c.title}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
