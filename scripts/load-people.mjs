// Load the people data (data/people/) into Neon Postgres over HTTPS.
//
// Usage: node --env-file=.env.local scripts/load-people.mjs
// Uses DATABASE_URL_UNPOOLED (the direct connection, as Neon recommends for loads and
// migrations), falling back to DATABASE_URL. Applies db/schema.sql, then replaces all people
// reference data in one transaction; per-user tables are not touched. Safe to re-run after
// scripts/build-people.py.
import { neon } from "@neondatabase/serverless";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PEOPLE = path.join(ROOT, "data", "people");
const TRANSLATION = "bsb";
const LANG = "en";
// A person's mentions within this many verses of each other in one chapter form one episode.
const EPISODE_GAP = 5;
// Rows per insert statement; all statements still run in one transaction.
const CHUNK = 5000;

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL_UNPOOLED or DATABASE_URL (neon env pull writes both to .env.local).");
  process.exit(1);
}
const sql = neon(url);

const people = JSON.parse(await readFile(path.join(PEOPLE, "people.json"), "utf-8"));
const ids = new Set(people.map((p) => p.id));

const peopleRows = [];
const nameRows = [];
const relRows = [];
const textRows = [];
for (const p of people) {
  peopleRows.push([p.id, p.strong ?? "", p.name, p.type, p.description ?? "", p.tribe ?? ""]);
  for (const form of p.names ?? [p.name]) nameRows.push([p.id, LANG, TRANSLATION, form]);
  for (const [relation, list] of [
    ["parent", p.parents],
    ["sibling", p.siblings],
    ["partner", p.partners],
    ["child", p.offspring],
  ]) {
    for (const related of new Set(list ?? [])) relRows.push([p.id, related, relation, "tipnr"]);
  }
  const source = p.type === "Divine" ? "human" : "tipnr-ai";
  for (const kind of ["briefest", "brief", "short"]) {
    if (p[kind]) textRows.push([p.id, LANG, kind, p[kind], source]);
  }
}

const mentionRows = [];
const episodeRows = [];
for (const file of (await readdir(path.join(PEOPLE, "mentions"))).sort()) {
  const book = file.replace(/\.json$/, "");
  const verses = JSON.parse(await readFile(path.join(PEOPLE, "mentions", file), "utf-8"));
  const byPerson = new Map();
  for (const [key, spans] of Object.entries(verses)) {
    const [ch, v] = key.split(":").map(Number);
    for (const [start, end, pid, flag] of spans) {
      if (!ids.has(pid)) throw new Error(`${book} ${key}: unknown person ${pid}`);
      mentionRows.push([TRANSLATION, book, ch, v, start, end, pid, flag === 1]);
      if (!pid.startsWith("divine:")) {
        const refs = byPerson.get(pid) ?? new Map();
        refs.set(`${ch}:${v}`, [ch, v]);
        byPerson.set(pid, refs);
      }
    }
  }
  for (const [pid, refs] of byPerson) {
    let run = null;
    for (const [ch, v] of [...refs.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
      if (run && ch === run[2] && v - run[3] <= EPISODE_GAP) run[3] = v;
      else {
        if (run) episodeRows.push([pid, book, ...run]);
        run = [ch, v, ch, v];
      }
    }
    episodeRows.push([pid, book, ...run]);
  }
}

// One insert per chunk: columns passed as arrays and expanded with unnest().
function inserts(table, columns, types, rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = columns.map((_, c) => chunk.map((r) => r[c]));
    const unnest = types.map((t, c) => `$${c + 1}::${t}[]`).join(", ");
    out.push(sql.query(`insert into ${table} (${columns.join(", ")}) select * from unnest(${unnest})`, params));
  }
  return out;
}

const schema = (await readFile(path.join(ROOT, "db", "schema.sql"), "utf-8"))
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);
for (const statement of schema) await sql.query(statement);

await sql.transaction([
  sql.query("truncate person_mentions, episodes, person_names, relationships, people cascade"),
  ...inserts("people", ["id", "strong", "name", "kind", "description", "tribe"], ["text", "text", "text", "text", "text", "text"], peopleRows),
  ...inserts("person_names", ["person_id", "lang", "translation", "form"], ["text", "text", "text", "text"], nameRows),
  ...inserts("relationships", ["person_id", "related_id", "relation", "source"], ["text", "text", "text", "text"], relRows),
  sql.query("delete from person_texts where source in ('tipnr-ai', 'human') and kind in ('briefest', 'brief', 'short')"),
  ...inserts("person_texts", ["person_id", "lang", "kind", "body", "source"], ["text", "text", "text", "text", "text"], textRows),
  ...inserts(
    "person_mentions",
    ["translation", "book", "chapter", "verse", "start_char", "end_char", "person_id", "inferred"],
    ["text", "text", "int", "int", "int", "int", "text", "boolean"],
    mentionRows,
  ),
  ...inserts("episodes", ["person_id", "book", "start_ch", "start_v", "end_ch", "end_v"], ["text", "text", "int", "int", "int", "int"], episodeRows),
]);

console.log(
  `Loaded ${peopleRows.length} people, ${nameRows.length} name forms, ${relRows.length} family links, ` +
    `${mentionRows.length} mentions, ${episodeRows.length} episodes, ${textRows.length} descriptions.`,
);
