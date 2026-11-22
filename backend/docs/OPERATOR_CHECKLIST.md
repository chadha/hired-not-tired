# LinkedIn SSO operator checklist

No hostname, account, credential or deployment is assumed by this repository. Complete these steps only in the operator's own LinkedIn and hosting accounts.

## 1. Choose the public origins and database

- [ ] Choose the HTTPS frontend origin and HTTPS backend origin. Do not use a path in either origin.
- [ ] Keep the frontend and backend on the same schemeful site (for example, the same registrable domain). The session cookie is deliberately `SameSite=Lax`; CORS does not make cookies cross-site.
- [ ] Provision or select a **persistent PostgreSQL 14+ database** with backups, TLS, a least-privilege runtime user and enough storage for identities, sessions, OAuth attempts and consent audit records. Do not use an ephemeral container filesystem or SQLite in production.
- [ ] Create a unique `AUTH_HASH_PEPPER` of at least 32 characters in the host's secret manager. Changing it later invalidates sessions and outstanding OAuth attempts.

## 2A. Existing Supabase project with LinkedIn OIDC (recommended for this integration)

Use this section when Supabase manages the LinkedIn provider. Skip section 2B. Do not create another Supabase project.

- [ ] Connect the existing project in Lovable **Settings → General → External Supabase**. This project connection does not require Lovable Cloud.
- [ ] In Supabase **Authentication → Sign In / Providers → LinkedIn**, confirm the provider key is `linkedin_oidc` and the official LinkedIn client ID/secret remain in Supabase, never in frontend code.
- [ ] In the LinkedIn Developer Portal, register the exact Supabase provider callback shown in that provider panel: `https://<existing-project-ref>.supabase.co/auth/v1/callback`. Do not replace it with the FastAPI or frontend callback.
- [ ] In Supabase **Authentication → URL Configuration → Redirect URLs**, add the exact FastAPI callback for local development: `http://localhost:8000/api/v1/auth/linkedin/callback`.
- [ ] For production, add `https://<chosen-backend-hostname>/api/v1/auth/linkedin/callback` to that same Supabase allowlist. Replace the placeholder with the real backend hostname; there is no frontend `/auth/callback` route in this backend-owned flow.
- [ ] Set Supabase **Site URL** to `https://hirednottired.com` for the production frontend. The OAuth adapter explicitly supplies the backend `redirect_to`; Site URL alone is not the callback.
- [ ] Set backend-only `SUPABASE_URL=https://<existing-project-ref>.supabase.co` and `SUPABASE_PUBLISHABLE_KEY` to the existing project's publishable/anon key. Do not use a service-role secret and do not use `VITE_*` names. Keep `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` empty in this mode.
- [ ] Keep `LINKEDIN_REDIRECT_URI` identical to the FastAPI callback allowlisted in Supabase.

The browser still opens only `/api/v1/auth/linkedin/authorize`. FastAPI redirects to Supabase with `provider=linkedin_oidc` and PKCE, handles the callback, retrieves the available Supabase/LinkedIn profile through `/auth/v1/user`, and creates the existing opaque application session. No Supabase access or refresh token is exposed to frontend JavaScript.

## 2B. Direct LinkedIn OIDC without Supabase

- [ ] Sign in to the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps) and create or select the application owned by the product operator.
- [ ] Open the application's **Products** tab and add the official **Sign In with LinkedIn using OpenID Connect** product. Complete any LinkedIn review or verification it requires.
- [ ] Open the application's **Auth** tab. Under **OAuth 2.0 settings → Authorized redirect URLs for your app**, add the exact backend callback URI:

```text
https://<chosen-backend-hostname>/api/v1/auth/linkedin/callback
```

The final production callback URI depends on the chosen backend hostname. Replace the placeholder, register the resulting URI **exactly**, and use the identical value for `LINKEDIN_REDIRECT_URI`. Scheme, hostname, path and trailing-slash behavior must match; the implemented path has no trailing slash. Do not register the frontend `/coach` URL as the LinkedIn callback.
- [ ] For local development only, register exactly `http://localhost:8000/api/v1/auth/linkedin/callback` if that local flow will be used.
- [ ] Put the LinkedIn client ID and client secret only in backend `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` secret settings. Never put them in `VITE_*`, source control, browser storage or logs.
- [ ] Confirm the application offers the `openid`, `profile` and `email` scopes. Do not request employment history, skills, connections or messaging scopes for this sign-in flow.

## 3. Configure the backend and frontend

- [ ] Copy `deploy/production.env.example` to the host's secret configuration, replacing every placeholder. `DATABASE_URL` must use `postgresql+asyncpg://` and include the persistent database.
- [ ] Set `APP_ENV=production` and `COOKIE_SECURE=true`.
- [ ] Set `FRONTEND_URL=https://<chosen-frontend-hostname>` and include that exact origin in `CORS_ORIGINS`. Add other explicit HTTPS origins only when required; never use `*`.
- [ ] Set the frontend's public `VITE_API_BASE_URL=https://<chosen-backend-hostname>` with no `/api/v1` suffix. This is a URL, not a secret.
- [ ] Set the current `SERVICE_TERMS_VERSION`, `PRIVACY_NOTICE_VERSION` and `OPTIONAL_CONSENT_VERSION` values.
- [ ] Optional: configure `SEARCH_PROVIDER=brave` and backend-only `SEARCH_API_KEY` for cited public contact results. Leave it empty to retain the honest `not_configured` state and contextual LinkedIn people-search fallback. `SEARCH_API_URL` defaults to Brave's official public web-search endpoint; outbound timeout/body limits are bounded.
- [ ] Do not configure LinkedIn member search, DM sending, ATS submission or email sending unless a separately authorized provider adapter and its exact permissions/receipts exist. OIDC alone grants none of these capabilities.

Production startup deliberately fails if PostgreSQL, secure cookies, HTTPS origins, the exact callback path or hashing configuration is unsafe. Both LinkedIn credentials may be absent only when sign-in is intentionally unavailable; a half-configured credential pair fails startup.

## 4. Migrate and start on a generic Docker-compatible host

From `backend/`:

```bash
cp deploy/production.env.example deploy/production.env
# Populate deploy/production.env through the host's secret process.
docker compose -f deploy/docker-compose.yaml build
docker compose -f deploy/docker-compose.yaml run --rm auth alembic upgrade head
docker compose -f deploy/docker-compose.yaml up -d auth
docker compose -f deploy/docker-compose.yaml ps
```

Startup does **not** run migrations automatically. Run `alembic upgrade head` as a separate controlled step before shifting traffic. The container starts Uvicorn on port `8000` with access logs disabled and has a `/health/ready` health check. Place it behind an HTTPS reverse proxy and trust proxy headers only from that proxy. Keep PostgreSQL persistent and outside this Compose file.

## 5. Verify without exposing secrets

```bash
python scripts/smoke_auth.py \
  --base-url https://<chosen-backend-hostname> \
  --frontend-origin https://<chosen-frontend-hostname> \
  --require-configured
```

- [ ] `/health/live` returns `200` and `/health/ready` returns `200` after migration.
- [ ] Capabilities returns `available`, the exact authorization path and only the three OIDC scopes.
- [ ] The authorize route returns a redirect to LinkedIn; the smoke test does not follow it.
- [ ] Provider capabilities return truthful document/search/handoff states without exposing keys.
- [ ] An unauthenticated session request returns `401`; callback and CORS checks match the smoke script output.
- [ ] Apply migrations `20261122_0002_career_engine` and `20261122_0003_paypal_subscriptions` before serving traffic; readiness checks their required tables. Verify rollback/re-upgrade in staging, not against production data.
- [ ] For Sandbox billing only, follow [PAYPAL_SANDBOX.md](PAYPAL_SANDBOX.md): create the Sandbox REST app/product/three exact EUR monthly plans, configure backend credentials/plan IDs and public client ID, register all eight webhook events, and test approval, verification, cancellation and refunds with Sandbox accounts. Keep `PAYPAL_LIVE_ENABLED=false`; no real Sandbox checkout is presumed complete by this checklist.
- [ ] Import a real public vacancy, confirm the candidate profile, create/review a package, and verify reload persistence and cross-account isolation in staging. If search is unconfigured, confirm no contact is invented and the people-search fallback appears.
- [ ] Perform the operator's own real browser login only after the callback is registered. Confirm first-login and returning-login bootstrap, logout, consent changes and account closure. Do not record tokens, cookies or callback query strings in tickets or logs.