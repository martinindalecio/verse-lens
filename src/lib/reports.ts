import { getBook, getChapter } from "./bible";
import { db } from "./db";
import { getSections, sectionAt } from "./sections";
import { sectionUnits } from "./units";

// In-app "Report a mistake". Validation lives here so the route stays thin and tests can
// exercise it with db() mocked. The message is stored and shown as plain text only.

export const SUPPORTED_LANGS = ["en"] as const;
export const MAX_MESSAGE = 2000;
const MAX_PERSON_ID = 120;
const DEFAULT_DAILY_CAP = 500;

export type ReportInput = { target: string; message: string; lang: string };
export type Checked = { ok: true; value: ReportInput } | { ok: false; message: string; status: 400 | 404 };

const bad = (message: string, status: 400 | 404 = 400): Checked => ({ ok: false, message, status });

/** Daily insert cap from REPORTS_DAILY_CAP: a non-negative integer; missing or invalid means 500. */
export function dailyCap(raw = process.env.REPORTS_DAILY_CAP): number {
  return raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : DEFAULT_DAILY_CAP;
}

export async function checkReport(body: unknown): Promise<Checked> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return bad("Expected a JSON object.");
  const { target, message, lang } = body as Record<string, unknown>; // anything else, user_id included, is ignored

  if (typeof message !== "string") return bad("message must be text.");
  const text = message.trim();
  if (text.length < 1 || text.length > MAX_MESSAGE) return bad(`message must be 1-${MAX_MESSAGE} characters.`);

  let language = "en";
  if (lang !== undefined) {
    if (typeof lang !== "string" || !(SUPPORTED_LANGS as readonly string[]).includes(lang)) {
      return bad(`lang must be one of: ${SUPPORTED_LANGS.join(", ")}.`);
    }
    language = lang;
  }

  if (typeof target !== "string") return bad("target must be text.");
  if (target.startsWith("person:")) {
    const id = target.slice("person:".length);
    if (!id || id.length > MAX_PERSON_ID || target !== target.trim()) return bad("Bad person target.");
    const rows = await db().query("select 1 from people where id = $1", [id]);
    if (rows.length === 0) return bad("Unknown person.", 404);
  } else if (target.startsWith("passage:")) {
    const m = /^passage:([a-z0-9-]+)\.([1-9]\d{0,2})\.([1-9]\d{0,2})$/.exec(target);
    if (!m || !getBook(m[1])) return bad("Expected passage:<book>.<chapter>.<verse>.");
    const chapter = Number(m[2]);
    const verse = Number(m[3]);
    // Passage reports name the start of the unit the Passage tab explained: a BSB section,
    // or one part of a long section (src/lib/units.ts).
    const section = sectionAt(await getSections(m[1]), chapter, verse);
    let startsUnit = false;
    if (section) {
      const lengths = new Map<number, number>();
      for (let ch = section.start[0]; ch <= section.end[0]; ch++) lengths.set(ch, (await getChapter(m[1], ch))?.length ?? 0);
      startsUnit = sectionUnits(section, (ch) => lengths.get(ch) ?? 0).some((u) => u.start[0] === chapter && u.start[1] === verse);
    }
    if (!startsUnit) return bad("That verse doesn't start a passage.", 404);
  } else {
    return bad("target must be person:<id> or passage:<book>.<chapter>.<verse>.");
  }

  return { ok: true, value: { target, message: text, lang: language } };
}

/** Spends one of today's slots (UTC day); false when the cap is reached. Atomic upsert. */
export async function takeDailySlot(cap = dailyCap(), day = new Date().toISOString().slice(0, 10)): Promise<boolean> {
  const rows = await db().query(
    "insert into report_days (day, n) select $1::date, 1 where $2::int > 0 on conflict (day) do update set n = report_days.n + 1 where report_days.n < $2::int returning n",
    [day, cap],
  );
  return rows.length > 0;
}

export async function insertReport(r: ReportInput): Promise<void> {
  // user_id stays null until there is a session; it is never taken from the request.
  await db().query("insert into mistake_reports (user_id, target, lang, message) values (null, $1, $2, $3)", [r.target, r.lang, r.message]);
}
