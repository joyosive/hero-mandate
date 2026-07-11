"use client";

// Receipts table: executed receipts and refused breaches in one
// chronological feed, newest first. Breach rows are err-tinted and carry a
// permanent err left border; receipt rows get an acid left border on hover.

import { BREACH_MEANING, txUrl, type ChainInfo } from "@/lib/chain";
import { shortHash } from "@/lib/chain";
import type { ActivityRow } from "@/lib/agents";
import { fmtEth, relTime } from "./format";
import { useNow } from "./hooks";

const TH =
  "px-3 py-2 text-left font-mono text-[9.5px] font-normal uppercase tracking-[0.16em] text-dim";

function TxCell({
  row,
  chain,
  live,
}: {
  row: ActivityRow;
  chain: ChainInfo;
  live: boolean;
}) {
  if (live && row.txHash) {
    const err = row.kind === "breach";
    return (
      <a
        href={txUrl(chain, row.txHash)}
        target="_blank"
        rel="noopener noreferrer"
        className={`underline underline-offset-2 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid ${
          err
            ? "text-err/80 decoration-err/40 hover:text-err hover:decoration-err"
            : "text-muted decoration-dim hover:text-acid hover:decoration-acid"
        }`}
      >
        view
      </a>
    );
  }
  return (
    <span className="uppercase tracking-[0.1em] text-cyan/70">sim</span>
  );
}

export function ActivityTable({
  rows,
  chain,
  live,
}: {
  rows: ActivityRow[];
  chain: ChainInfo;
  live: boolean;
}) {
  const now = useNow(1000);
  const receipts = rows.filter((r) => r.kind === "receipt").length;
  const breaches = rows.length - receipts;

  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line2 px-4 py-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white">
          Receipts
        </h2>
        <span className="font-mono text-[10px] tabular-nums text-dim">
          {receipts} executed · {breaches} refused
        </span>
        <span className="ml-auto hidden font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim sm:inline">
          hash-chained · recomputable by anyone
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-12 text-center font-mono text-[11px] text-muted">
          No activity on this chain yet. Run the demo scenario to populate.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse font-mono text-[11px]">
            <thead>
              <tr>
                <th className={TH}>time</th>
                <th className={TH}>node</th>
                <th className={TH}>instrument</th>
                <th className={`${TH} text-right`}>amount (eth)</th>
                <th className={TH}>new head</th>
                <th className={TH}>tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) =>
                row.kind === "receipt" ? (
                  <tr
                    key={i}
                    className="group border-t border-line2 transition-colors hover:bg-acid/[0.04]"
                  >
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted transition-shadow group-hover:shadow-[inset_2px_0_0_var(--color-acid)]">
                      {row.timestamp !== null
                        ? relTime(row.timestamp, now)
                        : "--"}
                    </td>
                    <td className="px-3 py-2 text-muted">#{row.nodeId}</td>
                    <td className="px-3 py-2 text-white">
                      {row.instrumentLabel}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-acid">
                      {fmtEth(row.amount)}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {row.newHead ? shortHash(row.newHead) : "--"}
                    </td>
                    <td className="px-3 py-2">
                      <TxCell row={row} chain={chain} live={live} />
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={i}
                    className="border-t border-line2 bg-err/[0.06]"
                  >
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-err/70 shadow-[inset_2px_0_0_var(--color-err)]">
                      {row.timestamp !== null
                        ? relTime(row.timestamp, now)
                        : "--"}
                    </td>
                    <td className="px-3 py-2 text-err">#{row.nodeId}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-err">
                      REFUSED code {row.code} (
                      {BREACH_MEANING[row.code ?? 0] ?? "UNKNOWN"})
                    </td>
                    <td colSpan={2} className="px-3 py-2 text-err/80">
                      attempted {row.instrumentLabel} · {fmtEth(row.amount)}{" "}
                      ETH
                    </td>
                    <td className="px-3 py-2">
                      <TxCell row={row} chain={chain} live={live} />
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
