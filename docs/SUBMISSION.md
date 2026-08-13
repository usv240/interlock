# Devpost submission — INTERLOCK

Paste-ready. Every number here is reproducible from the repo.

---

## Tagline

**Agent memory that lets parallel agents think for 40 seconds without corrupting each other's work.**

---

## Links

| Field | Value |
|---|---|
| Repository | https://github.com/usv240/interlock |
| Demo | https://d3dgn014prmcy8.cloudfront.net |
| Public API | https://wpvk3ox2bxo2w3zhxmx54ssjf40rakuz.lambda-url.us-east-1.on.aws/ |
| Video | *(paste after upload)* |
| Licence | MIT — detected in the repo About panel |

---

## Inspiration

An LLM agent's unit of work is not a database transaction. It **reads** shared memory, **thinks for forty seconds**, then **acts** — and the world changed while it was thinking.

Measured across ten contended workloads ([CoAgent, arXiv:2606.15376](https://arxiv.org/abs/2606.15376)), the standard fix runs at **0.93× the speed of running agents one at a time, at 1.83× the token cost.** Running agents in parallel today is *slower than not parallelising at all*, and you pay nearly double for the privilege.

Meanwhile parallel agents are shipping at scale, and the industry's answer to shared-state conflict is a **git worktree and a merge conflict**.

The insight the paper points at, and nobody had built: **most conflicts are semantically irrelevant.** An agent can read the conflicting write and judge whether it actually breaks its plan. A real conflict needs repair of only the *dependent steps*.

## What it does

INTERLOCK is optimistic concurrency where **validation is reasoning instead of a version check**, and **abort is a surgical repair instead of a rollback**.

1. **Declare** — an agent writes its plan and read-set before acting, as text *and* a 1024-dim embedding
2. **Watch** — when a commit lands, three paths in one query find who is threatened: exact row overlap, a recursive provenance walk, and an ANN search over intent embeddings that catches plans sharing *meaning* but no rows
3. **Diff** — `AS OF SYSTEM TIME` replays the exact snapshot the agent read
4. **Adjudicate** — the provenance graph rules first, for free; only its candidates reach a model
5. **Resolve** — the ruling is recorded exactly once, and only dependent steps are repaired

Correctness never rests on the model's judgement: the final write is a real `SERIALIZABLE` transaction, so a wrong ruling costs wasted work, not a lost update.

It runs as a **public API with self-serve keys and tenant isolation** — point your own fleet at it.

## How we built it

**CockroachDB — all four tools, none decorative**

| Tool | What the agent does with it |
|---|---|
| **Distributed Vector Indexing** | C-SPANN indexes over intent, commit and step embeddings. Detects plans threatened by meaning. Threshold **measured, not guessed** (`npm run ai:calibrate`) |
| **Managed MCP Server** | Read-only, audit-logged auditor console. Investigation is inherently read-only, so safe-by-default is exactly right |
| **ccloud / Cloud API** | A continuity agent that refuses to let a cascade run if the cluster is not actually configured to survive a region |
| **Agent Skills** | Consumed for schema design; contributed `managing-long-running-agent-transactions` back, including the traps that cost us real time |

Plus **changefeeds**, **row-level TTL**, **`REGIONAL BY TABLE` localities**, and a **3-region `SURVIVE REGION FAILURE`** database.

**AWS — only what we actually run on**

Bedrock (Titan embeddings + Claude across three tiers with cost-aware routing) · Lambda (public API + SQS worker) · EventBridge + SQS (async adjudication with DLQ) · S3 + CloudFront (static demo, private origin via OAC) · CloudWatch · IAM (five specific model ARNs, not `bedrock:*`).

We deliberately **removed** ECS Fargate from our claims — we designed for it and never wired it, and *"meaningfully integrated, not just initialized"* is a pass/fail rule.

## Challenges we ran into

Four bugs found by measurement, all documented in the source:

- **A cosine/L2 mismatch silently disabled semantic detection.** The threshold was scaled for cosine, the operator was L2. Real conflicts measure 0.52 in cosine and 1.02 in L2, so the vector path never once fired — and the "detected by both" label hid it.
- **`INT8` arrives as a string** in node-postgres, so `version + 1` produced `"11"` from `"1"` — silently, with a plausible-looking result. The guard we added then threw on CockroachDB's own job IDs (~1.2e18); it now returns BigInt.
- **Changefeeds do an initial scan by default**, so the first run re-adjudicated all of history: 22 batches, 25,000 tokens. Nothing broke, because the unique index made every replayed ruling a no-op — but it was real money on a no-op.
- **`us.` inference profiles dispatch cross-region.** A least-privilege policy allowing only `us-east-1` model ARNs is denied naming `us-east-2`.

## Accomplishments we're proud of

**We published where it loses.** Below ~15k tokens of reasoning per task, adjudicating costs more than retrying — so don't use this, just retry. That region is shaded on the chart rather than cropped out. Above it: **1.28× cost against optimistic concurrency's 2.01×**, with **zero lost updates at every point in every mode**.

**Exactly-once is structural, not conventional.** A `UNIQUE (commit_id, intent_id)` index means a double-apply fails loudly. It survived a chaos drill that destroys every in-flight connection mid-adjudication — 12 kill waves, all four invariants held — and then paid for itself a second time by making SQS's at-least-once delivery safe with no extra code.

**Tenant isolation is proven, not asserted.** `npm run test:isolation` runs two tenants whose intents measure **cosine distance 0.0000** — identical text the vector path would certainly have matched across tenants had the filter been outside the query.

## What we learned

The economics are the opposite of what the pitch assumed. Adjudication costs roughly a fixed amount per conflict; re-running a task costs in proportion to how much reasoning it discards. So the honest claim is a **regime**, not a win — and finding the crossover took three legitimate optimisations and one workload redesign, all published.

## What's next

Step-level semantic matching (the plumbing exists, off by default because it costs more than it returns on the hot path); a first-class SDK; and adjudicator distillation, since the graph pre-filter already narrows the question far enough that a much smaller model should suffice.

---

## Judging-criteria checklist

| Criterion | Evidence |
|---|---|
| **Agentic Memory Design** | Memory as a concurrency substrate: intents, read-sets, provenance graph, embeddings, MVCC snapshots, bitemporal validity. 6 migrations, 14 tables, 3 vector indexes, 3-region topology |
| **Technological Implementation** | Recursive CTE ⨝ ANN ⨝ time-travel in one serializable transaction; async pipeline with DLQ and partial-batch failure; 4 documented bug hunts |
| **Real-World Impact** | Public API with self-serve keys and proven tenant isolation. Published crossover so adopters know when *not* to use it |
| **Product Readiness** | 3 regions + `SURVIVE REGION FAILURE`; chaos drill; exactly-once by constraint; DB-backed spend ceiling; least-privilege IAM with explicit denies; credential rotation script; `npm run pipeline` health check |
| **Creativity & Originality** | First open-source implementation of semantic concurrency control, benchmarked against the paper's own numbers |

## Feedback on the CockroachDB AI tools

- The **managed MCP server accepting a service-account API key** as a bearer token — not just OAuth — is what made a headless auditor console possible. Worth documenting more prominently; the console only shows the OAuth flow.
- `CREATE CHANGEFEED` defaulting to an **initial scan** is the correct default for replication and an expensive one for event-driven work. A louder warning in the docs would have saved us 25,000 tokens.
- Vector index selection is (correctly) row-count dependent, which makes "is my index working?" hard to answer early. A `SHOW VECTOR INDEX` diagnostic would help.
- `ADD REGION IF NOT EXISTS` being idempotent while `SET PRIMARY REGION` is not made writing a re-runnable migration slightly awkward.
