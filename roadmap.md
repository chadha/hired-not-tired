# Roadmap

## PayPal Sandbox monthly subscriptions

- [x] Add EUR 4.99 Starter, EUR 9.99 Pro (recommended), and EUR 19.99 Premium monthly pricing without inventing feature limits
- [x] Add FastAPI-owned pending checkouts, verified subscription/entitlement state, cancellation, payment records and idempotent signed webhooks
- [x] Add the existing-backend Alembic migration and Sandbox-only configuration with Live fail-closed controls
- [x] Add public pricing, Sandbox PayPal subscription buttons, account billing status and user-facing cancellation without fake success
- [x] Add backend/frontend tests, Sandbox operator documentation and a separate future-Live checklist
- [ ] External verification: create Sandbox app/product/plans/webhook and complete a real Sandbox approval; no live payments or deployment

## Real candidate-owned application journey

- [x] Add authenticated candidate profile revisions, optimistic concurrency, jobs/URL import, application packages, exact-version approvals, contacts, outreach, idempotency and audit persistence to FastAPI
- [x] Add safe public job-page import and compliant provider-backed contact discovery; no fabricated jobs, people, submissions or sends
- [x] Connect the existing chat UI to durable live workspace data, URL import, automatic contact research and candidate-controlled outreach while preserving the fictional local demo
- [x] Add PostgreSQL migration, provider configuration/capabilities, deployment and operator documentation
- [x] Run backend/frontend tests, lint, typecheck/build signals, migration and local smoke checks; distinguish local verification from unconfigured external providers
- [ ] External blockers: deploy with persistent PostgreSQL and HTTPS; configure real OAuth and optional search-provider credentials; perform real-provider browser verification
- [ ] Platform gap: no standard backend rate-limiting primitive; an ad-hoc limit requires explicit confirmation of that tradeoff

## Hired Not Tired brand theme

- [x] Replace the circular mark with the reusable SVG logo, both brand variants and SVG favicon
- [x] Apply the light 50-40-10 navy/mist/slate/spark design tokens and Space Grotesk/Inter typography across existing screens
- [x] Add reduced-motion-safe logo, hero, feature-card and primary-button interactions
- [x] Verify unchanged copy, routes, demo and authentication behavior with 77 passing tests, clean automatic builds/typecheck, lint with no errors, and desktop/mobile browser checks
- [x] Pre-bundle Framer Motion with the existing UI dependencies to prevent duplicate React copies during development; fresh loads, repeated reloads, coach and privacy render without runtime errors

## Existing Supabase LinkedIn OIDC integration

- [ ] Connect the confirmed existing Supabase project for LinkedIn SSO, preserve FastAPI-owned PKCE/sessions, and verify the real browser OAuth flow once a public backend is available
- [x] Preserve the FastAPI-owned session and callback architecture while adding Supabase `linkedin_oidc` as an explicit server-side OAuth adapter
- [x] Keep the existing landing action, demo behavior and unavailable states; do not invent separate login/signup or email/password flows that are absent from this codebase
- [x] Add mocked-provider tests for authorization, PKCE callback, profile mapping, cancellation, errors and account/session creation
- [x] Confirm the user-selected existing-Supabase path on 2026-11-22: 9 backend Supabase tests and 12 frontend LinkedIn/live-flow tests pass; no real provider login is claimed
- [x] Document the exact Supabase and LinkedIn redirect URLs and verify all portable checks
- [ ] Connect the user's existing Supabase project through Lovable Settings → General → External Supabase; no new project or Lovable Cloud enablement
- [ ] Run the real LinkedIn login end-to-end after the existing project and deployed backend are connected; do not claim completion from mocked tests

## LinkedIn SSO operational readiness

- [x] Audit frontend live authentication against backend OIDC, callback, cookie, CSRF, CORS and session contracts; fix verified mismatches only
- [x] Add generic Docker-host deployment configuration and an exact operator checklist without choosing a hostname or deploying
- [x] Add a secret-safe local smoke test for capabilities, authorization, callback/session availability and CORS preflight
- [x] Add live-mode frontend and mocked-provider backend regression tests
- [x] Run backend/frontend tests, typecheck, lint and build verification; document observed results and external blockers
- [ ] External operator actions: choose/register the exact backend callback hostname, supply official LinkedIn credentials, configure persistent PostgreSQL/HTTPS, deploy and perform a real-provider browser login

## Marketing-claim release

- [x] Replace the landing hero and metadata with the locked claim hierarchy while preserving LinkedIn authentication and the isolated local demo
- [x] Add the marketing-claim rationale and one-slide judge pitch, explicitly separating customer-facing copy from internal strategy
- [x] Add landing-message and authentication/demo regression tests
- [x] Run frontend tests, typecheck, lint and production-build verification; inspect desktop and mobile previews
- [ ] Run the proposed 5-second message-validation experiment with 10–15 target participants — pending; no participants have been contacted

## Standalone FastAPI LinkedIn authentication backend

- [x] Document requirements, exact API/error contracts, security decisions and local setup before implementation
- [x] Add async SQLAlchemy/Alembic persistence for identities, users, opaque sessions, OAuth attempts and granular consents
- [x] Implement the seven required routes with LinkedIn OIDC validation, secure cookies, CSRF, strict CORS and truthful capabilities
- [x] Add local PostgreSQL Compose, backend container, environment template and backend CI
- [x] Add mocked-OIDC/JWKS tests for configuration, callback failures, sessions, CSRF, consent and deletion; 23 backend and 71 frontend tests pass
- [x] Wire the existing frontend to session bootstrap, consent, logout and deletion while preserving the isolated fictional demo
- [x] Verify Alembic upgrade, real Uvicorn health/capabilities/503/OpenAPI smoke, frontend typecheck/lint/automatic build, and desktop/mobile demo flows
- [ ] Real LinkedIn authorization remains pending operator credentials and exact callback registration; no real provider login was attempted. PostgreSQL CI is configured but was not executed in this sandbox, which used SQLite for portable tests

## LinkedIn-only authentication brief and preview visibility

- [x] Confirmed both uploaded documents are identical; previous package updates appear on `/coach` after **Prepare application**, not on the retired manual `/onboard` wizard
- [x] Audited the current FastAPI source: it has candidate/job/coach/demo routes but no LinkedIn OIDC, session, consent or account-deletion endpoints
- [x] Added the requested landing headline and **Continue with LinkedIn** action, gated by backend capability metadata and an exact same-backend authorization path
- [x] Added typed OIDC identity, consent and workspace contracts; only `openid`, `profile` and `email` are requested, with no unsupported employment/skills/connections claims
- [x] Retired the manual registration wizard and kept profile enrichment in the continuous chat
- [x] Kept the explicitly fictional local demo accessible by candidate choice; it never creates an account or counts as authentication
- [x] Implement first/returning login, stable-subject provisioning, HttpOnly sessions, consent persistence/withdrawal and account deletion in the standalone FastAPI service; real provider use still needs LinkedIn Developer Portal credentials
- [x] Test backend state/nonce/signature/issuer/audience/expiry validation, session enforcement and account isolation with mocked OIDC/JWKS; no real LinkedIn network call was made

## Current vertical slice: candidate-controlled master revisions

- [x] Preserve immutable master-profile revision history and require explicit confirmation for fact edits
- [x] Detect uploaded/current email conflicts and require an explicit keep/use choice without automatic overwrite
- [x] Create a fresh tailored CV on master revision; invalidate channel approval and require fresh review of affected answers and cover letters
- [x] Add idempotent revision handling and six focused revision tests; all 57 tests, typecheck, lint and production build pass
- [x] Verify home, privacy, both onboarding paths, conflict resolution, real PDF/DOCX downloads, approval invalidation, timeline and mobile layout in Chromium
- [x] Reconfirm upstream commit 527a1f0: profile PATCH and CV upload exist, but profile-fact revision and package CV generation do not
- [x] Backend dependency completed: profile-fact revisions with optimistic version checks and package CV generation are implemented in FastAPI and connected to the live controls

## Authoritative application-engine implementation

- [x] Inspect APPLICATION_ENGINE_SPEC.md at upstream commit 527a1f0 and audit the current UI, FastAPI routes and tests
- [x] Add confirmed-fact provenance, immutable package snapshots, application answers and independent cover-letter versions/approvals
- [x] Add exact channel/destination/answer/attachment/CV approval binding, invalidation, idempotent handoff and candidate-reported submission states
- [x] Add candidate-supplied email contacts and exact-payload copy/mailto handoff with Needle disabled and real sending capability-gated
- [x] Add authoritative-contract regression tests; verify both intake paths, exports, channel approval and email readiness in desktop/mobile browsers
- [x] Keep live-only missing operations explicitly unavailable; no backend URL, deployment, provider connection or real external send was invented

### Authoritative-spec backend status after the durable-engine implementation

- [x] FastAPI `/providers/capabilities` with safe document, email, Needle, LinkedIn and employer/ATS capability metadata
- [x] FastAPI application-package, profile-fact, document, CV-artifact, answer, approval, action and timeline resource families from spec section 7
- [x] Durable master-profile revision/conflict history, candidate ownership/authentication, tenant isolation, idempotency and audit events
- [ ] Private original-binary storage, malware scanning and production retention operations remain deployment responsibilities; parsed CV text is persisted
- [ ] Authorized provider adapters and verified receipts for direct submit/send remain unconfigured; all current paths are guided handoffs
- [ ] Backend-confirmed provider webhooks, email suppression and duplicate webhook handling remain unavailable until an authorized provider exists; no standard distributed rate-limit primitive exists

- [x] Chat-first UI from handoff doc
- [x] Align with frontend spec: discover + rank jobs on load
- [x] Add hiring-contact discovery, evidence, confidence, and review states to every job
- [x] Add outreach approval, message history, reminders, replies/outcomes, and timeline events
- [x] Add authorized messaging provider boundary with honest unavailable and demo-only states
- [x] Add regression tests for evidence, approval, provider permissions, and demo labeling
- [x] Verify the complete chat-first workflow and preserve existing flows
- [x] Prevent blank screen when hiring-contact discovery state is missing
- [x] Previous Needle PoC — superseded by the independent manual-handoff scope
- [x] Read outreach specifications and inspect the repository's actual OpenAPI schema
- [x] Add inline manual contact create/edit with evidence and URL validation
- [x] Implement draft → approved → handed_off → candidate_confirmed_sent with exact-message binding
- [x] Add user-controlled LinkedIn handoff, Not yet, and candidate-recorded replies/outcomes
- [x] Wire available draft/interaction endpoints; keep missing live endpoints explicitly unavailable
- [x] Add vertical-slice safeguard tests and verify the complete labeled demo journey
- [x] Use the local in-memory demo only for this milestone — selected by user; no deployed backend configured
- [x] Audit all six current repository documents and apply the newer locked CV-led application strategy
- [x] Add PDF/DOCX CV import while preserving the existing conversational profile path
- [x] Add the inline Job Application Package: requirement analysis, tailored CV versions, evidence review and exact-version approval
- [x] Add validated PDF/DOCX exports and visible LinkedIn, employer-site and email capability states
- [x] Add document, approval, provenance and demo regression tests; verify the complete browser flow
- [x] Confirm backend deployment status — no deployed URL exists; continue with the explicitly labeled local demo only and do not deploy anything
- [x] Local FastAPI contracts now implement contact CRUD/discovery, draft editing, approval, handoff, candidate-confirmed send, replies, workspace reload, packages, CV source/versions and application channels
- [ ] Deployed verification remains external: set VITE_API_BASE_URL only after an operator deploys this backend and supplies its real public origin; then run real-session reload, isolation and provider checks
- [ ] Direct external submission/send adapters remain intentionally unavailable; guided handoff is the implemented path

## Ads

- [x] Plan the first ad campaign (brief: visitor action, audience, markets, budget, channel) — audience, market (Germany, Berlin focus) and Meta channel preference settled; budget left open by the user
- [ ] Connect the Facebook & Instagram ad account — connection card skipped by the user; waiting for them to sign in
- [x] Record the Meta asset gap: the user has no Facebook Page and no Instagram account, so Meta ads cannot run
- [x] Hold the campaign until a Facebook Page exists — user decision 2026-11-22; nothing created, no spend approved
- [x] Leave the user an exact self-service checklist for creating the Page and business assets
- [ ] External: the user creates a Facebook Page and business portfolio/ad account, then asks to resume so the Meta connection card can be opened
- [x] Settle ad language: English and German as separate ad sets for comparison (user, 2026-11-22)
- [x] Research offer — declined by the user (2026-11-22): skip competitor/customer-search research and go straight to creative from the brief
- [ ] German ad set needs an agreed German landing experience or handoff before it runs; the site is English today