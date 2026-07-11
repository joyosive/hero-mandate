// Local self test for the MPP x Mandate guard. No network, no chain: the
// contract is mocked in memory but reproduces execute() semantics exactly,
// with scope checks through the real merkle module, receipt heads through
// the real receipt module, and real ABI-encoded event logs. The MPP side
// (challenge, credential) is SIM by design. Run with: npx tsx src/mpp-selftest.ts

import assert from "node:assert/strict";
import {
  Contract,
  Interface,
  Wallet,
  decodeBytes32String,
  getBytes,
  keccak256,
  toUtf8Bytes,
  verifyMessage,
} from "ethers";
import { HERO_MANDATE_ABI } from "./abi";
import { buildRoot, instrumentId, verifyProof } from "./merkle";
import { GENESIS_HEAD, nextHead } from "./receipt";
import { MandateGuard, MppChallenge, credentialDigest, verifyCredential } from "./mpp-guard";

function pass(name: string): void {
  console.log(`PASS  ${name}`);
}

// ---------------------------------------------------------------- mock contract

interface MockState {
  agent: string;
  remaining: bigint;
  expiry: bigint;
  scopeRoot: string;
  ancestorRoots: string[];
  modelHash: string;
  receiptHead: string;
  breaches: bigint;
}

/** In-memory HeroMandate reproducing execute(): expiry, capacity, lineage scope, receipts, breach codes. */
class MockMandateContract {
  readonly interface = new Interface(HERO_MANDATE_ABI);
  readonly target = "0x00000000000000000000000000000000000000aa";
  timestamp = 1760000000n;
  private txCounter = 0;

  constructor(
    readonly id: bigint,
    readonly state: MockState,
  ) {}

  getFunction(name: string): (...args: any[]) => Promise<any> {
    if (name === "getMandate") {
      return async (id: bigint) => {
        assert.equal(id, this.id, "mock holds exactly one mandate");
        return {
          parentId: 0n,
          agent: this.state.agent,
          remaining: this.state.remaining,
          expiry: this.state.expiry,
          scopeRoot: this.state.scopeRoot,
          modelHash: this.state.modelHash,
          receiptHead: this.state.receiptHead,
          breaches: this.state.breaches,
        };
      };
    }
    if (name === "execute") {
      return async (id: bigint, instrument: string, amount: bigint, proofs: string[][]) =>
        this.execute(id, instrument, amount, proofs);
    }
    throw new Error(`mock has no function ${name}`);
  }

  private execute(id: bigint, instrument: string, amount: bigint, proofs: string[][]) {
    assert.equal(id, this.id, "mock holds exactly one mandate");
    const hash = `0x${(++this.txCounter).toString(16).padStart(64, "0")}`;
    const wrap = (name: "Executed" | "Breach", args: unknown[]) => {
      const { topics, data } = this.interface.encodeEventLog(name, args);
      return { hash, wait: async () => ({ logs: [{ address: this.target, topics: [...topics], data }] }) };
    };
    const refuse = (code: number) => {
      this.state.breaches += 1n;
      return wrap("Breach", [id, code, instrument, amount]);
    };

    this.timestamp += 12n;
    if (this.state.expiry <= this.timestamp) return refuse(1);
    if (amount > this.state.remaining) return refuse(2);
    // Scope: the one revealed leaf must prove against this node's root and every ancestor root.
    for (const [i, root] of [this.state.scopeRoot, ...this.state.ancestorRoots].entries()) {
      if (!verifyProof(root, decodeBytes32String(instrument), proofs[i] ?? [])) return refuse(3);
    }
    this.state.remaining -= amount;
    this.state.receiptHead = nextHead(this.state.receiptHead, {
      instrument,
      amount,
      modelHash: this.state.modelHash,
      timestamp: this.timestamp,
    });
    return wrap("Executed", [id, instrument, amount, this.state.receiptHead, this.timestamp]);
  }
}

// ---------------------------------------------------------------- cast

const agent = new Wallet(keccak256(toUtf8Bytes("hero-mpp-selftest-agent")));
const MODEL = keccak256(toUtf8Bytes("hero-payer-v1"));
const EXPIRY = 2000000000n;

const PAY_SET = ["PAY-USDC", "ETH-USD"];
const PARENT_SET = ["PAY-USDC", "ETH-USD", "ARB-USD"];
const ROOT_SET = ["PAY-USDC", "ETH-USD", "ARB-USD", "BTC-USD"];
const ANCESTOR_SETS = [PARENT_SET, ROOT_SET];

function challenge(id: string, amount: bigint): MppChallenge {
  return { id, payTo: "0x000000000000000000000000000000000000beef", asset: "USDC", amount, memo: "gpu-hours" };
}

function mockMandate(id: bigint, remaining: bigint, scopeSet: string[], ancestorSets: string[][]): MockMandateContract {
  return new MockMandateContract(id, {
    agent: agent.address,
    remaining,
    expiry: EXPIRY,
    scopeRoot: buildRoot(scopeSet),
    ancestorRoots: ancestorSets.map(buildRoot),
    modelHash: MODEL,
    receiptHead: GENESIS_HEAD,
    breaches: 0n,
  });
}

// ---------------------------------------------------------------- tests

async function main(): Promise<void> {
  // 1. In-scope, in-capacity payment: signed credential embedding the receipt head.
  const mock = mockMandate(7n, 5000000n, PAY_SET, ANCESTOR_SETS);
  const guard = new MandateGuard(mock as unknown as Contract, 7n, agent, PAY_SET, ANCESTOR_SETS);

  const paid = await guard.authorize(challenge("chg-001", 1250000n));
  assert.ok(paid.ok, "in-scope in-capacity payment must yield a credential");
  assert.equal(paid.credential.receiptHead, mock.state.receiptHead, "credential must embed the on-chain head");
  const expectedHead = nextHead(GENESIS_HEAD, {
    instrument: instrumentId("PAY-USDC"),
    amount: 1250000n,
    modelHash: MODEL,
    timestamp: mock.timestamp,
  });
  assert.equal(paid.credential.receiptHead, expectedHead, "head must match the real receipt fold");
  assert.equal(mock.state.remaining, 3750000n, "capacity must decrement by the spend");
  const digest = credentialDigest("chg-001", agent.address, 1250000n, paid.credential.receiptHead);
  assert.equal(verifyMessage(getBytes(digest), paid.credential.signature), agent.address);
  assert.ok(verifyCredential(paid.credential, 1250000n, agent.address));
  pass("in-scope payment yields a signed credential embedding the correct receipt head");

  // 2. Over capacity: breach code 2, no credential, state untouched.
  {
    const result = await guard.authorize(challenge("chg-002", 9000000n));
    assert.equal(result.ok, false, "over-capacity payment must be refused");
    assert.ok(!result.ok && result.breachCode === 2, "breach code must be 2 (capacity)");
    assert.ok(!("credential" in result), "no credential may exist for a refused spend");
    assert.equal(mock.state.remaining, 3750000n, "capacity must be untouched by the refusal");
    assert.equal(mock.state.breaches, 1n, "breach must be recorded at the node");
    pass("over-capacity payment is refused with breach code 2 and no credential");
  }

  // 3. Out of scope: a trading-only mandate that was never granted PAY-USDC.
  {
    const tradeMock = mockMandate(9n, 5000000n, ["ETH-USD", "ARB-USD"], [ROOT_SET]);
    const tradeGuard = new MandateGuard(
      tradeMock as unknown as Contract,
      9n,
      agent,
      ["ETH-USD", "ARB-USD"],
      [ROOT_SET],
    );
    const result = await tradeGuard.authorize(challenge("chg-003", 100000n));
    assert.equal(result.ok, false, "out-of-scope asset must be refused");
    assert.ok(!result.ok && result.breachCode === 3, "breach code must be 3 (scope)");
    assert.ok(!("credential" in result), "no credential may exist for an out-of-scope spend");
    assert.equal(tradeMock.state.remaining, 5000000n, "capacity must be untouched by the refusal");
    assert.equal(tradeMock.state.receiptHead, GENESIS_HEAD, "receipt chain must not extend on refusal");
    pass("out-of-scope asset is refused with breach code 3 and no credential");
  }

  // 4. Tampering with the receipt head in the credential breaks verification.
  {
    const tampered = { ...paid.credential, receiptHead: keccak256(toUtf8Bytes("forged-head")) };
    assert.notEqual(tampered.receiptHead, paid.credential.receiptHead);
    assert.equal(verifyCredential(tampered, 1250000n, agent.address), false, "tampered head must break verification");
    assert.equal(verifyCredential(paid.credential, 9999999n, agent.address), false, "tampered amount must break verification");
    assert.ok(verifyCredential(paid.credential, 1250000n, agent.address), "the untouched credential still verifies");
    pass("tampering with the receipt head in the credential breaks signature verification");
  }

  console.log("");
  console.log("ALL TESTS PASSED");
}

main().catch((err) => {
  console.error(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
