"""Tag people's names in the BSB text using STEPBible's TIPNR proper-names data.

Usage: python3 scripts/build-people.py path/to/tipnr.txt
Source: https://github.com/STEPBible/STEPBible-Data (TIPNR, CC BY 4.0, STEPBible.org /
Tyndale House Cambridge). The raw file is not committed: STEPBible asks that copies of it
not be reposted, so download it yourself.

TIPNR lists, for every individual, each Hebrew/Greek form of their name and every verse it
occurs in (ESV wording, standard English versification). For each (person, verse) pair this
script looks for the English name in that BSB verse and records the character span.

Writes:
  data/people/people.json             one record per person (Male/Female)
  data/people/mentions/<book>.json    {"ch:v": [[start, end, personId], ...]}
  docs/research/people-tagging.md     accuracy report: found, missed, ambiguous
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BSB = ROOT / "data" / "bsb"
OUT = ROOT / "data" / "people"
REPORT = ROOT / "docs" / "research" / "people-tagging.md"

# STEPBible book abbreviations in canonical order, matched to data/bsb/index.json order.
STEP_BOOKS = (
    "Gen Exo Lev Num Deu Jos Jdg Rut 1Sa 2Sa 1Ki 2Ki 1Ch 2Ch Ezr Neh Est Job Psa Pro Ecc Sng "
    "Isa Jer Lam Ezk Dan Hos Jol Amo Oba Jon Mic Nam Hab Zep Hag Zec Mal "
    "Mat Mrk Luk Jhn Act Rom 1Co 2Co Gal Eph Php Col 1Th 2Th 1Ti 2Ti Tit Phm Heb Jas "
    "1Pe 2Pe 1Jn 2Jn 3Jn Jud Rev"
).split()
ALIASES = {"Jam": "Jas"}

PERSON_TYPES = {"Male", "Female"}
# Words for peoples and tribes ("Jews", "Levites") are linked in TIPNR to the ancestor
# (Judah, Levi). They are not that person, so they are never tagged as them.
GENTILIC_RE = re.compile(r"(ites?|Jews?|Jewess|Greeks?|Gentiles?|Hebrews?|Romans?|Egyptians?)$")
# Some people carry a divine title among their forms (TIPNR lists "God" under Israel/Jacob);
# those words are tagged by the divine-name rules, never as a human person.
DIVINE_WORDS = {"God", "GOD", "LORD", "Lord", "Spirit", "Holy Spirit", "Almighty", "Most High", "Christ"}
REF_RE = re.compile(r"^([1-3]?[A-Z][a-z]{1,2})\.(\d+)\.(\d+)([a-z]?)$")


def clean_name(raw: str) -> list[str]:
    """'Paul =KJV,TR; [ ] =ESV,NIV,NA' -> ['Paul']; prefers ESV/NIV/unannotated forms."""
    preferred, fallback = [], []
    for part in raw.split(";"):
        texts, _, versions = part.partition("=")
        for text in texts.split(","):
            text = re.sub(r"[/–\[\]()]", " ", text)
            text = re.sub(r"\s+", " ", text).strip().rstrip(":")
            if not text or not text[0].isupper() or GENTILIC_RE.search(text) or text in DIVINE_WORDS:
                continue
            if not versions or "ESV" in versions or "NIV" in versions:
                preferred.append(text)
            else:
                fallback.append(text)
    return preferred + fallback


def parse_tipnr(path: Path) -> list[dict]:
    people = []
    for block in path.read_text(encoding="utf-8").split("\n$=========="):
        lines = [l.rstrip("\t\r") for l in block.split("\n")]
        if not lines[0].strip().startswith("PERSON"):
            continue
        header = lines[1].split("\t")
        if len(header) < 9 or "@" not in header[0]:
            continue
        ptype = header[8].strip()
        if ptype not in PERSON_TYPES:
            continue
        uid, _, ustrong = header[0].partition("=")
        person = {
            "id": uid.strip(),
            "strong": ustrong.strip(),
            "name": uid.split("@")[0].replace("_", " "),
            "description": header[1].strip(),
            "parents": [p.strip() for p in header[2].split("+") if p.strip()],
            "siblings": [s.strip() for s in header[3].split(",") if s.strip()],
            "partners": [s.strip() for s in header[4].split(",") if s.strip()],
            "offspring": [s.strip() for s in header[5].split(",") if s.strip()],
            "tribe": header[6].strip(),
            "type": ptype,
            "forms": [],
        }
        for line in lines[2:]:
            if line.startswith("– Total"):
                continue
            if line.startswith("– "):
                f = line.split("\t")
                if len(f) < 5:
                    continue
                refs = [r.strip() for r in f[-1].split(";") if r.strip()]
                person["forms"].append({"kind": f[0][2:].strip(), "names": clean_name(f[3]), "refs": refs})
            elif line.startswith("@") and "=" in line:
                key, _, value = line[1:].partition("=")
                if key in ("Briefest", "Brief", "Short"):
                    person[key.lower()] = value.strip()
        people.append(person)
    return people


def load_bible() -> tuple[dict, dict]:
    index = json.loads((BSB / "index.json").read_text())
    slugs = {abbr: book["slug"] for abbr, book in zip(STEP_BOOKS, index)}
    texts = {b["slug"]: json.loads((BSB / f"{b['slug']}.json").read_text())["chapters"] for b in index}
    return slugs, texts


def apply_overrides(mentions: dict, texts: dict, ids: set, stats: Counter) -> None:
    """Apply data/people/overrides.json. Overridden spans carry a 4th element, 2."""
    overrides = json.loads((OUT / "overrides.json").read_text())
    for o in overrides["spans"]:
        slug, cv = o["ref"].split()
        ch, v = map(int, cv.split(":"))
        if o["person"] not in ids:
            sys.exit(f"override {o['ref']}: unknown person {o['person']}")
        text = texts[slug][ch - 1][v - 1]
        found = [m.span() for m in re.finditer(rf"(?<![\w’'-]){re.escape(o['text'])}(?![\w-])", text)]
        if len(found) < o.get("occurrence", 1):
            sys.exit(f"override {o['ref']}: '{o['text']}' not found in “{text}”")
        start, end = found[o.get("occurrence", 1) - 1]
        verses = mentions.setdefault(slug, {})
        spans = [sp for sp in verses.get(f"{ch}:{v}", []) if sp[1] <= start or sp[0] >= end]
        verses[f"{ch}:{v}"] = sorted(spans + [[start, end, o["person"], 2]])
        stats["overrides"] += 1
    for r in overrides["replace"]:
        if r["to"] not in ids:
            sys.exit(f"override replace: unknown person {r['to']}")
        first, last = r["chapters"]
        for key, spans in mentions.get(r["book"], {}).items():
            if first <= int(key.split(":")[0]) <= last:
                for sp in spans:
                    if sp[2] == r["from"]:
                        sp[2] = r["to"]
                        sp[3:] = [2]
                        stats["overrides"] += 1


# God, the Holy Spirit and "the Lord" are not in TIPNR's verse lists, so they are tagged by
# text rules. Rule-based spans carry a 4th element, 3. Existing person spans win.
JESUS = "Jesus@Isa.7.14-Rev"
DIVINE = [
    {"id": "divine:god", "name": "God", "type": "Divine", "description": "God, called the LORD (YHWH), God, and the Lord",
     "brief": "The God of Israel, the creator, called the LORD (YHWH)"},
    {"id": "divine:spirit", "name": "Holy Spirit", "type": "Divine", "description": "The Spirit of God",
     "brief": "The Spirit of God, called the Holy Spirit"},
    {"id": "divine:lord", "name": "the Lord", "type": "Divine", "description": "In the New Testament, 'the Lord' can mean God or Jesus",
     "brief": "Can mean God or Jesus; the context decides"},
]
# (pattern, person id, testament or None for both). Order matters: longer phrases first.
DIVINE_RULES = [
    (r"Holy Spirit", "divine:spirit", None),
    (r"Spirit", "divine:spirit", None),
    (r"LORD|GOD", "divine:god", None),
    (r"God", "divine:god", None),
    (r"Lord(?= Jesus)", JESUS, "NT"),
    (r"Christ", JESUS, "NT"),
    (r"Lord", "divine:god", "OT"),
    (r"Lord", "divine:lord", "NT"),
]


def tag_divine(mentions: dict, texts: dict, stats: Counter) -> None:
    order = list(texts)
    for slug, chapters in texts.items():
        testament = "OT" if order.index(slug) < 39 else "NT"
        verses = mentions.setdefault(slug, {})
        for ch, chapter in enumerate(chapters, 1):
            for v, text in enumerate(chapter, 1):
                key = f"{ch}:{v}"
                spans = verses.get(key, [])
                added = []
                for pattern, pid, only in DIVINE_RULES:
                    if only and only != testament:
                        continue
                    for m in re.finditer(rf"(?<![\w’'-])(?:{pattern})(?![\w-])", text):
                        if any(sp[0] < m.end() and m.start() < sp[1] for sp in spans + added):
                            continue
                        added.append([m.start(), m.end(), pid, 3])
                        stats[f"divine:{pid}"] += 1
                if added:
                    verses[key] = sorted(spans + added)


def main(src: str) -> None:
    people = parse_tipnr(Path(src))
    slugs, texts = load_bible()

    # (slug, ch, v) -> list of (personId, candidate names, occurrence index)
    wanted = defaultdict(list)
    bad_refs = 0
    for p in people:
        all_names = [n for f in p["forms"] for n in f["names"]]
        for f in p["forms"]:
            for ref in f["refs"]:
                m = REF_RE.match(ref)
                if not m:
                    bad_refs += 1
                    continue
                book, ch, v, occ = m.groups()
                slug = slugs.get(ALIASES.get(book, book))
                if not slug:
                    bad_refs += 1
                    continue
                names = f["names"] + [n for n in all_names if n not in f["names"]]
                wanted[(slug, int(ch), int(v))].append((p["id"], names, ord(occ) - 96 if occ else 0))

    mentions = defaultdict(dict)
    stats = Counter()
    by_book = defaultdict(Counter)
    missed_names = Counter()
    ambiguous_examples = []
    acts_missed = []
    for (slug, ch, v), reqs in wanted.items():
        chapters = texts[slug]
        if ch > len(chapters) or v > len(chapters[ch - 1]):
            stats["no_verse"] += 1
            by_book[slug]["no_verse"] += 1
            continue
        text = chapters[ch - 1][v - 1]
        spans = {}
        # Collapse duplicate requests (a person listed under several forms for one verse).
        seen = set()
        for pid, names, occ in reqs:
            if (pid, occ, names[0] if names else "") in seen:
                continue
            seen.add((pid, occ, names[0] if names else ""))
            stats["refs"] += 1
            by_book[slug]["refs"] += 1
            hit = None
            for name in names:
                found = [m.span() for m in re.finditer(rf"(?<![\w’'-]){re.escape(name)}(?![\w-])", text)]
                if found:
                    hit = found[min(occ - 1, len(found) - 1)] if occ else found[0]
                    break
            if not hit:
                if slug == "acts":
                    acts_missed.append(f"{ch}:{v} {pid}: {text}")
                stats["missed"] += 1
                by_book[slug]["missed"] += 1
                missed_names[names[0] if names else pid] += 1
                continue
            if hit in spans and spans[hit] != pid:
                stats["ambiguous"] += 1
                by_book[slug]["ambiguous"] += 1
                if len(ambiguous_examples) < 25:
                    ambiguous_examples.append(f"{slug} {ch}:{v}: “{text[hit[0]:hit[1]]}” = {spans[hit]} or {pid}")
                continue
            spans[hit] = pid
            stats["found"] += 1
            by_book[slug]["found"] += 1
        if spans:
            # A person with two forms ("Pharaoh", "Pharaoh Neco") can match overlapping words;
            # keep the longest.
            kept = []
            for (s, e), pid in sorted(spans.items(), key=lambda kv: kv[0][0] - kv[0][1]):
                if all(e <= ks or s >= ke for ks, ke, _ in kept):
                    kept.append([s, e, pid])
            mentions[slug][f"{ch}:{v}"] = sorted(kept)

    # Second pass: the BSB often writes a name where the Greek/Hebrew has only "he", so those
    # words have no TIPNR reference. If exactly one person with that name is tagged in the
    # same chapter, the word is theirs. Inferred mentions carry a 4th element, 1.
    name_forms = {p["id"]: {n for f in p["forms"] for n in f["names"]} for p in people}
    for slug, chapters in texts.items():
        verses = mentions.get(slug, {})
        for ch, chapter in enumerate(chapters, 1):
            in_chapter = defaultdict(set)
            for v in range(1, len(chapter) + 1):
                for s, e, pid in verses.get(f"{ch}:{v}", []):
                    in_chapter[chapter[v - 1][s:e]].add(pid)
            unique = {name: next(iter(pids)) for name, pids in in_chapter.items() if len(pids) == 1}
            if not unique:
                continue
            pattern = re.compile(r"(?<![\w’'-])(" + "|".join(map(re.escape, sorted(unique, key=len, reverse=True))) + r")(?![\w-])")
            for v, text in enumerate(chapter, 1):
                key = f"{ch}:{v}"
                spans = verses.get(key, [])
                added = []
                for m in pattern.finditer(text):
                    if any(s <= m.start() < e for s, e, *_ in spans):
                        continue
                    pid = unique[m.group(1)]
                    if m.group(1) in name_forms[pid]:
                        added.append([m.start(), m.end(), pid, 1])
                if added:
                    verses[key] = sorted(spans + added)
                    stats["inferred"] += len(added)
                    by_book[slug]["inferred"] += len(added)
            if verses:
                mentions[slug] = verses

    apply_overrides(mentions, texts, {p["id"] for p in people}, stats)
    tag_divine(mentions, texts, stats)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "mentions").mkdir(exist_ok=True)
    for slug, verses in mentions.items():
        (OUT / "mentions" / f"{slug}.json").write_text(json.dumps(verses, separators=(",", ":")))
    records = [{k: v for k, v in p.items() if k != "forms"} | {"names": sorted({n for f in p["forms"] for n in f["names"]})} for p in people]
    records += DIVINE
    (OUT / "people.json").write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")))

    def pct(c):
        return f"{100 * c['found'] / c['refs']:.1f}%" if c["refs"] else "n/a"

    acts = by_book["acts"]
    lines = [
        "# People tagging report",
        "",
        "Generated by `scripts/build-people.py` from STEPBible TIPNR (CC BY 4.0) against the BSB text.",
        "",
        f"- People (male/female): {len(people)}",
        f"- Person-verse references: {stats['refs']}",
        f"- Found in the BSB text: {stats['found']} ({pct(stats)})",
        f"- Missed (name not in the BSB verse): {stats['missed']}",
        f"- Ambiguous (two people claim the same word): {stats['ambiguous']}",
        f"- Added from chapter context (name the BSB supplies for clarity): {stats['inferred']}",
        f"- Hand-checked corrections applied (data/people/overrides.json): {stats['overrides']}",
        f"- Divine names tagged by rule: God {stats['divine:divine:god']}, Holy Spirit {stats['divine:divine:spirit']}, Jesus (Christ / Lord Jesus) {stats['divine:' + JESUS]}, NT 'the Lord' {stats['divine:divine:lord']}",
        f"- Verse not in BSB: {stats['no_verse']}; unparsed references: {bad_refs}",
        "",
        f"**Acts:** {acts['found']} of {acts['refs']} found ({pct(acts)}), {acts['missed']} missed, {acts['ambiguous']} ambiguous, {acts['inferred']} added from context.",
        "",
        "## By book (lowest first)",
        "",
        "| Book | Refs | Found | Missed | Ambiguous |",
        "|---|---|---|---|---|",
    ]
    for slug, c in sorted(by_book.items(), key=lambda kv: kv[1]["found"] / max(kv[1]["refs"], 1)):
        lines.append(f"| {slug} | {c['refs']} | {pct(c)} | {c['missed']} | {c['ambiguous']} |")
    lines += ["", "## Most-missed names", ""] + [f"- {n}: {c}" for n, c in missed_names.most_common(30)]
    lines += ["", "## Ambiguous examples", ""] + [f"- {e}" for e in ambiguous_examples]
    lines += ["", "## Acts: every miss", ""] + [f"- {m}" for m in sorted(acts_missed, key=lambda x: [int(n) for n in x.split()[0].split(":")])]
    REPORT.write_text("\n".join(lines) + "\n")
    print("\n".join(lines[4:13]))


if __name__ == "__main__":
    main(sys.argv[1])
