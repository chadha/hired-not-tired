# Authentication backend requirements and decisions

## Scope

This is a separately runnable Python 3.12+ FastAPI modular monolith for Hired, Not Tired identity and account controls. It owns LinkedIn OpenID Connect (OIDC), account provisioning, an empty initial career-profile record, opaque server-side sessions, consent history, logout and account closure. It does not implement job discovery, coaching, application packages or outreach providers, and it never claims those operations exist.

The browser's explicitly labelled fictional demo is outside this service. Demo entry does not call these endpoints, create a user or count as authentication.

## Locked decisions

1. LinkedIn is the only production identity provider. The flow is authorization code with a confidential server-side client and exactly the scopes `openid profile email`.
2. `(provider, provider_subject)` is the identity key. Email is optional, can be unverified, is not unique and is never used to merge accounts.
3. Only ID-token identity claims are imported: subject, names, picture, email/email verification and locale. Employment, education, skills and connections are neither requested nor inferred.
4. LinkedIn access tokens and ID tokens are transient. They are not persisted, returned to the browser or logged. Identity claims come only from a validated ID token, not browser input or a userinfo request.
5. First successful login creates a user, external identity and blank career profile in one transaction. It records the configured service-terms and privacy acknowledgements. Optional analytics, marketing and research/model-improvement choices remain unrecorded/false until the candidate chooses.
6. Returning login updates only claims present in the newly validated token. An absent optional claim does not erase a previously stored value. A closed account is not silently reactivated.
7. Sessions are opaque random 256-bit values. Only keyed SHA-256 hashes are stored in PostgreSQL. Sessions expire after seven days and are not sliding sessions. Logout revokes the current session; account closure revokes all sessions.
8. OAuth attempts expire after ten minutes and are single-use. State and nonce are random 256-bit values. State is hashed in the database. The transient HttpOnly OAuth cookie carries the attempt identifier and nonce with an HMAC; the callback verifies the cookie, state hash, nonce hash, expiry and consumed state before exchanging the code.
9. Cookie authentication uses an HttpOnly `SameSite=Lax` session cookie. `Secure` and `__Host-` names are mandatory in production. State-changing routes also require an exact allowed `Origin` and an `X-CSRF-Token` header. The synchronizer token is returned only by `GET /auth/session`, kept in frontend memory, rotated on each session bootstrap and stored as a keyed hash.
10. Consent history is append-only. Each record has a notice type, version, grant/withdraw value and server timestamp. Essential acknowledgements cannot be withdrawn through the optional-consent API. A version must match the currently configured notice version.
11. Account deletion requires an authenticated request, CSRF validation and the literal confirmation `DELETE`. Active career-profile and external-identity data are deleted, the user record is closed and stripped of direct identity fields, sessions are revoked, and OAuth attempts linked to the user are deleted. Pseudonymized user/consent audit rows remain as documented below.
12. A user marked `legal_hold=true` cannot be deleted through the self-service route; the API returns `409 account_legal_hold`. There is no public endpoint that sets or clears a legal hold.
13. PostgreSQL is the production store. Alembic migrations are applied explicitly with `alembic upgrade head`; application startup never mutates schema. Tests may use SQLite for local portability, while CI runs against PostgreSQL.

## Assumptions and retention policy

- The deployer operates PostgreSQL, HTTPS termination and a backup process. This repository does not provision them.
- Live-row changes take effect when the deletion transaction commits. Pseudonymized consent/user audit rows may be retained for up to six years where the operator needs to demonstrate notice and consent compliance; the operator must shorten or otherwise adapt this to its confirmed legal policy.
- Encrypted database backups can contain prior data for at most 30 days under the documented production policy. Deletion does not claim immediate physical erasure from backups. Backup restoration must reapply a deletion tombstone before the restored system serves traffic.
- A documented legal hold supersedes normal retention until the hold is released by an authorized operator. No legal hold is inferred automatically.
- Local development has no backups and no external retention. Its deletion response still describes the production policy honestly rather than claiming backup erasure.
- Notice texts are versioned deployer-owned legal content. The default version `2026-11-22` is an identifier, not a claim that legal counsel approved notice wording.

## Non-goals

No deployment, cloud database, external account creation, real LinkedIn login, email/password authentication, browser automation, token storage in browser storage, Needle integration or paid service is included.