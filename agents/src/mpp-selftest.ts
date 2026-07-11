// Local self test for the MPP x Mandate guard. No network, no chain: the
// contract is mocked in memory but reproduces execute() semantics exactly,
// with scope checks through the real merkle module, receipt heads through
// the real receipt module, and real ABI-encoded event logs. The credential
// side uses the real @arbitrum/mpp primitives (createChallengeHash,
// buildPermit2TypedData); the challenge itself is SIM by design.
// Run with: npx tsx src/mpp-selftest.ts

import assert from "node:assert/strict";
import { Contract, Interface, Wallet, decodeBytes32String, keccak256, toUtf8Bytes, verifyTypedData } from "ethers";
// Same deep import as mpp-guard.ts: v0.1.0 does not export its utils module.
import { buildPermit2TypedData, createChallengeHash } from "../node_modules/@arbitrum/mpp/dist/utils.js";
import { HERO_MANDATE_ABI } from "./abi";
import { buildRoot, instrumentId, verifyProof } from "./merkle";
import { GENESIS_HEAD, nextHead } from "./receipt";
import {
  DEMO_USDC,
  MandateGuard,
  MppChallenge,
  SIM_CHAIN_ID,
  mandateRealm,
  toEthersTypes,
  verifyCredential,
} from "./mpp-guard";

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
  // 1. In-scope, in-capacity payment: permit2 credential embedding the receipt head.
  const mock = mockMandate(7n, 5000000n, PAY_SET, ANCESTOR_SETS);
  const guard = new MandateGuard(mock as unknown as Contract, 7n, agent, PAY_SET, ANCESTOR_SETS);

  const paid = await guard.authorize(challenge("chg-001", 1250000n));
  assert.ok(paid.ok, "in-scope in-capacity payment must yield a credential");
  assert.equal(paid.credential.type, "permit2", "credential must use MPP's permit2 wire shape");
  assert.equal(paid.credential.receiptHead, mock.state.receiptHead, "credential must embed the on-chain head");
  const expectedHead = nextHead(GENESIS_HEAD, {
    instrument: instrumentId("PAY-USDC"),
    amount: 1250000n,
    modelHash: MODEL,
    timestamp: mock.timestamp,
  });
  assert.equal(paid.credential.receiptHead, expectedHead, "head must match the real receipt fold");
  assert.equal(mock.state.remaining, 3750000n, "capacity must decrement by the spend");
  assert.deepEqual(
    paid.credential.permit.permitted,
    [{ token: DEMO_USDC, amount: "1250000" }],
    "permit must cover the challenged amount in the SIM demo token",
  );
  assert.deepEqual(
    paid.credential.transferDetails,
    [{ to: "0x000000000000000000000000000000000000beef", requestedAmount: "1250000" }],
    "transfer details must match the challenge",
  );
  pass("in-scope payment yields a permit2 credential embedding the correct receipt head");

  // 1a. Recover the signer from the permit2 typed data: must be the agent.
  {
    const typed = buildPermit2TypedData({
      chainId: SIM_CHAIN_ID,
      permitted: paid.credential.permit.permitted,
      recipient: paid.credential.transferDetails[0].to as `0x${string}`,
      nonce: BigInt(paid.credential.permit.nonce),
      deadline: BigInt(paid.credential.permit.deadline),
      Witness: paid.credential.witness,
    });
    const signer = verifyTypedData(typed.domain, toEthersTypes(typed), typed.message, paid.credential.signature);
    assert.equal(signer, agent.address, "typed data signer must be the agent");
    pass("permit2 typed data signature recovers to the agent address");
  }

  // 1b. Binding: the witness challenge hash equals createChallengeHash under the
  // receipt head realm, and a different receipt head produces a different hash.
  {
    const recomputed = createChallengeHash({
      id: "chg-001",
      realm: mandateRealm(paid.credential.receiptHead),
      transferDetails: paid.credential.transferDetails,
    });
    assert.equal(paid.credential.witness.challengeHash, recomputed, "witness must equal the recomputed challenge hash");
    const otherHead = keccak256(toUtf8Bytes("some-other-head"));
    assert.notEqual(otherHead, paid.credential.receiptHead);
    const otherHash = createChallengeHash({
      id: "chg-001",
      realm: mandateRealm(otherHead),
      transferDetails: paid.credential.transferDetails,
    });
    assert.notEqual(paid.credential.witness.challengeHash, otherHash, "a different receipt head must change the challenge hash");
    pass("challenge hash binds the credential to the exact mandate receipt head");
  }

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

  // 4. Tampering with the credential breaks verification.
  {
    assert.ok(verifyCredential(paid.credential, agent.address, SIM_CHAIN_ID), "the untouched credential verifies");
    const forgedHead = { ...paid.credential, receiptHead: keccak256(toUtf8Bytes("forged-head")) };
    assert.equal(verifyCredential(forgedHead, agent.address, SIM_CHAIN_ID), false, "tampered head must break verification");
    const forgedAmount = {
      ...paid.credential,
      transferDetails: [{ ...paid.credential.transferDetails[0], requestedAmount: "9999999" }],
    };
    assert.equal(verifyCredential(forgedAmount, agent.address, SIM_CHAIN_ID), false, "tampered amount must break verification");
    assert.ok(verifyCredential(paid.credential, agent.address, SIM_CHAIN_ID), "the untouched credential still verifies");
    pass("tampering with the receipt head or amount breaks credential verification");
  }

  console.log("");
  console.log("ALL TESTS PASSED");
}

main().catch((err) => {
  console.error(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
