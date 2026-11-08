import { BOOKS, getChapter } from "./bible";
import { db } from "./db";

// People data built by scripts/build-people.py from STEPBible TIPNR (CC BY 4.0) and loaded into
// Neon Postgres by scripts/load-people.mjs. Verse text itself always comes from data/bsb/.

const TRANSLATION = "bsb";
const LANG = "en";
// Per-person colors in the text; the CSS defines --p0 ... --p7.
const PALETTE_SIZE = 8;
const BOOK_SLUGS = BOOKS.map((b) => b.slug);
const bookIndex = (slug: string) => BOOK_SLUGS.indexOf(slug);

/** [start, end, personId] of a name in the verse text. */
export type Span = [number, number, string];

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

export async function getChapterPeople(slug: string, chapter: number): Promise<ChapterPeople> {
  const rows = (await db().query(
    `select m.verse, m.start_char, m.end_char, m.person_id, p.name, p.kind
       from person_mentions m join people p on p.id = m.person_id
      where m.translation = $1 and m.book = $2 and m.chapter = $3
      order by m.verse, m.start_char`,
    [TRANSLATION, slug, chapter],
  )) as { verse: number; start_char: number; end_char: number; person_id: string; name: string; kind: string }[];

  const spans: Record<number, Span[]> = {};
  const people: Record<string, ChapterPerson> = {};
  let nextColor = 0;
  for (const r of rows) {
    (spans[r.verse] ??= []).push([r.start_char, r.end_char, r.person_id]);
    if (!people[r.person_id]) {
      const divine = r.kind === "Divine";
      people[r.person_id] = { name: r.name, divine, color: divine ? null : nextColor++ % PALETTE_SIZE };
    }
  }
  return { spans, people };
}

function ref(b: number, chapter: number, verse: number): Ref {
  return { book: BOOKS[b].slug, bookName: BOOKS[b].name, chapter, verse };
}

function snippet(text: string, max = 110) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

type Pos = [number, number, number];
const cmp = (a: Pos, b: Pos) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const RELATION_ORDER = ["parent", "sibling", "partner", "child"];
const RELATION_LABEL: Record<string, string> = { parent: "parent", sibling: "sibling", partner: "spouse", child: "child" };

export async function getPersonCard(id: string, at: { book: string; chapter: number; verse: number }, whole: boolean): Promise<PersonCard | null> {
  const atBook = bookIndex(at.book);
  if (atBook < 0) return null;
  const sql = db();
  const [personRows, textRows] = await Promise.all([
    sql.query(`select id, name, kind, description from people where id = $1`, [id]),
    sql.query(`select kind, body from person_texts where person_id = $1 and lang = $2`, [id, LANG]),
  ]);
  const p = personRows[0] as { id: string; name: string; kind: string; description: string } | undefined;
  if (!p) return null;
  const texts = Object.fromEntries((textRows as { kind: string; body: string }[]).map((t) => [t.kind, t.body]));
  const divine = p.kind === "Divine";
  const pos: Pos = [atBook, at.chapter, at.verse];
  // Up to and including the verse being read; "earlier" excludes it ("You are here").
  const before = (x: Pos) => cmp(x, pos) <= 0;
  const earlier = (x: Pos) => cmp(x, pos) < 0;

  const card: PersonCard = {
    id,
    name: p.name,
    kind: divine ? "divine" : "person",
    pronoun: p.kind === "Male" ? "His" : p.kind === "Female" ? "Her" : null,
    description: p.description,
    brief: texts.brief ?? texts.short ?? "",
    aliases: [],
    notConfused: [],
    soFar: [],
    earlierCount: 0,
    laterCount: 0,
    family: [],
    appearsWith: [],
  };
  if (divine) return card;

  const [mentionRows, episodeRows, familyRows, togetherRows, nameRows] = await Promise.all([
    sql.query(`select book, chapter, verse, start_char, end_char from person_mentions where person_id = $1 and translation = $2`, [id, TRANSLATION]),
    sql.query(`select book, start_ch, start_v, end_ch, end_v from episodes where person_id = $1`, [id]),
    sql.query(
      `select r.related_id, r.relation, p.id as known_id, p.name as known_name
         from relationships r left join people p on p.id = r.related_id
        where r.person_id = $1`,
      [id],
    ),
    // People named in the same verses so far (data, not AI).
    sql.query(
      `select m2.person_id, p.name, count(distinct (m2.book, m2.chapter, m2.verse))::int as verses
         from person_mentions m1
         join person_mentions m2 on m2.translation = m1.translation and m2.book = m1.book
                                and m2.chapter = m1.chapter and m2.verse = m1.verse and m2.person_id <> m1.person_id
         join people p on p.id = m2.person_id and p.kind <> 'Divine'
        where m1.person_id = $1 and m1.translation = $2
          and ($3 or (array_position($4::text[], m1.book) - 1, m1.chapter, m1.verse) <= ($5::int, $6::int, $7::int))
        group by 1, 2 order by verses desc, 2 limit 10`,
      [id, TRANSLATION, whole, BOOK_SLUGS, atBook, at.chapter, at.verse],
    ),
    sql.query(`select count(*)::int as n from person_names where person_id = $1 and translation = $2`, [id, TRANSLATION]),
  ]);

  const mentions = (mentionRows as { book: string; chapter: number; verse: number; start_char: number; end_char: number }[])
    .map((m) => ({ pos: [bookIndex(m.book), m.chapter, m.verse] as Pos, start: m.start_char, end: m.end_char }))
    .sort((a, b) => cmp(a.pos, b.pos) || a.start - b.start);

  const episodes = (episodeRows as { book: string; start_ch: number; start_v: number; end_ch: number; end_v: number }[])
    .map((e) => ({ start: [bookIndex(e.book), e.start_ch, e.start_v] as Pos, end: [bookIndex(e.book), e.end_ch, e.end_v] as Pos }))
    .sort((a, b) => cmp(a.start, b.start));
  const visible = whole ? episodes : episodes.filter((e) => earlier(e.start));
  card.laterCount = episodes.filter((e) => !earlier(e.start)).length;
  for (const e of [...visible].reverse()) {
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

  // Name forms as written in the text, and where each first appears.
  const forms = new Map<string, Ref>();
  const formCount = (nameRows[0] as { n: number }).n;
  for (const m of mentions) {
    if (forms.size >= formCount) break;
    const verses = await getChapter(BOOKS[m.pos[0]].slug, m.pos[1]);
    const form = verses?.[m.pos[2] - 1]?.slice(m.start, m.end);
    if (form && !forms.has(form)) forms.set(form, ref(...m.pos));
  }
  card.aliases = [...forms].map(([form, first]) => ({ form, first }));

  // Other people who share a name form, most-mentioned first.
  if (forms.size) {
    const others = (await sql.query(
      `select p.id, p.name, coalesce(t.body, p.description) as note,
              (select count(*) from person_mentions m where m.person_id = p.id)::int as mentions
         from people p left join person_texts t on t.person_id = p.id and t.kind = 'brief' and t.lang = $3
        where p.id <> $1 and p.kind <> 'Divine'
          and exists (select 1 from person_names n where n.person_id = p.id and n.form = any($2::text[]))
        order by mentions desc limit 4`,
      [id, [...forms.keys()], LANG],
    )) as { id: string; name: string; note: string }[];
    card.notConfused = others.map((o) => ({ id: o.id, name: o.name, note: o.note }));
  }

  const family = familyRows as { related_id: string; relation: string; known_id: string | null; known_name: string | null }[];
  family.sort((a, b) => RELATION_ORDER.indexOf(a.relation) - RELATION_ORDER.indexOf(b.relation));
  card.family = family.map((f) => ({
    id: f.known_id,
    name: f.known_name ?? f.related_id.split("@")[0].split("|")[0].replace(/_/g, " "),
    note: RELATION_LABEL[f.relation] ?? f.relation,
  }));

  const familyIds = new Set(card.family.map((f) => f.id));
  card.appearsWith = (togetherRows as { person_id: string; name: string; verses: number }[])
    .filter((t) => !familyIds.has(t.person_id))
    .slice(0, 5)
    .map((t) => ({ id: t.person_id, name: t.name, note: `${t.verses} ${t.verses === 1 ? "verse" : "verses"} together` }));

  return card;
}
