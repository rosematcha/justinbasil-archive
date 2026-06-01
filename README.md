# JustInBasil Archive

A faithful, editable recreation of **[justinbasil.com](https://www.justinbasil.com)** — Jason
Kingsford's Pokémon TCG resource site — as a static [Astro](https://astro.build) site with a
git-based CMS ([Keystatic](https://keystatic.com)).

```bash
pnpm install
pnpm dev      # http://localhost:4321 — site + /keystatic editor
pnpm build    # static build -> dist/
```

Edit content at **`/keystatic`** (or directly in `src/content/`), then commit. Deploys to
Cloudflare Pages — see [DEPLOY.md](DEPLOY.md).
