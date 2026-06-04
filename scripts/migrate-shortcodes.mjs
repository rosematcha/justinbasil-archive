#!/usr/bin/env node
// Rewrites legacy hand-written HTML blocks (deck boxes, galleries, note boxes,
// colored boxes) into the compact shortcodes. SAFE BY CONSTRUCTION: every file's
// migrated body is rendered through the real pipeline and compared to the original
// render (visible text + image srcs + link hrefs). If they don't match, the file is
// left untouched and the block is reported — the migration can never corrupt content.
//
//   node scripts/migrate-shortcodes.mjs --dry-run        # report only, write nothing
//   node scripts/migrate-shortcodes.mjs --dry-run --verbose
//   node scripts/migrate-shortcodes.mjs                  # apply where it round-trips
//   node scripts/migrate-shortcodes.mjs --only new-decks # limit to matching paths
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { comparable, comparableEqual } from './lib/render-md.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const CONTENT = path.join(ROOT, 'src/content');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const onlyArg = args.find((a) => a.startsWith('--only'));
const ONLY = onlyArg ? (onlyArg.split('=')[1] || args[args.indexOf(onlyArg) + 1]) : null;

const decodeEntities = (s) =>
  String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();

const COMP_NAME = {
  compnone: 'none', compm: 'meme', comp0: 'casual', comp1: 'low',
  comp2: 'moderate', comp3: 'high', compu: 'tbd',
};

const stripTags = (s) => decodeEntities(String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

// Per-block equivalence gate: a replacement is only committed if it renders to the
// same visible text / images / links as the original block. Localizes failures so a
// single odd block stays raw HTML without blocking its neighbors.
// When a block is left as raw HTML, still drop its leading indentation: our regexes
// consume the indent into the match, and a neighbouring block that DID convert now
// ends with a blank line — leaving ≥4 spaces before `<div>` would turn it into a
// markdown code block. Dedenting the first line keeps the raw HTML rendering as HTML.
const keepRaw = (full) => full.replace(/^[ \t]+/, '');

function verifyBlock(original, replacement) {
  // Strip the block's leading indentation before rendering in isolation: a fragment
  // that starts with ≥4 spaces would be parsed as a markdown code block. (The actual
  // replacement removes that indentation in-place, so the written file is unaffected.)
  const r = comparableEqual(comparable(keepRaw(original)), comparable(replacement));
  if (!r.equal && process.env.DEBUG_BLOCK) {
    console.log('--- block mismatch ---\n  ' + r.reasons.join('\n  ') + '\n');
  }
  return r.equal;
}

// ---- decklist tokenizers -------------------------------------------------

// Run-on markdown form: **Pokémon - 25** 4 Hoppip LOT 12 4 Jumpluff LOT 14 …
// Locate the **section** headers first, then take each cards-blob as the text
// between consecutive headers (blobs can contain `*`, e.g. the `{\*}` promo marker,
// so we must NOT use a `[^*]` class to scan them).
function decklistFromRunon(text) {
  const headerRe = /\*\*\s*([^*]+?)\s*\*\*/g;
  const heads = [];
  let m;
  while ((m = headerRe.exec(text)))
    heads.push({ label: m[1].trim(), end: headerRe.lastIndex, start: m.index });
  if (heads.length === 0) return null;
  const lines = [];
  for (let i = 0; i < heads.length; i++) {
    lines.push(heads[i].label);
    const blob = text
      .slice(heads[i].end, i + 1 < heads.length ? heads[i + 1].start : undefined)
      .replace(/\{\\\*\}/g, '{*}')
      .trim();
    for (const card of blob.split(/(?<=\d)\s+(?=\d+\s+\S)/)) {
      const c = card.trim();
      if (c) lines.push(c);
    }
  }
  return lines;
}

// HTML <ul><li> form: <p class="jb-decklist-section">Pokémon - 16</p><ul><li>…</li></ul>
function decklistFromHtml(html) {
  const dom = new JSDOM(`<body>${html}</body>`);
  const nodes = [...dom.window.document.querySelectorAll('.jb-decklist-section, li')];
  if (nodes.length === 0) return null;
  return nodes.map((n) =>
    n.textContent.replace(/\{\\\*\}/g, '{*}').replace(/\s+/g, ' ').trim(),
  );
}

// ---- block transforms ----------------------------------------------------

function migrateGalleries(body, report) {
  return body.replace(/[ \t]*<div class="jb-gallery">([\s\S]*?)<\/div>/g, (full, inner) => {
    const figs = [...inner.matchAll(/<figure class="jb-gallery-slide">([\s\S]*?)<\/figure>/g)];
    if (figs.length === 0) return keepRaw(full);
    const items = figs.map((f) => {
      const href = (f[1].match(/<a href="([^"]*)"/) || [])[1];
      const src = (f[1].match(/<img[^>]*src="([^"]*)"/) || [])[1] || href;
      const cap = (f[1].match(/<figcaption>([\s\S]*?)<\/figcaption>/) || [])[1];
      const capTxt = cap ? ` "${stripTags(cap)}"` : '';
      return `- ${src}${capTxt}`;
    });
    const repl = `\n\n:::gallery\n${items.join('\n')}\n:::\n\n`;
    if (!verifyBlock(full, repl)) { report.flag++; return keepRaw(full); }
    report.gallery++;
    return repl;
  });
}

function migrateNotes(body, report) {
  return body.replace(
    /[ \t]*<div class="jb-code-container">\s*<div class="note_box">([\s\S]*?)<\/div>\s*<\/div>/g,
    (full, inner) => {
      const title = (inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1];
      const rest = inner.replace(/<h3[^>]*>[\s\S]*?<\/h3>/, '').trim();
      const attr = title ? `{title="${stripTags(title)}"}` : '';
      const repl = `\n\n:::note${attr}\n${rest}\n:::\n\n`;
      if (!verifyBlock(full, repl)) { report.flag++; return keepRaw(full); }
      report.note++;
      return repl;
    },
  );
}

function migrateBoxes(body, report) {
  // Class-based colored boxes only (skip inline-styled jb-cta-banner variants).
  return body.replace(
    /[ \t]*(<a href="([^"]*)">)?\s*<div class="((?:box|rbox)[^"]*)">([\s\S]*?)<\/div>\s*(<\/a>)?/g,
    (full, aOpen, href, cls, inner, aClose) => {
      const colorM = cls.match(/box_(\w+)/);
      const round = /\brbox\b/.test(cls);
      const titleM = inner.match(/<p class="box_title">([\s\S]*?)<\/p>/);
      const rest = inner.replace(/<p class="box_title">[\s\S]*?<\/p>/, '').trim();
      const attrs = [];
      if (colorM) attrs.push(`color="${colorM[1]}"`);
      if (titleM) attrs.push(`title="${stripTags(titleM[1])}"`);
      if (href) attrs.push(`href="${href}"`);
      if (round) attrs.push('round');
      const repl = `\n\n:::box{${attrs.join(' ')}}\n${rest}\n:::\n\n`;
      if (!verifyBlock(full, repl)) { report.flag++; return keepRaw(full); }
      report.box++;
      return repl;
    },
  );
}

// Set-page hero header (jb-set-card). Abstracts the uniform hero boilerplate (bg,
// logo, set-identifier, title) into attributes; keeps the body (description + the
// per-set nav links) as authored, since those vary and carry `.blink` styling.
function migrateSetcards(body, report) {
  const RE =
    /[ \t]*<div class="jb-code-container">\s*<div class="jb-set-card"([^>]*)>\s*<div>\s*([\s\S]*?)<hr\s*\/?>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  return body.replace(RE, (full, cardAttrs, hero, inner) => {
    const bg = (cardAttrs.match(/background-image:url\(([^)]*)\)/) || [])[1];
    let logo, identifier, idalt;
    for (const img of hero.match(/<img[^>]*>/g) || []) {
      const src = (img.match(/src="([^"]*)"/) || [])[1];
      if (/jb-deck-thumb/.test(img)) logo = src;
      else if (/jb-icon-center/.test(img)) {
        identifier = src;
        idalt = (img.match(/alt="([^"]*)"/) || [])[1];
      }
    }
    const title = (hero.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
    const subtitle = (hero.match(/<h3[^>]*jb-smallcaps-center[^>]*>([\s\S]*?)<\/h3>/) || [])[1];
    if (!title && !bg) {
      report.flag++;
      return keepRaw(full);
    }
    const attrs = [];
    if (bg) attrs.push(`bg="${bg}"`);
    if (logo) attrs.push(`logo="${logo}"`);
    if (identifier) attrs.push(`identifier="${identifier}"`);
    if (idalt) attrs.push(`idalt="${stripTags(idalt).replace(/"/g, "'")}"`);
    if (title) attrs.push(`title="${stripTags(title).replace(/"/g, "'")}"`);
    if (subtitle) attrs.push(`subtitle="${stripTags(subtitle).replace(/"/g, "'")}"`);
    const repl = `\n\n:::setcard{${attrs.join(' ')}}\n\n${inner.trim()}\n\n:::\n\n`;
    if (!verifyBlock(full, repl)) {
      report.flag++;
      return keepRaw(full);
    }
    report.setcard++;
    return repl;
  });
}

// Tournament-results grids (league/halloffame): an event deck_box header followed by
// a jb-row of jb-col-3 placement columns (each a "Nth Place" label + a decklist).
// Distinct from archetype decks (which use jb-col-6), so this never collides.
const RESULTS_RE = new RegExp(
  '[ \\t]*<div class="jb-code-container">\\s*' +
    '<div id="([^"]*)" class="deck_box">\\s*<h2>([\\s\\S]*?)</h2>\\s*' +
    '(?:<p class="jb-deckbox-sublabel[^"]*">([\\s\\S]*?)</p>)?\\s*</div>\\s*</div>' +
    '([\\s\\S]*?)' +
    '(?=<div class="jb-code-container">\\s*<div id="[^"]*" class="deck_box">|$)',
  'g',
);

function migrateResults(body, report) {
  return body.replace(RESULTS_RE, (full, id, event, meta, cols) => {
    if (!/class="jb-col-3"/.test(cols)) return full; // archetype deck, not a grid
    // Some events nest later placements inside a `jb-col-9 > jb-row` sub-grid; drop
    // those wrappers so every placement is a flat column (content is identical).
    const flat = cols
      .replace(/<div class="jb-col-9"[^>]*>/g, '')
      .replace(/<div class="jb-row">/g, '');
    const segments = flat.split(/<div class="jb-col-3">/).slice(1);
    if (!segments.length) return full;
    const placements = [];
    for (const seg of segments) {
      const labelM = seg.match(/<p class="jb-center">([\s\S]*?)<\/p>/);
      const segNoLabel = seg.replace(/<p class="jb-center">[\s\S]*?<\/p>/, '');
      // Recent events use <ul> decklists; older ones use run-on markdown. Try both
      // (strip wrapper tags first for the run-on form so closing </div>s don't leak in).
      const dl =
        decklistFromHtml(segNoLabel) ||
        decklistFromRunon(segNoLabel.replace(/<[^>]+>/g, ' '));
      if (!labelM || !dl) {
        report.resultsSkipped++;
        return keepRaw(full);
      }
      const rankM = labelM[1].match(/<strong>([\s\S]*?)<\/strong>/);
      const rank = stripTags(rankM ? rankM[1] : labelM[1]);
      const who = stripTags(
        labelM[1].replace(/<strong>[\s\S]*?<\/strong>/, '').replace(/<br\s*\/?>/i, ' '),
      );
      placements.push({ rank, who, dl });
    }
    const attrs = [`id="${id}"`, `event="${stripTags(event).replace(/"/g, "'")}"`];
    if (meta) attrs.push(`meta="${stripTags(meta).replace(/"/g, "'")}"`);
    let out = `\n\n:::results{${attrs.join(' ')}}\n\n`;
    for (const p of placements) {
      out += `#### ${p.rank}${p.who ? ' — ' + p.who : ''}\n\n`;
      out += '```decklist\n' + p.dl.join('\n') + '\n```\n\n';
    }
    out += ':::\n\n';
    if (!verifyBlock(full, out)) {
      report.resultsSkipped++;
      return keepRaw(full);
    }
    report.results++;
    return out;
  });
}

const DECK_RE = new RegExp(
  '[ \\t]*(?:<div class="jb-layout[^"]*"[^>]*>)?' +
    '(?:<div class="jb-row">)?(?:<div class="jb-col-12">)?' +
    '<div class="jb-code-container">\\s*' +
    '<div id="([^"]*)" class="deck_box">([\\s\\S]*?)</div>\\s*</div>' +
    '\\s*(?:</div>)*' +
    '<div class="jb-row"><div class="jb-col-6">([\\s\\S]*?)' +
    '</div><div class="jb-col-6">([\\s\\S]*?)</div></div>' +
    '(?:</div>)*',
  'g',
);

function migrateDecks(body, report) {
  return body.replace(DECK_RE, (full, id, header, left, right) => {
    const priceM = header.match(/<p class="jb-deckbox-title">([\s\S]*?)<\/p>/);
    const nameM = header.match(/<h[12]([^>]*)>([\s\S]*?)<\/h[12]>/);
    const subM = header.match(/<p class="jb-deckbox-sublabel[^"]*">([\s\S]*?)<\/p>/);
    const compM = header.match(/class="(comp\w+)"/);
    if (!nameM) {
      report.deckSkipped++;
      return keepRaw(full); // can't identify the archetype → leave as-is
    }
    const nameClass = (nameM[1].match(/class="([^"]*)"/) || [])[1];
    let typeAttr = null;
    if (nameClass) {
      if (/^[grwlpfdmync]$/.test(nameClass.trim())) {
        typeAttr = nameClass.trim(); // single-letter type symbol → recoverable
      } else {
        // Unknown decorative class the shortcode can't reproduce; leave raw.
        report.deckSkipped++;
        return keepRaw(full);
      }
    }
    const attrs = [`id="${id}"`, `name="${stripTags(nameM[2])}"`];
    if (typeAttr) attrs.push(`type="${typeAttr}"`);

    // Pull thumbnail + illustrator out of the left column into attributes. Two
    // conventions exist: a separate `*Illus. X*` line (SV era) or the credit baked
    // into the image alt — `![Illus. X](/img)` (SS era).
    let leftBody = left;
    let illus = null;
    const mdImg = leftBody.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (mdImg) {
      attrs.push(`image="${mdImg[2]}"`);
      const altIllus = mdImg[1].match(/^Illus\.\s*(.+)$/i);
      if (altIllus) illus = stripTags(altIllus[1]);
      leftBody = leftBody.replace(mdImg[0], '');
    } else {
      const htmlImg = leftBody.match(/<img[^>]*src="([^"]*)"[^>]*>/);
      if (htmlImg) {
        attrs.push(`image="${htmlImg[1]}"`);
        leftBody = leftBody.replace(htmlImg[0], '');
      }
    }
    const illusM = leftBody.match(/\*Illus\.\s*([^*]+?)\*/) || leftBody.match(/<em>Illus\.\s*([\s\S]*?)<\/em>/);
    if (illusM) {
      illus = stripTags(illusM[1]);
      leftBody = leftBody.replace(illusM[0], '');
    }
    if (illus) attrs.push(`illus="${illus}"`);
    if (priceM) attrs.push(`price="${stripTags(priceM[1])}"`);
    if (subM) attrs.push(`sublabel="${stripTags(subM[1]).replace(/"/g, "'")}"`);
    if (compM && COMP_NAME[compM[1]]) attrs.push(`comp="${COMP_NAME[compM[1]]}"`);

    // Right column = [optional source/credit] [decklist] [optional trailing sections
    // like "### Alternate Lists" / "### Testing Streams"]. Find the decklist's start,
    // then its end (the first heading or row-grid that follows it = trailing content).
    const dlStart = right.search(
      /\*\*\s*[^*]+?\s*\*\*|<p class="jb-decklist-section">|<div class="jb-code-container">/,
    );
    if (dlStart < 0) {
      report.deckSkipped++;
      return keepRaw(full); // no decklist found → leave as-is
    }
    const sourcePart = right.slice(0, dlStart);
    const afterStart = right.slice(dlStart);
    const trailM = afterStart.search(/\n\s*\n\s*(?:#{1,6}\s|<div class="jb-row")/);
    const dlText = trailM >= 0 ? afterStart.slice(0, trailM) : afterStart;
    const trailingPart = trailM >= 0 ? afterStart.slice(trailM).trim() : '';

    let decklist = decklistFromRunon(dlText) || decklistFromHtml(dlText);
    if (!decklist) {
      report.deckSkipped++;
      return keepRaw(full); // unrecognized decklist shape → leave as-is
    }
    // The intro above the decklist is usually a chrome heading ("### DECK LIST",
    // "### EXAMPLE DECK LIST") with occasionally a real credit line. Drop heading
    // lines entirely; keep a remaining "Source: …" credit as the source attribute.
    const source = stripTags(
      sourcePart.replace(/^#{1,6}\s+.*$/gm, '').replace(/<[^>]+>/g, ''),
    )
      .replace(/^source:\s*/i, '')
      .trim();
    if (source) attrs.push(`source="${source.replace(/"/g, "'")}"`);

    // 4-colon container so a deck can hold nested 3-colon directives (e.g. a
    // `:::gallery` of card images in the left column, as on the Battle Academy page).
    const fence = '```decklist\n' + decklist.join('\n') + '\n```';
    const repl =
      `\n\n::::deck{${attrs.join(' ')}}\n\n` +
      leftBody.trim() +
      `\n\n${fence}\n\n` +
      (trailingPart ? trailingPart + '\n\n' : '') +
      `::::\n\n`;
    if (!verifyBlock(full, repl)) {
      report.deckSkipped++;
      return keepRaw(full); // didn't round-trip → leave as raw HTML, flag for review
    }
    report.deck++;
    return repl;
  });
}

// ---- driver --------------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(fp));
    else if (e.name.endsWith('.md')) out.push(fp);
  }
  return out;
}

function splitFrontmatter(raw) {
  const m = raw.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : { fm: '', body: raw };
}

const files = walk(CONTENT).filter((f) => !ONLY || f.includes(ONLY));
const totals = { files: 0, changed: 0, deck: 0, deckSkipped: 0, gallery: 0, note: 0, box: 0, results: 0, resultsSkipped: 0, setcard: 0, flag: 0, bug: 0 };
const flagged = [];

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const { fm, body } = splitFrontmatter(raw);
  const report = { deck: 0, deckSkipped: 0, gallery: 0, note: 0, box: 0, results: 0, resultsSkipped: 0, setcard: 0, flag: 0 };

  // Each transform self-verifies per block (verifyBlock) — committed blocks are
  // guaranteed render-equivalent; non-equivalent blocks are left as raw HTML.
  let out = body;
  out = migrateGalleries(out, report);
  out = migrateNotes(out, report);
  out = migrateBoxes(out, report);
  out = migrateSetcards(out, report);
  out = migrateResults(out, report);
  out = migrateDecks(out, report);
  // Leftover Squarespace page-section wrappers are often indented; once a preceding
  // block becomes a shortcode (introducing a blank line), that indent would turn the
  // `<div>` into a markdown code block. Dedent them so they stay HTML at column 0.
  out = out.replace(/^[ \t]+(?=<div class="jb-layout)/gm, '');

  const migrated = report.deck + report.gallery + report.note + report.box + report.results + report.setcard;
  const left = report.deckSkipped + report.resultsSkipped + report.flag;
  if (migrated === 0 && left === 0) continue;
  totals.files++;
  const rel = path.relative(ROOT, file);

  for (const k of ['deck', 'gallery', 'note', 'box', 'results', 'setcard', 'flag']) totals[k] += report[k];
  totals.deckSkipped += report.deckSkipped;
  totals.resultsSkipped += report.resultsSkipped;
  if (left) flagged.push({ file: rel, deckSkipped: report.deckSkipped, flag: report.flag + report.resultsSkipped });

  if (out === body) continue; // nothing committed (everything flagged)

  // Defense-in-depth: per-block gates should compose to whole-file equivalence.
  // If not, something interacted badly — do NOT write; surface it loudly.
  const cmp = comparableEqual(comparable(body), comparable(out));
  if (!cmp.equal) {
    totals.bug++;
    console.log(`!! FILE-LEVEL MISMATCH (not written) ${rel}\n   ${cmp.reasons.join('\n   ')}`);
    continue;
  }

  totals.changed++;
  console.log(
    `${DRY ? 'would write' : 'WROTE'}  ${rel}  ` +
      `(deck:${report.deck} gallery:${report.gallery} note:${report.note} box:${report.box} results:${report.results} setcard:${report.setcard}` +
      `${left ? ` · left-raw:${left}` : ''})`,
  );
  if (!DRY) fs.writeFileSync(file, fm + out);
}

console.log('\n--- summary ---');
console.log(`files with blocks: ${totals.files}   files ${DRY ? 'to change' : 'changed'}: ${totals.changed}`);
console.log(`blocks migrated → deck:${totals.deck} gallery:${totals.gallery} note:${totals.note} box:${totals.box} results:${totals.results} setcard:${totals.setcard}`);
console.log(`blocks left as raw HTML (didn't round-trip): deck:${totals.deckSkipped} results:${totals.resultsSkipped} other:${totals.flag}`);
if (totals.bug) console.log(`!! file-level mismatches (investigate): ${totals.bug}`);
if (flagged.length) {
  console.log(`\n--- files with blocks left raw for manual review (${flagged.length}) ---`);
  for (const r of flagged) console.log(`  ${r.file}  (deck:${r.deckSkipped} other:${r.flag})`);
}
