"use client";

// Live ops strip: five tiles, mono numerals. The first four are computed
// from chain events via lib/stats.ts; the fifth is a measured figure and
// says so. Count-up runs once on first reveal, skipped under reduced motion.

import { useEffect, useRef, useState } from "react";
import { formatEther } from "ethers";
import type { OpsStats } from "@/lib/stats";
import { LiveDot, Pill } from "@/components/ui";
import { prefersReducedMotion, useReveal } from "./reveal";

function useCountUp(target: number, run: boolean): number {
  const [value, setValue] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (!run || started.current) return;
    started.current = true;
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    const t0 = performance.now();
    const duration = 900;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setValue(target * eased);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [run, target]);
  return value;
}

function Tile({
  label,
  target,
  decimals,
  run,
}: {
  label: string;
  target: number;
  decimals: number;
  run: boolean;
}) {
  const value = useCountUp(target, run);
  return (
    <div className="panel p-4 md:p-5">
      <div className="font-mono text-[28px] leading-none text-white md:text-[34px]">
        {value.toFixed(decimals)}
      </div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
        {label}
      </div>
    </div>
  );
}

export default function OpsStrip({
  stats,
  live,
  chainLabel,
}: {
  stats: OpsStats | null;
  live: boolean;
  chainLabel: string | null;
}) {
  const [ref, revealed] = useReveal<HTMLDivElement>(0.3);
  return (
    <section className="mx-auto max-w-[1280px] border-t border-line2 px-4 py-12 md:px-6 md:py-16">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
          Live ops
        </h2>
        {stats && (
          <Pill tone={live ? "acid" : "cyan"}>
            <LiveDot sim={!live} />
            {live ? "live" : "sim"}
          </Pill>
        )}
        {chainLabel && (
          <span className="font-mono text-[11px] text-dim">{chainLabel}</span>
        )}
      </div>

      <div
        ref={ref}
        className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        {stats ? (
          <>
            <Tile
              label="Mandates created"
              target={stats.mandates}
              decimals={0}
              run={revealed}
            />
            <Tile
              label="Receipts written"
              target={stats.receipts}
              decimals={0}
              run={revealed}
            />
            <Tile
              label="Breaches recorded"
              target={stats.breaches}
              decimals={0}
              run={revealed}
            />
            <Tile
              label="Capacity escrowed · ETH"
              target={Number(formatEther(stats.escrowedWei))}
              decimals={2}
              run={revealed}
            />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="panel h-[92px] animate-pulse md:h-[104px]" />
          ))
        )}
        <div className="panel p-4 md:p-5">
          <div className="font-mono text-[28px] leading-none text-white md:text-[34px]">
            &lt;$0.01
          </div>
          <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            Cost per receipt
          </div>
          <div className="mt-1 font-mono text-[10px] text-dim">
            measured · orbit testnet gas
          </div>
        </div>
      </div>
    </section>
  );
}
