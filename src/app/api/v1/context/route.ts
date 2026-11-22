import { rateLimit, withServerTiming } from "@/lib/api";
import { clientId } from "@/lib/client-quota";
import { handleContextRequest } from "@/lib/context-handler";

// A cache miss waits for a full Opus answer (up to 16k output tokens), which can take minutes.
export const maxDuration = 300;

// Explains the BSB section unit holding the reader's selection (src/lib/context-handler.ts).
export const POST = withServerTiming(async (request, _context, timing) => {
  // Every miss here is a paid Opus call, so this is the tightest limit. The per-client quota
  // (DAILY_GENERATION_PER_CLIENT) and the daily generation cap (DAILY_GENERATION_CAP) are checked
  // later, only when a call to the model is really needed.
  const limited = rateLimit(request, "context", 10);
  if (limited) return limited;
  return handleContextRequest(await request.json().catch(() => null), { timing, client: clientId(request) });
});
