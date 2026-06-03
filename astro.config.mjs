// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

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
});
