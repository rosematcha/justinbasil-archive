// Core extraction helpers shared by convert.mjs and tests.
import { JSDOM } from 'jsdom';

const SITE = 'https://www.justinbasil.com';
const TITLE_SUFFIX = /\s*[—–-]\s*JustInBasil['’]s Pok[ée]mon TCG Resources\s*$/i;

/** Decode a few common HTML entities for frontmatter scalar fields. */
export function decodeEntities(s = '') {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&rsquo;|&#8217;/g, '’')
    .replace(/&mdash;|&#8212;/g, '—')
    .replace(/&ndash;|&#8211;/g, '–')
    .replace(/&quot;/g, '"')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/** Remove ads, telemetry, and inert Squarespace scripts from a content subtree. */
export function sanitize(root, doc) {
  const AD_RE = /adsbygoogle|googlesyndication|google-analytics|gtag|doubleclick|pagead|squarespace\.com\/analytics|sqs-?telemetry|Static\.SQUARESPACE_CONTEXT/i;

  // Convert JS-based navigation (onclick="window.location.href='…'") into real <a>
  // links BEFORE we strip on* handlers. Used by the ToC card grids (home, /play, etc.).
  root.querySelectorAll('[onclick]').forEach((el) => {
    const m = (el.getAttribute('onclick') || '').match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
    if (m && el.parentNode) {
      const a = doc.createElement('a');
      a.setAttribute('href', m[1]);
      a.setAttribute('style', 'display:block;color:inherit;text-decoration:none;cursor:pointer');
      el.parentNode.insertBefore(a, el);
      a.appendChild(el);
    }
  });

  // scripts, noscript, ins (adsense), iframes that are ad frames
  root.querySelectorAll('script, noscript, style').forEach((n) => n.remove());
  root.querySelectorAll('ins.adsbygoogle, .adsbygoogle, [id*="google_ads"], [class*="adsbygoogle"]').forEach((n) => n.remove());
  // Squarespace ad / pixel blocks
  root.querySelectorAll('[data-block-type="51"]').forEach((n) => n.remove()); // ad block
  // strip any element whose attrs match ad/telemetry
  root.querySelectorAll('*').forEach((n) => {
    for (const attr of [...n.attributes]) {
      if (/^on/i.test(attr.name)) n.removeAttribute(attr.name); // inline handlers
      if (AD_RE.test(attr.value || '')) { n.remove(); return; }
    }
  });
  return root;
}

/**
 * Extract the page's content region + metadata from a mirrored HTML file.
 * Returns { title, description, ogImage, sourcePath, html }.
 */
export function extractPage(rawHtml, { sourcePath } = {}) {
  const dom = new JSDOM(rawHtml);
  const doc = dom.window.document;

  const ogTitle = doc.querySelector('meta[property="og:title"]')?.content || doc.querySelector('title')?.textContent || '';
  const title = decodeEntities(ogTitle.replace(TITLE_SUFFIX, '')) || 'Untitled';
  const description = decodeEntities(doc.querySelector('meta[name=description]')?.content || doc.querySelector('meta[property="og:description"]')?.content || '');
  let ogImage = doc.querySelector('meta[property="og:image"]')?.content || '';
  const canonical = doc.querySelector('link[rel=canonical]')?.href || '';

  // Publish date (videos/resources are blog-collection items with a date).
  const publishDate =
    doc.querySelector('meta[property="article:published_time"]')?.content ||
    doc.querySelector('time.Blog-meta-item--date')?.getAttribute('datetime') ||
    (rawHtml.match(/"datePublished":"([^"]+)"/) || [])[1] || '';

  const main = doc.querySelector('main.Index') || doc.querySelector('main') || doc.querySelector('.Content-outer') || doc.querySelector('.sqs-slide-container');
  if (!main) return { title, description, ogImage, canonical, html: '' };

  // Strip Squarespace chrome we don't want inside the body.
  main.querySelectorAll('header, footer, .Header, .Footer, .Mobile-bar, nav').forEach((n) => n.remove());
  sanitize(main, doc);

  // Normalize lazy-loaded images: Squarespace gallery/image blocks rely on JS to
  // copy data-src -> src. We strip that JS, so do it statically here. Without this,
  // gallery images (visual set lists, etc.) render as broken-image placeholders.
  main.querySelectorAll('img').forEach((img) => {
    const real = img.getAttribute('data-src') || img.getAttribute('data-image');
    const cur = img.getAttribute('src');
    if (real && (!cur || cur.startsWith('data:') || cur.trim() === '')) {
      img.setAttribute('src', real);
    }
    img.setAttribute('loading', 'lazy');
    img.removeAttribute('data-load');
  });

  // Collect each Index-page section's content (preserve row/col grid markup).
  // Use ONLY .Index-page-content (each already wraps its .sqs-layout) to avoid
  // duplicating content. Fall back to top-level .sqs-layout, then main.
  let sections = main.querySelectorAll('.Index-page-content');
  if (!sections.length) sections = main.querySelectorAll('.sqs-layout');
  let html;
  if (sections.length) {
    html = [...sections].map((s) => s.innerHTML).join('\n');
  } else {
    html = main.innerHTML;
  }

  const result = { title, description, ogImage, canonical, publishDate, sourcePath, html };
  dom.window.close(); // free JSDOM memory promptly (we keep only plain strings)
  return result;
}
