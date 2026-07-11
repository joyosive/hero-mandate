// Real stablecoin settlement on Arbitrum Sepolia, end to end:
//   mandate (HeroMandate escrow) -> MPP permit2 credential -> canonical
//   Permit2 permitWitnessTransferFrom -> ERC20 tokens actually move.
// The MPP challenge transport is local (the guard labels those lines SIM);
// every transaction in this script is real and gets an explorer link.
// Usage: npx tsx src/settle.ts [--token usdc|demo] [--step]

import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import {
  AbiCoder,
  Contract,
  InterfaceAbi,
  JsonRpcProvider,
  Wallet,
  formatEther,
  formatUnits,
  id,
  keccak256,
  parseEther,
  solidityPacked,
  toUtf8Bytes,
} from "ethers";
// Same deep import as mpp-guard.ts: @arbitrum/mpp v0.1.0 does not export its
// default module path map entries for direct utils/default access via TS.
import {
  PERMIT2_ADDRESS,
  PERMIT2_SINGLE_ABI,
  PERMIT2_WITNESS_TYPE_STRING,
  TOKEN_CONTRACTS,
} from "../node_modules/@arbitrum/mpp/dist/default.js";
import { HERO_MANDATE_ABI } from "./abi";
import { balanceOf, deployHeroDemoUSD, erc20, allowance, approveMax, transfer, HERO_DEMO_USD } from "./erc20";
import { buildRoot } from "./merkle";
import { MandateBoundCredential, MandateGuard, MppChallenge, verifyCredential } from "./mpp-guard";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

// ---------------------------------------------------------------- constants

const HERO_MANDATE_ADDRESS = "0x0dfca3eabfde4e4714057a326058611e040dcdd9";
const CIRCLE_USDC = TOKEN_CONTRACTS.USDC_ARBITRUM_SEPOLIA;
const ARBISCAN_TX = "https://sepolia.arbiscan.io/tx/";
const ARBISCAN_ADDR = "https://sepolia.arbiscan.io/address/";
const CHAIN_ID = 421614;

const PAY_SET = ["PAY-USDC"];
const SETTLEMENT_MODEL = keccak256(toUtf8Bytes("hero-settlement-v1"));

// 5 tokens at 6 decimals. The SAME number is used as the mandate execute()
// amount: mandate capacity is escrowed wei and its units are abstract
// authority units here, deliberately aligned 1:1 with token base units so
// one number tells both ledgers the same story. They remain separate
// ledgers: the ETH escrow does not hold the tokens.
const SETTLE_AMOUNT = 5_000_000n;
const MANDATE_CAPACITY = parseEther("0.002"); // 2e15 authority units escrowed
const MANDATE_TTL = 24n * 3600n;
const GAS_STAKE = parseEther("0.0005");
const OPS_TOKEN_TOPUP = 25_000_000n; // 25 tokens to the ops agent

const PERMIT2_EXTRA_ABI = ["function nonceBitmap(address, uint256) view returns (uint256)"];
const PAYMENT_WITNESS_TYPEHASH = keccak256(toUtf8Bytes("PaymentWitness(bytes32 challengeHash)"));
const INVALID_NONCE_SELECTOR = id("InvalidNonce()").slice(0, 10);

const OUT_DIR = path.join(__dirname, "..", "out");
const OUT_FILE = path.join(OUT_DIR, "settle-sepolia.json");
const TOKEN_FILE = path.join(OUT_DIR, "settle-token.json");

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

function short(hex: string): string {
  return hex.length > 18 ? `${hex.slice(0, 10)}..${hex.slice(-6)}` : hex;
}

function describeError(err: unknown): string {
  const e = err as { shortMessage?: string; reason?: string; message?: string };
  return e?.shortMessage || e?.reason || e?.message || String(err);
}

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

// ---------------------------------------------------------------- args

function parseTokenMode(argv: string[]): "usdc" | "demo" {
  const i = argv.indexOf("--token");
  // Real Circle USDC is the headline path; it falls back to the demo token
  // (with the faucet instruction) when neither wallet holds any USDC.
  if (i < 0) return "usdc";
  const v = argv[i + 1];
  if (v !== "usdc" && v !== "demo") {
    console.error("usage: tsx src/settle.ts [--token usdc|demo] [--step]");
    process.exit(1);
  }
  return v;
}

// ---------------------------------------------------------------- json helpers

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

// ---------------------------------------------------------------- revert probing

function revertData(err: unknown): string {
  const e = err as { data?: unknown; info?: { error?: { data?: unknown } } };
  if (typeof e?.data === "string") return e.data;
  const inner = e?.info?.error?.data;
  return typeof inner === "string" ? inner : "";
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const tokenModeRequested = parseTokenMode(process.argv.slice(2));

  const rpc = process.env.RPC_ARB_SEPOLIA;
  if (!rpc) {
    console.error("missing RPC_ARB_SEPOLIA in ../.env");
    process.exit(1);
  }
  const rawPk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rawPk) {
    console.error("missing DEPLOYER_PRIVATE_KEY in ../.env");
    process.exit(1);
  }
  const deployerPk = rawPk.startsWith("0x") ? rawPk : `0x${rawPk}`;

  const provider = new JsonRpcProvider(rpc);
  const link = (hash: string) => `${ARBISCAN_TX}${hash}`;

  // Same deterministic derivation as flow.ts: keccak(deployerPk, index).
  const treasury = new Wallet(deployerPk, provider);
  const ops = new Wallet(keccak256(solidityPacked(["bytes32", "uint256"], [deployerPk, 3])), provider);
  const vendor = new Wallet(keccak256(solidityPacked(["bytes32", "uint256"], [deployerPk, 4])), provider);

  console.log("");
  console.log("HERO MANDATE :: real settlement :: mandate -> credential -> permit2 -> tokens");
  console.log(`chain Arbitrum Sepolia (${CHAIN_ID})  mandate contract ${HERO_MANDATE_ADDRESS}`);
  hr();

  // ---- rails check: everything this script settles through must have code.
  const [permit2Code, usdcCode, mandateCode] = await Promise.all([
    provider.getCode(PERMIT2_ADDRESS),
    provider.getCode(CIRCLE_USDC),
    provider.getCode(HERO_MANDATE_ADDRESS),
  ]);
  log("RAILS", `canonical Permit2 ${PERMIT2_ADDRESS}  code ${(permit2Code.length - 2) / 2} bytes`);
  log("RAILS", `Circle USDC       ${CIRCLE_USDC}  code ${(usdcCode.length - 2) / 2} bytes`);
  log("RAILS", `HeroMandate       ${HERO_MANDATE_ADDRESS}  code ${(mandateCode.length - 2) / 2} bytes`);
  if (permit2Code === "0x" || mandateCode === "0x") {
    console.error("Permit2 or HeroMandate has no code on this chain, cannot settle");
    process.exit(1);
  }

  log("BOOT", `treasury ${treasury.address}`);
  log("BOOT", `ops      ${ops.address}  (derived index 3, the paying agent)`);
  log("BOOT", `vendor   ${vendor.address}  (derived index 4, the payee)`);
  log("BOOT", "note: the MPP challenge below is generated locally (guard labels it SIM); every tx is real");

  const treasuryBefore = await provider.getBalance(treasury.address);
  if (treasuryBefore < parseEther("0.005")) {
    console.error(`treasury balance ${formatEther(treasuryBefore)} ETH is too low, need about 0.005 ETH`);
    process.exit(1);
  }
  hr();

  const summary: Record<string, unknown> = {
    network: "Arbitrum Sepolia",
    chainId: CHAIN_ID,
    mandateContract: HERO_MANDATE_ADDRESS,
    permit2: PERMIT2_ADDRESS,
    wallets: { treasury: treasury.address, ops: ops.address, vendor: vendor.address },
  };

  // ---- step 1: gas for the two agent wallets.
  await stepGate("step 1: gas stakes");
  const fundingTxs: Record<string, string> = {};
  for (const [label, wallet] of [
    ["ops", ops],
    ["vendor", vendor],
  ] as const) {
    const balance = await provider.getBalance(wallet.address);
    if (balance >= GAS_STAKE) {
      log("FUND", `${label} gas ok (${formatEther(balance)} ETH)`);
      continue;
    }
    const tx = await treasury.sendTransaction({ to: wallet.address, value: GAS_STAKE });
    await tx.wait();
    fundingTxs[label] = tx.hash;
    log("FUND", `${label} funded with ${formatEther(GAS_STAKE)} ETH  tx ${link(tx.hash)}`);
  }
  summary.fundingTxs = fundingTxs;
  hr();

  // ---- step 2: pick the token that will actually move.
  await stepGate("step 2: the token");
  let tokenMode: "usdc" | "demo" = tokenModeRequested;
  let tokenAddress = "";
  let tokenSymbol = "";
  let tokenDeployTx: string | null = null;
  const tokenTxs: Record<string, string> = {};

  if (tokenModeRequested === "usdc") {
    if (usdcCode === "0x") {
      log("TOKEN", "Circle USDC has no code here, falling back to demo token");
      tokenMode = "demo";
    } else {
      const [treasuryUsdc, opsUsdc] = await Promise.all([
        balanceOf(CIRCLE_USDC, treasury.address, provider),
        balanceOf(CIRCLE_USDC, ops.address, provider),
      ]);
      log("TOKEN", `Circle USDC balances: treasury ${formatUnits(treasuryUsdc, 6)}  ops ${formatUnits(opsUsdc, 6)}`);
      if (opsUsdc >= SETTLE_AMOUNT) {
        tokenMode = "usdc";
        tokenAddress = CIRCLE_USDC;
        tokenSymbol = "USDC";
      } else if (treasuryUsdc >= SETTLE_AMOUNT) {
        // Move only what this settlement needs; the rest stays in treasury.
        const topUp = SETTLE_AMOUNT;
        const txHash = await transfer(CIRCLE_USDC, ops.address, topUp, treasury);
        tokenTxs.opsTopUp = txHash;
        log("TOKEN", `moved ${formatUnits(topUp, 6)} USDC treasury -> ops  tx ${link(txHash)}`);
        tokenMode = "usdc";
        tokenAddress = CIRCLE_USDC;
        tokenSymbol = "USDC";
      } else {
        log("TOKEN", `no Circle USDC held: claim at faucet.circle.com to the treasury address ${treasury.address}`);
        log("TOKEN", "falling back to the demo token for this run");
        tokenMode = "demo";
      }
    }
  }

  if (tokenMode === "demo") {
    const recorded = readJson<{ address?: string }>(TOKEN_FILE);
    if (recorded?.address && (await provider.getCode(recorded.address)) !== "0x") {
      tokenAddress = recorded.address;
      log("TOKEN", `reusing deployed ${HERO_DEMO_USD.symbol} at ${tokenAddress}`);
    } else {
      const deployed = await deployHeroDemoUSD(treasury);
      tokenAddress = deployed.address;
      tokenDeployTx = deployed.txHash;
      writeJson(TOKEN_FILE, {
        address: tokenAddress,
        deployTx: tokenDeployTx,
        name: HERO_DEMO_USD.name,
        symbol: HERO_DEMO_USD.symbol,
        decimals: HERO_DEMO_USD.decimals,
        deployedAt: new Date().toISOString(),
      });
      log("TOKEN", `deployed ${HERO_DEMO_USD.name} (${HERO_DEMO_USD.symbol}, 6 decimals) at ${tokenAddress}`);
      log("TOKEN", `deploy tx ${link(tokenDeployTx)}`);
    }
    tokenSymbol = HERO_DEMO_USD.symbol;
    const opsToken = await balanceOf(tokenAddress, ops.address, provider);
    if (opsToken < SETTLE_AMOUNT) {
      const txHash = await transfer(tokenAddress, ops.address, OPS_TOKEN_TOPUP, treasury);
      tokenTxs.opsTopUp = txHash;
      log("TOKEN", `moved ${formatUnits(OPS_TOKEN_TOPUP, 6)} ${tokenSymbol} treasury -> ops  tx ${link(txHash)}`);
    } else {
      log("TOKEN", `ops already holds ${formatUnits(opsToken, 6)} ${tokenSymbol}`);
    }
  }
  log("TOKEN", `settling ${formatUnits(SETTLE_AMOUNT, 6)} ${tokenSymbol}  token ${ARBISCAN_ADDR}${tokenAddress}`);
  summary.token = {
    mode: tokenMode,
    address: tokenAddress,
    symbol: tokenSymbol,
    decimals: 6,
    deployTx: tokenDeployTx,
    txs: tokenTxs,
  };
  hr();

  // ---- step 3: the mandate. Treasury grants the ops agent directly:
  // a single-node tree, scope root over PAY-USDC only, 0.002 ETH escrowed
  // as authority capacity. Reused across runs while unexpired.
  await stepGate("step 3: the mandate");
  const asTreasury = new Contract(HERO_MANDATE_ADDRESS, HERO_MANDATE_ABI, treasury);
  const asOps = asTreasury.connect(ops) as Contract;
  const scopeRoot = buildRoot(PAY_SET);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  let mandateId = 0n;
  let mandateCreateTx: string | null = null;
  let mandateReused = false;
  const previous = readJson<{ mandate?: { id?: string } }>(OUT_FILE);
  if (previous?.mandate?.id) {
    try {
      const m = await asTreasury.getFunction("getMandate")(BigInt(previous.mandate.id));
      const usable =
        String(m.agent).toLowerCase() === ops.address.toLowerCase() &&
        String(m.scopeRoot).toLowerCase() === scopeRoot.toLowerCase() &&
        BigInt(m.expiry) > nowSec + 1800n &&
        BigInt(m.remaining) >= SETTLE_AMOUNT;
      if (usable) {
        mandateId = BigInt(previous.mandate.id);
        mandateReused = true;
        log("MANDATE", `reusing mandate ${mandateId}  remaining ${m.remaining} authority units  expiry ${m.expiry}`);
      }
    } catch {
      // fall through to creation
    }
  }
  if (mandateId === 0n) {
    const tx = await asTreasury.getFunction("createMandate")(
      ops.address,
      nowSec + MANDATE_TTL,
      scopeRoot,
      SETTLEMENT_MODEL,
      { value: MANDATE_CAPACITY },
    );
    const receipt = await tx.wait();
    for (const entry of receipt.logs) {
      try {
        const parsed = asTreasury.interface.parseLog({ topics: [...entry.topics], data: entry.data });
        if (parsed?.name === "MandateCreated") mandateId = BigInt(parsed.args.id);
      } catch {
        continue;
      }
    }
    if (mandateId === 0n) throw new Error("createMandate produced no MandateCreated event");
    mandateCreateTx = tx.hash;
    log("MANDATE", `treasury created payments mandate ${mandateId} for the ops agent`);
    log("MANDATE", `capacity ${formatEther(MANDATE_CAPACITY)} ETH escrowed (authority units in wei)  scope PAY-USDC only  expiry now+24h`);
    log("MANDATE", `tx ${link(tx.hash)}`);
  }
  summary.mandate = {
    id: mandateId.toString(),
    reused: mandateReused,
    createTx: mandateCreateTx,
    capacityWei: MANDATE_CAPACITY.toString(),
    scope: PAY_SET,
  };
  hr();

  // ---- step 4: authorize through the guard. The mandate contract accepts
  // the spend on-chain first; only then does the ops agent sign the permit2
  // credential, bound to the new receipt head, over the REAL token address.
  await stepGate("step 4: authorize under mandate");
  const permit2Reader = new Contract(PERMIT2_ADDRESS, PERMIT2_EXTRA_ABI, provider);
  // Permit2 nonces are unordered; derive from the timestamp so every run
  // uses a fresh one, and verify it is unspent in the nonceBitmap.
  let nonce = BigInt(Date.now());
  for (;;) {
    const word = BigInt(await permit2Reader.getFunction("nonceBitmap")(ops.address, nonce >> 8n));
    if ((word & (1n << (nonce & 255n))) === 0n) break;
    nonce += 1n;
  }
  log("AUTH", `permit2 unordered nonce ${nonce} (timestamp-derived, verified unspent in nonceBitmap)`);

  const guard = new MandateGuard(asOps, mandateId, ops, PAY_SET, [], {
    token: tokenAddress,
    nonceFor: () => nonce,
  });
  const challenge: MppChallenge = {
    // chg-settle-002 is the real-USDC series; chg-settle-001 was the demo token.
    id: tokenMode === "usdc" ? "chg-settle-002" : "chg-settle-001",
    payTo: vendor.address,
    asset: "USDC",
    amount: SETTLE_AMOUNT,
    memo: "vendor invoice settlement",
  };
  const authorized = await guard.authorize(challenge);
  if (!authorized.ok) {
    console.error(`mandate refused the spend, breach code ${authorized.breachCode}  tx ${link(authorized.txHash)}`);
    process.exit(1);
  }
  const credential: MandateBoundCredential = authorized.credential;
  log("AUTH", `mandate execute tx ${link(authorized.txHash)}`);
  log("AUTH", `receipt head ${short(authorized.receiptHead)}  challenge hash ${short(credential.witness.challengeHash)}`);
  log("AUTH", `permit covers the real token: ${credential.permit.permitted[0].token} amount ${credential.permit.permitted[0].amount}`);
  const credentialVerified = verifyCredential(credential, ops.address, CHAIN_ID);
  log("AUTH", credentialVerified ? "credential verified locally (signer, hash binding)" : "CREDENTIAL VERIFICATION FAILED");
  if (!credentialVerified) process.exit(1);
  summary.authorize = {
    challengeId: challenge.id,
    executeTx: authorized.txHash,
    receiptHead: authorized.receiptHead,
    challengeHash: credential.witness.challengeHash,
    nonce: credential.permit.nonce,
    deadline: credential.permit.deadline,
    credentialVerified,
  };
  hr();

  // ---- step 5: ops approves Permit2 for the token, once.
  await stepGate("step 5: approve permit2");
  let approveTx: string | null = null;
  const current = await allowance(tokenAddress, ops.address, PERMIT2_ADDRESS, provider);
  if (current >= SETTLE_AMOUNT) {
    log("APPROVE", `permit2 already approved (allowance ${current > 10n ** 30n ? "max" : current}), skipped`);
  } else {
    approveTx = await approveMax(tokenAddress, PERMIT2_ADDRESS, ops);
    log("APPROVE", `ops approved permit2 for ${tokenSymbol} (max)  tx ${link(approveTx)}`);
  }
  summary.approveTx = approveTx ?? "already-approved";
  hr();

  // ---- step 6: SETTLE. The vendor redeems the credential on canonical
  // Permit2. The witness is the hashed PaymentWitness struct, and the
  // witness type string comes from @arbitrum/mpp, so the on-chain typehash
  // matches the signed EIP-712 payload exactly.
  await stepGate("step 6: settle on permit2");
  const witness = keccak256(
    AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [PAYMENT_WITNESS_TYPEHASH, credential.witness.challengeHash]),
  );
  const permit2AsVendor = new Contract(PERMIT2_ADDRESS, PERMIT2_SINGLE_ABI as unknown as InterfaceAbi, vendor);
  const settleArgs = [
    {
      permitted: {
        token: credential.permit.permitted[0].token,
        amount: credential.permit.permitted[0].amount,
      },
      nonce: credential.permit.nonce,
      deadline: credential.permit.deadline,
    },
    {
      to: credential.transferDetails[0].to,
      requestedAmount: credential.transferDetails[0].requestedAmount,
    },
    ops.address,
    witness,
    PERMIT2_WITNESS_TYPE_STRING,
    credential.signature,
  ] as const;

  const [vendorBefore, opsBefore] = await Promise.all([
    balanceOf(tokenAddress, vendor.address, provider),
    balanceOf(tokenAddress, ops.address, provider),
  ]);
  log("SETTLE", `vendor ${tokenSymbol} before: ${formatUnits(vendorBefore, 6)}  (ops holds ${formatUnits(opsBefore, 6)})`);
  const settleTx = await permit2AsVendor.getFunction("permitWitnessTransferFrom")(...settleArgs);
  await settleTx.wait();
  const [vendorAfter, opsAfter] = await Promise.all([
    balanceOf(tokenAddress, vendor.address, provider),
    balanceOf(tokenAddress, ops.address, provider),
  ]);
  log("SETTLE", `settlement tx ${link(settleTx.hash)}`);
  log("SETTLE", `vendor ${tokenSymbol} after:  ${formatUnits(vendorAfter, 6)}  (ops holds ${formatUnits(opsAfter, 6)})`);
  const delta = vendorAfter - vendorBefore;
  if (delta !== SETTLE_AMOUNT) {
    console.error(`vendor balance moved by ${delta}, expected ${SETTLE_AMOUNT}`);
    process.exitCode = 1;
  }
  log("SETTLE", `vendor received exactly ${formatUnits(delta, 6)} ${tokenSymbol}`);
  log("SETTLE", "REAL STABLECOIN SETTLEMENT: mandate -> credential -> permit2 -> tokens moved");
  summary.settlement = {
    tx: settleTx.hash,
    token: tokenAddress,
    amount: SETTLE_AMOUNT.toString(),
    vendorBefore: vendorBefore.toString(),
    vendorAfter: vendorAfter.toString(),
    opsBefore: opsBefore.toString(),
    opsAfter: opsAfter.toString(),
  };
  hr();

  // ---- step 7: NEGATIVE. Replay the exact same credential: the permit2
  // nonce is spent, so the second settlement must revert on-chain.
  await stepGate("step 7: replay the same credential");
  log("REPLAY", "vendor replays the identical credential (same nonce, same signature)");
  let replaySelector = "";
  try {
    await permit2AsVendor.getFunction("permitWitnessTransferFrom").staticCall(...settleArgs);
  } catch (err) {
    replaySelector = revertData(err).slice(0, 10);
  }
  if (replaySelector === "") {
    console.error("replay staticCall did NOT revert, the nonce was not consumed");
    process.exitCode = 1;
  }
  log(
    "REPLAY",
    `static probe reverts with selector ${replaySelector}${replaySelector === INVALID_NONCE_SELECTOR ? " = InvalidNonce()" : ""}`,
  );
  // Land the refusal on-chain for the explorer: fixed gas limit skips the
  // estimate so the reverting transaction is actually mined.
  let replayTxHash = "";
  let replayReverted = false;
  try {
    const tx = await permit2AsVendor.getFunction("permitWitnessTransferFrom")(...settleArgs, { gasLimit: 300000n });
    replayTxHash = tx.hash;
    await tx.wait();
    console.error("replay transaction unexpectedly succeeded");
    process.exitCode = 1;
  } catch (err) {
    const receipt = (err as { receipt?: { hash?: string; status?: number } })?.receipt;
    if (receipt?.hash) replayTxHash = receipt.hash;
    replayReverted = receipt?.status === 0;
    if (!replayTxHash) {
      log("REPLAY", `replay refused before broadcast: ${describeError(err)}`);
    }
  }
  if (replayTxHash) {
    log("REPLAY", `replay tx mined and REVERTED  tx ${link(replayTxHash)}`);
  }
  log("REPLAY", "credential is single-use, replay refused by permit2");
  summary.replay = {
    tx: replayTxHash || null,
    reverted: replayReverted,
    selector: replaySelector,
    invalidNonce: replaySelector === INVALID_NONCE_SELECTOR,
  };
  hr();

  // ---- step 8: cost and summary.
  const treasuryAfter = await provider.getBalance(treasury.address);
  log("COST", `treasury ${formatEther(treasuryBefore)} -> ${formatEther(treasuryAfter)} ETH  spent ${formatEther(treasuryBefore - treasuryAfter)}`);
  if (!mandateReused) {
    log("COST", `of which ${formatEther(MANDATE_CAPACITY)} ETH is escrowed mandate capacity, reclaimable after expiry`);
  }
  summary.cost = {
    treasuryBeforeWei: treasuryBefore.toString(),
    treasuryAfterWei: treasuryAfter.toString(),
    spentWei: (treasuryBefore - treasuryAfter).toString(),
  };
  summary.generatedAt = new Date().toISOString();
  writeJson(OUT_FILE, summary);
  log("DONE", `summary written to ${OUT_FILE}`);
  if (process.exitCode) {
    log("DONE", "at least one step did not go as scripted, review the log above");
  }
}

main().catch((err) => {
  console.error(`fatal: ${describeError(err)}`);
  process.exit(1);
});
