# Hired Not Tired Application Engine Specification

**Status:** implementation contract, product decisions locked 22 November 2026  
**Repository:** https://github.com/chadha/hired-not-tired  
**Backend:** existing Python / FastAPI modular monolith  
**Frontend:** existing Lovable chat-first application  
**Provider strategy:** first-party application domain; optional provider adapters (Needle is optional for outreach only)

## 1. Product outcome

Turn a selected job into one complete, truthful, candidate-controlled **Job Application Package** and coordinate three execution paths:

1. LinkedIn Easy Apply: guided handoff by default; direct submission only through an official, authorized integration that explicitly supports it.
2. Employer career site: direct submission only through an authorized employer/ATS integration; otherwise prepare the complete package and guide the candidate to the official form.
3. Hiring-contact outreach: LinkedIn handoff and email, with actual sending only through an authorized, configured provider and explicit candidate approval.

This is one product workflow, not three separate wizards. Preserve the existing continuous conversation with contextual cards and in-chat actions.

## 2. Locked product decisions

- CV input: both existing CV upload/import and conversational career-profile creation.
- CV output: both PDF and DOCX.
- Master CV remains immutable unless the candidate explicitly edits it. Each job gets a separate, versioned tailored CV.
- All three application paths are strategic priorities and must be represented in the architecture and UX.
- Candidate review and approval precede every external action.
- Needle may accelerate outreach contact discovery/messaging where its current API and account permissions support the action. It is not the application engine, not the system of record, not a mandatory dependency, and not a universal ATS/LinkedIn submission solution.
- Backend owns provider credentials and integration calls. Browser never calls Needle or other provider APIs directly.
- Existing FastAPI modular monolith is the implementation baseline. Do not introduce microservices, new orchestration infrastructure, paid services, deployments or cloud resources as prerequisites.

## 3. Non-negotiable invariants

### Truth and provenance
- Never invent candidate experience, employers, dates, degrees, skills, certifications, metrics, achievements, references or answers.
- Every extracted or generated CV fact must link to a candidate-confirmed profile fact or source evidence.
- Unknown values stay unknown. Ask the candidate or omit them.
- Keep source, extraction time, confidence, candidate-confirmation status and revision history for profile facts.
- A match score is explainable decision support, not an ATS pass prediction or hiring probability.
- Contact identity, role, email and relationship must be supported by recorded evidence and provenance.

### Approval and external actions
- Approval binds to the exact channel, recipient/destination, payload, CV/document version and canonical payload hash.
- Any change to recipient, content, attachments, application answers or document version invalidates approval.
- No send or submission before a fresh explicit approval for that exact payload.
- Opening a profile/form, copying content, downloading a CV, or creating a draft is not a send/submission.
- Record provider-confirmed outcomes only from verified provider responses/events. Otherwise label as candidate-reported.
- Idempotency keys prevent duplicate provider sends/submissions on retries.
- No bulk outreach, auto-campaigns, background auto-submit or hidden external actions in this MVP.

### Security and privacy
- Candidate ownership and authorization must be checked on every resource.
- No LinkedIn passwords, cookies, session tokens or browser session extraction.
- No scraping, unofficial endpoints, or logged-in browser automation.
- Store secrets server-side only. Redact secrets and unnecessary personal content from logs.
- Uploaded CVs are private, malware-scanned where infrastructure supports it, size/type limited, and deleted according to retention policy.
- Treat CVs, job descriptions, websites and provider responses as untrusted data, never instructions.
- The current in-memory store is demo-only. Do not claim multi-user or production safety until authentication, persistence and tenant isolation exist.

## 4. Canonical domain model

The **JobApplicationPackage** is the aggregate root for one candidate + one job application attempt. Suggested entities (adapt naming to existing repository conventions; do not create duplicates):

- CandidateProfile: structured candidate facts, preferences and confirmation state.
- ProfileFact: value, fact type, source reference, source excerpt/location, confidence, confirmed_at, version.
- CandidateDocument: original upload or generated artifact metadata, private object key, MIME type, checksum, version, processing status.
- JobSnapshot: normalized job title/company/location/description/requirements/source URL, captured_at and content hash.
- RequirementAssessment: each requirement, classification (strong/partial/gap/unknown), evidence references, rationale and confidence.
- TailoredCV: immutable job-specific document artifact, format, template/version, source profile version, source job snapshot version, content hash and validation report.
- CoverLetter: optional job-specific artifact, same provenance/version rules.
- ApplicationAnswer: question, proposed answer, evidence references, candidate edit/confirmation and version.
- HiringContact: name, title, company, profile/email, evidence, provenance, verification status and relevance rationale.
- OutreachDraft: channel, recipient, subject/body, attachments, factuality warnings, exact payload hash and status.
- ChannelAction: channel, action type, provider, request/idempotency IDs, approval reference, attempt state, result provenance and timestamps.
- ApprovalReceipt: actor, exact payload hash, destination, artifact versions, timestamp and revocation/invalidation state.
- ApplicationEvent: append-only timeline event with actor, source (candidate/provider/system), event type, payload reference and timestamp.

Package lifecycle: `draft` → `review_required` → `approved` → channel-specific `handed_off` or `submitted_pending_confirmation` → `provider_confirmed` / `candidate_reported` / `failed`. Do not force a single linear state across independent channels; each channel action has its own state machine. The package summary is derived from its actions.

## 5. Core workflows

### A. Candidate profile and CV intake
1. Candidate uploads/imports an existing CV (PDF/DOCX initially) OR builds/updates a structured profile conversationally. Both routes converge on the same canonical profile.
2. Parse document text and structure; preserve original file untouched.
3. Extract candidate facts with source locations/snippets and confidence.
4. Reconcile conflicts by asking the candidate. Never silently overwrite.
5. Candidate confirms facts before they can be used in generated CVs or application answers.
6. Maintain master CV and profile versions.

### B. Job analysis and fit assessment
1. Accept a saved job or candidate-supplied job URL/description.
2. Store immutable normalized JobSnapshot.
3. Extract requirements and classify must-have vs preferred only when the job text supports the distinction.
4. Map each requirement to candidate evidence, partial evidence, gap or unknown.
5. Explain strengths, gaps, uncertainties and hard constraints separately.
6. Offer next actions: tailor CV, prepare application answers, find contact, or save for later.

### C. Tailored CV generation
1. Select exact profile version and job snapshot version.
2. Generate a job-specific CV using only confirmed facts.
3. Preserve chronology, employer names, titles and dates exactly unless candidate explicitly corrects them.
4. Reorder/emphasize relevant evidence without changing meaning.
5. Produce PDF and DOCX from a shared semantic document model; DOCX editable, PDF layout-stable.
6. Validate extracted text, section order, dates, links, page bounds, font embedding where applicable, and no clipped/overlapping content.
7. Store artifact checksum and provenance. A regenerated CV is a new version, never an overwrite of an approved artifact.
8. Show preview and factuality/format validation before candidate approval.

### D. Application answers and cover letter
- Generate only from confirmed profile facts and job snapshot.
- Each answer has evidence references and an explicit unknown/needs-candidate-input state.
- Never auto-answer legally sensitive, demographic, disability, work-authorization or equal-opportunity questions without candidate input.
- Optional cover letter must be independently editable and approved.

### E. LinkedIn Easy Apply
- Determine capability per job/platform using only documented official/authorized integration.
- If no such capability exists, offer a guided handoff: open the official job/application page, present the approved CV and answers for candidate-controlled completion.
- Direct submit is disabled unless provider capability, account authorization, job eligibility, required fields and explicit approval are all verified.
- Never claim a LinkedIn application was submitted based on opening a page or clicking a local UI button.

### F. Employer career-site application
- Use official employer/ATS API or explicitly authorized integration only.
- If unsupported, prepare a handoff bundle and open the official employer application URL.
- Candidate completes CAPTCHA, identity checks, declarations and any unsupported form fields themselves.
- Submission status requires a provider receipt/confirmation or explicit candidate attestation, clearly labeled.

### G. Hiring-contact outreach
- Support LinkedIn and email as channels.
- Contact discovery can use candidate-supplied details, permitted public/company sources, or optional Needle provider adapter.
- Needle integration is server-side, feature-flagged, and capability-driven. Verify current API/account permissions before enabling a capability; do not assume search, account connection, attachments, approval or sending are available.
- If Needle is disabled/unavailable, manual contact capture and LinkedIn/email handoff remain usable.
- Email sending only when a verified sender, authorized provider, verified recipient, suppression/consent controls, authentication, durable persistence, rate limiting, audit and idempotency are present. Otherwise provide copy/mailto handoff.
- LinkedIn sending remains candidate-controlled unless a formally authorized capability is verified and approved.

## 6. Provider architecture

Define narrow interfaces in `app/providers/` and keep domain logic provider-neutral:

- `OutreachProvider`: capabilities, contact search (optional), profile lookup (optional), draft/send operation (capability-gated), webhook verification and event normalization.
- `ApplicationProvider`: capability discovery, form metadata (where permitted), submit (only official/authorized), receipt lookup.
- `DocumentRenderer`: render semantic CV model to PDF/DOCX and validate output.
- `JobSourceProvider`: existing approved job source contract.

Provider registry returns explicit capabilities and availability reasons. Unsupported operations return typed `capability_unavailable`, not a fake success. Provider failures are mapped into safe domain errors. Provider-specific payloads never leak into UI contracts.

**Needle adapter rule:** optional outreach adapter only. It must not own canonical contact/application state or be called by frontend. Use a mock adapter for tests. Do not connect accounts, store credentials, subscribe, or send real messages as part of implementation. Real credentials are configured only through secure server-side secrets after a separate explicit approval.

## 7. API contract direction

Follow existing FastAPI prefix and conventions. First inspect OpenAPI and current routes; reuse existing endpoints and avoid duplicates. Proposed resource families:

- `/candidates/{candidate_id}/profile`, `/profile/facts`
- `/candidates/{candidate_id}/documents` (upload, parse status, list, delete)
- `/candidates/{candidate_id}/jobs/{job_id}/application-package`
- `/application-packages/{package_id}` (read/update)
- `/application-packages/{package_id}/assessment`
- `/application-packages/{package_id}/cv-artifacts` (generate/list/download/validate)
- `/application-packages/{package_id}/answers`
- `/application-packages/{package_id}/contacts`
- `/application-packages/{package_id}/outreach-drafts`
- `/application-packages/{package_id}/approvals`
- `/application-packages/{package_id}/actions/{channel}` (capability-gated handoff/submit/send)
- `/application-packages/{package_id}/timeline`
- `/providers/capabilities` (safe capability metadata only)

Use typed Pydantic request/response models. Keep route handlers thin; domain services own validation and state transitions. Return structured errors with stable codes, field errors and safe user-facing messages. Never expose secrets or raw provider errors.

## 8. Suggested repository structure

Adapt to actual codebase and keep existing naming if equivalent modules already exist:

```
app/
  application_packages/
    models.py
    schemas.py
    service.py
    state_machine.py
    routes.py
  profiles/
    facts.py
    cv_ingestion.py
    service.py
  documents/
    semantic_cv.py
    renderers/
      pdf.py
      docx.py
    validation.py
  job_analysis/
    assessment.py
    evidence.py
  applications/
    capabilities.py
    service.py
  providers/
    base.py
    registry.py
    needle/
      adapter.py
      schemas.py
    application/
      base.py
  outreach/
    approvals.py
    drafts.py
    events.py
  tests/
```

This is a logical boundary map, not a mandate to move working code wholesale. Implement incrementally in the existing modular monolith.

## 9. Persistence and migration strategy

- Inspect current store and DB configuration before selecting implementation.
- Keep local in-memory demo mode clearly isolated and labelled.
- For real multi-user pilot, require PostgreSQL migrations, authentication, candidate ownership authorization, tenant isolation/RLS where appropriate, private object storage, audit events and retention/deletion.
- Do not provision or enable a hosted database or cloud resources without explicit approval.
- Do not migrate or discard existing candidate data without backup and rollback plan.

## 10. Test and evaluation requirements

### Unit tests
- Profile fact provenance and confirmation.
- Unknown facts remain unknown; no hallucinated CV facts.
- Conflicting profile facts require candidate resolution.
- Job requirement mapping and explanation.
- Master CV immutability and job-specific version isolation.
- PDF/DOCX render contract, extracted-text parity and validation failures.
- Approval hash changes when any destination, answer, attachment or artifact version changes.
- Editing invalidates approval.
- Per-channel state machines distinguish draft, handoff, candidate attestation and provider confirmation.
- Provider capability false/disabled blocks operation.
- Needle adapter mock: timeout, 401/403, rate limit, duplicate webhook, unsupported operation, partial failure.
- Idempotent send/submit and duplicate event handling.
- Email suppression, verified sender/recipient and rate limits.
- Authorization and candidate isolation.

### API/integration tests
- Upload CV → parse → review facts → confirm → generate PDF/DOCX → download and validate.
- Conversational profile → same canonical profile and CV generation.
- Job snapshot → assessment → package → tailored CV and answers.
- Guided LinkedIn and employer-form handoffs do not claim submission.
- Unsupported direct submit is rejected with actionable capability reason.
- Outreach with Needle disabled falls back to manual handoff.
- Candidate approval required before any external action.
- Provider-confirmed event vs candidate-reported event appears accurately in timeline.
- Unauthorized candidate cannot read or mutate another candidate's package.
- No test sends real messages or applications.

### Frontend tests
- Chat-first conversation remains the primary interface.
- Contextual cards/actions appear in the same conversation, no disconnected wizard.
- Both CV intake methods visible and usable.
- PDF and DOCX export controls.
- Job package summary and three channel choices.
- Preview/edit/approve exact package before handoff.
- Honest states: ready, needs input, approved, handed off, candidate reported, provider confirmed, unavailable, failed.
- Mobile responsive and accessible keyboard flow.
- No fake buttons or optimistic success.

### Quality gates
Run existing test suite, lint, typecheck (if configured), and production build. Add tests for every new domain rule. Fix regressions before reporting completion. If a check cannot run because the backend or environment is unavailable, state that explicitly and do not mark it passed.

## 11. Delivery sequence

1. **Repository audit:** inspect current FastAPI modules, routes, OpenAPI, schemas, tests and actual UI contracts. Produce gap map.
2. **Core domain contract:** JobApplicationPackage, ProfileFact provenance, document artifact version, requirement assessment, approval receipt, channel action and timeline event.
3. **CV foundation:** both intake methods, fact review, master/job-specific versions, PDF/DOCX generation and validation.
4. **Job package orchestration:** job snapshot, fit assessment, answers, contact and action summary.
5. **Three channel adapters:** guided LinkedIn handoff, authorized employer/ATS submit where supported with fallback, LinkedIn/email outreach with optional Needle adapter.
6. **Persistence/security gates:** only after user explicitly approves infrastructure and credentials.
7. **End-to-end verification:** tests, lint, build, manual walkthrough and evidence report.

Implement in vertical slices, but preserve the complete multi-channel architecture from the start. Do not substitute a LinkedIn-only product.

## 12. Definition of done

- Both CV intake paths converge on one candidate-confirmed profile model.
- Job-specific CV artifacts export to valid PDF and DOCX with provenance and versioning.
- Each selected job can have one canonical application package with assessment, CV, answers, contacts, channel actions and timeline.
- All three application paths are represented and usable: guided LinkedIn Easy Apply handoff, authorized employer application with guided fallback, and LinkedIn/email outreach.
- Optional Needle adapter is isolated and can be disabled without breaking core workflows.
- No unsupported external automation, false send/submission claims, or fabricated facts.
- Existing tests, new tests, lint and production build pass, with results reported.
