import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { z } from 'zod';

/**
 * Contract checks for systems checklist rows 5, 17, 26 and 51: the wire format other
 * teams depend on must not drift, and additive changes must stay compatible.
 *
 *   CONTRACT_URL=https://staging.example.com/api/orders/123 npx tsx --test contract/*.test.ts
 */

const URL_UNDER_TEST = process.env.CONTRACT_URL;
const skip = URL_UNDER_TEST ? false : 'set CONTRACT_URL to a live endpoint to validate';

const Order = z
  .object({
    id: z.string().min(1),
    status: z.enum(['pending', 'paid', 'failed', 'refunded']),
    amount: z.number().int().nonnegative(),
    currency: z.string().length(3),
    createdAt: z.string().datetime(),
    items: z
      .array(
        z.object({
          sku: z.string().min(1),
          quantity: z.number().int().positive(),
          unitAmount: z.number().int().nonnegative(),
        }),
      )
      .min(1),
  })
  .passthrough(); // additive fields are allowed; that is how v1 stays compatible

const ErrorEnvelope = z
  .object({
    error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }).passthrough(),
  })
  .passthrough();

test('live response matches the published schema', { skip }, async () => {
  const res = await fetch(URL_UNDER_TEST!);
  assert.ok(res.status < 500, `server error: ${res.status}`);

  const body = await res.json();
  if (res.status >= 400) {
    const parsed = ErrorEnvelope.safeParse(body);
    if (!parsed.success) assert.fail(`error body drifted: ${parsed.error.message}`);
    return;
  }

  const parsed = Order.safeParse(body);
  if (!parsed.success) assert.fail(`response drifted from contract:\n${parsed.error.message}`);

  // Business invariant: the total must equal the sum of line items.
  const total = parsed.data.items.reduce((sum, i) => sum + i.unitAmount * i.quantity, 0);
  assert.equal(total, parsed.data.amount, 'amount does not equal the sum of line items');
});

test('additive changes keep backwards compatibility', () => {
  const dir = path.join(import.meta.dirname, 'fixtures');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const fixture = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    const parsed = Order.safeParse(fixture);
    if (!parsed.success) assert.fail(`${file} no longer parses:\n${parsed.error.message}`);
  }
});

test('error envelope always carries a request id', { skip }, async () => {
  const base = URL_UNDER_TEST!.replace(/\/[^/]+$/, '');
  const res = await fetch(`${base}/__contract_probe_${Date.now()}`);
  assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
  const parsed = ErrorEnvelope.safeParse(await res.json().catch(() => ({})));
  assert.ok(parsed.success, 'error envelope missing code/message/requestId');
});
