# Traceability — requirement to evidence

Two rules:

- **Runnable**: a script in this repo produces a pass/fail today.
- **Template**: the invariant, fault, and assertion are specified, but the test
  needs one app-specific binding (an endpoint, a broker, a cluster). It is not
  counted as covered until that binding exists.
- **Drill**: a human exercise with a recorded result.

## Site checklist — 20 website checks

| # | Check | Spec | Runnable |
|---|---|---|---|
| 1 | privacy policy | `web/tests/04-content-and-legal.spec.ts` | yes |
| 2 | terms page | `web/tests/04-content-and-legal.spec.ts` | yes |
| 3 | clear CTA | `web/tests/04-content-and-legal.spec.ts` | yes |
| 4 | FAQ | `web/tests/04-content-and-legal.spec.ts` | yes |
| 5 | robots.txt | `web/tests/01-crawl-and-links.spec.ts` | yes |
| 6 | sitemap.xml | `web/tests/01-crawl-and-links.spec.ts` | yes |
| 7 | custom 404 | `web/tests/01-crawl-and-links.spec.ts` | yes |
| 8 | alt text | `web/tests/02-seo-and-metadata.spec.ts` | yes |
| 9 | analytics | `web/tests/07-consent-and-analytics.spec.ts` | yes |
| 10 | meta titles | `web/tests/02-seo-and-metadata.spec.ts` | yes |
| 11 | meta description | `web/tests/02-seo-and-metadata.spec.ts` | yes |
| 12 | social share | `web/tests/02-seo-and-metadata.spec.ts` | yes |
| 13 | favicon | `web/tests/02-seo-and-metadata.spec.ts` | yes |
| 14 | canonical URIs | `web/tests/02-seo-and-metadata.spec.ts` | yes |
| 15 | cookie consent | `web/tests/07-consent-and-analytics.spec.ts` | yes (needs selectors) |
| 16 | mobile version | `web/tests/05-mobile-and-responsive.spec.ts` | yes |
| 17 | accessibility | `web/tests/03-accessibility.spec.ts` | yes |
| 18 | test forms | `web/tests/06-forms.spec.ts` | yes (needs `forms[]`) |
| 19 | broken links | `web/tests/01-crawl-and-links.spec.ts` | yes |
| 20 | performance | `web/tests/08-performance-budgets.spec.ts` + `lighthouserc.json` | yes |

## Systems checklist — 53 invariants

| # | Concept | Artifact | Status | Cadence |
|---|---|---|---|---|
| 1 | Rate Limiting | `k6/scenarios.js` (load) + row 1 | template | nightly |
| 2 | Caching | row 2 (origin count + TTL assertions) | template | nightly |
| 3 | Load Balancing | `k6/scenarios.js` + drain during load | template | weekly |
| 4 | Reverse Proxies | row 4 (curl abuse cases) | template | pre-release |
| 5 | API Gateways | `contract/api-contract.test.ts` + row 5 | partial | PR |
| 6 | CI/CD | `security/run-security-scan.ps1` + pipeline rules | partial | PR |
| 7 | Docker | `security/run-security-scan.ps1` (trivy/syft) | yes | build |
| 8 | Kubernetes | row 8 (rollout + admission tests) | template | weekly |
| 9 | Service Discovery | row 9 (scale + kill) | template | weekly |
| 10 | Circuit Breakers | `chaos/run-chaos.ts` | partial (client metrics hook) | weekly |
| 11 | Timeouts | `chaos/run-chaos.ts` | yes | weekly |
| 12 | Retries | `chaos/run-chaos.ts` + row 12 | partial | weekly |
| 13 | Exponential Backoff | row 13 (arrival histogram) | template | weekly |
| 14 | Idempotency | `property/idempotency.pbt.test.ts` | yes | PR / nightly |
| 15 | Message Queues | row 15 (kill consumer) | template | weekly |
| 16 | Pub/Sub | row 16 (slow subscriber) | template | weekly |
| 17 | Event-Driven Architecture | `contract/api-contract.test.ts` + row 17 | partial | PR |
| 18 | Distributed Transactions | `sql/invariants.sql` (ledger balance) | yes | nightly |
| 19 | Saga Pattern | row 19 (compensation drill) | template | weekly |
| 20 | Dead Letter Queues | row 20 (poison message) | template | weekly |
| 21 | Cron Jobs | row 21 (replica overlap) | template | weekly |
| 22 | WebSockets | row 22 (k6/ws) | template | weekly |
| 23 | Long Polling | row 23 | template | weekly |
| 24 | Server-Sent Events | row 24 | template | weekly |
| 25 | Database Indexing | `sql/invariants.sql` (seq scans) | yes | nightly |
| 26 | Query Optimization | `sql/invariants.sql` (temp spills) | yes | nightly |
| 27 | N+1 Queries | `sql/invariants.sql` + row 27 | partial | PR / nightly |
| 28 | Connection Pooling | `sql/invariants.sql` (pool usage) | yes | nightly |
| 29 | Read Replicas | `sql/invariants.sql` (lag) | partial | nightly |
| 30 | Sharding | row 30 (skew report) | template | quarterly |
| 31 | Partitioning | `sql/invariants.sql` (default partition) | partial | nightly |
| 32 | Replication | `sql/invariants.sql` + failover drill | drill | monthly |
| 33 | Leader Election | row 33 (partition + SIGSTOP) | drill | monthly |
| 34 | CAP Theorem | row 34 (zone partition) | drill | quarterly |
| 35 | Eventual Consistency | `sql/invariants.sql` (checksum) | partial | nightly |
| 36 | Optimistic Locking | row 36 (100 parallel PATCHes) | template | PR |
| 37 | Pessimistic Locking | `sql/invariants.sql` (lock waits) | yes | nightly |
| 38 | Distributed Locks | row 38 (pause past TTL) | template | monthly |
| 39 | Race Conditions | `property/idempotency.pbt.test.ts` + `sql/invariants.sql` | partial | PR / nightly |
| 40 | Deadlocks | `sql/invariants.sql` (blocking pids) | yes | nightly |
| 41 | Memory Leaks | `k6/scenarios.js` soak | yes | weekly |
| 42 | Garbage Collection | row 42 (pprof/JFR) | template | weekly |
| 43 | Thread Safety | row 43 (`-race`/TSAN in CI) | template | PR |
| 44 | Backpressure | `k6/scenarios.js` spike + row 44 | partial | weekly |
| 45 | Autoscaling | `k6/scenarios.js` spike | template | weekly |
| 46 | Horizontal Scaling | row 46 (pod disruption) | template | weekly |
| 47 | Vertical Scaling | row 47 (two node sizes) | drill | quarterly |
| 48 | CDN | row 48 (curl -I, 3 regions) | template | pre-release |
| 49 | Edge Caching | row 49 (two users, same URL) | template | pre-release |
| 50 | Cache Invalidation | row 50 (write then read) | template | weekly |
| 51 | Feature Flags | row 51 (flip + provider outage) | template | weekly |
| 52 | Blue-Green | row 52 (cutover + rollback) | drill | monthly |
| 53 | Canary Releases | row 53 (inject error, auto-rollback) | drill | monthly |

## Honest summary

- **Site checklist:** 20/20 runnable (15 and 18 skip until selectors/forms are configured).
- **Systems checklist:** 10 runnable today, 11 partially bound, 26 specified templates, 6 drills.
  Nothing is claimed as covered without an artifact.

The gap is deliberate: distributed invariants require *your* infrastructure.
The matrix gives the invariant, the fault, and the assertion; binding it to one
endpoint or one broker is an afternoon of work per row, not a research project.
