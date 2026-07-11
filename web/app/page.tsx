// Landing: story plus live proof. Under construction in this build pass;
// the console remains fully available at /console.
import Link from "next/link";

export default function Page() {
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-16 md:px-6">
      <h1 className="font-display text-3xl font-bold text-white">The breach is provable. <span className="text-acid">The mandate stays sealed.</span></h1>
      <p className="mt-4 max-w-[620px] text-[15px] leading-relaxed text-muted">
        Authority for AI trading agents: escrowed, scoped, delegable, receipted.
      </p>
      <Link href="/console" className="btn mt-8 inline-flex">Open the console</Link>
    </main>
  );
}
