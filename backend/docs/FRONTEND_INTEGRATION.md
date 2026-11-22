# Frontend integration

## Configuration

Set only the public backend origin in the frontend environment:

```bash
VITE_API_BASE_URL=http://localhost:8000
# Optional public Sandbox client ID; never put the PayPal secret in frontend env.
VITE_PAYPAL_CLIENT_ID=
```

Do not append `/api/v1`. Never put `LINKEDIN_CLIENT_SECRET`, `AUTH_HASH_PEPPER`, LinkedIn tokens or any other backend secret in `VITE_*` variables. With no `VITE_API_BASE_URL`, the existing explicitly labelled fictional local demo remains available and makes no real authentication claim.

## Authorization and callback return path

After `GET /api/v1/auth/capabilities` returns `status=available` and the exact authorization path, the browser navigates to:

```text
<VITE_API_BASE_URL>/api/v1/auth/linkedin/authorize
```

The backend owns state, nonce, code exchange and validation. LinkedIn must redirect to the backend callback registered in `API_CONTRACT.md`. The backend then redirects to `<FRONTEND_URL>/coach?auth=linkedin&first_login=0|1`. The query flags are display hints only; they are not trusted as identity or session data.

When `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are configured, the same frontend button and backend routes use Supabase's `linkedin_oidc` provider. FastAPI creates the PKCE challenge, exchanges the Supabase authorization code, retrieves `/auth/v1/user`, maps only available LinkedIn/OIDC profile fields, and issues the existing opaque session cookie. Supabase access/refresh tokens are never returned to the browser or stored in browser storage. Supabase owns its provider-facing flow state; FastAPI correlates its callback with the signed, single-use OAuth attempt cookie and PKCE verifier. Direct LinkedIn OIDC remains available when both Supabase settings are absent.

This project currently has one landing-page **Continue with LinkedIn** action and no separate login/signup screens or email/password flow. The Supabase adapter does not invent or remove email/password authentication.

Expected callback failures return to `<FRONTEND_URL>/?auth_error=<fixed-code>`. The landing page maps these codes to concise messages. It must not display raw callback parameters or treat any query parameter as authenticated identity.

## Credentialed fetch and session bootstrap

Every live API request uses `credentials: "include"`. On entering `/coach` in live mode, the frontend calls `GET /api/v1/auth/session` before loading candidate data. A `401` clears only the frontend's candidate pointer, returns to sign-in, and never falls back to demo authentication.

A successful response supplies `candidate_id`, validated identity claims, current consents, current consent versions, session expiry and a fresh CSRF token. The candidate ID alone is stored in `sessionStorage` as a non-authoritative routing pointer; the session cookie remains the actual credential. Identity claims, CV data and tokens are not written to browser storage.

The CSRF token stays in a frontend module variable. Send it as `X-CSRF-Token` together with `Origin` (automatically supplied by the browser) on every state-changing request. The typed client also sends a unique `Idempotency-Key`; package mutations additionally send `If-Match: <package.revision>`, and profile edits send `expected_version`. Refresh CSRF through session bootstrap after a `403 csrf_token_invalid`, reload or `401`. Do not store it in localStorage/sessionStorage.

```ts
const workspace = await api.linkedinAuthSession()
await api.updateConsents([{
  notice_type: "marketing",
  notice_version: workspace.consent_versions.marketing,
  granted: true,
}])
```

## Logout, deletion and errors

Logout calls `POST /api/v1/auth/logout`, handles `204`, clears the candidate pointer and returns to `/`. Account closure requires the user to enter `DELETE`, then calls `DELETE /api/v1/account` with `{"confirmation":"DELETE"}`. A successful response means active rows were closed/anonymized under the documented retention policy, not immediate erasure from backups.

The backend error envelope is `{"error":{"code","message","request_id"}}`. Display its safe message; retain the request ID for support diagnostics if needed. Live failures never silently substitute demo success.

## Durable career workspace

After session bootstrap, `/coach` loads profile, owned jobs/matches and `GET /candidates/{candidate_id}/workspace`. The workspace restores packages, selected and alternative contacts, drafts, replies and timeline entries into the existing conversation. It does not create demo rows.

`POST /jobs/import` accepts a public vacancy URL and preserves its source and retrieval timestamp. Selecting/importing a job triggers `POST /candidates/{candidate_id}/jobs/{job_id}/contacts/discover`; the response can be `found`, `no_reliable_match`, `not_configured` or `unavailable`. Only cited public results are rendered. The UI always offers a contextual LinkedIn people-search fallback and manual contact entry.

Package creation, CV/cover/answer edits, exact approvals, application handoffs, contact CRUD, LinkedIn/email drafts, candidate-confirmed sends and candidate-recorded replies use the typed methods in `src/lib/api.ts`. A 409 revision or payload mismatch blocks the action and requires fresh review. Downloads still generate validated PDF/DOCX locally from the exact approved artifact; the backend download contract returns its immutable text source.

No browser code calls Brave, LinkedIn, Supabase privileged APIs, Needle, an ATS or an email provider. `GET /providers/capabilities` controls available UI states. LinkedIn OIDC does not enable member search or messaging. All LinkedIn and email actions remain user-controlled handoffs unless a separately authorized adapter explicitly reports otherwise.

## PayPal Sandbox subscriptions

`/pricing` is public and always shows the fixed EUR monthly prices. Checkout requires a real authenticated FastAPI session, configured backend plans and public `VITE_PAYPAL_CLIENT_ID`; the fictional demo and unconfigured states cannot create paid status.

Selecting a plan calls `POST /billing/checkout-intents` before rendering PayPal Buttons. The SDK uses `vault=true`, `intent=subscription`, `currency=EUR`; `createSubscription` sends only the server-returned plan ID and pending intent as `custom_id`. Approval calls `POST /billing/verify`, and only its backend response updates entitlement UI. Cancellation calls `POST /billing/cancellation`; errors and cancelled approval never display success.

See [PAYPAL_SANDBOX.md](PAYPAL_SANDBOX.md) for provider setup, migration and webhook verification. No real Sandbox checkout is claimed until an operator performs it with configured Sandbox accounts.