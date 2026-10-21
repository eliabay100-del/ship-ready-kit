import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Load / spike / soak / stress profiles for systems checklist items 1, 3, 11-13, 44-47.
 *
 *   k6 run -e BASE_URL=https://staging.example.com -e SCENARIO=load scenarios.js
 *   SCENARIO=smoke|load|spike|soak|stress
 *
 * Never point this at production without an approved window and a kill switch.
 */

const BASE = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ENDPOINTS = (__ENV.ENDPOINTS || '/,/api/health').split(',').map((p) => p.trim());

const businessErrors = new Rate('business_errors');
const endpointLatency = new Trend('endpoint_latency', true);

const scenarios = {
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '10s',
    tags: { profile: 'smoke' },
  },
  load: {
    executor: 'ramping-arrival-rate',
    startRate: 10,
    timeUnit: '1s',
    preAllocatedVUs: 50,
    maxVUs: 300,
    stages: [
      { target: 50, duration: '2m' },
      { target: 50, duration: '5m' },
      { target: 0, duration: '30s' },
    ],
    tags: { profile: 'load' },
  },
  spike: {
    executor: 'ramping-arrival-rate',
    startRate: 5,
    timeUnit: '1s',
    preAllocatedVUs: 100,
    maxVUs: 600,
    stages: [
      { target: 5, duration: '30s' },
      { target: 250, duration: '30s' }, // 50x in 30s: does autoscaling/backpressure hold?
      { target: 250, duration: '2m' },
      { target: 5, duration: '30s' },
    ],
    tags: { profile: 'spike' },
  },
  soak: {
    executor: 'constant-arrival-rate',
    rate: 40,
    timeUnit: '1s',
    duration: '30m',
    preAllocatedVUs: 60,
    maxVUs: 200,
    tags: { profile: 'soak' }, // catches memory leaks / FD growth (item 41)
  },
  stress: {
    executor: 'ramping-arrival-rate',
    startRate: 20,
    timeUnit: '1s',
    preAllocatedVUs: 100,
    maxVUs: 800,
    stages: [
      { target: 100, duration: '2m' },
      { target: 300, duration: '2m' },
      { target: 500, duration: '2m' }, // find the knee, not just pass
    ],
    tags: { profile: 'stress' },
  },
};

const selected = __ENV.SCENARIO;
if (selected && !scenarios[selected]) {
  throw new Error(`Unknown SCENARIO "${selected}". Use one of: ${Object.keys(scenarios).join(', ')}`);
}

export const options = {
  scenarios: selected ? { [selected]: scenarios[selected] } : { smoke: scenarios.smoke },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
    business_errors: ['rate<0.005'],
    checks: ['rate>0.99'],
    // Backpressure check: under stress, latency must not grow without bound.
    'http_req_duration{profile:spike}': ['p(95)<2000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: false,
};

export default function () {
  for (const path of ENDPOINTS) {
    const res = http.get(`${BASE}${path}`, {
      tags: { endpoint: path },
      timeout: '10s',
    });

    endpointLatency.add(res.timings.duration, { endpoint: path });

    const ok = check(res, {
      'status is 2xx/3xx': (r) => r.status >= 200 && r.status < 400,
      'no 5xx': (r) => r.status < 500,
      'responded under 2s': (r) => r.timings.duration < 2000,
      'has content-type': (r) => !!r.headers['Content-Type'],
    });

    if (!ok) businessErrors.add(true, { endpoint: path });
  }

  sleep(Number(__ENV.PAUSE ?? 0.2));
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 0;
  const failed = data.metrics.http_req_failed?.values?.rate ?? 0;
  return {
    stdout: `\nprofile=${selected ?? 'smoke'} p95=${p95.toFixed(0)}ms error_rate=${(failed * 100).toFixed(2)}%\n`,
    'k6-summary.json': JSON.stringify(data, null, 2),
  };
}
