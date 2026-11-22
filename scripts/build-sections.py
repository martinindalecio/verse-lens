"""Extract the BSB's section headings and parallel-passage references into data/sections/.

Usage: python3 scripts/build-sections.py path/to/engbsb_usfm.zip
Source: https://ebible.org/Scriptures/engbsb_usfm.zip (Berean Standard Bible, public domain).

The headings ("The Stoning of Stephen") split each book into the passages readers know. They
give passage context a natural unit, title person-card episodes, and name what comes before
and after a passage without asking a model. The verse text itself still comes from data/bsb/;
this script only checks that every section points at verses that exist there.

The USFM also tags words with Strong's numbers, but those tags are misaligned (Acts 1:1 tags
"book" as G3588, the Greek article), so they are not used.

Output, one file per book: data/sections/<slug>.json
  [{"title": "...", "start": [ch, v], "end": [ch, v], "parallels": ["Luke 3:23–38"],
    "subheadings": [{"title": "...", "start": [ch, v]}]}]
Subheadings are the \\s2 headings plus Psalm 119's acrostic letters (\\qa).
Sections are contiguous and cover every verse of the book.
"""
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BSB = ROOT / "data" / "bsb"
OUT = ROOT / "data" / "sections"

MARKER = re.compile(r"^\\(c|v|s1|s2|qa|r)\s+(.*)$")


def books_in_zip(zip_path: str) -> list[tuple[str, str]]:
    """(file name, text) for the 66 books, in canonical order (files are numbered)."""
    with zipfile.ZipFile(zip_path) as z:
        names = sorted(n for n in z.namelist() if n.endswith(".usfm"))
        books = []
        for name in names:
            text = z.read(name).decode("utf-8")
            if "\\c 1" in text:  # skips front matter and glossary files
                books.append((name, text))
    return books


def header_name(text: str) -> str:
    m = re.search(r"^\\h\s+(.+?)\s*$", text, re.M)
    return m.group(1) if m else ""


def parse(text: str) -> list[dict]:
    sections: list[dict] = []
    pending_title: str | None = None
    pending_parallels: list[str] = []
    pending_sub: str | None = None
    chapter = 0
    for raw in text.splitlines():
        m = MARKER.match(raw.strip())
        if not m:
            continue
        tag, rest = m.group(1), m.group(2).strip()
        if tag == "c":
            chapter = int(rest.split()[0])
        elif tag == "s1":
            if pending_title is not None and rest.startswith("("):
                # Hebrews 11 has a second \s1 "(Joshua–Malachi)" right after its heading: a reference, not a title.
                pending_parallels.append(rest.strip("()"))
                continue
            pending_title = rest if pending_title is None else f"{pending_title}: {rest}"
            pending_parallels = []
        elif tag in ("s2", "qa"):  # qa: Psalm 119's acrostic letters (ALEPH, BETH, ...)
            pending_sub = rest.title() if tag == "qa" else rest
        elif tag == "r":
            refs = rest.strip().strip("()")
            pending_parallels += [r.strip() for r in refs.split(";") if r.strip()]
        elif tag == "v":
            verse = int(re.match(r"\d+", rest).group())  # "3-4" bridges start at 3
            if pending_title is not None or not sections:
                sections.append({
                    "title": pending_title or "",
                    "start": [chapter, verse],
                    "parallels": pending_parallels,
                    "subheadings": [],
                })
                pending_title, pending_parallels = None, []
            if pending_sub is not None:
                sections[-1]["subheadings"].append({"title": pending_sub, "start": [chapter, verse]})
                pending_sub = None
    return sections


def main(zip_path: str) -> None:
    index = json.loads((BSB / "index.json").read_text())
    books = books_in_zip(zip_path)
    if len(books) != len(index):
        sys.exit(f"Expected {len(index)} books in the zip, found {len(books)}.")

    OUT.mkdir(parents=True, exist_ok=True)
    total = untitled = long_sections = 0
    for meta, (name, text) in zip(index, books):
        usfm_name = header_name(text)
        if usfm_name.lower().replace(" ", "") != meta["name"].lower().replace(" ", ""):
            print(f"note: {name} is '{usfm_name}', matched to {meta['name']} by order")
        chapters = json.loads((BSB / f"{meta['slug']}.json").read_text())["chapters"]
        sections = parse(text)

        # Each section ends where the next begins; the last ends at the book's last verse.
        for i, s in enumerate(sections):
            if i + 1 < len(sections):
                c, v = sections[i + 1]["start"]
                s["end"] = [c, v - 1] if v > 1 else [c - 1, len(chapters[c - 2])]
            else:
                s["end"] = [len(chapters), len(chapters[-1])]
            for c, v in (s["start"], s["end"]):
                if not (1 <= c <= len(chapters) and 1 <= v <= len(chapters[c - 1])):
                    sys.exit(f"{meta['slug']}: section '{s['title']}' points at {c}:{v}, which data/bsb lacks.")
            if not s["title"]:
                untitled += 1
            span = sum(
                (s["end"][1] if c == s["end"][0] else len(chapters[c - 1])) - (s["start"][1] if c == s["start"][0] else 1) + 1
                for c in range(s["start"][0], s["end"][0] + 1)
            )
            if span > 30:
                long_sections += 1
        if sections[0]["start"] != [1, 1]:
            sys.exit(f"{meta['slug']}: the first section starts at {sections[0]['start']}, not 1:1.")

        ordered = [{k: s[k] for k in ("title", "start", "end", "parallels", "subheadings")} for s in sections]
        (OUT / f"{meta['slug']}.json").write_text(json.dumps(ordered, ensure_ascii=False, indent=1) + "\n")
        total += len(sections)

    print(f"{total} sections in {len(index)} books; {untitled} without a heading; {long_sections} longer than 30 verses.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
