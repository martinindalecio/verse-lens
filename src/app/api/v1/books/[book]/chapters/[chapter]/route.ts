import { apiError, rateLimit } from "@/lib/api";
import { getBook, getChapter, TRANSLATION } from "@/lib/bible";
import { getChapterPeople } from "@/lib/people";

type Params = { params: Promise<{ book: string; chapter: string }> };

// GET /api/v1/books/acts/chapters/9: verse text plus the people highlighted in it.
export async function GET(request: Request, { params }: Params) {
  const limited = rateLimit(request, "read", 120);
  if (limited) return limited;

  const { book: slug, chapter: chapterParam } = await params;
  const book = getBook(slug);
  const chapter = Number(chapterParam);
  const verses = book && Number.isInteger(chapter) ? await getChapter(book.slug, chapter) : null;
  if (!book || !verses) return apiError("not_found", "Unknown book or chapter.", 404);

  try {
    const people = await getChapterPeople(book.slug, chapter);
    return Response.json({ translation: TRANSLATION, book, chapter, verses, people });
  } catch (error) {
    console.error("chapter people failed", error);
    return apiError("internal", "Couldn't load this chapter. Try again.", 500);
  }
}
