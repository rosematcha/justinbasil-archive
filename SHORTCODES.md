# Editing shortcodes

These let you write common page blocks in plain text instead of HTML. Type them
directly into the **Body (raw)** field in the CMS. Copy a template, change the
values, done. The site turns them into the same styled blocks as before.

> Old hand-written HTML still works — you don't have to convert anything. Use these
> for new content (and feel free to replace old HTML blocks as you touch them).

---

## Deck block

An archetype: name, thumbnail, illustrator, strategy write-up, and the card list.

A deck uses **four colons** (`::::`) because it can contain other blocks (like a
`:::gallery` of card images). Everything else uses three.

````md
::::deck{id="lostmarch" name="Lost March" image="/images/lost-march.webp" illus="Masakazu Fukuda"}

### Basic Strategy

Use Professor Elm's Lecture to set up Jumpluff…

### Key Cards

- [Jumpluff LOT 14](https://limitlesstcg.com/cards/lot/14)

```decklist
Pokémon - 25
4 Hoppip LOT 12
4 Jumpluff LOT 14
Trainer Cards - 27
3 Cynthia UPR 119
Energy - 8
4 Grass Energy SWSHEnergy 1
```

::::
````

**Attributes** (inside the `{ }`, all optional except `name`):

| Attribute  | What it does | Example |
|------------|--------------|---------|
| `name`     | Archetype title (required) | `name="Lost March"` |
| `id`       | Anchor for `#linking` to the deck (auto-made from the name if omitted) | `id="lostmarch"` |
| `image`    | Thumbnail path | `image="/images/lost-march.webp"` |
| `illus`    | Illustrator credit (shown as *Illus. …*) | `illus="Masakazu Fukuda"` |
| `source`   | Credit line above the list (shown as *Source: …*) | `source="Piper Lepine — 6th NAIC"` |
| `price`    | Price tag in the header | `price="$65"` |
| `sublabel` | Free-text line under the name | `sublabel="Competitive Potential: Moderate"` |
| `comp`     | Competitive-rating bar: `none`, `meme`, `casual`, `low`, `moderate`, `high`, `tbd` | `comp="high"` |
| `type`     | Energy-type symbol before the name: `g r w l p f d m y n c` | `type="g"` |

Everything between the opening `::::deck{…}` and the closing `::::` is the **left
column** (strategy, key cards, etc.). The ` ```decklist ` block becomes the **right
column**. Anything you put *after* the decklist (e.g. an `### Alternate Lists`
section) also stays in the right column.

You can nest a gallery of card images in the left column — it uses three colons
inside the four-colon deck:

````md
::::deck{name="Erika" type="g"}
This deck features Vileplume, Gloom, and Jumpluff.

:::gallery
- /images/evs-002-r-en.webp
- /images/cec-003-r-en-lg.webp
:::

```decklist
Pokémon - 20
3 Hoppip EVS 2
```
::::
````

### The decklist

Paste a normal deck export between the ` ```decklist ` fences — one card per line.
A line that **starts with a number** is a card; any other line is a **section
header**. No other formatting needed:

```decklist
Pokémon - 16
3 Munkidori TWM 95
2 Froslass TWM 53
Trainer Cards - 36
4 Arven OBF 186
Energy - 8
8 Basic Darkness Energy SVE 7
```

You can also use a ` ```decklist ` block on its own (outside a deck) anywhere you
just need a formatted list.

---

## Set page header (hero)

The big banner at the top of a set's pages (Set List / Visual / Highlights / etc.).
The hero (background, logo, set icon, title) becomes attributes; the description and
the row of nav links stay in the body exactly as written (they differ per set).

```md
:::setcard{bg="/images/scarlet-violet.webp" logo="/images/sv-logo.webp" identifier="/images/svi.webp" idalt="SV1 Set Identifier" title="Set List"}

<p class="jb-decklist-center">Learn more about Scarlet & Violet by visiting the articles below.</p>

<p class="jb-decklist-center"><a href="/set-lists/sv1">Set List</a> | <a class="blink" href="/visual/sv1">Visual Set List</a> | <a class="blink" href="/highlights/sv1">Set Highlights</a></p>

:::
```

- `bg` — background image; `logo` — set logo; `identifier`/`idalt` — small set icon + its alt text; `title` — the big heading; `subtitle` — optional second line.
- The body is anything below the divider — usually a centered description and the
  nav-link row. Leave those links as-is; the current page's link has no `blink` class,
  the others do.

---

## Tournament results

A results grid: an event header and one column per placement, each with its decklist.
Each `#### Nth Place — Player / Deck` heading starts a new column; follow it with a
` ```decklist ` block.

````md
:::results{id="jul24" event="Eternal" meta="12 July 2024, 6 Participants"}

#### 1st Place — Kaleidophoenix - Luxray ex
```decklist
Pokémon - 19
4 Shinx UPR 45
Energy - 9
4 Double Colorless Energy SLG 69
```

#### 2nd Place — PianoLegPete - Palafin ex
```decklist
Pokémon - 20
4 Finizen TWM 59
```

:::
````

- `event` — the format/event name (the bold header).
- `meta` — the line under it (date, participant count).
- `id` — anchor for `#linking` (auto-made from the event name if omitted).
- The heading text splits on the **em dash** (`—`): rank on the left, player/deck on
  the right. (Hyphens in "Player - Deck" are safe — only the em dash splits.)

---

## Gallery

A row of images (click to enlarge). One image per line; optional caption in quotes.

```md
:::gallery
- /images/color-print-quality.webp "Color print quality"
- /images/card-back-color.webp
:::
```

---

## Note box

A highlighted callout (the red-bordered box).

```md
:::note{title="Card Availability Note"}
Ampharos ex SVP 16 was cut from base set and won't be tournament legal until 19 May.
:::
```

`title` is optional.

---

## Colored box / call-to-action

A colored banner, optionally a clickable link.

```md
:::box{color="green" title="Meta Decks" href="/guide/meta" round}
These established archetypes have proved themselves in large competitions.
:::
```

- `color` — `red`, `orange`, `yellow`, `yellowgreen`, `green`, `darkgreen`, `blue`,
  `purple`, `teal`, `violet`, `lavender`, `brown`, `grey`, `darkgrey` (and more).
- `title` — bold heading line (optional).
- `href` — makes the whole box a link (optional).
- `round` — rounded corners (optional; just include the word).

---

## Tips

- The `:::` lines must start at the **far left** (no spaces in front of them).
- Leave a **blank line** before and after each block.
- To preview, save and view the page — the dev site / published site renders it.
