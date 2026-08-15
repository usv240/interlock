# INTERLOCK

**Agent memory that lets parallel agents think for 40 seconds without corrupting each other's work.**

Built on CockroachDB and AWS for the *Build with Agentic Memory* hackathon.

**[Live demo](https://d3dgn014prmcy8.cloudfront.net)** · **[API reference](docs/API.md)** · **[Setup](SETUP.md)** · MIT

---

## See it work — 30 seconds, no setup

Node only. **No database, no AWS account, no configuration.** It issues itself a
throwaway key and runs against the live service.

```bash
git clone https://github.com/usv240/interlock && cd interlock && npm install
npm run quickstart
```

```
1. Is the service up?
   healthy — 3 regions, survives region failure

3. The Scheduler says what it is about to do — before it does it
   intent declared with 4 plan steps

4. Meanwhile, Triage commits into the same queue

5. The ruling
   verdict   INVALIDATING       ruled by claude-haiku-4-5
   rationale The queue depth increased from 118 to 131, which changes the
             overflow calculation and the volume to hand to APAC.

   2 of 4 steps preserved — optimistic concurrency would discard all 4
   cost of this ruling: $0.002
```

Two more worth a minute:

| Command | What it shows |
|---|---|
| `npm run compare` | The same collision priced **with and without** INTERLOCK. Add `-- --reasoning 400` and it prints, in red, that we cost *more* below the crossover. |
| `npm run verify` | Issues a key and proves it: authenticated, tenant-isolated, metered, garbage keys refused. |

Everything above runs against the deployed system. Nothing is mocked or recorded.

---

## In one paragraph

An LLM agent **reads** shared state, **thinks for forty seconds**, then **acts** —
and the world moved while it was thinking. Lock the row and every other agent
waits out an inference. Abort on conflict and you throw away all forty seconds of
reasoning. INTERLOCK adds a third option: when a commit lands, work out *which
plan steps it actually invalidated*, and redo only those. The database is not
storage here — it is the mechanism. Swap it out and the product stops existing.

---

## The problem

An LLM agent's transaction is not a database transaction. It **reads** shared memory, **thinks for forty seconds**, then **acts**. The world changed while it was thinking.

Classical concurrency control offers two bad options:

- **Two-phase locking** — hold the lock across the whole task. Every other agent waits out a full inference.
- **Optimistic concurrency** — detect the conflict at commit and discard the agent's *entire* reasoning.

Measured across ten contended workloads ([CoAgent, arXiv:2606.15376](https://arxiv.org/abs/2606.15376)), optimistic concurrency runs at **0.93× the speed of running agents one at a time, at 1.83× the token cost.** You pay nearly double to go backwards.

Meanwhile parallel agents are shipping at scale, and the industry's answer to shared-state conflict is **a git worktree and a merge conflict**.

## The idea

Most conflicts are **semantically irrelevant**. An agent can read the conflicting write and judge whether it actually breaks its plan. A real conflict needs repair of only the *dependent steps* — not the whole task.

INTERLOCK is optimistic concurrency where **validation is reasoning instead of a version check**, and **abort is a surgical repair instead of a rollback**.

Correctness never rests on the model's judgement: the final write is a real `SERIALIZABLE` transaction, so a wrong ruling costs wasted work, not a lost update.

---

## The mechanism

| Step | What happens | Doing the work |
|---|---|---|
| **1. Declare** | Agent writes an *intent* before acting: what it read, what it plans to do, as text **and** embedding | Serializable write + `VECTOR(1024)` |
| **2. Watch** | A commit lands. Who is actually threatened? Three paths in one query, one snapshot | Recursive CTE ⨝ **C-SPANN vector search** |
| **3. Diff** | Replay the exact snapshot the agent read, diff against now | **`AS OF SYSTEM TIME`** |
| **4. Adjudicate** | *irrelevant* → proceed · *invalidating* → repair only dependent steps · *fatal* → abort | Provenance pre-filter, then Bedrock |
| **5. Resolve** | Ruling recorded, exactly once, and acted on | `SERIALIZABLE` + `UNIQUE` index |

### Step 2 in detail — three detection paths

```
exact     intents that read this very row at an older version
graph     recursive walk of the provenance graph, at step granularity
vector    approximate nearest neighbour over intent embeddings —
          catches plans that share meaning but no rows
```

All three execute against the **same transactional snapshot**. That is the reason this lives *in* CockroachDB rather than beside it.

### Step 4 in detail — the graph answers first

If no plan step descends from the changed resource, the recursive CTE rules **irrelevant with zero inference**. The model is only consulted on the candidates the graph has already narrowed to. This one change cut measured cost by roughly a third: we had been paying an expensive model to confirm conclusions a SQL query had already reached.

---

## Why CockroachDB, and not something else

| | Why it fails here |
|---|---|
| **PostgreSQL + pgvector** | Defaults to `READ COMMITTED`, so lost updates are possible unless every call site remembers to opt in. No point-in-time reads, so step 3 is impossible. Single-region. |
| **Pinecone / Chroma / Weaviate** | No transactions at all. The similarity query and the graph query would see different states — reintroducing exactly the consistency gap this system exists to close. |
| **Postgres + a separate vector store** | Two systems, two snapshots. A commit visible in one and not the other silently produces wrong blast radii. |
| **DynamoDB** | No joins, no recursive CTEs, no vector index. The provenance walk becomes application code. |

What is actually load-bearing:

- **`SERIALIZABLE` by default** — correctness is inherited from the database, not reimplemented. Verified: `npm run db:verify`.
- **MVCC + `AS OF SYSTEM TIME`** — this is the *mechanism*, not a convenience. Without point-in-time reads there is no way to show an agent what moved under it.
- **C-SPANN vector index co-located with transactional rows** — semantic detection with zero consistency gap.
- **3 regions + `SURVIVE REGION FAILURE`** — if the arbiter's memory is unavailable, the entire fleet is unsafe at once.

---

## Results

Everything below was produced by the harness in this repo, on a live cluster. Reproduce with `npm run bench` and `npm run bench:sweep`.

### The crossover

INTERLOCK is **not always better**, and the honest claim is a regime rather than a win:

```
reasoning/task    OCC cost    INTERLOCK cost    winner      margin
 3,357 tokens     2.04x       3.57x             OCC         -75%
16,652 tokens     2.02x       1.59x             INTERLOCK   +21%
37,314 tokens     2.01x       1.28x             INTERLOCK   +36%
```

**Below roughly 15k tokens of reasoning per task, do not use this — just retry.**

The reason is structural: adjudication costs roughly a fixed amount per conflict, while re-running a task costs in proportion to how much thinking it discards. Cheap tasks have nothing worth protecting. The saving grows with task cost.

### Correctness

**Zero lost updates in every mode at every point on the curve**, checked by arithmetic rather than by inspection: each resource carries a counter, and a correct run must satisfy `final_counter == successful_commits`.

### Chaos drill

`npm run chaos` destroys every in-flight connection at random moments while agents adjudicate.

```
13 kill waves fired | 6 commits | 6 tasks completed | 0 abandoned

PASS  exactly-once adjudication (0 duplicate pairs)
PASS  no orphaned repairs (0)
PASS  counter balances: 6 increments for 6 commits
PASS  nothing left mid-flight (0 threatened)
```

The wave count varies per run — kills are fired at random moments — so expect
something in the low teens rather than that exact number.

**The fourth check used to be a global count, and that was wrong.** It asked
whether *any* intent in the database sat in `threatened`, so an afternoon of
running the test suite made it fail with 15 on a run that had left 4. It passed
historically because the cluster happened to be clean, not because the property
held. It is now scoped to the drill's own agents, like the other three always
were.

It also no longer asserts zero unconditionally. An intent left `threatened`
after a connection dies mid-adjudication is **recoverable, not corrupt**: the
sequence is mark → adjudicate → record, and a kill between the first and last
leaves the middle state, with nothing lost and nothing doubled, because the
changefeed re-delivers and the `UNIQUE` index makes the retry a no-op. Asserting
zero would have been asserting that a random kill never lands mid-sequence —
which is precisely what this drill exists to cause.

**What this proves and what it does not.** CockroachDB Basic is managed, so we cannot take a region offline, and a script claiming to would be theatre. The database's half — surviving region loss — is a configuration property, verified declaratively (`3 regions, survival goal = region`). *Our* half — behaving correctly when the database becomes unreachable mid-decision — is what the drill attacks, because from an application's point of view a region loss *is* connections dying mid-flight.

Exactly-once is structural, not conventional: a `UNIQUE` index on `(commit_id, intent_id)` means a double-apply fails loudly rather than quietly recording two verdicts for one conflict.

---

## CockroachDB tools used — all four

| Tool | What the agent actually does with it |
|---|---|
| **Distributed Vector Indexing** | One **partial, tenant-prefixed** C-SPANN index over the intents *currently in flight* — semantic detection never asks about resolved plans, so indexing them is write amplification for nothing. At **roughly 1,700 live plans the planner selects it** (`npm run ai:vector` prints the plan and names the tenant). Threshold measured, not guessed — `npm run ai:calibrate`. |
| **Managed MCP Server** | Read-only, audit-logged console for inspecting live conflicts. Investigation is inherently read-only, so the safe-by-default posture is exactly right. |
| **ccloud CLI** | Continuity agent: inspects regions, reads the GC window that bounds time-travel reach, snapshots before adjudication cascades. |
| **Agent Skills Repo** | Consumed for schema and index design. We wrote one back — skills/managing-long-running-agent-transactions/ — and it is in this repo, not yet upstream. |

## AWS services used

Only the services this project actually runs on. An earlier draft of this table
also listed EventBridge, SQS and ECS Fargate — designed for, never wired. Since
the rules require components to be *"meaningfully integrated, not just
initialized"*, claiming five services we use beats eight we half-use.

| Service | Role |
|---|---|
| **Amazon Bedrock** | Titan Text Embeddings V2 (1024-dim) for the vector path; Claude on **two caller-selectable tiers** (`adjudicator: "bulk" \| "adjudicator"`), named by role so client code survives a model id moving. The cheap tier is the default because the provenance graph has already narrowed the question. A third tier exists in code and is deliberately **not** granted or published — see `infra/iam-policy.json`. Every call's tokens land in the ledger. |
| **AWS Lambda** | The public API — declares intents, commits, adjudicates, enforces the spend ceiling. Function URL, no API Gateway. |
| **Amazon S3 + CloudFront** | Hosts the demo as a static export with a **private** origin: CloudFront-only read via Origin Access Control, no public bucket policy. |
| **Amazon CloudWatch** | $20 budget alarm with three thresholds, plus the logs that caught a cold-start syntax failure and a cross-region IAM denial during the build. |
| **AWS IAM** | Runtime role scoped to five specific model ARNs rather than `bedrock:*`, with explicit denies on deleting evidence and altering model access. See [`infra/`](infra/). |

### A cross-region IAM lesson worth recording

Claude's `us.` inference profiles perform **cross-region dispatch**. A policy
allowing only `us-east-1` foundation-model ARNs fails at runtime with a denial
naming `us-east-2`, because that is where the profile routed the call. Scoping
least-privilege correctly means allowing the underlying model in every region
the profile may dispatch to — while the profile ARN itself stays in its home
region.

---

## Everything you can run

**No setup required** — these use our live deployment:

| Command | What it does |
|---|---|
| `npm run quickstart` | The whole loop: declare → collide → ruling |
| `npm run compare` | The same collision priced with and without INTERLOCK |
| `npm run verify` | Proves a key is authenticated, isolated and metered |
| `npm run example:langchain` | Two LangChain agents contending over one queue |
| `npm run test:sdk` | 13 contract checks against the live endpoint |
| `npm run submission:check` | Is everything a judge can touch still working? |

**Needs your own cluster** (see [SETUP.md](SETUP.md)):

| Command | What it does |
|---|---|
| `npm run db:migrate` / `db:reset` | Apply / rebuild the schema |
| `npm run db:verify` | Proves serializable, 3 regions, time travel, vector index |
| `npm run demo` | The mechanism end to end, locally, with full accounting |
| `npm run bench` / `bench:sweep` | Four modes, one workload · the crossover curve |
| `npm run chaos` | Connection-severing resilience drill |
| `npm run ai:probe` / `ai:calibrate` / `ai:vector` | Bedrock reachability · threshold · index selection |
| `npm run test:isolation` / `test:tiers` | Tenant isolation · model tier routing |
| `npm run continuity` / `mcp` / `pipeline` | ccloud preflight · MCP tools · async pipeline health |

Frontend: `cd web && npm install && npm run dev`

---

## Run the whole stack on your own infrastructure

The commands at the top use our deployment. This is the path if you want to
change the mechanism rather than call it: your own CockroachDB cluster, your own
Bedrock access, your own Lambda.

Requires Node 20+, a CockroachDB Cloud cluster (**v25.2 or newer** — below that
there is no vector index), and AWS credentials with Bedrock access.
**[SETUP.md](SETUP.md)** walks through obtaining every credential step by step.

```bash
cp .env.example .env.local                # then fill it in — see SETUP.md
npm run db:migrate && npm run db:verify   # schema, then proof it does what we claim
npm run demo                              # the mechanism end to end, locally
npm run api:deploy && npm run deploy      # your own API and site
```

---

## Using it from your own agents

**Full API reference: [docs/API.md](docs/API.md).**

INTERLOCK is a service, not a framework. Your agents keep their own models, prompts and tools; it arbitrates the shared state and nothing else.

Worth being explicit about what that means commercially, because it decides whether this fits your architecture:

- **We run the inference.** You do not bring a model or a model key. When a commit threatens an in-flight plan, we call Bedrock on our account to judge whether the plan actually broke. You are metered, not billed.
- **We never see your agent's reasoning** — only a one-sentence intent, a read-set, and a step list.
- **Most conflicts never reach a model.** The provenance graph settles them for free; a ruling with `model: "provenance-graph"` cost nothing.
- **You can choose who rules.** `adjudicator: "bulk" | "adjudicator"` on a commit, named by role rather than model id. `GET /v1/health` publishes what is available. Unknown values are refused rather than silently downgraded.
- **This is not an inference proxy.** If you want somewhere to run your model calls, this is the wrong service.

```js
import { Interlock } from "./sdk/client.js";

const { key } = await Interlock.issueKey({ name: "My Fleet" });
const il = new Interlock({ apiKey: key });

const agent = await il.registerAgent({ name: "Scheduler" });
const queue = await il.registerResource({ key: "support-eu", body: { depth: 118 } });

// 1. say what you are about to do, before you do it
const { intent } = await il.declare({
  agentId: agent.id,
  statement: "Rebalance the EU queue and page a second responder.",
  reads: [{ resourceId: queue.id, observedVersion: queue.version }],
});

// 2. commit through us
const { adjudications } = await il.commit({
  agentId: agent.id,
  intentId: intent.id,
  resourceId: queue.id,
  body: { depth: 131 },
  statement: "Depth rose to 131.",
});

// 3. act on the ruling — it names which steps died, not just that something did
for (const a of adjudications) {
  if (a.verdict === "invalidating") redo(a.affectedSteps);
}
```

The client is dependency-free `fetch`: Node, Deno, Bun, workers, browsers.

### LangChain

A LangChain agent already tells its callbacks what it is about to do. That is precisely what INTERLOCK needs, so the integration is a callback rather than a rewrite:

```js
import { InterlockCallback } from "./sdk/langchain.js";

const guard = new InterlockCallback({ apiKey, agentId, resources });
await executor.invoke(input, { callbacks: [guard] });

if (guard.wasInvalidated) redo(guard.stepsToRedo);
```

Tool calls are recorded as plan steps as they happen, which is what lets a conflict be repaired at step granularity instead of throwing the task away. Run `npm run example:langchain` to watch two agents contend over one queue.

If declaring fails, the callback warns and lets the run continue. A guard that breaks the run it is guarding is worse than no guard.

---

## Honest limitations

Stated here rather than buried, because a reproducible benchmark is only a strength if we stand behind what it prints.

1. **INTERLOCK loses below the crossover.** Around 3.3k tokens of reasoning per task it costs 3.57× against optimistic concurrency's 2.04×. That is a real result and it is published above rather than tuned away.
2. **The workload's dependency fraction and pass count are parameters we chose.** The first version had every step depend on the contended value — the worst possible case, and unrepresentative. Both are now explicit and swept, but they are still our choices, and the whole curve including the losing region is published so the choice is inspectable.
3. **The vector index is selected only above a few thousand in-flight plans.** It is a *partial* index covering plans still in flight, because semantic detection never asks about resolved ones. At 1,695 live plans in a tenant the planner picks it — `npm run ai:vector` prints the plan and the tenant it probed. Below that a scan genuinely wins and CockroachDB is right to prefer it, so `npm run db:verify` also *forces* the index, which is the only way to tell one that is resting from one that is dead.

   We have had both kinds of dead. The index was built for L2 while every query asked in cosine (migration 007). Once fixed, it was selected only for unfiltered queries nothing in this system runs (migration 010). And then the corpus seeded to prove it works was written with status `aborted`, which put all 1,741 rows *outside* the partial index — every statement true, conclusion still wrong.
4. **We cannot take down a managed region.** See the chaos drill section for exactly which half of the guarantee is tested here.
5. **Energy figures are estimates.** A single coefficient (Wh per 1k tokens) is applied uniformly to every mode. The absolute number may be wrong; the *comparison* stays valid because every mode is multiplied by the same figure. Override with `ENERGY_WH_PER_1K_TOKENS`.

---

## Provenance and disclosures

The rules require entrants to disclose *"any other pre-existing code or work
incorporated into the Project"*, and separately permit *"standard development
tools, including frameworks, libraries, starter templates, and AI coding
assistants"*. Both, in full:

- **Nothing predates the submission period.** There is no earlier codebase
  underneath this one, and no pre-existing code or work was incorporated. That
  is the disclosure the rules ask for, and the answer is none.
- **Original work, solely owned.** Every design decision, the benchmark
  methodology, and every published figure was made and verified by the entrant
  against a live cluster. Standard development tooling was used throughout,
  including an AI coding assistant — explicitly permitted, and noted here
  because this project publishes what it did rather than only what flatters it.
- **CockroachDB Agent Skills were consumed** for schema and index design, as the
  hackathon intends. `skills/managing-long-running-agent-transactions/` is ours,
  written in return; it ships here and is **not** upstream.
- **Prior art is cited, not incorporated.** The baseline figures in the benchmark
  are CoAgent's published numbers ([arXiv:2606.15376]), labelled `published`
  wherever they appear and kept visually distinct from figures our own harness
  produced. No code from any cited paper is used.
- **Dependencies** are standard open-source packages under permissive licences —
  `pg`, `@aws-sdk/*`, `@langchain/core`, Next.js, React, Tailwind. See
  `package.json` and `web/package.json`.

[arXiv:2606.15376]: https://arxiv.org/abs/2606.15376

## Availability for judging

The demo and API are free, unauthenticated where it matters, and stay up through
the judging period. `npm run submission:check` verifies from outside — the site,
the API, the budget, the full declare→commit→ruling loop, and that the public
repo is current — and exits non-zero if a judge would hit a failure.

Ceilings are set far above anything judging can produce and are visible on
`GET /v1/health`:

| Scope | Ceiling | Roughly |
|---|---|---|
| Anonymous, per address | 3,000 calls · $10/day | more than a person can click |
| Per key, per tenant | 10,000 calls · $25/day | more than a fleet needs |
| Everyone, per day | $50 | ~25,000 adjudications |
| **Everyone, per month** | **$25** | **~12,000 adjudications** |

The monthly figure is the one that bounds a bill, and it is deliberately the
tightest. Daily caps reset, so on their own they bound nothing anybody is ever
charged for — $50 a day is $1,500 a month, and each day would report itself as
working the whole way. Judging realistically costs a few dollars: a hundred
judges running the demo twenty times each is about $4.

They are not removed, and that is deliberate. `/v1/demo` and `/v1/keys` are
unauthenticated so anyone can evaluate this without asking permission, which
means a crawler has the same access a judge does. A ceiling nobody legitimate
can reach costs nothing; no ceiling at all is an unbounded bill with nobody
watching it for a month.

This is enforcement rather than warning — every Bedrock call goes through the
handler that checks it. AWS Budgets, by comparison, only email. `GET /v1/health`
and `POST /v1/keys` keep working if a ceiling is reached, and the 429 says which
one and when it resets.

## References

- **CoAgent: Concurrency Control for Multi-Agent Systems** — [arXiv:2606.15376](https://arxiv.org/abs/2606.15376). Source of the baseline figures and of the core idea that an LLM can judge whether a conflicting write invalidates its plan.
- **ATM: CID-Brokered Pre-Write Admission for Multi-Agent Code Co-Synthesis** — [arXiv:2607.00041](https://arxiv.org/pdf/2607.00041)
- **Verified Detection and Prevention of Concurrency Anomalies in Multi-Agent LLM Systems** — [arXiv:2606.17182](https://arxiv.org/pdf/2606.17182)
- **Early Diagnosis of Wasted Computation in Multi-Agent LLM Systems** — [arXiv:2606.01365](https://arxiv.org/html/2606.01365v2)

CoAgent published the algorithm. This is an independent open-source implementation on a serializable distributed database, benchmarked against its reported numbers.

## License

MIT — see [LICENSE](LICENSE).
