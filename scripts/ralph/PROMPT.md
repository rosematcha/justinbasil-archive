# Ralph Loop: De-Squarespace the content into human-friendly Markdown

You are working in the **justinbasil-archive** repo (Astro + Keystatic). Your job is to
turn the obtuse, Squarespace-exported content bodies into clean, human-friendly
**Markdown-where-possible / faithful-HTML-where-needed**, *without changing how any page
looks when rendered.*

Read this entire prompt every iteration. Then do the **single most valuable next step**
toward completion, verify it, record progress, and stop. The loop will feed you this
prompt again; you will see your own prior work in the files, in git, and in the progress
ledger.

---

## The one rule you must never break

**DO NOT COMMIT. DO NOT `git add`. DO NOT `git push`.** The maintainer will review the
full diff and make a single bulk commit at the end. Your job is to leave the working tree
in a clean, correct, uncommitted state. (You may use `git status` / `git diff` /
`git stash` for inspection and `git show HEAD:<path>` to read the pristine version of a
file — but never create commits.)

---

## Background: how this content is produced (read carefully)

The `.md` files under `src/content/**` are **not hand-authored**. They are *generated
deterministically* from mirrored HTML:

```
_corpus/*.html   (source of truth: original justinbasil.com pages, mirrored)
      │
      ▼   scripts/lib/extract.mjs  ::  extractPage()   ← THE TRANSFORM YOU IMPROVE
      │   scripts/convert.mjs       (orchestrates, idempotent, resumable)
      ▼
src/content/<collection>/<slug>.md  (frontmatter + body)
      │
      ▼   src/components/RenderedEntry.astro  →  injected with set:html  (TODAY)
      ▼   Astro page renders
```

`extractPage()` currently grabs each Squarespace section's `innerHTML` **verbatim**, so the
bodies are full of `<div class="sqs-row/sqs-block/sqs-html-content …">` wrapper soup, inline
styles, `data-*`/`id` attributes, and HTML entities (`&quot;` appears ~305k times).

**Therefore: do NOT fix 332 generated files by hand.** Improve the *transform* and
re-generate. Hand-edits would be inconsistent and wiped out on the next `convert` run.
The 29k-line translation tables alone make hand-editing infeasible. Converging the
transform is the whole point of this loop.

Regenerate (no network; reuses the on-disk image cache) with:

```bash
node scripts/convert.mjs --no-images <slug-substring> ...   # subset, fast
node scripts/convert.mjs --no-images                        # everything in scope
```

---

## Site architecture & compatibility (design every change to fit this)

Match these facts so your output stays compatible with how the site builds, renders, and
gets edited. When a choice could break any of them, choose the option that preserves them.

- **Static-first build, deploys anywhere.** The public site is built as **pure static
  HTML** (`astro build`) and served on Cloudflare with no Worker/Functions. The `react()`
  and `keystatic()` integrations load **only in `astro dev`** (see `astro.config.mjs`).
  → Your transform runs at build time only. Never introduce anything that needs a runtime
  server, client JS, or per-request logic. No `<script>`, no client-side hydration, no
  `onclick` (the corpus had JS-nav links; `extract.mjs` already rewrites those to real
  `<a>` — keep that behavior).

- **Content is `.md`, rendered by Astro's Markdown pipeline.** Files are `*.md` (not
  `.mdx`). `render(entry)` → `<Content />` compiles them with Astro's **standard Markdown
  processor (remark/rehype, GFM on)**, which is lenient and **passes embedded raw HTML
  through**. This is why "Markdown where possible, HTML where needed" works in one file.
  → GFM tables, `**bold**`, `[text](href)`, `#` headings all compile. Raw HTML blocks must
  be separated from Markdown by blank lines and **not indented** (leading indentation makes
  Markdown treat them as code blocks — the exact failure the old `set:html` path avoided).
  Your transform must left-align block-level HTML and surround it with blank lines.

- **Keystatic edits these same files (`fields.mdx`, extension `md`).** The CMS editor
  (`keystatic.config.ts`) parses bodies as MDX, which is stricter than the public Markdown
  renderer. To keep entries openable/editable in `/keystatic`, prefer **well-formed,
  MDX-safe HTML**: self-close void tags (`<br />`, `<img … />`, `<hr />`), quote all
  attribute values, and avoid stray/unclosed tags. Cleaner HTML here is a real compatibility
  win, not just aesthetics. (The public build does not require this, but the editor does.)

- **Frontmatter schema is fixed** (`src/content.config.ts` Zod schema + the Keystatic
  `sharedFields`). Do **not** add, rename, or drop frontmatter keys. `showHeading: false`
  on a page means its body supplies its own `<h1>` — preserve that heading so the layout
  doesn't double it.

- **Layout & styling come from three stylesheets** — `global.css` (design tokens: brand
  greens, Montserrat, ~1800px content width), `jb-custom.css`, and the **layout-bearing**
  `squarespace-compat.css`. The compat sheet is the reason visual fidelity depends on
  keeping `sqs-row`/`col`/`span-N`/`sqs-col-N`/`sqs-block`/`sqs-html-content`/image-block/
  gallery markup. Don't invent new classes the stylesheets don't define, and don't drop the
  ones they target.

- **Images are local, root-relative** (`/images/<hash>.<ext>` under `public/`, produced by
  the convert pipeline + `asset-map.json`). Keep image `src` values exactly as the pipeline
  emits them. Run convert with `--no-images` so you never hit the network. `npm run verify`
  fails if any live `squarespace-cdn.com` ref survives — keep it at zero.

- **No ads/telemetry, ever.** `sanitize()` in `extract.mjs` and the `verify.mjs` gate strip
  and forbid AdSense/analytics/`SQUARESPACE_CONTEXT` tokens. Don't reintroduce any.

## Scope

**In scope** (332 files) — these collections only:

```
guide  resources  new-decks  pages  league  rotation  highlights
set-lists  visual  proxies  translations
```

**Out of scope: `videos/` (398 files).** Do not touch them in this loop. They are
near-identical boilerplate and will be handled by a separate scripted pass that reuses the
same transform you build here. Do not let `convert.mjs` rewrite them — pass explicit slug
filters, or confirm your transform changes are a no-op on a sample video before any full run.

---

## The two hard requirements

1. **Markdown where possible, HTML where needed.** Prose — paragraphs, headings, bold/
   italic, links, plain lists, and genuinely tabular data — must become real Markdown.
   Keep raw HTML *only* for things Markdown cannot faithfully reproduce: multi-column
   grids (`sqs-row` + `col span-N`), styled "card" blocks (background-image set-list
   headers), image blocks with aspect-ratio padding, galleries, iframes/embeds, buttons.

2. **Visually faithful.** The rendered page must look essentially identical to today.
   This is the gate that constrains everything. The Squarespace compat CSS
   (`src/styles/squarespace-compat.css`) is **layout-bearing** — it targets `.sqs-row`,
   `.col`, `.span-N`, `.sqs-col-N`, `.sqs-block`, `.sqs-html-content`, image-block and
   gallery classes. **Never strip a class/wrapper/inline-style that the compat CSS or a
   layout depends on.** When unsure whether something is decorative or structural, keep it.

These two requirements pull against each other on purpose. Resolve the tension per block
type, verified by the fidelity harness below — never by eye alone across 332 pages.

---

## One-time setup (do these first if not already done — check the ledger)

### S1. Switch rendering from `set:html` to compiled Markdown

`src/components/RenderedEntry.astro` currently injects the body with `set:html={body}`,
which never compiles Markdown — so any Markdown you emit would render as literal text.
Change it to render the collection entry through Astro's compiled content
(`const { Content } = await render(entry)` from `astro:content`, then `<Content />`),
which **passes embedded raw HTML through** while compiling Markdown. Preserve all existing
behavior: the YouTube header block, the `has-video-embed` class, and the video-block hiding
CSS. Keep the surrounding `PageLayout` props identical.

Verify: `npm run build` succeeds and a spot-checked page (e.g. `/guide/introduction`) still
renders its prose, images, and links. If compiled Markdown mangles the legacy raw-HTML
bodies (indented HTML becoming code blocks, stray `<p>` wrapping), that is expected for
not-yet-cleaned files — it is acceptable *only* if the fidelity harness (S2) still passes
for already-converted collections. Treat any fidelity regression as a bug to fix in the
transform, not to paper over.

### S2. Build the fidelity harness (`scripts/lib/fidelity.mjs` + a runner)

This is how you prove "visually faithful" automatically — no pixel diffing.

- A `fingerprint(html)` function that, given a rendered page's HTML, returns a *normalized
  content signature*: the ordered list of visible text tokens (whitespace-collapsed,
  entities decoded), ordered `(headingLevel, text)` pairs, ordered `img src` values,
  ordered `(href, linkText)` pairs, and ordered table-cell texts. It must ignore
  attributes, class names, element nesting, and insignificant whitespace.
- **Capture the baseline BEFORE changing the transform**, from the pristine current output:
  run `npm run build` on the current tree, fingerprint every in-scope page in
  `dist/**`, and save to `_corpus/fidelity-baseline.json`. Do this once, while
  `git status` still shows the content bodies unchanged. If the baseline already exists,
  do not recapture it (it must reflect pristine output).
- A runner `node scripts/lib/fidelity.mjs check [collection]` that rebuilds, re-fingerprints,
  and diffs against the baseline, printing any page whose signature changed and exactly what
  changed. **A passing run = zero meaningful diffs.** Whitespace-only and entity-decode
  differences must normalize to equal (that's the readability win, not a regression).

### S3. Create the progress ledger `scripts/ralph/PROGRESS.md`

Track state so each iteration resumes cleanly. Suggested format:

```
## Setup
- [ ] S1 render switch  - [ ] S2 fidelity harness + baseline captured  - [ ] S3 ledger

## Collections (status: pending | in-progress | PASSING)
- guide        : pending
- resources    : pending
- new-decks    : pending
- pages        : pending
- league       : pending
- rotation     : pending
- highlights   : pending
- set-lists    : pending
- visual       : pending
- proxies      : pending
- translations : pending   # tables — handle via deterministic table extraction

## Transform rules added (so re-reads stay consistent)
- <date/iter>: <rule, e.g. "decode all HTML entities in body text">
## Open problems / blocked
- <page>: <what broke, hypothesis>
```

---

## The per-iteration loop (after setup)

1. **Pick the next non-PASSING collection** from the ledger (top to bottom; start with
   `guide` — smallest, prose-heavy, best signal). Work one collection at a time.
2. **Inspect a few real files** in that collection and their `_corpus` HTML to see what
   block types appear. Identify the next transform improvement that makes the bodies more
   Markdown-like *for that collection's patterns*.
3. **Improve the transform** — extend `scripts/lib/extract.mjs` (or a new
   `scripts/lib/beautify.mjs` it calls) with a deterministic rule. Make rules general and
   ordered; prefer DOM operations (JSDOM is already a dependency) over regex on HTML.
4. **Regenerate just this collection**: `node scripts/convert.mjs --no-images <slugs…>`.
5. **Verify, in order — all must pass before the collection is PASSING:**
   - `npm run build` succeeds (no Astro/MDX compile errors).
   - `node scripts/lib/fidelity.mjs check <collection>` → zero meaningful diffs vs baseline.
   - `npm run verify` still passes (completeness + no ad/telemetry + images localized).
   - Readability bar for the collection's bodies: no `&quot;`/`&amp;`/`&nbsp;` entities in
     prose; no `data-block-*`, `data-sqsp-*`, `id="block-…"`, or `class=""` noise on prose
     elements; paragraphs/headings/bold/italic/links/plain-lists are Markdown, not `<p>`/
     `<h_>`/`<strong>`/`<a>`/`<ul>`. (Layout wrappers legitimately remain HTML — that's fine.)
6. **Record** the rule you added and the new collection status in the ledger. If something
   is blocked, write the specific page + hypothesis under "Open problems" and move on.
7. **Stop.** (The loop will re-feed this prompt.)

### Transform rules to build toward (general, in roughly this order)

- Decode HTML entities in body text (`&quot;`→`"`, `&amp;`→`&`, `&#8217;`→’, `&nbsp;`→space, …).
- Drop inert noise attributes everywhere they don't affect rendering: `data-block-*`,
  `data-sqsp-*`, `data-rte-*`, `id="block-…"`, empty `class=""`, `style="white-space:pre-wrap"`.
  **Keep** layout classes/styles the compat CSS needs (see requirement 2).
- Unwrap purely-presentational text wrappers (`div.sqs-html-content`, `div.sqs-block-content`
  around prose) and convert the inner `<h1-4>/<p>/<strong>/<em>/<a>/<ul>/<ol>/<li>` to
  Markdown headings, paragraphs, emphasis, links, and lists.
- Convert real `<table>`/`<tr>`/`<td>` data (set lists, translations) to GitHub-flavored
  Markdown tables **only when the table is genuinely tabular** and the result fingerprints
  identically. If a "table" is actually a layout grid, leave it as HTML.
- Collapse the long runs of blank lines and trailing whitespace the export left behind.
- Leave images, galleries, iframes, buttons, multi-column grids, and styled cards as
  (lightly de-noised) HTML.

### `translations/` note

These are giant card-name tables. Do **not** hand-edit. Treat them as a pure
deterministic table-extraction problem in the transform; verify a couple of files build and
fingerprint-match before declaring the collection PASSING. This collection is the strongest
argument for the script-driven approach — converging the rule fixes all 17 files at once.

---

## Done criteria → completion promise

Output the completion promise **only when ALL of these hold**:

- Every in-scope collection is marked **PASSING** in the ledger.
- `npm run build` is green.
- `node scripts/lib/fidelity.mjs check` (all collections) reports **zero meaningful diffs**
  against the pristine baseline.
- `npm run verify` passes.
- The readability bar (step 5) holds across all in-scope collections.
- `videos/` and any out-of-scope files are unchanged (`git status` shows only in-scope
  content, the transform/scripts, `RenderedEntry.astro`, and `scripts/ralph/**`).
- **Nothing is committed.** The working tree is clean and uncommitted, ready for the
  maintainer's single bulk commit.

When and only when all are true, output exactly:

```
<promise>MARKDOWN CLEANUP COMPLETE</promise>
```

If you are not done, do not output the promise — do one solid step, update the ledger, and
stop so the loop continues.

---

## Guardrails / anti-patterns

- Never hand-edit generated `.md` bodies as your fix — fix the transform and regenerate.
  (Editing a file to make one page pass while the transform still emits soup is a false win
  the next `convert` run erases.)
- Never weaken or delete the fidelity harness, baseline, or `verify.mjs` to make a check
  pass. If a check fails, the *content* is wrong, not the check.
- Never strip layout-bearing wrappers/classes/styles to chase "cleaner" Markdown — visual
  fidelity wins every tie.
- Don't expand scope to `videos/` or other collections.
- Don't commit, add, stage, or push. Ever.
```
