// Landing stats over the mandate tree, plus a landing-safe chain read.
// Reuses the read-only data layer in lib/chain.ts. One extra honesty rule
// for the landing page: a live chain with zero mandates falls back to the
// deterministic fixture, and the UI labels that state SIM.

import { encodeBytes32String } from "ethers";
import fixture from "@/config/fixture.json";
import {
  CHAINS,
  loadChainState,
  type ChainInfo,
  type ChainKey,
  type ChainState,
  type MandateNode,
} from "./chain";

export interface OpsStats {
  mandates: number;
  receipts: number;
  breaches: number;
  escrowedWei: bigint;
}

function walk(nodes: MandateNode[], fn: (n: MandateNode) => void) {
  for (const n of nodes) {
    fn(n);
    walk(n.children, fn);
  }
}

// Mandates: every node, root or delegated. Receipts and breaches: summed
// from events. Escrow: value that entered the contract, i.e. root capacity;
// delegated capacity moves inside the escrow and must not be double counted.
export function computeStats(state: ChainState): OpsStats {
  let mandates = 0;
  let receipts = 0;
  let breaches = 0;
  let escrowedWei = 0n;
  walk(state.roots, (n) => {
    mandates += 1;
    receipts += n.receipts.length;
    breaches += n.breaches;
    if (n.parentId === 0) escrowedWei += n.capacity;
  });
  return { mandates, receipts, breaches, escrowedWei };
}

interface FixtureReceipt {
  instrument: string;
  amount: string;
  timestamp: number;
  newHead: string;
}

interface FixtureBreach {
  code: number;
  instrument: string;
  amount: string;
}

interface FixtureMandate {
  id: number;
  parentId: number;
  agent: string;
  capacity: string;
  remaining: string;
  expiryOffsetSec: number;
  scopeRoot: string;
  modelHash: string;
  receiptHead: string;
  breaches: number;
  receipts: FixtureReceipt[];
  breachEvents: FixtureBreach[];
}

function buildTree(nodes: MandateNode[]): MandateNode[] {
  const byId = new Map<number, MandateNode>();
  for (const n of nodes) byId.set(n.id, n);
  const roots: MandateNode[] = [];
  for (const n of nodes) {
    const parent = n.parentId !== 0 ? byId.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

function fixtureState(chain: ChainInfo): ChainState {
  const now = Math.floor(Date.now() / 1000);
  const nodes: MandateNode[] = (fixture.mandates as FixtureMandate[]).map(
    (m) => ({
      id: m.id,
      parentId: m.parentId,
      agent: m.agent,
      capacity: BigInt(m.capacity),
      remaining: BigInt(m.remaining),
      expiry: now + m.expiryOffsetSec,
      scopeRoot: m.scopeRoot,
      modelHash: m.modelHash,
      receiptHead: m.receiptHead,
      breaches: m.breaches,
      receipts: m.receipts.map((r) => ({
        instrument: encodeBytes32String(r.instrument),
        instrumentLabel: r.instrument,
        amount: BigInt(r.amount),
        newHead: r.newHead,
        timestamp: r.timestamp,
        txHash: null,
      })),
      breachEvents: m.breachEvents.map((b) => ({
        code: b.code,
        instrument: encodeBytes32String(b.instrument),
        instrumentLabel: b.instrument,
        amount: BigInt(b.amount),
        txHash: null,
      })),
      children: [],
    })
  );
  return {
    mode: "sim",
    chain,
    contractAddress: null,
    roots: buildTree(nodes),
    fetchedAt: Date.now(),
  };
}

// Landing read: live state when the chain has data; deterministic fixture,
// mode "sim", when the RPC fails or the chain is empty.
export async function loadLandingState(key: ChainKey): Promise<ChainState> {
  const state = await loadChainState(key);
  if (state.mode === "live" && state.roots.length === 0) {
    return fixtureState(CHAINS[key]);
  }
  return state;
}
