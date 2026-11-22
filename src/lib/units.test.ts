import { describe, expect, it } from "vitest";
import { BOOKS, getChapter } from "@/lib/bible";
import { getSections } from "@/lib/sections";
import { MAX_UNIT_VERSES, cmpChV, formatChVRange, sectionUnits, unitAt, versesBetween, type ChV, type SectionLike } from "@/lib/units";

const lengths = (map: Record<number, number>) => (ch: number) => map[ch] ?? 0;
const section = (start: ChV, end: ChV, subheadings: SectionLike["subheadings"] = []): SectionLike => ({
  title: "S",
  start,
  end,
  subheadings,
});
const ranges = (units: ReturnType<typeof sectionUnits>) => units.map((u) => formatChVRange(u.start, u.end));

describe("sectionUnits", () => {
  it("keeps a section of at most 30 verses whole", () => {
    const units = sectionUnits(section([6, 1], [6, 7]), lengths({ 6: 15 }));
    expect(units).toEqual([{ title: "S", start: [6, 1], end: [6, 7], part: null }]);
    expect(sectionUnits(section([1, 1], [1, 30]), lengths({ 1: 40 }))).toHaveLength(1);
  });

  it("splits at subheadings first", () => {
    const s = section([1, 1], [1, 40], [
      { title: "A", start: [1, 1] },
      { title: "B", start: [1, 21] },
    ]);
    const units = sectionUnits(s, lengths({ 1: 40 }));
    expect(ranges(units)).toEqual(["1:1–20", "1:21–40"]);
    expect(units.map((u) => u.title)).toEqual(["S: A", "S: B"]);
    expect(units.map((u) => u.part)).toEqual([
      { index: 1, count: 2 },
      { index: 2, count: 2 },
    ]);
  });

  it("keeps verses before the first subheading under the section title", () => {
    const units = sectionUnits(section([1, 1], [1, 40], [{ title: "B", start: [1, 11] }]), lengths({ 1: 40 }));
    expect(ranges(units)).toEqual(["1:1–10", "1:11–40"]);
    expect(units[0].title).toBe("S");
  });

  it("splits at chapter boundaries when there are no subheadings", () => {
    const units = sectionUnits(section([3, 20], [5, 10]), lengths({ 3: 30, 4: 25, 5: 30 }));
    expect(ranges(units)).toEqual(["3:20–30", "4:1–25", "5:1–10"]);
  });

  it("splits into even parts of at most 30 when nothing else is left", () => {
    expect(ranges(sectionUnits(section([1, 1], [1, 31]), lengths({ 1: 31 })))).toEqual(["1:1–16", "1:17–31"]);
    expect(ranges(sectionUnits(section([1, 1], [1, 61]), lengths({ 1: 61 })))).toEqual(["1:1–21", "1:22–42", "1:43–61"]);
  });

  it("cascades: a subheading part that is still too long is split again", () => {
    const s = section([1, 1], [2, 30], [{ title: "B", start: [1, 6] }]);
    const units = sectionUnits(s, lengths({ 1: 40, 2: 30 }));
    expect(ranges(units)).toEqual(["1:1–5", "1:6–23", "1:24–40", "2:1–30"]);
  });

  it("finds the unit holding a verse", () => {
    const units = sectionUnits(section([3, 20], [5, 10]), lengths({ 3: 30, 4: 25, 5: 30 }));
    expect(unitAt(units, [4, 3])?.start).toEqual([4, 1]);
    expect(unitAt(units, [5, 11])).toBeNull();
  });

  it("covers every real BSB section with contiguous units of at most 30 verses", async () => {
    let long = 0;
    for (const book of BOOKS) {
      const chapters = await Promise.all(Array.from({ length: book.chapters }, (_, i) => getChapter(book.slug, i + 1)));
      const len = (ch: number) => chapters[ch - 1]?.length ?? 0;
      for (const s of await getSections(book.slug)) {
        const all = versesBetween(s.start, s.end, len);
        if (all.length > MAX_UNIT_VERSES) long++;
        const units = sectionUnits(s, len);
        const covered = units.flatMap((u) => versesBetween(u.start, u.end, len));
        expect(covered).toEqual(all);
        for (const u of units) {
          expect(versesBetween(u.start, u.end, len).length).toBeLessThanOrEqual(MAX_UNIT_VERSES);
          expect(cmpChV(u.start, u.end)).toBeLessThanOrEqual(0);
        }
      }
    }
    expect(long).toBe(73);
  });
});
