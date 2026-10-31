import { z } from "zod";

// Shared between the API route (structured output) and the UI (rendering).
// Facts and interpretation live in separate fields on purpose: the UI must
// never present a tradition's reading as historical fact.

const Confidence = z.enum(["high", "medium", "low"]);

const Claim = z.object({
  text: z.string().describe("One factual claim about history, geography, or culture."),
  basis: z
    .string()
    .describe(
      "What the claim rests on: the biblical text itself (with reference), a named ancient source " +
        "(e.g. 'Josephus, Antiquities 18.2.2'), archaeology, or 'scholarly consensus'. " +
        "Never invent a citation; if unsure, say 'general scholarly reconstruction'.",
    ),
  confidence: Confidence,
});

export const PassageContextSchema = z.object({
  summary: z.string().describe("2-3 sentences: what is happening in the selected verses."),
  setting: z.object({
    speaker: z.string().describe("Who is speaking or writing. 'Narrator' if narrative."),
    audience: z.string().describe("Who is being addressed, in the story and/or the original readers."),
    place: z.string(),
    when: z.string().describe("Approximate date range, with 'c.' and scholarly ranges where uncertain."),
    confidence: Confidence,
  }),
  narrative_flow: z.object({
    before: z.string().describe("What leads into this passage."),
    after: z.string().describe("What follows and why it matters."),
  }),
  historical_context: z.array(Claim),
  cultural_context: z.array(Claim),
  key_terms: z.array(
    z.object({
      term: z.string().describe("The English word or phrase as it appears in the BSB text."),
      original: z.string().describe("Hebrew, Aramaic, or Greek word in its original script."),
      transliteration: z.string(),
      strongs: z.string().describe("Strong's number like 'G26' or 'H2617', or '' if unsure."),
      meaning: z.string(),
    }),
  ),
  cross_references: z.array(
    z.object({
      reference: z.string().describe("e.g. 'Numbers 21:4-9'"),
      connection: z.string(),
    }),
  ),
  interpretations: z.array(
    z.object({
      tradition: z
        .string()
        .describe("e.g. 'Catholic', 'Eastern Orthodox', 'Reformed', 'Wesleyan/Arminian', 'Jewish', 'Historical-critical'"),
      view: z.string(),
    }),
  ),
  open_questions: z
    .array(z.string())
    .describe("Points where scholars genuinely disagree or the evidence is thin."),
});

export type PassageContext = z.infer<typeof PassageContextSchema>;

export const ContextRequestSchema = z.object({
  book: z.string(),
  chapter: z.number().int().positive(),
  start: z.number().int().positive(),
  end: z.number().int().positive(),
});

export type ContextRequest = z.infer<typeof ContextRequestSchema>;
