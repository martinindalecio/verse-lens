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

// What the model writes: only what data can't answer. Neighbouring sections, cross references,
// key words and people come from data files and the people tables (PassageData below).
export const PassageContextSchema = z.object({
  summary: z.string().describe("2-3 sentences: what happens in this passage."),
  setting: z.object({
    speaker: z.string().describe("Who is speaking or writing. 'Narrator' if narrative."),
    audience: z.string().describe("Who is being addressed, in the story and/or the original readers."),
    place: z.string(),
    when: z.string().describe("Approximate date range, with 'c.' and scholarly ranges where uncertain."),
    confidence: Confidence,
  }),
  historical_context: z.array(Claim),
  cultural_context: z.array(Claim),
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

// ---- The API response: the unit explained, the reader's selection inside it, the AI part and
// the data part, kept apart so the UI can label each with where it came from. Zod schemas so
// /api/v1/schema can publish the whole response as JSON Schema; the server builds the response
// from these types.

/** [chapter, verse] */
const ChapterVerseSchema = z.tuple([z.number().int().positive(), z.number().int().positive()]).describe("[chapter, verse]");
export type ChapterVerse = [number, number];

export const PassageUnitSchema = z.object({
  book: z.string().describe("Book slug, e.g. 'acts'."),
  bookName: z.string(),
  title: z.string().describe("BSB section title ('The Choosing of the Seven'), plus the subheading when split at one."),
  start: ChapterVerseSchema,
  end: ChapterVerseSchema,
  reference: z.string().describe("'Acts 6:1–7'"),
  part: z
    .object({ index: z.number().int().positive(), count: z.number().int().positive() })
    .nullable()
    .describe("Set when a long section is split into parts."),
});
export type PassageUnit = z.infer<typeof PassageUnitSchema>;

export const PassageSelectionSchema = z.object({
  chapter: z.number().int().positive(),
  start: z.number().int().positive(),
  end: z.number().int().positive(),
});
export type PassageSelection = z.infer<typeof PassageSelectionSchema>;

/** A neighbouring unit, titled by its BSB heading. */
export const NeighbourUnitSchema = z.object({
  title: z.string(),
  start: ChapterVerseSchema,
  end: ChapterVerseSchema,
  reference: z.string().describe("Chapter:verse range without the book name, e.g. '5:33–42'."),
});
export type NeighbourUnit = z.infer<typeof NeighbourUnitSchema>;

export const CrossReferenceSchema = z.object({
  label: z.string().describe("'Luke 1:1–4'"),
  to: z
    .object({ book: z.string(), chapter: z.number().int().positive(), verse: z.number().int().positive() })
    .nullable()
    .describe("Where the reference starts, for a link; null when the label couldn't be parsed."),
  source: z.enum(["bsb", "openbible"]).describe("'bsb': a parallel passage from the BSB's headings; 'openbible': OpenBible.info (CC BY)."),
  votes: z.number().int().nullable().describe("OpenBible.info votes summed over the unit's verses; null for BSB parallels."),
});
export type CrossReference = z.infer<typeof CrossReferenceSchema>;

/** An original-language word from STEPBible TAGNT/TAHOT (CC BY 4.0). */
export const KeyTermSchema = z.object({
  strongs: z.string().describe("'G1248' (Greek) or 'H…' (Hebrew)"),
  lemma: z.string(),
  translit: z.string(),
  gloss: z.string(),
  count: z.number().int().positive().describe("Occurrences in the unit."),
});
export type KeyTerm = z.infer<typeof KeyTermSchema>;

/** Someone named in the unit, from our mentions (TIPNR identities). */
export const PassagePersonSchema = z.object({
  id: z.string().describe("TIPNR unique name, e.g. 'Paul@Act.7.58-2Pe'."),
  name: z.string().describe("Name as first written in the unit ('Saul')."),
  usualName: z.string().nullable().describe("TIPNR's most common name ('Paul'), when different from name."),
  description: z.string().describe("TIPNR brief (AI-written by STEPBible) or description; '' when unknown."),
  firstRef: z.string().describe("'Acts 6:5': first verse in the unit that names them."),
  first: ChapterVerseSchema.describe("Chapter and verse of firstRef."),
});
export type PassagePerson = z.infer<typeof PassagePersonSchema>;

export const PassageDataSchema = z.object({
  before: NeighbourUnitSchema.nullable(),
  after: NeighbourUnitSchema.nullable(),
  crossReferences: z.array(CrossReferenceSchema),
  keyTerms: z.array(KeyTermSchema),
  people: z.array(PassagePersonSchema).describe("Empty when the unit names nobody or the people lookup failed."),
});
export type PassageData = z.infer<typeof PassageDataSchema>;

/** 200 response of POST /api/v1/context. */
export const PassageContextResponseSchema = z.object({
  unit: PassageUnitSchema,
  selection: PassageSelectionSchema,
  ai: PassageContextSchema,
  data: PassageDataSchema,
});
export type PassageContextResponse = z.infer<typeof PassageContextResponseSchema>;

/** Every /api/v1 error: clients branch on code (and treat unknown codes as generic errors). */
export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const ContextRequestSchema = z.object({
  book: z.string(),
  chapter: z.number().int().positive(),
  start: z.number().int().positive(),
  end: z.number().int().positive(),
});

export type ContextRequest = z.infer<typeof ContextRequestSchema>;
