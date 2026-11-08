import Anthropic from "@anthropic-ai/sdk";
import { apiError, rateLimit } from "@/lib/api";
import { getBook, getChapter } from "@/lib/bible";
import { ContextRefusedError, getPassageContext } from "@/lib/context";
import { ContextRequestSchema } from "@/lib/context-schema";

const MAX_VERSES = 30;

export async function POST(request: Request) {
  // Every miss here is a paid Opus call, so this is the tightest limit.
  const limited = rateLimit(request, "context", 10);
  if (limited) return limited;

  const parsed = ContextRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_request", "Invalid request.", 400);
  const { book: slug, chapter, start, end } = parsed.data;

  const book = getBook(slug);
  // The verse text always comes from our own data, never from the client.
  const verses = book ? await getChapter(book.slug, chapter) : null;
  if (!book || !verses) return apiError("not_found", "Unknown book or chapter.", 404);
  if (start > end || end > verses.length) return apiError("invalid_request", "Verse range is out of bounds.", 400);
  if (end - start + 1 > MAX_VERSES) return apiError("invalid_request", `Select at most ${MAX_VERSES} verses.`, 400);

  try {
    const context = await getPassageContext({ book, chapter, start, end }, verses);
    return Response.json({ context });
  } catch (error) {
    if (error instanceof ContextRefusedError) return apiError("refused", error.message, 422);
    if (error instanceof Anthropic.AuthenticationError) {
      return apiError("server_misconfigured", "The server's ANTHROPIC_API_KEY is missing or invalid.", 503);
    }
    if (error instanceof Anthropic.RateLimitError) {
      return apiError("upstream_rate_limited", "Too many requests right now. Try again in a moment.", 429);
    }
    console.error("context generation failed", error);
    return apiError("upstream_failed", "Couldn't generate context. Try again.", 502);
  }
}
