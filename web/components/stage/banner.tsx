"use client";

// Stage event banner, the bottom band of the projector view. A newly
// arrived event takes the band over for four seconds: executed trades in
// acid with a slide-up entrance, refusals in massive err type with one
// hard flash. Idle, the band runs a slow ticker tape of the last ten
// events (pausable on hover, a static list under reduced motion).

import type { CSSProperties } from "react";
import { shortHash } from "@/lib/chain";
import type { ActivityRow } from "@/lib/agents";
import { fmtEth } from "@/components/console/format";

// Short breach words for projector distance; codes match the contract.
const BREACH_WORD: Record<number, string> = {
  1: "expired",
  2: "over capacity",
  3: "scope",
};

export interface StageEvent {
  key: string;
  kind: "receipt" | "breach";
  nodeId: number;
  instrumentLabel: string;
  amount: bigint;
  newHead?: string;
  code?: number;
}

export function toStageEvent(row: ActivityRow, key: string): StageEvent {
  return {
    key,
    kind: row.kind,
    nodeId: row.nodeId,
    instrumentLabel: row.instrumentLabel,
    amount: row.amount,
    newHead: row.newHead,
    code: row.code,
  };
}

function Takeover({ ev, live }: { ev: StageEvent; live: boolean }) {
  const breach = ev.kind === "breach";
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-center ${
        breach ? "stage-hard-flash" : ""
      }`}
    >
      <span className="font-mono text-[clamp(11px,1.2vw,16px)] uppercase tracking-[0.3em] text-dim">
        {breach ? "refused" : "executed"} · node #{ev.nodeId}
        {live ? "" : " · sim"}
      </span>
      {breach ? (
        <span
          className="font-mono font-bold uppercase leading-[1.08] text-err"
          style={{ fontSize: "clamp(24px,5.5vw,80px)" }}
        >
          REFUSED · BREACH AT NODE {ev.nodeId} · code {ev.code}{" "}
          {BREACH_WORD[ev.code ?? 0] ?? "unknown"}
        </span>
      ) : (
        <span
          className="stage-slide-up font-mono leading-[1.08] text-acid"
          style={{ fontSize: "clamp(22px,4.5vw,68px)" }}
        >
          {ev.instrumentLabel}{" "}
          <span className="tabular-nums">{fmtEth(ev.amount)} ETH</span>
          {" -> head "}
          {shortHash(ev.newHead ?? "")}
        </span>
      )}
    </div>
  );
}

function TickerItem({ ev }: { ev: StageEvent }) {
  return (
    <span
      className="flex shrink-0 items-baseline gap-[0.8em] whitespace-nowrap pr-[4em] font-mono"
      style={{ fontSize: "clamp(14px,1.6vw,22px)" }}
    >
      {ev.kind === "receipt" ? (
        <>
          <span className="uppercase tracking-[0.14em] text-dim">exec</span>
          <span className="text-white">{ev.instrumentLabel}</span>
          <span className="tabular-nums text-acid">
            {fmtEth(ev.amount)} ETH
          </span>
          <span className="text-dim">#{ev.nodeId}</span>
          <span className="text-muted">{shortHash(ev.newHead ?? "")}</span>
        </>
      ) : (
        <>
          <span className="font-semibold uppercase tracking-[0.14em] text-err">
            refused
          </span>
          <span className="text-err/80">
            code {ev.code} {BREACH_WORD[ev.code ?? 0] ?? "unknown"}
          </span>
          <span className="text-muted">
            {ev.instrumentLabel}{" "}
            <span className="tabular-nums">{fmtEth(ev.amount)} ETH</span>
          </span>
          <span className="text-dim">#{ev.nodeId}</span>
        </>
      )}
    </span>
  );
}

function Ticker({
  items,
  reduced,
}: {
  items: StageEvent[];
  reduced: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="px-4 text-center font-mono text-[clamp(12px,1.4vw,18px)] uppercase tracking-[0.2em] text-dim">
        awaiting first on-chain event
      </p>
    );
  }
  // Reduced motion: honest static list, newest first, no tape.
  if (reduced) {
    return (
      <div className="flex max-h-full flex-col gap-1 overflow-y-auto px-4">
        {items.map((ev) => (
          <TickerItem key={ev.key} ev={ev} />
        ))}
      </div>
    );
  }
  const copy = (dupe: boolean) => (
    <div className="flex shrink-0 items-baseline" aria-hidden={dupe}>
      {items.map((ev) => (
        <TickerItem key={ev.key} ev={ev} />
      ))}
    </div>
  );
  return (
    <div
      className="stage-marquee"
      style={{
        "--marquee-dur": `${Math.max(24, items.length * 6)}s`,
      } as CSSProperties}
    >
      <div className="stage-marquee-track">
        {copy(false)}
        {copy(true)}
      </div>
    </div>
  );
}

export function StageBanner({
  active,
  ticker,
  live,
  reduced,
}: {
  active: StageEvent | null;
  ticker: StageEvent[];
  live: boolean;
  reduced: boolean;
}) {
  return (
    <section
      aria-live="polite"
      className="flex h-[24vh] min-h-[140px] flex-col justify-center overflow-hidden border-t border-line2"
    >
      {active ? (
        <Takeover key={active.key} ev={active} live={live} />
      ) : (
        <Ticker items={ticker} reduced={reduced} />
      )}
    </section>
  );
}
