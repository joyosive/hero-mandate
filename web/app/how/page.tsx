import type { Metadata } from "next";
import Link from "next/link";
import { Panel, Wordmark } from "@/components/ui";

export const metadata: Metadata = {
  title: "How it works: Hero Mandate",
  description:
    "The Chain of Mandate primitive: delegated authority that provably narrows at every level, enforced by construction.",
};

function Section({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Panel className="p-5 sm:p-6">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[0.68rem] text-acid">{index}</span>
        <h2 className="font-display text-lg font-bold tracking-tight text-white">
          {title}
        </h2>
      </div>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted">
        {children}
      </div>
    </Panel>
  );
}

export default function HowPage() {
  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-dim/30 py-4">
        <div className="flex flex-col">
          <Wordmark />
          <span className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-muted">
            Chain of Mandate
          </span>
        </div>
        <Link
          className="ml-auto font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted hover:text-acid"
          href="/"
        >
          Back to console
        </Link>
      </header>

      <main className="mt-6 space-y-5">
        <Section index="01" title="Authority is the missing object">
          <p>
            Agentic trading is going multi-agent: an orchestrator hires
            specialist sub-agents for momentum, hedging, yield. Today there is
            no way to delegate authority downward such that a sub-agent
            provably cannot exceed what its parent granted, the strategy stays
            private, and a breach is attributable to the exact level where it
            happened. Session keys grant plaintext authority upfront and
            verify nothing after the fact. Audit tools watch from outside.
            Neither makes authority itself an enforceable object.
          </p>
        </Section>

        <Section index="02" title="A mandate is an on-chain node">
          <p>
            A mandate is escrowed capacity plus a committed scope, an expiry,
            and a model fingerprint. Mandates form a tree: a treasury funds a
            root, the root agent delegates narrower mandates to sub-agents,
            and so on down.
          </p>
        </Section>

        <Section index="03" title="Narrowing by construction">
          <p>
            A child mandate is carved out of its parent&apos;s escrowed
            balance. Delegating 0.15 out of a 0.5 mandate leaves the parent
            0.35. A child cannot exceed its parent because the capacity
            physically moves: no comparison logic to get wrong, nothing to
            audit after the fact. Child expiry must sit inside the
            parent&apos;s. The allowed instruments are committed as a merkle
            root, so the strategy universe is never published. Every execution
            reveals exactly one leaf and proves it against the roots of the
            executing mandate and every ancestor up the chain.
          </p>
        </Section>

        <Section index="04" title="Record and refuse">
          <p>
            An in-authority agent attempting an out-of-authority action does
            not revert silently. The contract refuses the action and records a
            Breach event pinned to that exact mandate node: code 1 expired,
            code 2 over capacity, code 3 scope refused. The failure is
            attributable at the right level of the chain, and the parent chain
            stays untouched.
          </p>
        </Section>

        <Section index="05" title="Receipts, and the line we do not cross">
          <p>
            Every execution extends a per-mandate hash chain that folds in the
            instrument, the amount, and the model fingerprint behind the
            decision. One altered byte breaks the chain, and anyone can
            recompute it from public events: tamper evident, never tamper
            proof. The console&apos;s verify button does exactly that, client
            side. And the line: no order execution, no custody of trading
            assets, no routing. The escrow is authority capacity, not payment
            rails. Hero proves agent behaviour, venues execute trades.
          </p>
        </Section>
      </main>

      <footer className="mt-10 border-t border-dim/30 pt-4">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-dim">
          Testnet only. No token. No admin keys.
        </p>
      </footer>
    </div>
  );
}
