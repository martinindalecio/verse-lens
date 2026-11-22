# Operations

## Mistake reports

Reports from "Report a mistake" land in `mistake_reports`. Run these in the Neon SQL editor
(or `psql "$DATABASE_URL"`). Messages are plain text from the public; never render them as HTML.

Open reports, newest first:

```sql
select id, created_at, target, lang, message
from mistake_reports
where not resolved
order by created_at desc;
```

Mark one resolved:

```sql
update mistake_reports set resolved = true where id = 123;
```

Reports received per day (the daily cap is `REPORTS_DAILY_CAP`, default 500; over it the API answers 429):

```sql
select day, n from report_days order by day desc limit 14;
```

## Daily limits

New passage explanations per UTC day: `DAILY_GENERATION_CAP` for everyone (default 200) and
`DAILY_GENERATION_PER_CLIENT` per client (default 20). Reports: `REPORTS_DAILY_CAP` (default 500)
and `REPORTS_PER_CLIENT` (default 20). Per-client counts live in `client_days`, keyed by a
SHA-256 of the IP salted with `CLIENT_HASH_SALT` (set it in production; raw IPs are never
stored). Over any of them the API answers 429 (codes in `docs/api.md`).

Explanations generated per day, and the busiest clients today:

```sql
select day, n from generation_days order by day desc limit 14;
select bucket, left(client, 12) as client, n from client_days where day = current_date order by n desc limit 20;
```

Old per-client rows aren't needed after their day:

```sql
delete from client_days where day < current_date - 7;
```

## Migrating `section_context` to the range key

Stored explanations are keyed by the unit's whole range (`end_ch`, `end_v` were added to the
primary key) so a unit whose range changes is regenerated instead of serving old text. A
database created before that still has the old table, which `create table if not exists` won't
change. It is a cache, so drop it and re-apply the schema (stored explanations are then
regenerated on demand, spending generation slots):

```sql
drop table if exists section_context;
```

then run `node scripts/load-people.mjs` (it applies `db/schema.sql`), or paste the
`section_context` and `client_days` statements from `db/schema.sql` into the SQL editor.
