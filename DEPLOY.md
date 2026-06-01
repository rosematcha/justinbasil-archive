# Deploying the JustInBasil archive to Cloudflare Pages

The site builds to **100% static HTML** (`dist/`), so it deploys to Cloudflare Pages with
no Functions or Workers — fast, cheap, and robust. Content editing is done locally with
Keystatic, then pushed to GitHub, which triggers a rebuild.

## Local development & editing

```bash
pnpm install
pnpm dev          # http://localhost:4321  — site + /keystatic editor (local mode)
pnpm build        # -> dist/ (730 static pages + images), pnpm preview to check
pnpm verify       # completeness + AdSense + image-localization gates
```

Open **`/keystatic`** in dev to add/edit content (Site Updates, Videos, etc.) through
forms. Changes are written to the Markdown files in `src/content/` — commit and push them.

## Deploy to Cloudflare Pages

**Option A — Git integration (recommended):**
1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build settings:
   - Build command: `pnpm build`
   - Build output directory: `dist`
   - Environment variable (optional): `SITE_URL = https://<your-domain>` (canonical URLs + sitemap)
4. Every `git push` to the main branch rebuilds and redeploys.

**Option B — Direct upload:**
```bash
pnpm build
npx wrangler pages deploy dist --project-name justinbasil-archive
```

## Editing flow (production)

1. `pnpm dev` locally → `/keystatic` → add/edit content (or edit `src/content/*.md` directly).
2. `git commit && git push`.
3. Cloudflare rebuilds the static site automatically (Option A) — changes go live in ~1–2 min.

## Notes & limits

- **Files:** the build is ~13,300 files / ~1.8 GB (mostly the ~12.5k optimized WebP card
  images). This is within Cloudflare Pages' **20,000-file** limit and the **25 MB/file**
  limit (largest file is well under). If the image count ever approaches 20k, move
  `public/images` to **R2** and serve via a bucket binding.
- **Custom domain:** add `justinbasil.com` as a custom domain on the Pages project once the
  account access / domain transfer is complete.
- **Hosted (GitHub-mode) editing (optional, advanced):** `keystatic.config.ts` already
  supports GitHub mode via `KEYSTATIC_STORAGE=github` + `KEYSTATIC_REPO`. Running the admin
  in production requires a small SSR deployment (e.g. a separate Worker) and a Keystatic
  GitHub App — see https://keystatic.com/docs/github-mode. The local-edit-and-push flow
  above avoids that and is recommended for this archive.
