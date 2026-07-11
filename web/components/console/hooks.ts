"use client";

// Small client hooks for the console surfaces: a ticking clock for relative
// times and countdowns, and a reduced-motion probe so scripted animation
// (the verify terminal) can be skipped honestly.

import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      intervalMs
    );
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
