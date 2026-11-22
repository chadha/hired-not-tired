# Hired Not Tired FastAPI backend

Standalone Python 3.12+ service for LinkedIn OIDC, secure candidate sessions, consent/account lifecycle, and the candidate-owned career/application workflow. PostgreSQL is required in production. Nothing in this repository deploys infrastructure or converts the fictional frontend demo into a live account.

Read first:

- [Requirements and product decisions](docs/REQUIREMENTS.md)
- [Exact HTTP contract](docs/API_CONTRACT.md)
- [Security and production validation](docs/SECURITY.md)
- [Frontend integration](docs/FRONTEND_INTEGRATION.md)
- [Operator checklist](docs/OPERATOR_CHECKLIST.md)

## Implemented in code

- Seven auth/account routes plus live/ready health routes and typed OpenAPI schemas.
- Direct LinkedIn authorization-code OIDC or existing-Supabase `linkedin_oidc` with backend-owned PKCE/callback validation, stable-subject provisioning and safe fixed error redirects.
- Opaque hashed sessions, HttpOnly cookies, in-memory frontend CSRF, strict credentialed CORS and fail-closed production checks.
- Candidate-confirmed profile/fact revisions, immutable history, optimistic concurrency and CV-text revisions.
- Candidate-owned public-URL job imports, source/retrieval evidence and deterministic requirement matching.
- Versioned application packages, tailored CV/cover letters, answers, exact-version approvals, approved-source download and guided handoffs/candidate-reported outcomes.
- Candidate-supplied contacts and optional Brave public-search discovery with cited evidence/confidence; no-result/not-configured fallbacks never invent people.
- Grounded editable LinkedIn/email drafts, exact-payload approval, user-controlled handoff, explicit candidate-confirmed sends and candidate-recorded replies.
- Ownership scoping, idempotency keys, audit events, bounded outbound HTTP, SSRF checks and PostgreSQL migrations.
- PayPal Sandbox monthly subscriptions with pending-checkout ownership, exact plan verification, entitlements, cancellation, payment records and signed idempotent webhooks. See [Sandbox setup](docs/PAYPAL_SANDBOX.md).
- Generic Docker-compatible deployment artifacts, secret-safe smoke checks and PostgreSQL CI.

## External and intentionally unavailable

Real LinkedIn login still requires official credentials, an exact registered production callback, persistent PostgreSQL, HTTPS, deployment and a real-provider browser check. Optional contact discovery requires an operator-supplied Brave Search API key. Neither LinkedIn OIDC nor this service grants member search, arbitrary DMs, Easy Apply submission, ATS submission or email delivery. Those actions remain guided handoffs. Needle is disabled and optional.

There is no standard distributed backend rate-limit primitive. No ad-hoc limit is presented as production-grade protection; configure ingress limits until a supported primitive exists. Binary malware scanning/private original-document storage are deployment responsibilities; this service stores frontend-parsed CV text.

## Local setup

Requirements: Python 3.12+, Docker with Compose for PostgreSQL, and a frontend at `http://localhost:8080`.

```bash
cd backend
cp .env.example .env
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[dev]'
docker compose up -d postgres
alembic upgrade head
uvicorn app.main:app --reload --port 8000 --no-access-log
```

OpenAPI is at `http://localhost:8000/docs`. Set frontend `VITE_API_BASE_URL=http://localhost:8000` with no `/api/v1` suffix. Every live request uses credentials. With no backend URL, only the explicitly labelled fictional demo is available.

## Configuration

See `.env.example` and `deploy/production.env.example`. Important values:

| Variable | Local/default | Production rule |
| --- | --- | --- |
| `APP_ENV` | `local` | `production` enables fail-closed checks |
| `DATABASE_URL` | local PostgreSQL DSN | persistent `postgresql+asyncpg://`; no SQLite fallback |
| `AUTH_HASH_PEPPER` | explicit unsafe local value | unique random 32+ character secret |
| `FRONTEND_URL` / `CORS_ORIGINS` | `http://localhost:8080` | explicit HTTPS origins; CORS includes frontend |
| `COOKIE_SECURE` | `false` | must be `true` |
| `LINKEDIN_REDIRECT_URI` | local FastAPI callback | exact registered HTTPS `/api/v1/auth/linkedin/callback` |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | empty | both or neither for existing-Supabase mode |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | empty | both or neither for direct OIDC mode |
| `SEARCH_API_KEY` | empty | optional backend-only Brave key; empty means `not_configured` |
| `SEARCH_API_URL` | official Brave web-search URL | HTTPS required when search is configured |
| `OUTBOUND_TIMEOUT_SECONDS` / `OUTBOUND_MAX_BYTES` | `10` / `1500000` | bounded provider/import limits |
| `PAYPAL_ENV` / `PAYPAL_LIVE_ENABLED` | `sandbox` / `false` | Live fails closed without explicit future production enablement |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | empty | Sandbox REST app credentials; backend only |
| `PAYPAL_WEBHOOK_ID` | empty | Sandbox webhook ID for signature verification |
| `PAYPAL_STARTER_PLAN_ID` / `PAYPAL_PRO_PLAN_ID` / `PAYPAL_PREMIUM_PLAN_ID` | empty | exact Sandbox EUR monthly plan IDs |
| `SERVICE_TERMS_VERSION` / `PRIVACY_NOTICE_VERSION` / `OPTIONAL_CONSENT_VERSION` | `2026-11-22` | deployer-owned current notice IDs |

Changing the hash pepper invalidates sessions and OAuth attempts. Keep frontend/backend on the same schemeful site because cookies use `SameSite=Lax`. Never expose backend secrets through `VITE_*`.

## Migrations

```bash
alembic upgrade head
alembic current
# Staging verification after a migration change:
alembic downgrade base
alembic upgrade head
```

Startup never runs migrations automatically. `20261122_0002_career_engine` adds career resources; `20261122_0003_paypal_subscriptions` adds pending checkouts, subscriptions, payments and webhook deduplication. Readiness checks connectivity and required tables. Production PostgreSQL must be persistent, backed up and outside the stateless application container.

## Smoke checks

```bash
python scripts/smoke_auth.py \
  --base-url http://localhost:8000 \
  --frontend-origin http://localhost:8080
```

Checks readiness, auth and provider capabilities, authorize/callback behavior, anonymous session rejection and CORS. It never follows LinkedIn redirects, performs login, prints response bodies or accepts secrets/cookies/tokens. `--require-configured` additionally requires LinkedIn `status=available`.

## Verification

```bash
ruff check .
ruff format --check .
mypy app
pytest -q
```

Portable tests use isolated SQLite by default. To run against PostgreSQL:

```bash
TEST_DATABASE_URL='postgresql+asyncpg://hnt:hnt@localhost:5432/hnt_test' pytest -q
```

Create an empty test database first. Tests recreate only explicitly selected test tables; never target development/production data. CI uses PostgreSQL 17 and runs formatting, Ruff, mypy, migration upgrade/downgrade/re-upgrade and all tests without real provider calls.

### Observed local verification on 2026-11-22

- **62 backend tests passed** with isolated SQLite; Ruff, formatting and strict mypy passed.
- **93 frontend tests passed** across 15 files; frontend lint had 0 errors and 6 existing Fast Refresh warnings; the harness reported `build OK` after the changes.
- SQLite Alembic upgrade/downgrade/re-upgrade passed through `20261122_0003`.
- Real local Uvicorn smoke passed in `configuration_required` mode, including provider capabilities, auth/callback/session/CORS, billing route contracts, anonymous billing protection and migrated readiness.
- Public `/pricing` browser verification passed with exact prices, Pro highlighting, three disabled unconfigured Sandbox buttons, zero PayPal requests and no page errors.
- PostgreSQL tests and Compose were not run because Docker is unavailable in this sandbox. CI is configured but its remote result was not observed.
- No real LinkedIn login, PayPal Sandbox approval, Brave request, ATS/email send, production image build, live payment or deployment was performed.

## Production configuration only

```bash
cp deploy/production.env.example deploy/production.env
# Populate through the host's secret process.
docker compose -f deploy/docker-compose.yaml build
docker compose -f deploy/docker-compose.yaml run --rm auth alembic upgrade head
docker compose -f deploy/docker-compose.yaml up -d auth
```

Run migrations separately before shifting traffic. Supply secrets through the host secret manager, terminate HTTPS at the trusted proxy, configure ingress limits, and keep persistent PostgreSQL outside Compose. Account closure is not immediate erasure from backups; retention/legal holds follow `docs/REQUIREMENTS.md`.