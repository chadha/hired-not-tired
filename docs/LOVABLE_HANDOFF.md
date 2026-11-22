

## Critical product requirement: in-app hiring-contact discovery and outreach

This is a core differentiator, not an optional convenience. The candidate must not have to manually research who owns a vacancy, copy a message, switch apps, and send it themselves.

### Required experience inside each opportunity

1. **Find the hiring contact:** offer an explicit "Find hiring manager" action for each job. Search permitted public company/team sources and authorized contact data. Candidate-submitted contact leads are also supported.
2. **Rank and verify:** show the best candidate contact(s), their name, current role, company, public professional profile URL where lawfully available, source/evidence, confidence, and the reason they are relevant to this particular vacancy.
3. **Be honest about uncertainty:** states are Not searched, Searching, Found, Needs review, and No reliable match. Never invent a person, email, relationship, or claim that a person owns a vacancy without evidence. A company executive is not automatically the hiring manager.
4. **Compose in context:** create a personalized message using the confirmed candidate profile, selected job, and evidence-backed contact context. Keep the draft, edits, approval, and history inside the app.
5. **Send from the app when authorized:** expose "Send from Hired Not Tired" only if a real, approved provider integration supports that exact message type and recipient. Require candidate review and explicit approval. Record provider response/message ID and delivery state where available.
6. **Track the relationship:** store draft, approval, sent, delivery, reply, follow-up due, and outcome events in the candidate's job timeline. Never mark a message sent based on opening a profile or clicking a deep link.

### LinkedIn-specific integration constraint

Do not assume that standard LinkedIn sign-in or the ordinary self-serve API grants permission to send member-to-member messages. LinkedIn API access is permission- and program-scoped, and LinkedIn prohibits unauthorized bots, scraping, and automated message activity. A LinkedIn Pages messaging integration available through an approved partner is not equivalent to permission to send messages from an individual's personal LinkedIn account.

Therefore:
- Build a provider adapter interface, but keep LinkedIn personal-account sending disabled until Hired Not Tired has written approval and a supported API/partner capability for this use case.
- Never request LinkedIn passwords, session cookies, or browser tokens.
- Never use browser automation, scraping behind login, unofficial APIs, or user-session replay.
- Do not call an external profile link "Send". Opening a profile is not sending a message.
- If sending is unavailable, keep contact discovery, verification, message composition, approval, and timeline tracking in Hired Not Tired. Clearly show the actual blocker; do not silently fall back to copy/paste as if the requirement were met.
- Support other authorized channels (for example, email) only when a legitimate provider integration and recipient address are available and the candidate explicitly approves sending.

### Demo requirements

- Fictional contacts must be visibly labeled DEMO.
- Demo send/reply events must be labeled DEMO ONLY and must never be confused with a real external message.
- Do not seed a fake real-world hiring manager or fabricate a LinkedIn profile URL.

### Required UI states and tests

- Contact discovery status: not searched / searching / found / needs review / no reliable match.
- Evidence and confidence visible for every proposed contact.
- Contact source and last-checked timestamp visible.
- Provider connection and permission status visible.
- Message states: draft / awaiting approval / approved / sending / sent / failed / reply received.
- Sending disabled if provider permission is absent, recipient is unverified, or candidate approval is missing.
- Tests cover no fabricated contact, provenance/confidence display, explicit approval, send blocked without provider permission, truthful failure states, and demo labeling.

### API contract direction

Add typed resources/endpoints for:
- job-specific contact discovery and results;
- contact evidence/provenance and confidence;
- candidate selection/confirmation of a contact;
- outreach draft and candidate approval;
- provider connection/capability status;
- send request and provider result;
- message/reply/follow-up timeline events.

Do not represent these as production-ready until the backend persistence, authorization, provider access, and end-to-end tests exist.
