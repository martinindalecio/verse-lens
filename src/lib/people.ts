import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOOKS, getChapter } from "./bible";

// People data built by scripts/build-people.py from STEPBible TIPNR (CC BY 4.0).
// Read from data/people/ for now; the same data loads into Postgres via scripts/load-people.py.

type PersonRecord = {
  id: string;
  name: string;
  type: "Male" | "Female" | "Divine";
  description: string;
  briefest?: string;
  brief?: string;
  short?: string;
  parents?: string[];
  siblings?: string[];
  partners?: string[];
  offspring?: string[];
  names?: string[];
};

/** [start, end, personId, flag?]; flag 1 = inferred from chapter, 2 = hand-checked, 3 = rule (divine). */
export type Span = [number, number, string, number?];

export type ChapterPerson = { name: string; divine: boolean; color: number | null };

export type ChapterPeople = {
  spans: Record<number, Span[]>;
  people: Record<string, ChapterPerson>;
};

export type Ref = { book: string; bookName: string; chapter: number; verse: number };

export type Episode = {
  book: string;
  bookName: string;
  startCh: number;
  startV: number;
  endCh: number;
  endV: number;
  snippet: string;
  /** After the reader's position (only present when the whole story is shown). */
  later: boolean;
};

export type PersonLink = { id: string | null; name: string; note: string };

export type PersonCard = {
  id: string;
  name: string;
  kind: "person" | "divine";
  pronoun: "His" | "Her" | null;
  description: string;
  brief: string;
  aliases: { form: string; first: Ref }[];
  notConfused: PersonLink[];
  soFar: Episode[];
  earlierCount: number;
  laterCount: number;
  family: PersonLink[];
  appearsWith: PersonLink[];
};

const DATA = path.join(process.cwd(), "data", "people");
// Mentions of one person within this many verses of each other in a chapter form one episode.
const EPISODE_GAP = 5;
// Per-person colors in the text; the CSS defines --p0 ... --p7.
const PALETTE_SIZE = 8;

let peoplePromise: Promise<Map<string, PersonRecord>> | undefined;
const mentionCache = new Map<string, Promise<Record<string, Span[]>>>();
let indexPromise: Promise<Map<string, [number, number, number][]>> | undefined;

function loadPeople() {
  peoplePromise ??= readFile(path.join(DATA, "people.json"), "utf-8").then(
    (raw) => new Map((JSON.parse(raw) as PersonRecord[]).map((p) => [p.id, p])),
  );
  return peoplePromise;
}

function loadMentions(slug: string) {
  let pending = mentionCache.get(slug);
  if (!pending) {
    pending = readFile(path.join(DATA, "mentions", `${slug}.json`), "utf-8")
      .then((raw) => JSON.parse(raw) as Record<string, Span[]>)
      .catch(() => ({}));
    mentionCache.set(slug, pending);
  }
  return pending;
}

/** personId -> [bookIndex, chapter, verse] for every mention, in Bible order. */
function loadIndex() {
  indexPromise ??= (async () => {
    const index = new Map<string, [number, number, number][]>();
    for (const [b, book] of BOOKS.entries()) {
      const verses = await loadMentions(book.slug);
      for (const [key, spans] of Object.entries(verses)) {
        const [ch, v] = key.split(":").map(Number);
        for (const [, , pid] of spans) {
          const list = index.get(pid) ?? [];
          const last = list.at(-1);
          if (!last || last[0] !== b || last[1] !== ch || last[2] !== v) list.push([b, ch, v]);
          index.set(pid, list);
        }
      }
    }
    for (const list of index.values()) list.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
    return index;
  })();
  return indexPromise;
}

export async function getChapterPeople(slug: string, chapter: number): Promise<ChapterPeople> {
  const [people, verses] = await Promise.all([loadPeople(), loadMentions(slug)]);
  const spans: Record<number, Span[]> = {};
  const chapterPeople: Record<string, ChapterPerson> = {};
  let nextColor = 0;
  for (const [key, list] of Object.entries(verses)) {
    const [ch, v] = key.split(":").map(Number);
    if (ch === chapter) spans[v] = list;
  }
  for (const v of Object.keys(spans).map(Number).sort((a, b) => a - b)) {
    for (const [, , pid] of spans[v]) {
      if (chapterPeople[pid]) continue;
      const p = people.get(pid);
      const divine = p?.type === "Divine" || pid.startsWith("divine:");
      chapterPeople[pid] = { name: p?.name ?? pid, divine, color: divine ? null : nextColor++ % PALETTE_SIZE };
    }
  }
  return { spans, people: chapterPeople };
}

const nameOf = (id: string) => id.split("@")[0].split("|")[0].replace(/_/g, " ");

function ref(b: number, chapter: number, verse: number): Ref {
  return { book: BOOKS[b].slug, bookName: BOOKS[b].name, chapter, verse };
}

function snippet(text: string, max = 110) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

export async function getPersonCard(id: string, at: { book: string; chapter: number; verse: number }, whole: boolean): Promise<PersonCard | null> {
  const [people, index] = await Promise.all([loadPeople(), loadIndex()]);
  const p = people.get(id);
  const atBook = BOOKS.findIndex((b) => b.slug === at.book);
  if (!p || atBook < 0) return null;
  const divine = p.type === "Divine";
  const pos: [number, number, number] = [atBook, at.chapter, at.verse];
  const before = (x: [number, number, number]) =>
    x[0] < pos[0] || (x[0] === pos[0] && (x[1] < pos[1] || (x[1] === pos[1] && x[2] <= pos[2])));

  const card: PersonCard = {
    id,
    name: p.name,
    kind: divine ? "divine" : "person",
    pronoun: p.type === "Male" ? "His" : p.type === "Female" ? "Her" : null,
    description: p.description,
    brief: p.brief ?? p.short ?? "",
    aliases: [],
    notConfused: [],
    soFar: [],
    earlierCount: 0,
    laterCount: 0,
    family: [],
    appearsWith: [],
  };
  if (divine) return card;

  const mentions = index.get(id) ?? [];

  // Episodes: runs of mentions in one chapter, at most EPISODE_GAP verses apart.
  const episodes: { start: [number, number, number]; end: [number, number, number] }[] = [];
  for (const m of mentions) {
    const run = episodes.at(-1);
    if (run && run.end[0] === m[0] && run.end[1] === m[1] && m[2] - run.end[2] <= EPISODE_GAP) run.end = m;
    else episodes.push({ start: m, end: m });
  }
  // "So far" is what came before this verse; the verse itself is "You are here".
  const earlier = (x: [number, number, number]) => before(x) && !(x[0] === pos[0] && x[1] === pos[1] && x[2] === pos[2]);
  const visible = whole ? episodes : episodes.filter((e) => earlier(e.start));
  card.laterCount = episodes.length - episodes.filter((e) => earlier(e.start)).length;
  const newestFirst = [...visible].reverse();
  for (const e of newestFirst) {
    const end = !whole && !before(e.end) ? pos : e.end;
    const verses = await getChapter(BOOKS[e.start[0]].slug, e.start[1]);
    card.soFar.push({
      book: BOOKS[e.start[0]].slug,
      bookName: BOOKS[e.start[0]].name,
      startCh: e.start[1],
      startV: e.start[2],
      endCh: end[1],
      endV: end[2],
      snippet: snippet(verses?.[e.start[2] - 1] ?? ""),
      later: !earlier(e.start),
    });
  }

  // Name forms and where each first appears, from the tagged text.
  const forms = new Map<string, Ref>();
  for (const m of mentions) {
    if (forms.size === (p.names?.length ?? 0)) break;
    const verses = await getChapter(BOOKS[m[0]].slug, m[1]);
    const spans = (await loadMentions(BOOKS[m[0]].slug))[`${m[1]}:${m[2]}`] ?? [];
    for (const [s, e, pid] of spans) {
      const form = verses?.[m[2] - 1]?.slice(s, e);
      if (pid === id && form && !forms.has(form)) forms.set(form, ref(m[0], m[1], m[2]));
    }
  }
  card.aliases = [...forms].map(([form, first]) => ({ form, first }));

  // Other people who share a name form, most-mentioned first.
  const shared = new Set(forms.keys());
  const others: { link: PersonLink; count: number }[] = [];
  for (const other of people.values()) {
    if (other.id === id || other.type === "Divine" || !other.names?.some((n) => shared.has(n))) continue;
    others.push({ link: { id: other.id, name: other.name, note: other.brief ?? other.description }, count: index.get(other.id)?.length ?? 0 });
  }
  card.notConfused = others.sort((a, b) => b.count - a.count).slice(0, 4).map((o) => o.link);

  for (const [relation, list] of [
    ["parent", p.parents],
    ["sibling", p.siblings],
    ["spouse", p.partners],
    ["child", p.offspring],
  ] as const) {
    for (const rid of new Set(list ?? [])) {
      card.family.push({ id: people.has(rid) ? rid : null, name: nameOf(rid), note: relation });
    }
  }

  // People named in the same verses so far (data, not AI).
  const together = new Map<string, number>();
  for (const m of mentions) {
    if (!whole && !before(m)) break;
    const spans = (await loadMentions(BOOKS[m[0]].slug))[`${m[1]}:${m[2]}`] ?? [];
    for (const pid of new Set(spans.map((s) => s[2]))) {
      if (pid !== id && !pid.startsWith("divine:")) together.set(pid, (together.get(pid) ?? 0) + 1);
    }
  }
  const familyIds = new Set(card.family.map((f) => f.id));
  card.appearsWith = [...together]
    .filter(([pid]) => !familyIds.has(pid) && people.get(pid)?.type !== "Divine")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pid, count]) => ({ id: pid, name: people.get(pid)?.name ?? nameOf(pid), note: `${count} ${count === 1 ? "verse" : "verses"} together` }));

  return card;
}
