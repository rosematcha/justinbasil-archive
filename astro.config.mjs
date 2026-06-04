// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import remarkDirective from 'remark-directive';
import remarkJbShortcodes from './src/lib/remark-jb-shortcodes.mjs';

// Architecture:
//  - Public site is built as PURE STATIC HTML (fast, robust, deploys anywhere incl.
//    Cloudflare Pages with no Functions/Worker).
//  - Content is edited with Decap CMS, served as static files from `public/admin/`
//    (no Astro integration / server route needed). Locally: `npx decap-server` + the
//    dev server, open /admin/. In production it uses the GitHub backend (see admin/config.yml).
//  - Keystatic was removed: its MDX editor treats every raw HTML element as an undefined
//    component, which is incompatible with these preserved raw-HTML bodies.

export default defineConfig({
  site: process.env.SITE_URL || 'https://justinbasil.com',
  integrations: [
    mdx(),
    sitemap(),
  ],
  // Editor-friendly shortcodes (deck/decklist/gallery/note/box) compile to the
  // existing CSS hooks. remark-directive must run first to parse the `:::` syntax
  // into directive nodes; remarkJbShortcodes then rewrites them. See src/lib/.
  // (Astro 6: plugins go on a `unified()` processor; gfm/smartypants stay on by
  // default since we leave those options unset.)
  markdown: {
    processor: unified({ remarkPlugins: [remarkDirective, remarkJbShortcodes] }),
  },
});
