"use client";

// Copy-on-click mono text. Shows a brief floating "copied" chip, never an
// alert. Keyboard focusable, full value in the title attribute.

import { useCallback, useEffect, useRef, useState } from "react";

export function CopyText({
  value,
  display,
  className = "",
  title,
}: {
  value: string;
  display: string;
  className?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API unavailable (insecure context): fall back quietly.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        // nothing else to try; stay silent rather than alert
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1200);
  }, [value]);

  return (
    <button
      type="button"
      onClick={onCopy}
      title={title ?? value}
      aria-label={`Copy ${title ?? value}`}
      className={`group relative inline-flex cursor-pointer items-center font-mono focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-acid ${className}`}
    >
      <span className="underline decoration-dim decoration-dotted underline-offset-2 transition-colors group-hover:decoration-acid">
        {display}
      </span>
      {copied && (
        <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-acid bg-bg px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-acid">
          copied
        </span>
      )}
    </button>
  );
}
