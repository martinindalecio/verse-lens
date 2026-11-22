import Anthropic from "@anthropic-ai/sdk";
import { apiError, type ServerTiming } from "./api";
import { getBook, getChapter } from "./bible";
import {
  ContextRefusedError,
  DailyCapReachedError,
  GenerationCounterError,
  contextService,
  type createContextService,
} from "./context";
import { ContextRequestSchema, type PassageContextResponse, type PassagePerson } from "./context-schema";
import { crossReferences, keyTerms, neighbours, unitPeople, type UnitContext } from "./passage-data";
import { getSections, sectionAt } from "./sections";
import { formatChVRange, sectionUnits, unitAt, versesBetween } from "./units";

/** Most verses a reader can select at once. */
export const MAX_SELECTION = 30;

type Timer = Pick<ServerTiming, "time">;
const untimed: Timer = { time: (_name, work) => (typeof work === "function" ? work() : work) };

export type ContextHandlerOptions = {
  service?: ReturnType<typeof createContextService>;
  /** People in the unit; defaults to the database (empty when it is unavailable). */
  people?: (ctx: Pick<UnitContext, "book" | "unit">) => Promise<PassagePerson[]>;
  timing?: Timer;
};

/**
 * POST /api/v1/context, minus rate limiting. The request is the reader's selection; the answer
 * explains the BSB section unit holding its first verse, with the selection echoed so the client
 * can highlight it inside the unit.
 */
export async function handleContextRequest(body: unknown, options: ContextHandlerOptions = {}): Promise<Response> {
  const timing = options.timing ?? untimed;
  const parsed = ContextRequestSchema.safeParse(body);
  if (!parsed.success) return apiError("invalid_request", "Invalid request.", 400);
  const { book: slug, chapter, start, end } = parsed.data;

  const book = getBook(slug);
  // The verse text always comes from our own data, never from the client.
  const verses = book ? await timing.time("files", getChapter(book.slug, chapter)) : null;
  if (!book || !verses) return apiError("not_found", "Unknown book or chapter.", 404);
  if (start > end || end > verses.length) return apiError("invalid_request", "Verse range is out of bounds.", 400);
  if (end - start + 1 > MAX_SELECTION) return apiError("invalid_request", `Select at most ${MAX_SELECTION} verses.`, 400);

  const sections = await timing.time("files", getSections(book.slug));
  const section = sectionAt(sections, chapter, start);
  if (!section) return apiError("not_found", "No section holds this verse.", 404);
  const sectionIndex = sections.indexOf(section);

  // Chapters from the previous section's start to the next one's end, for unit lengths and text.
  const firstCh = sections[sectionIndex - 1]?.start[0] ?? section.start[0];
  const lastCh = sections[sectionIndex + 1]?.end[0] ?? section.end[0];
  const chapterTexts = new Map<number, string[]>();
  await timing.time("files", async () => {
    const numbers = Array.from({ length: lastCh - firstCh + 1 }, (_, i) => firstCh + i);
    const texts = await Promise.all(numbers.map((ch) => getChapter(book.slug, ch)));
    numbers.forEach((ch, i) => chapterTexts.set(ch, texts[i] ?? []));
  });
  const chapterLength = (ch: number) => chapterTexts.get(ch)?.length ?? 0;

  const unit = unitAt(sectionUnits(section, chapterLength), [chapter, start]);
  if (!unit) return apiError("not_found", "No section holds this verse.", 404);
  const ctx: UnitContext = { book: book.slug, sections, sectionIndex, unit, chapterLength };
  const { before, after } = neighbours(ctx);

  try {
    const people = await timing.time("db", (options.people ?? unitPeople)(ctx));
    const unitVerses = versesBetween(unit.start, unit.end, chapterLength).map((at) => ({
      at,
      text: chapterTexts.get(at[0])?.[at[1] - 1] ?? "",
    }));
    const [ai, refs, terms] = await Promise.all([
      timing.time("context", (options.service ?? contextService()).getPassageContext({ book, unit, verses: unitVerses, people, before, after })),
      timing.time("files", crossReferences(ctx)),
      timing.time("files", keyTerms(ctx)),
    ]);
    const response: PassageContextResponse = {
      unit: {
        book: book.slug,
        bookName: book.name,
        title: unit.title,
        start: unit.start,
        end: unit.end,
        reference: `${book.name} ${formatChVRange(unit.start, unit.end)}`,
        part: unit.part,
      },
      selection: { chapter, start, end },
      ai,
      data: { before, after, crossReferences: refs, keyTerms: terms, people },
    };
    return Response.json(response);
  } catch (error) {
    if (error instanceof DailyCapReachedError) {
      return apiError("daily_cap_reached", error.message, 429, { "Retry-After": String(error.retryAfterSeconds) });
    }
    if (error instanceof ContextRefusedError) return apiError("refused", error.message, 422);
    if (error instanceof Anthropic.AuthenticationError) {
      return apiError("server_misconfigured", "The server's ANTHROPIC_API_KEY is missing or invalid.", 503);
    }
    if (error instanceof Anthropic.RateLimitError) {
      return apiError("upstream_rate_limited", "Too many requests right now. Try again in a moment.", 429);
    }
    if (error instanceof GenerationCounterError) console.error("generation counter failed", error.cause);
    else console.error("context generation failed", error);
    return apiError("upstream_failed", "Couldn't generate context. Try again.", 502);
  }
}
