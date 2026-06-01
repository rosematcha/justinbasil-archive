// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import keystatic from '@keystatic/astro';

// Architecture:
//  - Public site is built as PURE STATIC HTML (fast, robust, deploys anywhere incl.
//    Cloudflare Pages with no Functions/Worker).
//  - The Keystatic editor (/keystatic) runs in local-filesystem mode during `astro dev`.
//    Editing flow: edit locally -> git commit/push -> Cloudflare rebuilds the static site.
//  - So the React + Keystatic integrations (which add server-only admin routes) are
//    loaded ONLY in dev; the production build stays 100% static.
const isDev = process.argv.includes('dev');

export default defineConfig({
  site: process.env.SITE_URL || 'https://justinbasil.com',
  integrations: [
    mdx(),
    sitemap(),
    ...(isDev ? [react(), keystatic()] : []),
  ],
});
