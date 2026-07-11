// How it works: the five-step rail expanded, with the exact receipt hash
// formula and the record-and-refuse behaviour. The site header comes from
// the layout; this page renders content only.

import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/ui";

export const metadata: Metadata = {
  title: "How it works: Hero Mandate",
  description:
    "The Chain of Mandate primitive: delegated authority that provably narrows at every level, enforced by construction.",
};

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid";

function Step({
  n,
  name,
  title,
  children,
}: {
  n: string;
  name: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Panel className="p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-acid">
          {n} · {name}
        </span>
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

function Connector() {
  return <div aria-hidden="true" className="ml-6 h-5 w-px bg-acid/25" />;
}

export default function HowPage() {
  return (
    <div className="mx-auto min-h-dvh max-w-[880px] px-4 pb-20 pt-10 sm:px-6 md:pt-14">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-acid">
          Protocol mechanics
        </p>
        <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-white md:text-4xl">
          Authority that narrows by construction.
        </h1>
        <p className="mt-4 max-w-[640px] text-[15px] leading-relaxed text-muted">
          Agentic trading is going multi-agent: an orchestrator hires
          specialist sub-agents for momentum, hedging, yield. Today there is
          no way to delegate authority downward such that a sub-agent
          provably cannot exceed what its parent granted, the strategy stays
          private, and a breach is attributable to the exact level where it
          happened. Session keys grant plaintext authority upfront and verify
          nothing after the fact. Audit tools watch from outside. Neither
          makes authority itself an enforceable object. Hero Mandate does.
        </p>
      </header>

      <main className="mt-8">
        <Step n="01" name="Mandate" title="Escrowed authority as a node">
          <p>
            A mandate is escrowed capacity plus a committed scope, an expiry,
            and a model fingerprint. Mandates form a tree: a treasury funds a
            root with real escrowed value, the root agent delegates narrower
            mandates to sub-agents, and so on down. The funder is recorded,
            and after expiry the remaining capacity returns to it.
          </p>
          <p>
            A child mandate is carved out of its parent&apos;s escrowed
            balance. Delegating 0.15 out of a 0.5 mandate leaves the parent
            0.35. A child cannot exceed its parent because the capacity
            physically moves: no comparison logic to get wrong, nothing to
            audit after the fact. Child expiry must sit inside the
            parent&apos;s, checked at delegation. The allowed instruments are
            committed as a merkle root, so the strategy universe is never
            published.
          </p>
        </Step>
        <Connector />

        <Step n="02" name="Trade" title="Every check, every ancestor">
          <p>
            The agent calls execute with an instrument, an amount, and merkle
            proofs. The contract checks expiry, remaining capacity, and the
            proof of that one instrument against the executing mandate&apos;s
            scope root and every ancestor&apos;s root up the chain. Exactly
            one leaf is revealed per trade; a child can only use scope its
            whole lineage allows, without any ancestor revealing its set.
          </p>
          <div className="rounded-md border border-err/40 bg-err/5 p-3.5">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-err">
              Record and refuse
            </h3>
            <p className="mt-2">
              An in-authority agent attempting an out-of-authority action
              does not revert silently. The contract refuses the action and
              records a Breach event pinned to that exact mandate node, so
              the failure is attributable at the right level of the chain
              while the parent chain stays untouched.
            </p>
            <div className="mt-3 space-y-1 font-mono text-[11px]">
              <div>
                <span className="text-err">code 1 · EXPIRED</span>
                <span className="text-muted"> past the mandate&apos;s expiry</span>
              </div>
              <div>
                <span className="text-err">code 2 · OVER CAPACITY</span>
                <span className="text-muted"> amount exceeds remaining escrow</span>
              </div>
              <div>
                <span className="text-err">code 3 · SCOPE REFUSED</span>
                <span className="text-muted"> instrument fails a proof somewhere in the lineage</span>
              </div>
            </div>
          </div>
        </Step>
        <Connector />

        <Step n="03" name="Receipt" title="A hash chain per mandate">
          <p>
            Every successful execution extends a per-mandate hash chain that
            folds in the instrument, the amount, and the model fingerprint
            behind the decision. Decision bound to deed, exactly:
          </p>
          <div className="overflow-x-auto rounded-md border border-line bg-panel2 p-3.5 font-mono text-[12px] leading-relaxed text-white">
            <div>
              newHead = keccak256(abi.encodePacked(
            </div>
            <div className="pl-5">
              prevHead,<span className="text-dim">    // bytes32, zero for the first receipt</span>
            </div>
            <div className="pl-5">
              instrument,<span className="text-dim">  // bytes32</span>
            </div>
            <div className="pl-5">
              amount,<span className="text-dim">      // uint256</span>
            </div>
            <div className="pl-5">
              modelHash,<span className="text-dim">   // bytes32</span>
            </div>
            <div className="pl-5">
              timestamp<span className="text-dim">    // uint64</span>
            </div>
            <div>))</div>
          </div>
          <p>
            One altered byte anywhere in the history produces a different
            head. The chain does not prevent tampering with a database
            somewhere else; it makes tampering visible. Tamper evident,
            never tamper proof.
          </p>
        </Step>
        <Connector />

        <Step n="04" name="Anchor" title="Extending the existing proof line">
          <p>
            Receipt heads and scope roots can additionally anchor into the
            already-deployed and verified HeroAnchor contract on Arbitrum
            Sepolia, extending the existing Hero proof-of-action deployment
            rather than replacing it. The same WASM binary runs on Robinhood
            Chain testnet and Arbitrum Sepolia.
          </p>
        </Step>
        <Connector />

        <Step n="05" name="Verify" title="Anyone can recompute">
          <p>
            All inputs to the receipt chain are public events. Anyone can
            replay them, recompute the head, and compare it against the value
            the contract stores. The console&apos;s verify button does exactly
            that, client side, in your browser.
          </p>
          <p>
            And the line we do not cross: no order execution, no custody of
            trading assets, no routing, no touching tokenized securities. The
            escrow is authority capacity, not payment rails. Hero proves
            agent behaviour; venues execute trades. That line keeps the
            protocol out of the securities blast radius and is exactly why it
            is useful to regulated platforms.
          </p>
        </Step>
      </main>

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line2 pt-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-dim">
          Testnet only. No token. No admin keys.
        </p>
        <Link
          className={`font-mono text-[11px] uppercase tracking-[0.14em] text-muted underline decoration-dim underline-offset-4 hover:text-white ${FOCUS}`}
          href="/console"
        >
          Open the console
        </Link>
      </footer>
    </div>
  );
}
