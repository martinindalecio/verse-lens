# Verse Lens: design notes

## The problem

Readers hit a verse and don't know the world behind it: who is talking, what just happened, what a custom meant, why a word was chosen. Study Bibles and commentaries have this, but they're dense, and they're written from one tradition's point of view.

## What makes it different from "ask ChatGPT about this verse"

A chat box makes you write the question. Verse Lens gives a **structured context panel** for any passage: the same sections every time, so you learn what to look for. Two rules keep it honest:

1. **Every factual claim shows its basis and a confidence level.** "Nicodemus was on the Sanhedrin" rests on the text itself (John 3:1, 7:50). "Teachers met students at night" is a scholarly reconstruction and is labeled that way.
2. **Facts and interpretation never mix.** History, geography, culture and language are presented as facts. What a passage *means* appears only under "How traditions read it", with each view labeled (Catholic, Orthodox, Reformed, Jewish, historical-critical, and so on) and shown side by side without ranking.

## Risks, most serious first

| Risk | Why it matters | Mitigation now | Next step |
| --- | --- | --- | --- |
| **Made-up facts** (wrong dates, invented customs, made-up citations, wrong Strong's numbers) | One confident error in a Bible app costs the trust the app depends on. | Prompt forbids invented citations; every claim carries a `basis` and a `confidence`; Strong's left blank when unsure; a disclaimer in the UI. | Retrieval over public-domain reference works (Strong's/BDB/Thayer lexicons, Easton's Bible Dictionary, Matthew Henry, ISBE 1915) so claims cite real text. Spot-check eval set. |
| **Theological bias** | Readers from different traditions will distrust an app that quietly takes sides. | Interpretation lives in its own labeled section. | Review prompts with readers from several traditions; let users choose which traditions they see. |
| **Cost per user** | Every uncached passage is a full Opus call. | In-memory cache per passage (the answer doesn't depend on the user). | Persistent cache (database or `'use cache: remote'`); pre-generate popular passages with the Batch API at half price. |
| **Abuse of the API route** | It's an open endpoint that spends money. | Range limits (max 30 verses), the server looks up the text itself. | Rate limiting per IP / auth before any public deploy. |
| **Translation licensing** | NIV, ESV and NLT need licenses. | Ships the BSB, which is public domain. | WEB/KJV as alternates; license others only if users ask. |

## Decisions

- **Translation:** Berean Standard Bible. Modern English and public domain since 2023.
- **Stack:** Next.js 16 App Router, TypeScript, Tailwind 4. Bible text is bundled as JSON (about 4 MB), so there's no external Bible API dependency.
- **Model:** `claude-opus-5-5`, effort `medium`, structured outputs via `betaZodOutputFormat`, with server-side refusal fallbacks (`fallbacks: "default"`).
- **Context window:** the whole chapter goes to the model, with the selected verses marked, so "before / after" is grounded in the actual text.
