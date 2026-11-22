// Shared plumbing for the /api/v1 routes: one error shape and a rate limiter.
// Clients (web, iOS) branch on error.code, never on the English message.

export type ApiErrorCode =
  | "invalid_request"
  | "not_found"
  | "rate_limited"
  | "upstream_rate_limited"
  | "refused"
  | "server_misconfigured"
  | "upstream_failed"
  | "internal";

export function apiError(code: ApiErrorCode, message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: { code, message } }, { status, headers });
}

export function clientIp(request: Request): string {
  // On Vercel the first x-forwarded-for entry is the client address.
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

/**
 * Fixed-window limiter per IP and bucket. State lives in this server instance's
 * memory, so with several instances the real ceiling is limit x instances. That
 * is enough to stop casual abuse of the Anthropic-backed route; a shared store
 * (or Vercel's firewall rate limit) is the upgrade if it isn't.
 * Returns a 429 response when over the limit, otherwise null.
 */
export function rateLimit(request: Request, bucket: string, limit: number, windowMs = 60_000): Response | null {
  const now = Date.now();
  const key = `${bucket}:${clientIp(request)}`;
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
    if (windows.size > 5000) {
      for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    }
  }
  w.count++;
  if (w.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
  return apiError("rate_limited", "Too many requests. Try again shortly.", 429, { "Retry-After": String(retryAfter) });
}

/**
 * Server-Timing for one request: `total` plus any phases a route measures (db, files). Browsers
 * show it in dev tools; scripts/time-card.mjs (planned) reads it to check the 300 ms target.
 * Durations of the same name add up; time parallel work as one phase so it isn't counted twice.
 */
export class ServerTiming {
  private readonly started = performance.now();
  private readonly phases = new Map<string, number>();

  async time<T>(name: string, work: Promise<T> | (() => Promise<T>)): Promise<T> {
    const start = performance.now();
    try {
      return await (typeof work === "function" ? work() : work);
    } finally {
      this.phases.set(name, (this.phases.get(name) ?? 0) + performance.now() - start);
    }
  }

  header(): string {
    const entries = [...this.phases, ["total", performance.now() - this.started] as const];
    return entries.map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`).join(", ");
  }
}

/** Wraps a route handler so every response it returns, errors included, carries Server-Timing. */
export function withServerTiming<C>(handler: (request: Request, context: C, timing: ServerTiming) => Response | Promise<Response>) {
  return async (request: Request, context: C): Promise<Response> => {
    const timing = new ServerTiming();
    const response = await handler(request, context, timing);
    try {
      response.headers.set("Server-Timing", timing.header());
      return response;
    } catch {
      // Immutable headers (a proxied response): copy it.
      const copy = new Response(response.body, response);
      copy.headers.set("Server-Timing", timing.header());
      return copy;
    }
  };
}
