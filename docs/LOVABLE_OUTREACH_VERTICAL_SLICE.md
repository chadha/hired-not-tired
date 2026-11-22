# Lovable handoff: CV-led application experience and three application paths

**Product decisions locked:** both CV creation methods; PDF + DOCX; LinkedIn Easy Apply guided handoff plus direct submission only through an official authorized integration; supported direct employer applications; hiring-manager outreach through LinkedIn handoff and email. Preserve the existing single continuous chat-first interface.

Read before changing the UI:
- OUTREACH_ENGINE_MVP_SPEC.md
- OUTREACH_ENGINE_IMPLEMENTATION_PLAN.md
- LOVABLE_HANDOFF.md

## Product outcome

Help a candidate go from a selected job to a truthful, tailored application and relevant professional outreach. The reusable unit is a versioned **Job Application Package**, not a one-off generated message.

## Primary candidate journey

1. **Find/select a job:** use existing job discovery and saved job cards. Clearly label LinkedIn Easy Apply only when reliable source data confirms it.
2. **Provide career history:** candidate can upload/import an existing CV (PDF/DOCX) OR build/complete a structured career profile conversationally. Both paths must be supported.
3. **Analyze the job:** parse required/preferred skills, experience, qualifications, responsibilities and application questions. Show requirement-level matches, candidate evidence, gaps and uncertainty. Do not treat a heuristic score as ATS acceptance probability.
4. **Create tailored CV:** generate an editable job-specific CV grounded in candidate-confirmed facts. Preserve the master CV; create an immutable version for each job. Never invent metrics, skills, employers, titles or qualifications.
5. **Review/export:** show a clear change/evidence review. Export both PDF and DOCX. Validate document text extraction, headings, reading order and layout. Editing after approval invalidates approval.
6. **Choose an application path:** show all supported paths in the same conversation:
   - **LinkedIn Easy Apply:** prepare CV and answers, then guide the candidate through LinkedIn's official UI. Direct submit is available only if backend reports a formally authorized official integration. Never scrape, automate a logged-in browser, collect credentials/cookies or use unofficial endpoints.
   - **Apply on employer site:** if an authorized, supported employer/ATS integration exists, prefill and submit only after explicit candidate approval. Otherwise open the employer's official application form and provide the ready package. Never show “submitted” without trustworthy confirmation.
   - **Contact hiring team:** identify/add evidence-backed potential contacts. Prepare LinkedIn message for manual handoff or email. Attach the exact approved tailored CV to email only when a secure authorized email provider is enabled. LinkedIn message and CV attachment are completed manually by the candidate where the LinkedIn UI supports attachments.
7. **Track outcomes:** one job timeline records preparation, CV version, approval, handoff, actual submission, outreach, replies and outcomes. Distinguish candidate-reported from provider-confirmed events.

## Job Application Package UI

Render contextual cards inline in the existing conversation:
- Selected job and application-channel capabilities.
- CV source: uploaded CV or conversational profile.
- Requirement match/evidence and missing information.
- Tailored CV preview, edit actions, version and PDF/DOCX export.
- Application question/answer review.
- Application path choices and exact destination.
- Contact evidence, message composer and approved CV attachment reference.
- Approval summary and timeline.

Do not create a separate multi-page wizard, unrelated dashboard redesign or disconnected outreach workspace. Keep the interaction conversational and low-friction.

## Backend integration rules

- Inspect actual FastAPI OpenAPI, existing CV/profile/job routes, schemas, storage and tests before wiring the UI.
- Reuse existing routes and models. Do not invent endpoints and pretend they exist.
- Centralize API calls in the existing API client and use VITE_API_BASE_URL.
- If a capability is missing, show a truthful unavailable/coming-next state and report the exact backend contract required.
- Keep provider credentials and LLM secrets backend-only.
- Existing in-memory backend is demo/ephemeral and must be visibly labeled; do not represent it as durable or multi-user safe.

## Safety and approval invariants

- All CV claims trace to candidate-confirmed source facts. Unknown facts remain unknown.
- Candidate reviews exact CV, answers, destination, recipient and message before external action.
- Approval binds to artifact version/hash and exact destination/content. Any edit invalidates approval.
- LinkedIn handoff is not submission or sending.
- Employer-form handoff is not submission.
- Only an authorized provider's trustworthy success response may create provider-confirmed submission/send status. Candidate attestations are self-reported.
- No scraping, unauthorized browser automation, fake contact identities, guessed email addresses, bulk outreach, or automatic follow-ups.
- No paid services, deployment, cloud resources or external messages without explicit approval.

## Testing requirements

Test both CV input paths; PDF/DOCX parsing; job parsing; evidence mapping; missing/contradictory facts; CV edits and versioning; PDF/DOCX export and text extraction; approval invalidation; Easy Apply vs non-Easy Apply capability states; direct employer integration success/failure/unsupported form; LinkedIn handoff without false sent status; email disabled/enabled gates and attachment version integrity; timeline provenance; backend unavailable and demo labeling.

## Completion report

Report:
- files/components changed;
- existing and new backend endpoints used;
- missing backend contracts and integrations;
- CV parsing/export/ATS validation tests and results;
- which application paths are truly integrated vs guided handoff;
- which states/data are real vs demo;
- confirmation no external application or message was submitted automatically and no paid provider/infrastructure was activated.

Implement in small, verifiable increments. Do not build fake integration buttons. First prove the application package from job selection through tailored CV review and PDF/DOCX export, then connect each authorized application channel.
