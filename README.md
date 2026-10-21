# Ship-ready kit

A launch gate you can actually run: **20 pre-launch website checks** and **53
distributed-systems invariants**, each expressed as an automated test, a
scheduled drill, or a written waiver. It ships with a reference site that proves
the suite itself works.

![CI](https://github.com/eliabay100-del/ship-ready-kit/actions/workflows/ci.yml/badge.svg)
![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

This is not a reading list. Every row has an observable assertion and a command
that can fail.

## What's in the box

| Path | What it is |
|---|---|
| [`CHECKLISTS.md`](./CHECKLISTS.md) | The two checklists, grouped and defined |
| [`web/`](./web) | Playwright suite for the 20 site checks, driven by one config file |
| [`distributed/53-invariants.yml`](./distributed/53-invariants.yml) | 53 invariants with fault injection, assertions, priority, and tooling |
| [`distributed/`](./distributed) | k6 profiles, Toxiproxy chaos drill, property tests, contract tests, SQL invariants |
| [`security/`](./security) | Threat model, ASVS-style checklist, PowerShell scanner runner |
| [`docs/ADDITIONAL-KITS.md`](./docs/ADDITIONAL-KITS.md) | What the two lists miss: data, disaster recovery, rollback, ops, launch day |
| [`docs/TRACEABILITY.md`](./docs/TRACEABILITY.md) | Every requirement mapped to a test or drill, with honest status |
| [`PROMPT.md`](./PROMPT.md) | A senior-engineer operating prompt for a coding agent |

## Requirements

- Node.js 20+
- Docker (chaos drill only)
- k6 (load scenarios only)
- PowerShell 5.1+ or PowerShell 7 (security scanner only)

## Quick start: audit a site

```bash
git clone https://github.com/eliabay100-del/ship-ready-kit.git ship-ready-kit
cd ship-ready-kit/web
npm install
npx playwright install chromium

# audit any site without editing a file
SITE_URL=https://example.com npx playwright test --reporter=list
```

Windows PowerShell:

```powershell
$env:SITE_URL = "https://example.com"
npx playwright test --reporter=list
```

The crawler runs once in `global-setup.ts` and caches its result in
`web/.cache/crawl.json`. Eight specs read that snapshot, so the site is crawled
once instead of eight times.

### Configure it for your project

```bash
cp launch.config.json launch.config.local.json
LAUNCH_CONFIG=./launch.config.local.json npx playwright test
```

`*.local.json` is git-ignored, so project selectors and staging URLs stay out of
the repo. The fields that usually need editing:

| Field | Set it to |
|---|---|
| `baseURL` | your staging or preview URL |
| `requiredPaths` | pages that must exist even when nothing links to them |
| `legal.privacy`, `legal.terms` | the real paths (not `/privacy-policy-2`) |
| `cta.anyOf` | the actual CTA copy you ship |
| `consent.*` | banner, accept, reject, and settings selectors |
| `forms[]` | one entry per form: fields, submit button, success marker, optional idempotency/rate-limit probes |
| `seo.*`, `perf.*`, `mobile.*` | budgets you are willing to enforce |
| `crawl.exclude` | destructive, authenticated, or infinite paths |

Environment overrides: `SITE_URL`, `LAUNCH_CONFIG`, `MAX_PAGES`, `MAX_DEPTH`,
`CRAWL_CONCURRENCY`, `PERF_RUNS`.

Never point `forms[].rateLimit` at production. The suite sends deliberately
malformed and oversized requests.

### What each spec covers

| Spec | Checklist items | Fails on |
|---|---|---|
| `01-crawl-and-links` | 5, 6, 7, 19 | broken internal links, redirect chains, missing/short `robots.txt`, missing `sitemap.xml`, soft-404s, framework error pages served as 404 |
| `02-seo-and-metadata` | 8, 10, 11, 12, 13, 14 | missing/duplicate/overlong titles and descriptions, missing canonical, incomplete Open Graph/Twitter tags, missing or undersized preview image, missing favicon, images without `alt` |
| `03-accessibility` | 17 | axe-core WCAG 2.1 AA violations, no keyboard bypass, invisible focus, motion not honoring `prefers-reduced-motion` |
| `04-content-and-legal` | 1, 2, 3, 4 | missing privacy/terms pages, no CTA, no FAQ, lorem ipsum or placeholder copy |
| `05-mobile-and-responsive` | 16 | horizontal overflow at 360px, tap targets under budget, unreadably small text, sticky header eating the viewport, unreachable nav |
| `06-forms` | 18 | required fields accepted empty, XSS reflected, oversized input accepted, duplicate submission not deduplicated, missing rate limit (opt-in) |
| `07-consent-and-analytics` | 9, 15 | analytics requests or cookies before consent, reject not persisted, accept not persisted, dark-pattern button hierarchy |
| `08-performance-budgets` | 20 | LCP, CLS, TTFB, transferred JS, DOM size, or blocking scripts over budget |

Lighthouse CI adds the standard report: `npm run test:lhci`.

## Prove the suite works

The repository ships a reference site that should pass every check. Run the
audit against it to test the tests:

```bash
cd web
npm run test:fixtures -- --reporter=line
```

This starts the fixture site on port 4173, points the suite at
`launch.config.fixture.json`, and runs all eight specs. At the time of writing
the baseline is **119 passed, 7 skipped**; the skips are checks whose selectors
or external services are intentionally absent, and each names its reason. If a
spec fails here, the bug is in the spec, not in your site.

## The 53 systems invariants

[`distributed/53-invariants.yml`](./distributed/53-invariants.yml) is a matrix,
not prose. Each row carries:

- `invariant` — the claim that must always hold;
- `break_it` — the fault or load that tries to falsify it;
- `assert` — the observable evidence that it held;
- `tooling` — the minimum viable toolchain;
- `layer` and `priority` (`P0` blocks release, `P1` needs an owner and a date).

```bash
cd distributed
npm install

# load profiles: smoke / load / spike / soak / stress
k6 run -e BASE_URL=https://staging.example.com -e SCENARIO=smoke k6/scenarios.js

# chaos: latency -> hard failure -> recovery, through Toxiproxy
docker compose -f chaos/docker-compose.yml up -d
npx tsx chaos/run-chaos.ts

# exactly-once under concurrent retries (real staging database)
API_URL=https://staging.example.com npm run pbt

# contract drift against a live endpoint
CONTRACT_URL=https://staging.example.com/api/orders/123 npm run contract

# SQL invariants, read-only snapshot
psql "$STAGING_DATABASE_URL" -f sql/invariants.sql
```

Scenarios are opt-in. Without `API_URL` or `CONTRACT_URL`, the property and
contract tests **skip with an explicit reason** instead of pretending to pass.

## Security baseline

```powershell
powershell -ExecutionPolicy Bypass -File security/run-security-scan.ps1 -Repo . -Url https://staging.example.com -FailOnHigh
```

The runner executes every scanner that is installed, writes JSON evidence to
`security/reports/`, and reports missing tools as `SKIP` — never `PASS`. The
threat model, auth/authz test matrix, and ASVS-style checklist live in
[`security/README.md`](./security/README.md).

## Use it with a coding agent

[`PROMPT.md`](./PROMPT.md) is an operating prompt for an agent doing launch
hardening. It encodes the rules that keep this honest:

1. **Evidence over claims.** Paste the command and its output; never report a
   result you did not observe.
2. **Never weaken a test to make it pass.** No silent skips, loosened
   assertions, or raised timeouts.
3. **No mocks inside E2E.** Mocks belong in unit and contract tests.
4. **Deterministic fixtures.** Seeded data, fixed clocks, isolated tenants.
5. **A row is done only when `docs/TRACEABILITY.md` says so.**

## Honest coverage

[`docs/TRACEABILITY.md`](./docs/TRACEABILITY.md) maps every requirement to a
spec or a drill and labels it:

| Label | Meaning |
|---|---|
| **runnable** | produces pass/fail today |
| **partial** | a test exists but needs app-specific bindings |
| **template** | invariant, fault, and assertion are written; no endpoint is bound yet |
| **drill** | a human exercise with a recorded result |

A green CI run does not mean "all 73 rows are covered". It means the rows marked
runnable passed. Everything else has an owner and a date, or it is not done.

## Repository layout

```text
ship-ready-kit/
├── CHECKLISTS.md               # 20 site checks + 53 systems concepts
├── PROMPT.md                   # agent operating prompt
├── web/                        # Playwright audit
│   ├── launch.config.json      # the only file most projects edit
│   ├── launch.config.fixture.json
│   ├── lib/                    # config loader + crawler
│   ├── tests/                  # 8 specs, one per concern
│   └── fixtures/               # reference site + self-test runner
├── distributed/                # systems invariants
│   ├── 53-invariants.yml       # the matrix
│   ├── k6/scenarios.js         # load profiles
│   ├── chaos/                  # Toxiproxy drill
│   ├── property/               # idempotency + race property tests
│   ├── contract/               # wire-format drift tests
│   └── sql/invariants.sql      # read-only data checks
├── security/                   # threat model + scanner runner
├── docs/                       # additional kits + traceability
└── .github/workflows/ci.yml
```

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

- installs both packages from their lockfiles;
- type-checks both TypeScript projects;
- runs the entire Playwright suite against the reference site;
- validates that the matrix still has 53 unique, well-formed rows;
- runs the contract suite in skip mode (CI has no staging credentials).

No secrets are required for a green build.

## Known limits

- The crawler is single-origin and discovers links from server-rendered HTML;
  client-rendered routes need `sitemap.xml` or `requiredPaths`.
- `alt=""` is accepted as intentionally decorative. Missing `alt` fails.
- Analytics detection is pattern-based; add providers to
  `analytics.requestPatterns`.
- Consent and form specs skip loudly until you supply selectors.
- Load, chaos, property, and contract checks need real infrastructure. They are
  built to skip, not to lie.
- The security scanner is PowerShell-only. On macOS/Linux, run the individual
  tools directly from the checklist.

## Contributing

Issues and pull requests are welcome. Two rules apply to every change: each
assertion must be able to fail, and a row is not covered without evidence. Before
opening a PR:

```bash
npm --prefix web run test:fixtures -- --reporter=line
npm --prefix web run typecheck
npm --prefix distributed run typecheck
npm --prefix distributed run validate:matrix
```

## License

MIT — see [LICENSE](./LICENSE).
