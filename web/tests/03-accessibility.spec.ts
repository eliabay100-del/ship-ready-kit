import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { config } from '../lib/config';
import { loadCrawl } from '../lib/crawl';

/** Covers site checklist #17 (accessibility): WCAG 2.1 A/AA via axe + keyboard/focus reality checks. */

const crawl = loadCrawl();
const LIMIT = Number(process.env.A11Y_PAGES ?? 25);
const pages = crawl.pages.filter((p) => p.status === 200 && !p.error).slice(0, LIMIT);

for (const p of pages) {
  test(`WCAG 2.1 AA: ${p.path}`, async ({ page }) => {
    await page.goto(p.url, { waitUntil: 'domcontentloaded' });
    // Give lazy content a chance without sleeping on arbitrary timeouts.
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    const report = blocking.map(
      (v) =>
        `[${v.impact}] ${v.id}: ${v.help}\n      ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join('\n      ')}${v.nodes.length > 3 ? `\n      … +${v.nodes.length - 3} more` : ''}`,
    );

    expect(blocking.length, `\n${report.join('\n')}\n`).toBe(0);
  });
}

test.describe('Keyboard & focus', () => {
  test('keyboard users can bypass navigation or land in a landmark', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const skipLink = page.locator('a[href^="#"]', { hasText: /skip|jump to/i }).first();
    const hasSkip = (await skipLink.count()) > 0;

    if (hasSkip) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
      expect(focused, 'first Tab did not focus the skip link').toMatch(/skip|jump to/i);
      const box = await skipLink.boundingBox();
      expect(box, 'skip link is invisible when focused').not.toBeNull();
    } else {
      await expect(page.locator('main, [role="main"]').first(), 'no skip link and no <main> landmark').toHaveCount(1);
    }
  });

  test('the first 12 tab stops have a visible focus indicator', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const offenders: string[] = [];

    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          label: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`,
          outlineWidth: Number.parseFloat(cs.outlineWidth || '0'),
          outlineStyle: cs.outlineStyle,
          boxShadow: cs.boxShadow,
          visible: rect.width > 0 && rect.height > 0,
        };
      });
      if (!info || !info.visible) continue;
      const hasOutline = info.outlineStyle !== 'none' && info.outlineWidth > 0;
      const hasRing = info.boxShadow !== 'none' && info.boxShadow.includes('rgb');
      if (!hasOutline && !hasRing) offenders.push(info.label);
    }

    expect(offenders, `focus is invisible on: ${offenders.join(', ')}`).toEqual([]);
  });

  test('no keyboard trap in the first 20 tab stops', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const seen = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
      const key = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return '';
        const r = el.getBoundingClientRect();
        return `${el.tagName}:${el.id}:${el.getAttribute('aria-label') ?? ''}:${Math.round(r.x)},${Math.round(r.y)}`;
      });
      if (key) seen.add(key);
    }
    expect(seen.size, 'focus cycling between the same one or two elements').toBeGreaterThan(2);
  });
});

test.describe('Reduced motion & contrast baseline', () => {
  test('honours prefers-reduced-motion', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', baseURL: config.baseURL });
    const page = await context.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const animated = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => {
          const cs = getComputedStyle(el);
          const duration = cs.animationDuration.split(',').map((d) => Number.parseFloat(d) || 0);
          const transition = cs.transitionDuration.split(',').map((d) => Number.parseFloat(d) || 0);
          return duration.some((d) => d > 0.5) || transition.some((d) => d > 0.5);
        })
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().split(' ')[0]}`),
    );
    await context.close();
    // Long animations under reduced-motion are a bug; short ones are tolerated.
    expect(animated, `long motion with prefers-reduced-motion: ${animated.join(', ')}`).toEqual([]);
  });
});
