# TODOs

In priority order.

1. **Rate limiting** on `POST /api/context` before any public deploy (it spends API credits).
2. **Persistent cache** for generated context (Postgres/Supabase or `'use cache: remote'`). The in-memory cache is lost on every cold start.
3. **Grounding with real sources:** retrieve from public-domain lexicons and reference works and cite them, instead of relying on the model's memory.
4. **Eval set:** 30-50 passages with known facts and common pitfalls (dates, Strong's numbers, attributions); run it whenever the prompt changes.
5. **Streaming** the context panel so the first sections show up quickly.
6. **Maps and timeline** for the Setting section.
7. **Reader preferences:** choose which traditions appear; remember the last chapter read.
8. **Search** by reference ("John 3:16") and by keyword.
9. **Proper 404 status** for unknown chapters (today the not-found page renders with status 200 because it streams inside Suspense).
10. **People overrides file** (`data/people/overrides.json`): hand-checked fixes for verses where two same-named people share a chapter (Acts 4 Johns, Acts 10 Simons, Acts 13 Sauls) and TIPNR's 10 ambiguous cases; apply in `scripts/build-people.py`.
11. **Divine-name tagging rules** for God, the LORD, the Lord and the Holy Spirit (not in TIPNR's verse lists); review "Lord" meaning "sir/master".
