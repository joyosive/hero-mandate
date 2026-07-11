// Composition: Arbitrum MPP (Machine Payments Protocol) moves the money,
// Hero Mandate bounds and proves the authority. A payee issues an MPP
// challenge; this guard answers it only after the mandate contract accepts
// the spend via execute(), which decrements escrowed capacity and extends
// the receipt hash chain. The credential is @arbitrum/mpp's permit2 wire
// format, and the new receipt head is folded into the package's own
// challenge hash through the realm string, together with the exact amount
// that execute() authorized, so a payment credential cannot exist without
// on-chain authority for that precise amount.

import { Contract, TypedDataField, Wallet, keccak256, toUtf8Bytes, verifyTypedData } from "ethers";
// @arbitrum/mpp v0.1.0 does not list its utils module in the package exports
// map (only ".", "./client", "./server" and "./default" are exported), so we
// import the built file directly. This is the package's own code and types,
// not a vendored copy.
import { buildPermit2TypedData, createChallengeHash } from "../node_modules/@arbitrum/mpp/dist/utils.js";
import type { Permit2Payload } from "../node_modules/@arbitrum/mpp/dist/default.js";
import { buildProof, instrumentId } from "./merkle";

// ---------------------------------------------------------------- MPP wire shapes

export interface MppChallenge {
  id: string;
  payTo: string;
  asset: "USDC";
  amount: bigint;
  memo: string;
}

/**
 * @arbitrum/mpp permit2 wire credential, extended with the challenge id and
 * the mandate receipt head it is bound to. The receipt head reaches the
 * signature through createChallengeHash: it is the realm of the witness.
 */
export interface MandateBoundCredential extends Permit2Payload {
  type: "permit2";
  challengeId: string;
  receiptHead: string;
}

export type AuthorizeResult =
  | { ok: true; credential: MandateBoundCredential; receiptHead: string; txHash: string }
  | { ok: false; breachCode: number; txHash: string };

const BREACH_NAMES: Record<number, string> = { 1: "expiry", 2: "capacity", 3: "scope", 4: "caller" };

// SIM: demo token address, "usd" in ASCII. No real USDC is assumed on the
// testnets this project runs against; the permit2 payload is never settled.
export const DEMO_USDC = "0x0000000000000000000000000000000000757364";

// SIM: chain id used when the contract has no provider (the mock selftest
// contract). Arbitrum Sepolia, matching @arbitrum/mpp's supported chains.
export const SIM_CHAIN_ID = 421614;

// ---------------------------------------------------------------- credential binding

/**
 * Realm string binding a challenge hash to a mandate receipt head AND the
 * exact amount that execute() authorized. Folding the executed amount in here
 * puts it inside the challenge hash, hence inside the signed permit2 witness,
 * so the credential proves this precise amount was authorized on-chain, not
 * merely that some execute() happened.
 */
export function mandateRealm(receiptHead: string, executedAmount: bigint | string): string {
  return `hero-mandate/${receiptHead}/${executedAmount.toString()}`;
}

/**
 * buildPermit2TypedData returns readonly type tuples; ethers wants mutable
 * TypedDataField arrays. No EIP712Domain entry is present in the builder's
 * types, so nothing needs stripping before signing.
 */
export function toEthersTypes(typed: ReturnType<typeof buildPermit2TypedData>): Record<string, TypedDataField[]> {
  return typed.types as unknown as Record<string, TypedDataField[]>;
}

/**
 * Anyone can verify: bind the permit amount to the amount the mandate
 * authorized, recompute the challenge hash from the credential's own transfer
 * details under the amount-bearing receipt head realm, check it matches the
 * signed witness, then recover the permit2 typed data signer and compare.
 *
 * The authorized amount is the requestedAmount in transferDetails, which is
 * what execute() decremented and what the realm folds into the witness. A
 * credential whose permit covers a different amount than the realm authorizes
 * is rejected before any signature check.
 */
export function verifyCredential(credential: MandateBoundCredential, expectedAgent: string, chainId: number): boolean {
  try {
    // The amount this credential is presented as authorization for.
    const permitAmount = credential.permit.permitted[0].amount;
    // The amount actually authorized on-chain, carried in the transfer details
    // and folded into the realm (hence into the signed challenge hash).
    const authorizedAmount = credential.transferDetails[0].requestedAmount;
    // Strong binding: the permit must cover exactly the authorized amount, so
    // a credential built for one amount cannot be re-presented for another.
    if (permitAmount !== authorizedAmount) return false;
    const expectedHash = createChallengeHash({
      id: credential.challengeId,
      realm: mandateRealm(credential.receiptHead, authorizedAmount),
      transferDetails: credential.transferDetails,
    });
    if (expectedHash !== credential.witness.challengeHash) return false;
    const typed = buildPermit2TypedData({
      chainId,
      permitted: credential.permit.permitted,
      recipient: credential.transferDetails[0].to as `0x${string}`,
      nonce: BigInt(credential.permit.nonce),
      deadline: BigInt(credential.permit.deadline),
      Witness: { challengeHash: expectedHash },
    });
    const signer = verifyTypedData(typed.domain, toEthersTypes(typed), typed.message, credential.signature);
    return signer.toLowerCase() === expectedAgent.toLowerCase();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- the guard

/**
 * Optional real-settlement knobs. Defaults preserve the original behavior
 * exactly: the SIM demo token and a nonce derived from the challenge id.
 */
export interface GuardSettlementOptions {
  /** ERC20 address the permit2 credential covers. Default DEMO_USDC (SIM). */
  token?: string;
  /** Unordered permit2 nonce source; supply a fresh unused nonce per challenge. */
  nonceFor?: (challenge: MppChallenge) => bigint;
}

/** One agent operating under one mandate. Payment instruments are scope symbols like "PAY-USDC". */
export class MandateGuard {
  constructor(
    private readonly contract: Contract,
    private readonly mandateId: bigint,
    private readonly agentWallet: Wallet,
    private readonly scopeSet: string[],
    private readonly ancestorSets: string[][] = [],
    private readonly settlement: GuardSettlementOptions = {},
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

  private async chainId(): Promise<number> {
    const provider = this.contract.runner?.provider;
    if (provider) return Number((await provider.getNetwork()).chainId);
    return SIM_CHAIN_ID; // SIM: mock contract, no provider attached
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
    // This is the exact amount the mandate authorizes and decrements; the
    // credential below is bound to it so authority and payment cannot diverge.
    const executedAmount = challenge.amount;
    const proofs = this.proofStack(symbol);
    const tx = await this.contract.getFunction("execute")(
      this.mandateId,
      instrumentId(symbol),
      executedAmount,
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

      // 3. Executed: the mandate allowed the spend. Fold the new receipt head
      // AND the exact authorized amount into MPP's challenge hash via the
      // realm, then sign the permit2 typed data, so payment and authority stay
      // one object bound to this precise amount.
      if (parsed.name === "Executed" && BigInt(parsed.args.id) === this.mandateId) {
        const receiptHead = String(parsed.args.newHead);
        const chainId = await this.chainId();
        const transferDetails = [{ to: challenge.payTo, requestedAmount: executedAmount.toString() }];
        const challengeHash = createChallengeHash({
          id: challenge.id,
          realm: mandateRealm(receiptHead, executedAmount),
          transferDetails,
        });
        const permitted = [{ token: this.settlement.token ?? DEMO_USDC, amount: executedAmount.toString() }];
        // Never sign a permit for a different amount than the mandate just
        // authorized. Both are built from executedAmount, so on the honest path
        // this always holds; it throws only if a future change lets them drift.
        if (permitted[0].amount !== executedAmount.toString()) {
          throw new Error(
            `permit amount ${permitted[0].amount} does not equal the executed amount ${executedAmount.toString()}`,
          );
        }
        // Permit2 nonces are unordered uint256 values; derived from the
        // challenge id by default, or supplied by the caller when a real
        // settlement needs a fresh unused nonce per run.
        const nonce = this.settlement.nonceFor?.(challenge) ?? BigInt(keccak256(toUtf8Bytes(challenge.id)));
        const deadline = now + 3600n;
        const typed = buildPermit2TypedData({
          chainId,
          permitted,
          recipient: challenge.payTo as `0x${string}`,
          nonce,
          deadline,
          Witness: { challengeHash },
        });
        const signature = await this.agentWallet.signTypedData(typed.domain, toEthersTypes(typed), typed.message);
        this.log(`executed on-chain, receipt head ${receiptHead}`);
        this.log(`SIM MPP permit2 credential signed by ${this.agentWallet.address}, receipt head and amount ${executedAmount.toString()} bound via challenge hash realm`);
        return {
          ok: true,
          credential: {
            type: "permit2",
            permit: { permitted, nonce: nonce.toString(), deadline: deadline.toString() },
            transferDetails,
            witness: { challengeHash },
            signature,
            challengeId: challenge.id,
            receiptHead,
          },
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
