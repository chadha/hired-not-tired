# Hired Not Tired

> **Your AI career companion. From job-search chaos to confident career momentum.**

Hired Not Tired helps active job seekers run a more focused, relationship-led job search. It brings candidate onboarding, opportunity discovery, explainable matching, hiring-manager outreach preparation, interaction learning, and personal coaching into one continuous experience.

**Product thesis:** candidates do not need another vacancy list or another generic CV generator. They need an intelligent partner that understands their goals, helps them take the next useful action, learns from real interactions, and supports their momentum throughout the search.

This repository contains the **backend engine and API**. The candidate-facing experience is built separately in Lovable and integrates through [docs/LOVABLE_HANDOFF.md](docs/LOVABLE_HANDOFF.md).

---

## Product strategy

### Initial customer

Active job seekers who are ready to change roles and want structured help managing the complete search. The initial product wedge is technology, product, and engineering professionals, where role requirements and skills can be represented and evaluated with useful evidence.

### Value proposition

**Hired Not Tired coordinates the job-search journey, not just the job search.**

1. **Understand me:** build a reusable career profile from a CV, candidate-provided LinkedIn information, and stated goals.
2. **Find relevant opportunities:** discover jobs from multiple permitted sources and explain why each opportunity is or is not a fit.
3. **Help me connect:** prepare thoughtful, role-specific outreach to relevant hiring contacts.
4. **Learn with me:** turn replies, interviews, rejections, and other outcomes into structured career insights.
5. **Keep me moving:** provide a personal coach with a grounded next-best-action plan and supportive accountability.

### Differentiation

The differentiator is the combination of **career context + relationship intelligence + learning over time**. The product should remember what the candidate is aiming for, what has happened, what feedback was received, and which strategies are worth testing next.

We must not claim that a match score predicts hiring success. Scores are decision-support signals based on available evidence, not probabilities of receiving an offer.

### Product growth principle

Optimize for meaningful candidate progress, not vanity activity. More applications are not necessarily better. The product should encourage fewer, better-aligned opportunities and useful professional conversations.

North-star metric for the MVP:

- **Weekly Meaningful Progress (WMP):** active candidates completing at least one high-value job-search milestone in a week, such as reviewing a qualified opportunity, sending a candidate-approved outreach message, recording recruiter feedback, progressing an interview, or completing a coach-recommended action.

Supporting metrics:
- onboarding completion rate;
- time to first qualified opportunity;
- qualified-opportunity review rate;
- outreach draft-to-candidate-approved-send rate;
- recruiter response rate (only where reliable sent/reply events are recorded);
- interview progression rate;
- weekly action-plan completion;
- candidate-reported confidence and usefulness;
- workflow completion, latency, error rate, and cost per active candidate.

Do not optimize for message volume, applications submitted, or raw chat turns in isolation.

---

## Experience and core workflows

The primary interface is **one continuous conversation with the career coach**, enriched with contextual cards for profiles, job matches, outreach drafts, interactions, and action plans. The coach is the front door; specialist capabilities operate behind it.

### Workflow A: Candidate onboarding

**Goal:** build a trustworthy, editable candidate profile and establish search constraints before recommending opportunities.

~~~mermaid
flowchart TD
    A[Candidate starts conversation] --> B[Upload CV]
    B --> C[Provide LinkedIn URL and/or candidate-supplied profile data]
    C --> D[Extract structured experience and skills]
    D --> E[Reconcile sources and flag uncertainty]
    E --> F[Ask career goals and target roles]
    F --> G[Capture location, work mode and salary preferences]
    G --> H[Show profile summary for candidate confirmation]
    H --> I[Persist approved career profile]
    I --> J[Initialize career memory and coach context]
~~~

**Inputs**
- CV document or extracted CV text;
- LinkedIn URL and/or profile information supplied by the candidate or obtained through an authorized integration;
- target roles, career direction, locations, work mode, salary floor, and other candidate preferences.

**Processing**
1. Extract structured facts such as roles, skills, experience, education, projects, and certifications.
2. Preserve source provenance so the candidate can see where a profile fact came from.
3. Reconcile duplicates and flag conflicts instead of silently guessing.
4. Separate verified candidate-provided facts from AI-inferred suggestions.
5. Ask the candidate to review and confirm the profile before it is used for matching.

**Outputs**
- canonical career profile;
- skill and experience inventory;
- search preferences and hard constraints;
- initial career-memory record;
- explicit consent and data-handling state.

**Acceptance criteria**
- Candidate can edit all extracted information.
- Missing information is represented as unknown, not fabricated.
- Profile facts retain provenance.
- No LinkedIn credentials are requested or stored.
- Candidate understands what information is retained and can request correction or deletion.

### Workflow B: Job discovery and matching

**Goal:** surface a small, ranked set of relevant opportunities with transparent evidence and useful next actions.

~~~mermaid
flowchart TD
    A[Confirmed career profile] --> B[Build search criteria]
    B --> C[Query approved job-source adapters]
    C --> D[Normalize job records]
    D --> E[Deduplicate by source and canonical URL]
    E --> F[Evaluate hard constraints]
    F --> G[Compare role requirements with profile evidence]
    G --> H[Generate strengths, gaps and uncertainty]
    H --> I[Rank and explain opportunities]
    I --> J[Candidate reviews shortlist]
    J --> K[Save decision and feedback]
    K --> L[Improve future search preferences]
~~~

**Source strategy**
- candidate-submitted job URLs and job descriptions;
- permitted public employer career pages;
- approved job feeds and licensed/authorized integrations;
- demo fixtures, visibly marked as simulated.

Every source adapter must document its access method, terms/permission basis, freshness, attribution, and parsing limitations. Do not scrape LinkedIn or bypass access controls.

**Matching approach**
- skills and domain alignment;
- relevant experience and seniority;
- responsibilities and role scope;
- career direction;
- candidate preferences.

Apply hard constraints such as minimum salary and location separately from the relevance score. Missing salary or unclear work mode should be shown as unknown, not treated as a match.

Each match should include:
- score and confidence label;
- evidence supporting the match;
- strengths and potential gaps;
- hard-constraint status;
- source and last-checked timestamp;
- recommended next action.

Initial scoring weights are hypotheses to calibrate with human-reviewed examples. They are not validated hiring predictors.

**Acceptance criteria**
- Jobs are deduplicated and traceable to a source.
- The candidate can understand why a job was ranked.
- Salary/location conflicts are surfaced.
- The system never invents job details or hiring contacts.
- Candidate feedback can adjust future preferences.

### Technical architecture: orchestrated career engine

**Architecture decision:** start with a modular monolith, not a fleet of microservices. One API, one deployable backend, shared typed contracts, and specialist agent capabilities orchestrated as bounded workflow steps. This keeps the system buildable by a small hackathon team while preserving clear module boundaries.

~~~mermaid
flowchart TB
    C[Candidate] --> UI[Lovable React UI<br/>Continuous coach conversation]
    UI --> API[FastAPI API layer]
    API --> AUTH[Identity, consent and policy boundary]
    AUTH --> ORCH[Career workflow orchestrator]

    subgraph CAP[Specialist capabilities]
      PROF[Profile capability]
      DISC[Job discovery capability]
      MATCH[Matching capability]
      OUT[Outreach capability]
      LEARN[Interaction learning capability]
      COACH[Personal coach capability]
    end

    ORCH --> PROF
    ORCH --> DISC
    ORCH --> MATCH
    ORCH --> OUT
    ORCH --> LEARN
    ORCH --> COACH

    PROF --> LLM[LLM provider adapter]
    MATCH --> LLM
    OUT --> LLM
    LEARN --> LLM
    COACH --> LLM
    DISC --> SRC[Approved job-source adapters]

    subgraph DATA[Governed data layer]
      PG[(PostgreSQL)]
      VEC[(pgvector)]
      OBJ[Encrypted object storage]
      AUD[Audit and workflow events]
    end

    PROF --> PG
    PROF --> OBJ
    DISC --> PG
    MATCH --> PG
    OUT --> PG
    LEARN --> PG
    COACH --> PG
    COACH --> VEC
    ORCH --> AUD
~~~

**Logical components**
- **Experience layer:** Lovable UI; continuous chat, contextual cards, progress and approvals.
- **API layer:** FastAPI routes, request validation, authentication, authorization, rate limits, and response contracts.
- **Orchestration layer:** coordinates stateful candidate workflows, retries, checkpoints, and specialist capability calls.
- **Specialist capabilities:** profile, discovery, matching, outreach, learning, and coach.
- **Integration layer:** LLM provider adapter, job-source adapters, document storage, and optional approved communication integrations.
- **Data layer:** relational system of record, vector retrieval for semantic memory, object storage for documents, and audit/workflow events.
- **Evaluation/observability:** traces, structured logs, quality evaluations, latency, token/cost telemetry, and failure monitoring.

**Technology direction**

| Layer | Initial choice | Design constraint |
|---|---|---|
| UI | Lovable-generated React + TypeScript | API-driven; chat-first |
| API | Python + FastAPI + Pydantic | Typed, versioned contracts |
| Orchestration | LangGraph-compatible workflow boundary | Durable state and bounded tools |
| LLM | AWS Bedrock through provider adapter | Model access configurable, not hard-coded into business logic |
| System of record | PostgreSQL | Relational facts and transactional updates |
| Semantic memory | pgvector | Retrieval supplements, never replaces, structured facts |
| CV/object storage | S3-compatible encrypted storage | Private objects, short-lived access |
| Runtime | Docker; AWS deployment target | Health checks, secrets management, least privilege |

**Agent and tool boundaries**
- Agents receive only the candidate context needed for their task.
- Tool calls are allow-listed and validated.
- Job descriptions and uploaded documents are untrusted input, never system instructions.
- External actions are separated from planning and drafting.
- Every action has an actor, permission check, status, and audit event.
- The coach can recommend and coordinate; it cannot bypass approval policies.

### Workflow C: Hiring manager outreach

**Goal:** help a candidate build a relevant professional connection with a credible, personalized message.

~~~mermaid
flowchart TD
    A[Candidate selects qualified job] --> B[Find publicly identified hiring contact, if available]
    B --> C[Collect permitted professional context]
    C --> D[Retrieve candidate evidence relevant to role]
    D --> E[Draft concise personalized message]
    E --> F[Check factual claims, tone and relevance]
    F --> G[Save draft and rationale]
    G --> H[Candidate reviews and edits]
    H --> I{Candidate approves external action?}
    I -- No --> J[Keep draft; no message sent]
    I -- Yes --> K[Open permitted communication channel or authorized integration]
    K --> L[Record candidate-confirmed send event]
    L --> M[Track follow-up and response]
    M --> N[Send interaction to learning workflow]
~~~

**Inputs**
- selected job and job requirements;
- hiring contact details supplied by the candidate or discovered from permitted public/authorized sources;
- candidate profile, relevant projects, and demonstrated strengths;
- candidate's preferred tone and communication goal.

**Outputs**
- message draft;
- personalization rationale;
- factuality checklist;
- contact/source provenance;
- status such as draft, candidate-approved, or candidate-confirmed sent.

**Guardrails**
- Never fabricate a hiring manager, email address, relationship, or shared experience.
- Never claim a message was sent when the engine only generated a draft.
- Candidate approval is required before sending through an external channel.
- LinkedIn automation, unauthorized scraping, and credential collection are out of scope.
- Use official APIs or authorized integrations only where access and use are permitted.

**Acceptance criteria**
- The draft contains specific, evidence-backed relevance.
- Unsupported claims are flagged for review.
- Candidate can edit, copy, and open the relevant channel.
- Sent status is recorded only after reliable candidate confirmation or an authorized provider result.

### Workflow D: Personal AI coach

**Goal:** be the candidate's trusted operating partner: understand their context, identify the next useful move, support momentum, and learn from outcomes.

~~~mermaid
flowchart TD
    A[Candidate opens coach conversation] --> B[Load profile and consented context]
    B --> C[Retrieve recent jobs, applications and interactions]
    C --> D[Retrieve relevant strategic memory]
    D --> E[Identify goal, blocker and emotional context]
    E --> F[Generate grounded assessment]
    F --> G[Propose prioritized next-best actions]
    G --> H[Explain why each action matters]
    H --> I{Candidate chooses or delegates}
    I --> J[Execute permitted internal workflow]
    J --> K[Record outcome and progress]
    K --> L[Update episodic memory]
    L --> M[Evaluate whether strategic memory should change]
    M --> A
~~~

**Coach responsibilities**
1. **Strategic guidance:** prioritize opportunities and search strategy.
2. **Tactical help:** prepare outreach, applications, interview preparation, and follow-ups.
3. **Development:** identify evidence-backed skill gaps and propose focused learning actions.
4. **Emotional support:** acknowledge frustration without toxic positivity, pressure, or unsupported promises.
5. **Accountability:** help the candidate choose realistic actions and reflect on completed steps.

**Memory model**
- **Profile memory:** stable candidate facts, ambitions, preferences, and constraints.
- **Episodic memory:** timestamped applications, outreach, recruiter responses, interviews, decisions, and outcomes.
- **Strategic memory:** hypotheses and evidence about what is working for this candidate, with confidence and recency.

Strategic memory must distinguish observations from hypotheses. A single rejection is not proof of a skills gap; a few messages are not enough to establish a reliable outreach pattern. The coach should cite the relevant candidate history in its explanation and ask for correction when context is incomplete.

**Coach response contract**
- empathetic, direct response;
- relevant evidence/insights;
- prioritized recommended actions;
- estimated effort and expected purpose;
- explicit confirmation for actions that affect external systems;
- no guarantee of employment or interview outcomes.

---

## Database design

### Data architecture principles

1. PostgreSQL is the source of truth for candidate, job, application, interaction, and workflow state.
2. JSONB is appropriate for flexible extracted attributes and source payload snapshots, but important relationships and queryable fields remain relational.
3. pgvector is an optional retrieval index for semantic memory; it is not the canonical store of candidate facts.
4. CVs and other uploaded documents live in private encrypted object storage. Store metadata and references in PostgreSQL, not public file URLs.
5. Every candidate-owned record is tenant-scoped and protected by authorization. Row-level security can provide defense in depth.
6. Record provenance, timestamps, consent, retention, and deletion status.
7. Do not store LinkedIn passwords, session cookies, or unnecessary sensitive data.

### Core entities

~~~mermaid
erDiagram
    CANDIDATE ||--|| CAREER_PROFILE : has
    CANDIDATE ||--o{ CANDIDATE_DOCUMENT : uploads
    CANDIDATE ||--o{ JOB_MATCH : receives
    JOB ||--o{ JOB_MATCH : evaluated_in
    CANDIDATE ||--o{ APPLICATION : manages
    JOB ||--o{ APPLICATION : relates_to
    APPLICATION ||--o{ INTERACTION : records
    CANDIDATE ||--o{ CAREER_MEMORY : owns
    CANDIDATE ||--o{ ACTION_PLAN : receives
    ACTION_PLAN ||--o{ ACTION_ITEM : contains
    CANDIDATE ||--o{ OUTREACH_DRAFT : creates
    JOB ||--o{ OUTREACH_DRAFT : contextualizes
    CANDIDATE ||--o{ WORKFLOW_RUN : initiates
    CANDIDATE ||--o{ AUDIT_EVENT : generates

    CANDIDATE {
      uuid id PK
      string email
      string display_name
      timestamp created_at
      timestamp deleted_at
    }
    CAREER_PROFILE {
      uuid id PK
      uuid candidate_id FK
      string career_goal
      jsonb target_roles
      jsonb skills
      jsonb preferences
      timestamp updated_at
    }
    CANDIDATE_DOCUMENT {
      uuid id PK
      uuid candidate_id FK
      string object_key
      string document_type
      string processing_status
      timestamp created_at
    }
    JOB {
      uuid id PK
      string source
      string source_external_id
      string canonical_url
      string title
      string company
      string location
      jsonb requirements
      timestamp last_seen_at
    }
    JOB_MATCH {
      uuid id PK
      uuid candidate_id FK
      uuid job_id FK
      int score
      string confidence
      jsonb evidence
      boolean constraints_met
    }
    APPLICATION {
      uuid id PK
      uuid candidate_id FK
      uuid job_id FK
      string status
      timestamp created_at
    }
    INTERACTION {
      uuid id PK
      uuid application_id FK
      string interaction_type
      text content
      string source
      boolean simulated
      timestamp occurred_at
    }
    OUTREACH_DRAFT {
      uuid id PK
      uuid candidate_id FK
      uuid job_id FK
      text message
      string status
      jsonb approval_record
    }
    CAREER_MEMORY {
      uuid id PK
      uuid candidate_id FK
      string memory_type
      text content
      jsonb evidence_refs
      float confidence
      timestamp updated_at
    }
    ACTION_PLAN {
      uuid id PK
      uuid candidate_id FK
      string status
      timestamp created_at
    }
    ACTION_ITEM {
      uuid id PK
      uuid action_plan_id FK
      string title
      string status
      string priority
    }
    WORKFLOW_RUN {
      uuid id PK
      uuid candidate_id FK
      string workflow_type
      string status
      jsonb result
      timestamp created_at
    }
    AUDIT_EVENT {
      uuid id PK
      uuid candidate_id FK
      string actor
      string action
      jsonb metadata
      timestamp created_at
    }
~~~

### Entity responsibilities

| Entity | Purpose |
|---|---|
| Candidate | Identity, account and lifecycle |
| CareerProfile | Confirmed goals, skills, experience and preferences |
| CandidateDocument | Private document metadata and processing state |
| Job | Normalized opportunity and source provenance |
| JobMatch | Candidate/job evaluation, evidence, constraints and confidence |
| Application | Candidate's relationship with a specific opportunity |
| Interaction | Outreach, recruiter replies, interviews, rejection, offer, and notes |
| OutreachDraft | Message content, rationale, approval and send state |
| CareerMemory | Profile, episodic and strategic memory with evidence |
| ActionPlan / ActionItem | Coach-generated actions and candidate progress |
| WorkflowRun | Orchestration state, result, errors and trace references |
| AuditEvent | Security-relevant and externally consequential activity |

### Suggested constraints and indexes

- Unique normalized job identity on (source, source_external_id) when the source provides a stable ID.
- Unique candidate/job application relationship where product rules require one active application.
- Index all candidate-owned tables by candidate_id.
- Index interactions by (application_id, occurred_at DESC).
- Index job search fields such as title, company, location, and freshness.
- Use vector indexes only after measuring retrieval quality and scale.
- Enforce tenant/candidate ownership in the API and database policies, not only in the UI.

### Current implementation versus target architecture

The current hackathon engine uses an in-memory store to make the demo easy to run. The schema above is the **target persistent data model**, not a claim that PostgreSQL migrations, pgvector, object storage, row-level security, or production identity are already implemented.

Before real candidate data is accepted, implement persistent storage, authentication, candidate-level authorization, secure document handling, data export/deletion, and retention controls.

---

## API overview

All endpoints are under /api/v1. OpenAPI is available at /openapi.json; interactive documentation is available at /docs.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /candidates/onboard | Create candidate profile |
| POST | /candidates/{candidate_id}/documents/cv | Submit extracted CV text |
| POST | /candidates/{candidate_id}/profile/linkedin | Add candidate-provided LinkedIn data |
| GET | /candidates/{candidate_id}/profile | Read profile |
| PATCH | /candidates/{candidate_id}/profile | Update profile |
| POST | /jobs/discover | Discover jobs through configured adapters |
| GET | /jobs | List known jobs |
| POST | /jobs/{job_id}/match/{candidate_id} | Evaluate a job match |
| POST | /outreach/draft | Generate outreach draft |
| POST | /interactions | Record candidate interaction |
| GET | /career/memory/{candidate_id} | Read career memory |
| POST | /coach/chat | Send coach message |
| GET | /coach/action-plan/{candidate_id} | Retrieve action plan |
| POST | /workflows/run | Start a workflow |
| GET | /workflows/{workflow_id} | Read workflow status |
| POST | /demo/seed | Seed simulated judge scenario |

The API is an evolving MVP contract. The Lovable frontend should use the live OpenAPI document as the integration source of truth and handle unavailable capabilities gracefully.

---

## Run locally

Requirements: Docker + Docker Compose, or Python 3.11+.

~~~bash
cp .env.example .env
docker compose up --build
~~~

- API: http://localhost:8000
- Health: http://localhost:8000/health
- Swagger: http://localhost:8000/docs
- Demo seed: POST /api/v1/demo/seed

The current coach and matching capabilities use deterministic demo logic. AWS Bedrock configuration variables are present as integration direction, but a live Bedrock invocation is not yet wired into the current coach implementation.

### Demo data

The demo seed creates a fictional candidate and simulated job opportunities. Any simulated recruiter response or outcome must be labeled as demo data in the UI and must never be represented as a real vacancy, contact, or interaction.

---

## Repository structure

~~~text
hired-not-tired/
├── app/
│   ├── main.py                 # FastAPI routes and application
│   ├── config.py               # Environment configuration
│   ├── schemas.py              # Pydantic API contracts
│   ├── store.py                # In-memory demo store
│   ├── agents.py               # Profile, matching, learning and coach logic
│   └── sources.py              # Job-source adapter boundary
├── docs/
│   ├── LOVABLE_HANDOFF.md      # Frontend integration brief
│   └── ENGINE_NOTES.md         # Current implementation limits
├── tests/
│   └── test_api.py
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── .env.example
~~~

---

## Security, privacy, trust and responsible use

- **Candidate-side product:** this product assists job seekers; it is not an employer candidate-screening or hiring-decision system.
- **Data minimization:** collect only what is needed for the candidate's chosen workflow.
- **Consent and control:** explain data use, support correction and deletion, and make external actions visible.
- **Source integrity:** retain job source and retrieval timestamps; distinguish unknown from verified.
- **Human control:** candidate reviews outreach and controls external communications and applications.
- **No unauthorized LinkedIn automation:** no scraping, credential collection, bot messaging, or access-control circumvention.
- **Untrusted content:** treat job descriptions, uploaded documents, and pasted recruiter messages as data, not instructions to the agent.
- **Fairness:** evaluate recommendations for systematic disparities and avoid protected traits or proxies in ranking.
- **No false promises:** do not present match scores as hiring probabilities or coach recommendations as guarantees.

---

## Production readiness: explicit status

This repository is a **hackathon MVP scaffold**, not yet a production-ready service for real candidate data.

| Capability | Current status |
|---|---|
| FastAPI routes and typed contracts | Implemented |
| Deterministic demo onboarding/profile extraction | Implemented |
| Heuristic explainable matching | Implemented; needs evaluation |
| Outreach draft generation | Implemented; sending is not implemented |
| Interaction capture and basic insight rules | Implemented |
| Deterministic coach response and action suggestions | Implemented |
| Job-source adapter interface | Implemented; live adapters are not |
| Persistent PostgreSQL and migrations | Not implemented |
| pgvector memory retrieval | Not implemented |
| Authentication and candidate isolation | Not implemented |
| Production CV parsing, malware scanning and private object storage | Not implemented |
| Live AWS Bedrock inference | Not implemented |
| Production observability, rate limits and alerting | Not implemented |
| Data export/deletion and retention automation | Not implemented |
| Load, security and end-to-end evaluation | Not yet validated |

### Production gate

Before onboarding real users or storing real CVs:
1. Implement authentication, authorization, and candidate/tenant isolation.
2. Replace in-memory storage with PostgreSQL migrations and tested persistence.
3. Add encrypted private document storage, file validation, malware scanning, and deletion.
4. Wire and evaluate the selected Bedrock model behind a provider interface.
5. Add rate limiting, secrets management, audit trails, structured logs, traces, metrics, and alerts.
6. Implement privacy notice, consent, retention, export, and deletion workflows.
7. Validate each job-source integration's permissions and terms.
8. Run unit, integration, security, load, backup/restore, and end-to-end tests.

---

## Build principles

### Value by design
Every workflow should help the candidate make a better career decision or complete a meaningful next step.

### Secure by design
Candidate data, source provenance, permissions, and external actions are first-class architecture concerns.

### Adopted by design
The coach experience should reduce cognitive load, explain recommendations, celebrate real progress, and let the candidate stay in control.

**The product promise:** Don't just find another job listing. Build momentum toward the right next opportunity.


## Critical product requirement: hiring-contact discovery and in-app outreach

The candidate should not have to leave Hired Not Tired to research who is responsible for a vacancy, then copy a message into another app. Every opportunity should include a **Find hiring manager** workflow that identifies plausible hiring contacts, shows evidence and confidence, and lets the candidate review a personalized message in the same continuous experience.

The product must distinguish three separate capabilities:
1. **Contact discovery:** identify a likely hiring manager, team lead, department head, or recruiter from permitted sources. Show provenance, role, relevance, confidence, and last-checked time. Never fabricate a contact or imply that a person owns a vacancy without evidence.
2. **Message preparation and approval:** draft and edit outreach in-app, retain the candidate's approval record, and maintain a job-specific communication timeline.
3. **External sending:** send from Hired Not Tired only through a genuinely authorized provider integration that supports the channel and message type. Require explicit candidate approval and record the provider's result. Opening a LinkedIn profile is not sending a message.

**LinkedIn constraint:** standard LinkedIn sign-in does not imply permission to send personal member-to-member messages. LinkedIn API access is permission-scoped; unauthorized scraping, bots, and automated message activity are prohibited. An approved LinkedIn Pages messaging partner integration is not the same as personal-account messaging access. Keep personal LinkedIn sending disabled unless Hired Not Tired obtains written approval and a supported integration. Never use credentials, session cookies, browser automation, or unofficial APIs. Do not silently substitute copy/paste and claim the requirement is fulfilled.

The provider adapter should expose real capability/permission status. When no authorized sender is available, show the blocker honestly while keeping discovery, verification, message drafting, approval, and tracking in the app. Support other channels only through authorized integrations and candidate approval. Demo contacts and send events must be clearly labeled DEMO ONLY.

See [the Lovable handoff](docs/LOVABLE_HANDOFF.md#critical-product-requirement-in-app-hiring-contact-discovery-and-outreach) for UI states, acceptance criteria, and API contract direction.
