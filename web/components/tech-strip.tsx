// Per-page tech attribution strip. A compact, muted horizontal row that
// names the real pieces powering a given page (each chip: a piece and its
// honest role), plus one line naming the authority contract on Robinhood
// Chain, linking to its explorer address page. No hooks: pure render over
// the shared CHAINS/CONTRACT constants, so it stays a plain component even
// inside client pages.

import { CHAINS, CONTRACT } from "@/components/shell";

export type TechChip =
  | "heromandate"
  | "permit2"
  | "mpp";

// Exact, honest chip copy. Each string names a real piece and its role.
const CHIP_TEXT: Record<TechChip, string> = {
  heromandate: "HeroMandate · Stylus authority contract · on Robinhood Chain",
  permit2: "Uniswap Permit2 · moves the tokens · on Robinhood Chain",
  mpp: "Arbitrum MPP · builds the payment credential",
};

const LINK =
  "text-acid underline decoration-dim underline-offset-2 transition-colors hover:decoration-acid focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid";

// Name portion (before the first middot) rendered brighter; the role stays
// muted. The exact chip string is preserved character for character.
function Chip({ text }: { text: string }) {
  const cut = text.indexOf(" · ");
  const name = cut === -1 ? text : text.slice(0, cut);
  const role = cut === -1 ? "" : text.slice(cut);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line2 bg-panel px-2.5 py-1 font-mono text-[10.5px] leading-none tracking-[0.02em]">
      <span
        aria-hidden="true"
        className="h-1 w-1 shrink-0 rounded-full bg-acid"
      />
      <span>
        <span className="text-white">{name}</span>
        {role && <span className="text-muted">{role}</span>}
      </span>
    </span>
  );
}

export default function TechStrip({
  chips,
  className = "mt-4",
}: {
  chips: TechChip[];
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Technology powering this page"
      className={`flex flex-col gap-2 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <Chip key={c} text={CHIP_TEXT[c]} />
        ))}
      </div>

      <p className="font-mono text-[10.5px] leading-relaxed text-dim">
        contract{" "}
        <span className="break-all text-muted">{CONTRACT}</span> on{" "}
        <a
          href={`${CHAINS.robinhood.explorer}/address/${CONTRACT}`}
          target="_blank"
          rel="noopener noreferrer"
          title={`Contract on ${CHAINS.robinhood.label}`}
          className={LINK}
        >
          {CHAINS.robinhood.label}
        </a>
      </p>
    </div>
  );
}
