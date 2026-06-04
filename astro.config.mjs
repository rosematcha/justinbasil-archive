// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { fileURLToPath } from 'node:url';
import { unified } from '@astrojs/markdown-remark';
import remarkDirective from 'remark-directive';
// Resolve the local plugin to an absolute path. A bare './src/lib/...' relative
// import can fail to resolve when Vite hot-reloads astro.config (it keeps the id
// relative and looks in the wrong CWD); an absolute file path always resolves.
const remarkJbShortcodes = (
  await import(fileURLToPath(new URL('./src/lib/remark-jb-shortcodes.mjs', import.meta.url)))
).default;

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
