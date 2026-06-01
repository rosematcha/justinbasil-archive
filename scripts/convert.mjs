#!/usr/bin/env node
// Deterministic conversion: mirrored Squarespace HTML (_corpus) -> Astro content (.md)
// + localized images (public/images). Idempotent & resumable: re-running reuses the
// on-disk image cache and asset-map. Content text is preserved verbatim (no LLM rewriting).
//
// Usage:
//   node scripts/convert.mjs            # full run
//   node scripts/convert.mjs --no-images   # skip image download (faster dev iterations)
//   node scripts/convert.mjs guide/meta about   # only the given slugs (substring match)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';
import sharp from 'sharp';
import { extractPage, decodeEntities } from './lib/extract.mjs';
import { mapPath } from './lib/map.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const CORPUS = path.join(ROOT, '_corpus');
const CONTENT = path.join(ROOT, 'src/content');
const IMG_DIR = path.join(ROOT, 'public/images');
const ASSET_MAP = path.join(CORPUS, 'asset-map.json');
const REPORT = path.join(CORPUS, 'convert-report.json');

const args = process.argv.slice(2);
const NO_IMAGES = args.includes('--no-images');
const filters = args.filter((a) => !a.startsWith('--'));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const IMG_URL_RE = /(?:https?:)?\/\/(?:images\.squarespace-cdn\.com|static1\.squarespace\.com)\/[^\s"')\\]+/g;

fs.mkdirSync(IMG_DIR, { recursive: true });
const assetMap = fs.existsSync(ASSET_MAP) ? JSON.parse(fs.readFileSync(ASSET_MAP, 'utf8')) : {};

// ---- helpers ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripQuery = (u) => u.split('?')[0];
const absUrl = (u) => (u.startsWith('//') ? 'https:' + u : u.replace(/^http:/, 'https:'));
const hashName = (u) => crypto.createHash('sha1').update(stripQuery(u)).digest('hex').slice(0, 16);

/** Map every corpus HTML file to its url path + collection target. */
function corpusFiles() {
  const urls = fs.readFileSync(path.join(CORPUS, 'urls.txt'), 'utf8').trim().split('\n');
  const out = [];
  for (const url of urls) {
    const urlPath = new URL(url).pathname;
    // Skip Squarespace blog filter views (dynamic category/tag/author listings).
    if (/\/(category|tag|author)\//.test(urlPath)) continue;
    // wget --adjust-extension saved /a/b -> a/b.html, / -> index.html
    let rel = urlPath.replace(/^\/+/, '');
    const file = path.join(CORPUS, rel + '.html');
    if (!fs.existsSync(file)) continue;
    const { dir, slug } = mapPath(urlPath);
    out.push({ url, urlPath, file, dir, slug });
  }
  return out;
}

/** Collect all unique squarespace image URLs (base, no query) referenced in html+og. */
function collectImages(html, ogImage) {
  const set = new Set();
  for (const m of html.matchAll(IMG_URL_RE)) set.add(stripQuery(absUrl(m[0])));
  if (ogImage && /squarespace/.test(ogImage)) set.add(stripQuery(absUrl(ogImage)));
  return set;
}

/** Download + format-detect one image; returns local web path (/images/xxx.ext). */
async function fetchImage(baseUrl) {
  if (assetMap[baseUrl]) {
    const local = path.join(ROOT, 'public', assetMap[baseUrl]);
    if (fs.existsSync(local)) return assetMap[baseUrl];
  }
  const hash = hashName(baseUrl);
  // Request a large variant for quality.
  const fetchUrl = baseUrl + (baseUrl.includes('?') ? '' : '?format=2500w');
  let buf;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(fetchUrl, { headers: { 'User-Agent': UA } });
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 5) throw new Error(`HTTP ${res.status}`);
        const ra = Number(res.headers.get('retry-after')) || 0;
        await sleep(Math.max(ra * 1000, 800 * 2 ** attempt) + Math.random() * 500);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      break;
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(800 * 2 ** attempt + Math.random() * 500);
    }
  }
  let ext = 'bin';
  try {
    const meta = await sharp(buf).metadata();
    ext = meta.format === 'jpeg' ? 'jpg' : meta.format || 'bin';
  } catch {
    // not an image sharp understands (svg/gif/ico) — sniff magic bytes
    const head = buf.subarray(0, 8).toString('latin1');
    if (head.startsWith('<svg') || head.includes('<?xml')) ext = 'svg';
    else if (head.startsWith('GIF8')) ext = 'gif';
    else ext = path.extname(stripQuery(baseUrl)).slice(1) || 'bin';
  }
  const fname = `${hash}.${ext}`;
  fs.writeFileSync(path.join(IMG_DIR, fname), buf);
  const web = `/images/${fname}`;
  assetMap[baseUrl] = web;
  return web;
}

/** Rewrite all squarespace image URLs in html to their local paths. */
function rewriteImages(html) {
  return html.replace(IMG_URL_RE, (m) => {
    const base = stripQuery(absUrl(m));
    return assetMap[base] || m;
  });
}

/** Rewrite absolute justinbasil.com links to root-relative; drop trailing slashes. */
const DISCORD_INVITE = 'https://discord.gg/gy52nzras2';
function rewriteLinks(html) {
  return html
    .replace(/(href|src)=("|')(?:https?:)?\/\/(?:www\.)?justinbasil\.com(\/[^"']*)?\2/gi,
      (_m, attr, q, p = '/') => `${attr}=${q}${(p || '/').replace(/\/$/, '') || '/'}${q}`)
    // /discord was a Squarespace redirect to the Discord invite (not a real page).
    .replace(/href=("|')\/discord\/?\1/gi, `href="${DISCORD_INVITE}"`);
}

function yamlEscape(s) { return JSON.stringify(s ?? ''); }

function frontmatter(meta) {
  const lines = ['---'];
  lines.push(`title: ${yamlEscape(meta.title)}`);
  if (meta.description) lines.push(`description: ${yamlEscape(meta.description)}`);
  if (meta.ogImage) lines.push(`ogImage: ${yamlEscape(meta.ogImage)}`);
  if (meta.publishDate) lines.push(`publishDate: ${meta.publishDate}`);
  if (meta.youtubeId) lines.push(`youtubeId: ${yamlEscape(meta.youtubeId)}`);
  if (meta.thumbnail) lines.push(`thumbnail: ${yamlEscape(meta.thumbnail)}`);
  lines.push(`sourceUrl: ${yamlEscape(meta.sourceUrl)}`);
  lines.push('showHeading: false');
  lines.push('---', '', '');
  return lines.join('\n');
}

// ---- main ----
// Streamed one page at a time to bound memory: extract -> download its images
// (shared on-disk cache dedupes across pages) -> rewrite -> write -> free.
const files = corpusFiles().filter((f) => !filters.length || filters.some((s) => f.urlPath.includes(s)));
console.log(`Converting ${files.length} pages${NO_IMAGES ? ' (skipping images)' : ''}…`);

const imgLimit = pLimit(5);
const report = { pages: 0, images: { ok: 0, failed: 0 }, missingImages: [], errors: [] };
let i = 0;

for (const f of files) {
  i++;
  try {
    const raw = fs.readFileSync(f.file, 'utf8');
    const p = extractPage(raw, { sourcePath: f.urlPath });
    const yt = p.html.match(/youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})/);

    if (!NO_IMAGES) {
      const imgs = collectImages(p.html, p.ogImage);
      await Promise.all([...imgs].map((u) => imgLimit(async () => {
        try { await fetchImage(u); report.images.ok++; }
        catch (e) { report.images.failed++; report.missingImages.push(u); }
      })));
    }

    let html = NO_IMAGES ? p.html : rewriteImages(p.html);
    html = rewriteLinks(html);
    const ogImage = p.ogImage ? (assetMap[stripQuery(absUrl(p.ogImage))] || undefined) : undefined;
    const meta = {
      title: p.title, description: p.description, ogImage,
      publishDate: p.publishDate ? p.publishDate.slice(0, 10) : undefined,
      youtubeId: yt ? yt[1] : undefined, sourceUrl: f.url,
    };
    const outDir = path.join(CONTENT, f.dir, path.dirname(f.slug));
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(CONTENT, f.dir, f.slug + '.md'), frontmatter(meta) + html + '\n');
    report.pages++;
  } catch (e) {
    report.errors.push(`${f.urlPath}: ${e.message}`);
    console.error(`! failed ${f.urlPath}: ${e.message}`);
  }
  if (i % 25 === 0) {
    console.log(`  ${i}/${files.length} pages · imgs ok=${report.images.ok} fail=${report.images.failed}`);
    fs.writeFileSync(ASSET_MAP, JSON.stringify(assetMap, null, 0));
  }
}

fs.writeFileSync(ASSET_MAP, JSON.stringify(assetMap, null, 0));
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(`Done. Wrote ${report.pages} pages, images ok=${report.images.ok} failed=${report.images.failed}. Report: ${path.relative(ROOT, REPORT)}`);
