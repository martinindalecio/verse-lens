# UX research round 1 (October 2026)

Four research agents reviewed the reading-companion plan (`docs/designs/reading-companion.md`) and the clickable mockup. This is the summary and the proposed changes. Nothing here has been tested with real people yet; see `usability-test.md`.

## Findings

### 1. Nobody does "story so far" for the Bible

- **Logos** has the deepest people data (5,000+ people, family diagrams), but on separate expert pages behind a $9.99+/month subscription. Its people tags sit on the Greek/Hebrew, so English tagging is inconsistent.
- **STEPBible** has the open data we plan to use (TIPNR, CC BY), but a dated, hover-based interface that doesn't work on phones.
- **Olive Tree** shows a panel of people and places for the current passage, but as generic dictionary articles that spoil later events.
- **YouVersion, BibleProject, Dwell**: beautiful and free (or donor-funded), little or no in-text study.
- **Kindle** shipped exactly our pattern for novels in June 2026: "Story So Far" recaps stop at your position, and a spoiler warning appears before anything further.

**The gap Verse Lens can own:** a tap-in-place person card, correctly disambiguated in the English text, limited to where you're reading, with facts separate from labeled interpretations, mobile-first, and later in Spanish.

### 2. The mockup gets the content right and the mechanics wrong

Scores out of 10 from the design review: card hierarchy 6, laptop 6, passage tab 5, crafted feel 5, bottom sheet 4, iOS feel 4, trust labels 4, older users and Spanish 4, wayfinding 3, accessibility 3, missing states 2.

The five biggest problems:

1. **Verse numbers are the only way to explain a verse**, and they're about 17×20 pt (Apple's minimum is 44).
2. **No single way back.** Jumps, card chains and tab switches don't share a history, and a home-screen app has no browser back button.
3. **The sheet isn't a real iOS sheet**: fixed pixel heights, a toggle instead of a drag handle, controls out of thumb reach.
4. **Fixed small text** (10-13 px) that ignores the iPhone's text size setting.
5. **"DATA" and "AI" badges** mean nothing to most churchgoers and turn into noise (6+ per card).

### 3. AI trust is the category's weak point

- A January 2026 Bible Society pilot found AI Bible chatbots lean conservative-Evangelical without showing other traditions.
- YouVersion's CEO claims AI misquotes Scripture 15-60% of the time. He isn't a neutral source and didn't publish a method, but the risk is real.
- AI Bible chat apps draw complaints about aggressive subscriptions and confusing answers.

This backs the existing rules: verse text only from `data/bsb/`, a basis and confidence on every claim, and interpretations labeled by tradition (Catholic and Orthodox included).

### 4. Spanish is feasible, with free modern texts

| Option | License | Notes |
|---|---|---|
| **Versión Biblia Libre (VBL)** | CC BY-SA 4.0 | Modern. Machine-readable on GitHub (seven1m/open-bibles). Recommended main text. |
| **Reina-Valera 1909** | Public domain | Traditional names and phrasing church readers know; archaic spelling. Recommended second option. |
| La Biblia en Español Sencillo | CC BY 4.0 | Simple modern Spanish, credit only. |
| RVR1960, NVI, LBLA/NBLA, TLA | Copyrighted | Need a license. Not for now. |

- **No Spanish people data exists.** STEPBible is English-only. We build a person → Spanish name table per translation (Saulo, Pablo, Felipe, Santiago/Jacobo) by matching TIPNR's verse references against the Spanish text, then reviewing misses by hand.
- **Next.js 16 has built-in i18n routing** (`app/[lang]/`, `next/root-params`, JSON dictionaries). No extra library is needed for two languages. With Cache Components on, `generateStaticParams` must return both languages.
- **AI output** is generated directly in Spanish per (language, translation) and stored separately, using the translation's own name forms.

### 5. Skills to add to the repo

| Need | Skill | Why |
|---|---|---|
| Review designs | `mastepanoski/claude-skills`: Nielsen heuristics audit, cognitive walkthrough, WCAG 2.2 audit (MIT) | Real methods with severity ratings; plain instructions, no programs. Better than gstack for this. |
| Plan user tests | `Owl-Listener/designer-skills`: usability test plan, test scenarios, interview summary (MIT) | Thin but correct scaffolding; needs a consent step added. |
| Look crafted | `anthropics/skills`: `frontend-design` | Deliberate type, color and layout; avoids the generic AI look. |
| Later | gstack `design-review` | Strongest visual audit (about 80 checks), but needs the gstack install and a running app. |

Copy only the instruction files into `.claude/skills/` after reading them in full; no scripts.

## Proposed design changes

**Interaction**
1. Tap anywhere on a verse to select it, and tap a second verse for a range; names stay separate targets with extra invisible padding. Explain the BSB section the verse belongs to, with the tapped verse highlighted.
2. One history for everything: cards, tab switches and jumps. A "Back to 9:11" pill just above the sheet restores both the scroll position and the card you came from. Breadcrumbs when two or more deep.
3. A real iOS-style sheet: drag between medium (about 50%) and large; swipe down to close; a fixed header (back, Passage/People switch, close) that never scrolls away.

**Card content**
4. Identity first: "Saul of Tarsus · later called Paul (Acts 13:9) · not King Saul ›". The full "not to be confused with" list folds below.
5. "So far" gets a "You are here · 9:11" marker. Spoiler-safe by default, with an explicit "Show his whole story" switch and a warning (Kindle's pattern).
6. "Connected to" as compact rows, written from the card person's point of view. Family shown as a small tree when the data has it (Logos's pattern).
7. Three description lengths from TIPNR: one line on the card, a short paragraph, a full profile.

**Trust**
8. Drop "DATA" (unmarked means fact). One plain line per AI section: "Summaries written by AI from the verses shown ⓘ". A "Report a mistake" link on every card.

**Real-app polish**
9. Follow the iPhone's text size (system body text, `rem` units), plus an in-app size control. Smallest text 13 px.
10. Safe areas for the notch and home bar, no page bounce behind the sheet, dark mode, system UI font plus a serif for scripture, real section headings in the text.
11. Design every state: loading (facts first, AI text streams in), AI failed or rate-limited, offline, first-time hint on the first name, unnamed people (the eunuch), groups, disputed identities.

**Spanish-ready from day one**
12. All interface text in translation files; `/[lang]/` routes; `lang` and `translation` columns on every stored AI result and person name; layouts that tolerate 30% longer labels.

## Decisions needed

- Which of the 12 changes to accept (the default is all of them).
- Whether to tag Jesus, God, the Spirit and "the Lord" as people.
- Spanish: VBL as the main text plus RV1909 as the traditional option?
- Adopt the three skills into `.claude/skills/`?
