// Shared UI primitives for the Hero Mandate console.
// Sibling of the Hero site: same tokens, same pill and button language.

import type { ReactNode } from "react";

export function Pill({
  children,
  tone = "muted",
  className = "",
}: {
  children: ReactNode;
  tone?: "muted" | "acid" | "cyan" | "err";
  className?: string;
}) {
  const toneClass =
    tone === "acid"
      ? "pill-acid"
      : tone === "cyan"
        ? "pill-cyan"
        : tone === "err"
          ? "pill-err"
          : "";
  return <span className={`pill ${toneClass} ${className}`}>{children}</span>;
}

export function PillButton({
  children,
  active = false,
  onClick,
  className = "",
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`pill pill-btn ${className}`}
      data-active={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Button({
  children,
  onClick,
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`btn ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`panel ${className}`}>{children}</div>;
}

export function LiveDot({ sim = false }: { sim?: boolean }) {
  return (
    <span
      className={`live-dot ${sim ? "live-dot-sim" : ""}`}
      aria-hidden="true"
    />
  );
}

export function Label({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted ${className}`}
    >
      {children}
    </span>
  );
}

export function Wordmark() {
  return (
    <span className="font-display text-lg font-bold tracking-tight">
      <span className="text-white">HERO</span>
      <span className="text-acid">MANDATE</span>
    </span>
  );
}
