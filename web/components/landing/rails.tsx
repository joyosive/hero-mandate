// One primitive, four rails: where the same mandate object touches each
// part of the stack. One sentence and one proof link per card; the Fhenix
// card is roadmap and is labeled as such.

import { CHAINS, CONTRACT } from "@/components/shell";

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid";

const RAILS = [
  {
    name: "Arbitrum",
    body: "The engine. The mandate contract is Rust compiled to WASM on Stylus, deployed from one binary.",
    href: `${CHAINS.sepolia.explorer}/address/${CONTRACT}`,
    link: "contract on Arbiscan",
    roadmap: false,
  },
  {
    name: "Robinhood Chain",
    body: "The market. Millions of people just got AI agents that trade. Hero is the missing safety and audit layer, live on their chain.",
    href: `${CHAINS.robinhood.explorer}/address/${CONTRACT}`,
    link: "contract on Robinhood explorer",
    roadmap: false,
  },
  {
    name: "Fhenix",
    body: "The seal. Scope stays private today through merkle commitments. Numeric limits go fully encrypted with CoFHE as the coprocessor lands.",
    href: "https://blog.arbitrum.io/fhenix-private-computation/",
    link: "fhenix on the arbitrum blog",
    roadmap: true,
  },
  {
    name: "MPP + Permit2",
    body: "The payments rail. Our guard emits @arbitrum/mpp permit2 credentials that cannot exist unless the mandate allowed the spend.",
    href: "https://github.com/OffchainLabs/arbitrum-mpp",
    link: "OffchainLabs/arbitrum-mpp",
    roadmap: false,
  },
] as const;

export default function Rails() {
  return (
    <section className="mx-auto max-w-[1280px] border-t border-line2 px-4 py-12 md:px-6 md:py-16">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
        One primitive, four rails
      </h2>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {RAILS.map((rail) => (
          <div key={rail.name} className="panel flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-acid">
                {rail.name}
              </h3>
              {rail.roadmap && <span className="pill">roadmap</span>}
            </div>
            <p className="flex-1 text-sm leading-relaxed text-muted">
              {rail.body}
            </p>
            <a
              className={`font-mono text-[11px] text-white underline decoration-dim underline-offset-4 hover:decoration-acid ${FOCUS}`}
              href={rail.href}
              target="_blank"
              rel="noreferrer"
            >
              {rail.link}
            </a>
          </div>
        ))}
      </div>

      <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">
        One primitive underneath: the engine that verifies a robot&apos;s
        actions verifies an agent&apos;s trades.
      </p>
    </section>
  );
}
