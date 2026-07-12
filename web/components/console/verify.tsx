"use client";

// Verify drawer: recomputes a mandate's receipt hash chain client-side and
// presents each fold as a terminal line, printed sequentially (~120ms apart,
// instant under reduced motion). The math is exactly lib/chain.ts:
// head[n] = keccak256(solidityPacked(prevHead, instrument, amount,
// modelHash, timestamp)); the final verdict comes from verifyReceiptChain.

import { useEffect, useMemo, useRef, useState } from "react";
import { ZeroHash, keccak256, solidityPacked } from "ethers";
import {
  shortHash,
  verifyReceiptChain,
  type MandateNode,
} from "@/lib/chain";
import { fmtEth } from "./format";
import { usePrefersReducedMotion } from "./hooks";

interface TermLine {
  text: string;
  head?: string;
  tone: "muted" | "white" | "err";
  headTone?: "acid" | "err";
}

function buildVerification(node: MandateNode): {
  lines: TermLine[];
  ok: boolean;
} {
  const lines: TermLine[] = [];
  lines.push({
    text: `verify mandate #${node.id} · ${node.receipts.length} receipt${
      node.receipts.length === 1 ? "" : "s"
    } · model ${shortHash(node.modelHash)}`,
    tone: "muted",
  });
  lines.push({
    text: `head[0] = ${shortHash(ZeroHash)} (genesis)`,
    tone: "muted",
  });

  // Same fold as computeReceiptHead in lib/chain.ts, printed step by step.
  let head = ZeroHash;
  node.receipts.forEach((r, i) => {
    head = keccak256(
      solidityPacked(
        ["bytes32", "bytes32", "uint256", "bytes32", "uint64"],
        [head, r.instrument, r.amount, node.modelHash, r.timestamp]
      )
    );
    lines.push({
      text: `head[${i + 1}] = keccak(head[${i}], ${r.instrumentLabel}, ${fmtEth(
        r.amount
      )} ETH, model, ${r.timestamp}) ->`,
      head: shortHash(head),
      tone: "white",
      headTone: "acid",
    });
  });

  const result = verifyReceiptChain(node);
  lines.push({
    text: "computed head =",
    head: result.computed,
    tone: "white",
    headTone: "acid",
  });
  lines.push({
    text: "on-chain head =",
    head: result.expected,
    tone: "white",
    headTone: result.ok ? "acid" : "err",
  });
  return { lines, ok: result.ok };
}

export function VerifyDrawer({
  node,
  onClose,
}: {
  node: MandateNode;
  onClose: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const view = useMemo(() => buildVerification(node), [node]);
  const [shown, setShown] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const done = shown >= view.lines.length;

  // Sequential print, skipped under reduced motion.
  useEffect(() => {
    if (reduced) {
      setShown(view.lines.length);
      return;
    }
    setShown(0);
    const t = window.setInterval(() => {
      setShown((s) => {
        if (s + 1 >= view.lines.length) window.clearInterval(t);
        return s + 1;
      });
    }, 120);
    return () => window.clearInterval(t);
  }, [view, reduced]);

  // Keep the newest line in view as it prints.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown, done]);

  // Esc closes; focus lands on the close control; page scroll locks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Verify receipt chain for mandate #${node.id}`}
        className="absolute inset-x-0 bottom-0"
      >
        <div className="mx-auto max-w-[860px] px-3 sm:px-6">
          <div className="overflow-hidden rounded-t-lg border border-b-0 border-acid/50 bg-bg shadow-[0_-16px_48px_rgba(0,0,0,0.65)]">
            <header className="flex items-center justify-between gap-3 border-b border-line2 bg-panel px-4 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-acid">
                verify · mandate #{node.id} · receipt chain
              </span>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                className="pill pill-btn focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid"
              >
                esc · close
              </button>
            </header>

            <div
              ref={bodyRef}
              className="max-h-[46vh] overflow-y-auto px-4 py-3"
            >
              <div className="overflow-x-auto">
                <div className="min-w-max font-mono text-[11px] leading-[1.9]">
                  {view.lines.slice(0, shown).map((line, i) => (
                    <div key={i} className="whitespace-pre">
                      <span className="text-dim">{"> "}</span>
                      <span
                        className={
                          line.tone === "white"
                            ? "text-white"
                            : line.tone === "err"
                              ? "text-err"
                              : "text-muted"
                        }
                      >
                        {line.text}
                      </span>
                      {line.head && (
                        <span
                          className={
                            line.headTone === "err"
                              ? "text-err"
                              : "text-acid"
                          }
                        >
                          {" "}
                          {line.head}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {done && (
                <div className="mt-3 border-t border-line2 pb-1 pt-3">
                  <span
                    className={`font-display text-3xl font-bold tracking-[0.06em] ${
                      view.ok ? "text-acid" : "text-err"
                    }`}
                  >
                    {view.ok ? "VERIFIED" : "BROKEN"}
                  </span>
                  <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                    receipt chain recomputed client side from{" "}
                    {node.receipts.length} executed event
                    {node.receipts.length === 1 ? "" : "s"} · one altered byte
                    breaks the chain
                  </p>
                  {node.breaches > 0 && (
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-err">
                      {node.breaches} breach{node.breaches === 1 ? "" : "es"}{" "}
                      recorded on this node · the refusals are provable too
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
