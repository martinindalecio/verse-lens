@AGENTS.md

## Project docs

- **docs/DESIGN.md**: product decisions, risks, and why the app is shaped the way it is
- **TODOS.md**: deferred work, in priority order

## Rules for this codebase

- Facts and interpretation stay separate. Historical and cultural claims go in `historical_context` / `cultural_context` with a `basis` and `confidence`; readings of meaning go only in `interpretations`, labeled by tradition. Don't merge these in the schema or the UI.
- Verse text always comes from `data/bsb/`, never from the client.
- Bump `PROMPT_VERSION` in `src/lib/context.ts` whenever the prompt or `PassageContextSchema` changes.
