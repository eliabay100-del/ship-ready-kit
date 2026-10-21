# Distributed systems test kit — systems checklist (53 concepts)

The 53 items are not 53 features. Each one is a **claim about behaviour under
stress or failure**, so each one becomes an invariant with a fault injection and
an observable pass condition.

[`53-invariants.yml`](./53-invariants.yml) is the source of truth: one row per
concept with `invariant`, `break_it`, `assert`, `tooling`, `priority`.

## Coverage rule

A row is only "covered" when one of these is true:

| Level | Evidence | Runs |
|---|---|---|
| `unit` | deterministic test of the algorithm (backoff math, breaker state machine) | every PR |
| `integration` | real DB/queue/broker via testcontainers | every PR |
| `contract` | schema/fixture compatibility check | every PR |
| `load` | k6 profile with thresholds recorded | nightly |
| `chaos` | fault injected, invariant re-checked | weekly / before launch |
| `drill` | documented manual exercise with a recorded result (failover, restore) | monthly / quarterly |

If a row has no automation and no drill record, it is **not** covered — say so
in the release review rather than implying coverage.

## What runs today

```bash
# 1. Invariant matrix (static, reviewed in PRs)
cat distributed/53-invariants.yml

# 2. Load / spike / soak / stress (items 1, 3, 11-13, 41, 44-47)
k6 run -e BASE_URL=https://staging.example.com -e SCENARIO=smoke distributed/k6/scenarios.js
k6 run -e BASE_URL=https://staging.example.com -e SCENARIO=spike distributed/k6/scenarios.js
k6 run -e BASE_URL=https://staging.example.com -e SCENARIO=soak  distributed/k6/scenarios.js   # 30 min

# 3. Chaos: latency + hard failure + recovery (items 10-13, 44)
docker compose -f distributed/chaos/docker-compose.yml up -d
npx tsx distributed/chaos/run-chaos.ts        # writes chaos-report.json

# 4. Property-based exactly-once (items 14, 39)
API_URL=https://staging.example.com npx tsx --test distributed/property/idempotency.pbt.test.ts

# 5. Contract drift (items 5, 17, 26)
CONTRACT_URL=https://staging.example.com/api/orders/ord_123 npx tsx --test distributed/contract/api-contract.test.ts

# 6. SQL invariants (items 14, 18, 25-40) — against a snapshot
psql "$STAGING_DATABASE_URL" -f distributed/sql/invariants.sql
```

Every script is safe by construction against staging. **Nothing here should be
pointed at production** except a read-only SQL snapshot; the rate-limit and
chaos tests will page someone.

## The seven tests that catch the most real incidents

If you only build seven things from this list, build these:

1. **Idempotency under concurrency** (row 14) — the bug that charges twice.
2. **Oversell / double-spend property** (row 39) — the bug that loses money.
3. **Timeout + retry + breaker chain** (rows 10-13) — the bug that turns a slow
   dependency into a full outage.
4. **Saga compensation** (rows 18-19) — the bug that leaves orphaned state.
5. **Queue drain + poison message** (rows 15, 20) — the bug that silently stops
   processing.
6. **Restore drill** (rows 32, 48-50) — the backup you never tested.
7. **Canary auto-rollback** (row 53) — the safety net for everything else.

## How to turn a row into a test

For row `N`:

1. Write the invariant as an assertion on **observable state**, not on internal
   calls: "exactly one row", "balance is 0", "p95 < 800 ms", "zero 5xx".
2. Write the smallest fault that could falsify it (`break_it`).
3. Run the assertion **before** the fault (baseline), **during** (degradation is
   bounded), and **after** (recovery is automatic).
4. Record the result as an artifact (JSON/JUnit) so the release review has
   evidence, not a claim.
5. Add the row id to the test name (`it('row 14: ...')`) so the matrix and the
   suite stay linked.

## CI cadence

| Trigger | Suite | Budget |
|---|---|---|
| every PR | unit, integration, contract, web audit | < 10 min |
| merge to main | + smoke k6, container/IaC scan | < 20 min |
| nightly | + load profile, full a11y/SEO crawl, dependency scan | < 60 min |
| weekly | + chaos drill, spike/soak | < 3 h |
| monthly | + failover, restore, canary rollback drill | scheduled |

Failures in `P0` rows block the release. `P1` needs an owner and a dated waiver.
`P2` is tracked, not blocking.
