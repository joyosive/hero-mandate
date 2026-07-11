// Local self test for the model attestation layer.
// No network, no keys from disk. Run with: npx tsx src/attestation-selftest.ts
//
// Proves: a valid attestation verifies and recovers to the operator; a
// different signer fails; tampering any bound field (or the domain) breaks
// it; an unregistered modelHash is rejected.

import assert from "node:assert/strict";
import { Wallet, getAddress, keccak256, parseEther, toUtf8Bytes } from "ethers";
import { instrumentId } from "./merkle";
import {
  Attestation,
  attest,
  buildDemoRegistry,
  deriveOperator,
  modelHashOf,
  verifyAttestation,
} from "./attestation";

function pass(name: string): void {
  console.log(`PASS  ${name}`);
}

// Deterministic, self-contained keys. Not read from disk, never printed.
const DEPLOYER_PK = keccak256(toUtf8Bytes("hero-attestation-selftest-deployer"));
const operator = deriveOperator(DEPLOYER_PK);
const impostor = new Wallet(keccak256(toUtf8Bytes("hero-attestation-selftest-impostor")));

const registry = buildDemoRegistry(operator.address);

// A canonical in-scope action: momentum trades ETH-USD for 0.0004 under node 4.
const input = {
  chainId: 421614,
  contract: "0x0dfca3eabfde4e4714057a326058611e040dcdd9",
  mandateId: 4n,
  receiptHead: "0xf4db49c3638d916ab70ac9aed85d4cce81654114dfe1214a012349ce2c62ce9f",
  modelHash: modelHashOf("hero-momentum-v1"),
  instrument: instrumentId("ETH-USD"),
  amount: parseEther("0.0004"),
};

async function main(): Promise<void> {
  // ------------------------------------------------------------ valid attestation
  {
    const att = await attest(operator, input);
    const res = verifyAttestation(att, registry);
    assert.equal(res.ok, true, "valid attestation must verify");
    assert.equal(getAddress(res.operator ?? ""), getAddress(operator.address), "must recover to the operator");
    assert.equal(registry[input.modelHash].operator, getAddress(operator.address), "registry maps modelHash to operator");
    pass("valid attestation verifies and recovers to the published operator");
  }

  // ------------------------------------------------------------ different signer
  {
    // Same bound fields and registered modelHash, but signed by an impostor.
    const forged = await attest(impostor, input);
    const res = verifyAttestation(forged, registry);
    assert.equal(res.ok, false, "an attestation by a non-operator must fail");
    assert.equal(res.reason, "attestation does not cover this action");
    assert.notEqual(getAddress(res.operator ?? "0x0000000000000000000000000000000000000000"), getAddress(operator.address));
    pass("a different signer fails: recovered key is not the registered operator");
  }

  // ------------------------------------------------------------ tampering breaks it
  {
    const base = await attest(operator, input);

    const tampers: Array<[string, (a: Attestation) => Attestation]> = [
      ["mandateId", (a) => ({ ...a, mandateId: (BigInt(a.mandateId) + 1n).toString() })],
      ["amount", (a) => ({ ...a, amount: (BigInt(a.amount) + 1n).toString() })],
      ["instrument", (a) => ({ ...a, instrument: instrumentId("BTC-USD") })],
      ["receiptHead", (a) => ({ ...a, receiptHead: `0x${"11".repeat(32)}` })],
      // modelHash swapped to another REGISTERED model: still fails, because
      // the signature covered the original hash, so the digest no longer matches.
      ["modelHash", (a) => ({ ...a, modelHash: modelHashOf("hero-payer-v1") })],
      ["chainId (domain)", (a) => ({ ...a, chainId: a.chainId + 1 })],
      ["contract (domain)", (a) => ({ ...a, contract: "0x000000000000000000000000000000000000dEaD" })],
    ];

    for (const [field, mutate] of tampers) {
      const res = verifyAttestation(mutate(base), registry);
      assert.equal(res.ok, false, `tampering ${field} must break verification`);
    }
    pass("tampering any bound field or the domain breaks verification");
  }

  // ------------------------------------------------------------ unregistered modelHash
  {
    // The operator honestly signs an action for a model nobody published.
    const att = await attest(operator, { ...input, modelHash: modelHashOf("hero-ghost-v9") });
    const res = verifyAttestation(att, registry);
    assert.equal(res.ok, false, "an unregistered modelHash must be rejected");
    assert.equal(res.reason, "modelHash is not in the registry");
    pass("an unregistered modelHash is rejected before signature recovery");
  }

  console.log("");
  console.log("ALL TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
