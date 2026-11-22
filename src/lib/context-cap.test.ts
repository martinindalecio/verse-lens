import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createContextService, parseDailyCap, secondsToNextUtcMidnight, type GenerateInput, type Sql } from "@/lib/context";
import { handleContextRequest, type ContextHandlerOptions as HandlerOptions } from "@/lib/context-handler";
import { hashClient, takeClientSlot } from "@/lib/client-quota";
import { PassageContextResponseSchema, type PassageContext, type PassageContextResponse } from "@/lib/context-schema";
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
  await pg.exec("truncate section_context, generation_days, client_days");
});

afterEach(() => {
  vi.restoreAllMocks();
});

type People = Awaited<ReturnType<NonNullable<HandlerOptions["people"]>>>;

function setup({
  cap,
  clientCap,
  failCounter = false,
  failInsert = false,
}: {
  cap: number;
  clientCap?: number;
  failCounter?: boolean;
  failInsert?: boolean;
}) {
  const sql: Sql = async (query, params) => {
    if (failCounter && query.includes("generation_days")) throw new Error("connection reset");
    if (failInsert && query.includes("insert into section_context")) throw new Error("connection reset");
    return (await pg.query<Record<string, unknown>>(query, params)).rows;
  };
  // Resolves on the next tick, so concurrent requests really overlap.
  const generate = vi.fn<(input: GenerateInput) => Promise<PassageContext>>(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return FAKE;
  });
  const service = createContextService({ sql, generate, now: () => NOW, cap: () => cap, clientCap: clientCap === undefined ? undefined : () => clientCap });
  const ask = (chapter: number, start: number, end = start, opts: { client?: string; people?: People } = {}) =>
    handleContextRequest(
      { book: "acts", chapter, start, end },
      { service, people: async () => (opts.people === undefined ? [] : opts.people), client: opts.client },
    );
  return { generate, ask };
}

async function storedRows() {
  return (await pg.query("select book, start_ch, start_v, end_ch, end_v, prompt_version from section_context")).rows;
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
    // The response matches the schema /api/v1/schema publishes.
    expect(PassageContextResponseSchema.parse(body)).toEqual(body);
    expect(body.data.crossReferences[0].label).toBe("1 Timothy 3:8–13");
    expect(await storedRows()).toEqual([{ book: "acts", start_ch: 6, start_v: 1, end_ch: 6, end_v: 7, prompt_version: 2 }]);
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

describe("storing explanations", () => {
  const PERSON = {
    id: "Stephen@Act.6.5-",
    name: "Stephen",
    usualName: null,
    description: "The first Christian martyr",
    firstRef: "Acts 6:5",
    first: [6, 5] as [number, number],
  };

  it("people lookup failing: the model is called but nothing is stored; the next call with people stores it", async () => {
    const { generate, ask } = setup({ cap: 10 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const first = await ask(6, 1, 1, { people: null });
    expect(first.status).toBe(200);
    const body = (await first.json()) as PassageContextResponse;
    expect(body.ai).toEqual(FAKE);
    expect(body.data.people).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await storedRows()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not storing context for acts 6:1"));

    const second = await ask(6, 1, 1, { people: [PERSON] });
    expect(second.status).toBe(200);
    expect(((await second.json()) as PassageContextResponse).data.people).toEqual([PERSON]);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0][0].people).toEqual([]);
    expect(generate.mock.calls[1][0].people).toEqual([PERSON]);
    expect(await storedRows()).toEqual([{ book: "acts", start_ch: 6, start_v: 1, end_ch: 6, end_v: 7, prompt_version: 2 }]);
  });

  it("people lookup failing still serves a stored explanation without a model call", async () => {
    const { generate, ask } = setup({ cap: 10 });
    expect((await ask(6, 1)).status).toBe(200);
    const res = await ask(6, 2, 2, { people: null });
    expect(res.status).toBe(200);
    expect(((await res.json()) as PassageContextResponse).ai).toEqual(FAKE);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await counter()).toBe(1);
  });

  it("a failed insert after a successful model call still returns the explanation", async () => {
    const { generate, ask } = setup({ cap: 10, failInsert: true });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await ask(6, 1);
    expect(res.status).toBe(200);
    expect(((await res.json()) as PassageContextResponse).ai).toEqual(FAKE);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("storing passage context failed", expect.any(Error));
    expect(await storedRows()).toEqual([]);
  });

  it("a stored explanation for the same start but another end is a miss", async () => {
    // As if Acts 6:1 once started a unit ending at 6:6 (before build-sections was re-run).
    const stale = { ...FAKE, summary: "Old text for a different range." };
    await pg.query(
      `insert into section_context (lang, translation, book, start_ch, start_v, end_ch, end_v, prompt_version, context)
       values ('en', 'bsb', 'acts', 6, 1, 6, 6, 2, $1)`,
      [JSON.stringify(stale)],
    );
    const { generate, ask } = setup({ cap: 10 });
    const res = await ask(6, 1);
    expect(((await res.json()) as PassageContextResponse).ai).toEqual(FAKE);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await storedRows()).toHaveLength(2);
  });
});

describe("per-client daily quota", () => {
  const A = hashClient("198.51.100.1");
  const B = hashClient("198.51.100.2");

  async function clientCount(client: string, bucket = "generation"): Promise<number | null> {
    const rows = (
      await pg.query<{ n: number }>("select n from client_days where day = $1::date and bucket = $2 and client = $3", [DAY, bucket, client])
    ).rows;
    return rows[0]?.n ?? null;
  }

  it("over its quota a client gets 429 daily_cap_reached naming this device; others and cached sections still work", async () => {
    const { generate, ask } = setup({ cap: 100, clientCap: 2 });
    const [s1, s2, s3] = await sectionStarts(3);
    expect((await ask(...s1, s1[1], { client: A })).status).toBe(200);
    expect((await ask(...s2, s2[1], { client: A })).status).toBe(200);

    const refused = await ask(...s3, s3[1], { client: A });
    expect(refused.status).toBe(429);
    const { error } = await refused.json();
    expect(error.code).toBe("daily_cap_reached");
    expect(error.message).toMatch(/this device/i);
    expect(Number(refused.headers.get("Retry-After"))).toBe(9 * 3600);
    // Checked before the global cap: the refusal spent no global slot.
    expect(await counter()).toBe(2);
    expect(await clientCount(A)).toBe(2);

    // A cache hit spends nothing, even over the quota.
    expect((await ask(...s1, s1[1], { client: A })).status).toBe(200);
    // Another client is unaffected.
    expect((await ask(...s3, s3[1], { client: B })).status).toBe(200);
    expect(await clientCount(B)).toBe(1);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("concurrent requests from one client never pass its quota", async () => {
    const { generate, ask } = setup({ cap: 100, clientCap: 3 });
    const responses = await Promise.all((await sectionStarts(8)).map((s) => ask(...s, s[1], { client: A })));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(3);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(5);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(await clientCount(A)).toBe(3);
  });

  it("defaults to 20 per client when no clientCap is given", async () => {
    await pg.query("insert into client_days (day, bucket, client, n) values ($1::date, 'generation', $2, 20)", [DAY, A]);
    const { generate, ask } = setup({ cap: 100 });
    const [s1] = await sectionStarts(1);
    expect((await ask(...s1, s1[1], { client: A })).status).toBe(429);
    expect(generate).not.toHaveBeenCalled();
  });

  it("buckets are separate, and a quota of 0 refuses everything", async () => {
    const sql: Sql = async (q, p) => (await pg.query<Record<string, unknown>>(q, p)).rows;
    expect(await takeClientSlot(sql, { day: DAY, bucket: "report", client: A, cap: 1 })).toBe(true);
    expect(await takeClientSlot(sql, { day: DAY, bucket: "report", client: A, cap: 1 })).toBe(false);
    expect(await takeClientSlot(sql, { day: DAY, bucket: "generation", client: A, cap: 1 })).toBe(true);
    expect(await takeClientSlot(sql, { day: DAY, bucket: "report", client: B, cap: 0 })).toBe(false);
    expect(await clientCount(A, "report")).toBe(1);
    expect(await clientCount(B, "report")).toBeNull();
  });

  it("stores a salted SHA-256 of the IP, never the IP", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(A).toMatch(/^[0-9a-f]{64}$/);
    expect(A).not.toContain("198.51.100.1");
    expect(A).not.toBe(B);
    expect(hashClient("198.51.100.1")).toBe(A);
  });
});
