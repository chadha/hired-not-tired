# Security design

## OIDC validation

The confidential client secret exists only in backend environment configuration. Authorization uses LinkedIn's fixed authorization endpoint; token exchange uses LinkedIn's token endpoint and the exact same configured redirect URI. The service accepts only an RS256 ID token signed by a key from LinkedIn's JWKS endpoint. Validation requires and verifies signature, `iss=https://www.linkedin.com`, audience equal to the configured client ID, expiry, issued-at and subject. Nonce is compared using a constant-time keyed hash. Provider access tokens are discarded immediately.

JWKS responses are cached briefly and refreshed once for an unknown key ID. Tests replace the provider transport/provider adapter and use local RSA keys; they never call LinkedIn.

State is a random 256-bit, single-use value stored as a keyed hash. The attempt identifier and raw nonce travel only in a short-lived HttpOnly cookie with an HMAC. Callback processing checks state, attempt binding, nonce binding, expiry and consumption before provider exchange. Callback failures consume a known attempt where appropriate and redirect only to the configured frontend with a fixed error code.

### Existing Supabase `linkedin_oidc` mode

When both `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are present, FastAPI uses Supabase instead of direct LinkedIn code exchange. Supabase replaces caller state with its own provider-facing flow state, so FastAPI correlates the returned browser through the signed, single-use attempt cookie and requires the PKCE verifier during `grant_type=pkce` code exchange. The exact configured backend callback is sent as `redirect_to` and verified against the attempt. The publishable/anon key is used only for Supabase Auth requests; no service-role key is required.

FastAPI retrieves the authenticated user from Supabase `/auth/v1/user`, maps the stable LinkedIn identity subject and available standard profile fields, then discards Supabase access/refresh tokens. Only the existing opaque HNT session cookie reaches the browser. Partial Supabase configuration selects Supabase mode and fails closed rather than silently falling back to direct LinkedIn.

## Sessions and CSRF

Session values come from `secrets.token_urlsafe(32)`. PostgreSQL stores `HMAC-SHA256(AUTH_HASH_PEPPER, token)`, never the bearer value. The session cookie is HttpOnly, `Path=/`, `SameSite=Lax`, seven-day Max-Age, and Secure in production. Its production name uses the `__Host-` prefix and no Domain attribute. The callback-scoped OAuth cookie instead uses `__Secure-hnt_oauth`: `__Host-` cookies require `Path=/`, while this cookie deliberately keeps `Path=/api/v1/auth/linkedin`. It remains Secure, HttpOnly, SameSite=Lax and host-only.

The CSRF token is a separate random value stored as a keyed hash. `GET /auth/session` rotates it and returns it once in JSON. The frontend holds it in a module variable, never localStorage/sessionStorage. `POST /auth/logout`, `PUT /account/consents` and `DELETE /account` require both the token header and exact Origin allowlist match. This protects cookie-authenticated mutations even if a browser sends cookies automatically.

CORS is not an authentication mechanism. Every protected route independently loads the session, checks expiry/revocation/account status and scopes data by its `user_id`. Production `CORS_ORIGINS` must include `FRONTEND_URL`. Because cookies use `SameSite=Lax`, frontend and backend must share a schemeful site; a CORS allowlist does not make cookies cross-site.

## Storage and account lifecycle

- External identity uniqueness is `(provider, provider_subject)`; email has no uniqueness constraint.
- Session, OAuth and consent records reference internal UUIDs. OAuth attempts and sessions expire; production operations should schedule deletion of expired attempts and long-revoked sessions.
- Account closure deletes active career-profile and external-identity rows, clears direct identity fields on the user, revokes all sessions and deletes linked OAuth attempts.
- Consent history is append-only and becomes pseudonymized audit data after direct identifiers and identity links are removed. Retention and legal holds follow `REQUIREMENTS.md`.
- SQLAlchemy bound parameters prevent SQL string interpolation. Pydantic constrains lengths, literals and collection sizes.

## Logging and HTTP transport

Application code never logs authorization codes, state, nonce, ID/access/session/CSRF tokens, client secrets, cookies or provider response bodies. Run Uvicorn with `--no-access-log` because default access logs can include callback query strings. Errors returned to browsers contain stable codes and request IDs, not stack traces or provider detail.

Production must sit behind HTTPS. Forwarded headers are trusted only from the deployment's configured proxy. The service sets no CORS wildcard and no tokens in URLs it generates for the frontend.

## Production fail-closed validation

`APP_ENV=production` refuses startup when any of these is true:

- `DATABASE_URL` is absent or uses the local-development default.
- `AUTH_HASH_PEPPER` is absent, shorter than 32 characters or equal to a documented local/test value.
- `COOKIE_SECURE` is not `true`.
- `FRONTEND_URL`, `LINKEDIN_REDIRECT_URI` or any CORS origin is non-HTTPS, contains a wildcard, or is missing.
- Only one of `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` is set.
- Only one of `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` is set, or a configured Supabase URL is not a valid HTTPS origin.
- `PAYPAL_ENV=live` without both `APP_ENV=production` and the explicit future `PAYPAL_LIVE_ENABLED=true` flag; this check also fails closed outside production.

Production may start with both LinkedIn credentials absent so health and truthful `configuration_required` capabilities remain available; authorization then always returns `503`. It never falls back to demo authentication.

## Secret handling

`.env.example` contains only explicitly marked local-development values. Real secrets belong in the backend deployment's secret manager/environment, never frontend `VITE_*` variables, source control or test fixtures. Rotating `AUTH_HASH_PEPPER` invalidates all existing sessions and outstanding OAuth attempts and should be treated as a global sign-out.

## Data minimization and dependencies

Direct LinkedIn mode calls no userinfo endpoint. Supabase mode calls only Supabase Auth's authenticated `/auth/v1/user` endpoint to retrieve the available OIDC profile. No employment, skills or connections endpoint is called in either mode. Dependencies are pinned by compatible release ranges in `pyproject.toml`; CI runs Ruff, mypy and tests. Deployment teams should additionally run dependency and container vulnerability scanning in their release environment.

## Career data, outbound providers and tenant isolation

CV/profile revisions, jobs, packages, contacts, outreach, interactions, idempotency records and audit events are persisted in the same candidate-owned PostgreSQL boundary. Every resource query includes the authenticated internal user ID; candidate IDs and package IDs alone never grant access. Account closure cascades through active career records. Consent/audit retention remains governed by `REQUIREMENTS.md`.

Profile and package mutations use optimistic versions. Mutations require CSRF plus `Idempotency-Key`; audit rows bind actor, operation, resource and request ID. Approval hashes bind the exact immutable content/recipient/channel and are invalidated by later edits. Candidate-reported sends/submissions are stored separately from provider-confirmed events.

Public job import and optional Brave search run only in server-side adapters. URL normalization rejects embedded credentials, non-default ports, localhost/private/IP targets and unsafe redirects; DNS results are checked, redirects are revalidated, response bytes and time are capped. Only public vacancy metadata and cited public search snippets are accepted. The service never logs into or scrapes LinkedIn, uses session cookies, automates a browser, or invents a missing person/job.

`SEARCH_API_KEY` is backend-only. With no key, contact discovery returns `not_configured`, zero contacts and a contextual people-search URL. No demo result is substituted. LinkedIn OIDC does not grant member search or messaging. Email and LinkedIn remain explicit handoffs; no direct send/submit provider is implemented.

The backend has no standard distributed rate-limit primitive. This change does not claim one. Adding an ad-hoc per-instance limit would not provide durable multi-instance protection and requires an explicit product/operations decision. Production ingress should provide bounded request rates/body sizes until a supported backend primitive exists. Original CV malware scanning and private binary storage remain deployment responsibilities: this implementation stores frontend-parsed text, not uploaded binaries.

## PayPal subscriptions

PayPal client credentials and OAuth access tokens exist only in the backend client and are never logged or persisted. Only the client ID is public in frontend SDK configuration. Subscription mutations use the existing session, Origin/CSRF and per-user idempotency boundary.

A random pending checkout belongs to the authenticated user and stores the server plan mapping. Verification requires PayPal's returned `custom_id` to match that intent, plus exact plan ID, EUR amount and one-month interval. Only PayPal `ACTIVE` grants an entitlement. Unique PayPal subscription IDs prevent cross-account claiming; cancellation loads the record by both subscription ID and authenticated user ID.

Webhooks have no user session, but every event must pass PayPal's server-side signature verification API using the configured webhook ID and original transmission headers. Event IDs are unique. Stored subscription state is refreshed from PayPal before entitlement changes; unknown subscriptions are ignored. Payment records verify EUR and the stored plan amount, and refunds/reversals update existing transactions without inventing provider-confirmed entitlement.

Cancellation preserves access only when a stored PayPal-confirmed paid-through date remains in the future. Suspension, expiration and unverified/inactive states grant no access. No local/demo fallback can create paid status.

## Error responses and CORS

Unhandled exceptions are converted to the standard `internal_error` envelope inside the request-context middleware, and `CORSMiddleware` is registered last so it wraps every application response. Without this, Starlette's outermost server-error handler returned 500s without `Access-Control-Allow-Origin`, and browsers reported an opaque network failure instead of a readable error with a `request_id`. Server logs record request ID, method, path and exception type only.