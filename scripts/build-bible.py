"""Convert scrollmapper BSB.json into per-book files under data/bsb/.

Usage: python3 scripts/build-bible.py path/to/BSB.json
Source: https://github.com/scrollmapper/bible_databases (formats/json/BSB.json)
The Berean Standard Bible is in the public domain.
"""
import json
import re
import sys
from pathlib import Path

ROMAN = {"I ": "1 ", "II ": "2 ", "III ": "3 "}
RENAME = {"Revelation of John": "Revelation"}

def clean_name(name: str) -> str:
    name = RENAME.get(name, name)
    for roman, arabic in sorted(ROMAN.items(), key=lambda kv: -len(kv[0])):
        if name.startswith(roman):
            return arabic + name[len(roman):]
    return name

def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

def main(src: str) -> None:
    data = json.load(open(src, encoding="utf-8"))
    out = Path(__file__).resolve().parent.parent / "data" / "bsb"
    out.mkdir(parents=True, exist_ok=True)
    index = []
    for i, book in enumerate(data["books"]):
        name = clean_name(book["name"])
        slug = slugify(name)
        chapters = []
        for ch in sorted(book["chapters"], key=lambda c: c["chapter"]):
            verses = sorted(ch["verses"], key=lambda v: v["verse"])
            chapters.append([v["text"].strip() for v in verses])
        (out / f"{slug}.json").write_text(
            json.dumps({"name": name, "slug": slug, "chapters": chapters}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        index.append({"name": name, "slug": slug, "testament": "OT" if i < 39 else "NT", "chapters": len(chapters)})
    (out / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    print(f"wrote {len(index)} books to {out}")

if __name__ == "__main__":
    main(sys.argv[1])
