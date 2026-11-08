"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ChapterPeople, Span } from "@/lib/people";
import { ContextPanel, type ContextState } from "./context-panel";
import { PersonCard, type Jump } from "./person-card";

export type ReturnTo = { book: string; bookName: string; chapter: number; verse: number };

type Props = {
  bookSlug: string;
  bookName: string;
  chapter: number;
  verses: string[];
  people: ChapterPeople;
  initialVerse: number | null;
  initialPerson: string | null;
  returnTo: ReturnTo | null;
};

type Range = { start: number; end: number };

// One history for everything in the sheet: person cards, passages and tab switches.
type View =
  | { type: "person"; id: string; label: string; verse: number }
  | { type: "passage"; start: number; end: number }
  | { type: "hint"; tab: Tab };

type Tab = "passage" | "people";
type SheetSize = "closed" | "medium" | "large";

const rangeKey = (r: Range) => `${r.start}-${r.end}`;

export function ChapterReader({ bookSlug, bookName, chapter, verses, people, initialVerse, initialPerson, returnTo }: Props) {
  const router = useRouter();
  const [views, setViews] = useState<View[]>(() => {
    if (!initialPerson) return [];
    const verse = initialVerse ?? 1;
    // Title the card with the name as written at this verse ("Saul" in Acts 9, "Paul" later).
    const span = people.spans[verse]?.find((s) => s[2] === initialPerson);
    const label = span ? verses[verse - 1].slice(span[0], span[1]) : (people.people[initialPerson]?.name ?? "");
    return [{ type: "person", id: initialPerson, label, verse }];
  });
  const [size, setSize] = useState<SheetSize>(initialPerson ? "medium" : "closed");
  const [range, setRange] = useState<Range | null>(null);
  const [contexts, setContexts] = useState<Record<string, ContextState>>({});
  const [flash, setFlash] = useState<number | null>(initialVerse);
  const [jumpedFrom, setJumpedFrom] = useState<number | null>(null);
  const dragStart = useRef<number | null>(null);
  // Next.js can keep the previous chapter mounted (hidden), so look verses up within this one.
  const articleRef = useRef<HTMLElement>(null);

  const top = views.at(-1);
  const tab: Tab = top?.type === "person" || (top?.type === "hint" && top.tab === "people") ? "people" : "passage";
  const readingVerse = top?.type === "person" ? top.verse : top?.type === "passage" ? top.start : 1;

  useEffect(() => {
    if (initialVerse) scrollToVerse(initialVerse);
  }, [initialVerse]);

  function scrollToVerse(n: number) {
    articleRef.current?.querySelector(`[data-verse="${n}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlash(n);
  }

  function push(view: View) {
    setViews((v) => [...v, view]);
    setSize((s) => (s === "closed" ? "medium" : s));
  }

  function openPerson(id: string, label: string, verse: number) {
    push({ type: "person", id, label, verse });
  }

  // Tap a verse to select it, tap another to extend the range, tap inside the selection to clear it.
  function selectVerse(n: number) {
    let next: Range | null;
    if (!range) next = { start: n, end: n };
    else if (n >= range.start && n <= range.end) next = null;
    else next = { start: Math.min(range.start, n), end: Math.max(range.end, n) };
    setRange(next);
    if (next) {
      const view: View = { type: "passage", ...next };
      setViews((v) => (v.at(-1)?.type === "passage" ? [...v.slice(0, -1), view] : [...v, view]));
      setSize((s) => (s === "closed" ? "medium" : s));
    } else if (top?.type === "passage") {
      back();
    }
  }

  function back() {
    if (views.length <= 1) return close();
    const prev = views.at(-2);
    setViews((v) => v.slice(0, -1));
    if (prev?.type === "passage") setRange({ start: prev.start, end: prev.end });
  }

  function close() {
    setSize("closed");
    setViews([]);
    setRange(null);
  }

  function showTab(next: Tab) {
    if (next === tab) return;
    const last = [...views].reverse().find((v) => (next === "people" ? v.type === "person" : v.type === "passage"));
    push(last ?? { type: "hint", tab: next });
  }

  function jump(to: Jump) {
    if (to.book === bookSlug && to.chapter === chapter) {
      setJumpedFrom(readingVerse);
      scrollToVerse(to.verse);
      return;
    }
    const query = new URLSearchParams({ v: String(to.verse), from: `${bookSlug}.${chapter}.${readingVerse}` });
    if (top?.type === "person") query.set("person", top.id);
    router.push(`/read/${to.book}/${to.chapter}?${query}`);
  }

  async function explain(r: Range) {
    const key = rangeKey(r);
    const reference = `${bookName} ${chapter}:${r.start === r.end ? r.start : `${r.start}-${r.end}`}`;
    setContexts((c) => ({ ...c, [key]: { status: "loading", reference } }));
    try {
      const res = await fetch("/api/v1/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book: bookSlug, chapter, ...r }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? `Request failed (${res.status})`);
      setContexts((c) => ({ ...c, [key]: { status: "done", reference, context: body.context } }));
    } catch (error) {
      setContexts((c) => ({ ...c, [key]: { status: "error", reference, message: error instanceof Error ? error.message : String(error) } }));
    }
  }

  function onHandleUp(y: number) {
    const start = dragStart.current;
    dragStart.current = null;
    if (start === null) return;
    const dy = y - start;
    if (Math.abs(dy) < 8) setSize((s) => (s === "large" ? "medium" : "large"));
    else if (dy < 0) setSize("large");
    else if (size === "large") setSize("medium");
    else close();
  }

  const inRange = (n: number) => range !== null && n >= range.start && n <= range.end;
  const prev = views.at(-2);
  const backLabel = !prev ? null : prev.type === "person" ? prev.label : prev.type === "passage" ? `Verse ${prev.start}${prev.end !== prev.start ? `–${prev.end}` : ""}` : "Back";

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:gap-10">
      <div className={size !== "closed" ? "max-lg:pb-[60dvh]" : ""}>
        {(returnTo || jumpedFrom) && (
          <div className="sticky top-2 z-10 mb-4 flex justify-center">
            {jumpedFrom ? (
              <button
                type="button"
                onClick={() => {
                  scrollToVerse(jumpedFrom);
                  setJumpedFrom(null);
                }}
                className="min-h-11 rounded-full bg-foreground px-5 text-base font-bold text-background shadow-lg"
              >
                ← Back to verse {jumpedFrom}
              </button>
            ) : (
              returnTo && (
                <Link
                  href={`/read/${returnTo.book}/${returnTo.chapter}?${new URLSearchParams({
                    v: String(returnTo.verse),
                    ...(top?.type === "person" ? { person: top.id } : {}),
                  })}`}
                  className="flex min-h-11 items-center rounded-full bg-foreground px-5 text-base font-bold text-background shadow-lg"
                >
                  ← Back to {returnTo.bookName} {returnTo.chapter}:{returnTo.verse}
                </Link>
              )
            )}
          </div>
        )}

        <article ref={articleRef} className="text-[1.1875rem] leading-[1.8]">
          {verses.map((text, i) => {
            const n = i + 1;
            return (
              <span
                key={n}
                data-verse={n}
                onClick={() => selectVerse(n)}
                onAnimationEnd={() => setFlash(null)}
                className={`cursor-pointer scroll-mt-24 rounded-md ${inRange(n) ? "bg-highlight shadow-[inset_0_-2px_0_var(--accent)]" : ""} ${flash === n ? "animate-[pulse_1.2s_ease-in-out_2]" : ""}`}
              >
                <button
                  type="button"
                  aria-pressed={inRange(n)}
                  aria-label={`Verse ${n}, select to explain`}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectVerse(n);
                  }}
                  className="mr-1 align-super text-[0.8125rem] font-bold leading-none text-accent"
                >
                  {n}
                </button>
                <VerseText
                  text={text}
                  spans={people.spans[n] ?? []}
                  people={people}
                  active={top?.type === "person" && top.verse === n ? top.id : null}
                  onOpen={(id, label) => openPerson(id, label, n)}
                />{" "}
              </span>
            );
          })}
        </article>
      </div>

      <aside
        data-size={size}
        aria-label="Study panel"
        className="flex flex-col bg-card max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:rounded-t-[1.75rem] max-lg:shadow-[0_-10px_36px_rgba(21,38,46,0.16)] max-lg:transition-[height,transform] max-lg:duration-300 max-lg:data-[size=closed]:invisible max-lg:data-[size=closed]:h-[55dvh] max-lg:data-[size=closed]:translate-y-full max-lg:data-[size=medium]:h-[55dvh] max-lg:data-[size=large]:h-[92dvh] lg:sticky lg:top-4 lg:h-[calc(100dvh-2rem)] lg:rounded-2xl lg:border lg:border-line"
      >
        <div className="shrink-0 border-b border-line px-3 pb-2">
          <button
            type="button"
            aria-label={size === "large" ? "Make panel smaller" : "Make panel bigger"}
            onPointerDown={(e) => (dragStart.current = e.clientY)}
            onPointerUp={(e) => onHandleUp(e.clientY)}
            onPointerCancel={() => (dragStart.current = null)}
            className="mx-auto flex h-7 w-24 touch-none items-center justify-center lg:hidden"
          >
            <span className="h-1.5 w-10 rounded-full bg-line" />
          </button>
          <div className="flex items-center gap-2 lg:pt-3">
            {backLabel && (
              <button type="button" onClick={back} className="flex min-h-11 max-w-[8rem] items-center gap-1 rounded-xl px-2 text-base font-bold text-accent">
                <span aria-hidden="true">←</span>
                <span className="truncate">{backLabel}</span>
              </button>
            )}
            <div role="tablist" aria-label="Panel" className="grid flex-1 grid-cols-2 rounded-xl bg-chip p-1">
              {(["passage", "people"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => showTab(t)}
                  className={`min-h-10 rounded-lg text-base ${tab === t ? "bg-card font-bold shadow-sm" : "text-muted"}`}
                >
                  {t === "passage" ? "Passage" : "People"}
                </button>
              ))}
            </div>
            <button type="button" onClick={close} aria-label="Close panel" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-chip lg:hidden">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {top?.type === "person" ? (
            <PersonCard
              key={`${top.id}-${top.verse}`}
              id={top.id}
              label={top.label}
              at={{ book: bookSlug, bookName, chapter, verse: top.verse }}
              onOpenPerson={(id, label) => openPerson(id, label, top.verse)}
              onJump={jump}
            />
          ) : top?.type === "passage" ? (
            <PassageView
              title={`${bookName} ${chapter}:${top.start}${top.end !== top.start ? `–${top.end}` : ""}`}
              range={top}
              people={people}
              state={contexts[rangeKey(top)]}
              onExplain={() => explain(top)}
              onOpenPerson={(id, label) => openPerson(id, label, top.start)}
            />
          ) : (
            <Hint tab={top?.type === "hint" ? top.tab : "people"} />
          )}
        </div>
      </aside>
    </div>
  );
}

function VerseText({
  text,
  spans,
  people,
  active,
  onOpen,
}: {
  text: string;
  spans: Span[];
  people: ChapterPeople;
  active: string | null;
  onOpen: (id: string, label: string) => void;
}) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end, id] of spans) {
    if (start < at) continue;
    if (start > at) parts.push(text.slice(at, start));
    const person = people.people[id];
    const label = text.slice(start, end);
    parts.push(
      <button
        key={start}
        type="button"
        className="person-name"
        data-divine={person?.divine || undefined}
        aria-current={active === id ? "true" : undefined}
        style={person?.color != null ? ({ "--person-color": `var(--p${person.color})` } as CSSProperties) : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(id, label);
        }}
      >
        {label}
      </button>,
    );
    at = end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

function PassageView({
  title,
  range,
  people,
  state,
  onExplain,
  onOpenPerson,
}: {
  title: string;
  range: Range;
  people: ChapterPeople;
  state: ContextState | undefined;
  onExplain: () => void;
  onOpenPerson: (id: string, label: string) => void;
}) {
  const here = new Map<string, string>();
  for (let v = range.start; v <= range.end; v++) {
    for (const [, , id] of people.spans[v] ?? []) {
      const p = people.people[id];
      if (p && !p.divine) here.set(id, p.name);
    }
  }
  return (
    <div className="space-y-5">
      <h2 className="text-3xl font-bold">{title}</h2>
      {here.size > 0 && (
        <div className="space-y-2">
          <h3 className="text-lg font-bold">People here</h3>
          <div className="flex flex-wrap gap-2">
            {[...here].map(([id, name]) => (
              <button
                key={id}
                type="button"
                onClick={() => onOpenPerson(id, name)}
                className="min-h-11 rounded-full border-2 px-4 text-base font-bold"
                style={{ borderColor: `var(--p${people.people[id]?.color ?? 0})` }}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
      {!state || state.status === "idle" ? (
        <div className="space-y-2">
          <button type="button" onClick={onExplain} className="min-h-12 rounded-xl bg-accent px-5 text-base font-bold text-card">
            Explain what’s happening here
          </button>
          <p className="text-sm text-muted">Written by AI from the verses, with the basis for each claim.</p>
        </div>
      ) : (
        <ContextPanel state={state} />
      )}
    </div>
  );
}

function Hint({ tab }: { tab: Tab }) {
  return (
    <p className="text-lg text-muted">
      {tab === "people"
        ? "Tap an underlined name to see who it is, where they’ve been, and who they’re connected to."
        : "Tap a verse to see what’s happening there. Tap a second verse to include a range."}
    </p>
  );
}
