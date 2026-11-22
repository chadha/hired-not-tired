# HTTP API contract

Base path: `/api/v1`. JSON uses UTF-8. Timestamps are RFC 3339 UTC values. UUIDs are strings. OpenAPI is available at `/docs` in non-production environments and the schema at `/openapi.json`.

## Error envelope

Endpoint errors use the matching HTTP status and:

```json
{
  "error": {
    "code": "authentication_required",
    "message": "Sign in to continue.",
    "request_id": "5a6f84f75f9341f9a02b547dd2a4c29d"
  }
}
```

Validation errors use status `422`, code `validation_error`, and an optional `details` array containing field locations and messages without submitted values. Unexpected failures use status `500`, code `internal_error`; no exception, provider response, token or stack trace is returned.

## Shared objects

### LinkedInAuthCapability

```json
{
  "provider": "linkedin_oidc",
  "status": "configuration_required",
  "authorization_path": null,
  "scopes": ["openid", "profile", "email"],
  "missing": ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  "detail": "LinkedIn Developer Portal credentials are not configured. Real sign-in is unavailable; no login is simulated."
}
```

`status` is `available` or `configuration_required`. Runtime discovery/JWKS failures use `unavailable` only when reported by an enclosing deployment; this service itself does not probe LinkedIn in the capabilities route. When available, `authorization_path` is exactly `/api/v1/auth/linkedin/authorize` and `missing` is empty.

### LinkedInIdentityClaims

Required: `sub`. Optional/nullable: `name`, `given_name`, `family_name`, `picture`, `email`, `email_verified`, `locale`. No employment, skills or connection fields exist.

### AccountConsent

```json
{
  "notice_type": "marketing",
  "notice_version": "2026-11-22",
  "granted": true,
  "recorded_at": "2026-11-22T03:00:00Z"
}
```

`notice_type` is `service_terms`, `privacy`, `analytics`, `marketing` or `research`. `research` means research/model improvement and is always optional.

### AuthenticatedWorkspace

```json
{
  "candidate_id": "2d54f369-b3a6-4b3e-b87a-e995f542e8e2",
  "identity": {
    "sub": "linkedin-stable-subject",
    "name": "Example User",
    "email": null,
    "email_verified": false
  },
  "first_login": false,
  "career_profile_created": true,
  "consents": [],
  "consent_versions": {
    "service_terms": "2026-11-22",
    "privacy": "2026-11-22",
    "analytics": "2026-11-22",
    "marketing": "2026-11-22",
    "research": "2026-11-22"
  },
  "session_expires_at": "2026-11-29T03:00:00Z",
  "csrf_token": "random-one-time-bootstrap-value"
}
```

`consents` contains the latest recorded state for each notice type that has a record. Unrecorded optional choices are false by default; no timestamp is invented for them. `consent_versions` supplies the current version for every notice type so the frontend never hardcodes legal-version identifiers. `csrf_token` must be kept only in frontend memory and sent on subsequent state-changing requests. It is rotated by every successful session bootstrap.

## Endpoints

### `GET /auth/capabilities`

Public. Returns `200 LinkedInAuthCapability`. It performs no network request and never fabricates availability.

### `GET /auth/linkedin/authorize`

Public browser entry point. With complete direct LinkedIn configuration, creates a single-use attempt and returns `302` to LinkedIn's authorization endpoint with `response_type=code`, exact configured `redirect_uri`, client ID, `scope=openid profile email`, random state and nonce. It sets a ten-minute HttpOnly SameSite=Lax OAuth-attempt cookie.

With complete Supabase configuration, the same route returns `302` to `<SUPABASE_URL>/auth/v1/authorize` with `provider=linkedin_oidc`, `scopes=openid profile email`, the exact backend `redirect_to`, and an S256 PKCE challenge. The signed attempt cookie carries the PKCE verifier only to the backend callback. Supabase access/refresh tokens are never exposed to the browser.

Without complete configuration, returns `503 integration_not_configured` and no redirect. It never creates a demo session.

### `GET /auth/linkedin/callback`

Public provider redirect target for both direct LinkedIn and Supabase modes. Query parameters are `code`, optional `state`, optional `error` and optional `error_description`. Provider error descriptions are never reflected or logged. Supabase callbacks are correlated through the signed attempt cookie and PKCE rather than caller-supplied state.

Expected success and failure both return `303` to the configured frontend:

- Success: `<FRONTEND_URL>/coach?auth=linkedin&first_login=1` for provisioning, or `first_login=0` for returning login. A new opaque session cookie is set and the OAuth cookie is cleared.
- Provider denial: `<FRONTEND_URL>/?auth_error=access_denied`.
- Invalid/expired/consumed state or attempt cookie: `<FRONTEND_URL>/?auth_error=invalid_state`.
- Code exchange, issuer, audience, signature, expiry, nonce or claim validation failure: `<FRONTEND_URL>/?auth_error=oauth_validation_failed`.
- Closed account: `<FRONTEND_URL>/?auth_error=account_closed`.
- Other safely handled failure: `<FRONTEND_URL>/?auth_error=oauth_failed`.

No error redirect includes provider descriptions, codes, tokens, email addresses or internal exception text. Missing service configuration returns `503 integration_not_configured` instead of a redirect.

For direct LinkedIn mode, the exact LinkedIn Developer Portal redirect URI is `<BACKEND_PUBLIC_ORIGIN>/api/v1/auth/linkedin/callback`; local default: `http://localhost:8000/api/v1/auth/linkedin/callback`. For Supabase mode, add that same FastAPI URI to Supabase **Authentication → URL Configuration → Redirect URLs**, while LinkedIn receives only Supabase's provider callback `https://<existing-project-ref>.supabase.co/auth/v1/callback`.

### `GET /auth/session`

Requires a valid session cookie. Returns `200 AuthenticatedWorkspace`. Missing, malformed, expired, revoked or closed-account sessions return `401 authentication_required`. Successful response rotates the CSRF token.

### `POST /auth/logout`

Requires session, exact allowed `Origin` and `X-CSRF-Token`. Revokes the current session, clears session/OAuth cookies and returns `204` with no body. Invalid CSRF returns `403 csrf_origin_required`, `csrf_token_required` or `csrf_token_invalid`.

### `PUT /account/consents`

Requires session, origin and CSRF. Request:

```json
{
  "consents": [
    {"notice_type": "marketing", "notice_version": "2026-11-22", "granted": false},
    {"notice_type": "research", "notice_version": "2026-11-22", "granted": true}
  ]
}
```

The array has 1–5 unique notice types. `recorded_at` is server-generated and not accepted in input. Returns `200` with `{"consents": [AccountConsent]}` containing current recorded states. Unsupported versions return `422 consent_version_invalid`; duplicate types return `422 duplicate_notice_type`; withdrawing `service_terms` or `privacy` returns `422 essential_consent_required`. Essential acknowledgement at the current version with `granted=true` is allowed.

### `DELETE /account`

Requires session, origin, CSRF and body `{"confirmation":"DELETE"}`. Any other confirmation returns `422 deletion_confirmation_required`.

Success returns `200`:

```json
{
  "status": "closed_and_anonymized",
  "sessions_revoked": 2,
  "active_profile_deleted": true,
  "external_identity_deleted": true,
  "retention_notice": "Active profile data is deleted now. Pseudonymized consent audit records may be retained for up to six years; encrypted backups may retain prior data for up to 30 days. Legal holds supersede deletion."
}
```

The session cookie is cleared. Subsequent session calls return `401`. A legal hold returns `409 account_legal_hold` without performing deletion.

## Health

- `GET /health/live`: public `200 {"status":"ok"}`.
- `GET /health/ready`: public; executes `SELECT 1` and checks the auth/career tables. Returns `200 {"status":"ready"}` or `503 database_unavailable`.

## Cross-origin rules

The frontend sends `fetch(..., {credentials: "include"})`. CORS uses only configured explicit origins, `Access-Control-Allow-Credentials: true`, methods `GET,POST,PUT,PATCH,DELETE,OPTIONS`, and headers `Content-Type,X-CSRF-Token,Idempotency-Key,If-Match`. Wildcard origins are forbidden, and production `CORS_ORIGINS` must include `FRONTEND_URL`. Every mutation requires an exact allowed Origin and CSRF token. Frontend and backend must share a schemeful site because the cookies deliberately use `SameSite=Lax`.

## Candidate-owned career resources

All routes below require the same valid session, candidate ownership and CSRF for mutations. IDs in a path never authorize access: every profile, job, package, artifact, contact, draft and interaction is loaded through the authenticated user's internal UUID. Cross-candidate access returns `404` rather than revealing existence.

Every career mutation requires `Idempotency-Key`. Repeating the same key, route, actor and payload returns the recorded result; changing any of them returns `409 idempotency_conflict`. Package writes require `If-Match` equal to the current integer `revision`; profile writes require `expected_version`. Conflicts return `409 revision_conflict` and never overwrite newer work. Audit events record actor, operation, resource type and request ID without session or provider secrets.

### Profile and revisions

- `POST /candidates/onboard` creates candidate-confirmed conversational profile facts. No identity beyond the authenticated OIDC claims is inferred.
- `GET/PATCH /candidates/{candidate_id}/profile` reads or creates a new immutable profile revision. PATCH uses `expected_version`, `candidate_confirmed` and constrained profile fields.
- `GET /candidates/{candidate_id}/profile/revisions` returns immutable master snapshots in revision order.
- `PATCH /candidates/{candidate_id}/profile/facts` and `/facts/{fact_id}` edit/confirm one fact or resolve a conflict with explicit `candidate_confirmed=true` and `expected_version`.
- `POST /candidates/{candidate_id}/documents/cv` stores frontend-parsed PDF/DOCX/TXT text as a new unconfirmed revision; binary parsing and validated export remain frontend operations.

### Jobs and matching

- `GET /jobs` lists only the caller's persisted jobs.
- `POST /jobs/import` accepts `{candidate_id,source_url}`. The importer permits public HTTPS/HTTP URLs only, blocks embedded credentials, non-default ports, localhost/private targets and unsafe redirects, caps response size/time, and requires job evidence in JSON-LD or supported page metadata. It preserves `source_url` and `retrieved_at`; it never invents a vacancy.
- `POST /jobs/discover` lists existing owned jobs using the supplied filters. It is not a claim of external job-provider integration.
- `POST /jobs/{job_id}/match/{candidate_id}` deterministically compares confirmed candidate facts to the persisted job and returns requirement-level evidence/gaps.

### Application packages

- `POST /candidates/{candidate_id}/jobs/{job_id}/application-package` creates or returns the owned package from the current immutable master and job snapshots.
- `GET /application-packages/{package_id}` and `/revisions` return current state and immutable package snapshots.
- `POST /application-packages/{package_id}/cv-artifacts` with `{action:"generate",source_profile_version}` creates a fresh tailored version from the latest confirmed master.
- `PATCH /application-packages/{package_id}/cv-artifacts` saves candidate text as a new immutable version.
- `POST|PATCH /application-packages/{package_id}/answers[/{answer_id}]` creates/edits candidate answers; blank unknowns stay blank.
- `PATCH /application-packages/{package_id}` creates or edits cover-letter versions.
- `POST /application-packages/{package_id}/approvals` binds an exact CV/cover artifact, channel/destination, or outreach recipient/subject/body/attachment. Any mismatch returns `409 approval_version_mismatch`.
- `GET /application-packages/{package_id}/cv-artifacts/{artifact_id}/download` returns only an exact approved immutable artifact's text source.
- `POST /application-packages/{package_id}/actions/{channel}` performs only a recorded guided handoff unless an authorized provider explicitly supports direct submit. No direct-submit adapter is configured.
- `POST /application-packages/{package_id}/actions/{channel}/candidate-confirmation` records only the candidate's report, never provider-confirmed submission.

### Contacts and outreach

- `POST /candidates/{candidate_id}/jobs/{job_id}/contacts` stores candidate-supplied identity, source evidence and email. Public URLs and LinkedIn profile form are validated; vacancy ownership is not inferred.
- `PATCH /candidates/{candidate_id}/contacts/{contact_id}` edits an owned contact before handoff and invalidates affected approvals.
- `POST /candidates/{candidate_id}/jobs/{job_id}/contacts/discover` uses only the selected job's persisted title/company/location and the configured compliant public-search provider. It returns cited candidates with evidence dates and confidence, or `no_reliable_match`/`not_configured` plus a contextual LinkedIn people-search URL. It never scrapes LinkedIn.
- `POST /outreach/draft` generates a grounded LinkedIn draft from confirmed profile facts, selected job and selected owned contact.
- `POST /application-packages/{package_id}/outreach-drafts` generates an email draft tied to the same job/contact and current CV artifact.
- `PATCH /candidates/{candidate_id}/outreach/drafts/{draft_id}` and `/application-packages/{package_id}/outreach-drafts/{draft_id}` save candidate edits and invalidate approval.
- `POST /candidates/{candidate_id}/outreach/drafts/{draft_id}/approve` and package `/approvals` approve exact payloads.
- `POST /candidates/{candidate_id}/outreach/drafts/{draft_id}/handoff` records a LinkedIn profile handoff. Package `/actions/email` returns a mailto handoff. Neither sends a message.
- `POST /candidates/{candidate_id}/outreach/drafts/{draft_id}/confirm-sent` and package `/actions/email/candidate-confirmation` record explicit candidate confirmation after handoff.
- `POST /interactions` stores candidate-recorded replies/outcomes with their dates and source. `GET /interactions` lists owned records.
- `GET /candidates/{candidate_id}/workspace` restores owned contacts, packages, messages, interactions and timeline entries.

### Capabilities and coach

`GET /providers/capabilities` is public and reports document handling, optional Brave public-search configuration, email handoff/send status, LinkedIn/ATS submission status and Needle status. No secret or provider response body is returned. `POST /coach/chat` and `GET /coach/action-plan/{candidate_id}` are deterministic, candidate-owned helpers, not AI/provider claims.

## PayPal Sandbox billing

All billing routes except the webhook require the authenticated candidate session. Mutations also require exact Origin, CSRF and `Idempotency-Key`; no browser-supplied price, currency, amount, user ID or entitlement is authoritative.

- `GET /billing/plans` returns the fixed server plan keys/prices and whether each Sandbox plan is configured. Starter is EUR 4.99, Pro EUR 9.99 and Premium EUR 19.99 monthly.
- `GET /billing/subscription` returns the caller's stored PayPal status, amount, billing/paid-through dates and whether current entitlement is active.
- `POST /billing/checkout-intents` with `{plan_key}` creates a random pending intent bound to the caller and server-configured plan. PayPal approval must return this ID as `custom_id`.
- `POST /billing/verify` with `{intent_id,subscription_id}` retrieves the subscription and plan from PayPal server-to-server, checks intent ownership/custom ID, exact plan ID, EUR amount and one-month interval, and grants entitlement only for PayPal `ACTIVE`. Unique subscription IDs prevent cross-user claims.
- `POST /billing/cancellation` with `{subscription_id}` loads the caller's owned record and requests PayPal cancellation. Cancellation timestamps and confirmed paid-through access are stored separately; future paid-through access remains active.
- `POST /webhooks/paypal` is outside user auth and accepts only a raw event whose PayPal verification API result is exactly `SUCCESS`. It handles `BILLING.SUBSCRIPTION.ACTIVATED|UPDATED|CANCELLED|SUSPENDED|EXPIRED` and `PAYMENT.SALE.COMPLETED|REFUNDED|REVERSED`. Event IDs and transaction IDs are unique; subscription state is re-read from PayPal before entitlement changes. Unknown subscriptions cannot create paid access.

The configured PayPal client ID is public; secret, OAuth tokens, plan secrets and webhook verification credentials never appear in frontend code or logs. Sandbox is the default. Live fails closed without explicit future production enablement. Setup and exact webhook names are in [PAYPAL_SANDBOX.md](PAYPAL_SANDBOX.md).