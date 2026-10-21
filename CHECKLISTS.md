# Checklists

Two checklists drive this repository. They are written as requirements; the
tests are the executable form. Nothing here is tool-specific — the same list
works for a static marketing site or a service with a database.

---

## Site launch checklist (20)

1. Privacy policy
2. Terms page
3. Clear CTA
4. FAQ
5. `robots.txt`
6. `sitemap.xml`
7. Custom 404
8. Alt text
9. Analytics
10. Meta titles
11. Meta description
12. Social share
13. Favicon
14. Canonical URIs
15. Cookie consent
16. Mobile version
17. Accessibility
18. Test forms
19. Check broken links
20. Optimize performance

Grouped for testing:

| Group | Items |
|---|---|
| Legal & trust | 1, 2, 4, 15 |
| Conversion | 3, 18 |
| Crawlability & SEO | 5, 6, 10, 11, 12, 13, 14, 19 |
| Content quality | 7, 8, 17, 20 |
| Measurement | 9 |

### What each item actually means

- **Cookie consent** is a consent-management requirement, not just a banner:
  non-essential scripts must be blocked until an explicit choice, the choice must
  be remembered, and refusal must be as easy as acceptance.
- **Social share** means Open Graph and Twitter Card tags *and* a preview image
  that loads at 1200×630 or larger.
- **Accessibility** is tested against WCAG 2.1 AA (axe-core) plus keyboard and
  focus behaviour, not just the presence of `alt` attributes.
- **Optimize performance** is treated as Core Web Vitals budgets (LCP, CLS,
  TTFB) plus a transferred-JavaScript budget.
- **Test forms** includes the unhappy paths: required fields, injection,
  oversize input, duplicate submission, and rate limiting.

---

## Systems checklist (53)

### Traffic & resilience

1. Rate Limiting
2. Caching
3. Load Balancing
4. Reverse Proxies
5. API Gateways
6. CI/CD
7. Docker
8. Kubernetes
9. Service Discovery
10. Circuit Breakers
11. Timeouts
12. Retries
13. Exponential Backoff
14. Idempotency

### Async & realtime

15. Message Queues
16. Pub/Sub
17. Event-Driven Architecture
18. Distributed Transactions
19. Saga Pattern
20. Dead Letter Queues
21. Cron Jobs
22. WebSockets
23. Long Polling
24. Server-Sent Events

### Data & consistency

25. Database Indexing
26. Query Optimization
27. N+1 Queries
28. Connection Pooling
29. Read Replicas
30. Sharding
31. Partitioning
32. Replication
33. Leader Election
34. CAP Theorem
35. Eventual Consistency
36. Optimistic Locking
37. Pessimistic Locking
38. Distributed Locks
39. Race Conditions
40. Deadlocks
41. Memory Leaks

### Runtime & scaling

42. Garbage Collection
43. Thread Safety
44. Backpressure
45. Autoscaling
46. Horizontal Scaling
47. Vertical Scaling

### Delivery & caching

48. CDN
49. Edge Caching
50. Cache Invalidation
51. Feature Flags
52. Blue-Green Deployment
53. Canary Releases

---

## How the two lists connect

The site checklist is what a visitor and a crawler experience. The systems
checklist is what happens when traffic, failure, and concurrency arrive. A
release gate needs both: a perfect Lighthouse score on a service that
double-charges under retry is not ready.

Each of the 53 concepts is expressed as an invariant in
[`distributed/53-invariants.yml`](./distributed/53-invariants.yml), and each of
the 20 checks maps to a spec in [`web/tests/`](./web/tests). The mapping,
including what is still a template, is in
[`docs/TRACEABILITY.md`](./docs/TRACEABILITY.md).
