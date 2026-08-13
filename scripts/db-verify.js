/**
 * Proves the four claims the project rests on, against the live cluster.
 *
 * Every one of these is something the landing page asserts, so each should be
 * reproducible by anyone who clones the repo rather than taken on trust:
 *
 *   1. Isolation really is SERIALIZABLE (inherited, not implemented)
 *   2. The database is multi-region and survives losing a region
 *   3. AS OF SYSTEM TIME reads real historical rows — not just constants
 *   4. The C-SPANN vector index is actually chosen by the planner
 *
 * Run: npm run db:verify
 */
import pg from "pg";
import { requireEnv } from "./env.js";

const { Client } = pg;

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const warn = (s) => `\x1b[33m!\x1b[0m ${s}`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const head = (s) => `\n\x1b[1m${s}\x1b[0m`;

let failures = 0;
const check = (pass, msg) => {
  console.log(pass ? ok(msg) : bad(msg));
  if (!pass) failures++;
};

const client = new Client({
  connectionString: requireEnv("DATABASE_URL"),
  application_name: "interlock-verify",
});

async function main() {
  await client.connect();
  await client.query("SET database = interlock");

  /* 1 — isolation ------------------------------------------------------ */
  console.log(head("1. Isolation"));
  const { rows: iso } = await client.query("SHOW default_transaction_isolation");
  const level = iso[0].default_transaction_isolation;
  check(
    level.toLowerCase() === "serializable",
    `default_transaction_isolation = ${level}`,
  );
  console.log(
    dim("   PostgreSQL defaults to read committed. Lost updates are impossible"),
  );
  console.log(dim("   here because the database refuses them, not because we do."));

  /* 2 — multi-region ---------------------------------------------------- */
  console.log(head("2. Multi-region topology"));
  const { rows: regions } = await client.query("SHOW REGIONS FROM DATABASE interlock");
  check(regions.length >= 3, `${regions.length} regions on the database`);
  for (const r of regions) {
    console.log(dim(`   ${r.region}${r.primary ? "  (primary)" : ""}`));
  }
  console.log(
    dim("   Three is the minimum for SURVIVE REGION FAILURE — with two there is"),
  );
  console.log(dim("   no quorum left when one dies."));

  const { rows: surv } = await client.query(
    "SELECT survival_goal FROM [SHOW DATABASES] WHERE database_name = 'interlock'",
  );
  const goal = surv[0]?.survival_goal ?? "(none)";
  check(goal === "region", `survival goal = ${goal}`);

  const { rows: loc } = await client.query(`
    SELECT table_name, locality
    FROM [SHOW TABLES FROM interlock]
    WHERE table_name IN ('agent','resource','intent','adjudication','bench_run')
    ORDER BY table_name
  `);
  console.log(dim("   per-table locality:"));
  for (const t of loc) {
    console.log(dim(`     ${t.table_name.padEnd(14)} ${t.locality}`));
  }

  /* 3 — time travel over real rows -------------------------------------- */
  console.log(head("3. AS OF SYSTEM TIME over real rows"));
  console.log(
    dim("   (a constant SELECT proves nothing — this writes, waits, overwrites,"),
  );
  console.log(dim("    then reads the past and checks it sees the OLD value)"));

  await client.query(`
    INSERT INTO resource (kind, ext_key, body, version)
    VALUES ('probe', 'aost-probe', '{"state":"before"}'::JSONB, 1)
    ON CONFLICT (kind, ext_key)
    DO UPDATE SET body = '{"state":"before"}'::JSONB, version = 1, updated_at = now()
  `);

  const { rows: t0 } = await client.query(
    "SELECT cluster_logical_timestamp() AS hlc",
  );
  const hlc = t0[0].hlc;

  await new Promise((r) => setTimeout(r, 1200));

  await client.query(`
    UPDATE resource SET body = '{"state":"after"}'::JSONB, version = 2
    WHERE kind = 'probe' AND ext_key = 'aost-probe'
  `);

  const { rows: now } = await client.query(
    "SELECT body->>'state' AS s FROM resource WHERE kind='probe' AND ext_key='aost-probe'",
  );
  const { rows: past } = await client.query(
    `SELECT body->>'state' AS s FROM resource AS OF SYSTEM TIME ${hlc}
     WHERE kind='probe' AND ext_key='aost-probe'`,
  );

  check(now[0].s === "after", `present reads "${now[0].s}"`);
  check(
    past[0]?.s === "before",
    `AS OF SYSTEM TIME reads "${past[0]?.s ?? "(nothing)"}" — the pre-update value`,
  );

  // How far back can we actually go? This is the GC window, and it bounds how
  // much history the adjudicator can diff against.
  let reach = "unknown";
  for (const iv of ["-1m", "-10m", "-1h", "-4h", "-8h", "-24h", "-72h"]) {
    try {
      await client.query(
        `SELECT count(*) FROM resource AS OF SYSTEM TIME '${iv}'`,
      );
      reach = iv;
    } catch {
      break;
    }
  }
  console.log(
    reach === "unknown"
      ? warn("   could not establish GC reach")
      : ok(`   historical reach on a real table: ${reach}`),
  );

  await client.query(
    "DELETE FROM resource WHERE kind='probe' AND ext_key='aost-probe'",
  );

  /* 4 — is the vector index actually used? ------------------------------ */
  console.log(head("4. C-SPANN vector index"));
  const zeros = `[${Array(1024).fill(0).join(",")}]`;
  const { rows: plan } = await client.query(
    `EXPLAIN SELECT id FROM intent ORDER BY embedding <-> '${zeros}' LIMIT 5`,
  );
  const planText = plan.map((r) => Object.values(r)[0]).join("\n");
  const usesIndex = /intent_embedding_idx|vector/i.test(planText);
  check(usesIndex, "planner selects the vector index for a nearest-neighbour scan");
  console.log(
    dim(
      planText
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, 6)
        .map((l) => `   ${l}`)
        .join("\n"),
    ),
  );

  /* summary ------------------------------------------------------------- */
  console.log(
    failures === 0
      ? `\n${ok("all checks passed")}`
      : `\n${bad(`${failures} check(s) failed`)}`,
  );

  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(bad(e.message));
  try {
    await client.end();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
