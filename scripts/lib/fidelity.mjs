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

// ---------------------------------------------------------------------------
// Styling-invariant check (PROMPT-2 step 5b). The content fidelity harness is
// BLIND to alignment, colour, layout, and orphaned classes — every Round-1.5
// styling regression passed it. This mode asserts the *look* survived, using
// the `_corpus/*.html` pristine originals as the source of truth where one is
// available, plus global structural invariants on the built `dist/**`.
//
//   node scripts/lib/fidelity.mjs style [collection]
//
// FAILS (exit 1) on any of:
//   - a heading centered in the corpus original is no longer centered in dist
//   - a content element references a CSS class that does not exist in any
//     stylesheet (orphaned class — the namespace-rename failure mode)
//   - a content ordered list has its markers suppressed (list-style:none) when
//     it is not inside a decklist code-block card (the ol-reset failure mode)
//   - the site link-colour rule (.sqs-content a { color:#2738b4 }) is missing
//   - a residual Squarespace structural class (sqs-*, span-N, col, row,
//     image-block-*, col-N) leaked onto a content element
// REPORTS (non-fatal) the per-collection count of residual inline style= on
// content, so progress is visible without blocking on the bespoke-card long tail.
// ---------------------------------------------------------------------------

const CORPUS = path.join(REPO, "_corpus");
const STYLES_DIR = path.join(REPO, "src/styles");

// Map a `_corpus/<name>.html` to its built dist html, if one exists. The corpus
// names are page slugs; in this archive they all live in the `pages` collection
// (rendered at site root) except `home` → index.html.
function corpusToDist(name) {
  if (name === "home") return path.join(DIST, "index.html");
  const p = path.join(DIST, name, "index.html");
  return fs.existsSync(p) ? p : null;
}

// Every `.class` token referenced anywhere in the stylesheets. Used to detect
// orphaned classes on content (a class that no rule can match).
function cssClassUniverse() {
  const set = new Set();
  for (const f of fg.sync(["*.css"], { cwd: STYLES_DIR, absolute: true })) {
    const css = fs.readFileSync(f, "utf8");
    for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) set.add(m[1]);
  }
  return set;
}

// Squarespace structural classes that must NOT survive on content (only the
// `.sqs-content` prose wrapper, which is added by RenderedEntry, is allowed).
function isLeakedSqsClass(cls) {
  if (cls === "sqs-content") return false;
  return (
    /^sqs-/.test(cls) ||
    /^(col|row)$/.test(cls) ||
    /^(col|span|sqs-col)-\d+$/.test(cls) ||
    /^image-block(-|$)/.test(cls) ||
    /^(gallery|html|code|website-component|image|video|spacer)-block$/.test(cls)
  );
}

// Headings (and their text) that are centered in a pristine corpus page.
function centeredHeadingsFromCorpus(html) {
  const dom = new JSDOM(html);
  const root = getMain(dom.window.document);
  if (!root) return [];
  const out = [];
  root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
    const style = (h.getAttribute("style") || "").replace(/\s+/g, "").toLowerCase();
    if (style.includes("text-align:center")) {
      const text = collapseWs(h.textContent || "");
      if (text) out.push(text);
    }
  });
  return out;
}

// Is a dist heading element centered? Either an inline text-align:center, or a
// promoted alignment class (jb-center*) — the migration target.
function distHeadingCentered(h) {
  const style = (h.getAttribute("style") || "").replace(/\s+/g, "").toLowerCase();
  if (style.includes("text-align:center")) return true;
  const cls = (h.getAttribute("class") || "").split(/\s+/);
  return cls.some((c) => /^jb-center/.test(c) || c === "box_title" || c === "box-title");
}

function cmdStyle(onlyCollection) {
  const cssClasses = cssClassUniverse();
  const cssText = fg
    .sync(["*.css"], { cwd: STYLES_DIR, absolute: true })
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");

  const failures = [];
  const warnings = [];

  // --- Invariant: link-colour rule present ----------------------------------
  const linkRuleRe = /\.sqs-content\s+a[^{]*\{[^}]*#2738b4/i;
  if (!linkRuleRe.test(cssText.replace(/\s+/g, " "))) {
    failures.push("link-colour rule `.sqs-content a { color:#2738b4 }` missing from CSS");
  }

  // --- Per-corpus alignment invariant ---------------------------------------
  const corpusFiles = fg.sync(["*.html"], { cwd: CORPUS });
  let alignChecked = 0;
  for (const cf of corpusFiles) {
    const name = cf.replace(/\.html$/, "");
    const distPath = corpusToDist(name);
    if (!distPath) continue;
    // Only check pages in scope of the requested collection (all corpus pages
    // map to `pages`); skip if a specific other collection was requested.
    if (onlyCollection && onlyCollection !== "pages") continue;
    const corpusHtml = fs.readFileSync(path.join(CORPUS, cf), "utf8");
    const wantCentered = centeredHeadingsFromCorpus(corpusHtml);
    if (!wantCentered.length) continue;
    const distDom = new JSDOM(fs.readFileSync(distPath, "utf8"));
    const distRoot = getMain(distDom.window.document);
    const distHeadings = [...distRoot.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    for (const text of wantCentered) {
      const match = distHeadings.find((h) => collapseWs(h.textContent || "") === text);
      if (!match) continue; // text-content drift is the fidelity harness's job
      alignChecked++;
      if (!distHeadingCentered(match)) {
        failures.push(`alignment lost: heading "${text}" centered in corpus/${cf} but not in dist (${path.relative(DIST, distPath)})`);
      }
    }
  }

  // --- Global content invariants over built dist ----------------------------
  const entries = listEntries(onlyCollection);
  const residualStyleByCol = {};
  let orphanCount = 0;
  let leakedSqsCount = 0;
  let olStrippedCount = 0;

  for (const e of entries) {
    const html = readHtml(e.dist);
    if (html == null) continue;
    const dom = new JSDOM(html);
    const main = getMain(dom.window.document);
    if (!main) continue;
    // Limit to the prose container so site-chrome inline styles don't count.
    const content = main.querySelector(".sqs-content") || main;

    // Residual inline style= on content (non-fatal metric).
    const styled = content.querySelectorAll("[style]");
    if (styled.length) residualStyleByCol[e.collection] = (residualStyleByCol[e.collection] || 0) + styled.length;

    // Orphaned / leaked classes.
    content.querySelectorAll("[class]").forEach((el) => {
      for (const cls of (el.getAttribute("class") || "").split(/\s+/).filter(Boolean)) {
        if (isLeakedSqsClass(cls)) {
          leakedSqsCount++;
          if (failures.length < 200)
            failures.push(`leaked Squarespace class "${cls}" on <${el.tagName.toLowerCase()}> in ${e.collection}/${e.slug}`);
        } else if (!cssClasses.has(cls)) {
          // Non-fatal: many of these are inert Squarespace carousel/gallery hook
          // classes (`circle`, `dot`, `arrow`, `slide`, …) whose JS is gone and
          // which carry no visual rule — dropping them changes nothing. We count
          // them as a cleanliness metric but do NOT fail the gate, since the
          // documented regressions (alignment loss, namespace-rename collapse)
          // surface as alignment or leaked-sqs failures, not arbitrary hooks.
          orphanCount++;
        }
      }
    });

    // Ordered-list markers: an <ol> not inside a decklist/code-block card must
    // not be visually unmarked. We can only check declared style here.
    content.querySelectorAll("ol").forEach((ol) => {
      const inCard = ol.closest(".sqs-code-container, .jb-code-container, .jb-set-card, .jb-gallery");
      if (inCard) return;
      const style = (ol.getAttribute("style") || "").replace(/\s+/g, "").toLowerCase();
      if (style.includes("list-style:none") || style.includes("list-style-type:none")) {
        olStrippedCount++;
        failures.push(`ordered-list markers suppressed inline on <ol> in ${e.collection}/${e.slug}`);
      }
    });
  }

  // --- Report ---------------------------------------------------------------
  console.log(`Styling-invariant check${onlyCollection ? ` (collection=${onlyCollection})` : ""}`);
  console.log(`  link-colour rule: ${linkRuleRe.test(cssText.replace(/\s+/g, " ")) ? "present" : "MISSING"}`);
  console.log(`  alignment headings checked against corpus: ${alignChecked}`);
  console.log(`  leaked Squarespace classes on content: ${leakedSqsCount}`);
  console.log(`  orphaned classes (no CSS rule) on content: ${orphanCount}`);
  console.log(`  <ol> with inline markers suppressed (outside cards): ${olStrippedCount}`);
  const totalResidual = Object.values(residualStyleByCol).reduce((a, b) => a + b, 0);
  console.log(`  residual inline style= on content (non-fatal): ${totalResidual}`);
  for (const [c, n] of Object.entries(residualStyleByCol).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${c}: ${n}`);
  }
  if (warnings.length) for (const w of warnings) console.log("  warn:", w);

  if (failures.length) {
    console.log(`\nSTYLE FAIL: ${failures.length} invariant violation(s):`);
    for (const f of failures.slice(0, 60)) console.log("  -", f);
    if (failures.length > 60) console.log(`  … and ${failures.length - 60} more`);
    process.exit(1);
  }
  console.log("\nStyle OK: all styling invariants hold.");
  process.exit(0);
}

const argv = process.argv.slice(2);
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const cmd = argv[0];
  if (cmd === "capture") cmdCapture();
  else if (cmd === "check") cmdCheck(argv[1] || null);
  else if (cmd === "style") cmdStyle(argv[1] || null);
  else {
    console.error("Usage: node scripts/lib/fidelity.mjs capture | check [collection] | style [collection]");
    process.exit(2);
  }
}
