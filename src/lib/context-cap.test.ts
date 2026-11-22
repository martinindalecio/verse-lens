import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createContextService, parseDailyCap, secondsToNextUtcMidnight, type Sql } from "@/lib/context";
import { handleContextRequest } from "@/lib/context-handler";
import type { PassageContext, PassageContextResponse } from "@/lib/context-schema";
import { getSections } from "@/lib/sections";

// The daily generation cap (docs/designs/reading-companion.md, Revision 3), tested against
// PGlite (Postgres compiled to WebAssembly, in process) loaded with the real db/schema.sql.
// The model is always mocked; people lookups return nothing (no database for them here).

const FAKE: PassageContext = {
  summary: "A summary.",
  setting: { speaker: "Narrator", audience: "Theophilus", place: "Jerusalem", when: "c. AD 33-35", confidence: "medium" },
  historical_context: [{ text: "A fact.", basis: "Acts 6:1", confidence: "high" }],
  cultural_context: [],
  interpretations: [{ tradition: "Reformed", view: "A reading." }],
  open_questions: [],
};

const NOW = new Date("2026-11-22T15:00:00Z");
const DAY = "2026-11-22";

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(await readFile(path.join(process.cwd(), "db", "schema.sql"), "utf-8"));
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("truncate section_context, generation_days");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup({ cap, failCounter = false }: { cap: number; failCounter?: boolean }) {
  const sql: Sql = async (query, params) => {
    if (failCounter && query.includes("generation_days")) throw new Error("connection reset");
    return (await pg.query<Record<string, unknown>>(query, params)).rows;
  };
  // Resolves on the next tick, so concurrent requests really overlap.
  const generate = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return FAKE;
  });
  const service = createContextService({ sql, generate, now: () => NOW, cap: () => cap });
  const ask = (chapter: number, start: number, end = start) =>
    handleContextRequest({ book: "acts", chapter, start, end }, { service, people: async () => [] });
  return { generate, ask };
}

async function counter(): Promise<number | null> {
  const rows = (await pg.query<{ n: number }>("select n from generation_days where day = $1::date", [DAY])).rows;
  return rows[0]?.n ?? null;
}

/** Starts of the first n sections of Acts: distinct units. */
async function sectionStarts(n: number): Promise<[number, number][]> {
  return (await getSections("acts")).slice(0, n).map((s) => s.start);
}

describe("daily generation cap", () => {
  it("(a) the (cap+1)th new section gets 429 daily_cap_reached; a cached one still returns 200 and spends nothing", async () => {
    const { generate, ask } = setup({ cap: 2 });
    const [s1, s2, s3] = await sectionStarts(3);

    expect((await ask(...s1)).status).toBe(200);
    expect((await ask(...s2)).status).toBe(200);
    expect(await counter()).toBe(2);

    const refused = await ask(...s3);
    expect(refused.status).toBe(429);
    expect((await refused.json()).error.code).toBe("daily_cap_reached");
    const retryAfter = Number(refused.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(86400);
    expect(retryAfter).toBe(9 * 3600); // 15:00 UTC -> midnight

    // Cached: the same section (another verse inside it) answers without spending a slot.
    const cached = await ask(s1[0], s1[1] + 1);
    expect(cached.status).toBe(200);
    const body = (await cached.json()) as PassageContextResponse;
    expect(body.ai).toEqual(FAKE);
    expect(body.selection).toEqual({ chapter: s1[0], start: s1[1] + 1, end: s1[1] + 1 });
    expect(body.unit.start).toEqual(s1);
    expect(await counter()).toBe(2);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("(b) 10 concurrent distinct sections with 3 slots left make exactly 3 model calls", async () => {
    await pg.query("insert into generation_days (day, n) values ($1::date, 7)", [DAY]);
    const { generate, ask } = setup({ cap: 10 });
    const responses = await Promise.all((await sectionStarts(10)).map((s) => ask(...s)));
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(await counter()).toBe(10);
  });

  it("(c) cap 0 refuses every new section", async () => {
    const { generate, ask } = setup({ cap: 0 });
    for (const s of await sectionStarts(3)) {
      const res = await ask(...s);
      expect(res.status).toBe(429);
      expect((await res.json()).error.code).toBe("daily_cap_reached");
    }
    expect(generate).not.toHaveBeenCalled();
    expect(await counter()).toBeNull();
  });

  it("(c) DAILY_GENERATION_CAP: missing or invalid means 200, 0 turns generation off", () => {
    expect(parseDailyCap(undefined)).toBe(200);
    expect(parseDailyCap("abc")).toBe(200);
    expect(parseDailyCap("-1")).toBe(200);
    expect(parseDailyCap("")).toBe(200);
    expect(parseDailyCap("1.5")).toBe(200);
    expect(parseDailyCap("0")).toBe(0);
    expect(parseDailyCap("50")).toBe(50);
  });

  it("(d) a failing counter query returns 502 upstream_failed and makes no model call", async () => {
    const { generate, ask } = setup({ cap: 10, failCounter: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [s1] = await sectionStarts(1);
    const res = await ask(...s1);
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("upstream_failed");
    expect(generate).not.toHaveBeenCalled();
  });

  it("(e) two concurrent requests for the same section spend 1 slot and make 1 model call", async () => {
    const { generate, ask } = setup({ cap: 10 });
    // Acts 6:1-7 is one section: two different selections inside it share one explanation.
    const [a, b] = await Promise.all([ask(6, 1), ask(6, 3, 4)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await counter()).toBe(1);
    const body = (await b.json()) as PassageContextResponse;
    expect(body.unit).toMatchObject({ title: "The Choosing of the Seven", start: [6, 1], end: [6, 7], reference: "Acts 6:1–7" });
    expect(body.selection).toEqual({ chapter: 6, start: 3, end: 4 });
    expect(body.data.crossReferences[0].label).toBe("1 Timothy 3:8–13");
    const rows = (await pg.query("select book, start_ch, start_v, prompt_version from section_context")).rows;
    expect(rows).toEqual([{ book: "acts", start_ch: 6, start_v: 1, prompt_version: 2 }]);
  });

  it("Retry-After counts to the next UTC midnight, within (0, 86400]", () => {
    expect(secondsToNextUtcMidnight(new Date("2026-11-22T00:00:00Z"))).toBe(86400);
    expect(secondsToNextUtcMidnight(new Date("2026-11-22T23:59:59.500Z"))).toBe(1);
    expect(secondsToNextUtcMidnight(new Date("2026-12-31T12:00:00Z"))).toBe(43200);
  });
});

describe("POST /api/v1/context validation", () => {
  it("rejects bad selections before touching the database or the model", async () => {
    const { generate, ask } = setup({ cap: 10 });
    expect((await ask(6, 5, 2)).status).toBe(400);
    expect((await ask(6, 1, 99)).status).toBe(400);
    expect((await ask(99, 1)).status).toBe(404);
    expect((await handleContextRequest({ book: "acts" })).status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });
});
