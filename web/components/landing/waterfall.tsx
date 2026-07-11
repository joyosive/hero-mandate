"use client";

// The authority waterfall: the mandate tree drawn as capacity bars on one
// shared horizontal scale. Every width is proportional to real wei values.
// On first reveal the parent fill shrinks by the carved amount and each
// child bar slides out directly beneath the segment it was carved from:
// delegation as physics, not policy. Breaches stamp the node they happened
// on; receipts tick along the bar that spent them.

import { useEffect, useState } from "react";
import { formatEther } from "ethers";
import {
  addressUrl,
  shortAddress,
  shortHash,
  txUrl,
  type ChainInfo,
  type ChainState,
  type MandateNode,
} from "@/lib/chain";
import { LiveDot, Pill } from "@/components/ui";
import { prefersReducedMotion, useReveal } from "./reveal";

const BREACH_SHORT: Record<number, string> = {
  1: "expired",
  2: "capacity",
  3: "scope",
};

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

function fmtEth(v: bigint): string {
  const s = formatEther(v);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

// Fraction as a plain number, safe for style percentages.
function frac(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  if (part <= 0n) return 0;
  return Number((part * 100000n) / whole) / 100000;
}

function Countdown({ expiry }: { expiry: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const left = expiry - now;
  if (left <= 0) return <span className="text-err">EXPIRED</span>;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="text-white">
      {d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}h ${pad(m)}m ${pad(s)}s`}
    </span>
  );
}

interface RowProps {
  node: MandateNode;
  left: number; // fraction of the shared scale, 0..1
  width: number; // fraction of the shared scale, 0..1
  depth: number;
  chain: ChainInfo;
  live: boolean;
  revealed: boolean;
  glow: boolean;
}

function NodeRows({
  node,
  left,
  width,
  depth,
  chain,
  live,
  revealed,
  glow,
}: RowProps) {
  const isRoot = node.parentId === 0;
  const carved = node.children.reduce((acc, c) => acc + c.capacity, 0n);

  // Fill = remaining capacity. Pre-reveal the parent still "holds" what it
  // later carves away, so the shrink animation is exactly the carved amount.
  const fillFinal = frac(node.remaining, node.capacity);
  const fillPre = Math.min(1, frac(node.remaining + carved, node.capacity));
  const fill = revealed ? fillFinal : fillPre;

  // The bar itself slides out for delegated nodes.
  const barWidth = isRoot || revealed ? width : 0;

  // Receipt ticks partition the spent region, measured from the right end.
  let cum = 0n;
  const ticks = node.receipts.map((r) => {
    cum += r.amount;
    return { receipt: r, pos: Math.max(0, 1 - frac(cum, node.capacity)) };
  });

  // Children stack immediately after the final fill edge, on the same scale.
  let cursor = node.remaining;
  const placedChildren = node.children.map((child) => {
    const childLeft = left + width * frac(cursor, node.capacity);
    const childWidth = width * frac(child.capacity, node.capacity);
    cursor += child.capacity;
    return { child, childLeft, childWidth };
  });

  const baseDelay = depth * 600;

  return (
    <div>
      {/* meta row: id, agent, capacity, expiry, model */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[11px] leading-tight">
        <span className={isRoot ? "font-bold text-acid" : "font-bold text-white"}>
          #{node.id} {isRoot ? "ROOT" : `CHILD OF #${node.parentId}`}
        </span>
        {live ? (
          <a
            className={`text-muted underline decoration-dim underline-offset-2 hover:text-white ${FOCUS}`}
            href={addressUrl(chain, node.agent)}
            target="_blank"
            rel="noreferrer"
          >
            {shortAddress(node.agent)}
          </a>
        ) : (
          <span className="text-muted">{shortAddress(node.agent)}</span>
        )}
        <span className="text-muted">
          <span className="text-acid">{fmtEth(node.remaining)}</span>
          {" / "}
          {fmtEth(node.capacity)} ETH
        </span>
        <span className="text-muted">
          expires <Countdown expiry={node.expiry} />
        </span>
        <span className="text-dim">model {shortHash(node.modelHash)}</span>
      </div>

      {/* bar row: absolute placement keeps every bar on one shared scale */}
      <div className="relative mt-1.5 h-10 sm:h-11">
        <div
          className="absolute inset-y-0 rounded-[4px] border border-line bg-panel2"
          style={{
            left: `${left * 100}%`,
            width: `${barWidth * 100}%`,
            transition: isRoot
              ? undefined
              : `width 700ms ${EASE} ${baseDelay + 200}ms`,
          }}
        >
          {/* remaining capacity, the only loud surface on the page */}
          <div
            className="absolute inset-y-0 left-0 rounded-[3px] bg-acid"
            style={{
              width: `${fill * 100}%`,
              transition: `width 900ms ${EASE} ${baseDelay}ms`,
            }}
          />

          {/* ghost of the carved segment: it did not vanish, it moved down */}
          {carved > 0n && (
            <div
              aria-hidden="true"
              className="absolute inset-y-0 rounded-[3px] border border-acid/35 bg-acid/10"
              style={{
                left: `${fillFinal * 100}%`,
                width: `${Math.max(0, fillPre - fillFinal) * 100}%`,
                opacity: revealed ? 1 : 0,
                transition: `opacity 500ms ease ${baseDelay + 500}ms`,
              }}
            />
          )}

          {/* one acid tick per executed receipt, at data-true positions */}
          {ticks.map(({ receipt, pos }, i) => {
            const label = `${receipt.instrumentLabel} · ${fmtEth(receipt.amount)} ETH`;
            const tooltip = (
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded border border-line bg-panel px-2 py-1 font-mono text-[10px] normal-case tracking-normal text-white group-hover:block group-focus-visible:block">
                {label}
                <span className="text-muted">
                  {live && receipt.txHash ? " · view tx" : " · sim"}
                </span>
              </span>
            );
            const tickProps = {
              className: `group absolute inset-y-0 w-[8px] ${FOCUS}`,
              style: { left: `calc(${pos * 100}% - 4px)` },
            };
            return live && receipt.txHash ? (
              <a
                key={i}
                {...tickProps}
                href={txUrl(chain, receipt.txHash)}
                target="_blank"
                rel="noreferrer"
                aria-label={`receipt ${label}, view transaction`}
              >
                <span className="mx-auto block h-full w-[2px] bg-acid" />
                {tooltip}
              </a>
            ) : (
              <span
                key={i}
                {...tickProps}
                tabIndex={0}
                aria-label={`receipt ${label}, sim`}
              >
                <span className="mx-auto block h-full w-[2px] bg-acid" />
                {tooltip}
              </span>
            );
          })}
        </div>
      </div>

      {/* breach stamps, pinned to this node, aligned to its bar's right end */}
      {node.breachEvents.length > 0 && (
        <div
          className="mt-2 flex flex-wrap justify-end gap-2"
          style={{ marginRight: `${Math.max(0, 1 - (left + width)) * 100}%` }}
        >
          {node.breachEvents.map((b, i) => (
            <span
              key={i}
              title={`${b.instrumentLabel} · ${fmtEth(b.amount)} ETH`}
              className="inline-flex items-center gap-2 rounded border border-err/50 bg-err/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-err"
              style={{
                opacity: revealed ? 1 : 0,
                boxShadow: glow
                  ? "0 0 16px rgba(255, 84, 112, 0.5)"
                  : "0 0 0 rgba(255, 84, 112, 0)",
                transition: `opacity 400ms ease ${baseDelay + 700}ms, box-shadow 700ms ease`,
              }}
            >
              REFUSED · code {b.code} {BREACH_SHORT[b.code] ?? ""}
              {live && b.txHash ? (
                <a
                  className={`underline decoration-err/50 underline-offset-2 hover:decoration-err ${FOCUS} focus-visible:outline-err`}
                  href={txUrl(chain, b.txHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  tx
                </a>
              ) : (
                <span className="normal-case text-cyan/80">sim</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* children: thin acid drop line, then the carved bar beneath */}
      {placedChildren.map(({ child, childLeft, childWidth }) => (
        <div key={child.id}>
          <div aria-hidden="true" className="relative h-8">
            <div
              className="absolute inset-y-0 w-px bg-acid/60"
              style={{
                left: `${childLeft * 100}%`,
                transform: revealed ? "scaleY(1)" : "scaleY(0)",
                transformOrigin: "top",
                transition: `transform 300ms ease-out ${baseDelay + 450}ms`,
              }}
            />
          </div>
          <NodeRows
            node={child}
            left={childLeft}
            width={childWidth}
            depth={depth + 1}
            chain={chain}
            live={live}
            revealed={revealed}
            glow={glow}
          />
        </div>
      ))}
    </div>
  );
}

function Diagram({ state }: { state: ChainState }) {
  const [ref, revealed] = useReveal<HTMLDivElement>(0.3);
  const [glow, setGlow] = useState(false);

  useEffect(() => {
    if (!revealed || prefersReducedMotion()) return;
    const on = setTimeout(() => setGlow(true), 1500);
    const off = setTimeout(() => setGlow(false), 2900);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [revealed]);

  const live = state.mode === "live";
  return (
    <div ref={ref} className="panel mt-5 p-4 sm:p-6 md:p-8">
      {state.roots.map((root, i) => (
        <div key={root.id} className={i > 0 ? "mt-10 border-t border-line2 pt-8" : ""}>
          <NodeRows
            node={root}
            left={0}
            width={1}
            depth={0}
            chain={state.chain}
            live={live}
            revealed={revealed}
            glow={glow}
          />
        </div>
      ))}
    </div>
  );
}

export default function Waterfall({ state }: { state: ChainState | null }) {
  const live = state?.mode === "live";
  return (
    <section className="mx-auto max-w-[1280px] border-t border-line2 px-4 py-12 md:px-6 md:py-16">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
          Authority waterfall
        </h2>
        {state && (
          <Pill tone={live ? "acid" : "cyan"}>
            <LiveDot sim={!live} />
            {live ? "live" : "sim"}
          </Pill>
        )}
        {state && (
          <span className="font-mono text-[11px] text-dim">
            {state.chain.label}
          </span>
        )}
        {state && live && state.contractAddress && (
          <a
            className={`font-mono text-[11px] text-muted underline decoration-dim underline-offset-2 hover:text-white ${FOCUS}`}
            href={addressUrl(state.chain, state.contractAddress)}
            target="_blank"
            rel="noreferrer"
          >
            contract {shortAddress(state.contractAddress)}
          </a>
        )}
      </div>

      {state ? (
        <Diagram key={state.chain.key + state.mode} state={state} />
      ) : (
        <div className="panel mt-5 p-4 sm:p-6 md:p-8" aria-busy="true">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            reading chain state
          </span>
          <div className="mt-4 h-10 animate-pulse rounded-[4px] bg-panel2 sm:h-11" />
          <div className="mt-10 ml-[70%] h-10 w-[30%] animate-pulse rounded-[4px] bg-panel2 sm:h-11" />
        </div>
      )}

      <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">
        delegation physically moves capacity. a child cannot exceed its
        parent. there is no rule to bypass.
      </p>
    </section>
  );
}
