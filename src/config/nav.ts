// The site header navigation, reproduced 1:1 from the original Squarespace site.
// Folder titles (What to Play, What's Next, …) are Squarespace nav *folders* — they
// are dropdown labels, not real pages — so they have no href of their own.
// Edit this file to change the header/footer navigation.

export interface NavLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface NavEntry {
  label: string;
  href?: string;
  external?: boolean;
  children?: NavLink[];
}

export const nav: NavEntry[] = [
  { label: 'Home', href: '/' },
  {
    label: 'What to Play',
    href: '/play',
    children: [
      { label: 'What to Play', href: '/play' },
      { label: 'Meta Decks (Standard)', href: '/guide/meta' },
      { label: 'Budget Decks (Standard)', href: '/guide/budget' },
      { label: 'Where to Play', href: '/play/where' },
      { label: 'Alternate Formats', href: '/league/formats' },
    ],
  },
  {
    label: "What's Next",
    href: '/new',
    children: [
      { label: 'Upcoming Releases', href: '/new' },
      { label: 'Black Bolt & White Flare Set List', href: '/set-lists/sv105' },
      { label: 'Black Bolt & White Flare Visual Set List', href: '/visual/sv105' },
    ],
  },
  {
    label: 'Rotation',
    href: '/rotation/g-on',
    children: [
      { label: 'Table of Contents (2025)', href: '/rotation/g-on' },
      { label: 'Introduction (2025)', href: '/rotation/g-on/introduction' },
      { label: 'Noteworthy Losses and Retentions from BRS-CRZ (2025)', href: '/rotation/g-on/noteworthy-losses-and-retentions' },
      { label: 'The New Essentials (G-on)', href: '/rotation/g-on/essentials' },
      { label: '2025 Rotation Card Status (BRS-CRZ)', href: '/rotation/g-on/card-status' },
    ],
  },
  {
    label: 'Deck Building',
    href: '/deck-building',
    children: [
      { label: 'Deck Building', href: '/deck-building' },
      { label: 'Deck Building Guide', href: '/guide' },
      { label: 'Ask for Help', href: 'https://discord.gg/gy52nzras2', external: true },
      { label: 'Staples & Noteworthy Cards', href: '/guide/appendix2' },
      { label: 'Deckbuilding for Prereleases', href: '/guide/appendix5' },
    ],
  },
  {
    label: 'Other Tools',
    href: '/tools',
    children: [
      { label: 'Other Tools', href: '/tools' },
      { label: 'Gift Guide', href: '/gifts' },
      { label: 'Battle Academy Supplement Decks', href: '/battle-academy' },
      { label: 'Guide to Identifying Fake Cards', href: '/guide/fakes' },
      { label: 'Site Updates', href: '/resources' },
      { label: 'External Resources', href: '/external' },
    ],
  },
  { label: 'Eternal', href: '/eternal' },
  { label: 'About', href: '/about' },
];

export const siteTitle = "JustInBasil's Pokémon TCG Resources";
export const patreonUrl = 'https://www.patreon.com/justinbasil';
