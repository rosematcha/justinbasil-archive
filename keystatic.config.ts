import { config, fields, collection } from '@keystatic/core';

// Storage: local filesystem for development (run `astro dev` → /keystatic).
// In production (Cloudflare), set KEYSTATIC_STORAGE=github and KEYSTATIC_REPO=owner/name
// so edits are committed via the GitHub API and trigger a rebuild.
// NOTE: this config is bundled for the browser too, so `process` is not defined here.
// Use Vite's `import.meta.env` (statically inlined) instead of `process.env`.
const env = import.meta.env;
const storage =
  env.KEYSTATIC_STORAGE === 'github' && env.KEYSTATIC_REPO
    ? ({ kind: 'github', repo: env.KEYSTATIC_REPO } as const)
    : ({ kind: 'local' } as const);

// Shared schema fields. `title` is stored in frontmatter; the file/dir name is the
// URL slug (matching the original justinbasil.com path), so the body lives in `content`.
const sharedFields = {
  title: fields.slug({ name: { label: 'Title' } }),
  description: fields.text({ label: 'Description', multiline: true }),
  navTitle: fields.text({ label: 'Nav title (optional)' }),
  ogImage: fields.text({ label: 'OG image path (optional)' }),
  sourceUrl: fields.url({ label: 'Original URL (provenance)' }),
  draft: fields.checkbox({ label: 'Draft', defaultValue: false }),
  content: fields.mdx({ label: 'Body' }),
};

const mkCollection = (label: string, dir: string, extra = {}) =>
  collection({
    label,
    slugField: 'title',
    path: `src/content/${dir}/**`,
    format: { contentField: 'content' },
    schema: { ...sharedFields, ...extra },
  });

export default config({
  storage,
  ui: {
    brand: { name: "JustInBasil Archive" },
    navigation: {
      'Content': ['resources', 'videos', 'guide', 'setLists', 'visual', 'newDecks', 'highlights'],
      'Reference': ['rotation', 'translations', 'proxies', 'league', 'pages'],
    },
  },
  collections: {
    resources: mkCollection('Resources (Site Updates)', 'resources', {
      publishDate: fields.date({ label: 'Publish date' }),
      category: fields.text({ label: 'Category' }),
      excerpt: fields.text({ label: 'Excerpt', multiline: true }),
    }),
    videos: mkCollection('Videos', 'videos', {
      youtubeId: fields.text({ label: 'YouTube video ID' }),
      thumbnail: fields.text({ label: 'Thumbnail path' }),
      publishDate: fields.date({ label: 'Publish date' }),
    }),
    guide: mkCollection('Deck Building Guide', 'guide'),
    setLists: mkCollection('Set Lists', 'set-lists'),
    visual: mkCollection('Visual Set Lists', 'visual'),
    newDecks: mkCollection('New Decks', 'new-decks'),
    highlights: mkCollection('Highlights', 'highlights'),
    rotation: mkCollection('Rotation', 'rotation'),
    translations: mkCollection('Translations', 'translations'),
    proxies: mkCollection('Proxies', 'proxies'),
    league: mkCollection('League / Formats', 'league'),
    pages: mkCollection('Standalone Pages', 'pages'),
  },
});
