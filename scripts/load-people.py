"""Load the people data (data/people/) into Postgres.

Usage: DATABASE_URL=postgresql://... python3 scripts/load-people.py
Needs psql on PATH. Applies db/schema.sql, then replaces all people reference data in one
transaction (per-user tables are not touched). Safe to re-run after build-people.py.
"""
import csv
import io
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PEOPLE = ROOT / "data" / "people"
SCHEMA = ROOT / "db" / "schema.sql"
TRANSLATION, LANG = "bsb", "en"
# A person's mentions within this many verses of each other in one chapter form one episode.
EPISODE_GAP = 5


def copy_block(table: str, columns: list[str], rows: list[list]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n", quoting=csv.QUOTE_ALL)  # quoted "" stays "", not NULL
    writer.writerows(rows)
    return f"copy {table} ({', '.join(columns)}) from stdin with (format csv);\n{buf.getvalue()}\\.\n"


def main() -> None:
    url = os.environ.get("DATABASE_URL") or sys.exit("Set DATABASE_URL")
    people = json.loads((PEOPLE / "people.json").read_text())
    ids = {p["id"] for p in people}

    people_rows, name_rows, rel_rows, text_rows = [], [], [], []
    for p in people:
        people_rows.append([p["id"], p.get("strong", ""), p["name"], p["type"], p.get("description", ""), p.get("tribe", "")])
        for form in p.get("names", [p["name"]]):
            name_rows.append([p["id"], LANG, TRANSLATION, form])
        father_mother = p.get("parents", [])
        for relation, field in (("parent", father_mother), ("sibling", p.get("siblings", [])),
                                ("partner", p.get("partners", [])), ("child", p.get("offspring", []))):
            for related in dict.fromkeys(field):
                rel_rows.append([p["id"], related, relation, "tipnr"])
        source = "human" if p["type"] == "Divine" else "tipnr-ai"
        for kind in ("briefest", "brief", "short"):
            if p.get(kind):
                text_rows.append([p["id"], LANG, kind, p[kind], source])

    mention_rows, episode_rows = [], []
    for path in sorted((PEOPLE / "mentions").glob("*.json")):
        book = path.stem
        verses = json.loads(path.read_text())
        by_person = {}
        for key, spans in verses.items():
            ch, v = map(int, key.split(":"))
            for span in spans:
                start, end, pid = span[:3]
                if pid not in ids:
                    sys.exit(f"{book} {key}: unknown person {pid}")
                flag = span[3] if len(span) > 3 else 0
                mention_rows.append([TRANSLATION, book, ch, v, start, end, pid, "true" if flag == 1 else "false"])
                if not pid.startswith("divine:"):
                    by_person.setdefault(pid, set()).add((ch, v))
        for pid, refs in by_person.items():
            run = None
            for ch, v in sorted(refs):
                if run and ch == run[2] and v - run[3] <= EPISODE_GAP:
                    run[3] = v
                else:
                    if run:
                        episode_rows.append([pid, book, *run])
                    run = [ch, v, ch, v]
            episode_rows.append([pid, book, *run])

    sql = "\\set ON_ERROR_STOP on\n" + SCHEMA.read_text() + "\nbegin;\n"
    sql += "truncate person_mentions, episodes, person_names, relationships, people cascade;\n"
    sql += copy_block("people", ["id", "strong", "name", "kind", "description", "tribe"], people_rows)
    sql += copy_block("person_names", ["person_id", "lang", "translation", "form"], name_rows)
    sql += copy_block("relationships", ["person_id", "related_id", "relation", "source"], rel_rows)
    sql += "delete from person_texts where source in ('tipnr-ai', 'human') and kind in ('briefest', 'brief', 'short');\n"
    sql += copy_block("person_texts", ["person_id", "lang", "kind", "body", "source"], text_rows)
    sql += copy_block("person_mentions", ["translation", "book", "chapter", "verse", "start_char", "end_char", "person_id", "inferred"], mention_rows)
    sql += copy_block("episodes", ["person_id", "book", "start_ch", "start_v", "end_ch", "end_v"], episode_rows)
    sql += "commit;\n"

    subprocess.run(["psql", url, "-q", "-X"], input=sql, text=True, check=True)
    print(f"Loaded {len(people_rows)} people, {len(name_rows)} name forms, {len(rel_rows)} family links, "
          f"{len(mention_rows)} mentions, {len(episode_rows)} episodes, {len(text_rows)} descriptions.")


if __name__ == "__main__":
    main()
