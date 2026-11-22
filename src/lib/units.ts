// Passage context is explained per BSB section ("The Choosing of the Seven"). Most sections are
// short; the 73 longer than MAX_UNIT_VERSES are split into "units" so one explanation never
// covers too much text: at the section's subheadings, else at chapter boundaries, else into
// evenly sized parts of at most MAX_UNIT_VERSES. Pure functions only: no file or network access.

export const MAX_UNIT_VERSES = 30;

/** [chapter, verse] */
export type ChV = [number, number];

export type SectionLike = {
  title: string;
  start: ChV;
  end: ChV;
  subheadings: { title: string; start: ChV }[];
};

export type Unit = {
  /** The section's title, or "Section title: Subheading" when split at a subheading. */
  title: string;
  start: ChV;
  end: ChV;
  /** Set when the section is split: this unit's 1-based place among its parts. */
  part: { index: number; count: number } | null;
};

/** Number of verses in a chapter of the section's book. */
export type ChapterLength = (chapter: number) => number;

export const cmpChV = (a: ChV, b: ChV) => a[0] - b[0] || a[1] - b[1];

/** All verses from start to end inclusive, in order (may cross chapters). */
export function versesBetween(start: ChV, end: ChV, chapterLength: ChapterLength): ChV[] {
  const out: ChV[] = [];
  for (let ch = start[0]; ch <= end[0]; ch++) {
    const first = ch === start[0] ? start[1] : 1;
    const last = ch === end[0] ? end[1] : chapterLength(ch);
    for (let v = first; v <= last; v++) out.push([ch, v]);
  }
  return out;
}

type Span = { title: string; verses: ChV[] };

/** Splits verses at the given start positions (each opens a new span). */
function splitAt(verses: ChV[], starts: { title: string; start: ChV }[], fallbackTitle: string): Span[] {
  const spans: Span[] = [];
  for (const verse of verses) {
    const opener = starts.find((s) => cmpChV(s.start, verse) === 0);
    if (opener || spans.length === 0) spans.push({ title: opener?.title ?? fallbackTitle, verses: [] });
    spans[spans.length - 1].verses.push(verse);
  }
  return spans;
}

/** Evenly sized parts of at most `max` verses (31 verses -> 16 + 15, not 30 + 1). */
function chunk(span: Span, max: number): Span[] {
  const n = Math.ceil(span.verses.length / max);
  if (n <= 1) return [span];
  const size = Math.ceil(span.verses.length / n);
  const out: Span[] = [];
  for (let i = 0; i < span.verses.length; i += size) out.push({ title: span.title, verses: span.verses.slice(i, i + size) });
  return out;
}

function byChapter(span: Span): Span[] {
  const starts = [...new Set(span.verses.map(([ch]) => ch))].map((ch) => ({ title: span.title, start: span.verses.find((v) => v[0] === ch)! }));
  return splitAt(span.verses, starts, span.title);
}

/** The units a section is explained in, in order; one unit when the section is short enough. */
export function sectionUnits(section: SectionLike, chapterLength: ChapterLength, max = MAX_UNIT_VERSES): Unit[] {
  const verses = versesBetween(section.start, section.end, chapterLength);
  if (verses.length <= max) return [{ title: section.title, start: section.start, end: section.end, part: null }];

  // Subheadings inside the section (one at the section's first verse just renames the first part).
  const inside = section.subheadings.filter((s) => cmpChV(s.start, section.start) >= 0 && cmpChV(s.start, section.end) <= 0);
  let spans: Span[] =
    inside.length > 0
      ? splitAt(
          verses,
          inside.map((s) => ({ title: `${section.title}: ${s.title}`, start: s.start })),
          section.title,
        )
      : [{ title: section.title, verses }];

  // Anything still too long: chapter boundaries, then even parts.
  spans = spans.flatMap((s) => (s.verses.length > max ? byChapter(s) : [s]));
  spans = spans.flatMap((s) => (s.verses.length > max ? chunk(s, max) : [s]));

  return spans.map((s, i) => ({
    title: s.title,
    start: s.verses[0],
    end: s.verses[s.verses.length - 1],
    part: { index: i + 1, count: spans.length },
  }));
}

/** The unit containing chapter:verse, or null. */
export function unitAt(units: Unit[], at: ChV): Unit | null {
  return units.find((u) => cmpChV(u.start, at) <= 0 && cmpChV(at, u.end) <= 0) ?? null;
}

/** "6:1–7" or "6:1–7:3" (chapter and verses of a unit, without the book). */
export function formatChVRange(start: ChV, end: ChV): string {
  if (cmpChV(start, end) === 0) return `${start[0]}:${start[1]}`;
  if (start[0] === end[0]) return `${start[0]}:${start[1]}–${end[1]}`;
  return `${start[0]}:${start[1]}–${end[0]}:${end[1]}`;
}
