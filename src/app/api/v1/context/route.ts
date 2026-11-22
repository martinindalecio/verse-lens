import { rateLimit, withServerTiming } from "@/lib/api";
import { handleContextRequest } from "@/lib/context-handler";

// Explains the BSB section unit holding the reader's selection (src/lib/context-handler.ts).
export const POST = withServerTiming(async (request, _context, timing) => {
  // Every miss here is a paid Opus call, so this is the tightest limit. The daily generation cap
  // (DAILY_GENERATION_CAP) is checked later, only when a call to the model is really needed.
  const limited = rateLimit(request, "context", 10);
  if (limited) return limited;
  return handleContextRequest(await request.json().catch(() => null), { timing });
});
