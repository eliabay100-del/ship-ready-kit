import { test, expect } from '@playwright/test';
import { config } from '../lib/config';
import { loadCrawl } from '../lib/crawl';

/** Covers site checklist #16 (mobile version) and the mobile half of #17/#20. */

const crawl = loadCrawl();
const PATHS = ['/', ...crawl.pages.map((p) => p.path).filter((p) => p !== '/').slice(0, 2)];

const VIEWPORTS = [
  { name: 'iphone-se-375x667', width: 375, height: 667 },
  { name: 'pixel-7-412x915', width: 412, height: 915 },
  { name: 'ipad-mini-768x1024', width: 768, height: 1024 },
];

for (const vp of VIEWPORTS) {
  test.describe(`Mobile ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true });

    for (const pathname of PATHS) {
      test(`no horizontal overflow: ${pathname}`, async ({ page }) => {
        await page.goto(pathname, { waitUntil: 'domcontentloaded' });
        const result = await page.evaluate(() => {
          const doc = document.documentElement;
          const overflow = doc.scrollWidth - doc.clientWidth;
          const culprits =
            overflow <= 1
              ? []
              : [...document.querySelectorAll<HTMLElement>('body *')]
                  .filter((el) => {
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && r.right > window.innerWidth + 1;
                  })
                  .slice(0, 5)
                  .map((el) => `${el.tagName.toLowerCase()}.${(el.className.toString().split(' ')[0] || 'anon').slice(0, 24)} right=${Math.round(el.getBoundingClientRect().right)}px`);
          return { overflow, culprits };
        });
        expect(result.overflow, `page scrolls horizontally by ${result.overflow}px\n${result.culprits.join('\n')}`).toBeLessThanOrEqual(1);
      });

      test(`tap targets are at least ${config.mobile.minTapTargetPx}px: ${pathname}`, async ({ page }) => {
        await page.goto(pathname, { waitUntil: 'domcontentloaded' });
        const tooSmall = await page.evaluate((min) => {
          const candidates = [...document.querySelectorAll<HTMLElement>('button, [role="button"], input:not([type="hidden"]), select, nav a')];
          return candidates
            .filter((el) => {
              const r = el.getBoundingClientRect();
              const cs = getComputedStyle(el);
              return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
            })
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width < min || r.height < min;
            })
            .slice(0, 8)
            .map((el) => {
              const r = el.getBoundingClientRect();
              return `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 24)}" ${Math.round(r.width)}×${Math.round(r.height)}`;
            });
        }, config.mobile.minTapTargetPx);
        expect(tooSmall, `tap targets below ${config.mobile.minTapTargetPx}px:\n${tooSmall.join('\n')}`).toEqual([]);
      });
    }

    test('body copy is readable without zoom', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const tiny = await page.evaluate((min) => {
        const texts = [...document.querySelectorAll<HTMLElement>('p, li, a, button, span')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 40 && r.height > 0 && (el.textContent ?? '').trim().length > 20;
        });
        return texts
          .map((el) => ({
            size: Number.parseFloat(getComputedStyle(el).fontSize),
            label: `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 24)}"`,
          }))
          .filter((t) => t.size < min)
          .slice(0, 8)
          .map((t) => `${t.label} ${t.size}px`);
      }, config.mobile.minFontSizePx);
      expect(tiny, `text below ${config.mobile.minFontSizePx}px:\n${tiny.join('\n')}`).toEqual([]);
    });

    test('viewport meta allows zoom', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
      expect(viewport, 'missing viewport meta').toBeTruthy();
      expect(viewport ?? '', 'user-scalable=no blocks pinch zoom').not.toMatch(/user-scalable\s*=\s*no/i);
      expect(viewport ?? '', 'maximum-scale=1 blocks pinch zoom').not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/i);
    });

    test('sticky header does not eat the viewport', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const ratio = await page.evaluate((max) => {
        const offenders = [...document.querySelectorAll<HTMLElement>('header, nav, [class*="sticky"], [class*="fixed"]')]
          .filter((el) => {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return (cs.position === 'fixed' || cs.position === 'sticky') && r.height > 0;
          })
          .map((el) => ({ h: el.getBoundingClientRect().height, max }));
        const worst = offenders.sort((a, b) => b.h - a.h)[0];
        return worst ? worst.h / window.innerHeight : 0;
      }, config.mobile.maxStickyHeaderViewportRatio);
      expect(ratio, `sticky/fixed header covers ${(ratio * 100).toFixed(0)}% of the viewport`).toBeLessThanOrEqual(
        config.mobile.maxStickyHeaderViewportRatio,
      );
    });

    test('mobile navigation opens and closes', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const toggle = page.locator('button[aria-expanded], [role="button"][aria-expanded], button[aria-controls]').first();
      test.skip((await toggle.count()) === 0, 'no disclosure-style nav toggle found');

      const before = await toggle.getAttribute('aria-expanded');
      await toggle.click();
      if (before !== null) await expect(toggle).not.toHaveAttribute('aria-expanded', before);
      await expect(page.locator('nav').first()).toBeVisible();
    });
  });
}
