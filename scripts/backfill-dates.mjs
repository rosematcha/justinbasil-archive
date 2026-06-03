#!/usr/bin/env node
// Backfill `publishDate` into content files that lack one. Blog collections
// (resources/videos/translations) already have accurate published metadata and are left
// alone; static pages (guide/set-lists/visual/new-decks/highlights/rotation/proxies/
// league/pages) get the page's own Squarespace timestamp (pageUpdatedDate) so the whole
// archive is sortable by date.
//
//   node scripts/backfill-dates.mjs            # DRY RUN
//   node scripts/backfill-dates.mjs --apply
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageUpdatedDate } from './lib/extract.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const CONTENT = path.join(ROOT, 'src/content');
const CORPUS = path.join(ROOT, '_corpus');
const APPLY = process.argv.includes('--apply');

// content dir -> corpus URL prefix (same name for prefixed collections; '' for pages).
const PREFIX = {
  guide: 'guide', 'set-lists': 'set-lists', visual: 'visual', 'new-decks': 'new-decks',
  highlights: 'highlights', rotation: 'rotation', proxies: 'proxies', league: 'league',
  resources: 'resources', translations: 'translations', videos: 'videos',
};

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(fp));
    else if (e.name.endsWith('.md')) out.push(fp);
  }
  return out;
}

/** Map a content .md path to its source corpus .html path. */
function corpusFor(mdPath) {
  const rel = path.relative(CONTENT, mdPath).replace(/\.md$/, ''); // e.g. set-lists/ss11
  const [dir, ...rest] = rel.split(path.sep);
  const sub = rest.join('/');
  if (dir === 'pages') {
    const slug = sub || 'home';
    return path.join(CORPUS, (slug === 'home' ? 'index' : slug) + '.html');
  }
  const prefix = PREFIX[dir];
  if (!prefix) return null;
  return path.join(CORPUS, prefix, sub + '.html');
}

function hasPublishDate(text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  return fm ? /^publishDate:/m.test(fm[1]) : false;
}

/** Insert `publishDate: <date>` into the frontmatter block (before its closing ---). */
function addPublishDate(text, date) {
  return text.replace(/^(---\n[\s\S]*?)\n---/, (_m, fm) => `${fm}\npublishDate: ${date}\n---`);
}

let added = 0, skippedHave = 0, noCorpus = 0, noDate = 0;
const byColl = {};
for (const md of walk(CONTENT)) {
  const text = fs.readFileSync(md, 'utf8');
  if (hasPublishDate(text)) { skippedHave++; continue; }
  const cf = corpusFor(md);
  if (!cf || !fs.existsSync(cf)) { noCorpus++; continue; }
  const date = pageUpdatedDate(fs.readFileSync(cf, 'utf8'));
  if (!date) { noDate++; continue; }
  const coll = path.relative(CONTENT, md).split(path.sep)[0];
  byColl[coll] = (byColl[coll] || 0) + 1;
  added++;
  if (APPLY) fs.writeFileSync(md, addPublishDate(text, date));
}

console.log(`${APPLY ? 'Added' : 'WOULD add'} publishDate to ${added} files:`);
for (const [c, n] of Object.entries(byColl).sort()) console.log(`  ${c}: ${n}`);
console.log(`Skipped (already dated): ${skippedHave} · no corpus match: ${noCorpus} · no timestamp: ${noDate}`);
if (!APPLY) console.log('\nDRY RUN — re-run with --apply to write.');
