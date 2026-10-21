import { load } from 'cheerio';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isExcluded, isInternal, urlKey } from './config';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(here, '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'crawl.json');
const UA = 'ship-ready-audit/1.0 (+launch-gate)';
const TIMEOUT_MS = 15_000;
const HTML_EXT = /\.(?:html?|php|asp|aspx|jsp)$/i;
const NON_HTML = /\.(?:pdf|zip|png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|csv|xlsx?|docx?|mp4|webm|mp3|woff2?|ttf)$/i;

export interface LinkCheck {
  url: string;
  status: number;
  ok: boolean;
  error?: string;
}

export interface PageResult {
  url: string;
  path: string;
  status: number;
  contentType: string | null;
  redirectChain: string[];
  title: string | null;
  description: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  lang: string | null;
  viewport: string | null;
  h1: string[];
  headings: { level: number; text: string }[];
  images: { src: string; alt: string | null }[];
  links: string[];
  og: Record<string, string>;
  twitter: Record<string, string>;
  jsonLdCount: number;
  hasDetails: boolean;
  textLength: number;
  htmlBytes: number;
  ttfbMs: number;
  error?: string;
}

export interface SitemapResult {
  status: number;
  urls: string[];
  childSitemaps: string[];
  error?: string;
}

export interface CrawlResult {
  baseURL: string;
  startedAt: string;
  pages: PageResult[];
  linkChecks: LinkCheck[];
  externalLinks: string[];
  brokenLinks: LinkCheck[];
  robotsTxt: { status: number; body: string; sitemaps: string[] };
  sitemap: SitemapResult;
  notFound: { status: number; bodySnippet: string; error?: string };
  durationMs: number;
}

interface Fetched {
  status: number;
  finalUrl: string;
  chain: string[];
  body: string;
  contentType: string | null;
  ttfbMs: number;
}

async function fetchWithChain(url: string, maxHops = 6): Promise<Fetched> {
  const chain: string[] = [];
  let current = url;
  const started = performance.now();

  for (let hop = 0; hop <= maxHops; hop += 1) {
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    chain.push(current);

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = new URL(location, current).toString();
      continue;
    }

    const body = await res.text();
    return {
      status: res.status,
      finalUrl: current,
      chain,
      body,
      contentType: res.headers.get('content-type'),
      ttfbMs: Math.round(performance.now() - started),
    };
  }

  throw new Error(`redirect chain longer than ${maxHops}: ${chain.join(' -> ')}`);
}

export async function checkUrl(url: string): Promise<LinkCheck> {
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': UA, range: 'bytes=0-2047' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    }
    await res.body?.cancel();
    return { url, status: res.status, ok: res.status >= 200 && res.status < 400 };
  } catch (err) {
    return { url, status: 0, ok: false, error: (err as Error).message };
  }
}

function parsePage(url: string, fetched: Fetched): PageResult {
  const $ = load(fetched.body);
  const meta = (name: string) => $(`meta[name="${name}"]`).attr('content')?.trim() ?? null;
  const prop = (p: string) => $(`meta[property="${p}"]`).attr('content')?.trim() ?? null;
  const tw = (name: string) => $(`meta[name="twitter:${name}"]`).attr('content')?.trim() ?? null;
  const abs = (href: string | undefined): string | null => {
    if (!href) return null;
    try {
      return new URL(href, fetched.finalUrl).toString();
    } catch {
      return null;
    }
  };

  const images: { src: string; alt: string | null }[] = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src') ?? $(el).attr('data-src') ?? '';
    if (!src || src.startsWith('data:')) return;
    try {
      images.push({ src: new URL(src, fetched.finalUrl).toString(), alt: $(el).attr('alt') ?? null });
    } catch {
      /* malformed src — reported by the broken-link spec if it matters */
    }
  });

  const links: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (!href || /^(?:mailto:|tel:|javascript:|sms:)/i.test(href)) return;
    const resolved = abs(href);
    if (resolved) links.push(resolved);
  });

  const headings: { level: number; text: string }[] = [];
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    const tag = ($(el).prop('tagName') as string | undefined) ?? 'h2';
    headings.push({ level: Number(tag.slice(1)), text: $(el).text().replace(/\s+/g, ' ').trim() });
  });

  return {
    url: fetched.finalUrl,
    path: new URL(fetched.finalUrl).pathname || '/',
    status: fetched.status,
    contentType: fetched.contentType,
    redirectChain: fetched.chain,
    title: $('title').first().text().replace(/\s+/g, ' ').trim() || null,
    description: meta('description'),
    canonical: abs($('link[rel="canonical"]').attr('href')),
    robotsMeta: meta('robots'),
    lang: $('html').attr('lang')?.trim() ?? null,
    viewport: meta('viewport'),
    h1: headings.filter((h) => h.level === 1).map((h) => h.text),
    headings,
    images,
    links,
    og: {
      title: prop('og:title') ?? '',
      description: prop('og:description') ?? '',
      image: prop('og:image') ?? '',
      url: prop('og:url') ?? '',
      type: prop('og:type') ?? '',
      siteName: prop('og:site_name') ?? '',
    },
    twitter: { card: tw('card') ?? '', title: tw('title') ?? '', image: tw('image') ?? '' },
    jsonLdCount: $('script[type="application/ld+json"]').length,
    hasDetails: $('details').length > 0,
    textLength: $('body').text().replace(/\s+/g, ' ').trim().length,
    htmlBytes: Buffer.byteLength(fetched.body),
    ttfbMs: fetched.ttfbMs,
  };
}

function parseSitemapXml(xml: string): { urls: string[]; childSitemaps: string[] } {
  const $ = load(xml, { xmlMode: true });
  const urls: string[] = [];
  const childSitemaps: string[] = [];
  $('url > loc').each((_, el) => {
    urls.push($(el).text().trim());
  });
  $('sitemap > loc').each((_, el) => {
    childSitemaps.push($(el).text().trim());
  });
  return { urls: urls.filter(Boolean), childSitemaps: childSitemaps.filter(Boolean) };
}

async function readSitemap(baseURL: string): Promise<SitemapResult> {
  try {
    const res = await fetch(`${baseURL}/sitemap.xml`, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const xml = await res.text();
    const { urls, childSitemaps } = parseSitemapXml(xml);

    const children: string[] = [];
    if (urls.length === 0 && childSitemaps.length > 0) {
      for (const child of childSitemaps.slice(0, 10)) {
        try {
          const childRes = await fetch(child, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
          const parsed = parseSitemapXml(await childRes.text());
          urls.push(...parsed.urls);
          children.push(child);
        } catch {
          /* reported by the spec as a broken sitemap child */
        }
      }
    }

    return { status: res.status, urls: [...new Set(urls)], childSitemaps, error: undefined };
  } catch (err) {
    return { status: 0, urls: [], childSitemaps: [], error: (err as Error).message };
  }
}

async function readRobots(baseURL: string) {
  try {
    const res = await fetch(`${baseURL}/robots.txt`, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    const sitemaps = [...body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1] ?? '');
    return { status: res.status, body, sitemaps };
  } catch {
    return { status: 0, body: '', sitemaps: [] };
  }
}

async function probeNotFound(baseURL: string) {
  const url = `${baseURL}/__ship-ready-404-probe-${Date.now()}`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.text();
    return { status: res.status, bodySnippet: body.slice(0, 20_000) };
  } catch (err) {
    return { status: 0, bodySnippet: '', error: (err as Error).message };
  }
}

/**
 * Breadth-first crawl, one pass, shared by every spec.
 * The result is cached to disk so 8 spec files do not re-crawl the site 8 times.
 */
export async function crawlSite(): Promise<CrawlResult> {
  const started = Date.now();
  const base = config.baseURL;
  const origin = new URL(base).origin;

  const queue: { url: string; depth: number }[] = [{ url: base, depth: 0 }];
  const seen = new Set<string>([urlKey(base)]);
  const pageKeys = new Set<string>();
  const pages: PageResult[] = [];
  const linkChecks = new Map<string, LinkCheck>();
  const external = new Set<string>();

  const enqueue = (url: string, depth: number) => {
    if (!isInternal(url)) {
      external.add(url);
      return;
    }
    if (isExcluded(new URL(url).pathname)) return;
    const key = urlKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    queue.push({ url, depth });
  };

  while (queue.length > 0 && pages.length < config.crawl.maxPages) {
    const batch = queue.splice(0, Math.max(1, config.crawl.concurrency));
    const results = await Promise.allSettled(
      batch.map(async ({ url, depth }) => {
        const fetched = await fetchWithChain(url);
        const isHtml = (fetched.contentType ?? '').includes('text/html');
        if (!isHtml) {
          linkChecks.set(url, { url, status: fetched.status, ok: fetched.status < 400 });
          return null;
        }
        const page = parsePage(url, fetched);
        for (const img of page.images) {
          if (isInternal(img.src) && !linkChecks.has(img.src)) {
            linkChecks.set(img.src, { url: img.src, status: -1, ok: true });
          }
        }
        if (depth < config.crawl.maxDepth) {
          for (const link of page.links) {
            const pathname = new URL(link).pathname;
            if (NON_HTML.test(pathname) && !HTML_EXT.test(pathname)) {
              if (!linkChecks.has(link)) linkChecks.set(link, { url: link, status: -1, ok: true });
              continue;
            }
            enqueue(link, depth + 1);
          }
        }
        return page;
      }),
    );

    for (const [i, settled] of results.entries()) {
      const requested = batch[i]?.url ?? '';
      if (settled.status === 'rejected') {
        const message = String((settled.reason as Error)?.message ?? settled.reason);
        pages.push({
          url: requested,
          path: new URL(requested).pathname || '/',
          status: 0,
          contentType: null,
          redirectChain: [requested],
          title: null,
          description: null,
          canonical: null,
          robotsMeta: null,
          lang: null,
          viewport: null,
          h1: [],
          headings: [],
          images: [],
          links: [],
          og: {},
          twitter: {},
          jsonLdCount: 0,
          hasDetails: false,
          textLength: 0,
          htmlBytes: 0,
          ttfbMs: 0,
          error: message,
        });
      } else if (settled.value) {
        const key = urlKey(settled.value.url);
        if (!pageKeys.has(key)) {
          pageKeys.add(key);
          pages.push(settled.value);
        }
      }
    }
  }

  // Probe the asset links we skipped during the crawl (one HEAD each, bounded).
  const unchecked = [...linkChecks.values()].filter((l) => l.status === -1).slice(0, 100);
  const assetChecks = await Promise.all(unchecked.map((l) => checkUrl(l.url)));
  for (const check of assetChecks) linkChecks.set(check.url, check);

  const [robotsTxt, sitemap, notFound] = await Promise.all([
    readRobots(base),
    readSitemap(base),
    probeNotFound(base),
  ]);

  const allChecks = [...linkChecks.values()];
  return {
    baseURL: base,
    startedAt: new Date().toISOString(),
    pages,
    linkChecks: allChecks,
    externalLinks: [...external],
    brokenLinks: allChecks.filter((l) => !l.ok && l.status !== 401 && l.status !== 403),
    robotsTxt,
    sitemap,
    notFound,
    durationMs: Date.now() - started,
  };
}

export function saveCrawl(result: CrawlResult): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(result, null, 2), 'utf8');
}

export function loadCrawl(): CrawlResult {
  if (!existsSync(CACHE_FILE)) {
    throw new Error(`No crawl snapshot at ${CACHE_FILE}. Run global setup (playwright will do it) or set REUSE_CRAWL=0.`);
  }
  return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as CrawlResult;
}

export function crawlIsFresh(maxAgeMs = 15 * 60 * 1000): boolean {
  return existsSync(CACHE_FILE) && Date.now() - statSync(CACHE_FILE).mtimeMs < maxAgeMs;
}
