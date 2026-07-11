"use client";

// Landing hero: the thesis and the proof chips. Type only, no decoration;
// the waterfall below is the page's one bold element.

import Link from "next/link";
import { CHAINS, CONTRACT, REPO_URL, type ChainKey } from "@/components/shell";
import { shortAddress } from "@/lib/chain";

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid";

export default function Hero({ chain }: { chain: ChainKey }) {
  return (
    <section className="mx-auto max-w-[1280px] px-4 pb-12 pt-14 md:px-6 md:pb-16 md:pt-24">
      <p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.22em] text-acid">
        <span className="live-dot" aria-hidden="true" />
        Live on Robinhood Chain
      </p>

      <h1 className="mt-6 max-w-[920px] font-display text-[clamp(2.5rem,7vw,4.9rem)] font-bold leading-[1.02] tracking-tight text-white">
        The breach is provable.
        <span className="block text-acid">The mandate stays sealed.</span>
      </h1>

      <p className="mt-6 max-w-[680px] text-[15px] leading-relaxed text-muted md:text-[17px]">
        Hero Mandate makes an AI agent&apos;s authority an on-chain object:
        escrowed, scoped, expiring, delegable downward, and provably narrower
        at every level.
      </p>

      <div className="mt-7 flex flex-wrap items-center gap-2">
        <a
          className={`pill pill-btn no-underline ${FOCUS}`}
          href={`${CHAINS[chain].explorer}/address/${CONTRACT}`}
          target="_blank"
          rel="noreferrer"
          title={`ChainOfMandate on ${CHAINS[chain].label}`}
        >
          contract {shortAddress(CONTRACT)}
        </a>
        <a
          className={`pill pill-btn no-underline ${FOCUS}`}
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
        >
          14 commits
        </a>
        <a
          className={`pill pill-btn no-underline ${FOCUS}`}
          href={`${CHAINS.robinhood.explorer}/address/${CONTRACT}`}
          target="_blank"
          rel="noreferrer"
          title={`Contract on ${CHAINS.robinhood.label}`}
        >
          Live on Robinhood Chain
        </a>
      </div>

      <div className="mt-9 flex flex-wrap items-center gap-5">
        <Link
          className={`btn no-underline hover:no-underline ${FOCUS}`}
          href={`/console?chain=${chain}`}
        >
          Open the console
        </Link>
        <Link
          className={`font-mono text-[11px] uppercase tracking-[0.14em] text-muted underline decoration-dim underline-offset-4 hover:text-white ${FOCUS}`}
          href={`/how?chain=${chain}`}
        >
          How it works
        </Link>
      </div>
    </section>
  );
}
