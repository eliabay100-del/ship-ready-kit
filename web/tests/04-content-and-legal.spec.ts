import { test, expect } from '@playwright/test';
import { config } from '../lib/config';
import { loadCrawl } from '../lib/crawl';

/**
 * Covers site checklist: privacy policy (1), terms page (2), clear CTA (3), FAQ (4).
 * Also guards against shipping placeholder copy.
 */

const crawl = loadCrawl();
const bulk = (lines: string[]) => `\n${lines.map((l) => `  • ${l}`).join('\n')}\n`;

const PLACEHOLDER = /lorem ipsum|dolor sit amet|\[insert|TODO:|TBD|coming soon|placeholder text/i;

function pageFor(pathname: string) {
  return crawl.pages.find((p) => p.path.replace(/\/+$/, '') === (pathname.replace(/\/+$/, '') || '/'));
}

test.describe('Legal pages (site checklist #1, #2)', () => {
  for (const [kind, pathname] of Object.entries(config.legal)) {
    test(`${kind} policy exists, is substantial, and is dated`, async ({ page }) => {
      const pageData = pageFor(pathname);
      if (pageData) expect(pageData.status, `${pathname} returned ${pageData.status}`).toBe(200);

      const res = await page.goto(pathname, { waitUntil: 'domcontentloaded' });
      expect(res?.status(), `${pathname} is not reachable`).toBeLessThan(400);

      const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      expect(body.length, `${kind} page is too thin to be a real policy (${body.length} chars)`).toBeGreaterThan(1500);
      await expect(page.locator('h1')).toHaveCount(1);
      expect(body, `${kind} page has no "last updated" date`).toMatch(/last updated|effective (?:date|as of)|updated on/i);
      expect(body, `${kind} page contains placeholder copy`).not.toMatch(PLACEHOLDER);

      const headings = await page.locator('h2, h3').count();
      expect(headings, `${kind} page has no sections`).toBeGreaterThanOrEqual(3);
    });
  }

  test('footer links to both legal pages from the home page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const hrefs = await page.locator('a[href]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
    const missing = Object.values(config.legal).filter((p) => !hrefs.some((h) => new URL(h).pathname.replace(/\/+$/, '') === p.replace(/\/+$/, '')));
    expect(missing, `legal pages not linked from the footer: ${missing.join(', ')}`).toEqual([]);
  });
});

test.describe('Clear CTA (site checklist #3)', () => {
  test('home page shows a visible primary CTA above the fold', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const pattern = new RegExp(config.cta.anyOf.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
    const cta = page.locator('a, button').filter({ hasText: pattern }).first();

    await expect(cta, `no CTA matching ${config.cta.anyOf.join(' / ')}`).toBeVisible();
    const box = await cta.boundingBox();
    const viewport = page.viewportSize();
    expect(box, 'CTA has no layout box').not.toBeNull();
    expect(box!.y, 'CTA is below the fold').toBeLessThan(viewport!.height);
    expect(box!.width * box!.height, 'CTA is too small to be a primary action').toBeGreaterThan(400);

    const href = await cta.getAttribute('href');
    if (href !== null) expect(href.replace(/#.*$/, ''), 'CTA links nowhere').not.toBe('');
  });

  test('CTA is reachable by accessible name', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const named = page.getByRole('link', { name: new RegExp(config.cta.anyOf[0] ?? '.', 'i') });
    const buttons = page.getByRole('button', { name: new RegExp(config.cta.anyOf.join('|'), 'i') });
    expect((await named.count()) + (await buttons.count()), 'CTA is not exposed as a link/button').toBeGreaterThan(0);
  });
});

test.describe('FAQ (site checklist #4)', () => {
  test('an FAQ exists with real questions and answers', async ({ page }) => {
    let found = false;
    const problems: string[] = [];

    for (const pathname of config.faq.paths) {
      const res = await page.goto(pathname, { waitUntil: 'domcontentloaded' }).catch(() => null);
      if (!res || res.status() >= 400) continue;
      found = true;

      const details = await page.locator('details').count();
      const faqSchema = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) =>
        nodes.some((n) => /"@type"\s*:\s*"FAQPage"/.test(n.textContent ?? '')),
      );
      const qHeadings = await page.locator('h2, h3, h4').filter({ hasText: /\?|how |what |can i |do you /i }).count();

      if (details + qHeadings < 5 && !faqSchema) problems.push(`${pathname}: only ${details + qHeadings} Q/A blocks and no FAQPage schema`);
      if (config.faq.requireFaqSchema && !faqSchema) problems.push(`${pathname}: FAQPage JSON-LD missing`);

      const text = await page.locator('body').innerText();
      if (PLACEHOLDER.test(text)) problems.push(`${pathname}: placeholder copy in FAQ`);
      if (details > 0) {
        // Accordions must actually open.
        const first = page.locator('details').first();
        await first.locator('summary').click();
        const open = await first.evaluate((el: HTMLDetailsElement) => el.open);
        expect(open, 'FAQ accordion does not open on click').toBe(true);
      }
      break;
    }

    expect(found, `no FAQ page reachable at ${config.faq.paths.join(' or ')}`).toBe(true);
    expect(problems, bulk(problems)).toEqual([]);
  });
});

test.describe('Copy quality', () => {
  test('no placeholder text anywhere crawled', () => {
    const offenders = crawl.pages
      .filter((p) => PLACEHOLDER.test(p.title ?? '') || PLACEHOLDER.test(p.description ?? ''))
      .map((p) => `${p.path} — "${(p.title ?? p.description ?? '').slice(0, 80)}"`);
    expect(offenders, bulk(offenders)).toEqual([]);
  });

  test('contact route is reachable and has a form or address', async ({ page, request }) => {
    const res = await request.get('/contact', { failOnStatusCode: false });
    test.skip(res.status() >= 400, 'no /contact route — acceptable if support lives elsewhere');

    await page.goto('/contact', { waitUntil: 'domcontentloaded' });
    const text = await page.locator('body').innerText();
    expect(text, 'contact page has neither a form nor an email address').toMatch(/<form|form|@|mailto:/i);
  });
});
