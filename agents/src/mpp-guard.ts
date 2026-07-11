// Composition: Arbitrum MPP (Machine Payments Protocol) moves the money,
// Hero Mandate bounds and proves the authority. A payee issues an MPP-style
// challenge; this guard answers it only after the mandate contract accepts
// the spend via execute(), which decrements escrowed capacity and extends
// the receipt hash chain. The credential is signed over the new receipt
// head, so a payment credential cannot exist without on-chain authority.

import { Contract, Wallet, getBytes, keccak256, solidityPacked, toUtf8Bytes, verifyMessage } from "ethers";
import { buildProof, instrumentId } from "./merkle";

// ---------------------------------------------------------------- vendored MPP shapes
// Minimal challenge/credential pattern vendored from arbitrum-mpp v0.1.0.
// The project is in progress, so we do not depend on it or call its server.

export interface MppChallenge {
  id: string;
  payTo: string;
  asset: "USDC";
  amount: bigint;
  memo: string;
}

export interface MppCredential {
  challengeId: string;
  payer: string;
  signature: string;
}

/** MPP credential extended with the mandate receipt head it is bound to. */
export interface MandateBoundCredential extends MppCredential {
  receiptHead: string;
}

export type AuthorizeResult =
  | { ok: true; credential: MandateBoundCredential; receiptHead: string; txHash: string }
  | { ok: false; breachCode: number; txHash: string };

const BREACH_NAMES: Record<number, string> = { 1: "expiry", 2: "capacity", 3: "scope", 4: "caller" };

// ---------------------------------------------------------------- credential binding

/** Digest the credential signature covers: challenge id, payer, amount, receipt head. */
export function credentialDigest(challengeId: string, payer: string, amount: bigint, receiptHead: string): string {
  return keccak256(
    solidityPacked(
      ["bytes32", "address", "uint256", "bytes32"],
      [keccak256(toUtf8Bytes(challengeId)), payer, amount, receiptHead],
    ),
  );
}

/** Anyone can verify: recover the signer over the bound digest and compare. */
export function verifyCredential(credential: MandateBoundCredential, amount: bigint, expectedAgent: string): boolean {
  const digest = credentialDigest(credential.challengeId, credential.payer, amount, credential.receiptHead);
  try {
    return verifyMessage(getBytes(digest), credential.signature).toLowerCase() === expectedAgent.toLowerCase();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- the guard

/** One agent operating under one mandate. Payment instruments are scope symbols like "PAY-USDC". */
export class MandateGuard {
  constructor(
    private readonly contract: Contract,
    private readonly mandateId: bigint,
    private readonly agentWallet: Wallet,
    private readonly scopeSet: string[],
    private readonly ancestorSets: string[][] = [],
  ) {}

  /** Proofs for the agent's own scope set and every ancestor set, leaf to root order. */
  private proofStack(symbol: string): string[][] {
    const proofFor = (set: string[]): string[] => {
      try {
        return buildProof(set, symbol);
      } catch {
        // Not in this set. Submit an empty proof anyway: the contract refuses
        // and records the Breach at this node instead of failing silently.
        return [];
      }
    };
    return [proofFor(this.scopeSet), ...this.ancestorSets.map(proofFor)];
  }

  private log(msg: string): void {
    console.log(`[guard] ${msg}`);
  }

  async authorize(challenge: MppChallenge): Promise<AuthorizeResult> {
    const symbol = `PAY-${challenge.asset}`;
    this.log(
      `SIM MPP challenge ${challenge.id}: ${challenge.amount} ${challenge.asset} to ${challenge.payTo} (${challenge.memo})`,
    );

    // 1. Preflight: read the mandate and report the would-be result locally.
    // Advisory only. The contract stays the sole enforcer, so we submit either way.
    const m = await this.contract.getFunction("getMandate")(this.mandateId);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const expired = BigInt(m.expiry) <= now;
    const overCapacity = challenge.amount > BigInt(m.remaining);
    const verdict = expired
      ? "would refuse (expired)"
      : overCapacity
        ? "would refuse (over remaining capacity)"
        : "would allow";
    this.log(`SIM preflight: mandate ${this.mandateId} remaining ${m.remaining}, ${verdict}`);

    // 2. Execute on-chain: reveal exactly one leaf, prove it up the lineage.
    const proofs = this.proofStack(symbol);
    const tx = await this.contract.getFunction("execute")(
      this.mandateId,
      instrumentId(symbol),
      challenge.amount,
      proofs,
    );
    const receipt = await tx.wait();
    if (!receipt) throw new Error("execute returned no receipt");

    const contractAddress = String(this.contract.target).toLowerCase();
    for (const entry of receipt.logs) {
      if (String(entry.address).toLowerCase() !== contractAddress) continue;
      let parsed;
      try {
        parsed = this.contract.interface.parseLog({ topics: [...entry.topics], data: entry.data });
      } catch {
        continue;
      }
      if (!parsed) continue;

      // 3. Executed: the mandate allowed the spend. Sign the credential over
      // the new receipt head so payment and authority stay one object.
      if (parsed.name === "Executed" && BigInt(parsed.args.id) === this.mandateId) {
        const receiptHead = String(parsed.args.newHead);
        const digest = credentialDigest(challenge.id, this.agentWallet.address, challenge.amount, receiptHead);
        const signature = await this.agentWallet.signMessage(getBytes(digest));
        this.log(`executed on-chain, receipt head ${receiptHead}`);
        this.log(`SIM MPP credential signed by ${this.agentWallet.address}, bound to receipt head`);
        return {
          ok: true,
          credential: { challengeId: challenge.id, payer: this.agentWallet.address, signature, receiptHead },
          receiptHead,
          txHash: String(tx.hash),
        };
      }

      // 4. Breach: refused and recorded at this node. No credential exists.
      if (parsed.name === "Breach" && BigInt(parsed.args.id) === this.mandateId) {
        const breachCode = Number(parsed.args.code);
        this.log(`refused, breach code ${breachCode} (${BREACH_NAMES[breachCode] ?? "unknown"}), no credential signed`);
        return { ok: false, breachCode, txHash: String(tx.hash) };
      }
    }
    throw new Error("execute produced neither Executed nor Breach");
  }
}
