import { createHash } from "node:crypto";
import { clientIp } from "./api";

// Per-client daily quotas (client_days in db/schema.sql), so one client can't spend the global
// caps (DAILY_GENERATION_CAP, REPORTS_DAILY_CAP) for everyone. A client is a salted SHA-256 of
// its IP: raw IPs are never stored.

/** Default generations per client per UTC day (DAILY_GENERATION_PER_CLIENT). */
export const DEFAULT_GENERATIONS_PER_CLIENT = 20;
/** Default reports per client per UTC day (REPORTS_PER_CLIENT). */
export const DEFAULT_REPORTS_PER_CLIENT = 20;

export type QuotaBucket = "generation" | "report";

/** One query; rows come back as objects. */
export type QuotaSql = (query: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

/** A non-negative integer from the environment; missing or invalid means `fallback`. */
export function parseQuota(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\s*\d+\s*$/.test(raw)) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : fallback;
}

// Used when CLIENT_HASH_SALT is unset (local development). Hashes made with a public salt can be
// reversed by trying every IPv4 address, so production must set its own.
const FALLBACK_SALT = "verse-lens-dev-salt";
let warnedNoSalt = false;

function salt(): string {
  const configured = process.env.CLIENT_HASH_SALT;
  if (configured) return configured;
  if (!warnedNoSalt) {
    warnedNoSalt = true;
    console.warn("CLIENT_HASH_SALT is not set; per-client quotas use a fixed fallback salt.");
  }
  return FALLBACK_SALT;
}

/** The salted SHA-256 (hex) of an IP address. */
export function hashClient(ip: string): string {
  return createHash("sha256").update(`${salt()}:${ip}`).digest("hex");
}

/** The request's client id: the salted hash of its IP. */
export function clientId(request: Request): string {
  return hashClient(clientIp(request));
}

/**
 * Spends one of the client's slots in `bucket` for `day` (UTC date, YYYY-MM-DD). Atomic upsert:
 * false when the client has used `cap` already (and always when cap is 0).
 */
export async function takeClientSlot(
  sql: QuotaSql,
  { day, bucket, client, cap }: { day: string; bucket: QuotaBucket; client: string; cap: number },
): Promise<boolean> {
  const rows = await sql(
    `insert into client_days (day, bucket, client, n) select $1::date, $2, $3, 1 where $4::int > 0
     on conflict (day, bucket, client) do update set n = client_days.n + 1 where client_days.n < $4::int
     returning n`,
    [day, bucket, client, cap],
  );
  return rows.length > 0;
}
