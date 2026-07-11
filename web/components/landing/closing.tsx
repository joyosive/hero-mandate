// Closing band: the honesty line and the two exits, repo and console.

import Link from "next/link";
import { REPO_URL, type ChainKey } from "@/components/shell";

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid";

export default function Closing({ chain }: { chain: ChainKey }) {
  return (
    <section className="mx-auto max-w-[1280px] border-t border-line2 px-4 py-12 md:px-6 md:py-16">
      <div className="panel flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <p className="font-mono text-[12px] leading-relaxed text-muted">
          Testnet. No token. No admin keys.{" "}
          <span className="text-white">Everything on chain is real.</span>
        </p>
        <div className="flex flex-wrap items-center gap-5">
          <a
            className={`font-mono text-[11px] text-muted underline decoration-dim underline-offset-4 hover:text-white ${FOCUS}`}
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            github.com/joyosive/hero-mandate
          </a>
          <Link
            className={`btn no-underline hover:no-underline ${FOCUS}`}
            href={`/console?chain=${chain}`}
          >
            Open the console
          </Link>
        </div>
      </div>
    </section>
  );
}
