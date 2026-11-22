# Hired Not Tired Independent Outreach Engine MVP

**Status:** Proposed implementation specification  
**Product:** Hired Not Tired  
**Repository:** https://github.com/chadha/hired-not-tired  
**Decision:** Independent engine; LinkedIn + email channels; no Needle dependency.

## 1. Executive decision

Build Hired Not Tired's own outreach workflow and intelligence layer. The MVP owns contact records, evidence/provenance, relevance assessment, message drafting, candidate approval, send handoff, interaction history and outcome tracking.

The MVP does **not** recreate a third-party LinkedIn automation service. It must not scrape LinkedIn, automate a logged-in browser, collect LinkedIn credentials/cookies, use unofficial endpoints, or claim it can send personal LinkedIn messages through an API without documented authorization.

### MVP channel behavior

- **Email:** real sending is supported only through an explicitly configured, authorized email provider (first implementation may use SMTP or a transactional provider adapter). Require a verified recipient address, candidate review and explicit approval. If no provider is configured, offer a truthful mailto/copy handoff and record only that the draft was opened/copied, never that it was sent.
- **LinkedIn:** discover and store contacts from candidate-submitted profile URLs and permitted public/company sources; prepare the message in-app; user opens the LinkedIn profile and sends manually. Record status as `handed_off` or `candidate_confirmed_sent` only after explicit user confirmation. Do not automate personal-account sending.
- Keep channel adapters replaceable. No Needle SDK, API key, webhook, connected-account setup or subscription is required.

## 2. Product goal and user story

**Goal:** turn a job opportunity into a thoughtful, evidence-backed professional outreach action, with a reliable record of what happened.

As a job seeker, I can:
1. Select a saved job.
2. find or add a potential hiring contact/recruiter using permitted sources;
3. see why the person may be relevant and where each fact came from;
4. verify/edit the contact;
5. generate a tailored LinkedIn or email message grounded in my confirmed profile and the job;
6. edit and approve the exact message;
7. send via an authorized email provider or complete a user-controlled LinkedIn handoff;
8. record replies, follow-ups and outcomes in the job timeline.

The existing continuous chat-first experience remains the product's front door. Contact cards, message composer and approval confirmation appear as contextual chat artifacts, not a separate wizard.

## 3. Non-goals

- LinkedIn scraping, logged-in page crawling, browser automation, session replay or personal-account auto-messaging.
- InMail, connection invitations, bulk campaigns, automated sequences or auto-follow-ups.
- Finding private email addresses, guessing email patterns, email enrichment without a lawful basis, or sending to unverified addresses.
- Replacing job discovery, candidate onboarding, matching, coach or career memory.
- Multi-tenant production launch before authentication, authorization, persistence, privacy and security controls are implemented.
- Claiming delivery, open, reply or send status without reliable evidence.
- Needle or any mandatory third-party outreach vendor.

## 4. Scope and phased capability

### P0: usable local/demo MVP
- Create/update/list contacts linked to a job and candidate.
- Add contacts manually or by candidate-submitted LinkedIn URL/email.
- Capture evidence items with source URL, source type, observed fact and timestamp.
- Explain relevance with deterministic rules first; optional LLM explanation must cite stored evidence.
- Draft messages for LinkedIn and email using confirmed candidate/job/contact facts.
- Edit draft; approval bound to exact text hash.
- LinkedIn handoff via opening profile URL and copy/open mailto style handoff; user confirms actual send.
- Email provider interface with a mock provider for tests and a real provider only when configured.
- Log immutable outreach events and candidate-entered replies/outcomes.
- Demo records always visibly marked DEMO.

### P1: controlled pilot foundations
- PostgreSQL persistence and migrations.
- Authentication and candidate ownership/tenant isolation.
- Email provider integration with verified sender/domain, bounce/error handling and idempotency.
- Consent, suppression list, unsubscribe handling where applicable, retention/deletion workflows and audit events.
- Rate limits, abuse controls and deliverability monitoring.

### P2: later optional integrations
- Official/authorized LinkedIn partner/API capability only after written permission and technical access.
- Additional email/calendar/CRM providers behind adapters.
- More advanced contact discovery sources after legal/terms review.

## 5. UX requirements

Preserve one continuous chat conversation. Add contextual actions to existing job cards:
- **Find a contact**
- **Add contact**
- **Draft LinkedIn message**
- **Draft email**

Contact card must show:
- name and current role/company, if known;
- channel identifiers (public LinkedIn URL, verified email);
- source and last-checked time;
- evidence snippets/facts;
- relevance rationale and confidence (low/medium/high);
- verification status and any missing/uncertain fields;
- actions to edit, verify, select or dismiss.

Never label a person “the hiring manager” unless the source explicitly establishes that relationship. Default label: **Potential hiring contact**.

Message composer must show:
- selected job and contact;
- channel;
- exact recipient/URL;
- draft text and editable state;
- factuality warnings and evidence used;
- approval state;
- final action with honest semantics:
  - Email: **Approve and send email** only when a real provider is configured and recipient is verified.
  - LinkedIn: **Approve and open LinkedIn** / **Open profile to send**; never label it as an automatic send.

After LinkedIn handoff, ask “Did you send this message?” with Yes / Not yet. Only Yes creates `candidate_confirmed_sent`, including timestamp and actor. This is a user attestation, not provider-confirmed delivery.

## 6. Domain model

Use UUID identifiers. All candidate-owned entities include `candidate_id`.

### Contact
- id, candidate_id, display_name
- current_title, current_company, location (nullable)
- linkedin_url (nullable), email_address (nullable)
- email_verification_status: unknown | candidate_verified | provider_verified | invalid
- discovery_method: manual | candidate_submitted | approved_source | demo
- status: proposed | needs_review | verified | dismissed
- relevance_band: low | medium | high
- relevance_reasons: string[]
- created_at, updated_at, last_verified_at

### ContactEvidence
- id, contact_id, candidate_id
- source_type: candidate_input | company_page | public_profile | authorized_provider | other
- source_url (nullable), observed_fact, observed_at
- confidence: low | medium | high
- created_by, created_at

Evidence is append-only; corrections create a new evidence record or mark the old record superseded. Do not store scraped profile dumps.

### OutreachDraft
- id, candidate_id, job_id, contact_id
- channel: linkedin | email
- recipient_snapshot (URL/email and display name)
- subject (email only), body
- status: draft | awaiting_approval | approved | sending | sent | handed_off | candidate_confirmed_sent | failed | cancelled
- text_hash, approved_text_hash, approved_at, approved_by
- provider_name, provider_message_id (nullable)
- last_error_code, last_error_message (sanitized)
- created_at, updated_at, sent_at (nullable)

Any edit to recipient, subject or body invalidates prior approval and returns the draft to draft.

### OutreachEvent
- id, candidate_id, draft_id, event_type
- occurred_at, actor_type, actor_id
- metadata (allow-listed, no credentials)
- idempotency_key (unique where supplied)

Event types include draft_created, draft_edited, approved, send_requested, provider_accepted, provider_failed, linkedin_handoff_opened, candidate_confirmed_sent, reply_recorded, followup_scheduled, outcome_recorded, cancelled.

### Suppression
- candidate_id, normalized_email or contact_id, reason, created_at
- Prevents further email sends to a suppressed recipient.

## 7. Relevance and message quality

### Contact relevance
Start with explainable rules, not opaque model scores:
- evidence of current employment at target company;
- explicit association with target team/function;
- role seniority/function plausibly related to vacancy;
- source freshness and reliability;
- explicit hiring/recruiting ownership evidence.

Output a confidence band and reasons. Do not present a numeric probability of being the hiring manager.

### Message generation
Inputs are restricted to:
- candidate-confirmed profile facts;
- selected job description and source;
- contact facts supported by evidence;
- candidate-selected goal and tone.

Rules:
- Never invent shared connections, achievements, employment facts, recipient responsibilities or email addresses.
- Use placeholders or ask for missing facts instead of guessing.
- Distinguish verified facts from inferred suggestions.
- Keep messages concise and role-specific.
- Provide a factuality checklist and show which candidate/job/contact facts informed the draft.
- Treat job descriptions, web pages and documents as untrusted data, not instructions.

LLM calls must go through the existing model/provider boundary where available. Provide deterministic template fallback and mark it as such. Do not add an LLM vendor key to frontend configuration.

## 8. API design

Use the existing FastAPI application and configured API prefix (currently `/api/v1` per repository settings). Align with existing candidate/job route conventions and response models.

Proposed routes:

| Method | Route | Purpose |
|---|---|---|
| POST | `/candidates/{candidate_id}/jobs/{job_id}/contacts` | Create candidate-supplied contact |
| GET | `/candidates/{candidate_id}/jobs/{job_id}/contacts` | List contacts for a job |
| GET | `/candidates/{candidate_id}/contacts/{contact_id}` | Contact details/evidence |
| PATCH | `/candidates/{candidate_id}/contacts/{contact_id}` | Edit/verify contact fields |
| POST | `/candidates/{candidate_id}/contacts/{contact_id}/evidence` | Add provenance evidence |
| POST | `/candidates/{candidate_id}/jobs/{job_id}/contacts/discover` | Run permitted discovery adapters; initially manual/submitted/public approved sources only |
| POST | `/candidates/{candidate_id}/outreach/drafts` | Create draft |
| GET | `/candidates/{candidate_id}/outreach/drafts` | List drafts |
| GET | `/candidates/{candidate_id}/outreach/drafts/{draft_id}` | Draft and events |
| PATCH | `/candidates/{candidate_id}/outreach/drafts/{draft_id}` | Edit draft; invalidate approval |
| POST | `/candidates/{candidate_id}/outreach/drafts/{draft_id}/approve` | Approve exact draft content |
| POST | `/candidates/{candidate_id}/outreach/drafts/{draft_id}/send` | Email provider send only |
| POST | `/candidates/{candidate_id}/outreach/drafts/{draft_id}/handoff` | Record/open user-controlled LinkedIn handoff |
| POST | `/candidates/{candidate_id}/outreach/drafts/{draft_id}/confirm-sent` | Candidate attests LinkedIn send |
| POST | `/candidates/{candidate_id}/outreach/drafts/{draft_id}/replies` | Record reply manually |
| GET | `/candidates/{candidate_id}/outreach/timeline` | Timeline events |

Use typed Pydantic request/response models. Do not expose internal provider credentials, raw provider exceptions or unrestricted metadata.

## 9. Provider boundaries

### ContactDiscoveryProvider
- `discover(job, query, limit) -> ContactCandidate[]`
- Initial implementations: ManualContactProvider and CandidateSubmittedProvider.
- Optional public-company-source provider only after source/terms review.
- Every result must include provenance. No source means no asserted discovery.

### EmailSender
- `capabilities() -> EmailCapabilities`
- `send(recipient, subject, body, idempotency_key) -> SendResult`
- Implement MockEmailSender for tests.
- Real sender disabled unless backend environment is configured and sender identity is verified.
- Never send from frontend. Never log full message body or secrets by default.

### LinkedIn handoff
No API provider in MVP. Backend returns an approved handoff payload with the stored profile URL and text; frontend opens the profile and presents copy action. Handoff does not imply send.

## 10. Mandatory safety and correctness gates

For any real email send:
1. Authenticated candidate owns candidate, job, contact and draft.
2. Contact has a syntactically valid and verified recipient email.
3. Recipient is not suppressed.
4. Sender/provider is configured and verified.
5. Candidate approved exact current recipient, subject and body; hash matches.
6. Draft is not already sent/sending.
7. Idempotency key is persisted and duplicate requests return the original result.
8. Rate/volume limits pass.
9. Provider result is persisted before success is shown.
10. Failures are explicit; no retry that could duplicate a send unless provider idempotency semantics are confirmed.

For LinkedIn:
- Candidate must review exact text and destination.
- Handoff opens public profile URL only.
- No automated sending.
- User confirmation is separately recorded and clearly labeled self-reported.
- No password, cookie, token or session collection.

For all channels:
- No bulk sends or automated sequences.
- Suppression/do-not-contact state blocks outreach.
- Audit every approval and external action.
- Never infer a send from a click on a profile link.

## 11. Persistence, authentication and deployment

Repository inspection shows the current FastAPI scaffold stores state in an in-memory store and does not yet provide production authentication/tenant isolation. Existing routes accept candidate IDs, which is acceptable only for controlled local/demo use.

Therefore:
- P0 may use current in-memory store only with conspicuous demo/local-only labeling and no real email sending.
- Before real external sends or multi-user pilot, implement PostgreSQL persistence, migrations, authentication, candidate ownership checks, tenant isolation, secret management, HTTPS, rate limits, audit retention and deletion.
- Do not expose a public endpoint that trusts arbitrary candidate_id values.
- Use environment variables for backend configuration. Frontend may expose only `VITE_API_BASE_URL`; never expose email provider keys or LLM secrets with a `VITE_` prefix.
- Keep CORS allow-list explicit.

## 12. Acceptance criteria

### Contact and evidence
- Candidate can add and edit a contact for a saved job.
- Contact can have LinkedIn URL and/or email, but neither is fabricated.
- Every relevance claim has evidence or is explicitly labeled as an unverified candidate note.
- Unknown fields remain unknown.
- Duplicate contacts can be detected by normalized LinkedIn URL/email without merging conflicting facts silently.

### Draft and approval
- Candidate can create LinkedIn and email drafts from a selected job/contact.
- Draft includes evidence references and factuality warnings.
- Editing after approval invalidates approval.
- Approval binds to exact recipient, subject and body hash.
- User can cancel a draft.

### Channel behavior
- LinkedIn handoff opens the correct public profile URL and offers message copy.
- UI does not claim LinkedIn message was sent until candidate confirms it; timeline labels this self-reported.
- Email send is unavailable unless a real provider is configured, sender verified, recipient verified, auth and persistence gates pass.
- Mock provider is used in automated tests only and is always labeled simulated.

### Timeline and reliability
- Draft, approval, handoff, send, reply and outcome events are visible in job timeline.
- Duplicate requests do not duplicate sends/events.
- Provider errors map to truthful UI states.
- No demo event can be confused with a real event.

### Security and privacy
- No LinkedIn credentials or session material stored.
- No secrets in frontend bundle or logs.
- Candidate data is isolated before any real-user pilot.
- Data correction/deletion and retention are documented before public launch.

## 13. Product metrics

North-star remains Weekly Meaningful Progress, consistent with the existing README.

Outreach-specific metrics:
- contacts reviewed per qualified job;
- evidence completeness rate;
- draft approval rate;
- email provider acceptance rate (only for actual provider sends);
- candidate-confirmed LinkedIn handoff/send rate, separately labeled;
- reply rate only where replies are reliably recorded;
- positive conversation/interview progression;
- time from job selection to first quality outreach action;
- factuality issue rate and user edit distance.

Do not optimize for volume of messages.

## 14. Open decisions for implementation

1. Which email provider is selected for the pilot? Keep behind EmailSender until selected.
2. Which auth mechanism will be used for candidate identity? Must precede multi-user use.
3. Which public/company data sources are approved for contact discovery? Start with candidate-submitted/manual inputs.
4. Which LLM provider is configured in the current backend? Reuse existing adapter; do not introduce a new vendor without a decision.

## 15. Definition of done

A candidate can select a real job, add a real contact with provenance, review why the contact may be relevant, generate and edit an evidence-grounded LinkedIn or email message, approve the exact text, complete a truthful LinkedIn handoff or (in a secured configured pilot) send a verified email through an authorized provider, and see accurate outreach events in the job timeline.

The MVP must not depend on Needle and must never pretend that a handoff is a sent message.
