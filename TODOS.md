# TODOs

In priority order.

1. **Shared rate limiting**: `/api/v1` has a per-IP limiter, but it lives in each server instance's memory (limit x instances). Move it to a shared store or Vercel's firewall before a public deploy.
2. **Grounding with real sources:** retrieve from public-domain lexicons and reference works and cite them, instead of relying on the model's memory.
3. **Eval set:** 30-50 passages with known facts and common pitfalls (dates, Strong's numbers, attributions); run it whenever the prompt changes.
4. **Streaming** the context panel so the first sections show up quickly.
5. **Maps and timeline** for the Setting section.
6. **Reader preferences:** choose which traditions appear; remember the last chapter read.
7. **Search** by reference ("John 3:16") and by keyword.
8. **Proper 404 status** for unknown chapters (today the not-found page renders with status 200 because it streams inside Suspense).
9. **Review divine-name rules**: "Spirit" describing God's nature (John 4:24 "God is Spirit") is tagged as the Holy Spirit; NT "the Lord" gets a "God or Jesus" card. Consider per-verse overrides for common passages.
10. **Check low-scoring books** in `docs/research/people-tagging.md` (Psalms 56%, Hosea 66%) and add overrides where names are mis-tagged.
11. **Send corrections upstream**: the Caesar-in-Acts-25-28 fix and others in `data/people/overrides.json` to STEPBible@Gmail.com.
12. **"Not to be confused with" is too loose**: Saul's card lists Shaul, king of Edom, who shares no story with him. Only list people a reader could actually mix up.
13. **Bottom sheet drag**: the sheet can only be dragged by its handle; dragging from its content should move it too.
14. **Batch pre-generation**: generate passage context for Acts and the Gospels (then the rest) with the Batch API at half price, now that it is keyed per BSB section (`docs/designs/reading-companion.md`, Revision 3). Check the output against the eval set before readers see it.
