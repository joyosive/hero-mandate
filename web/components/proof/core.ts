// Proof-of-Action hashing core.
//
// This is the SAME deterministic recorder as the standalone log page and the
// Hero agent CLI (agents/hero-worker.mjs). The hash must stay byte identical
// across all three so a receipt computed in the browser can be recomputed and
// anchored by the CLI. Imports come from the project's ethers, never a CDN.
//
// CRITICAL: the hashed `task` is { type, who, what, hours } ONLY. Any contact
// metadata (an email) is never part of the task, the log, the receipt root, or
// the exported session JSON. It is carried separately by the UI.

import { ZeroHash, concat, keccak256, toUtf8Bytes } from "ethers";

// ==CORE-START== must match public log page + agents/hero-worker.mjs byte for byte

// The six task types the mandate allows, in order. The select renders these.
export const TASK_TYPES = [
  "review",
  "call",
  "content",
  "ops",
  "bounty",
  "onboarding",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

// The worker's sealed authority. Plaintext here; production seals it with Fhenix.
export const MANDATE = {
  role: "proof-of-action-recorder",
  allowedTypes: [...TASK_TYPES] as string[],
  requiredFields: ["who", "what"] as string[],
  maxHoursPerTask: 8,
  version: "v0.1",
};

// The only fields that enter the hash. hours is optional (omitted when blank).
export interface Task {
  type: string;
  who: string;
  what: string;
  hours?: number;
}

export interface Decision {
  recordedAt: string;
  withinMandate: boolean;
  exceptions: string[];
  result: "recorded" | "flagged";
}

export interface Receipt {
  root: string;
  log: unknown[];
  decision: Decision;
}

// h0 = keccak(ZeroHash || rec0); hi = keccak(h(i-1) || reci). One altered byte
// breaks the chain. Identical to hero-worker.mjs and the log page.
export function buildRoot(records: unknown[]): string {
  let prev: string = ZeroHash;
  for (const rec of records) {
    prev = keccak256(concat([prev, toUtf8Bytes(JSON.stringify(rec))]));
  }
  return prev;
}

// Deterministic on purpose so receipts are reproducible and independently checkable.
export function agentWorker(task: Task): Decision {
  const ex: string[] = [];
  if (!MANDATE.allowedTypes.includes(task.type))
    ex.push(`type '${task.type}' not in mandate`);
  for (const f of MANDATE.requiredFields)
    if (!task[f as keyof Task]) ex.push(`missing required field '${f}'`);
  if (typeof task.hours === "number" && task.hours > MANDATE.maxHoursPerTask)
    ex.push(`hours ${task.hours} over mandate cap ${MANDATE.maxHoursPerTask}`);
  return {
    recordedAt: new Date().toISOString(),
    withinMandate: ex.length === 0,
    exceptions: ex,
    result: ex.length === 0 ? "recorded" : "flagged",
  };
}

// Proof-of-Action shape: mandate -> task -> agent decision -> result.
// The t:1 entry spreads the task; this is byte identical to the log page's
// `{ t: 1, type: "task", ...task }` because the "task" literal is always
// overwritten by task.type, leaving the same keys, order and values.
export function makeReceipt(task: Task): Receipt {
  const d = agentWorker(task);
  const log: unknown[] = [
    { t: 0, type: "mandate", role: MANDATE.role, version: MANDATE.version },
    { t: 1, ...task },
    { t: 2, type: "decide", withinMandate: d.withinMandate, exceptions: d.exceptions },
    { t: 3, type: "result", result: d.result, recordedAt: d.recordedAt },
  ];
  return { root: buildRoot(log), log, decision: d };
}
// ==CORE-END==

// One anchor covers the day's work: hash-chain over each receipt root.
// Kept identical so the CLI can recompute the session root from exported JSON.
export function sessionRoot(receipts: { root: string }[]): string {
  return buildRoot(receipts.map((s) => ({ root: s.root })));
}

// Optional central capture. Each recorded action also lands in a Google Sheet.
// The email is stored by the sheet as contact metadata only; the server-side
// Apps Script sanitizes formula injection separately.
export const SHEET_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbzaEZpEjEj8VD8HfeEvNByS5SoxWq0OIw5yE9nj3sCx6jIAXS6RLeRwCloRTyFLZ_romA/exec";

// Optional email. Empty is allowed; non-empty must look like an address.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
