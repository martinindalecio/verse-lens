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
// the data part, kept apart so the UI can label each with where it came from.

/** [chapter, verse] */
export type ChapterVerse = [number, number];

export type PassageUnit = {
  book: string;
  bookName: string;
  /** BSB section title ("The Choosing of the Seven"), plus the subheading when split at one. */
  title: string;
  start: ChapterVerse;
  end: ChapterVerse;
  /** "Acts 6:1–7" */
  reference: string;
  /** Set when a long section is split into parts. */
  part: { index: number; count: number } | null;
};

export type PassageSelection = { chapter: number; start: number; end: number };

/** A neighbouring unit, titled by its BSB heading. */
export type NeighbourUnit = { title: string; start: ChapterVerse; end: ChapterVerse; reference: string };

export type CrossReference = {
  /** "Luke 1:1–4" */
  label: string;
  /** Where the reference starts, for a link; null when the label couldn't be parsed. */
  to: { book: string; chapter: number; verse: number } | null;
  /** "bsb": a parallel passage from the BSB's headings; "openbible": OpenBible.info (CC BY). */
  source: "bsb" | "openbible";
  /** OpenBible.info votes summed over the unit's verses; null for BSB parallels. */
  votes: number | null;
};

/** An original-language word from STEPBible TAGNT/TAHOT (CC BY 4.0). */
export type KeyTerm = { strongs: string; lemma: string; translit: string; gloss: string; count: number };

/** Someone named in the unit, from our mentions (TIPNR identities). */
export type PassagePerson = {
  id: string;
  /** Name as first written in the unit ("Saul"). */
  name: string;
  /** TIPNR's most common name ("Paul"), when different from `name`. */
  usualName: string | null;
  /** TIPNR brief (AI-written by STEPBible) or description; '' when unknown. */
  description: string;
  /** "Acts 6:5": first verse in the unit that names them. */
  firstRef: string;
  /** Chapter and verse of firstRef, for opening their card there. */
  first: ChapterVerse;
};

export type PassageData = {
  before: NeighbourUnit | null;
  after: NeighbourUnit | null;
  crossReferences: CrossReference[];
  keyTerms: KeyTerm[];
  people: PassagePerson[];
};

export type PassageContextResponse = {
  unit: PassageUnit;
  selection: PassageSelection;
  ai: PassageContext;
  data: PassageData;
};

export const ContextRequestSchema = z.object({
  book: z.string(),
  chapter: z.number().int().positive(),
  start: z.number().int().positive(),
  end: z.number().int().positive(),
});

export type ContextRequest = z.infer<typeof ContextRequestSchema>;
