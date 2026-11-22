import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { TRANSLATION, type BookMeta } from "./bible";
import { PassageContextSchema, type NeighbourUnit, type PassageContext, type PassagePerson } from "./context-schema";
import { db } from "./db";
import { peopleForPrompt } from "./passage-data";
import { formatChVRange, type ChV, type Unit } from "./units";

const MODEL = "claude-opus-5-5";

// Bump when the prompt or schema changes so cached answers are regenerated.
// 2: one explanation per BSB section unit (no selection marking); before/after, cross references
//    and key terms moved out of the model into data; people in the passage given to the prompt.
export const PROMPT_VERSION = 2;

/** Daily generation cap when DAILY_GENERATION_CAP is missing or invalid. */
export const DEFAULT_DAILY_CAP = 200;

const SYSTEM_PROMPT = `You are a careful biblical historian helping a reader understand a passage of the Bible in its original setting.

Your job is context, not preaching:
- Explain who is involved, where and when it happens, and the historical and cultural background a first reader would have taken for granted. The reader already sees the neighbouring sections, cross references and original-language words elsewhere, so don't list them.
- When a list of people in the passage is given, use those identities; don't merge or swap people who share a name.
- Keep historical facts and interpretation strictly apart. Facts go in historical_context and cultural_context. Readings of what the passage means go only in interpretations, each labeled with the tradition that holds it. Where traditions differ meaningfully, present the main views side by side and neutrally, without ranking them. Where they don't differ, a single short entry is fine.
- Every factual claim needs an honest basis. Prefer the biblical text itself and well-known ancient sources (Josephus, Philo, the Mishnah, Tacitus, etc.) and archaeological findings you are confident about. Never invent a book title, page number, or quotation. If a claim is a reasonable reconstruction rather than attested, say so and lower its confidence.
- Dates and places are often debated. Give ranges and put real disagreements in open_questions instead of picking a side.
- Be concise. Aim for 3-6 items per list, and fewer when the passage doesn't call for more.`;

export class ContextRefusedError extends Error {}

/** Today's cap of new explanations is spent. */
export class DailyCapReachedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Today's limit for new explanations is reached; saved ones still work.");
  }
}

/** The generation counter couldn't be read or written, so no model call was made. */
export class GenerationCounterError extends Error {}

/** DAILY_GENERATION_CAP: a non-negative integer; missing or invalid means 200; 0 turns generation off. */
export function parseDailyCap(raw: string | undefined): number {
  if (raw === undefined || !/^\s*\d+\s*$/.test(raw)) return DEFAULT_DAILY_CAP;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : DEFAULT_DAILY_CAP;
}

/** Seconds until the next UTC midnight, in (0, 86400]. */
export function secondsToNextUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

/** What the model sees: the unit's verses (from data/bsb), its neighbours' titles and its people. */
export type GenerateInput = {
  book: BookMeta;
  unit: Unit;
  verses: { at: ChV; text: string }[];
  people: PassagePerson[];
  before: NeighbourUnit | null;
  after: NeighbourUnit | null;
};

/** One query; rows come back as objects. */
export type Sql = (query: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export type ContextDeps = {
  sql: Sql;
  generate: (input: GenerateInput) => Promise<PassageContext>;
  /** Current time; the counter's day is its UTC date. */
  now: () => Date;
  /** Today's cap (see parseDailyCap). */
  cap: () => number;
};

const LANG = "en";
const TRANSLATION_ID = "bsb";

/**
 * Context for a unit is the same for every reader, so it is generated once and stored in Postgres
 * (section_context). The in-memory map only joins concurrent requests for the same unit so they
 * don't each call the model (or spend a slot of the daily cap).
 */
export function createContextService(deps: ContextDeps) {
  const inFlight = new Map<string, Promise<PassageContext>>();

  function getPassageContext(input: GenerateInput): Promise<PassageContext> {
    const key = `v${PROMPT_VERSION}:${input.book.slug}.${input.unit.start[0]}.${input.unit.start[1]}`;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = loadOrGenerate(input).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return pending;
  }

  async function loadOrGenerate(input: GenerateInput): Promise<PassageContext> {
    const where = [LANG, TRANSLATION_ID, input.book.slug, input.unit.start[0], input.unit.start[1], PROMPT_VERSION];
    const stored = await deps.sql(
      `select context from section_context
        where lang = $1 and translation = $2 and book = $3 and start_ch = $4 and start_v = $5 and prompt_version = $6`,
      where,
    );
    if (stored[0]) return PassageContextSchema.parse(stored[0].context);

    // A cache miss that isn't joining another request: spend a slot before calling the model, so
    // refused or failed calls count too.
    await spendSlot();

    const context = await deps.generate(input);
    await deps.sql(
      `insert into section_context (lang, translation, book, start_ch, start_v, prompt_version, context)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing`,
      [...where, JSON.stringify(context)],
    );
    return context;
  }

  async function spendSlot(): Promise<void> {
    const now = deps.now();
    const day = now.toISOString().slice(0, 10);
    let rows: Record<string, unknown>[];
    try {
      rows = await deps.sql(
        `insert into generation_days (day, n) select $1::date, 1 where $2::int > 0
         on conflict (day) do update set n = generation_days.n + 1 where generation_days.n < $2::int
         returning n`,
        [day, deps.cap()],
      );
    } catch (error) {
      throw new GenerationCounterError("The daily generation counter is unavailable.", { cause: error });
    }
    if (rows.length === 0) throw new DailyCapReachedError(secondsToNextUtcMidnight(now));
  }

  return { getPassageContext };
}

let service: ReturnType<typeof createContextService> | undefined;

/** The app's service: Neon, Claude, the real clock and DAILY_GENERATION_CAP. */
export function contextService() {
  service ??= createContextService({
    sql: (query, params) => db().query(query, params) as Promise<Record<string, unknown>[]>,
    generate: generateWithClaude,
    now: () => new Date(),
    cap: () => parseDailyCap(process.env.DAILY_GENERATION_CAP),
  });
  return service;
}

export function buildPrompt({ book, unit, verses, people, before, after }: GenerateInput): string {
  const range = formatChVRange(unit.start, unit.end);
  const lines = verses.map(({ at, text }) => `${at[0]}:${at[1]} ${text}`).join("\n");
  const around = [
    before ? `Before it: "${before.title}" (${book.name} ${before.reference}).` : "",
    after ? `After it: "${after.title}" (${book.name} ${after.reference}).` : "",
  ].filter(Boolean);
  const cast = people.length
    ? `\n\nPeople named in this passage, identified from scholarly data (STEPBible TIPNR):\n${peopleForPrompt(people)}`
    : "";
  return `Give the context for ${book.name} ${range}, the section headed "${unit.title}" in the ${TRANSLATION}.${
    around.length ? `\n${around.join(" ")}` : ""
  }${cast}

<passage book="${book.name}" range="${range}">
${lines}
</passage>`;
}

// Created lazily so builds and pages that never call the API don't need credentials.
let client: Anthropic | undefined;

async function generateWithClaude(input: GenerateInput): Promise<PassageContext> {
  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // Server-side fallback: if a safety classifier declines, the API retries on
    // a fallback model inside the same call instead of returning a refusal.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(PassageContextSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(input) }],
  });

  if (response.stop_reason === "refusal") {
    throw new ContextRefusedError(response.stop_details?.explanation ?? "The model declined this request.");
  }
  if (!response.parsed_output) {
    throw new Error(`No structured output (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}
