# Security Test Evidence

All tests use **safe, synthetic test data**: renamed text files, zero-filled buffers, and harmless `alert()`/`HYPERLINK` strings. Nothing malicious is executed. The data files are in `sample-data/`.

Evidence comes from two sources:
- **Automated:** `npm test` (Jest + Supertest) runs the app in-process against an in-memory database (55 tests, 6 suites).
- **Live:** `scripts/security-demo.sh` runs `curl` against the Docker deployment at `http://localhost:3000`.

The brief asks for at least three security tests. The three required demonstrations are **Test 1 (invalid file uploads)**, **Test 2 (unauthorized project access)** and **Test 3 (excessive requests)**. ST-4 to ST-8 are additional.

---

## Test 1: Invalid file uploads (threat T2)

| Case | Input (safe test data) | Expected | Result |
|---|---|---|---|
| 1a | `fake-executable.csv`: starts with the `MZ` PE header and contains NUL bytes, renamed `invoice.csv` | Rejected as binary (415) | ✅ 415 `File content is not a text CSV (binary data detected)` |
| 1b | 3 MB file of the letter `a` | Rejected before parsing (413) | ✅ 413 `File too large (max 2 MB).` |
| 1c | `.exe`, `.html`, `.xlsm` extensions | Rejected by allow-list (415) | ✅ 415 |
| 1d | CSV with columns `name,cost` | Rejected with a helpful message (400) | ✅ 400 `Missing required column(s)…` |
| 1e | Text file named `fake.xlsx` | Rejected: not a ZIP (415) | ✅ 415 |
| 1f | **Zip bomb**: 40 KB `.xlsx` that expands to 40 MB | Rejected *before* decompression (400) | ✅ 400 `expands beyond 25 MB` (test builds the archive at runtime) |
| 1g | 5,001-row CSV | Rejected (400) | ✅ 400 `Too many rows (max 5000)` |
| 1h | `invalid-rows.csv`: 1 good row, plus rows with a blank category, a non-number, a negative amount and a bad date | Good row accepted, bad rows listed | ✅ `validCount 1, errorCount 4` with per-row messages |

Screenshots: `screenshots/08-sec-invalid-upload-rejected.png`, `screenshots/09-sec-row-validation.png`

## Test 2: Unauthorized project access (threat T1)

Setup: `alice` owns project #1 and `bob` owns project #2 ("Bob's Confidential Budget").

| Case | Request | Expected | Result |
|---|---|---|---|
| 2a | Alice: `GET /projects/2`, `/data.json`, `/report.pdf`, `/report.csv`, `/report.xlsx`, `/anomalies` | 404 and no data in the body | ✅ 404 on all routes. The body never contains the other user's project name or items |
| 2b | Bob: `POST` add item / clear / delete / AI summary on Alice's project, **with a valid CSRF token** | 404, and Alice's data unchanged | ✅ 404. Alice still has 18 items and no injected item |
| 2c | Bob's dashboard | Doesn't list Alice's project | ✅ |
| 2d | No session: `GET /projects/1` | Redirect to login (302) or 401 for JSON | ✅ 302 / 401 |
| 2e | Malformed IDs: `abc`, `-1`, `1.5`, `1 OR 1=1` | 404 | ✅ |

Screenshot: `screenshots/10-sec-unauthorized-project-404.png`

## Test 3: Excessive requests (threat T5)

| Case | Request | Expected | Result |
|---|---|---|---|
| 3a | 6 wrong-password logins from one client within 60 s | Attempts 1–5 get 401, attempt 6 gets **429** | ✅ `[401,401,401,401,401,429]` |
| 3b | 6 AI-summary calls by one user within 60 s | Calls 1–5 get 200, call 6 gets **429** (protects the LiteLLM budget) | ✅ `[200,200,200,200,200,429]` |
| 3c | 11 uploads by one user within 60 s | Upload 11 gets 429, with `RateLimit` and `Retry-After` headers | ✅ |

Screenshot: `screenshots/11-sec-rate-limited-429.png`

## Additional tests

| ID | Threat | What is tested | Result |
|---|---|---|---|
| ST-4 | T3 Formula injection | Uploads `formula-injection.csv` (`=HYPERLINK(…)`, `+SUM(…)`, `@cmd`, `-2+3`), then exports. The CSV cells come back prefixed with `'`, and the XLSX contains no formula cells | ✅ |
| ST-5 | T6 Stored XSS | Uploads `xss.csv` with `<script>` and `<img onerror>` and a project named `<script>…`. The HTML contains only the escaped form `&lt;script&gt;`, and the CSP has no `unsafe-inline` | ✅ |
| ST-6 | T7 SQL injection | Logs in as `alice_t' OR 1=1--`, which returns 401. The project name `x'); DROP TABLE projects;--` is stored and shown literally, and the table still exists | ✅ |
| ST-7 | T8 CSRF | POST without a token returns 403. A token from another user's session returns 403. Multipart upload without the header token returns 403 | ✅ |
| ST-8 | T8/T10 Hardening | Cookie is `HttpOnly` and `SameSite=Lax`, `nosniff` is set, `X-Powered-By` is absent, and malformed JSON gets a 400 with no stack trace | ✅ |
| LLM | T4 Prompt injection / leakage | Notes containing `SECRET NOTE: password123` are absent from the LLM payload, `<>` are stripped from labels, and output is sanitised and capped at 4,000 chars. Against a **mock OpenAI-compatible server**: the request has a system guardrail, a Bearer key and the configured model, and on a 500 error the app falls back to the local summary | ✅ |

---

## Automated run: `npm test`

```

## anomaly.test.js — passed
PASS | unusual expense detection > flags an extreme variance % outlier (8ms)
PASS | unusual expense detection > flags unbudgeted spend (estimate 0) (1ms)
PASS | unusual expense detection > flags a large money overrun even if % is modest (1ms)
PASS | unusual expense detection > no statistics with fewer than 4 items, and uniform data has no outliers (4ms)

## calc.test.js — passed
PASS | variance calculations > variance and percentage for an overrun (7ms)
PASS | variance calculations > underrun gives negative variance (1ms)
PASS | variance calculations > within +/-5% is On budget (boundary inclusive) (0ms)
PASS | variance calculations > zero estimate: percentage is undefined (null), not Infinity (0ms)
PASS | variance calculations > floating point is rounded to cents (0ms)
PASS | variance calculations > summarize aggregates totals and categories (2ms)
PASS | variance calculations > empty project (0ms)

## services.test.js — passed
PASS | file parsing > parses the sample CSV (10ms)
PASS | file parsing > parses the sample XLSX with header aliases ("Estimated Cost") (36ms)
PASS | file parsing > reports row-level validation errors without rejecting good rows (2ms)
PASS | formula injection neutralising > "=1+1" is prefixed with a quote (0ms)
PASS | formula injection neutralising > "+SUM(A1)" is prefixed with a quote (1ms)
PASS | formula injection neutralising > "-2+3" is prefixed with a quote (0ms)
PASS | formula injection neutralising > "@cmd" is prefixed with a quote (0ms)
PASS | formula injection neutralising > "	=x" is prefixed with a quote (1ms)
PASS | formula injection neutralising > normal text and numbers unchanged (0ms)
PASS | chart image validation > rejects non-PNG data and accepts a real PNG (1ms)
PASS | AI payload (data minimisation and prompt-injection hygiene) > free-text notes are never sent to the model (0ms)
PASS | AI payload (data minimisation and prompt-injection hygiene) > labels are stripped of markup characters and truncated (1ms)
PASS | AI payload (data minimisation and prompt-injection hygiene) > model output is sanitised and length-capped (0ms)
PASS | AI payload (data minimisation and prompt-injection hygiene) > local fallback summary mentions totals (17ms)

## llm.integration.test.js — passed
PASS |  > sends a chat completion with system guardrails, key and model; sanitises reply (200ms)
PASS |  > falls back to the local summary when the AI service fails (518ms)

## security.test.js — passed
PASS | ST-1 Invalid / malicious file uploads are rejected > executable disguised as .csv (MZ header, binary) -> 415 (9ms)
PASS | ST-1 Invalid / malicious file uploads are rejected > disallowed extension (.exe / .html / .xlsm) -> 415 (9ms)
PASS | ST-1 Invalid / malicious file uploads are rejected > oversized file (3 MB) -> 413 (20ms)
PASS | ST-1 Invalid / malicious file uploads are rejected > CSV with wrong columns -> 400 with a helpful message (4ms)
PASS | ST-1 Invalid / malicious file uploads are rejected > .xlsx that is not a ZIP -> 415 (3ms)
PASS | ST-1 Invalid / malicious file uploads are rejected > zip bomb .xlsx (40 KB that expands to 40 MB) -> 400 before decompression (115ms)
PASS | ST-1 Invalid / malicious file uploads are rejected > too many rows (5,001) -> 400 (7ms)
PASS | ST-1 Invalid / malicious file uploads are rejected > invalid rows are reported and not imported (4ms)
PASS | ST-2 Unauthorized project access (IDOR / broken access control) > bob cannot read any of alice's project endpoints (404, no data leaked) (11ms)
PASS | ST-2 Unauthorized project access (IDOR / broken access control) > bob cannot modify, delete or run AI on alice's project (12ms)
PASS | ST-2 Unauthorized project access (IDOR / broken access control) > bob's dashboard does not list alice's project (3ms)
PASS | ST-2 Unauthorized project access (IDOR / broken access control) > unauthenticated requests are redirected to login / 401 (4ms)
PASS | ST-2 Unauthorized project access (IDOR / broken access control) > malformed IDs are rejected safely (8ms)
PASS | ST-4 CSV / formula injection in exported reports > CSV export prefixes =, +, -, @ cells with a quote (3ms)
PASS | ST-4 CSV / formula injection in exported reports > XLSX export stores them as text, not formulas (64ms)
PASS | ST-5 Stored XSS is neutralised by output encoding + CSP > script tags are HTML-escaped in the project page (18ms)
PASS | ST-5 Stored XSS is neutralised by output encoding + CSP > Content-Security-Policy forbids inline scripts (5ms)
PASS | ST-6 SQL injection > classic ' OR 1=1-- login bypass fails (298ms)
PASS | ST-6 SQL injection > SQL in a project name is stored literally (parameterised queries) (10ms)
PASS | ST-7 CSRF protection > state-changing POST without token -> 403 (5ms)
PASS | ST-7 CSRF protection > POST with a token from another session -> 403 (9ms)
PASS | ST-7 CSRF protection > JSON upload without header token -> 403 (2ms)
PASS | ST-8 Session and header hardening > session cookie is HttpOnly and SameSite=Lax (2ms)
PASS | ST-8 Session and header hardening > security headers present and X-Powered-By removed (2ms)
PASS | ST-8 Session and header hardening > errors do not leak stack traces (2ms)

## rate-limit.test.js — passed
PASS | ST-3 Rate limiting > 6th failed login within a minute is blocked with 429 (1600ms)
PASS | ST-3 Rate limiting > AI summary endpoint allows 5 calls per minute per user, then 429 (332ms)
PASS | ST-3 Rate limiting > 429 responses carry standard RateLimit headers (302ms)

Total 55 / 55
```

## Live run against the Docker deployment: `scripts/security-demo.sh`

```
== Login as alice (seeded demo user)
POST /login -> 302

== TEST 1: Invalid file uploads
-- 1a. Windows executable renamed to invoice.csv
{"error":"File content is not a text CSV (binary data detected)"}  -> HTTP 415
-- 1b. 3 MB file
{"error":"File too large (max 2 MB)."}  -> HTTP 413
-- 1c. Disallowed type (.html)
{"error":"Only .csv and .xlsx files (max 2 MB) are accepted."}  -> HTTP 415
-- 1d. Wrong columns
{"error":"Missing required column(s): category, estimated, actual. Expected: category, item, estimated, actual [, date, notes]"}  -> HTTP 400

== TEST 2: Unauthorized project access (alice -> bob's project #2)
GET /projects/2 -> 404
GET /projects/2/data.json -> 404
GET /projects/2/report.pdf -> 404
GET /projects/2/report.csv -> 404
POST /projects/2/delete (valid CSRF token) -> 404
GET /projects/1 (alice's own) -> 200
GET /projects/1 (no session) -> 302 (redirect to login)

== TEST 3: Excessive requests (brute-force login)
attempt 1 -> 401
attempt 2 -> 401
attempt 3 -> 401
attempt 4 -> 401
attempt 5 -> 401
attempt 6 -> 429
attempt 7 -> 429
-- Rate-limit headers on the blocked response:
HTTP/1.1 429 Too Many Requests
RateLimit: "300-in-1min"; r=277; t=58
RateLimit: "5-in-1min"; r=0; t=58
RateLimit-Policy: "300-in-1min"; q=300; w=60; pk=:MjQ1YzBmZmMwZjZh:
RateLimit-Policy: "5-in-1min"; q=5; w=60; pk=:MjQ1YzBmZmMwZjZh:
Retry-After: 58
```

## Dependency audit

```
$ npm audit
found 0 vulnerabilities
```

`exceljs@4.4.0` depends on `uuid@8`, which is affected by advisory GHSA-w5hq-g745-h8pq (moderate). `npm audit fix --force` would have *downgraded* exceljs to 3.4.0, so the fix was an `overrides` entry in `package.json` forcing `uuid@^11.1.1`. All tests (including XLSX import and export) pass with the override.

## Container hardening (Docker deployment)

```
$ docker inspect cost-estimation-app-1 --format '…'
User=node ReadonlyRootfs=true CapDrop=[ALL] SecurityOpt=[no-new-privileges:true] Memory=536870912 PidsLimit=100 Ports={"3000/tcp":[{"HostIp":"127.0.0.1","HostPort":"3000"}]}

$ docker exec cost-estimation-app-1 sh -c "id; touch /app/src/hack"
uid=1000(node) gid=1000(node) groups=1000(node)
touch: cannot touch '/app/src/hack': Read-only file system

$ curl -sI http://localhost:3000/login   (security headers)
Content-Security-Policy: default-src 'self';script-src 'self';style-src 'self';img-src 'self' data:;connect-src 'self';font-src 'self';object-src 'none';base-uri 'self';form-action 'self';frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Referrer-Policy: same-origin
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Set-Cookie: cva.sid=<redacted>; Path=/; Expires=Mon, 26 Oct 2026 09:42:57 GMT; HttpOnly; SameSite=Lax
```
