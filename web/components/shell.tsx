"use client";

// App shell: one sticky header, one footer, chain selection carried in the
// URL (?chain=robinhood|sepolia) so every page shares it statelessly.
// Pages render inside; the shell owns navigation and chain context only.

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export const CHAINS = {
  robinhood: { key: "robinhood", chainId: "46630", label: "Robinhood Chain", explorer: "https://explorer.testnet.chain.robinhood.com" },
  sepolia: { key: "sepolia", chainId: "421614", label: "Arbitrum Sepolia", explorer: "https://sepolia.arbiscan.io" },
} as const;

export type ChainKey = keyof typeof CHAINS;

export const CONTRACT = "0x0dfca3eabfde4e4714057a326058611e040dcdd9";
export const REPO_URL = "https://github.com/joyosive/hero-mandate";

export function useChain(): ChainKey {
  const params = useSearchParams();
  const c = params.get("chain");
  return c === "sepolia" ? "sepolia" : "robinhood";
}

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/console", label: "Console" },
  { href: "/settlement", label: "Settlement" },
  { href: "/agents", label: "Agents" },
  { href: "/how", label: "How it works" },
] as const;

function HeaderInner() {
  const pathname = usePathname();
  const chain = useChain();
  const query = `?chain=${chain}`;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-[rgba(10,11,9,0.92)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between gap-3 px-4 md:px-6">
        <Link href={`/${query}`} className="flex shrink-0 items-baseline gap-2 no-underline hover:no-underline">
          <span className="font-disp text-[17px] font-bold tracking-[0.5px] text-white">HER<span className="text-acid">Ō</span></span>
          <span className="font-mono text-[10px] uppercase tracking-[2.5px] text-muted">Mandate</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={`${item.href}${query}`}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-[1.2px] no-underline transition-colors hover:no-underline ${
                  active ? "bg-panel text-acid" : "text-muted hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <a
            href="/log.html"
            className="rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-[1.2px] text-muted no-underline transition-colors hover:text-white hover:no-underline"
          >
            Log
          </a>
        </nav>

        <div className="flex items-center gap-2">
          {/* chain segmented control */}
          <div className="flex rounded-lg border border-line p-[3px]" role="group" aria-label="Chain">
            {(Object.keys(CHAINS) as ChainKey[]).map((key) => (
              <Link
                key={key}
                href={`${pathname}?chain=${key}`}
                aria-current={chain === key ? "true" : undefined}
                className={`rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-[1px] no-underline transition-colors hover:no-underline ${
                  chain === key ? "bg-acid font-semibold text-[#0A0B09]" : "text-muted hover:text-white"
                }`}
              >
                {key === "robinhood" ? "Robinhood" : "Sepolia"}
              </Link>
            ))}
          </div>
          <a
            href={`${CHAINS[chain].explorer}/address/${CONTRACT}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-2 rounded-lg border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[1px] text-acid no-underline transition-colors hover:border-acid hover:no-underline lg:flex"
          >
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-acid" /> Live contract
          </a>
        </div>
      </div>

      {/* mobile nav row */}
      <nav className="flex gap-1 overflow-x-auto border-t border-line2 px-4 py-2 md:hidden">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={`${item.href}${query}`}
              className={`whitespace-nowrap rounded-md px-3 py-1 font-mono text-[10.5px] uppercase tracking-[1px] no-underline ${
                active ? "bg-panel text-acid" : "text-muted"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        <a href="/log.html" className="whitespace-nowrap rounded-md px-3 py-1 font-mono text-[10.5px] uppercase tracking-[1px] text-muted no-underline">
          Log
        </a>
      </nav>
    </header>
  );
}

export function Header() {
  return (
    <Suspense fallback={<header className="h-14 border-b border-line" />}>
      <HeaderInner />
    </Suspense>
  );
}

export function Footer() {
  return (
    <footer className="mt-20 border-t border-line">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-8 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="font-mono text-[11px] uppercase tracking-[1.5px] text-dim">
          Hero · proof of action for trading agents
        </div>
        <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-muted">
          <a href={`${CHAINS.robinhood.explorer}/address/${CONTRACT}`} target="_blank" rel="noopener noreferrer">Robinhood Chain</a>
          <a href={`${CHAINS.sepolia.explorer}/address/${CONTRACT}`} target="_blank" rel="noopener noreferrer">Arbitrum Sepolia</a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="/log.html" className="text-dim hover:text-acid">Log an action</a>
          <span className="text-dim">testnet · no token · tamper evident</span>
        </div>
      </div>
    </footer>
  );
}
