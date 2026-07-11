// Model attestation layer for Hero Mandate.
//
// The problem this closes: on chain the modelHash is a self-declared
// commitment. The mandate binds the receipt chain to a fingerprint, but
// nothing forces the party that actually ran the model to stand behind it.
//
// This layer adds that party. A "model operator" is whoever runs the model
// behind a modelHash: in production an inference provider or a TEE, in this
// demo a wallet derived at index 5. The operator publishes, in a registry,
// the mapping modelHash -> operator address. For every action an agent
// executes, the operator signs an EIP-712 attestation binding the model to
// that exact deed, anchored on the on-chain receipt head.
//
// Trust boundary, stated honestly: the attestation proves the holder of the
// operator key stands behind this action. It does not by itself prove which
// model produced the bytes. Hardware (TEE) or ZK inference verification
// (for example Offchain Labs inference verification) removes that remaining
// trust by proving which model ran. Self-declared today, operator-attested
// today, trustless-attested next.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  Provider,
  TypedDataDomain,
  TypedDataField,
  Wallet,
  getAddress,
  keccak256,
  solidityPacked,
  toUtf8Bytes,
  verifyTypedData,
} from "ethers";

// ---------------------------------------------------------------- operator key

// Sub-agent keys are derived from the deployer key and an index, the same
// derivation family flow.ts uses (orchestrator 1, momentum 2, ops 3). The
// model operator lives at index 5. Its private key is never printed.
export const OPERATOR_INDEX = 5;

/** Normalize a deployer key to a 0x-prefixed 32 byte hex string. */
function normalizePk(deployerPk: string): string {
  const trimmed = deployerPk.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("deployer key must be a 32 byte hex string");
  }
  return hex.toLowerCase();
}

/** The model operator wallet, derived from the deployer key at OPERATOR_INDEX. */
export function deriveOperator(deployerPk: string, provider?: Provider): Wallet {
  const pk = normalizePk(deployerPk);
  const key = keccak256(solidityPacked(["bytes32", "uint256"], [pk, OPERATOR_INDEX]));
  return provider ? new Wallet(key, provider) : new Wallet(key);
}

// ---------------------------------------------------------------- model registry

/** modelHash -> { operator address, human label }. This is the published map. */
export type ModelRegistry = Record<string, { operator: string; label: string }>;

// The three models the demo drives. keccak of the source string is the
// modelHash the contract commits, so these match flow.ts exactly.
export const MODEL_SOURCES = ["hero-orchestrator-v1", "hero-momentum-v1", "hero-payer-v1"] as const;

/** modelHash for a model source string, matching the on-chain commitment. */
export function modelHashOf(source: string): string {
  return keccak256(toUtf8Bytes(source));
}

/** Register the three demo model hashes to one operator, labelled by source. */
export function buildDemoRegistry(operator: string): ModelRegistry {
  const op = getAddress(operator);
  const registry: ModelRegistry = {};
  for (const source of MODEL_SOURCES) {
    registry[modelHashOf(source)] = { operator: op, label: source };
  }
  return registry;
}

export const REGISTRY_PATH = path.join(__dirname, "..", "out", "model-registry.json");

/** Read the published registry. Missing file means an empty registry. */
export function loadRegistry(file: string = REGISTRY_PATH): ModelRegistry {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8")) as ModelRegistry;
}

/** Publish the registry to disk. */
export function saveRegistry(registry: ModelRegistry, file: string = REGISTRY_PATH): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`);
}

// ---------------------------------------------------------------- attestation

export const ATTESTATION_DOMAIN_NAME = "HeroMandateAttestation";
export const ATTESTATION_DOMAIN_VERSION = "1";

// The struct the operator signs. chainId and the verifying contract live in
// the EIP-712 domain, so they are part of the signature too: an attestation
// for one chain or one contract cannot be replayed against another.
export const ATTESTATION_TYPES: Record<string, TypedDataField[]> = {
  ModelAttestation: [
    { name: "mandateId", type: "uint256" },
    { name: "receiptHead", type: "bytes32" },
    { name: "modelHash", type: "bytes32" },
    { name: "instrument", type: "bytes32" },
    { name: "amount", type: "uint256" },
  ],
};

/** The exact fields an attestation binds. instrument is the bytes32 id. */
export interface AttestationInput {
  chainId: number;
  contract: string;
  mandateId: bigint;
  receiptHead: string;
  modelHash: string;
  instrument: string;
  amount: bigint;
}

/** A signed attestation. Numeric fields are strings so it round-trips JSON. */
export interface Attestation {
  chainId: number;
  contract: string;
  mandateId: string;
  receiptHead: string;
  modelHash: string;
  instrument: string;
  amount: string;
  signature: string;
}

export interface VerifyAttestationResult {
  ok: boolean;
  operator: string | null;
  reason: string;
}

function buildDomain(chainId: number, contract: string): TypedDataDomain {
  return {
    name: ATTESTATION_DOMAIN_NAME,
    version: ATTESTATION_DOMAIN_VERSION,
    chainId,
    verifyingContract: getAddress(contract),
  };
}

function messageOf(att: AttestationInput | Attestation): Record<string, unknown> {
  return {
    mandateId: BigInt(att.mandateId),
    receiptHead: att.receiptHead,
    modelHash: att.modelHash,
    instrument: att.instrument,
    amount: BigInt(att.amount),
  };
}

/**
 * The operator signs the EIP-712 typed data over exactly the bound fields.
 * Returns the attestation and its signature, ready to publish next to the run.
 */
export async function attest(operatorWallet: Wallet, input: AttestationInput): Promise<Attestation> {
  const domain = buildDomain(input.chainId, input.contract);
  const signature = await operatorWallet.signTypedData(domain, ATTESTATION_TYPES, messageOf(input));
  return {
    chainId: input.chainId,
    contract: getAddress(input.contract),
    mandateId: input.mandateId.toString(),
    receiptHead: input.receiptHead,
    modelHash: input.modelHash,
    instrument: input.instrument,
    amount: input.amount.toString(),
    signature,
  };
}

/**
 * Recompute the typed-data digest, recover the signer, and assert it is the
 * operator the registry publishes for this modelHash. A modelHash absent from
 * the registry is rejected outright. Any tampered field recovers a different
 * signer, so verification fails with "attestation does not cover this action".
 */
export function verifyAttestation(att: Attestation, registry: ModelRegistry): VerifyAttestationResult {
  const entry = registry[att.modelHash.toLowerCase()] ?? registry[att.modelHash];
  if (!entry) {
    return { ok: false, operator: null, reason: "modelHash is not in the registry" };
  }
  let recovered: string;
  try {
    // verifyTypedData recomputes the EIP-712 digest from the domain, types
    // and message, then ecrecovers the signer. One altered field yields a
    // different digest and therefore a different recovered address.
    const domain = buildDomain(att.chainId, att.contract);
    recovered = verifyTypedData(domain, ATTESTATION_TYPES, messageOf(att), att.signature);
  } catch {
    return { ok: false, operator: null, reason: "signature does not recover" };
  }
  if (getAddress(recovered) !== getAddress(entry.operator)) {
    return { ok: false, operator: recovered, reason: "attestation does not cover this action" };
  }
  return { ok: true, operator: recovered, reason: "verified" };
}
