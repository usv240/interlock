# INTERLOCK

**Agent memory that lets parallel agents think for 40 seconds without corrupting each other's work.**

Built on CockroachDB and AWS for the *Build with Agentic Memory* hackathon.

🔗 **Live demo:** https://d3dgn014prmcy8.cloudfront.net
🔌 **Public API:** `https://wpvk3ox2bxo2w3zhxmx54ssjf40rakuz.lambda-url.us-east-1.on.aws/`

```bash
# Run a real adjudication against the production cluster
curl -s -X POST https://wpvk3ox2bxo2w3zhxmx54ssjf40rakuz.lambda-url.us-east-1.on.aws/v1/demo \
  -H 'content-type: application/json' -d '{}'
```

INTERLOCK runs as a **service**, not only a demonstration. Point your own agent
fleet at it: declare intents before acting, commit through the API, act on the
ruling. Your agents keep their own reasoning and tools; INTERLOCK arbitrates
only the shared state.

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
12 kill waves | 6 commits | 6 tasks completed | 0 abandoned

PASS  exactly-once adjudication (0 duplicate pairs)
PASS  no orphaned repairs (0)
PASS  counter balances: 6 increments for 6 commits
PASS  nothing stuck mid-flight (0 threatened)
```

**What this proves and what it does not.** CockroachDB Basic is managed, so we cannot take a region offline, and a script claiming to would be theatre. The database's half — surviving region loss — is a configuration property, verified declaratively (`3 regions, survival goal = region`). *Our* half — behaving correctly when the database becomes unreachable mid-decision — is what the drill attacks, because from an application's point of view a region loss *is* connections dying mid-flight.

Exactly-once is structural, not conventional: a `UNIQUE` index on `(commit_id, intent_id)` means a double-apply fails loudly rather than quietly recording two verdicts for one conflict.

---

## CockroachDB tools used — all four

| Tool | What the agent actually does with it |
|---|---|
| **Distributed Vector Indexing** | C-SPANN indexes over `intent`, `commit_log`, `plan_step` embeddings. Detects plans threatened by *meaning* when they share no rows. Threshold is measured, not guessed — `npm run ai:calibrate`. |
| **Managed MCP Server** | Read-only, audit-logged console for inspecting live conflicts. Investigation is inherently read-only, so the safe-by-default posture is exactly right. |
| **ccloud CLI** | Continuity agent: inspects regions, reads the GC window that bounds time-travel reach, snapshots before adjudication cascades. |
| **Agent Skills Repo** | Consumed for schema and index design; one skill contributed back upstream. |

## AWS services used

Only the services this project actually runs on. An earlier draft of this table
also listed EventBridge, SQS and ECS Fargate — designed for, never wired. Since
the rules require components to be *"meaningfully integrated, not just
initialized"*, claiming five services we use beats eight we half-use.

| Service | Role |
|---|---|
| **Amazon Bedrock** | Titan Text Embeddings V2 (1024-dim) for the vector path; Claude across three tiers with cost-aware routing. Adjudication runs on the cheap tier because the provenance graph has already narrowed the question. Every call's tokens land in the ledger. |
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

## Setup

Requires Node 20+, a CockroachDB Cloud cluster (**v25.2 or newer** — below that there is no vector index), and AWS credentials with Bedrock access.

```bash
git clone <repo> && cd interlock
npm install
cp .env.example .env.local     # then fill it in — see SETUP.md
```

`SETUP.md` walks through obtaining every credential step by step.

```bash
npm run db:migrate    # schema, vector indexes, multi-region topology
npm run db:verify     # proves serializable, 3 regions, time travel, vector index
npm run ai:probe      # confirms every Bedrock tier is reachable
npm run demo          # end-to-end walkthrough of the mechanism
```

### Everything you can run

| Command | Purpose |
|---|---|
| `npm run db:check` | Connectivity + capability probe |
| `npm run db:verify` | Proves the four claims this project rests on |
| `npm run db:migrate` / `db:reset` | Apply / rebuild schema |
| `npm run ai:probe` | All Bedrock tiers + accounting |
| `npm run ai:calibrate` | Measures the semantic threshold from real embeddings |
| `npm run ai:vector` | Shows whether the planner picks the vector index |
| `npm run demo` | The mechanism, end to end |
| `npm run bench` | Four modes, one workload |
| `npm run bench:sweep` | The crossover curve |
| `npm run chaos` | Connection-severing resilience drill |

Frontend: `cd web && npm install && npm run dev`

---

## Honest limitations

Stated here rather than buried, because a reproducible benchmark is only a strength if we stand behind what it prints.

1. **INTERLOCK loses below the crossover.** Around 3.3k tokens of reasoning per task it costs 3.57× against optimistic concurrency's 2.04×. That is a real result and it is published above rather than tuned away.
2. **The workload's dependency fraction and pass count are parameters we chose.** The first version had every step depend on the contended value — the worst possible case, and unrepresentative. Both are now explicit and swept, but they are still our choices, and the whole curve including the losing region is published so the choice is inspectable.
3. **The vector index is not always selected by the planner.** At small row counts a full scan is genuinely cheaper, and CockroachDB correctly prefers it. `npm run ai:vector` prints the plan either way rather than asserting.
4. **We cannot take down a managed region.** See the chaos drill section for exactly which half of the guarantee is tested here.
5. **Energy figures are estimates.** A single coefficient (Wh per 1k tokens) is applied uniformly to every mode. The absolute number may be wrong; the *comparison* stays valid because every mode is multiplied by the same figure. Override with `ENERGY_WH_PER_1K_TOKENS`.

---

## References

- **CoAgent: Concurrency Control for Multi-Agent Systems** — [arXiv:2606.15376](https://arxiv.org/abs/2606.15376). Source of the baseline figures and of the core idea that an LLM can judge whether a conflicting write invalidates its plan.
- **ATM: CID-Brokered Pre-Write Admission for Multi-Agent Code Co-Synthesis** — [arXiv:2607.00041](https://arxiv.org/pdf/2607.00041)
- **Verified Detection and Prevention of Concurrency Anomalies in Multi-Agent LLM Systems** — [arXiv:2606.17182](https://arxiv.org/pdf/2606.17182)
- **Early Diagnosis of Wasted Computation in Multi-Agent LLM Systems** — [arXiv:2606.01365](https://arxiv.org/html/2606.01365v2)

CoAgent published the algorithm. This is an independent open-source implementation on a serializable distributed database, benchmarked against its reported numbers.

## License

MIT — see [LICENSE](LICENSE).
