"use client";

// Interactive SETTLEMENT replay. A play button steps through the five beats
// of a real, mandate-gated stablecoin settlement that already happened
// on-chain. It is a replay, not a live signature: there are no keys in the
// browser and nothing is sent. Every beat links to the real transaction on
// the block explorer so the whole thing is verifiable end to end.
//
// Play sequence: one `revealed` counter (0..5) gates which beats are shown.
// Pressing play sets `playing`, and an interval advances `revealed` by one
// every ~900ms until it reaches 5; a reduced-motion viewer jumps straight to
// 5 with no interval. The SETTLE beat mounts its count-up when revealed >= 3.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePrefersReducedMotion } from "@/components/console/hooks";
import TechStrip from "@/components/tech-strip";
import { CountUp } from "./countup";
import {
  SETTLEMENTS,
  chainLabel,
  explorerName,
  fmtUnits,
  shortHex,
  txUrl,
  units,
  type Settlement,
} from "./data";

const BEATS = 5;
const BEAT_MS = 900;

function StyleBlock() {
  return (
    <style>{`
      @keyframes settleIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      .settle-in { animation: settleIn 320ms ease-out both; }
      @keyframes settleFlash {
        0% { box-shadow: 0 0 0 0 rgba(170,255,0,0); }
        28% { box-shadow: 0 0 30px 2px rgba(170,255,0,0.45); }
        100% { box-shadow: 0 0 0 0 rgba(170,255,0,0); }
      }
      .settle-flash { animation: settleFlash 1200ms ease-out 1; }
      @keyframes settleCaret { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      .settle-caret { animation: settleCaret 1s step-end infinite; }
      @media (prefers-reduced-motion: reduce) {
        .settle-in, .settle-flash, .settle-caret { animation: none !important; }
      }
    `}</style>
  );
}

function TxLink({
  s,
  hash,
  children,
}: {
  s: Settlement;
  hash: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={txUrl(s.chainKey, hash)}
      target="_blank"
      rel="noopener noreferrer"
      title={`${hash} on ${explorerName(s.chainKey)}`}
      className="font-mono text-[11px] text-acid underline decoration-dim decoration-dotted underline-offset-2 transition-colors hover:decoration-acid focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid"
    >
      {children ?? shortHex(hash)}
    </a>
  );
}

function BeatCard({
  n,
  title,
  tone = "acid",
  flash = false,
  children,
}: {
  n: number;
  title: string;
  tone?: "acid" | "err" | "cyan";
  flash?: boolean;
  children: ReactNode;
}) {
  const label =
    tone === "err"
      ? "text-err"
      : tone === "cyan"
        ? "text-cyan"
        : "text-acid";
  const edge =
    tone === "err"
      ? "border-err/45"
      : tone === "cyan"
        ? "border-cyan/40"
        : "border-[rgba(76,79,71,0.55)]";
  return (
    <article
      className={`settle-in panel ${edge} ${flash ? "settle-flash" : ""} p-4 sm:p-5`}
    >
      <div className="flex items-center gap-2 font-mono text-[11px]">
        <span className="text-dim">{">"}</span>
        <span className="text-dim tabular-nums">[{n}/{BEATS}]</span>
        <span className={`uppercase tracking-[0.16em] ${label}`}>{title}</span>
      </div>
      <div className="mt-3">{children}</div>
    </article>
  );
}

function DataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
        {label}
      </span>
      <span className="font-mono text-[12px] text-white">{children}</span>
    </div>
  );
}

function SettlementView({ s }: { s: Settlement }) {
  const reduced = usePrefersReducedMotion();
  const [revealed, setRevealed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  const playRef = useRef<HTMLButtonElement | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const play = useCallback(() => {
    clear();
    if (reduced) {
      setRevealed(BEATS);
      setPlaying(false);
      return;
    }
    setRevealed(1);
    setPlaying(true);
  }, [clear, reduced]);

  const reset = useCallback(() => {
    clear();
    setPlaying(false);
    setRevealed(0);
    playRef.current?.focus();
  }, [clear]);

  // Advance one beat per tick while playing.
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setRevealed((r) => Math.min(r + 1, BEATS));
    }, BEAT_MS);
    return () => clear();
  }, [playing, clear]);

  // Stop the interval once the last beat is on screen.
  useEffect(() => {
    if (revealed >= BEATS && playing) setPlaying(false);
  }, [revealed, playing]);

  // Reset local state when the selected chain changes.
  useEffect(() => {
    return () => clear();
  }, [s.chainKey, clear]);

  const dec = s.token.decimals;
  const amount = units(s.amount, dec);
  const beforeN = units(s.vendorBefore, dec);
  const afterN = units(s.vendorAfter, dec);
  const done = revealed >= BEATS;
  const sym = s.token.symbol;

  return (
    <div>
      <StyleBlock />

      {/* always-visible settlement summary */}
      <div className="panel mt-6 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
            token
          </span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-[15px] leading-none text-white">
              {sym}
            </span>
            <span className={`pill ${s.token.real ? "pill-acid" : "pill-cyan"}`}>
              {s.token.real ? "Circle USDC" : "demo stablecoin"}
            </span>
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
            amount
          </span>
          <span className="font-mono text-[15px] leading-none text-acid tabular-nums">
            {amount} {sym}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
            vendor
          </span>
          <span className="font-mono text-[15px] leading-none text-white">
            {shortHex(s.vendor)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
            network
          </span>
          <span className="font-mono text-[15px] leading-none text-white">
            {chainLabel(s.chainKey)}
          </span>
        </div>
      </div>

      {/* controls */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          ref={playRef}
          type="button"
          onClick={play}
          disabled={playing}
          aria-label="Play settlement replay"
          className="group inline-flex items-center gap-2.5 rounded-full border border-acid bg-acid px-6 py-2.5 font-mono text-[13px] font-semibold uppercase tracking-[0.12em] text-[#0a0b09] transition-colors hover:bg-transparent hover:text-acid disabled:cursor-not-allowed disabled:border-dim disabled:bg-transparent disabled:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid"
        >
          <span
            aria-hidden="true"
            className="inline-block h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-current"
          />
          {playing ? "Playing" : done ? "Play again" : "Play settlement"}
        </button>
        {revealed > 0 && (
          <button
            type="button"
            onClick={reset}
            className="btn focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid"
          >
            Reset
          </button>
        )}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-dim tabular-nums">
          {revealed}/{BEATS} beats
          {playing && <span className="settle-caret text-acid"> _</span>}
        </span>
      </div>

      {/* beats */}
      <div className="mt-5 flex flex-col gap-3">
        {revealed === 0 && (
          <div className="panel px-4 py-10 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              Press play to replay this on-chain settlement
            </p>
            <p className="mt-2 font-mono text-[10px] text-dim">
              five beats, each linking to a transaction you can open on{" "}
              {explorerName(s.chainKey)}
            </p>
          </div>
        )}

        {revealed >= 1 && (
          <BeatCard n={1} title="Mandate check">
            <p className="font-mono text-[12px] leading-relaxed text-muted">
              The agent executes under the payments mandate on-chain. No
              mandate, no settlement.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <DataRow label="mandate">
                #{s.mandateId} · scope PAY-USDC
              </DataRow>
              <DataRow label="execute tx">
                <TxLink s={s} hash={s.executeTx} />
              </DataRow>
            </div>
          </BeatCard>
        )}

        {revealed >= 2 && (
          <BeatCard n={2} title="Credential">
            <p className="font-mono text-[12px] leading-relaxed text-muted">
              An @arbitrum/mpp Permit2 credential is signed, bound to the
              receipt head and to the exact amount. It authorizes this payment
              and nothing else.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <DataRow label="bound">
                amount {amount} {sym} · receipt head {shortHex(s.receiptHead)}
              </DataRow>
              <DataRow label="nonce">
                <span className="tabular-nums">{s.nonce}</span>
              </DataRow>
            </div>
          </BeatCard>
        )}

        {revealed >= 3 && (
          <BeatCard n={3} title="Settle" flash={!reduced}>
            <p className="font-mono text-[12px] leading-relaxed text-muted">
              Tokens move through the canonical Permit2 contract. This
              transaction is real and final on {chainLabel(s.chainKey)}.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
                  amount settled
                </span>
                <div className="mt-1 font-display text-4xl font-bold tabular-nums text-acid sm:text-5xl">
                  <CountUp to={amount} reduced={reduced} /> {sym}
                </div>
              </div>
              <div>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
                  vendor balance, on-chain
                </span>
                <div className="mt-1 font-mono text-[15px] tabular-nums text-white">
                  {fmtUnits(s.vendorBefore, dec)}
                  <span className="text-dim"> {"->"} </span>
                  <span className="text-acid">{fmtUnits(s.vendorAfter, dec)}</span>{" "}
                  {sym}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-dim tabular-nums">
                  {beforeN < afterN ? "+" : ""}
                  {(afterN - beforeN).toFixed(2)} {sym} this settlement
                </div>
              </div>
            </div>
            <div className="mt-4">
              <DataRow label="settle tx">
                <TxLink s={s} hash={s.settleTx} />
              </DataRow>
            </div>
          </BeatCard>
        )}

        {revealed >= 4 && (
          <BeatCard n={4} title="Replay refused" tone="err">
            <p className="font-mono text-[12px] leading-relaxed text-err">
              The same credential is replayed. Permit2 rejects it: the nonce is
              already consumed.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <DataRow label="result">
                <span className="text-err">
                  {s.replay.tx
                    ? "reverted on-chain"
                    : "rejected on-chain, nonce consumed"}
                  {s.replay.invalidNonce
                    ? ` · InvalidNonce (${s.replay.selector})`
                    : ""}
                </span>
              </DataRow>
              {s.replay.tx && (
                <DataRow label="replay tx">
                  <TxLink s={s} hash={s.replay.tx} />
                </DataRow>
              )}
            </div>
          </BeatCard>
        )}

        {revealed >= 5 && (
          <BeatCard n={5} title="Done">
            <p className="font-display text-xl font-bold leading-snug text-white sm:text-2xl">
              No mandate, no payment. Not one token more than authorized.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <DataRow label="execute tx">
                <TxLink s={s} hash={s.executeTx} />
              </DataRow>
              <DataRow label="settle tx">
                <TxLink s={s} hash={s.settleTx} />
              </DataRow>
            </div>
          </BeatCard>
        )}
      </div>

      {/* footer */}
      <footer className="mt-8 border-t border-line2 pt-4">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
          canonical Permit2 {s.permit2} · the same rails Circle USDC uses ·
          replay only, no keys in the browser, no live signing
        </p>
      </footer>
    </div>
  );
}

export default function Settlement() {
  const [idx, setIdx] = useState(0);
  const many = SETTLEMENTS.length > 1;
  const s = SETTLEMENTS[idx];

  return (
    <main className="mx-auto max-w-[1080px] px-4 pb-16 pt-8 md:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-white sm:text-[30px]">
          Settlement
        </h1>
        <span className="pill pill-acid">
          <span className="live-dot" aria-hidden="true" />
          on-chain replay
        </span>

        {many && (
          <div
            className="ml-auto flex rounded-lg border border-line p-[3px]"
            role="group"
            aria-label="Settlement chain"
          >
            {SETTLEMENTS.map((entry, i) => (
              <button
                key={entry.chainKey}
                type="button"
                onClick={() => setIdx(i)}
                aria-current={i === idx ? "true" : undefined}
                className={`rounded-md px-3 py-1 font-mono text-[10px] uppercase tracking-[1px] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid ${
                  i === idx
                    ? "bg-acid font-semibold text-[#0a0b09]"
                    : "text-muted hover:text-white"
                }`}
              >
                {entry.token.symbol}
              </button>
            ))}
          </div>
        )}
      </div>

      <TechStrip chips={["heromandate", "mpp", "permit2"]} />

      <p className="mt-2 max-w-[680px] font-mono text-[12px] leading-relaxed text-muted">
        Replaying the on-chain settlement, every step verifiable. This
        visualizes a mandate-gated stablecoin payment that already happened; it
        does not sign or send anything from your browser.
      </p>

      {s ? (
        <SettlementView key={s.chainKey} s={s} />
      ) : (
        <p className="panel mt-6 px-4 py-12 text-center font-mono text-[11px] text-muted">
          No settlement runs recorded yet.
        </p>
      )}
    </main>
  );
}
