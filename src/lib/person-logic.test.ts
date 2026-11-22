import { describe, expect, it, vi } from "vitest";
import { byChapter, cmpPos, findFirstForms, storyStops, type EpisodeSpan, type Mention, type Pos } from "./person-logic";

const ep = (start: Pos, end: Pos): EpisodeSpan => ({ start, end });

describe("cmpPos", () => {
  it("orders by book, then chapter, then verse", () => {
    expect(cmpPos([1, 1, 1], [2, 1, 1])).toBeLessThan(0);
    expect(cmpPos([1, 9, 9], [1, 10, 1])).toBeLessThan(0);
    expect(cmpPos([1, 2, 3], [1, 2, 4])).toBeLessThan(0);
    expect(cmpPos([1, 2, 5], [1, 2, 4])).toBeGreaterThan(0);
    expect(cmpPos([1, 2, 3], [1, 2, 3])).toBe(0);
  });
});

describe("byChapter", () => {
  const m = (b: number, c: number, v: number): Mention => ({ pos: [b, c, v], start: 0, end: 1 });

  it("returns [] for no mentions", () => {
    expect(byChapter([])).toEqual([]);
  });

  it("groups consecutive mentions of the same chapter, keeping order", () => {
    const groups = byChapter([m(1, 1, 1), m(1, 1, 4), m(1, 2, 1), m(2, 2, 1), m(2, 2, 2)]);
    expect(groups.map((g) => g.map((x) => x.pos))).toEqual([
      [
        [1, 1, 1],
        [1, 1, 4],
      ],
      [[1, 2, 1]],
      [
        [2, 2, 1],
        [2, 2, 2],
      ],
    ]);
  });

  it("does not merge the same chapter number in different books", () => {
    expect(byChapter([m(1, 1, 1), m(2, 1, 1)])).toHaveLength(2);
  });
});

describe("storyStops", () => {
  const at: Pos = [0, 5, 10];
  const before = ep([0, 1, 1], [0, 1, 5]);
  const before2 = ep([0, 3, 1], [0, 3, 9]);
  const after = ep([0, 7, 1], [0, 7, 3]);
  const after2 = ep([0, 8, 1], [0, 8, 3]);

  it("shows only earlier episodes, newest first, without whole", () => {
    const { stops, laterCount } = storyStops([before, before2, after, after2], at, false);
    expect(stops.map((s) => s.start)).toEqual([before2.start, before.start]);
    expect(stops.every((s) => !s.later)).toBe(true);
    expect(laterCount).toBe(2);
  });

  it("leaves episodes that finished before the position uncut", () => {
    expect(storyStops([before], at, false).stops[0].end).toEqual(before.end);
  });

  it("excludes an episode starting exactly at the position (counted as later)", () => {
    const here = ep([0, 5, 10], [0, 5, 12]);
    const { stops, laterCount } = storyStops([before, here], at, false);
    expect(stops.map((s) => s.start)).toEqual([before.start]);
    expect(laterCount).toBe(1);
  });

  it("cuts an episode that straddles the position at the position", () => {
    const straddle = ep([0, 5, 1], [0, 6, 4]);
    const { stops } = storyStops([before, straddle], at, false);
    expect(stops[0]).toEqual({ start: [0, 5, 1], end: at, later: false });
    expect(stops[1].end).toEqual(before.end);
  });

  it("keeps an episode that ends exactly at the position uncut", () => {
    const endsHere = ep([0, 5, 1], [0, 5, 10]);
    expect(storyStops([endsHere], at, false).stops[0].end).toEqual([0, 5, 10]);
  });

  it("whole mode shows everything newest first, marks later ones, and never cuts", () => {
    const straddle = ep([0, 5, 1], [0, 6, 4]);
    const { stops, laterCount } = storyStops([before, straddle, after], at, true);
    expect(stops.map((s) => s.start)).toEqual([after.start, straddle.start, before.start]);
    expect(stops.map((s) => s.later)).toEqual([true, false, false]);
    expect(stops[1].end).toEqual([0, 6, 4]);
    expect(laterCount).toBe(1);
  });

  it("whole mode marks an episode starting at the position as later", () => {
    expect(storyStops([ep([0, 5, 10], [0, 5, 12])], at, true).stops[0].later).toBe(true);
  });

  it("handles no episodes", () => {
    expect(storyStops([], at, false)).toEqual({ stops: [], laterCount: 0 });
  });

  it("does not mutate the input order", () => {
    const eps = [before, before2];
    storyStops(eps, at, false);
    expect(eps).toEqual([before, before2]);
  });
});

describe("findFirstForms", () => {
  // Each chapter is an array of verse strings; mentions index into them.
  const chapters: Record<string, string[]> = {
    "0.1": ["Saul went out", "then Saul came"],
    "0.2": ["Paul spoke", "x"],
    "0.3": ["Paul and Saul", "y"],
    "0.4": ["Paulus said", "z"],
  };
  const key = (p: Pos) => `${p[0]}.${p[1]}`;
  const makeLoader = () => vi.fn(async (p: Pos) => chapters[key(p)] ?? null);
  const mention = (b: number, c: number, v: number, start: number, end: number): Mention => ({ pos: [b, c, v], start, end });

  it("finds the first appearance of each form", async () => {
    const mentions = [mention(0, 1, 1, 0, 4), mention(0, 1, 2, 5, 9), mention(0, 2, 1, 0, 4)];
    const found = await findFirstForms(mentions, ["Saul", "Paul"], makeLoader());
    expect(found.get("Saul")).toEqual([0, 1, 1]);
    expect(found.get("Paul")).toEqual([0, 2, 1]);
    expect(found.size).toBe(2);
  });

  it("stops early once every name is found", async () => {
    const mentions = [mention(0, 1, 1, 0, 4), mention(0, 2, 1, 0, 4), mention(0, 3, 1, 0, 4), mention(0, 4, 1, 0, 4)];
    const loader = makeLoader();
    const found = await findFirstForms(mentions, ["Saul", "Paul"], loader, 1);
    expect([...found.keys()].sort()).toEqual(["Paul", "Saul"]);
    // Batch of 1 loads chapter 1 (Saul); the next batch of 2 loads chapters 2 and 3 (Paul found); chapter 4 is never read.
    expect(loader.mock.calls.map((c) => key(c[0]))).toEqual(["0.1", "0.2", "0.3"]);
  });

  it("loads each chapter once even with several mentions in it", async () => {
    const mentions = [mention(0, 1, 1, 0, 4), mention(0, 1, 2, 5, 9), mention(0, 3, 1, 0, 4), mention(0, 3, 1, 9, 13)];
    const loader = makeLoader();
    await findFirstForms(mentions, ["Saul", "Paul", "Never"], loader);
    const keys = loader.mock.calls.map((c) => key(c[0]));
    expect(keys).toEqual(["0.1", "0.3"]);
  });

  it("a name that never appears in the text does not produce a wrong result", async () => {
    const mentions = [mention(0, 1, 1, 0, 4), mention(0, 2, 1, 0, 4)];
    const found = await findFirstForms(mentions, ["Saul", "Paul", "Barnabas"], makeLoader());
    expect([...found.keys()].sort()).toEqual(["Paul", "Saul"]);
    expect(found.has("Barnabas")).toBe(false);
  });

  it("does not read chapters whose mentions cannot add a form", async () => {
    // After "Saul" is found, chapter 3's 4-long span cannot add anything: no 4-long name is pending.
    const mentions = [mention(0, 1, 1, 0, 4), mention(0, 3, 1, 0, 4)];
    const loader = makeLoader();
    await findFirstForms(mentions, ["Saul"], loader, 1); // batch of 1 so loading is sequential
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("records an override span whose text matches no name, without blocking other forms", async () => {
    // "Paulus" (length 6) is not one of the names; it is still reported as its own form.
    const mentions = [mention(0, 1, 1, 0, 4), mention(0, 4, 1, 0, 6)];
    const found = await findFirstForms(mentions, ["Saul", "Paul"], makeLoader());
    expect(found.get("Saul")).toEqual([0, 1, 1]);
    expect(found.get("Paulus")).toEqual([0, 4, 1]);
    expect(found.has("Paul")).toBe(false);
  });

  it("ignores spans outside the loaded text and chapters that fail to load", async () => {
    const mentions = [mention(0, 1, 1, 0, 4), mention(0, 1, 9, 0, 4), mention(0, 9, 1, 0, 4)];
    const found = await findFirstForms(mentions, ["Saul", "Paul"], makeLoader());
    expect([...found.entries()]).toEqual([["Saul", [0, 1, 1]]]);
  });

  it("returns an empty map for no mentions and loads nothing", async () => {
    const loader = makeLoader();
    expect((await findFirstForms([], ["Saul"], loader)).size).toBe(0);
    expect(loader).not.toHaveBeenCalled();
  });
});
