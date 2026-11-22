"use client";

import { useEffect, useId, useRef, useState } from "react";

type Props = {
  /** `person:<id>` or `passage:<book>.<chapter>.<verse>` (a section's start verse). */
  target: string;
  className?: string;
};

type Status = "idle" | "open" | "sending" | "sent" | "failed";

const MAX = 2000;

/** "Report a mistake": a link-style button that expands an inline form. Posts to /api/v1/reports. */
export function ReportMistake(props: Props) {
  // Keyed by target so a different card or passage starts a fresh report.
  return <ReportForm key={props.target} {...props} />;
}

function ReportForm({ target, className = "" }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (status === "open") textRef.current?.focus();
  }, [status]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch("/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, message: message.trim(), lang: "en" }),
      });
      if (res.ok) {
        setStatus("sent");
        setMessage("");
        return;
      }
      const body = await res.json().catch(() => null);
      setError(res.status === 429 ? "Too many reports right now. Please try again later." : (body?.error?.message ?? "Couldn’t send your report."));
      setStatus("failed");
    } catch {
      setError("Couldn’t reach the server. Check your connection.");
      setStatus("failed");
    }
  }

  function cancel() {
    setStatus("idle");
    setError("");
    // Return focus to the button that opened the form once it is back.
    requestAnimationFrame(() => openRef.current?.focus());
  }

  if (status === "sent") {
    return (
      <p role="status" className={`min-h-11 content-center text-base ${className}`}>
        Thank you. Your report was sent.
      </p>
    );
  }

  if (status === "idle") {
    return (
      <button
        ref={openRef}
        type="button"
        onClick={() => setStatus("open")}
        className={`min-h-11 text-left text-base text-accent underline underline-offset-4 ${className}`}
      >
        Report a mistake
      </button>
    );
  }

  const sending = status === "sending";
  return (
    <form onSubmit={send} className={`w-full space-y-3 rounded-2xl border border-line bg-card p-4 ${className}`}>
      <label htmlFor={`${id}-msg`} className="block text-base font-bold">
        What’s wrong?
      </label>
      <textarea
        id={`${id}-msg`}
        ref={textRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={MAX}
        rows={4}
        required
        disabled={sending}
        aria-describedby={`${id}-hint`}
        className="block w-full rounded-xl border border-line bg-background p-3 text-base leading-relaxed"
      />
      <p id={`${id}-hint`} className="text-sm text-muted">
        Sent to the editors as plain text. Please don’t include personal details.
      </p>
      {status === "failed" && (
        <p role="alert" className="text-base font-bold">
          {error} Your text is still here; you can try again.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={sending || !message.trim()}
          className="min-h-11 rounded-full bg-accent px-5 text-base font-bold text-background disabled:opacity-50"
        >
          {sending ? "Sending…" : status === "failed" ? "Try again" : "Send"}
        </button>
        <button type="button" onClick={cancel} disabled={sending} className="min-h-11 rounded-full bg-chip px-5 text-base font-bold">
          Cancel
        </button>
      </div>
    </form>
  );
}
