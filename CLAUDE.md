@AGENTS.md

## Project docs

- **docs/DESIGN.md**: product decisions, risks, and why the app is shaped the way it is
- **docs/designs/reading-companion.md**: approved plan for person cards, passage context, sync and the build order
- **TODOS.md**: deferred work, in priority order

## Rules for this codebase

- Facts and interpretation stay separate. Historical and cultural claims go in `historical_context` / `cultural_context` with a `basis` and `confidence`; readings of meaning go only in `interpretations`, labeled by tradition. Don't merge these in the schema or the UI.
- Verse text always comes from `data/bsb/`, never from the client.
- Bump `PROMPT_VERSION` in `src/lib/context.ts` whenever the prompt or `PassageContextSchema` changes.

## gstack (recommended)

This project uses [gstack](https://github.com/garrytan/gstack) for AI-assisted workflows.
Install it for the best experience:

```bash
git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
```

Skills like /qa, /ship, /review, /investigate, and /browse become available after install.
Use /browse for all web browsing (Aside first, the bundled gstack browser as fallback). Use ~/.claude/skills/gstack/... for gstack file paths.
