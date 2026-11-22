// Checks data/people/identity-tests.json against data/people/mentions/<book>.json.
// A case passes when some mention in that verse whose text slice (offsets into the BSB verse)
// equals `form` has the expected person id. Exits 1 on any failure.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (...p) => JSON.parse(readFileSync(path.join(root, ...p), "utf-8"));

const cases = readJson("data", "people", "identity-tests.json");
const mentionCache = new Map();
const bsbCache = new Map();
const load = (cache, key, loader) => {
  if (!cache.has(key)) cache.set(key, loader());
  return cache.get(key);
};

let failed = 0;
for (const c of cases) {
  const label = `${c.book} ${c.chapter}:${c.verse} "${c.form}"`;
  let found = [];
  let problem = null;
  try {
    const mentions = load(mentionCache, c.book, () => readJson("data", "people", "mentions", `${c.book}.json`));
    const book = load(bsbCache, c.book, () => readJson("data", "bsb", `${c.book}.json`));
    const text = book.chapters[c.chapter - 1]?.[c.verse - 1];
    if (text === undefined) problem = "verse not found in BSB";
    else {
      found = (mentions[`${c.chapter}:${c.verse}`] ?? []).map(([start, end, id]) => ({
        text: text.slice(start, end),
        id,
      }));
    }
  } catch (e) {
    problem = e.message;
  }
  const ok = !problem && found.some((m) => m.text === c.form && m.id === c.expected);
  if (ok) {
    console.log(`ok   ${label} -> ${c.expected}`);
    continue;
  }
  failed++;
  console.log(`FAIL ${label}`);
  console.log(`  expected: ${c.expected}`);
  if (problem) console.log(`  problem:  ${problem}`);
  else if (found.length === 0) console.log("  actual:   (no mentions in this verse)");
  else for (const m of found) console.log(`  actual:   "${m.text}" -> ${m.id}`);
}

console.log(`\n${cases.length - failed}/${cases.length} identity cases passed`);
process.exit(failed ? 1 : 0);
