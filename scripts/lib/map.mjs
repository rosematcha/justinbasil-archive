// Maps an original justinbasil.com path to an Astro collection + slug.
// Paths with a known collection prefix AND a sub-path go to that collection;
// everything else (single-segment pages, landing/index pages, /play/where, …)
// goes to the `pages` singleton collection, preserved 1:1.

export const COLLECTION_BY_PREFIX = {
  videos: 'videos',
  resources: 'resources',
  'set-lists': 'set-lists',
  guide: 'guide',
  'new-decks': 'new-decks',
  visual: 'visual',
  translations: 'translations',
  proxies: 'proxies',
  rotation: 'rotation',
  highlights: 'highlights',
  league: 'league',
};

/** @returns {{ dir: string, slug: string }} dir = content subdir, slug = file path (no ext). */
export function mapPath(urlPath) {
  const segments = urlPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (segments.length >= 2 && COLLECTION_BY_PREFIX[segments[0]]) {
    return { dir: COLLECTION_BY_PREFIX[segments[0]], slug: segments.slice(1).join('/') };
  }
  // Singleton / landing / index page.
  return { dir: 'pages', slug: segments.join('/') || 'home' };
}
