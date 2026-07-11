// Landing: the thesis, the authority waterfall, live ops, the four rails.
// All client work lives in components/landing; this page only mounts it
// behind Suspense because the shell's chain selection rides useSearchParams.

import { Suspense } from "react";
import Landing from "@/components/landing/landing";

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <Landing />
    </Suspense>
  );
}
