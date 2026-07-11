// Hero Mandate live demo runner.
// Runs the deterministic chain of mandate scenario against a deployed
// HeroMandate contract and prints a theatrical but honest ops log.
// Usage: npx tsx src/run.ts --chain robinhood|sepolia --address 0x...

import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import {
  Contract,
  EventLog,
  JsonRpcProvider,
  Wallet,
  formatEther,
  keccak256,
  parseEther,
  solidityPacked,
  toUtf8Bytes,
} from "ethers";
import { HERO_MANDATE_ABI } from "./abi";
import { buildProof, buildRoot, instrumentId } from "./merkle";
import { GENESIS_HEAD, nextHead } from "./receipt";

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

const ROOT_SET = ["ETH-USD", "ARB-USD", "BTC-USD"];
const CHILD_SET = ["ETH-USD", "ARB-USD"];

const ORCHESTRATOR_MODEL = keccak256(toUtf8Bytes("hero-orchestrator-v1"));
const MOMENTUM_MODEL = keccak256(toUtf8Bytes("hero-momentum-v1"));

const ROOT_CAPACITY = parseEther("0.005");
const CHILD_CAPACITY = parseEther("0.0015");
const TRADE_ETH = parseEther("0.0004");
const TRADE_ARB = parseEther("0.0003");
const BREACH_SCOPE_AMOUNT = parseEther("0.0002");
const BREACH_CAP_AMOUNT = parseEther("0.005");
const GAS_STAKE = parseEther("0.002");

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

// ---------------------------------------------------------------- args

interface Args {
  chain: ChainKey;
  address: string;
}

function parseArgs(argv: string[]): Args {
  let chain: string | undefined;
  let address: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--chain") chain = argv[++i];
    else if (argv[i] === "--address") address = argv[++i];
  }
  if ((chain !== "robinhood" && chain !== "sepolia") || !address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    console.error("usage: tsx src/run.ts --chain robinhood|sepolia --address 0xCONTRACT");
    process.exit(1);
  }
  return { chain, address };
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
  id: bigint,
  symbol: string,
  amount: bigint,
  proofs: string[][],
): Promise<ExecOutcome> {
  let txHash: string | undefined;
  try {
    const tx = await contract.getFunction("execute")(id, instrumentId(symbol), amount, proofs);
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
      if (parsed.name === "Executed" && parsed.args.id === id) {
        return {
          status: "executed",
          txHash,
          newHead: String(parsed.args.newHead),
          timestamp: BigInt(parsed.args.timestamp),
        };
      }
      if (parsed.name === "Breach" && parsed.args.id === id) {
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

async function readMandate(contract: Contract, id: bigint): Promise<MandateView> {
  const m = await contract.getFunction("getMandate")(id);
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
  id: bigint,
  modelHash: string,
  headOnChain: string,
  fromBlock: number,
): Promise<VerifyResult> {
  const raw = await contract.queryFilter(contract.filters.Executed(id), fromBlock, "latest");
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

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const { chain, address } = parseArgs(process.argv.slice(2));
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

  const asTreasury = new Contract(address, HERO_MANDATE_ABI, treasury);
  const asOrchestrator = asTreasury.connect(orchestrator) as Contract;
  const asMomentum = asTreasury.connect(momentum) as Contract;

  console.log("");
  console.log("HERO MANDATE :: chain of mandate :: live run");
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

  const treasuryBalance = await provider.getBalance(treasury.address);
  if (treasuryBalance < parseEther("0.012")) {
    console.error(`treasury balance ${eth(treasuryBalance)} is too low. Need about 0.012 ETH for escrow plus gas.`);
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
    },
  };
  const fundingTxs: Record<string, string> = {};

  // Gas stakes for the two agent wallets.
  for (const [label, wallet] of [
    ["orchestrator", orchestrator],
    ["momentum", momentum],
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
  let childId = 0n;
  for (const entry of delegateReceipt.logs) {
    try {
      const parsed = asOrchestrator.interface.parseLog({ topics: [...entry.topics], data: entry.data });
      if (parsed?.name === "Delegated") childId = BigInt(parsed.args.childId);
    } catch {
      continue;
    }
  }
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
  for (const [label, id, view] of [
    ["root", rootId, rootView],
    ["momentum", childId, childView],
  ] as const) {
    const result = await verifyReceiptChain(asTreasury, id, view.modelHash, view.receiptHead, fromBlock);
    const verdict = result.ok ? "VERIFIED" : "BROKEN";
    log("VERIFY", `node ${id} receipt chain recomputed from ${result.receipts} Executed event(s): ${verdict}`);
    if (!result.ok) {
      failures++;
      log("VERIFY", `  on-chain ${result.headOnChain}  recomputed ${result.headRecomputed}`);
    }
    verification[label] = {
      nodeId: id.toString(),
      receipts: result.receipts,
      headOnChain: result.headOnChain,
      headRecomputed: result.headRecomputed,
      verdict,
    };
  }
  summary.verification = verification;

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
  };
  summary.generatedAt = new Date().toISOString();

  const outDir = path.join(__dirname, "..", "out");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `run-${chain}.json`);
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
