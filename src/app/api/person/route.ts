import { getBook } from "@/lib/bible";
import { getPersonCard } from "@/lib/people";

// GET /api/person?id=Paul@Act.7.58-2Pe&at=acts.9.11[&all=1]
// "at" is where the reader is; "so far" stops there unless all=1.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const [book, chapter, verse] = (params.get("at") ?? "").split(".");
  const ch = Number(chapter);
  const v = Number(verse);
  if (!id || !getBook(book) || !Number.isInteger(ch) || !Number.isInteger(v)) {
    return Response.json({ error: "Expected ?id=<person>&at=<book>.<chapter>.<verse>" }, { status: 400 });
  }
  const card = await getPersonCard(id, { book, chapter: ch, verse: v }, params.get("all") === "1");
  if (!card) return Response.json({ error: "Unknown person." }, { status: 404 });
  return Response.json({ card });
}
