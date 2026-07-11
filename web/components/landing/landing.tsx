"use client";

// Landing orchestrator: reads the chain selected in the shell (?chain=),
// loads that chain's state once, and feeds the waterfall and the ops strip
// from the same read so the two never disagree. Live data when the chain
// has it; the deterministic fixture, labeled SIM, when it does not.

import { useEffect, useMemo, useState } from "react";
import { useChain } from "@/components/shell";
import type { ChainState, ChainKey as DataChainKey } from "@/lib/chain";
import { computeStats, loadLandingState } from "@/lib/stats";
import Hero from "./hero";
import Waterfall from "./waterfall";
import OpsStrip from "./ops-strip";
import Rails from "./rails";
import Steps from "./steps";
import Closing from "./closing";

const DATA_KEY: Record<"robinhood" | "sepolia", DataChainKey> = {
  robinhood: "46630",
  sepolia: "421614",
};

export default function Landing() {
  const chain = useChain();
  const dataKey = DATA_KEY[chain];
  const [state, setState] = useState<ChainState | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    loadLandingState(dataKey).then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [dataKey]);

  const stats = useMemo(() => (state ? computeStats(state) : null), [state]);

  return (
    <main>
      <Hero chain={chain} />
      <Waterfall state={state} />
      <OpsStrip
        stats={stats}
        live={state?.mode === "live"}
        chainLabel={state ? state.chain.label : null}
      />
      <Rails />
      <Steps chain={chain} />
      <Closing chain={chain} />
    </main>
  );
}
