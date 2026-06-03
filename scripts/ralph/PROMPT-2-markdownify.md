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

## ⚠️ What an earlier run of this loop already broke — read before you touch anything

A previous pass of this prompt ran and **silently regressed the site's appearance** while the
text-fidelity harness reported "green" every time. The maintainer then fixed these by hand.
Do not re-introduce them, and understand *why the loop missed them*:

- **The fidelity harness is blind to styling and layout.** It compares *visible text, links,
  images, headings, table cells* — NOT computed styles, alignment, spacing, colour, or column
  layout. **"Fidelity OK" does NOT mean the page looks right.** Every regression below passed
  the harness. You MUST verify the *rendered look* separately (see "Styling/layout
  verification" in step 5).
- **Centering was lost wholesale.** Converting a centered `<h1 style="text-align:center">` (or
  `<p>`) to Markdown `#`/text **drops the alignment** — Markdown can't express it. ~80% of page
  titles and many in-body headers are centered in the original. → **Rule:** a heading OR
  paragraph that carries a promoted alignment/style class (e.g. `jb-center`) must stay HTML
  (`outerHTML`), so the class survives. Only *unstyled* prose becomes Markdown. (Already
  implemented in `blockToMd`; keep it.)
- **`white-space:pre-wrap` blocked class promotion.** It's dead Squarespace noise, but left in
  the `style` it prevented the exact-match `text-align:center → jb-center` promotion, so
  centered elements never got their class. → strip `white-space:pre-wrap`/`pre-line` as dead
  style (already implemented).
- **Column gutters collapsed.** Stripping the `.sqs-block` wrappers removed the 17px padding
  that *was* the inter-column gutter, so columns butted together at 0px. → when you remove a
  wrapper/style, you must reproduce its **measured** effect in CSS and confirm with computed
  styles, not by eye.
- **A site-wide class rename half-applied.** Renaming `.sqs-*` → `.jb-*` in CSS while content
  still used `.sqs-*` (or vice-versa) collapsed every grid. → never rename a class unless the
  content references AND the CSS rules move together in the same iteration, verified by build +
  computed-style check.
- **An over-broad CSS reset killed list numbers.** `.jb-code-container ol { list-style:none }`
  (meant for `<ul>` decklists) stripped the numbers off ordered ranking lists. → scope CSS
  tightly; check ordered lists still show markers.

**The current `beautify.mjs` + stylesheets already contain the fixes for all of the above.**
Start from the current branch state — do not revert these. Re-running `convert` reproduces the
committed output byte-for-byte (verified), so any diff you see after a regen is *only* your
intended change.

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
  - **⚠️ It is necessary but NOT sufficient.** It says nothing about how the page *looks* —
    alignment, spacing, colour, fonts, column layout all pass through it untouched. A green
    fidelity run with a broken layout is exactly how the earlier pass shipped regressions.
    Pair it with the styling/layout verification in step 5 — never treat it as the whole gate.
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

> **Exception (do not skip):** a `<h1>`–`<h6>` or `<p>` that is **aligned or otherwise styled**
> (carries a promoted `jb-center`/`jb-*` class, or an inline `text-align`) must **stay HTML** —
> Markdown can't express alignment, and flattening it silently left-aligns the element. Only
> *unstyled* headings/paragraphs become Markdown `#`/text. This is the single biggest
> regression from the last run; `blockToMd` already does this — keep it.

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
5. **Verify — ALL gates must pass. Content gates AND styling gates AND human sign-off.**

   **a. Content / compile gates (necessary, not sufficient):**
   - `npm run build` is green (no Markdown/MDX compile errors; no indented-HTML code blocks).
   - `node scripts/lib/fidelity.mjs check <collection>` → **zero meaningful content diffs**.
   - `npm run verify` is green.
   - **Markdown-compliance bar** for the collection's bodies:
     - Zero of: `<p>`, `<strong>`, `<b>`, `<em>`, `<i>`, `<h1>`–`<h6>`, `<a>`, `<ul>`,
       `<ol>`, `<li>`, `<hr>`, `<blockquote>` **except** where the element carries a kept
       style class (e.g. a centered `<h2 class="jb-center">` legitimately stays HTML — see
       the centering lesson). Unstyled prose must be Markdown.
     - Zero inline `style=` and zero Squarespace `class=` (`sqs-*`, `span-N`, `col`, `row`,
       `image-block-*`, etc.) on content. (Promoted `jb-*` classes are allowed and expected.)
     - Remaining HTML limited to the **allowlist**: `<iframe>`, alignment/style-bearing
       headings & paragraphs (`jb-*` classed), and whitelisted semantic blocks (`.jb-gallery`,
       `.jb-set-card`, `.jb-button`, `.jb-onclick-link`, …) whose styling is fully CSS-driven.
     - Genuine data tables are GFM pipe tables.

   **b. Styling / layout gates (the part the earlier run skipped — DO NOT skip):**
   The fidelity harness CANNOT see these. Build a real check. Extend the harness (e.g. a new
   `node scripts/lib/fidelity.mjs style <collection>` mode) that, for representative pages,
   compares the **computed/declared styling against the `_corpus` original** — the corpus is
   the source of truth. At minimum assert these invariants and FAIL on any mismatch:
   - **Alignment:** every element centered in the corpus is still centered in the output
     (and left ones still left). Derive the expected set from the corpus `text-align`.
   - **Grid/layout:** multi-column rows still render side-by-side with the original gutter
     (no collapse to a single stacked column at desktop width); column widths match.
   - **Lists:** ordered lists still show their numbers; intentionally-unmarked lists stay so.
   - **Link colour:** content links are the site link blue (`#2738b4`); card/`.blink`/inherit
     exceptions preserved.
   - **No leaked inline styles / orphaned classes:** no content element references a CSS class
     that no longer exists, and no inline `style=` survived on converted prose.
   If a true computed-style diff isn't feasible headlessly, the check must at least assert the
   above as **structural invariants** on the built `dist/**/*.html` + presence of the matching
   CSS rules — and you must escalate to (c).

   **c. Human visual sign-off (mandatory per collection):**
   You cannot *see* the page. Do **not** self-certify a collection as PASSING. After a/b pass,
   mark the collection **`READY FOR REVIEW`** in the ledger, list 3–5 representative page URLs
   (incl. the trickiest: multi-column, set-list cards, tables, centered headers) and run
   `npm run dev` so the maintainer can eyeball them at desktop **and** mobile width. Only the
   maintainer flips `READY FOR REVIEW → PASSING`. The completion promise requires every
   collection at human-confirmed `PASSING`.
6. **Record** in the ledger: the rule + CSS you added, the new tag counts (should drop
   monotonically), the styling invariants you checked, the review URLs, the collection status,
   and any page parked under "Open problems" with a specific hypothesis.
7. **Stop.**

Track the headline metric each iteration so progress is visible: total in-scope count of the
"should-be-Markdown" tags above + `style=`/Squarespace-`class=` occurrences. It must trend to
~zero (outside the allowlist).

---

## Done criteria → completion promise

Output the promise **only when ALL hold**:

- Every in-scope collection is at **human-confirmed `PASSING`** (content gates + styling gates
  + maintainer visual sign-off — step 5a/b/c). Self-certified collections do NOT count.
- Across all in-scope bodies: zero `<p>/<strong>/<b>/<em>/<i>/<h1-6>/<a>/<ul>/<ol>/<li>/<hr>/
  <blockquote>` **except** alignment/style-bearing elements kept as `jb-*`-classed HTML; zero
  inline `style=`; zero Squarespace `class=`. Remaining HTML is only the allowlist, and
  genuine tables are GFM.
- The removed styling is reproduced in CSS, **verified against the corpus** (alignment, grid
  gutters, list markers, link colour) — not just eyeballed.
- `npm run build` green, `node scripts/lib/fidelity.mjs check` (all) reports zero meaningful
  content diffs, the styling-invariant check passes, `npm run verify` green.
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

- **Don't trust "Fidelity OK" as proof the page looks right.** It only checks text/links/
  images/headings. A green run with a wrecked layout is the failure mode that already shipped.
  Styling/layout has its own gate (5b) + human sign-off (5c).
- Don't flatten a heading/paragraph that carries an alignment/style class to Markdown — keep
  it as `jb-*`-classed HTML so the alignment survives.
- Don't remove a wrapper/inline-style without reproducing its **measured** effect in CSS and
  confirming against the corpus (the gutter-collapse lesson).
- Don't rename a CSS class unless the content references AND the stylesheet rules move in the
  same iteration, verified by build + styling check (the namespace-mismatch lesson).
- Don't write a broad CSS reset that hits more than intended (the `ol { list-style:none }`
  lesson) — scope tightly and re-check the affected elements.
- Don't hand-edit generated `.md` bodies as the fix — fix the transform + CSS and regenerate.
- Don't keep HTML "to be safe" when a Markdown form exists and the element is unstyled —
  convert it and move styling to CSS. (Reverses Round 1, but the centering exception above
  takes precedence: styled/aligned elements stay HTML.)
- Don't solve styling with inline `style=` or by re-adding Squarespace classes — use named
  CSS classes on the compiled output.
- Don't weaken/delete the fidelity harness, baseline, styling check, or `verify.mjs` to pass —
  a failing check means the *content/look* regressed, not the check.
- Don't self-certify a collection as PASSING — only the maintainer's visual review promotes it.
- Don't expand scope to `videos/`. Don't commit, add, stage, or push. Ever.
```
