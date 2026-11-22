import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/v1/schema", () => {
  it("serves the request, the whole context response, the AI part and the error shape", async () => {
    const res = await GET(new Request("http://test/api/v1/schema"), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["ApiError", "ContextRequest", "PassageContext", "PassageContextResponse"]);
    const response = body.PassageContextResponse;
    expect(response.required).toEqual(["unit", "selection", "ai", "data"]);
    expect(Object.keys(response.properties.data.properties)).toEqual(["before", "after", "crossReferences", "keyTerms", "people"]);
    expect(response.properties.ai.required).toContain("historical_context");
  });
});
