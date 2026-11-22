import { describe, expect, it, vi } from "vitest";
import { getChapter } from "@/lib/bible";
import { getSections, sectionAt } from "@/lib/sections";
import { sectionUnits } from "@/lib/units";

// Database-backed people lookups are mocked; everything else reads the real data/ files.
vi.mock("@/lib/people", () => ({
  getChapterPeople: vi.fn(async (_slug: string, chapter: number) =>
    chapter === 6
      ? {
          // Acts 6:5 "...They chose Stephen, ... and Philip, Prochorus, ..."
          spans: {
            5: [
              [50, 57, "Stephen@Act.6.5-"],
              [114, 120, "Philip@Act.6.5-"],
              [163, 170, "Nicolaus@Act.6.5"],
            ],
            8: [[0, 7, "Stephen@Act.6.5-"]],
            2: [[4, 9, "divine:god"]],
          },
          people: {
            "Stephen@Act.6.5-": { name: "Stephen", divine: false, color: 0 },
            "Philip@Act.6.5-": { name: "Philip", divine: false, color: 1 },
            "Nicolaus@Act.6.5": { name: "Nicolaus", divine: false, color: 2 },
            "divine:god": { name: "God", divine: true, color: null },
          },
        }
      : { spans: {}, people: {} },
  ),
}));
vi.mock("@/lib/db", () => ({
  db: () => ({
    query: vi.fn(async () => [
      { id: "Stephen@Act.6.5-", description: "The first Christian martyr" },
      { id: "Philip@Act.6.5-", description: "One of the seven, later an evangelist" },
    ]),
  }),
}));

const { crossReferences, getFrequentStrongs, keyTerms, neighbours, parseOpenBibleRef, parseParallel, peopleForPrompt, unitPeople } =
  await import("@/lib/passage-data");

async function actsContext(chapter: number, verse: number) {
  const sections = await getSections("acts");
  const section = sectionAt(sections, chapter, verse)!;
  const lengths = await Promise.all(Array.from({ length: 28 }, (_, i) => getChapter("acts", i + 1)));
  const chapterLength = (ch: number) => lengths[ch - 1]?.length ?? 0;
  const unit = sectionUnits(section, chapterLength)[0];
  return { book: "acts", sections, sectionIndex: sections.indexOf(section), unit, chapterLength };
}

describe("reference parsing", () => {
  it("parses BSB parallels", () => {
    expect(parseParallel("1 Timothy 3:8–13")).toEqual({ book: "1-timothy", start: [3, 8], end: [3, 13] });
    expect(parseParallel("1 Chronicles 15:29—16:3")).toEqual({ book: "1-chronicles", start: [15, 29], end: [16, 3] });
    expect(parseParallel("Song 1:1–17")?.book).toBe("song-of-solomon");
    expect(parseParallel("Joshua–Malachi")).toBeNull();
  });

  it("parses OpenBible references, including hyphenated book slugs", () => {
    expect(parseOpenBibleRef("luke.1.3")).toEqual({ book: "luke", start: [1, 3], end: [1, 3] });
    expect(parseOpenBibleRef("1-peter.2.21-1-peter.2.23")).toEqual({ book: "1-peter", start: [2, 21], end: [2, 23] });
    expect(parseOpenBibleRef("nowhere.1.1")).toBeNull();
  });
});

describe("passage data for Acts 6:1-7, The Choosing of the Seven", () => {
  it("is one unit titled by the BSB heading", async () => {
    const ctx = await actsContext(6, 3);
    expect(ctx.unit).toEqual({ title: "The Choosing of the Seven", start: [6, 1], end: [6, 7], part: null });
  });

  it("names the neighbouring sections", async () => {
    const { before, after } = neighbours(await actsContext(6, 1));
    expect(before).toEqual({ title: "Gamaliel’s Advice", start: [5, 33], end: [5, 42], reference: "5:33–42" });
    expect(after).toEqual({ title: "The Arrest of Stephen", start: [6, 8], end: [6, 15], reference: "6:8–15" });
  });

  it("lists the BSB parallel first, then OpenBible references by votes", async () => {
    const refs = await crossReferences(await actsContext(6, 1));
    expect(refs[0]).toEqual({ label: "1 Timothy 3:8–13", to: { book: "1-timothy", chapter: 3, verse: 8 }, source: "bsb", votes: null });
    expect(refs.length).toBeGreaterThan(1);
    expect(refs.length).toBeLessThanOrEqual(8);
    const open = refs.filter((r) => r.source === "openbible");
    expect(open.length).toBeGreaterThan(0);
    // Sorted by votes, no duplicates, nothing inside Acts 6:1-7 or overlapping 1 Timothy 3:8-13.
    const votes = open.map((r) => r.votes!);
    expect([...votes].sort((a, b) => b - a)).toEqual(votes);
    expect(new Set(refs.map((r) => r.label)).size).toBe(refs.length);
    for (const r of open) {
      expect(r.to!.book === "acts" && r.to!.chapter === 6 && r.to!.verse <= 7).toBe(false);
      expect(r.to!.book === "1-timothy" && r.to!.chapter === 3 && r.to!.verse >= 8 && r.to!.verse <= 13).toBe(false);
    }
  });

  it("picks informative Greek words, not function words", async () => {
    const terms = await keyTerms(await actsContext(6, 1));
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.length).toBeLessThanOrEqual(8);
    const frequent = await getFrequentStrongs();
    expect(frequent.has("G3588")).toBe(true); // the article
    expect(frequent.has("G2532")).toBe(true); // "and"
    for (const t of terms) {
      expect(t.strongs).toMatch(/^G\d+$/);
      expect(frequent.has(t.strongs)).toBe(false);
      expect(t.lemma && t.gloss).toBeTruthy();
    }
    // The passage is about serving (diakonia) tables and widows.
    const ids = terms.map((t) => t.strongs);
    expect(ids.some((id) => ["G1248", "G1247", "G5503", "G5132"].includes(id))).toBe(true);
  });

  it("lists the people named in the unit, without divine names, with TIPNR descriptions", async () => {
    const ctx = await actsContext(6, 1);
    const people = await unitPeople(ctx);
    expect(people.map((p) => [p.name, p.usualName, p.firstRef, p.description])).toEqual([
      ["Stephen", null, "Acts 6:5", "The first Christian martyr"],
      ["Philip", null, "Acts 6:5", "One of the seven, later an evangelist"],
      // Named as written in the BSB ("Nicolas"), with TIPNR's usual name kept alongside.
      ["Nicolas", "Nicolaus", "Acts 6:5", ""],
    ]);
    const prompt = peopleForPrompt(people);
    expect(prompt).toContain("- Philip = One of the seven, later an evangelist (Acts 6:5)");
    expect(prompt).toContain("- Nicolas = also called Nicolaus (Acts 6:5)");
  });
});
