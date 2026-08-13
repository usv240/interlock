/**
 * SQS worker: adjudicates commits off the queue, in parallel.
 *
 * This is the other half of splitting commit from adjudication. Each message is
 * one landed commit; the worker runs the detection query, rules on everyone
 * threatened, and records the outcome.
 *
 * WHY DUPLICATES ARE FINE HERE
 * SQS is at-least-once, and a changefeed retries on any non-2xx, so the same
 * commit will occasionally arrive twice. That would normally demand careful
 * deduplication in the worker — except adjudication is already idempotent by
 * a UNIQUE index on (commit_id, intent_id), added for the chaos drill.
 *
 * So the property that made connection loss survivable also makes at-least-once
 * delivery survivable, without a line of extra code. Worth noticing: it is the
 * same invariant paying for itself twice.
 *
 * PARTIAL BATCH FAILURE
 * Reporting individual failed message IDs means one poisonous commit does not
 * force the whole batch to be redelivered. After three attempts a message goes
 * to the dead-letter queue rather than looping forever.
 */
import { processCommit } from "../agents/interlock.js";
import { Usage } from "../agents/bedrock.js";
import { query, closePool } from "../agents/db.js";

export const handler = async (event) => {
  const failures = [];
  const usage = new Usage("sqs-worker");
  let adjudicated = 0;

  for (const record of event.Records ?? []) {
    let commitId;
    try {
      const envelope = JSON.parse(record.body);
      // EventBridge wraps the payload in `detail`; a direct SQS send would not.
      const detail = envelope.detail ?? envelope;
      commitId = detail.commitId;

      if (!commitId) {
        // Nothing to retry — a malformed message will never become valid.
        console.warn("message without commitId, discarding", record.messageId);
        continue;
      }

      const outcomes = await processCommit(commitId, { usage });
      adjudicated += outcomes.length;

      await query(
        `INSERT INTO api_request (route, client_hash, status, duration_ms, tokens, detail)
         VALUES ('worker:adjudicate', 'sqs', 200, 0, $1, $2)`,
        [
          usage.tokensTotal,
          JSON.stringify({
            commitId,
            outcomes: outcomes.length,
            verdicts: outcomes.map((o) => o.verdict),
          }),
        ],
      ).catch(() => {});

      console.log(
        JSON.stringify({
          commitId,
          threatened: outcomes.length,
          verdicts: outcomes.map((o) => o.verdict),
          preserved: outcomes.reduce((n, o) => n + o.stepsPreserved, 0),
        }),
      );
    } catch (e) {
      console.error("adjudication failed", commitId, e.message);
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  const u = usage.toJSON();
  console.log(
    JSON.stringify({
      batch: event.Records?.length ?? 0,
      adjudicated,
      failed: failures.length,
      usd: u.usd,
      tokens: u.tokensTotal,
    }),
  );

  if (process.env.CLOSE_POOL_PER_INVOKE === "1") await closePool();

  // Only these are redelivered; the rest are acknowledged.
  return { batchItemFailures: failures };
};
