import json
from collections.abc import Awaitable, Callable
from typing import Any, cast
from uuid import UUID

from fastapi import Request
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.career_engine import canonical_json, content_hash, create_master_profile, initial_candidate
from app.career_schemas import ApplicationPackage, Candidate, HiringContact, Job, MasterProfile
from app.database import utcnow
from app.dependencies import AuthContext
from app.errors import ApiError
from app.models import (
    ApplicationPackageRecord,
    AuditEvent,
    CareerProfile,
    ContactRecord,
    IdempotencyRecord,
    JobRecord,
    PackageRevision,
    ProfileRevision,
)

JsonDict = dict[str, Any]


def require_candidate(auth: AuthContext, candidate_id: UUID) -> None:
    if auth.user.id != candidate_id:
        raise ApiError(
            404, "resource_not_found", "The requested candidate resource is unavailable."
        )


async def get_candidate(db: AsyncSession, auth: AuthContext) -> Candidate:
    profile = await db.scalar(select(CareerProfile).where(CareerProfile.user_id == auth.user.id))
    if profile is None:
        profile = CareerProfile(user_id=auth.user.id)
        db.add(profile)
        await db.flush()
    revision = await db.scalar(
        select(ProfileRevision)
        .where(ProfileRevision.profile_id == profile.id)
        .order_by(ProfileRevision.revision.desc())
        .limit(1)
    )
    if revision:
        return Candidate.model_validate(revision.candidate_data)
    candidate = initial_candidate(str(auth.user.id), auth.user.full_name, auth.user.email)
    master = create_master_profile(candidate)
    db.add(
        ProfileRevision(
            profile_id=profile.id,
            revision=1,
            candidate_data=candidate.model_dump(mode="json"),
            master_profile=master.model_dump(mode="json"),
        )
    )
    await db.flush()
    return candidate


async def current_master(
    db: AsyncSession, auth: AuthContext, candidate: Candidate
) -> MasterProfile:
    profile = await db.scalar(select(CareerProfile).where(CareerProfile.user_id == auth.user.id))
    if profile is not None:
        revision = await db.scalar(
            select(ProfileRevision)
            .where(ProfileRevision.profile_id == profile.id)
            .order_by(ProfileRevision.revision.desc())
            .limit(1)
        )
        if revision:
            return MasterProfile.model_validate(revision.master_profile)
    return create_master_profile(candidate)


async def save_candidate_revision(
    db: AsyncSession,
    auth: AuthContext,
    candidate: Candidate,
    master: MasterProfile,
    expected_version: int,
) -> None:
    profile = await db.scalar(select(CareerProfile).where(CareerProfile.user_id == auth.user.id))
    if profile is None:
        raise ApiError(404, "profile_not_found", "The candidate profile is unavailable.")
    if candidate.master_profile_version != expected_version + 1:
        raise ApiError(
            409,
            "revision_invalid",
            "A confirmed revision must increment the profile version exactly once.",
        )
    result = cast(
        CursorResult[Any],
        await db.execute(
            update(CareerProfile)
            .where(CareerProfile.id == profile.id, CareerProfile.revision == expected_version)
            .values(revision=expected_version + 1, updated_at=utcnow())
        ),
    )
    if result.rowcount != 1:
        raise ApiError(
            409,
            "revision_conflict",
            "The profile changed. Reload the latest revision and review again.",
        )
    db.add(
        ProfileRevision(
            profile_id=profile.id,
            revision=candidate.master_profile_version,
            candidate_data=candidate.model_dump(mode="json"),
            master_profile=master.model_dump(mode="json"),
            captured_at=utcnow(),
        )
    )
    await db.flush()


def job_schema(record: JobRecord) -> Job:
    return Job(
        job_id=str(record.id),
        title=record.title,
        company=record.company,
        location=record.location,
        description=record.description,
        requirements=record.requirements,
        salary_min=record.salary_min,
        salary_max=record.salary_max,
        currency=record.currency,
        remote_type=record.remote_type,
        source=record.source,
        source_url=record.source_url,
        retrieved_at=record.retrieved_at.isoformat(),
        is_demo=False,
        application_method=record.application_method,
    )


async def owned_job(db: AsyncSession, auth: AuthContext, job_id: UUID) -> JobRecord:
    record = await db.scalar(
        select(JobRecord).where(JobRecord.id == job_id, JobRecord.user_id == auth.user.id)
    )
    if record is None:
        raise ApiError(404, "job_not_found", "The selected job is unavailable in this account.")
    return record


async def owned_package(
    db: AsyncSession, auth: AuthContext, package_id: UUID
) -> ApplicationPackageRecord:
    record = await db.scalar(
        select(ApplicationPackageRecord).where(
            ApplicationPackageRecord.id == package_id,
            ApplicationPackageRecord.user_id == auth.user.id,
        )
    )
    if record is None:
        raise ApiError(
            404,
            "application_package_not_found",
            "The application package is unavailable in this account.",
        )
    return record


def package_schema(record: ApplicationPackageRecord) -> ApplicationPackage:
    return ApplicationPackage.model_validate({**record.data, "revision": record.revision})


def check_package_revision(request: Request, record: ApplicationPackageRecord) -> None:
    value = request.headers.get("if-match")
    if not value:
        raise ApiError(
            428, "revision_required", "Send If-Match with the package revision being reviewed."
        )
    try:
        expected = int(value.strip('"'))
    except ValueError:
        raise ApiError(
            422, "revision_invalid", "If-Match must contain the numeric package revision."
        ) from None
    if expected != record.revision:
        raise ApiError(
            409,
            "revision_conflict",
            "The package changed. Reload it and review the latest version again.",
        )


async def save_package(
    db: AsyncSession,
    record: ApplicationPackageRecord,
    data: JsonDict,
) -> ApplicationPackage:
    record.revision += 1
    data["revision"] = record.revision
    record.data = data
    record.updated_at = utcnow()
    db.add(PackageRevision(package_id=record.id, revision=record.revision, data=data))
    await db.flush()
    return package_schema(record)


def contact_schema(record: ContactRecord) -> HiringContact:
    return HiringContact.model_validate(record.data)


async def owned_contact(db: AsyncSession, auth: AuthContext, contact_id: UUID) -> ContactRecord:
    record = await db.scalar(
        select(ContactRecord).where(
            ContactRecord.id == contact_id, ContactRecord.user_id == auth.user.id
        )
    )
    if record is None:
        raise ApiError(
            404, "contact_not_found", "The hiring contact is unavailable in this account."
        )
    return record


async def run_mutation(
    db: AsyncSession,
    request: Request,
    auth: AuthContext,
    operation: str,
    payload: JsonDict,
    resource_type: str,
    resource_id: str,
    callback: Callable[[], Awaitable[JsonDict | BaseModel]],
) -> JsonDict:
    key = request.headers.get("idempotency-key")
    if not key or not 8 <= len(key) <= 128:
        raise ApiError(
            428, "idempotency_key_required", "Send an Idempotency-Key between 8 and 128 characters."
        )
    request_hash = content_hash({"operation": operation, "payload": payload})
    existing = await db.scalar(
        select(IdempotencyRecord).where(
            IdempotencyRecord.user_id == auth.user.id,
            IdempotencyRecord.key == key,
        )
    )
    if existing:
        if existing.operation != operation or existing.request_hash != request_hash:
            raise ApiError(
                409,
                "idempotency_conflict",
                "This idempotency key was already used for a different operation or payload.",
            )
        return existing.response_data
    result = await callback()
    response = result.model_dump(mode="json") if isinstance(result, BaseModel) else result
    db.add(
        IdempotencyRecord(
            user_id=auth.user.id,
            key=key,
            operation=operation,
            request_hash=request_hash,
            response_data=response,
        )
    )
    db.add(
        AuditEvent(
            user_id=auth.user.id,
            event_type=operation,
            resource_type=resource_type,
            resource_id=resource_id,
            request_id=getattr(request.state, "request_id", "unknown"),
            event_data={
                "job_id": response.get("job_id"),
                "package_id": response.get("package_id"),
                "draft_id": response.get("draft_id"),
            },
        )
    )
    await db.flush()
    return response


async def timeline_for(db: AsyncSession, auth: AuthContext) -> list[JsonDict]:
    records = (
        (
            await db.execute(
                select(AuditEvent)
                .where(AuditEvent.user_id == auth.user.id)
                .order_by(AuditEvent.created_at.asc(), AuditEvent.id.asc())
            )
        )
        .scalars()
        .all()
    )
    events: list[JsonDict] = []
    for record in records:
        data = record.event_data
        events.append(
            {
                "timeline_id": str(record.id),
                "job_id": data.get("job_id") if isinstance(data.get("job_id"), str) else None,
                "draft_id": data.get("draft_id") if isinstance(data.get("draft_id"), str) else None,
                "contact_id": data.get("contact_id")
                if isinstance(data.get("contact_id"), str)
                else None,
                "type": record.event_type,
                "title": record.event_type.replace("_", " ").capitalize(),
                "detail": f"Backend-recorded {record.resource_type} event; no external delivery is implied.",
                "created_at": record.created_at.isoformat(),
                "source": "backend_confirmed",
                "simulated": False,
            }
        )
    return events


def decode_cached_package(value: str) -> JsonDict:
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ApiError(500, "internal_error", "An unexpected error occurred.")
    return parsed


def stable_request_payload(value: object) -> str:
    return canonical_json(value)
