// Read-only data layer for the Chain of Mandate console.
// Live path: JsonRpcProvider per chain, mandateCount + getMandate + events.
// Fallback path: deterministic fixture, always labeled SIM by the UI.

import {
  Contract,
  EventLog,
  JsonRpcProvider,
  ZeroHash,
  decodeBytes32String,
  encodeBytes32String,
  keccak256,
  solidityPacked,
} from "ethers";
import { MANDATE_ABI } from "./abi";
import addresses from "@/config/addresses.json";
import fixture from "@/config/fixture.json";

export type ChainKey = "46630" | "421614";

export interface ChainInfo {
  key: ChainKey;
  id: number;
  label: string;
  short: string;
  rpc: string;
  explorer: string;
}

export const CHAINS: Record<ChainKey, ChainInfo> = {
  "46630": {
    key: "46630",
    id: 46630,
    label: "Robinhood Chain testnet",
    short: "Robinhood",
    rpc: "https://rpc.testnet.chain.robinhood.com/rpc",
    explorer: "https://explorer.testnet.chain.robinhood.com",
  },
  "421614": {
    key: "421614",
    id: 421614,
    label: "Arbitrum Sepolia",
    short: "Arb Sepolia",
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
  },
};

export const CHAIN_KEYS: ChainKey[] = ["46630", "421614"];

export const BREACH_MEANING: Record<number, string> = {
  1: "EXPIRED",
  2: "OVER CAPACITY",
  3: "SCOPE REFUSED",
};

export interface Receipt {
  instrument: string; // bytes32
  instrumentLabel: string; // decoded ASCII symbol, or short hex
  amount: bigint;
  newHead: string;
  timestamp: number;
  txHash: string | null; // null in fixture mode
}

export interface BreachEvent {
  code: number;
  instrument: string;
  instrumentLabel: string;
  amount: bigint;
  txHash: string | null;
}

export interface MandateNode {
  id: number;
  parentId: number;
  agent: string;
  capacity: bigint; // original escrowed capacity, from creation or delegation event
  remaining: bigint;
  expiry: number;
  scopeRoot: string;
  modelHash: string;
  receiptHead: string;
  breaches: number;
  receipts: Receipt[];
  breachEvents: BreachEvent[];
  children: MandateNode[];
}

export type Mode = "live" | "sim";

export interface ChainState {
  mode: Mode;
  chain: ChainInfo;
  contractAddress: string | null;
  roots: MandateNode[];
  fetchedAt: number;
}

function decodeInstrument(instrument: string): string {
  try {
    const label = decodeBytes32String(instrument);
    if (label.length > 0) return label;
  } catch {
    // not a null-terminated ASCII bytes32, fall through to hex
  }
  return shortHash(instrument);
}

export function shortHash(value: string): string {
  if (!value) return "";
  return `${value.slice(0, 8)}..${value.slice(-6)}`;
}

export function shortAddress(value: string): string {
  if (!value) return "";
  return `${value.slice(0, 6)}..${value.slice(-4)}`;
}

// Receipt chain verification. Must match the contract exactly:
// newHead = keccak256(abi.encodePacked(prevHead, instrument, amount, modelHash, timestamp))
// Genesis prevHead is bytes32 zero.
export function computeReceiptHead(
  receipts: Receipt[],
  modelHash: string
): string {
  let head = ZeroHash;
  for (const r of receipts) {
    head = keccak256(
      solidityPacked(
        ["bytes32", "bytes32", "uint256", "bytes32", "uint64"],
        [head, r.instrument, r.amount, modelHash, r.timestamp]
      )
    );
  }
  return head;
}

export interface VerifyResult {
  ok: boolean;
  computed: string;
  expected: string;
}

export function verifyReceiptChain(node: MandateNode): VerifyResult {
  const computed = computeReceiptHead(node.receipts, node.modelHash);
  return {
    ok: computed.toLowerCase() === node.receiptHead.toLowerCase(),
    computed,
    expected: node.receiptHead,
  };
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
  const sortRec = (list: MandateNode[]) => {
    list.sort((a, b) => a.id - b.id);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
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

function loadFixture(chain: ChainInfo): ChainState {
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

async function loadLive(chain: ChainInfo, address: string): Promise<ChainState> {
  const provider = new JsonRpcProvider(chain.rpc, chain.id, {
    staticNetwork: true,
  });
  try {
    const contract = new Contract(address, MANDATE_ABI, provider);

    const count = Number(await contract.mandateCount());

    const ids = Array.from({ length: count }, (_, i) => i + 1);
    const [mandates, createdLogs, delegatedLogs, executedLogs, breachLogs] =
      await Promise.all([
        Promise.all(ids.map((id) => contract.getMandate(id))),
        contract.queryFilter(contract.filters.MandateCreated(), 0, "latest"),
        contract.queryFilter(contract.filters.Delegated(), 0, "latest"),
        contract.queryFilter(contract.filters.Executed(), 0, "latest"),
        contract.queryFilter(contract.filters.Breach(), 0, "latest"),
      ]);

    // Original capacity per id comes from creation and delegation events.
    const capacityById = new Map<number, bigint>();
    for (const log of createdLogs as EventLog[]) {
      capacityById.set(Number(log.args.id), BigInt(log.args.capacity));
    }
    for (const log of delegatedLogs as EventLog[]) {
      capacityById.set(Number(log.args.childId), BigInt(log.args.amount));
    }

    const receiptsById = new Map<number, Receipt[]>();
    for (const log of executedLogs as EventLog[]) {
      const id = Number(log.args.id);
      const instrument: string = log.args.instrument;
      const list = receiptsById.get(id) ?? [];
      list.push({
        instrument,
        instrumentLabel: decodeInstrument(instrument),
        amount: BigInt(log.args.amount),
        newHead: log.args.newHead,
        timestamp: Number(log.args.timestamp),
        txHash: log.transactionHash,
      });
      receiptsById.set(id, list);
    }

    const breachesById = new Map<number, BreachEvent[]>();
    for (const log of breachLogs as EventLog[]) {
      const id = Number(log.args.id);
      const instrument: string = log.args.instrument;
      const list = breachesById.get(id) ?? [];
      list.push({
        code: Number(log.args.code),
        instrument,
        instrumentLabel: decodeInstrument(instrument),
        amount: BigInt(log.args.amount),
        txHash: log.transactionHash,
      });
      breachesById.set(id, list);
    }

    const nodes: MandateNode[] = ids.map((id, i) => {
      const m = mandates[i];
      return {
        id,
        parentId: Number(m.parentId),
        agent: m.agent,
        capacity: capacityById.get(id) ?? BigInt(m.remaining),
        remaining: BigInt(m.remaining),
        expiry: Number(m.expiry),
        scopeRoot: m.scopeRoot,
        modelHash: m.modelHash,
        receiptHead: m.receiptHead,
        breaches: Number(m.breaches),
        receipts: receiptsById.get(id) ?? [],
        breachEvents: breachesById.get(id) ?? [],
        children: [],
      };
    });

    return {
      mode: "live",
      chain,
      contractAddress: address,
      roots: buildTree(nodes),
      fetchedAt: Date.now(),
    };
  } finally {
    provider.destroy();
  }
}

export async function loadChainState(key: ChainKey): Promise<ChainState> {
  const chain = CHAINS[key];
  const address = (addresses as Record<string, string>)[key] ?? "";
  if (!address) return loadFixture(chain);
  try {
    return await loadLive(chain, address);
  } catch {
    // RPC unreachable or contract call failed: honest fallback, labeled SIM.
    return loadFixture(chain);
  }
}

export function txUrl(chain: ChainInfo, txHash: string): string {
  return `${chain.explorer}/tx/${txHash}`;
}

export function addressUrl(chain: ChainInfo, address: string): string {
  return `${chain.explorer}/address/${address}`;
}
