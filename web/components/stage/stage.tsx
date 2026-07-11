"use client";

// Projector stage view. Same data layer and honesty rules as the console
// (LIVE only when the chain answers, SIM pill otherwise), but sized for a
// room: huge capacity bars center stage, a takeover event banner in the
// bottom band, a live-verified receipt chain line at the very bottom.
// Polls every 5 seconds (demo cadence; the public console keeps 15s).
// In SIM mode the fixture events run once through the banner on load so
// the page demos itself, clearly SIM-labeled.

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CONTRACT, useChain } from "@/components/shell";
import {
  CHAINS,
  loadChainState,
  shortAddress,
  verifyReceiptChain,
  type ChainState,
} from "@/lib/chain";
import { DATA_CHAIN_KEY, buildActivity, flattenNodes } from "@/lib/agents";
import { usePrefersReducedMotion } from "@/components/console/hooks";
import {
  BlockTick,
  MotionStyles,
  activityKeys,
  fetchBlockNumber,
  useChainDiff,
} from "@/components/console/motion";
import { StageBars } from "./bars";
import { StageBanner, toStageEvent, type StageEvent } from "./banner";

const TAKEOVER_MS = 4000;

function StageInner() {
  const siteKey = useChain();
  const dataKey = DATA_CHAIN_KEY[siteKey];
  const chain = CHAINS[dataKey];
  const reduced = usePrefersReducedMotion();

  const [state, setState] = useState<ChainState | null>(null);
  const [loading, setLoading] = useState(true);
  const [block, setBlock] = useState<number | null>(null);
  const [queue, setQueue] = useState<StageEvent[]>([]);
  const [active, setActive] = useState<StageEvent | null>(null);
  const keyRef = useRef(dataKey);
  keyRef.current = dataKey;

  const applyState = useCallback((next: ChainState, forKey: string) => {
    if (keyRef.current !== forKey) return;
    setState(next);
    if (next.mode === "live") {
      // Block heartbeat rides the same poll; no extra loop.
      fetchBlockNumber(next.chain).then((b) => {
        if (b !== null && keyRef.current === forKey) setBlock(b);
      });
    }
  }, []);

  // Initial load, and reload on chain switch. Banner state resets too, so
  // a switch can never replay the previous chain's events.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setState(null);
    setBlock(null);
    setQueue([]);
    setActive(null);
    loadChainState(dataKey).then((s) => {
      if (cancelled) return;
      setLoading(false);
      applyState(s, dataKey);
    });
    return () => {
      cancelled = true;
    };
  }, [dataKey, applyState]);

  // Stage cadence: 5s poll, live mode only. SIM data is static by design.
  useEffect(() => {
    if (state?.mode !== "live") return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const key = keyRef.current;
      const next = await loadChainState(key);
      // Ignore a transient fallback: keep the last good live view.
      if (next.mode === "live") applyState(next, key);
    }, 5000);
    return () => clearInterval(t);
  }, [state?.mode, applyState]);

  const diff = useChainDiff(state, dataKey);

  // Enqueue genuinely new events for the takeover banner, once per epoch.
  const enqueuedEpoch = useRef(0);
  useEffect(() => {
    if (diff.epoch === enqueuedEpoch.current) return;
    enqueuedEpoch.current = diff.epoch;
    if (diff.newRows.length === 0) return;
    setQueue((q) => [
      ...q,
      ...diff.newRows.map(({ key, row }) => toStageEvent(row, key)),
    ]);
  }, [diff]);

  // SIM self-demo: replay the fixture events through the banner once per
  // chain per mount. Skipped under reduced motion (static ticker instead).
  const replayed = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!state || state.mode !== "sim" || reduced) return;
    if (replayed.current.has(dataKey)) return;
    replayed.current.add(dataKey);
    const rows = buildActivity(state.roots);
    const keys = activityKeys(rows);
    const events = rows.map((r, i) => toStageEvent(r, keys[i]));
    events.reverse(); // buildActivity is newest first; replay oldest first
    setQueue((q) => [...q, ...events]);
  }, [state, dataKey, reduced]);

  // Banner queue: each event holds the band for 4s, then the next.
  useEffect(() => {
    if (active !== null || queue.length === 0) return;
    setActive(queue[0]);
    setQueue((q) => q.slice(1));
  }, [active, queue]);
  useEffect(() => {
    if (active === null) return;
    const t = window.setTimeout(() => setActive(null), TAKEOVER_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  const live = state?.mode === "live";
  const contractAddress = state?.contractAddress ?? CONTRACT;

  // Ticker tape: last 10 events, newest first, straight from chain state.
  const ticker = useMemo(() => {
    if (!state) return [];
    const rows = buildActivity(state.roots);
    const keys = activityKeys(rows);
    return rows.slice(0, 10).map((r, i) => toStageEvent(r, keys[i]));
  }, [state]);

  // Verify line: recompute every node's receipt chain client-side after
  // each poll. Same math as lib/chain.ts verifyReceiptChain.
  const verify = useMemo(() => {
    if (!state) return null;
    let receipts = 0;
    let ok = true;
    for (const n of flattenNodes(state.roots)) {
      receipts += n.receipts.length;
      if (!verifyReceiptChain(n).ok) ok = false;
    }
    return { ok, receipts };
  }, [state]);

  return (
    <main className="flex min-h-[calc(100dvh-6rem)] flex-col px-4 pb-3 pt-4 md:h-[calc(100dvh-3.5rem)] md:px-8">
      <MotionStyles />

      {/* top strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line2 pb-3 font-mono">
        <span className="text-[clamp(12px,1.2vw,15px)] font-semibold tracking-[0.3em] text-white">
          HERO MANDATE
        </span>
        <span className="text-[clamp(10px,1vw,13px)] uppercase tracking-[0.16em] text-muted">
          {chain.label}
        </span>
        {!loading && state && (
          <span className={`pill ${live ? "pill-acid" : "pill-cyan"}`}>
            <span
              className={`live-dot ${live ? "" : "live-dot-sim"}`}
              aria-hidden="true"
            />
            {live ? "live" : "sim"}
          </span>
        )}
        {live && block !== null && (
          <BlockTick
            block={block}
            className="font-mono text-[clamp(10px,1vw,13px)] tabular-nums text-dim"
          />
        )}
        <a
          href={`${chain.explorer}/address/${contractAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          title={`contract ${contractAddress}`}
          className="ml-auto text-[clamp(10px,1vw,13px)] text-muted underline decoration-dim underline-offset-2 transition-colors hover:text-acid hover:decoration-acid focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid"
        >
          {shortAddress(contractAddress)}
        </a>
      </div>

      {/* center: huge capacity bars */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-[1.6vh]">
        {loading || !state ? (
          <p className="my-auto text-center font-mono text-[clamp(12px,1.4vw,18px)] uppercase tracking-[0.2em] text-muted">
            reading chain state
          </p>
        ) : (
          <StageBars
            roots={state.roots}
            drains={diff.drains}
            epoch={diff.epoch}
          />
        )}
      </div>

      {/* bottom band: event banner / ticker tape */}
      <StageBanner
        active={active}
        ticker={ticker}
        live={live}
        reduced={reduced}
      />

      {/* verify line */}
      <footer className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line2 pt-2">
        {verify ? (
          <span
            className={`font-mono text-[clamp(11px,1.2vw,15px)] font-semibold uppercase tracking-[0.12em] ${
              verify.ok ? "text-acid" : "text-err"
            }`}
          >
            chain {verify.ok ? "VERIFIED" : "BROKEN"} ({verify.receipts}{" "}
            receipt{verify.receipts === 1 ? "" : "s"})
          </span>
        ) : (
          <span className="font-mono text-[clamp(11px,1.2vw,15px)] uppercase tracking-[0.12em] text-dim">
            chain verification pending
          </span>
        )}
        <span className="font-mono text-[clamp(9px,0.9vw,12px)] uppercase tracking-[0.14em] text-dim">
          receipt hash chain recomputed client side after every poll
        </span>
      </footer>
    </main>
  );
}

export default function StageView() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[calc(100dvh-6rem)] items-center justify-center md:h-[calc(100dvh-3.5rem)]">
          <p className="font-mono text-[clamp(12px,1.4vw,18px)] uppercase tracking-[0.2em] text-muted">
            reading chain state
          </p>
        </main>
      }
    >
      <StageInner />
    </Suspense>
  );
}
