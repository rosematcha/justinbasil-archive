#!/usr/bin/env node
// Un-obfuscate image filenames: rename /images/<sha1hash>.<ext> -> descriptive names
// derived from the original Squarespace URL, and update every reference.
//
// Deterministic & idempotent-ish: the name for a file is a pure function of its source
// URL (from _corpus/asset-map.json), so re-running produces the same plan. Collisions
// (≈1.6k descriptive names are reused by different source images) are disambiguated with
// a short URL-hash suffix; the lexicographically-first URL keeps the clean name.
//
// Usage:
//   node scripts/unhash-images.mjs            # DRY RUN — prints the plan, writes nothing
//   node scripts/unhash-images.mjs --apply    # execute: rename files + rewrite all refs
//
// Updates on --apply: public/images/* (rename), _corpus/asset-map.json (values),
// _corpus/fidelity-baseline.json (img srcs), and every /images/<hash> ref in
// src/content/**/*.md (bodies + ogImage frontmatter).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const IMG_DIR = path.join(ROOT, 'public/images');
const ASSET_MAP = path.join(ROOT, '_corpus/asset-map.json');
const BASELINE = path.join(ROOT, '_corpus/fidelity-baseline.json');
const CONTENT = path.join(ROOT, 'src/content');
const APPLY = process.argv.includes('--apply');

const assetMap = JSON.parse(fs.readFileSync(ASSET_MAP, 'utf8'));

/** Descriptive base name (no ext) from a source URL's last path segment. */
function descBase(url) {
  let seg = url.split('?')[0].split('/').pop() || '';
  try { seg = decodeURIComponent(seg); } catch {}
  let base = seg.replace(/\.[^.]+$/, '')            // drop original extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')                     // non-alphanumeric -> hyphen
    .replace(/^-+|-+$/g, '')                         // trim hyphens
    .replace(/-{2,}/g, '-');                         // collapse runs
  if (!base) base = 'image';
  if (base.length > 60) base = base.slice(0, 60).replace(/-+$/, '');
  return base;
}

// Build the rename plan deterministically (sorted by URL → stable collision winners).
const entries = Object.entries(assetMap).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const used = new Set();
const renameByOldBase = new Map();   // "ab0123.webp" -> "250px-845cramorant.webp"
const planByLocal = new Map();       // oldLocalPath -> newLocalPath
let collisions = 0;

for (const [url, local] of entries) {
  const oldBase = path.basename(local);
  const ext = (oldBase.split('.').pop() || 'bin').toLowerCase();
  let name = `${descBase(url)}.${ext}`;
  if (used.has(name)) {
    collisions++;
    const suffix = crypto.createHash('sha1').update(url).digest('hex').slice(0, 6);
    name = `${descBase(url)}-${suffix}.${ext}`;
    let n = 6;
    while (used.has(name)) { // astronomically unlikely; extend suffix if so
      name = `${descBase(url)}-${crypto.createHash('sha1').update(url).digest('hex').slice(0, ++n)}.${ext}`;
    }
  }
  used.add(name);
  renameByOldBase.set(oldBase, name);
  planByLocal.set(local, `/images/${name}`);
}

// Sanity: every planned source file exists, and no two map to the same target.
let missing = 0;
for (const [local] of planByLocal) {
  if (!fs.existsSync(path.join(ROOT, 'public', local.replace(/^\//, '')))) missing++;
}
const targets = new Set([...planByLocal.values()]);

console.log(`Plan: ${planByLocal.size} files · ${collisions} collision-suffixed · ` +
  `${targets.size} unique targets · ${missing} missing source files`);
console.log('Samples:');
for (const [url, local] of entries.slice(0, 6)) {
  console.log(`  ${path.basename(local).padEnd(22)} -> ${path.basename(planByLocal.get(local))}   (${url.split('/').pop()})`);
}
if (targets.size !== planByLocal.size) {
  console.error('✗ ABORT: target name collision detected — refusing to apply.');
  process.exit(1);
}
if (missing) console.warn(`⚠ ${missing} source files missing on disk (will skip those renames).`);

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to execute.');
  process.exit(0);
}

// ---- APPLY ----
// 1) Rename files on disk.
let renamed = 0;
for (const [local, newLocal] of planByLocal) {
  const from = path.join(ROOT, 'public', local.replace(/^\//, ''));
  const to = path.join(ROOT, 'public', newLocal.replace(/^\//, ''));
  if (from === to) { renamed++; continue; }
  if (!fs.existsSync(from)) continue;
  fs.renameSync(from, to);
  renamed++;
}
console.log(`Renamed ${renamed} files.`);

// 2) Rewrite a text blob's /images/<oldbase> refs via the rename map.
const IMG_REF = /\/images\/([A-Za-z0-9._-]+?\.[A-Za-z0-9]+)/g;
function rewrite(text) {
  let hits = 0;
  const out = text.replace(IMG_REF, (m, base) => {
    const nn = renameByOldBase.get(base);
    if (!nn) return m;          // not a managed image — leave untouched
    hits++;
    return `/images/${nn}`;
  });
  return { out, hits };
}

// 3) asset-map values.
const newMap = {};
for (const [url, local] of Object.entries(assetMap)) newMap[url] = planByLocal.get(local) || local;
fs.writeFileSync(ASSET_MAP, JSON.stringify(newMap));
console.log('Rewrote asset-map.json');

// 4) fidelity baseline img srcs.
if (fs.existsSync(BASELINE)) {
  const { out, hits } = rewrite(fs.readFileSync(BASELINE, 'utf8'));
  fs.writeFileSync(BASELINE, out);
  console.log(`Rewrote fidelity-baseline.json (${hits} refs)`);
}

// 5) all content .md (bodies + ogImage frontmatter).
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(fp));
    else if (e.name.endsWith('.md') || e.name.endsWith('.mdx')) out.push(fp);
  }
  return out;
}
let filesChanged = 0, totalHits = 0;
for (const f of walk(CONTENT)) {
  const { out, hits } = rewrite(fs.readFileSync(f, 'utf8'));
  if (hits) { fs.writeFileSync(f, out); filesChanged++; totalHits += hits; }
}
console.log(`Rewrote ${totalHits} refs across ${filesChanged} content files.`);
console.log('\n✓ Done.');
