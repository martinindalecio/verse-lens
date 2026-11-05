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
REF_RE = re.compile(r"^([1-3]?[A-Z][a-z]{1,2})\.(\d+)\.(\d+)([a-z]?)$")


def clean_name(raw: str) -> list[str]:
    """'Paul =KJV,TR; [ ] =ESV,NIV,NA' -> ['Paul']; prefers ESV/NIV/unannotated forms."""
    preferred, fallback = [], []
    for part in raw.split(";"):
        texts, _, versions = part.partition("=")
        for text in texts.split(","):
            text = re.sub(r"[/–\[\]()]", " ", text)
            text = re.sub(r"\s+", " ", text).strip().rstrip(":")
            if not text or not text[0].isupper() or GENTILIC_RE.search(text):
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
            mentions[slug][f"{ch}:{v}"] = sorted([s, e, pid] for (s, e), pid in spans.items())

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

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "mentions").mkdir(exist_ok=True)
    for slug, verses in mentions.items():
        (OUT / "mentions" / f"{slug}.json").write_text(json.dumps(verses, separators=(",", ":")))
    records = [{k: v for k, v in p.items() if k != "forms"} | {"names": sorted({n for f in p["forms"] for n in f["names"]})} for p in people]
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
