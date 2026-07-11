// Local self test for merkle.ts and the receipt chain recompute.
// No network, no keys. Run with: npx tsx src/selftest.ts

import assert from "node:assert/strict";
import {
  ZeroHash,
  concat,
  encodeBytes32String,
  keccak256,
  parseEther,
  solidityPacked,
  toUtf8Bytes,
} from "ethers";
import {
  buildProof,
  buildRoot,
  hashPair,
  instrumentId,
  leafOf,
  sortedUniqueLeaves,
  verifyProof,
} from "./merkle";
import { GENESIS_HEAD, ReceiptStep, foldReceipts, nextHead } from "./receipt";

const ROOT_SET = ["ETH-USD", "ARB-USD", "BTC-USD"];
const CHILD_SET = ["ETH-USD", "ARB-USD"];

function pass(name: string): void {
  console.log(`PASS  ${name}`);
}

// ---------------------------------------------------------------- leaves

{
  const manual = keccak256(solidityPacked(["bytes32"], [encodeBytes32String("ETH-USD")]));
  assert.equal(leafOf("ETH-USD"), manual, "leaf must be keccak of packed bytes32 instrument");
  assert.equal(instrumentId("ETH-USD"), encodeBytes32String("ETH-USD"));
  pass("leaf hashing matches the contract packing");
}

// ---------------------------------------------------------------- pair hashing

{
  const a = leafOf("ETH-USD");
  const b = leafOf("ARB-USD");
  assert.equal(hashPair(a, b), hashPair(b, a), "pair hash must be commutative");
  const [lo, hi] = BigInt(a) <= BigInt(b) ? [a, b] : [b, a];
  assert.equal(hashPair(a, b), keccak256(concat([lo, hi])), "pair hash must sort ascending then keccak");
  pass("pair hashing sorts ascending and is commutative");
}

// ---------------------------------------------------------------- roots

{
  // Single leaf set: root is the leaf, proof is empty.
  assert.equal(buildRoot(["ETH-USD"]), leafOf("ETH-USD"));
  assert.deepEqual(buildProof(["ETH-USD"], "ETH-USD"), []);
  assert.ok(verifyProof(buildRoot(["ETH-USD"]), "ETH-USD", []));
  pass("single leaf set promotes to root unchanged");
}

{
  // Two leaves.
  const root = buildRoot(CHILD_SET);
  const leaves = sortedUniqueLeaves(CHILD_SET);
  assert.equal(root, hashPair(leaves[0], leaves[1]));
  pass("two leaf root is the sorted pair hash");
}

{
  // Three leaves: level one is [h(l0,l1), l2 promoted], root is h of those.
  const leaves = sortedUniqueLeaves(ROOT_SET);
  const manualRoot = hashPair(hashPair(leaves[0], leaves[1]), leaves[2]);
  assert.equal(buildRoot(ROOT_SET), manualRoot, "odd leaf must promote unchanged");
  pass("three leaf root folds with odd promotion");
}

{
  // Input order and duplicates must not change the root.
  const shuffledWithDupes = ["BTC-USD", "ETH-USD", "ARB-USD", "ETH-USD", "BTC-USD"];
  assert.equal(buildRoot(shuffledWithDupes), buildRoot(ROOT_SET));
  pass("root is invariant to input order and duplicates");
}

{
  // Empty set must refuse.
  assert.throws(() => buildRoot([]));
  pass("empty set is rejected");
}

// ---------------------------------------------------------------- proofs

{
  // Every member of every set proves against its own root.
  for (const set of [CHILD_SET, ROOT_SET, ["A", "B", "C", "D", "E"], ["SOL-USD", "DOGE-USD", "OP-USD", "LINK-USD"]]) {
    const root = buildRoot(set);
    for (const symbol of set) {
      const proof = buildProof(set, symbol);
      assert.ok(verifyProof(root, symbol, proof), `proof for ${symbol} must verify in {${set.join(", ")}}`);
    }
  }
  pass("all membership proofs verify (2, 3, 4 and 5 leaf sets, odd promotion covered)");
}

{
  // The exact proofs array shape used by execute(): child scope then root scope.
  for (const symbol of CHILD_SET) {
    assert.ok(verifyProof(buildRoot(CHILD_SET), symbol, buildProof(CHILD_SET, symbol)));
    assert.ok(verifyProof(buildRoot(ROOT_SET), symbol, buildProof(ROOT_SET, symbol)));
  }
  pass("in-scope trades prove against child root and root root");
}

{
  // Demo beat 4: BTC-USD is in the root set but not the child set.
  assert.throws(() => buildProof(CHILD_SET, "BTC-USD"), /not in the instrument set/);
  assert.ok(verifyProof(buildRoot(ROOT_SET), "BTC-USD", buildProof(ROOT_SET, "BTC-USD")));
  assert.equal(verifyProof(buildRoot(CHILD_SET), "BTC-USD", []), false, "bare leaf must not pass as child root");
  pass("out-of-scope instrument cannot prove against the child root");
}

{
  // A proof for one symbol must not validate another, and must fail a wrong root.
  const proof = buildProof(ROOT_SET, "ETH-USD");
  assert.equal(verifyProof(buildRoot(ROOT_SET), "ARB-USD", proof), false);
  assert.equal(verifyProof(buildRoot(CHILD_SET), "ETH-USD", proof), false);
  pass("proofs do not transfer across symbols or roots");
}

// ---------------------------------------------------------------- receipt chain

{
  const model = keccak256(toUtf8Bytes("hero-momentum-v1"));
  const steps: ReceiptStep[] = [
    { instrument: instrumentId("ETH-USD"), amount: parseEther("0.0004"), modelHash: model, timestamp: 1760000000n },
    { instrument: instrumentId("ARB-USD"), amount: parseEther("0.0003"), modelHash: model, timestamp: 1760000060n },
  ];

  assert.equal(GENESIS_HEAD, ZeroHash, "genesis head must be bytes32 zero");

  const h1 = nextHead(GENESIS_HEAD, steps[0]);
  const manual1 = keccak256(
    solidityPacked(
      ["bytes32", "bytes32", "uint256", "bytes32", "uint64"],
      [ZeroHash, steps[0].instrument, steps[0].amount, model, steps[0].timestamp],
    ),
  );
  assert.equal(h1, manual1, "link must match the contract packing exactly");

  const h2 = nextHead(h1, steps[1]);
  assert.equal(foldReceipts(steps), h2, "fold must equal stepwise links");
  pass("receipt chain packing and fold match the contract");

  // Recompute-from-events shape: every recorded newHead must be reproduced.
  const events = [
    { ...steps[0], newHead: h1 },
    { ...steps[1], newHead: h2 },
  ];
  let head = GENESIS_HEAD;
  for (const ev of events) {
    head = nextHead(head, ev);
    assert.equal(head, ev.newHead, "recomputed head must match the emitted head");
  }
  pass("event stream recompute reproduces every emitted head");

  // Tamper evidence: one altered byte anywhere breaks the chain.
  assert.notEqual(nextHead(h1, { ...steps[1], amount: steps[1].amount + 1n }), h2);
  assert.notEqual(nextHead(h1, { ...steps[1], timestamp: steps[1].timestamp + 1n }), h2);
  assert.notEqual(nextHead(h1, { ...steps[1], instrument: instrumentId("BTC-USD") }), h2);
  assert.notEqual(
    nextHead(h1, { ...steps[1], modelHash: keccak256(toUtf8Bytes("hero-momentum-v2")) }),
    h2,
    "swapping the model fingerprint must break the chain",
  );
  assert.notEqual(foldReceipts([steps[1], steps[0]]), h2, "reordering receipts must break the chain");
  pass("tampering with any field or the order breaks the chain");
}

console.log("");
console.log("ALL TESTS PASSED");
