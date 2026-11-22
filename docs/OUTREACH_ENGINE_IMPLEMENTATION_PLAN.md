# Hired Not Tired Independent Outreach Engine: Implementation Plan

**Companion specification:** [OUTREACH_ENGINE_MVP_SPEC.md](OUTREACH_ENGINE_MVP_SPEC.md)  
**Repository:** https://github.com/chadha/hired-not-tired  
**Approach:** extend the existing FastAPI modular monolith; preserve the Lovable chat-first interface.

## 1. Repository baseline inspected

The repository README describes a career companion with candidate onboarding, job discovery/matching, outreach preparation, interaction learning and coaching. The backend is a FastAPI application under `app/`, with Pydantic schemas, an in-memory store, specialist agent modules and source adapters. Existing API prefix is configured through settings (the documented/default prefix is `/api/v1`).

Existing `app/main.py` already has candidate onboarding/profile, CV upload, job discovery and outreach-related imports. Existing `docs/LOVABLE_HANDOFF.md` defines contact discovery and outreach as a core differentiator, while explicitly prohibiting unauthorized LinkedIn scraping, browser automation, credential collection and unsupported personal-account messaging.

**Important baseline limitation:** the current in-memory store and candidate-ID-based routes are demo scaffolding, not production authentication, persistence or tenant isolation. Do not enable real external sending against this baseline.

## 2. Architecture decision

Use a modular monolith with bounded modules:

- `app/contacts/`: contact domain, evidence, relevance and discovery adapters.
- `app/outreach/`: drafts, approvals, channel orchestration, events and timeline.
- `app/providers/email/`: EmailSender interface, mock implementation and later real adapter.
- `app/providers/linkedin/`: user-controlled handoff only; no personal-account automation.
- Existing `app/agents/`: message generation capability, reusing existing provider/configuration boundaries.

Keep API route registration in existing FastAPI application conventions. Do not introduce microservices, LangGraph, Redis/Celery or a new database as a prerequisite for the first local vertical slice.

## 3. Delivery phases

### Phase 0: baseline and contracts
- Map current schemas, store, settings, API prefix, tests and frontend handoff.
- Add typed contact, evidence, outreach draft, approval, event and channel capability models.
- Add a small domain service layer independent of FastAPI route handlers.
- Add deterministic contact relevance and message validation functions.
- Document current demo-only limitations.

**Exit:** contracts and domain tests pass; no UI changes yet.

### Phase 1: contact management vertical slice
- Create and list contacts scoped to candidate + job.
- Add candidate-supplied LinkedIn URL/email.
- Add evidence records and provenance timestamps.
- Normalize LinkedIn URLs and email for duplicate detection.
- Add contact edit/verify/dismiss states.
- Implement manual and candidate-submitted discovery adapters only.

**Exit:** user can add a contact to a job and see provenance/evidence; no fabricated search results.

### Phase 2: message drafting
- Create LinkedIn/email draft from selected job, candidate profile and contact evidence.
- Reuse existing LLM adapter if configured; otherwise deterministic templates.
- Persist evidence references and factuality warnings with draft.
- Add edit/cancel operations.
- Calculate canonical hash of channel + recipient + subject + body.

**Exit:** draft is editable, traceable and unsupported claims are flagged.

### Phase 3: approval and channel handoff
- Approval endpoint stores actor, timestamp and exact content hash.
- Any subsequent edit invalidates approval.
- LinkedIn handoff endpoint returns the profile URL and approved message payload; frontend opens profile and copies text, with no send claim.
- Candidate confirmation endpoint records a self-reported send event.
- Email send route remains disabled unless a configured provider, verified sender/recipient, auth, persistence, suppression and idempotency controls are all present.
- Mock email provider is used only in tests/demo and visibly marked simulated.

**Exit:** LinkedIn handoff works honestly; no automatic LinkedIn send; email send cannot accidentally use mock provider in production.

### Phase 4: timeline and interaction learning
- Record draft, edit, approval, handoff, candidate-confirmed send, provider result, reply and outcome events.
- Add timeline query endpoint.
- Allow candidate to record reply content/summary and outcome.
- Connect events to existing interaction learning workflow only after event provenance is preserved.

**Exit:** job timeline reflects only real or explicitly self-reported events, with clear labels.

### Phase 5: persistence and pilot hardening
Required before real external email or multi-user pilot:
- PostgreSQL models and migrations.
- Authentication and candidate ownership authorization.
- Tenant isolation and least-privilege access.
- Verified sender domain and email provider integration.
- Suppression/unsubscribe controls, rate limits, abuse prevention.
- Audit events, secret management, HTTPS, CORS, data retention and deletion.
- Provider idempotency and failure/reconciliation behavior.
- Privacy/legal review for contact data sources and outreach.

**Exit:** security review and end-to-end tests pass in a staging environment.

## 4. Proposed API sequence

Follow existing API prefix and route style. Proposed resources:

1. `POST /candidates/{candidate_id}/jobs/{job_id}/contacts`
2. `GET /candidates/{candidate_id}/jobs/{job_id}/contacts`
3. `GET/PATCH /candidates/{candidate_id}/contacts/{contact_id}`
4. `POST /candidates/{candidate_id}/contacts/{contact_id}/evidence`
5. `POST /candidates/{candidate_id}/jobs/{job_id}/contacts/discover`
6. `POST /candidates/{candidate_id}/outreach/drafts`
7. `GET/PATCH /candidates/{candidate_id}/outreach/drafts/{draft_id}`
8. `POST /candidates/{candidate_id}/outreach/drafts/{draft_id}/approve`
9. `POST /candidates/{candidate_id}/outreach/drafts/{draft_id}/handoff`
10. `POST /candidates/{candidate_id}/outreach/drafts/{draft_id}/confirm-sent`
11. `POST /candidates/{candidate_id}/outreach/drafts/{draft_id}/send` (disabled until secure email pilot gates pass)
12. `POST /candidates/{candidate_id}/outreach/drafts/{draft_id}/replies`
13. `GET /candidates/{candidate_id}/outreach/timeline`

## 5. Test strategy

### Unit tests
- URL/email normalization and duplicate detection.
- Evidence provenance validation.
- Contact relevance bands and explanation.
- Message generation never fills unknown facts with guesses.
- Canonical content hash changes when recipient/subject/body changes.
- Approval invalidation after edit.
- Suppression and channel eligibility.
- LinkedIn handoff is not treated as send.
- Provider result mapping and idempotency.

### API tests
- Candidate/job/contact ownership checks.
- Contact CRUD and evidence append.
- Draft CRUD, approval, handoff and timeline.
- Email send blocked when provider/auth/persistence gates are absent.
- Mock email provider cannot be used as production sender.
- Invalid/duplicate requests return safe, deterministic responses.

### Frontend integration tests
- Chat-first contact discovery and add-contact flow.
- Contact card evidence and confidence.
- LinkedIn/email channel selection.
- Editable composer and approval confirmation.
- LinkedIn open-profile handoff and candidate confirmation.
- Clear states for no provider, unverified email, failed send and demo data.
- No false “sent” success state.

### Manual acceptance scenario
1. Use a test candidate and a real job URL.
2. Add a real public professional contact manually, with source URL and observed evidence.
3. Generate a LinkedIn draft and an email draft.
4. Edit one draft and approve it.
5. Open LinkedIn profile via handoff; verify app does not claim sent.
6. Confirm “sent” only after the user actually sends it.
7. Record a reply manually and inspect timeline.
8. Test email send remains blocked until all pilot prerequisites are explicitly configured.

No automated test sends real email or LinkedIn messages.

## 6. Lovable workstream

Lovable should consume only Hired Not Tired API contracts, never connect to Needle or external outreach providers directly.

Required UI:
- Add **Find a contact** and **Add contact** actions to each relevant job card.
- Keep results and composer inside the continuous chat.
- Render contact provenance, confidence and uncertainty.
- Support LinkedIn and email draft tabs/options.
- Show recipient, exact text and approval before any external action.
- LinkedIn action opens profile and copies text; then asks user to confirm whether they actually sent it.
- Email send button appears only when backend reports an enabled, verified email capability.
- Distinguish demo, simulated, handoff, self-reported send and provider-confirmed send.
- Preserve all existing onboarding, matching, coach and timeline experiences.

## 7. Operational constraints

- No Needle credentials, dependency, subscription or API calls.
- No LinkedIn credentials/cookies/session tokens.
- No real email sending until the user explicitly chooses a provider and the security gates are implemented.
- No public deployment, cloud resource creation or paid service activation without explicit approval.
- Frontend may use `VITE_API_BASE_URL`; all provider and LLM secrets remain backend-only.
- Keep local demo data clearly labeled and never mix it with production candidate records.

## 8. Definition of implementation complete

The MVP vertical slice is complete when contact capture with evidence, contact relevance, AI/deterministic drafting, exact-text approval, LinkedIn user handoff, manual reply/outcome capture and a truthful timeline work end to end against the existing FastAPI app and Lovable chat-first UI. Real email delivery is a separate secured pilot milestone, not a fake demo button.
