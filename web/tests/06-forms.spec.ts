import { test, expect } from '@playwright/test';
import { config } from '../lib/config';

/**
 * Covers site checklist #18 (test forms): required-field enforcement, happy path,
 * injection safety, oversize input, idempotent retries, and rate limiting.
 * All of it is driven by `forms` in launch.config.json — nothing is hard-coded.
 */

const forms = config.forms;

test.describe('Forms (site checklist #18)', () => {
  test.skip(forms.length === 0, 'No forms configured. Add entries to `forms` in launch.config.json.');

  for (const spec of forms) {
    test.describe(spec.name, () => {
      const fill = async (page: import('@playwright/test').Page, overrides: Record<string, string> = {}) => {
        for (const field of spec.fields) {
          const locator = field.selector.startsWith('name=')
            ? page.locator(`[name="${field.selector.slice(5)}"]`)
            : page.locator(field.selector);
          const value = overrides[field.selector] ?? field.value;
          if (field.type === 'checkbox') {
            const checked = await locator.isChecked().catch(() => false);
            if (!checked) await locator.check();
          } else if (field.type === 'select') {
            await locator.selectOption({ label: value }).catch(() => locator.selectOption(value));
          } else {
            await locator.fill(value);
          }
        }
      };

      test('required fields are enforced with an accessible error', async ({ page }) => {
        await page.goto(spec.path, { waitUntil: 'domcontentloaded' });
        await page.locator(spec.submitSelector).first().click();

        const outcome = await page.evaluate(() => {
          const form = document.querySelector('form');
          const nativeInvalid = form ? !form.checkValidity() : false;
          const ariaInvalid = document.querySelectorAll('[aria-invalid="true"]').length;
          const alerts = [...document.querySelectorAll('[role="alert"], .error, .field-error, [data-error]')].filter(
            (el) => (el as HTMLElement).offsetParent !== null && (el.textContent ?? '').trim().length > 0,
          ).length;
          return { nativeInvalid, ariaInvalid, alerts };
        });

        expect(
          outcome.nativeInvalid || outcome.ariaInvalid > 0 || outcome.alerts > 0,
          'submitting an empty form produced no validation signal (no :invalid, aria-invalid, or error text)',
        ).toBe(true);
      });

      test('happy path submits', async ({ page }) => {
        await page.goto(spec.path, { waitUntil: 'domcontentloaded' });
        await fill(page);

        const dialogs: string[] = [];
        page.on('dialog', async (d) => {
          dialogs.push(d.message());
          await d.dismiss();
        });

        const response = page.waitForResponse((r) => r.request().method() !== 'GET', { timeout: 15_000 }).catch(() => null);
        await page.locator(spec.submitSelector).first().click();
        const res = await response;
        expect(res?.status() ?? 200, `submit returned ${res?.status()}`).toBeLessThan(500);

        if (spec.successMarker) {
          await expect(page.getByText(new RegExp(spec.successMarker, 'i')).first(), 'no success confirmation').toBeVisible({ timeout: 15_000 });
        }
        expect(dialogs, 'form triggered a native dialog (JS error path?)').toEqual([]);
      });

      test('input is escaped, not executed (XSS)', async ({ page }) => {
        const payload = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`;
        await page.goto(spec.path, { waitUntil: 'domcontentloaded' });
        await fill(page, Object.fromEntries(spec.fields.map((f) => [f.selector, payload])));

        await page.locator(spec.submitSelector).first().click();
        await page.waitForTimeout(1500);

        const executed = await page.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? 0);
        expect(executed, 'submitted markup executed in the page (DOM XSS)').toBe(0);

        // If the payload is echoed, it must be as text, not as a live element.
        const injected = await page.locator('img[src="x"]').count();
        expect(injected, 'injected <img> became a DOM element (unescaped reflection)').toBe(0);
      });

      test('oversize input is bounded or rejected, never a 5xx', async ({ page }) => {
        await page.goto(spec.path, { waitUntil: 'domcontentloaded' });
        const huge = 'A'.repeat(10_000);
        const textFields = spec.fields.filter((f) => !f.type || ['text', 'textarea', 'email', 'tel', 'url'].includes(f.type));
        test.skip(textFields.length === 0, 'no free-text field');

        for (const field of textFields.slice(0, 2)) {
          const locator = field.selector.startsWith('name=')
            ? page.locator(`[name="${field.selector.slice(5)}"]`)
            : page.locator(field.selector);
          await locator.fill(huge);
          const accepted = await locator.inputValue();
          expect(accepted.length, `no maxlength on ${field.selector} (10k chars accepted client-side)`).toBeLessThan(10_000);
        }

        const responsePromise = page.waitForResponse((r) => r.request().method() !== 'GET', { timeout: 15_000 }).catch(() => null);
        await page.locator(spec.submitSelector).first().click();
        const res = await responsePromise;
        if (res) expect(res.status(), 'oversize submission caused a server error').toBeLessThan(500);
      });

      test('retries are idempotent (no duplicate side effects)', async ({ request }) => {
        test.skip(!spec.idempotency, 'no `idempotency` block configured for this form');
        const { url, header, body } = spec.idempotency!;
        const key = `ship-ready-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const send = () =>
          request.post(url, {
            headers: { [header]: key, 'content-type': 'application/json' },
            data: body,
            failOnStatusCode: false,
          });

        const [first, second] = await Promise.all([send(), send()]);
        const firstBody = await first.text();
        const secondBody = await second.text();

        expect([first.status(), second.status()].some((s) => s < 300), 'neither retry succeeded').toBe(true);
        const statuses = [first.status(), second.status()];
        expect(statuses.every((s) => s < 500), `retry produced a 5xx: ${statuses.join(',')}`).toBe(true);
        expect(
          statuses[0] === statuses[1] || statuses.includes(409),
          `retry returned inconsistent statuses: ${statuses.join(',')}`,
        ).toBe(true);

        const id = (raw: string) => raw.match(/"(?:id|orderId|reference)"\s*:\s*"?([\w-]+)"?/)?.[1] ?? raw;
        expect(id(secondBody), `duplicate side effect: first=${firstBody.slice(0, 200)} second=${secondBody.slice(0, 200)}`).toBe(id(firstBody));
      });

      test('rate limiting returns 429 with Retry-After (opt-in)', async ({ request }) => {
        test.skip(!spec.rateLimit, 'no `rateLimit` block configured — never run this against production');
        const { url, requests, expectStatus } = spec.rateLimit!;
        const statuses: number[] = [];
        let retryAfter: string | null = null;

        for (let i = 0; i < requests; i += 1) {
          const res = await request.post(url, { data: {}, failOnStatusCode: false });
          statuses.push(res.status());
          retryAfter ??= res.headers()['retry-after'] ?? null;
        }

        expect(statuses, `expected some ${expectStatus} responses, got ${statuses.join(',')}`).toContain(expectStatus);
        expect(retryAfter, '429 without a Retry-After header').toBeTruthy();
        expect(statuses.filter((s) => s >= 500), 'rate limiting leaked 5xx errors').toEqual([]);
      });
    });
  }
});
