import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChapterReader, type ReturnTo } from "@/components/chapter-reader";
import { BOOKS, getBook, getChapter, TRANSLATION } from "@/lib/bible";
import { getChapterPeople } from "@/lib/people";

type Props = PageProps<"/read/[book]/[chapter]">;

export default function ChapterPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<p className="text-muted">Loading chapter…</p>}>
      <Chapter params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function Chapter({ params, searchParams }: Props) {
  const [{ book: slug, chapter: chapterParam }, query] = await Promise.all([params, searchParams]);
  const book = getBook(slug);
  const chapter = Number(chapterParam);
  const verses = book && Number.isInteger(chapter) ? await getChapter(book.slug, chapter) : null;
  if (!book || !verses) notFound();
  const people = await getChapterPeople(book.slug, chapter);

  // ?v=11&person=<id>&from=acts.9.11 comes from a reference tapped in a person card.
  const verse = Number(one(query.v));
  const [fromBook, fromCh, fromV] = (one(query.from) ?? "").split(".");
  const fromBookMeta = getBook(fromBook);
  const returnTo: ReturnTo | null = fromBookMeta
    ? { book: fromBook, bookName: fromBookMeta.name, chapter: Number(fromCh), verse: Number(fromV) }
    : null;
  const prev = chapter > 1 ? { slug: book.slug, chapter: chapter - 1 } : neighbour(book.slug, -1);
  const next = chapter < book.chapters ? { slug: book.slug, chapter: chapter + 1 } : neighbour(book.slug, 1);

  return (
    <div className="space-y-6">
      <nav className="flex items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-base text-muted hover:text-accent">
            All books
          </Link>
          <h1 className="text-3xl font-bold">
            {book.name} {chapter}
          </h1>
        </div>
        <div className="flex gap-2">
          {prev && (
            <Link href={`/read/${prev.slug}/${prev.chapter}`} aria-label="Previous chapter" className="flex h-11 w-11 items-center justify-center rounded-xl bg-chip">
              <Chevron flip />
            </Link>
          )}
          {next && (
            <Link href={`/read/${next.slug}/${next.chapter}`} aria-label="Next chapter" className="flex h-11 w-11 items-center justify-center rounded-xl bg-chip">
              <Chevron />
            </Link>
          )}
        </div>
      </nav>

      <ChapterReader
        key={`${book.slug}-${chapter}-${one(query.person) ?? ""}-${verse || ""}`}
        bookSlug={book.slug}
        bookName={book.name}
        chapter={chapter}
        verses={verses}
        people={people}
        initialVerse={Number.isInteger(verse) && verse > 0 ? verse : null}
        initialPerson={one(query.person) ?? null}
        returnTo={returnTo}
      />

      <p className="pb-6 text-sm text-muted">
        Scripture text: {TRANSLATION}. People data: STEPBible TIPNR (CC BY 4.0), with corrections listed in the project.
      </p>
    </div>
  );
}

function neighbour(slug: string, step: 1 | -1) {
  const i = BOOKS.findIndex((b) => b.slug === slug) + step;
  const b = BOOKS[i];
  if (!b) return null;
  return { slug: b.slug, chapter: step === 1 ? 1 : b.chapters };
}

function Chevron({ flip = false }: { flip?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={flip ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}
