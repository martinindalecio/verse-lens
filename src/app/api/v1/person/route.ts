import { apiError, rateLimit } from "@/lib/api";
import { getBook } from "@/lib/bible";
import { getPersonCard } from "@/lib/people";

// GET /api/v1/person?id=Paul@Act.7.58-2Pe&at=acts.9.11[&all=1]
// "at" is where the reader is; "so far" stops there unless all=1.
export async function GET(request: Request) {
  const limited = rateLimit(request, "read", 120);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const [book, chapter, verse] = (params.get("at") ?? "").split(".");
  const ch = Number(chapter);
  const v = Number(verse);
  const bad = !id || !chapter || !verse || !getBook(book) || !Number.isInteger(ch) || !Number.isInteger(v) || ch < 1 || v < 1;
  if (bad) return apiError("invalid_request", "Expected ?id=<person>&at=<book>.<chapter>.<verse>", 400);

  try {
    const card = await getPersonCard(id, { book, chapter: ch, verse: v }, params.get("all") === "1");
    if (!card) return apiError("not_found", "Unknown person.", 404);
    return Response.json({ card });
  } catch (error) {
    console.error("person card failed", error);
    return apiError("internal", "Couldn't load this person. Try again.", 500);
  }
}
