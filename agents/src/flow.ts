// Hero Mandate unified stage flow.
// The complete story in one command, against a deployed HeroMandate contract:
//   beats 1-6  chain of mandate (same scenario as run.ts)
//   beat 7     machine payment under mandate (MPP permit2 credential)
//   beat 8     cross-chain anchor into HeroProofAnchor on Arbitrum Sepolia
// Usage: npx tsx src/flow.ts --chain robinhood|sepolia --address 0x... [--step] [--no-anchor]

import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import {
  Contract,
  EventLog,
  JsonRpcProvider,
  Wallet,
  dataSlice,
  formatEther,
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
import { MandateGuard, MppChallenge, verifyCredential } from "./mpp-guard";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

// ---------------------------------------------------------------- chains

const CHAINS = {
  robinhood: {
    label: "Robinhood Chain testnet",
    rpcEnv: "RPC_ROBINHOOD",
    explorerTxBase: "https://explorer.testnet.chain.robinhood.com/tx/",
  },
  sepolia: {
    label: "Arbitrum Sepolia",
    rpcEnv: "RPC_ARB_SEPOLIA",
    explorerTxBase: "https://sepolia.arbiscan.io/tx/",
  },
} as const;

type ChainKey = keyof typeof CHAINS;

// ---------------------------------------------------------------- scenario constants

// The root scope grants PAY-USDC alongside the trading instruments because
// execute() proves every leaf against the whole lineage: the beat 7 payments
// sub-mandate can only spend what its root ancestor also allows.
const ROOT_SET = ["ETH-USD", "ARB-USD", "BTC-USD", "PAY-USDC"];
const CHILD_SET = ["ETH-USD", "ARB-USD"];
const PAY_SET = ["PAY-USDC"];

const ORCHESTRATOR_MODEL = keccak256(toUtf8Bytes("hero-orchestrator-v1"));
const MOMENTUM_MODEL = keccak256(toUtf8Bytes("hero-momentum-v1"));
const PAYER_MODEL = keccak256(toUtf8Bytes("hero-payer-v1"));

const ROOT_CAPACITY = parseEther("0.005");
const CHILD_CAPACITY = parseEther("0.0015");
const TRADE_ETH = parseEther("0.0004");
const TRADE_ARB = parseEther("0.0003");
const BREACH_SCOPE_AMOUNT = parseEther("0.0002");
const BREACH_CAP_AMOUNT = parseEther("0.005");
const GAS_STAKE = parseEther("0.0005");

const PAY_CAPACITY = parseEther("0.0005");
const PAY_AMOUNT = 200000000000000n; // 0.0002 ETH equivalent, the mandate amount
const PAY_OVER_AMOUNT = parseEther("0.001");

// Fixed demo recipient: keccak("hero-data-feed") truncated to 20 bytes.
const DATA_FEED_RECIPIENT = getAddress(dataSlice(keccak256(toUtf8Bytes("hero-data-feed")), 0, 20));

// HeroProofAnchor on Arbitrum Sepolia, the same contract that anchors the
// Hero robot-fleet proofs. Verified source; anchor() is permissionless.
const ANCHOR_ADDRESS = "0xb3fa3222130fac54b90e37835dce4f052349571b";
const ANCHOR_ABI = [
  "function anchor(bytes32)",
  "function verify(bytes32) view returns (bool,uint64,address)",
  "event ProofAnchored(bytes32 indexed proofRoot, address indexed submitter, uint64 timestamp)",
  "error AlreadyAnchored(bytes32 proofRoot)",
];
const ARBISCAN_TX = "https://sepolia.arbiscan.io/tx/";

const BREACH_NAMES: Record<number, string> = {
  1: "expiry",
  2: "capacity",
  3: "scope",
  4: "caller",
};

// ---------------------------------------------------------------- log helpers

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function log(tag: string, msg: string): void {
  console.log(`[${ts()}] ${tag.padEnd(10)} ${msg}`);
}

function hr(): void {
  console.log("-".repeat(78));
}

// Presenter mode: with --step, each beat waits for Enter so the narration
// controls the pace and the console updates land on cue.
const STEP_MODE = process.argv.includes("--step");

async function stepGate(beat: string): Promise<void> {
  if (!STEP_MODE) return;
  process.stdout.write(`\n>> ${beat}  [Enter]`);
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
  console.log("");
}

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

const ALREADY_ANCHORED_SELECTOR = id("AlreadyAnchored(bytes32)").slice(0, 10);

function isAlreadyAnchored(err: unknown): boolean {
  const e = err as { revert?: { name?: string }; data?: unknown; shortMessage?: string; message?: string };
  if (e?.revert?.name === "AlreadyAnchored") return true;
  if (typeof e?.data === "string" && e.data.startsWith(ALREADY_ANCHORED_SELECTOR)) return true;
  return `${e?.shortMessage ?? ""} ${e?.message ?? ""}`.includes("AlreadyAnchored");
}

// ---------------------------------------------------------------- args

interface Args {
  chain: ChainKey;
  address: string;
  noAnchor: boolean;
}

function parseArgs(argv: string[]): Args {
  let chain: string | undefined;
  let address: string | undefined;
  let noAnchor = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--chain") chain = argv[++i];
    else if (argv[i] === "--address") address = argv[++i];
    else if (argv[i] === "--no-anchor") noAnchor = true;
  }
  if ((chain !== "robinhood" && chain !== "sepolia") || !address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    console.error("usage: tsx src/flow.ts --chain robinhood|sepolia --address 0xCONTRACT [--step] [--no-anchor]");
    process.exit(1);
  }
  return { chain, address, noAnchor };
}

// ---------------------------------------------------------------- execute wrapper

interface ExecOutcome {
  status: "executed" | "refused" | "reverted" | "unknown";
  txHash?: string;
  newHead?: string;
  timestamp?: bigint;
  breachCode?: number;
  detail?: string;
}

// execute() returns bool and does NOT revert on refusal. Success and refusal
// are read from the receipt logs (Executed vs Breach). A hard revert, for
// example a wrong caller, is caught and reported instead of crashing the run.
async function attemptExecute(
  contract: Contract,
  contractAddress: string,
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
      if (entry.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
      let parsed;
      try {
        parsed = contract.interface.parseLog({ topics: [...entry.topics], data: entry.data });
      } catch {
        continue;
      }
      if (!parsed) continue;
      if (parsed.name === "Executed" && parsed.args.id === mandateId) {
        return {
          status: "executed",
          txHash,
          newHead: String(parsed.args.newHead),
          timestamp: BigInt(parsed.args.timestamp),
        };
      }
      if (parsed.name === "Breach" && parsed.args.id === mandateId) {
        return { status: "refused", txHash, breachCode: Number(parsed.args.code) };
      }
    }
    return { status: "unknown", txHash, detail: "no Executed or Breach event found in receipt" };
  } catch (err) {
    return { status: "reverted", txHash, detail: describeError(err) };
  }
}

// ---------------------------------------------------------------- mandate readback

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

// ---------------------------------------------------------------- receipt verification

interface VerifyResult {
  ok: boolean;
  receipts: number;
  headOnChain: string;
  headRecomputed: string;
}

async function verifyReceiptChain(
  contract: Contract,
  mandateId: bigint,
  modelHash: string,
  headOnChain: string,
  fromBlock: number,
): Promise<VerifyResult> {
  const raw = await contract.queryFilter(contract.filters.Executed(mandateId), fromBlock, "latest");
  const events = raw.filter((e): e is EventLog => e instanceof EventLog);
  events.sort(
    (a, b) => a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex || a.index - b.index,
  );
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
  return {
    ok: linksIntact && head.toLowerCase() === headOnChain.toLowerCase(),
    receipts: events.length,
    headOnChain,
    headRecomputed: head,
  };
}

// ---------------------------------------------------------------- delegated event id

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

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const { chain, address, noAnchor } = parseArgs(process.argv.slice(2));
  const net = CHAINS[chain];
  const link = (hash: string) => `${net.explorerTxBase}${hash}`;

  const rpc = process.env[net.rpcEnv];
  if (!rpc) {
    console.error(`missing ${net.rpcEnv} in ../.env`);
    process.exit(1);
  }
  const rawPk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rawPk) {
    console.error("missing DEPLOYER_PRIVATE_KEY in ../.env");
    process.exit(1);
  }
  const deployerPk = rawPk.startsWith("0x") ? rawPk : `0x${rawPk}`;

  const provider = new JsonRpcProvider(rpc);

  // Deterministic cast. Sub-agent keys are derived from the deployer key and
  // an index, so the same wallets appear on every run. Keys are never printed.
  const treasury = new Wallet(deployerPk, provider);
  const orchestrator = new Wallet(keccak256(solidityPacked(["bytes32", "uint256"], [deployerPk, 1])), provider);
  const momentum = new Wallet(keccak256(solidityPacked(["bytes32", "uint256"], [deployerPk, 2])), provider);
  const ops = new Wallet(keccak256(solidityPacked(["bytes32", "uint256"], [deployerPk, 3])), provider);

  const asTreasury = new Contract(address, HERO_MANDATE_ABI, treasury);
  const asOrchestrator = asTreasury.connect(orchestrator) as Contract;
  const asMomentum = asTreasury.connect(momentum) as Contract;
  const asOps = asTreasury.connect(ops) as Contract;

  console.log("");
  console.log("HERO MANDATE :: full flow :: mandate, payment, anchor");
  console.log(`chain ${net.label} (${chain})  contract ${address}`);
  hr();

  const code = await provider.getCode(address);
  if (code === "0x") {
    console.error(`no contract code at ${address} on ${net.label}. Check --address and --chain.`);
    process.exit(1);
  }

  log("BOOT", `treasury      ${treasury.address}`);
  log("BOOT", `orchestrator  ${orchestrator.address}`);
  log("BOOT", `momentum      ${momentum.address}`);
  log("BOOT", `ops           ${ops.address}`);

  const treasuryBefore = await provider.getBalance(treasury.address);
  if (treasuryBefore < parseEther("0.008")) {
    console.error(`treasury balance ${eth(treasuryBefore)} is too low. Need about 0.008 ETH for escrow plus gas.`);
    process.exit(1);
  }

  const summary: Record<string, unknown> = {
    chain,
    network: net.label,
    contract: address,
    explorerTxBase: net.explorerTxBase,
    wallets: {
      treasury: treasury.address,
      orchestrator: orchestrator.address,
      momentum: momentum.address,
      ops: ops.address,
    },
  };
  const fundingTxs: Record<string, string> = {};

  // Gas stakes for the three agent wallets.
  for (const [label, wallet] of [
    ["orchestrator", orchestrator],
    ["momentum", momentum],
    ["ops", ops],
  ] as const) {
    const balance = await provider.getBalance(wallet.address);
    if (balance >= GAS_STAKE) {
      log("FUND", `${label} gas ok (${eth(balance)})`);
      continue;
    }
    log("FUND", `${label} below gas stake, sending ${eth(GAS_STAKE)} from treasury`);
    const tx = await treasury.sendTransaction({ to: wallet.address, value: GAS_STAKE });
    await tx.wait();
    fundingTxs[label] = tx.hash;
    log("FUND", `${label} funded  tx ${link(tx.hash)}`);
  }
  summary.fundingTxs = fundingTxs;
  hr();

  let failures = 0;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const rootExpiry = nowSec + 24n * 3600n;
  const childExpiry = nowSec + 12n * 3600n;
  const rootScopeRoot = buildRoot(ROOT_SET);
  const childScopeRoot = buildRoot(CHILD_SET);
  const payScopeRoot = buildRoot(PAY_SET);

  await stepGate("beat 1: create the root mandate");
  // Beat 1: treasury opens the root mandate for the orchestrator.
  log("NODE 1", "treasury opens the root mandate for the orchestrator");
  const createTx = await asTreasury.getFunction("createMandate")(
    orchestrator.address,
    rootExpiry,
    rootScopeRoot,
    ORCHESTRATOR_MODEL,
    { value: ROOT_CAPACITY },
  );
  const createReceipt = await createTx.wait();
  const fromBlock = createReceipt.blockNumber as number;
  let rootId = 0n;
  for (const entry of createReceipt.logs) {
    try {
      const parsed = asTreasury.interface.parseLog({ topics: [...entry.topics], data: entry.data });
      if (parsed?.name === "MandateCreated") rootId = BigInt(parsed.args.id);
    } catch {
      continue;
    }
  }
  log("NODE 1", `mandate id ${rootId}  capacity ${eth(ROOT_CAPACITY)} escrowed  expiry now+24h`);
  log("NODE 1", `scope committed as merkle root over ${ROOT_SET.length} instruments (set stays private)`);
  log("NODE 1", `model hero-orchestrator-v1 bound as ${short(ORCHESTRATOR_MODEL)}`);
  log("NODE 1", `tx ${link(createTx.hash)}`);
  hr();

  await stepGate("beat 2: delegate to the momentum sub-agent");
  // Beat 2: orchestrator carves a momentum sub-mandate out of node 1.
  log("NODE 2", "orchestrator carves a momentum sub-mandate out of node 1");
  const delegateTx = await asOrchestrator.getFunction("delegate")(
    rootId,
    momentum.address,
    CHILD_CAPACITY,
    childExpiry,
    childScopeRoot,
    MOMENTUM_MODEL,
  );
  const delegateReceipt = await delegateTx.wait();
  const childId = parseDelegatedChildId(asOrchestrator, delegateReceipt.logs);
  log("NODE 2", `mandate id ${childId}  narrowing enforced by construction:`);
  log("", `  capacity  ${eth(CHILD_CAPACITY)} physically carved out of node ${rootId}, parent keeps ${eth(ROOT_CAPACITY - CHILD_CAPACITY)}`);
  log("", "  expiry    24h tightened to 12h, checked at delegation");
  log("", `  scope     committed root over ${CHILD_SET.length} instruments, a strict subset in effect`);
  log("NODE 2", `model hero-momentum-v1 bound as ${short(MOMENTUM_MODEL)}`);
  log("NODE 2", `tx ${link(delegateTx.hash)}`);
  hr();

  await stepGate("beat 3: two in-mandate trades");
  // Beat 3: momentum executes two in-scope trades. Proofs prove the child's
  // own instrument against its root AND against the parent's root, so the
  // whole lineage authorizes every trade.
  const executions: Array<Record<string, unknown>> = [];
  let localHead = GENESIS_HEAD;
  for (const [symbol, amount] of [
    ["ETH-USD", TRADE_ETH],
    ["ARB-USD", TRADE_ARB],
  ] as const) {
    log("EXEC", `momentum trades ${symbol} for ${eth(amount)}`);
    const proofs = [buildProof(CHILD_SET, symbol), buildProof(ROOT_SET, symbol)];
    const outcome = await attemptExecute(asMomentum, address, childId, symbol, amount, proofs);
    if (outcome.status === "executed" && outcome.newHead && outcome.timestamp !== undefined) {
      const expected = nextHead(localHead, {
        instrument: instrumentId(symbol),
        amount,
        modelHash: MOMENTUM_MODEL,
        timestamp: outcome.timestamp,
      });
      const linkOk = expected.toLowerCase() === outcome.newHead.toLowerCase();
      log("EXEC", `receipt head ${short(localHead)} -> ${short(outcome.newHead)}${linkOk ? "" : "  LINK MISMATCH"}`);
      log("EXEC", `tx ${link(outcome.txHash ?? "")}`);
      if (!linkOk) failures++;
      localHead = outcome.newHead;
      executions.push({
        instrument: symbol,
        amountWei: amount.toString(),
        txHash: outcome.txHash,
        newHead: outcome.newHead,
        timestamp: outcome.timestamp.toString(),
      });
    } else {
      failures++;
      log("EXEC", `UNEXPECTED ${outcome.status}${outcome.detail ? `: ${outcome.detail}` : ""}${outcome.breachCode !== undefined ? ` (breach code ${outcome.breachCode})` : ""}`);
      if (outcome.txHash) log("EXEC", `tx ${link(outcome.txHash)}`);
    }
  }
  summary.executions = executions;
  hr();

  const breaches: Array<Record<string, unknown>> = [];
  const parentBefore = await readMandate(asTreasury, rootId);

  await stepGate("beat 4: scope breach attempt");
  // Beat 4: BTC-USD sits inside the ROOT scope but not inside the child's.
  // The child cannot borrow authority its own node was never granted.
  log("ATTEMPT", `momentum tries BTC-USD for ${eth(BREACH_SCOPE_AMOUNT)}`);
  log("ATTEMPT", "BTC-USD is inside the ROOT scope but NOT inside the momentum scope");
  const btcOutcome = await attemptExecute(asMomentum, address, childId, "BTC-USD", BREACH_SCOPE_AMOUNT, [
    [],
    buildProof(ROOT_SET, "BTC-USD"),
  ]);
  if (btcOutcome.status === "refused") {
    const codeName = BREACH_NAMES[btcOutcome.breachCode ?? -1] ?? "unknown";
    log("RESULT", "REFUSED");
    log("RESULT", `BREACH RECORDED AT NODE ${childId}  code ${btcOutcome.breachCode} (${codeName})`);
    const parentAfter = await readMandate(asTreasury, rootId);
    const untouched =
      parentAfter.remaining === parentBefore.remaining && parentAfter.breaches === parentBefore.breaches;
    log(
      "RESULT",
      `PARENT UNTOUCHED  node ${rootId} remaining ${eth(parentAfter.remaining)}  breaches ${parentAfter.breaches}${untouched ? "" : "  WARNING: parent state moved"}`,
    );
    if (!untouched) failures++;
    log("RESULT", `tx ${link(btcOutcome.txHash ?? "")}`);
    breaches.push({
      instrument: "BTC-USD",
      amountWei: BREACH_SCOPE_AMOUNT.toString(),
      code: btcOutcome.breachCode,
      nodeId: childId.toString(),
      txHash: btcOutcome.txHash,
    });
  } else {
    failures++;
    log("RESULT", `UNEXPECTED ${btcOutcome.status}${btcOutcome.detail ? `: ${btcOutcome.detail}` : ""}`);
    if (btcOutcome.txHash) log("RESULT", `tx ${link(btcOutcome.txHash)}`);
  }
  hr();

  await stepGate("beat 5: capacity breach attempt");
  // Beat 5: an over-capacity trade. In scope, but the escrow says no.
  log("ATTEMPT", `momentum tries ETH-USD for ${eth(BREACH_CAP_AMOUNT)}, above its remaining capacity`);
  const capOutcome = await attemptExecute(asMomentum, address, childId, "ETH-USD", BREACH_CAP_AMOUNT, [
    buildProof(CHILD_SET, "ETH-USD"),
    buildProof(ROOT_SET, "ETH-USD"),
  ]);
  if (capOutcome.status === "refused") {
    const codeName = BREACH_NAMES[capOutcome.breachCode ?? -1] ?? "unknown";
    log("RESULT", "REFUSED");
    log("RESULT", `BREACH RECORDED AT NODE ${childId}  code ${capOutcome.breachCode} (${codeName})`);
    log("RESULT", `tx ${link(capOutcome.txHash ?? "")}`);
    breaches.push({
      instrument: "ETH-USD",
      amountWei: BREACH_CAP_AMOUNT.toString(),
      code: capOutcome.breachCode,
      nodeId: childId.toString(),
      txHash: capOutcome.txHash,
    });
  } else {
    failures++;
    log("RESULT", `UNEXPECTED ${capOutcome.status}${capOutcome.detail ? `: ${capOutcome.detail}` : ""}`);
    if (capOutcome.txHash) log("RESULT", `tx ${link(capOutcome.txHash)}`);
  }
  summary.breaches = breaches;
  hr();

  await stepGate("beat 6: verify receipt chains");
  // Beat 6: read both nodes back and recompute the receipt chains from events.
  const rootView = await readMandate(asTreasury, rootId);
  const childView = await readMandate(asTreasury, childId);
  log("NODE 1", `remaining ${eth(rootView.remaining)}  breaches ${rootView.breaches}  head ${short(rootView.receiptHead)}`);
  log("NODE 2", `remaining ${eth(childView.remaining)}  breaches ${childView.breaches}  head ${short(childView.receiptHead)}`);

  const verification: Record<string, unknown> = {};
  for (const [label, mandateId, view] of [
    ["root", rootId, rootView],
    ["momentum", childId, childView],
  ] as const) {
    const result = await verifyReceiptChain(asTreasury, mandateId, view.modelHash, view.receiptHead, fromBlock);
    const verdict = result.ok ? "VERIFIED" : "BROKEN";
    log("VERIFY", `node ${mandateId} receipt chain recomputed from ${result.receipts} Executed event(s): ${verdict}`);
    if (!result.ok) {
      failures++;
      log("VERIFY", `  on-chain ${result.headOnChain}  recomputed ${result.headRecomputed}`);
    }
    verification[label] = {
      nodeId: mandateId.toString(),
      receipts: result.receipts,
      headOnChain: result.headOnChain,
      headRecomputed: result.headRecomputed,
      verdict,
    };
  }
  hr();

  await stepGate("beat 7: machine payment under mandate");
  // Beat 7: the orchestrator carves a PAYMENTS sub-mandate for the ops agent.
  // An MPP payment challenge is answered only after the mandate contract
  // accepts the spend, so the payment credential cannot outrun the authority.
  log("NODE 3", "orchestrator carves a payments sub-mandate for the ops agent");
  const payExpiry = BigInt(Math.floor(Date.now() / 1000)) + 6n * 3600n;
  const payDelegateTx = await asOrchestrator.getFunction("delegate")(
    rootId,
    ops.address,
    PAY_CAPACITY,
    payExpiry,
    payScopeRoot,
    PAYER_MODEL,
  );
  const payDelegateReceipt = await payDelegateTx.wait();
  const payId = parseDelegatedChildId(asOrchestrator, payDelegateReceipt.logs);
  log("NODE 3", `mandate id ${payId}  capacity ${eth(PAY_CAPACITY)} carved out of node ${rootId}  expiry now+6h`);
  log("NODE 3", "scope committed as a single-leaf merkle root: PAY-USDC only, no trading authority");
  log("NODE 3", `model hero-payer-v1 bound as ${short(PAYER_MODEL)}`);
  log("NODE 3", `tx ${link(payDelegateTx.hash)}`);

  const chainId = Number((await provider.getNetwork()).chainId);
  const guard = new MandateGuard(asOps, payId, ops, PAY_SET, [ROOT_SET]);

  log("PAY", `data feed vendor ${DATA_FEED_RECIPIENT} challenges for ${eth(PAY_AMOUNT)} equivalent in USDC`);
  const challenge: MppChallenge = {
    id: "chg-stage-001",
    payTo: DATA_FEED_RECIPIENT,
    asset: "USDC",
    amount: PAY_AMOUNT,
    memo: "market data feed",
  };
  const paid = await guard.authorize(challenge);
  let paymentSummary: Record<string, unknown> = {};
  if (paid.ok) {
    log("PAY", `execute tx ${link(paid.txHash)}`);
    log("PAY", `receipt head ${paid.receiptHead}`);
    log("PAY", `MPP permit2 credential signed, bound to receipt head ${short(paid.receiptHead)}`);
    log("PAY", `challenge hash ${short(paid.credential.witness.challengeHash)}`);
    const verified = verifyCredential(paid.credential, ops.address, chainId);
    if (verified) {
      log("PAY", "CREDENTIAL VERIFIED");
    } else {
      failures++;
      log("PAY", "CREDENTIAL VERIFICATION FAILED");
    }
    paymentSummary = {
      nodeId: payId.toString(),
      challengeId: challenge.id,
      recipient: DATA_FEED_RECIPIENT,
      amountWei: PAY_AMOUNT.toString(),
      memo: challenge.memo,
      executeTx: paid.txHash,
      receiptHead: paid.receiptHead,
      challengeHash: paid.credential.witness.challengeHash,
      signer: ops.address,
      credentialVerified: verified,
    };
  } else {
    failures++;
    log("PAY", `UNEXPECTED refusal, breach code ${paid.breachCode}  tx ${link(paid.txHash)}`);
  }

  // The negative: a second challenge above the payment mandate's remaining
  // capacity. The contract refuses, records the breach, and no credential
  // can exist. Payment authority is escrow, not policy.
  log("ATTEMPT", `second challenge asks ${eth(PAY_OVER_AMOUNT)}, above the payment mandate's remaining capacity`);
  const refused = await guard.authorize({
    id: "chg-stage-002",
    payTo: DATA_FEED_RECIPIENT,
    asset: "USDC",
    amount: PAY_OVER_AMOUNT,
    memo: "bulk data backfill",
  });
  if (!refused.ok && refused.breachCode === 2) {
    log("RESULT", "REFUSED");
    log("RESULT", `BREACH RECORDED AT NODE ${payId}  code 2 (capacity)  no credential signed`);
    log("RESULT", `tx ${link(refused.txHash)}`);
    log("RESULT", "NO MANDATE, NO PAYMENT.");
  } else {
    failures++;
    log("RESULT", `UNEXPECTED ${refused.ok ? "a credential was signed for an over-capacity spend" : `breach code ${refused.breachCode}`}`);
  }
  summary.payment = {
    ...paymentSummary,
    refused: {
      challengeId: "chg-stage-002",
      amountWei: PAY_OVER_AMOUNT.toString(),
      breachCode: refused.ok ? null : refused.breachCode,
      txHash: refused.txHash,
      credentialSigned: refused.ok,
    },
  };

  const payView = await readMandate(asTreasury, payId);
  log("NODE 3", `remaining ${eth(payView.remaining)}  breaches ${payView.breaches}  head ${short(payView.receiptHead)}`);
  {
    const result = await verifyReceiptChain(asTreasury, payId, payView.modelHash, payView.receiptHead, fromBlock);
    const verdict = result.ok ? "VERIFIED" : "BROKEN";
    log("VERIFY", `node ${payId} receipt chain recomputed from ${result.receipts} Executed event(s): ${verdict}`);
    if (!result.ok) failures++;
    verification.payments = {
      nodeId: payId.toString(),
      receipts: result.receipts,
      headOnChain: result.headOnChain,
      headRecomputed: result.headRecomputed,
      verdict,
    };
  }
  summary.verification = verification;
  hr();

  await stepGate("beat 8: cross-chain anchor");
  // Beat 8: anchor the momentum node's final receipt head from THIS run into
  // HeroProofAnchor on Arbitrum Sepolia, the contract that already anchors
  // the Hero robot-fleet proofs.
  const momentumFinalHead = childView.receiptHead;
  let anchorSummary: Record<string, unknown> = { status: "skipped" };
  let sepoliaBefore: bigint | undefined;
  let sepoliaAfter: bigint | undefined;
  if (noAnchor) {
    log("ANCHOR", "skipped (--no-anchor)");
  } else if (chain !== "robinhood") {
    log("ANCHOR", `skipped: this run already lives on ${net.label}, the cross-chain anchor beat is for the robinhood run`);
  } else if (!process.env.RPC_ARB_SEPOLIA) {
    failures++;
    log("ANCHOR", "missing RPC_ARB_SEPOLIA in ../.env, cannot anchor");
  } else {
    const sepoliaProvider = new JsonRpcProvider(process.env.RPC_ARB_SEPOLIA);
    const sepoliaTreasury = new Wallet(deployerPk, sepoliaProvider);
    const anchorContract = new Contract(ANCHOR_ADDRESS, ANCHOR_ABI, sepoliaTreasury);
    sepoliaBefore = await sepoliaProvider.getBalance(sepoliaTreasury.address);
    log("ANCHOR", `momentum final receipt head from this run: ${momentumFinalHead}`);
    log("ANCHOR", `anchoring into HeroProofAnchor ${ANCHOR_ADDRESS} on Arbitrum Sepolia`);
    let anchorTxHash: string | undefined;
    let anchorStatus = "anchored";
    try {
      const tx = await anchorContract.getFunction("anchor")(momentumFinalHead);
      await tx.wait();
      anchorTxHash = tx.hash;
      log("ANCHOR", `tx ${ARBISCAN_TX}${tx.hash}`);
    } catch (err) {
      if (isAlreadyAnchored(err)) {
        anchorStatus = "already-anchored";
        log("ANCHOR", "already anchored, verifying instead");
      } else {
        anchorStatus = "failed";
        failures++;
        log("ANCHOR", `UNEXPECTED: ${describeError(err)}`);
      }
    }
    try {
      const [ok, anchoredAt, submitter] = await anchorContract.getFunction("verify")(momentumFinalHead);
      log("ANCHOR", `verify(head) -> (${ok}, ${anchoredAt}, ${submitter})`);
      if (!ok) failures++;
      anchorSummary = {
        status: anchorStatus,
        head: momentumFinalHead,
        txHash: anchorTxHash ?? null,
        explorer: anchorTxHash ? `${ARBISCAN_TX}${anchorTxHash}` : null,
        verified: Boolean(ok),
        anchoredAt: String(anchoredAt),
        submitter: String(submitter),
        contract: ANCHOR_ADDRESS,
      };
    } catch (err) {
      failures++;
      log("ANCHOR", `verify failed: ${describeError(err)}`);
      anchorSummary = { status: anchorStatus, head: momentumFinalHead, txHash: anchorTxHash ?? null, verified: false };
    }
    log("ANCHOR", "one engine: the contract that anchors robot fleet proofs now attests this trading run.");
    sepoliaAfter = await sepoliaProvider.getBalance(sepoliaTreasury.address);
  }
  summary.anchor = anchorSummary;
  hr();

  // Cost summary. The escrow is not burned: remaining capacity returns to
  // the treasury via reclaim() after expiry.
  const treasuryAfter = await provider.getBalance(treasury.address);
  log("COST", `treasury on ${chain}: ${eth(treasuryBefore)} -> ${eth(treasuryAfter)}  spent ${eth(treasuryBefore - treasuryAfter)}`);
  if (sepoliaBefore !== undefined && sepoliaAfter !== undefined) {
    log("COST", `treasury on sepolia (anchor): ${eth(sepoliaBefore)} -> ${eth(sepoliaAfter)}  spent ${eth(sepoliaBefore - sepoliaAfter)}`);
  }
  log("COST", `of which ${eth(ROOT_CAPACITY)} is escrowed capacity, reclaimable after expiry via reclaim()`);
  summary.cost = {
    treasuryBeforeWei: treasuryBefore.toString(),
    treasuryAfterWei: treasuryAfter.toString(),
    spentWei: (treasuryBefore - treasuryAfter).toString(),
    escrowedReclaimableWei: ROOT_CAPACITY.toString(),
    sepoliaBeforeWei: sepoliaBefore?.toString() ?? null,
    sepoliaAfterWei: sepoliaAfter?.toString() ?? null,
    sepoliaSpentWei: sepoliaBefore !== undefined && sepoliaAfter !== undefined ? (sepoliaBefore - sepoliaAfter).toString() : null,
  };

  summary.mandates = {
    root: {
      id: rootId.toString(),
      agent: rootView.agent,
      remainingWei: rootView.remaining.toString(),
      expiry: rootView.expiry.toString(),
      scopeRoot: rootView.scopeRoot,
      modelHash: rootView.modelHash,
      receiptHead: rootView.receiptHead,
      breaches: rootView.breaches.toString(),
      createTx: createTx.hash,
    },
    momentum: {
      id: childId.toString(),
      agent: childView.agent,
      remainingWei: childView.remaining.toString(),
      expiry: childView.expiry.toString(),
      scopeRoot: childView.scopeRoot,
      modelHash: childView.modelHash,
      receiptHead: childView.receiptHead,
      breaches: childView.breaches.toString(),
      delegateTx: delegateTx.hash,
    },
    payments: {
      id: payId.toString(),
      agent: payView.agent,
      remainingWei: payView.remaining.toString(),
      expiry: payView.expiry.toString(),
      scopeRoot: payView.scopeRoot,
      modelHash: payView.modelHash,
      receiptHead: payView.receiptHead,
      breaches: payView.breaches.toString(),
      delegateTx: payDelegateTx.hash,
    },
  };
  summary.generatedAt = new Date().toISOString();

  const outDir = path.join(__dirname, "..", "out");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `flow-${chain}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(summary, null, 2)}\n`);
  hr();
  log("DONE", `summary written to ${outFile}`);
  if (failures > 0) {
    log("DONE", `${failures} beat(s) did not go as scripted, review the log above`);
    process.exitCode = 1;
  } else {
    log("DONE", "every beat landed as scripted");
  }
}

main().catch((err) => {
  console.error(`fatal: ${describeError(err)}`);
  process.exit(1);
});
