"""Import OpenBible.info cross references into data/crossrefs/.

Usage: python3 -I scripts/build-crossrefs.py path/to/cross-references.zip
Source: https://a.openbible.info/data/cross-references.zip (https://www.openbible.info/labs/cross-references/).
License: CC BY. Credit "OpenBible.info" wherever the data is shown.

The zip holds one tab-separated file: "From Verse", "To Verse", "Votes", with references like
Gen.1.1, 1Cor.13.4 and ranges like Col.1.16-Col.1.17. Votes are community ratings; negative or
zero votes mean the pairing was rejected, so only votes >= 1 are kept. Treat the download as
untrusted: it is only parsed, never executed, and every field is validated.

Output, one file per book: data/crossrefs/<slug>.json
  {"<chapter>:<verse>": [{"ref": "acts.9.4" | "acts.9.4-acts.9.6", "votes": 12}, ...]}
Each verse keeps its 10 best-voted references (ties broken by canonical order). Every source
verse and every target (both ends of a range) must exist in data/bsb/; the rest are dropped
and counted. Verse text still comes from data/bsb/ only.
"""
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BSB = ROOT / "data" / "bsb"
OUT = ROOT / "data" / "crossrefs"
MEMBER = "cross_references.txt"
MAX_PER_VERSE = 10
MAX_ZIP_BYTES = 64 * 1024 * 1024  # the real file is about 8 MB unpacked

# OpenBible abbreviation -> our slug (data/bsb/index.json), in canonical order.
ABBREVIATIONS = {
    "Gen": "genesis", "Exod": "exodus", "Lev": "leviticus", "Num": "numbers", "Deut": "deuteronomy",
    "Josh": "joshua", "Judg": "judges", "Ruth": "ruth", "1Sam": "1-samuel", "2Sam": "2-samuel",
    "1Kgs": "1-kings", "2Kgs": "2-kings", "1Chr": "1-chronicles", "2Chr": "2-chronicles",
    "Ezra": "ezra", "Neh": "nehemiah", "Esth": "esther", "Job": "job", "Ps": "psalms",
    "Prov": "proverbs", "Eccl": "ecclesiastes", "Song": "song-of-solomon", "Isa": "isaiah",
    "Jer": "jeremiah", "Lam": "lamentations", "Ezek": "ezekiel", "Dan": "daniel", "Hos": "hosea",
    "Joel": "joel", "Amos": "amos", "Obad": "obadiah", "Jonah": "jonah", "Mic": "micah",
    "Nah": "nahum", "Hab": "habakkuk", "Zeph": "zephaniah", "Hag": "haggai", "Zech": "zechariah",
    "Mal": "malachi", "Matt": "matthew", "Mark": "mark", "Luke": "luke", "John": "john",
    "Acts": "acts", "Rom": "romans", "1Cor": "1-corinthians", "2Cor": "2-corinthians",
    "Gal": "galatians", "Eph": "ephesians", "Phil": "philippians", "Col": "colossians",
    "1Thess": "1-thessalonians", "2Thess": "2-thessalonians", "1Tim": "1-timothy",
    "2Tim": "2-timothy", "Titus": "titus", "Phlm": "philemon", "Heb": "hebrews", "Jas": "james",
    "1Pet": "1-peter", "2Pet": "2-peter", "1John": "1-john", "2John": "2-john", "3John": "3-john",
    "Jude": "jude", "Rev": "revelation",
}

REF = re.compile(r"^([0-9A-Za-z]+)\.(\d{1,3})\.(\d{1,3})$")


def parse_ref(text: str, line_no: int) -> tuple[str, int, int]:
    m = REF.match(text)
    if not m:
        sys.exit(f"line {line_no}: cannot parse reference {text!r}")
    abbr = m.group(1)
    if abbr not in ABBREVIATIONS:
        sys.exit(f"line {line_no}: unknown book abbreviation {abbr!r} in {text!r}; add it to ABBREVIATIONS.")
    return ABBREVIATIONS[abbr], int(m.group(2)), int(m.group(3))


def read_rows(zip_path: str) -> list[str]:
    with zipfile.ZipFile(zip_path) as z:
        info = z.getinfo(MEMBER)  # KeyError if the layout changed: fail loudly
        if info.file_size > MAX_ZIP_BYTES:
            sys.exit(f"{MEMBER} is {info.file_size} bytes, more than the {MAX_ZIP_BYTES} byte limit.")
        return z.read(MEMBER).decode("utf-8").splitlines()


def main(zip_path: str) -> None:
    index = json.loads((BSB / "index.json").read_text())
    order = {b["slug"]: i for i, b in enumerate(index)}
    if set(ABBREVIATIONS.values()) != set(order) or len(ABBREVIATIONS) != len(order):
        sys.exit("ABBREVIATIONS must map to each of the BSB's books exactly once.")
    lengths = {}  # slug -> verses per chapter
    for b in index:
        chapters = json.loads((BSB / f"{b['slug']}.json").read_text())["chapters"]
        lengths[b["slug"]] = [len(c) for c in chapters]

    def exists(slug: str, c: int, v: int) -> bool:
        return 1 <= c <= len(lengths[slug]) and 1 <= v <= lengths[slug][c - 1]

    rows = read_rows(zip_path)
    if not rows or not rows[0].startswith("From Verse\tTo Verse\tVotes"):
        sys.exit(f"unexpected header: {rows[0] if rows else '(empty file)'!r}")

    by_book: dict[str, dict[str, list]] = {slug: {} for slug in order}
    total = low_votes = missing_target = missing_source = bad_range = 0
    for n, line in enumerate(rows[1:], start=2):
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            sys.exit(f"line {n}: expected 3 tab-separated fields, got {len(parts)}")
        src_text, dst_text, votes_text = parts
        if not re.fullmatch(r"-?\d+", votes_text):
            sys.exit(f"line {n}: votes {votes_text!r} is not an integer")
        total += 1
        src = parse_ref(src_text, n)
        ends = [parse_ref(p, n) for p in dst_text.split("-")]
        if len(ends) > 2:
            sys.exit(f"line {n}: more than one '-' in {dst_text!r}")
        votes = int(votes_text)
        if votes < 1:
            low_votes += 1
            continue
        if not exists(*src):
            missing_source += 1
            continue
        if not all(exists(*e) for e in ends):
            missing_target += 1
            continue
        if len(ends) == 2:
            if ends[0] == ends[1]:
                ends = ends[:1]
            elif (order[ends[0][0]], *ends[0][1:]) > (order[ends[1][0]], *ends[1][1:]):
                bad_range += 1
                continue
        ref = "-".join(f"{s}.{c}.{v}" for s, c, v in ends)
        sort_key = (order[ends[0][0]], ends[0][1], ends[0][2], len(ends))
        by_book[src[0]].setdefault(f"{src[1]}:{src[2]}", []).append((votes, sort_key, ref))

    OUT.mkdir(parents=True, exist_ok=True)
    verses = kept = trimmed = 0
    for slug in order:
        book = {}
        for key in sorted(by_book[slug], key=lambda k: tuple(map(int, k.split(":")))):
            refs = sorted(by_book[slug][key], key=lambda r: (-r[0], r[1]))
            trimmed += max(0, len(refs) - MAX_PER_VERSE)
            refs = refs[:MAX_PER_VERSE]
            book[key] = [{"ref": r[2], "votes": r[0]} for r in refs]
            kept += len(refs)
        verses += len(book)
        (OUT / f"{slug}.json").write_text(json.dumps(book, separators=(",", ":")) + "\n")

    print(f"{total} rows read from {MEMBER}")
    print(f"dropped: {low_votes} with votes < 1, {missing_target} with a target not in data/bsb, "
          f"{missing_source} with a source not in data/bsb, {bad_range} reversed ranges, "
          f"{trimmed} beyond the top {MAX_PER_VERSE} per verse")
    print(f"kept {kept} references on {verses} verses in {len(order)} books -> {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
