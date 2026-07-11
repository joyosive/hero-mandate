// How it works, as a rail: the five stations every trade passes through.
// Language sourced from docs/ARCHITECTURE.md; /how carries the depth.

import Link from "next/link";
import type { ChainKey } from "@/components/shell";

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid";

const STEPS = [
  {
    key: "MANDATE",
    line: "Escrowed capacity, committed scope, expiry, model fingerprint. One node in a tree.",
  },
  {
    key: "TRADE",
    line: "The agent executes. One scope leaf is revealed and proved against every ancestor's root.",
  },
  {
    key: "RECEIPT",
    line: "Each execution extends a per-mandate hash chain. One altered byte breaks it.",
  },
  {
    key: "ANCHOR",
    line: "Heads and roots anchor into the verified HeroAnchor contract on Arbitrum Sepolia.",
  },
  {
    key: "VERIFY",
    line: "Anyone recomputes the chain from public events. Tamper evident, never tamper proof.",
  },
] as const;

export default function Steps({ chain }: { chain: ChainKey }) {
  return (
    <section className="mx-auto max-w-[1280px] border-t border-line2 px-4 py-12 md:px-6 md:py-16">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
        How it works
      </h2>

      <ol className="relative mt-7 grid gap-7 sm:grid-cols-5 sm:gap-4">
        {/* connector: horizontal on the rail, vertical when stacked */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-[3px] hidden h-px bg-acid/25 sm:block"
        />
        <div
          aria-hidden="true"
          className="absolute bottom-1 left-[3px] top-1 w-px bg-acid/25 sm:hidden"
        />
        {STEPS.map((step) => (
          <li key={step.key} className="relative pl-6 sm:pl-0">
            <span
              aria-hidden="true"
              className="absolute left-0 top-[0px] block h-[7px] w-[7px] bg-acid sm:relative sm:left-auto sm:top-auto"
            />
            <div className="font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-white sm:mt-3">
              {step.key}
            </div>
            <p className="mt-1.5 max-w-[46ch] text-[13px] leading-relaxed text-muted sm:pr-3">
              {step.line}
            </p>
          </li>
        ))}
      </ol>

      <Link
        className={`mt-7 inline-block font-mono text-[11px] uppercase tracking-[0.14em] text-muted underline decoration-dim underline-offset-4 hover:text-white ${FOCUS}`}
        href={`/how?chain=${chain}`}
      >
        Read the full mechanics
      </Link>
    </section>
  );
}
