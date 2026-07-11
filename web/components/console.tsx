"use client";

// The Chain of Mandate console: header, mandate tree, receipts, breaches,
// client-side receipt chain verification.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatEther } from "ethers";
import {
  BREACH_MEANING,
  CHAIN_KEYS,
  CHAINS,
  addressUrl,
  loadChainState,
  shortAddress,
  shortHash,
  txUrl,
  verifyReceiptChain,
  type ChainInfo,
  type ChainKey,
  type ChainState,
  type MandateNode,
  type VerifyResult,
} from "@/lib/chain";
import {
  Button,
  Label,
  LiveDot,
  Panel,
  Pill,
  PillButton,
  Wordmark,
} from "@/components/ui";

function fmtEth(v: bigint): string {
  const s = formatEther(v);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function fmtTime(ts: number): string {
  // 2026-07-09T14:05:12Z -> 07-09 14:05:12 UTC
  return `${new Date(ts * 1000).toISOString().slice(5, 19).replace("T", " ")} UTC`;
}

function Countdown({ expiry }: { expiry: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const left = expiry - now;
  if (left <= 0) {
    return <span className="font-mono text-xs text-err">EXPIRED</span>;
  }
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const text =
    d > 0
      ? `${d}d ${pad(h)}h ${pad(m)}m`
      : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  return <span className="font-mono text-xs text-white">{text}</span>;
}

function CapacityBar({ node }: { node: MandateNode }) {
  const pct =
    node.capacity > 0n
      ? Math.min(100, Number((node.remaining * 10000n) / node.capacity) / 100)
      : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Label>Capacity</Label>
        <span className="font-mono text-xs text-white">
          <span className="text-acid">{fmtEth(node.remaining)}</span>
          {" / "}
          {fmtEth(node.capacity)} ETH remaining
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-dim/25">
        <div
          className="h-full rounded-full bg-acid"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ReceiptRow({
  receipt,
  chain,
  live,
}: {
  receipt: MandateNode["receipts"][number];
  chain: ChainInfo;
  live: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-dim/25 py-1.5 first:border-t-0">
      <span className="font-mono text-xs text-white">
        {receipt.instrumentLabel}
      </span>
      <span className="font-mono text-xs text-acid">
        {fmtEth(receipt.amount)} ETH
      </span>
      <span className="font-mono text-[0.68rem] text-muted">
        head {shortHash(receipt.newHead)}
      </span>
      <span className="font-mono text-[0.68rem] text-muted">
        {fmtTime(receipt.timestamp)}
      </span>
      {live && receipt.txHash ? (
        <a
          className="font-mono text-[0.68rem] text-cyan underline decoration-cyan/40 underline-offset-2 hover:decoration-cyan"
          href={txUrl(chain, receipt.txHash)}
          target="_blank"
          rel="noreferrer"
        >
          explorer
        </a>
      ) : (
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-cyan/70">
          sim
        </span>
      )}
    </div>
  );
}

function BreachRow({
  breach,
  chain,
  live,
}: {
  breach: MandateNode["breachEvents"][number];
  chain: ChainInfo;
  live: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md border border-err/40 bg-err/5 px-2.5 py-1.5">
      <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-err">
        Breach {breach.code}: {BREACH_MEANING[breach.code] ?? "UNKNOWN"}
      </span>
      <span className="font-mono text-xs text-err">
        {breach.instrumentLabel}
      </span>
      <span className="font-mono text-xs text-err/80">
        {fmtEth(breach.amount)} ETH
      </span>
      <span className="font-mono text-[0.68rem] text-err/60">refused</span>
      {live && breach.txHash ? (
        <a
          className="font-mono text-[0.68rem] text-err underline decoration-err/40 underline-offset-2"
          href={txUrl(chain, breach.txHash)}
          target="_blank"
          rel="noreferrer"
        >
          explorer
        </a>
      ) : (
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-cyan/70">
          sim
        </span>
      )}
    </div>
  );
}

function MandateCard({
  node,
  chain,
  live,
  verify,
  onVerify,
}: {
  node: MandateNode;
  chain: ChainInfo;
  live: boolean;
  verify: Record<string, VerifyResult>;
  onVerify: (node: MandateNode) => void;
}) {
  const isRoot = node.parentId === 0;
  const result = verify[`${node.id}:${node.receiptHead}`];
  return (
    <div className="space-y-4">
      <Panel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-sm font-bold tracking-tight text-white">
            MANDATE #{node.id}
          </span>
          <Pill tone={isRoot ? "acid" : "muted"}>
            {isRoot ? "root" : `child of #${node.parentId}`}
          </Pill>
          {node.breaches > 0 && (
            <Pill tone="err">
              {node.breaches} breach{node.breaches === 1 ? "" : "es"}
            </Pill>
          )}
        </div>

        <div className="mt-4">
          <CapacityBar node={node} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Meta label="Agent">
            {live ? (
              <a
                className="font-mono text-xs text-white underline decoration-dim underline-offset-2 hover:decoration-acid"
                href={addressUrl(chain, node.agent)}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddress(node.agent)}
              </a>
            ) : (
              <span className="font-mono text-xs text-white">
                {shortAddress(node.agent)}
              </span>
            )}
          </Meta>
          <Meta label="Expires in">
            <Countdown expiry={node.expiry} />
          </Meta>
          <Meta label="Scope root">
            <span className="font-mono text-xs text-muted">
              {shortHash(node.scopeRoot)}
            </span>
          </Meta>
          <Meta label="Model hash">
            <span className="font-mono text-xs text-muted">
              {shortHash(node.modelHash)}
            </span>
          </Meta>
        </div>

        {node.breachEvents.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {node.breachEvents.map((b, i) => (
              <BreachRow key={i} breach={b} chain={chain} live={live} />
            ))}
          </div>
        )}

        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-2">
            <Label>Receipts ({node.receipts.length})</Label>
            <span className="font-mono text-[0.68rem] text-muted">
              head {shortHash(node.receiptHead)}
            </span>
          </div>
          <div className="mt-1.5">
            {node.receipts.length === 0 ? (
              <p className="font-mono text-[0.68rem] text-dim">
                No executions on this node.
              </p>
            ) : (
              node.receipts.map((r, i) => (
                <ReceiptRow key={i} receipt={r} chain={chain} live={live} />
              ))
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => onVerify(node)}>Verify chain</Button>
          {result && (
            <span
              className={`font-mono text-xs font-bold tracking-[0.1em] ${
                result.ok ? "text-acid" : "text-err"
              }`}
            >
              {result.ok ? "VERIFIED" : "BROKEN"}
              <span className="ml-2 font-normal tracking-normal text-muted">
                recomputed {shortHash(result.computed)}
              </span>
            </span>
          )}
        </div>
      </Panel>

      {node.children.length > 0 && (
        <div className="ml-3 space-y-4 border-l border-dim/40 pl-3 sm:ml-6 sm:pl-6">
          {node.children.map((child) => (
            <MandateCard
              key={child.id}
              node={child}
              chain={chain}
              live={live}
              verify={verify}
              onVerify={onVerify}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Console() {
  const [chainKey, setChainKey] = useState<ChainKey>("46630");
  const [state, setState] = useState<ChainState | null>(null);
  const [loading, setLoading] = useState(true);
  const [verify, setVerify] = useState<Record<string, VerifyResult>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setState(null);
    setVerify({});
    loadChainState(chainKey).then((s) => {
      if (cancelled) return;
      setState(s);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [chainKey]);

  // Light polling, live mode only. SIM data is static by design.
  useEffect(() => {
    if (state?.mode !== "live") return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const next = await loadChainState(chainKey);
      // Ignore a transient fallback: keep the last good live view.
      if (next.mode === "live") setState(next);
    }, 15000);
    return () => clearInterval(t);
  }, [state?.mode, chainKey]);

  const onVerify = useCallback((node: MandateNode) => {
    const result = verifyReceiptChain(node);
    setVerify((v) => ({
      ...v,
      [`${node.id}:${node.receiptHead}`]: result,
    }));
  }, []);

  const chain = CHAINS[chainKey];
  const live = state?.mode === "live";

  return (
    <div className="mx-auto min-h-dvh max-w-4xl px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-dim/30 py-4">
        <div className="flex flex-col">
          <Wordmark />
          <span className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-muted">
            Chain of Mandate
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {CHAIN_KEYS.map((key) => (
            <PillButton
              key={key}
              active={key === chainKey}
              onClick={() => setChainKey(key)}
            >
              {CHAINS[key].label}
            </PillButton>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {!loading && state && (
            <Pill tone={live ? "acid" : "cyan"}>
              <LiveDot sim={!live} />
              {live ? "live" : "sim"}
            </Pill>
          )}
          <Link
            className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted hover:text-acid"
            href="/how"
          >
            How it works
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
        <span className="font-mono text-[0.68rem] text-muted">
          {chain.label}, chain {chain.id}
        </span>
        {live && state?.contractAddress ? (
          <a
            className="font-mono text-[0.68rem] text-cyan underline decoration-cyan/40 underline-offset-2"
            href={addressUrl(chain, state.contractAddress)}
            target="_blank"
            rel="noreferrer"
          >
            contract {shortAddress(state.contractAddress)}
          </a>
        ) : (
          !loading && (
            <span className="font-mono text-[0.68rem] text-cyan/80">
              no deployment on this chain yet, showing the deterministic demo
              fixture
            </span>
          )
        )}
      </div>

      <main>
        {loading || !state ? (
          <Panel className="p-8 text-center">
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
              Reading chain state
            </span>
          </Panel>
        ) : state.roots.length === 0 ? (
          <Panel className="p-8 text-center">
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
              No mandates on this chain yet
            </span>
          </Panel>
        ) : (
          <div className="space-y-6">
            {state.roots.map((root) => (
              <MandateCard
                key={root.id}
                node={root}
                chain={chain}
                live={live}
                verify={verify}
                onVerify={onVerify}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="mt-10 border-t border-dim/30 pt-4">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-dim">
          Testnet only. No token. No custody of trading assets. Breach codes:
          1 expired, 2 over capacity, 3 scope refused.
        </p>
      </footer>
    </div>
  );
}
