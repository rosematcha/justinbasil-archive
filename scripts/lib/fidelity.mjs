#!/usr/bin/env node
// Fidelity harness: prove rendered pages are visually faithful across transform changes.
//
// fingerprint(html) returns a *normalized content signature* that ignores attributes,
// class names, element nesting, and insignificant whitespace — but captures:
//   - ordered visible text tokens (whitespace-collapsed, entities decoded by JSDOM)
//   - ordered (headingLevel, text) pairs
//   - ordered img src values
//   - ordered (href, linkText) pairs
//   - ordered table-cell texts
//
// CLI:
//   node scripts/lib/fidelity.mjs capture            # write _corpus/fidelity-baseline.json
//   node scripts/lib/fidelity.mjs check [collection] # diff current build vs baseline

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import fg from "fast-glob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const DIST = path.join(REPO, "dist");
const CONTENT = path.join(REPO, "src/content");
const BASELINE = path.join(REPO, "_corpus/fidelity-baseline.json");

const IN_SCOPE = [
  "guide", "resources", "new-decks", "pages", "league", "rotation",
  "highlights", "set-lists", "visual", "proxies", "translations",
];

// Map (collection, slug) -> dist html path.
// `pages` collection renders at site root; others under /<collection>/<slug>/.
function distPathFor(collection, slug) {
  if (collection === "pages" && slug === "home") return path.join(DIST, "index.html");
  const base = collection === "pages" ? DIST : path.join(DIST, collection);
  return path.join(base, slug, "index.html");
}

function listEntries(onlyCollection) {
  const out = [];
  for (const col of IN_SCOPE) {
    if (onlyCollection && col !== onlyCollection) continue;
    const dir = path.join(CONTENT, col);
    if (!fs.existsSync(dir)) continue;
    const files = fg.sync(["**/*.md"], { cwd: dir });
    for (const f of files) {
      const slug = f.replace(/\.md$/, "");
      out.push({ collection: col, slug, dist: distPathFor(col, slug) });
    }
  }
  return out;
}

// Normalize curly ↔ straight quotes. Astro/remark's typographer turns straight quotes
// (which Squarespace exported throughout) into curly ones when compiling Markdown — a
// purely typographic change that should not be flagged as a fidelity diff. We collapse
// both forms to ASCII so the diff is whitespace-and-typography-insensitive.
function normalizeQuotes(s) {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    // Astro/remark's typographer also turns `...` into `…` (and `--` into `–`/`—`).
    // Same purely-typographic class; collapse both to ASCII for the diff.
    .replace(/…/g, '...')
    // Collapse any run of 3+ dots to a canonical "...". Astro maps `....` (4 dots) to
    // `…` (single char) which we then re-expand to "..." (3 dots), so without this
    // a pristine "Star...." (4) and a current "Star..." (3) would still diverge.
    .replace(/\.{3,}/g, '...')
    .replace(/[–—]/g, '-');
}

function collapseWs(s) {
  return normalizeQuotes(s).replace(/\s+/g, " ").trim();
}

// Astro's Markdown link emission percent-encodes non-ASCII in URLs (so `PokéTownBE`
// → `Pok%C3%A9TownBE`). Pristine raw HTML kept the literal character. Both refer to
// the same target — decode for the fidelity comparison.
// Remove paired chrome tokens from a baseline token stream. The only one in this corpus
// is "View fullsize" from Squarespace lightbox buttons — see `fingerprint()` for the
// matching DOM-side filter.
function stripChromeTokens(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === "View" && toks[i + 1] === "fullsize") { i++; continue; }
    out.push(toks[i]);
  }
  return out;
}

function normalizeUrl(href) {
  if (!href) return href;
  try { return decodeURI(href); } catch { return href; }
}

// Extract just the article body — strip site chrome (header/nav/footer) so layout
// changes in shared components don't drown out content diffs.
function getMain(document) {
  return (
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.body
  );
}

export function fingerprint(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const root = getMain(doc);

  // Remove script/style; they're not visible content.
  root.querySelectorAll("script,style,noscript").forEach((n) => n.remove());
  // Remove visually-hidden chrome. Squarespace's lightbox button emits a
  // `<span class="v6-visually-hidden">View fullsize</span>` for screen readers; that
  // text is NOT visible content. Round 2's image conversion `![alt](src)` legitimately
  // drops it, so the fingerprint excludes such chrome on the CURRENT side. Baseline
  // tokens recorded these strings before this filter existed — `loadBaseline` strips
  // the matching sequences on the baseline side so comparisons stay symmetric.
  root.querySelectorAll(".v6-visually-hidden, .visually-hidden, .sr-only").forEach((n) => n.remove());

  // Walk text nodes individually so inter-element whitespace (e.g. the `\n` Markdown
  // inserts between `<h1>` and `<p>`) doesn't change the token sequence vs. an inline
  // HTML source that put the same elements adjacent with no whitespace. Visible text is
  // what we care about — adjacency-or-not between block elements is rendering.
  const tokens = [];
  const w = doc.createTreeWalker(root, dom.window.NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = collapseWs(n.nodeValue);
    if (!t) continue;
    for (const tok of t.split(" ")) if (tok) tokens.push(tok);
  }

  const headings = [];
  root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
    headings.push([Number(h.tagName.slice(1)), collapseWs(h.textContent || "")]);
  });

  const imgs = [];
  root.querySelectorAll("img").forEach((img) => {
    imgs.push(img.getAttribute("src") || "");
  });

  const links = [];
  root.querySelectorAll("a[href]").forEach((a) => {
    links.push([normalizeUrl(a.getAttribute("href") || ""), collapseWs(a.textContent || "")]);
  });

  const cells = [];
  root.querySelectorAll("td,th").forEach((c) => {
    // Normalize cells the same way as page-level text (text-node walk, single-spaced).
    const cw = doc.createTreeWalker(c, dom.window.NodeFilter.SHOW_TEXT);
    const parts = [];
    let cn; while ((cn = cw.nextNode())) {
      const t = collapseWs(cn.nodeValue);
      if (t) parts.push(t);
    }
    cells.push(parts.join(" "));
  });

  return { tokens, headings, imgs, links, cells };
}

function readHtml(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}

function fingerprintEntry(entry) {
  const html = readHtml(entry.dist);
  if (html == null) return { missing: true };
  return fingerprint(html);
}

function buildAll(onlyCollection) {
  const entries = listEntries(onlyCollection);
  const out = {};
  for (const e of entries) {
    const key = `${e.collection}/${e.slug}`;
    out[key] = fingerprintEntry(e);
  }
  return out;
}

function diffArrays(label, a, b, limit = 5) {
  const an = a || [], bn = b || [];
  const diffs = [];
  const max = Math.max(an.length, bn.length);
  for (let i = 0; i < max; i++) {
    const av = JSON.stringify(an[i]);
    const bv = JSON.stringify(bn[i]);
    if (av !== bv) diffs.push({ i, before: an[i], after: bn[i] });
    if (diffs.length >= limit) break;
  }
  if (an.length !== bn.length) {
    return { label, lenBefore: an.length, lenAfter: bn.length, sample: diffs };
  }
  if (diffs.length) return { label, sample: diffs };
  return null;
}

function diffFingerprint(before, after) {
  if (!before && !after) return null;
  if (!before) return { reason: "no baseline entry" };
  if (!after) return { reason: "no current entry" };
  if (before.missing || after.missing) {
    if (before.missing && after.missing) return null;
    return { reason: before.missing ? "missing in baseline" : "missing in current" };
  }
  const parts = [
    diffArrays("tokens", before.tokens, after.tokens),
    diffArrays("headings", before.headings, after.headings),
    diffArrays("imgs", before.imgs, after.imgs),
    diffArrays("links", before.links, after.links),
    diffArrays("cells", before.cells, after.cells),
  ].filter(Boolean);
  return parts.length ? parts : null;
}

function cmdCapture() {
  if (fs.existsSync(BASELINE)) {
    console.error(`Baseline already exists at ${path.relative(REPO, BASELINE)}.`);
    console.error("Refusing to overwrite. Delete it manually if you really mean to.");
    process.exit(2);
  }
  if (!fs.existsSync(DIST)) {
    console.error("dist/ not found. Run `npm run build` first.");
    process.exit(2);
  }
  console.error("Capturing fidelity baseline from dist/ …");
  const all = buildAll(null);
  const missing = Object.entries(all).filter(([, v]) => v.missing).map(([k]) => k);
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(all, null, 0));
  console.error(`Wrote ${Object.keys(all).length} fingerprints → ${path.relative(REPO, BASELINE)}`);
  if (missing.length) {
    console.error(`Warning: ${missing.length} entries had no rendered html (recorded as missing):`);
    for (const k of missing.slice(0, 20)) console.error("  -", k);
    if (missing.length > 20) console.error(`  … and ${missing.length - 20} more`);
  }
}

function cmdCheck(onlyCollection) {
  if (!fs.existsSync(BASELINE)) {
    console.error("No baseline. Run: node scripts/lib/fidelity.mjs capture");
    process.exit(2);
  }
  if (!fs.existsSync(DIST)) {
    console.error("dist/ not found. Run `npm run build` first.");
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  // Apply current normalizers to baseline values so older captures (which stored e.g.
  // percent-encoded URLs verbatim) compare equal to the current normalized form.
  // Also strip visually-hidden chrome strings ("View fullsize" from Squarespace lightbox
  // buttons) — the live fingerprint excludes these via `.v6-visually-hidden` DOM
  // removal, so baseline must drop the matching token/link entries to compare equal.
  for (const k of Object.keys(baseline)) {
    const f = baseline[k];
    if (!f || f.missing) continue;
    if (Array.isArray(f.links)) f.links = f.links.map(([h, t]) => [normalizeUrl(h), t]);
    if (Array.isArray(f.tokens)) f.tokens = stripChromeTokens(f.tokens);
    // For links whose text was *only* the visually-hidden chrome string, replace the
    // text with "" rather than dropping the entry — the link itself (href = lightbox
    // target = image src) still exists in the pristine DOM and is reproduced by the
    // Markdown `[![alt](src)](src)` form.
    if (Array.isArray(f.links)) f.links = f.links.map(([h, t]) => [h, t === "View fullsize" ? "" : t]);
  }
  const current = buildAll(onlyCollection);
  const keys = onlyCollection
    ? Object.keys(baseline).filter((k) => k.startsWith(onlyCollection + "/"))
    : Object.keys(baseline);
  let changed = 0;
  for (const k of keys) {
    const d = diffFingerprint(baseline[k], current[k]);
    if (!d) continue;
    changed++;
    console.log(`\n# ${k}`);
    if (d.reason) { console.log("  ", d.reason); continue; }
    for (const part of d) {
      if (part.lenBefore != null) {
        console.log(`  ${part.label}: length ${part.lenBefore} → ${part.lenAfter}`);
      } else {
        console.log(`  ${part.label}: ${part.sample.length} diff(s)`);
      }
      for (const s of part.sample) {
        console.log(`    [${s.i}] ${JSON.stringify(s.before)} → ${JSON.stringify(s.after)}`);
      }
    }
  }
  console.log(
    `\nFidelity ${changed === 0 ? "OK" : "DIFFS"}: ${changed} changed of ${keys.length} checked` +
    (onlyCollection ? ` (collection=${onlyCollection})` : "")
  );
  process.exit(changed === 0 ? 0 : 1);
}

const argv = process.argv.slice(2);
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const cmd = argv[0];
  if (cmd === "capture") cmdCapture();
  else if (cmd === "check") cmdCheck(argv[1] || null);
  else {
    console.error("Usage: node scripts/lib/fidelity.mjs capture | check [collection]");
    process.exit(2);
  }
}
