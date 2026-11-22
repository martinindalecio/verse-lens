import { apiError, rateLimit, withServerTiming } from "@/lib/api";
import { clientId } from "@/lib/client-quota";
import { checkReport, insertReport, takeClientReportSlot, takeDailySlot } from "@/lib/reports";

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

    // This client's quota first, so one client can't spend the global cap for everyone.
    const clientAllowed = await timing.time("db", () => takeClientReportSlot(clientId(request)));
    if (!clientAllowed) {
      return apiError("daily_cap_reached", "This device has reached today's limit for reports. Please try again tomorrow.", 429, {
        "Retry-After": String(secondsToUtcMidnight()),
      });
    }

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
