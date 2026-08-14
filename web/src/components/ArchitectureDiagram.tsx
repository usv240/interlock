import InfoButton from "./InfoButton";

/**
 * The architecture, drawn to show the one thing that matters about it: there
 * are two paths through the system, and they are separated on purpose.
 *
 * The synchronous path is what an agent waits for — declare, commit, done as
 * soon as the write is durable. The asynchronous path is everything the agent
 * should not have to wait for: finding who was threatened, judging, repairing.
 *
 * A generic boxes-and-arrows diagram would hide that split, which is the whole
 * design. So the two paths are drawn as two lanes, and CockroachDB sits across
 * both because it is the only component that appears in each.
 */

const W = 860;
const H = 400;

function Box({
  x, y, w = 132, h = 52, title, sub, accent = false, dashed = false,
}: {
  x: number; y: number; w?: number; h?: number;
  title: string; sub?: string; accent?: boolean; dashed?: boolean;
}) {
  return (
    <g>
      <rect
        x={x} y={y} width={w} height={h} rx="8"
        fill="var(--surface)"
        stroke={accent ? "var(--accent)" : "var(--border-strong)"}
        strokeWidth={accent ? 1.5 : 1}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
      <text
        x={x + w / 2} y={y + (sub ? 21 : h / 2 + 4)}
        textAnchor="middle" fontSize="12" fontWeight="600"
        fill={accent ? "var(--accent)" : "var(--ink)"}
      >
        {title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + 37} textAnchor="middle" fontSize="10" fill="var(--muted)">
          {sub}
        </text>
      )}
    </g>
  );
}

function Arrow({
  from, to, label, dashed = false, curve = 0,
}: {
  from: [number, number]; to: [number, number];
  label?: string; dashed?: boolean; curve?: number;
}) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 + curve;
  const d = curve
    ? `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`
    : `M ${x1} ${y1} L ${x2} ${y2}`;

  return (
    <g>
      <path
        d={d} fill="none"
        stroke="var(--baseline)" strokeWidth="1.5"
        strokeDasharray={dashed ? "5 4" : undefined}
        markerEnd="url(#arrowhead)"
      />
      {label && (
        <text
          x={mx} y={my - 7} textAnchor="middle" fontSize="10"
          fill="var(--muted)"
        >
          {label}
        </text>
      )}
    </g>
  );
}

export default function ArchitectureDiagram() {
  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          Two paths, separated on purpose
          <InfoButton
            title="Why the split matters"
            what="An agent waits for the top lane and never waits for the bottom one."
            how="Declaring and committing are synchronous: the agent gets an answer as soon as its write is durable. Detection, adjudication and repair happen afterwards, driven by a changefeed, so a commit that threatens fifty in-flight plans does not block on fifty model calls."
            note="Publishing the event from the commit path would be simpler, but then the write and the notification could disagree. A changefeed reads the same durable log, so an event exists if and only if the row does."
            align="right"
          />
        </h3>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-px w-4 bg-baseline" aria-hidden="true" />
            <span className="text-ink-2">synchronous</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-px w-4 border-t border-dashed border-baseline" aria-hidden="true" />
            <span className="text-ink-2">asynchronous</span>
          </span>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[720px]"
          role="img"
          aria-label="Architecture. Synchronous path: agent fleet calls the Lambda API, which declares intents and commits to CockroachDB. Asynchronous path: a CockroachDB changefeed on commit_log posts to the API, which publishes to EventBridge; a rule routes to SQS; a worker Lambda runs detection against CockroachDB, adjudicates via Bedrock, and writes the ruling back."
        >
          <defs>
            <marker id="arrowhead" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6 Z" fill="var(--baseline)" />
            </marker>
          </defs>

          {/* lane labels */}
          <text x="14" y="46" fontSize="10" fontWeight="600" fill="var(--muted)">
            AGENT WAITS
          </text>
          <text x="14" y="264" fontSize="10" fontWeight="600" fill="var(--muted)">
            AGENT DOES NOT WAIT
          </text>

          {/* ---- synchronous lane ---- */}
          <Box x={110} y={60} title="Agent fleet" sub="yours, or ours" />
          <Arrow from={[242, 86]} to={[300, 86]} />
          <Box x={300} y={60} title="Lambda API" sub="/v1/intents · /v1/commits" w={158} accent />
          <Arrow from={[458, 86]} to={[516, 86]} label="declare + commit" />

          {/* ---- CockroachDB spine ---- */}
          <rect
            x={516} y={40} width={230} height={300} rx="10"
            fill="var(--surface-2)" stroke="var(--accent)" strokeWidth="1.5"
          />
          <text x={631} y={64} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--accent)">
            CockroachDB
          </text>
          <text x={631} y={80} textAnchor="middle" fontSize="10" fill="var(--muted)">
            3 regions · SURVIVE REGION FAILURE
          </text>

          {[
            ["intent + read-set", "SERIALIZABLE"],
            ["provenance graph", "recursive CTE"],
            ["embeddings", "C-SPANN vector index"],
            ["adjudication", "UNIQUE = exactly-once"],
            ["MVCC history", "AS OF SYSTEM TIME"],
          ].map(([name, how], i) => (
            <g key={name}>
              <rect
                x={532} y={96 + i * 44} width={198} height={34} rx="6"
                fill="var(--surface)" stroke="var(--border)" strokeWidth="1"
              />
              <text x={542} y={110 + i * 44} fontSize="10.5" fontWeight="600" fill="var(--ink)">
                {name}
              </text>
              <text x={542} y={123 + i * 44} fontSize="9.5" fill="var(--muted)">
                {how}
              </text>
            </g>
          ))}

          {/* ---- asynchronous lane ---- */}
          <Arrow from={[746, 300]} to={[790, 300]} dashed />
          <text x={768} y={292} textAnchor="middle" fontSize="9" fill="var(--muted)">
            changefeed
          </text>

          {/* wrap around to the left of the async lane */}
          <path
            d="M 790 300 Q 830 300 830 330 Q 830 360 790 360 L 130 360 Q 96 360 96 330 L 96 300"
            fill="none" stroke="var(--baseline)" strokeWidth="1.5" strokeDasharray="5 4"
            markerEnd="url(#arrowhead)"
          />
          <text x={460} y={374} textAnchor="middle" fontSize="9.5" fill="var(--muted)">
            commit_log rows stream out of the same durable log the write went into
          </text>

          <Box x={30} y={274} title="/v1/cdc" sub="webhook sink" w={132} dashed />
          <Arrow from={[162, 300]} to={[196, 300]} dashed />
          <Box x={196} y={274} title="EventBridge" sub="commit.landed" w={126} dashed />
          <Arrow from={[322, 300]} to={[356, 300]} dashed />
          <Box x={356} y={274} title="SQS" sub="3 retries → DLQ" w={110} dashed />
          <Arrow from={[466, 300]} to={[500, 300]} dashed />
          <Box x={500} y={274} title="Worker λ" sub="parallel, batched" w={0} />

          {/* worker sits over the spine edge, so draw it explicitly */}
          <rect x={488} y={274} width={112} height={52} rx="8"
            fill="var(--surface)" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" />
          <text x={544} y={295} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--accent)">
            Worker λ
          </text>
          <text x={544} y={311} textAnchor="middle" fontSize="10" fill="var(--muted)">
            batched, parallel
          </text>

          {/* Bedrock */}
          <Box x={762} y={148} title="Bedrock" sub="Titan + Claude" w={86} accent />
          <Arrow from={[600, 288]} to={[762, 190]} dashed curve={-24} />
          <text x={706} y={244} textAnchor="middle" fontSize="9" fill="var(--muted)">
            embed · adjudicate
          </text>
        </svg>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
        CockroachDB appears in both lanes because it is the only component that
        has to. It holds the state an agent commits, the provenance and vectors
        detection walks, the MVCC history the diff replays, and the ruling —
        and it is the thing that notifies, so the write and the notification
        cannot disagree.
      </p>
    </div>
  );
}
