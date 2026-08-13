/**
 * INTERLOCK as a service.
 *
 * A Lambda function URL exposing the mechanism over HTTP, so an agent fleet
 * that is not this one can use it as its concurrency layer:
 *
 *   GET  /v1/health          preflight: topology, survival goal, quota left
 *   POST /v1/demo            run a scripted conflict end to end, return the trace
 *   POST /v1/intents         declare an intent before acting
 *   POST /v1/commits         commit a change; returns rulings on anyone threatened
 *   GET  /v1/adjudications   recent rulings (read-only audit feed)
 *
 * SPENDING SOMEONE ELSE'S MONEY
 * This endpoint is unauthenticated so judges and passers-by can try it, which
 * means strangers can spend our inference budget. Per-instance rate limiting
 * would not help: Lambda instances are ephemeral and concurrent, so in-memory
 * counters undercount by exactly the factor that matters during a flood.
 *
 * So the ceiling lives in the database, incremented inside a SERIALIZABLE
 * transaction. It is the same guarantee this product exists to provide, turned
 * on its own operating costs -- which felt like the honest way to build it.
 */
import { query, serializableTx, closePool } from "../agents/db.js";
import { Usage } from "../agents/bedrock.js";
import {
  declareIntent,
  commitResource,
  processCommit,
} from "../agents/interlock.js";
import { preflight } from "../agents/continuity.js";
import { runStreamingDemo } from "./stream.js";
import { resolveCaller, issueKey } from "../agents/auth.js";
import { handleChangefeed } from "./cdc.js";
import { createHash, randomUUID } from "node:crypto";

/** Hard daily ceilings. Breaching either returns 429, never a surprise bill. */
const DAILY_CALL_LIMIT = Number(process.env.DAILY_CALL_LIMIT ?? 400);
const DAILY_USD_LIMIT = Number(process.env.DAILY_USD_LIMIT ?? 3);
/** Single switch to take the endpoint down without a redeploy. */
const ENABLED = process.env.API_ENABLED !== "0";

const CORS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json", ...CORS },
  body: JSON.stringify(body),
});

/** Never log or store a raw client IP; a truncated hash is enough to rate limit. */
const clientHash = (event) => {
  const ip = event?.requestContext?.http?.sourceIp ?? "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
};

/* -------------------------------------------------------------------------- */
/* Quota                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Atomically check and reserve quota.
 *
 * The check and the increment happen in one serializable transaction, so two
 * concurrent requests cannot both observe "one call left" and both proceed.
 */
async function reserveQuota(bucket, limits = {}) {
  const callLimit = limits.callLimit ?? DAILY_CALL_LIMIT;
  const usdLimit = limits.usdLimit ?? DAILY_USD_LIMIT;

  const { result } = await serializableTx(
    async (client) => {
      const { rows } = await client.query(
        `INSERT INTO api_quota (day, bucket, calls)
         VALUES (current_date(), $1, 0)
         ON CONFLICT (day, bucket) DO UPDATE SET updated_at = now()
         RETURNING calls, usd_micros`,
        [bucket],
      );

      const calls = Number(rows[0].calls);
      const usd = Number(rows[0].usd_micros) / 1e6;

      if (calls >= callLimit) {
        return { allowed: false, reason: "daily call limit", calls, usd };
      }
      if (usd >= usdLimit) {
        return { allowed: false, reason: "daily spend limit", calls, usd };
      }

      await client.query(
        `UPDATE api_quota SET calls = calls + 1, updated_at = now()
         WHERE day = current_date() AND bucket = $1`,
        [bucket],
      );

      return {
        allowed: true,
        calls: calls + 1,
        usd,
        callsLeft: DAILY_CALL_LIMIT - calls - 1,
      };
    },
    { label: "reserveQuota" },
  );
  return result;
}

async function recordSpend(bucket, usage) {
  const micros = Math.round(usage.usd * 1e6);
  await query(
    `UPDATE api_quota
     SET tokens = tokens + $2, usd_micros = usd_micros + $3, updated_at = now()
     WHERE day = current_date() AND bucket = $1`,
    [bucket, usage.tokensTotal, micros],
  );
  await query(
    `UPDATE api_quota
     SET tokens = tokens + $1, usd_micros = usd_micros + $2, updated_at = now()
     WHERE day = current_date() AND bucket = 'global'`,
    [usage.tokensTotal, micros],
  );
}

async function logRequest(route, hash, status, ms, tokens, detail = {}) {
  try {
    await query(
      `INSERT INTO api_request (route, client_hash, status, duration_ms, tokens, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [route, hash, status, ms, tokens, JSON.stringify(detail)],
    );
  } catch {
    /* never let telemetry failure break a response */
  }
}

/* -------------------------------------------------------------------------- */
/* The live demo                                                              */
/* -------------------------------------------------------------------------- */

async function ensureAgent(name, role) {
  const { rows } = await query(`SELECT id FROM agent WHERE name = $1`, [name]);
  if (rows[0]) return rows[0].id;
  const { rows: ins } = await query(
    `INSERT INTO agent (name, role, home_region) VALUES ($1,$2,'aws-us-east-1') RETURNING id`,
    [name, role],
  );
  return ins[0].id;
}

/**
 * One scripted conflict, run for real against the cluster.
 *
 * Nothing is mocked: real embeddings, a real serializable commit, a real
 * adjudication. The returned trace is the actual row contents, which is what
 * makes this a demo rather than an animation.
 */
async function runDemo(scenario = "queue") {
  const usage = new Usage("public-demo");
  const trace = [];
  const t0 = Date.now();

  const planner = await ensureAgent("Scheduler", "capacity-planner");
  const router = await ensureAgent("Triage", "ticket-router");

  // Retire intents left open by earlier demo runs.
  //
  // Without this, every previous run's Scheduler intent stays 'open' and gets
  // re-detected by the semantic path on each new run — correctly, since they
  // genuinely are near-identical plans. The rulings are right but the trace
  // becomes unreadable, and a demo whose output grows with its own history is
  // a demo nobody can follow.
  await query(
    `UPDATE intent SET status = 'aborted', resolved_at = now(), valid_to = now()
     WHERE agent_id = $1 AND status IN ('open','threatened','repairing')`,
    [planner],
  );

  const key = `demo-${randomUUID().slice(0, 8)}`;
  const { rows: res } = await query(
    `INSERT INTO resource (kind, ext_key, body) VALUES ('queue', $1, $2) RETURNING id, version`,
    [key, JSON.stringify({ open_tickets: 118, staffed: 6 })],
  );
  const resource = res[0];

  trace.push({
    step: "setup",
    label: "Shared state created",
    detail: `queue/${key} at 118 open tickets, 6 staff (v${resource.version})`,
  });

  // --- 1. Declare ---------------------------------------------------------
  const intent = await declareIntent({
    agentId: planner,
    taskId: randomUUID(),
    statement:
      "Rebalance the EU support queue for the overnight shift: 118 open tickets against 6 staff, so move the overflow to the APAC rota and page a second responder.",
    reads: [{ resourceId: resource.id, observedVersion: resource.version }],
    steps: [
      { description: "Read current queue depth and staffing", dependsOn: [resource.id], tokensUsed: 1800 },
      { description: "Compute overflow above the per-responder threshold", dependsOn: [resource.id], tokensUsed: 3100 },
      { description: "Draft the APAC handover note listing which tickets move", dependsOn: [resource.id], tokensUsed: 5200 },
      { description: "Page a second overnight responder from the rota", tokensUsed: 2400 },
    ],
    usage,
  });

  trace.push({
    step: "declare",
    label: "Scheduler declares an intent",
    detail: "4 plan steps, 12,500 tokens of reasoning already spent",
    snapshot: intent.read_hlc,
    intentId: intent.id,
  });

  // --- 2. A conflicting commit -------------------------------------------
  const commit = await commitResource({
    agentId: router,
    resourceId: resource.id,
    expectedVersion: resource.version,
    newBody: JSON.stringify({ open_tickets: 131, staffed: 6 }),
    statement:
      "Reassign 13 escalated tickets from the US queue into the EU support queue, raising its depth to 131.",
    usage,
  });

  trace.push({
    step: "commit",
    label: "Triage commits into the same queue",
    detail: `depth 118 -> 131 (v${commit.prevVersion} -> v${commit.newVersion}), serializable`,
  });

  // --- 3-5. Watch, diff, adjudicate, resolve ------------------------------
  const outcomes = await processCommit(commit.commit.id, { usage });

  for (const o of outcomes) {
    trace.push({
      step: "adjudicate",
      label: `Ruling: ${o.verdict.toUpperCase()}`,
      detail: o.rationale,
      detectedBy: o.detectedBy,
      distance: o.distance == null ? null : Number(Number(o.distance).toFixed(3)),
      stepsRepaired: o.stepsRepaired,
      stepsPreserved: o.stepsPreserved,
      stepsTotal: o.stepsTotal,
    });
  }

  const repaired = outcomes.reduce((n, o) => n + o.stepsRepaired, 0);
  const preserved = outcomes.reduce((n, o) => n + o.stepsPreserved, 0);
  const u = usage.toJSON();

  // Close this run's intent so the next caller starts from a clean picture.
  await query(
    `UPDATE intent SET status = 'aborted', resolved_at = now(), valid_to = now()
     WHERE id = $1 AND status IN ('open','threatened','repairing')`,
    [intent.id],
  ).catch(() => {});

  return {
    ok: true,
    scenario,
    durationMs: Date.now() - t0,
    trace,
    summary: {
      stepsRepaired: repaired,
      stepsPreserved: preserved,
      preservedPct: repaired + preserved ? Math.round((preserved / (repaired + preserved)) * 100) : 0,
      note:
        "Under optimistic concurrency every step would have been discarded and re-run.",
    },
    cost: {
      calls: u.calls,
      tokensIn: u.tokensIn,
      tokensOut: u.tokensOut,
      usd: u.usd,
      energyWh: Number(u.energy.wh.toFixed(4)),
      gCO2e: Number(u.energy.gCO2e.toFixed(4)),
      assumption: u.energy.assumption,
    },
    usage,
  };
}

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Streaming variant, wrapped by the runtime's streamifyResponse.
 *
 * Buffered routes still work here: writing the whole body and ending is a
 * degenerate stream. So there is one entry point rather than two, and no route
 * has to know which mode it is running under.
 *
 * `awslambda` is a runtime-injected global, absent locally — hence the guard,
 * which also lets the same file be imported by tests.
 */
const streamify = globalThis.awslambda?.streamifyResponse;

async function handleStreamingDemo(event, responseStream) {
  const started = Date.now();
  const hash = clientHash(event);

  const quota = await reserveQuota(hash);
  if (!quota.allowed) {
    responseStream.write(
      JSON.stringify({
        t: "error",
        error: `Rate limited: ${quota.reason} reached.`,
        hint: "Limits exist so a public demo cannot run up an unbounded inference bill. Clone the repo to run it without limits.",
      }) + "\n",
    );
    responseStream.end();
    await logRequest("/v1/demo/stream", hash, 429, Date.now() - started, 0);
    return;
  }

  let usage = null;
  try {
    usage = await runStreamingDemo((ev) => {
      // Newline-delimited JSON: trivially parseable from a browser
      // ReadableStream, and readable with curl, which matters because the
      // README tells people to try it with curl.
      responseStream.write(JSON.stringify(ev) + "\n");
    });
  } catch (e) {
    responseStream.write(
      JSON.stringify({ t: "error", error: e.message?.slice(0, 300) }) + "\n",
    );
  } finally {
    responseStream.end();
  }

  if (usage) await recordSpend(bucket, usage);
  await logRequest(
    "/v1/demo/stream",
    hash,
    200,
    Date.now() - started,
    usage?.tokensTotal ?? 0,
  );
}

export const handler = streamify
  ? streamify(async (event, responseStream, _context) => {
      const method = event?.requestContext?.http?.method ?? "GET";
      const path = (event?.rawPath ?? "/").replace(/\/+$/, "") || "/";

      if (path === "/v1/demo/stream" && method === "POST") {
        const stream = globalThis.awslambda.HttpResponseStream.from(
          responseStream,
          {
            statusCode: 200,
            headers: {
              "content-type": "application/x-ndjson",
              ...CORS,
            },
          },
        );
        return handleStreamingDemo(event, stream);
      }

      // Everything else: run the buffered router and write its result out.
      const res = await bufferedHandler(event);
      const stream = globalThis.awslambda.HttpResponseStream.from(responseStream, {
        statusCode: res.statusCode,
        headers: res.headers,
      });
      stream.write(res.body);
      stream.end();
    })
  : bufferedHandler;

async function bufferedHandler(event) {
  const started = Date.now();
  const method = event?.requestContext?.http?.method ?? "GET";
  const path = (event?.rawPath ?? "/").replace(/\/+$/, "") || "/";
  const hash = clientHash(event);

  if (method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  if (!ENABLED) {
    return json(503, {
      ok: false,
      error: "The public endpoint is currently disabled.",
      hint: "The code and benchmarks remain reproducible locally: see the repository README.",
    });
  }

  try {
    /* --- health ---------------------------------------------------------- */
    if (path === "/v1/health" || path === "/") {
      const pre = await preflight();
      const { rows } = await query(
        `SELECT calls, usd_micros FROM api_quota
         WHERE day = current_date() AND bucket = 'global'`,
      );
      await logRequest(path, hash, 200, Date.now() - started, 0);
      return json(200, {
        ok: true,
        service: "interlock",
        safe: pre.safe,
        topology: {
          regions: pre.survivability.regions,
          primary: pre.survivability.primary,
          survivalGoal: pre.survivability.survivalGoal,
          timeTravelReach: pre.reach,
        },
        quota: {
          callsToday: Number(rows[0]?.calls ?? 0),
          callLimit: DAILY_CALL_LIMIT,
          usdToday: Number(rows[0]?.usd_micros ?? 0) / 1e6,
          usdLimit: DAILY_USD_LIMIT,
        },
        endpoints: [
          "GET  /v1/health",
          "POST /v1/keys           (self-serve, key shown once)",
          "POST /v1/demo",
          "POST /v1/demo/stream   (ndjson, shows the working)",
          "POST /v1/intents",
          "POST /v1/commits",
          "GET  /v1/adjudications",
        ],
      });
    }

    /* --- recent rulings (read-only, no quota) ---------------------------- */
    if (path === "/v1/adjudications" && method === "GET") {
      const { rows } = await query(
        `SELECT ag.name AS agent, a.verdict::STRING AS verdict, a.detected_by,
                a.steps_repaired, a.steps_total, a.decided_at,
                left(a.rationale, 160) AS rationale
         FROM adjudication a
         JOIN intent i ON i.id = a.intent_id
         JOIN agent ag ON ag.id = i.agent_id
         ORDER BY a.decided_at DESC LIMIT 20`,
      );
      await logRequest(path, hash, 200, Date.now() - started, 0);
      return json(200, { ok: true, adjudications: rows });
    }

    /* --- changefeed webhook: CockroachDB pushes commits here -------------- */
    if (path === "/v1/cdc" && method === "POST") {
      const res = await handleChangefeed(event);
      // Logged so `npm run pipeline` can see this hop. Without it the webhook
      // is the one link in the chain whose health is invisible.
      await logRequest("/v1/cdc", hash, res.statusCode, Date.now() - started, 0);
      return { ...res, headers: { ...CORS, "content-type": "text/plain" } };
    }

    /* --- self-serve key issuance ----------------------------------------- */
    if (path === "/v1/keys" && method === "POST") {
      // Rate limited by IP rather than by key: this is the endpoint you use
      // when you do not yet have one.
      //
      // Issuance is cheap — a row and a hash, no inference — so the limit only
      // needs to stop bulk tenant creation, not to ration. It was 5, which a
      // reader could exhaust by retyping a name and a shared office IP could
      // exhaust for everyone in it. The cost of being slightly too generous
      // here is a few unused rows; the cost of being too tight is someone
      // deciding the service is broken.
      const gate = await reserveQuota(`keys:${hash}`, { callLimit: 25, usdLimit: 999 });
      if (!gate.allowed) {
        return json(429, {
          ok: false,
          error: "Too many keys issued from this address today.",
        });
      }

      const b = JSON.parse(event.body || "{}");
      const issued = await issueKey({ name: b.name, label: b.label });
      await logRequest(path, hash, 200, Date.now() - started, 0);

      return json(200, {
        ok: true,
        key: issued.key,
        prefix: issued.prefix,
        tenant: issued.tenant,
        limits: { dailyCalls: 2000, dailyUsd: 5 },
        warning:
          "This is the only time the key is shown. Only a SHA-256 of it is stored, so it cannot be recovered — issue a new one if lost.",
        usage: `curl -H 'authorization: Bearer ${issued.prefix}...' ${process.env.PUBLIC_BASE_URL ?? ""}/v1/commits`,
      });
    }

    /* --- everything below spends money, so it needs quota ---------------- */
    const caller = await resolveCaller(event?.headers?.authorization);
    if (caller.error) {
      await logRequest(path, hash, 401, Date.now() - started, 0);
      return json(401, { ok: false, error: caller.error });
    }

    // Authenticated callers are metered against their own tenant; anonymous
    // ones share a per-IP bucket in the public tenant.
    const bucket = caller.authenticated ? `tenant:${caller.tenantId}` : hash;
    const quota = await reserveQuota(bucket, caller);
    if (!quota.allowed) {
      await logRequest(path, hash, 429, Date.now() - started, 0, {
        reason: quota.reason,
      });
      return json(429, {
        ok: false,
        error: `Rate limited: ${quota.reason} reached.`,
        hint: "Limits exist so a public demo cannot run up an unbounded inference bill. Clone the repo to run it without limits.",
        quota: { calls: quota.calls, usd: quota.usd },
      });
    }

    if (path === "/v1/demo" && method === "POST") {
      const result = await runDemo();
      await recordSpend(bucket, result.usage);
      const { usage, ...body } = result;
      await logRequest(path, hash, 200, Date.now() - started, usage.tokensTotal, {
        repaired: body.summary.stepsRepaired,
        preserved: body.summary.stepsPreserved,
      });
      return json(200, { ...body, quota: { callsLeft: quota.callsLeft } });
    }

    if (path === "/v1/intents" && method === "POST") {
      const b = JSON.parse(event.body || "{}");
      if (!b.agentId || !b.statement) {
        return json(400, { ok: false, error: "agentId and statement are required" });
      }
      const usage = new Usage("api");
      const intent = await declareIntent({
        agentId: b.agentId,
        taskId: b.taskId || randomUUID(),
        statement: b.statement,
        reads: b.reads ?? [],
        steps: b.steps ?? [],
        usage,
      });
      await recordSpend(bucket, usage);
      await logRequest(path, hash, 200, Date.now() - started, usage.tokensTotal);
      return json(200, { ok: true, intent, cost: usage.toJSON() });
    }

    if (path === "/v1/commits" && method === "POST") {
      const b = JSON.parse(event.body || "{}");
      if (!b.agentId || !b.resourceId || !b.statement) {
        return json(400, {
          ok: false,
          error: "agentId, resourceId and statement are required",
        });
      }
      const usage = new Usage("api");
      const commit = await commitResource({
        agentId: b.agentId,
        intentId: b.intentId ?? null,
        resourceId: b.resourceId,
        expectedVersion: b.expectedVersion ?? null,
        newBody: JSON.stringify(b.body ?? {}),
        statement: b.statement,
        usage,
      });
      if (commit.conflict) {
        await recordSpend(bucket, usage);
        return json(409, { ok: false, conflict: true, ...commit });
      }
      const outcomes = await processCommit(commit.commit.id, { usage });
      await recordSpend(bucket, usage);
      await logRequest(path, hash, 200, Date.now() - started, usage.tokensTotal);
      return json(200, {
        ok: true,
        commit: commit.commit,
        adjudications: outcomes,
        cost: usage.toJSON(),
      });
    }

    await logRequest(path, hash, 404, Date.now() - started, 0);
    return json(404, { ok: false, error: `No route for ${method} ${path}` });
  } catch (e) {
    await logRequest(path, hash, 500, Date.now() - started, 0, {
      message: e.message?.slice(0, 300),
    });
    return json(500, { ok: false, error: e.message?.slice(0, 300) });
  } finally {
    // Lambda freezes between invocations; a pool left open holds server-side
    // sessions that the next cold start cannot reuse.
    if (process.env.CLOSE_POOL_PER_INVOKE === "1") await closePool();
  }
};
