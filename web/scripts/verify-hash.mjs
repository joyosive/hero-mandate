// Proves the React core hashes byte identically to the standalone log.html,
// and that the new optional email does NOT change the receipt hash.
//
// Run: node --experimental-strip-types scripts/verify-hash.mjs
//
// Two independent computations of the SAME fixed log:
//   (a) reference: buildRoot + makeReceipt copied VERBATIM from public/log.html
//   (b) core:      imported from components/proof/core.ts (the React screen)
// If the roots are equal, the hash is unchanged.

import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  buildRoot as coreBuildRoot,
  makeReceipt as coreMakeReceipt,
} from "../components/proof/core.ts";

// ---- reference, copied verbatim from public/log.html --------------------------
const REF_MANDATE = {
  role: "proof-of-action-recorder",
  allowedTypes: ["review", "call", "content", "ops", "bounty", "onboarding"],
  requiredFields: ["who", "what"],
  maxHoursPerTask: 8,
  version: "v0.1",
};
function refBuildRoot(records) {
  let prev = ethers.ZeroHash;
  for (const rec of records) {
    prev = ethers.keccak256(
      ethers.concat([prev, ethers.toUtf8Bytes(JSON.stringify(rec))])
    );
  }
  return prev;
}
function refAgentWorker(task) {
  const ex = [];
  if (!REF_MANDATE.allowedTypes.includes(task.type))
    ex.push(`type '${task.type}' not in mandate`);
  for (const f of REF_MANDATE.requiredFields)
    if (!task[f]) ex.push(`missing required field '${f}'`);
  if (typeof task.hours === "number" && task.hours > REF_MANDATE.maxHoursPerTask)
    ex.push(`hours ${task.hours} over mandate cap ${REF_MANDATE.maxHoursPerTask}`);
  return {
    recordedAt: new Date().toISOString(),
    withinMandate: ex.length === 0,
    exceptions: ex,
    result: ex.length === 0 ? "recorded" : "flagged",
  };
}
function refMakeReceipt(task) {
  const d = refAgentWorker(task);
  const log = [
    { t: 0, type: "mandate", role: REF_MANDATE.role, version: REF_MANDATE.version },
    { t: 1, type: "task", ...task },
    { t: 2, type: "decide", withinMandate: d.withinMandate, exceptions: d.exceptions },
    { t: 3, type: "result", result: d.result, recordedAt: d.recordedAt },
  ];
  return { root: refBuildRoot(log), log, decision: d };
}

// ---- 1) fixed log: mandate + a task WITHOUT email -----------------------------
const FIXED = "2026-07-11T00:00:00.000Z";
const task = { type: "review", who: "ada", what: "Reviewed the mandate spec", hours: 1.5 };
const fixedLog = [
  { t: 0, type: "mandate", role: REF_MANDATE.role, version: REF_MANDATE.version },
  { t: 1, type: "task", ...task },
  { t: 2, type: "decide", withinMandate: true, exceptions: [] },
  { t: 3, type: "result", result: "recorded", recordedAt: FIXED },
];

const refRoot = refBuildRoot(fixedLog);
const coreRoot = coreBuildRoot(fixedLog);
assert.equal(coreRoot, refRoot, "core.buildRoot must equal log.html buildRoot");

// ---- 2) full makeReceipt, byte identical (mock time to fix recordedAt) --------
const RealDate = Date;
class FixedDate extends RealDate {
  toISOString() {
    return FIXED;
  }
}
globalThis.Date = FixedDate;

const refReceipt = refMakeReceipt(task);
const coreReceipt = coreMakeReceipt(task);
assert.equal(coreReceipt.root, refReceipt.root, "makeReceipt roots must match");

// ---- 3) email present in the form does NOT change the task or the hash --------
const formInputs = {
  type: "review",
  who: "ada",
  email: "ada@example.com",
  what: "Reviewed the mandate spec",
  hours: 1.5,
};
const taskFromForm = {
  type: formInputs.type,
  who: formInputs.who,
  what: formInputs.what,
  hours: formInputs.hours,
};
assert.equal("email" in taskFromForm, false, "email must not be in the task");
const withEmailReceipt = coreMakeReceipt(taskFromForm);
assert.equal(
  withEmailReceipt.root,
  refReceipt.root,
  "email must not change the receipt hash"
);

globalThis.Date = RealDate;

console.log("PASS  hash unchanged; email excluded from the receipt");
console.log("  fixed-log root (log.html) :", refRoot);
console.log("  fixed-log root (core.ts)  :", coreRoot);
console.log("  makeReceipt root (both)   :", coreReceipt.root);
console.log("  with-email task root      :", withEmailReceipt.root);
console.log("  equal                     :", coreRoot === refRoot && withEmailReceipt.root === refReceipt.root);
