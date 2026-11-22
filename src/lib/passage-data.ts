import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOOKS, getBook, getChapter } from "./bible";
import type { CrossReference, KeyTerm, NeighbourUnit, PassagePerson } from "./context-schema";
import { db } from "./db";
import { getChapterPeople } from "./people";
import type { Section } from "./sections";
import { cmpChV, formatChVRange, sectionUnits, versesBetween, type ChV, type ChapterLength, type Unit } from "./units";

// The parts of a passage explanation that come from data, not from the model:
//   before / after   neighbouring units, titled by the BSB's headings (public domain)
//   crossReferences  the BSB's parallel passages, then OpenBible.info cross references (CC BY)
//   keyTerms         STEPBible TAGNT/TAHOT words with Strong's numbers (CC BY 4.0)
//   people           our name mentions (STEPBible TIPNR identities), also given to the prompt

const MAX_CROSS_REFERENCES = 8;
const MAX_KEY_TERMS = 8;
/** A Strong's id in more than this share of its testament's verses is a function word ("the", "and"). */
const FREQUENT_SHARE = 0.02;

const dataFile = (...parts: string[]) => path.join(process.cwd(), "data", ...parts);

type CrossrefFile = Record<string, { ref: string; votes: number }[]>;
type WordsFile = Record<string, string[]>;
type LexiconEntry = { lemma: string; translit: string; gloss: string };

/** OpenBible.info cross references of one book, by "ch:v". */
export async function getCrossrefs(slug: string): Promise<CrossrefFile> {
  "use cache";
  if (!getBook(slug)) return {};
  return JSON.parse(await readFile(dataFile("crossrefs", `${slug}.json`), "utf-8")) as CrossrefFile;
}

/** Strong's ids per verse of one book, by "ch:v", in reading order. */
export async function getWords(slug: string): Promise<WordsFile> {
  "use cache";
  if (!getBook(slug)) return {};
  return JSON.parse(await readFile(dataFile("words", `${slug}.json`), "utf-8")) as WordsFile;
}

type Frequency = { df: Record<string, number>; verses: { G: number; H: number } };

/**
 * In how many verses each Strong's id appears, and how many verses each testament has. Read from
 * all 66 word files once per server instance (about 5 MB), then kept in memory.
 */
let frequency: Promise<Frequency> | undefined;
function getFrequency(): Promise<Frequency> {
  frequency ??= (async () => {
    const df: Record<string, number> = {};
    const verses = { G: 0, H: 0 };
    for (const book of BOOKS) {
      const words = JSON.parse(await readFile(dataFile("words", `${book.slug}.json`), "utf-8")) as WordsFile;
      for (const ids of Object.values(words)) {
        verses[book.testament === "NT" ? "G" : "H"]++;
        for (const id of new Set(ids)) df[id] = (df[id] ?? 0) + 1;
      }
    }
    return { df, verses };
  })();
  frequency.catch(() => (frequency = undefined));
  return frequency;
}

const testamentVerses = (f: Frequency, id: string) => (id.startsWith("G") ? f.verses.G : f.verses.H);

/**
 * Strong's ids in more than FREQUENT_SHARE of the verses of their testament (Greek ids against the
 * NT, Hebrew against the OT): articles, conjunctions, pronouns, "to be". Function words, skipped
 * as key terms.
 */
let frequent: Promise<Set<string>> | undefined;
export function getFrequentStrongs(): Promise<Set<string>> {
  frequent ??= getFrequency().then((f) => new Set(Object.keys(f.df).filter((id) => f.df[id] / testamentVerses(f, id) > FREQUENT_SHARE)));
  frequent.catch(() => (frequent = undefined));
  return frequent;
}

let lexicon: Promise<Record<string, LexiconEntry>> | undefined;
/** Lemma, transliteration and gloss for the given Strong's ids (missing ids are left out). */
export async function getLexiconEntries(ids: string[]): Promise<Record<string, LexiconEntry>> {
  "use cache";
  lexicon ??= readFile(dataFile("words", "lexicon.json"), "utf-8").then((s) => JSON.parse(s) as Record<string, LexiconEntry>);
  const all = await lexicon.catch((error) => {
    lexicon = undefined;
    throw error;
  });
  return Object.fromEntries(ids.filter((id) => all[id]).map((id) => [id, all[id]]));
}

// ---- references -----------------------------------------------------------------------------

const BOOK_BY_NAME = new Map<string, string>([...BOOKS.map((b) => [b.name, b.slug] as const), ["Song", "song-of-solomon"]]);
const bookName = (slug: string) => getBook(slug)?.name ?? slug;

type Range = { book: string; start: ChV; end: ChV };

/** "Luke 1:1–4", "Psalms 16:1–11", "1 Chronicles 15:29—16:3", "Genesis 4—9"; null if unparseable. */
export function parseParallel(label: string): Range | null {
  const m = /^(.+?) (\d+)(?::(\d+))?(?:[–—-](\d+)(?::(\d+))?)?$/.exec(label.trim());
  if (!m) return null;
  const book = BOOK_BY_NAME.get(m[1]);
  if (!book) return null;
  const ch = Number(m[2]);
  const v = m[3] ? Number(m[3]) : 1;
  let end: ChV;
  if (m[5]) end = [Number(m[4]), Number(m[5])];
  else if (m[4]) end = m[3] ? [ch, Number(m[4])] : [Number(m[4]), 999];
  else end = m[3] ? [ch, v] : [ch, 999];
  return { book, start: [ch, v], end };
}

/** OpenBible's "acts.9.4" or "acts.9.4-acts.9.6" (book slugs can hold hyphens: "1-peter.2.21-1-peter.2.23"). */
export function parseOpenBibleRef(ref: string): Range | null {
  const m = /^([a-z0-9-]+?)\.(\d+)\.(\d+)(?:-([a-z0-9-]+?)\.(\d+)\.(\d+))?$/.exec(ref);
  if (!m || !getBook(m[1])) return null;
  const start: ChV = [Number(m[2]), Number(m[3])];
  // A range into another book (rare) is shown from its start only.
  const end: ChV = m[4] === m[1] ? [Number(m[5]), Number(m[6])] : start;
  return { book: m[1], start, end };
}

export function formatRange(r: Range): string {
  return `${bookName(r.book)} ${formatChVRange(r.start, r.end)}`;
}

const overlaps = (a: Range, b: Range) => a.book === b.book && cmpChV(a.start, b.end) <= 0 && cmpChV(b.start, a.end) <= 0;

// ---- assembly -------------------------------------------------------------------------------

export type UnitContext = {
  book: string;
  sections: Section[];
  /** Index of the unit's section in `sections`. */
  sectionIndex: number;
  unit: Unit;
  chapterLength: ChapterLength;
};

/** The units before and after this one in the book (across section boundaries). */
export function neighbours({ sections, sectionIndex, unit, chapterLength }: UnitContext): { before: NeighbourUnit | null; after: NeighbourUnit | null } {
  const own = sectionUnits(sections[sectionIndex], chapterLength);
  const i = own.findIndex((u) => cmpChV(u.start, unit.start) === 0);
  const prev = own[i - 1] ?? (sectionIndex > 0 ? sectionUnits(sections[sectionIndex - 1], chapterLength).at(-1) : undefined);
  const next = own[i + 1] ?? (sectionIndex + 1 < sections.length ? sectionUnits(sections[sectionIndex + 1], chapterLength)[0] : undefined);
  return { before: prev ? neighbour(prev) : null, after: next ? neighbour(next) : null };
}

function neighbour(u: Unit): NeighbourUnit {
  return { title: u.title, start: u.start, end: u.end, reference: formatChVRange(u.start, u.end) };
}

/**
 * The section's BSB parallels first (all of them, they are hand-picked), then the best-voted
 * OpenBible.info references from the unit's verses (votes summed when several verses point at
 * the same place), skipping references inside the unit or overlapping one already listed.
 */
export async function crossReferences({ book, sections, sectionIndex, unit, chapterLength }: UnitContext): Promise<CrossReference[]> {
  const self: Range = { book, start: unit.start, end: unit.end };
  const out: CrossReference[] = [];
  const taken: Range[] = [self];

  for (const label of sections[sectionIndex].parallels) {
    if (out.length >= MAX_CROSS_REFERENCES) break;
    const r = parseParallel(label);
    out.push({ label, to: r ? { book: r.book, chapter: r.start[0], verse: r.start[1] } : null, source: "bsb", votes: null });
    if (r) taken.push(r);
  }

  const file = await getCrossrefs(book);
  const votes = new Map<string, number>();
  const order: string[] = [];
  for (const [ch, v] of versesBetween(unit.start, unit.end, chapterLength)) {
    for (const { ref, votes: n } of file[`${ch}:${v}`] ?? []) {
      if (!votes.has(ref)) order.push(ref);
      votes.set(ref, (votes.get(ref) ?? 0) + n);
    }
  }
  const ranked = order.map((ref, i) => ({ ref, votes: votes.get(ref)!, i })).sort((a, b) => b.votes - a.votes || a.i - b.i);
  for (const { ref, votes: n } of ranked) {
    if (out.length >= MAX_CROSS_REFERENCES) break;
    const r = parseOpenBibleRef(ref);
    if (!r || taken.some((t) => overlaps(t, r))) continue;
    taken.push(r);
    out.push({ label: formatRange(r), to: { book: r.book, chapter: r.start[0], verse: r.start[1] }, source: "openbible", votes: n });
  }
  return out;
}

/**
 * The unit's most informative original-language words: ids that are not function words, ranked
 * by count in the unit times inverse document frequency (rare words used here stand out).
 */
export async function keyTerms({ book, unit, chapterLength }: UnitContext): Promise<KeyTerm[]> {
  const [words, f, frequent] = await Promise.all([getWords(book), getFrequency(), getFrequentStrongs()]);
  const counts = new Map<string, number>();
  for (const [ch, v] of versesBetween(unit.start, unit.end, chapterLength)) {
    for (const id of words[`${ch}:${v}`] ?? []) if (!frequent.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const score = (id: string, n: number) => n * Math.log((testamentVerses(f, id) || 1) / (f.df[id] ?? 1));
  const ranked = [...counts].sort((a, b) => score(b[0], b[1]) - score(a[0], a[1]) || a[0].localeCompare(b[0]));
  const lexicon = await getLexiconEntries(ranked.slice(0, MAX_KEY_TERMS * 2).map(([id]) => id));
  return ranked
    .filter(([id]) => lexicon[id])
    .slice(0, MAX_KEY_TERMS)
    .map(([id, count]) => ({ strongs: id, ...lexicon[id], count }));
}

/**
 * People named in the unit (not divine names), in order of first mention, with TIPNR's brief.
 * Needs the database; null when the lookup fails (as opposed to [] for a unit naming nobody), so
 * the caller can explain the passage without people but not store that weaker answer.
 */
export async function unitPeople({ book, unit }: Pick<UnitContext, "book" | "unit">): Promise<PassagePerson[] | null> {
  try {
    const chapters: number[] = [];
    for (let ch = unit.start[0]; ch <= unit.end[0]; ch++) chapters.push(ch);
    const [mentions, texts] = await Promise.all([
      Promise.all(chapters.map((ch) => getChapterPeople(book, ch))),
      Promise.all(chapters.map((ch) => getChapter(book, ch))),
    ]);
    const found = new Map<string, PassagePerson>();
    chapters.forEach((ch, i) => {
      const { spans, people } = mentions[i];
      const verseNumbers = Object.keys(spans).map(Number).sort((a, b) => a - b);
      for (const v of verseNumbers) {
        if (cmpChV([ch, v], unit.start) < 0 || cmpChV([ch, v], unit.end) > 0) continue;
        for (const [start, end, id] of spans[v]) {
          const p = people[id];
          if (!p || p.divine || found.has(id)) continue;
          const name = texts[i]?.[v - 1]?.slice(start, end) || p.name;
          found.set(id, {
            id,
            name,
            usualName: name === p.name ? null : p.name,
            description: "",
            firstRef: `${bookName(book)} ${ch}:${v}`,
            first: [ch, v],
          });
        }
      }
    });
    if (found.size === 0) return [];
    const rows = (await db().query(
      `select p.id, coalesce(t.body, p.description) as description
         from people p left join person_texts t on t.person_id = p.id and t.lang = 'en' and t.kind = 'brief'
        where p.id = any($1::text[])`,
      [[...found.keys()]],
    )) as { id: string; description: string }[];
    for (const r of rows) found.get(r.id)!.description = r.description ?? "";
    return [...found.values()];
  } catch (error) {
    console.warn("people for passage context unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** One line per person for the prompt: "Philip = one of the seven, later an evangelist (Acts 6:5)". */
export function peopleForPrompt(people: PassagePerson[]): string {
  return people
    .map((p) => {
      const who = [p.usualName && p.usualName !== p.name ? `also called ${p.usualName}` : "", p.description].filter(Boolean).join("; ");
      return `- ${p.name}${who ? ` = ${who}` : ""} (${p.firstRef})`;
    })
    .join("\n");
}
