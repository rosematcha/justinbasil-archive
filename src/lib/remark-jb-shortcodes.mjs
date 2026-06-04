// remark-jb-shortcodes — compact, editor-friendly shortcodes that compile to the
// same HTML/CSS hooks the legacy hand-written blocks used. Authored as markdown
// directives (`:::deck`, `:::gallery`, `:::note`, `:::box`) plus a fenced
// ```decklist code block. Runs AFTER remark-directive in astro.config.mjs.
//
// Output strategy: we emit raw `html` mdast nodes for the wrapper chrome and keep
// the directive's markdown children inline between them, exactly like the legacy
// bodies interleave `<div>`…</div>` around real markdown. Astro's pipeline already
// stitches that (the preserved Squarespace HTML relies on the same behavior).
import { visit, SKIP } from 'unist-util-visit';
import { toString as mdToString } from 'mdast-util-to-string';

// type= attribute → single-letter energy-type class on the name (renders a TCG type
// symbol via CSS ::before). g/r/w/l/p/f/d/m/y/n/c (Grass/Fire/Water/Lightning/…).
const TYPE_CLASSES = new Set(['g', 'r', 'w', 'l', 'p', 'f', 'd', 'm', 'y', 'n', 'c']);

// comp= attribute → the CSS class that renders the "Competitive Potential" bar.
const COMP_CLASS = {
  none: 'compnone',
  meme: 'compm',
  casual: 'comp0',
  low: 'comp1',
  moderate: 'comp2',
  high: 'comp3',
  tbd: 'compu',
};

// box color= attribute → `.box_<color>` class. Accepts the human names defined in
// jb-custom.css (aliases collapse the underscore variants).
const BOX_COLORS = new Set([
  'red', 'orange', 'yellow', 'yellowgreen', 'yellow_green', 'green', 'darkgreen',
  'dark_green', 'blue', 'purple', 'teal', 'violet', 'lavender', 'brown',
  'burntbrown', 'burnt_brown', 'lah', 'jibx', 'darkgrey', 'dark_grey', 'grey',
]);

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const htmlNode = (value) => ({ type: 'html', value });

// Parse a raw deck-export blob into the `.jb-decklist-section` + `<ul><li>` markup.
// Rule: a line that starts with a number+space is a card → <li>; anything else is
// a section header → <p class="jb-decklist-section">. Card text is preserved
// verbatim (incl. set codes and `{*}` markers).
export function parseDecklist(raw) {
  const lines = String(raw)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let out = '<div class="jb-code-container">';
  let inList = false;
  for (const line of lines) {
    if (/^\d+\s/.test(line)) {
      if (!inList) {
        out += '<ul>';
        inList = true;
      }
      out += `<li>${escapeHtml(line)}</li>`;
    } else {
      if (inList) {
        out += '</ul>';
        inList = false;
      }
      out += `<p class="jb-decklist-section">${escapeHtml(line)}</p>`;
    }
  }
  if (inList) out += '</ul>';
  out += '</div>';
  return out;
}

// `path "optional caption"` → one gallery figure. Quote-agnostic: Astro's built-in
// smartypants runs before this plugin and curls straight quotes (" → “ ”), so we
// split on the first whitespace and strip any surrounding quote char from the caption.
function galleryFigure(item) {
  const trimmed = String(item).trim();
  if (!trimmed) return '';
  const sp = trimmed.search(/\s/);
  const src = sp === -1 ? trimmed : trimmed.slice(0, sp);
  const caption =
    sp === -1
      ? ''
      : trimmed
          .slice(sp + 1)
          .trim()
          .replace(/^["“”'‘’]+|["“”'‘’]+$/g, '')
          .trim();
  const alt = caption ? escapeHtml(caption) : '';
  const fig =
    `<figure class="jb-gallery-slide"><a href="${escapeHtml(src)}">` +
    `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" /></a>` +
    (caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '') +
    `</figure>`;
  return fig;
}

// Pull list-item strings out of a directive body (the gallery's markdown list).
function listItemStrings(node) {
  const items = [];
  for (const child of node.children || []) {
    if (child.type === 'list') {
      for (const li of child.children || []) {
        items.push(mdToString(li).trim());
      }
    }
  }
  return items;
}

function buildDeck(node) {
  const a = node.attributes || {};
  const name = a.name || mdToString(node).split('\n')[0] || 'Deck';
  const id = a.id || slug(name);
  const comp = a.comp && COMP_CLASS[a.comp] ? COMP_CLASS[a.comp] : null;

  // Header (deck_box): optional price, name, optional free-text sublabel (older
  // "Competitive Potential: …" / "Featuring …" lines), optional rating bar.
  let header = `<div class="jb-code-container"><div id="${escapeHtml(id)}" class="deck_box">`;
  if (a.price) header += `<p class="jb-deckbox-title">${escapeHtml(a.price)}</p>`;
  const type = a.type && TYPE_CLASSES.has(a.type) ? ` class="${a.type}"` : '';
  header += `<h2${type}>${escapeHtml(name)}</h2>`;
  if (a.sublabel) header += `<p class="jb-deckbox-sublabel">${escapeHtml(a.sublabel)}</p>`;
  if (comp) header += `<div class="${comp}"><span></span></div>`;
  header += `</div></div>`;

  // Left column opens with the thumbnail + illustrator credit (from attributes),
  // then the directive's markdown body (strategy / key cards / etc.).
  let leftOpen = `${header}<div class="jb-row"><div class="jb-col-6">`;
  if (a.image)
    leftOpen += `<img src="${escapeHtml(a.image)}" alt="" loading="lazy" />`;
  if (a.illus) leftOpen += `<p><em>Illus. ${escapeHtml(a.illus)}</em></p>`;

  // Split body at the decklist fence: children before it → left column; the decklist
  // and anything after it → right column (so trailing sections like "Alternate Lists"
  // or "Testing Streams" stay beside the list, as in the legacy two-column layout).
  const children = node.children || [];
  const idx = children.findIndex((c) => c.type === 'code' && c.lang === 'decklist');
  const left = idx === -1 ? children : children.slice(0, idx);
  const trailing = idx === -1 ? [] : children.slice(idx + 1);
  const decklistHtml = idx === -1 ? '' : parseDecklist(children[idx].value);

  let rightOpen = `</div><div class="jb-col-6">`;
  if (a.source) rightOpen += `<p>Source: ${escapeHtml(a.source)}</p>`;

  return [
    htmlNode(leftOpen),
    ...left,
    htmlNode(rightOpen + decklistHtml),
    ...trailing,
    htmlNode(`</div></div>`),
  ];
}

function buildNote(node) {
  const a = node.attributes || {};
  let open = `<div class="jb-code-container"><div class="note_box">`;
  if (a.title) open += `<h3>${escapeHtml(a.title)}</h3>`;
  return [htmlNode(open), ...(node.children || []), htmlNode(`</div></div>`)];
}

function buildBox(node) {
  const a = node.attributes || {};
  const color = a.color && BOX_COLORS.has(a.color) ? `box_${a.color}` : '';
  const rounded = a.round !== undefined ? ' rbox' : '';
  const classes = `box${rounded}${color ? ' ' + color : ''}`;
  let open = '';
  if (a.href) open += `<a href="${escapeHtml(a.href)}">`;
  open += `<div class="${classes}">`;
  if (a.title) open += `<p class="box_title">${escapeHtml(a.title)}</p>`;
  const close = `</div>${a.href ? '</a>' : ''}`;
  return [htmlNode(open), ...(node.children || []), htmlNode(close)];
}

function buildGallery(node) {
  const figures = listItemStrings(node).map(galleryFigure).join('');
  return [htmlNode(`<div class="jb-gallery">${figures}</div>`)];
}

// Tournament results: an event header (deck_box) + a row of placement columns.
// The body is a flat list of headings ("1st Place — Player / Deck") each followed by
// a ```decklist fence; every heading starts a new `jb-col-3` column.
function buildResults(node) {
  const a = node.attributes || {};
  const event = a.event || 'Results';
  const id = a.id || slug(event);
  let header = `<div class="jb-code-container"><div id="${escapeHtml(id)}" class="deck_box"><h2>${escapeHtml(event)}</h2>`;
  if (a.meta) header += `<p class="jb-deckbox-sublabel">${escapeHtml(a.meta)}</p>`;
  header += `</div></div><div class="jb-row">`;

  // Partition body children into columns at each heading.
  const cols = [];
  for (const child of node.children || []) {
    if (child.type === 'heading') cols.push({ label: mdToString(child), nodes: [] });
    else if (cols.length) cols[cols.length - 1].nodes.push(child);
  }

  const out = [htmlNode(header)];
  for (const col of cols) {
    // "1st Place — Player / Deck" → bold rank + line break + who. Split on the first
    // em/en dash only (NOT a hyphen, which appears inside "Player - Deck").
    const m = col.label.match(/^(.*?)\s[—–]\s([\s\S]*)$/);
    const rank = m ? m[1].trim() : col.label.trim();
    const who = m ? m[2].trim() : '';
    let colHtml = `<div class="jb-col-3"><p class="jb-center"><strong>${escapeHtml(rank)}</strong>`;
    if (who) colHtml += `<br />${escapeHtml(who)}`;
    colHtml += `</p>`;
    const rest = [];
    for (const n of col.nodes) {
      if (n.type === 'code' && n.lang === 'decklist') colHtml += parseDecklist(n.value);
      else rest.push(n);
    }
    out.push(htmlNode(colHtml), ...rest, htmlNode(`</div>`));
  }
  out.push(htmlNode(`</div>`));
  return out;
}

// Set-page hero header: the repeated jb-set-card boilerplate becomes attributes; the
// body (description + the per-page nav links) is kept as authored. We don't try to
// reduce the nav links — they vary per set and carry the `.blink` styling.
function buildSetcard(node) {
  const a = node.attributes || {};
  let h = `<div class="jb-code-container"><div class="jb-set-card"`;
  if (a.bg) h += ` style="background-image:url(${a.bg})"`;
  h += `><div>`;
  if (a.logo) h += `<img src="${escapeHtml(a.logo)}" loading="lazy" class="jb-deck-thumb" />`;
  if (a.identifier)
    h += `<img alt="${escapeHtml(a.idalt || '')}" src="${escapeHtml(a.identifier)}" loading="lazy" class="jb-icon-center-mt15" />`;
  h += `<h1 class="jb-white-center-margin5">${escapeHtml(a.title || '')}</h1>`;
  if (a.subtitle) h += `<h3 class="jb-smallcaps-center">${escapeHtml(a.subtitle)}</h3>`;
  h += `<hr />`;
  return [htmlNode(h), ...(node.children || []), htmlNode(`</div></div></div>`)];
}

const CONTAINERS = {
  deck: buildDeck,
  note: buildNote,
  box: buildBox,
  gallery: buildGallery,
  results: buildResults,
  setcard: buildSetcard,
};

export default function remarkJbShortcodes() {
  return (tree) => {
    // Container directives (deck/note/box/gallery). Return `index` (not SKIP) so the
    // visitor descends back into the spliced-in nodes — a deck/note/box can contain a
    // nested directive (e.g. a `:::gallery` of card images inside a `::::deck`), and
    // that inner directive must still be transformed. Replacements are raw `html`
    // nodes plus pass-through children, so nothing re-matches into a loop.
    visit(tree, 'containerDirective', (node, index, parent) => {
      const build = CONTAINERS[node.name];
      if (!build || !parent || index == null) return;
      const replacement = build(node);
      parent.children.splice(index, 1, ...replacement);
      return index;
    });

    // Standalone ```decklist fences (not consumed by a deck above).
    visit(tree, 'code', (node, index, parent) => {
      if (node.lang !== 'decklist' || !parent || index == null) return;
      parent.children.splice(index, 1, htmlNode(parseDecklist(node.value)));
      return [SKIP, index + 1];
    });
  };
}
