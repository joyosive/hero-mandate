"use client";

// Motion layer for the console surfaces. Three responsibilities:
//   1. useChainDiff: poll-to-poll diffing of chain state. It answers
//      "which events are genuinely new since the last poll" (by tx hash),
//      "which nodes drained capacity and by how much", and "which nodes
//      acted". First load of a chain only sets a baseline; nothing
//      animates. The seen-set resets on chain or mode change, so a chain
//      switch can never double-animate.
//   2. fetchBlockNumber + BlockTick: block-height heartbeat, fetched by
//      the caller during its existing poll (no extra polling loop here).
//   3. MotionStyles: the one-shot keyframes. All of them collapse to
//      instant end states under the global prefers-reduced-motion rule
//      in globals.css.

import { useRef } from "react";
import { JsonRpcProvider } from "ethers";
import type { ChainInfo, ChainState, Mode } from "@/lib/chain";
import { buildActivity, flattenNodes, type ActivityRow } from "@/lib/agents";

// ---------------------------------------------------------------------------
// Stable row identity
// ---------------------------------------------------------------------------

// Live rows key by kind + tx hash. Fixture rows (txHash null) key by
// content plus an occurrence index so identical rows stay distinct.
// Timestamps are deliberately excluded: breach timestamps resolve
// asynchronously and must never change a row's identity mid-session.
export function activityKeys(rows: ActivityRow[]): string[] {
  const counts = new Map<string, number>();
  return rows.map((r) => {
    const base = r.txHash
      ? `${r.kind}:${r.txHash}`
      : `${r.kind}:${r.nodeId}:${r.instrument}:${r.amount}:${
          r.kind === "receipt" ? r.newHead ?? "" : r.code ?? 0
        }`;
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

// ---------------------------------------------------------------------------
// Poll-to-poll diff
// ---------------------------------------------------------------------------

export interface ChainDiff {
  // Increments once per poll that brought changes. Used as a render key
  // to replay one-shot animations exactly once per change.
  epoch: number;
  // Row keys (activityKeys) that were not present in the previous poll.
  newRowKeys: Set<string>;
  // The same rows with their keys, oldest first, for banner replays.
  newRows: { key: string; row: ActivityRow }[];
  // nodeId -> amount of capacity drained since the previous poll.
  drains: Map<number, bigint>;
  // nodeIds that gained a receipt or breach since the previous poll.
  pings: Set<number>;
}

const EMPTY_DIFF: ChainDiff = {
  epoch: 0,
  newRowKeys: new Set(),
  newRows: [],
  drains: new Map(),
  pings: new Set(),
};

interface Snapshot {
  dataKey: string;
  mode: Mode;
  keySet: Set<string>;
  rows: ActivityRow[];
  keys: string[];
  remaining: Map<number, bigint>;
  eventCount: Map<number, number>;
}

function takeSnapshot(state: ChainState, dataKey: string): Snapshot {
  const rows = buildActivity(state.roots);
  const keys = activityKeys(rows);
  const remaining = new Map<number, bigint>();
  const eventCount = new Map<number, number>();
  for (const n of flattenNodes(state.roots)) {
    remaining.set(n.id, n.remaining);
    eventCount.set(n.id, n.receipts.length + n.breachEvents.length);
  }
  return {
    dataKey,
    mode: state.mode,
    keySet: new Set(keys),
    rows,
    keys,
    remaining,
    eventCount,
  };
}

function computeDiff(prev: Snapshot, next: Snapshot, epoch: number): ChainDiff {
  const newRows: { key: string; row: ActivityRow }[] = [];
  next.rows.forEach((row, i) => {
    const key = next.keys[i];
    if (!prev.keySet.has(key)) newRows.push({ key, row });
  });
  newRows.sort((a, b) => a.row.sortTs - b.row.sortTs);

  const drains = new Map<number, bigint>();
  const pings = new Set<number>();
  for (const [id, rem] of next.remaining) {
    const old = prev.remaining.get(id);
    if (old !== undefined && rem < old) drains.set(id, old - rem);
  }
  for (const [id, count] of next.eventCount) {
    const old = prev.eventCount.get(id);
    if (old !== undefined && count > old) pings.add(id);
  }

  const changed = newRows.length > 0 || drains.size > 0 || pings.size > 0;
  return {
    epoch: changed ? epoch + 1 : epoch,
    newRowKeys: new Set(newRows.map((r) => r.key)),
    newRows,
    drains,
    pings,
  };
}

export function useChainDiff(
  state: ChainState | null,
  dataKey: string
): ChainDiff {
  const ref = useRef<{ token: string; snap: Snapshot | null; diff: ChainDiff }>(
    { token: "", snap: null, diff: EMPTY_DIFF }
  );
  // Identity of the current input. fetchedAt changes on every poll; the
  // guard makes the render-phase computation idempotent (StrictMode safe).
  const token = state
    ? `${dataKey}|${state.mode}|${state.fetchedAt}`
    : `null|${dataKey}`;
  if (ref.current.token !== token) {
    const prev = ref.current;
    let snap: Snapshot | null = null;
    let diff: ChainDiff = { ...EMPTY_DIFF, epoch: prev.diff.epoch };
    if (state) {
      snap = takeSnapshot(state, dataKey);
      // Diff only against the same chain and mode. Anything else (chain
      // switch, sim/live flip) resets the baseline: no animation.
      if (
        prev.snap &&
        prev.snap.dataKey === dataKey &&
        prev.snap.mode === state.mode
      ) {
        diff = computeDiff(prev.snap, snap, prev.diff.epoch);
      }
    }
    ref.current = { token, snap, diff };
  }
  return ref.current.diff;
}

// ---------------------------------------------------------------------------
// Block heartbeat
// ---------------------------------------------------------------------------

export async function fetchBlockNumber(
  chain: ChainInfo
): Promise<number | null> {
  const provider = new JsonRpcProvider(chain.rpc, chain.id, {
    staticNetwork: true,
  });
  try {
    return await provider.getBlockNumber();
  } catch {
    return null;
  } finally {
    provider.destroy();
  }
}

export function BlockTick({
  block,
  className = "font-mono text-[10px] tabular-nums text-dim",
}: {
  block: number;
  className?: string;
}) {
  return (
    <span className={className} title={`latest block ${block}`}>
      block{" "}
      <span key={block} className="com-block inline-block tabular-nums">
        {block}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

const MOTION_CSS = `
@keyframes com-row-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes com-flash-acid {
  0% { background-color: rgba(170, 255, 0, 0.16); }
  100% { background-color: rgba(170, 255, 0, 0); }
}
@keyframes com-flash-err {
  0% { background-color: rgba(255, 84, 112, 0.24); }
  100% { background-color: rgba(255, 84, 112, 0.06); }
}
.com-row-new {
  animation: com-row-in 300ms ease-out, com-flash-acid 1.2s ease-out;
}
.com-row-new-err {
  animation: com-row-in 300ms ease-out, com-flash-err 1.2s ease-out;
}
@keyframes com-tick-rise {
  0% { opacity: 0; transform: translateY(6px); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-12px); }
}
.com-tick {
  position: absolute;
  right: 0;
  top: -18px;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--color-acid);
  background: rgba(10, 11, 9, 0.92);
  border: 1px solid rgba(170, 255, 0, 0.35);
  border-radius: 4px;
  padding: 2px 5px;
  pointer-events: none;
  animation: com-tick-rise 1.2s ease-out forwards;
}
@keyframes com-ping {
  0% {
    box-shadow: 0 0 0 0 rgba(170, 255, 0, 0.45);
    border-color: rgba(170, 255, 0, 0.9);
    opacity: 1;
  }
  100% {
    box-shadow: 0 0 0 16px rgba(170, 255, 0, 0);
    border-color: rgba(170, 255, 0, 0);
    opacity: 0;
  }
}
.com-ping {
  position: absolute;
  inset: 0;
  border-radius: 0.75rem;
  border: 1px solid rgba(170, 255, 0, 0.9);
  pointer-events: none;
  animation: com-ping 900ms ease-out forwards;
}
@keyframes com-block-tick {
  0% { color: var(--color-acid); }
  100% { color: var(--color-dim); }
}
.com-block { animation: com-block-tick 700ms ease-out; }
`;

export function MotionStyles() {
  return <style dangerouslySetInnerHTML={{ __html: MOTION_CSS }} />;
}
