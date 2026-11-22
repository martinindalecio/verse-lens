import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@/lib/db", () => ({ db: () => ({ query }) }));

import { POST } from "./route";

let ipCounter = 0;
function post(body: unknown, ip = `10.0.0.${++ipCounter}`) {
  return POST(
    new Request("http://test/api/v1/reports", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    undefined,
  );
}

const inserts = () => query.mock.calls.filter(([sql]) => String(sql).startsWith("insert into mistake_reports"));

beforeEach(() => {
  query.mockReset();
  delete process.env.REPORTS_DAILY_CAP;
  // people lookup finds "Paul@x"; cap upsert returns a row; insert returns nothing.
  query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.startsWith("select 1 from people")) return params[0] === "Paul@Act.7.58-2Pe" ? [{ "?column?": 1 }] : [];
    if (sql.startsWith("insert into report_days")) return [{ n: 1 }];
    return [];
  });
});

describe("POST /api/v1/reports", () => {
  it("accepts a person report", async () => {
    const res = await post({ target: "person:Paul@Act.7.58-2Pe", message: "  Wrong tribe.  " });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("Server-Timing")).toContain("total");
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0][1]).toEqual(["person:Paul@Act.7.58-2Pe", "en", "Wrong tribe."]);
  });

  it("accepts a passage report at a section start", async () => {
    const res = await post({ target: "passage:acts.4.1", message: "Title is off", lang: "en" });
    expect(res.status).toBe(201);
    expect(inserts()[0][1]).toEqual(["passage:acts.4.1", "en", "Title is off"]);
  });

  it("rejects empty and whitespace-only messages", async () => {
    for (const message of ["", "   \n "]) {
      const res = await post({ target: "passage:acts.4.1", message });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_request");
    }
    expect(inserts()).toHaveLength(0);
  });

  it("enforces the 2000 character limit", async () => {
    expect((await post({ target: "passage:acts.4.1", message: "a".repeat(2000) })).status).toBe(201);
    const res = await post({ target: "passage:acts.4.1", message: "a".repeat(2001) });
    expect(res.status).toBe(400);
  });

  it("rejects non-text messages, bad bodies and unsupported languages", async () => {
    expect((await post({ target: "passage:acts.4.1", message: 5 })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post({ target: "passage:acts.4.1", message: "x", lang: "es" })).status).toBe(400);
  });

  it.each(["", "person:", "person:" + "a".repeat(121), "passage:acts", "passage:acts.4", "passage:acts.4.1-3", "passage:acts.0.1", "passage:acts.x.1", "passage:nobook.1.1", "verse:acts.4.1", "Passage:acts.4.1"])(
    "rejects bad target %j",
    async (target) => {
      const res = await post({ target, message: "x" });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_request");
      expect(inserts()).toHaveLength(0);
    },
  );

  it("404s an unknown person", async () => {
    const res = await post({ target: "person:Nobody@Gen.1.1", message: "x" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
    expect(inserts()).toHaveLength(0);
  });

  it("404s a verse that does not start a section", async () => {
    const res = await post({ target: "passage:acts.4.2", message: "x" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("ignores user_id in the body", async () => {
    const res = await post({ target: "passage:acts.4.1", message: "x", user_id: "someone-else" });
    expect(res.status).toBe(201);
    const [sql, params] = inserts()[0];
    expect(sql).toContain("values (null,");
    expect(params).not.toContain("someone-else");
  });

  it("returns 429 rate_limited over the daily cap", async () => {
    query.mockImplementation(async (sql: string) => (sql.startsWith("insert into report_days") ? [] : []));
    const res = await post({ target: "passage:acts.4.1", message: "x" });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(inserts()).toHaveLength(0);
  });

  it("passes REPORTS_DAILY_CAP to the upsert and defaults to 500", async () => {
    await post({ target: "passage:acts.4.1", message: "x" });
    const capCall = () => query.mock.calls.filter(([sql]) => String(sql).startsWith("insert into report_days")).at(-1)![1][1];
    expect(capCall()).toBe(500);
    process.env.REPORTS_DAILY_CAP = "7";
    await post({ target: "passage:acts.4.1", message: "x" });
    expect(capCall()).toBe(7);
    process.env.REPORTS_DAILY_CAP = "abc";
    await post({ target: "passage:acts.4.1", message: "x" });
    expect(capCall()).toBe(500);
  });

  it("rate limits to 5 per minute per IP", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 5; i++) expect((await post({ target: "passage:acts.4.1", message: "x" }, ip)).status).toBe(201);
    const res = await post({ target: "passage:acts.4.1", message: "x" }, ip);
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
  });

  it("returns 500 internal when the database fails", async () => {
    query.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ target: "passage:acts.4.1", message: "x" });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("internal");
  });
});
