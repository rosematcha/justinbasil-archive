#!/usr/bin/env node
// Quick unit check for remark-jb-shortcodes: runs the same plugin order Astro uses
// (remark-directive → remarkJbShortcodes → rehype-raw) and asserts the output HTML
// contains the expected legacy CSS hooks. Run: node scripts/test-shortcodes.mjs
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import remarkJbShortcodes from '../src/lib/remark-jb-shortcodes.mjs';

const proc = unified()
  .use(remarkParse)
  .use(remarkDirective)
  .use(remarkJbShortcodes)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeStringify, { allowDangerousHtml: true });

const render = (md) => String(proc.processSync(md));

let pass = 0;
let fail = 0;
function check(label, html, conditions) {
  const bad = conditions.filter((c) => !c.test(html));
  if (bad.length === 0) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}`);
    bad.forEach((c) => console.log(`        missing: ${c.desc}`));
    console.log('        --- html ---\n' + html + '\n        ------------');
  }
}
const has = (re, desc) => ({ test: (h) => re.test(h), desc });
const count = (re, n, desc) => ({
  test: (h) => (h.match(re) || []).length === n,
  desc,
});

const DECK = `:::deck{id="lostmarch" name="Lost March" image="/images/lost-march.webp" illus="Masakazu Fukuda" comp="high"}

### Basic Strategy

Set up Jumpluff.

### Key Cards

- [Jumpluff LOT 14](https://limitlesstcg.com/cards/lot/14)

\`\`\`decklist
Pokémon - 25
4 Hoppip LOT 12
4 Jumpluff LOT 14
Trainer Cards - 27
3 Cynthia UPR 119
Energy - 8
4 Grass Energy SWSHEnergy 1
\`\`\`

:::
`;

check('deck', render(DECK), [
  has(/id="lostmarch" class="deck_box"/, 'deck_box anchor'),
  has(/<h2>Lost March<\/h2>/, 'name h2'),
  has(/class="comp3"/, 'comp=high → comp3'),
  has(/jb-row/, 'jb-row'),
  count(/jb-col-6/g, 2, 'two jb-col-6 columns'),
  has(/Illus\. Masakazu Fukuda/, 'illus credit'),
  has(/src="\/images\/lost-march.webp"/, 'thumbnail'),
  has(/limitlesstcg\.com\/cards\/lot\/14/, 'key-card markdown link compiled'),
  count(/jb-decklist-section/g, 3, 'three decklist sections'),
  count(/<li>/g, 5, 'five <li> total (1 key card + 4 decklist cards)'),
  has(/<li>4 Hoppip LOT 12<\/li>/, 'card text verbatim'),
  has(/<li>4 Grass Energy SWSHEnergy 1<\/li>/, 'energy card verbatim'),
]);

const STANDALONE = `\`\`\`decklist
Pokémon - 16
3 Munkidori TWM 95
Energy - 8
8 Basic Darkness Energy SVE 7
\`\`\`
`;
check('standalone decklist', render(STANDALONE), [
  count(/jb-decklist-section/g, 2, 'two sections'),
  count(/<li>/g, 2, 'two cards'),
]);

const GALLERY = `:::gallery
- /images/a.webp
- /images/b.webp "Credit: /u/holomondo"
:::
`;
check('gallery', render(GALLERY), [
  has(/class="jb-gallery"/, 'gallery wrapper'),
  count(/jb-gallery-slide/g, 2, 'two slides'),
  has(/<figcaption>Credit: \/u\/holomondo<\/figcaption>/, 'caption'),
  has(/alt="Credit: \/u\/holomondo"/, 'caption → alt'),
]);

// Captions survive smartypants curling the quotes (Astro runs it before this plugin).
const GALLERY_CURLY = `:::gallery
- /images/a.webp “Color print quality”
- /images/b.webp
:::
`;
check('gallery (curly quotes)', render(GALLERY_CURLY), [
  count(/jb-gallery-slide/g, 2, 'both slides kept'),
  has(/<figcaption>Color print quality<\/figcaption>/, 'curly caption stripped'),
]);

const NOTE = `:::note{title="Card Availability Note"}
Ampharos ex SVP 16 was cut from base set.
:::
`;
check('note', render(NOTE), [
  has(/class="note_box"/, 'note_box'),
  has(/<h3>Card Availability Note<\/h3>/, 'title'),
  has(/Ampharos ex SVP 16/, 'body compiled'),
]);

const BOX = `:::box{color="green" title="Meta Decks" href="/guide/meta" round}
These established archetypes have proved themselves.
:::
`;
check('box', render(BOX), [
  has(/<a href="\/guide\/meta">/, 'href wrap'),
  has(/class="box rbox box_green"/, 'box rbox box_green'),
  has(/<p class="box_title">Meta Decks<\/p>/, 'title'),
]);

const RESULTS = `:::results{id="jul24" event="Eternal" meta="12 July 2024, 6 Participants"}

#### 1st Place — Kaleidophoenix - Luxray ex
\`\`\`decklist
Pokémon - 19
4 Shinx UPR 45
Energy - 9
4 Double Colorless Energy SLG 69
\`\`\`

#### 2nd Place — PianoLegPete - Palafin ex
\`\`\`decklist
Pokémon - 20
4 Finizen TWM 59
\`\`\`

:::
`;
check('results', render(RESULTS), [
  has(/id="jul24" class="deck_box"/, 'event header anchor'),
  has(/<h2>Eternal<\/h2>/, 'event name'),
  has(/jb-deckbox-sublabel">12 July 2024, 6 Participants/, 'meta sublabel'),
  count(/class="jb-col-3"/g, 2, 'two placement columns'),
  has(/<strong>1st Place<\/strong><br ?\/?>Kaleidophoenix - Luxray ex/, '1st place label'),
  has(/<strong>2nd Place<\/strong><br ?\/?>PianoLegPete - Palafin ex/, '2nd place label'),
  count(/jb-decklist-section/g, 3, 'decklist sections across columns'),
]);

const SETCARD = `:::setcard{bg="/images/scarlet-violet.webp" logo="/images/logo.webp" identifier="/images/svi.webp" idalt="SV1 Set Identifier" title="Set List"}

<p class="jb-decklist-center">Learn more about Scarlet &amp; Violet.</p>

:::
`;
check('setcard', render(SETCARD), [
  has(/class="jb-set-card" style="background-image:url\(\/images\/scarlet-violet.webp\)"/, 'bg'),
  has(/<img src="\/images\/logo.webp"[^>]*class="jb-deck-thumb"/, 'logo'),
  has(/alt="SV1 Set Identifier"[^>]*class="jb-icon-center-mt15"|class="jb-icon-center-mt15"/, 'identifier'),
  has(/<h1 class="jb-white-center-margin5">Set List<\/h1>/, 'title'),
  has(/<hr ?\/?>/, 'hr'),
  has(/Learn more about Scarlet/, 'body kept'),
]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
