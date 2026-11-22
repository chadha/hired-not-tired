# Hired Not Tired

A chat-first career coach and candidate-controlled application workflow. The React/TanStack Start frontend preserves an explicitly fictional in-memory demo when no backend is configured. It never presents demo authentication, persistence, submission, delivery or contact discovery as real.

## Product workflow

- Confirm a conversational career profile or imported CV facts with immutable revisions.
- Import public job URLs, preserve source/retrieval evidence, and review requirement-level matches.
- Create versioned application packages, grounded answers, tailored CVs and cover letters; approve exact artifacts and export PDF/DOCX.
- Discover cited public hiring contacts only when an optional compliant search provider is configured, or use a contextual people-search/manual-contact fallback.
- Review, edit, approve and copy LinkedIn/email drafts; record handoffs, candidate-reported sends and replies without claiming provider delivery.

## Frontend

Requirements: Bun, Node.js and npm-compatible tooling.

```sh
bun install
bun run dev
bunx vitest run
bun run lint
```

Set `VITE_API_BASE_URL=http://localhost:8000` only when the separately runnable backend is available. Do not append `/api/v1`. In live mode, backend failures remain explicit and never substitute demo success.

## Standalone FastAPI backend

`backend/` contains LinkedIn OIDC (direct or existing-Supabase `linkedin_oidc`), secure opaque sessions, consent/account lifecycle, candidate-owned career persistence, Alembic migrations, provider boundaries, Docker-compatible deployment artifacts and PostgreSQL CI. See:

- [Backend setup and verification](backend/README.md)
- [Exact HTTP contract](backend/docs/API_CONTRACT.md)
- [Frontend integration](backend/docs/FRONTEND_INTEGRATION.md)
- [Security model](backend/docs/SECURITY.md)
- [Operator checklist](backend/docs/OPERATOR_CHECKLIST.md)

No production URL, cloud database, provider credential or successful real-provider login is included. External setup and deployment remain explicit operator actions.