# Verse Lens API (v1)

Every route lives under `/api/v1`. Requests and responses are JSON. Clients (the web app today,
iOS and Android later) only talk to these routes and never to the database.

The JSON Schemas for the context request, its full response and the error shape are served by
`GET /api/v1/schema`, generated from the same Zod schemas the server uses
(`src/lib/context-schema.ts`). Generate client types from it instead of copying this page.

Every response, errors included, carries a `Server-Timing` header (`total`, plus phases such
as `db`, `files`, `context`).

## Errors

Every error has the same shape:

```json
{ "error": { "code": "daily_cap_reached", "message": "Today's limit for new explanations is reached; saved ones still work." } }
```

Branch on `code`, never on `message` (the English text can change). **Clients must treat
unknown error codes as generic errors**: new codes can be added within v1 without notice.

| Code | HTTP | Meaning | What a client should do |
| --- | --- | --- | --- |
| `invalid_request` | 400 | The body or query is malformed or out of bounds. | Fix the request; don't retry as is. |
| `not_found` | 404 | Unknown book, chapter, person, or a verse that doesn't start a passage. | Don't retry. |
| `rate_limited` | 429 | Too many requests from this IP in the last minute, or reports are paused for today (global cap). `Retry-After` is set. | Wait `Retry-After` seconds. |
| `daily_cap_reached` | 429 | A daily limit is spent: today's new explanations for everyone (`DAILY_GENERATION_CAP`), or this device's share of explanations (`DAILY_GENERATION_PER_CLIENT`) or reports (`REPORTS_PER_CLIENT`). The message says which. `Retry-After` counts to the next UTC midnight. | Show the message and don't retry automatically. Passages someone already opened still load. |
| `upstream_rate_limited` | 429 | The AI provider is rate limiting us. | Offer "Try again" after a moment. |
| `refused` | 422 | The model declined to explain this passage. | Show the message; a retry may help. |
| `server_misconfigured` | 503 | The server's AI key is missing or invalid. | Show a generic error. |
| `upstream_failed` | 502 | Generating the explanation failed, or a counter couldn't be read. | Offer "Try again". |
| `internal` | 500 | Something else failed on the server. | Offer "Try again". |

A response that isn't JSON at all (a platform timeout page, a proxy error) is possible; treat it
as a generic error too.

### Limits

- Per-IP request rate, per server instance: `context` 10/minute, `reports` 5/minute, read routes
  (`books`, `chapters`, `person`) 120/minute. Over it: `rate_limited`.
- New explanations per UTC day: `DAILY_GENERATION_PER_CLIENT` per client (default 20), then
  `DAILY_GENERATION_CAP` for everyone (default 200). Only cache misses count: an explanation that
  is already stored is always served.
- Reports per UTC day: `REPORTS_PER_CLIENT` per client (default 20), then `REPORTS_DAILY_CAP` for
  everyone (default 500).

A "client" for the daily quotas is a salted SHA-256 of the IP address (`CLIENT_HASH_SALT`); raw
IPs are never stored.

## GET /api/v1/books

Every book in reading order.

```json
{
  "translation": "Berean Standard Bible (BSB, public domain)",
  "books": [{ "name": "Genesis", "slug": "genesis", "testament": "OT", "chapters": 50 }]
}
```

## GET /api/v1/books/{book}/chapters/{chapter}

Verse text (index 0 is verse 1) and the people highlighted in it. `spans` maps a verse number to
`[start_char, end_char, person_id]` ranges in that verse's text.

`GET /api/v1/books/acts/chapters/6`

```json
{
  "translation": "Berean Standard Bible (BSB, public domain)",
  "book": { "name": "Acts", "slug": "acts", "testament": "NT", "chapters": 28 },
  "chapter": 6,
  "verses": ["In those days, when the disciples were increasing in number, ..."],
  "people": {
    "spans": { "5": [[50, 57, "Stephen@Act.6.5-"]] },
    "people": { "Stephen@Act.6.5-": { "name": "Stephen", "divine": false, "color": 0 } }
  }
}
```

Errors: `not_found` (404), `rate_limited` (429), `internal` (500).

## GET /api/v1/person?id={id}&at={book}.{chapter}.{verse}[&all=1]

A person's card as seen from where the reader is (`at`). "So far" stops at `at` unless `all=1`.

`GET /api/v1/person?id=Paul@Act.7.58-2Pe&at=acts.9.11`

```json
{
  "card": {
    "id": "Paul@Act.7.58-2Pe",
    "name": "Paul",
    "kind": "person",
    "pronoun": "His",
    "description": "Apostle living at the time of the New Testament",
    "brief": "...",
    "aliases": [{ "form": "Saul", "first": { "book": "acts", "bookName": "Acts", "chapter": 7, "verse": 58 } }],
    "notConfused": [],
    "soFar": [],
    "earlierCount": 0,
    "laterCount": 0,
    "family": [],
    "appearsWith": []
  }
}
```

Errors: `invalid_request` (400), `not_found` (404), `rate_limited` (429), `internal` (500).

## POST /api/v1/context

Explains the BSB section (or the part of a long section) holding the first verse of the reader's
selection. The verse text is always read on the server; clients only send where they are.

Request (schema `ContextRequest`; at most 30 verses):

```json
{ "book": "acts", "chapter": 6, "start": 3, "end": 4 }
```

Response 200 (schema `PassageContextResponse`): the unit explained, the selection echoed back
for highlighting, the AI-written part and the data part. Show `ai` and `data` labeled
separately: `ai` is written by Claude, `data` comes from reference data (BSB headings,
OpenBible.info, STEPBible).

```json
{
  "unit": {
    "book": "acts",
    "bookName": "Acts",
    "title": "The Choosing of the Seven",
    "start": [6, 1],
    "end": [6, 7],
    "reference": "Acts 6:1–7",
    "part": null
  },
  "selection": { "chapter": 6, "start": 3, "end": 4 },
  "ai": {
    "summary": "...",
    "setting": { "speaker": "Narrator", "audience": "...", "place": "Jerusalem", "when": "c. AD 33-35", "confidence": "medium" },
    "historical_context": [{ "text": "...", "basis": "Acts 6:1", "confidence": "high" }],
    "cultural_context": [],
    "interpretations": [{ "tradition": "Reformed", "view": "..." }],
    "open_questions": []
  },
  "data": {
    "before": { "title": "Gamaliel’s Advice", "start": [5, 33], "end": [5, 42], "reference": "5:33–42" },
    "after": { "title": "The Arrest of Stephen", "start": [6, 8], "end": [6, 15], "reference": "6:8–15" },
    "crossReferences": [
      { "label": "1 Timothy 3:8–13", "to": { "book": "1-timothy", "chapter": 3, "verse": 8 }, "source": "bsb", "votes": null }
    ],
    "keyTerms": [{ "strongs": "G1248", "lemma": "διακονία", "translit": "diakonia", "gloss": "service", "count": 2 }],
    "people": [
      {
        "id": "Stephen@Act.6.5-",
        "name": "Stephen",
        "usualName": null,
        "description": "The first Christian martyr",
        "firstRef": "Acts 6:5",
        "first": [6, 5]
      }
    ]
  }
}
```

`data.people` is empty when the section names nobody, or when the people lookup failed (the
explanation is then still given, but not stored, so a later request stores a better one).

Errors: `invalid_request` (400), `not_found` (404), `refused` (422), `rate_limited`,
`daily_cap_reached`, `upstream_rate_limited` (429), `upstream_failed` (502),
`server_misconfigured` (503). A cache miss can take a minute or more.

## POST /api/v1/reports

"Report a mistake" on a person card or a passage.

Request: `target` is `person:<id>` or `passage:<book>.<chapter>.<verse>` (the start verse of the
explained unit); `message` is 1–2000 characters of plain text; `lang` is optional (`en`).

```json
{ "target": "passage:acts.6.1", "message": "The date range looks off.", "lang": "en" }
```

Response 201:

```json
{ "ok": true }
```

Errors: `invalid_request` (400), `not_found` (404), `rate_limited` (429: per-minute limit or
the global daily cap), `daily_cap_reached` (429: this device's daily quota), `internal` (500).

## GET /api/v1/schema

JSON Schemas generated from the server's Zod schemas:

```json
{
  "ContextRequest": { "type": "object", "...": "..." },
  "PassageContextResponse": { "type": "object", "...": "..." },
  "PassageContext": { "type": "object", "...": "..." },
  "ApiError": { "type": "object", "...": "..." }
}
```

`PassageContext` is the AI part alone (`PassageContextResponse.ai`), also used as the model's
structured output format.

## Changelog

- **2026-11-22**: `POST /api/v1/context` now answers `{ unit, selection, ai, data }` (one
  explanation per BSB section, with neighbouring sections, cross references, key words and people
  from data) instead of `{ context }` for the exact selection. `/api/v1/schema` now also serves
  `PassageContextResponse` and `ApiError`. New error code `daily_cap_reached` (429) on
  `/context` and `/reports`. v1 has no native clients yet, so the version stays v1.
