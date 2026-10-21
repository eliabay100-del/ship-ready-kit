import { test, expect } from '@playwright/test';
import { config } from '../lib/config';
import { loadCrawl } from '../lib/crawl';

/** Covers site checklist #20 (optimize performance) with lab budgets on real navigations. */

const crawl = loadCrawl();
const TARGETS = (process.env.PERF_PATHS?.split(',').map((p) => p.trim()) ?? ['/', '/pricing'])
  .map((path) => crawl.pages.find((p) => p.path === path)?.url ?? `${config.baseURL}${path}`)
  .slice(0, 5);

interface Metrics {
  lcp: number;
  cls: number;
  ttfb: number;
  jsKb: number;
  domNodes: number;
  requests: number;
}

async function measure(page: import('@playwright/test').Page, url: string): Promise<Metrics> {
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'load' });

  return page.evaluate(
    () =>
      new Promise<Metrics>((resolve) => {
        let lcp = 0;
        let cls = 0;

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) lcp = Math.max(lcp, entry.startTime);
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch {
          /* not supported */
        }

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
              if (!entry.hadRecentInput) cls += entry.value ?? 0;
            }
          }).observe({ type: 'layout-shift', buffered: true });
        } catch {
          /* not supported */
        }

        const read = () => {
          const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
          const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
          const jsKb =
            resources
              .filter((r) => r.initiatorType === 'script' || /\.m?js(?:\?|$)/.test(r.name))
              .reduce((sum, r) => sum + (r.transferSize || r.encodedBodySize || 0), 0) / 1024;

          resolve({
            lcp: Math.round(lcp),
            cls: Number(cls.toFixed(3)),
            ttfb: nav ? Math.round(nav.responseStart - nav.startTime) : 0,
            jsKb: Math.round(jsKb),
            domNodes: document.querySelectorAll('*').length,
            requests: resources.length,
          });
        };

        // LCP settles after the last paint; 3.5s is the observation window, not a race workaround.
        setTimeout(read, 3500);
      }),
  );
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

for (const url of TARGETS) {
  test(`Core Web Vitals: ${new URL(url).pathname}`, async ({ page }) => {
    test.setTimeout(60_000 * Math.max(1, config.perf.runs));
    const runs: Metrics[] = [];
    for (let i = 0; i < Math.max(1, config.perf.runs); i += 1) runs.push(await measure(page, url));

    const result = {
      lcp: median(runs.map((r) => r.lcp)),
      cls: median(runs.map((r) => r.cls)),
      ttfb: median(runs.map((r) => r.ttfb)),
      jsKb: median(runs.map((r) => r.jsKb)),
    };
    const suffix = `\n  runs: ${runs.map((r) => `lcp=${r.lcp}ms cls=${r.cls} ttfb=${r.ttfb}ms js=${r.jsKb}kb`).join('\n        ')}`;

    expect(result.ttfb, `TTFB ${result.ttfb}ms > ${config.perf.ttfbMs}ms${suffix}`).toBeLessThanOrEqual(config.perf.ttfbMs);
    expect(result.lcp, `LCP ${result.lcp}ms > ${config.perf.lcpMs}ms${suffix}`).toBeLessThanOrEqual(config.perf.lcpMs);
    expect(result.cls, `CLS ${result.cls} > ${config.perf.cls}${suffix}`).toBeLessThanOrEqual(config.perf.cls);
    expect(result.jsKb, `JS transfer ${result.jsKb}kB > ${config.perf.jsTransferKb}kB${suffix}`).toBeLessThanOrEqual(config.perf.jsTransferKb);
  });
}

test('DOM size stays within a maintainable bound', async ({ page }) => {
  await page.goto(TARGETS[0]!, { waitUntil: 'load' });
  const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
  expect(nodes, `${nodes} DOM nodes — Lighthouse warns above 800, fails above 1400`).toBeLessThan(1400);
});

test('no render-blocking third-party script in <head>', async ({ page }) => {
  await page.goto(TARGETS[0]!, { waitUntil: 'domcontentloaded' });
  const blocking = await page.evaluate(() =>
    [...document.querySelectorAll('head script[src]')]
      .filter((s) => !(s as HTMLScriptElement).async && !(s as HTMLScriptElement).defer && !(s as HTMLScriptElement).type.includes('module'))
      .map((s) => (s as HTMLScriptElement).src)
      .filter((src) => !new URL(src).host.endsWith(new URL(location.href).host)),
  );
  expect(blocking, `third-party render-blocking scripts in <head>:\n${blocking.join('\n')}`).toEqual([]);
});
