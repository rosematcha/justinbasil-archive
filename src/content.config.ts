import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Shared frontmatter for every preserved page.
const base = {
  title: z.string(),
  description: z.string().optional(),
  ogImage: z.string().optional(),
  navTitle: z.string().optional(),
  /** Original justinbasil.com URL this page was preserved from (provenance). */
  sourceUrl: z.string().optional(),
  publishDate: z.coerce.date().optional(),
  draft: z.boolean().default(false),
  /** Optional manual sort order for index listings. */
  order: z.number().optional(),
  /** Some pages bake their own <h1> into the body; suppress the layout heading. */
  showHeading: z.boolean().default(true),
};

const mdx = (dir: string) =>
  glob({ pattern: '**/*.{md,mdx}', base: `./src/content/${dir}` });

const videos = defineCollection({
  loader: mdx('videos'),
  schema: z.object({
    ...base,
    youtubeId: z.string().optional(),
    thumbnail: z.string().optional(),
  }),
});

const resources = defineCollection({
  loader: mdx('resources'),
  schema: z.object({
    ...base,
    category: z.string().optional(),
    excerpt: z.string().optional(),
  }),
});

const simple = (dir: string) => defineCollection({ loader: mdx(dir), schema: z.object(base) });

export const collections = {
  videos,
  resources,
  setLists: simple('set-lists'),
  guide: simple('guide'),
  newDecks: simple('new-decks'),
  visual: simple('visual'),
  translations: simple('translations'),
  proxies: simple('proxies'),
  rotation: simple('rotation'),
  highlights: simple('highlights'),
  league: simple('league'),
  pages: simple('pages'),
};
