// Model attestation demo. Additive and read-only: it reads the last run and
// re-executes nothing on chain.
//
//   npx tsx src/attest.ts --chain robinhood|sepolia
//
// For every Executed action in the run, the model operator (a wallet the
// registry publishes for that modelHash) signs an EIP-712 attestation binding
// the model to that exact deed, anchored on the on-chain receipt head. Each
// attestation is then verified: the recovered signer must be the published
// operator. One negative at the end tampers an amount and shows verification
// fails. Machine summary lands in out/attestations-<chain>.json.

import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import { Contract, JsonRpcProvider, Wallet, formatEther, getAddress } from "ethers";
import { HERO_MANDATE_ABI } from "./abi";
import { instrumentId } from "./merkle";
import {
  Attestation,
  ModelRegistry,
  REGISTRY_PATH,
  attest,
  buildDemoRegistry,
  deriveOperator,
  saveRegistry,
  verifyAttestation,
} from "./attestation";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

// ---------------------------------------------------------------- chains

const CHAINS = {
  robinhood: { label: "Robinhood Chain testnet", rpcEnv: "RPC_ROBINHOOD", chainIdEnv: "CHAIN_ID_ROBINHOOD" },
  sepolia: { label: "Arbitrum Sepolia", rpcEnv: "RPC_ARB_SEPOLIA", chainIdEnv: "CHAIN_ID_ARB_SEPOLIA" },
} as const;

type ChainKey = keyof typeof CHAINS;

// ---------------------------------------------------------------- run data shapes

interface MandateRecord {
  id: string;
  modelHash?: string;
  receiptHead?: string;
}

interface ExecutionRecord {
  instrument: string;
  amountWei: string;
  newHead: string;
}

interface PaymentRecord {
  nodeId: string;
  amountWei: string;
  receiptHead: string;
  memo?: string;
}

interface RunData {
  chain: string;
  contract: string;
  executions?: ExecutionRecord[];
  payment?: PaymentRecord;
  mandates?: { root?: MandateRecord; momentum?: MandateRecord; payments?: MandateRecord };
}

// An Executed action pulled out of the run, ready to attest.
interface Action {
  mandateId: bigint;
  symbol: string;
  instrument: string;
  amount: bigint;
  receiptHead: string;
  modelHash: string;
  label: string;
}

// ---------------------------------------------------------------- helpers

function short(hex: string): string {
  return hex.length > 18 ? `${hex.slice(0, 10)}..${hex.slice(-6)}` : hex;
}

function parseChain(argv: string[]): ChainKey {
  let chain: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--chain") chain = argv[++i];
  }
  if (chain !== "robinhood" && chain !== "sepolia") {
    console.error("usage: tsx src/attest.ts --chain robinhood|sepolia");
    process.exit(1);
  }
  return chain;
}

function loadRun(chain: ChainKey): { data: RunData; file: string } {
  const outDir = path.join(__dirname, "..", "out");
  const flowFile = path.join(outDir, `flow-${chain}.json`);
  const runFile = path.join(outDir, `run-${chain}.json`);
  const file = fs.existsSync(flowFile) ? flowFile : runFile;
  if (!fs.existsSync(file)) {
    console.error(`no run found: expected ${flowFile} or ${runFile}. Run src/flow.ts first.`);
    process.exit(1);
  }
  return { data: JSON.parse(fs.readFileSync(file, "utf8")) as RunData, file };
}

// Resolve chainId from ../.env, falling back to a provider query if absent.
async function resolveChainId(chain: ChainKey): Promise<number> {
  const fromEnv = process.env[CHAINS[chain].chainIdEnv];
  if (fromEnv && /^\d+$/.test(fromEnv)) return Number(fromEnv);
  const rpc = process.env[CHAINS[chain].rpcEnv];
  if (!rpc) throw new Error(`cannot resolve chainId: set ${CHAINS[chain].chainIdEnv} or ${CHAINS[chain].rpcEnv} in ../.env`);
  return Number((await new JsonRpcProvider(rpc).getNetwork()).chainId);
}

// The modelHash is normally in the run data. If a node is missing it, read it
// back with a read-only getMandate call using the RPC from ../.env.
async function resolveModelHash(
  chain: ChainKey,
  contract: string,
  mandateId: bigint,
  fromRun: string | undefined,
): Promise<string> {
  if (fromRun) return fromRun;
  const rpc = process.env[CHAINS[chain].rpcEnv];
  if (!rpc) throw new Error(`modelHash missing for mandate ${mandateId} and no ${CHAINS[chain].rpcEnv} to read it back`);
  const c = new Contract(contract, HERO_MANDATE_ABI, new JsonRpcProvider(rpc));
  const m = await c.getFunction("getMandate")(mandateId);
  return String(m.modelHash);
}

// Pull every Executed action out of the run: momentum trades plus, when the
// full flow ran, the machine payment. Breaches are refused, not executed, so
// they are never attested.
async function collectActions(chain: ChainKey, data: RunData): Promise<Action[]> {
  const actions: Action[] = [];
  const momentum = data.mandates?.momentum;
  if (momentum && Array.isArray(data.executions)) {
    const modelHash = await resolveModelHash(chain, data.contract, BigInt(momentum.id), momentum.modelHash);
    for (const ex of data.executions) {
      actions.push({
        mandateId: BigInt(momentum.id),
        symbol: ex.instrument,
        instrument: instrumentId(ex.instrument),
        amount: BigInt(ex.amountWei),
        receiptHead: ex.newHead,
        modelHash,
        label: "hero-momentum-v1",
      });
    }
  }
  const payments = data.mandates?.payments;
  if (data.payment && payments) {
    const modelHash = await resolveModelHash(chain, data.contract, BigInt(payments.id), payments.modelHash);
    actions.push({
      mandateId: BigInt(data.payment.nodeId),
      symbol: "PAY-USDC",
      instrument: instrumentId("PAY-USDC"),
      amount: BigInt(data.payment.amountWei),
      receiptHead: data.payment.receiptHead,
      modelHash,
      label: "hero-payer-v1",
    });
  }
  return actions;
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const chain = parseChain(process.argv.slice(2));
  const net = CHAINS[chain];

  const rawPk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rawPk) {
    console.error("missing DEPLOYER_PRIVATE_KEY in ../.env");
    process.exit(1);
  }

  const { data, file } = loadRun(chain);
  const contract = getAddress(data.contract);
  const chainId = await resolveChainId(chain);

  // Derive the operator and publish the registry: modelHash -> operator.
  const operator: Wallet = deriveOperator(rawPk);
  const registry: ModelRegistry = buildDemoRegistry(operator.address);
  saveRegistry(registry);

  console.log("");
  console.log("HERO MANDATE :: model attestation");
  console.log(`chain ${net.label} (${chain})  contract ${contract}  chainId ${chainId}`);
  console.log(`run source ${path.relative(path.join(__dirname, ".."), file)}`);
  console.log(`operator (model key) ${operator.address}`);
  console.log(`registry published to ${path.relative(path.join(__dirname, ".."), REGISTRY_PATH)} for ${Object.keys(registry).length} model hashes`);
  console.log("-".repeat(78));

  const actions = await collectActions(chain, data);
  if (actions.length === 0) {
    console.error("no Executed actions found in the run to attest");
    process.exit(1);
  }

  let failures = 0;
  const records: Array<Record<string, unknown>> = [];

  for (const action of actions) {
    const att = await attest(operator, {
      chainId,
      contract,
      mandateId: action.mandateId,
      receiptHead: action.receiptHead,
      modelHash: action.modelHash,
      instrument: action.instrument,
      amount: action.amount,
    });
    const res = verifyAttestation(att, registry);
    const verdict = res.ok ? "VERIFIED" : `FAILED (${res.reason})`;
    if (!res.ok) failures++;
    console.log(
      `MODEL ATTESTED  operator ${short(operator.address)} signed ${action.symbol} ${formatEther(action.amount)} ` +
        `under mandate ${action.mandateId}  modelHash ${short(action.modelHash)} (${action.label})  ${verdict}`,
    );
    records.push({
      mandateId: action.mandateId.toString(),
      instrument: action.symbol,
      amountWei: action.amount.toString(),
      receiptHead: action.receiptHead,
      modelHash: action.modelHash,
      label: action.label,
      operator: res.operator,
      verified: res.ok,
      attestation: att,
    });
  }

  console.log("-".repeat(78));

  // The negative: tamper the amount in a copy of the first attestation. The
  // signature covered the original amount, so the recovered signer is no
  // longer the operator and verification fails.
  const original = records[0].attestation as Attestation;
  const tampered: Attestation = { ...original, amount: (BigInt(original.amount) + 1n).toString() };
  const negative = verifyAttestation(tampered, registry);
  const negativeOk = negative.ok === false;
  if (!negativeOk) failures++;
  console.log(
    `NEGATIVE  amount on mandate ${original.mandateId} tampered ${original.amount} -> ${tampered.amount}: ` +
      `verification ${negative.ok ? "PASSED (UNEXPECTED)" : "FAILED"} (${negative.reason})`,
  );

  const summary = {
    chain,
    network: net.label,
    contract,
    chainId,
    runSource: path.basename(file),
    operator: operator.address,
    registryPath: path.basename(REGISTRY_PATH),
    registry,
    domain: { name: "HeroMandateAttestation", version: "1", chainId, verifyingContract: contract },
    attestations: records,
    negative: {
      mandateId: original.mandateId,
      field: "amount",
      original: original.amount,
      tampered: tampered.amount,
      verified: negative.ok,
      reason: negative.reason,
    },
    generatedAt: new Date().toISOString(),
  };

  const outFile = path.join(__dirname, "..", "out", `attestations-${chain}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log("-".repeat(78));
  console.log(`summary written to ${path.relative(path.join(__dirname, ".."), outFile)}`);

  if (failures > 0) {
    console.log(`${failures} attestation check(s) did not go as expected`);
    process.exitCode = 1;
  } else {
    console.log(`${records.length} action(s) attested and VERIFIED, negative correctly FAILED`);
  }
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
