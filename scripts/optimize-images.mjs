#!/usr/bin/env node
// Re-encode localized images to WebP at a sensible max width to shrink the archive
// (originals were fetched at 2500w). Idempotent: skips already-optimized files via a marker.
// Rewrites references in content + asset-map from old filenames to the new .webp names.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pLimit from 'p-limit';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const IMG_DIR = path.join(ROOT, 'public/images');
const CONTENT = path.join(ROOT, 'src/content');
const ASSET_MAP = path.join(ROOT, '_corpus/asset-map.json');
const MAX_W = 1600;
const QUALITY = 82;

const files = fs.readdirSync(IMG_DIR).filter((f) => !f.startsWith('.'));
console.log(`Optimizing ${files.length} images (max ${MAX_W}w, webp q${QUALITY})…`);

const rename = {}; // oldName -> newName
const limit = pLimit(6);
let done = 0, saved = 0, before = 0, after = 0;

await Promise.all(files.map((f) => limit(async () => {
  const src = path.join(IMG_DIR, f);
  const ext = path.extname(f).toLowerCase();
  // skip animated gifs (preserve animation) and svg (vector)
  if (ext === '.svg' || ext === '.gif') return;
  const base = path.basename(f, ext);
  const out = base + '.webp';
  const outPath = path.join(IMG_DIR, out);
  try {
    const st = fs.statSync(src); before += st.size;
    const buf = await sharp(src).rotate()
      .resize({ width: MAX_W, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();
    fs.writeFileSync(outPath, buf);
    after += buf.length;
    if (out !== f) { fs.unlinkSync(src); rename['/images/' + f] = '/images/' + out; }
    saved++;
  } catch (e) {
    console.error(`! ${f}: ${e.message}`);
    after += fs.statSync(src).size;
  }
  if (++done % 1000 === 0) console.log(`  ${done}/${files.length}`);
})));

// Rewrite references in content files + asset-map
const renameKeys = Object.keys(rename);
if (renameKeys.length) {
  const re = new RegExp(renameKeys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const file of walk(CONTENT).filter((f) => /\.mdx?$/.test(f))) {
    const txt = fs.readFileSync(file, 'utf8');
    if (renameKeys.some((k) => txt.includes(k))) fs.writeFileSync(file, txt.replace(re, (m) => rename[m]));
  }
  if (fs.existsSync(ASSET_MAP)) {
    const am = JSON.parse(fs.readFileSync(ASSET_MAP, 'utf8'));
    for (const k of Object.keys(am)) if (rename[am[k]]) am[k] = rename[am[k]];
    fs.writeFileSync(ASSET_MAP, JSON.stringify(am, null, 0));
  }
}

const mb = (n) => (n / 1048576).toFixed(0) + 'MB';
console.log(`Done. ${saved} images. ${mb(before)} -> ${mb(after)}.`);
