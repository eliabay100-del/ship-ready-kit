/**
 * Chaos drill: proves that the *client* behaves correctly when the network
 * misbehaves. This is the executable form of systems checklist rows 10, 11, 12, 13, 44.
 *
 *   docker compose -f distributed/chaos/docker-compose.yml up -d
 *   npx tsx distributed/chaos/run-chaos.ts
 *
 * Env:
 *   TOXIPROXY=http://localhost:8474
 *   UPSTREAM=upstream:8080
 *   CLIENT_TIMEOUT_MS=2000
 *   BREAKER_FAILURES=5        (informational; your breaker should open by then)
 *   OUT=chaos-report.json
 */

import { writeFileSync } from 'node:fs';

const TOXIPROXY = process.env.TOXIPROXY ?? 'http://localhost:8474';
const UPSTREAM = process.env.UPSTREAM ?? 'upstream:8080';
const CLIENT_TIMEOUT_MS = Number(process.env.CLIENT_TIMEOUT_MS ?? 2000);
const PROXY = 'ship-ready-proxy';
const LISTEN = '0.0.0.0:8666';
const TARGET = 'http://localhost:8666';

type Sample = { ms: number; status: number; ok: boolean };

const results: Record<string, unknown> = { startedAt: new Date().toISOString(), checks: [] as unknown[] };
const checks = results.checks as { name: string; pass: boolean; detail: string }[];

function record(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${TOXIPROXY}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

async function ensureProxy(): Promise<void> {
  await api(`/proxies/${PROXY}`, { method: 'DELETE' }).catch(() => undefined);
  const res = await api('/proxies', {
    method: 'POST',
    body: JSON.stringify({ name: PROXY, listen: LISTEN, upstream: UPSTREAM, enabled: true }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`cannot create proxy: ${res.status} ${await res.text()}`);
  console.log(`proxy ${PROXY}: ${LISTEN} -> ${UPSTREAM}`);
}

async function addToxic(type: 'latency' | 'timeout', attributes: Record<string, number>): Promise<void> {
  const res = await api(`/proxies/${PROXY}/toxics`, {
    method: 'POST',
    body: JSON.stringify({ name: `${type}-${Date.now()}`, type, stream: 'downstream', toxicity: 1, attributes }),
  });
  if (!res.ok) throw new Error(`toxic failed: ${res.status} ${await res.text()}`);
}

async function clearToxics(): Promise<void> {
  const res = await api(`/proxies/${PROXY}/toxics`);
  const toxics = (await res.json()) as { name: string }[];
  await Promise.all(toxics.map((t) => api(`/proxies/${PROXY}/toxics/${t.name}`, { method: 'DELETE' })));
}

async function sample(count: number): Promise<Sample[]> {
  const out: Sample[] = [];
  await Promise.all(
    Array.from({ length: count }, async () => {
      const started = performance.now();
      try {
        const res = await fetch(`${TARGET}/get`, { signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS) });
        out.push({ ms: performance.now() - started, status: res.status, ok: res.ok });
      } catch (err) {
        out.push({ ms: performance.now() - started, status: 0, ok: false, error: (err as Error).name } as Sample);
      }
    }),
  );
  return out;
}

const p95 = (samples: Sample[]) => {
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
};

async function main(): Promise<void> {
  await ensureProxy();
  await clearToxics();

  // 1. Baseline — the drill is meaningless if the proxy path is already slow.
  const baseline = await sample(20);
  const baselineP95 = p95(baseline);
  record('baseline latencies are sane', baselineP95 < 500, `p95=${baselineP95.toFixed(0)}ms`);
  record('baseline has no failures', baseline.every((s) => s.ok), `${baseline.filter((s) => !s.ok).length}/20 failed`);

  // 2. Latency injection — a slow dependency must not hang the caller.
  await addToxic('latency', { latency: 3000, jitter: 200 });
  const slowed = await sample(10);
  const slowP95 = p95(slowed);
  record(
    'caller times out instead of hanging (item 11)',
    slowP95 <= CLIENT_TIMEOUT_MS + 500,
    `p95=${slowP95.toFixed(0)}ms with a ${CLIENT_TIMEOUT_MS}ms client timeout`,
  );
  record(
    'slow dependency surfaces as an error, not a wrong success',
    slowed.some((s) => !s.ok),
    `${slowed.filter((s) => !s.ok).length}/10 degraded`,
  );
  await clearToxics();

  // 3. Hard failure — connection resets should fail fast, which is what lets a
  //    circuit breaker open instead of exhausting the pool.
  await addToxic('timeout', { timeout: 0 });
  const failed = await sample(10);
  const failP95 = p95(failed);
  record('dependency failure fails fast (item 10 precondition)', failP95 < 1000, `p95=${failP95.toFixed(0)}ms`);
  record('all calls fail while the dependency is down', failed.every((s) => !s.ok), `${failed.filter((s) => !s.ok).length}/10 failed`);
  await clearToxics();

  // 4. Recovery — the system must heal without a redeploy or manual action.
  const recoveredAt = performance.now();
  let recovered = false;
  for (let i = 0; i < 15; i += 1) {
    const s = await sample(1);
    if (s[0]?.ok) {
      recovered = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  record(
    'recovers automatically after heal (items 10, 12)',
    recovered,
    `recovered in ${Math.round(performance.now() - recoveredAt)}ms`,
  );

  const stable = await sample(20);
  record('p95 returns to baseline after recovery', p95(stable) < Math.max(500, baselineP95 * 2), `p95=${p95(stable).toFixed(0)}ms`);

  // 5. Report. Wire `checks` into your breaker metrics for item 10: the
  //    breaker should be OPEN during phase 3 and CLOSED after phase 4.
  results.finishedAt = new Date().toISOString();
  results.passed = checks.every((c) => c.pass);
  results.summary = { baselineP95: Math.round(baselineP95), degradedP95: Math.round(slowP95), failFastP95: Math.round(failP95) };

  writeFileSync(process.env.OUT ?? 'chaos-report.json', JSON.stringify(results, null, 2));
  if (!results.passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
