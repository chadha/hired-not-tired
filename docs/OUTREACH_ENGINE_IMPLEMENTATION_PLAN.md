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


## 9. First delivery: one complete LinkedIn vertical slice (implementation priority)

**This is the immediate build target.** Do not start email sending, broad contact discovery, provider integrations or campaign features until this slice works end to end.

### Exact candidate journey

1. **Select a saved job** from the existing job/opportunity cards.
2. **Add a contact** from a user-provided name, current title/company, public LinkedIn profile URL and optional evidence/source URL. Do not invent contact identities or scrape LinkedIn.
3. **Review the contact** inside the chat. Show source/evidence, confidence and uncertainty. Label as “Potential hiring contact”, not confirmed hiring manager.
4. **Generate a LinkedIn message** using only the selected job, candidate-confirmed profile and contact evidence. Show a short rationale and factuality warnings.
5. **Edit and approve** the exact message. Approval records actor, timestamp and a canonical hash of destination + message text. Any subsequent edit invalidates approval.
6. **LinkedIn handoff** opens the contact's public LinkedIn profile and makes the approved text easy to copy. The UI must say “Open LinkedIn to send” or “Open profile and copy message”, never “Message sent”.
7. **Record response** by allowing the candidate to record whether they sent the message and later add a reply (received date, channel, reply text/summary, sentiment/outcome optional). Label the send as candidate-confirmed/self-reported, and the reply as candidate-recorded. Do not imply LinkedIn webhook/API verification.

### P0 scope lock

- LinkedIn only for this first vertical slice.
- Email remains a future channel and is not implemented in this milestone.
- Contact entry is manual/candidate-supplied. A later discovery adapter can be added after the vertical slice.
- No Needle, LinkedIn API, scraping, browser automation, automated sending, email provider, paid integration or external account connection.
- No new microservice, workflow engine, or infrastructure spend.
- Reuse existing candidate, job, profile and interaction models wherever possible.
- Existing in-memory store is acceptable only for local/demo validation. Clearly label data as demo/ephemeral and do not represent it as durable or multi-user safe.

### Minimal API contract for this slice

Align route names with existing app conventions and configured API prefix. Proposed operations:

| Method | Route | Purpose |
|---|---|---|
| GET | /candidates/{candidate_id}/jobs | Load saved jobs (reuse existing route if available) |
| POST | /candidates/{candidate_id}/jobs/{job_id}/contacts | Add candidate-supplied contact |
| GET | /candidates/{candidate_id}/jobs/{job_id}/contacts | List contacts and evidence |
| POST | /candidates/{candidate_id}/outreach/drafts | Generate/create LinkedIn draft |
| PATCH | /candidates/{candidate_id}/outreach/drafts/{draft_id} | Edit draft; clear prior approval |
| POST | /candidates/{candidate_id}/outreach/drafts/{draft_id}/approve | Approve exact destination + text hash |
| POST | /candidates/{candidate_id}/outreach/drafts/{draft_id}/handoff | Record handoff intent and return LinkedIn URL/text |
| POST | /candidates/{candidate_id}/outreach/drafts/{draft_id}/confirm-sent | Candidate attests message was sent |
| POST | /candidates/{candidate_id}/outreach/drafts/{draft_id}/replies | Record a reply manually |
| GET | /candidates/{candidate_id}/outreach/timeline | Show outreach and reply events |

If equivalent endpoints already exist, extend/reuse them rather than create duplicates. Keep Pydantic request/response schemas and service logic separate from route handlers.

### Required state transitions

- Draft: draft
- Approval: approved only while stored hash matches current destination and text
- Handoff: handed_off (does not mean sent)
- Candidate attestation: candidate_confirmed_sent
- Reply: a separate reply_recorded event; do not overwrite send status

Any message or recipient edit resets the draft to draft and clears approval fields. Duplicate handoff/confirm/reply requests must not create duplicate timeline events where an idempotency key is supplied.

### Vertical-slice acceptance checklist

- [ ] Candidate can select an existing saved job in the current chat-first experience.
- [ ] Candidate can add a contact without leaving the conversation.
- [ ] Required contact fields validate; optional unknown facts remain blank.
- [ ] Contact card shows LinkedIn URL, source, evidence and uncertainty.
- [ ] Candidate can generate and edit a job-specific message.
- [ ] Message factuality warnings identify missing/unsupported claims.
- [ ] Approval binds to exact destination and exact message content.
- [ ] Editing after approval invalidates approval.
- [ ] Handoff is unavailable before approval.
- [ ] Handoff opens only the supplied public LinkedIn profile URL and presents the approved message for user-controlled copy/send.
- [ ] UI never claims an external send occurred because a profile was opened.
- [ ] Candidate can explicitly confirm they sent it.
- [ ] Candidate can record a reply and see it in the job timeline.
- [ ] Send and reply labels clearly distinguish candidate-reported events from provider-verified events.
- [ ] No Needle dependency, LinkedIn scraping, browser automation, real external message sending or email sending is introduced.
- [ ] Backend unit/API tests and frontend flow tests cover the complete journey.

**Definition of done for this milestone:** the seven-step journey (select job → add contact → generate message → approve → LinkedIn handoff → confirm sent → record response) works end to end in the existing Hired Not Tired application, with truthful state labels and no unauthorized automation.



## 10. Product strategy lock: CV-led, multi-channel job application platform

**Decision status: LOCKED by product owner, 22 November 2026.** This section supersedes Section 9's LinkedIn-only first-delivery scope and any earlier P0 scope that conflicts with it. Preserve the existing chat-first experience and independent architecture.

### Product promise

Hired Not Tired helps a candidate turn a job opportunity into a high-quality, tailored application and a relevant professional conversation. The product owns the application package and workflow; channels are execution paths, not separate products.

### Locked product decisions

1. **Both CV creation methods:** candidates can upload/import an existing CV or build their CV from a structured conversational career profile.
2. **Job-specific tailoring:** every selected job can produce a tailored CV grounded only in candidate-confirmed facts and evidence. Preserve the original master CV and create a separate version per job.
3. **Both export formats:** PDF and DOCX are first-release requirements. DOCX remains editable; PDF preserves predictable layout. Validate extracted text and document structure.
4. **All three application paths are strategic priorities:**
   - LinkedIn Easy Apply: support candidate-guided handoff and direct submission only where an official, authorized integration exists. Default to candidate-controlled handoff. No scraping, logged-in browser automation, credential/cookie collection, unofficial endpoints, or universal automation claims.
   - Direct application through Hired Not Tired: support employer submission only through an authorized API or explicitly supported integration. Otherwise prepare the package and guide the candidate to the employer's official application form. Never claim submission without verified success.
   - Hiring-manager/recruiter outreach: support LinkedIn manual handoff and email. LinkedIn remains user-sent unless formally authorized capability becomes available. Email sending requires the secure provider gates in the MVP spec; otherwise provide copy/mailto handoff, not a fake send.
5. **Evidence-led contact discovery:** manual/candidate-supplied information and permitted public/company sources only. Label unverified people “Potential hiring contact”. Never invent identities, email addresses, responsibilities or relationships.
6. **Application package is the shared domain object:** bind one candidate + one job to a versioned package containing tailored CV, optional cover letter, job-match analysis, application-question answers, outreach drafts, channel actions, approvals, submission evidence and timeline.
7. **Candidate approval is required** before any external submission or message send. The candidate reviews exact recipient, destination, content, CV attachment and answers. Approval is invalidated when approved content or attachment version changes.
8. **No paid integrations, deployment, new cloud resources, or external messages** without explicit user approval.

### Recommended delivery order

This is the product priority, not permission to bypass safety gates.

**Phase A: shared foundation**
- Inspect and reuse existing candidate profile, CV upload, job discovery/matching, chat UI and FastAPI routes.
- Establish canonical candidate career profile with source/provenance and candidate confirmation.
- Establish job requirement model and versioned application package.
- Preserve master CV; version all job-specific artifacts.
- Keep current in-memory backend demo-only and visibly labeled.

**Phase B: CV intelligence (core capability)**
- Parse uploaded CVs (PDF/DOCX) and conversational profile data into a canonical structured profile.
- Parse job descriptions into required/preferred qualifications, skills, experience, responsibilities and application questions.
- Produce evidence-linked match analysis: requirement, match status, supporting candidate evidence, missing/uncertain evidence and recommended truthful action.
- Generate job-specific ATS-friendly CV using a structured, parser-readable template; do not keyword-stuff or fabricate.
- Provide editable sections, review/diff, PDF + DOCX export, and validation for text extraction, headings, reading order, dates, links and layout.
- Explain that an internal match score is a heuristic, not a prediction of ATS ranking or acceptance.

**Phase C: three application paths**
- LinkedIn Easy Apply: identify/label Easy Apply opportunities only when source data provides reliable evidence. Prepare CV and answers; offer candidate-guided LinkedIn handoff. Direct application is enabled only through an official authorized integration and documented capability. Otherwise candidate completes submission on LinkedIn.
- Direct employer application: support a provider/ATS adapter boundary. Start with explicitly supported employer systems or official APIs, selected after technical and terms review. For unsupported forms, launch the official employer application page and provide a ready package. Capture confirmation only from a trustworthy response or candidate attestation, clearly distinguished.
- Hiring contact: contact/evidence capture, relevance explanation, LinkedIn message draft + manual handoff, and email draft + secure authorized send when configured. Attach the exact approved tailored CV version to email. For LinkedIn, show the CV as a ready artifact and explain that the candidate must attach it manually if LinkedIn's interface supports attachments. Never imply automatic attachment.

**Phase D: application tracking and learning**
- Unified timeline across preparation, approval, handoff, submission, outreach, replies and outcomes.
- Distinguish provider-confirmed, source-confirmed, and candidate-reported events.
- Learn from edits and outcomes only with transparent provenance and appropriate user controls.
- Measure application quality and meaningful progression, not raw application/message volume.

**Phase E: pilot hardening**
- Before multi-user or external-send pilot: PostgreSQL/migrations, authentication, candidate ownership and tenant isolation, audit trail, secrets management, HTTPS, rate limits, suppression, idempotency, retention/deletion and privacy/legal review.
- Validate supported integrations, vendor terms and regional requirements. No unsupported LinkedIn automation.
- Run end-to-end tests for each channel and failure/reconciliation paths.

### Core application package model (logical contract)

- candidate_id, job_id, package id, lifecycle status and timestamps.
- master profile version and source/provenance references.
- job snapshot and parsed requirements version.
- match analysis: requirement-level matches, evidence references, gaps, uncertainty and method/version.
- CV artifact: immutable version, source profile version, template/version, PDF/DOCX file references, extracted-text validation results and candidate approval.
- optional cover letter artifact.
- application answers: question, candidate-confirmed answer, evidence/source and review state.
- outreach: contact/evidence records and channel-specific drafts.
- approval: actor, timestamp, destination, content hash and artifact hashes.
- channel actions: channel, integration/provider, state, external reference and trustworthy confirmation evidence.
- append-only timeline events with provenance and actor.

Do not store file bytes or provider secrets in arbitrary JSON metadata. Use existing storage conventions for local/demo; design durable object storage only as part of an approved infrastructure decision.

### Revised success criteria

- Candidate can upload an existing CV OR build a profile conversationally.
- Candidate can select/paste a job and inspect requirement-level match evidence.
- Candidate can generate, edit, approve and export a job-specific ATS-friendly CV in PDF and DOCX without altering the master CV.
- Candidate can prepare an application package with supported questions/answers.
- Candidate can choose LinkedIn Easy Apply handoff, supported direct employer application, or hiring-contact outreach.
- Direct submissions and email sends are enabled only through authorized integrations with authentication, approval, idempotency and auditable provider confirmation.
- LinkedIn actions remain user-controlled unless formally authorized capability is established.
- Timeline accurately distinguishes prepared, approved, handed-off, submitted, candidate-reported and provider-confirmed states.
- UI remains a single continuous conversation with contextual cards, not a disconnected wizard.
- No fake success, fabricated contact, invented CV fact, or unsupported ATS-pass guarantee.

### Immediate implementation checkpoint

Inspect the current repository and Lovable implementation to identify existing CV/profile/job capabilities and reuse them. Produce a gap matrix mapping each locked requirement to existing code, missing backend contract, UI surface and test. Then implement the smallest end-to-end slice that proves the application package: selected job → candidate CV/profile → job analysis → tailored CV → review/approve → export. In parallel, define channel adapters and contracts, but do not fake or prematurely enable direct submission. The first demonstrable experience should make CV tailoring excellent while keeping all three application paths visible in the product architecture.
