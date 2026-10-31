import { readFile } from "node:fs/promises";
import path from "node:path";
import index from "../../data/bsb/index.json";

export type Testament = "OT" | "NT";

export type BookMeta = {
  name: string;
  slug: string;
  testament: Testament;
  chapters: number;
};

export type Passage = {
  book: BookMeta;
  chapter: number;
  start: number;
  end: number;
};

export const TRANSLATION = "Berean Standard Bible (BSB, public domain)";

export const BOOKS = index as BookMeta[];

export function getBook(slug: string): BookMeta | undefined {
  return BOOKS.find((b) => b.slug === slug);
}

type BookFile = { name: string; slug: string; chapters: string[][] };

/** Verses of one chapter (index 0 = verse 1), or null if it doesn't exist. */
export async function getChapter(slug: string, chapter: number): Promise<string[] | null> {
  "use cache";
  const book = getBook(slug);
  if (!book || chapter < 1 || chapter > book.chapters) return null;
  const file = path.join(process.cwd(), "data", "bsb", `${book.slug}.json`);
  const data = JSON.parse(await readFile(file, "utf-8")) as BookFile;
  return data.chapters[chapter - 1] ?? null;
}

export function formatReference(p: Passage): string {
  const verses = p.start === p.end ? `${p.start}` : `${p.start}-${p.end}`;
  return `${p.book.name} ${p.chapter}:${verses}`;
}
