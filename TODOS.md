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
10. **Review divine-name rules**: "Spirit" describing God's nature (John 4:24 "God is Spirit") is tagged as the Holy Spirit; NT "the Lord" gets a "God or Jesus" card. Consider per-verse overrides for common passages.
11. **Check low-scoring books** in `docs/research/people-tagging.md` (Psalms 56%, Hosea 66%) and add overrides where names are mis-tagged.
12. **Send corrections upstream**: the Caesar-in-Acts-25-28 fix and others in `data/people/overrides.json` to STEPBible@Gmail.com.
