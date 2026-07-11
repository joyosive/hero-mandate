// anchor-session.mjs: anchor a Proof of Action session root into HeroProofAnchor.
//
// The log.html page exports a session JSON: { sessionRoot, count, receipts:[{root, log}] }.
// This script takes that file (or a bare --root 0x...), submits anchor(sessionRoot) to the
// verified HeroProofAnchor contract on Arbitrum Sepolia, waits, then reads verify() back.
// Private keys stay on the machine that runs this, never in the browser.
//
// Run (from the repo root):   node scripts/anchor-session.mjs path/to/session.json
//   or:                       node scripts/anchor-session.mjs --root 0x<64-hex>
// It reads RPC_ARB_SEPOLIA and DEPLOYER_PRIVATE_KEY from the repo-root .env
// (ANCHOR_ADDRESS defaults to the deployed HeroProofAnchor and can be overridden by env).

import fs from "node:fs";

// ethers: use the workspace copy if it is not resolvable as a bare specifier from here.
let ethers;
try {
  ({ ethers } = await import("ethers"));
} catch {
  ({ ethers } = await import(
    new URL("../agents/node_modules/ethers/lib.esm/index.js", import.meta.url)
  ));
}

const ANCHOR_DEFAULT = "0xb3fa3222130fac54b90e37835dce4f052349571b";

// ---- tiny .env loader (repo root), does not overwrite an already-set env var ----
function loadEnv() {
  try {
    const txt = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env file is fine; env may come from the shell */
  }
}
loadEnv();

// ---- resolve the session root to anchor ----
function resolveRoot() {
  const argv = process.argv.slice(2);
  const rootFlagIdx = argv.indexOf("--root");
  if (rootFlagIdx !== -1 && argv[rootFlagIdx + 1]) {
    return { root: argv[rootFlagIdx + 1], source: "--root" };
  }
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: node scripts/anchor-session.mjs <session.json> | --root 0x<64-hex>");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const root = data.sessionRoot;
  if (!root) {
    console.error(`No 'sessionRoot' field in ${file}.`);
    process.exit(1);
  }
  // Integrity check: the exported receipts must recompute to the stated sessionRoot.
  if (Array.isArray(data.receipts)) {
    const recomputed = buildRoot(data.receipts.map((r) => ({ root: r.root })));
    if (recomputed !== root) {
      console.warn(`WARNING: sessionRoot in file does not match its receipts.`);
      console.warn(`  stated:     ${root}`);
      console.warn(`  recomputed: ${recomputed}`);
    } else {
      console.log(`Session integrity OK: ${data.receipts.length} receipts recompute to the root.`);
    }
  }
  return { root, source: file };
}

// same hash chain as the page and the agent CLI
function buildRoot(records) {
  let prev = ethers.ZeroHash;
  for (const rec of records) {
    prev = ethers.keccak256(ethers.concat([prev, ethers.toUtf8Bytes(JSON.stringify(rec))]));
  }
  return prev;
}

const { root, source } = resolveRoot();
if (!/^0x[0-9a-fA-F]{64}$/.test(root)) {
  console.error(`Not a bytes32 root: ${root}`);
  process.exit(1);
}

const RPC = process.env.RPC_ARB_SEPOLIA;
const KEY = process.env.DEPLOYER_PRIVATE_KEY;
const ANCHOR_ADDRESS = process.env.ANCHOR_ADDRESS || ANCHOR_DEFAULT;

console.log(`Session root (${source}): ${root}`);
console.log(`Anchor contract:         ${ANCHOR_ADDRESS} (Arbitrum Sepolia)`);

if (!RPC || !KEY) {
  console.log("");
  console.log("Set RPC_ARB_SEPOLIA and DEPLOYER_PRIVATE_KEY to anchor.");
  console.log("(Add them to the repo-root .env, or export them in the shell, then rerun.)");
  process.exit(0);
}

const abi = JSON.parse(
  fs.readFileSync(new URL("./HeroProofAnchor.abi.json", import.meta.url), "utf8")
);

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(KEY, provider);
const contract = new ethers.Contract(ANCHOR_ADDRESS, abi, wallet);

async function verifyAndReport() {
  const [anchored, timestamp, submitter] = await contract.verify(root);
  console.log("");
  console.log(`verify(${root}):`);
  console.log(`  anchored:  ${anchored}`);
  console.log(`  timestamp: ${timestamp} (${new Date(Number(timestamp) * 1000).toISOString()})`);
  console.log(`  submitter: ${submitter}`);
}

try {
  console.log("");
  console.log("Anchoring...");
  const tx = await contract.anchor(root);
  console.log(`  tx: https://sepolia.arbiscan.io/tx/${tx.hash}`);
  await tx.wait();
  console.log("  confirmed.");
  await verifyAndReport();
} catch (err) {
  const name = err?.revert?.name || err?.errorName;
  const already = name === "AlreadyAnchored" || /AlreadyAnchored/.test(err?.shortMessage || err?.message || "");
  if (already) {
    console.log("already anchored, verifying instead");
    await verifyAndReport();
  } else {
    console.error("Anchor failed:", err?.shortMessage || err?.message || err);
    process.exit(1);
  }
}
