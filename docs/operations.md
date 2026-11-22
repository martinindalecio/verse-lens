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
