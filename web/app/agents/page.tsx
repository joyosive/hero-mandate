"use client";

// Agent track records: the verifiable resume. One card per distinct agent
// address, every number recomputed from public chain events through the
// same data layer as the console. Chain selection via the shell's
// useChain() (?chain= in the URL); SIM pill whenever fixture data shows.

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChain } from "@/components/shell";
import {
  CHAINS,
  addressUrl,
  loadChainState,
  shortAddress,
  shortHash,
  type ChainState,
} from "@/lib/chain";
import {
  DATA_CHAIN_KEY,
  buildAgentRecords,
  type AgentRecord,
} from "@/lib/agents";
import { CopyText } from "@/components/console/copy";
import { fmtEth, relTime } from "@/components/console/format";
import { useNow } from "@/components/console/hooks";
import { Stat } from "@/components/console/stat";

function AgentCard({
  rec,
  live,
  chainKey,
  now,
}: {
  rec: AgentRecord;
  live: boolean;
  chainKey: keyof typeof CHAINS;
  now: number;
}) {
  const chain = CHAINS[chainKey];
  const active = rec.maxExpiry > now;
  const adherence =
    rec.adherencePct === null ? "--" : `${rec.adherencePct.toFixed(1)}%`;

  return (
    <article className="panel p-4 transition-colors duration-150 hover:border-acid/60 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <CopyText
          value={rec.address}
          display={shortAddress(rec.address)}
          title={`agent ${rec.address}`}
          className="text-[13px] font-semibold text-white"
        />
        <span className={`pill ${active ? "pill-acid" : ""}`}>
          {active ? "active" : "expired"}
        </span>
        {rec.breaches > 0 && (
          <span className="pill pill-err">
            {rec.breaches} breach{rec.breaches === 1 ? "" : "es"}
          </span>
        )}
        {live && (
          <a
            href={addressUrl(chain, rec.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto font-mono text-[10px] uppercase tracking-[0.1em] text-muted underline decoration-dim underline-offset-2 transition-colors hover:text-acid hover:decoration-acid focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid"
          >
            explorer
          </a>
        )}
      </div>

      <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
        {rec.roles.join(" · ")}
      </p>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
          model fingerprint
        </span>
        {rec.modelHashes.map((h) => (
          <CopyText
            key={h}
            value={h}
            display={shortHash(h)}
            title={`model hash ${h}`}
            className="text-[11px] text-white"
          />
        ))}
        <span className="font-mono text-[9.5px] text-dim">
          bound to every receipt
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line2 pt-3 sm:grid-cols-4">
        <Stat label="receipts" value={String(rec.receipts)} />
        <Stat
          label="breaches"
          value={String(rec.breaches)}
          tone={rec.breaches > 0 ? "err" : "white"}
        />
        <Stat
          label="scope adherence"
          value={adherence}
          tone={rec.adherencePct === 100 ? "acid" : "white"}
        />
        <Stat
          label="capacity eth"
          value={`${fmtEth(rec.consumed)} / ${fmtEth(rec.granted)}`}
          note="consumed / granted"
        />
      </div>

      <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.12em] text-dim">
        mandate nodes: {rec.nodeIds.map((id) => `#${id}`).join(" ")}
      </p>
    </article>
  );
}

function AgentsInner() {
  const siteKey = useChain();
  const dataKey = DATA_CHAIN_KEY[siteKey];
  const chain = CHAINS[dataKey];

  const [state, setState] = useState<ChainState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const keyRef = useRef(dataKey);
  keyRef.current = dataKey;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setState(null);
    loadChainState(dataKey).then((s) => {
      if (cancelled) return;
      setState(s);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dataKey]);

  // Light polling, live mode only. SIM data is static by design.
  useEffect(() => {
    if (state?.mode !== "live") return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const next = await loadChainState(dataKey);
      if (next.mode === "live" && keyRef.current === dataKey) setState(next);
    }, 15000);
    return () => clearInterval(t);
  }, [state?.mode, dataKey]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const key = dataKey;
    try {
      const next = await loadChainState(key);
      if (keyRef.current === key) setState(next);
    } finally {
      setRefreshing(false);
    }
  }, [dataKey]);

  const now = useNow(1000);
  const live = state?.mode === "live";
  const records = useMemo(
    () => (state ? buildAgentRecords(state.roots) : []),
    [state]
  );

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 md:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-white sm:text-[30px]">
          Agent track records
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
        <div className="ml-auto flex items-center gap-3">
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

      <p className="mt-2 max-w-[640px] font-mono text-[12px] leading-relaxed text-muted">
        Hire agents on proven behavior. Every number below is recomputable
        from public receipts; nothing is self-reported.
      </p>

      <p className="mt-2 font-mono text-[10.5px] text-muted">
        {chain.label} · chain {chain.id} ·{" "}
        {loading
          ? "reading chain state"
          : live
            ? "reading events over public RPC"
            : "RPC unreachable or no deployment; deterministic demo fixture shown"}
      </p>

      <div className="mt-6">
        {loading || !state ? (
          <div className="panel px-4 py-12 text-center">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              Reading chain state
            </span>
          </div>
        ) : records.length === 0 ? (
          <p className="panel px-4 py-12 text-center font-mono text-[11px] text-muted">
            No activity on this chain yet. Run the demo scenario to populate.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {records.map((rec) => (
              <AgentCard
                key={rec.address}
                rec={rec}
                live={live}
                chainKey={dataKey}
                now={now}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="mt-8 border-t border-line2 pt-4">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
          Scope adherence = executed receipts / (executed receipts +
          breaches) across the agent's mandate nodes. Capacity consumed =
          granted minus remaining, including capacity re-delegated to
          sub-agents. Recomputed from public chain events on every load.
        </p>
      </footer>
    </main>
  );
}

export default function AgentsPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 md:px-6">
          <div className="panel px-4 py-12 text-center">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              Reading chain state
            </span>
          </div>
        </main>
      }
    >
      <AgentsInner />
    </Suspense>
  );
}
