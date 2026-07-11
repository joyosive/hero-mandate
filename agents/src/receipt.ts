// Receipt hash chain recompute. MUST match the contract exactly:
//   newHead = keccak256(solidityPacked(
//     ["bytes32", "bytes32", "uint256", "bytes32", "uint64"],
//     [prevHead, instrument, amount, modelHash, timestamp]))
// Genesis head is bytes32 zero.

import { ZeroHash, keccak256, solidityPacked } from "ethers";

export const GENESIS_HEAD = ZeroHash;

export interface ReceiptStep {
  instrument: string;
  amount: bigint;
  modelHash: string;
  timestamp: bigint;
}

/** One link of the chain. */
export function nextHead(prevHead: string, step: ReceiptStep): string {
  return keccak256(
    solidityPacked(
      ["bytes32", "bytes32", "uint256", "bytes32", "uint64"],
      [prevHead, step.instrument, step.amount, step.modelHash, step.timestamp],
    ),
  );
}

/** Fold a full stream of receipts from genesis. */
export function foldReceipts(steps: ReceiptStep[]): string {
  return steps.reduce((head, step) => nextHead(head, step), GENESIS_HEAD);
}
