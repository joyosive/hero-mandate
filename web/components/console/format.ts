// Formatting helpers shared by the console and agents surfaces.
// All numeric and time output is mono-typeset by the callers.

import { formatEther } from "ethers";

export function fmtEth(v: bigint): string {
  const s = formatEther(v);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

// Fixed three decimals, for capacity bars where columns should not jitter.
export function fmtEth3(v: bigint): string {
  return Number(formatEther(v)).toFixed(3);
}

// Relative time, compact: "just now", "42s ago", "3m ago", "5h ago", "2d ago".
export function relTime(tsSec: number, nowSec: number): string {
  const d = Math.max(0, nowSec - tsSec);
  if (d < 5) return "just now";
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// Countdown to expiry: "1d 12h 30m" above a day, "01:59:59" below.
export function fmtCountdown(leftSec: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = Math.floor(leftSec / 86400);
  const h = Math.floor((leftSec % 86400) / 3600);
  const m = Math.floor((leftSec % 3600) / 60);
  const s = leftSec % 60;
  return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}
