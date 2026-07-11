"use client";

// Proof of Action, hands on. Real people log an action; each becomes a
// verifiable receipt hash computed exactly like the Hero agent CLI. Keys never
// touch this page: people log, the team anchors the collected root into
// HeroProofAnchor on-chain.
//
// Security: every piece of user input (who, what, email, exceptions) is
// rendered ONLY as a React {value}. There is no dangerouslySetInnerHTML and no
// HTML is ever built from user input, so stored/reflected XSS is impossible by
// construction. A hidden honeypot drops bots; input lengths are capped; the
// optional email is validated but never enters the receipt or the export.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  EMAIL_RE,
  MANDATE,
  SHEET_ENDPOINT,
  TASK_TYPES,
  buildRoot,
  makeReceipt,
  type Decision,
  type Receipt,
  type Task,
} from "@/components/proof/core";

interface SessionItem {
  task: Task;
  root: string;
  log: unknown[];
  decision: Decision;
}

const inputCls =
  "w-full rounded-[9px] border border-[rgba(76,79,71,0.55)] bg-panel2 px-3 py-[11px] font-body text-[15px] text-white placeholder:text-dim transition-colors focus:border-acid focus:outline-none focus-visible:border-acid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid";

const labelCls =
  "mb-1.5 mt-4 block font-mono text-[11px] uppercase tracking-[1px] text-muted";

async function postToSheet(fields: Record<string, unknown>) {
  if (!SHEET_ENDPOINT) return;
  try {
    await fetch(SHEET_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  } catch {
    // Never block the UI on capture.
  }
}

export function LogScreen() {
  const [type, setType] = useState<string>(TASK_TYPES[0]);
  const [who, setWho] = useState("");
  const [email, setEmail] = useState("");
  const [hours, setHours] = useState("");
  const [what, setWhat] = useState("");
  const [company, setCompany] = useState(""); // honeypot: humans never see it

  const [emailError, setEmailError] = useState<string | null>(null);
  const [result, setResult] = useState<Receipt | null>(null);
  const [session, setSession] = useState<SessionItem[]>([]);
  const [copied, setCopied] = useState(false);

  const whoRef = useRef<HTMLInputElement | null>(null);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    document.title = "Hero Mandate · Proof of Action";
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const rootValue = useMemo(
    () => buildRoot(session.map((s) => ({ root: s.root }))),
    [session]
  );

  function record() {
    // Honeypot: a filled hidden field means a bot. Treat as success, drop it.
    if (company.trim() !== "") {
      setWhat("");
      setHours("");
      whoRef.current?.focus();
      return;
    }

    // Optional email. Empty is fine; non-empty must look like an address.
    const em = email.trim();
    if (em !== "" && !EMAIL_RE.test(em)) {
      setEmailError("Enter a valid email or leave it blank.");
      return;
    }
    setEmailError(null);

    const cleanWho = who.trim();
    const cleanWhat = what.trim();
    const task: Task = {
      type,
      who: cleanWho,
      what: cleanWhat,
      hours: hours === "" ? undefined : Number(hours),
    };

    const r = makeReceipt(task);
    const d = r.decision;

    setResult(r);
    setSession((prev) => [
      ...prev,
      { task, root: r.root, log: r.log, decision: d },
    ]);

    // Contact capture. Email rides here as metadata only; it is never in the
    // task, the receipt, or the exported JSON.
    void postToSheet({
      ts: d.recordedAt,
      who: cleanWho,
      email: em,
      what: cleanWhat,
      type,
      hours: task.hours === undefined ? "" : task.hours,
      withinMandate: d.withinMandate,
      exceptions: d.exceptions.join("; "),
      root: r.root,
    });

    setWhat("");
    setHours("");
    whoRef.current?.focus();
  }

  function copySession() {
    const payload = JSON.stringify(
      {
        sessionRoot: rootValue,
        count: session.length,
        receipts: session.map((s) => ({ root: s.root, log: s.log })),
      },
      null,
      2
    );
    const done = () => {
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(payload).then(done, done);
    } else {
      done();
    }
  }

  const hasSession = session.length > 0;

  return (
    <main className="mx-auto max-w-[760px] px-4 pb-16 pt-7 md:px-6">
      <p className="mb-2.5 mt-2 font-mono text-[11px] uppercase tracking-[2px] text-acid">
        Proof of Action
      </p>
      <h1 className="mb-3 font-display text-[25px] font-bold leading-[1.15] tracking-[-0.3px] text-white sm:text-[30px]">
        Proof of action, hands on.
      </h1>
      <p className="mb-4 max-w-[60ch] text-[15px] text-muted">
        The same engine that proves an AI agent stayed within its trading
        mandate proves any action. Log one, get a tamper-evident receipt, and
        the day anchors on-chain into the same verified contract behind our
        fleet and trading proofs.
      </p>

      <div className="mb-[26px] flex items-start gap-2.5 rounded-[10px] border border-line border-l-2 border-l-acid bg-panel2 px-3.5 py-3 text-[13px] text-muted">
        <span aria-hidden="true">&bull;</span>
        <span>
          <b className="font-semibold text-white">Deterministic recorder.</b>{" "}
          Mandate shown in plaintext here; production seals it with Fhenix. Keys
          never touch this page: the team anchors the collected root.
        </span>
      </div>

      <form
        className="panel p-5"
        onSubmit={(e) => {
          e.preventDefault();
          record();
        }}
      >
        <label htmlFor="type" className={labelCls}>
          Task type
        </label>
        <select
          id="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className={inputCls}
        >
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <label htmlFor="who" className={labelCls}>
          Who
        </label>
        <input
          id="who"
          ref={whoRef}
          value={who}
          onChange={(e) => setWho(e.target.value)}
          maxLength={80}
          placeholder="your name"
          autoComplete="off"
          className={inputCls}
        />

        <div className="flex flex-col gap-x-3 sm:flex-row">
          <div className="min-w-0 flex-1">
            <label htmlFor="email" className={labelCls}>
              Email (optional)
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError(null);
              }}
              maxLength={120}
              placeholder="you@example.com"
              autoComplete="off"
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "email-err" : undefined}
              className={inputCls}
            />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="hours" className={labelCls}>
              Hours
            </label>
            <input
              id="hours"
              type="number"
              step="0.5"
              min="0"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="1.5"
              className={inputCls}
            />
          </div>
        </div>

        {emailError && (
          <p
            id="email-err"
            role="alert"
            className="mt-1.5 font-mono text-[12px] text-err"
          >
            {emailError}
          </p>
        )}

        <label htmlFor="what" className={labelCls}>
          What did you do?
        </label>
        <input
          id="what"
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          maxLength={200}
          placeholder="Reviewed the mandate spec"
          autoComplete="off"
          className={inputCls}
        />

        {/* Honeypot: visually hidden, off the tab order, hidden from AT. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-9999px",
            width: "1px",
            height: "1px",
            overflow: "hidden",
          }}
        >
          <label htmlFor="company">Company</label>
          <input
            id="company"
            name="company"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>

        <button
          type="submit"
          className="mt-5 w-full rounded-[9px] border border-acid bg-acid px-4 py-[13px] font-mono text-[13px] font-bold uppercase tracking-[1px] text-bg transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid"
        >
          Record action
        </button>

        {result && (
          <div
            role="status"
            aria-live="polite"
            className={`mt-[18px] rounded-[10px] border bg-panel2 p-3.5 text-[14px] ${
              result.decision.withinMandate
                ? "border-line"
                : "border-[rgba(255,84,112,0.4)]"
            }`}
          >
            {result.decision.withinMandate ? (
              <span className="font-bold text-acid">
                WITHIN MANDATE · recorded
              </span>
            ) : (
              <>
                <span className="font-bold text-err">EXCEPTION · flagged</span>
                <ul className="mt-1.5 list-disc pl-[18px] text-[13px] text-err">
                  {result.decision.exceptions.map((ex, i) => (
                    <li key={i}>{ex}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="mt-2 break-all font-mono text-[11px] text-muted">
              receipt: {result.root}
            </div>
          </div>
        )}
      </form>

      <div className="mb-1 mt-[30px] flex items-center justify-between gap-2.5">
        <h2 className="m-0 font-display text-[15px] font-medium text-white">
          Session
        </h2>
        {hasSession && (
          <span className="pill">
            {session.length} {session.length === 1 ? "action" : "actions"}
          </span>
        )}
      </div>

      {hasSession && (
        <ul className="mt-2 list-none p-0">
          {session.map((s, i) => {
            const rowWho = s.task.who || "?";
            const rowWhat = s.task.what || "(no description)";
            return (
              <li
                key={i}
                className="flex items-center gap-2 border-t border-line2 py-[9px] text-[13px] text-muted"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    s.decision.withinMandate ? "bg-acid" : "bg-err"
                  }`}
                  aria-hidden="true"
                />
                <span className="text-white">{rowWho}</span> · {rowWhat} ·{" "}
                <span className="font-mono text-[11px] text-dim">
                  {s.root.slice(0, 14)}&hellip;
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {hasSession && (
        <div className="mt-[18px]">
          <label className={labelCls}>Session root (the team anchors this)</label>
          <div className="mt-1.5 break-all rounded-[9px] border border-line bg-panel2 px-3 py-[11px] font-mono text-[12px] text-acid">
            {rootValue}
          </div>
          <button
            type="button"
            onClick={copySession}
            className="mt-4 w-full rounded-[9px] border border-line bg-transparent px-4 py-[13px] font-mono text-[13px] font-bold uppercase tracking-[1px] text-acid transition-colors hover:border-acid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid"
          >
            {copied ? "Copied" : "Copy session JSON"}
          </button>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            What happens next: send this JSON to the team. They anchor this one
            root on-chain into HeroProofAnchor, and every action above is then
            independently verifiable, forever, from one transaction. You keep
            your receipt; the chain keeps the proof.
          </p>
        </div>
      )}

      <p className="mt-10 border-t border-line2 pt-4 font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
        {MANDATE.role} · {MANDATE.version} · testnet · no token · tamper evident
      </p>
    </main>
  );
}
