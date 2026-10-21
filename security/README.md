# Security kit — pre-deployment

Goal: make the insecure path the *inconvenient* path. This is a working
checklist, not a compliance document. Every item has an owner and evidence.

Run the automated baseline first:

```powershell
powershell -ExecutionPolicy Bypass -File security/run-security-scan.ps1 -Repo . -Url https://staging.example.com -FailOnHigh
```

(`pwsh` works too if PowerShell 7 is installed.)

---

## 1. Threat model (do this before the scanner)

Draw the data-flow diagram: browser → CDN → proxy → app → DB/queue/third
parties. Mark every trust boundary. For each boundary ask STRIDE:

| Threat | Question that finds it |
|---|---|
| Spoofing | Can I pretend to be another user/tenant/service? |
| Tampering | Can I change data or a request I should not? |
| Repudiation | Would we know who did it? Are audit logs immutable? |
| Information disclosure | Can I read another tenant's data via ID, cache, or logs? |
| Denial of service | What is the cheapest request that costs us the most? |
| Elevation of privilege | Can a normal user reach admin functionality? |

Output: top 5 risks, each with a mitigation, an owner, and a test that proves
the mitigation. If a risk has no test, it is a guess.

---

## 2. Authentication

- [ ] Passwords: Argon2id/bcrypt (cost tuned), min 12 chars, no composition
      rules, breach-list check, no silent truncation
- [ ] MFA available; enforced for admins and payout/finance actions
- [ ] Login, reset, and OTP endpoints are rate-limited **per account and per IP**
- [ ] Reset tokens: single-use, short TTL, hashed at rest, invalidated on use,
      no account enumeration in responses or timing
- [ ] Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax/Strict`, `__Host-`
      prefix, rotated on login, invalidated on logout and password change
- [ ] JWT: signature verified with an allow-listed algorithm (never `none`),
      `exp`/`nbf`/`aud`/`iss` checked, short access TTL, refresh rotation with
      reuse detection, keys rotatable (kid)
- [ ] OAuth/OIDC: `state` + PKCE, exact redirect URI allow-list, no implicit flow
- [ ] Service-to-service: mTLS or short-lived workload identity, no shared
      static secrets in env vars
- [ ] Admin access: separate role, separate session policy, audit logged

**Test:** two accounts, every endpoint, swap object IDs → expect 403/404, never
200 with the other user's data.

---

## 3. Authorization (the #1 real-world breach)

- [ ] Every endpoint has an explicit authorization check — deny by default
- [ ] Object-level checks (BOLA/IDOR) on every read *and* write
- [ ] Tenant isolation enforced in the query layer (`WHERE tenant_id = ?`), not
      only in the UI
- [ ] Role checks are server-side; hidden UI is not access control
- [ ] Mass assignment blocked: allow-list of writable fields
- [ ] Admin routes are not reachable via path confusion, header spoofing, or
      method override
- [ ] Background jobs and queues re-check authorization/tenant scope
- [ ] Cache keys include tenant/user scope for anything personalized

**Test matrix (automate it):** `anonymous`, `user A`, `user B`, `support`,
`admin` × every route × every method. Assert the expected status for each cell.
This one table catches more bugs than any scanner.

---

## 4. Input, output, and injection

- [ ] Parameterized queries everywhere; no string-built SQL, including `ORDER BY`
      and table names (allow-list them)
- [ ] Output encoding by context (HTML, attribute, JS, URL, CSS); framework
      auto-escaping not bypassed with `dangerouslySetInnerHTML`/`|safe`
- [ ] Rich text sanitized server-side with an allow-list
- [ ] SSRF: outbound fetches use an allow-list, block link-local/metadata
      (169.254.169.254), resolve-then-connect, no redirects to private ranges
- [ ] File uploads: type sniffing (not just extension), size limit, re-encode
      images, store outside webroot, randomized names, AV scan, no SVG by default
- [ ] Deserialization: no native/pickle/YAML-load on untrusted input
- [ ] Template injection: user input never becomes a template
- [ ] Command injection: no shell with interpolated input; use argv arrays
- [ ] GraphQL: depth/complexity limits, introspection off in prod, per-field authz
- [ ] Request limits: body size, header size, JSON depth, array length, pagination
      cap, regex timeout (ReDoS)
- [ ] Redirects: no open redirect; validate `returnTo` against an allow-list

---

## 5. Browser and transport controls

| Header | Value | Why |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | no downgrade |
| `Content-Security-Policy` | nonce/hash-based, `object-src 'none'`, `base-uri 'none'` | XSS containment |
| `X-Content-Type-Options` | `nosniff` | MIME confusion |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | leak control |
| `Permissions-Policy` | deny camera/mic/geo unless needed | feature abuse |
| `Cross-Origin-Opener-Policy` | `same-origin` | XS-Leaks |
| `Cross-Origin-Resource-Policy` | `same-origin` (or `same-site`) | cross-origin reads |
| `frame-ancestors` (CSP) | `'none'` or explicit | clickjacking |

- [ ] TLS 1.2+ only, modern ciphers, HSTS preload, valid chain, no mixed content
- [ ] CORS: explicit origin allow-list, no `*` with credentials, no reflected
      `Origin`, `Vary: Origin`
- [ ] Cookies scoped to the narrowest domain/path
- [ ] CSP in report-only first, then enforced; collect violations
- [ ] Subresource integrity for third-party scripts you cannot remove

**Test:** `testssl.sh --severity HIGH`, `curl -I`, ZAP baseline, and a CSP
violation report from a real browser session.

---

## 6. Secrets and supply chain

- [ ] Secret scanning on every push **and** full git history; rotate anything
      ever committed (deleting the commit is not enough)
- [ ] Secrets in a manager (Vault/SSM/Doppler), injected at runtime, never baked
      into images or front-end bundles
- [ ] Different secrets per environment; no prod secrets in staging
- [ ] Dependency lockfile committed; CI installs from lockfile only
- [ ] SCA on every PR (`osv-scanner`, `npm audit --omit=dev`)
- [ ] SBOM generated per build (CycloneDX) and stored with the artifact
- [ ] Images pinned by digest, minimal base, non-root, read-only rootfs
- [ ] Artifacts signed (cosign) and verified at deploy time
- [ ] CI actions pinned by commit SHA; `pull_request_target` not used carelessly
- [ ] Dependency confusion: scoped packages, registry allow-list
- [ ] License policy checked for distribution

---

## 7. Infrastructure

- [ ] No public storage buckets; block public access at the account level
- [ ] Security groups: no `0.0.0.0/0` on SSH/DB/admin ports
- [ ] IMDSv2 enforced; no instance credentials in user data
- [ ] Least-privilege IAM; no wildcard `*` actions on `*` resources
- [ ] Kubernetes: RBAC least privilege, NetworkPolicy default-deny, Pod Security
      `restricted`, no privileged/hostPath, secrets via CSI/External Secrets
- [ ] Database not publicly reachable; TLS required; per-service users with
      minimal grants; no app user with `SUPERUSER`/DDL in prod
- [ ] Backups encrypted, cross-account, and restore-tested
- [ ] Audit logging on (CloudTrail/K8s audit) shipped off-box, immutable
- [ ] IaC scanned (`checkov`/`tfsec`), plan reviewed before apply
- [ ] Egress restricted; metadata endpoint blocked from app pods

---

## 8. Data protection and privacy

- [ ] Data inventory: what PII, where it lives, who can read it, how long
- [ ] Encryption in transit and at rest; field-level encryption for secrets
- [ ] PII never in logs, traces, error messages, analytics, or URLs
- [ ] Log redaction tested with a canary value
- [ ] Retention enforced by a job, not by hope; deletion verified downstream
      (backups, warehouse, search index, caches)
- [ ] DSAR export/delete works end to end within the legal window
- [ ] Consent gating verified (see the web kit's consent spec)
- [ ] Data processing agreements with every third party that sees PII
- [ ] Analytics configured with IP anonymization and no PII in event properties

---

## 9. Abuse, availability, and business logic

- [ ] Rate limits per IP, per account, per tenant, per endpoint class; 429 with
      `Retry-After`
- [ ] Signup/login/reset/OTP/payment endpoints have stricter limits + bot checks
- [ ] Idempotency on payment and state-changing endpoints
- [ ] No negative quantities, currency rounding abuse, coupon stacking, or
      race-condition double-spend (see property tests)
- [ ] Price and role are always resolved server-side, never trusted from the client
- [ ] Webhooks: signature verified, timestamp tolerance, replay protection
- [ ] Email/SMS sending is rate-limited and cannot be used as a spam relay
- [ ] Error responses do not leak stack traces, SQL, versions, or internal hosts
- [ ] Debug endpoints, `/actuator`, `/graphiql`, source maps, and `.git` are not
      publicly exposed

---

## 10. Verification and response

| Layer | Tool | When |
|---|---|---|
| SAST | semgrep, CodeQL | every PR |
| SCA | osv-scanner, npm audit | every PR |
| Secrets | gitleaks | every push |
| Container | trivy | every build |
| IaC | checkov | every infra PR |
| DAST | ZAP baseline (staging) | nightly / pre-release |
| AuthZ matrix | custom E2E | every PR |
| Fuzzing | API + upload fuzzers | nightly |
| TLS | testssl.sh | monthly / cert change |
| Pentest | external human | before major launch |
| Tabletop | team exercise | quarterly |

**Severity and SLA**

| Severity | Example | Fix within |
|---|---|---|
| Critical | auth bypass, RCE, exposed PII, leaked live key | 24 h, rollback if needed |
| High | IDOR, stored XSS, SSRF to metadata | 7 days |
| Medium | missing header, verbose errors, weak rate limit | 30 days |
| Low | best-practice gap, informational | next cycle |

**Incident minimum:** one named owner, a private channel, a timeline, evidence
preservation, credential rotation, customer comms if data is involved, and a
post-incident test that would have caught it.
