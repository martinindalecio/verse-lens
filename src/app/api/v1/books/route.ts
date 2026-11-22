import { rateLimit, withServerTiming } from "@/lib/api";
import { BOOKS, TRANSLATION } from "@/lib/bible";

// GET /api/v1/books: every book in reading order, so a client can build its table of contents.
export const GET = withServerTiming((request) => {
  const limited = rateLimit(request, "read", 120);
  if (limited) return limited;
  return Response.json({ translation: TRANSLATION, books: BOOKS });
});
