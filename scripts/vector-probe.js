/**
 * Is the C-SPANN vector index actually being used?
 *
 * The landing page claims semantic conflict detection runs on a distributed
 * vector index. An empty table would make the planner ignore that index and
 * full-scan instead, so this only means anything once real embeddings exist.
 *
 * Prints the query plan and the nearest neighbours so the claim is inspectable
 * rather than asserted. Run after `npm run demo`: npm run ai:vector
 */
import { query, closePool } from "../agents/db.js";
import { embed } from "../agents/bedrock.js";

const ok = (s) => `\x1b[32m/\x1b[0m ${s}`;
const warn = (s) => `\x1b[33m!\x1b[0m ${s}`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const { rows: counts } = await query(`
  SELECT
    (SELECT count(*) FROM intent)                             AS intents,
    (SELECT count(*) FROM intent WHERE embedding IS NOT NULL) AS intent_vecs,
    (SELECT count(*) FROM commit_log WHERE embedding IS NOT NULL) AS commit_vecs,
    (SELECT count(*) FROM plan_step WHERE embedding IS NOT NULL)  AS step_vecs
`);
const c = counts[0];
console.log(
  `rows with embeddings - intents ${c.intent_vecs}/${c.intents} | commits ${c.commit_vecs} | steps ${c.step_vecs}`,
);

if (Number(c.intent_vecs) === 0) {
  console.log(warn("no embeddings yet - run `npm run demo` first"));
  await closePool();
  process.exit(0);
}

const probeText = "rebalance the EU support queue for the overnight shift";
const { literal } = await embed(probeText);

console.log(`\n\x1b[1mQuery plan\x1b[0m ${dim(`ORDER BY embedding <=> '${probeText}'`)}`);
// Asked with the predicate findThreatened uses. An unfiltered probe answers a
// question nobody asks: measured on this cluster, the old full-table index was
// selected with no WHERE clause and abandoned the moment one was added.
const plan = await query(
  `EXPLAIN SELECT id FROM intent
   WHERE tenant_id IS NOT DISTINCT FROM NULL
     AND status IN ('open','threatened')
     AND embedding IS NOT NULL
   ORDER BY embedding <=> $1::VECTOR
   LIMIT 5`,
  [literal],
);
const planText = plan.rows.map((r) => Object.values(r)[0]).join("\n");
console.log(
  planText
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n"),
);

// Matched on the plan operator rather than an index name. This probe looked for
// `intent_embedding_idx` long after migration 007 renamed it, so it reported
// "not selected" on every single run — including runs whose plan plainly showed
// a vector search. That false negative was published as a caveat for a while.
// A check that can only fail is not a check.
const usesIndex = /vector search/.test(planText);
console.log(
  usesIndex
    ? ok("planner selected the vector index")
    : warn(
        "planner did NOT select the vector index. The index covers in-flight plans\n" +
          "  only, and below a few thousand of those a scan is genuinely cheaper - so\n" +
          "  this is correct behaviour, not a failure. `npm run db:verify` forces the\n" +
          "  index to prove it can still serve the query.",
      ),
);

console.log(`\n\x1b[1mNearest intents by meaning\x1b[0m`);
const { rows: near } = await query(
  `SELECT left(statement, 62) AS s,
          round((embedding <=> $1::VECTOR)::numeric, 4) AS dist,
          status
   FROM intent
   WHERE embedding IS NOT NULL
   ORDER BY embedding <=> $1::VECTOR
   LIMIT 5`,
  [literal],
);
for (const r of near) {
  console.log(
    `  ${String(r.dist).padEnd(8)} ${dim(String(r.status).padEnd(12))} ${r.s}...`,
  );
}

console.log(
  dim(
    "\nDistance is cosine (<=>), matching SEMANTIC_THRESHOLD. Anything at or\n" +
      "below the threshold is worth adjudicating.",
  ),
);

await closePool();
