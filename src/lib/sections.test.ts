import { describe, expect, it } from "vitest";
import { getSections, sectionAt, type Section } from "./sections";

const sec = (title: string, start: [number, number], end: [number, number]): Section => ({
  title,
  start,
  end,
  parallels: [],
  subheadings: [],
});

describe("sectionAt (synthetic)", () => {
  const sections = [sec("A", [1, 1], [1, 5]), sec("B", [1, 6], [2, 3]), sec("C", [2, 4], [2, 9])];
  const title = (c: number, v: number) => sectionAt(sections, c, v)?.title ?? null;

  it("returns null for no sections", () => {
    expect(sectionAt([], 1, 1)).toBeNull();
  });

  it("returns null before the first section starts", () => {
    expect(sectionAt([sec("X", [2, 1], [2, 5])], 1, 9)).toBeNull();
  });

  it("finds the start verse, a middle verse and the last verse of a section", () => {
    expect(title(1, 1)).toBe("A");
    expect(title(1, 3)).toBe("A");
    expect(title(1, 5)).toBe("A");
    expect(title(1, 6)).toBe("B");
  });

  it("handles a section spanning a chapter boundary", () => {
    expect(title(1, 40)).toBe("B"); // later verse of chapter 1, still inside B
    expect(title(2, 1)).toBe("B");
    expect(title(2, 3)).toBe("B");
    expect(title(2, 4)).toBe("C");
  });

  it("returns the last section for the last verse of the book", () => {
    expect(title(2, 9)).toBe("C");
  });

  it("works with a single section", () => {
    expect(sectionAt([sec("Only", [1, 1], [1, 9])], 1, 9)?.title).toBe("Only");
  });
});

describe("sectionAt (real Acts data)", () => {
  it("maps the first and last verses of the book", async () => {
    const acts = await getSections("acts");
    expect(sectionAt(acts, 1, 1)?.title).toBe("Prologue");
    expect(sectionAt(acts, 28, 31)?.title).toBe("Paul Preaches at Rome");
  });

  it("finds sections at their start, middle and end verses", async () => {
    const acts = await getSections("acts");
    expect(sectionAt(acts, 6, 1)?.title).toBe("The Choosing of the Seven");
    expect(sectionAt(acts, 6, 4)?.title).toBe("The Choosing of the Seven");
    expect(sectionAt(acts, 6, 7)?.title).toBe("The Choosing of the Seven");
    expect(sectionAt(acts, 6, 8)?.title).toBe("The Arrest of Stephen");
  });

  it("finds the section containing Acts 7:58", async () => {
    const acts = await getSections("acts");
    expect(sectionAt(acts, 7, 58)?.title).toBe("The Stoning of Stephen");
  });

  it("every section's own start and end verses map back to that section", async () => {
    const acts = await getSections("acts");
    for (const s of acts) {
      expect(sectionAt(acts, ...s.start)).toBe(s);
      expect(sectionAt(acts, ...s.end)).toBe(s);
    }
  });

  // Known oddity, pinned on purpose: sectionAt only knows where sections START, so a verse is always
  // reported under the section containing it. Acts 12:25 is the last verse of "The Death of Herod"
  // even though it narrates the start of the next episode (the BSB heading for that begins at 13:1).
  // An episode starting there is therefore titled "The Death of Herod". This asserts current
  // behaviour; change it deliberately if that is ever revisited.
  it("titles an episode starting on a section's last verse with that section (Acts 12:25)", async () => {
    const acts = await getSections("acts");
    expect(sectionAt(acts, 12, 25)?.title).toBe("The Death of Herod");
    expect(sectionAt(acts, 13, 1)?.title).toBe("Paul’s First Missionary Journey Begins");
  });
});

describe("getSections", () => {
  it("returns [] for an unknown book", async () => {
    expect(await getSections("not-a-book")).toEqual([]);
  });
});
