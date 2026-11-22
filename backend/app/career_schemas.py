from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Candidate(BaseModel):
    candidate_id: str
    full_name: str = Field(default="", max_length=300)
    email: str = Field(default="", max_length=320)
    linkedin_url: str | None = None
    career_goal: str = Field(default="", max_length=300)
    target_roles: list[str] = Field(default_factory=list, max_length=30)
    locations: list[str] = Field(default_factory=list, max_length=30)
    minimum_salary: int | None = Field(default=None, ge=0, le=100_000_000)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    remote_preference: str = Field(default="any", max_length=32)
    skills: list[str] = Field(default_factory=list, max_length=100)
    experience_years: float | None = Field(default=None, ge=0, le=80)
    summary: str = Field(default="", max_length=20_000)
    cv_text: str = Field(default="", max_length=200_000)
    cv_filename: str | None = Field(default=None, max_length=255)
    master_profile_version: int = Field(default=1, ge=1)
    profile_confirmed_at: str | None = None
    master_profile_history: list[dict[str, Any]] = Field(default_factory=list)
    master_documents: list[dict[str, Any]] = Field(default_factory=list)


class ProfileFact(BaseModel):
    fact_id: str
    fact_type: Literal["identity", "preference", "skill", "experience", "summary", "career_history"]
    label: str
    value: str
    source_kind: Literal["uploaded_cv", "conversational_profile", "conversational_onboarding"]
    source_reference: str
    source_excerpt: str
    confidence: float = Field(ge=0, le=1)
    confirmed_at: str | None
    version: int = Field(ge=1)


class MasterProfile(BaseModel):
    profile_version: int = Field(ge=1)
    captured_at: str
    revision_of: int | None
    source: dict[str, Any]
    facts: list[ProfileFact]
    conflicts: list[dict[str, Any]]


class Job(BaseModel):
    job_id: str
    title: str
    company: str
    location: str = ""
    description: str
    requirements: list[str] = Field(default_factory=list)
    salary_min: int | None = None
    salary_max: int | None = None
    currency: str = "EUR"
    remote_type: str = "unknown"
    source: str
    source_url: str
    retrieved_at: str
    is_demo: Literal[False] = False
    application_method: Literal["easy_apply", "external", "unknown"] | None = None


class CvApproval(BaseModel):
    artifact_id: str
    version: int
    approved_text_hash: str
    approved_at: str
    approved_by: str


class CvArtifact(BaseModel):
    artifact_id: str
    package_id: str
    version: int
    content: str
    change_summary: list[str]
    evidence_used: list[str]
    evidence_fact_ids: list[str]
    source_profile_version: int
    source_job_snapshot_id: str
    created_at: str
    approval: CvApproval | None


class ApplicationAnswer(BaseModel):
    answer_id: str
    question: str
    proposed_answer: str
    evidence_fact_ids: list[str]
    status: Literal["needs_candidate_input", "candidate_confirmed"]
    sensitive: bool
    version: int
    updated_at: str


class CoverLetterArtifact(BaseModel):
    artifact_id: str
    package_id: str
    version: int
    content: str
    source_profile_version: int
    source_job_snapshot_id: str
    created_at: str
    approval: CvApproval | None


class ChannelAction(BaseModel):
    channel: Literal["linkedin_easy_apply", "employer_site", "hiring_team", "email"]
    state: Literal[
        "draft", "approved", "handed_off", "candidate_reported", "provider_confirmed", "failed"
    ]
    approval: dict[str, Any] | None
    idempotency_key: str
    handed_off_at: str | None
    candidate_reported_at: str | None
    provider_receipt_id: str | None


class ApplicationPackage(BaseModel):
    package_id: str
    candidate_id: str
    job_id: str
    revision: int = Field(ge=1)
    status: Literal["draft", "approved"]
    source: dict[str, Any]
    master_profile: MasterProfile
    master_profile_history: list[MasterProfile]
    job_snapshot: dict[str, Any]
    analysis: dict[str, Any]
    versions: list[CvArtifact]
    current_artifact_id: str
    answers: list[ApplicationAnswer]
    cover_letter_versions: list[CoverLetterArtifact]
    current_cover_letter_id: str | None
    channel_actions: list[ChannelAction]
    capabilities: dict[str, Any]
    created_at: str
    updated_at: str
    is_demo: Literal[False] = False


class HiringContact(BaseModel):
    contact_id: str
    candidate_id: str
    job_id: str
    full_name: str
    current_title: str = ""
    company: str = ""
    profile_url: str = ""
    email: str = ""
    location: str = ""
    source_url: str = ""
    evidence_notes: str = ""
    confidence: Literal["low", "medium", "high"]
    relevance: str
    evidence_status: Literal["candidate_supplied", "public_search_result"]
    last_checked_at: str | None
    evidence_date: str | None = None
    created_at: str
    updated_at: str
    is_demo: Literal[False] = False


class ContactDiscoveryResult(BaseModel):
    status: Literal["found", "no_reliable_match", "not_configured", "unavailable"]
    contacts: list[HiringContact]
    fallback_url: str
    detail: str
    searched_at: str


class OutreachDraft(BaseModel):
    draft_id: str
    candidate_id: str
    job_id: str
    contact_id: str
    recipient_name: str | None = None
    subject: str | None = None
    message: str
    factuality_notes: list[str]
    status: str = "draft"
    requires_user_action: bool = True


class ApprovalReceipt(BaseModel):
    draft_id: str
    status: Literal["approved"] = "approved"
    recipient_url: str | None
    recipient_email: str | None = None
    subject: str | None = None
    attachment: dict[str, Any] | None = None
    body: str
    approved_text_hash: str
    approved_at: str
    approved_by: str


class HandoffReceipt(BaseModel):
    draft_id: str
    status: Literal["handed_off"] = "handed_off"
    linkedin_url: str | None = None
    recipient_email: str | None = None
    subject: str | None = None
    message: str
    mailto_url: str | None = None
    handed_off_at: str


class CandidateSentReceipt(BaseModel):
    draft_id: str
    status: Literal["candidate_confirmed_sent"] = "candidate_confirmed_sent"
    candidate_confirmed_sent_at: str


class Interaction(BaseModel):
    interaction_id: str
    candidate_id: str
    job_id: str
    channel: str
    interaction_type: str
    content: str
    outcome: str | None = None
    simulated: Literal[False] = False
    created_at: str


class WorkspaceData(BaseModel):
    contacts: list[HiringContact]
    application_packages: list[ApplicationPackage]
    messages: list[dict[str, Any]]
    interactions: list[Interaction]
    timeline: list[dict[str, Any]]


class JobImportInput(StrictModel):
    candidate_id: UUID
    source_url: str = Field(min_length=8, max_length=2048)


class JobDiscoverInput(StrictModel):
    candidate_id: UUID
    sources: list[str] = Field(default_factory=list, max_length=10)
    limit: int = Field(default=10, ge=1, le=50)


class JobsResponse(BaseModel):
    jobs: list[Job]


class ProfilePatch(StrictModel):
    expected_version: int = Field(ge=1)
    candidate_confirmed: bool
    full_name: str | None = Field(default=None, max_length=300)
    email: str | None = Field(default=None, max_length=320)
    career_goal: str | None = Field(default=None, max_length=300)
    target_roles: list[str] | None = Field(default=None, max_length=30)
    locations: list[str] | None = Field(default=None, max_length=30)
    skills: list[str] | None = Field(default=None, max_length=100)
    experience_years: float | None = Field(default=None, ge=0, le=80)
    summary: str | None = Field(default=None, max_length=20_000)
    cv_text: str | None = Field(default=None, max_length=200_000)
    minimum_salary: int | None = Field(default=None, ge=0, le=100_000_000)
    remote_preference: str | None = Field(default=None, max_length=32)


class CvUploadInput(StrictModel):
    filename: str = Field(min_length=1, max_length=255)
    text: str = Field(min_length=1, max_length=200_000)


class FactRevisionInput(StrictModel):
    expected_version: int = Field(ge=1)
    candidate_confirmed: Literal[True]
    fact_id: str | None = None
    value: str | None = Field(default=None, max_length=200_000)
    conflict_id: str | None = None
    use_proposed: bool | None = None
    confirm_all: Literal[True] | None = None


class FactRevisionResponse(BaseModel):
    candidate: Candidate
    master_profile: MasterProfile


class CvArtifactInput(StrictModel):
    action: Literal["generate"] | None = None
    source_profile_version: int | None = Field(default=None, ge=1)
    artifact_id: str | None = None
    content: str | None = Field(default=None, max_length=200_000)


class ApprovalInput(StrictModel):
    artifact_type: Literal["tailored_cv", "cover_letter", "channel_action", "outreach_draft"]
    artifact_id: str | None = None
    version: int | None = Field(default=None, ge=1)
    content: str | None = Field(default=None, max_length=200_000)
    channel: str | None = None
    destination: str | None = None
    draft_id: str | None = None
    contact_id: str | None = None
    recipient_url: str | None = None
    recipient_email: str | None = None
    subject: str | None = None
    attachment: dict[str, Any] | None = None
    body: str | None = Field(default=None, max_length=30_000)


class AnswerInput(StrictModel):
    answer_id: str | None = None
    question: str = Field(min_length=1, max_length=2000)
    proposed_answer: str = Field(default="", max_length=30_000)
    confirmed: bool


class PackagePatch(StrictModel):
    cover_letter: dict[str, Any]


class ActionInput(StrictModel):
    action: Literal["handoff", "submit"]
    destination: str | None = None
    draft_id: str | None = None
    approved_text_hash: str | None = None
    idempotency_key: str | None = None


class CandidateConfirmationInput(StrictModel):
    candidate_reported: bool | None = None
    candidate_confirmed: bool | None = None
    idempotency_key: str | None = None
    draft_id: UUID | None = None


class ContactInput(StrictModel):
    display_name: str = Field(min_length=1, max_length=300)
    current_title: str | None = Field(default=None, max_length=300)
    current_company: str | None = Field(default=None, max_length=300)
    location: str | None = Field(default=None, max_length=300)
    linkedin_url: str | None = Field(default=None, max_length=2048)
    discovery_method: Literal["manual"] = "manual"
    evidence: dict[str, Any] = Field(default_factory=dict)


class ContactPatch(StrictModel):
    display_name: str = Field(min_length=1, max_length=300)
    current_title: str | None = Field(default=None, max_length=300)
    current_company: str | None = Field(default=None, max_length=300)
    location: str | None = Field(default=None, max_length=300)
    email: str | None = Field(default=None, max_length=320)
    linkedin_url: str | None = Field(default=None, max_length=2048)
    source_url: str | None = Field(default=None, max_length=2048)
    evidence_notes: str | None = Field(default=None, max_length=5000)


class OutreachDraftInput(StrictModel):
    candidate_id: UUID
    job_id: UUID
    contact_id: UUID | None = None
    hiring_contact_name: str | None = Field(default=None, max_length=300)
    hiring_contact_context: str | None = Field(default=None, max_length=5000)
    tone: Literal["professional", "warm", "concise"] = "warm"


class EmailDraftInput(StrictModel):
    channel: Literal["email"]
    contact_id: UUID
    recipient_email: str = Field(min_length=3, max_length=320)
    cv_artifact_id: str


class DraftPatch(StrictModel):
    contact_id: UUID
    recipient_url: str | None = None
    recipient_email: str | None = None
    subject: str | None = Field(default=None, max_length=500)
    attachment: dict[str, Any] | None = None
    body: str = Field(min_length=1, max_length=30_000)


class DraftApprovalInput(StrictModel):
    draft_id: UUID
    contact_id: UUID
    recipient_url: str | None = None
    recipient_email: str | None = None
    subject: str | None = None
    attachment: dict[str, Any] | None = None
    body: str = Field(min_length=1, max_length=30_000)


class HandoffInput(StrictModel):
    contact_id: UUID
    recipient_url: str
    idempotency_key: str | None = None


class InteractionInput(StrictModel):
    candidate_id: UUID
    job_id: UUID
    channel: str = Field(default="manual", max_length=32)
    interaction_type: Literal[
        "application_submitted",
        "outreach_sent",
        "recruiter_reply",
        "interview",
        "rejection",
        "offer",
        "note",
    ]
    content: str = Field(min_length=1, max_length=20_000)
    outcome: str | None = Field(default=None, max_length=100)
    simulated: Literal[False] = False
    draft_id: UUID | None = None
    reply_date: str | None = None


class CoachInput(StrictModel):
    candidate_id: UUID
    message: str = Field(min_length=1, max_length=10_000)
    include_memory: bool = True
    include_recent_interactions: bool = True


class CoachReply(BaseModel):
    message: str
    insights: list[str]
    recommended_actions: list[dict[str, Any]]
    workflow_id: str
    coach_mode: Literal["deterministic"] = "deterministic"


class ActionPlan(BaseModel):
    candidate_id: str
    actions: list[dict[str, Any]]


class MatchEvidence(BaseModel):
    requirement: str
    status: Literal["strong_match", "partial_match", "gap", "unknown"]
    evidence: str


class JobMatch(BaseModel):
    candidate_id: str
    job_id: str
    match_score: int = Field(ge=0, le=100)
    confidence: Literal["low", "medium", "high"]
    strengths: list[str]
    gaps: list[str]
    evidence: list[MatchEvidence]
    constraints_met: bool
    recommendation: str


class OnboardInput(StrictModel):
    full_name: str = Field(min_length=1, max_length=300)
    email: str = Field(min_length=3, max_length=320)
    linkedin_url: str | None = None
    career_goal: str = Field(default="", max_length=300)
    target_roles: list[str] = Field(default_factory=list, max_length=30)
    locations: list[str] = Field(default_factory=list, max_length=30)
    minimum_salary: int | None = Field(default=None, ge=0)
    currency: str = "EUR"
    remote_preference: str = "any"


class LinkedInProfileInput(StrictModel):
    linkedin_url: str = Field(min_length=8, max_length=2048)
    consent_confirmed: Literal[True]


class EmptyInput(StrictModel):
    pass


class PackageListResponse(BaseModel):
    packages: list[ApplicationPackage]


class RevisionResponse(BaseModel):
    revisions: list[MasterProfile]


class DownloadResponse(BaseModel):
    artifact_id: str
    version: int
    filename: str
    content: str


class ContactListResponse(BaseModel):
    contacts: list[HiringContact]


class MessageListResponse(BaseModel):
    messages: list[dict[str, Any]]


class TimelineResponse(BaseModel):
    events: list[dict[str, Any]]


class DeleteResponse(BaseModel):
    status: str


class PackageActionResponse(BaseModel):
    receipt_id: str
    channel: str
    payload_hash: str
    confirmed_at: str


class ProviderStatus(BaseModel):
    configured: bool
    detail: str


class ProviderCapabilitiesResponse(BaseModel):
    source: Literal["backend"] = "backend"
    needle: dict[str, Any]
    email: dict[str, Any]
    applications: dict[str, Any]
    documents: dict[str, str]
    contact_discovery: ProviderStatus
    job_import: ProviderStatus
    job_search: ProviderStatus


class HealthStatus(BaseModel):
    status: str


class ErrorResponse(BaseModel):
    error: dict[str, Any]


class ProfileResponse(BaseModel):
    candidate: Candidate


class PackageRevisionHistory(BaseModel):
    revisions: list[ApplicationPackage]


class ArtifactListResponse(BaseModel):
    artifacts: list[CvArtifact]


class ContactDiscoveryInput(StrictModel):
    candidate_id: UUID


class IdempotencyInput(StrictModel):
    key: str = Field(min_length=8, max_length=128)


class SourceEvidence(BaseModel):
    source_url: str
    observed_at: datetime
    excerpt: str


class SearchProviderQuery(BaseModel):
    query: str
    source_urls: list[str]


class RevisionCheck(BaseModel):
    expected_version: int


class CandidateOwnedResource(BaseModel):
    candidate_id: UUID


class ArtifactApprovalResponse(BaseModel):
    approval: CvApproval


class MessageApprovalResponse(BaseModel):
    approval: ApprovalReceipt


class ExportValidation(BaseModel):
    artifact_id: str
    version: int
    approved: bool


class JobImportResponse(BaseModel):
    job: Job


class AccountDataResponse(BaseModel):
    workspace: WorkspaceData


class AuditEventResponse(BaseModel):
    event_type: str
    resource_id: str
    created_at: str


class APIErrorResponse(BaseModel):
    code: str
    message: str


class ConfirmationResponse(BaseModel):
    confirmed: bool


class RecordResponse(BaseModel):
    id: UUID


class CapabilityUnavailable(BaseModel):
    available: Literal[False] = False
    reason: str


class TextArtifact(BaseModel):
    content: str
    content_type: str = "text/plain; charset=utf-8"


class PublicUrlInput(StrictModel):
    url: str

    @field_validator("url")
    @classmethod
    def no_credentials(cls, value: str) -> str:
        if "@" in value:
            raise ValueError("Credentials are not allowed in URLs")
        return value
