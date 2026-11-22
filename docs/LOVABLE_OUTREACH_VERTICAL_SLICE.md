# Lovable handoff: first outreach vertical slice

Read these repository documents before changing the UI:
- OUTREACH_ENGINE_MVP_SPEC.md
- OUTREACH_ENGINE_IMPLEMENTATION_PLAN.md
- LOVABLE_HANDOFF.md

## Build only this first vertical slice

Select a saved job → add a contact → generate a message → approve → LinkedIn handoff → confirm sent → record response.

### Non-negotiable product UX

Keep the existing single, continuous chat-first experience. Do not create a separate wizard, dashboard redesign, multi-page funnel or disconnected outreach workspace. Render contextual cards and composer inline in the existing conversation.

### User journey and UI

1. On each existing job card, provide **Find/add contact**.
2. For this milestone, “Find contact” opens a small inline chat interaction that allows the candidate to add a contact manually. Do not imply automated LinkedIn search exists.
3. Contact fields: name (required), current title, company, public LinkedIn profile URL (required for LinkedIn handoff), optional location, source URL, evidence/notes. Unknown fields stay blank.
4. Render a **Potential hiring contact** card with the source/evidence, last checked time if available, confidence/uncertainty and an edit action. Never claim the person is the confirmed hiring manager without evidence.
5. Provide **Generate LinkedIn message**. Generate from the selected saved job, confirmed candidate profile and contact evidence only. Do not invent shared connections, achievements, recipient responsibilities or facts. If facts are missing, use a neutral message or flag the missing information.
6. Show an editable inline message composer with the exact LinkedIn destination, message text, concise personalization rationale and factuality warnings.
7. Provide an explicit approval confirmation showing the recipient profile and exact final text. The action is **Approve message**, not send.
8. Only after backend approval succeeds, enable **Open LinkedIn to send**. This opens the supplied public profile URL in a new tab and makes the approved message easy to copy. Do not automate LinkedIn, fill its message composer, or claim the message was sent.
9. After handoff, ask **Did you send this message?** with clear **Yes, I sent it** and **Not yet** actions. Only the Yes action records a candidate-confirmed/self-reported send.
10. Provide **Record a reply** with received date and reply text or summary. Save it to the selected job's outreach timeline. Label it candidate-recorded, not provider-verified.

### Backend integration

- Use only Hired Not Tired FastAPI endpoints under the configured VITE_API_BASE_URL.
- Inspect the actual OpenAPI schema and existing backend routes before wiring requests.
- Reuse existing endpoints and models where possible. Do not invent routes and assume they exist.
- If a required backend endpoint is missing, identify it explicitly and keep the UI in a truthful unavailable state; do not silently replace it with fake success.
- Centralize requests in the existing API client.
- Never call Needle or LinkedIn APIs directly from the browser.
- Never add secrets to frontend environment variables.
- Treat the current in-memory backend as demo/ephemeral only. Show a demo/local label where appropriate.

### State and approval rules

- States: draft → approved → handed_off → candidate_confirmed_sent. A reply is a separate timeline event.
- Editing recipient or message after approval must invalidate approval and require a new approval.
- Do not enable handoff before backend approval is confirmed.
- Opening LinkedIn is not proof of sending.
- Do not show a sent badge until the candidate explicitly confirms.
- Demo data and demo events must be clearly labeled DEMO.

### Out of scope for this task

- Email channel implementation.
- Automated LinkedIn discovery or scraping.
- LinkedIn API or partner integration.
- Browser automation or auto-send.
- Needle or any third-party outreach provider.
- Bulk campaigns, sequences and automatic follow-ups.
- Database migration, authentication redesign, deployment or paid services.
- Changes to onboarding, job matching, coach, or unrelated chat behavior.

### Visual and interaction requirements

- Preserve the existing visual language, spacing and chat conversation.
- Use inline cards and action buttons, not a new multi-step form.
- Keep the number of steps low; ask for only the contact details needed to proceed.
- Provide loading, empty, validation, success and error states.
- Never use fake contact identities, fake profile photos or fabricated LinkedIn URLs.
- All buttons must perform their advertised action.

### Testing and report

Test the complete path with a clearly labeled test contact and a saved job:
1. Select job.
2. Add contact.
3. Generate and edit message.
4. Approve exact message.
5. Open LinkedIn handoff.
6. Confirm sent.
7. Record a reply and see it in timeline.

Also test: missing profile URL, missing job, invalid URL, no backend, backend error, edit-after-approval, handoff-before-approval, repeated clicks, cancel/not-yet, and reply validation.

At completion, report:
- files/components changed;
- exact backend endpoints used;
- endpoints still missing;
- tests run and results;
- which data/states are real vs demo;
- confirmation that no external message was sent by the app and no third-party provider was connected.

Do not redesign the app. Do not implement extra features beyond this vertical slice.
