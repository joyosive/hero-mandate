// Hero Mandate operator cockpit: a LOCAL, click-driven web UI that fires the
// REAL on-chain actions from flow.ts and settle.ts, one step per button, so a
// founder can screen-record an interactive demo instead of a terminal.
//
// SECURITY MODEL: this is a local operator tool. The signing key is loaded
// from ../.env into THIS Node process only. It is used to build ethers Wallet
// signers here and it never leaves the process: the served page is a static
// string, the browser only POSTs {chain} to /api/step/<n>, and no API response
// or log line ever contains the private key. Do not deploy this server.
//
// Run:  npm run cockpit         (serves http://localhost:5599)
//       npm run cockpit -- --dry  (wires every endpoint, fires nothing)

import * as fs from "node:fs";
import * as path from "node:path";
import { createServer, IncomingMessage } from "node:http";
import * as dotenv from "dotenv";
import {
  AbiCoder,
  Contract,
  EventLog,
  InterfaceAbi,
  JsonRpcProvider,
  Wallet,
  dataSlice,
  formatEther,
  formatUnits,
  getAddress,
  id,
  keccak256,
  parseEther,
  solidityPacked,
  toUtf8Bytes,
} from "ethers";
import { HERO_MANDATE_ABI } from "./abi";
import { buildProof, buildRoot, instrumentId } from "./merkle";
import { GENESIS_HEAD, nextHead } from "./receipt";
import { MandateBoundCredential, MandateGuard, MppChallenge, verifyCredential } from "./mpp-guard";
import { allowance, approveMax, balanceOf, deployHeroDemoUSD, transfer, HERO_DEMO_USD } from "./erc20";
// Same deep import as settle.ts: @arbitrum/mpp v0.1.0 does not expose these
// via its package exports map, so the built module is imported directly.
import {
  PERMIT2_ADDRESS,
  PERMIT2_SINGLE_ABI,
  PERMIT2_WITNESS_TYPE_STRING,
  TOKEN_CONTRACTS,
} from "../node_modules/@arbitrum/mpp/dist/default.js";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

const PORT = 5599;
const DRY = process.argv.includes("--dry");
const OUT_DIR = path.join(__dirname, "..", "out");

// The one HeroMandate contract, same address on every chain here.
const CONTRACT = "0x0dfca3eabfde4e4714057a326058611e040dcdd9";

// ---------------------------------------------------------------- chains

interface ChainConfig {
  key: "robinhood" | "sepolia";
  label: string;
  chainId: number;
  rpcEnv: string;
  explorer: string;
  explorerTxBase: string;
  circleUsdc: string | null;
  outName: string;
  tokenName: string;
  challengeIdUsdc: string;
  challengeIdDemo: string;
}

const CHAINS: Record<"robinhood" | "sepolia", ChainConfig> = {
  robinhood: {
    key: "robinhood",
    label: "Robinhood Chain testnet",
    chainId: 46630,
    rpcEnv: "RPC_ROBINHOOD",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    explorerTxBase: "https://explorer.testnet.chain.robinhood.com/tx/",
    circleUsdc: null,
    outName: "settle-robinhood.json",
    tokenName: "settle-token-robinhood.json",
    challengeIdUsdc: "chg-robinhood-001",
    challengeIdDemo: "chg-robinhood-001",
  },
  sepolia: {
    key: "sepolia",
    label: "Arbitrum Sepolia",
    chainId: 421614,
    rpcEnv: "RPC_ARB_SEPOLIA",
    explorer: "https://sepolia.arbiscan.io",
    explorerTxBase: "https://sepolia.arbiscan.io/tx/",
    circleUsdc: TOKEN_CONTRACTS.USDC_ARBITRUM_SEPOLIA,
    outName: "settle-sepolia.json",
    tokenName: "settle-token.json",
    challengeIdUsdc: "chg-settle-003",
    challengeIdDemo: "chg-settle-001",
  },
};

type ChainKey = keyof typeof CHAINS;

// ---------------------------------------------------------------- scenario constants (from flow.ts)

const ROOT_SET = ["ETH-USD", "ARB-USD", "BTC-USD", "PAY-USDC"];
const CHILD_SET = ["ETH-USD", "ARB-USD"];
const PAY_SET = ["PAY-USDC"];

const ORCHESTRATOR_MODEL = keccak256(toUtf8Bytes("hero-orchestrator-v1"));
const MOMENTUM_MODEL = keccak256(toUtf8Bytes("hero-momentum-v1"));

const ROOT_CAPACITY = parseEther("0.005");
const CHILD_CAPACITY = parseEther("0.0015");
const TRADE_ETH = parseEther("0.0004");
const BREACH_SCOPE_AMOUNT = parseEther("0.0002");
const BREACH_CAP_AMOUNT = parseEther("0.005");
const GAS_STAKE = parseEther("0.0005");

// Settlement constants (from settle.ts).
const SETTLE_AMOUNT = 5_000_000n;
const SETTLE_MANDATE_CAPACITY = parseEther("0.002");
const SETTLE_MANDATE_TTL = 24n * 3600n;
const OPS_TOKEN_TOPUP = 25_000_000n;
const SETTLEMENT_MODEL = keccak256(toUtf8Bytes("hero-settlement-v1"));
const PERMIT2_EXTRA_ABI = ["function nonceBitmap(address, uint256) view returns (uint256)"];
const PAYMENT_WITNESS_TYPEHASH = keccak256(toUtf8Bytes("PaymentWitness(bytes32 challengeHash)"));

// HeroProofAnchor on Arbitrum Sepolia, the contract that already anchors the
// Hero robot-fleet proofs. Verified source; anchor() is permissionless.
const ANCHOR_ADDRESS = "0xb3fa3222130fac54b90e37835dce4f052349571b";
const ANCHOR_ABI = [
  "function anchor(bytes32)",
  "function verify(bytes32) view returns (bool,uint64,address)",
  "error AlreadyAnchored(bytes32 proofRoot)",
];
const ALREADY_ANCHORED_SELECTOR = id("AlreadyAnchored(bytes32)").slice(0, 10);

const BREACH_NAMES: Record<number, string> = { 1: "expiry", 2: "capacity", 3: "scope", 4: "caller" };

// ---------------------------------------------------------------- helpers

function short(hex: string): string {
  return hex.length > 18 ? `${hex.slice(0, 10)}..${hex.slice(-6)}` : hex;
}

function eth(wei: bigint): string {
  return `${formatEther(wei)} ETH`;
}

function describeError(err: unknown): string {
  const e = err as { shortMessage?: string; reason?: string; message?: string };
  return e?.shortMessage || e?.reason || e?.message || String(err);
}

function isAlreadyAnchored(err: unknown): boolean {
  const e = err as { revert?: { name?: string }; data?: unknown; shortMessage?: string; message?: string };
  if (e?.revert?.name === "AlreadyAnchored") return true;
  if (typeof e?.data === "string" && e.data.startsWith(ALREADY_ANCHORED_SELECTOR)) return true;
  return `${e?.shortMessage ?? ""} ${e?.message ?? ""}`.includes("AlreadyAnchored");
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** A step failure whose message is safe to show. Never carries the key. */
class StepError extends Error {}

// ---------------------------------------------------------------- runtime (signers stay here)

interface Runtime {
  net: ChainConfig;
  provider: JsonRpcProvider;
  deployerPk: string;
  treasury: Wallet;
  orchestrator: Wallet;
  momentum: Wallet;
  ops: Wallet;
  vendor: Wallet;
  asTreasury: Contract;
}

function buildRuntime(chain: ChainKey): Runtime {
  const net = CHAINS[chain];
  const rpc = process.env[net.rpcEnv];
  if (!rpc) throw new StepError(`missing ${net.rpcEnv} in ../.env`);
  const rawPk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rawPk) throw new StepError("missing DEPLOYER_PRIVATE_KEY in ../.env");
  const deployerPk = rawPk.startsWith("0x") ? rawPk : `0x${rawPk}`;

  const provider = new JsonRpcProvider(rpc);
  // Deterministic cast, identical derivation to flow.ts and settle.ts.
  const treasury = new Wallet(deployerPk, provider);
  const orchestrator = new Wallet(keccak256(solidityPacked(["bytes32", "uint256"], [deployerPk, 1])), provider);
  const momentum = new Wallet(keccak256(solidityPacked(["bytes32", "uint256"], [deployerPk, 2])), provider);
  const ops = new Wallet(keccak256(solidityPacked(["bytes32", "uint256"], [deployerPk, 3])), provider);
  const vendor = new Wallet(keccak256(solidityPacked(["bytes32", "uint256"], [deployerPk, 4])), provider);
  const asTreasury = new Contract(CONTRACT, HERO_MANDATE_ABI, treasury);
  return { net, provider, deployerPk, treasury, orchestrator, momentum, ops, vendor, asTreasury };
}

/** Fund an agent wallet from treasury if it is below the gas stake. */
async function ensureGas(rt: Runtime, wallet: Wallet): Promise<void> {
  const balance = await rt.provider.getBalance(wallet.address);
  if (balance >= GAS_STAKE) return;
  const tx = await rt.treasury.sendTransaction({ to: wallet.address, value: GAS_STAKE });
  await tx.wait();
}

async function ensureContractCode(rt: Runtime): Promise<void> {
  const code = await rt.provider.getCode(CONTRACT);
  if (code === "0x") throw new StepError(`no HeroMandate code at ${CONTRACT} on ${rt.net.label}`);
}

// ---------------------------------------------------------------- execute wrapper (from flow.ts)

interface ExecOutcome {
  status: "executed" | "refused" | "reverted" | "unknown";
  txHash?: string;
  newHead?: string;
  timestamp?: bigint;
  breachCode?: number;
  detail?: string;
}

async function attemptExecute(
  contract: Contract,
  mandateId: bigint,
  symbol: string,
  amount: bigint,
  proofs: string[][],
): Promise<ExecOutcome> {
  let txHash: string | undefined;
  try {
    const tx = await contract.getFunction("execute")(mandateId, instrumentId(symbol), amount, proofs);
    txHash = tx.hash;
    const receipt = await tx.wait();
    if (!receipt) return { status: "unknown", txHash, detail: "no receipt returned" };
    for (const entry of receipt.logs) {
      if (entry.address.toLowerCase() !== CONTRACT.toLowerCase()) continue;
      let parsed;
      try {
        parsed = contract.interface.parseLog({ topics: [...entry.topics], data: entry.data });
      } catch {
        continue;
      }
      if (!parsed) continue;
      if (parsed.name === "Executed" && parsed.args.id === mandateId) {
        return { status: "executed", txHash, newHead: String(parsed.args.newHead), timestamp: BigInt(parsed.args.timestamp) };
      }
      if (parsed.name === "Breach" && parsed.args.id === mandateId) {
        return { status: "refused", txHash, breachCode: Number(parsed.args.code) };
      }
    }
    return { status: "unknown", txHash, detail: "no Executed or Breach event found" };
  } catch (err) {
    return { status: "reverted", txHash, detail: describeError(err) };
  }
}

interface MandateView {
  parentId: bigint;
  agent: string;
  remaining: bigint;
  expiry: bigint;
  scopeRoot: string;
  modelHash: string;
  receiptHead: string;
  breaches: bigint;
}

async function readMandate(contract: Contract, mandateId: bigint): Promise<MandateView> {
  const m = await contract.getFunction("getMandate")(mandateId);
  return {
    parentId: BigInt(m.parentId),
    agent: String(m.agent),
    remaining: BigInt(m.remaining),
    expiry: BigInt(m.expiry),
    scopeRoot: String(m.scopeRoot),
    modelHash: String(m.modelHash),
    receiptHead: String(m.receiptHead),
    breaches: BigInt(m.breaches),
  };
}

function parseDelegatedChildId(contract: Contract, logs: Array<{ topics: readonly string[]; data: string }>): bigint {
  for (const entry of logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: [...entry.topics], data: entry.data });
      if (parsed?.name === "Delegated") return BigInt(parsed.args.childId);
    } catch {
      continue;
    }
  }
  return 0n;
}

async function verifyReceiptChain(
  contract: Contract,
  mandateId: bigint,
  modelHash: string,
  headOnChain: string,
  fromBlock: number,
): Promise<{ ok: boolean; receipts: number; headRecomputed: string }> {
  const raw = await contract.queryFilter(contract.filters.Executed(mandateId), fromBlock, "latest");
  const events = raw.filter((e): e is EventLog => e instanceof EventLog);
  events.sort((a, b) => a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex || a.index - b.index);
  let head = GENESIS_HEAD;
  let linksIntact = true;
  for (const ev of events) {
    head = nextHead(head, {
      instrument: String(ev.args.instrument),
      amount: BigInt(ev.args.amount),
      modelHash,
      timestamp: BigInt(ev.args.timestamp),
    });
    if (head.toLowerCase() !== String(ev.args.newHead).toLowerCase()) linksIntact = false;
  }
  return { ok: linksIntact && head.toLowerCase() === headOnChain.toLowerCase(), receipts: events.length, headRecomputed: head };
}

// ---------------------------------------------------------------- session state (per chain)

interface Session {
  rootId?: bigint;
  childId?: bigint;
  fromBlock?: number;
  localHead?: string;
}

const sessions: Record<ChainKey, Session> = { robinhood: {}, sepolia: {} };

// ---------------------------------------------------------------- result shape sent to browser

interface StepResult {
  ok: boolean;
  outcome: "ok" | "refused" | "verified" | "error";
  txHash: string | null;
  explorerUrl: string | null;
  network: string;
  summary: string;
}

function link(net: ChainConfig, hash: string): string {
  return `${net.explorerTxBase}${hash}`;
}

// ---------------------------------------------------------------- step handlers

async function step1(rt: Runtime, chain: ChainKey): Promise<StepResult> {
  await ensureContractCode(rt);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const tx = await rt.asTreasury.getFunction("createMandate")(
    rt.orchestrator.address,
    nowSec + 24n * 3600n,
    buildRoot(ROOT_SET),
    ORCHESTRATOR_MODEL,
    { value: ROOT_CAPACITY },
  );
  const receipt = await tx.wait();
  let rootId = 0n;
  for (const entry of receipt.logs) {
    try {
      const parsed = rt.asTreasury.interface.parseLog({ topics: [...entry.topics], data: entry.data });
      if (parsed?.name === "MandateCreated") rootId = BigInt(parsed.args.id);
    } catch {
      continue;
    }
  }
  if (rootId === 0n) throw new StepError("createMandate produced no MandateCreated event");
  sessions[chain] = { rootId, fromBlock: receipt.blockNumber as number, localHead: GENESIS_HEAD };
  return {
    ok: true,
    outcome: "ok",
    txHash: tx.hash,
    explorerUrl: link(rt.net, tx.hash),
    network: rt.net.label,
    summary: `Root mandate ${rootId} created. Capacity ${eth(ROOT_CAPACITY)} escrowed, expiry now+24h. Scope committed as a Merkle root over ${ROOT_SET.length} instruments, model hero-orchestrator-v1 bound.`,
  };
}

async function step2(rt: Runtime, chain: ChainKey): Promise<StepResult> {
  const s = sessions[chain];
  if (s.rootId === undefined) throw new StepError("No root mandate in this session. Run step 1 first.");
  await ensureGas(rt, rt.orchestrator);
  const asOrchestrator = rt.asTreasury.connect(rt.orchestrator) as Contract;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const tx = await asOrchestrator.getFunction("delegate")(
    s.rootId,
    rt.momentum.address,
    CHILD_CAPACITY,
    nowSec + 12n * 3600n,
    buildRoot(CHILD_SET),
    MOMENTUM_MODEL,
  );
  const receipt = await tx.wait();
  const childId = parseDelegatedChildId(asOrchestrator, receipt.logs);
  if (childId === 0n) throw new StepError("delegate produced no Delegated event");
  s.childId = childId;
  const parent = await readMandate(rt.asTreasury, s.rootId);
  return {
    ok: true,
    outcome: "ok",
    txHash: tx.hash,
    explorerUrl: link(rt.net, tx.hash),
    network: rt.net.label,
    summary: `Sub-mandate ${childId} carved from node ${s.rootId}. Child capacity ${eth(CHILD_CAPACITY)}, parent ${s.rootId} keeps ${eth(parent.remaining)}. Scope narrowed to ${CHILD_SET.length} instruments, expiry tightened to 12h. Narrowing enforced by construction.`,
  };
}

async function step3(rt: Runtime, chain: ChainKey): Promise<StepResult> {
  const s = sessions[chain];
  if (s.childId === undefined) throw new StepError("No sub-mandate in this session. Run step 2 first.");
  await ensureGas(rt, rt.momentum);
  const asMomentum = rt.asTreasury.connect(rt.momentum) as Contract;
  const prevHead = s.localHead ?? GENESIS_HEAD;
  const proofs = [buildProof(CHILD_SET, "ETH-USD"), buildProof(ROOT_SET, "ETH-USD")];
  const outcome = await attemptExecute(asMomentum, s.childId, "ETH-USD", TRADE_ETH, proofs);
  if (outcome.status !== "executed" || !outcome.newHead) {
    throw new StepError(`ETH-USD trade did not execute (${outcome.status}${outcome.detail ? `: ${outcome.detail}` : ""})`);
  }
  s.localHead = outcome.newHead;
  return {
    ok: true,
    outcome: "ok",
    txHash: outcome.txHash ?? null,
    explorerUrl: outcome.txHash ? link(rt.net, outcome.txHash) : null,
    network: rt.net.label,
    summary: `ETH-USD executed for ${eth(TRADE_ETH)} under mandate ${s.childId}. Scope and capacity checked, receipt head ${short(prevHead)} -> ${short(outcome.newHead)}, model fingerprint bound into the chain.`,
  };
}

async function step4(rt: Runtime, chain: ChainKey): Promise<StepResult> {
  const s = sessions[chain];
  if (s.childId === undefined) throw new StepError("No sub-mandate in this session. Run step 2 first.");
  await ensureGas(rt, rt.momentum);
  const asMomentum = rt.asTreasury.connect(rt.momentum) as Contract;
  // BTC-USD is inside the ROOT scope but not the child scope: empty child proof.
  const proofs = [[], buildProof(ROOT_SET, "BTC-USD")];
  const outcome = await attemptExecute(asMomentum, s.childId, "BTC-USD", BREACH_SCOPE_AMOUNT, proofs);
  if (outcome.status !== "refused") {
    throw new StepError(`expected a scope refusal, got ${outcome.status}${outcome.detail ? `: ${outcome.detail}` : ""}`);
  }
  const parentAfter = s.rootId !== undefined ? await readMandate(rt.asTreasury, s.rootId) : undefined;
  const name = BREACH_NAMES[outcome.breachCode ?? -1] ?? "unknown";
  const parentNote = parentAfter ? ` Parent ${s.rootId} untouched (remaining ${eth(parentAfter.remaining)}).` : "";
  return {
    ok: true,
    outcome: "refused",
    txHash: outcome.txHash ?? null,
    explorerUrl: outcome.txHash ? link(rt.net, outcome.txHash) : null,
    network: rt.net.label,
    summary: `BTC-USD is inside the ROOT scope but not the momentum scope. Breach code ${outcome.breachCode} (${name}) recorded at node ${s.childId}.${parentNote} The child cannot borrow authority it was never granted.`,
  };
}

async function step5(rt: Runtime, chain: ChainKey): Promise<StepResult> {
  const s = sessions[chain];
  if (s.childId === undefined) throw new StepError("No sub-mandate in this session. Run step 2 first.");
  await ensureGas(rt, rt.momentum);
  const asMomentum = rt.asTreasury.connect(rt.momentum) as Contract;
  const proofs = [buildProof(CHILD_SET, "ETH-USD"), buildProof(ROOT_SET, "ETH-USD")];
  const outcome = await attemptExecute(asMomentum, s.childId, "ETH-USD", BREACH_CAP_AMOUNT, proofs);
  if (outcome.status !== "refused") {
    throw new StepError(`expected a capacity refusal, got ${outcome.status}${outcome.detail ? `: ${outcome.detail}` : ""}`);
  }
  const name = BREACH_NAMES[outcome.breachCode ?? -1] ?? "unknown";
  return {
    ok: true,
    outcome: "refused",
    txHash: outcome.txHash ?? null,
    explorerUrl: outcome.txHash ? link(rt.net, outcome.txHash) : null,
    network: rt.net.label,
    summary: `ETH-USD for ${eth(BREACH_CAP_AMOUNT)} is in scope but above the mandate's remaining capacity. Breach code ${outcome.breachCode} (${name}) recorded at node ${s.childId}. No spend, the escrow says no.`,
  };
}

async function step6(rt: Runtime): Promise<StepResult> {
  const net = rt.net;
  // Rails must be the chain we think, because the permit2 credential is signed
  // against this chain id and settled on-chain.
  const liveChainId = Number((await rt.provider.getNetwork()).chainId);
  if (liveChainId !== net.chainId) {
    throw new StepError(`${net.rpcEnv} reports chainId ${liveChainId}, expected ${net.chainId} for ${net.label}`);
  }
  const [permit2Code, mandateCode] = await Promise.all([
    rt.provider.getCode(PERMIT2_ADDRESS),
    rt.provider.getCode(CONTRACT),
  ]);
  if (permit2Code === "0x" || mandateCode === "0x") throw new StepError("Permit2 or HeroMandate has no code on this chain");

  await ensureGas(rt, rt.ops);
  await ensureGas(rt, rt.vendor);

  // ---- token: real Circle USDC where it exists, honest hUSD demo stablecoin otherwise.
  let tokenMode: "usdc" | "demo" = net.circleUsdc ? "usdc" : "demo";
  let tokenAddress = "";
  let tokenSymbol = "";
  if (tokenMode === "usdc" && net.circleUsdc) {
    const circleUsdc = net.circleUsdc;
    const usdcCode = await rt.provider.getCode(circleUsdc);
    if (usdcCode === "0x") {
      tokenMode = "demo";
    } else {
      const [treasuryUsdc, opsUsdc] = await Promise.all([
        balanceOf(circleUsdc, rt.treasury.address, rt.provider),
        balanceOf(circleUsdc, rt.ops.address, rt.provider),
      ]);
      if (opsUsdc >= SETTLE_AMOUNT) {
        tokenAddress = circleUsdc;
        tokenSymbol = "USDC";
      } else if (treasuryUsdc >= SETTLE_AMOUNT) {
        await transfer(circleUsdc, rt.ops.address, SETTLE_AMOUNT, rt.treasury);
        tokenAddress = circleUsdc;
        tokenSymbol = "USDC";
      } else {
        tokenMode = "demo";
      }
    }
  }
  if (tokenMode === "demo") {
    const tokenFile = path.join(OUT_DIR, net.tokenName);
    const recorded = readJson<{ address?: string }>(tokenFile);
    if (recorded?.address && (await rt.provider.getCode(recorded.address)) !== "0x") {
      tokenAddress = recorded.address;
    } else {
      const deployed = await deployHeroDemoUSD(rt.treasury);
      tokenAddress = deployed.address;
      writeJson(tokenFile, {
        address: tokenAddress,
        deployTx: deployed.txHash,
        name: HERO_DEMO_USD.name,
        symbol: HERO_DEMO_USD.symbol,
        decimals: HERO_DEMO_USD.decimals,
        deployedAt: new Date().toISOString(),
      });
    }
    tokenSymbol = HERO_DEMO_USD.symbol;
    const opsToken = await balanceOf(tokenAddress, rt.ops.address, rt.provider);
    if (opsToken < SETTLE_AMOUNT) await transfer(tokenAddress, rt.ops.address, OPS_TOKEN_TOPUP, rt.treasury);
  }

  // ---- payments mandate: treasury grants the ops agent, scope PAY-USDC only.
  // Reused across runs while unexpired, exactly as settle.ts does.
  const asOps = rt.asTreasury.connect(rt.ops) as Contract;
  const scopeRoot = buildRoot(PAY_SET);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const outFile = path.join(OUT_DIR, net.outName);
  let mandateId = 0n;
  let mandateCreateTx: string | null = null;
  const previous = readJson<{ mandate?: { id?: string } }>(outFile);
  if (previous?.mandate?.id) {
    try {
      const m = await readMandate(rt.asTreasury, BigInt(previous.mandate.id));
      const usable =
        m.agent.toLowerCase() === rt.ops.address.toLowerCase() &&
        m.scopeRoot.toLowerCase() === scopeRoot.toLowerCase() &&
        m.expiry > nowSec + 1800n &&
        m.remaining >= SETTLE_AMOUNT;
      if (usable) mandateId = BigInt(previous.mandate.id);
    } catch {
      // fall through to creation
    }
  }
  if (mandateId === 0n) {
    const tx = await rt.asTreasury.getFunction("createMandate")(
      rt.ops.address,
      nowSec + SETTLE_MANDATE_TTL,
      scopeRoot,
      SETTLEMENT_MODEL,
      { value: SETTLE_MANDATE_CAPACITY },
    );
    const receipt = await tx.wait();
    for (const entry of receipt.logs) {
      try {
        const parsed = rt.asTreasury.interface.parseLog({ topics: [...entry.topics], data: entry.data });
        if (parsed?.name === "MandateCreated") mandateId = BigInt(parsed.args.id);
      } catch {
        continue;
      }
    }
    if (mandateId === 0n) throw new StepError("createMandate produced no MandateCreated event");
    mandateCreateTx = tx.hash;
  }

  // ---- authorize: mandate accepts the spend first, THEN the ops agent signs
  // the permit2 credential, bound to the new receipt head and the exact amount.
  const permit2Reader = new Contract(PERMIT2_ADDRESS, PERMIT2_EXTRA_ABI, rt.provider);
  let nonce = BigInt(Date.now());
  for (;;) {
    const word = BigInt(await permit2Reader.getFunction("nonceBitmap")(rt.ops.address, nonce >> 8n));
    if ((word & (1n << (nonce & 255n))) === 0n) break;
    nonce += 1n;
  }
  const guard = new MandateGuard(asOps, mandateId, rt.ops, PAY_SET, [], { token: tokenAddress, nonceFor: () => nonce });
  const challenge: MppChallenge = {
    id: tokenMode === "usdc" ? net.challengeIdUsdc : net.challengeIdDemo,
    payTo: rt.vendor.address,
    asset: "USDC",
    amount: SETTLE_AMOUNT,
    memo: "vendor invoice settlement",
  };
  const authorized = await guard.authorize(challenge);
  if (!authorized.ok) throw new StepError(`mandate refused the spend, breach code ${authorized.breachCode}`);
  const credential: MandateBoundCredential = authorized.credential;
  if (!verifyCredential(credential, rt.ops.address, net.chainId)) throw new StepError("credential verification failed");

  // ---- ops approves canonical Permit2 for the token, once.
  const currentAllowance = await allowance(tokenAddress, rt.ops.address, PERMIT2_ADDRESS, rt.provider);
  if (currentAllowance < SETTLE_AMOUNT) await approveMax(tokenAddress, PERMIT2_ADDRESS, rt.ops);

  // ---- settle: the vendor redeems the credential on canonical Permit2.
  const witness = keccak256(
    AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [PAYMENT_WITNESS_TYPEHASH, credential.witness.challengeHash]),
  );
  const permit2AsVendor = new Contract(PERMIT2_ADDRESS, PERMIT2_SINGLE_ABI as unknown as InterfaceAbi, rt.vendor);
  const settleArgs = [
    {
      permitted: { token: credential.permit.permitted[0].token, amount: credential.permit.permitted[0].amount },
      nonce: credential.permit.nonce,
      deadline: credential.permit.deadline,
    },
    { to: credential.transferDetails[0].to, requestedAmount: credential.transferDetails[0].requestedAmount },
    rt.ops.address,
    witness,
    PERMIT2_WITNESS_TYPE_STRING,
    credential.signature,
  ] as const;

  const vendorBefore = await balanceOf(tokenAddress, rt.vendor.address, rt.provider);
  const settleTx = await permit2AsVendor.getFunction("permitWitnessTransferFrom")(...settleArgs);
  await settleTx.wait();
  const vendorAfter = await balanceOf(tokenAddress, rt.vendor.address, rt.provider);
  const delta = vendorAfter - vendorBefore;

  writeJson(outFile, {
    network: net.label,
    chainId: net.chainId,
    mandate: { id: mandateId.toString(), createTx: mandateCreateTx },
    settlement: { tx: settleTx.hash, token: tokenAddress, symbol: tokenSymbol, amount: SETTLE_AMOUNT.toString() },
    generatedAt: new Date().toISOString(),
  });

  const honest = tokenMode === "demo" ? " (hUSD is an honestly labeled demo stablecoin, settled through the real canonical Permit2)" : "";
  return {
    ok: true,
    outcome: "ok",
    txHash: settleTx.hash,
    explorerUrl: link(net, settleTx.hash),
    network: net.label,
    summary: `Settled ${formatUnits(delta, 6)} ${tokenSymbol} to the vendor under mandate ${mandateId}. Vendor balance ${formatUnits(vendorBefore, 6)} -> ${formatUnits(vendorAfter, 6)}. MPP credential bound to the receipt and the exact amount, Permit2 moved the token${honest}.`,
  };
}

async function step7(rt: Runtime, chain: ChainKey): Promise<StepResult> {
  const s = sessions[chain];
  if (s.childId === undefined) throw new StepError("No sub-mandate in this session. Run steps 1-3 first.");
  const view = await readMandate(rt.asTreasury, s.childId);
  const head = view.receiptHead;
  if (head.toLowerCase() === GENESIS_HEAD.toLowerCase()) {
    throw new StepError("The mandate has no receipts yet. Run step 3 (trade in-scope) first to produce a head to anchor.");
  }
  // Always anchors to Arbitrum Sepolia, regardless of the selected chain.
  const sepolia = CHAINS.sepolia;
  const sepoliaRpc = process.env[sepolia.rpcEnv];
  if (!sepoliaRpc) throw new StepError(`missing ${sepolia.rpcEnv} in ../.env, cannot anchor`);
  const sepoliaProvider = new JsonRpcProvider(sepoliaRpc);
  const sepoliaTreasury = new Wallet(rt.deployerPk, sepoliaProvider);
  const anchor = new Contract(ANCHOR_ADDRESS, ANCHOR_ABI, sepoliaTreasury);

  let anchorTxHash: string | null = null;
  let status = "anchored";
  try {
    const tx = await anchor.getFunction("anchor")(head);
    await tx.wait();
    anchorTxHash = tx.hash;
  } catch (err) {
    if (isAlreadyAnchored(err)) status = "already anchored";
    else throw new StepError(describeError(err));
  }
  const [ok, anchoredAt, submitter] = await anchor.getFunction("verify")(head);
  if (!ok) throw new StepError("anchor verify() returned false");
  return {
    ok: true,
    outcome: "ok",
    txHash: anchorTxHash,
    explorerUrl: anchorTxHash ? link(sepolia, anchorTxHash) : `${sepolia.explorer}/address/${ANCHOR_ADDRESS}`,
    network: sepolia.label,
    summary: `Momentum receipt head ${short(head)} anchored into HeroProofAnchor ${short(ANCHOR_ADDRESS)} on ${sepolia.label} (${status}). verify(head) = true, anchored at ${anchoredAt} by ${short(String(submitter))}. One engine: the contract that anchors robot-fleet proofs now attests this trading run.`,
  };
}

async function step8(rt: Runtime, chain: ChainKey): Promise<StepResult> {
  const s = sessions[chain];
  if (s.childId === undefined || s.fromBlock === undefined) {
    throw new StepError("No sub-mandate in this session. Run steps 1-3 first.");
  }
  const view = await readMandate(rt.asTreasury, s.childId);
  const result = await verifyReceiptChain(rt.asTreasury, s.childId, view.modelHash, view.receiptHead, s.fromBlock);
  if (!result.ok) {
    return {
      ok: false,
      outcome: "error",
      txHash: null,
      explorerUrl: null,
      network: rt.net.label,
      summary: `Receipt chain does NOT verify. Recomputed ${short(result.headRecomputed)} does not match on-chain ${short(view.receiptHead)}.`,
    };
  }
  return {
    ok: true,
    outcome: "verified",
    txHash: null,
    explorerUrl: null,
    network: rt.net.label,
    summary: `Receipt chain for node ${s.childId} recomputed from ${result.receipts} public Executed event(s). Recomputed head ${short(result.headRecomputed)} matches the on-chain head. One altered byte would break it.`,
  };
}

const HANDLERS: Record<number, (rt: Runtime, chain: ChainKey) => Promise<StepResult>> = {
  1: step1,
  2: step2,
  3: step3,
  4: step4,
  5: step5,
  6: step6,
  7: step7,
  8: step8,
};

async function runStep(n: number, chain: ChainKey): Promise<StepResult> {
  const net = CHAINS[chain];
  if (DRY) {
    return {
      ok: false,
      outcome: "error",
      txHash: null,
      explorerUrl: null,
      network: net.label,
      summary: `DRY MODE: step ${n} (${STEPS[n - 1]?.title ?? "?"}) endpoint is wired. No transaction was fired.`,
    };
  }
  try {
    const rt = buildRuntime(chain);
    const handler = HANDLERS[n];
    if (!handler) throw new StepError(`unknown step ${n}`);
    return await handler(rt, chain);
  } catch (err) {
    // Only the safe message is ever surfaced. The key never appears here.
    const message = err instanceof StepError ? err.message : describeError(err);
    return { ok: false, outcome: "error", txHash: null, explorerUrl: null, network: net.label, summary: message };
  }
}

// ---------------------------------------------------------------- the page

interface StepDef {
  n: number;
  title: string;
  tech: string;
}

const STEPS: StepDef[] = [
  {
    n: 1,
    title: "CREATE ROOT MANDATE",
    tech: "HeroMandate.createMandate() on Arbitrum Stylus (Rust to WASM). Escrows authority, emits MandateCreated.",
  },
  {
    n: 2,
    title: "DELEGATE SUB-MANDATE",
    tech: "HeroMandate.delegate(). Capacity is carved from the parent, so a child can never exceed it. Narrowing by construction.",
  },
  {
    n: 3,
    title: "TRADE IN-SCOPE (ETH-USD)",
    tech: "HeroMandate.execute(). Checks scope and capacity, extends the receipt hash chain, binds the model fingerprint.",
  },
  {
    n: 4,
    title: "ATTEMPT OUT-OF-SCOPE (BTC-USD)",
    tech: "Record and refuse. Breach code 3, pinned to this node, parent untouched.",
  },
  {
    n: 5,
    title: "ATTEMPT OVER-CAPACITY",
    tech: "Breach code 2. Refused and recorded.",
  },
  {
    n: 6,
    title: "SETTLE PAYMENT (MPP + Permit2)",
    tech: "Arbitrum MPP builds the payment credential, bound to the mandate receipt and the exact amount. Uniswap Permit2 moves the token. No mandate, no payment.",
  },
  {
    n: 7,
    title: "ANCHOR CROSS-CHAIN",
    tech: "HeroProofAnchor 0xb3fa...571b on Arbitrum Sepolia. The same verified contract that anchors our robot fleet now attests this trading run.",
  },
  {
    n: 8,
    title: "VERIFY RECEIPT CHAIN",
    tech: "Recomputed client side from public events. One altered byte breaks it.",
  },
];

const CSS = `
:root{
  --bg:#0a0b09; --panel:#101209; --panel2:#0e100c; --acid:#aaff00; --white:#eceee6;
  --muted:#7a7e72; --dim:#4c4f47; --err:#ff5470; --cyan:#22d3ee;
  --line:rgba(170,255,0,0.16); --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background-color:var(--bg);color:var(--white);
  background-image:linear-gradient(to right,rgba(170,255,0,.035) 1px,transparent 1px),
    linear-gradient(to bottom,rgba(170,255,0,.035) 1px,transparent 1px);
  background-size:44px 44px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;line-height:1.5;}
::selection{background:var(--acid);color:var(--bg)}
a{color:var(--acid);text-decoration:none;border-bottom:1px solid var(--line)}
a:hover{border-bottom-color:var(--acid)}
.wrap{max-width:860px;margin:0 auto;padding:1.4rem 1.1rem 4rem}
.mono{font-family:var(--mono)}
.dim{color:var(--dim)}
.muted{color:var(--muted)}
header{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1rem;padding-bottom:1rem;border-bottom:1px solid rgba(76,79,71,.5)}
.wordmark{font-weight:800;letter-spacing:.14em;font-size:1.05rem}
.wordmark b{color:var(--acid)}
.tag{font-family:var(--mono);font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);
  border:1px solid var(--dim);border-radius:999px;padding:.2rem .6rem;white-space:nowrap}
.spacer{flex:1}
.pill-btn{cursor:pointer;font-family:var(--mono);font-size:.64rem;letter-spacing:.08em;text-transform:uppercase;
  color:var(--muted);border:1px solid var(--dim);border-radius:999px;padding:.28rem .7rem;background:transparent;
  transition:border-color .12s,color .12s,background-color .12s}
.pill-btn:hover{border-color:var(--acid);color:var(--acid)}
.pill-btn[data-active="true"]{border-color:var(--acid);background:rgba(170,255,0,.08);color:var(--acid)}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:.55rem;margin:1rem 0 .4rem}
.live{display:inline-flex;align-items:center;gap:.45rem;font-family:var(--mono);font-size:.64rem;
  letter-spacing:.08em;text-transform:uppercase;color:var(--acid)}
.dot{width:.5rem;height:.5rem;border-radius:999px;background:var(--acid);box-shadow:0 0 8px rgba(170,255,0,.8);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.addr{font-family:var(--mono);font-size:.66rem;color:var(--muted);word-break:break-all}
.addr b{color:var(--white)}
.steps{margin-top:1.2rem;display:flex;flex-direction:column;gap:.7rem}
.step{background:var(--panel);border:1px solid rgba(76,79,71,.55);border-radius:.7rem;padding:.85rem .95rem}
.step-head{display:flex;align-items:center;gap:.7rem}
.num{font-family:var(--mono);font-size:.8rem;color:var(--acid);font-weight:700}
.title{font-weight:700;letter-spacing:.03em;font-size:.92rem;flex:1}
.tech{margin:.5rem 0 0;font-family:var(--mono);font-size:.68rem;color:var(--muted);line-height:1.55}
.btn{cursor:pointer;font-family:var(--mono);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;
  color:var(--acid);background:transparent;border:1px solid var(--acid);border-radius:999px;padding:.33rem .95rem;
  transition:background-color .12s,color .12s}
.btn:hover{background:var(--acid);color:var(--bg)}
.btn:disabled{border-color:var(--dim);color:var(--dim);background:transparent;cursor:progress}
.result{margin-top:.7rem;padding:.6rem .7rem;border-radius:.5rem;border:1px solid rgba(76,79,71,.4);
  background:var(--panel2);font-size:.78rem;min-height:2.1rem}
.result.idle{color:var(--dim);font-family:var(--mono);font-size:.68rem}
.result.running{color:var(--muted)}
.result.ok{border-color:var(--line)}
.result.verified{border-color:var(--acid)}
.result.refused,.result.err{border-color:var(--err)}
.verdict{font-family:var(--mono);font-weight:700;letter-spacing:.12em;margin-bottom:.35rem}
.verdict.verified{color:var(--acid)}
.verdict.refused{color:var(--err)}
.line{color:var(--white)}
.meta{margin-top:.35rem;font-family:var(--mono);font-size:.68rem;color:var(--muted)}
.meta a{font-size:.68rem}
.note{margin-top:1.4rem;font-family:var(--mono);font-size:.66rem;color:var(--muted);line-height:1.6}
footer{margin-top:1.1rem;padding-top:1rem;border-top:1px solid rgba(76,79,71,.5);
  font-family:var(--mono);font-size:.64rem;color:var(--dim);line-height:1.6}
`;

const CLIENT_JS = `
var CFG = window.__CFG__;
var chain = CFG.defaultChain;

function el(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? "" : s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function shortHash(h){ return h && h.length > 16 ? h.slice(0,10) + ".." + h.slice(-6) : h; }

function paintChain(){
  var c = CFG.chains[chain];
  document.querySelectorAll("[data-chain]").forEach(function(b){
    b.setAttribute("data-active", b.getAttribute("data-chain") === chain ? "true" : "false");
  });
  el("net-label").textContent = c.label;
  el("net-id").textContent = "chain " + c.chainId;
  el("net-explorer").textContent = c.explorer.replace("https://","");
  el("net-explorer").setAttribute("href", c.explorer);
}

function setChain(c){ chain = c; paintChain(); }

function renderResult(res, d){
  var outcome = d.outcome || (d.ok ? "ok" : "error");
  var cls = outcome === "verified" ? "verified" : outcome === "refused" ? "refused" : outcome === "error" ? "err" : "ok";
  res.className = "result " + cls;
  var html = "";
  if(outcome === "verified"){ html += '<div class="verdict verified">VERIFIED</div>'; }
  if(outcome === "refused"){ html += '<div class="verdict refused">REFUSED</div>'; }
  html += '<div class="line">' + esc(d.summary) + "</div>";
  var meta = "";
  if(d.network){ meta += esc(d.network); }
  if(d.txHash && d.explorerUrl){
    meta += (meta ? "  &middot;  " : "") + 'tx <a href="' + esc(d.explorerUrl) + '" target="_blank" rel="noreferrer">' + esc(shortHash(d.txHash)) + "</a>";
  } else if(d.explorerUrl && outcome !== "error"){
    meta += (meta ? "  &middot;  " : "") + '<a href="' + esc(d.explorerUrl) + '" target="_blank" rel="noreferrer">view contract</a>';
  }
  if(meta){ html += '<div class="meta">' + meta + "</div>"; }
  res.innerHTML = html;
}

async function runStep(btn){
  var n = btn.getAttribute("data-run");
  var res = el("result-" + n);
  var label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "RUNNING";
  res.className = "result running";
  res.innerHTML = '<span class="mono">firing step ' + n + " on " + esc(CFG.chains[chain].label) + " ...</span>";
  try{
    var r = await fetch("/api/step/" + n, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain: chain })
    });
    var data = await r.json();
    renderResult(res, data);
  }catch(e){
    res.className = "result err";
    res.innerHTML = '<div class="line">network error: ' + esc(e && e.message ? e.message : e) + "</div>";
  }finally{
    btn.disabled = false;
    btn.textContent = label;
  }
}

document.querySelectorAll("[data-chain]").forEach(function(b){
  b.addEventListener("click", function(){ setChain(b.getAttribute("data-chain")); });
});
document.querySelectorAll("[data-run]").forEach(function(b){
  b.addEventListener("click", function(){ runStep(b); });
});
paintChain();
`;

function renderStepCard(s: StepDef): string {
  const num = String(s.n).padStart(2, "0");
  return `
    <div class="step" id="card-${s.n}">
      <div class="step-head">
        <span class="num">${num}</span>
        <span class="title">${s.title}</span>
        <button class="btn" data-run="${s.n}">RUN</button>
      </div>
      <div class="tech">${s.tech}</div>
      <div class="result idle" id="result-${s.n}">idle, click RUN to fire this step live</div>
    </div>`;
}

function renderPage(): string {
  const cfg = {
    contract: CONTRACT,
    anchor: ANCHOR_ADDRESS,
    defaultChain: "robinhood",
    chains: {
      robinhood: { label: CHAINS.robinhood.label, chainId: CHAINS.robinhood.chainId, explorer: CHAINS.robinhood.explorer },
      sepolia: { label: CHAINS.sepolia.label, chainId: CHAINS.sepolia.chainId, explorer: CHAINS.sepolia.explorer },
    },
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Hero Mandate operator cockpit</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header>
    <span class="wordmark">HERO <b>MANDATE</b></span>
    <span class="tag">operator cockpit</span>
    <span class="spacer"></span>
    <button class="pill-btn" data-chain="robinhood">Robinhood Chain</button>
    <button class="pill-btn" data-chain="sepolia">Arbitrum Sepolia</button>
  </header>

  <div class="bar">
    <span class="live"><span class="dot"></span> LIVE ON <span id="net-label"></span></span>
    <span class="tag" id="net-id"></span>
    <span class="tag">contract ${CONTRACT}</span>
    <a class="tag" id="net-explorer" target="_blank" rel="noreferrer"></a>
  </div>
  <div class="addr">HeroMandate <b>${CONTRACT}</b> &middot; every step below fires a REAL transaction on the selected chain.</div>

  <div class="steps">
    ${STEPS.map(renderStepCard).join("")}
  </div>

  <div class="note">
    RESET: re-running step 1 opens a fresh mandate tree, so the ids increment on every pass. Steps 2-5, 7 and 8 act on the tree opened by the most recent step 1 on the selected chain. Step 6 settles through its own reusable payments mandate.
  </div>

  <footer>
    Local operator cockpit. The signing key stays on this machine. The public site at hero-mandate.netlify.app is read-only.
  </footer>
</div>
<script>window.__CFG__ = ${JSON.stringify(cfg)};</script>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

const PAGE = renderPage();

// ---------------------------------------------------------------- server

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = req.url || "/";
    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(PAGE);
      return;
    }
    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, dry: DRY }));
      return;
    }
    const m = url.match(/^\/api\/step\/([1-8])$/);
    if (req.method === "POST" && m) {
      const body = await readBody(req);
      let chain: ChainKey = "robinhood";
      try {
        const parsed = JSON.parse(body || "{}");
        if (parsed.chain === "sepolia" || parsed.chain === "robinhood") chain = parsed.chain;
      } catch {
        // default chain
      }
      const result = await runStep(Number(m[1]), chain);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  } catch (err) {
    // Never leak internals or the key: only the safe description escapes.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ ok: false, outcome: "error", txHash: null, explorerUrl: null, network: "", summary: describeError(err) }),
    );
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Hero Mandate cockpit on http://localhost:${PORT}${DRY ? "  [DRY: no transactions will fire]" : ""}`);
  console.log("The signing key is loaded into this process only and is never sent to the browser.");
});
