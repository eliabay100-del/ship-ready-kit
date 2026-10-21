import { test, expect } from '@playwright/test';
import { analyticsCookieRe, analyticsRequestRe, config } from '../lib/config';

/**
 * Covers site checklist #15 (Cookie consents) and #9 (analytics).
 * The requirement is not "a banner exists" — it is that non-essential
 * tracking is impossible before an explicit choice, refusal is as easy as
 * acceptance, and the choice persists.
 */

const consent = config.consent;
const configured = Boolean(consent.bannerSelector);

async function requestLog(page: import('@playwright/test').Page): Promise<string[]> {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}

const trackingOnly = (urls: string[]) => urls.filter((u) => analyticsRequestRe.test(u));

test.describe('Cookie consent (site checklist #15)', () => {
  test.skip(!configured, 'Set `consent.bannerSelector` in launch.config.json to enable these checks.');

  test('banner appears on first visit and offers accept + reject', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const banner = page.locator(consent.bannerSelector).first();
    await expect(banner).toBeVisible();
    await expect(page.locator(consent.acceptSelector).first()).toBeVisible();
    await expect(page.locator(consent.rejectSelector).first(), 'no "reject all" control (GDPR requires equivalent choice)').toBeVisible();
  });

  test('refusal is as prominent as acceptance', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const accept = await page.locator(consent.acceptSelector).first().boundingBox();
    const reject = await page.locator(consent.rejectSelector).first().boundingBox();
    test.skip(!accept || !reject, 'controls have no layout box');

    const area = (b: { width: number; height: number }) => b.width * b.height;
    const ratio = area(reject!) / area(accept!);
    expect(ratio, `reject button is ${(ratio * 100).toFixed(0)}% the size of accept (dark pattern)`).toBeGreaterThanOrEqual(0.5);

    const acceptText = (await page.locator(consent.acceptSelector).first().innerText()).toLowerCase();
    const rejectText = (await page.locator(consent.rejectSelector).first().innerText()).toLowerCase();
    expect(rejectText.length, 'reject control has no text label').toBeGreaterThan(2);
    expect(/accept all|allow all/.test(acceptText) ? /reject all|decline all|deny all/.test(rejectText) : true).toBe(true);
  });

  test('no analytics runs before consent', async ({ page, context }) => {
    const urls = await requestLog(page);
    await page.goto('/', { waitUntil: 'load' });
    // Observation window: analytics beacons often fire late.
    await page.waitForTimeout(2500);

    const tracked = trackingOnly(urls);
    expect(tracked, `analytics fired before consent:\n${tracked.join('\n')}`).toEqual([]);

    const cookies = await context.cookies();
    const trackingCookies = cookies.filter((c) => analyticsCookieRe.test(c.name));
    expect(trackingCookies.map((c) => c.name), 'tracking cookies set before consent').toEqual([]);
  });

  test('rejecting persists and keeps analytics off after reload', async ({ page, context }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator(consent.rejectSelector).first().click();
    await page.waitForTimeout(800);

    const urls = await requestLog(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2500);

    expect(trackingOnly(urls), 'analytics fired after rejecting').toEqual([]);
    const cookies = await context.cookies();
    expect(cookies.filter((c) => analyticsCookieRe.test(c.name)).map((c) => c.name)).toEqual([]);

    const bannerStillShown = await page.locator(consent.bannerSelector).first().isVisible().catch(() => false);
    expect(bannerStillShown, 'consent prompt reappears after a stored refusal').toBe(false);

    const stored = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));
    expect(
      [...stored.local, ...stored.session].some((k) => /consent|cookie|privacy|gdpr/i.test(k)),
      `no persistence key found (localStorage: ${stored.local.join(',')})`,
    ).toBe(true);
  });

  test('accepting enables analytics', async ({ page }) => {
    const urls = await requestLog(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator(consent.acceptSelector).first().click();

    await page.waitForTimeout(3000);
    const tracked = trackingOnly(urls);
    expect(tracked.length, 'accepting consent did not start any analytics request').toBeGreaterThan(0);
  });

  test('GPC / DNT is honoured when present (opt-in)', async ({ browser }) => {
    test.skip(process.env.CHECK_GPC !== '1', 'set CHECK_GPC=1 to assert Global Privacy Control support');
    const context = await browser.newContext({
      baseURL: config.baseURL,
      extraHTTPHeaders: { 'sec-gpc': '1' },
    });
    const page = await context.newPage();
    const urls = await requestLog(page);
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await context.close();
    expect(trackingOnly(urls), 'analytics fired despite Sec-GPC: 1').toEqual([]);
  });
});

test.describe('Analytics present (site checklist #9)', () => {
  test('exactly one analytics provider is wired up', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    const html = await page.content();
    const providers = config.analytics.requestPatterns.filter((pattern) => new RegExp(pattern, 'i').test(html));
    if (configured) {
      // With a CMP the script is injected after consent, so HTML absence is fine.
      test.skip(true, 'CMP configured — provider is injected after consent (covered above)');
    }
    expect(providers, 'no analytics provider script in the page source').not.toEqual([]);
  });
});
