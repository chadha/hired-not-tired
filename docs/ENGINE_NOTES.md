# Engine notes and known limitations

## Current implementation

- FastAPI endpoints with Pydantic request/response models.
- In-memory store for hackathon demo.
- Deterministic profile extraction, matching, interaction insight classification and coaching responses.
- Demo data seeded by API.
- Job-source adapter interface and candidate-submitted URL placeholder.
- CORS origins are configurable.
- Docker container and health endpoint included.

## Deliberate limits

- No production authentication, account isolation or authorization yet.
- In-memory store resets on restart.
- CV upload endpoint accepts extracted plain text; file parsing and malware scanning are not included.
- AWS Bedrock SDK dependency is included, but model invocation adapter is not yet wired into the coach. Current coach mode is deterministic demo.
- Candidate-submitted job URLs are not fetched or scraped.
- No LinkedIn API integration.
- No email/LinkedIn message sending.
- Matching formula is a heuristic and not a hiring probability.
- Not yet evaluated against a representative, human-labeled dataset.

## Production blockers

Do not expose to real customers until identity/tenant isolation, persistent storage, deletion/export, secure file handling, real LLM provider implementation, rate limiting, monitoring and legal/privacy review are implemented.
