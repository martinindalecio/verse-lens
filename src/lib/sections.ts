import { readFile } from "node:fs/promises";
import path from "node:path";
import { getBook } from "./bible";

// The BSB's own section headings ("The Conversion of Saul"), built into data/sections/ by
// scripts/build-sections.py. Public domain, like the verse text. Sections are contiguous, in
// order, and cover every verse of the book.

export type Section = {
  title: string;
  start: [number, number];
  end: [number, number];
  parallels: string[];
  subheadings: { title: string; start: [number, number] }[];
};

/** Sections of one book in order, or [] for an unknown book. */
export async function getSections(slug: string): Promise<Section[]> {
  "use cache";
  const book = getBook(slug);
  if (!book) return [];
  const file = path.join(process.cwd(), "data", "sections", `${book.slug}.json`);
  return JSON.parse(await readFile(file, "utf-8")) as Section[];
}

/** The section containing chapter:verse (the last one starting at or before it), or null. */
export function sectionAt(sections: Section[], chapter: number, verse: number): Section | null {
  let lo = 0;
  let hi = sections.length - 1;
  let found: Section | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [c, v] = sections[mid].start;
    if (c < chapter || (c === chapter && v <= verse)) {
      found = sections[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
