import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Neon Postgres over HTTPS (one-shot queries; no pool to manage). DATABASE_URL is the pooled
// connection string written to .env.local by `neon env pull` / `neon deploy`; in production it
// comes from the hosting provider's environment variables. Never log it: it holds the password.
let client: NeonQueryFunction<false, false> | undefined;

export function db() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Run `neon env pull` to write it to .env.local.");
    client = neon(url);
  }
  return client;
}
