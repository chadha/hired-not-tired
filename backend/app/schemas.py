from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

NoticeType = Literal["service_terms", "privacy", "analytics", "marketing", "research"]


class LinkedInAuthCapability(BaseModel):
    provider: Literal["linkedin_oidc"] = "linkedin_oidc"
    status: Literal["available", "configuration_required", "unavailable"]
    authorization_path: str | None
    scopes: list[str]
    missing: list[str]
    detail: str


class LinkedInIdentityClaims(BaseModel):
    sub: str = Field(min_length=1, max_length=255)
    name: str | None = Field(default=None, max_length=300)
    given_name: str | None = Field(default=None, max_length=150)
    family_name: str | None = Field(default=None, max_length=150)
    picture: str | None = Field(default=None, max_length=2048)
    email: str | None = Field(default=None, max_length=320)
    email_verified: bool = False
    locale: str | None = Field(default=None, max_length=35)


class AccountConsent(BaseModel):
    notice_type: NoticeType
    notice_version: str
    granted: bool
    recorded_at: datetime


class AuthenticatedWorkspace(BaseModel):
    candidate_id: UUID
    identity: LinkedInIdentityClaims
    first_login: bool
    career_profile_created: bool
    consents: list[AccountConsent]
    consent_versions: dict[NoticeType, str]
    session_expires_at: datetime
    csrf_token: str


class ConsentInput(BaseModel):
    notice_type: NoticeType
    notice_version: str = Field(min_length=1, max_length=64)
    granted: bool


class ConsentsUpdate(BaseModel):
    consents: list[ConsentInput] = Field(min_length=1, max_length=5)


class ConsentsResponse(BaseModel):
    consents: list[AccountConsent]


class DeleteAccountRequest(BaseModel):
    confirmation: str = Field(min_length=1, max_length=64)


class DeleteAccountResponse(BaseModel):
    status: Literal["closed_and_anonymized"] = "closed_and_anonymized"
    sessions_revoked: int
    active_profile_deleted: bool
    external_identity_deleted: bool
    retention_notice: str


class HealthResponse(BaseModel):
    status: str
