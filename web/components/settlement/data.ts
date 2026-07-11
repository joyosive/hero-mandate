// Settlement data layer for the interactive replay panel.
//
// Every field here is copied verbatim from a real on-chain settlement run
// (agents/out/settle-*.json). Nothing is signed or sent from the browser:
// these transactions already happened and are verifiable on the explorer.
// The panel replays them; it does not produce them.

import { CHAINS, type ChainKey } from "@/components/shell";
import raw from "@/config/settlements.json";

export interface SettlementReplay {
  tx: string | null;
  invalidNonce: boolean;
  selector: string;
}

export interface SettlementToken {
  symbol: string; // on-chain token symbol, e.g. USDC
  real: boolean; // true = canonical Circle USDC, false = demo stablecoin
  label: string; // human label, e.g. "Circle USDC"
  address: string;
  decimals: number;
}

export interface Settlement {
  chainKey: ChainKey; // keys shell CHAINS for explorer + label
  network: string;
  chainId: number;
  mandateContract: string;
  permit2: string;
  token: SettlementToken;
  vendor: string;
  mandateId: number;
  executeTx: string; // agent executes under the payments mandate
  receiptHead: string; // receipt head the credential is bound to
  nonce: string; // permit2 nonce, consumed on settle
  amount: string; // settled amount, in token base units
  settleTx: string; // tokens move through canonical Permit2
  vendorBefore: string; // vendor balance before, base units
  vendorAfter: string; // vendor balance after, base units
  replay: SettlementReplay; // the refused replay of the same credential
}

export const SETTLEMENTS = raw as unknown as Settlement[];

export function txUrl(chainKey: ChainKey, hash: string): string {
  return `${CHAINS[chainKey].explorer}/tx/${hash}`;
}

export function chainLabel(chainKey: ChainKey): string {
  return CHAINS[chainKey].label;
}

export function explorerName(chainKey: ChainKey): string {
  return chainKey === "sepolia" ? "Arbiscan" : "explorer";
}

// Base units -> number of whole tokens (6 decimals for USDC).
export function units(base: string, decimals: number): number {
  return Number(base) / 10 ** decimals;
}

// Fixed two decimals, mono columns should not jitter as they count.
export function fmtUnits(base: string, decimals: number): string {
  return units(base, decimals).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtAmount(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function shortHex(h: string): string {
  return h.length > 12 ? `${h.slice(0, 6)}..${h.slice(-4)}` : h;
}
