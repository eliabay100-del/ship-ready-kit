# Additional pre-deployment kits

Everything here answers one question: **what evidence would make a senior
engineer comfortable putting this in front of users?** Each kit lists what it
proves, how to run it, and the gate that decides pass/fail.

The two source lists cover marketing-site basics and distributed-systems
patterns. The kits below close the gaps those lists do not mention: data,
security, operations, and the ability to undo a bad deploy.

---

## 0. The non-negotiable baseline

Before any specialised kit:

- [ ] `main` is green, branch protection on, no direct pushes
- [ ] One-command local setup from a clean clone (`make dev` / `docker compose up`)
- [ ] One-command test run; CI runs the same command
- [ ] Staging exists, matches prod topology closely enough to be meaningful
- [ ] Secrets come from a manager, never from the repo or image
- [ ] Every deploy is traceable to a commit and an artifact digest
- [ ] Rollback is documented, tested, and faster than fixing forward

---

## 1. Correctness and change safety

| Kit | Proves | How | Gate |
|---|---|---|---|
| Unit tests | logic is right in isolation | fast, deterministic, no network | coverage of changed lines ≥ 80%, no flakes |
| Integration tests | the app works against real DB/queue/cache | testcontainers, ephemeral schema per run | green on every PR |
| Contract tests | consumers and providers agree on the wire format | zod/JSON Schema + fixtures, or Pact | no breaking change without a version bump |
| E2E smoke | the critical user journey works end to end | Playwright, 5-10 paths, seeded data | green before deploy and after deploy |
| Property-based tests | invariants hold for arbitrary input | fast-check/Hypothesis, shrinking on failure | 0 counterexamples; failures become regression tests |
| Mutation testing | the tests actually detect bugs | Stryker/mutmut on the core module | mutation score ≥ 60% on critical code |
| Golden/snapshot tests | output format does not drift silently | serializers, API responses, emails | diff reviewed, not blindly updated |
| Visual regression | the UI did not break | Playwright screenshots, percy/chromatic | no unintended diff; intentional diffs approved |
| Compatibility | old clients keep working | API versioning + previous-client fixtures | N-1 client version passes |
| i18n/l10n | no hard-coded strings, layouts survive translation | pseudo-locale, RTL, long-string test | no overflow, no missing keys |
| Browser/device matrix | works where users are | Playwright projects: chromium/webkit/firefox + 3 viewports | top-5 analytics browsers green |

**Anti-pattern:** calling a suite "E2E" when it mocks the API. Mocked tests
prove your mocks, not your product.

---

## 2. Performance and capacity

| Kit | Proves | How | Gate |
|---|---|---|---|
| Load test | meets SLO at expected peak | k6 ramping-arrival-rate to 1.5× peak | p95 < budget, error < 1% |
| Stress test | you know where the knee is | ramp until failure, record breaking point | capacity headroom ≥ 2× peak |
| Spike test | survives sudden bursts | 50× in 30 s (autoscaling/backpressure) | no 5xx, recovery < 2 min |
| Soak test | no leaks or degradation over time | 2-24 h at expected load | RSS slope ≈ 0, p95 stable |
| Capacity model | you can predict cost and limits | requests/sec per instance, DB connections, queue throughput | documented headroom per component |
| Frontend vitals | real users get a fast page | Lighthouse CI + RUM (LCP/INP/CLS) | p75 LCP < 2.5 s, CLS < 0.1 |
| Bundle budget | JS does not creep | size-limit / bundlesize in CI | fail on > 10% growth |
| DB performance | queries scale with data | EXPLAIN on 10× dataset, pg_stat_statements | no seq scans on big tables, p95 < 50 ms |
| Cost per request | unit economics hold | cloud cost / requests, per-endpoint attribution | within budget at 2× traffic |

---

## 3. Resilience and disaster recovery

| Kit | Proves | How | Gate |
|---|---|---|---|
| Chaos drill | failures are survivable | toxiproxy: latency, reset, partition, DNS failure | bounded latency, automatic recovery |
| Dependency outage | the app degrades, not dies | block one dependency at a time | documented degraded mode, no cascade |
| Failover drill | the standby actually works | kill primary, promote, measure | RTO met, RPO met, clients reconnect |
| Restore drill | backups are real | restore to a clean environment, run checksums | restore < RTO, row counts match |
| Region/AZ loss | survives infrastructure loss | game day with one zone removed | SLO holds or planned degradation |
| Queue backlog | drains without a stampede | pause consumer, build 100k messages, resume | drains within target, no duplicate storm |
| DLQ handling | poison messages do not block | publish malformed message, fix, replay | queue healthy, replay succeeds |
| Rate-limit tiers | fair use is enforced | per-key/per-tenant tests | isolation proven, 429 + Retry-After |
| Kill switch | you can turn features off | flip under load, kill flag provider | < 1 s effect, safe default |
| Game day | humans can operate it | scheduled exercise with a hypothesis and a scribe | findings filed with owners |

**RTO/RPO must be written down.** "We have backups" is not a recovery plan.
A restore you have not performed is a hypothesis.

---

## 4. Security

Full detail in [`../security/README.md`](../security/README.md). Minimum gate:

| Kit | Proves | How | Gate |
|---|---|---|---|
| Threat model | you know what you are defending | STRIDE per trust boundary, data-flow diagram | updated this release, top risks have owners |
| SAST | no obvious code flaws | semgrep/codeql | no high findings |
| SCA | dependencies are clean | osv-scanner/npm audit | no critical/high with a fix |
| Secret scanning | no credentials in git | gitleaks, full history | 0 live secrets; rotate if found |
| Container scan | image is not a CVE piñata | trivy, non-root, read-only fs | 0 critical, no root |
| IaC scan | infrastructure is not misconfigured | checkov/tfsec | no public buckets, no 0.0.0.0/0 admin |
| DAST | running app resists attacks | ZAP baseline/full scan on staging | no high; auth flows covered |
| AuthZ matrix | no IDOR/BOLA | two users × every endpoint, object-level checks | 403/404 on cross-tenant access |
| AuthN review | sessions and tokens are safe | JWT alg/exp/aud, cookie flags, rotation, MFA | no `alg:none`, HttpOnly+Secure+SameSite |
| Headers/TLS | browser protections on | HSTS, CSP, frame-ancestors, COOP/CORP, testssl.sh | A grade, no TLS < 1.2 |
| Fuzzing | parsers do not crash | API + file upload fuzzing | no 5xx, no unhandled exception |
| Pentest | a human tried to break it | external test before major launch | critical/high fixed or accepted |
| Incident response | you can respond | tabletop + runbook + contacts | on-call knows the drill |

---

## 5. Data

| Kit | Proves | How | Gate |
|---|---|---|---|
| Migration test | schema change is safe | run up + down on a prod-sized snapshot | < 5 s lock, backward compatible |
| Expand/contract | zero-downtime schema change | old + new code run simultaneously | both versions work |
| Backfill test | data migration is correct and resumable | run twice, compare checksums, kill mid-run | idempotent, resumable, no data loss |
| Reconciliation | money/state adds up | ledger sums, counts vs source of truth | zero discrepancies |
| Data quality | inputs are valid | constraints + dbt tests + anomaly checks | no nulls/dupes/orphans in critical tables |
| PII inventory | you know where personal data lives | field-level classification, logs included | no PII in logs/traces/analytics |
| Retention/DSAR | you can delete and export | automated export/delete, verified downstream | request fulfilled within legal window |
| Encryption | data is protected at rest and in transit | KMS, TLS everywhere, column encryption for secrets | no plaintext PII at rest |
| Backup encryption | stolen backup is useless | encrypted, key access audited | verified by restore test |

---

## 6. Delivery and rollback

| Kit | Proves | How | Gate |
|---|---|---|---|
| Pipeline integrity | bad code cannot ship | required checks, signed artifacts, protected envs | red = no deploy |
| Artifact provenance | you know what is running | SBOM + attestation + digest pinning | digest matches commit |
| Rollback drill | undo works | deploy bad version, roll back under load | < 5 min, zero dropped requests |
| Blue/green | instant switch | cutover + rollback with traffic | 0 5xx, schema compatible |
| Canary analysis | small blast radius | 1→5→25→100% with SLO gates | auto-rollback on breach |
| Feature flags | decouple deploy from release | flag default off, kill switch tested | < 1 s flip, safe fallback |
| Config drift | environments match | diff infra + app config | no untracked drift |
| Environment parity | staging predicts prod | same image, same migrations, same topology | parity report reviewed |
| Post-deploy verification | the deploy actually worked | smoke suite + synthetic journey + error rate | green within 5 min of deploy |

---

## 7. Operability

| Kit | Proves | How | Gate |
|---|---|---|---|
| SLOs | you know what "healthy" means | SLI + target + error budget per journey | documented, alerting wired |
| Alert tests | alerts actually fire | inject the condition in staging, watch the page | fires < 5 min, actionable |
| Dashboards | you can see the failure | RED/USE metrics + business KPIs | on-call can diagnose without SSH |
| Runbooks | anyone can respond | one per alert, tested by someone who did not write it | steps work on staging |
| Tracing | you can follow a request | OpenTelemetry, trace IDs in logs and errors | end-to-end trace for every 5xx |
| Log hygiene | logs are useful and safe | structured, correlated, no PII, retention set | searchable in < 1 min |
| On-call readiness | a human is reachable | rotation, escalation policy, contact test | page reaches a human < 5 min |
| Incident simulation | the process works | tabletop + live exercise | timeline + follow-ups recorded |

---

## 8. Product and compliance gates

- **Accessibility:** WCAG 2.1 AA automated + manual keyboard/screen-reader pass
  on the critical journey (not just the home page).
- **Privacy/consent:** analytics blocked before consent, refusal as easy as
  acceptance, consent logged with version and timestamp, GPC honoured.
- **Legal:** privacy policy, terms, cookie policy, refund/cancellation terms,
  company details, contact route, accessibility statement where required.
- **SEO:** crawlable, canonical, sitemap, robots, structured data, no accidental
  `noindex`, 404 returns 404.
- **Analytics:** one provider, consent-gated, key events verified, no PII in
  event properties, dashboards exist before launch.
- **Email deliverability (if you send email):** SPF, DKIM, DMARC, bounce
  handling, unsubscribe, warm-up plan.
- **Payments (if you take money):** test cards, 3DS, refunds, webhooks with
  signature verification, idempotency, reconciliation, tax handling.
- **Support:** contact route monitored, response SLA, status page.

---

## 9. Launch day

**Pre-flight (T-24h)**

- [ ] All P0 gates green; waivers signed and dated
- [ ] Rollback tested *today*, not last month
- [ ] Backups verified by restore, not by existence
- [ ] On-call rota confirmed; escalation numbers work
- [ ] Dashboards and alerts open on the wall
- [ ] Comms drafted (status page, support macros, social)

**Watch window (first 60-120 min)**

- Error rate, p95 latency, saturation, queue depth, DB connections
- Business KPIs: signups, checkouts, form submissions, 4xx on key routes
- Client-side: JS errors, web vitals, 404s, broken links
- Support inbox and social mentions

**Kill criteria (decide before launch, not during)**

Examples: error rate > 2% for 5 min, checkout success < 95%, p95 > 2× baseline,
data corruption detected, security incident. On breach: roll back first,
diagnose second.

**Post-launch (T+24h / T+7d)**

- Error budget consumption vs forecast
- Top 10 client errors, top 10 slow endpoints
- Support ticket themes
- Flaky tests quarantined with owners
- Retro: what the gates missed, and the test that would have caught it
