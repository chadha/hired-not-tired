from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from pydantic import BaseModel, EmailStr, Field, HttpUrl, ConfigDict


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class APIModel(BaseModel):
    model_config = ConfigDict(use_enum_values=True)


class CandidateOnboardRequest(APIModel):
    full_name: str = Field(min_length=1, max_length=120)
    email: str
    linkedin_url: str | None = None
    linkedin_data: dict[str, Any] = Field(default_factory=dict)
    career_goal: str = Field(min_length=2, max_length=160)
    target_roles: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    minimum_salary: int | None = Field(default=None, ge=0)
    currency: str = "EUR"
    remote_preference: Literal["remote", "hybrid", "onsite", "any"] = "any"


class CandidateProfile(APIModel):
    candidate_id: str
    full_name: str
    email: str
    linkedin_url: str | None = None
    career_goal: str
    target_roles: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    minimum_salary: int | None = None
    currency: str = "EUR"
    remote_preference: str = "any"
    skills: list[str] = Field(default_factory=list)
    experience_years: float | None = None
    summary: str = ""
    cv_text: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class CVUploadRequest(APIModel):
    filename: str
    text: str = Field(min_length=20, max_length=100_000)


class LinkedInProfileInput(APIModel):
    linkedin_url: str | None = None
    profile_data: dict[str, Any] = Field(default_factory=dict)


class CandidateProfilePatch(APIModel):
    career_goal: str | None = None
    target_roles: list[str] | None = None
    locations: list[str] | None = None
    minimum_salary: int | None = None
    remote_preference: str | None = None
    skills: list[str] | None = None


class JobOpportunity(APIModel):
    job_id: str
    title: str
    company: str
    location: str = "Not specified"
    description: str
    requirements: list[str] = Field(default_factory=list)
    salary_min: int | None = None
    salary_max: int | None = None
    currency: str = "EUR"
    remote_type: str = "unspecified"
    source: str
    source_url: str
    is_demo: bool = False
    discovered_at: datetime = Field(default_factory=utcnow)


class JobDiscoverRequest(APIModel):
    candidate_id: str
    submitted_urls: list[str] = Field(default_factory=list)
    query: str | None = None
    sources: list[str] = Field(default_factory=lambda: ["candidate_submitted", "demo"])
    limit: int = Field(default=10, ge=1, le=50)


class MatchEvidence(APIModel):
    requirement: str
    status: Literal["strong_match", "partial_match", "gap", "unknown"]
    evidence: str


class JobMatch(APIModel):
    candidate_id: str
    job_id: str
    match_score: int = Field(ge=0, le=100)
    confidence: Literal["low", "medium", "high"] = "medium"
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    evidence: list[MatchEvidence] = Field(default_factory=list)
    constraints_met: bool = True
    recommendation: str = "review_opportunity"


class OutreachDraftRequest(APIModel):
    candidate_id: str
    job_id: str
    hiring_contact_name: str | None = None
    hiring_contact_context: str | None = None
    tone: Literal["professional", "warm", "concise"] = "warm"


class OutreachDraft(APIModel):
    draft_id: str
    candidate_id: str
    job_id: str
    recipient_name: str | None = None
    subject: str | None = None
    message: str
    factuality_notes: list[str] = Field(default_factory=list)
    status: Literal["draft", "approved", "sent_by_user"] = "draft"
    requires_user_action: bool = True


class InteractionCreate(APIModel):
    candidate_id: str
    job_id: str
    channel: str = "manual"
    interaction_type: Literal["application_submitted", "outreach_sent", "recruiter_reply", "interview", "rejection", "offer", "note"]
    content: str = Field(min_length=1, max_length=10_000)
    outcome: str | None = None
    simulated: bool = False


class Interaction(APIModel):
    interaction_id: str
    candidate_id: str
    job_id: str
    channel: str
    interaction_type: str
    content: str
    outcome: str | None = None
    simulated: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class LearningInsight(APIModel):
    insight_id: str
    category: Literal["strength", "skill_gap", "strategy", "momentum", "feedback"]
    title: str
    detail: str
    evidence_interaction_ids: list[str] = Field(default_factory=list)
    confidence: Literal["low", "medium", "high"] = "medium"


class CoachChatRequest(APIModel):
    candidate_id: str
    message: str = Field(min_length=1, max_length=5_000)
    include_memory: bool = True
    include_recent_interactions: bool = True


class RecommendedAction(APIModel):
    action_id: str
    title: str
    description: str
    priority: Literal["high", "medium", "low"] = "medium"
    action_type: Literal["job_search", "outreach", "learning", "application", "wellbeing", "follow_up"]
    estimated_minutes: int | None = None


class CoachChatResponse(APIModel):
    message: str
    insights: list[str] = Field(default_factory=list)
    recommended_actions: list[RecommendedAction] = Field(default_factory=list)
    workflow_id: str
    coach_mode: Literal["demo", "bedrock"] = "demo"


class WorkflowRunRequest(APIModel):
    candidate_id: str
    workflow_type: Literal["daily_career_pulse", "discover_and_match", "coach_review"] = "daily_career_pulse"


class WorkflowStatus(APIModel):
    workflow_id: str
    candidate_id: str
    workflow_type: str
    status: Literal["queued", "running", "completed", "failed"]
    result: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
