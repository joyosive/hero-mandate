// Merkle helpers for Hero Mandate scope commitments.
// These MUST match the on-chain verifier exactly:
//   leaf        = keccak256(solidityPacked(["bytes32"], [instrument]))
//                 where instrument = encodeBytes32String(symbol)
//   parent node = keccak256(concat(sorted pair, ascending as bytes))
//   root        = fold sorted unique leaves pairwise per level,
//                 an odd trailing leaf promotes to the next level unchanged

import { concat, encodeBytes32String, keccak256, solidityPacked } from "ethers";

/** Symbol string to its bytes32 instrument id, e.g. "ETH-USD". */
export function instrumentId(symbol: string): string {
  return encodeBytes32String(symbol);
}

/** Leaf hash of one instrument symbol. */
export function leafOf(symbol: string): string {
  return keccak256(solidityPacked(["bytes32"], [instrumentId(symbol)]));
}

/** Commutative pair hash: sort the two 32 byte values ascending, concat, keccak. */
export function hashPair(a: string, b: string): string {
  const [lo, hi] = BigInt(a) <= BigInt(b) ? [a, b] : [b, a];
  return keccak256(concat([lo, hi]));
}

/** Sorted (ascending) unique leaves for a symbol set. */
export function sortedUniqueLeaves(symbols: string[]): string[] {
  const seen = new Set<string>();
  const leaves: string[] = [];
  for (const symbol of symbols) {
    const leaf = leafOf(symbol).toLowerCase();
    if (!seen.has(leaf)) {
      seen.add(leaf);
      leaves.push(leaf);
    }
  }
  leaves.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
  return leaves;
}

/** Merkle root of an instrument set. */
export function buildRoot(symbols: string[]): string {
  let level = sortedUniqueLeaves(symbols);
  if (level.length === 0) {
    throw new Error("cannot build a root over an empty instrument set");
  }
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(hashPair(level[i], level[i + 1]));
      } else {
        next.push(level[i]);
      }
    }
    level = next;
  }
  return level[0];
}

/** Merkle proof (sibling path, leaf to root) for one symbol within a set. */
export function buildProof(symbols: string[], symbol: string): string[] {
  let level = sortedUniqueLeaves(symbols);
  let index = level.indexOf(leafOf(symbol).toLowerCase());
  if (index < 0) {
    throw new Error(`"${symbol}" is not in the instrument set`);
  }
  const proof: string[] = [];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(hashPair(level[i], level[i + 1]));
        if (i === index) proof.push(level[i + 1]);
        else if (i + 1 === index) proof.push(level[i]);
      } else {
        next.push(level[i]);
      }
    }
    index = Math.floor(index / 2);
    level = next;
  }
  return proof;
}

/** Local check that a proof binds a symbol to a root. Mirrors the on-chain fold. */
export function verifyProof(root: string, symbol: string, proof: string[]): boolean {
  let computed = leafOf(symbol);
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed.toLowerCase() === root.toLowerCase();
}
