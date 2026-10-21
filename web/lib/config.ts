import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.LAUNCH_CONFIG
  ? path.resolve(process.env.LAUNCH_CONFIG)
  : path.join(here, '..', 'launch.config.json');

export interface FormFieldSpec {
  /** CSS selector, or a `name` attribute when prefixed with `name=`. */
  selector: string;
  value: string;
  required?: boolean;
  type?: 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'select' | 'checkbox';
}

export interface FormSpec {
  name: string;
  path: string;
  submitSelector: string;
  fields: FormFieldSpec[];
  /** Text/regex that proves submission succeeded. */
  successMarker?: string;
  /** Optional: proves the backend de-duplicates retries. */
  idempotency?: { url: string; header: string; body: Record<string, unknown> };
  /** Opt-in only. Never run against production. */
  rateLimit?: { url: string; requests: number; expectStatus: number };
}

export interface LaunchConfig {
  baseURL: string;
  crawl: { maxPages: number; maxDepth: number; concurrency: number; exclude: string[] };
  requiredPaths: string[];
  legal: { privacy: string; terms: string };
  cta: { anyOf: string[] };
  faq: { paths: string[]; requireFaqSchema: boolean };
  seo: {
    titleMin: number;
    titleMax: number;
    descriptionMin: number;
    descriptionMax: number;
    ogImageMinWidth: number;
    ogImageMinHeight: number;
  };
  consent: {
    bannerSelector: string;
    acceptSelector: string;
    rejectSelector: string;
    settingsSelector: string;
  };
  analytics: { requestPatterns: string[]; cookiePatterns: string[] };
  forms: FormSpec[];
  perf: {
    lcpMs: number;
    cls: number;
    ttfbMs: number;
    jsTransferKb: number;
    runs: number;
  };
  mobile: {
    minTapTargetPx: number;
    minFontSizePx: number;
    maxStickyHeaderViewportRatio: number;
  };
  notFound: { markers: string[]; frameworkDefaultPatterns: string[] };
}

const raw = JSON.parse(readFileSync(configPath, 'utf8')) as LaunchConfig;

/** Typed config with env overrides, so CI can retarget without editing JSON. */
export const config: LaunchConfig = {
  ...raw,
  baseURL: (process.env.SITE_URL ?? raw.baseURL).replace(/\/+$/, ''),
  crawl: {
    ...raw.crawl,
    maxPages: Number(process.env.MAX_PAGES ?? raw.crawl.maxPages),
    maxDepth: Number(process.env.MAX_DEPTH ?? raw.crawl.maxDepth),
    concurrency: Number(process.env.CRAWL_CONCURRENCY ?? raw.crawl.concurrency),
  },
  perf: {
    ...raw.perf,
    runs: Number(process.env.PERF_RUNS ?? raw.perf.runs),
  },
};

export const analyticsRequestRe = new RegExp(config.analytics.requestPatterns.join('|'), 'i');
export const analyticsCookieRe = new RegExp(config.analytics.cookiePatterns.join('|'), 'i');

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** True when the URL belongs to the audited site. */
export function isInternal(url: string): boolean {
  return hostOf(url) === hostOf(config.baseURL);
}

/** Normalised key for de-duplicating URLs that differ only by trailing slash/hash. */
export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return `${u.origin}${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`;
  } catch {
    return url;
  }
}

export function isExcluded(pathname: string): boolean {
  return config.crawl.exclude.some((pattern) => new RegExp(pattern).test(pathname));
}
