"""Import original-language words from STEPBible-Data (TAGNT Greek NT, TAHOT Hebrew OT).

Usage: python3 -I scripts/build-words.py path/to/downloaded-dir
Source: https://github.com/STEPBible/STEPBible-Data, folder "Translators Amalgamated OT+NT".
Both datasets state "CC BY 4.0" in their own header (Tyndale House Cambridge / STEPBible.org);
STEPBible files with a different license (some are CC BY-NC) are not used. The
raw files are not committed: STEPBible asks that copies of them not be reposted, so download
them yourself (see the README for the commands).

Input files, looked up by prefix in the directory you pass:
  TAGNT Mat-Jhn*.txt, TAGNT Act-Rev*.txt                     (Greek NT)
  TAHOT Gen-Deu*.txt, TAHOT Jos-Est*.txt, TAHOT Job-Sng*.txt, TAHOT Isa-Mal*.txt   (Hebrew OT)

Output:
  data/words/<slug>.json    {"ch:v": ["G976", "G1078", ...]}   one file per book, same slugs
                            as data/bsb/. Strong's ids in reading order, one per word.
  data/words/lexicon.json   {"G26": {"lemma": "ἀγαπάω", "translit": "agapaō", "gloss": "to love"}}

Choices:
  * Ids are base Strong's ids: leading zeros and the disambiguation letter are dropped
    ("G0026" -> "G26", "G2424G" -> "G2424", "H1254A" -> "H1254"). STEPBible's letters tell apart
    different people or senses that share a number; the lexicon keeps the most common
    lemma/gloss for the base id, and the script reports how many base ids merged
    differing lemmas so the loss is visible.
  * Hebrew prefixes and suffixes (H9001-H9099: "the", "and", "in", pronoun endings) and
    punctuation are skipped: they are not words of their own. Each Hebrew word is
    represented by its root. Greek words are all kept, including the article (G3588).
  * Which text: Greek follows NA28 (words whose edition list contains NA28), Hebrew follows
    the Qere where Leningrad has one (Ketiv-only and LXX-reconstructed "X" words are skipped).
  * Versification: both files give the English (NRSV) reference first, which matches the BSB.
    Hebrew Psalm titles are verse 0 there; the BSB folds the title into verse 1, so verse 0
    words are put at the start of verse 1. Anything that still does not land on a BSB verse
    is counted and listed in the report, never silently dropped.
  * Hebrew transliteration is the most common surface form of the root (unprefixed where
    possible), lowercased, not a lemma transliteration; Greek is transliterated from the lemma.
"""
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BSB = ROOT / "data" / "bsb"
OUT = ROOT / "data" / "words"

# STEPBible book abbreviations in canonical order, matched to data/bsb/index.json order.
STEP_BOOKS = (
    "Gen Exo Lev Num Deu Jos Jdg Rut 1Sa 2Sa 1Ki 2Ki 1Ch 2Ch Ezr Neh Est Job Psa Pro Ecc Sng "
    "Isa Jer Lam Ezk Dan Hos Jol Amo Oba Jon Mic Nam Hab Zep Hag Zec Mal "
    "Mat Mrk Luk Jhn Act Rom 1Co 2Co Gal Eph Php Col 1Th 2Th 1Ti 2Ti Tit Phm Heb Jas "
    "1Pe 2Pe 1Jn 2Jn 3Jn Jud Rev"
).split()
ALIASES = {"Jam": "Jas"}

GREEK_PREFIXES = ["TAGNT Mat-Jhn", "TAGNT Act-Rev"]
HEBREW_PREFIXES = ["TAHOT Gen-Deu", "TAHOT Jos-Est", "TAHOT Job-Sng", "TAHOT Isa-Mal"]

REF_RE = re.compile(r"^([1-3]?[A-Za-z]{2,3})\.(\d+)\.(\d+)(?:[\[({][^\])}]*[\])}])*#(\d+)=(\S*)$")
# Where the BSB's verse numbers follow the KJV instead of the NRSV. STEPBible gives the NRSV
# reference first and the KJV one in [square brackets] per word, so the bracket is used for
# these chapters only (checked against the BSB text: 2 Corinthians 13:12-14 and 3 John 14).
KJV_NUMBERED = {("2Co", 13), ("3Jn", 1)}
# One-off move: the BSB ends Revelation 12:17 with the sentence NRSV numbers 12:18.
VERSE_MOVES = {("Rev", 12, 18): (12, 17)}
ID_RE =re.compile(r"([GH])0*(\d+)[A-Za-z]*")


def base_id(raw: str) -> str | None:
    m = ID_RE.fullmatch(raw)
    return f"{m.group(1)}{m.group(2)}" if m else None


def clean_gloss(text: str) -> str:
    """'God»LORD@Gen.1.1-Heb' -> 'God'; ': beginning»first:1_x' -> 'beginning'.
    The part before » is the rendering at that spot; the lexicon takes the most common one."""
    text = text.strip().strip("}").strip()
    text = text.split("»", 1)[0].split("@", 1)[0]
    text = re.sub(r"^[:\s]+", "", text)
    text = text.replace("_", " ")
    return re.sub(r"\s+", " ", text).strip()


# ---------- Greek transliteration (from the lemma) ----------
GREEK_MAP = {
    "α": "a", "β": "b", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "ē", "θ": "th", "ι": "i",
    "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s",
    "ς": "s", "τ": "t", "υ": "y", "φ": "ph", "χ": "ch", "ψ": "ps", "ω": "ō",
}


def translit_greek(word: str) -> str:
    nfd = unicodedata.normalize("NFD", word.lower())
    # split into base letters with their combining marks
    letters: list[tuple[str, str]] = []
    for ch in nfd:
        if unicodedata.combining(ch):
            if letters:
                letters[-1] = (letters[-1][0], letters[-1][1] + ch)
        elif ch.isalpha():
            letters.append((ch, ""))
    out = []
    n = len(letters)
    for i, (ch, marks) in enumerate(letters):
        nxt = letters[i + 1][0] if i + 1 < n else ""
        nxt_marks = letters[i + 1][1] if i + 1 < n else ""
        piece = GREEK_MAP.get(ch, ch)
        if ch == "γ" and nxt in "γκξχ":
            piece = "n"
        elif ch == "υ" and i > 0 and letters[i - 1][0] in "αεοη" and "̈" not in marks:
            piece = "u"
        elif ch == "ρ" and i == 0 and "̔" in marks:
            piece = "rh"
        elif ch == "ρ" and i > 0 and letters[i - 1][0] == "ρ" and "̔" in marks:
            piece = "rh"
        if i == 0 and "̔" in marks and ch != "ρ":
            # rough breathing: an h before the vowel (and before a leading diphthong's first letter)
            piece = "h" + piece
        elif (
            i == 1
            and "̔" in marks
            and letters[0][0] in "αεοηυω"
            and letters[0][1] == ""
            and ch in "ιυ"
        ):
            out[0] = "h" + out[0]
        out.append(piece)
    return "".join(out)


# ---------- parsing ----------
def find_files(src: Path, prefixes: list[str]) -> list[Path]:
    found = []
    for prefix in prefixes:
        hits = sorted(p for p in src.iterdir() if p.name.startswith(prefix) and p.suffix == ".txt")
        if len(hits) != 1:
            sys.exit(f"expected exactly one file starting with '{prefix}' in {src}, found {len(hits)}")
        found.append(hits[0])
    return found


def check_license(path: Path) -> str:
    head = path.read_text(encoding="utf-8-sig")[:4000]
    if "CC BY 4.0" not in head or "NonCommercial" in head or "CC BY-NC" in head:
        sys.exit(f"{path.name}: header does not say plain CC BY 4.0, refusing to use it")
    m = re.search(r"[^\n]*CC BY 4\.0[^\n]*", head)
    return m.group(0).strip(" \t") if m else ""


def parse_ref(raw: str):
    m = REF_RE.match(raw)
    if not m:
        return None
    book = ALIASES.get(m.group(1), m.group(1))
    ch, v = int(m.group(2)), int(m.group(3))
    if (book, ch) in KJV_NUMBERED:
        alt = re.search(r"\[(\d+)\.(\d+)\]", raw)  # square brackets hold the KJV reference
        if alt and int(alt.group(1)) == ch:
            v = int(alt.group(2))
    ch, v = VERSE_MOVES.get((book, ch, v), (ch, v))
    return book, ch, v, int(m.group(4)), m.group(5)


def norm_hebrew(text: str) -> str:
    """Drop cantillation, meteg, maqqef, punctuation and morpheme marks; keep letters and vowels."""
    text = unicodedata.normalize("NFC", text.split("\\")[0].replace("/", ""))
    return "".join(
        ch for ch in text if not (0x0591 <= ord(ch) <= 0x05AF or ch in "\u05bd\u05be\u05c0\u05c3\u05bf\u05c5")
    )


class Lex:
    """Collects lemma/gloss/translit votes per base id."""

    def __init__(self):
        self.forms = defaultdict(Counter)   # id -> Counter((lemma, gloss))
        self.translit = defaultdict(Counter)  # id -> Counter(translit)
        self.translit_bare = defaultdict(Counter)  # unprefixed occurrences only
        self.bare_by_hebrew = defaultdict(Counter)  # id -> Counter((normalised Hebrew, translit))
        self.dstrongs = defaultdict(set)    # id -> raw disambiguated ids seen

    def entry(self, i: str) -> dict:
        (lemma, gloss), _ = self.forms[i].most_common(1)[0]
        translit = ""
        if i.startswith("H"):
            # prefer a word whose spelling is the lemma itself, else the commonest bare form
            exact = Counter()
            for (heb, tr), n in self.bare_by_hebrew[i].items():
                if heb == norm_hebrew(lemma):
                    exact[tr] += n
            tr = exact or self.translit_bare.get(i) or self.translit.get(i)
            translit = tr.most_common(1)[0][0] if tr else ""
        elif lemma:
            translit = translit_greek(lemma)
            if lemma[0].isupper():
                translit = translit.capitalize()
        if i.startswith("H"):  # cantillation/stress marks in lemmas are noise for readers
            lemma = "".join(c for c in lemma if not 0x0591 <= ord(c) <= 0x05AF)
        return {"lemma": lemma, "translit": translit, "gloss": gloss}


def parse_greek(files: list[Path], lex: Lex):
    verses = defaultdict(list)  # (book, ch, v) -> [(wordno, id)]
    skipped_not_na = 0
    for path in files:
        for line in path.read_text(encoding="utf-8-sig").split("\n"):
            if not line or line[0] == "#":
                continue
            cols = line.rstrip("\r").split("\t")
            ref = parse_ref(cols[0]) if len(cols) > 5 else None
            if not ref:
                continue
            if "NA28" not in cols[5]:
                skipped_not_na += 1
                continue
            book, ch, v, wordno, _ = ref
            raw = cols[3].split("=", 1)[0]
            sid = base_id(raw)
            if not sid:
                continue
            verses[(book, ch, v)].append(sid)
            lemma, _, gloss = cols[4].partition("=")
            lemma = lemma.split(",")[0].strip()
            lex.forms[sid][(lemma, clean_gloss(gloss))] += 1
            lex.dstrongs[sid].add(raw)
    return verses, skipped_not_na


def split_expanded(expanded: str):
    """Yield (dstrong, lemma, gloss) for each tagged element of the expanded-tags column."""
    pieces = re.split(r"(?=[/\\]\{?H\d{4}[A-Za-z]?=)", expanded)
    for piece in pieces:
        piece = piece.lstrip("/\\").strip().lstrip("{").rstrip("}")
        m = re.match(r"^(H\d{4}[A-Za-z]?)=([^=]*)=(.*)$", piece, re.S)
        if m:
            yield m.group(1), m.group(2), m.group(3)


def parse_hebrew(files: list[Path], lex: Lex):
    verses = defaultdict(list)
    skipped_type = Counter()
    for path in files:
        for line in path.read_text(encoding="utf-8-sig").split("\n"):
            if not line or line[0] == "#":
                continue
            cols = line.rstrip("\r").split("\t")
            ref = parse_ref(cols[0]) if len(cols) > 11 else None
            if not ref:
                continue
            book, ch, v, wordno, wtype = ref
            if wtype[:1] not in ("L", "Q", "R"):
                skipped_type[wtype[:1]] += 1
                continue
            tags = [t for t in re.findall(r"H\d{4}[A-Za-z]?", cols[4])]
            roots = [t for t in tags if not t.startswith("H9")]
            if not roots:
                continue
            for t in roots:
                verses[(book, ch, v)].append(base_id(t))
            # lexicon: lemma and gloss from the expanded tags, translit from the word's root segment
            expanded = {d: (lem, gl) for d, lem, gl in split_expanded(cols[11])}
            segs = cols[2].split("/")
            tagparts = cols[4].split("/")
            for d, (lem, gl) in expanded.items():
                if d.startswith("H9"):
                    continue
                sid = base_id(d)
                lex.forms[sid][(lem.split(",")[0].strip(), clean_gloss(gl))] += 1
                lex.dstrongs[sid].add(d)
            hebrew = norm_hebrew(cols[1])
            for t in roots:
                sid = base_id(t)
                idx = next((k for k, part in enumerate(tagparts) if t in part), None)
                if idx is None or len(segs) != len(tagparts):
                    continue
                form = segs[idx].split("\\")[0].lower().replace(".", "").strip("-\\ ")
                if not form:
                    continue
                lex.translit[sid][form] += 1
                if len(segs) == 1 and len(roots) == 1:
                    lex.translit_bare[sid][form] += 1
                    lex.bare_by_hebrew[sid][(hebrew, form)] += 1
    return verses, skipped_type


def load_bible():
    index = json.loads((BSB / "index.json").read_text())
    slugs = {abbr: b["slug"] for abbr, b in zip(STEP_BOOKS, index)}
    texts = {b["slug"]: json.loads((BSB / f"{b['slug']}.json").read_text())["chapters"] for b in index}
    return index, slugs, texts


def main(src_dir: str) -> None:
    src = Path(src_dir)
    greek_files = find_files(src, GREEK_PREFIXES)
    hebrew_files = find_files(src, HEBREW_PREFIXES)
    print("License lines:")
    for f in greek_files + hebrew_files:
        print(f"  {f.name}: {check_license(f)}")

    index, slugs, texts = load_bible()
    lex = Lex()
    g_verses, g_not_na = parse_greek(greek_files, lex)
    h_verses, h_skipped = parse_hebrew(hebrew_files, lex)

    out: dict[str, dict[str, list[str]]] = defaultdict(dict)
    unmapped = Counter()
    unmapped_examples = defaultdict(list)
    bsb_empty = []
    moved_v0 = 0
    for label, verses in (("greek", g_verses), ("hebrew", h_verses)):
        for (book, ch, v), ids in verses.items():
            slug = slugs.get(book)
            if slug is None:
                unmapped[f"{label}:unknown-book"] += 1
                unmapped_examples[f"{label}:unknown-book"].append(f"{book} {ch}:{v}")
                continue
            chapters = texts[slug]
            vv = v
            if v == 0:
                vv = 1  # Psalm titles: the BSB folds the title into verse 1
                moved_v0 += 1
            if ch < 1 or ch > len(chapters) or vv < 1 or vv > len(chapters[ch - 1]):
                unmapped[f"{label}:no-such-bsb-verse"] += 1
                unmapped_examples[f"{label}:no-such-bsb-verse"].append(f"{slug} {ch}:{v}")
                continue
            if not chapters[ch - 1][vv - 1].strip():
                bsb_empty.append(f"{slug} {ch}:{vv}")
                unmapped[f"{label}:bsb-verse-empty"] += 1
                continue
            key = f"{ch}:{vv}"
            if v == 0:
                out[slug][key] = ids + out[slug].get(key, [])  # title words first
            else:
                out[slug][key] = out[slug].get(key, []) + ids

    # write
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    total_verses = total_words = 0
    for b in index:
        slug = b["slug"]
        verses = out.get(slug, {})
        order = sorted(verses, key=lambda k: tuple(map(int, k.split(":"))))
        (OUT / f"{slug}.json").write_text(
            json.dumps({k: verses[k] for k in order}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        total_verses += len(verses)
        total_words += sum(len(x) for x in verses.values())

    used = {i for verses in out.values() for ids in verses.values() for i in ids}
    lexicon = {}
    for i in sorted(used, key=lambda s: (s[0], int(s[1:]))):
        if i not in lex.forms:
            unmapped["lexicon-missing-id"] += 1
            unmapped_examples["lexicon-missing-id"].append(i)
            continue
        lexicon[i] = lex.entry(i)
    (OUT / "lexicon.json").write_text(
        json.dumps(lexicon, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    merged = sum(1 for i in used if len({re.sub(r"^[GH]0*\d+", "", d) for d in lex.dstrongs[i]}) > 1)
    merged_diff = sum(1 for i in used if len({norm_hebrew(f[0]) for f in lex.forms[i]}) > 1)
    merged_gloss = sum(1 for i in used if len({f[1].lower() for f in lex.forms[i]}) > 1)
    no_translit = [i for i, e in lexicon.items() if not e["translit"]]
    size = sum(p.stat().st_size for p in OUT.glob("*.json"))
    print(f"\nBooks written: {sum(1 for b in index if out.get(b['slug']))} / {len(index)}")
    print(f"Verses: {total_verses:,}   words (ids): {total_words:,}   lexicon entries: {len(lexicon):,}")
    print(f"Greek words skipped (not in NA28): {g_not_na:,}   Hebrew words skipped by type: {dict(h_skipped)}")
    print(f"Psalm-title (verse 0) groups moved to verse 1: {moved_v0}")
    print(f"Base ids with several disambiguated forms: {merged:,}; with differing lemma spelling: "
          f"{merged_diff:,}; with differing gloss text: {merged_gloss:,}")
    print(f"Lexicon entries without a transliteration: {len(no_translit)} {no_translit[:10]}")
    print(f"Unmapped: {dict(unmapped) or 'none'}")
    for k, v in unmapped_examples.items():
        print(f"  {k}: {v[:15]}{' ...' if len(v) > 15 else ''}")
    if bsb_empty:
        print(f"  BSB verses with empty text that had words: {bsb_empty[:20]}")
    print(f"Output size: {size / 1e6:.2f} MB in {len(list(OUT.glob('*.json')))} files")

    # BSB verses with no words at all
    missing = []
    for b in index:
        for c, chapter in enumerate(texts[b["slug"]], 1):
            for v, text in enumerate(chapter, 1):
                if text.strip() and f"{c}:{v}" not in out.get(b["slug"], {}):
                    missing.append(f"{b['slug']} {c}:{v}")
    print(f"BSB verses (non-empty) with no word list: {len(missing)} {missing[:15]}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
