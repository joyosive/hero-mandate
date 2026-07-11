"use client";

// Count-up used by the SETTLE beat. Animates a value from 0 to the settled
// amount with requestAnimationFrame (easeOutCubic). Under reduced motion it
// prints the final value immediately, no animation. Two fixed decimals so the
// mono column does not reflow while it counts.

import { useEffect, useState } from "react";
import { fmtAmount } from "./data";

export function CountUp({
  to,
  durationMs = 800,
  reduced,
}: {
  to: number;
  durationMs?: number;
  reduced: boolean;
}) {
  const [val, setVal] = useState(reduced ? to : 0);

  useEffect(() => {
    if (reduced) {
      setVal(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(to * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, durationMs, reduced]);

  return <>{fmtAmount(val)}</>;
}
