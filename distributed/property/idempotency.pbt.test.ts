import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';

/**
 * Property-based checks for systems checklist items 14 (idempotency) and 39 (race conditions).
 *
 *   API_URL=https://staging.example.com npx tsx --test property/idempotency.pbt.test.ts
 *
 * Defaults assume a payments-style API; override the paths to fit yours.
 * This hits real infrastructure on purpose: mocks cannot prove exactly-once.
 */

const API = (process.env.API_URL ?? '').replace(/\/$/, '');
const POST_PATH = process.env.IDEMPOTENCY_PATH ?? '/api/payments';
const COUNT_PATH = process.env.COUNT_PATH ?? '/api/payments/count';
const KEY_HEADER = process.env.IDEMPOTENCY_HEADER ?? 'idempotency-key';
const skip = API ? false : 'set API_URL to a staging deployment with a real database';

interface Result {
  status: number;
  body: unknown;
  headers: Headers;
}

async function post(key: string, amount: number): Promise<Result> {
  const res = await fetch(`${API}${POST_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [KEY_HEADER]: key },
    body: JSON.stringify({ amount, currency: 'USD' }),
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

async function count(key: string): Promise<number> {
  const res = await fetch(`${API}${COUNT_PATH}?key=${encodeURIComponent(key)}`);
  assert.equal(res.status, 200, `count endpoint returned ${res.status}`);
  const data = (await res.json()) as { count?: number } | number;
  return typeof data === 'number' ? data : (data.count ?? 0);
}

const idOf = (body: unknown): string | undefined => {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    return String(record.id ?? record.paymentId ?? record.orderId ?? '');
  }
  return undefined;
};

test('concurrent retries with one key create exactly one side effect (item 14)', { skip }, async () => {
  // fast-check shrinks a failure by re-running with the same inputs. A stateful
  // API would then see a reused key, so every invocation gets a fresh key prefix.
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let invocation = 0;

  await fc.assert(
    fc.asyncProperty(fc.uuid(), fc.integer({ min: 1, max: 10_000 }), async (key, amount) => {
      const uniqueKey = `${runId}-${invocation++}-${key}`;
      const before = await count(uniqueKey);
      const results = await Promise.all(Array.from({ length: 6 }, () => post(uniqueKey, amount)));
      const after = await count(uniqueKey);

      const created = results.filter((r) => r.status >= 200 && r.status < 300);
      assert.ok(created.length >= 1, `no request succeeded: ${results.map((r) => r.status).join(',')}`);
      assert.equal(after - before, 1, `${after - before} side effects for one key`);
      assert.equal(after, 1, 'side effect was not recorded exactly once');

      const ids = new Set(created.map((r) => idOf(r.body)).filter(Boolean));
      assert.equal(ids.size, 1, `repeats returned different ids: ${[...ids].join(', ')}`);

      for (const r of results) {
        assert.ok(r.status < 500, `retry produced a server error: ${r.status}`);
      }
    }),
    { numRuns: Number(process.env.PBT_RUNS ?? 10) },
  );
});

test('same key with a different payload is rejected (item 14)', { skip }, async () => {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let invocation = 0;

  await fc.assert(
    fc.asyncProperty(fc.uuid(), fc.integer({ min: 1, max: 500 }), fc.integer({ min: 501, max: 1000 }), async (key, a, b) => {
      const uniqueKey = `${runId}-${invocation++}-${key}`;
      const first = await post(uniqueKey, a);
      const second = await post(uniqueKey, b);
      assert.ok(first.status < 300, `first request failed: ${first.status}`);
      assert.ok(
        [409, 422].includes(second.status),
        `key reuse with a different body returned ${second.status}, expected 409/422`,
      );
    }),
    { numRuns: 5 },
  );
});

test('no double spend under concurrent identical debits (item 39)', { skip }, async (t) => {
  // Requires a balance-style endpoint. Set DEBIT_PATH/BALANCE_PATH to enable.
  const debitPath = process.env.DEBIT_PATH;
  const balancePath = process.env.BALANCE_PATH;
  if (!debitPath || !balancePath) {
    t.skip('set DEBIT_PATH and BALANCE_PATH to enable the overspend property');
    return;
  }

  await fc.assert(
    fc.asyncProperty(fc.uuid(), async (account) => {
      const res = await fetch(`${API}${balancePath}?account=${account}`);
      const { balance } = (await res.json()) as { balance: number };
      const attempts = 3 * balance + 5;
      const outcomes = await Promise.all(
        Array.from({ length: attempts }, () =>
          fetch(`${API}${debitPath}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ account, amount: 1 }),
          }).then((r) => r.status),
        ),
      );

      const final = (await (await fetch(`${API}${balancePath}?account=${account}`)).json()) as { balance: number };
      assert.equal(final.balance, 0, `balance ended at ${final.balance}, expected 0`);
      assert.equal(outcomes.filter((s) => s < 300).length, balance, 'wrong number of debits succeeded');
      assert.ok(!outcomes.some((s) => s >= 500), 'contention produced 5xx');
    }),
    { numRuns: 3 },
  );
});
