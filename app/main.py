from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.schemas import (
    CandidateOnboardRequest, CandidateProfile, CVUploadRequest, LinkedInProfileInput,
    CandidateProfilePatch, JobOpportunity, JobDiscoverRequest, JobMatch,
    OutreachDraftRequest, OutreachDraft, InteractionCreate, Interaction,
    CoachChatRequest, WorkflowRunRequest, WorkflowStatus,
)
from app.store import store
from app.agents import profile_agent, matching_agent, learning_agent, coach_agent
from app.sources import SOURCES

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Coach-first autonomous AI career companion engine.",
    docs_url="/docs",
    openapi_url="/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "hired-not-tired-api", "environment": settings.app_env}


@app.get("/")
def root() -> dict[str, str]:
    return {"name": settings.app_name, "docs": "/docs", "health": "/health"}


@app.post(f"{settings.api_prefix}/candidates/onboard", response_model=CandidateProfile)
def onboard(payload: CandidateOnboardRequest) -> CandidateProfile:
    candidate_id = store.new_id("cand")
    profile = CandidateProfile(
        candidate_id=candidate_id,
        full_name=payload.full_name,
        email=payload.email,
        linkedin_url=payload.linkedin_url,
        career_goal=payload.career_goal,
        target_roles=payload.target_roles or [payload.career_goal],
        locations=payload.locations,
        minimum_salary=payload.minimum_salary,
        currency=payload.currency,
        remote_preference=payload.remote_preference,
        skills=sorted(set(str(s) for s in payload.linkedin_data.get("skills", []))),
        summary=str(payload.linkedin_data.get("summary", "")),
    )
    store.candidates[candidate_id] = profile
    return profile


@app.post(f"{settings.api_prefix}/candidates/{{candidate_id}}/documents/cv", response_model=CandidateProfile)
def upload_cv(candidate_id: str, payload: CVUploadRequest) -> CandidateProfile:
    profile = get_candidate(candidate_id)
    skills, summary = profile_agent.extract(payload.text)
    profile.cv_text = payload.text
    profile.skills = sorted(set(profile.skills + skills))
    profile.summary = (profile.summary + " " + summary).strip()[:1000]
    profile.updated_at = datetime.now(timezone.utc)
    store.candidates[candidate_id] = profile
    return profile


@app.post(f"{settings.api_prefix}/candidates/{{candidate_id}}/profile/linkedin", response_model=CandidateProfile)
def import_linkedin(candidate_id: str, payload: LinkedInProfileInput) -> CandidateProfile:
    profile = get_candidate(candidate_id)
    profile.linkedin_url = payload.linkedin_url or profile.linkedin_url
    supplied_skills = payload.profile_data.get("skills", [])
    profile.skills = sorted(set(profile.skills + [str(x) for x in supplied_skills]))
    profile.summary = (profile.summary + " " + str(payload.profile_data.get("summary", ""))).strip()[:1000]
    profile.updated_at = datetime.now(timezone.utc)
    store.candidates[candidate_id] = profile
    return profile


@app.get(f"{settings.api_prefix}/candidates/{{candidate_id}}/profile", response_model=CandidateProfile)
def get_profile(candidate_id: str) -> CandidateProfile:
    return get_candidate(candidate_id)


@app.patch(f"{settings.api_prefix}/candidates/{{candidate_id}}/profile", response_model=CandidateProfile)
def patch_profile(candidate_id: str, payload: CandidateProfilePatch) -> CandidateProfile:
    profile = get_candidate(candidate_id)
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(profile, key, value)
    profile.updated_at = datetime.now(timezone.utc)
    store.candidates[candidate_id] = profile
    return profile


@app.post(f"{settings.api_prefix}/jobs/discover")
def discover_jobs(payload: JobDiscoverRequest) -> dict[str, Any]:
    get_candidate(payload.candidate_id)
    found: list[JobOpportunity] = []
    for source_name in payload.sources:
        source = SOURCES.get(source_name)
        if source:
            found.extend(source.discover(payload.query, payload.limit))
    for url in payload.submitted_urls:
        existing = next((j for j in store.jobs.values() if j.source_url == url), None)
        if existing:
            found.append(existing)
    unique = {job.job_id: job for job in found}
    return {
        "workflow_id": store.new_id("wf"),
        "status": "completed",
        "jobs": list(unique.values())[:payload.limit],
        "note": "Submitted URLs are retained as candidate-provided sources; parsing requires an approved connector.",
    }


@app.get(f"{settings.api_prefix}/jobs", response_model=list[JobOpportunity])
def list_jobs() -> list[JobOpportunity]:
    return list(store.jobs.values())


@app.post(f"{settings.api_prefix}/jobs/{{job_id}}/match/{{candidate_id}}", response_model=JobMatch)
def match_job(job_id: str, candidate_id: str) -> JobMatch:
    profile = get_candidate(candidate_id)
    job = store.jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    result = matching_agent.match(profile, job)
    store.matches[f"{candidate_id}:{job_id}"] = result
    return result


@app.post(f"{settings.api_prefix}/outreach/draft", response_model=OutreachDraft)
def draft_outreach(payload: OutreachDraftRequest) -> OutreachDraft:
    profile = get_candidate(payload.candidate_id)
    job = store.jobs.get(payload.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    name = payload.hiring_contact_name
    first = profile.full_name.split()[0]
    message = (
        f"Hi {name or 'there'},\n\n"
        f"I came across the {job.title} opportunity at {job.company} and was interested in the team's work. "
        f"My background includes {', '.join(profile.skills[:3]) or 'relevant engineering experience'}, "
        f"and I'm currently focused on {profile.career_goal}. "
        "I'd welcome the opportunity to learn more about the role and the challenges the team is solving.\n\n"
        f"Best,\n{first}"
    )
    draft = OutreachDraft(
        draft_id=store.new_id("draft"),
        candidate_id=profile.candidate_id,
        job_id=job.job_id,
        recipient_name=name,
        message=message,
        factuality_notes=["Review every claim and recipient before sending.", "This is a draft; no message has been sent."],
    )
    store.drafts[draft.draft_id] = draft
    return draft


@app.post(f"{settings.api_prefix}/interactions", response_model=Interaction)
def create_interaction(payload: InteractionCreate) -> Interaction:
    get_candidate(payload.candidate_id)
    if payload.job_id not in store.jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    interaction = Interaction(
        interaction_id=store.new_id("int"),
        candidate_id=payload.candidate_id,
        job_id=payload.job_id,
        channel=payload.channel,
        interaction_type=payload.interaction_type,
        content=payload.content,
        outcome=payload.outcome,
        simulated=payload.simulated,
    )
    store.interactions[interaction.interaction_id] = interaction
    for insight in learning_agent.analyze(interaction):
        store.insights[insight.insight_id] = insight
    return interaction


@app.get(f"{settings.api_prefix}/career/memory/{{candidate_id}}")
def career_memory(candidate_id: str) -> dict[str, Any]:
    get_candidate(candidate_id)
    interactions = [x for x in store.interactions.values() if x.candidate_id == candidate_id]
    insights = [x for x in store.insights.values() if any(
        interaction_id in {i.interaction_id for i in interactions}
        for interaction_id in x.evidence_interaction_ids
    )]
    return {
        "candidate_id": candidate_id,
        "profile": store.candidates[candidate_id].model_dump(mode="json"),
        "episodic_memory": [x.model_dump(mode="json") for x in interactions],
        "strategic_insights": [x.model_dump(mode="json") for x in insights],
    }


@app.post(f"{settings.api_prefix}/coach/chat")
def coach_chat(payload: CoachChatRequest) -> dict[str, Any]:
    profile = get_candidate(payload.candidate_id)
    interactions = [x for x in store.interactions.values() if x.candidate_id == payload.candidate_id]
    insights = list(store.insights.values())
    jobs = list(store.jobs.values())
    response = coach_agent.respond(profile, payload.message, interactions, insights, jobs)
    store.actions[payload.candidate_id] = response.recommended_actions
    return response.model_dump(mode="json")


@app.get(f"{settings.api_prefix}/coach/action-plan/{{candidate_id}}")
def action_plan(candidate_id: str) -> dict[str, Any]:
    get_candidate(candidate_id)
    return {
        "candidate_id": candidate_id,
        "actions": [x.model_dump(mode="json") for x in store.actions.get(candidate_id, [])],
    }


@app.post(f"{settings.api_prefix}/workflows/run", response_model=WorkflowStatus)
def run_workflow(payload: WorkflowRunRequest) -> WorkflowStatus:
    get_candidate(payload.candidate_id)
    now = datetime.now(timezone.utc)
    workflow = WorkflowStatus(
        workflow_id=store.new_id("wf"),
        candidate_id=payload.candidate_id,
        workflow_type=payload.workflow_type,
        status="completed",
        result={"message": "MVP workflow completed. See coach action plan and job discovery endpoints."},
        created_at=now,
        updated_at=now,
    )
    store.workflows[workflow.workflow_id] = workflow
    return workflow


@app.get(f"{settings.api_prefix}/workflows/{{workflow_id}}", response_model=WorkflowStatus)
def get_workflow(workflow_id: str) -> WorkflowStatus:
    workflow = store.workflows.get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


@app.post(f"{settings.api_prefix}/demo/seed")
def seed_demo() -> dict[str, Any]:
    # Idempotent enough for a single-candidate judge demo.
    existing = next((p for p in store.candidates.values() if p.email == "sarah.demo@example.com"), None)
    if existing:
        profile = existing
    else:
        profile = CandidateProfile(
            candidate_id="cand_sarah_demo",
            full_name="Sarah Miller",
            email="sarah.demo@example.com",
            linkedin_url="https://www.linkedin.com/in/sarah-miller-demo",
            career_goal="AI Solutions Architect",
            target_roles=["AI Solutions Architect", "Senior Platform Engineer"],
            locations=["Berlin", "Remote"],
            minimum_salary=75000,
            skills=["Python", "AWS", "Kubernetes", "FastAPI", "Platform Engineering", "Docker"],
            experience_years=6,
            summary="Senior backend and platform engineer moving toward production AI architecture.",
            cv_text="Python AWS Kubernetes FastAPI Docker platform engineering backend",
        )
        store.candidates[profile.candidate_id] = profile

    demo_jobs = [
        JobOpportunity(
            job_id="job_ai_architect_demo",
            title="AI Solutions Architect",
            company="Northstar AI (demo)",
            location="Berlin / Hybrid",
            description="Design enterprise AI solutions, cloud architecture, Python services and production LLM workflows.",
            requirements=["Python", "AWS", "Kubernetes", "Production AI", "LLM evaluation"],
            salary_min=80000,
            salary_max=95000,
            source="demo",
            source_url="https://example.com/demo/ai-solutions-architect",
            is_demo=True,
        ),
        JobOpportunity(
            job_id="job_platform_demo",
            title="Senior Platform Engineer",
            company="Orbit Systems (demo)",
            location="Remote",
            description="Build cloud-native platform services with Kubernetes, Terraform, Python and observability.",
            requirements=["Python", "Kubernetes", "Terraform", "AWS", "Observability"],
            salary_min=78000,
            salary_max=90000,
            source="demo",
            source_url="https://example.com/demo/platform-engineer",
            is_demo=True,
        ),
    ]
    for job in demo_jobs:
        store.jobs[job.job_id] = job

    return {
        "candidate": profile.model_dump(mode="json"),
        "jobs": [x.model_dump(mode="json") for x in demo_jobs],
        "demo": True,
        "message": "Demo data is simulated and must not be represented as live vacancies or recruiter activity.",
    }


def get_candidate(candidate_id: str) -> CandidateProfile:
    profile = store.candidates.get(candidate_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return profile
