#!/usr/bin/env node
// Restores line breaks in card-reference lists that the Squarespace→Astro conversion
// flattened (the original separated cards with <br>, which were stripped, leaving
// run-on text like "Lumineon V BRS 40 Manaphy BRS 41 …"). Uses the _corpus/ HTML as
// the source of truth: for each <br>-separated card list, find its run-on form in the
// markdown and re-break it. Only touches blocks where the run-on form matches exactly.
//
//   node scripts/restore-card-breaks.mjs            # dry-run (report only)
//   node scripts/restore-card-breaks.mjs --apply    # write changes
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const APPLY = process.argv.includes('--apply');

// content file → corpus html (mirror layout under _corpus/)
const FILES = [
  'guide/energy', 'guide/search', 'guide/draw', 'guide/damage', 'guide/disruption',
  'guide/consistency', 'guide/recovery', 'guide/switching', 'guide/appendix2',
  'guide/gusting', 'set-lists/classic',
];

const clean = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

let totalBlocks = 0;
let totalFiles = 0;
for (const rel of FILES) {
  const mdPath = path.join(ROOT, 'src/content', rel + '.md');
  const corpusPath = path.join(ROOT, '_corpus', rel + '.html');
  if (!fs.existsSync(mdPath) || !fs.existsSync(corpusPath)) {
    console.log(`skip (missing): ${rel}`);
    continue;
  }
  const md0 = fs.readFileSync(mdPath, 'utf8');
  let md = md0;
  const dom = new JSDOM(fs.readFileSync(corpusPath, 'utf8'));
  let restored = 0;

  for (const el of dom.window.document.querySelectorAll('p, span, td, li')) {
    if (!el.querySelector('br')) continue;
    const segs = el.innerHTML
      .split(/<br\s*\/?>/i)
      .map(clean)
      .filter(Boolean);
    if (segs.length < 2) continue;
    // Only card-reference lists: every segment ends with "<SET> <NUM>".
    if (!segs.every((s) => /[A-Z][A-Za-z0-9]{1,5} \d{1,3}$/.test(s))) continue;
    const runon = segs.join(' ');
    const broken = segs.join('<br>\n');
    if (md.includes(runon) && !md.includes(broken)) {
      md = md.replace(runon, broken);
      restored++;
    }
  }
  if (restored) {
    totalBlocks += restored;
    totalFiles++;
    console.log(`${APPLY ? 'FIXED' : 'would fix'}  ${rel}.md  (${restored} card list[s])`);
    if (APPLY) fs.writeFileSync(mdPath, md);
  }
}
console.log(`\n${APPLY ? 'fixed' : 'would fix'} ${totalBlocks} card list(s) across ${totalFiles} file(s)`);
