#!/usr/bin/env node
// Verification gates for the archive:
//  1. Completeness — every sitemap page (minus filter views) has a content file.
//  2. AdSense/telemetry — zero ad tokens survive in content.
//  3. Image localization — report any remaining live squarespace-cdn refs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapPath } from './lib/map.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const CONTENT = path.join(ROOT, 'src/content');
const urls = fs.readFileSync(path.join(ROOT, '_corpus/urls.txt'), 'utf8').trim().split('\n');

let fail = 0;

// 1. Completeness
const expected = urls
  .map((u) => new URL(u).pathname)
  .filter((p) => !/\/(category|tag|author)\//.test(p));
const missing = [];
for (const p of expected) {
  const { dir, slug } = mapPath(p);
  const f = path.join(CONTENT, dir, slug + '.md');
  if (!fs.existsSync(f)) missing.push(`${p} -> ${path.relative(ROOT, f)}`);
}
console.log(`[completeness] ${expected.length - missing.length}/${expected.length} pages present`);
if (missing.length) { fail++; console.log('  MISSING:\n   ' + missing.slice(0, 20).join('\n   ')); }

// walk content files
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(fp));
    else if (e.name.endsWith('.md') || e.name.endsWith('.mdx')) out.push(fp);
  }
  return out;
}
const files = walk(CONTENT);

// 2. AdSense / telemetry gate
const AD_RE = /adsbygoogle|googlesyndication|google-analytics|gtag\(|doubleclick|SQUARESPACE_CONTEXT/i;
const adHits = files.filter((f) => AD_RE.test(fs.readFileSync(f, 'utf8')));
console.log(`[adsense] ${adHits.length} files with ad/telemetry tokens`);
if (adHits.length) { fail++; console.log('  ' + adHits.slice(0, 20).map((f) => path.relative(ROOT, f)).join('\n  ')); }

// 3. Remaining live CDN image refs
let cdnRefs = 0;
const cdnFiles = [];
for (const f of files) {
  const m = fs.readFileSync(f, 'utf8').match(/squarespace-cdn\.com|static1\.squarespace\.com/g);
  if (m) { cdnRefs += m.length; cdnFiles.push(`${path.relative(ROOT, f)} (${m.length})`); }
}
console.log(`[images] ${cdnRefs} remaining live CDN refs across ${cdnFiles.length} files`);
if (cdnFiles.length) console.log('  ' + cdnFiles.slice(0, 15).join('\n  '));

console.log(fail ? `\n✗ ${fail} gate(s) failed` : '\n✓ all gates passed');
process.exit(fail ? 1 : 0);
