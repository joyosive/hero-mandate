"use client";

// Compact stat cell: dim uppercase label over a mono value.
// Acid is reserved for the one highlight; err for breach counts.

export function Stat({
  label,
  value,
  tone = "white",
  note,
}: {
  label: string;
  value: string;
  tone?: "white" | "acid" | "err";
  note?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
        {label}
      </span>
      <span
        className={`truncate font-mono text-[15px] leading-none tabular-nums ${
          tone === "acid"
            ? "text-acid"
            : tone === "err"
              ? "text-err"
              : "text-white"
        }`}
        title={value}
      >
        {value}
      </span>
      {note && (
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-dim">
          {note}
        </span>
      )}
    </div>
  );
}
