import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChapterReader } from "@/components/chapter-reader";
import { getBook, getChapter, TRANSLATION } from "@/lib/bible";

export default function ChapterPage({ params }: PageProps<"/read/[book]/[chapter]">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading chapter…</p>}>
      <Chapter params={params} />
    </Suspense>
  );
}

async function Chapter({ params }: Pick<PageProps<"/read/[book]/[chapter]">, "params">) {
  const { book: slug, chapter: chapterParam } = await params;
  const book = getBook(slug);
  const chapter = Number(chapterParam);
  const verses = book && Number.isInteger(chapter) ? await getChapter(book.slug, chapter) : null;
  if (!book || !verses) notFound();

  return (
    <div className="space-y-6">
      <nav className="flex items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-muted hover:text-accent">
            All books
          </Link>
          <h1 className="font-serif text-3xl font-semibold">
            {book.name} {chapter}
          </h1>
        </div>
        <div className="flex gap-2 text-sm">
          {chapter > 1 && (
            <Link href={`/read/${book.slug}/${chapter - 1}`} className="rounded-md border border-line px-3 py-1.5 hover:border-accent">
              ← {chapter - 1}
            </Link>
          )}
          {chapter < book.chapters && (
            <Link href={`/read/${book.slug}/${chapter + 1}`} className="rounded-md border border-line px-3 py-1.5 hover:border-accent">
              {chapter + 1} →
            </Link>
          )}
        </div>
      </nav>

      <ChapterReader key={`${book.slug}-${chapter}`} bookSlug={book.slug} bookName={book.name} chapter={chapter} verses={verses} />

      <p className="text-xs text-muted">Scripture text: {TRANSLATION}.</p>
    </div>
  );
}
