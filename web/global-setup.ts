import { config } from './lib/config';
import { crawlIsFresh, crawlSite, saveCrawl } from './lib/crawl';

/**
 * Runs once per `playwright test` invocation.
 * Set REUSE_CRAWL=1 to reuse a snapshot younger than 15 minutes (fast local loops).
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.REUSE_CRAWL === '1' && crawlIsFresh()) {
    console.log('[crawl] reusing fresh snapshot');
    return;
  }

  console.log(`[crawl] starting at ${config.baseURL} (max ${config.crawl.maxPages} pages, depth ${config.crawl.maxDepth})`);
  const result = await crawlSite();
  saveCrawl(result);

  const failed = result.pages.filter((p) => p.error || p.status >= 500);
  console.log(
    `[crawl] ${result.pages.length} pages, ${result.linkChecks.length} URLs checked, ` +
      `${result.brokenLinks.length} broken, ${failed.length} errors in ${result.durationMs}ms`,
  );

  if (result.pages.length === 0) {
    throw new Error(`Nothing crawled at ${config.baseURL}. Is the site running?`);
  }
}
