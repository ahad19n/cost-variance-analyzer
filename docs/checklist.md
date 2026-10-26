# Pre-Deployment Security Checklist

Complete every item before the application is exposed beyond `localhost`. Tick an item only when it has been **verified**, not just configured. ✅ marks items already satisfied by the prototype in its local Docker deployment, and ☐ marks items that must be done before an internet deployment.

## 1. Secrets and configuration
- [x] ✅ `SESSION_SECRET` is a random value of at least 48 bytes, generated per environment (the app refuses to start in production without it).
- [x] ✅ `.env` is in `.gitignore` and `.dockerignore`, and no secrets are in the image (`docker history` / `docker run … env` checked).
- [x] ✅ `NODE_ENV=production` is set (the Dockerfile sets it).
- [ ] ☐ The LiteLLM key is a **virtual key** scoped to this app only, with a monthly budget cap and a model allow-list set in LiteLLM.
- [ ] ☐ `SEED_DEMO=false`, and the demo accounts `alice` and `bob` have been deleted.
- [ ] ☐ Secrets have moved from `.env` to a secret manager (Docker secrets, Vault, or a cloud secret store).

## 2. Transport security
- [ ] ☐ The app sits behind a TLS-terminating reverse proxy (Caddy, Nginx or Traefik) with a valid certificate, TLS 1.2+ only.
- [ ] ☐ `COOKIE_SECURE=true` (Secure cookies, HSTS, `upgrade-insecure-requests`) and `TRUST_PROXY=true`, so rate limits see real client IPs.
- [ ] ☐ HTTP redirects to HTTPS, and the HSTS header is verified with `curl -I`.
- [ ] ☐ `LITELLM_BASE_URL` uses `https://`.

## 3. Authentication and sessions
- [x] ✅ Passwords are hashed with bcrypt (cost 12), with a minimum length of 8 characters.
- [x] ✅ The session ID is regenerated on login, and the session is destroyed on logout.
- [x] ✅ The cookie is `HttpOnly` and `SameSite=Lax` (`Secure` once TLS is on), with a 2 h idle expiry.
- [x] ✅ Login failures show one generic message, with no timing difference between unknown users and wrong passwords.
- [ ] ☐ MFA, a breached-password check (HIBP k-anonymity) and per-account lockout are in place.

## 4. Access control
- [x] ✅ Every `/projects/:id/*` route uses `loadOwnedProject`, and the ownership check is in SQL.
- [x] ✅ The IDOR test suite (ST-2) passes, including the report, AI and delete routes.
- [ ] ☐ Every new route has been reviewed: no route that touches project data skips `requireAuth` + `loadOwnedProject`.

## 5. Input, output and files
- [x] ✅ zod validation on every body and parameter, plus body size limits.
- [x] ✅ Upload pipeline: extension allow-list, magic bytes, zip-bomb check, 2 MB, 5,000 rows, memory-only storage.
- [x] ✅ CSV/XLSX export neutralises formulas.
- [x] ✅ EJS auto-escaping everywhere (`grep '<%-' views` shows only `include` statements).
- [ ] ☐ Antivirus scanning of uploads (for example ClamAV) if files will ever be stored.

## 6. Browser hardening (HTTP headers)
- [x] ✅ CSP: `default-src 'self'`, `script-src 'self'` (no `unsafe-inline` or `unsafe-eval`), `object-src 'none'`, `frame-ancestors 'none'`.
- [x] ✅ `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options`, and `X-Powered-By` removed.
- [x] ✅ No third-party CDNs (Chart.js is self-hosted).
- [x] ✅ CORS is not enabled (same-origin only). Keep it that way unless an API client needs it.
- [ ] ☐ Headers scanned with securityheaders.com or Mozilla Observatory after deployment (target grade A).

## 7. Abuse protection
- [x] ✅ Rate limits: global 300/min, login 5/min, register 10/h, upload 10/min/user, AI 5/min/user, report 20/min/user.
- [ ] ☐ The rate-limit store has moved to Redis if more than one instance runs (the in-memory store is per-process and resets on restart).
- [ ] ☐ Reverse-proxy or WAF limits are set (request size, connection rate, bot protection).

## 8. Dependencies and build
- [x] ✅ `npm audit --audit-level=high` returns 0 vulnerabilities (re-run just before deployment).
- [x] ✅ The lockfile is committed and the image is built with `npm ci --omit=dev` (no dev tools in the runtime image).
- [ ] ☐ A CI pipeline runs `npm test`, `npm audit`, SAST (Semgrep or CodeQL), an image scan (Trivy) and DAST (OWASP ZAP baseline) on every push, and blocks merges on failure.
- [ ] ☐ Dependabot or Renovate is enabled for dependency updates.

## 9. Container and host
- [x] ✅ Runs as the non-root `node` user, with a read-only root filesystem, `cap_drop: ALL` and `no-new-privileges`.
- [x] ✅ Memory (512 MB) and PID (100) limits, plus a health check.
- [x] ✅ The port is bound to `127.0.0.1`, and only the reverse proxy is exposed publicly.
- [ ] ☐ The host OS is patched, with a firewall allowing only 80/443 (and SSH from an admin IP).

## 10. Data protection, logging and recovery
- [x] ✅ Only aggregated data is sent to the LLM, and notes never leave the server.
- [x] ✅ Errors are logged server-side, and clients never see stack traces.
- [ ] ☐ Structured audit log of logins, failed logins, uploads, deletes, report downloads and 403/404/429 events, shipped to central logging with alerts.
- [ ] ☐ Automated, encrypted, off-host backups of the `app-data` volume, **with a tested restore**.
- [ ] ☐ Encryption at rest (an encrypted volume or SQLCipher).
- [ ] ☐ A privacy notice explains the AI processing, and the LiteLLM upstream provider's data-retention terms have been reviewed.

## 11. Final verification
- [x] ✅ `npm test`: 55/55 pass, including the security suites ST-1 to ST-8.
- [ ] ☐ Manual smoke test on the deployed URL: log in, upload, generate the AI summary, download the PDF, check another user's project returns 404, and check 429 on login spam.
- [ ] ☐ An incident contact and a rollback procedure are documented.
