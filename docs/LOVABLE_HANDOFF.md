# Lovable UI Handoff

## Product experience

Build a polished, responsive, **chat-first** web app for Hired Not Tired. The coach is the product's front door, not a separate chatbot hidden in a dashboard.

Tagline: **Your AI career agent. Your next opportunity. Your career, moving forward.**

Visual direction: confident, warm, premium productivity product. Avoid generic recruiting-site layouts. Main surface is a continuous conversation with contextual cards and compact progress panels.

## Required screens/states

1. Welcome / onboarding conversation.
2. CV upload and LinkedIn profile URL + user-provided profile data input.
3. Career profile confirmation (target role, location, salary floor, skills).
4. Chat home with coach greeting, daily plan and progress.
5. Opportunity cards (match score, reasons, gaps, salary, source and demo label).
6. Outreach draft preview with explicit user review and copy/open actions.
7. Interaction capture form for recruiter reply, interview, rejection, offer or note.
8. Coach response with empathetic context, evidence-based insight and action-plan cards.

## API connection

Set `VITE_API_BASE_URL` to the deployed FastAPI origin, e.g. `https://YOUR-API-HOST`. Use `/api/v1`.

Use these endpoints:
- `POST /demo/seed` to load the safe simulated judge scenario.
- `POST /coach/chat` body: `{ candidate_id, message, include_memory: true, include_recent_interactions: true }`.
- `GET /coach/action-plan/{candidate_id}`.
- `POST /candidates/onboard`.
- `POST /candidates/{candidate_id}/documents/cv`.
- `POST /candidates/{candidate_id}/profile/linkedin`.
- `GET /candidates/{candidate_id}/profile`.
- `POST /jobs/discover`.
- `GET /jobs`.
- `POST /jobs/{job_id}/match/{candidate_id}`.
- `POST /outreach/draft`.
- `POST /interactions`.
- `GET /career/memory/{candidate_id}`.

Swagger/OpenAPI is exposed at `/docs` and `/openapi.json`.

## Suggested interaction flow

- On first launch, explain that the candidate remains in control of external actions.
- Offer "Try the live demo" which calls `POST /demo/seed`.
- Display the returned candidate and jobs.
- When a user selects a job, call matching endpoint and show the score with supporting evidence.
- For outreach, call draft endpoint. Never imply it was sent. Include copy and open LinkedIn/profile link controls.
- Simulate recruiter feedback only in an explicitly labeled demo scenario, or let the real candidate enter pasted feedback.
- On the coach turn, pass the user's message to `/coach/chat` and render response insights/actions.
- Persist the candidate ID in the app's own backend/session mechanism; don't put sensitive CV content in localStorage.

## Lovable implementation prompt

Build the Hired Not Tired frontend as a mobile-responsive chat-first career companion. Connect to the existing FastAPI API using `VITE_API_BASE_URL`. Start by calling `POST /api/v1/demo/seed` to render a complete demo experience. The main page should feel like a conversation with a thoughtful AI career coach. Use contextual cards inside the conversation for candidate profile, matched jobs, outreach drafts, recruiter interactions and recommended action plans. Implement loading, empty, error and retry states. Never claim an outreach message or job application has been sent automatically. Mark demo candidate, jobs and recruiter feedback as simulated. Use real API calls, not hardcoded frontend-only responses. Keep all external actions candidate-approved. Add a settings/privacy area explaining what profile information is stored and how the user can request deletion.

## UI acceptance criteria

- A new visitor can understand the value proposition in under 10 seconds.
- A demo can be completed in under 4 minutes.
- Coach chat is the primary interaction and remains continuous.
- Job match reasons and gaps are visible, not only a percentage.
- Outreach is clearly labeled "Draft - not sent".
- Simulated data is visibly labeled.
- Mobile layout works at 375px wide.
- All API failures show useful retry guidance.
