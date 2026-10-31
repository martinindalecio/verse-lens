"use client";

import { useRef, useState } from "react";
import { ContextPanel, type ContextState } from "./context-panel";

type Props = {
  bookSlug: string;
  bookName: string;
  chapter: number;
  verses: string[];
};

type Range = { start: number; end: number };

export function ChapterReader({ bookSlug, bookName, chapter, verses }: Props) {
  const [range, setRange] = useState<Range | null>(null);
  const [state, setState] = useState<ContextState>({ status: "idle" });
  const panelRef = useRef<HTMLDivElement>(null);

  // Tap a verse to select it, tap another to extend the range to it, tap
  // inside the selection to clear it. Works the same with touch and mouse.
  function selectVerse(n: number) {
    if (!range) {
      setRange({ start: n, end: n });
    } else if (n >= range.start && n <= range.end) {
      setRange(null);
    } else {
      setRange({ start: Math.min(range.start, n), end: Math.max(range.end, n) });
    }
  }

  async function explain() {
    if (!range) return;
    const reference = `${bookName} ${chapter}:${range.start === range.end ? range.start : `${range.start}-${range.end}`}`;
    setState({ status: "loading", reference });
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const res = await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book: bookSlug, chapter, ...range }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setState({ status: "done", reference, context: body.context });
    } catch (error) {
      setState({ status: "error", reference, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const inRange = (n: number) => range !== null && n >= range.start && n <= range.end;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <article className="font-serif text-lg leading-relaxed">
        {verses.map((text, i) => {
          const n = i + 1;
          return (
            <span
              key={n}
              role="button"
              tabIndex={0}
              onClick={() => selectVerse(n)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectVerse(n);
                }
              }}
              className={`cursor-pointer rounded-sm transition-colors ${inRange(n) ? "bg-highlight" : "hover:bg-highlight/50"}`}
            >
              <sup className="mr-0.5 font-sans text-xs text-accent">{n}</sup>
              {text}{" "}
            </span>
          );
        })}
      </article>

      <aside className="pb-20 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pb-0">
        {/* Fixed to the bottom of the screen on phones so it's reachable while reading. */}
        <div className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t border-line bg-background px-4 py-3 lg:static lg:mb-4 lg:border-0 lg:p-0">
          <button
            type="button"
            onClick={explain}
            disabled={!range || state.status === "loading"}
            className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
          >
            {range ? "Explain this passage" : "Select a verse"}
          </button>
          <span className="text-sm text-muted">
            {range
              ? `v. ${range.start}${range.end !== range.start ? `–${range.end}` : ""} · tap another verse to extend`
              : "Tap a verse to start"}
          </span>
        </div>
        <div ref={panelRef} className="scroll-mt-4">
          <ContextPanel state={state} />
        </div>
      </aside>
    </div>
  );
}
