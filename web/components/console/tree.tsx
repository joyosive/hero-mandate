"use client";

// Mandate tree panel: one row card per node, children indented under their
// parent with a thin connector line. Everything numeric is mono.
// Motion (all optional, driven by the poll diff in motion.tsx): capacity
// bars ease to their new width, a drained amount floats up by the bar, and
// a node that just acted gets a one-shot radar ring on its card border.

import {
  addressUrl,
  shortAddress,
  shortHash,
  type ChainInfo,
  type MandateNode,
} from "@/lib/chain";
import { CopyText } from "./copy";
import { fmtCountdown, fmtEth } from "./format";
import { useNow } from "./hooks";

function Expiry({ expiry }: { expiry: number }) {
  const now = useNow(1000);
  const left = expiry - now;
  if (left <= 0) {
    return (
      <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-err">
        EXPIRED
      </span>
    );
  }
  return (
    <span
      className={`font-mono text-[11px] tabular-nums ${
        left < 3600 ? "text-amber" : "text-white"
      }`}
      title={new Date(expiry * 1000).toISOString()}
    >
      {fmtCountdown(left)}
    </span>
  );
}

function CapacityBar({ node }: { node: MandateNode }) {
  const pct =
    node.capacity > 0n
      ? Math.min(100, Number((node.remaining * 10000n) / node.capacity) / 100)
      : 0;
  return (
    <div
      className="relative h-[18px] overflow-hidden rounded border border-line2 bg-bg"
      role="img"
      aria-label={`${fmtEth(node.remaining)} of ${fmtEth(node.capacity)} ETH remaining`}
    >
      <div
        className="absolute inset-y-0 left-0 bg-acid/85 transition-[width] duration-[600ms] ease-out"
        style={{ width: `${pct}%` }}
      />
      {/* Exact values, same bigints as the fill width: the chip must never
          disagree with the bar (fmtEth3 rounding misstated 0.0004-scale
          amounts, e.g. 0.0035 as 0.004 beside a 70% fill). */}
      <div className="absolute inset-y-0 right-1.5 flex items-center">
        <span className="rounded-sm bg-bg/80 px-1 font-mono text-[9.5px] leading-none tabular-nums text-white">
          {fmtEth(node.remaining)} / {fmtEth(node.capacity)} ETH
        </span>
      </div>
    </div>
  );
}

function NodeCard({
  node,
  chain,
  live,
  onVerify,
  drain,
  ping,
  epoch,
}: {
  node: MandateNode;
  chain: ChainInfo;
  live: boolean;
  onVerify: (node: MandateNode) => void;
  // Capacity drained since the last poll, if any.
  drain?: bigint;
  // True when this node gained a receipt or breach in the last poll.
  ping?: boolean;
  // Poll epoch; keys the one-shot elements so each change replays once.
  epoch?: number;
}) {
  const isRoot = node.parentId === 0;
  return (
    <div className="panel relative p-3 transition-colors duration-150 hover:border-acid/70">
      {ping && (
        <span key={`ping-${epoch}`} aria-hidden="true" className="com-ping" />
      )}
      {/* id, agent, breach counter */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className={`pill ${isRoot ? "pill-acid" : ""}`}>
          #{node.id}
          {isRoot ? " root" : ` under #${node.parentId}`}
        </span>
        <CopyText
          value={node.agent}
          display={shortAddress(node.agent)}
          title={`agent ${node.agent}`}
          className="text-[11px] text-white"
        />
        <span
          className={`pill ml-auto ${node.breaches > 0 ? "pill-err" : ""}`}
        >
          {node.breaches} breach{node.breaches === 1 ? "" : "es"}
        </span>
      </div>

      {/* capacity + expiry */}
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
          capacity remaining
        </span>
        <Expiry expiry={node.expiry} />
      </div>
      <div className="relative mt-1">
        <CapacityBar node={node} />
        {drain !== undefined && (
          <span key={`tick-${epoch}`} aria-hidden="true" className="com-tick">
            -{fmtEth(drain)} ETH
          </span>
        )}
      </div>

      {/* commitments */}
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
            scope root
          </span>
          <CopyText
            value={node.scopeRoot}
            display={shortHash(node.scopeRoot)}
            title={`scope root ${node.scopeRoot}`}
            className="text-[10.5px] text-muted"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
            model hash
          </span>
          <CopyText
            value={node.modelHash}
            display={shortHash(node.modelHash)}
            title={`model hash ${node.modelHash}`}
            className="text-[10.5px] text-muted"
          />
        </div>
      </div>

      {/* actions */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line2 pt-2.5">
        <button
          type="button"
          className="btn focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid"
          onClick={() => onVerify(node)}
        >
          Verify chain
        </button>
        {live && (
          <a
            href={addressUrl(chain, node.agent)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted underline decoration-dim underline-offset-2 transition-colors hover:text-acid hover:decoration-acid focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid"
          >
            agent on explorer
          </a>
        )}
      </div>
    </div>
  );
}

function Branch({
  node,
  chain,
  live,
  onVerify,
  drains,
  pings,
  epoch,
}: {
  node: MandateNode;
  chain: ChainInfo;
  live: boolean;
  onVerify: (node: MandateNode) => void;
  drains?: Map<number, bigint>;
  pings?: Set<number>;
  epoch?: number;
}) {
  return (
    <div>
      <NodeCard
        node={node}
        chain={chain}
        live={live}
        onVerify={onVerify}
        drain={drains?.get(node.id)}
        ping={pings?.has(node.id)}
        epoch={epoch}
      />
      {node.children.length > 0 && (
        <div className="ml-3 mt-3 space-y-3 border-l border-dim/50 pl-3 sm:ml-4 sm:pl-4">
          {node.children.map((child) => (
            <div key={child.id} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-3 top-7 h-px w-3 bg-dim/50 sm:-left-4 sm:w-4"
              />
              <Branch
                node={child}
                chain={chain}
                live={live}
                onVerify={onVerify}
                drains={drains}
                pings={pings}
                epoch={epoch}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MandateTree({
  roots,
  chain,
  live,
  onVerify,
  drains,
  pings,
  epoch,
}: {
  roots: MandateNode[];
  chain: ChainInfo;
  live: boolean;
  onVerify: (node: MandateNode) => void;
  // Poll diff (motion.tsx): drained amounts, acting nodes, poll epoch.
  drains?: Map<number, bigint>;
  pings?: Set<number>;
  epoch?: number;
}) {
  return (
    <div className="space-y-3">
      {roots.map((root) => (
        <Branch
          key={root.id}
          node={root}
          chain={chain}
          live={live}
          onVerify={onVerify}
          drains={drains}
          pings={pings}
          epoch={epoch}
        />
      ))}
    </div>
  );
}
