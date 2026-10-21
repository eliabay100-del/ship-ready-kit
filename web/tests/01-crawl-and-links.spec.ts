import { test, expect } from '@playwright/test';
import { config, isInternal, urlKey } from '../lib/config';
import { checkUrl, loadCrawl } from '../lib/crawl';

/**
 * Covers site checklist: robots.txt (5), sitemap.xml (6), custom 404 (7),
 * broken links (19) — plus the crawl health the other specs depend on.
 */

const crawl = loadCrawl();
const bulk = (lines: string[]) => `\n${lines.map((l) => `  • ${l}`).join('\n')}\n`;

test.describe('Crawl health', () => {
  test('crawl reached the site and found pages', () => {
    expect(crawl.pages.length, 'no HTML pages crawled').toBeGreaterThan(0);
    expect(crawl.pages.filter((p) => p.status === 200).length).toBeGreaterThan(0);
  });

  test('no page returns 5xx or a transport error', () => {
    const bad = crawl.pages
      .filter((p) => p.error || p.status >= 500)
      .map((p) => `${p.status || 'ERR'} ${p.path}${p.error ? ` — ${p.error}` : ''}`);
    expect(bad, bulk(bad)).toEqual([]);
  });

  test('required paths are reachable with 200', () => {
    const missing = config.requiredPaths.filter((required) => {
      const norm = required.replace(/\/+$/, '') || '/';
      return !crawl.pages.some((p) => p.status === 200 && (p.path.replace(/\/+$/, '') || '/') === norm);
    });
    expect(missing, `required pages not reachable: ${missing.join(', ')}`).toEqual([]);
  });

  test('no redirect chain longer than 2 hops', () => {
    const long = crawl.pages
      .filter((p) => p.redirectChain.length > 3)
      .map((p) => `${p.redirectChain.join(' -> ')}`);
    expect(long, bulk(long)).toEqual([]);
  });

  test('no soft-404 (200 responses that render "not found")', () => {
    const soft = crawl.pages
      .filter((p) => p.status === 200 && /not found|404|page (?:does not|doesn't) exist/i.test(p.title ?? ''))
      .map((p) => `${p.path} — title: "${p.title}"`);
    expect(soft, bulk(soft)).toEqual([]);
  });
});

test.describe('Broken links (site checklist #19)', () => {
  test('no broken internal links or assets', () => {
    const broken = crawl.brokenLinks
      .filter((l) => l.url.startsWith(new URL(config.baseURL).origin))
      .map((l) => `${l.status || l.error} ${l.url}`);
    expect(broken, bulk(broken)).toEqual([]);
  });

  test('outbound links resolve (opt-in: CHECK_EXTERNAL=1)', async ({ request }) => {
    test.skip(process.env.CHECK_EXTERNAL !== '1', 'set CHECK_EXTERNAL=1 to probe third-party links');
    const sample = crawl.externalLinks.slice(0, Number(process.env.EXTERNAL_LIMIT ?? 25));
    const results = await Promise.all(
      sample.map(async (url) => {
        try {
          const res = await request.head(url, { timeout: 10_000, failOnStatusCode: false });
          // 401/403/405/429 mean "alive but guarded", not broken.
          return [401, 403, 405, 429].includes(res.status()) || res.status() < 400 ? null : `${res.status()} ${url}`;
        } catch (err) {
          return `ERR ${url} — ${(err as Error).message}`;
        }
      }),
    );
    const broken = results.filter((r): r is string => r !== null);
    expect(broken, bulk(broken)).toEqual([]);
  });
});

test.describe('robots.txt (site checklist #5)', () => {
  test('is served, parseable, and does not block the crawler', () => {
    const { status, body } = crawl.robotsTxt;
    expect(status, 'robots.txt must return 200').toBe(200);
    expect(body.length, 'robots.txt is empty').toBeGreaterThan(0);
    expect(body).toMatch(/user-agent\s*:/i);

    // "User-agent: *" followed by "Disallow: /" (before the next user-agent block) blocks everyone.
    const blocks = body.split(/^\s*user-agent\s*:\s*/im).slice(1);
    const wildcardBlock = blocks.find((b) => b.trimStart().startsWith('*'));
    const blocksEverything = !!wildcardBlock && /^[ \t]*disallow:[ \t]*\/[ \t]*$/im.test(wildcardBlock);
    expect(blocksEverything, 'robots.txt disallows the whole site for every crawler').toBe(false);

    if (crawl.sitemap.status === 200) {
      expect(crawl.robotsTxt.sitemaps.length, 'sitemap served but not referenced in robots.txt').toBeGreaterThan(0);
    }
  });

  test('does not accidentally block CSS/JS assets needed by Google', () => {
    const blocked = [...crawl.robotsTxt.body.matchAll(/^\s*disallow:\s*(\S+\.(?:css|js).*)$/gim)].map((m) => m[1]);
    expect(blocked, `robots.txt blocks render assets: ${blocked.join(', ')}`).toEqual([]);
  });
});

test.describe('sitemap.xml (site checklist #6)', () => {
  test('is valid XML with absolute, same-host URLs', () => {
    expect(crawl.sitemap.status, 'sitemap.xml must return 200').toBe(200);
    expect(crawl.sitemap.urls.length, 'sitemap contains no <loc> entries').toBeGreaterThan(0);

    const invalid = crawl.sitemap.urls.filter((u) => !/^https?:\/\//i.test(u) || !isInternal(u));
    expect(invalid, `non-absolute or cross-host sitemap entries: ${invalid.slice(0, 10).join(', ')}`).toEqual([]);
  });

  test('every sitemap URL returns 200 (sampled)', async () => {
    const limit = Number(process.env.SITEMAP_CHECK_LIMIT ?? 50);
    const sample = [...new Set(crawl.sitemap.urls)].slice(0, limit);
    const checks = await Promise.all(sample.map((u) => checkUrl(u)));
    const bad = checks.filter((c) => !c.ok).map((c) => `${c.status || c.error} ${c.url}`);
    expect(bad, bulk(bad)).toEqual([]);
  });

  test('sitemap covers the important pages', () => {
    const norm = (value: string) => value.replace(/\/+$/, '') || '/';
    const missing = config.requiredPaths.filter(
      (p) => !crawl.sitemap.urls.some((u) => norm(new URL(u).pathname) === norm(p)),
    );
    expect(missing, `required paths missing from sitemap: ${missing.join(', ')}`).toEqual([]);
  });
});

test.describe('Custom 404 (site checklist #7)', () => {
  test('returns a real 404 with a branded page, not a framework default', () => {
    const { status, bodySnippet, error } = crawl.notFound;
    expect(error ?? '', 'probe request failed').toBe('');
    expect(status, 'unknown URL must return HTTP 404 (not 200 soft-404, not 5xx)').toBe(404);

    const frameworkDefault = config.notFound.frameworkDefaultPatterns.find((p) =>
      new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(bodySnippet),
    );
    expect(frameworkDefault ?? '', `404 page is a raw framework/server default (${frameworkDefault})`).toBe('');

    const hasMarker = config.notFound.markers.some((m) => new RegExp(m, 'i').test(bodySnippet));
    expect(hasMarker, '404 page does not say "not found"/"404" (or use a configured marker)').toBe(true);

    // Must offer a way back.
    expect(bodySnippet, '404 page has no link back to the site').toMatch(/<a\s[^>]*href=["']\/["']/i);
  });
});

test.describe('Internal link graph', () => {
  test('every internal page target was resolved by the crawl', () => {
    const known = new Set([
      ...crawl.pages.map((p) => urlKey(p.url)),
      ...crawl.linkChecks.map((l) => urlKey(l.url)),
    ]);
    const unresolved = crawl.pages
      .flatMap((p) => p.links)
      .filter((l) => isInternal(l) && !known.has(urlKey(l)))
      .slice(0, 20);
    expect(unresolved, `links never verified: ${unresolved.join(', ')}`).toEqual([]);
  });
});
