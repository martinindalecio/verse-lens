// Pure logic behind person cards: no database, no files. src/lib/people.ts feeds it rows and a
// chapter loader; keeping it here makes it testable on its own.

/** [book index, chapter, verse] */
export type Pos = [number, number, number];

export const cmpPos = (a: Pos, b: Pos) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export type Mention = { pos: Pos; start: number; end: number };
export type EpisodeSpan = { start: Pos; end: Pos };
export type StoryStop = EpisodeSpan & { later: boolean };

/**
 * The "so far" timeline relative to the reader's position `at`, newest first.
 * Without `whole`: only episodes that start before `at` ("You are here" excludes the verse being
 * read), and an episode still running at `at` is cut off there. `laterCount` counts episodes that
 * start at or after `at`, whether or not they are shown. `episodes` must be sorted by start.
 */
export function storyStops(episodes: EpisodeSpan[], at: Pos, whole: boolean): { stops: StoryStop[]; laterCount: number } {
  const earlier = (x: Pos) => cmpPos(x, at) < 0;
  const upTo = (x: Pos) => cmpPos(x, at) <= 0;
  const visible = whole ? episodes : episodes.filter((e) => earlier(e.start));
  const stops = [...visible].reverse().map((e) => ({
    start: e.start,
    end: !whole && !upTo(e.end) ? at : e.end,
    later: !earlier(e.start),
  }));
  return { stops, laterCount: episodes.filter((e) => !earlier(e.start)).length };
}

/** Mentions grouped by chapter, keeping their order. `mentions` must be sorted. */
export function byChapter(mentions: Mention[]): Mention[][] {
  const groups: Mention[][] = [];
  for (const m of mentions) {
    const first = groups.at(-1)?.[0];
    if (first && first.pos[0] === m.pos[0] && first.pos[1] === m.pos[1]) groups.at(-1)!.push(m);
    else groups.push([m]);
  }
  return groups;
}

type ChapterLoader = (pos: Pos) => Promise<string[] | null | undefined>;

/**
 * Where each name form (the text of a mention span) first appears, in reading order.
 * `mentions` must be sorted; `names` are the person's name forms in this translation.
 *
 * A span's text is as long as the span, so a mention can only show a name of the same length.
 * Chapters are read only while they hold a mention that could add something: one as long as a
 * name not found yet, or as long as no name at all (an override written differently). Without
 * this, one name that never appears in the text made the old loop read every mention. It also
 * stops, as before, once as many forms are found as there are names. Chapters load in parallel
 * batches that double in size, so even a long walk takes a few round trips.
 */
export async function findFirstForms(mentions: Mention[], names: string[], loadChapter: ChapterLoader, firstBatch = 4): Promise<Map<string, Pos>> {
  const found = new Map<string, Pos>();
  const nameCount = new Set(names).size;
  const nameLengths = new Set(names.map((n) => n.length));
  const pending = new Set(names);
  const full = () => found.size >= nameCount;
  const needs = (m: Mention) => {
    const length = m.end - m.start;
    if (!nameLengths.has(length)) return true;
    for (const n of pending) if (n.length === length) return true;
    return false;
  };

  const groups = byChapter(mentions);
  for (let i = 0, size = firstBatch; !full(); size *= 2) {
    const batch: Mention[][] = [];
    for (; i < groups.length && batch.length < size; i++) if (groups[i].some(needs)) batch.push(groups[i]);
    if (!batch.length) break;
    const chapters = await Promise.all(batch.map((g) => loadChapter(g[0].pos)));
    batch.forEach((group, j) => {
      for (const m of group) {
        if (full()) return;
        if (!needs(m)) continue;
        const form = chapters[j]?.[m.pos[2] - 1]?.slice(m.start, m.end);
        if (form && !found.has(form)) {
          found.set(form, m.pos);
          pending.delete(form);
        }
      }
    });
  }
  return found;
}
