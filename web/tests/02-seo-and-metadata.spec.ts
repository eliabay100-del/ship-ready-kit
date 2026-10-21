import { test, expect } from '@playwright/test';
import { config, hostOf, pathOf } from '../lib/config';
import { loadCrawl } from '../lib/crawl';

/**
 * Covers site checklist: meta titles (10), meta description (11), social share (12),
 * favicon (13), canonical URIs (14), alt text (8) — plus OG image weight.
 */

const crawl = loadCrawl();
const LIMIT = Number(process.env.SEO_PAGES ?? 60);
const pages = crawl.pages.filter((p) => p.status === 200 && !p.error).slice(0, LIMIT);
const bulk = (lines: string[]) => `\n${lines.map((l) => `  • ${l}`).join('\n')}\n`;

test.describe('Site-wide uniqueness', () => {
  test('no duplicate titles', () => {
    const byTitle = new Map<string, string[]>();
    for (const p of pages) {
      const key = (p.title ?? '').toLowerCase().trim();
      if (!key) continue;
      byTitle.set(key, [...(byTitle.get(key) ?? []), p.path]);
    }
    const dupes = [...byTitle.entries()].filter(([, paths]) => paths.length > 1).map(([t, paths]) => `"${t}" → ${paths.join(', ')}`);
    expect(dupes, bulk(dupes)).toEqual([]);
  });

  test('no duplicate meta descriptions', () => {
    const byDesc = new Map<string, string[]>();
    for (const p of pages) {
      const key = (p.description ?? '').toLowerCase().trim();
      if (!key) continue;
      byDesc.set(key, [...(byDesc.get(key) ?? []), p.path]);
    }
    const dupes = [...byDesc.entries()].filter(([, paths]) => paths.length > 1).map(([d, paths]) => `"${d}" → ${paths.join(', ')}`);
    expect(dupes, bulk(dupes)).toEqual([]);
  });
});

for (const p of pages) {
  test.describe(`SEO ${p.path}`, () => {
    test('title is present, unique in shape, and within length budget', () => {
      expect(p.title, 'missing <title>').toBeTruthy();
      const len = (p.title ?? '').length;
      expect(len, `title is ${len} chars (${config.seo.titleMin}-${config.seo.titleMax})`).toBeGreaterThanOrEqual(config.seo.titleMin);
      expect(len, `title is ${len} chars (${config.seo.titleMin}-${config.seo.titleMax})`).toBeLessThanOrEqual(config.seo.titleMax);
      expect(p.title ?? '', 'title is a generic placeholder').not.toMatch(/^(home|untitled|new page|index)$/i);
    });

    test('meta description is present and within length budget', () => {
      expect(p.description, 'missing <meta name="description">').toBeTruthy();
      const len = (p.description ?? '').length;
      expect(len, `description is ${len} chars (${config.seo.descriptionMin}-${config.seo.descriptionMax})`).toBeGreaterThanOrEqual(
        config.seo.descriptionMin,
      );
      expect(len, `description is ${len} chars (${config.seo.descriptionMin}-${config.seo.descriptionMax})`).toBeLessThanOrEqual(
        config.seo.descriptionMax,
      );
    });

    test('canonical points at itself, absolutely, on the right host', () => {
      expect(p.canonical, 'missing <link rel="canonical">').toBeTruthy();
      const canonical = p.canonical ?? '';
      expect(canonical, 'canonical must be absolute').toMatch(/^https?:\/\//i);
      expect(hostOf(canonical), 'canonical points at another host').toBe(hostOf(config.baseURL));
      expect(pathOf(canonical), 'canonical points at another page (de-index risk)').toBe(pathOf(p.url));
      expect(canonical).not.toMatch(/\?/);
    });

    test('Open Graph + Twitter card are complete', () => {
      expect(p.og.title, 'missing og:title').toBeTruthy();
      expect(p.og.description, 'missing og:description').toBeTruthy();
      expect(p.og.image, 'missing og:image').toBeTruthy();
      expect(p.og.url, 'missing og:url').toBeTruthy();
      expect(p.og.type, 'missing og:type').toBeTruthy();
      expect(p.twitter.card, 'missing twitter:card').toBeTruthy();
      expect(hostOf(p.og.image ?? ''), 'og:image must be absolute').toBeTruthy();
      if (p.og.url) expect(pathOf(p.og.url), 'og:url differs from canonical').toBe(pathOf(p.canonical ?? p.url));
    });

    test('language and viewport are declared', () => {
      expect(p.lang, 'missing <html lang>').toBeTruthy();
      expect(p.lang ?? '').toMatch(/^[a-z]{2}(?:-[A-Za-z]{2,4})?$/);
      expect(p.viewport, 'missing viewport meta').toBeTruthy();
      expect(p.viewport ?? '', 'viewport disables zoom (WCAG 1.4.4)').not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?\b/i);
    });

    test('indexable: no accidental noindex', () => {
      expect((p.robotsMeta ?? '').toLowerCase()).not.toMatch(/noindex|none/);
    });

    test('one H1 and no skipped heading levels', () => {
      expect(p.h1.length, p.h1.length === 0 ? 'no <h1>' : `multiple <h1>: ${p.h1.join(' | ')}`).toBe(1);
      const skips: string[] = [];
      let previous = 0;
      for (const h of p.headings) {
        if (previous > 0 && h.level > previous + 1) skips.push(`h${previous} → h${h.level} ("${h.text.slice(0, 40)}")`);
        previous = h.level;
      }
      expect(skips, bulk(skips)).toEqual([]);
    });

    test('every image has descriptive alt text', () => {
      const missing = p.images.filter((img) => img.alt === null).map((img) => img.src);
      const empty = p.images.filter((img) => img.alt === '').map((img) => img.src);
      const filenamey = p.images
        .filter((img) => (img.alt ?? '').length > 0 && /\.(png|jpe?g|webp|svg|gif)$/i.test(img.alt ?? ''))
        .map((img) => `${img.src} → alt="${img.alt}"`);

      expect(missing, `images without alt: ${missing.slice(0, 10).join(', ')}`).toEqual([]);
      // alt="" is valid for decorative images, but a page made only of alt="" is a smell.
      if (p.images.length > 0) expect(empty.length, 'all images are decorative (alt="")').toBeLessThan(p.images.length);
      expect(filenamey, `alt text is a filename: ${filenamey.join(', ')}`).toEqual([]);
    });
  });
}

test.describe('Social preview image', () => {
  test('og:image loads and meets the 1200×630 minimum', async ({ page }) => {
    const candidates = [...new Set(pages.map((p) => p.og.image).filter((v): v is string => !!v))].slice(0, 5);
    test.skip(candidates.length === 0, 'no og:image declared');

    const bad: string[] = [];
    for (const src of candidates) {
      const dims = await page.evaluate(
        (url) =>
          new Promise<{ w: number; h: number } | { error: string }>((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => resolve({ error: 'failed to load' });
            img.src = url;
            setTimeout(() => resolve({ error: 'timeout' }), 8000);
          }),
        src,
      );
      if ('error' in dims) bad.push(`${src} — ${dims.error}`);
      else if (dims.w < config.seo.ogImageMinWidth || dims.h < config.seo.ogImageMinHeight) {
        bad.push(`${src} — ${dims.w}×${dims.h} (min ${config.seo.ogImageMinWidth}×${config.seo.ogImageMinHeight})`);
      }
    }
    expect(bad, bulk(bad)).toEqual([]);
  });
});

test.describe('Favicon (site checklist #13)', () => {
  test('a favicon is declared and served', async ({ request }) => {
    const iconLink = await request.get('/', { failOnStatusCode: false });
    const html = await iconLink.text();
    const links = [...html.matchAll(/<link[^>]+rel=["'][^"']*(?:icon|apple-touch-icon)[^"']*["'][^>]*>/gi)].map((m) => m[0]);
    expect(links.length, 'no <link rel="icon"> or apple-touch-icon in <head>').toBeGreaterThan(0);

    const hrefs = links
      .map((tag) => tag.match(/href=["']([^"']+)["']/i)?.[1])
      .filter((h): h is string => !!h)
      .map((h) => new URL(h, config.baseURL).toString());

    const results = await Promise.all(
      [...new Set([...hrefs, `${config.baseURL}/favicon.ico`])].map(async (u) => ({
        u,
        status: (await request.get(u, { failOnStatusCode: false })).status(),
      })),
    );
    const ok = results.filter((r) => r.status >= 200 && r.status < 400);
    expect(ok.length, `favicon candidates all failed: ${results.map((r) => `${r.status} ${r.u}`).join(', ')}`).toBeGreaterThan(0);
  });
});

test.describe('Structured data (optional, report only)', () => {
  test('home page exposes JSON-LD or microdata', async ({}, testInfo) => {
    const home = pages.find((p) => p.path === '/') ?? pages[0];
    testInfo.annotations.push({ type: 'info', description: `home JSON-LD blocks: ${home?.jsonLdCount ?? 0}` });
    test.skip((home?.jsonLdCount ?? 0) === 0, 'no JSON-LD — recommended, not required');
    expect(home?.jsonLdCount ?? 0).toBeGreaterThan(0);
  });
});
