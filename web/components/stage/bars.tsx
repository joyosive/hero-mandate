"use client";

// Stage capacity bars: the mandate tree flattened into huge horizontal
// bars, sized to be read from the back of a room. Numerals are
// clamp(28px,4vw,56px) mono; bars ease to their new width on drain and a
// drained-amount tick floats up beside the bar. Breaches are stamped as
// big err badges on the node row.

import { shortAddress, type MandateNode } from "@/lib/chain";
import { fmtEth, fmtEth3 } from "@/components/console/format";

interface FlatNode {
  node: MandateNode;
  depth: number;
}

function flatten(roots: MandateNode[]): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (n: MandateNode, depth: number) => {
    out.push({ node: n, depth });
    n.children.forEach((c) => walk(c, depth + 1));
  };
  roots.forEach((r) => walk(r, 0));
  return out;
}

function StageBar({
  node,
  depth,
  drain,
  epoch,
}: {
  node: MandateNode;
  depth: number;
  drain?: bigint;
  epoch?: number;
}) {
  const pct =
    node.capacity > 0n
      ? Math.min(100, Number((node.remaining * 10000n) / node.capacity) / 100)
      : 0;
  const isRoot = node.parentId === 0;
  return (
    <div style={{ paddingLeft: `${Math.min(depth, 3) * 2.5}vw` }}>
      {/* label row */}
      <div className="flex flex-wrap items-baseline gap-x-[1.2vw] gap-y-1">
        <span
          className="font-mono font-semibold leading-none tracking-tight text-white"
          style={{ fontSize: "clamp(28px,4vw,56px)" }}
        >
          #{node.id}
        </span>
        <span className="font-mono text-[clamp(11px,1.2vw,16px)] uppercase tracking-[0.2em] text-muted">
          {isRoot ? "root" : `under #${node.parentId}`}
        </span>
        <span className="hidden font-mono text-[clamp(11px,1.1vw,15px)] text-dim sm:inline">
          {shortAddress(node.agent)}
        </span>
        {node.breaches > 0 && (
          <span className="border-2 border-err px-[0.5em] py-[0.12em] font-mono text-[clamp(13px,1.6vw,24px)] font-bold uppercase tracking-[0.16em] text-err">
            {node.breaches} breach{node.breaches === 1 ? "" : "es"}
          </span>
        )}
        <span
          className="ml-auto whitespace-nowrap font-mono leading-none tabular-nums text-acid max-sm:basis-full max-sm:text-right"
          style={{ fontSize: "clamp(28px,4vw,56px)" }}
        >
          {fmtEth3(node.remaining)}
          <span className="text-dim"> / {fmtEth3(node.capacity)} ETH</span>
        </span>
      </div>

      {/* bar */}
      <div className="relative mt-[0.8vh]">
        <div
          className="relative overflow-hidden rounded-md border border-line2 bg-panel"
          style={{ height: "clamp(20px,3.8vh,40px)" }}
          role="img"
          aria-label={`node ${node.id}: ${fmtEth(node.remaining)} of ${fmtEth(
            node.capacity
          )} ETH remaining`}
        >
          <div
            className="absolute inset-y-0 left-0 bg-acid/85 transition-[width] duration-[600ms] ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        {drain !== undefined && (
          <span
            key={`tick-${epoch}`}
            aria-hidden="true"
            className="stage-tick"
            style={{ fontSize: "clamp(12px,1.4vw,18px)" }}
          >
            -{fmtEth(drain)} ETH
          </span>
        )}
      </div>
    </div>
  );
}

export function StageBars({
  roots,
  drains,
  epoch,
}: {
  roots: MandateNode[];
  drains?: Map<number, bigint>;
  epoch?: number;
}) {
  const flat = flatten(roots);
  if (flat.length === 0) {
    return (
      <p className="my-auto text-center font-mono text-[clamp(12px,1.4vw,18px)] uppercase tracking-[0.2em] text-dim">
        no mandates on this chain yet
      </p>
    );
  }
  return (
    // my-auto centers when the tree fits and degrades to top-aligned
    // scrolling (no clipping) when it does not.
    <div className="my-auto flex w-full flex-col gap-[2.2vh]">
      {flat.map(({ node, depth }) => (
        <StageBar
          key={node.id}
          node={node}
          depth={depth}
          drain={drains?.get(node.id)}
          epoch={epoch}
        />
      ))}
    </div>
  );
}
