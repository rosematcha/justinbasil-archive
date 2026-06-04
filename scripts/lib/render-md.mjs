// Shared markdown→HTML renderer mirroring Astro's pipeline (remark-directive +
// our shortcodes + raw HTML passthrough). Used by the migration's equivalence gate
// and by tests. We deliberately omit smartypants/gfm-autolink cosmetics: both sides
// of every comparison go through THIS same pipeline, so any such differences cancel.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import { JSDOM } from 'jsdom';
import remarkJbShortcodes from '../../src/lib/remark-jb-shortcodes.mjs';

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkJbShortcodes)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeStringify, { allowDangerousHtml: true });

export function renderMd(body) {
  return String(processor.processSync(body));
}

// "deck list" / "example deck list" headings are pure chrome the shortcode drops;
// strip them so they don't break text equality.
const stripChrome = (s) =>
  s
    .replace(/\bexample deck list\b/gi, '')
    .replace(/\bdeck list\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

// Reduce rendered HTML to what must be preserved: visible text, image sources, and
// link targets. Structure (p vs li, wrapper divs) is intentionally ignored.
// Decode the handful of entities rehype emits, so old/new compare on the same text.
const decode = (s) =>
  String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x26;/g, '&')
    .replace(/&nbsp;| /g, ' ');

export function comparable(body) {
  const html = renderMd(body);
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  // Replace tags with spaces (NOT textContent): jsdom's textContent concatenates
  // adjacent elements with no separator, so <h2>Name</h2><em>Illus</em> would read
  // "NameIllus" and adjacent <li> cards would fuse. Tag→space keeps boundaries.
  const text = stripChrome(decode((doc.body.innerHTML || '').replace(/<[^>]+>/g, ' ')));
  const imgs = [...doc.querySelectorAll('img')].map((n) => n.getAttribute('src') || '').sort();
  const hrefs = [...doc.querySelectorAll('a')].map((n) => n.getAttribute('href') || '').sort();
  return { text, imgs, hrefs };
}

export function comparableEqual(a, b) {
  const reasons = [];
  if (a.text !== b.text) {
    // surface the first divergence for debugging
    let i = 0;
    while (i < a.text.length && i < b.text.length && a.text[i] === b.text[i]) i++;
    reasons.push(
      `text differs near char ${i}:\n  OLD …${a.text.slice(Math.max(0, i - 40), i + 60)}…\n  NEW …${b.text.slice(Math.max(0, i - 40), i + 60)}…`,
    );
  }
  if (a.imgs.join('|') !== b.imgs.join('|'))
    reasons.push(`img srcs differ:\n  OLD ${a.imgs.join(', ')}\n  NEW ${b.imgs.join(', ')}`);
  if (a.hrefs.join('|') !== b.hrefs.join('|'))
    reasons.push(`hrefs differ (${a.hrefs.length} vs ${b.hrefs.length})`);
  return { equal: reasons.length === 0, reasons };
}
