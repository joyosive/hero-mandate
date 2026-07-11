"use client";

// Chain of Mandate console. Reads mandates, receipts and breaches through
// the shared data layer (lib/chain.ts) and renders them as a dense,
// tabular, trading-infrastructure surface: mandate tree left, receipts
// feed right, client-side receipt-chain verification in a terminal drawer.
// Chain selection comes from the URL (?chain=) via the shell's useChain().

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { CHAINS as SITE_CHAINS, CONTRACT, useChain } from "@/components/shell";
import {
  CHAINS,
  loadChainState,
  shortAddress,
  type ChainState,
  type MandateNode,
} from "@/lib/chain";
import {
  DATA_CHAIN_KEY,
  buildActivity,
  fetchBreachTimestamps,
  flattenNodes,
} from "@/lib/agents";
import { ActivityTable } from "@/components/console/activity";
import { CopyText } from "@/components/console/copy";
import { fmtEth, relTime } from "@/components/console/format";
import { useNow } from "@/components/console/hooks";
import {
  BlockTick,
  MotionStyles,
  fetchBlockNumber,
  useChainDiff,
} from "@/components/console/motion";
import { MandateTree } from "@/components/console/tree";
import { Stat } from "@/components/console/stat";
import { VerifyDrawer } from "@/components/console/verify";

function LoadingPanel({ text }: { text: string }) {
  return (
    <div className="panel px-4 py-12 text-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
        {text}
      </span>
    </div>
  );
}

function ConsoleInner() {
  const siteKey = useChain();
  const dataKey = DATA_CHAIN_KEY[siteKey];
  const chain = CHAINS[dataKey];

  const [state, setState] = useState<ChainState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [breachTs, setBreachTs] = useState<Map<string, number>>(new Map());
  const [block, setBlock] = useState<number | null>(null);
  const [verifyNode, setVerifyNode] = useState<MandateNode | null>(null);
  const keyRef = useRef(dataKey);
  keyRef.current = dataKey;

  const applyState = useCallback(
    async (next: ChainState, forKey: string) => {
      if (keyRef.current !== forKey) return;
      setState(next);
      // Block heartbeat: piggybacks on this apply, no extra polling loop.
      if (next.mode === "live") {
        fetchBlockNumber(next.chain).then((b) => {
          if (b !== null && keyRef.current === forKey) setBlock(b);
        });
      }
      const ts = await fetchBreachTimestamps(next);
      if (keyRef.current === forKey) setBreachTs(ts);
    },
    []
  );

  // Initial load, and reload on chain switch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setState(null);
    setBreachTs(new Map());
    setBlock(null);
    setVerifyNode(null);
    loadChainState(dataKey).then(async (s) => {
      if (cancelled) return;
      setLoading(false);
      await applyState(s, dataKey);
    });
    return () => {
      cancelled = true;
    };
  }, [dataKey, applyState]);

  // Light polling, live mode only. SIM data is static by design.
  useEffect(() => {
    if (state?.mode !== "live") return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const next = await loadChainState(dataKey);
      // Ignore a transient fallback: keep the last good live view.
      if (next.mode === "live") await applyState(next, dataKey);
    }, 15000);
    return () => clearInterval(t);
  }, [state?.mode, dataKey, applyState]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const key = dataKey;
    try {
      const next = await loadChainState(key);
      await applyState(next, key);
    } finally {
      setRefreshing(false);
    }
  }, [dataKey, applyState]);

  const now = useNow(1000);
  const live = state?.mode === "live";
  const contractAddress = state?.contractAddress ?? CONTRACT;
  // Poll-to-poll diff: new event rows, capacity drains, acting nodes.
  // First load and chain switches only set a baseline (no animation).
  const diff = useChainDiff(state, dataKey);

  const flat = useMemo(
    () => (state ? flattenNodes(state.roots) : []),
    [state]
  );
  const activity = useMemo(
    () => (state ? buildActivity(state.roots, breachTs) : []),
    [state, breachTs]
  );
  const totals = useMemo(() => {
    let receipts = 0;
    let breaches = 0;
    let unspent = 0n;
    for (const n of flat) {
      receipts += n.receipts.length;
      breaches += n.breaches;
      unspent += n.remaining;
    }
    return { receipts, breaches, unspent };
  }, [flat]);

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 md:px-6">
      <MotionStyles />
      {/* header row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-white sm:text-[30px]">
          Console
        </h1>
        {!loading && state && (
          <span className={`pill ${live ? "pill-acid" : "pill-cyan"}`}>
            <span
              className={`live-dot ${live ? "" : "live-dot-sim"}`}
              aria-hidden="true"
            />
            {live ? "live" : "sim"}
          </span>
        )}
        {live && block !== null && <BlockTick block={block} />}
        <span className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-[9.5px] uppercase tracking-[0.16em] text-dim">
            contract
          </span>
          <CopyText
            value={contractAddress}
            display={shortAddress(contractAddress)}
            title={`contract ${contractAddress}`}
            className="text-[11px] text-white"
          />
          <a
            href={`${SITE_CHAINS[siteKey].explorer}/address/${contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] uppercase tracking-[0.1em] text-muted underline decoration-dim underline-offset-2 transition-colors hover:text-acid hover:decoration-acid focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid"
          >
            explorer
          </a>
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Link
            href={`/settlement?chain=${siteKey}`}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted underline decoration-dim underline-offset-2 transition-colors hover:text-acid hover:decoration-acid focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid"
          >
            Settlement
          </Link>
          <Link
            href={`/stage?chain=${siteKey}`}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted underline decoration-dim underline-offset-2 transition-colors hover:text-acid hover:decoration-acid focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid"
          >
            Stage
          </Link>
          {state && (
            <span className="font-mono text-[10px] tabular-nums text-muted">
              refreshed {relTime(Math.floor(state.fetchedAt / 1000), now)}
            </span>
          )}
          <button
            type="button"
            className="btn focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid"
            onClick={refresh}
            disabled={refreshing || loading}
          >
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      <p className="mt-2 font-mono text-[10.5px] text-muted">
        {chain.label} · chain {chain.id} ·{" "}
        {loading
          ? "reading chain state"
          : live
            ? "reading events over public RPC"
            : "RPC unreachable or no deployment; deterministic demo fixture shown"}
      </p>

      {/* summary strip */}
      {!loading && state && (
        <div className="panel mt-5 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="mandates" value={String(flat.length)} />
          <Stat label="receipts" value={String(totals.receipts)} />
          <Stat
            label="breaches"
            value={String(totals.breaches)}
            tone={totals.breaches > 0 ? "err" : "white"}
          />
          <Stat
            label="unspent escrow"
            value={`${fmtEth(totals.unspent)} ETH`}
            tone="acid"
          />
        </div>
      )}

      {/* tree + receipts */}
      <div className="mt-5 grid items-start gap-4 lg:grid-cols-3">
        <section className="lg:col-span-1">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white">
              Mandate tree
            </h2>
            <span className="font-mono text-[10px] tabular-nums text-dim">
              {flat.length} node{flat.length === 1 ? "" : "s"}
            </span>
          </div>
          {loading || !state ? (
            <LoadingPanel text="Reading chain state" />
          ) : state.roots.length === 0 ? (
            <p className="panel px-4 py-12 text-center font-mono text-[11px] text-muted">
              No activity on this chain yet. Run the demo scenario to
              populate.
            </p>
          ) : (
            <MandateTree
              roots={state.roots}
              chain={chain}
              live={live}
              onVerify={setVerifyNode}
              drains={diff.drains}
              pings={diff.pings}
              epoch={diff.epoch}
            />
          )}
        </section>

        <div className="lg:col-span-2">
          {loading || !state ? (
            <LoadingPanel text="Reading chain state" />
          ) : (
            <ActivityTable
              rows={activity}
              chain={chain}
              live={live}
              newKeys={diff.newRowKeys}
            />
          )}
        </div>
      </div>

      <footer className="mt-8 border-t border-line2 pt-4">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
          Breach codes: 1 expired, 2 over capacity, 3 scope refused. Testnet
          only. No token. No custody of trading assets.
        </p>
      </footer>

      {verifyNode && (
        <VerifyDrawer node={verifyNode} onClose={() => setVerifyNode(null)} />
      )}
    </main>
  );
}

export default function Console() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 md:px-6">
          <LoadingPanel text="Reading chain state" />
        </main>
      }
    >
      <ConsoleInner />
    </Suspense>
  );
}
