"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { PersonCard as Card, PersonLink, Ref } from "@/lib/people";

export type Jump = { book: string; chapter: number; verse: number };

type Props = {
  id: string;
  label: string;
  at: { book: string; bookName: string; chapter: number; verse: number };
  onOpenPerson: (id: string, label: string) => void;
  onJump: (to: Jump) => void;
};

type Loaded = { key: string; card: Card | null; error: string | null };

// Cards depend only on (person, position, whole story), so keep them for the session.
const cache = new Map<string, Promise<Card>>();

function fetchCard(id: string, at: Props["at"], whole: boolean) {
  const key = `${id}|${at.book}.${at.chapter}.${at.verse}|${whole}`;
  let pending = cache.get(key);
  if (!pending) {
    const query = new URLSearchParams({ id, at: `${at.book}.${at.chapter}.${at.verse}` });
    if (whole) query.set("all", "1");
    pending = fetch(`/api/person?${query}`).then(async (res) => {
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      return body.card as Card;
    });
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return { key, pending };
}

const REPORT_URL = "https://github.com/martinindalecio/verse-lens/issues/new";

export function PersonCard({ id, label, at, onOpenPerson, onJump }: Props) {
  const [whole, setWhole] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const { key, pending } = fetchCard(id, at, whole);

  useEffect(() => {
    let live = true;
    pending.then(
      (card) => live && setLoaded({ key, card, error: null }),
      (error: Error) => live && setLoaded({ key, card: null, error: error.message }),
    );
    return () => {
      live = false;
    };
  }, [key, pending]);

  const current = loaded?.key === key ? loaded : null;
  const card = current?.card;

  if (current?.error) {
    return <p className="text-base">Couldn’t load this person. {current.error}</p>;
  }
  if (!card) {
    return (
      <div className="space-y-3" aria-busy="true">
        <h2 className="text-3xl font-bold">{label}</h2>
        <div className="h-4 w-3/4 rounded bg-chip" />
        <div className="h-4 w-1/2 rounded bg-chip" />
      </div>
    );
  }

  const here = `${at.bookName} ${at.chapter}:${at.verse}`;
  const otherForms = card.aliases.filter((a) => a.form !== label);
  const reportHref = `${REPORT_URL}?${new URLSearchParams({ title: `Mistake: ${card.name} (${here})`, body: `Person: ${card.id}\nWhere: ${here}\n\nWhat's wrong:\n` })}`;

  if (card.kind === "divine") {
    return (
      <div className="space-y-4">
        <h2 className="text-3xl font-bold">{label}</h2>
        <p className="text-lg">{card.brief || card.description}</p>
        <p className="text-base text-muted">
          Appears throughout the Bible. These names are marked by simple rules, so a few may be wrong.
        </p>
        <Footer reportHref={reportHref} />
      </div>
    );
  }

  const stops = showAll ? card.soFar : card.soFar.slice(0, 3);
  const pronoun = (card.pronoun ?? "Their").toLowerCase();

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-3xl font-bold leading-tight">{label}</h2>
          <p className="text-lg text-muted">{card.description}</p>
        </div>
        {otherForms.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {otherForms.map((a) => (
              <button
                key={a.form}
                type="button"
                onClick={() => onJump(a.first)}
                className="min-h-11 rounded-full bg-chip px-4 text-base"
              >
                Also called <strong>{a.form}</strong> <span className="text-muted">({refLabel(a.first)})</span>
              </button>
            ))}
          </div>
        )}
        {card.brief && (
          <div className="space-y-1">
            <p className="text-lg leading-relaxed">{card.brief}</p>
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <InfoIcon /> Description written by AI (from STEPBible, adapted by their editors)
            </p>
          </div>
        )}
        {card.notConfused.length > 0 && (
          <details className="rounded-2xl border border-line">
            <summary className="flex min-h-12 cursor-pointer items-center px-4 text-base font-bold">
              Not to be confused with {card.notConfused.length === 1 ? card.notConfused[0].name : "others"}
            </summary>
            <ul className="space-y-1 px-2 pb-2">
              {card.notConfused.map((o) => (
                <li key={o.id ?? o.name}>
                  <PersonRow link={o} onOpen={() => o.id && onOpenPerson(o.id, o.name)} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-xl font-bold">
          {card.pronoun ?? "Their"} story so far
        </h3>
        <ol className="relative space-y-1">
          {!whole && (
            <Stop marker="here" title="You are here" sub={here} />
          )}
          {stops.map((e) => {
            const range =
              e.startCh === e.endCh && e.startV === e.endV
                ? `${e.bookName} ${e.startCh}:${e.startV}`
                : e.startCh === e.endCh
                  ? `${e.bookName} ${e.startCh}:${e.startV}–${e.endV}`
                  : `${e.bookName} ${e.startCh}:${e.startV}–${e.endCh}:${e.endV}`;
            return (
              <Stop key={`${e.book}.${e.startCh}.${e.startV}`} marker={e.later ? "later" : "past"}>
                <button
                  type="button"
                  onClick={() => onJump({ book: e.book, chapter: e.startCh, verse: e.startV })}
                  className="min-h-11 text-left text-base font-bold text-accent underline underline-offset-4"
                >
                  {range}
                  {e.later && <span className="ml-2 rounded bg-chip px-1.5 py-0.5 text-sm font-normal text-foreground no-underline">Later</span>}
                </button>
                <p className="text-base leading-relaxed text-muted">“{e.snippet}”</p>
              </Stop>
            );
          })}
        </ol>
        {card.soFar.length === 0 && <p className="text-base text-muted">This is where {pronoun === "their" ? "they" : pronoun === "his" ? "he" : "she"} first appears.</p>}
        {card.soFar.length > 3 && (
          <button type="button" onClick={() => setShowAll(!showAll)} className="min-h-11 rounded-full bg-chip px-5 text-base font-bold">
            {showAll ? "Show fewer" : `Show ${card.soFar.length - 3} earlier`}
          </button>
        )}
        <label className="flex min-h-14 items-center justify-between gap-4 border-y border-line py-2">
          <span>
            <span className="block text-base font-bold">Show {pronoun} whole story</span>
            <span className="block text-sm text-muted">
              {card.laterCount > 0
                ? `Includes ${card.laterCount} later ${card.laterCount === 1 ? "appearance" : "appearances"}, after ${here}`
                : `Nothing more after ${here}`}
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={whole}
            onChange={(e) => {
              setWhole(e.target.checked);
              setShowAll(false);
            }}
            className="h-7 w-12 shrink-0 accent-[var(--accent)]"
          />
        </label>
      </section>

      {card.family.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xl font-bold">Family</h3>
          <ul className="space-y-1">
            {card.family.map((f) => (
              <li key={`${f.note}-${f.name}-${f.id}`}>
                <PersonRow link={f} onOpen={f.id ? () => onOpenPerson(f.id!, f.name) : undefined} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.appearsWith.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xl font-bold">Often named with {pronoun === "their" ? "them" : pronoun === "his" ? "him" : "her"}</h3>
          <ul className="space-y-1">
            {card.appearsWith.map((p) => (
              <li key={p.id}>
                <PersonRow link={p} onOpen={() => p.id && onOpenPerson(p.id, p.name)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <Footer reportHref={reportHref} />
    </div>
  );
}

function refLabel(r: Ref) {
  return `${r.bookName} ${r.chapter}:${r.verse}`;
}

function Stop({ marker, title, sub, children }: { marker: "here" | "past" | "later"; title?: string; sub?: string; children?: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
      <span className="flex flex-col items-center pt-1.5" aria-hidden="true">
        <span
          className={
            marker === "here"
              ? "h-5 w-5 rounded-full bg-route ring-4 ring-route/25"
              : marker === "later"
                ? "h-3.5 w-3.5 rounded-full border-[3px] border-dashed border-route"
                : "h-3.5 w-3.5 rounded-full border-[3px] border-route bg-card"
          }
        />
        <span className="mt-1 w-[3px] flex-1 bg-route/70" />
      </span>
      <div className="pb-3">
        {title && <p className="text-base font-bold">{title}</p>}
        {sub && <p className="text-base text-muted">{sub}</p>}
        {children}
      </div>
    </li>
  );
}

function PersonRow({ link, onOpen }: { link: PersonLink; onOpen?: () => void }) {
  const body = (
    <>
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-highlight text-lg font-bold text-accent">
        {link.name.charAt(0)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-lg font-bold">{link.name}</span>
        <span className="text-base text-muted">{link.note}</span>
      </span>
    </>
  );
  if (!onOpen) return <div className="flex min-h-14 items-center gap-3 px-2 py-1">{body}</div>;
  return (
    <button type="button" onClick={onOpen} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 py-1 hover:bg-chip">
      {body}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

function Footer({ reportHref }: { reportHref: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-base">
      <a href={reportHref} target="_blank" rel="noreferrer" className="min-h-11 content-center text-accent underline underline-offset-4">
        Report a mistake
      </a>
      <span className="text-sm text-muted">People data: STEPBible TIPNR, CC BY 4.0</span>
    </div>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
    </svg>
  );
}
