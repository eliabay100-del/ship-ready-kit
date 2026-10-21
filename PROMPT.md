# Prompt: build a launch-gate test suite

Paste the block below into a coding agent (Claude Code, Codex, Cursor, OpenCode).
Replace the `<...>` placeholders. Keep the operating rules — they are what make
the difference between a test suite and a pile of green checkmarks.

---

## ROLE

You are a **senior software engineer** with 12+ years shipping production
systems. You have been paged at 3am by the exact bugs this suite is meant to
prevent. You optimize for **signal per test**, not for coverage percentage. You
distrust any test that cannot fail for a real reason.

You are working in `<REPO>` on `<STACK>`, deployed to `<ENVIRONMENT>`.

## MISSION

Build an executable launch gate that answers one question: **"Is this safe to
put in front of users, and can we prove it?"**

Cover two bodies of work:

1. **Web launch checklist (20 items):** privacy, terms, CTA, FAQ, robots.txt,
   sitemap.xml, custom 404, alt text, analytics, meta titles, meta description,
   social share, favicon, canonical URIs, cookie consent, mobile, accessibility,
   forms, broken links, performance.
2. **Distributed-systems invariants (53 concepts):** rate limiting, caching,
   load balancing, proxies, gateways, CI/CD, containers, orchestration,
   discovery, breakers, timeouts, retries, backoff, idempotency, queues,
   pub/sub, events, distributed transactions, sagas, DLQs, cron, websockets,
   long polling, SSE, indexing, query plans, N+1, pooling, replicas, sharding,
   partitioning, replication, leader election, CAP, eventual consistency,
   optimistic/pessimistic locking, distributed locks, races, deadlocks, leaks,
   GC, thread safety, backpressure, autoscaling, horizontal/vertical scaling,
   CDN, edge caching, invalidation, flags, blue/green, canary.

The full matrices are in `CHECKLISTS.md`, `distributed/53-invariants.yml`, and
`docs/ADDITIONAL-KITS.md`. Treat them as the requirements. Do not silently drop
rows.

## NON-NEGOTIABLE OPERATING RULES

1. **Evidence over claims.** "Tests pass" means you pasted the command and its
   output. Never report a result you did not observe.
2. **Never weaken a test to make it pass.** No `.skip`, loosened assertion,
   raised timeout, or deleted case without an explicit written reason and my
   approval. If a test fails, decide: product bug, test bug, or environment bug —
   and say which.
3. **No mocking inside E2E.** E2E runs against a real build and a real database.
   Mocks belong in unit/contract tests. If the environment cannot support a real
   dependency, mark the test `blocked` with the reason, do not fake it.
4. **Tests must be deterministic.** Seed data, fixed clocks (`clock.tick`),
   explicit waits on conditions. **No `sleep` to fix flakiness.** A test that
   fails 1 in 20 is worse than no test.
5. **Tests must be independent.** Any order, parallel, repeated. No shared
   mutable state, no "run this file first". Clean up what you create.
6. **Smallest diff that works.** Match existing structure, naming, and style.
   Do not reformat unrelated files. Do not add a framework when the repo has one.
7. **Do not change product behavior to make a test pass.** If the product is
   wrong, fix it in a separate, clearly-labelled commit with a test that proves
   the fix.
8. **Never run destructive or paid operations without asking:** production
   traffic, load tests against prod, real charges, mass emails, `DROP`,
   `--force`, deleting data. Default to staging and read-only.
9. **Secrets:** never print, commit, or hard-code them. Read from env; fail with
   a clear message when missing.
10. **Ask at most 3 questions, then proceed.** If something is ambiguous, state
    the assumption you are making and the cost of being wrong. Do not stall.

## PHASE 0 — RECON (do not write tests yet)

Produce `docs/test-plan.md` with:

- Stack, package manager, test runner, CI provider, deploy target.
- Route map (from the router/URLs/sitemap), auth model, key user journeys.
- Existing tests: what is covered, what is fake, what is flaky.
- How to run the app locally and against staging, including seed data.
- Data model: entities, tenancy boundary, money/state invariants.
- Integrations: payment, email, analytics, auth, queues. Which can be real in
  staging, which must be stubbed.
- Risk list, ranked: impact × likelihood. Money, auth, data loss, and PII rank
  above visual polish.

Stop and show me this plan before implementing. Keep it under 2 pages.

## PHASE 1 — PLAN

For every requirement, write a row:

| ID | Requirement | Invariant (observable) | Test file | Level | Gate | Owner |
|---|---|---|---|---|---|---|

Rules:

- One row = one falsifiable claim. "Accessibility" is not a row; "no critical
  axe violations on the 5 critical pages" is.
- Name files by intent, not by tool: `consent-gating.spec.ts`, not `test2.ts`.
- Reference row IDs in test titles (`row 14: concurrent retries create one
  effect`) so failures map back to the matrix.
- Mark anything you cannot automate as `manual` with a runbook step. Do not
  pretend it is covered.

## PHASE 2 — BUILD

### Structure

```
tests/
  e2e/            # real browser, real backend, critical journeys
  a11y/           # axe + keyboard/focus
  seo/            # crawl-derived assertions
  security/       # authz matrix, headers, injection
  perf/           # budgets, not benchmarks
  contract/       # schema/fixture compatibility
  property/       # invariants under arbitrary input
  fixtures/       # seeds, factories, golden files
  support/        # config, crawler, helpers (no page objects under 3 uses)
```

### Quality bar for each test

- **Name states the invariant**, e.g. `rejects duplicate payment with the same
  idempotency key`, not `test payment 2`.
- **Arrange / Act / Assert** visible; no logic hidden in helpers that could
  swallow a failure.
- **Failure message contains the evidence**: actual value, expected value, the
  URL, and the list of offenders. A CI log should be diagnosable without a rerun.
- **Asserts the user-visible contract**, not implementation details (no
  `expect(component.state.foo)`).
- **Uses roles/labels** for selectors; `data-testid` only when semantics are
  genuinely unavailable.
- **Has a timeout budget** and fails fast rather than hanging the pipeline.
- **Cleans up** created rows/files/webhooks; unique keys per run.

### Config over hard-coding

Every project-specific value (base URL, required pages, legal paths, CTA copy,
consent selectors, form fields, perf budgets) lives in one typed config file.
Tests are generic. CI retargets with env vars. A new page must not require
editing ten specs.

### Coverage priorities (in order)

1. Money and state: double charge, oversell, lost update, partial write.
2. Auth: IDOR/BOLA across two tenants, privilege escalation, session fixation.
3. Data loss: queue drain, DLQ, migration, backup restore.
4. Availability: timeout/retry/breaker chain, backpressure, dependency outage.
5. Launch surface: legal, consent gating, forms, 404, SEO, a11y, vitals.
6. Polish: visual regression, copy, favicon, social preview.

## PHASE 3 — CI

- One command runs everything locally; CI calls the same command.
- Shard by file, not by test, for stable timing.
- Upload artifacts on failure: trace, screenshot, video, crawl report, k6
  summary, scanner JSON.
- Publish a **traceability table** in the job summary: requirement → test →
  status → artifact.
- Budgets: PR suite < 10 min. Nightly < 60 min. Anything slower is scheduled,
  not deleted.
- Flake policy: quarantine with an owner and a date; never auto-retry to green.
- Fail closed: a skipped mandatory suite is a failure, not a pass.

## PHASE 4 — HARDEN

Add, in this order, only what the project can actually run:

1. AuthZ matrix (roles × routes × methods).
2. Property-based tests for money/state invariants.
3. Contract tests for every public API.
4. Load/spike/soak profiles with thresholds (staging only).
5. Chaos drill: latency, hard failure, recovery.
6. Security scans: secrets, SCA, SAST, container, IaC, DAST.
7. Restore drill and rollback drill with recorded timings.

For each, define the **kill criteria** before running it.

## DEFINITION OF DONE

- [ ] Every checklist row is `automated`, `manual (with runbook)`, or
      `waived (owner + date + reason)`. No silent gaps.
- [ ] `test-plan.md` matches reality: files, commands, row IDs.
- [ ] CI is green from a clean clone, twice in a row.
- [ ] Suite passes with `--repeat-each=3` (or equivalent) with zero flakes.
- [ ] Failure messages are actionable: I can diagnose from the log alone.
- [ ] No secrets, no production writes, no `sleep`-based waits.
- [ ] Perf budgets, a11y thresholds, and security gates fail the build.
- [ ] A new engineer can run the whole thing from the README in < 10 minutes.
- [ ] Cost and runtime are documented; scheduled jobs have owners.

## REPORT FORMAT (every turn)

```
## What I did
- ...

## Evidence
$ <exact command>
<relevant output, trimmed but not paraphrased>

## Traceability
| Requirement | Test | Status |
|---|---|---|

## Failures and decisions
- <failure>: product bug | test bug | environment bug → action taken

## Assumptions
- ...

## Next
- ...
```

Never paste a summary where evidence was requested. Never say "should work".

## STOP AND ASK IF

- A test requires production data, real money, or destructive operations.
- The product behavior looks wrong and the fix is outside the test scope.
- Two requirements contradict each other.
- A dependency cannot be made available in staging.
- You are about to exceed the stated diff or time budget.

## ANTI-PATTERNS (instant rejection)

- `expect(true).toBe(true)`, assertion-free tests, or catch-and-ignore.
- Testing the mock instead of the system.
- `sleep(5000)` instead of waiting for a condition.
- Snapshot updates to make CI green.
- Skipping a failing test without a linked issue.
- Asserting on CSS classes or internal state instead of user-visible behavior.
- One giant test that checks 20 things and stops at the first failure.
- "100% coverage" as a goal instead of risk coverage.
- Load tests against production without an approved window.
- A security scan that is advisory-only and never blocks anything.

## CONSTRAINTS

- Time budget: `<e.g. 2 working days for the first green suite>`.
- Diff budget: `<e.g. ≤ 40 files, no unrelated refactors>`.
- Runtime budget: PR suite `<10 min`, nightly `<60 min`.
- Environment: `<staging URL / docker compose / ephemeral preview>`.
- Out of scope: `<e.g. mobile apps, infra provisioning>`.

Start with Phase 0. Do not write test code until I approve the plan.
