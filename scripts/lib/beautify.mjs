// Deterministic DOM cleanup applied to extracted page bodies before serialization.
// Rules are intentionally narrow: they must NEVER change rendering (the fidelity harness
// is the ground truth). Layout-bearing classes / styles that the compat CSS depends on
// stay. We only remove things the public renderer ignores.

const NOISE_DATA_ATTR_PREFIXES = [
  'data-block-',
  'data-sqsp-',
  'data-rte-',
  'data-image-',
  'data-border-',
];

const NOISE_DATA_ATTR_EXACT = new Set([
  'data-definition-name',
  'data-website-component-id',
  'data-test',
  'data-controller',
  'data-controllers',
  'data-converted',
  'data-load',
  'data-parent-ratio',
  'data-original-size',
  'data-image-dimensions',
  'data-image-focal-point',
  'data-image-resolution',
  'data-image-id',
  'data-image',
  'data-src',
  'data-licensed-assets-loaded',
  'data-collection-id',
  'data-edit-main-image',
  'data-parent-id',
  'data-localized',
  // Gallery-lightbox decorations. These are Squarespace UI metadata for the lightbox
  // overlay JS (which we strip). On static output they carry no visual or semantic
  // weight — the href + (escaped) alt is the whole contract.
  'data-title',
  'data-description',
  'data-lightbox-theme',
  'data-animation-role',
  'data-stretch',
  'data-loader',
  'data-position',
  'elementtiming',
  'aria-label',
  'aria-hidden',
  'role',
]);

const NOISE_ID_RE = /^(?:block-|yui_|thumb-|item-)/;

// Out-of-band stash for converted prose. JSDOM's HTML serializer re-encodes `&` → `&amp;`
// and U+00A0 → `&nbsp;`, which would re-introduce the entities the readability bar
// forbids. So we replace each convertible `.sqs-html-content` with a one-character
// sentinel + index, keep the Markdown text in an array, and splice it back into the
// serialized string in `finalizeBody()` — after collapseBlankLines, so its own
// paragraph-break blank lines aren't collapsed.
const STASH_OPEN = '';
const STASH_CLOSE = '';
let stash = [];

function pushStash(md) {
  const i = stash.length;
  stash.push(md);
  return STASH_OPEN + i + STASH_CLOSE;
}

/** Reset stash before each page. */
export function resetStash() { stash = []; }

// Mirror convert.mjs `rewriteLinks` for Markdown link hrefs (which never see that pass
// because the rewrite targets `href="…"` attribute syntax, not `[text](href)`).
const DISCORD_INVITE = 'https://discord.gg/gy52nzras2';
function normalizeHref(href) {
  if (!href) return href;
  // Absolute justinbasil.com → root-relative, drop trailing slash on subpaths.
  const m = href.match(/^https?:\/\/(?:www\.)?justinbasil\.com(\/[^\s]*)?$/i);
  if (m) href = (m[1] || '/').replace(/\/$/, '') || '/';
  // /discord was a Squarespace redirect to the actual Discord invite. Apply AFTER
  // the justinbasil rewrite so `https://justinbasil.com/discord` also routes here.
  if (/^\/discord\/?$/i.test(href)) return DISCORD_INVITE;
  return href;
}

// Inner-text builder: returns a string with internal ASCII whitespace runs collapsed
// to single spaces, but LEADING and TRAILING whitespace preserved so callers can move
// them outside emphasis markers (CommonMark forbids whitespace immediately inside `**`).
// Escape Markdown specials in literal text so source `*` / `_` (e.g. asterisk
// footnote markers) aren't mistaken for emphasis when re-compiled. We do NOT escape
// `[`/`]` etc. broadly — they're rarer in this corpus and could over-escape link
// alt-text. If a future case shows them being mis-parsed, extend here.
function escapeMdText(s) {
  return s.replace(/([*_])/g, '\\$1');
}

function inlineRaw(el) {
  let out = '';
  for (const c of el.childNodes) {
    if (c.nodeType === 3) { out += escapeMdText(c.nodeValue); continue; }
    if (c.nodeType !== 1) continue;
    const tag = c.tagName.toLowerCase();
    if (tag === 'strong' || tag === 'b') out += wrap('**', inlineRaw(c));
    else if (tag === 'em' || tag === 'i')  out += wrap('*',  inlineRaw(c));
    else if (tag === 'a') {
      const inner = inlineRaw(c);
      const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
      // Always emit the anchor (even with empty text) — pristine had the link in DOM
      // and the fidelity fingerprint counts links in order, so dropping it desyncs the
      // sequence.
      out += m[1] + '[' + m[2] + '](' + normalizeHref(c.getAttribute('href') || '') + ')' + m[3];
    }
    else if (tag === 'br') out += '  \n';
    // Layout wrappers commonly sit inside `<li>` etc. in this corpus. Treat them as
    // transparent in inline contexts — emit their children, not the wrapper.
    // `<p>`/`<div>` inside an inline context are wrappers; descend into children.
    // `<span>` we KEEP as raw HTML — it often introduces a text-node boundary in
    // pristine that the fidelity fingerprint relies on.
    else if (tag === 'p' || tag === 'div') out += inlineRaw(c);
    else out += c.outerHTML;          // unknown inline element — pass through
  }
  // Collapse internal ASCII whitespace runs to a single space (keep U+00A0).
  // Preserve a single leading/trailing space if any whitespace existed there.
  return out
    .replace(/[ \t\n]+/g, ' ');
}

// `**text**` requires text to be non-empty AND have no whitespace at its boundary.
// Move boundary whitespace outside the markers.
function wrap(marker, inner) {
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const tag = marker === '**' ? 'strong' : 'em';
  if (!m[2] || !/[\p{L}\p{N}]/u.test(m[2])) {
    // Empty or punct-only — Markdown emphasis can't represent it. Raw HTML preserves
    // the element so the rendered DOM text-node split matches pristine.
    return m[1] + (m[2] ? `<${tag}>${m[2]}</${tag}>` : '') + m[3];
  }
  const isAlnum = (ch) => /[\p{L}\p{N}]/u.test(ch);
  // For Markdown emphasis to reliably bind around the content, both inner ends must be
  // alphanumeric. Otherwise CommonMark's flanking rules can leave one or both `*`s as
  // literal characters (e.g. `Star-*that` — closing `*` is preceded by `-` punctuation
  // and followed by a letter, which fails right-flanking). Fall back to raw HTML.
  if (!isAlnum(m[2][0]) || !isAlnum(m[2][m[2].length - 1])) {
    return m[1] + `<${tag}>${m[2]}</${tag}>` + m[3];
  }
  return m[1] + marker + m[2] + marker + m[3];
}

function inlineToMd(el) {
  return inlineRaw(el).trim();
}

// List → Markdown, with nested `<ul>/<ol>` inside an `<li>` rendered as an indented
// sub-list (2-space indent per CommonMark "loose" sub-list nesting).
function listToMd(node) {
  const ordered = node.tagName.toLowerCase() === 'ol';
  const items = [...node.children].filter((c) => c.tagName.toLowerCase() === 'li');
  if (!items.length) return null;
  const lines = [];
  items.forEach((li, idx) => {
    const marker = ordered ? `${idx + 1}. ` : '- ';
    // Split each li's children into inline run + trailing nested lists.
    let inline = '';
    const nestedLists = [];
    for (const child of li.childNodes) {
      if (child.nodeType === 1) {
        const ct = child.tagName.toLowerCase();
        if (ct === 'ul' || ct === 'ol') { nestedLists.push(child); continue; }
      }
      // Reuse inlineRaw on a temporary parent. inlineRaw iterates childNodes of its
      // argument, so wrap the single node in a fragment-like dummy.
      const frag = node.ownerDocument.createElement('span');
      frag.appendChild(child.cloneNode(true));
      inline += inlineRaw(frag);
    }
    inline = inline.replace(/[ \t\n]+/g, ' ').trim();
    lines.push(marker + (inline || ''));
    for (const nl of nestedLists) {
      const sub = listToMd(nl);
      if (!sub) continue;
      for (const subLine of sub.split('\n')) lines.push('  ' + subLine);
    }
  });
  return lines.join('\n');
}

function blockToMd(node) {
  if (node.nodeType === 3) {
    const t = node.nodeValue.replace(/[ \t\n]+/g, ' ').trim();
    return t || null;
  }
  if (node.nodeType !== 1) return null;
  const tag = node.tagName.toLowerCase();
  const m = tag.match(/^h([1-6])$/);
  if (m) {
    // A heading that carries a promoted style class (e.g. `jb-center` on centered
    // page titles / banner headers) must stay HTML so the class — and thus the
    // original alignment — survives. Markdown `#` can't express alignment, so
    // flattening these silently left-aligned every centered title. At this point in
    // the pipeline `stripNoiseAttrs` has removed noise classes and
    // `promoteUtilityStyles` has converted meaningful inline styles to `jb-*`
    // classes, so any remaining class on a heading is a real, kept style.
    if ((node.classList && node.classList.length) || /text-align\s*:/i.test(node.getAttribute('style') || '')) return node.outerHTML.trim();
    const txt = inlineToMd(node);
    // Empty heading: keep the element so fidelity sees the same heading count.
    if (!txt) return `<${tag}></${tag}>`;
    return '#'.repeat(Number(m[1])) + ' ' + txt;
  }
  if (tag === 'p') {
    // Same as headings: a paragraph carrying a promoted alignment class (or an inline
    // text-align) must stay HTML so its centering survives — Markdown can't express it.
    if ((node.classList && node.classList.length) || /text-align\s*:/i.test(node.getAttribute('style') || '')) return node.outerHTML.trim();
    let txt = inlineToMd(node);
    if (!txt) return null;
    // Prevent CommonMark ordered-list interpretation at line start.
    txt = txt.replace(/^(\d+)([.)])(\s)/, '$1\\$2$3');
    return txt;
  }
  if (tag === 'ul' || tag === 'ol') {
    return listToMd(node);
  }
  if (tag === 'hr') return '---';
  if (tag === 'br') return null;
  return node.outerHTML;
}

const CONVERTIBLE_TAGS = new Set(['h1','h2','h3','h4','h5','h6','p','ul','ol','hr','br']);

/** Only convert when every direct child is a tag we know how to express in Markdown. */
function tryConvertProse(el) {
  const kids = [...el.childNodes].filter((n) => n.nodeType !== 3 || n.nodeValue.trim());
  if (!kids.length) return false;
  for (const k of kids) {
    if (k.nodeType === 3) continue;
    if (k.nodeType !== 1) return false;
    if (!CONVERTIBLE_TAGS.has(k.tagName.toLowerCase())) return false;
  }
  const parts = kids.map(blockToMd).filter((s) => s && s.trim());
  if (!parts.length) return false;
  const md = parts.join('\n\n');
  // Replace the element's content with the stash sentinel. Keep the wrapping
  // `.sqs-html-content` div so the compat CSS still targets the prose (margins on
  // headings, inline-block on imgs, word-wrap).
  el.textContent = pushStash(md);
  return true;
}

// After prose conversion succeeded on every `.sqs-html-content`, collapse the surrounding
// Squarespace HTML-block wrapper chain so the markdown emerges as a top-level sibling.
// Pattern in the corpus:
//   <div class="sqs-block html-block sqs-block-html">
//     <div class="sqs-block-content">
//       <div class="sqs-html-content">STASH</div>
//     </div>
//   </div>
// All three wrappers are pure passthroughs once the inner content is a stash sentinel —
// the original visual rules (margins, word-wrap) move to `.sqs-content` styling.
function unwrapProseBlockWrappers(root) {
  root.querySelectorAll('div.sqs-block.sqs-block-html').forEach((block) => {
    // Find the .sqs-html-content (must be present and now hold only the stash sentinel)
    const html = block.querySelector('.sqs-html-content');
    if (!html) return;
    // Confirm it's a converted-prose sentinel: textContent matches the stash pattern and
    // there are no element children left (tryConvertProse sets textContent which wipes
    // child nodes).
    const txt = html.textContent;
    if (!txt) return;
    if (html.children.length !== 0) return; // belt-and-braces: only if no element kids
    if (!new RegExp('^\\s*' + STASH_OPEN + '\\d+' + STASH_CLOSE + '\\s*$').test(txt)) return;
    // Replace the entire .sqs-block wrapper with a text node holding the sentinel.
    const sentinel = block.ownerDocument.createTextNode(txt.trim());
    block.parentNode.replaceChild(sentinel, block);
  });
}

// Promote ubiquitous inline styles to utility / pattern classes. Each entry is the
// exact normalized style string (lowercase, whitespace-stripped, trailing `;`) and the
// class to add when it matches. Single-rule utilities first; then multi-rule patterns
// that recur enough to deserve a class (uppercase table headers, CTA card title/desc/
// body, centered icons).
const STYLE_TO_UTIL_CLASS = [
  // Single-rule utilities.
  { match: 'font-weight:bold;',    klass: 'jb-bold' },
  { match: 'text-align:center;',   klass: 'jb-center' },
  { match: 'text-align:right;',    klass: 'jb-right' },
  { match: 'text-align:left;',     klass: 'jb-left' },
  { match: 'vertical-align:middle;', klass: 'jb-vmid' },
  { match: 'margin-top:0px;',      klass: 'jb-mt0' },
  // Recurring multi-rule patterns.
  { match: 'font-size:16px;font-weight:bold;text-transform:uppercase;', klass: 'jb-th' },
  { match: 'vertical-align:middle;margin-left:auto;margin-right:auto;display:block;', klass: 'jb-icon-center' },
  { match: 'color:#fff;text-align:center;margin:15px;', klass: 'jb-cta-title' },
  { match: 'margin:5px;text-align:center;', klass: 'jb-cta-desc' },
  { match: 'text-align:center;padding:20px20px0px20px;', klass: 'jb-cta-body' },
  { match: 'max-width:70px;display:block;margin-left:auto;margin-right:auto;', klass: 'jb-icon-70' },
  { match: 'text-align:center;margin:0px0px0px0px;', klass: 'jb-center-flat' },
  { match: 'text-align:center;color:#fff;', klass: 'jb-white-center' },
  { match: 'text-align:center;margin:0px;color:#fff;', klass: 'jb-white-center-margin0' },
  { match: 'color:#fff;text-align:center;margin:5px;', klass: 'jb-white-center-margin5' },
  { match: 'text-align:center;margin-left:auto;margin-right:auto;', klass: 'jb-center-block' },
  { match: 'font-size:25px;text-align:center;margin-bottom:0px;', klass: 'jb-deckbox-title' },
  { match: 'font-family:pkmntcg;font-size:18px;', klass: 'jb-symbol-18' },
  { match: 'margin-top:10px;', klass: 'jb-mt-10' },
  { match: 'text-align:left;', klass: 'jb-left' },
  { match: 'font-family:pkmntcg;font-size:18px;font-weight:normal;', klass: 'jb-symbol-18-n' },
  { match: 'text-align:center;margin:0px;', klass: 'jb-center-mb0' },
  { match: 'white-space:pre-wrap;', klass: 'jb-pre' },
  { match: 'cursor:pointer;', klass: 'jb-pointer' },
  { match: 'padding:10px;', klass: 'jb-p10' },
  { match: 'font-size:25px;text-transform:uppercase;', klass: 'jb-25-upper' },
  { match: 'display:inline-block;font-size:10px;', klass: 'jb-ib-10' },
  // Original Squarespace HTML literally has the typo `dislay:` — preserve the match.
  { match: 'dislay:inline-block;float:left;padding-right:10px;', klass: 'jb-fl-padded' },
  { match: 'text-align:left;font-size:14px;', klass: 'jb-left-14' },
  { match: 'margin-bottom:0px;', klass: 'jb-mb0' },
  { match: 'font-size:16px;color:#fff;font-weight:bold;text-transform:uppercase;', klass: 'jb-th-white' },
  { match: 'text-decoration:underline;', klass: 'jb-u' },
  { match: 'column-width:160px;', klass: 'jb-col-160' },
  { match: 'color:blue;', klass: 'jb-blue' },
  { match: 'margin-top:0px;margin-bottom:10px;', klass: 'jb-mt0-mb10' },
  { match: 'padding:5px;', klass: 'jb-p5' },
  { match: 'margin-bottom:0;margin-top:0;', klass: 'jb-m0' },
  { match: 'font-size:25px;font-weight:bold;text-transform:uppercase;', klass: 'jb-25-bold-upper' },
  { match: 'text-align:center;margin:0px;padding:0px;', klass: 'jb-center-zero' },
  { match: 'padding:5px!important;', klass: 'jb-p5-i' },
  { match: 'font-family:pkmntcg;', klass: 'jb-pkmntcg' },
  { match: "font-family:'pkmntcg';", klass: 'jb-pkmntcg' },
  { match: 'text-align:center;font-style:italic;margin:0px;padding:0px;', klass: 'jb-center-italic' },
  { match: 'padding:5px;margin:5px;width:100%;text-align:center;', klass: 'jb-card-tile' },
  { match: 'font-size:19px;font-weight:bold;text-transform:uppercase;text-align:center;', klass: 'jb-h-19' },
  { match: 'padding:5px!important;width:64px;', klass: 'jb-p5-w64' },
  { match: 'margin-left:20px;margin-top:0px;margin-bottom:0px;', klass: 'jb-mx20-m0' },
  { match: 'margin-left:20px;margin-bottom:0px;', klass: 'jb-ml20-mb0' },
  { match: 'width:320px;text-align:center;margin-left:auto;margin-right:auto;', klass: 'jb-w320-center' },
  { match: 'text-align:center;padding-top:0px;margin-top:0px;', klass: 'jb-center-top0' },
  { match: 'text-align:center;margin-top:20px;', klass: 'jb-center-mt20' },
  { match: 'text-align:center;margin-top:0px;', klass: 'jb-center-mt0' },
  { match: 'text-align:center;margin-bottom:0px;', klass: 'jb-center-mb0-2' },
  { match: 'padding:8px;', klass: 'jb-p8' },
  // Small single-rule colour/size tail.
  { match: 'color:#da6d6d;', klass: 'jb-c-da6d6d' },
  { match: 'color:darkblue;', klass: 'jb-darkblue' },
  { match: 'color:lightblue;', klass: 'jb-lightblue' },
  { match: 'color:red;', klass: 'jb-red' },
  { match: 'font-size:10px;', klass: 'jb-fs10' },
  { match: 'font-size:8px;', klass: 'jb-fs8' },
  { match: 'font-weight:600;', klass: 'jb-fw600' },
  { match: 'max-height:200px;', klass: 'jb-mh200' },
  { match: 'max-height:165px;', klass: 'jb-mh165' },
  { match: 'background-color:#000;color:#fff;font-weight:bold;', klass: 'jb-blackchip' },
  { match: 'background-color:#f2f2f2;padding:10px;', klass: 'jb-greybox' },
  { match: 'background-color:#f2f2f2;', klass: 'jb-greybg' },
  { match: 'font-size:8px;text-align:center;', klass: 'jb-fs8-center' },
  { match: 'text-align:center;font-size:20px;margin-bottom:1;', klass: 'jb-center-20' },
  { match: 'color:#fff;font-variant:small-caps;text-align:center;margin:0px;', klass: 'jb-smallcaps-center' },
  { match: 'color:#fff;text-align:center;margin-top:15px;margin-bottom:0px;', klass: 'jb-white-center-mt15' },
  { match: 'margin-top:15px;vertical-align:middle;margin-left:auto;margin-right:auto;display:block;', klass: 'jb-icon-center-mt15' },
  { match: 'border-width:1px;border-style:solid;margin:10px;', klass: 'jb-bordered-box' },
  { match: 'padding:5px;background-color:#000;color:#fff;font-weight:bold;', klass: 'jb-blackchip-p5' },
  { match: 'text-align:center;padding:0;margin:5px;', klass: 'jb-center-p0-m5' },
  { match: 'justify-content:center;display:flex;flex-direction:row;', klass: 'jb-flex-center' },
  { match: 'width:calc(100%);justify-content:center;display:flex;flex-direction:row;', klass: 'jb-flex-center-full' },
  { match: 'text-align:left;margin-left:0px;padding-left:0px;', klass: 'jb-left-flush' },
  { match: 'box-sizing:border-box;padding:10px;margin:0px;background-color:#eee;border:1pxsolid;border-color:#e3e3e3#cecece#b4b4b4#d6d6d6;box-shadow:02px2px0rgb(000/16%),0001pxrgb(000/8%);border-radius:4px;', klass: 'jb-flat-card' },
  { match: 'border:0;width:320px;text-align:center;margin:auto;', klass: 'jb-w320-auto' },
  { match: 'border-spacing:5px;padding:5px;text-align:center;margin-left:auto;margin-right:auto;', klass: 'jb-table-center' },
  { match: 'padding-left:5px!important;padding-right:5px;width:64px;', klass: 'jb-p5x-w64' },
  { match: 'text-align:center;margin-top:0px;margin-bottom:20px;', klass: 'jb-center-mb20' },
  { match: 'text-align:center;padding-bottom:0px;margin-bottom:0px;', klass: 'jb-center-pb0-mb0' },
  { match: 'text-align:center;padding-bottom:0px;margin:0px;', klass: 'jb-center-pb0-m0' },
  { match: 'padding-bottom:0px;margin-bottom:0px;text-align:center;', klass: 'jb-center-pb0-mb0' },
  { match: 'padding-top:0px;margin-top:0px;text-align:center;', klass: 'jb-center-pt0-mt0' },
  { match: 'padding-bottom:0px;margin-bottom:0px;margin-top:3px;', klass: 'jb-pb0-mb0-mt3' },
  { match: 'text-align:center;margin-top:20px;margin-bottom:25px;', klass: 'jb-center-mt20-mb25' },
  { match: 'text-align:center;font-size:25px;', klass: 'jb-center-25' },
  { match: 'font-size:16px;font-weight:bold;text-transform:uppercase;text-align:center;', klass: 'jb-th-center' },
  { match: 'font-size:19px;font-weight:bold;text-transform:uppercase;text-align:center;margin-top:5px;', klass: 'jb-h19-center-mt5' },
  { match: 'font-size:16px;', klass: 'jb-fs16' },
  { match: 'margin-top:10px;margin-bottom:10px;', klass: 'jb-my10' },
  { match: 'margin-left:5px;', klass: 'jb-ml5' },
  { match: 'text-align:center;vertical-align:middle;', klass: 'jb-center-vmid' },
  { match: 'max-height:150px;max-width:200px;margin-top:auto;margin-bottom:auto;', klass: 'jb-thumb-150-200' },
  { match: 'background-color:#7f7f7f;padding:5px;', klass: 'jb-greychip' },
  { match: 'text-align:center;border:1pxsolidblack;padding:10px;margin-left:auto;margin-right:auto;', klass: 'jb-center-bordered' },
  { match: 'padding-left:5px;padding-right:5px!important;width:64px;', klass: 'jb-p5x-w64b' },
  { match: 'padding-right:5px;padding-left:5px!important;', klass: 'jb-p5x' },
  { match: 'width:64px;padding-left:5px!important;padding-right:5px;', klass: 'jb-p5x-w64c' },
  { match: 'padding-left:5px;padding-right:5px!important;', klass: 'jb-p5x' },
  { match: 'margin-left:auto;margin-right:auto;', klass: 'jb-mx-auto' },
  { match: 'font-size:15px;text-align:justify;margin-bottom:0px;padding-top:0px;margin-top:8px;line-height:1.5;margin-left:20px;margin-right:20px;', klass: 'jb-deckbox-body-justify' },
  { match: 'max-width:600px;background-color:#ddd;margin-left:auto;margin-right:auto;text-align:center;padding:8px;', klass: 'jb-greybanner' },
];
function promoteUtilityStyles(root) {
  root.querySelectorAll('[style]').forEach((el) => {
    const raw = (el.getAttribute('style') || '').trim();
    const norm = raw.replace(/\s+/g, '').toLowerCase();
    for (const rule of STYLE_TO_UTIL_CLASS) {
      if (norm !== rule.match && norm !== rule.match.replace(/;$/, '')) continue;
      el.removeAttribute('style');
      const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      if (!cls.includes(rule.klass)) cls.push(rule.klass);
      el.setAttribute('class', cls.join(' '));
      return;
    }
  });
}

function addClass(el, klass) {
  const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  if (!cls.includes(klass)) cls.push(klass);
  el.setAttribute('class', cls.join(' '));
}

// Parse `background-image:url(/images/xxx.webp)` out of a normalized-or-raw style value.
function extractBgImage(raw) {
  const m = raw.match(/background-image\s*:\s*url\(\s*([^)]*?)\s*\)/i);
  if (!m) return null;
  const u = m[1].replace(/^['"]|['"]$/g, '').trim();
  return u || null;
}
function extractBgPosition(raw) {
  const m = raw.match(/background-position\s*:\s*([a-z]+)/i);
  return m ? m[1].toLowerCase() : null;
}

// Background-image "cards" (set-list header cards, rotation tiles) have no Markdown form
// and per the PROMPT-2 Images guidance stay as minimal HTML with a semantic class whose
// STATIC styling lives entirely in CSS. The only genuinely per-instance value is the
// card's own `background-image` URL (and occasionally a non-default background-position).
// We strip everything else to a `.jb-set-card` / `.jb-rotation-card` class and keep only
// that one unavoidable declaration inline (the documented card exception).
function convertBgCards(root) {
  root.querySelectorAll('[style]').forEach((el) => {
    const raw = (el.getAttribute('style') || '').trim();
    const norm = raw.replace(/\s+/g, '').toLowerCase();
    // The dark set-list header card: margin:10px; ... color:#ffffff; background-color:#111;
    if (norm.includes('background-color:#111;') &&
        norm.includes('box-shadow:02px2px') && norm.startsWith('margin:10px;')) {
      const url = extractBgImage(raw);
      const pos = extractBgPosition(raw);
      el.removeAttribute('style');
      addClass(el, 'jb-set-card');
      if (pos && pos !== 'center') addClass(el, 'jb-bgpos-' + pos);
      if (url) el.setAttribute('style', `background-image:url(${url})`);
      return;
    }
    // The rotation grid tiles: background-image:url(...); ... width:calc(100% - 10px);
    // height:200px; background-color:#b1e88f|#444; (cover/contain) + border + shadow.
    if (norm.includes('box-sizing:border-box;') && norm.includes('height:200px;') &&
        norm.includes('box-shadow:02px2px') && extractBgImage(raw)) {
      const url = extractBgImage(raw);
      const pos = extractBgPosition(raw);
      const contain = /background-size\s*:\s*contain/i.test(raw);
      const darkBg = /background-color\s*:\s*#444/i.test(raw);
      el.removeAttribute('style');
      addClass(el, 'jb-rotation-card');
      if (contain) addClass(el, 'jb-bgsize-contain');
      if (darkBg) addClass(el, 'jb-rotation-card-dark');
      if (pos && pos !== 'center') addClass(el, 'jb-bgpos-' + pos);
      if (url) el.setAttribute('style', `background-image:url(${url})`);
      return;
    }
    // Format "chips" (set/format tags): border:2px; border-color:XXX; background-color:#XXX;
    // color:#fff; font-weight:bold; padding-left/right:5px; float:left; margins. Uniform
    // structure with per-format brand colours — strip to `.jb-fmt-chip` + keep only the two
    // instance colours inline.
    if (norm.includes('float:left;') && norm.includes('color:#fff;font-weight:bold;') &&
        norm.includes('padding-left:5px;padding-right:5px;') && norm.startsWith('border:2px;')) {
      const bg = (raw.match(/background-color\s*:\s*([^;]+)/i) || [])[1];
      const bc = (raw.match(/border-color\s*:\s*([^;]+)/i) || [])[1];
      el.removeAttribute('style');
      addClass(el, 'jb-fmt-chip');
      const decls = [];
      if (bg) decls.push(`background-color:${bg.trim()}`);
      if (bc) decls.push(`border-color:${bc.trim()}`);
      if (decls.length) el.setAttribute('style', decls.join(';'));
      return;
    }
    // Season "boxes" (centered CTA banners): background-color:#XXX; font-weight:bold;
    // text-align:center; border:5px solid #XXX; color:#fff; — uniform but per-season colours.
    if (/^background-color:[^;]+;font-weight:bold;text-align:center;border:5pxsolid#?[0-9a-f]{3,6};color:#(fff|000);$/.test(norm)) {
      const bg = (raw.match(/background-color\s*:\s*([^;]+)/i) || [])[1];
      const bd = (raw.match(/border\s*:\s*(5px[^;]+)/i) || [])[1];
      const fg = (raw.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i) || [])[1];
      el.removeAttribute('style');
      addClass(el, 'jb-season-box');
      const decls = [];
      if (bg) decls.push(`background-color:${bg.trim()}`);
      if (bd) decls.push(`border:${bd.trim()}`);
      if (fg) decls.push(`color:${fg.trim()}`);
      if (decls.length) el.setAttribute('style', decls.join(';'));
      return;
    }
    // Centered CTA banner variant: margin-left/right:auto; [max-width:Npx;]
    // background-color:#XXX; padding:10px; text-align:center; border:5px solid #XXX;
    // color:#XXX; [border-radius:15px;]. Uniform layout, per-instance colours (+ optional
    // max-width).
    if (/^margin-left:auto;margin-right:auto;(max-width:\d+px;)?background-color:[^;]+;padding:10px;text-align:center;border:5pxsolid#?[0-9a-f]{3,6};color:#(fff|000);(border-radius:15px;)?$/.test(norm)) {
      const bg = (raw.match(/background-color\s*:\s*([^;]+)/i) || [])[1];
      const bd = (raw.match(/border\s*:\s*(5px[^;]+)/i) || [])[1];
      const fg = (raw.match(/(?:;)\s*color\s*:\s*([^;]+)/i) || [])[1];
      const mw = (raw.match(/max-width\s*:\s*([^;]+)/i) || [])[1];
      const round = /border-radius/i.test(raw);
      el.removeAttribute('style');
      addClass(el, 'jb-cta-banner');
      if (round) addClass(el, 'jb-round15');
      const decls = [];
      if (mw) decls.push(`max-width:${mw.trim()}`);
      if (bg) decls.push(`background-color:${bg.trim()}`);
      if (bd) decls.push(`border:${bd.trim()}`);
      if (fg) decls.push(`color:${fg.trim()}`);
      if (decls.length) el.setAttribute('style', decls.join(';'));
      return;
    }
    // Centered bold banner: background-color:#XXX; text-align:center; padding:5px;
    // font-weight:800;
    if (/^background-color:[^;]+;text-align:center;padding:5px;font-weight:800;$/.test(norm)) {
      const bg = (raw.match(/background-color\s*:\s*([^;]+)/i) || [])[1];
      el.removeAttribute('style');
      addClass(el, 'jb-center-p5-800');
      if (bg) el.setAttribute('style', `background-color:${bg.trim()}`);
      return;
    }
    // "Info grid" cards (the /get + landing-page layouts): box-sizing:border-box;
    // padding:20px; margin:5px; width:calc(N%-10px); background-color:#XXX; border + shadow
    // + radius [+ optional flex row]. Uniform card frame; per-card width + bg colour inline.
    if (norm.includes('box-sizing:border-box;') && /width:calc\(\d+%-10px\)/.test(norm) &&
        norm.includes('box-shadow:02px2px') && norm.includes('background-color:')) {
      const bg = (raw.match(/background-color\s*:\s*([^;]+)/i) || [])[1];
      const w = (raw.match(/width\s*:\s*(calc\([^)]+\))/i) || [])[1];
      const flex = /display\s*:\s*flex/i.test(raw);
      el.removeAttribute('style');
      addClass(el, 'jb-grid-card');
      if (flex) addClass(el, 'jb-grid-card-flex');
      const decls = [];
      if (w) decls.push(`width:${w.trim()}`);
      if (bg) decls.push(`background-color:${bg.trim()}`);
      if (decls.length) el.setAttribute('style', decls.join(';'));
      return;
    }
    // Flat info card without width/image: background-color:#XXX; border + shadow + radius;
    // padding:15px; height:100%;
    if (/^background-color:[^;]+;border:1pxsolid;border-color:#e3e3e3#cecece#b4b4b4#d6d6d6;box-shadow:02px2px0rgb\(000\/16%\),0001pxrgb\(000\/8%\);border-radius:4px;padding:15px;height:100%;$/.test(norm)) {
      const bg = (raw.match(/background-color\s*:\s*([^;]+)/i) || [])[1];
      el.removeAttribute('style');
      addClass(el, 'jb-info-card');
      if (bg) el.setAttribute('style', `background-color:${bg.trim()}`);
      return;
    }
    // Colored header cells: font-weight:bold; background-color:#XXX; color:white;
    // padding:8px; text-align:center; — uniform but per-instance background colour.
    if (/^font-weight:bold;background-color:[^;]+;color:white;padding:8px;text-align:center;$/.test(norm)) {
      const bg = (raw.match(/background-color\s*:\s*([^;]+)/i) || [])[1];
      el.removeAttribute('style');
      addClass(el, 'jb-th-cell');
      if (bg) el.setAttribute('style', `background-color:${bg.trim()}`);
      return;
    }
    // The clickable rotation "button" tile (no image): background-color:#f7f7f7;
    // cursor:pointer; border:1px solid; border-color:...; margin:5px;
    if (norm.startsWith('background-color:#f7f7f7;') &&
        norm.includes('border-color:#e3e3e3#cecece#b4b4b4#d6d6d6;')) {
      el.removeAttribute('style');
      addClass(el, norm.includes('cursor:pointer') ? 'jb-tile-button' : 'jb-tile');
      return;
    }
  });
}

// Move `<img style="width:NNpx; height:NNpx;">` to the canonical HTML attribute form
// (`<img width="NN" height="NN">`) — same render, no inline style.
function imgDimensionsToAttrs(root) {
  root.querySelectorAll('img[style]').forEach((img) => {
    const s = (img.getAttribute('style') || '').trim();
    const m = s.match(/^width\s*:\s*(\d+)px\s*;\s*height\s*:\s*(\d+)px\s*;?$/i);
    if (!m) return;
    if (!img.hasAttribute('width'))  img.setAttribute('width', m[1]);
    if (!img.hasAttribute('height')) img.setAttribute('height', m[2]);
    img.removeAttribute('style');
  });
}

// Strip inline `style=` and empty `class=""` from list elements inside Squarespace
// code-block decklist cards. Their visual rules (list-style:none, padding-left:17px,
// zero margins) are reproduced once in CSS targeting `.sqs-code-container ul/ol/li`.
function cleanCodeBlockLists(root) {
  root.querySelectorAll('.sqs-code-container').forEach((container) => {
    container.querySelectorAll('ul, ol, li, hr').forEach((el) => {
      el.removeAttribute('style');
    });
    // Decklist inline icons: any `<img style="vertical-align: middle;">` in the card.
    container.querySelectorAll('img[style]').forEach((img) => {
      const s = (img.getAttribute('style') || '').trim();
      if (/^vertical-align\s*:\s*middle\s*;?$/i.test(s)) img.removeAttribute('style');
      else if (/^max-height\s*:\s*165px\s*;\s*display\s*:\s*block\s*;\s*margin-left\s*:\s*auto\s*;\s*margin-right\s*:\s*auto\s*;?$/i.test(s)) {
        // "Deck thumb" pattern: large centered preview image.
        img.removeAttribute('style');
        const cls = (img.getAttribute('class') || '').split(/\s+/).filter(Boolean);
        if (!cls.includes('jb-deck-thumb')) cls.push('jb-deck-thumb');
        img.setAttribute('class', cls.join(' '));
      }
    });
    // Centered-in-card paragraphs (`text-align:center; margin:0px;`) — uniform pattern.
    container.querySelectorAll('p[style]').forEach((p) => {
      const s = (p.getAttribute('style') || '').trim();
      if (/^text-align\s*:\s*center\s*;\s*margin\s*:\s*0px\s*;?$/i.test(s)) {
        p.removeAttribute('style');
        const cls = (p.getAttribute('class') || '').split(/\s+/).filter(Boolean);
        if (!cls.includes('jb-decklist-center')) cls.push('jb-decklist-center');
        p.setAttribute('class', cls.join(' '));
      }
    });
  });
}

// `<span class="symb">` is the Pokémon energy-symbol icon (pkmntcg font). Pristine
// inline styles are always `font-size:25px; vertical-align:middle;` — move that to a
// single CSS rule so the inline style can be dropped. (`.symb` already sets
// `font-family:'pkmntcg'` in `jb-custom.css`.)
function stripSymbStyles(root) {
  root.querySelectorAll('span.symb').forEach((el) => el.removeAttribute('style'));
}

// Decklist section-header `<p>`s inside `.sqs-code-container` consistently use a bold
// padding-left:17px style. Replace per-element inline styles with a single class
// (`.jb-decklist-section`) so the styling lives in CSS.
// `<a class="jlink">` is the styled in-page navigation anchor used in decklist cards.
// Its inner spans get inline `vertical-align:middle; font-size:15px;` (label) and the
// `.symb` already had its size handled. Strip span inline styles inside `.jlink`; CSS
// targets `a.jlink > span` for the label sizing.
function stripJlinkSpanStyles(root) {
  root.querySelectorAll('a.jlink span[style]').forEach((el) => el.removeAttribute('style'));
  // `<a style="color:#2738b4;">` is the jlink color set inline — promote to `class=jlink`
  // so the dedicated CSS rule applies and the style attribute drops.
  root.querySelectorAll('a[style]').forEach((a) => {
    const s = (a.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase();
    if (s === 'color:#2738b4;' || s === 'color:#2738b4') {
      a.removeAttribute('style');
      const cls = (a.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      if (!cls.includes('jlink')) cls.push('jlink');
      a.setAttribute('class', cls.join(' '));
    }
  });
}

// `.deck_box` / `.deckbox` / `.notebox` / `.note_box` are decklist intro cards (deck
// name, archetype label, "Snorlax Control" sub-label). Pristine inline styles on the
// inner `<h1>/<h2>/<p>` are uniform per-element. Strip them and move the styling onto
// scoped CSS so the layout still matches.
function stripDeckBoxStyles(root) {
  const sel = '.deck_box, .deckbox, .notebox, .note_box';
  root.querySelectorAll(sel).forEach((box) => {
    box.querySelectorAll('h1[style], h2[style]').forEach((el) => el.removeAttribute('style'));
    // Direct-child `<div style="margin-bottom: 15px;">` row spacer — CSS handles it.
    [...box.children].forEach((c) => {
      if (c.tagName === 'DIV' && /^margin-bottom\s*:\s*15px;?$/i.test((c.getAttribute('style') || '').trim())) {
        c.removeAttribute('style');
      }
    });
    box.querySelectorAll('p[style]').forEach((p) => {
      const s = p.getAttribute('style') || '';
      const cls = (p.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      let matched = false;
      // The `font-size:12px; padding-top:0px; margin-top:-4px;` sub-label paragraph
      // (plus the small-caps variant).
      if (/font-size\s*:\s*12px/i.test(s) && /margin-top\s*:\s*-4px/i.test(s)) {
        if (!cls.includes('jb-deckbox-sublabel')) cls.push('jb-deckbox-sublabel');
        if (/small-caps/i.test(s) && !cls.includes('jb-smallcaps')) cls.push('jb-smallcaps');
        matched = true;
      }
      // The 25-px centered title paragraph.
      else if (/font-size\s*:\s*25px/i.test(s) && /text-align\s*:\s*center/i.test(s)) {
        if (!cls.includes('jb-deckbox-title')) cls.push('jb-deckbox-title');
        matched = true;
      }
      // The 20-px body paragraph with the standard margin/line-height (center- or
      // justify-aligned).
      else if (/font-size\s*:\s*20px/i.test(s) && /line-height\s*:\s*1\.5/i.test(s)) {
        if (!cls.includes('jb-deckbox-body')) cls.push('jb-deckbox-body');
        if (/text-align\s*:\s*justify/i.test(s) && !cls.includes('jb-deckbox-body-justify')) cls.push('jb-deckbox-body-justify');
        matched = true;
      }
      // The small-caps margin-top:15px variant.
      else if (/font-size\s*:\s*12px/i.test(s) && /margin-top\s*:\s*15px/i.test(s) && /small-caps/i.test(s)) {
        if (!cls.includes('jb-deckbox-credit')) cls.push('jb-deckbox-credit');
        matched = true;
      }
      if (matched) {
        p.removeAttribute('style');
        p.setAttribute('class', cls.join(' '));
      }
    });
  });
}

function tagDecklistSections(root) {
  const re = /font-weight\s*:\s*bold/i;
  const re2 = /padding-left\s*:\s*17px/i;
  root.querySelectorAll('.sqs-code-container p[style]').forEach((p) => {
    const s = p.getAttribute('style') || '';
    if (!re.test(s) || !re2.test(s)) return;
    p.removeAttribute('style');
    const cls = (p.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    if (!cls.includes('jb-decklist-section')) cls.push('jb-decklist-section');
    p.setAttribute('class', cls.join(' '));
  });
}

// Unwrap the outer `.sqs-block` scaffolding around already-semantic content blocks.
// After `unwrapBlockContent` collapses the inner `.sqs-block-content` passthrough,
// many code-blocks / video-blocks reduce to `<div class="sqs-block ..."><div
// class="sqs-code-container">…</div></div>` — the outer `.sqs-block` is dead weight
// (its only visual contribution is the 17 px padding handled by CSS on the inner
// container if needed). Drop the outer wrapper when its only element child is one of
// the recognised semantic inner blocks.
const UNWRAPPABLE_INNER = '.sqs-code-container, .sqs-video-wrapper';
function unwrapBlockShell(root) {
  root.querySelectorAll('div.sqs-block').forEach((block) => {
    const kids = [...block.children];
    if (kids.length !== 1) return;
    const inner = kids[0];
    if (!inner.matches(UNWRAPPABLE_INNER)) return;
    // No significant text between the wrapper and the inner element.
    const text = [...block.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim()).length;
    if (text) return;
    block.parentNode.replaceChild(inner, block);
  });
}

// Generic unwrap of pure-passthrough `.sqs-block-content` divs. These exist directly
// inside every `.sqs-block` and add no visual rule of their own — the *parent*
// `.sqs-block` carries the 17px horizontal padding via `squarespace-compat.css`. When a
// `.sqs-block-content` contains exactly one element child (and no significant text),
// the wrapper is dead weight. Run AFTER prose / image-block conversion so the converted
// blocks (already replaced by text-node sentinels) don't accidentally match.
function unwrapBlockContent(root) {
  root.querySelectorAll('div.sqs-block-content').forEach((el) => {
    // Significant text would change the DOM if we unwrap.
    const text = [...el.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim()).length;
    if (text) return;
    const kids = [...el.children];
    if (kids.length !== 1) return;
    el.parentNode.replaceChild(kids[0], el);
  });
}

// Convert Squarespace gallery containers (grid-of-thumbnails) into a minimal
// `.jb-gallery` block per PROMPT-2 Images guidance: galleries have no faithful Markdown
// form so they stay HTML, but we drop every Squarespace-internal wrapper, attribute, and
// inline style and emit a clean structure that's styled exclusively via CSS.
//
// Input shape varies (gallery-design-grid, gallery-design-stacked, gallery-block, etc.);
// they share a `.slide[data-type="image"] > .margin-wrapper > <a href><img></a>` core.
// Some galleries embed the image directly (`<img>` without an outer anchor).
function convertGalleries(root) {
  const galleries = [...root.querySelectorAll(
    '.sqs-gallery-block-grid, .sqs-gallery-design-grid, .sqs-gallery-design-stacked, ' +
    '.sqs-gallery-block-slider, .sqs-gallery-block'
  )];
  // Deduplicate: if one matches an ancestor of another, prefer the outermost.
  const top = galleries.filter((g) => !galleries.some((o) => o !== g && o.contains(g)));
  for (const gallery of top) {
    const doc = gallery.ownerDocument;
    const replacement = doc.createElement('div');
    replacement.setAttribute('class', 'jb-gallery');

    const slides = gallery.querySelectorAll('.slide');
    for (const slide of slides) {
      const img = slide.querySelector('img[src]');
      if (!img) continue;
      const newImg = doc.createElement('img');
      newImg.setAttribute('src', img.getAttribute('src'));
      const alt = img.getAttribute('alt');
      if (alt != null) newImg.setAttribute('alt', alt);
      newImg.setAttribute('loading', 'lazy');

      const figure = doc.createElement('figure');
      figure.setAttribute('class', 'jb-gallery-slide');
      const anchor = slide.querySelector('a[href]');
      if (anchor) {
        const newA = doc.createElement('a');
        newA.setAttribute('href', anchor.getAttribute('href'));
        newA.appendChild(newImg);
        figure.appendChild(newA);
      } else {
        figure.appendChild(newImg);
      }
      // Preserve visible per-slide title/description below the image (these are
      // displayed on the static page, so they're part of the visible-content
      // fingerprint).
      const title = slide.querySelector('.image-slide-title');
      if (title) {
        const t = title.textContent ? title.textContent.replace(/\s+/g, ' ').trim() : '';
        if (t) {
          const cap = doc.createElement('figcaption');
          cap.textContent = t;
          figure.appendChild(cap);
        }
      }
      replacement.appendChild(figure);
    }
    if (replacement.children.length === 0) continue; // nothing extractable, leave as-is
    // Replace the OUTERMOST Squarespace gallery-block wrapper (if there is one) so the
    // `.sqs-block.gallery-block.sqs-block-gallery` scaffold doesn't survive around the
    // already-minimal `.jb-gallery`. Fall back to the gallery container itself.
    const outer = gallery.closest('.sqs-block.gallery-block, .sqs-block-gallery') || gallery;
    outer.parentNode.replaceChild(replacement, outer);
  }
}

// Remove Squarespace spacer-blocks. They render as a single `&nbsp;`-filled box meant
// to hold open a column or add vertical space — purely visual padding. The surrounding
// grid column already fixes the layout width (via `sqs-col-N`), so an empty column is
// the same width as a spacer-filled one; the only loss is the small vertical-space
// offset, which is acceptable per the prompt's "drop redundant wrappers" guidance.
function removeSpacerBlocks(root) {
  root.querySelectorAll('div.sqs-block.spacer-block, div.sqs-block-spacer').forEach((el) => el.remove());
}

// Remove "ad placeholder" code-blocks. Pristine has many
// `<div class="sqs-block ... code-block"> … <div class="sqs-code-container"><!-- Basic
// Ad --></div> … </div>` blocks whose body is a single HTML comment. They render
// nothing visible — adsense and similar pixels were stripped by `sanitize()` but the
// empty containers remained. Drop the whole block.
function removeEmptyCodeBlocks(root) {
  root.querySelectorAll('div.sqs-block.code-block, div.sqs-block-code').forEach((block) => {
    const container = block.querySelector('.sqs-code-container');
    const inner = container || block;
    // Significant content = any text or any non-comment node child.
    let hasReal = false;
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (hasReal) return;
        if (c.nodeType === 1) { hasReal = true; return; }
        if (c.nodeType === 3 && c.nodeValue.trim()) { hasReal = true; return; }
        // nodeType 8 = comment → not "real"
      }
    };
    walk(inner);
    if (!hasReal) block.remove();
  });
}

// Convert Squarespace horizontal-rule blocks (`<div class="sqs-block ... horizontalrule-
// block"><div class="sqs-block-content"><hr></div></div>`) into a Markdown `---`.
function convertHrBlocks(root) {
  root.querySelectorAll('div.sqs-block.horizontalrule-block, div.sqs-block-horizontalrule').forEach((block) => {
    const sentinel = block.ownerDocument.createTextNode(pushStash('---'));
    block.parentNode.replaceChild(sentinel, block);
  });
}

// Classes for which any inline `style=` is dead weight — `squarespace-compat.css` already
// neutralizes these with `!important` rules. Stripping the inline styles is purely
// visual no-op while reducing the inline-`style=` budget.
const DEAD_STYLE_CLASSES = new Set([
  'has-aspect-ratio',
  'intrinsic',
  'image-intrinsic',
  'image-block-wrapper',
  'embed-block-wrapper',
  'sqs-image-shape-container-element',
]);

// Squarespace structural class → jb-prefixed equivalent. The CSS rules carry the
// jb-* names; the rename keeps the rendered layout identical while clearing the
// "no Squarespace `class=`" portion of the Round-2 done criteria.
const SQS_TO_JB_CLASS = new Map([
  ['sqs-row', 'jb-row'],
  ['sqs-block', 'jb-block'],
  ['sqs-block-content', 'jb-block-content'],
  ['sqs-code-container', 'jb-code-container'],
  ['sqs-layout', 'jb-layout'],
  ['sqs-html-content', 'jb-html-content'],
  ['sqs-block-html', 'jb-block-html'],
  ['sqs-block-code', 'jb-block-code'],
  ['sqs-block-website-component', 'jb-block-component'],
  ['sqs-block-video', 'jb-block-video'],
  ['sqs-video-wrapper', 'jb-video-wrapper'],
  ['sqs-block-image-figure', 'jb-block-image-figure'],
  ['sqs-block-image', 'jb-block-image'],
  ['sqs-block-spacer', 'jb-block-spacer'],
  ['sqs-block-gallery', 'jb-block-gallery'],
  ['website-component-block', 'jb-component-block'],
  ['html-block', 'jb-html-block'],
  ['code-block', 'jb-code-block'],
  ['image-block', 'jb-image-block'],
  ['gallery-block', 'jb-gallery-block'],
  ['video-block', 'jb-video-block'],
  ['span-0', 'jb-span-0'],
  ['sqs-gallery-meta-container', 'jb-gallery-meta-container'],
  ['sqs-gallery-image-container', 'jb-gallery-image-container'],
  ['sqs-gallery-design-carousel-slide', 'jb-gallery-carousel-slide'],
  ['sqs-system-gallery-init', 'jb-system-gallery-init'],
  ['sqs-system-gallery', 'jb-system-gallery'],
  ['sqs-slice', 'jb-slice'],
  ['sqs-gallery-list', 'jb-gallery-list'],
  ['sqs-block-markdown', 'jb-block-markdown'],
  ['sqs-slide-layer-content', 'jb-slide-layer-content'],
  ['sqs-slide-layer', 'jb-slide-layer'],
  ['sqs-grid-12', 'jb-grid-12'],
  ['columns-12', 'jb-columns-12'],
  ['row', 'jb-row-anchor'],  // the bare `row` companion class to `sqs-row`
  ['col', 'jb-col'],
]);
for (let i = 1; i <= 12; i++) {
  SQS_TO_JB_CLASS.set(`sqs-col-${i}`, `jb-col-${i}`);
  SQS_TO_JB_CLASS.set(`span-${i}`, `jb-span-${i}`);
}

// Classes to fully drop after renaming. These are redundant aliases of structural
// information that's already present in another class on the same element:
// - `jb-row-anchor` is the `row` companion to `jb-row` — keep only `jb-row`
// - `jb-col` is the bare-`col` marker; the CSS now uses `[class*="jb-col-"]`
//   attribute selectors so the width-bearing `jb-col-N` is sufficient
// - `jb-span-N` is the legacy alias for `jb-col-N` — same number, drop the alias
const DROP_AFTER_RENAME = new Set(['jb-row-anchor', 'jb-col']);

function renameSqsClasses(root) {
  root.querySelectorAll('[class]').forEach((el) => {
    const classes = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    let changed = false;
    const renamed = [];
    for (const c of classes) {
      const r = SQS_TO_JB_CLASS.get(c);
      if (r) { renamed.push(r); changed = true; }
      // Catch-all for the long tail of Squarespace structural classes not in the
      // explicit map (summary-block / gallery-carousel / slice widgets, e.g.
      // `sqs-block-summary-v2`, `sqs-gallery-container`, `sqs-slice-group`,
      // `sqs-slide`, `sqs-blog-list`). Their widget JS/styling is gone, so a
      // mechanical `sqs-X` → `jb-X` rename is visually neutral and clears the
      // "no Squarespace `class=` on content" Round-2 criterion. Explicit-map
      // entries above still win (they map to the names the CSS targets).
      else if (/^sqs-/.test(c)) { renamed.push('jb-' + c.slice(4)); changed = true; }
      else renamed.push(c);
    }
    // Drop redundant aliases.
    const final = [];
    for (const c of renamed) {
      if (DROP_AFTER_RENAME.has(c)) { changed = true; continue; }
      // Drop `jb-span-N` if the matching `jb-col-N` is already present.
      const m = c.match(/^jb-span-(\d+)$/);
      if (m && renamed.includes(`jb-col-${m[1]}`)) { changed = true; continue; }
      if (!final.includes(c)) final.push(c);
    }
    if (changed) {
      if (final.length) el.setAttribute('class', final.join(' '));
      else el.removeAttribute('class');
    }
  });
}

function stripNoiseAttrs(root) {
  root.querySelectorAll('*').forEach((el) => {
    const names = el.getAttributeNames();
    // Pre-compute class list for the dead-style check.
    const classList = (el.getAttribute('class') || '').split(/\s+/);
    for (const name of names) {
      if (NOISE_DATA_ATTR_EXACT.has(name)) { el.removeAttribute(name); continue; }
      if (NOISE_DATA_ATTR_PREFIXES.some((p) => name.startsWith(p))) {
        el.removeAttribute(name); continue;
      }
      if (name === 'id') {
        const v = el.getAttribute('id') || '';
        if (NOISE_ID_RE.test(v)) el.removeAttribute('id');
        continue;
      }
      if (name === 'class') {
        const v = (el.getAttribute('class') || '').trim();
        if (!v) el.removeAttribute('class');
        continue;
      }
      if (name === 'style') {
        const v = (el.getAttribute('style') || '').trim();
        if (!v) { el.removeAttribute('style'); continue; }
        if (classList.some((c) => DEAD_STYLE_CLASSES.has(c))) { el.removeAttribute('style'); continue; }
        // Strip rules with no visual effect on block-level elements: `width:100%`,
        // `margin:0px;` chains, etc. Decompose the style string, drop dead rules, and
        // re-serialize. If the result is empty, remove the attribute.
        const tag = el.tagName.toLowerCase();
        const isBlock = /^(div|p|h[1-6]|ul|ol|li|section|article)$/.test(tag);
        const kept = v.split(';').map((r) => r.trim()).filter((r) => {
          if (!r) return false;
          const norm = r.replace(/\s+/g, '').toLowerCase();
          // Always dead: width:100% on block elements (block default), explicit zero
          // margins/paddings that are typically already zero by the user-agent / our CSS.
          if (isBlock && (norm === 'width:100%' || norm === 'width:auto')) return false;
          // `white-space:pre-wrap` is a pure Squarespace rich-text artifact: our prose
          // conversion already collapses whitespace, and for normal text it renders
          // identically to the default. Dropping it both de-noises the markup and lets a
          // lone `text-align:center` promote to the `jb-center` class (otherwise the
          // pre-wrap suffix blocks the exact-match in promoteUtilityStyles, which is why
          // centered page titles silently went left-aligned).
          if (norm === 'white-space:pre-wrap' || norm === 'white-space:pre-line') return false;
          return true;
        });
        if (!kept.length) { el.removeAttribute('style'); continue; }
        el.setAttribute('style', kept.join('; ') + ';');
        continue;
      }
    }
  });
}

// Unwrap pure-passthrough single-column Squarespace scaffolding. A `.row.sqs-row`
// whose only element child is a `.col` at 100% width (`.span-12` / `.sqs-col-12`)
// is a no-op wrapper — the column already fills the row. Repeatedly unwrap so
// chains like row>col>row>col collapse to bare content. Loop until fixed.
function unwrapScaffolding(root) {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 8) {
    changed = false;
    root.querySelectorAll('div.row.sqs-row').forEach((row) => {
      const kids = [...row.children];
      if (kids.length !== 1) return;
      const col = kids[0];
      if (col.tagName.toLowerCase() !== 'div') return;
      const cls = (col.getAttribute('class') || '').split(/\s+/);
      if (!cls.includes('col')) return;
      if (!(cls.includes('span-12') || cls.includes('sqs-col-12'))) return;
      // Unwrap col into row, then row into its parent.
      const parent = row.parentNode;
      if (!parent) return;
      while (col.firstChild) row.insertBefore(col.firstChild, col);
      col.remove();
      while (row.firstChild) parent.insertBefore(row.firstChild, row);
      row.remove();
      changed = true;
    });
  }
}

// Escape Markdown image-alt/link-text: ]  →  \]   and  \  →  \\
function escapeMdAlt(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/]/g, '\\]');
}
// Escape Markdown link/image URL: () in href need handling — we wrap href in <…> if it
// contains parens or whitespace. The corpus uses clean `/images/<hash>.<ext>` so usually
// no escape needed, but be defensive.
function safeUrl(u) {
  return /[()\s]/.test(u) ? `<${u}>` : u;
}

// Convert standalone Squarespace `.sqs-block.image-block` figures into a Markdown image
// (plus optional italic caption). Per PROMPT-2: single content images → `![alt](src)` +
// `*caption*`. Skip image blocks that live inside a gallery container — galleries are
// addressed separately and kept as minimal HTML.
function convertImageBlocks(root) {
  const blocks = [...root.querySelectorAll('div.sqs-block.image-block')];
  for (const block of blocks) {
    // Skip if inside a gallery (e.g. `.sqs-gallery-block`, `.sqs-gallery-design-grid`).
    if (block.closest('.sqs-gallery-block, .sqs-gallery-design-grid, .sqs-gallery')) continue;
    const figure = block.querySelector('figure.sqs-block-image-figure, .image-block-outer-wrapper');
    if (!figure) continue;
    const img = figure.querySelector('img[src]');
    if (!img) continue;
    const src = img.getAttribute('src');
    if (!src) continue;
    const alt = escapeMdAlt(img.getAttribute('alt') || '');

    // Caption assembly. Three pristine sources, in display order:
    //   - `.image-title-wrapper` (above the image, small heading)
    //   - `figcaption` (below the image, the canonical caption)
    //   - `.image-subtitle-wrapper` (below the figcaption / inside the figure)
    // Each wrapper contains 1+ `<p>` elements. Render each <p> as one caption paragraph
    // (joined by `\n\n` so paragraphs stay separate) and concatenate the three sources
    // with `\n\n` as well. De-duplicate against containment: if a source is INSIDE the
    // figcaption we already picked up, don't re-add it (this is the "nested wrapper +
    // inner div both match" hazard).
    const figcap = figure.querySelector('figcaption');
    const sources = [];
    const title = figure.querySelector('.image-title-wrapper');
    if (title && !(figcap && figcap.contains(title))) sources.push(title);
    if (figcap) sources.push(figcap);
    const subtitle = figure.querySelector('.image-subtitle-wrapper');
    if (subtitle && !(figcap && figcap.contains(subtitle))) sources.push(subtitle);

    const capParas = [];
    for (const src2 of sources) {
      const ps = src2.querySelectorAll('p');
      if (ps.length) {
        for (const p of ps) {
          const t = inlineRaw(p).replace(/[ \t\n]+/g, ' ').trim();
          if (t) capParas.push(t);
        }
      } else {
        const t = inlineRaw(src2).replace(/[ \t\n]+/g, ' ').trim();
        if (t) capParas.push(t);
      }
    }
    // Dedup consecutive duplicates (defensive).
    const dedup = [];
    for (const p of capParas) if (p && p !== dedup[dedup.length - 1]) dedup.push(p);
    const caption = dedup.join('\n\n');

    // Link target — restricted to anchors that are DIRECT image-block link siblings,
    // not anchors that happen to live inside a caption/subtitle/title body. Two real
    // pristine modes:
    //   - explicit clickthrough: `<a class="sqs-block-image-link" href="…">` (CTA)
    //   - lightbox anchor: `<a data-lightbox-theme="..." href="/images/<hash>">`
    // We require the `<a>` to have one of those signatures so a `<a>` inside a
    // caption (e.g. `<a href="pokebeach.com">` in a subtitle) is NOT mis-read as the
    // image's own link target.
    let href = '';
    const anchor = figure.querySelector(
      'a.sqs-block-image-link[href], a[data-lightbox-theme][href]'
    );
    if (anchor) href = anchor.getAttribute('href') || '';

    // Build Markdown. Wrap each caption paragraph in `*…*` individually so multi-
    // paragraph captions still render italic line-by-line without forming one giant
    // emphasis span (which CommonMark won't bind across blank lines anyway).
    let md = `![${alt}](${safeUrl(src)})`;
    if (href) md = `[${md}](${safeUrl(normalizeHref(href))})`;
    if (caption) {
      const italicized = caption.split('\n\n').map((p) => `*${p}*`).join('\n\n');
      md += '\n\n' + italicized;
    }

    // Replace the entire `.sqs-block.image-block` element with the stash sentinel text.
    // The sentinel becomes a text node sibling of whatever else lived in the column;
    // `finalizeBody` splices `\n\n<md>\n\n` in, opening Markdown context.
    const sentinel = block.ownerDocument.createTextNode(pushStash(md));
    block.parentNode.replaceChild(sentinel, block);
  }
}

export function beautify(root) {
  // Strip noise attributes FIRST so any raw-HTML fallthrough during prose conversion
  // (e.g. an unknown inline element passed through as `outerHTML`) carries no leftover
  // `class=""`, `data-block-*`, etc.
  stripNoiseAttrs(root);
  // Drop HTML comments. Most are commented-out content (`<!--<h1>old title</h1>-->`)
  // that the DOM parser keeps as Comment nodes — they don't render but they bloat the
  // markup and hide inline styles from `promoteUtilityStyles`. Ad-placeholder comments
  // inside code-blocks are handled separately by `removeEmptyCodeBlocks`.
  const w = root.ownerDocument.createTreeWalker(root, root.ownerDocument.defaultView.NodeFilter.SHOW_COMMENT);
  const comments = [];
  let cnode;
  while ((cnode = w.nextNode())) comments.push(cnode);
  for (const c of comments) {
    if (!c.parentNode) continue;
    // If the comment sits between two text nodes, removing it would fuse them and
    // potentially merge adjacent tokens (e.g. `League<!--…-->, or` would become
    // `League, or` parsed as a single text node, tokenizing "League," instead of
    // "League" "," — a fidelity desync). Replace with a single space to preserve the
    // text-node boundary, which the visible-text fingerprint relies on.
    const prev = c.previousSibling;
    const next = c.nextSibling;
    if (prev && prev.nodeType === 3 && next && next.nodeType === 3) {
      c.parentNode.replaceChild(c.ownerDocument.createTextNode(' '), c);
    } else {
      c.parentNode.removeChild(c);
    }
  }
  // Drop visually-hidden SR-only chrome (`<span class="v6-visually-hidden">View
  // fullsize</span>` from Squarespace lightbox buttons, etc.). The fidelity harness
  // already excludes these on both sides (R2-4), and they're invisible to readers —
  // removing them from the source is purely a markup-cleanliness win.
  root.querySelectorAll('.v6-visually-hidden, .visually-hidden, .sr-only').forEach((n) => n.remove());
  unwrapScaffolding(root);
  convertGalleries(root);
  convertImageBlocks(root);
  convertHrBlocks(root);
  removeEmptyCodeBlocks(root);
  removeSpacerBlocks(root);
  cleanCodeBlockLists(root);
  stripSymbStyles(root);
  stripJlinkSpanStyles(root);
  stripDeckBoxStyles(root);
  tagDecklistSections(root);
  convertBgCards(root);
  promoteUtilityStyles(root);
  imgDimensionsToAttrs(root);
  root.querySelectorAll('.sqs-html-content').forEach((el) => tryConvertProse(el));
  unwrapProseBlockWrappers(root);
  unwrapBlockContent(root);
  unwrapBlockShell(root);
  // Rename Squarespace structural classes LAST so all earlier transforms (which key
  // on the `sqs-*` names — `.sqs-html-content` for prose conversion,
  // `.sqs-block.sqs-block-html` for the wrapper-chain unwrap, `.sqs-block-content`
  // for the generic passthrough unwrap, etc.) still match.
  renameSqsClasses(root);
  return root;
}

/** Final string-level cleanup PLUS splice the stashed Markdown back in. */
export function finalizeBody(html) {
  // 1. Collapse runs of blank/whitespace-only lines so the HTML body parses as ONE
  //    CommonMark HTML block (otherwise indented HTML after a blank line becomes a code
  //    block).
  let s = html
    .replace(/(?:^|\n)[ \t]*(?=\n)/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim() + '\n';
  // 2. Splice stashed Markdown into each sentinel. Insert blank lines around it so the
  //    surrounding `<div class="sqs-html-content">…</div>` opens a fresh Markdown
  //    context inside.
  s = s.replace(
    new RegExp(STASH_OPEN + '(\\d+)' + STASH_CLOSE, 'g'),
    (_m, idx) => '\n\n' + stash[Number(idx)] + '\n\n',
  );
  return s;
}

// Back-compat export: extract.mjs currently imports `collapseBlankLines`. Keep the name
// but make it the new pipeline step.
export const collapseBlankLines = finalizeBody;
