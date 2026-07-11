// Aggregations on top of the read-only chain data layer (lib/chain.ts).
// loadChainState stays the single source of chain state; this module only
// reshapes it: a chronological activity feed for the console, agent track
// records for the agents page, and (live mode only) block timestamps for
// breach events so refusals can interleave chronologically.

import { JsonRpcProvider } from "ethers";
import type { ChainKey, ChainState, MandateNode } from "./chain";

// The site shell carries chain selection as ?chain=robinhood|sepolia.
// The data layer keys chains by chain id string. Map between them here.
export type SiteChainKey = "robinhood" | "sepolia";

export const DATA_CHAIN_KEY: Record<SiteChainKey, ChainKey> = {
  robinhood: "46630",
  sepolia: "421614",
};

export function flattenNodes(roots: MandateNode[]): MandateNode[] {
  const out: MandateNode[] = [];
  const walk = (n: MandateNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

// ---------------------------------------------------------------------------
// Activity feed: executed receipts and refused breaches, newest first.
// ---------------------------------------------------------------------------

export interface ActivityRow {
  kind: "receipt" | "breach";
  nodeId: number;
  // Real block/event timestamp when known, null when the source event does
  // not carry one (breach events; fixture breaches). Display "--" for null.
  timestamp: number | null;
  // Ordering key only, never displayed. Unknown-time breaches sort just
  // after the last receipt of their node, matching emission order.
  sortTs: number;
  instrument: string;
  instrumentLabel: string;
  amount: bigint;
  newHead?: string;
  code?: number;
  txHash: string | null;
}

export function buildActivity(
  roots: MandateNode[],
  breachTs?: Map<string, number>
): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const node of flattenNodes(roots)) {
    let lastReceiptTs = 0;
    for (const r of node.receipts) {
      lastReceiptTs = Math.max(lastReceiptTs, r.timestamp);
      rows.push({
        kind: "receipt",
        nodeId: node.id,
        timestamp: r.timestamp,
        sortTs: r.timestamp,
        instrument: r.instrument,
        instrumentLabel: r.instrumentLabel,
        amount: r.amount,
        newHead: r.newHead,
        txHash: r.txHash,
      });
    }
    node.breachEvents.forEach((b, i) => {
      const ts = b.txHash ? breachTs?.get(b.txHash) ?? null : null;
      rows.push({
        kind: "breach",
        nodeId: node.id,
        timestamp: ts,
        sortTs: ts ?? (lastReceiptTs > 0 ? lastReceiptTs + 1 + i : 0),
        instrument: b.instrument,
        instrumentLabel: b.instrumentLabel,
        amount: b.amount,
        code: b.code,
        txHash: b.txHash,
      });
    });
  }
  rows.sort((a, b) => b.sortTs - a.sortTs || b.nodeId - a.nodeId);
  return rows;
}

// Breach events do not carry a timestamp on-chain. In live mode, resolve the
// block timestamp of each breach transaction so the feed can interleave
// refusals chronologically. Results are cached per chain+tx for the session.
const breachTsCache = new Map<string, number>();

export async function fetchBreachTimestamps(
  state: ChainState
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (state.mode !== "live") return out;

  const hashes = new Set<string>();
  for (const node of flattenNodes(state.roots)) {
    for (const b of node.breachEvents) {
      if (b.txHash) hashes.add(b.txHash);
    }
  }
  const missing = [...hashes].filter(
    (h) => !breachTsCache.has(`${state.chain.key}:${h}`)
  );

  if (missing.length > 0) {
    const provider = new JsonRpcProvider(state.chain.rpc, state.chain.id, {
      staticNetwork: true,
    });
    try {
      await Promise.all(
        missing.map(async (h) => {
          try {
            const receipt = await provider.getTransactionReceipt(h);
            if (!receipt) return;
            const block = await provider.getBlock(receipt.blockNumber);
            if (block) {
              breachTsCache.set(
                `${state.chain.key}:${h}`,
                Number(block.timestamp)
              );
            }
          } catch {
            // leave this breach without a timestamp; the row shows "--"
          }
        })
      );
    } finally {
      provider.destroy();
    }
  }

  for (const h of hashes) {
    const ts = breachTsCache.get(`${state.chain.key}:${h}`);
    if (ts !== undefined) out.set(h, ts);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Agent track records: one record per distinct agent address.
// ---------------------------------------------------------------------------

export interface AgentRecord {
  address: string;
  nodeIds: number[];
  roles: string[];
  modelHashes: string[];
  receipts: number;
  breaches: number;
  // (executed receipts) / (executed receipts + breaches), percent.
  // Null when the agent has no activity at all.
  adherencePct: number | null;
  granted: bigint;
  consumed: bigint; // granted minus remaining, includes re-delegated capacity
  maxExpiry: number;
}

export function buildAgentRecords(roots: MandateNode[]): AgentRecord[] {
  const byAgent = new Map<string, AgentRecord>();

  for (const node of flattenNodes(roots)) {
    const key = node.agent.toLowerCase();
    let rec = byAgent.get(key);
    if (!rec) {
      rec = {
        address: node.agent,
        nodeIds: [],
        roles: [],
        modelHashes: [],
        receipts: 0,
        breaches: 0,
        adherencePct: null,
        granted: 0n,
        consumed: 0n,
        maxExpiry: 0,
      };
      byAgent.set(key, rec);
    }
    rec.nodeIds.push(node.id);
    const role =
      node.parentId === 0
        ? "root mandate holder"
        : `sub-agent under node ${node.parentId}`;
    if (!rec.roles.includes(role)) rec.roles.push(role);
    if (!rec.modelHashes.includes(node.modelHash)) {
      rec.modelHashes.push(node.modelHash);
    }
    rec.receipts += node.receipts.length;
    rec.breaches += node.breaches;
    rec.granted += node.capacity;
    rec.consumed +=
      node.capacity > node.remaining ? node.capacity - node.remaining : 0n;
    rec.maxExpiry = Math.max(rec.maxExpiry, node.expiry);
  }

  const records = [...byAgent.values()];
  for (const rec of records) {
    const denom = rec.receipts + rec.breaches;
    rec.adherencePct = denom > 0 ? (rec.receipts / denom) * 100 : null;
  }
  records.sort((a, b) => Math.min(...a.nodeIds) - Math.min(...b.nodeIds));
  return records;
}
