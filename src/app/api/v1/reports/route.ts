import { apiError, rateLimit, withServerTiming } from "@/lib/api";
import { checkReport, insertReport, takeDailySlot } from "@/lib/reports";

// POST /api/v1/reports  { target, message, lang? }  ->  201 { ok: true }
export const POST = withServerTiming(async (request, _context: unknown, timing) => {
  const limited = rateLimit(request, "reports", 5);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_request", "Expected a JSON body.", 400);
  }

  try {
    const checked = await timing.time("db", () => checkReport(body));
    if (!checked.ok) return apiError(checked.status === 404 ? "not_found" : "invalid_request", checked.message, checked.status);

    const allowed = await timing.time("db", () => takeDailySlot());
    if (!allowed) {
      return apiError("rate_limited", "Reports are paused for today. Please try again tomorrow.", 429, {
        "Retry-After": String(secondsToUtcMidnight()),
      });
    }

    await timing.time("db", () => insertReport(checked.value));
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("report failed", error);
    return apiError("internal", "Couldn't send your report. Try again.", 500);
  }
});

function secondsToUtcMidnight(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}
