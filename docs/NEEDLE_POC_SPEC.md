# Needle Proof of Concept (PoC) Specification

**Product:** Hired Not Tired  
**Status:** Proposed implementation specification  
**Repository:** https://github.com/chadha/hired-not-tired  
**Scope:** One controlled, end-to-end test of hiring-contact discovery and candidate-approved LinkedIn outreach through Needle.

---

## 1. Executive summary

Validate whether Needle can power the highest-value Hired Not Tired workflow:

> Given a real job opportunity, find a relevant hiring contact, verify the contact's profile, prepare a personalized message, let the candidate approve it inside Hired Not Tired, send it from the candidate-authorized connected account, and record the actual send/reply events.

This is an integration spike, not a production launch. The PoC must establish the real API behavior, permissions, account ownership model, usage limits, event delivery, cost and operational risks before Needle becomes a product dependency.

**Success is not a polished mockup. Success is one real, explicitly approved message sent to one appropriate test contact through a connected test account, with the provider result recorded.**

No message may be sent during development, seeding, page load, contact search, draft generation or preview. The only send path is a deliberate candidate action after a clear confirmation.

## 2. Questions the PoC must answer

1. Can Hired Not Tired list and identify the Needle connected account available to the test user?
2. Can Needle search LinkedIn people using a company and relevant role/title keywords?
3. Can it retrieve a candidate contact's LinkedIn profile and connection status?
4. Can we create a lead in Needle and associate it with our job/contact records?
5. Can we prepare and display a personalized message inside Hired Not Tired?
6. Can our own approval button call Needle's direct-send endpoint, rather than requiring the candidate to copy text or visit LinkedIn?
7. Can we reliably record the actual send result and subsequent reply events?
8. What happens when the recipient is not a first-degree connection, an InMail is required, the account is disconnected, or a usage limit is reached?
9. What does Needle cost at the actual volume and account model we need?
10. What security, privacy, data-processing and platform-policy obligations apply?

## 3. In scope

### 3.1 One controlled scenario

Use one real job vacancy and one test candidate account. Search for a small number of likely hiring contacts at the employer. The candidate selects one contact, reviews one message and explicitly approves one send.

The test contact must be an appropriate professional contact for the role. Do not send unsolicited test messages to random people. Prefer a consenting test recipient or a contact who has explicitly agreed to receive the test.

### 3.2 User journey

1. Candidate opens a job opportunity in Hired Not Tired.
2. Candidate clicks **Find hiring manager**.
3. Backend searches LinkedIn people through Needle using the connected account, employer/company identifiers and role-relevant keywords.
4. UI displays candidate contacts with profile URL, name, current headline/title, company, location (when available), connection degree/status and source.
5. Hired Not Tired ranks contacts as *potentially relevant*, not confirmed hiring managers. It explains the evidence and uncertainty.
6. Candidate selects a contact.
7. Backend retrieves the LinkedIn profile through Needle and stores the source timestamp and relevant evidence.
8. Hired Not Tired generates a message using only the candidate's confirmed profile, job details and retrieved contact context.
9. Candidate can edit the message in Hired Not Tired.
10. Candidate sees the sending account, recipient, channel, exact message text and any relevant account/recipient constraints.
11. Candidate explicitly confirms **Send LinkedIn message**.
12. Backend validates approval, recipient eligibility, account state, suppression and idempotency, then calls Needle.
13. Hired Not Tired records Needle's returned message ID, conversation ID, sent timestamp and request ID.
14. A Needle webhook records later events, including a reply, and updates the candidate's career timeline.

## 4. Needle integration facts and constraints

The current Needle documentation describes a REST API at `https://needle.app/api/v1`, Bearer API-key authentication, and an MCP server at `https://needle.app/mcp/v1`. This PoC should use the REST API from the backend because it gives us a clear server-side integration boundary and avoids exposing provider credentials to the browser.

Relevant documented operations:

| Capability | Documented API |
|---|---|
| Authenticated workspace/user check | `GET /me` |
| List connected accounts | `GET /connected-accounts` |
| Search LinkedIn people | `POST /linkedin/people/search` |
| Retrieve LinkedIn profile | `GET /linkedin/profiles/{identity}?connectedAccountId=...` |
| Create/update lead | `POST /leads` or documented create/update operation |
| Send LinkedIn message | `POST /linkedin/messages` |
| List messages in conversation | LinkedIn conversation/messages endpoints |
| Webhooks | Create in Needle dashboard or documented webhook API; receive events at our HTTPS endpoint |

### 4.1 Direct message eligibility

Needle documents that a direct LinkedIn message can only be sent to a first-degree connection. Check the retrieved profile's `isConnected` value before offering this action.

For an out-of-network recipient, do not call the direct-message endpoint. The profile may expose `isOpenProfile`; InMail is a separate capability and may consume credits. InMail is explicitly outside the first PoC send path unless separately approved and budgeted.

### 4.2 Account connection

Needle documents that connecting a new LinkedIn account is dashboard-only. The API can list, update and delete connected accounts, but cannot initiate a new connection.

The UI must therefore show clear connection states:
- Connected and active
- Paused
- Needs reconnect / disconnected
- No account connected
- Provider unavailable / credentials not configured

Never ask for LinkedIn passwords, cookies, session tokens or browser storage. The user connects the test account through Needle's own dashboard.

### 4.3 Draft versus in-app approval

Needle's draft endpoint creates a draft that waits for a member to approve it in the Needle inbox. The documented API reference does not show a draft-approval endpoint.

For this PoC, use **Hired Not Tired's own explicit approval gate** followed by Needle's direct-send endpoint. This is the route that can provide an approval button inside our app. Do not create a Needle draft and imply that our UI can approve it unless Needle confirms an API capability for that operation.

The direct-send call must only happen after the backend verifies the persisted candidate approval.

### 4.4 Usage limits

Needle applies hourly, daily and weekly limits per action to connected accounts. The PoC must read and display available account state/usage where supported, handle HTTP 429 as a blocked send, and never attempt to bypass limits or retry aggressively.

### 4.5 Webhooks

Needle webhooks are HTTPS POST requests and use a signing secret shown once at creation. Configure the webhook in Needle and store the secret server-side. Verify authenticity using Needle's current documented signature-verification procedure before accepting events. Do not invent a signature header or verification algorithm; confirm it from the current webhook documentation/vendor if unclear.

Subscribe only to required events for the PoC, at minimum:
- `linkedin_message_sent`
- `linkedin_message_received`
- `account_connected`
- `account_reconnected`
- `account_disconnected`
- `account_paused`
- `draft_failed` only if drafts are later included

Persist provider event IDs and process events idempotently. Ignore unknown event types safely. A webhook event is authoritative for subsequent message/reply timeline updates, but the immediate direct-send response is the initial send confirmation.

## 5. Architecture

### 5.1 Components

- **Lovable frontend:** continuous chat-first journey, contact results, contact evidence, message editor, approval confirmation, send state and timeline.
- **Hired Not Tired FastAPI backend:** authentication boundary (existing scaffold currently lacks production auth), validation, Needle adapter, approval persistence, webhook receiver and audit trail.
- **Needle REST API:** connected account listing, LinkedIn search/profile lookup, direct send, conversations and webhook events.
- **Persistence:** current backend uses an in-memory store. For a local/controlled PoC, add a small persistence layer or explicitly document that state is ephemeral. Never claim durable tracking if events disappear on restart. Before a public multi-user pilot, use a persistent database and tenant isolation.

### 5.2 Provider adapter

Define a provider interface so the product is not coupled to Needle-specific payloads:

- `get_connection_status()`
- `list_connected_accounts()`
- `search_people(query, company, connected_account_id)`
- `get_profile(identity, connected_account_id)`
- `send_message(identity, text, connected_account_id, idempotency_key)`
- `list_conversation_messages(conversation_id, connected_account_id)`
- `verify_and_parse_webhook(headers, raw_body)`

Implement `NeedleProvider` behind this interface. The UI and career workflow must depend on Hired Not Tired API contracts, never call Needle directly.

### 5.3 Secret handling

- `NEEDLE_API_KEY` exists only in backend environment/secret manager.
- `NEEDLE_WEBHOOK_SECRET` exists only in backend environment/secret manager.
- Never use `VITE_` or frontend-exposed environment variables for secrets.
- Never return raw provider credentials to the client.
- Redact authorization headers and sensitive payloads from logs.
- Use HTTPS in deployed environments.

## 6. Proposed Hired Not Tired API contracts

Names are proposed for this PoC and may be aligned with the current FastAPI routing conventions.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/v1/integrations/needle/status` | Provider configured and account status |
| GET | `/api/v1/integrations/needle/accounts` | Safe connected-account summary |
| POST | `/api/v1/jobs/{job_id}/contacts/discover` | Search for potential contacts |
| GET | `/api/v1/jobs/{job_id}/contacts` | List saved contacts and evidence |
| POST | `/api/v1/contacts/{contact_id}/verify` | Refresh profile evidence |
| POST | `/api/v1/outreach/drafts` | Create a Hired Not Tired draft |
| POST | `/api/v1/outreach/{draft_id}/approve` | Persist explicit candidate approval |
| POST | `/api/v1/outreach/{draft_id}/send` | Send after all backend gates pass |
| GET | `/api/v1/outreach/{draft_id}` | Read message state |
| POST | `/api/v1/integrations/needle/webhooks` | Receive provider events |

### 6.1 Contact data model

Minimum fields:
- `id`, `candidate_id`, `job_id`, `company_id`
- `provider` = needle
- `provider_lead_id` (nullable until lead is created)
- `provider_identity` / LinkedIn public identifier
- `profile_url`, `full_name`, `headline`, `company_name`, `location`
- `is_connected`, `is_open_profile`, `degree`
- `relevance_reason`, `confidence`, `evidence[]`
- `discovery_status`, `last_verified_at`

Evidence entries must include source, observed fact, source URL/identifier and observed timestamp. Do not infer “this person is the hiring manager” from title alone. Label results “Potential hiring contact” until evidence supports a stronger claim.

### 6.2 Outreach draft data model

Minimum fields:
- `id`, `candidate_id`, `job_id`, `contact_id`
- `channel` = linkedin
- `connected_account_id` (provider ID; never a secret)
- `text`, `status`
- `approved_by_candidate_id`, `approved_at`, `approved_text_hash`
- `sent_at`, `provider_message_id`, `provider_conversation_id`, `provider_request_id`
- `failure_code`, `failure_message`
- `created_at`, `updated_at`

Statuses:
`draft` → `awaiting_approval` → `approved` → `sending` → `sent` or `failed`.
Webhook-driven reply adds a separate `reply_received` timeline event; it must not overwrite the original send status.

## 7. Mandatory send safety gates

The backend must reject sending unless ALL are true:

1. Authenticated candidate owns the job, contact and draft.
2. Candidate explicitly approved the exact current message text.
3. Approval is bound to a hash of the exact message text; any edit invalidates approval.
4. Connected account exists, is active and is authorized for this candidate/test.
5. Recipient identity is verified and matches the selected contact.
6. Profile confirms `isConnected=true` for direct messaging.
7. Recipient/company is not suppressed and no do-not-contact rule applies.
8. Message is within Needle's documented constraints and account usage limits.
9. Draft is not already sent or currently sending.
10. An idempotency key or equivalent persisted send-attempt guard prevents duplicate sends.

The UI must display the exact recipient, sender account, channel and final message text immediately before approval. The button must say **Approve and send LinkedIn message**. No hidden send-on-load, send-on-discovery, automatic campaign enrollment or background outreach.

If a precondition fails, show a truthful blocked state and the reason. Do not silently open LinkedIn or copy text to clipboard as a substitute.

## 8. Contact discovery and ranking

For one job, search with a small, bounded query set, for example:
- Company + exact job title
- Company + likely team/function (e.g. Platform Engineering, AI Engineering)
- Company + role families (e.g. Engineering Director, Head of Platform, Talent Acquisition)

The search result is a set of possible contacts, not proof of ownership of the vacancy.

Rank using explainable signals:
- Same current company (strong signal)
- Function/team alignment with job (strong signal)
- Seniority appropriate to hiring responsibility (moderate signal)
- Explicit job/team association from a source (strongest signal when available)
- Recruiter/talent role associated with company (moderate signal)
- Generic seniority or company affiliation alone (weak signal)

Show a short explanation and confidence band (low/medium/high) with evidence. Do not show a numeric “probability this person is the hiring manager” unless calibrated against labeled data.

Stop after a small result cap (e.g. 10 candidates) and respect provider limits. No scraping outside Needle's documented/authorized capabilities.

## 9. UX requirements

Preserve Hired Not Tired's single continuous chat-first interface.

The conversation should render:
- A **Find hiring manager** action in each job card.
- Search progress and a clear no-result state.
- Contact cards with name, headline, company, profile link, evidence, confidence and connection status.
- A contact selection action.
- An editable message composer embedded in the conversation.
- A clear connected-account indicator.
- An approval confirmation with recipient, sender and exact message.
- Send progress, success or failure based on actual backend response.
- A timeline with message sent and reply received events.

Do not create a disconnected multi-step wizard. Do not invent profile photos or contact identities. Use clearly labeled demo data only when the provider is not connected.

## 10. PoC acceptance criteria

### Discovery
- [ ] Backend can report Needle configuration and connected-account status without exposing secrets.
- [ ] Search returns actual provider results for a controlled test query.
- [ ] Each result includes provider identity and source timestamp.
- [ ] UI labels contacts as potential contacts, not verified hiring managers.
- [ ] Empty, error, rate-limit and disconnected-account states are handled.

### Profile verification
- [ ] A selected result can be looked up by Needle profile API.
- [ ] Connection degree, `isConnected` and `isOpenProfile` are represented correctly.
- [ ] No profile data is fabricated when provider fields are null or withheld.

### Approval and sending
- [ ] Draft can be created and edited inside Hired Not Tired.
- [ ] No Needle send call occurs before explicit candidate approval.
- [ ] Editing after approval invalidates the approval.
- [ ] Direct messaging is blocked unless `isConnected=true`.
- [ ] Exactly one approved test message can be sent through Needle.
- [ ] Provider message ID, conversation ID and sent timestamp are persisted.
- [ ] Duplicate-click/retry tests do not create duplicate messages.
- [ ] 401, 403, 404, 422, 429 and 5xx failures are mapped to honest UI states.

### Events
- [ ] Webhook authenticity is verified using Needle's documented procedure.
- [ ] Duplicate webhook delivery does not duplicate timeline events.
- [ ] A reply event is associated with the correct candidate, contact and job.
- [ ] Unknown event types are safely acknowledged/ignored as documented.

### Security
- [ ] Needle API key and webhook secret are never sent to the browser.
- [ ] Logs redact credentials and avoid storing unnecessary message/profile content.
- [ ] A candidate cannot read or send using another candidate's data.
- [ ] All sends are auditable with actor, approval timestamp, text hash, provider request ID and outcome.

## 11. Out of scope

- Multi-user production rollout.
- Multi-tenant account sharing or candidate self-service account connection inside Hired Not Tired.
- Automated campaign sequences or bulk messaging.
- InMail, paid credits or connection invitations.
- Instagram.
- AI-generated automatic sends.
- Job-board scraping or additional job providers.
- Production-grade career memory migration.
- Replacing the existing career engine or Lovable interface.

## 12. Cost and account assumptions

Needle's current public pricing page (checked for this specification) advertises a one-week free trial and a Pro plan at **$199 per agent/month with 20,000 credits**, plus enterprise/custom options. Pricing and billing unit should be reconfirmed with Needle before purchase; this is not a commitment to subscribe.

Use the free trial for a bounded test if available. Do not start a paid subscription, add credits, connect an account, or send a real message without the user's explicit approval.

Needle connected accounts are connected through Needle's dashboard, and the account owner controls sharing and permissions. The first PoC should use one explicitly authorized test account and one consenting recipient. Do not use a shared account across unrelated candidates.

## 13. Risks and go/no-go decision

### Risks
- Vendor account connection and workspace permission model may not fit a multi-tenant consumer SaaS.
- Needle's provider terms, data processing, retention, security and account-risk profile require review.
- LinkedIn restrictions and connected-account limits must be understood; a vendor integration does not remove platform-policy or user-account risk.
- Direct message availability is limited to first-degree connections; InMail is a separate paid/limited path.
- The current Hired Not Tired backend has in-memory storage and no production authentication/tenant isolation. It is not safe for real customer credentials or multi-user messaging until those foundations exist.
- Webhook signature verification and replay protection must be implemented correctly.

### Go criteria
Proceed to a limited beta only if:
- One real contact search and profile lookup succeeds.
- One consenting test recipient receives exactly one candidate-approved message.
- A reply is captured and correlated correctly.
- No send is possible without persisted explicit approval.
- The vendor's terms, data processing and security posture are acceptable.
- Costs and per-account limits are commercially viable.

Otherwise, keep Needle behind an optional provider adapter and do not make it a mandatory product dependency.

## 14. Implementation deliverables

1. `NeedleProvider` adapter in the FastAPI backend.
2. Typed Pydantic contracts for account status, contacts, evidence, outreach drafts, approvals, send results and webhook events.
3. Contact discovery and profile verification endpoints.
4. Candidate approval and guarded send endpoints.
5. Webhook receiver with signature verification, event idempotency and timeline updates.
6. Lovable UI integration using only Hired Not Tired backend endpoints.
7. Automated tests with a mocked Needle HTTP client; no real sends in automated tests.
8. A manual test checklist for one authorized account and consenting recipient.
9. A short PoC report: what worked, limitations, actual usage/cost and go/no-go recommendation.

## 15. Official Needle references

- [Needle API introduction](https://needle.app/docs/api-reference/introduction)
- [Needle connected accounts](https://needle.app/docs/connected-accounts)
- [Search LinkedIn people](https://needle.app/docs/api-reference/search-linkedin-classic-people)
- [Get a LinkedIn profile](https://needle.app/docs/api-reference/get-linkedin-profile)
- [Send a LinkedIn message](https://needle.app/docs/api-reference/send-linkedin-message)
- [Create a draft](https://needle.app/docs/api-reference/create-draft)
- [Needle webhooks](https://needle.app/docs/webhooks)
- [Needle pricing](https://needle.app/pricing)

---

**Definition of done:** Hired Not Tired can discover a plausible hiring contact for one real vacancy, show evidence, prepare a message, obtain explicit in-app approval, send one message through the authorized Needle connected account, and record the provider-confirmed send plus a reply event, without requiring the candidate to leave Hired Not Tired to search for the contact or send the message.
