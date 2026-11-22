# Hired Not Tired

**Your autonomous AI career companion.** Find relevant opportunities, prepare meaningful outreach, learn from every interaction, and keep moving forward.

This repository contains the **engine/API**. Build the candidate-facing experience in Lovable using the contracts in [docs/LOVABLE_HANDOFF.md](docs/LOVABLE_HANDOFF.md).

## MVP scope

- Candidate profile onboarding from CV text and user-provided LinkedIn profile data/URL.
- Job discovery through candidate-submitted URLs and configured public/approved job feeds.
- Explainable job matching with evidence and hard constraints.
- Personalized hiring-manager outreach drafts (human approval required before sending).
- Interaction capture and learning insights.
- Coach-first conversation that uses profile, application history and memory to recommend next actions.
- Deterministic demo mode so the complete experience works without cloud credentials.

## Run locally

Requirements: Docker + Docker Compose, or Python 3.11+.

```bash
cp .env.example .env
docker compose up --build
```

API docs: http://localhost:8000/docs  
Health: http://localhost:8000/health  
Demo seed: `POST /api/v1/demo/seed`

Without AWS credentials, the engine uses deterministic demo responses. To enable Bedrock, configure `AWS_REGION`, `AWS_BEDROCK_MODEL_ID`, and AWS credentials/role. No credentials are committed.

## Important integration boundaries

- LinkedIn profile data must be supplied by the candidate or acquired through an authorized integration. No scraping, credential collection, or bot activity.
- The engine drafts outreach. Sending messages and submitting applications remain candidate-approved actions unless a specific authorized integration permits otherwise.
- Job sources are adapters. Only use feeds/pages whose terms and access rules allow ingestion.
- Demo jobs and recruiter replies are clearly marked as simulated.

## API overview

All endpoints are under `/api/v1`. The API uses a demo candidate ID returned by onboarding or demo seed.

- `POST /candidates/onboard`
- `POST /candidates/{candidate_id}/documents/cv`
- `POST /candidates/{candidate_id}/profile/linkedin`
- `GET /candidates/{candidate_id}/profile`
- `PATCH /candidates/{candidate_id}/profile`
- `POST /jobs/discover`
- `GET /jobs`
- `POST /jobs/{job_id}/match/{candidate_id}`
- `POST /outreach/draft`
- `POST /interactions`
- `GET /career/memory/{candidate_id}`
- `POST /coach/chat`
- `GET /coach/action-plan/{candidate_id}`
- `POST /workflows/run`
- `GET /workflows/{workflow_id}`
- `POST /demo/seed`

See the OpenAPI spec at `/openapi.json` and the [Lovable handoff](docs/LOVABLE_HANDOFF.md).

## Production checklist

This is a hackathon-ready engine scaffold, not a claim of production certification. Before real users:
1. Add real authentication/authorization and tenant isolation.
2. Use managed PostgreSQL, encrypted object storage and secrets manager.
3. Configure Bedrock model access and evaluate prompts against a labeled dataset.
4. Add rate limiting, abuse protection, structured observability and alerting.
5. Validate data retention, deletion/export flows and privacy notice.
6. Add job-source-specific permission/compliance review.
7. Add integration tests, load tests, backup/restore and deployment health checks.

## Architecture

FastAPI modular monolith + Pydantic contracts + repository/service boundary. The MVP uses an in-memory store for frictionless local demo; replace it with PostgreSQL before production. The agent engine is deliberately provider-agnostic and exposes a Bedrock-compatible adapter point.
