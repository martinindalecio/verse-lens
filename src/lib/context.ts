import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { formatReference, TRANSLATION, type Passage } from "./bible";
import { PassageContextSchema, type PassageContext } from "./context-schema";
import { db } from "./db";

const MODEL = "claude-opus-5-5";

// Bump when the prompt or schema changes so cached answers are regenerated.
const PROMPT_VERSION = 1;

const SYSTEM_PROMPT = `You are a careful biblical historian helping a reader understand a passage of the Bible in its original setting.

Your job is context, not preaching:
- Explain who is involved, where and when it happens, what came before and after, and the historical, cultural, and linguistic background a first reader would have taken for granted.
- Keep historical facts and interpretation strictly apart. Facts go in historical_context and cultural_context. Readings of what the passage means go only in interpretations, each labeled with the tradition that holds it. Where traditions differ meaningfully, present the main views side by side and neutrally, without ranking them. Where they don't differ, a single short entry is fine.
- Every factual claim needs an honest basis. Prefer the biblical text itself and well-known ancient sources (Josephus, Philo, the Mishnah, Tacitus, etc.) and archaeological findings you are confident about. Never invent a book title, page number, or quotation. If a claim is a reasonable reconstruction rather than attested, say so and lower its confidence.
- Dates and places are often debated. Give ranges and put real disagreements in open_questions instead of picking a side.
- Only give a Strong's number when you are sure of it; otherwise leave it empty.
- Be concise. Aim for 3-6 items per list, and fewer when the passage doesn't call for more.`;

// Created lazily so builds and pages that never call the API don't need credentials.
let client: Anthropic | undefined;

// Context for a passage is the same for every reader, so it is generated once and stored in
// Postgres (passage_context). The in-memory map only joins concurrent requests for the same
// passage so they don't each call the model.
const inFlight = new Map<string, Promise<PassageContext>>();

export class ContextRefusedError extends Error {}

export function getPassageContext(passage: Passage, chapterVerses: string[]): Promise<PassageContext> {
  const key = `v${PROMPT_VERSION}:${passage.book.slug}.${passage.chapter}.${passage.start}-${passage.end}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = loadOrGenerate(passage, chapterVerses).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

async function loadOrGenerate(passage: Passage, chapterVerses: string[]): Promise<PassageContext> {
  const where = ["en", "bsb", passage.book.slug, passage.chapter, passage.start, passage.end, PROMPT_VERSION];
  const stored = (await db().query(
    `select context from passage_context
      where lang = $1 and translation = $2 and book = $3 and chapter = $4 and start_v = $5 and end_v = $6 and prompt_version = $7`,
    where,
  )) as { context: unknown }[];
  if (stored[0]) return PassageContextSchema.parse(stored[0].context);

  const context = await generate(passage, chapterVerses);
  await db().query(
    `insert into passage_context (lang, translation, book, chapter, start_v, end_v, prompt_version, context)
     values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing`,
    [...where, JSON.stringify(context)],
  );
  return context;
}

async function generate(passage: Passage, chapterVerses: string[]): Promise<PassageContext> {
  const chapterText = chapterVerses
    .map((text, i) => {
      const n = i + 1;
      const selected = n >= passage.start && n <= passage.end;
      return `${selected ? ">> " : ""}${n} ${text}`;
    })
    .join("\n");

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
    messages: [
      {
        role: "user",
        content: `Give the context for ${formatReference(passage)}.

The full chapter (${TRANSLATION}) is below. Selected verses are marked with ">>".

<chapter book="${passage.book.name}" chapter="${passage.chapter}">
${chapterText}
</chapter>`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new ContextRefusedError(response.stop_details?.explanation ?? "The model declined this request.");
  }
  if (!response.parsed_output) {
    throw new Error(`No structured output (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}
