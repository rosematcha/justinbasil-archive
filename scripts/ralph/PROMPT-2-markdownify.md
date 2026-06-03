# Ralph Loop (Round 2): Maximize Markdown compliance, move styling into CSS

Round 1 converted prose to Markdown but, to stay pixel-perfect, **kept all the Squarespace
HTML scaffolding** — so the bodies are still ~95k `<div>`, ~14k `<img>`, ~17k `<li>`,
~13k `<td>`, ~94k `class=`, ~15k inline `style=`. That is the problem to fix now.

**Goal this round:** make the content bodies as close to *standard, idiomatic Markdown* as
possible, and **migrate the styling that the stripped HTML used to carry into the site's
CSS**, so the rendered pages still match the original justinbasil.com look. There is no
reason to ship `<strong>` when `**bold**` compiles to the same `<strong>` the CSS already
styles — and the same logic extends to lists, links, images, tables, rules, and quotes.

Read this whole prompt every iteration. Do the single most valuable next step toward the
done criteria, verify it, update the ledger, and stop. The loop re-feeds this prompt; you
will see your own prior work in the files, git, and the ledger.

> **This round explicitly REVERSES Round 1's guardrail** ("visual fidelity wins every tie;
> never strip layout wrappers"). Now: **Markdown compliance wins ties; strip the HTML and
> reproduce its styling in CSS.** Preserve the *rendered look*, not the *HTML structure*.

---

## The one rule you must never break

**DO NOT COMMIT / `git add` / `git push`.** The maintainer reviews the full diff and makes a
single bulk commit at the end. Leave the working tree clean and uncommitted. (Read-only git
is fine: `git status`, `git diff`, `git show HEAD:<path>`.)

---

## What already exists (build on it, don't rebuild)

- **Pipeline:** `_corpus/*.html` → `scripts/lib/extract.mjs` (`extractPage`) +
  `scripts/lib/beautify.mjs` → `src/content/<collection>/<slug>.md`. Orchestrated by
  `scripts/convert.mjs`. **Improve the transform and regenerate — never hand-edit the
  generated `.md` bodies** (hand-edits are wiped on the next `convert` run, and the 17
  translation files are ~29k lines each).
  - Regenerate fast, offline: `node scripts/convert.mjs --no-images <slug-substrings…>`
- **Rendering:** `src/components/RenderedEntry.astro` already uses
  `const { Content } = await render(entry)` → `<Content />`. Bodies are `.md`, compiled by
  Astro's standard Markdown pipeline (remark/rehype, **GFM on**), which compiles Markdown
  and passes embedded raw HTML through. The prose is wrapped in `<div class="sqs-content">`.
- **Stylesheets:** `src/styles/global.css` (design tokens), `jb-custom.css`, and
  `squarespace-compat.css` (currently targets `.sqs-row/.col/.span-N/.sqs-block/…`). **You
  will edit these** — as you remove a wrapper/inline-style, move whatever visual rule it
  carried onto the compiled Markdown output (e.g. style `.sqs-content img`, `.sqs-content
  table`, a new semantic class) so the look survives.
- **Fidelity harness:** `scripts/lib/fidelity.mjs` + `_corpus/fidelity-baseline.json`. The
  baseline is a *content signature* per page (ordered visible text, headings, `img src`,
  `(href,text)` links, table-cell text) captured from pristine output. It is
  **structure/attribute-agnostic**, so it stays valid even as you change the DOM from HTML
  to Markdown — it proves you didn't drop or reorder content. Do **not** recapture or weaken
  it. `node scripts/lib/fidelity.mjs check [collection]` must report zero meaningful diffs.
- **Ledger:** `scripts/ralph/PROGRESS.md`. Add a `## Round 2: Markdown compliance` section
  (reset all in-scope collections to `pending` for this round) and keep it current.

---

## Scope

In scope (same 332 files): `guide resources new-decks pages league rotation highlights
set-lists visual proxies translations`. **`videos/` stays out of scope.** Don't let
`convert.mjs` rewrite videos — use slug filters or confirm your changes are a no-op on a
sample video.

---

## What "Markdown compliance" means here (the conversion targets)

Convert every construct that has an idiomatic Markdown form. After this round, the prose
collections should contain **essentially no** HTML for these — they should be Markdown:

| HTML now | Convert to |
|---|---|
| `<h1>`–`<h6>` | `#`…`######` |
| `<p>` | blank-line-separated paragraphs |
| `<strong>`/`<b>` | `**bold**` |
| `<em>`/`<i>` | `*italic*` |
| `<a href>` | `[text](href)` |
| `<ul><li>` / `<ol><li>` | `- item` / `1. item` |
| `<hr>` | `---` |
| `<blockquote>` | `> quote` |
| genuine data `<table><tr><td>` | GFM pipe tables |
| standalone content `<img>`/`<figure>` | `![alt](src)` (see Images) |
| `<span>` with no semantic purpose | unwrap to plain text; push any real styling to CSS |
| redundant wrappers: `div.sqs-row > .col-12.span-12`, `.sqs-block`, `.sqs-block-content`, `.sqs-html-content`, `.sqs-code-container` that wrap a single column of content | remove; reproduce any needed spacing/width on the `.sqs-content` prose container in CSS |

**Inline `style=` and Squarespace `class=` are not allowed to survive on converted
content.** When a rule is purely presentational, drop it. When it carries real visual intent
(centering, max-width, a card's background image, brand color), move it into a **named CSS
class** in a stylesheet and, if needed, apply that class to a minimal HTML wrapper — never an
inline style.

### Images — review each pattern individually (per the maintainer)

Inspect the actual image structures and convert by type, preserving the original styling via
CSS, not inline attributes:

- **Single standalone content image** (the common `figure > image-block-wrapper > img` +
  optional `figcaption`): convert to Markdown `![alt](src)`, and render the caption as an
  `*italic*` line beneath it. Reproduce centering / max-width / caption styling by styling
  `.sqs-content img` and a caption convention in CSS. Keep the existing `/images/<hash>.<ext>`
  `src` exactly.
- **Multi-image galleries** (grids of thumbnails — common in `visual/`): no faithful
  Markdown form. Keep as **minimal** HTML with a single semantic class (e.g. `.jb-gallery`),
  inline styles removed and the grid styling moved to CSS.
- **Background-image "cards"** (e.g. the set-list header card with `background-image`,
  centered logo/symbol, and a links row): no Markdown form. Keep a **minimal** HTML block
  with a semantic class (e.g. `.jb-set-card`); move every inline style into that class in
  CSS, and turn the inner links row into normal content where possible.

### Embeds / buttons

- `<iframe>` (YouTube/embeds): keep — no Markdown form. (Video pages already handle the main
  embed separately.)
- Squarespace button blocks (`<button>` / button-link blocks): convert to a normal Markdown
  link, styled as a button via a CSS class on the rendered `<a>` (e.g. `.sqs-content
  .jb-button`), or a minimal `<a class="jb-button">` if a wrapper is unavoidable.

---

## Architecture & compatibility (keep all of these true)

- **Static build, no runtime.** Public site is pure static HTML (`astro build`), no Worker.
  Don't introduce `<script>`, client JS, hydration, or per-request logic.
- **`.md` + standard Markdown pipeline.** Block-level raw HTML you keep (galleries, cards,
  iframes) must be **left-aligned and surrounded by blank lines**, or Markdown turns indented
  HTML into code blocks and wraps stray text in `<p>`. Your transform must enforce this.
- **Keystatic edits these files** (`fields.mdx`, extension `md`) — keep any retained HTML
  **well-formed and MDX-safe**: self-close void tags (`<br />`, `<img … />`, `<hr />`), quote
  attributes, no stray/unclosed tags.
- **Frontmatter schema is fixed** (`content.config.ts` + Keystatic `sharedFields`). Don't
  add/rename/drop keys. Preserve a body's own `<h1>`/`#` when `showHeading: false`.
- **Images stay local & root-relative** (`/images/<hash>.<ext>`). Run convert with
  `--no-images`. `npm run verify` must stay green (it forbids live `squarespace-cdn` refs and
  any ad/telemetry tokens) — keep those at zero.
- **Styling lives in CSS, not inline.** Every visual rule you remove from the HTML must be
  reproduced by a stylesheet rule targeting the compiled Markdown output. This is the core of
  "maximize compliance with the original site's styling."

---

## Per-iteration loop

1. **Pick the next non-PASSING collection** (start with `guide` — smallest, highest signal;
   then the other prose collections; then `set-lists`/`visual`/`proxies`; then
   `translations` last — its giant tables are pure GFM-table extraction).
2. **Measure** the collection's current HTML usage (tag histogram + `class=`/`style=` counts)
   and pick the highest-impact construct still present.
3. **Improve the transform** (`beautify.mjs`/`extract.mjs`) with a deterministic, ordered
   rule (prefer JSDOM DOM ops over regex). If the rule removes styling, **add the matching
   CSS** in the same iteration.
4. **Regenerate** just this collection: `node scripts/convert.mjs --no-images <slugs…>`.
5. **Verify — all must pass before the collection is PASSING:**
   - `npm run build` is green (no Markdown/MDX compile errors; no indented-HTML code blocks).
   - `node scripts/lib/fidelity.mjs check <collection>` → **zero meaningful content diffs**
     (content preserved despite the DOM change).
   - `npm run verify` is green.
   - **Markdown-compliance bar** for the collection's bodies:
     - Zero of: `<p>`, `<strong>`, `<b>`, `<em>`, `<i>`, `<h1>`–`<h6>`, `<a>`, `<ul>`,
       `<ol>`, `<li>`, `<hr>`, `<blockquote>` (all of these have Markdown forms).
     - Zero inline `style=` and zero Squarespace `class=` (`sqs-*`, `span-N`, `col`, `row`,
       `image-block-*`, etc.) on content.
     - Remaining HTML limited to the **allowlist**: `<iframe>`, and explicitly-whitelisted
       semantic blocks (`.jb-gallery`, `.jb-set-card`, `.jb-button` or equivalents) whose
       styling is fully CSS-driven (no inline styles).
     - Genuine data tables are GFM pipe tables.
   - **Visual spot-check:** build and eyeball 2–3 representative pages from the collection
     (and note them in the ledger) to confirm the CSS migration preserved the look — captions
     centered, set-list card intact, tables readable, images sized sensibly.
6. **Record** in the ledger: the rule + CSS you added, the new tag counts (should drop
   monotonically), the collection status, and any page parked under "Open problems" with a
   specific hypothesis.
7. **Stop.**

Track the headline metric each iteration so progress is visible: total in-scope count of the
"should-be-Markdown" tags above + `style=`/Squarespace-`class=` occurrences. It must trend to
~zero (outside the allowlist).

---

## Done criteria → completion promise

Output the promise **only when ALL hold**:

- Every in-scope collection is **PASSING** (meets the Markdown-compliance bar in step 5).
- Across all in-scope bodies: zero `<p>/<strong>/<b>/<em>/<i>/<h1-6>/<a>/<ul>/<ol>/<li>/<hr>/
  <blockquote>`, zero inline `style=`, zero Squarespace `class=`. Remaining HTML is only the
  allowlist (`<iframe>` + CSS-driven `.jb-*` semantic blocks), and genuine tables are GFM.
- The removed styling is reproduced in CSS so spot-checked pages still match the original look.
- `npm run build` green, `node scripts/lib/fidelity.mjs check` (all) reports zero meaningful
  content diffs, `npm run verify` green.
- `videos/` and out-of-scope files unchanged; `git status` shows only in-scope content, the
  transform/scripts, stylesheets, and `scripts/ralph/**`.
- **Nothing committed.** Working tree clean and uncommitted, ready for the maintainer's bulk
  commit.

When and only when all are true, output exactly:

```
<promise>MARKDOWN COMPLIANCE COMPLETE</promise>
```

Otherwise: do one solid step, update the ledger, and stop so the loop continues.

---

## Guardrails / anti-patterns

- Don't hand-edit generated `.md` bodies as the fix — fix the transform + CSS and regenerate.
- Don't keep HTML "to be safe" when a Markdown form exists — convert it and move styling to
  CSS. (Reverses Round 1.)
- Don't solve styling with inline `style=` or by re-adding Squarespace classes — use named
  CSS classes on the compiled output.
- Don't weaken/delete the fidelity harness, baseline, or `verify.mjs` to pass a check — a
  failing check means the *content/look* regressed, not the check.
- Don't expand scope to `videos/`. Don't commit, add, stage, or push. Ever.
```
