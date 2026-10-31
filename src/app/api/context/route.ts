import Anthropic from "@anthropic-ai/sdk";
import { getBook, getChapter } from "@/lib/bible";
import { ContextRefusedError, getPassageContext } from "@/lib/context";
import { ContextRequestSchema } from "@/lib/context-schema";

const MAX_VERSES = 30;

export async function POST(request: Request) {
  const parsed = ContextRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const { book: slug, chapter, start, end } = parsed.data;

  const book = getBook(slug);
  // The verse text always comes from our own data, never from the client.
  const verses = book ? await getChapter(book.slug, chapter) : null;
  if (!book || !verses) {
    return Response.json({ error: "Unknown book or chapter." }, { status: 404 });
  }
  if (start > end || end > verses.length) {
    return Response.json({ error: "Verse range is out of bounds." }, { status: 400 });
  }
  if (end - start + 1 > MAX_VERSES) {
    return Response.json({ error: `Select at most ${MAX_VERSES} verses.` }, { status: 400 });
  }

  try {
    const context = await getPassageContext({ book, chapter, start, end }, verses);
    return Response.json({ context });
  } catch (error) {
    if (error instanceof ContextRefusedError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "The server's ANTHROPIC_API_KEY is missing or invalid." }, { status: 503 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Too many requests right now. Try again in a moment." }, { status: 429 });
    }
    console.error("context generation failed", error);
    return Response.json({ error: "Couldn't generate context. Try again." }, { status: 502 });
  }
}
